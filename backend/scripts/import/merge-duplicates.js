#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Склейка дублей марок и моделей в БД по правилам shared/carCanon.js:
//   • «GWM HAVAL» / «Haval» / «HAVAL» → «Haval», «VW» → «Volkswagen»,
//     «LADA / AVTOVAZ» → «Lada» (таблица BRAND_CANON);
//   • марки, различающиеся только регистром (не из таблицы), приводятся к
//     самому частому написанию;
//   • Ford «Focus Mk II» → «Focus» + поколение «2 (C307)» (и остальные Mk).
//
// Если после переименования две записи совпали по уникальному ключу
// (brand, model, engine_code, engine_volume, year_from) — это один и тот же
// автомобиль, записи объединяются:
//   • выживает ручная запись (без метки «⚠ Импортировано» в notes), при
//     нескольких — самая старая; ЗАПОЛНЕННЫЕ ПОЛЯ ВЫЖИВШЕЙ НЕ ТРОГАЮТСЯ,
//     из дублей доливается только пустое (объёмы по агрегатам, фильтры,
//     мощность, годы) + объединяются допуски/теги/ссылки;
//   • car_events дублей переносятся на выжившую запись (история и авторство
//     не теряются), сами дубли удаляются;
//   • на выжившую пишется событие 'edited' с комментарием о склейке.
// Поисковые поля (name_normalized/…/search_vector) пересобираются как в
// backend/src/routes/cars.js — с учётом тегов.
//
// Запуск:  node scripts/import/merge-duplicates.js --dry-run   # посмотреть план
//          node scripts/import/merge-duplicates.js             # применить
// Доступ к БД: DATABASE_URL либо SUPABASE_ACCESS_TOKEN+SUPABASE_PROJECT_REF
// (как у остальных скриптов импорта). Скрипт идемпотентен — повторный запуск
// найдёт «нечего склеивать».
// ─────────────────────────────────────────────────────────────────────────────

import { buildNameFields, normalize, expandQuery } from '../../../shared/translit.js';
import { canonCar, canonicalBrand } from '../../../shared/carCanon.js';
import { makeQuery, sqlLiteral } from './db.js';
import { c, color, mark } from './log.js';

const DRY = process.argv.includes('--dry-run');
const query = await makeQuery();

const lit = sqlLiteral;
const jlit = (v) => `${lit(JSON.stringify(v ?? null))}::jsonb`;

// Ключ уникального индекса idx_cars_upsert_key — ровно как в БД.
const carKeyOf = (c) =>
    `${String(c.brand).toLowerCase()}|${String(c.model).toLowerCase()}|${String(c.engine_code || '').toLowerCase()}|${Number(c.engine_volume ?? 0).toFixed(1)}|${c.year_from}`;

const labelOf = (c) => [c.brand, c.model, c.generation, c.engine_code,
    c.engine_volume, c.year_from].filter(x => x != null && x !== '').join(' ');

// ── 1. Все написания марок: ищем группы-двойники ─────────────────────────────
// normalize() в SQL — то же, что shared/translit.js: нижний регистр, вся
// пунктуация → пробел, схлопнуть пробелы. По этому ключу марки группируются
// и матчатся с алиасами BRAND_CANON.
const NORM_SQL = `trim(regexp_replace(lower(brand), '[^a-zа-яё0-9]+', ' ', 'g'))`;

const brandRows = (await query(
    `SELECT brand, ${NORM_SQL} AS norm, count(*)::int AS n FROM cars GROUP BY brand`)).rows;

// Группируем написания по каноническому ключу (алиасы BRAND_CANON склеивают
// «vw» с «volkswagen» и т.п.).
const groups = new Map();  // canonKey → { spellings: Map(raw → n), canonical|null }
for (const row of brandRows) {
    const canonical = canonicalBrand(row.brand);
    const key = canonical ? normalize(canonical) : row.norm;
    if (!groups.has(key)) groups.set(key, { spellings: new Map(), canonical: null });
    const g = groups.get(key);
    g.spellings.set(row.brand, Number(row.n));
    if (canonical) g.canonical = canonical;
}

