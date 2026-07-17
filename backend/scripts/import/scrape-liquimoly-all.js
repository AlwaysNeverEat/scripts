#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Полный сбор Liqui Moly по каталогу — строго по одной марке за раз. После
// КАЖДОЙ марки новые машины сразу уходят в БД (кадэнс 25 записей / 30 сек), а
// существующие пополняются недостающими объёмами/мощностью. Рост базы виден по
// ходу, а не в самом конце.
//
// Запуск (из backend/):
//   node scripts/import/scrape-liquimoly-all.js --import-new --user <login>
//   node scripts/import/scrape-liquimoly-all.js --import-new --brands "Audi,BMW"
//
// Отправку в БД включает --import-new. Без него — только локальный сбор.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './http.js';
import { fetchManufacturers } from './liquimoly-api.js';
import { cleanBrand } from './liquimoly-parse.js';
import { color, mark, stage, info } from './log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback; };

const IMPORT_NEW = args.includes('--import-new');
const USER_LOGIN = arg('--user', null);
const OUT_FILE = path.resolve(ROOT, arg('--out', 'data/import/liquimoly-cars.json'));
const BATCH_DIR = path.resolve(ROOT, arg('--batch-dir', 'data/import/batches'));
const LIMIT_BRANDS = parseInt(arg('--limit-brands', '0')) || Infinity;
const BATCH_SIZE = arg('--batch-size', '25');
const BATCH_INTERVAL = arg('--batch-interval-ms', '30000');
const HEARTBEAT = Math.max(5, Number(arg('--heartbeat-seconds', '20')) || 20);
const ONLY = arg('--brands', '').split(',').map(cleanBrand).filter(Boolean);
fs.mkdirSync(BATCH_DIR, { recursive: true });

const carCount = () => (readJson(OUT_FILE, []) || []).length;
const dur = ms => { const s = Math.floor(ms / 1000); return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(x => String(x).padStart(2, '0')).join(':'); };

function runNode(nodeArgs, label, details = () => '') {
    return new Promise(resolve => {
        const startedAt = Date.now();
        const child = spawn(process.execPath, nodeArgs, { stdio: 'inherit', shell: false });
        info(`  ${mark.step} ${label}; pid=${child.pid || '—'}`);
        const timer = setInterval(() => info(`  ${mark.wait} ${label}: ${dur(Date.now() - startedAt)}${details() ? ` | ${details()}` : ''}`), HEARTBEAT * 1000);
        child.once('error', e => { clearInterval(timer); console.error(`  ${mark.fail} ${label}: ${e.message}`); resolve(1); });
        child.once('exit', code => { clearInterval(timer); resolve(code ?? 1); });
    });
}

async function importBatch(file, label) {
    const a = ['scripts/import/import-cars.js', file, '--allow-no-volume',
        '--progress-every', '25', '--batch-size', String(BATCH_SIZE), '--batch-interval-ms', String(BATCH_INTERVAL)];
    if (USER_LOGIN) a.push('--user', USER_LOGIN);
    return runNode(a, `БД(+новые) ${label}`);
}

async function applyBatch(file, label) {
    const a = ['scripts/import/apply-liquimoly.js', '--cars', file];
    if (USER_LOGIN) a.push('--user', USER_LOGIN);
    return runNode(a, `БД(пополнение) ${label}`);
}

info(color.stage('════ ПОЛНЫЙ СБОР LIQUI MOLY (по одной марке) ════'));
let manufacturers;
try { manufacturers = await fetchManufacturers(); }
catch (e) { console.error(`${mark.fail} не удалось получить список марок: ${e.message}`); process.exit(1); }

let brands = manufacturers || [];
if (ONLY.length) brands = brands.filter(b => ONLY.some(w => cleanBrand(b.name).includes(w) || w.includes(cleanBrand(b.name))));
brands = brands.slice(0, LIMIT_BRANDS);
info(`марок к обходу: ${color.brand(String(brands.length))}${ONLY.length ? ` (фильтр: ${ONLY.join(', ')})` : ''}`);
if (!brands.length) { console.error('нет марок к обходу'); process.exit(2); }

let scrapeFailures = 0, importFailures = 0, discovered = 0;
for (let i = 0; i < brands.length; i++) {
    const brand = brands[i];
    const before = readJson(OUT_FILE, []) || [];
    const beforeKeys = new Set(before.map(c => c._type_key).filter(Boolean));
    const startedAt = Date.now();
    stage(`[${i + 1}/${brands.length}] ${brand.name.toUpperCase()}`);

    const scrapeCode = await runNode(
        ['scripts/import/scrape-liquimoly.js', '--brands', brand.name],
        `сбор ${brand.name}`,
        () => `локально=${carCount()} (+${Math.max(0, carCount() - before.length)})`,
    );
    if (scrapeCode !== 0) scrapeFailures++;

    const after = readJson(OUT_FILE, []) || [];
    const newCars = after.filter(c => c._type_key && !beforeKeys.has(c._type_key));
    discovered += newCars.length;

    let importCode = 0, applyCode = 0;
    if (IMPORT_NEW) {
        const safe = brand.name.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || `brand-${i + 1}`;
        const batchFile = path.join(BATCH_DIR, `lm-${String(i + 1).padStart(3, '0')}-${safe}.json`);
        // 1) пополняем существующие в БД — всей маркой (не только новыми);
        writeJson(batchFile, after.filter(c => c.brand && cleanBrand(c.brand) === cleanBrand(brand.name)));
        applyCode = await applyBatch(batchFile, brand.name);
        // 2) добавляем новые машины кадэнсом 25/30с;
        if (newCars.length) {
            writeJson(batchFile, newCars);
            importCode = await importBatch(batchFile, brand.name);
        }
        if (applyCode === 0 && importCode === 0) fs.rmSync(batchFile, { force: true });
        else importFailures++;
    }

    info(`${color.dim(`└─ ${brand.name}: новых=${newCars.length}, scrape=${scrapeCode}, add=${importCode}, fill=${applyCode}, ${dur(Date.now() - startedAt)}`)}`);
}

stage('ИТОГ LIQUI MOLY');
info(`  марок обработано: ${brands.length}`);
info(`  новых локальных машин: ${color.ok(String(discovered))}`);
info(`  всего в ${path.relative(ROOT, OUT_FILE)}: ${carCount()}`);
info(`  ошибок сбора: ${scrapeFailures}; ошибок БД: ${importFailures}`);
process.exit(scrapeFailures || importFailures ? 2 : 0);
