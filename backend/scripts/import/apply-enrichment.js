#!/usr/bin/env node
// Идемпотентная дозапись фильтров и мощности из filters.json.
// Заполняет только отдельные пустые vf/mf/sf, kw и bhp. Ручные значения и
// absent:true никогда не перезаписываются.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './http.js';
import { makeQuery } from './db.js';
import { buildSourceKeys, cleanSourceLinks } from '../../../shared/sourceLinks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const args = process.argv.slice(2);
function argValue(name, fallback) {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback;
}

const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(argValue('--limit', '0')) || Infinity;
const USER_LOGIN = argValue('--user', null);
const FILTERS_FILE = path.resolve(ROOT, argValue('--filters', 'data/import/filters.json'));
const CARS_FILE = path.resolve(ROOT, argValue('--cars', 'data/import/cars-workset.json'));

const filters = readJson(FILTERS_FILE, null);
const cars = readJson(CARS_FILE, null);
if (!filters || !Array.isArray(cars)) {
    console.error('Нужны filters.json и cars-workset.json');
    process.exit(1);
}

const query = await makeQuery();
let importUser = null;
if (USER_LOGIN) {
    const result = await query('SELECT id, display_name FROM users WHERE lower(login) = lower($1)', [USER_LOGIN]);
    if (!result.rows.length) {
        console.error(`Пользователь «${USER_LOGIN}» не найден`);
        process.exit(1);
    }
    importUser = result.rows[0];
    console.log(`Правки будут записаны на: ${importUser.display_name} (${USER_LOGIN})`);
}

function naturalKey(car) {
    return [car.brand, car.model, car.engine_code || '', Number(car.engine_volume || 0).toFixed(1), car.year_from]
        .map(x => String(x).toLowerCase().trim())
        .join('|');
}

const dbResult = await query(`
    SELECT id, brand, model, engine_code, engine_volume, year_from,
           filter_part_numbers, kw, bhp, source_links
    FROM cars
`);
const dbById = new Map();
const dbByKey = new Map();
for (const row of dbResult.rows) {
    dbById.set(String(row.id), row);
    dbByKey.set(naturalKey(row), row);
}
console.log(`В базе ${dbResult.rows.length} машин — UPDATE только при реальной дозаписи`);

const carByTypeKey = new Map(cars.filter(x => x._type_key).map(x => [x._type_key, x]));

function slotFilled(slot) {
    return Boolean(slot && ((slot.part && String(slot.part).trim()) || slot.absent === true));
}

function mergeFilterPartNumbers(current, entry) {
    const next = current && typeof current === 'object' ? JSON.parse(JSON.stringify(current)) : {};
    const changed = [];
    for (const key of ['vf', 'mf', 'sf']) {
        const part = entry[key] && String(entry[key]).trim();
        if (!part || slotFilled(next[key])) continue;
        next[key] = { part, absent: false };
        changed.push(key);
    }
    return { next, changed };
}

function sourceName(entry) {
    const names = Array.isArray(entry.sources) && entry.sources.length
        ? entry.sources
        : String(entry.source || 'catalog').split('+').filter(Boolean);
    return names.map(x => x === 'mann' ? 'MANN-FILTER' : x === 'big' ? 'BIG FILTER' : x === 'lynx' ? 'LYNX' : x).join(' + ');
}

