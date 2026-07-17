#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Пополнение СУЩЕСТВУЮЩИХ машин в БД данными Liqui Moly: объёмы по агрегатам,
// кВт, л.с., ссылка на подбор. Строго недеструктивно — пишем только в пустые
// слоты, заполненное (в т.ч. ручное) не трогаем. Новые машины сюда не попадают
// (их добавляет import-cars.js).
//
// Запуск:  node scripts/import/apply-liquimoly.js [--dry-run] [--limit N]
//              [--user login] [--cars data/import/liquimoly-cars.json]
//
// Матчинг: LiquiMoly не отдаёт код двигателя, поэтому машину БД ищем по
// марка+модель+объём+год, а при нескольких кандидатах разводим по ближайшему кВт.
// ─────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './http.js';
import { makeQuery } from './db.js';
import { buildSourceKeys, cleanSourceLinks } from '../../../shared/sourceLinks.js';
import { color, mark, carLabel, info } from './log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback; };

const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(arg('--limit', '0')) || Infinity;
const USER_LOGIN = arg('--user', null);
const CARS_FILE = path.resolve(ROOT, arg('--cars', 'data/import/liquimoly-cars.json'));

const AGGREGATES = ['engine', 'automatic', 'manual', 'transfer', 'diffFront', 'diffRear'];
const norm = (v) => String(v ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

// Ключ без кода двигателя (LiquiMoly его не даёт).
const looseKey = (brand, model, volume, yearFrom) =>
    `${norm(brand)}|${norm(model)}|${Number(volume ?? 0).toFixed(1)}|${yearFrom ?? ''}`;

function slotVolume(slot) {
    if (!slot || typeof slot !== 'object') return null;
    return slot.volumeService || slot.volumeTotal || slot.volumePlain || slot.volume || null;
}

// Доливаем в fluid_capacities БД только те агрегаты, где у нас есть объём, а в
// базе слот пуст (нет объёма). Возвращаем новый объект и список изменённых.
function mergeFluid(dbFluid, lmFluid) {
    const next = dbFluid && typeof dbFluid === 'object' ? JSON.parse(JSON.stringify(dbFluid)) : {};
    const changed = [];
    for (const key of AGGREGATES) {
        const lm = lmFluid && lmFluid[key];
        const lmVol = slotVolume(lm);
        if (lmVol == null) continue;                 // у источника объёма нет — нечего лить
        if (slotVolume(next[key]) != null) continue; // в базе уже заполнено — не трогаем
        next[key] = { ...(next[key] || {}), ...lm };
        changed.push(key);
    }
    return { next, changed };
}

// Из нескольких кандидатов БД выбираем ближайший по кВт (когда у LM он есть).
function pickRow(rows, lmCar) {
    if (rows.length === 1) return rows[0];
    if (lmCar.kw == null) return rows[0];
    return rows.slice().sort((a, b) =>
        Math.abs((a.kw ?? 1e9) - lmCar.kw) - Math.abs((b.kw ?? 1e9) - lmCar.kw))[0];
}

const cars = readJson(CARS_FILE, null);
if (!Array.isArray(cars)) { console.error(`Не читается ${CARS_FILE} — сначала scrape-liquimoly.js`); process.exit(1); }

const query = await makeQuery();
let importUser = null;
if (USER_LOGIN) {
    const r = await query('SELECT id, display_name FROM users WHERE lower(login) = lower($1)', [USER_LOGIN]);
    if (!r.rows.length) { console.error(`Пользователь «${USER_LOGIN}» не найден`); process.exit(1); }
    importUser = r.rows[0];
    info(`Правки будут записаны на: ${importUser.display_name} (${USER_LOGIN})`);
}

const dbResult = await query(`
    SELECT id, brand, model, engine_code, engine_volume, year_from,
           kw, bhp, fluid_capacities, source_links, service_flags
    FROM cars`);
const index = new Map();
for (const row of dbResult.rows) {
    const k = looseKey(row.brand, row.model, row.engine_volume, row.year_from);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(row);
}
info(`в базе ${dbResult.rows.length} машин — доливаю объёмы/мощность из Liqui Moly только в пустое`);

let processed = 0, updated = 0, noMatch = 0, unchanged = 0, failed = 0;
for (const car of cars) {
    if (processed >= LIMIT) break;
    const rows = index.get(looseKey(car.brand, car.model, car.engine_volume, car.year_from));
    if (!rows || !rows.length) { noMatch++; continue; }
    const row = pickRow(rows, car);
    processed++;

    const changes = {};
    const sets = [];
    const params = [];
    const p = (v) => { params.push(v); return '$' + params.length; };

    const merged = mergeFluid(row.fluid_capacities, car.fluid_capacities);
    if (merged.changed.length) {
        changes.fluid_capacities = { from: row.fluid_capacities, to: merged.next };
        sets.push(`fluid_capacities = ${p(JSON.stringify(merged.next))}::jsonb`);
    }
    if (car.kw != null && row.kw == null) { changes.kw = { from: null, to: car.kw }; sets.push(`kw = ${p(car.kw)}`); }
    if (car.bhp != null && row.bhp == null) { changes.bhp = { from: null, to: car.bhp }; sets.push(`bhp = ${p(car.bhp)}`); }

    const oldLinks = row.source_links || {};
    if (!oldLinks.liquimoly && car.source_links && car.source_links.liquimoly) {
        const nextLinks = cleanSourceLinks({ ...oldLinks, liquimoly: car.source_links.liquimoly });
        changes.source_links = { from: oldLinks, to: nextLinks };
        sets.push(`source_links = ${p(JSON.stringify(nextLinks))}::jsonb`);
        sets.push(`source_keys = ${p(JSON.stringify(buildSourceKeys(nextLinks)))}::jsonb`);
    }

    if (!sets.length) { unchanged++; continue; }
    const label = carLabel({ brand: car.brand, model: car.model, engine_code: row.engine_code, year_from: car.year_from });
    if (DRY_RUN) { updated++; info(`  ${color.dim('[dry-run]')} ${label}: ${Object.keys(changes).join(', ')} ${merged.changed.length ? color.vol('объёмы:' + merged.changed.join('/')) : ''}`); continue; }

    let sql = `WITH upd AS (UPDATE cars SET ${sets.join(', ')}, updated_at = now() WHERE id = ${p(row.id)} RETURNING id)`;
    if (importUser) {
        const bits = [];
        if (merged.changed.length) bits.push(`объёмы ${merged.changed.join('/')}`);
        if (changes.kw || changes.bhp) bits.push('мощность');
        if (changes.source_links) bits.push('ссылка Liqui Moly');
        const comment = `${bits.join(', ')} дозаполнены автоматически (Liqui Moly)`;
        sql += ` INSERT INTO car_events (car_id, user_id, type, comment, changed_fields)
                 SELECT id, ${p(importUser.id)}, 'edited', ${p(comment)}, ${p(JSON.stringify(changes))}::jsonb FROM upd RETURNING car_id AS id`;
    } else {
        sql += ' SELECT id FROM upd';
    }

    try {
        const r = await query(sql, params);
        if (!r.rows.length) { unchanged++; continue; }
        updated++;
        info(`  ${mark.ok} ${label}: ${merged.changed.length ? color.vol('объёмы ' + merged.changed.join('/')) : ''} `
            + `${changes.kw ? color.power('kw') : ''} ${changes.bhp ? color.power('bhp') : ''} ${changes.source_links ? color.link('+lm') : ''}`.trim());
    } catch (error) { failed++; console.error(`  ${mark.fail} ${label}: ${error.message}`); }
}

info(`${DRY_RUN ? '[dry-run] ' : ''}${color.stage('Liqui Moly → БД (пополнение существующих):')}`);
info(`  ${DRY_RUN ? 'будет обновлено' : 'обновлено'}: ${color.ok(String(updated))}`);
info(`  без изменений (уже заполнено): ${unchanged}`);
info(`  нет машины в БД (кандидат на добавление import-cars): ${noMatch}`);
if (failed) info(`  ошибок: ${color.warn(String(failed))}`);
process.exit(failed ? 2 : 0);
