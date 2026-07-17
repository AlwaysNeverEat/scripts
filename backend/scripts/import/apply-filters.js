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
import { completePower } from './power.js';
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
const CARS_FILE = path.resolve(ROOT, argValue('--cars', 'data/import/cars-enriched.json'));
const STATE_FILE = path.resolve(ROOT, argValue('--state', 'data/import/.filters-applied.json'));

const COLOR_ENABLED = !process.env.NO_COLOR && process.env.IMPORT_COLOR !== '0';
const ansi = (code, text) => COLOR_ENABLED ? `\x1b[${code}m${text}\x1b[0m` : String(text);
const color = {
    ok: (s) => ansi(32, s),
    brand: (s) => ansi(36, s),
    model: (s) => ansi(35, s),
    engine: (s) => ansi(33, s),
    year: (s) => ansi(90, s),
    filters: (s) => ansi(92, s),
    power: (s) => ansi(94, s),
    link: (s) => ansi(96, s),
};

function formatCarLabel(car) {
    return [
        color.brand(car.brand),
        color.model(car.model),
        car.engine_code ? color.engine(car.engine_code) : '',
        car.year_from ? color.year(car.year_from) : '',
    ].filter(Boolean).join(' ');
}

function formatChangeSummary(changes, entry) {
    return [
        changes.filter_part_numbers ? color.filters(`vf=${entry.vf || '—'} mf=${entry.mf || '—'} sf=${entry.sf || '—'}`) : '',
        changes.kw ? color.power(`kw=${entry.kw}`) : '',
        changes.bhp ? color.power(`bhp=${entry.bhp}`) : '',
        changes.source_links ? color.link('+mann-link') : '',
    ].filter(Boolean).join(' ');
}

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

// Ключ машины как в уникальном индексе БД.
const carDbKey = (b, m, c, v, y) =>
    `${String(b).toLowerCase()}|${String(m).toLowerCase()}|${String(c || '').toLowerCase()}|${Number(v ?? 0).toFixed(1)}|${y}`;

// Одним запросом — текущее состояние всех машин (id + поля, которые можем
// менять). Иначе на свежей машине это тысячи отдельных SELECT'ов. Дальше
// база трогается только для реальных апдейтов.
const dbRows = new Map();
{
    const r = await query(
        `SELECT lower(brand)||'|'||lower(model)||'|'||lower(coalesce(engine_code,''))
                  ||'|'||coalesce(engine_volume,0)::numeric(6,1)::text||'|'||year_from::text AS k,
                id, filter_part_numbers, kw, bhp, source_links
         FROM cars`);
    for (const row of r.rows) dbRows.set(row.k, row);
    console.log(`в базе ${dbRows.size} машин — SELECT на каждую больше не нужен`);
}

function buildFpn(entry) {
    const mk = (part) => part
        ? { part, absent: false }
        : { part: null, absent: false };
    return { vf: mk(entry.vf), mf: mk(entry.mf), sf: mk(entry.sf) };
}

// Пустые фильтры? ({} или объект без единого part/absent:true)
function fpnIsEmpty(fpn) {
    if (!fpn || typeof fpn !== 'object') return true;
    return !Object.values(fpn).some(v =>
        v && ((v.part && String(v.part).trim()) || v.absent === true));
}

let updated = 0, skippedState = 0, notEligible = 0, noCar = 0, processed = 0;

