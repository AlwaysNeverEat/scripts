#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Заливка машин из JSON (собранного scrape-motul.js + scrape-rolf.js) в БД.
// По образцу scripts/seed.js: напрямую в Postgres, мимо API.
//
// Запуск:  DATABASE_URL=postgres://... node scripts/import/import-cars.js \
//              [data/import/motul-cars.json] [--dry-run] [--limit N] [--user login]
//
// Существующие машины не трогаем: INSERT ... ON CONFLICT DO NOTHING по
// уникальному ключу (brand, model, engine_code, engine_volume, year_from) —
// всё, что коллеги уже рассчитали руками, остаётся как есть.
// Импортированные помечаются предупреждением в notes.
//
// --user <login> — «начислить» машины на пользователя сайта: created_by =
// его display_name + событие 'added' в car_events (это источник правды для
// топа и ачивок). Без --user пишется created_by='import' и событий нет.
//
// Доступ к БД:
//   1) DATABASE_URL — обычное pg-подключение (как seed.js);
//   2) SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF — тот же SQL через
//      HTTPS Management API Supabase (когда прямой Postgres недоступен,
//      например из окружений без сырого TCP).
// ─────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNameFields } from '../../../shared/translit.js';
import { buildSourceKeys, cleanSourceLinks } from '../../../shared/sourceLinks.js';
import { readJson, writeJson } from './http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || Infinity : Infinity;
const userIdx = args.indexOf('--user');
const USER_LOGIN = userIdx >= 0 ? args[userIdx + 1] : null;
// --state <файл>: локальный список уже залитых _type_key — при повторных
// прогонах (цикл доливки) такие машины пропускаются без запросов к БД.
const stateIdx = args.indexOf('--state');
const STATE_FILE = stateIdx >= 0 ? path.resolve(ROOT, args[stateIdx + 1]) : null;
// Позиционный аргумент = файл. Индексы значений флагов исключаем только
// если флаг реально передан (иначе idx+1 === 0 «съедал» сам путь к файлу,
// и импортёр молча брал дефолтный файл).
const flagValueIdx = new Set(
    [limitIdx, userIdx, stateIdx].filter(i => i >= 0).map(i => i + 1));
const fileArg = args.find((a, i) => !a.startsWith('--') && !flagValueIdx.has(i));
const IN_FILE = path.resolve(ROOT, fileArg || 'data/import/motul-cars.json');

// ── Доступ к БД: pg напрямую или SQL через Supabase Management API ──────────
const SB_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const SB_REF = process.env.SUPABASE_PROJECT_REF;

let query;
if (SB_TOKEN && SB_REF) {
    query = supabaseHttpQuery;
    console.log(`БД: Supabase Management API (проект ${SB_REF})`);
} else {
    ({ query } = await import('../../src/db/client.js'));
}

// Литерал для подстановки параметра в SQL (Management API не принимает
// параметризованные запросы). standard_conforming_strings в Postgres включён
// по умолчанию — достаточно удвоить одинарные кавычки.
function sqlLiteral(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return `'${String(v).replace(/\0/g, '').replace(/'/g, "''")}'`;
}

async function supabaseHttpQuery(text, params = []) {
    const sql = text.replace(/\$(\d+)/g, (_, n) => sqlLiteral(params[Number(n) - 1]));
    for (let attempt = 1; ; attempt++) {
        const res = await fetch(`https://api.supabase.com/v1/projects/${SB_REF}/database/query`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${SB_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: sql }),
        });
        const body = await res.text();
        // 429/5xx — временное: ждём и повторяем (запрос идемпотентен,
        // ON CONFLICT DO NOTHING переживает повтор).
        if ((res.status === 429 || res.status >= 500) && attempt < 6) {
            const ms = 3000 * 2 ** (attempt - 1);
            console.warn(`  Supabase API ${res.status}, ретрай через ${ms / 1000}с…`);
            await new Promise(r => setTimeout(r, ms));
            continue;
        }
        if (!res.ok) throw new Error(`Supabase API HTTP ${res.status}: ${body.slice(0, 300)}`);
        let rows;
        try { rows = JSON.parse(body); } catch { rows = []; }
        return { rows: Array.isArray(rows) ? rows : [] };
    }
}

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

