#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Заливка подобранных артикулов фильтров (data/import/filters.json) в БД.
//
// Запуск:  node scripts/import/apply-filters.js [--dry-run] [--limit N]
//              [--user login] [--state файл] [--filters файл] [--cars файл]
//
// Обновляются ТОЛЬКО машины с пустыми фильтрами (все part пустые и нет
// absent:true) — всё, что заполнено руками, неприкосновенно. Каждое обновление
// пишет событие 'edited' в car_events (формат changed_fields как у
// diffChangedFields в routes/cars.js) — на сайте это выглядит как обычная
// правка, а метрика edited считает её на пользователя из --user.
// ─────────────────────────────────────────────────────────────────────────────

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
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(argValue('--limit', '0')) || Infinity;
const USER_LOGIN = argValue('--user', null);
const FILTERS_FILE = path.resolve(ROOT, argValue('--filters', 'data/import/filters.json'));
const CARS_FILE = path.resolve(ROOT, argValue('--cars', 'data/import/cars-enriched.json'));
const STATE_FILE = path.resolve(ROOT, argValue('--state', 'data/import/.filters-applied.json'));

const query = await makeQuery();

const filters = readJson(FILTERS_FILE, null);
const cars = readJson(CARS_FILE, null);
if (!filters || !cars) {
    console.error('Нужны filters.json и cars-enriched.json — сначала scrape-filters.js');
    process.exit(1);
}

let importUser = null;
if (USER_LOGIN) {
    const r = await query('SELECT id, display_name FROM users WHERE lower(login) = lower($1)', [USER_LOGIN]);
    if (!r.rows.length) {
        console.error(`Пользователь «${USER_LOGIN}» не найден`);
        process.exit(1);
    }
    importUser = r.rows[0];
    console.log(`Правки будут записаны на: ${importUser.display_name} (${USER_LOGIN})`);
}

const applied = new Set(readJson(STATE_FILE, []));
const carByKey = new Map(cars.map(c => [c._type_key, c]));

// Условие «фильтры пустые»: {} или объект без единого part/absent:true.
const EMPTY_FPN = `NOT EXISTS (
    SELECT 1 FROM jsonb_each(coalesce(c.filter_part_numbers, '{}'::jsonb)) AS f(k, v)
    WHERE coalesce(v->>'part', '') <> '' OR coalesce(v->>'absent', 'false') = 'true'
)`;

function buildFpn(entry) {
    const mk = (part) => part
        ? { part, absent: false }
        : { part: null, absent: false };
    return { vf: mk(entry.vf), mf: mk(entry.mf), sf: mk(entry.sf) };
}

let updated = 0, skippedState = 0, notEligible = 0, noCar = 0, processed = 0;

for (const [typeKey, entry] of Object.entries(filters)) {
    if (processed >= LIMIT) break;
    if (entry.source === 'none' || (!entry.vf && !entry.mf && !entry.sf)) continue;
    if (applied.has(typeKey)) { skippedState++; continue; }
    const car = carByKey.get(typeKey);
    if (!car) { noCar++; continue; }
    processed++;

    const keyWhere = `lower(c.brand) = lower($1) AND lower(c.model) = lower($2)
        AND lower(coalesce(c.engine_code, '')) = lower(coalesce($3, ''))
        AND coalesce(c.engine_volume, 0) = coalesce($4::numeric, 0)
        AND c.year_from = $5`;
    const keyParams = [car.brand, car.model, car.engine_code ?? null,
                       car.engine_volume ?? null, car.year_from];

    if (DRY_RUN) {
        const r = await query(
            `SELECT 1 FROM cars c WHERE ${keyWhere} AND ${EMPTY_FPN}`, keyParams);
        if (r.rows.length) updated++; else notEligible++;
        continue;
    }

    const fpn = JSON.stringify(buildFpn(entry));
    const comment = `фильтры подобраны автоматически (${entry.source === 'mann' ? 'MANN-FILTER' : entry.source})`;

    let sql = `WITH old AS (
            SELECT c.id, c.filter_part_numbers FROM cars c
            WHERE ${keyWhere} AND ${EMPTY_FPN}
        ),
        upd AS (
            UPDATE cars SET filter_part_numbers = $6::jsonb, updated_at = now()
            WHERE id IN (SELECT id FROM old)
            RETURNING id
        )`;
    const params = [...keyParams, fpn];

    if (importUser) {
        sql += `
        INSERT INTO car_events (car_id, user_id, type, comment, changed_fields)
        SELECT o.id, $7, 'edited', $8,
               jsonb_build_object('filter_part_numbers',
                   jsonb_build_object('from', o.filter_part_numbers, 'to', $6::jsonb))
        FROM old o
        RETURNING car_id AS id`;
        params.push(importUser.id, comment);
    } else {
        sql += ` SELECT id FROM upd`;
    }

    const r = await query(sql, params);
    if (r.rows.length) {
        updated++;
        const label = `${car.brand} ${car.model} ${car.engine_code || ''} ${car.year_from}`.replace(/\s+/g, ' ');
        console.log(`  ✓ ${label}: vf=${entry.vf || '—'} mf=${entry.mf || '—'} sf=${entry.sf || '—'}`);
        // В стейт — только успешные: «не подошло» может значить «машина ещё
        // не залита» (дольётся следующим циклом конвейера) — не хороним её.
        applied.add(typeKey);
        writeJson(STATE_FILE, [...applied]);
    } else {
        notEligible++; // машины нет в базе или фильтры уже заполнены
    }
}

console.log(`${DRY_RUN ? '[dry-run] ' : ''}Фильтры:`);
console.log(`  ${DRY_RUN ? 'будет обновлено' : 'обновлено'}: ${updated}`);
console.log(`  не подошло (нет в базе / фильтры уже заполнены): ${notEligible}`);
if (skippedState) console.log(`  пропущено по стейту: ${skippedState}`);
if (noCar) console.log(`  нет машины в JSON: ${noCar}`);
process.exit(0);
