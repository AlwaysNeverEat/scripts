#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// LYNX (lynxauto.info) — ещё один fallback по фильтрам. Обрабатывает только те
// машины, которые MANN и BIG FILTER не заполнили полностью.
//
// Каталог LYNX — OpenCart с каскадом подбора по авто (AJAX/JSON):
//   module/mainmenucategory/car          &vendor=<slug>            → список моделей
//   module/mainmenucategory/modifications&vendor&car               → модификации
//     (car_model содержит код двигателя в скобках, power_engine="кВт (лс)",
//      car_year="ММ/ГГ-ММ/ГГ")
//   product/category/podbor &vendor&car&year&modification&power_engine&path=11
//                                                                   → HTML с артикулами
//
// Классификация по префиксу артикула LYNX:
//   LF-… → масляный (mf), LA-… → воздушный (vf), LC-… → салонный (sf),
//   LT-… → топливный (пропускаем).
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { politeFetch, readJson, writeJson } from './http.js';
import { matchEngineCodes } from './db.js';
import { expandQuery } from '../../../shared/translit.js';
import { color, mark } from './log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback; };
const IN_FILE = path.resolve(ROOT, arg('--in', 'data/import/cars-workset.json'));
const OUT_FILE = path.resolve(ROOT, arg('--out', 'data/import/filters.json'));
const CACHE_DIR = path.resolve(ROOT, 'data/import/cache/lynx');
const LIMIT = parseInt(arg('--limit', '0')) || Infinity;
const BRANDS = arg('--brands', '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const FORCE = args.includes('--force');
const RETRY_DAYS = Math.max(0, Number(arg('--retry-days', process.env.LYNX_RETRY_DAYS || '14')) || 14);
// Основной каталог с RU-данными — lynxauto.info. С российского адреса он
// отвечает напрямую (там артикулы LF/LA/LC в HTML). Некоторые нероссийские
// адреса он гео-редиректит на глобальный ecatalogue.lynxauto.jp, где RU-покрытие
// меньше; LYNX_BASE позволяет переопределить хост при необходимости.
const BASE = (process.env.LYNX_BASE || 'https://lynxauto.info').replace(/\/+$/, '');
const MMC = `${BASE}/index.php?route=module/mainmenucategory`;
const PLACEHOLDER = /^(модель|модификация|model range|modification|select)$/i;
fs.mkdirSync(CACHE_DIR, { recursive: true });

const norm = v => String(v || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').replace(/\s+/g, ' ').trim();
const tokens = v => norm(v).split(' ').filter(x => x.length > 1 || /^\d+$/.test(x));

async function cachedJson(key, url, body) {
    const file = path.join(CACHE_DIR, `${key}-${crypto.createHash('sha1').update(url + (body || '')).digest('hex').slice(0, 12)}.json`);
    if (!FORCE && fs.existsSync(file)) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* перезапросим */ } }
    const res = await politeFetch(url, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', Referer: `${BASE}/index.php?route=product/category/podbor` },
    });
    if (res.status !== 200) throw new Error(`LYNX HTTP ${res.status}`);
    const data = await res.json();
    fs.writeFileSync(file, JSON.stringify(data));
    return data;
}

// GET с ручным следованием редиректам (politeFetch отдаёт 301/302 как есть).
async function getFollow(url, redirects = 4) {
    let current = url;
    for (let i = 0; i < redirects; i++) {
        const res = await politeFetch(current, { headers: { Referer: `${BASE}/index.php?route=product/category/podbor` } });
        if ([301, 302, 303, 307, 308].includes(res.status)) {
            const loc = res.headers.get('location');
            if (!loc) return res;
            current = new URL(loc, current).href;
            continue;
        }
        return res;
    }
    throw new Error('LYNX: слишком много редиректов');
}

