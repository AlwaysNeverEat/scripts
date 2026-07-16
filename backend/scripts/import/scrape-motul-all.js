#!/usr/bin/env node
// Полный первичный сбор Motul. Сначала доливает в БД уже имеющийся локальный
// чекпоинт, затем проходит все легковые марки. После КАЖДОЙ марки новые записи
// сразу отправляются в БД, поэтому рост базы виден до завершения всего каталога.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { CookieJar, politeFetch, readJson, writeJson } from './http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const BASE = 'https://motul.lubricantadvisor.com';
const PAGE = `${BASE}/default.aspx?data=1&lang=rus`;
const args = process.argv.slice(2);

function argValue(name, fallback) {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] != null ? args[index + 1] : fallback;
}

const IMPORT_NEW = args.includes('--import-new');
const USER_LOGIN = argValue('--user', null);
const OUT_FILE = path.resolve(ROOT, argValue('--out', 'data/import/motul-cars.json'));
const BATCH_DIR = path.resolve(ROOT, argValue('--batch-dir', 'data/import/batches'));
const LIMIT_BRANDS = parseInt(argValue('--limit-brands', '0')) || Infinity;
const HEARTBEAT_SECONDS = Math.max(5, Number(argValue('--heartbeat-seconds', process.env.IMPORT_HEARTBEAT_SECONDS || '20')) || 20);
const ONLY_BRANDS = argValue('--brands', '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);

const internalWithValue = new Set(['--user', '--batch-dir', '--limit-brands', '--heartbeat-seconds']);
const internalBoolean = new Set(['--import-new']);
const forwarded = [];
for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (internalBoolean.has(value)) continue;
    if (internalWithValue.has(value)) { index++; continue; }
    if (value === '--brands') { index++; continue; }
    forwarded.push(value);
}

fs.mkdirSync(BATCH_DIR, { recursive: true });
const jar = new CookieJar();
const formatDuration = ms => {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    return [hours, minutes, rest].map(value => String(value).padStart(2, '0')).join(':');
};
const carCount = () => readJson(OUT_FILE, []).length;

function formFields(html) {
    const $ = cheerio.load(html);
    const out = {};
    for (const name of ['__EVENTTARGET', '__EVENTARGUMENT', '__LASTFOCUS', '__VIEWSTATE', '__VIEWSTATEGENERATOR', '__EVENTVALIDATION']) {
        const value = $(`input[name="${name}"]`).attr('value');
        if (value != null) out[name] = value;
    }
    return out;
}

async function runNode(nodeArgs, label, heartbeatDetails = () => '') {
    return new Promise(resolve => {
        const startedAt = Date.now();
        const child = spawn(process.execPath, nodeArgs, { stdio: 'inherit', shell: false });
        console.log(`  → ${label}; pid=${child.pid || '—'}`);
        const timer = setInterval(() => {
            const details = heartbeatDetails();
            console.log(`  … ${label}: работает ${formatDuration(Date.now() - startedAt)}${details ? ` | ${details}` : ''}`);
        }, HEARTBEAT_SECONDS * 1000);
        const finish = code => { clearInterval(timer); resolve(code ?? 1); };
        child.once('error', error => { console.error(`  ${label}: ${error.message}`); finish(1); });
        child.once('exit', finish);
    });
}

async function importFile(file, label) {
    if (!IMPORT_NEW) return 0;
    const importArgs = ['scripts/import/import-cars.js', file, '--progress-every', '25'];
    if (USER_LOGIN) importArgs.push('--user', USER_LOGIN);
    return runNode(importArgs, label, () => `источник=${path.basename(file)}`);
}

// Сначала база получает всё, что уже лежит на диске. Поэтому даже если Motul
// сейчас недоступен, локально собранные машины не ждут сеть.
const existing = readJson(OUT_FILE, []);
console.log('════════════ ФАЗА 1: НАПОЛНЕНИЕ БАЗЫ ИЗ MOTUL ════════════');
console.log(`Локальный чекпоинт: ${existing.length} машин (${path.relative(ROOT, OUT_FILE)})`);
if (IMPORT_NEW && existing.length) {
    const code = await importFile(OUT_FILE, 'доливка всего локального чекпоинта в БД');
    if (code !== 0) {
        console.error('База недоступна или доливка завершилась ошибкой. Motul пока не запускаю, чтобы не копить невидимый хвост.');
        process.exit(code);
    }
}

