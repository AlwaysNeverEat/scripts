#!/usr/bin/env node
// Собирает единый набор для обогащения:
//   1) все машины Motul из cars-enriched.json;
//   2) старые машины БД, у которых отсутствует хотя бы один фильтр, кВт или л.с.
// Старые машины не импортируются заново: synthetic _type_key нужен только для
// подбора и последующего UPDATE существующей строки.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './http.js';
import { makeQuery } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const args = process.argv.slice(2);
function argValue(name, fallback) {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback;
}

const IN_FILE = path.resolve(ROOT, argValue('--in', 'data/import/cars-enriched.json'));
const OUT_FILE = path.resolve(ROOT, argValue('--out', 'data/import/cars-workset.json'));
const ALL_DB = args.includes('--all-db');

const motulCars = readJson(IN_FILE, []);
if (!Array.isArray(motulCars)) {
    console.error(`${IN_FILE} должен быть массивом`);
    process.exit(1);
}

const query = await makeQuery();
const missingFilter = (slot) => `(
    coalesce(filter_part_numbers->'${slot}'->>'part', '') = ''
    AND coalesce(filter_part_numbers->'${slot}'->>'absent', 'false') <> 'true'
)`;
const where = ALL_DB ? 'true' : `(
    kw IS NULL OR bhp IS NULL
    OR ${missingFilter('vf')}
    OR ${missingFilter('mf')}
    OR ${missingFilter('sf')}
)`;
const result = await query(`
    SELECT id, brand, model, generation, engine_code, engine_volume,
           year_from, year_to, kw, bhp, fuel_type, motul_name, engine_name,
           fluid_capacities, car_approvals, source_links
    FROM cars
    WHERE ${where}
    ORDER BY brand, model, year_from, engine_code
`);

function naturalKey(car) {
    return [car.brand, car.model, car.engine_code || '', Number(car.engine_volume || 0).toFixed(1), car.year_from]
        .map(x => String(x).toLowerCase().trim())
        .join('|');
}

const workset = motulCars.map(car => ({ ...car }));
const byNaturalKey = new Map();
for (const car of workset) {
    if (car.brand && car.model && car.year_from) byNaturalKey.set(naturalKey(car), car);
}

let merged = 0;
let appended = 0;
for (const row of result.rows) {
    const key = naturalKey(row);
    const existing = byNaturalKey.get(key);
    if (existing) {
        existing._db_id = row.id;
        if (existing.kw == null) existing.kw = row.kw;
        if (existing.bhp == null) existing.bhp = row.bhp;
        merged++;
        continue;
    }

    const car = {
        brand: row.brand,
        model: row.model,
        generation: row.generation,
        engine_code: row.engine_code,
        engine_volume: row.engine_volume == null ? null : Number(row.engine_volume),
        year_from: row.year_from,
        year_to: row.year_to,
        kw: row.kw,
        bhp: row.bhp,
        fuel_type: row.fuel_type,
        motul_name: row.motul_name,
        engine_name: row.engine_name,
        fluid_capacities: row.fluid_capacities || {},
        car_approvals: row.car_approvals || [],
        source_links: row.source_links || {},
        _type_key: `db:${row.id}`,
        _db_id: row.id,
        _backfill_only: true,
        _warnings: ['добавлено из БД только для дозаполнения фильтров/мощности'],
    };
    workset.push(car);
    byNaturalKey.set(key, car);
    appended++;
}

writeJson(OUT_FILE, workset);
console.log(`Набор обогащения: Motul=${motulCars.length}, старых строк БД с пропусками=${result.rows.length}`);
console.log(`  совпали с Motul: ${merged}`);
console.log(`  добавлены только для backfill: ${appended}`);
console.log(`  итог: ${workset.length} → ${OUT_FILE}`);