// ── Пользователь для начисления (--user) ────────────────────────────────────
let importUser = null;
if (USER_LOGIN) {
    const r = await query(
        'SELECT id, display_name FROM users WHERE lower(login) = lower($1)',
        [USER_LOGIN],
    );
    if (!r.rows.length) {
        console.error(`Пользователь с логином «${USER_LOGIN}» не найден`);
        process.exit(1);
    }
    importUser = r.rows[0];
    console.log(`Машины будут начислены на: ${importUser.display_name} (${USER_LOGIN})`);
}
const createdBy = importUser ? importUser.display_name : 'import';

const importedKeys = STATE_FILE ? new Set(readJson(STATE_FILE, [])) : null;

let inserted = 0, existing = 0, invalid = 0, skippedByState = 0, updatedApprovals = 0;
const invalidReport = [];

for (const car of cars.slice(0, LIMIT)) {
    if (importedKeys && car._type_key && importedKeys.has(car._type_key)) {
        skippedByState++;
        continue;
    }
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

    // Конфликт = машина уже в базе. Ручные записи не трогаем НИКОГДА;
    // единственное исключение — наша же импортированная запись без допусков,
    // которой пришли непустые допуски: дозаписываем только их (+notes).
    let sql =
        `INSERT INTO cars (brand, model, generation, engine_code, engine_volume,
                           year_from, year_to, kw, bhp, fuel_type,
                           motul_name, engine_name,
                           fluid_capacities, filter_part_numbers, car_approvals,
                           notes, source_links, source_keys,
                           name_normalized, name_cyrillic, name_translit, search_vector,
                           created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                 $19,$20,$21,to_tsvector('simple', $22),$23)
         ON CONFLICT (lower(brand), lower(model), lower(coalesce(engine_code,'')), coalesce(engine_volume,0), year_from)
         DO UPDATE SET
           car_approvals = EXCLUDED.car_approvals,
           notes         = EXCLUDED.notes,
           updated_at    = now()
         WHERE cars.notes LIKE '⚠ Импортировано%'
           AND jsonb_array_length(cars.car_approvals) = 0
           AND jsonb_array_length(EXCLUDED.car_approvals) > 0
         RETURNING id, (xmax = 0) AS inserted`;
    const params =
        [car.brand, car.model, car.generation ?? null, car.engine_code ?? null,
         car.engine_volume ?? null, car.year_from, car.year_to ?? null,
         car.kw ?? null, car.bhp ?? null, car.fuel_type ?? null,
         car.motul_name ?? null, car.engine_name ?? null,
         JSON.stringify(car.fluid_capacities), JSON.stringify({}),
         JSON.stringify(car.car_approvals || []),
         notes, JSON.stringify(sourceLinks), JSON.stringify(sourceKeys),
         nameNormalized, nameCyrillic, nameTranslit, svTokens, createdBy];

    if (importUser) {
        // Событие 'added' — по нему сайт считает топ и ачивки автора.
        // Только для настоящих вставок: дозапись допусков событий не плодит.
        sql = `WITH ins AS (${sql}),
               ev AS (INSERT INTO car_events (car_id, user_id, type)
                      SELECT id, $24, 'added' FROM ins WHERE inserted)
               SELECT id, inserted FROM ins`;
        params.push(importUser.id);
    }

    const r = await query(sql, params);
    if (!r.rows.length) existing++;
    else if (r.rows[0].inserted === true || r.rows[0].inserted === 't') inserted++;
    else updatedApprovals++;

    // В стейт — только «финально» обработанные: с допусками, либо когда
    // обогащение уже прошло и допусков точно нет (_rolf есть в записи).
    // Машины без допусков и без _rolf ждут дозаписи следующим циклом.
    const enrichedDone = (car.car_approvals && car.car_approvals.length) || car._rolf !== undefined;
    if (importedKeys && car._type_key && enrichedDone) {
        importedKeys.add(car._type_key);
        writeJson(STATE_FILE, [...importedKeys]);
    }
}

console.log(`${DRY_RUN ? '[dry-run] ' : ''}Импорт из ${path.relative(ROOT, IN_FILE)}:`);
console.log(`  ${DRY_RUN ? 'будет добавлено' : 'добавлено'}: ${inserted}`);
console.log(`  уже в базе (пропущено): ${existing}`);
console.log(`  битых записей: ${invalid}`);
if (updatedApprovals) console.log(`  дозаписаны допуски: ${updatedApprovals}`);
if (skippedByState) console.log(`  пропущено по стейту (залиты ранее): ${skippedByState}`);
if (invalidReport.length) {
    console.log('\nБитые записи:');
    for (const line of invalidReport.slice(0, 30)) console.log('  - ' + line);
    if (invalidReport.length > 30) console.log(`  … и ещё ${invalidReport.length - 30}`);
}
process.exit(0);
