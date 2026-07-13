#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Подбор артикулов фильтров (vf=масляный, mf=воздушный, sf=салонный) через
// открытый GraphQL-каталог MANN-FILTER. Машины группируются по
// (марка, модель, поколение, код двигателя, объём, кВт) — один лукап на группу.
//
// Запуск:  node scripts/import/scrape-filters.js [--in cars-enriched.json]
//              [--out filters.json] [--limit N групп] [--brands "skoda,kia"]
//
// Выход: data/import/filters.json — map _type_key → {vf, mf, sf, source,
// matched}. Файл машин НЕ трогаем (его пишет конвейер), поэтому гонок нет.
//
// Матчинг (по просьбе пользователя): модель + двигатель главные, год мягкий.
// Цепочка Mann (разведана, Store: pcat_mf_ru_store_ru):
//   brand_id_suggestion(search) → vehicle_brand_id
//   modelCollectionByBrandId(brand_id, model_name) → серии моделей
//   modelTypeCollection(series_id) → модификации (engine_code, ccm, kw, годы)
//   productLinkageCollection(type_id) → фильтры с типами по-русски
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { politeFetch, writeJson, readJson } from './http.js';
import { matchEngineCodes } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');

const GQL_URL = 'https://www.mann-filter.com/api/graphql/catalog-prod';
const STORE = 'pcat_mf_ru_store_ru';

const args = process.argv.slice(2);
function argValue(name, fallback) {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback;
}
const IN_FILE  = path.resolve(ROOT, argValue('--in', 'data/import/cars-enriched.json'));
const OUT_FILE = path.resolve(ROOT, argValue('--out', 'data/import/filters.json'));
const LIMIT = parseInt(argValue('--limit', '0')) || Infinity;
const BRANDS = argValue('--brands', '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const CACHE_DIR = path.resolve(ROOT, 'data/import/cache/mann');

fs.mkdirSync(CACHE_DIR, { recursive: true });

// ── GraphQL с дисковым кэшем ────────────────────────────────────────────────
async function gql(query, cacheKeyPrefix) {
    const cacheFile = path.join(CACHE_DIR,
        cacheKeyPrefix + '-' + crypto.createHash('sha1').update(query).digest('hex').slice(0, 16) + '.json');
    if (fs.existsSync(cacheFile)) return readJson(cacheFile, null);

    const res = await politeFetch(GQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Store: STORE },
        body: JSON.stringify({ query }),
    });
    if (res.status !== 200) throw new Error(`Mann GraphQL HTTP ${res.status}`);
    const data = await res.json();
    if (data.errors) throw new Error(`Mann GraphQL: ${JSON.stringify(data.errors).slice(0, 200)}`);
    fs.writeFileSync(cacheFile, JSON.stringify(data));
    return data;
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, ' ').trim();

// ── Шаги цепочки Mann ────────────────────────────────────────────────────────
// Кандидаты брендов: у Mann один наш бренд может быть несколькими каталогами
// («CHEVROLET» и «CHEVROLET EUROPE / DAEWOO (GM)») — перебираем все.
async function findBrandCandidates(brand) {
    const variants = [...new Set([brand, brand.split(/[\s/]+/)[0]])].filter(Boolean);
    const out = [];
    const seen = new Set();
    for (const v of variants) {
        const d = await gql(
            `{ brand_id_suggestion(search:"${esc(v)}") { suggestions { vehicle_brand_id vehicle_brand_name } } }`,
            'brand');
        for (const s of d.data.brand_id_suggestion.suggestions || []) {
            if (seen.has(s.vehicle_brand_id)) continue;
            seen.add(s.vehicle_brand_id);
            out.push(s);
        }
    }
    // Точное совпадение имени первым (чтобы «GAZ» не стал «Tagaz»).
    out.sort((a, b) => Number(norm(b.vehicle_brand_name) === norm(brand))
                     - Number(norm(a.vehicle_brand_name) === norm(brand)));
    return out;
}

// Все серии бренда (model_name у Mann — строгий фильтр и часто пустой,
// поэтому грузим полный список и матчим сами).
async function loadAllSeries(brandId) {
    const d = await gql(
        `{ modelCollectionByBrandId(vehicle_brand_id:"${esc(brandId)}", model_name:"", pageSize: 500) {
             models { model_series_id model_series_name model_series_date } } }`,
        'series');
    return d.data.modelCollectionByBrandId.models || [];
}

const tokenize = (s) => norm(s).split(/\s+/).filter(t => t.length >= 2 || /^\d+$/.test(t));