async function cachedHtml(key, url) {
    const file = path.join(CACHE_DIR, `${key}-${crypto.createHash('sha1').update(url).digest('hex').slice(0, 12)}.html`);
    if (!FORCE && fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
    const res = await getFollow(url);
    if (res.status !== 200) throw new Error(`LYNX HTTP ${res.status}`);
    const text = await res.text();
    fs.writeFileSync(file, text);
    return text;
}

// Список vendor-слагов (audi, bmw, …) со страницы подбора.
let VENDORS = null;
async function loadVendors() {
    if (VENDORS) return VENDORS;
    try {
        const html = await cachedHtml('podbor-page', `${BASE}/index.php?route=product/category/podbor`);
        const set = new Set();
        for (const m of html.matchAll(/data-image="([a-z0-9_-]+)"/gi)) if (m[1] !== '_') set.add(m[1].toLowerCase());
        VENDORS = [...set];
    } catch { VENDORS = []; }
    return VENDORS;
}

// Упорядоченный список кандидатов vendor-слага (ТОЛЬКО латиница — у LYNX слаги
// латинские). Сначала — совпавшие со списком слагов сайта, затем прочие.
function vendorCandidates(brand, vendors) {
    const latin = s => /^[a-z0-9-]+$/.test(s);
    const raw = new Set();
    for (const v of expandQuery(brand)) { raw.add(norm(v).replace(/\s+/g, '-')); raw.add(norm(v).replace(/\s+/g, '')); }
    raw.add(norm(brand).replace(/\s+/g, '-'));
    raw.add(norm(brand).replace(/\s+/g, ''));
    const cands = [...raw].filter(c => c && latin(c));
    // те, что реально есть в списке слагов сайта — вперёд
    const inList = cands.filter(c => vendors.includes(c));
    const partial = vendors.filter(v => cands.some(c => c === v || c.startsWith(v) || v.startsWith(c)));
    return [...new Set([...inList, ...partial, ...cands])];
}

// «85 (115)» → {kw:85, bhp:115};  «09/91-07/94» → {year_from:1991, year_to:1994}.
function parsePower(s) { const m = String(s).match(/(\d{1,4})\s*\(\s*(\d{1,4})\s*\)/); return m ? { kw: +m[1], bhp: +m[2] } : {}; }
function parseYears(s) {
    const m = String(s).match(/(\d{2})\/(\d{2})\s*-\s*(?:(\d{2})\/(\d{2}))?/);
    if (!m) return {};
    const yr = y => (+y <= 40 ? 2000 + +y : 1900 + +y);
    return { year_from: yr(m[2]), year_to: m[4] ? yr(m[4]) : null };
}
// Коды двигателя из «2.0 E  (AAD, ABK)» → "AAD, ABK"; объём → 2.0.
function parseModel(carModel) {
    const codes = (carModel.match(/\(([^)]+)\)/) || [])[1] || '';
    const vol = (carModel.match(/(\d\.\d)/) || [])[1];
    return { codes, volume: vol ? +vol : null };
}

function scoreCar(car, title) {
    let best = 0;
    for (const a of expandQuery(`${car.model || ''} ${car.generation || ''}`)) {
        const ours = new Set(tokens(a));
        let s = 0;
        for (const t of tokens(title)) if (ours.has(t)) s += /\d/.test(t) ? 3 : 2;
        best = Math.max(best, s);
    }
    return best;
}

function matchModification(car, mods) {
    const scored = [];
    for (const mod of mods) {
        if (!mod.car_model) continue;
        const info = parseModel(mod.car_model);
        const pw = parsePower(mod.power_engine);
        const yrs = parseYears(mod.car_year);
        let score = 0;
        const codeOk = matchEngineCodes(car.engine_code, info.codes);
        if (car.engine_code && info.codes && codeOk) score += 8;
        else if (car.engine_code && info.codes && !codeOk) continue;
        const volOk = car.engine_volume && info.volume && Math.abs(car.engine_volume - info.volume) <= 0.12;
        if (volOk) score += 3;
        const kwOk = car.kw && pw.kw && Math.abs(car.kw - pw.kw) <= 4;
        if (kwOk) score += 3;
        if (!codeOk && !volOk && !kwOk) continue;
        if (car.year_from && yrs.year_from && car.year_from >= yrs.year_from - 1 && (!yrs.year_to || car.year_from <= yrs.year_to + 1)) score += 1;
        scored.push({ mod, info, pw, score });
    }
    scored.sort((a, b) => b.score - a.score);
    if (!scored.length || scored[0].score < 5) return null;
    return scored[0];
}

