#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Достановка фильтров по КОДУ ДВИГАТЕЛЯ — без сети, поверх уже собранного
// data/import/filters.json.
//
// Зачем: один и тот же мотор стоит на разных моделях и даже разных марках
// (OM662 у SsangYong и TAGAZ, EA189 у VW/Skoda/Audi/Seat). Если для одной
// машины артикул уже найден, для «однодвигательных» соседей его не нужно
// искать заново.
//
// ЧТО КОПИРУЕМ И ПОЧЕМУ ТОЛЬКО ЭТО:
//   mf (МАСЛЯНЫЙ)   — по умолчанию. Масляный фильтр — деталь двигателя:
//                     одинаковый код мотора → одинаковый фильтр.
//   vf (ВОЗДУШНЫЙ)  — только с --all. Зависит от корпуса воздушного фильтра,
//                     а он от платформы, а не от мотора.
//   sf (САЛОННЫЙ)   — только с --all. К двигателю не имеет отношения вообще,
//                     это кузов. Копировать его по мотору — почти наверняка
//                     ошибка; флаг есть только для ручных экспериментов.
// (Именование vf/mf/sf — как у операторов, см. scrape-filters.js.)
//
// Правила безопасности:
//   • код двигателя должен быть внятным: латиница, ≥4 символов, есть и буква,
//     и цифра («1KR-FE», «OM662», «4G63»). «2C», «1.9 TDI», «Система
//     охлаждения» — не коды, такие машины пропускаются;
//   • объём двигателя должен совпадать (до 0.1 л). Донор без объёма подходит
//     к любому;
//   • если у доноров с одним кодом РАЗНЫЕ артикулы — не гадаем, пропускаем
//     (расхождение попадёт в статистику);
//   • заполненное не трогаем — только пустые поля;
//   • kw/bhp и mann_link НЕ копируются: мощность у одного мотора в разных
//     марках отличается, а ссылка ведёт на чужую машину.
//
// Запуск:  node scripts/import/fill-filters-by-engine.js [--dry-run] [--all]
//              [--cars файл] [--filters файл] [--show N]
// ─────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');

const args = process.argv.slice(2);
function argValue(name, fallback) {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback;
}
const CARS_FILE = path.resolve(ROOT, argValue('--cars', 'data/import/cars-enriched.json'));
const FILTERS_FILE = path.resolve(ROOT, argValue('--filters', 'data/import/filters.json'));
const DRY_RUN = args.includes('--dry-run');
const FIELDS = args.includes('--all') ? ['mf', 'vf', 'sf'] : ['mf'];
const SHOW = parseInt(argValue('--show', '15')) || 0;

// ── Ключи двигателя ──────────────────────────────────────────────────────────
// «G23D (MB M161)» → ['G23D', 'M161']; «4G63-DOHC» → ['4G63-DOHC', '4G63'];
// «1KR-FE» → ['1KR-FE'] (обрубок «1KR» короче 4 символов — не берём, чтобы не
// склеить разные моторы одной серии).
function engineKeys(code) {
    const raw = String(code || '').toUpperCase();
    if (!raw || /[А-ЯЁ]/.test(raw)) return [];
    const usable = (t) => t.length >= 4 && /[A-Z]/.test(t) && /\d/.test(t) && /^[A-Z0-9][A-Z0-9.\-+]*$/.test(t);
    const out = new Set();
    for (const token of raw.split(/[^A-Z0-9.\-+]+/)) {
        const t = token.replace(/^[-.+]+|[-.+]+$/g, '');
        if (!t) continue;
        if (usable(t)) out.add(t);
        const head = t.split('-')[0];
        if (head !== t && usable(head)) out.add(head);
    }
    return [...out];
}

const bucketOf = (car) => car.engine_volume ? Number(car.engine_volume).toFixed(1) : '?';

// ── Загрузка ────────────────────────────────────────────────────────────────
const cars = readJson(CARS_FILE, null);
const filters = readJson(FILTERS_FILE, null);
if (!Array.isArray(cars)) { console.error(`Не читается ${CARS_FILE}`); process.exit(1); }
if (!filters || typeof filters !== 'object') { console.error(`Не читается ${FILTERS_FILE}`); process.exit(1); }

const usable = cars.filter(c => c && c._type_key);
console.log(`Машин: ${usable.length}, записей фильтров: ${Object.keys(filters).length}`);
console.log(`Копируем поля: ${FIELDS.join(', ')}${DRY_RUN ? '  [dry-run]' : ''}`);

// ── Индекс доноров: ключ двигателя → объём → поле → артикул → машина-донор ───
function buildDonors() {
    const donors = new Map();
    let donorCars = 0;
    for (const car of usable) {
        const entry = filters[car._type_key];
        if (!entry || entry.source === 'none') continue;
        if (!FIELDS.some(f => entry[f])) continue;
        const keys = engineKeys(car.engine_code);
        if (!keys.length) continue;
        donorCars++;
        const bucket = bucketOf(car);
        for (const key of keys) {
            if (!donors.has(key)) donors.set(key, new Map());
            const byBucket = donors.get(key);
            if (!byBucket.has(bucket)) byBucket.set(bucket, {});
            const slot = byBucket.get(bucket);
            for (const f of FIELDS) {
                if (!entry[f]) continue;
                if (!slot[f]) slot[f] = new Map();
                if (!slot[f].has(entry[f])) slot[f].set(entry[f], car);
            }
        }
    }
    return { donors, donorCars };
}