// Токен-матчинг серии: пересечение слов/чисел нашей модели («2170 / Priora»)
// с названием серии Mann («Priora (2170)»). Числовые токены весомее.
function scoreSeries(series, model, generation, yearFrom) {
    const ours = new Set([...tokenize(model), ...tokenize(generation || '')]);
    const theirs = tokenize(series.model_series_name);
    let score = 0;
    for (const t of theirs) {
        if (ours.has(t)) score += /\d/.test(t) ? 3 : 2;
    }
    if (norm(series.model_series_name) === norm(model)) score += 3;
    const ym = (series.model_series_date || '').match(/^(\d{2})-(\d{2})?/);
    if (ym && yearFrom) {
        const from = 1900 + parseInt(ym[1]) + (parseInt(ym[1]) < 50 ? 100 : 0);
        const to = ym[2] ? 1900 + parseInt(ym[2]) + (parseInt(ym[2]) < 50 ? 100 : 0) : 9999;
        if (yearFrom >= from - 1 && yearFrom <= to + 1) score += 1;
        else if (yearFrom < from - 2 || yearFrom > to + 6) score -= 2;
    }
    return score;
}

async function findSeries(brandCandidates, model, generation, yearFrom) {
    const scored = [];
    for (const brand of brandCandidates.slice(0, 4)) {
        const series = await loadAllSeries(brand.vehicle_brand_id);
        for (const s of series) {
            const score = scoreSeries(s, model, generation, yearFrom);
            if (score >= 2) scored.push({ ...s, _score: score });
        }
    }
    scored.sort((a, b) => b._score - a._score);
    return scored;
}

async function findType(seriesList, group) {
    for (const series of seriesList.slice(0, 3)) {
        const d = await gql(
            `{ modelTypeCollection(model_series_id:"${esc(series.model_series_id)}") {
                 allModelTypes { model_type_id vehicle_name engine_code ccm kw
                                 vehicle_manufactured_from vehicle_manufactured_to } } }`,
            'types');
        const types = d.data.modelTypeCollection.allModelTypes || [];
        const scored = [];
        for (const t of types) {
            let score = 0;
            const codeOk = matchEngineCodes(group.engine_code, t.engine_code);
            if (codeOk) score += 6;
            const ccmOk = group.ccm && t.ccm && Math.abs(parseInt(t.ccm) - group.ccm) <= 40;
            if (ccmOk) score += 2;
            const kwOk = group.kw && t.kw && Math.abs(parseInt(t.kw) - group.kw) <= 3;
            if (kwOk) score += 2;
            const yf = parseInt((t.vehicle_manufactured_from || '').slice(0, 4)) || null;
            const yt = parseInt((t.vehicle_manufactured_to || '').slice(0, 4)) || 9999;
            if (group.year_from && yf && group.year_from >= yf - 1 && group.year_from <= yt + 1) score += 1;

            // Планка: код двигателя, либо объём+мощность. Если кода нет с
            // одной из сторон (у Mann они часто пустые, у российских
            // каталогов Motul нет кВт) — достаточно объёма, мощность мягко.
            // Оба кода есть, но не совпали — по объёму НЕ матчим (это разные
            // моторы одной серии).
            const codeMissing = !group.engine_code || !t.engine_code;
            const eligible = codeOk
                || (ccmOk && kwOk)
                || (ccmOk && codeMissing && (!group.kw || !t.kw || kwOk));
            if (eligible) scored.push({ t, series, score });
        }
        scored.sort((a, b) => b.score - a.score);
        if (scored.length) return scored[0];
    }
    return null;
}

// Приоритет салонников как в юзерскрипте «Скопировать 3 артикула»: CU > CUK > FP.
function cabinRank(article) {
    if (/^CU(?!K)/i.test(article)) return 0;
    if (/^CUK/i.test(article)) return 1;
    if (/^FP/i.test(article)) return 2;
    return 3;
}

// SKU 'W712/95_MANN-FILTER' → артикул в фирменной записи Mann:
// 'W 712/95', 'C 22 117' (5+ цифр группируются по 3 справа, 4 и меньше — нет),
// 'HU 6002 Z' (буквенный хвост отделяется пробелом), 'C 27 003/1'.
export function formatMannArticle(sku) {
    const raw = sku.replace(/_MANN-FILTER$/i, '').trim();
    const m = raw.match(/^([A-Z]+)\s*([\d].*)$/i);
    if (!m) return raw;
    const segments = m[2].split('/').map((seg, i) => {
        const sm = seg.match(/^(\d+)\s*([A-Z]*)$/i);
        if (!sm) return seg;
        const digits = sm[1].length > 4
            ? sm[1].replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
            : sm[1];
        return sm[2] ? `${digits} ${sm[2].toUpperCase()}` : digits;
    });
    return `${m[1].toUpperCase()} ${segments.join('/')}`;
}