console.log(`[Motul] Получаю список легковых марок: ${PAGE}`);
const catalogStartedAt = Date.now();
const catalogTimer = setInterval(() => {
    console.log(`  … ожидание каталога Motul: ${formatDuration(Date.now() - catalogStartedAt)} (HTTP тайм-аут и ретраи включены)`);
}, HEARTBEAT_SECONDS * 1000);

let makes;
try {
    const start = await politeFetch(PAGE, { timeoutMs: 45000 });
    if (start.status !== 200) throw new Error(`стартовая страница HTTP ${start.status}`);
    jar.absorb(start);
    const startHtml = await start.text();
    const body = new URLSearchParams({
        ...formFields(startHtml), search: '', hidItemId: '', hidIsModel: '',
        'ctl00$ContentPlaceHolder1$rptCategoryBtn$ctl01$btnImage.x': '10',
        'ctl00$ContentPlaceHolder1$rptCategoryBtn$ctl01$btnImage.y': '10',
    }).toString();
    const response = await politeFetch(PAGE, {
        method: 'POST',
        timeoutMs: 45000,
        headers: { Cookie: jar.header(), Referer: PAGE, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    if (response.status !== 200) throw new Error(`категория легковых HTTP ${response.status}`);
    const $ = cheerio.load(await response.text());
    makes = $('select[name="ctl00$ContentPlaceHolder1$lstMake"] option').map((_, element) => ({
        id: $(element).attr('value'),
        label: $(element).text().trim(),
    })).get().filter(make => make.id && make.label)
        .filter(make => !/\((USA|CAN|TUR)\)|IRAN KHODRO/i.test(make.label));
} finally {
    clearInterval(catalogTimer);
}

if (ONLY_BRANDS.length) makes = makes.filter(make => ONLY_BRANDS.some(brand => make.label.toLowerCase().includes(brand)));
makes = makes.slice(0, LIMIT_BRANDS);
console.log(`[Motul] Найдено марок к обходу: ${makes.length}`);
if (!makes.length) {
    console.error('Motul не вернул ни одной подходящей марки. Проверь сеть или HTML каталога.');
    process.exit(2);
}

let scrapeFailures = 0;
let importFailures = 0;
let discoveredTotal = 0;
for (let index = 0; index < makes.length; index++) {
    const make = makes[index];
    const beforeCars = readJson(OUT_FILE, []);
    const beforeKeys = new Set(beforeCars.map(car => car._type_key).filter(Boolean));
    const startedAt = Date.now();
    console.log(`\n┌─ [${index + 1}/${makes.length}] ${make.label}`);
    console.log(`│  До марки: локально ${beforeCars.length} машин`);

    const scrapeCode = await runNode(
        ['scripts/import/scrape-motul.js', '--brands', make.label.toLowerCase(), ...forwarded],
        `Motul ${make.label}`,
        () => `локально=${carCount()}, за марку=+${Math.max(0, carCount() - beforeCars.length)}`,
    );

    const afterCars = readJson(OUT_FILE, []);
    const newCars = afterCars.filter(car => car._type_key && !beforeKeys.has(car._type_key));
    discoveredTotal += newCars.length;
    if (scrapeCode !== 0) scrapeFailures++;

    let importCode = 0;
    if (IMPORT_NEW && newCars.length) {
        const safeName = make.label.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || `brand-${index + 1}`;
        const batchFile = path.join(BATCH_DIR, `${String(index + 1).padStart(3, '0')}-${safeName}.json`);
        writeJson(batchFile, newCars);
        console.log(`│  Новых записей Motul: ${newCars.length}. Сразу отправляю их в БД.`);
        importCode = await importFile(batchFile, `БД ${make.label}`);
        if (importCode === 0) fs.rmSync(batchFile, { force: true });
        else importFailures++;
    } else if (!newCars.length) {
        console.log('│  Новых модификаций нет: всё уже было в чекпоинте.');
    }

    console.log(`└─ Итог ${make.label}: найдено новых=${newCars.length}, scrape=${scrapeCode}, db=${importCode}, время=${formatDuration(Date.now() - startedAt)}`);
}

console.log('\n════════════ ИТОГ ПЕРВИЧНОГО СБОРА MOTUL ════════════');
console.log(`Марок обработано: ${makes.length}`);
console.log(`Новых локальных машин: ${discoveredTotal}`);
console.log(`Всего в локальном Motul JSON: ${carCount()}`);
console.log(`Ошибок марок: ${scrapeFailures}; ошибок заливки в БД: ${importFailures}`);
console.log('Следующая фаза (ROLF и фильтры) запускается только после нулевого количества ошибок.');
process.exit(scrapeFailures || importFailures ? 2 : 0);
