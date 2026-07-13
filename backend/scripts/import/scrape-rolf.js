#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Обогащение motul-cars.json допусками масла из виджета ROLF/UPEC
// (podbor.upec.pro — тот самый виджет с rolfoil.ru/podbor, который операторы
// парсят юзерскриптом). Для каждой машины ищем модификацию по коду двигателя,
// сверяем код/объём/мощность/годы и берём объединение meets_requirements
// всех предложенных для двигателя масел — ровно то, что собирает
// watchForRolfTags() в userscript/src/oil-calculator/app.js.
//
// Запуск:  node scripts/import/scrape-rolf.js [--in файл] [--force] [--limit N]
//
// Машины без совпадения получают пустые car_approvals и запись в _warnings.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { politeFetch, writeJson, readJson } from './http.js';
import { normApproval } from '../../../shared/calculator.js';
import { matchEngineCodes } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');

const WIDGET_HOST = 'https://podbor.upec.pro';
const PARTNER_PAGE = 'https://rolfoil.ru/podbor/';
// Партнёрский токен ROLF с rolfoil.ru/podbor (актуален на июль 2026;
// при протухании скрипт сам достаёт свежий со страницы партнёра).
const FALLBACK_TOKEN = 'cc5b938dddd7df0a20690023b6e330941aade700d9dcedf95a6fb76686deef8b';

const args = process.argv.slice(2);
function argValue(name, fallback) {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback;
}
const IN_FILE = path.resolve(ROOT, argValue('--in', 'data/import/motul-cars.json'));
// --out: писать обогащённые машины в ОТДЕЛЬНЫЙ файл (не трогая входной).
// Нужно, когда scrape-motul.js ещё дописывает входной файл: два процесса,
// пишущие один JSON, затирали бы правки друг друга. Вход читается снапшотом
// (writeJson атомарен), выход докапливается по _type_key.
const OUT_FILE = path.resolve(ROOT, argValue('--out', path.relative(ROOT, IN_FILE)));
const SEPARATE_OUT = OUT_FILE !== IN_FILE;
const FORCE = args.includes('--force');
const LIMIT = parseInt(argValue('--limit', '0')) || Infinity;
const CACHE_DIR = path.resolve(ROOT, 'data/import/cache/upec');

fs.mkdirSync(CACHE_DIR, { recursive: true });