function extractFilters(items) {
    const out = {};
    const cabins = [];
    for (const it of items) {
        const sku = it.product && it.product.sku;
        if (!sku) continue;
        const article = formatMannArticle(sku);
        const type = it.product_type || '';
        if (type === 'Масляный фильтр') {
            if (!out.vf) out.vf = article;
        } else if (type === 'Воздушный фильтр') {
            if (!out.mf) out.mf = article;
        } else if (type === 'Воздушный фильтр салона') {
            cabins.push(article);
        }
    }
    if (cabins.length) {
        cabins.sort((a, b) => cabinRank(a) - cabinRank(b));
        out.sf = cabins[0];
    }
    return out;
}

// ── Группировка машин и основной цикл ────────────────────────────────────────
const cars = readJson(IN_FILE, null);
if (!cars) {
    console.error(`Не читается ${IN_FILE}`);
    process.exit(1);
}
const filters = readJson(OUT_FILE, {});

const groups = new Map();
for (const car of cars) {
    if (!car._type_key) continue;
    if (BRANDS.length && !BRANDS.some(b => car.brand.toLowerCase().includes(b))) continue;
    if (filters[car._type_key]) continue; // уже подобрано
    const key = [car.brand, car.model, car.generation || '', car.engine_code || '',
                 car.engine_volume || '', car.kw || ''].join('|').toLowerCase();
    if (!groups.has(key)) groups.set(key, { cars: [], sample: car });
    groups.get(key).cars.push(car);
}

console.log(`Групп к подбору: ${groups.size} (машин: ${[...groups.values()].reduce((s, g) => s + g.cars.length, 0)})`);

let found = 0, missed = 0, failedGroups = 0, processed = 0;
const brandIdCache = new Map();

for (const [key, group] of groups) {
    if (processed >= LIMIT) break;
    processed++;
    const c = group.sample;
    const g = {
        engine_code: c.engine_code,
        ccm: c.engine_volume ? Math.round(c.engine_volume * 1000) : null,
        kw: c.kw,
        year_from: c.year_from,
    };
    const label = `${c.brand} ${c.model} ${c.engine_code || c.engine_volume || ''}`.trim();

    try {
        let brandCands = brandIdCache.get(c.brand);
        if (brandCands === undefined) {
            brandCands = await findBrandCandidates(c.brand);
            brandIdCache.set(c.brand, brandCands);
        }
        if (!brandCands.length) { missNote(group, 'бренд не найден на Mann'); continue; }

        const seriesList = await findSeries(brandCands, c.model, c.generation, c.year_from);
        if (!seriesList.length) { missNote(group, 'модель не найдена на Mann'); continue; }

        const hit = await findType(seriesList, g);
        if (!hit) { missNote(group, 'модификация не найдена на Mann'); continue; }

        const d = await gql(
            `{ productLinkageCollection(vehicle_model_type_id:"${esc(hit.t.model_type_id)}", pageSize: 40) {
                 items { product_type product { sku } } } }`,
            'products');
        const parts = extractFilters(d.data.productLinkageCollection.items || []);
        if (!parts.vf && !parts.mf && !parts.sf) { missNote(group, 'у Mann нет фильтров для модификации'); continue; }

        const matched = `${hit.series.model_series_name} ${hit.t.vehicle_name} ${hit.t.engine_code || ''}`.replace(/\s+/g, ' ').trim();
        for (const car of group.cars) {
            filters[car._type_key] = { ...parts, source: 'mann', matched };
        }
        found++;
        console.log(`  ✓ ${label}: vf=${parts.vf || '—'} mf=${parts.mf || '—'} sf=${parts.sf || '—'} (${matched})`);
        writeJson(OUT_FILE, filters);
    } catch (e) {
        failedGroups++;
        console.warn(`  ⚠ ${label}: ${e.message}`);
    }
}

function missNote(group, why) {
    missed++;
    const c = group.sample;
    console.log(`  ✗ ${c.brand} ${c.model} ${c.engine_code || ''}: ${why}`);
    // Помечаем «не нашли», чтобы не перебирать заново; fallback-скрейперы
    // (LYNX/GoodWill/BIG) смотрят именно на записи со source='none'.
    for (const car of group.cars) {
        if (!filters[car._type_key]) filters[car._type_key] = { source: 'none', why };
    }
    writeJson(OUT_FILE, filters);
}

console.log(`\nГотово: найдено групп ${found}, не найдено ${missed}, ошибок ${failedGroups}.`);
console.log(`Файл: ${OUT_FILE} (записей: ${Object.keys(filters).length})`);