// Варианты артикула для (код, объём): точный объём + доноры без объёма;
// у машины без объёма — все объёмы этого кода (тогда согласие должно быть
// полным).
function candidates(donors, key, bucket, field) {
    const byBucket = donors.get(key);
    if (!byBucket) return null;
    const merged = new Map();
    for (const [b, slot] of byBucket) {
        if (bucket !== '?' && b !== '?' && b !== bucket) continue;
        for (const [value, car] of slot[field] || []) if (!merged.has(value)) merged.set(value, car);
    }
    return merged.size ? merged : null;
}

// ── Достановка ──────────────────────────────────────────────────────────────
const filled = { mf: 0, vf: 0, sf: 0 };
let touched = 0, conflicts = 0, noCode = 0, noDonor = 0, examples = [];

// Машина с двумя кодами («G23D (MB M161)») связывает две группы, поэтому
// заполненное на этом проходе открывает доноров для следующего. Крутим до
// сходимости, чтобы один запуск давал тот же результат, что три подряд.
for (let round = 1; round <= 6; round++) {
    const before = touched;
    conflicts = 0; noCode = 0; noDonor = 0;
    const { donors, donorCars } = buildDonors();
    if (round === 1) {
        console.log(`Доноров (машин с найденными фильтрами и внятным кодом): ${donorCars}, кодов двигателя: ${donors.size}`);
    }
    fillPass(donors);
    if (touched === before) break;
}

function fillPass(donors) {
  for (const car of usable) {
    const entry = filters[car._type_key];
    const missing = FIELDS.filter(f => !(entry && entry[f]));
    if (!missing.length) continue;

    const keys = engineKeys(car.engine_code);
    if (!keys.length) { noCode++; continue; }
    const bucket = bucketOf(car);

    const picked = {};
    let from = null;
    for (const field of missing) {
        // Несколько ключей у одной машины («G23D (MB M161)») — согласие
        // требуется по каждому: разошлись между собой, значит не уверены.
        const values = new Map();
        for (const key of keys) {
            const found = candidates(donors, key, bucket, field);
            if (!found) continue;
            for (const [value, donor] of found) if (!values.has(value)) values.set(value, donor);
        }
        if (!values.size) continue;
        if (values.size > 1) { conflicts++; continue; }
        const [value, donor] = [...values][0];
        if (donor._type_key === car._type_key) continue;
        picked[field] = value;
        from = donor;
    }

    if (!from) { noDonor++; continue; }

    const prev = entry && entry.source !== 'none' ? entry : {};
    const sources = new Set([
        ...(Array.isArray(prev.sources) ? prev.sources : String(prev.source || '').split('+').filter(s => s && s !== 'none')),
        ...(Array.isArray(filters[from._type_key].sources)
            ? filters[from._type_key].sources
            : String(filters[from._type_key].source || '').split('+').filter(s => s && s !== 'none')),
    ]);
    const note = `скопировано по коду двигателя ${from.engine_code} (${from.brand} ${from.model})`;
    filters[car._type_key] = {
        ...prev,
        ...picked,
        // kw остаётся в записи (пусть и null), иначе scrape-filters.js будет
        // заново гонять эти машины через Mann на каждом прогоне. Раз в
        // MANN_RETRY_DAYS prepare-filter-retry.js всё равно снимет запись и
        // отправит на честный подбор.
        kw: prev.kw ?? null,
        bhp: prev.bhp ?? null,
        source: [...sources].join('+') || 'mann',
        sources: [...sources],
        copied_from: from._type_key,
        copied_by: 'engine-code',
        matched: prev.matched ? `${prev.matched} + ${note}` : note,
        why: undefined,
    };
    touched++;
    for (const f of Object.keys(picked)) filled[f]++;
    if (examples.length < SHOW) {
        examples.push(`  ✓ ${car.brand} ${car.model} ${car.engine_code || ''} ${car.year_from || ''}`.replace(/\s+$/, '')
            + ` ← ${from.brand} ${from.model}: `
            + Object.entries(picked).map(([f, v]) => `${f}=${v}`).join(' '));
    }
  }
}

for (const line of examples) console.log(line);

if (!DRY_RUN) writeJson(FILTERS_FILE, filters);

console.log(`\nДозаполнено машин: ${touched}`
    + ` (${FIELDS.map(f => `${f}: ${filled[f]}`).join(', ')})`);
console.log(`Пропущено: расхождение артикулов у одного кода ${conflicts},`
    + ` без внятного кода двигателя ${noCode}, донора нет ${noDonor}`);
console.log(DRY_RUN ? 'Файл НЕ изменён (--dry-run).' : `Записан ${FILTERS_FILE}`);