// ── Токен ────────────────────────────────────────────────────────────────────
async function fetchToken() {
    try {
        const res = await politeFetch(PARTNER_PAGE, { redirect: 'follow' });
        const html = await res.text();
        const m = html.match(/partner\/build\/([0-9a-f]{32,})\//);
        if (m) return m[1];
    } catch (e) {
        console.warn(`⚠ не удалось получить токен с ${PARTNER_PAGE}: ${e.message}`);
    }
    return FALLBACK_TOKEN;
}

const TOKEN = await fetchToken();

async function api(pathname, params) {
    const url = new URL(`${WIDGET_HOST}/api/v1/public/${pathname}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('token', TOKEN);

    const cacheFile = path.join(CACHE_DIR,
        pathname.replace(/\//g, '_') + '-' + crypto.createHash('sha1').update(url.search).digest('hex').slice(0, 16) + '.json');
    if (fs.existsSync(cacheFile)) return readJson(cacheFile, null);

    const res = await politeFetch(url.href, {
        headers: { Referer: `${WIDGET_HOST}/`, Accept: 'application/json', token: TOKEN },
    });
    if (res.status !== 200) return null;
    const data = await res.json();
    fs.writeFileSync(cacheFile, JSON.stringify(data));
    return data;
}

// ── Сопоставление модификаций ────────────────────────────────────────────────

function yearsOverlap(car, gen) {
    const years = (gen.years_array || []).map(Number).filter(Boolean);
    if (!years.length || !car.year_from) return true; // нет данных — не режем
    const from = car.year_from, to = car.year_to || from + 30;
    return years.some(y => y >= from && y <= to);
}

// Кандидаты из /cars/autocomplete → плоский список генераций с брендом/моделью.
function flatten(acResponse) {
    const out = [];
    for (const b of acResponse || []) {
        for (const m of b.models || []) {
            for (const g of m.generations || []) {
                if (g.transport_type && g.transport_type !== 'CAR') continue;
                out.push({ ...g, brand: b.brand, model: m.model });
            }
        }
    }
    return out;
}

function pickModification(car, candidates) {
    const brandNorm = car.brand.toUpperCase();
    const scored = [];
    for (const c of candidates) {
        let score = 0;
        if (c.brand && c.brand.toUpperCase() === brandNorm) score += 2;
        const codeOk = matchEngineCodes(car.engine_code, c.engine_code);
        if (codeOk) score += 4;
        const volOk = car.engine_volume && c.engine_volume
            && Math.abs(parseFloat(c.engine_volume) - car.engine_volume) < 0.05;
        if (volOk) score += 2;
        const powerOk = car.bhp && c.power && Math.abs(c.power - car.bhp) <= 5;
        if (powerOk) score += 2;
        const yearOk = yearsOverlap(car, c);
        if (yearOk) score += 1;

        // Минимальная планка: совпал код двигателя, либо объём+мощность.
        if ((codeOk && yearOk) || (volOk && powerOk && yearOk)) {
            scored.push({ c, score });
        }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.length ? scored[0].c : null;
}

// ── Нормализация тегов допусков (как watchForRolfTags в юзерскрипте) ────────
// «MB 229.3/229.5» → «MB 229.3», «MB 229.5»; «Renault RN0700/0710» →
// «Renault RN0700», «Renault RN0710»; «ACEA A3/B4» остаётся как есть.
function normalizeTag(tag) {
    const t = tag.replace(/\s+/g, ' ').trim();
    const m = t.match(/^(.*?[A-Za-zА-Яа-я])[\s-]*([\d][\w.\-]*(?:\/[\d][\w.\-]*)+)$/);
    if (!m) return [t];

    const prefix = m[1].trim();
    const parts = m[2].split('/').map(v => v.trim());
    // «MB 229.51/52/31»: хвостовые части — продолжения первой («52» → «229.52»).
    const base = parts[0].match(/^(\d+)\.\d+$/);
    const full = parts.map((v, i) =>
        i > 0 && base && /^\d{1,2}$/.test(v) ? `${base[1]}.${v}` : v);
    // «RN0700/0710» → «RN0700», «RN0710» (без пробела, как в исходном теге).
    const sep = t.startsWith(prefix) && /^\d/.test(t.slice(prefix.length)) ? '' : ' ';
    return full.map(v => `${prefix}${sep}${v}`);
}

// Кириллические буквы-двойники в тегах («МВ 229.5», «Porsche А40») → латиница,
// чтобы дедупликация через normApproval склеивала их с латинскими вариантами.
const HOMOGLYPHS = { А: 'A', В: 'B', С: 'C', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', Т: 'T', У: 'Y', Х: 'X' };
function latinize(s) {
    return s.replace(/[АВСЕКМНОРТУХ]/g, ch => HOMOGLYPHS[ch] || ch)
            .replace(/[авсекмнортух]/g, ch => HOMOGLYPHS[ch.toUpperCase()] || ch);
}

// Дедупликация разных написаний одного допуска: «MB229.5» / «MB 229.5» /
// «МВ 229.5» → одна запись. Представитель — самый читаемый вариант
// (чистый ASCII, с пробелом, короче).
function dedupeApprovals(tags) {
    const byKey = new Map();
    for (const tag of tags) {
        const key = normApproval(latinize(tag));
        if (!key || key.length < 3) continue;
        const prev = byKey.get(key);
        if (!prev || better(tag, prev)) byKey.set(key, tag);
    }
    return [...byKey.values()];

    function better(a, b) {
        const asciiA = /^[\x20-\x7E]*$/.test(a), asciiB = /^[\x20-\x7E]*$/.test(b);
        if (asciiA !== asciiB) return asciiA;
        const spaceA = a.includes(' '), spaceB = b.includes(' ');
        if (spaceA !== spaceB) return spaceA;
        return a.length < b.length;
    }
}

function extractApprovals(liquids) {
    const tags = new Set();
    const products = liquids && liquids.products && liquids.products.data || [];
    for (const p of products) {
        const req = p.meets_requirements || '';
        for (const piece of req.split(/[;\n]+/)) {
            const t = piece.replace(/\s+/g, ' ').trim();
            if (!t || t.length < 3 || t.length > 80) continue;
            for (const norm of normalizeTag(t)) tags.add(norm);
        }
    }
    return dedupeApprovals([...tags]);
}

function engineVolumeOf(liquids) {
    const agg = (liquids && liquids.aggregates || []).find(a => /двигатель/i.test(a.name || ''));
    return agg ? agg.filling_volume || null : null;
}

// ── Основной цикл ────────────────────────────────────────────────────────────
const input = readJson(IN_FILE, null);
if (!input) {
    console.error(`Нет файла ${IN_FILE} — сначала запусти scrape-motul.js`);
    process.exit(1);
}

// При раздельном выходе: уже обогащённые машины берём из OUT_FILE,
// из входа обрабатываем только новые (по _type_key).
let cars, outCars;
if (SEPARATE_OUT) {
    outCars = readJson(OUT_FILE, []);
    const done = new Set(outCars.map(c => c._type_key).filter(Boolean));
    cars = input.filter(c => !done.has(c._type_key));
    console.log(`Вход: ${input.length}, уже обогащено: ${outCars.length}, новых: ${cars.length}`);
} else {
    cars = input;
    outCars = null;
}

function checkpoint() {
    writeJson(OUT_FILE, SEPARATE_OUT ? outCars : cars);
}

let enriched = 0, missed = 0, skipped = 0, processed = 0;

for (const car of cars) {
    if (processed >= LIMIT) break;
    if (!FORCE && (car.car_approvals.length || car._rolf !== undefined)) {
        if (SEPARATE_OUT) outCars.push(car);
        skipped++;
        continue;
    }
    processed++;

    const queries = [];
    if (car.engine_code) queries.push(car.engine_code);
    if (car.engine_volume) queries.push(`${car.brand} ${car.model} ${car.engine_volume}`);
    queries.push(`${car.brand} ${car.model}`);

    let match = null;
    for (const q of queries) {
        const ac = await api('cars/autocomplete', { query: q });
        match = pickModification(car, flatten(ac));
        if (match) break;
    }

    const label = `${car.brand} ${car.model} ${car.engine_code || ''} ${car.year_from}`.trim();
    if (!match) {
        missed++;
        car._rolf = null;
        pushWarning(car, 'ROLF: модификация не найдена');
        console.log(`  ✗ ${label}: не найдено`);
        if (SEPARATE_OUT) outCars.push(car);
        checkpoint();
        continue;
    }

    const liquids = await api('find-liquids-by-modification',
        { modification: match.id, source: 'cards', transportType: 'CAR' });
    const approvals = extractApprovals(liquids);

    car.car_approvals = approvals;
    car._rolf = {
        modification_id: match.id,
        matched: `${match.brand} ${match.model} ${match.generation || ''} ${match.modification || ''} ${match.engine_code || ''} (${match.years || ''})`.replace(/\s+/g, ' ').trim(),
        engine_filling_volume: engineVolumeOf(liquids),
    };
    if (!approvals.length) pushWarning(car, 'ROLF: модификация найдена, но допусков нет');

    enriched++;
    console.log(`  ✓ ${label}: ${approvals.length} допусков (${car._rolf.matched})`);
    if (SEPARATE_OUT) outCars.push(car);
    checkpoint();
}

checkpoint();

function pushWarning(car, w) {
    car._warnings = car._warnings || [];
    if (!car._warnings.includes(w)) car._warnings.push(w);
}

console.log(`\nГотово: обогащено ${enriched}, без совпадения ${missed}, пропущено (уже были) ${skipped}.`);