// Тип фильтра по слову-подписи строки (list_showtable-name2): «Фильтр
// воздушный/салонный/масляный/топливный/АКПП…». Классифицируем СТРОГО по слову —
// префиксы артикулов у LYNX плавают. Топливные и АКПП пропускаем.
function classifyByWord(name) {
    const n = String(name || '').toLowerCase();
    if (/воздуш/.test(n)) return 'vf';
    if (/салон/.test(n)) return 'sf';   // в т.ч. «салонный угольный»
    if (/масл/.test(n)) return 'mf';
    return null;                        // топливный, АКПП, ГУР и т.п. — не наши слоты
}

// Запасная классификация по префиксу, если слова-подписи нет:
// LA→воздушный, LAC→салонный, LC/LO→масляный. LF (топливный) и LT (АКПП) — мимо.
function classifyByCode(code) {
    const c = String(code || '').toUpperCase();
    if (/^LAC/.test(c)) return 'sf';
    if (/^LA/.test(c)) return 'vf';
    if (/^L[CO]/.test(c)) return 'mf';
    return null;
}

// Артикулы фильтров: пара «код (list_showtable-code) ↔ слово-тип
// (list_showtable-name2)» в одной строке. Салонный без «угольный» приоритетнее.
function parseArticles(html) {
    const $ = cheerio.load(html);
    const out = { vf: null, mf: null, sf: null };
    const sfPlain = { sf: false };  // уже ли занят простым (не угольным) салонным
    $('.list_showtable-code').each((_, el) => {
        const code = $(el).text().replace(/\s+/g, ' ').trim();
        if (!/[A-Za-z].*\d/.test(code)) return;
        let name = '';
        let node = $(el);
        for (let i = 0; i < 5 && !name; i++) {
            node = node.parent();
            name = node.find('.list_showtable-name2').first().text().replace(/\s+/g, ' ').trim();
        }
        const slot = classifyByWord(name) || classifyByCode(code);
        if (!slot) return;
        if (slot === 'sf') {
            const isCarbon = /уголь/i.test(name);
            if (!out.sf || (sfPlain.sf === false && !isCarbon)) { out.sf = code; sfPlain.sf = !isCarbon; }
        } else if (!out[slot]) {
            out[slot] = code;
        }
    });
    // Запасной путь: код без строковой вёрстки — классифицируем по префиксу.
    if (!out.vf && !out.mf && !out.sf) {
        for (const m of html.matchAll(/\bL[A-Z]{1,2}-?\d{3,5}[A-Z]?\b/gi)) {
            const code = m[0].toUpperCase().replace(/^L([A-Z]{1,2})/, 'L$1');
            const slot = classifyByCode(code);
            if (slot && !out[slot]) out[slot] = code;
        }
    }
    return out;
}

function incomplete(entry) {
    if (!entry || entry.source === 'none') return true;
    if (entry.vf && entry.mf && entry.sf) return false;
    if (FORCE || !entry.lynx_checked_at || RETRY_DAYS === 0) return true;
    return Date.now() - (Date.parse(entry.lynx_checked_at) || 0) >= RETRY_DAYS * 86400000;
}

const cars = readJson(IN_FILE, null);
const filters = readJson(OUT_FILE, {});
if (!Array.isArray(cars)) { console.error(`Не читается ${IN_FILE}`); process.exit(1); }
const targets = cars.filter(c => c._type_key && incomplete(filters[c._type_key]) && (!BRANDS.length || BRANDS.some(b => c.brand.toLowerCase().includes(b))));
const byBrand = new Map();
for (const car of targets) { if (!byBrand.has(car.brand)) byBrand.set(car.brand, []); byBrand.get(car.brand).push(car); }

const vendors = await loadVendors();
console.log(`${color.stage('LYNX')}: ${targets.length} машин, ${byBrand.size} марок; повтор промахов ${RETRY_DAYS} дн.; vendor-слагов ${vendors.length}`);