for (const [typeKey, entry] of Object.entries(filters)) {
    if (processed >= LIMIT) break;
    if (entry.source === 'none') continue;
    const hasParts = entry.vf || entry.mf || entry.sf;
    const hasPower = entry.kw || entry.bhp;
    if (!hasParts && !hasPower && !entry.mann_link) continue;
    if (applied.has(typeKey)) { skippedState++; continue; }
    const car = carByKey.get(typeKey);
    if (!car) { noCar++; continue; }
    processed++;

    // Текущее состояние машины — из массового префетча (без запроса к БД).
    // Изменения считаем в JS, чтобы событие edited содержало ровно то, что
    // реально поменялось.
    const row = dbRows.get(carDbKey(car.brand, car.model, car.engine_code, car.engine_volume, car.year_from));
    if (!row) { notEligible++; continue; }

    const changes = {};   // field → { from, to } (формат diffChangedFields)
    const sets = [];
    const params = [];
    const p = (v) => { params.push(v); return '$' + params.length; };

    if (hasParts && fpnIsEmpty(row.filter_part_numbers)) {
        const newFpn = buildFpn(entry);
        changes.filter_part_numbers = { from: row.filter_part_numbers, to: newFpn };
        sets.push(`filter_part_numbers = ${p(JSON.stringify(newFpn))}::jsonb`);
    }
    // ЛС/кВт доливаем ТОЛЬКО в пустые поля — заполненное не трогаем. Пару
    // kw↔bhp дополняем пересчётом из значения источника или уже имеющегося.
    const effKw = row.kw != null ? row.kw : entry.kw;
    const effBhp = row.bhp != null ? row.bhp : entry.bhp;
    const fullPower = completePower(effKw, effBhp);
    if (fullPower.kw != null && row.kw == null) {
        changes.kw = { from: null, to: fullPower.kw };
        sets.push(`kw = ${p(fullPower.kw)}`);
    }
    if (fullPower.bhp != null && row.bhp == null) {
        changes.bhp = { from: null, to: fullPower.bhp };
        sets.push(`bhp = ${p(fullPower.bhp)}`);
    }
    // Ссылка на страницу машины в каталоге Mann — только если её ещё нет
    // (существующие ссылки не трогаем); source_keys пересчитываем той же
    // функцией, что использует сайт.
    const oldLinks = row.source_links || {};
    if (entry.mann_link && !oldLinks.mann) {
        const newLinks = cleanSourceLinks({ ...oldLinks, mann: entry.mann_link });
        changes.source_links = { from: oldLinks, to: newLinks };
        sets.push(`source_links = ${p(JSON.stringify(newLinks))}::jsonb`);
        sets.push(`source_keys = ${p(JSON.stringify(buildSourceKeys(newLinks)))}::jsonb`);
    }

    if (!sets.length) {
        // Нечего менять — машина полностью укомплектована, фиксируем в стейте
        // (запись на диск — один раз в конце, не на каждую машину).
        applied.add(typeKey);
        notEligible++;
        continue;
    }

    if (DRY_RUN) { updated++; continue; }

    let sql = `WITH upd AS (
            UPDATE cars SET ${sets.join(', ')}, updated_at = now()
            WHERE id = ${p(row.id)}
            RETURNING id
        )`;
    if (importUser) {
        const comment = changes.filter_part_numbers
            ? `фильтры подобраны автоматически (${entry.source === 'mann' ? 'MANN-FILTER' : entry.source})`
            : 'мощность дозаписана автоматически (MANN-FILTER)';
        sql += `
        INSERT INTO car_events (car_id, user_id, type, comment, changed_fields)
        SELECT id, ${p(importUser.id)}, 'edited', ${p(comment)}, ${p(JSON.stringify(changes))}::jsonb
        FROM upd
        RETURNING car_id AS id`;
    } else {
        sql += ` SELECT id FROM upd`;
    }

    const r = await query(sql, params);
    if (r.rows.length) {
        updated++;
        const what = formatChangeSummary(changes, entry);
        console.log(`  ${color.ok('✓')} ${formatCarLabel(car)}: ${what}`);
        applied.add(typeKey);
    } else {
        notEligible++;
    }
}

// Стейт на диск — один раз в конце (не тысячи записей в цикле).
if (!DRY_RUN) writeJson(STATE_FILE, [...applied]);

console.log(`${DRY_RUN ? '[dry-run] ' : ''}Фильтры/мощность:`);
console.log(`  ${DRY_RUN ? 'будет обновлено' : 'обновлено'}: ${updated}`);
console.log(`  без изменений (нет в базе / уже заполнено): ${notEligible}`);
if (skippedState) console.log(`  пропущено по стейту: ${skippedState}`);
if (noCar) console.log(`  нет машины в JSON: ${noCar}`);
process.exit(0);
