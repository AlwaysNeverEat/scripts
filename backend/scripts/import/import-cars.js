#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Заливка машин из JSON (собранного scrape-motul.js + scrape-rolf.js) в БД.
// По образцу scripts/seed.js: напрямую в Postgres, мимо API.
//
// Запуск:  DATABASE_URL=postgres://... node scripts/import/import-cars.js \
//              [data/import/motul-cars.json] [--dry-run] [--limit N]
//
// Существующие машины не трогаем: INSERT ... ON CONFLICT DO NOTHING по
// уникальному ключу (brand, model, engine_code, engine_volume, year_from) —
// всё, что коллеги уже рассчитали руками, остаётся как есть.
// Импортированные помечаются created_by='import' и предупреждением в notes.
// ─────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '../../src/db/client.js';
import { buildNameFields } from '../../../shared/translit.js';
import { buildSourceKeys, cleanSourceLinks } from '../../../shared/sourceLinks.js';
import { readJson } from './http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || Infinity : Infinity;
const fileArg = args.find(a => !a.startsWith('--') && a !== args[limitIdx + 1]);
const IN_FILE = path.resolve(ROOT, fileArg || 'data/import/motul-cars.json');

const NOTES_BASE = '⚠ Импортировано автоматически (Motul + ROLF), не проверено';

const cars = readJson(IN_FILE, null);
if (!cars) {
    console.error(`Не читается ${IN_FILE} — сначала запусти scrape-motul.js`);
    process.exit(1);
}

// ── Валидация записи; возвращает список проблем ─────────────────────────────
function validate(car) {
    const problems = [];
    if (!car.brand) problems.push('нет brand');
    if (!car.model) problems.push('нет model');
    if (!car.year_from) problems.push('нет year_from');
    const e = car.fluid_capacities && car.fluid_capacities.engine;
    const vol = e && (e.volumeService || e.volumeTotal || e.volumePlain || e.volume);
    if (!vol) problems.push('нет объёма масла двигателя');
    return problems;
}

let inserted = 0, existing = 0, invalid = 0;
const invalidReport = [];

for (const car of cars.slice(0, LIMIT)) {
    const label = [car.brand, car.model, car.engine_code, car.year_from].filter(Boolean).join(' ');
    const problems = validate(car);
    if (problems.length) {
        invalid++;
        invalidReport.push(`${label || '(пустая запись)'}: ${problems.join(', ')}`);
        continue;
    }

    const notes = car.car_approvals && car.car_approvals.length
        ? NOTES_BASE
        : NOTES_BASE + '; допуски на ROLF не нашлись';

    const sourceLinks = cleanSourceLinks(car.source_links);
    const sourceKeys = buildSourceKeys(sourceLinks);

    if (DRY_RUN) {
        const r = await query(
            `SELECT 1 FROM cars
             WHERE lower(brand) = lower($1) AND lower(model) = lower($2)
               AND lower(coalesce(engine_code, '')) = lower(coalesce($3, ''))
               AND coalesce(engine_volume, 0) = coalesce($4::numeric, 0)
               AND year_from = $5`,
            [car.brand, car.model, car.engine_code, car.engine_volume, car.year_from],
        );
        if (r.rows.length) existing++; else inserted++;
        continue;
    }

    const { nameNormalized, nameCyrillic, nameTranslit, synonymTokens } = buildNameFields(
        car.brand, car.model, car.generation, car.engine_code,
        car.engine_volume, car.year_from, car.year_to);
    const svTokens = synonymTokens.flatMap(s => s.split(/\s+/)).filter(Boolean).join(' ');

    const r = await query(
        `INSERT INTO cars (brand, model, generation, engine_code, engine_volume,
                           year_from, year_to, kw, bhp, fuel_type,
                           motul_name, engine_name,
                           fluid_capacities, filter_part_numbers, car_approvals,
                           notes, source_links, source_keys,
                           name_normalized, name_cyrillic, name_translit, search_vector,
                           created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                 $19,$20,$21,to_tsvector('simple', $22),'import')
         ON CONFLICT (lower(brand), lower(model), lower(coalesce(engine_code,'')), coalesce(engine_volume,0), year_from)
         DO NOTHING
         RETURNING id`,
        [car.brand, car.model, car.generation ?? null, car.engine_code ?? null,
         car.engine_volume ?? null, car.year_from, car.year_to ?? null,
         car.kw ?? null, car.bhp ?? null, car.fuel_type ?? null,
         car.motul_name ?? null, car.engine_name ?? null,
         JSON.stringify(car.fluid_capacities), JSON.stringify({}),
         JSON.stringify(car.car_approvals || []),
         notes, JSON.stringify(sourceLinks), JSON.stringify(sourceKeys),
         nameNormalized, nameCyrillic, nameTranslit, svTokens],
    );
    if (r.rows.length) inserted++; else existing++;
}

console.log(`${DRY_RUN ? '[dry-run] ' : ''}Импорт из ${path.relative(ROOT, IN_FILE)}:`);
console.log(`  ${DRY_RUN ? 'будет добавлено' : 'добавлено'}: ${inserted}`);
console.log(`  уже в базе (пропущено): ${existing}`);
console.log(`  битых записей: ${invalid}`);
if (invalidReport.length) {
    console.log('\nБитые записи:');
    for (const line of invalidReport.slice(0, 30)) console.log('  - ' + line);
    if (invalidReport.length > 30) console.log(`  … и ещё ${invalidReport.length - 30}`);
}
process.exit(0);
