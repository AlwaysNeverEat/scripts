#!/usr/bin/env node
// BIG FILTER fallback: серверный HTML-каталог марки -> модификации -> GB-артикулы.
// Обрабатывает только записи, которые MANN не заполнил полностью.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { politeFetch, readJson, writeJson } from './http.js';
import { matchEngineCodes } from './db.js';
import { expandQuery } from '../../../shared/translit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback; };
const IN_FILE = path.resolve(ROOT, arg('--in', 'data/import/cars-workset.json'));
const OUT_FILE = path.resolve(ROOT, arg('--out', 'data/import/filters.json'));
const CACHE_DIR = path.resolve(ROOT, 'data/import/cache/big-filter');
const LIMIT = parseInt(arg('--limit', '0')) || Infinity;
const BRANDS = arg('--brands', '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const FORCE = args.includes('--force');
const RETRY_DAYS = Math.max(0, Number(arg('--retry-days', process.env.BIG_RETRY_DAYS || '14')) || 14);
const BASE = 'https://bigfilter.com';
fs.mkdirSync(CACHE_DIR, { recursive: true });

const norm = value => String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').replace(/\s+/g, ' ').trim();
const tokens = value => norm(value).split(' ').filter(x => x.length > 1 || /^\d+$/.test(x));
const escRe = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function cachedText(url, key) {
    const file = path.join(CACHE_DIR, `${key}-${crypto.createHash('sha1').update(url).digest('hex').slice(0, 12)}.html`);
    if (!FORCE && fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
    const res = await politeFetch(url);
    if (res.status !== 200) throw new Error(`BIG FILTER HTTP ${res.status}`);
    const text = await res.text();
    if (text.length < 500) throw new Error('BIG FILTER вернул пустую страницу');
    fs.writeFileSync(file, text);
    return text;
}

function brandAliases(brand) {
    const out = new Set([norm(brand)]);
    for (const value of expandQuery(brand)) out.add(norm(value));
    if (/^(lada|ваз|vaz)/.test(norm(brand))) { out.add('lada'); out.add('ваз'); }
    if (/mercedes/.test(norm(brand))) out.add('mercedes benz');
    return [...out].filter(Boolean);
}

function parseBrandIndex(html) {
    const $ = cheerio.load(html);
    const out = [];
    const seen = new Set();
    $('a[href*="/products/cars/"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const m = href.match(/\/products\/cars\/([^/?#]+)/i);
        const name = $(el).text().replace(/\s+/g, ' ').trim();
        if (!m || !name || seen.has(m[1])) return;
        seen.add(m[1]);
        out.push({ name, slug: m[1], url: new URL(`/products/cars/${m[1]}/`, BASE).href });
    });
    return out;
}

function findBrand(index, brand) {
    const aliases = brandAliases(brand);
    const scored = index.map(item => {
        const name = norm(item.name);
        let score = 0;
        for (const alias of aliases) {
            if (name === alias) score = Math.max(score, 100);
            else if (name.includes(alias) || alias.includes(name)) score = Math.max(score, 60);
        }
        return { item, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
    return scored[0]?.item || null;
}

function parseYear(text) {
    const m = text.match(/(\d{2})\/(\d{2})\s*(?:⇒|=>|—|-|→)\s*(?:(\d{2})\/(\d{2}))?/);
    if (!m) return {};
    const year = y => Number(y) <= 40 ? 2000 + Number(y) : 1900 + Number(y);
    return { year_from: year(m[2]), year_to: m[4] ? year(m[4]) : null };
}

function collectTextLines($) {
    const lines = [];
    const root = $('body').get(0) || $.root().get(0);
    function walk(node) {
        if (!node) return;
        if (node.type === 'text') {
            for (const part of String(node.data || '').replace(/\u00a0/g, ' ').split(/[\r\n]+/)) {
                const text = part.replace(/\s+/g, ' ').trim();
                if (text) lines.push(text);
            }
            return;
        }
        for (const child of node.children || []) walk(child);
    }
    walk(root);
    return lines;
}

function parsePage(html, brand, sourceLink) {
    const $ = cheerio.load(html);
    const lines = collectTextLines($);
    const rows = [];
    let model = '';
    let current = null;
    let section = '';
    let expect = '';
    const finish = () => {
        if (!current) return;
        for (const key of ['vf','mf','sf']) current[key] = current[key]?.[0] || null;
        if (current.model && (current.engine_code || current.engine_volume || current.kw)) rows.push(current);
        current = null;
        section = '';
        expect = '';
    };
    for (const line of lines) {
        if (new RegExp(`^${escRe(brand)}\\s+`, 'i').test(line) && !/Тип модели|Код двигателя|Мощность|Период/i.test(line)) {
            finish(); model = line.replace(new RegExp(`^${escRe(brand)}\\s+`, 'i'), '').trim(); continue;
        }
        if (/^Тип модели\s*\(объем двигателя\)/i.test(line)) {
            finish();
            const label = line.replace(/^Тип модели\s*\(объем двигателя\)\s*/i, '').trim();
            if (!label) { expect = 'type'; continue; }
            const v = label.match(/\d+(?:[.,]\d+)?/);
            current = { model, engine_name: label, engine_volume: v ? Number(v[0].replace(',', '.')) : null, engine_code: null, kw: null, bhp: null, year_from: null, year_to: null, vf: [], mf: [], sf: [], big_link: sourceLink };
            continue;
        }
        if (expect === 'type') {
            const v = line.match(/\d+(?:[.,]\d+)?/);
            current = { model, engine_name: line, engine_volume: v ? Number(v[0].replace(',', '.')) : null, engine_code: null, kw: null, bhp: null, year_from: null, year_to: null, vf: [], mf: [], sf: [], big_link: sourceLink };
            expect = '';
            continue;
        }
        if (!current) continue;
        if (/^Код двигателя/i.test(line)) {
            const value = line.replace(/^Код двигателя\s*/i, '').trim();
            if (value) current.engine_code = value === '.' ? null : value; else expect = 'code';
            continue;
        }
        if (expect === 'code') { current.engine_code = line === '.' ? null : line; expect = ''; continue; }
        if (/^Мощность кВт/i.test(line)) {
            const m = line.match(/(\d{1,4})\s*\(\s*(\d{1,4})\s*\)/);
            if (m) { current.kw = Number(m[1]); current.bhp = Number(m[2]); } else expect = 'power';
            continue;
        }
        if (expect === 'power') {
            const m = line.match(/(\d{1,4})\s*\(\s*(\d{1,4})\s*\)/);
            if (m) { current.kw = Number(m[1]); current.bhp = Number(m[2]); }
            expect = '';
            continue;
        }
        if (/^Период выпуска/i.test(line)) {
            const period = parseYear(line);
            if (period.year_from) Object.assign(current, period); else expect = 'period';
            continue;
        }
        if (expect === 'period') { Object.assign(current, parseYear(line)); expect = ''; continue; }
        if (/воздушн.*салон/i.test(line)) { section = 'sf'; continue; }
        if (/маслян.*фильтр/i.test(line)) { section = 'mf'; continue; }
        if (/воздушн.*фильтр/i.test(line)) { section = 'vf'; continue; }
        const articles = line.match(/\bGB-[A-Z0-9][A-Z0-9/.-]*\b/gi) || [];
        if (section && articles.length) current[section].push(...articles.map(x => x.toUpperCase()));
    }
    finish();
    return rows;
}

function modelScore(car, row) {
    let best = 0;
    for (const a of expandQuery(`${car.model || ''} ${car.generation || ''}`)) {
        for (const b of expandQuery(row.model || '')) {
            const ours = new Set(tokens(a));
            let score = 0;
            for (const t of tokens(b)) if (ours.has(t)) score += /\d/.test(t) ? 3 : 2;
            if (norm(a) === norm(b)) score += 4;
            best = Math.max(best, score);
        }
    }
    return best;
}

function matchRow(car, rows) {
    const scored = [];
    for (const row of rows) {
        let score = modelScore(car, row);
        if (score < 2) continue;
        const bothCodes = car.engine_code && row.engine_code;
        const codeOk = matchEngineCodes(car.engine_code, row.engine_code);
        if (bothCodes && !codeOk) continue;
        if (codeOk) score += 8;
        const volumeOk = car.engine_volume && row.engine_volume && Math.abs(Number(car.engine_volume) - Number(row.engine_volume)) <= 0.12;
        if (volumeOk) score += 3;
        const kwOk = car.kw && row.kw && Math.abs(Number(car.kw) - Number(row.kw)) <= 4;
        if (kwOk) score += 2;
        if (!codeOk && !volumeOk) continue;
        if (car.year_from && row.year_from && car.year_from >= row.year_from - 1 && (!row.year_to || car.year_from <= row.year_to + 1)) score++;
        scored.push({ row, score });
    }
    scored.sort((a,b)=>b.score-a.score);
    if (!scored.length || scored[0].score < 5) return null;
    if (scored[1] && scored[0].score - scored[1].score < 2 && norm(scored[0].row.engine_code) !== norm(scored[1].row.engine_code)) return null;
    return scored[0].row;
}

function incomplete(entry) {
    if (!entry || entry.source === 'none') return true;
    if (entry.vf && entry.mf && entry.sf && entry.kw && entry.bhp) return false;
    if (FORCE || !entry.big_checked_at || RETRY_DAYS === 0) return true;
    return Date.now() - (Date.parse(entry.big_checked_at) || 0) >= RETRY_DAYS * 86400000;
}

const cars = readJson(IN_FILE, null);
const filters = readJson(OUT_FILE, {});
if (!Array.isArray(cars)) { console.error(`Не читается ${IN_FILE}`); process.exit(1); }
const targets = cars.filter(c => c._type_key && incomplete(filters[c._type_key]) && (!BRANDS.length || BRANDS.some(b => c.brand.toLowerCase().includes(b))));
const byBrand = new Map();
for (const car of targets) { if (!byBrand.has(car.brand)) byBrand.set(car.brand, []); byBrand.get(car.brand).push(car); }
const index = parseBrandIndex(await cachedText(`${BASE}/products/cars/`, 'index'));
console.log(`BIG FILTER: ${targets.length} машин, ${byBrand.size} марок; повтор промахов ${RETRY_DAYS} дн.`);
let processed = 0, found = 0, missed = 0, errors = 0;
for (const [brand, brandCars] of byBrand) {
    if (processed >= LIMIT) break;
    const hitBrand = findBrand(index, brand);
    if (!hitBrand) { console.log(`  ✗ ${brand}: марка не найдена`); continue; }
    try {
        const rows = parsePage(await cachedText(hitBrand.url, `brand-${hitBrand.slug}`), hitBrand.name, hitBrand.url);
        for (const car of brandCars) {
            if (processed++ >= LIMIT) break;
            const current = filters[car._type_key] || {};
            const hit = matchRow(car, rows);
            if (!hit) {
                filters[car._type_key] = { ...current, big_checked_at: new Date().toISOString(), why_big: 'уверенное совпадение не найдено' };
                missed++; continue;
            }
            const merged = { ...current };
            for (const key of ['vf','mf','sf','kw','bhp']) if (!merged[key] && hit[key]) merged[key] = hit[key];
            const sources = new Set(Array.isArray(merged.sources) ? merged.sources : String(merged.source || '').split('+').filter(x => x && x !== 'none'));
            sources.add('big');
            merged.sources = [...sources];
            merged.source = merged.sources.join('+');
            merged.big_link = hit.big_link;
            merged.big_checked_at = new Date().toISOString();
            merged.matched_big = `${hit.model} ${hit.engine_name || ''} ${hit.engine_code || ''}`.replace(/\s+/g, ' ').trim();
            filters[car._type_key] = merged;
            found++;
            console.log(`  ✓ ${car.brand} ${car.model} ${car.engine_code || ''}: vf=${merged.vf || '—'} mf=${merged.mf || '—'} sf=${merged.sf || '—'} kw=${merged.kw || '—'}`);
            writeJson(OUT_FILE, filters);
        }
    } catch (error) { errors++; console.warn(`  ⚠ ${brand}: ${error.message}`); }
}
writeJson(OUT_FILE, filters);
console.log(`BIG FILTER: найдено ${found}, промахов ${missed}, ошибок марок ${errors}`);
process.exit(errors ? 2 : 0);