let processed = 0, updated = 0, noCar = 0, noRow = 0, unchanged = 0, failed = 0;
for (const [typeKey, entry] of Object.entries(filters)) {
    if (processed >= LIMIT) break;
    if (!entry || entry.source === 'none') continue;
    const hasPayload = entry.vf || entry.mf || entry.sf || entry.kw || entry.bhp || entry.mann_link;
    if (!hasPayload) continue;

    const car = carByTypeKey.get(typeKey);
    if (!car) { noCar++; continue; }
    const row = car._db_id != null ? dbById.get(String(car._db_id)) : dbByKey.get(naturalKey(car));
    if (!row) { noRow++; continue; }
    processed++;

    const changes = {};
    const sets = [];
    const params = [];
    const p = value => { params.push(value); return '$' + params.length; };

    const mergedFilters = mergeFilterPartNumbers(row.filter_part_numbers, entry);
    if (mergedFilters.changed.length) {
        changes.filter_part_numbers = { from: row.filter_part_numbers, to: mergedFilters.next };
        sets.push(`filter_part_numbers = ${p(JSON.stringify(mergedFilters.next))}::jsonb`);
    }
    if (entry.kw && row.kw == null) {
        changes.kw = { from: null, to: Number(entry.kw) };
        sets.push(`kw = ${p(Number(entry.kw))}`);
    }
    if (entry.bhp && row.bhp == null) {
        changes.bhp = { from: null, to: Number(entry.bhp) };
        sets.push(`bhp = ${p(Number(entry.bhp))}`);
    }

    const oldLinks = row.source_links || {};
    if (entry.mann_link && !oldLinks.mann) {
        const nextLinks = cleanSourceLinks({ ...oldLinks, mann: entry.mann_link });
        changes.source_links = { from: oldLinks, to: nextLinks };
        sets.push(`source_links = ${p(JSON.stringify(nextLinks))}::jsonb`);
        sets.push(`source_keys = ${p(JSON.stringify(buildSourceKeys(nextLinks)))}::jsonb`);
    }

    if (!sets.length) { unchanged++; continue; }
    const label = `${car.brand} ${car.model} ${car.engine_code || ''} ${car.year_from || ''}`.replace(/\s+/g, ' ').trim();
    if (DRY_RUN) {
        updated++;
        console.log(`  [dry-run] ${label}: ${Object.keys(changes).join(', ')}`);
        continue;
    }

    let sql = `WITH upd AS (
        UPDATE cars SET ${sets.join(', ')}, updated_at = now()
        WHERE id = ${p(row.id)}
        RETURNING id
    )`;
    if (importUser) {
        const changedNames = [];
        if (mergedFilters.changed.length) changedNames.push(`фильтры ${mergedFilters.changed.join('/')}`);
        if (changes.kw || changes.bhp) changedNames.push('мощность');
        if (changes.source_links) changedNames.push('ссылка MANN');
        const comment = `${changedNames.join(', ')} дозаполнены автоматически (${sourceName(entry)})`;
        sql += `
        INSERT INTO car_events (car_id, user_id, type, comment, changed_fields)
        SELECT id, ${p(importUser.id)}, 'edited', ${p(comment)}, ${p(JSON.stringify(changes))}::jsonb
        FROM upd
        RETURNING car_id AS id`;
    } else {
        sql += ' SELECT id FROM upd';
    }

    try {
        const result = await query(sql, params);
        if (!result.rows.length) { unchanged++; continue; }
        updated++;
        row.filter_part_numbers = mergedFilters.next;
        if (changes.kw) row.kw = changes.kw.to;
        if (changes.bhp) row.bhp = changes.bhp.to;
        if (changes.source_links) row.source_links = changes.source_links.to;
        console.log(`  ✓ ${label}: ${Object.keys(changes).join(', ')}`);
    } catch (error) {
        failed++;
        console.error(`  ⚠ ${label}: ${error.message}`);
    }
}

console.log(`${DRY_RUN ? '[dry-run] ' : ''}Дозаполнение завершено:`);
console.log(`  обработано записей каталога: ${processed}`);
console.log(`  ${DRY_RUN ? 'будет обновлено' : 'обновлено'}: ${updated}`);
console.log(`  уже заполнено: ${unchanged}`);
if (noCar) console.log(`  старых записей filters.json вне workset: ${noCar}`);
if (noRow) console.log(`  машин workset, не найденных в БД: ${noRow}`);
if (failed) console.log(`  ошибок: ${failed}`);
process.exit(failed ? 2 : 0);