// Марку трогаем только если у неё РЕАЛЬНО несколько написаний (или алиас из
// таблицы): одинокое «MERCEDES-BENZ» не переименовываем ради красоты.
const brandTarget = new Map();  // raw spelling → каноническое написание
for (const g of groups.values()) {
    const spellings = [...g.spellings.keys()];
    const aliasRename = g.canonical && spellings.some(s => s !== g.canonical);
    if (spellings.length < 2 && !aliasRename) continue;
    const target = g.canonical
        // без правила в таблице — самое частое написание (при равенстве — первое по алфавиту)
        || [...g.spellings.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
    for (const raw of spellings) {
        if (raw !== target) brandTarget.set(raw, target);
    }
}

if (brandTarget.size) {
    console.log('Марки к переименованию:');
    for (const [raw, target] of [...brandTarget].sort()) {
        console.log(`  ${color.brand(raw)} → ${color.ok(target)}`);
    }
} else {
    console.log('Дублей в написании марок не нашлось.');
}

// ── 2. Кандидаты: лёгкие identity-поля затронутых марок ──────────────────────
// Берём не только переименовываемые написания, но и все их группы целиком
// (для поиска коллизий: «VW Golf» может совпасть с «Volkswagen Golf»),
// плюс весь Ford — там переименовываются модели «… Mk N».
const affectedNorms = new Set(['ford']);
for (const [raw] of brandTarget) {
    const canonical = canonicalBrand(raw);
    affectedNorms.add(canonical ? normalize(canonical) : normalize(raw));
}
for (const g of groups.values()) {
    for (const raw of g.spellings.keys()) {
        if (brandTarget.has(raw)) {
            for (const s of g.spellings.keys()) affectedNorms.add(normalize(s));
        }
    }
}
// алиасы канонических групп: «vw» должен найтись, даже если канон — «volkswagen»
for (const key of [...affectedNorms]) {
    const canonical = canonicalBrand(key);
    if (canonical) affectedNorms.add(normalize(canonical));
}

const inList = [...affectedNorms].map(lit).join(', ');
const candidates = (await query(
    `SELECT id, brand, model, generation, engine_code, engine_volume,
            year_from, year_to, tags, created_by, created_at,
            (notes LIKE '⚠ Импортировано%') AS is_import
     FROM cars
     WHERE ${NORM_SQL} IN (${inList})`)).rows;
for (const c of candidates) {
    c.is_import = c.is_import === true || c.is_import === 't';
    if (c.engine_volume != null) c.engine_volume = Number(c.engine_volume);
}
console.log(`затронутых марок: ${affectedNorms.size}, записей-кандидатов: ${candidates.length}`);

// ── 3. План: новая идентичность каждой записи, группировка по ключу ──────────
for (const c of candidates) {
    const canon = canonCar(c);
    const targetBrand = brandTarget.get(c.brand) || canon.brand;
    c.next = { brand: targetBrand, model: canon.model, generation: canon.generation };
    c.changed = c.next.brand !== c.brand || c.next.model !== c.model
        || (c.next.generation ?? null) !== (c.generation ?? null);
}

const byKey = new Map();
for (const c of candidates) {
    const key = carKeyOf({ ...c, brand: c.next.brand, model: c.next.model });
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(c);
}

const renames = [];  // одиночные записи с изменённой идентичностью
const merges = [];   // группы-дубли: { survivor, losers }
for (const rows of byKey.values()) {
    if (rows.length === 1) {
        if (rows[0].changed) renames.push(rows[0]);
        continue;
    }
    // Дубли одного автомобиля: выживает ручная запись, при нескольких — старейшая.
    const sorted = rows.slice().sort((a, b) =>
        (a.is_import - b.is_import) || (new Date(a.created_at) - new Date(b.created_at)));
    merges.push({ survivor: sorted[0], losers: sorted.slice(1) });
}

console.log(`\nПлан: переименований=${c.count(String(renames.length))}, `
    + `склеек=${c.count(String(merges.length))} `
    + `(удалится дублей: ${color.warn(String(merges.reduce((s, m) => s + m.losers.length, 0)))})`);

for (const r of renames.slice(0, 200)) {
    console.log(`  переименование: ${labelOf(r)} → ${color.ok(labelOf({ ...r, ...r.next }))}`
        + (r.is_import ? '' : color.warn('  [ручная запись]')));
}
if (renames.length > 200) console.log(`  … и ещё ${renames.length - 200}`);
for (const m of merges) {
    console.log(`  склейка → ${color.ok(labelOf({ ...m.survivor, ...m.survivor.next }))}`);
    console.log(`      выживает: ${labelOf(m.survivor)} (${m.survivor.is_import ? 'импорт' : color.warn('ручная')}, ${m.survivor.created_by || '—'})`);
    for (const l of m.losers) {
        console.log(`      удаляется: ${labelOf(l)} (${l.is_import ? 'импорт' : color.warn('ручная')}, ${l.created_by || '—'})`);
    }
}

if (!renames.length && !merges.length) {
    console.log(`${mark.ok} нечего склеивать — база уже чистая`);
    process.exit(0);
}
if (DRY) {
    console.log('\n[dry-run] ничего не меняю');
    process.exit(0);
}

// ── 4. Пересборка поисковых полей — как upsertSearchFields в routes/cars.js ──
function searchFieldsSql(row) {
    const { nameNormalized, nameCyrillic, nameTranslit, synonymTokens } = buildNameFields(
        row.brand, row.model, row.generation, row.engine_code,
        row.engine_volume, row.year_from, row.year_to);
    const tagList = Array.isArray(row.tags) ? row.tags.map(t => normalize(t)).filter(Boolean) : [];
    const tagTokens = tagList.flatMap(t => expandQuery(t));
    const nameWithTags = tagList.length ? `${nameNormalized} ${tagList.join(' ')}` : nameNormalized;
    const svTokens = [...synonymTokens, ...tagTokens]
        .flatMap(s => s.split(/\s+/)).filter(Boolean).join(' ');
    return `name_normalized = ${lit(nameWithTags)},
            name_cyrillic   = ${lit(nameCyrillic)},
            name_translit   = ${lit(nameTranslit)},
            search_vector   = to_tsvector('simple', ${lit(svTokens)})`;
}

// ── 5. Переименования ────────────────────────────────────────────────────────
let renamed = 0, mergedGroups = 0, deleted = 0, failed = 0;
for (const r of renames) {
    const next = { ...r, ...r.next };
    let sql = `UPDATE cars SET
            brand = ${lit(next.brand)}, model = ${lit(next.model)},
            generation = ${lit(next.generation ?? null)},
            ${searchFieldsSql(next)}, updated_at = now()
        WHERE id = ${lit(r.id)};`;
    if (!r.is_import) {
        // Ручная запись — оставляем след в фиде событий машины.
        const changed = {};
        if (next.brand !== r.brand) changed.brand = { from: r.brand, to: next.brand };
        if (next.model !== r.model) changed.model = { from: r.model, to: next.model };
        if ((next.generation ?? null) !== (r.generation ?? null))
            changed.generation = { from: r.generation ?? null, to: next.generation ?? null };
        sql += `\nINSERT INTO car_events (car_id, user_id, type, comment, changed_fields)
            VALUES (${lit(r.id)}, NULL, 'edited',
                    'приведено к каноническому написанию (склейка дублей марок/моделей)',
                    ${jlit(changed)});`;
    }
    try {
        await query(sql);
        renamed++;
    } catch (error) {
        failed++;
        console.error(`  ${color.err('⚠')} ${labelOf(r)}: ${error.message}`);
    }
}

// ── 6. Склейки ───────────────────────────────────────────────────────────────
// Полные строки участников — только теперь, их немного.
const mergeIds = merges.flatMap(m => [m.survivor.id, ...m.losers.map(l => l.id)]);
const fullRows = new Map();
if (mergeIds.length) {
    const r = await query(
        `SELECT * FROM cars WHERE id IN (${mergeIds.map(lit).join(', ')})`);
    for (const row of r.rows) fullRows.set(String(row.id), row);
}

const isEmptyObj = (o) => !o || typeof o !== 'object' || !Object.keys(o).length;
const slotFilled = (s) => Boolean(s && ((s.part && String(s.part).trim()) || s.absent === true));
const fluidFilled = (a) => a && (a.volumeTotal || a.volumeService || a.volumePlain || a.volume
    || (Array.isArray(a.motulProducts) && a.motulProducts.length));

for (const m of merges) {
    const surv = fullRows.get(String(m.survivor.id));
    const losers = m.losers.map(l => fullRows.get(String(l.id))).filter(Boolean);
    if (!surv || losers.length !== m.losers.length) {
        failed++;
        console.error(`  ${color.err('⚠')} склейка ${labelOf(m.survivor)}: записи не дочитались из БД`);
        continue;
    }

    // Итоговая запись: идентичность каноническая, поля выжившей — приоритетны,
    // из дублей доливается только пустое.
    const next = { ...surv, ...m.survivor.next };
    if (!String(next.generation ?? '').trim()) {
        next.generation = losers.map(l => canonCar(l).generation).find(g => String(g ?? '').trim()) ?? next.generation;
    }
    const conflicts = [];
    for (const f of ['year_to', 'kw', 'bhp', 'fuel_type', 'motul_name', 'engine_name', 'notes']) {
        for (const l of losers) {
            if (l[f] == null || l[f] === '') continue;
            if (next[f] == null || next[f] === '') next[f] = l[f];
            else if (String(next[f]) !== String(l[f])) conflicts.push(f);
        }
    }
    // Объёмы по агрегатам: недостающие/пустые агрегаты — из дублей.
    next.fluid_capacities = { ...(surv.fluid_capacities || {}) };
    for (const l of losers) {
        for (const [agg, val] of Object.entries(l.fluid_capacities || {})) {
            if (!fluidFilled(next.fluid_capacities[agg]) && fluidFilled(val)) next.fluid_capacities[agg] = val;
            else if (fluidFilled(next.fluid_capacities[agg]) && fluidFilled(val)) conflicts.push(`fluid_capacities.${agg}`);
        }
    }
    // Фильтры: послотово (vf/mf/sf), заполненное у выжившей неприкосновенно.
    next.filter_part_numbers = { ...(surv.filter_part_numbers || {}) };
    for (const l of losers) {
        for (const slot of ['vf', 'mf', 'sf']) {
            const cur = next.filter_part_numbers[slot];
            const other = (l.filter_part_numbers || {})[slot];
            if (!slotFilled(cur) && slotFilled(other)) next.filter_part_numbers[slot] = other;
        }
    }
    // Допуски и теги — объединение без дублей; ссылки — выжившая поверх дублей.
    const approvals = new Set((surv.car_approvals || []).map(String));
    next.car_approvals = [...(surv.car_approvals || [])];
    const tags = new Set((surv.tags || []).map(t => normalize(t)));
    next.tags = [...(surv.tags || [])];
    let links = {};
    const sourceKeys = new Set(surv.source_keys || []);
    for (const l of losers) {
        for (const a of l.car_approvals || []) if (!approvals.has(String(a))) { approvals.add(String(a)); next.car_approvals.push(a); }
        for (const t of l.tags || []) if (!tags.has(normalize(t))) { tags.add(normalize(t)); next.tags.push(t); }
        links = { ...links, ...(l.source_links || {}) };
        for (const k of l.source_keys || []) sourceKeys.add(k);
    }
    next.source_links = { ...links, ...(surv.source_links || {}) };
    next.source_keys = [...sourceKeys];
    for (const f of ['recommended_oils', 'service_flags', 'oil_overrides']) {
        if ((Array.isArray(next[f]) ? !next[f].length : isEmptyObj(next[f]))) {
            next[f] = losers.map(l => l[f]).find(v => (Array.isArray(v) ? v.length : !isEmptyObj(v))) ?? next[f];
        }
    }

    const comment = `склеены дубли: ${losers.map(labelOf).join('; ')}`
        + (conflicts.length ? ` (расхождения, оставлены значения этой записи: ${[...new Set(conflicts)].join(', ')})` : '');
    const changed = {};
    for (const f of ['brand', 'model', 'generation']) {
        if ((next[f] ?? null) !== (surv[f] ?? null)) changed[f] = { from: surv[f] ?? null, to: next[f] ?? null };
    }

    const loserIds = losers.map(l => lit(l.id)).join(', ');
    const sql = `
        UPDATE car_events SET car_id = ${lit(surv.id)} WHERE car_id IN (${loserIds});
        DELETE FROM cars WHERE id IN (${loserIds});
        UPDATE cars SET
            brand = ${lit(next.brand)}, model = ${lit(next.model)},
            generation = ${lit(next.generation ?? null)},
            year_to = ${lit(next.year_to ?? null)}, kw = ${lit(next.kw ?? null)},
            bhp = ${lit(next.bhp ?? null)}, fuel_type = ${lit(next.fuel_type ?? null)},
            motul_name = ${lit(next.motul_name ?? null)}, engine_name = ${lit(next.engine_name ?? null)},
            notes = ${lit(next.notes ?? null)},
            fluid_capacities = ${jlit(next.fluid_capacities)},
            filter_part_numbers = ${jlit(next.filter_part_numbers)},
            car_approvals = ${jlit(next.car_approvals)},
            recommended_oils = ${jlit(next.recommended_oils ?? [])},
            service_flags = ${jlit(next.service_flags ?? {})},
            oil_overrides = ${jlit(next.oil_overrides ?? {})},
            source_links = ${jlit(next.source_links)},
            source_keys = ${jlit(next.source_keys)},
            tags = ${jlit(next.tags)},
            ${searchFieldsSql(next)}, updated_at = now()
        WHERE id = ${lit(surv.id)};
        INSERT INTO car_events (car_id, user_id, type, comment, changed_fields)
        VALUES (${lit(surv.id)}, NULL, 'edited', ${lit(comment)}, ${jlit(changed)});`;

    try {
        await query(sql);
        mergedGroups++;
        deleted += losers.length;
        console.log(`  ${mark.ok} склеено: ${labelOf(next)} (удалено дублей: ${losers.length})`
            + (conflicts.length ? color.warn(` расхождения: ${[...new Set(conflicts)].join(', ')}`) : ''));
    } catch (error) {
        failed++;
        console.error(`  ${color.err('⚠')} склейка ${labelOf(m.survivor)}: ${error.message}`);
    }
}

// ── 7. Итог и контрольный срез ───────────────────────────────────────────────
console.log(`\nГотово: переименовано=${color.ok(String(renamed))}, `
    + `склеено групп=${color.ok(String(mergedGroups))}, удалено дублей=${deleted}, `
    + `ошибок=${failed ? color.err(String(failed)) : '0'}`);

const brandsAfter = (await query(
    `SELECT brand, count(*)::int AS n FROM cars
     WHERE ${NORM_SQL} IN (${inList}) GROUP BY brand ORDER BY brand`)).rows;
console.log('\nКонтроль — затронутые марки теперь:');
for (const b of brandsAfter) console.log(`  ${color.brand(b.brand)}: ${b.n}`);

const focus = (await query(
    `SELECT model, coalesce(generation, '—') AS generation, count(*)::int AS n
     FROM cars WHERE lower(brand) = 'ford' AND lower(model) LIKE 'focus%'
     GROUP BY model, generation ORDER BY model, generation`)).rows;
if (focus.length) {
    console.log('Контроль — Ford Focus:');
    for (const f of focus) console.log(`  ${color.model(f.model)} / ${f.generation}: ${f.n}`);
}
process.exit(failed ? 2 : 0);