let processed = 0, found = 0, missed = 0, errors = 0;
for (const [brand, brandCars] of byBrand) {
    if (processed >= LIMIT) break;
    // Перебираем кандидаты-слаги, берём первый, вернувший реальные модели.
    let vendor = null, carList = [];
    for (const cand of vendorCandidates(brand, vendors)) {
        try {
            const list = (await cachedJson(`car-${cand}`, `${MMC}/car`, `&vendor=${encodeURIComponent(cand)}`)).list || [];
            const real = list.filter(c => c.value && !PLACEHOLDER.test(c.value.trim()));
            if (real.length) { vendor = cand; carList = real; break; }
        } catch { /* пробуем следующий кандидат-слаг */ }
    }
    if (!vendor) { console.log(`  ${mark.fail} ${color.brand(brand)}: vendor не найден в LYNX`); continue; }

    for (const car of brandCars) {
        if (processed++ >= LIMIT) break;
        const current = filters[car._type_key] || {};
        // 1) подбираем модель LYNX по названию
        const carHit = carList.map(c => ({ c, s: scoreCar(car, c.title || c.value) })).filter(x => x.s >= 2).sort((a, b) => b.s - a.s)[0];
        if (!carHit) { filters[car._type_key] = { ...current, lynx_checked_at: new Date().toISOString(), why_lynx: 'модель LYNX не найдена' }; missed++; continue; }
        let mods;
        try {
            mods = (await cachedJson(`mod-${vendor}-${norm(carHit.c.value)}`, `${MMC}/modifications`, `&vendor=${encodeURIComponent(vendor)}&car=${encodeURIComponent(carHit.c.value)}`)).list || [];
        } catch (e) { errors++; console.warn(`  ${mark.warn} ${brand} ${car.model}: ${e.message}`); continue; }
        const modHit = matchModification(car, mods);
        if (!modHit) { filters[car._type_key] = { ...current, lynx_checked_at: new Date().toISOString(), why_lynx: 'модификация не сматчилась' }; missed++; continue; }

        // 2) страница подбора с артикулами (path=11 = Фильтры)
        const url = `${BASE}/index.php?route=product/category/podbor`
            + `&vendor=${encodeURIComponent(vendor)}&car=${encodeURIComponent(carHit.c.value)}`
            + `&year=${encodeURIComponent(modHit.mod.car_year)}&modification=${encodeURIComponent(modHit.mod.car_model)}`
            + `&power_engine=${encodeURIComponent(modHit.mod.power_engine)}&path=11`;
        let articles;
        try { articles = parseArticles(await cachedHtml(`prod-${vendor}-${crypto.createHash('sha1').update(url).digest('hex').slice(0, 8)}`, url)); }
        catch (e) { errors++; console.warn(`  ${mark.warn} ${brand} ${car.model}: ${e.message}`); continue; }

        if (!articles.vf && !articles.mf && !articles.sf) {
            filters[car._type_key] = { ...current, lynx_checked_at: new Date().toISOString(), why_lynx: 'артикулы не найдены' };
            missed++; continue;
        }
        const merged = { ...current };
        for (const k of ['vf', 'mf', 'sf']) if (!merged[k] && articles[k]) merged[k] = articles[k];
        const sources = new Set(Array.isArray(merged.sources) ? merged.sources : String(merged.source || '').split('+').filter(x => x && x !== 'none'));
        sources.add('lynx');
        merged.sources = [...sources];
        merged.source = merged.sources.join('+');
        merged.lynx_link = url;
        merged.lynx_checked_at = new Date().toISOString();
        merged.matched_lynx = `${carHit.c.value} ${modHit.mod.car_model}`.replace(/\s+/g, ' ').trim();
        filters[car._type_key] = merged;
        found++;
        console.log(`  ${mark.ok} ${color.brand(car.brand)} ${color.model(car.model)} ${color.engine(car.engine_code || '')}: ${color.filters(`vf=${merged.vf || '—'} mf=${merged.mf || '—'} sf=${merged.sf || '—'}`)}`);
        writeJson(OUT_FILE, filters);
    }
}
writeJson(OUT_FILE, filters);
console.log(`LYNX: найдено ${color.ok(String(found))}, промахов ${missed}, ошибок ${errors}`);
process.exit(errors ? 2 : 0);
