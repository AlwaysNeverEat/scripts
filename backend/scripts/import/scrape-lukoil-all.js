#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Полный сбор ЛУКОЙЛ по всем легковым маркам. По образцу scrape-motul-all.js:
// цепляемся за марку, собираем её целиком в data/import/lukoil-cars.json, затем
// СРАЗУ отправляем новые записи в БД частями (темп «25 машин раз в 30 секунд»),
// и — опционально — тут же ищем фильтры по этой марке (MANN → BIG → запись в БД).
//
// Запуск:  node scripts/import/scrape-lukoil-all.js --import-new --user <login>
//              [--with-filters] [--no-overwrite] [--brands "kia,skoda"]
//              [--limit-brands N] [--limit-models N]
//              [--pace-size 25] [--pace-pause-ms 30000] [--debug]
//
// Перезапись включена по умолчанию (пользователь выбрал «перезаписывать всё»):
// oil/тех-данные Лукойла перетирают существующие строки, но допуски, фильтры и
// авторство сохраняются (см. import-cars.js --overwrite).
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, setScrapeInterval } from './http.js';
import { createLukoilClient } from './lukoil-api.js';
import log from './log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback;
};

const IMPORT_NEW = args.includes('--import-new');
const WITH_FILTERS = args.includes('--with-filters');
const OVERWRITE = !args.includes('--no-overwrite'); // перезапись по умолчанию
const USER_LOGIN = argValue('--user', null);
const OUT_FILE = path.resolve(ROOT, argValue('--out', 'data/import/lukoil-cars.json'));
const BATCH_DIR = path.resolve(ROOT, argValue('--batch-dir', 'data/import/batches-lukoil'));
const WORKSET = path.resolve(ROOT, 'data/import/lukoil-workset.json');
const FILTERS = path.resolve(ROOT, 'data/import/lukoil-filters.json');
const LIMIT_BRANDS = parseInt(argValue('--limit-brands', '0')) || Infinity;
const PACE_SIZE = argValue('--pace-size', '25');
const PACE_PAUSE_MS = argValue('--pace-pause-ms', '30000');
const HEARTBEAT_SECONDS = Math.max(5, Number(argValue('--heartbeat-seconds', process.env.IMPORT_HEARTBEAT_SECONDS || '20')) || 20);
const ONLY_BRANDS = argValue('--brands', '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
if (args.includes('--debug')) log.setDebug(true);

// Аргументы, пробрасываемые дочернему scrape-lukoil.js (--limit-models, --cache…).
const internalWithValue = new Set(['--user', '--out', '--batch-dir', '--limit-brands',
    '--heartbeat-seconds', '--pace-size', '--pace-pause-ms', '--brands']);
const internalBoolean = new Set(['--import-new', '--with-filters', '--no-overwrite']);
const forwarded = [];
for (let i = 0; i < args.length; i++) {
    if (internalBoolean.has(args[i])) continue;
    if (internalWithValue.has(args[i])) { i++; continue; }
    forwarded.push(args[i]);
}

fs.mkdirSync(BATCH_DIR, { recursive: true });
setScrapeInterval(1500, 250);

const formatDuration = ms => {
    const s = Math.floor(ms / 1000);
    return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
        .map(v => String(v).padStart(2, '0')).join(':');
};
const carCount = () => readJson(OUT_FILE, []).length;

function runNode(nodeArgs, label, heartbeatDetails = () => '') {
    return new Promise(resolve => {
        const startedAt = Date.now();
        const child = spawn(process.execPath, nodeArgs, { stdio: 'inherit', shell: false });
        log.step(`${label}; pid=${child.pid || '—'}`);
        const timer = setInterval(() => {
            log.info(`… ${label}: работает ${formatDuration(Date.now() - startedAt)}${heartbeatDetails() ? ' | ' + heartbeatDetails() : ''}`);
        }, HEARTBEAT_SECONDS * 1000);
        const finish = code => { clearInterval(timer); resolve(code ?? 1); };
        child.once('error', e => { log.error(`${label}: ${e.message}`); finish(1); });
        child.once('exit', finish);
    });
}

function importArgsFor(file, label) {
    const a = ['scripts/import/import-cars.js', file, '--source', 'lukoil', '--allow-no-volume',
        '--progress-every', '25', '--pace-size', String(PACE_SIZE), '--pace-pause-ms', String(PACE_PAUSE_MS)];
    if (OVERWRITE) a.push('--overwrite');
    if (USER_LOGIN) a.push('--user', USER_LOGIN);
    return a;
}

// Фильтры по одной марке: workset из батча → MANN → BIG → запись в БД.
// Best-effort: сбой фильтров не должен ронять сбор машин.
async function enrichFiltersForBrand(batchFile, brandLabel) {
    if (!WITH_FILTERS || !IMPORT_NEW) return;
    const brandArg = brandLabel.toLowerCase();
    await runNode(['scripts/import/build-enrichment-workset.js', '--in', batchFile, '--out', WORKSET],
        `рабочий набор фильтров ${brandLabel}`);
    await runNode(['scripts/import/prepare-filter-retry.js', '--cars', WORKSET, '--filters', FILTERS],
        `подготовка повторного MANN ${brandLabel}`);
    await runNode(['scripts/import/scrape-filters.js', '--in', WORKSET, '--out', FILTERS, '--brands', brandArg],
        `MANN-FILTER ${brandLabel}`);
    await runNode(['scripts/import/scrape-big-filter.js', '--in', WORKSET, '--out', FILTERS, '--brands', brandArg],
        `BIG FILTER ${brandLabel}`);
    const applyArgs = ['scripts/import/apply-enrichment.js', '--cars', WORKSET, '--filters', FILTERS];
    if (USER_LOGIN) applyArgs.push('--user', USER_LOGIN);
    await runNode(applyArgs, `запись фильтров в БД ${brandLabel}`);
}

// ── Список марок ─────────────────────────────────────────────────────────────
log.section('ЛУКОЙЛ: полный сбор легковых');
const client = createLukoilClient();
let manufacturers;
try {
    manufacturers = await client.listManufacturers();
} catch (e) {
    log.error(`не удалось получить список марок: ${e.message}`);
    process.exit(2);
}
if (ONLY_BRANDS.length) manufacturers = manufacturers.filter(m => ONLY_BRANDS.some(b => m.name.toLowerCase().includes(b)));
manufacturers = manufacturers.slice(0, LIMIT_BRANDS);
log.info(`марок к обходу: ${manufacturers.length}`);
if (!manufacturers.length) { log.error('нет подходящих марок'); process.exit(2); }

let scrapeFailures = 0, importFailures = 0, discoveredTotal = 0;

for (let index = 0; index < manufacturers.length; index++) {
    const man = manufacturers[index];
    const beforeCars = readJson(OUT_FILE, []);
    const beforeKeys = new Set(beforeCars.map(c => c._type_key).filter(Boolean));
    const startedAt = Date.now();
    log.plain('');
    log.step(`[${index + 1}/${manufacturers.length}] ${log.c.brand(man.name)} — до марки локально ${beforeCars.length}`);

    const scrapeCode = await runNode(
        ['scripts/import/scrape-lukoil.js', '--manufacturer-id', String(man.id), '--out', OUT_FILE, ...forwarded],
        `ЛУКОЙЛ ${man.name}`,
        () => `локально=${carCount()}, за марку=+${Math.max(0, carCount() - beforeCars.length)}`,
    );
    if (scrapeCode !== 0) scrapeFailures++;

    const afterCars = readJson(OUT_FILE, []);
    const newCars = afterCars.filter(c => c._type_key && !beforeKeys.has(c._type_key));
    discoveredTotal += newCars.length;

    let importCode = 0;
    if (IMPORT_NEW && newCars.length) {
        const safe = man.name.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || `brand-${index + 1}`;
        const batchFile = path.join(BATCH_DIR, `${String(index + 1).padStart(3, '0')}-${safe}.json`);
        writeJson(batchFile, newCars);
        log.info(`новых записей: ${newCars.length} — отправляю в БД (темп ${PACE_SIZE}/${Math.round(PACE_PAUSE_MS / 1000)}с)`);
        importCode = await runNode(importArgsFor(batchFile, `БД ${man.name}`), `БД ${man.name}`, () => `источник=${path.basename(batchFile)}`);
        if (importCode !== 0) importFailures++;
        try { await enrichFiltersForBrand(batchFile, man.name); }
        catch (e) { log.warn(`фильтры ${man.name}: ${e.message}`); }
        if (importCode === 0) fs.rmSync(batchFile, { force: true });
    } else if (!newCars.length) {
        log.info('новых модификаций нет: всё уже в чекпоинте');
    }

    log.ok(`итог ${man.name}: новых=${newCars.length}, scrape=${scrapeCode}, db=${importCode}, время=${formatDuration(Date.now() - startedAt)}`);
}

log.section('ИТОГ ПОЛНОГО СБОРА ЛУКОЙЛ');
log.info(`марок обработано: ${manufacturers.length}`);
log.info(`новых локальных машин: ${discoveredTotal}`);
log.info(`всего в lukoil-cars.json: ${carCount()}`);
log.info(`ошибок марок: ${scrapeFailures}; ошибок заливки в БД: ${importFailures}`);
process.exit(scrapeFailures || importFailures ? 2 : 0);
