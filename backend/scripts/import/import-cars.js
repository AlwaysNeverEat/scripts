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
import { canonCar } from '../../../shared/carCanon.js';
import { buildSourceKeys, cleanSourceLinks } from '../../../shared/sourceLinks.js';
import { readJson, writeJson } from './http.js';
import { makeQuery } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || Infinity : Infinity;
const progressIdx = args.indexOf('--progress-every');
const PROGRESS_EVERY = progressIdx >= 0 ? Math.max(1, parseInt(args[progressIdx + 1]) || 100) : 100;
// --allow-no-volume: не считать битой машину без объёма масла двигателя.
// Нужно для Liqui Moly: у части машин источник объём не даёт — сохраняем запись
// с пометкой service_flags.noSourceVolume вместо выбрасывания.
const ALLOW_NO_VOLUME = args.includes('--allow-no-volume');
// Кадэнс отправки в БД: после каждых --batch-size реальных записей ждём
// --batch-interval-ms. Дефолт выключен; конвейер задаёт «25 раз в 30 сек».
const batchSizeIdx = args.indexOf('--batch-size');
const BATCH_SIZE = batchSizeIdx >= 0 ? Math.max(0, parseInt(args[batchSizeIdx + 1]) || 0) : 0;
const batchIntervalIdx = args.indexOf('--batch-interval-ms');
const BATCH_INTERVAL_MS = batchIntervalIdx >= 0 ? Math.max(0, parseInt(args[batchIntervalIdx + 1]) || 0) : 30000;
const userIdx = args.indexOf('--user');
const USER_LOGIN = userIdx >= 0 ? args[userIdx + 1] : null;
// --state <файл>: локальный список уже залитых _type_key — при повторных
// прогонах (цикл доливки) такие машины пропускаются без запросов к БД.
const stateIdx = args.indexOf('--state');
const STATE_FILE = stateIdx >= 0 ? path.resolve(ROOT, args[stateIdx + 1]) : null;
// --overwrite: перезаписывать ВСЕ совпавшие строки oil/тех-данными из источника
//   (в т.ч. ручные). Бережём при этом допуски, фильтры и авторство.
// --allow-no-volume: не отбраковывать запись без объёма масла двигателя
//   (у Лукойла у части агрегатов объёма нет — импортируем с пометкой).
// --source <name>: влияет на маркер notes ('lukoil' → «(ЛУКОЙЛ)»).
// --pace-size N / --pace-pause-ms M: после каждых N записей в БД пауза M мс
//   (нужный пользователю темп «25 машин раз в 30 секунд»).
const OVERWRITE = args.includes('--overwrite');
// --overwrite-approvals: перезаписывать car_approvals на АВТО-записях (по метке
// notes '⚠ Импортировано%'), даже если допуски там уже есть. Нужно после фикса
// scrape-rolf — старую свалку из ~50 меняем на правильный набор по двигателю.
// Ручные записи (без метки) не затрагиваются.
const OVERWRITE_APPROVALS = args.includes('--overwrite-approvals');
const sourceIdx = args.indexOf('--source');
const SOURCE = sourceIdx >= 0 ? String(args[sourceIdx + 1] || '').toLowerCase() : 'motul';
const paceSizeIdx = args.indexOf('--pace-size');
const PACE_SIZE = paceSizeIdx >= 0 ? Math.max(0, parseInt(args[paceSizeIdx + 1]) || 0) : 0;
const pacePauseIdx = args.indexOf('--pace-pause-ms');
const PACE_PAUSE_MS = pacePauseIdx >= 0 ? Math.max(0, parseInt(args[pacePauseIdx + 1]) || 0) : 0;
// Единый кадэнс: --pace-size/--pace-pause-ms (ЛУКОЙЛ) и --batch-size/
// --batch-interval-ms (Liqui Moly) — синонимы; берём заданный.
const CAD_SIZE = PACE_SIZE || BATCH_SIZE;
const CAD_PAUSE = PACE_PAUSE_MS || BATCH_INTERVAL_MS;
// Позиционный аргумент = файл. Индексы значений флагов исключаем только
// если флаг реально передан (иначе idx+1 === 0 «съедал» сам путь к файлу,
// и импортёр молча брал дефолтный файл).
const flagValueIdx = new Set(
    [limitIdx, progressIdx, userIdx, stateIdx, batchSizeIdx, batchIntervalIdx, sourceIdx, paceSizeIdx, pacePauseIdx]
        .filter(i => i >= 0).map(i => i + 1));
const fileArg = args.find((a, i) => !a.startsWith('--') && !flagValueIdx.has(i));
const IN_FILE = path.resolve(ROOT, fileArg || 'data/import/motul-cars.json');

const rawQuery = await makeQuery();

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function isTransientDbError(error) {
    const message = String(error?.message || error);
    return /timeout|terminated|ECONN|ETIMEDOUT|ENET|EAI_AGAIN|429|5\d\d|rate/i.test(message);
}

async function query(text, params = [], { label = 'SQL', retries = 4 } = {}) {
    for (let attempt = 1; ; attempt++) {
        try {
            return await rawQuery(text, params);
        } catch (error) {
            if (attempt >= retries || !isTransientDbError(error)) throw error;
            const ms = Math.min(30000, 1500 * 2 ** (attempt - 1));
            console.warn(`  ${label}: ${error.message}; ретрай ${attempt}/${retries - 1} через ${Math.round(ms / 1000)}с…`);
            await sleep(ms);
        }
    }
}

// Заметка зависит от источника: ЛУКОЙЛ и Liqui Moly не дают допусков ROLF, зато
// у них бывает «источник не дал объём» — фиксируем это прямо в notes, чтобы на
// сайте было видно, почему у агрегата пусто.
function buildNotes(car) {
    const isLM = SOURCE === 'liquimoly' || (car.source_links && car.source_links.liquimoly);
    const isLukoil = SOURCE === 'lukoil';
    let notes;
    if (isLukoil) notes = '⚠ Импортировано автоматически (ЛУКОЙЛ), не проверено';
    else if (isLM) notes = '⚠ Импортировано автоматически (Liqui Moly), не проверено';
    else notes = '⚠ Импортировано автоматически (Motul + ROLF), не проверено';
    if (!isLukoil && !isLM && !(car.car_approvals && car.car_approvals.length)) {
        notes += '; допуски на ROLF не нашлись';
    }
    const noVol = car.service_flags && car.service_flags.noSourceVolume;
    if (Array.isArray(noVol) && noVol.length) notes += `; источник не дал объём: ${noVol.join(', ')}`;
    return notes;
}

const cars = readJson(IN_FILE, null);
if (!cars) {
    console.error(`Не читается ${IN_FILE} — сначала запусти scrape-motul.js`);
    process.exit(1);
}
if (!Array.isArray(cars)) {
    console.error(`${IN_FILE} должен быть JSON-массивом машин`);
    process.exit(1);
}
console.log(`прочитано ${cars.length} машин из ${path.relative(ROOT, IN_FILE)}`);

// ── Валидация записи; возвращает список проблем ─────────────────────────────
function validate(car) {
    const problems = [];
    if (!car.brand) problems.push('нет brand');
    if (!car.model) problems.push('нет model');
    if (!car.year_from) problems.push('нет year_from');
    if (!ALLOW_NO_VOLUME) {
        const e = car.fluid_capacities && car.fluid_capacities.engine;
        const vol = e && (e.volumeService || e.volumeTotal || e.volumePlain || e.volume);
        if (!vol) problems.push('нет объёма масла двигателя');
    }
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

// Ключ машины ровно как в уникальном индексе БД (для быстрого пропуска).
const carKey = (brand, model, code, vol, yf) =>
    `${String(brand).toLowerCase()}|${String(model).toLowerCase()}|${String(code || '').toLowerCase()}|${Number(vol ?? 0).toFixed(1)}|${yf}`;

// Одним запросом забираем ключи уже существующих машин (+ есть ли допуски,
// наша ли это импортная запись). Иначе на свежей машине это тысячи отдельных
// запросов к API — медленно и упирается в лимиты.
// В режиме --overwrite префетч ключей не нужен: мы апсертим каждую строку
// (в т.ч. существующие), поэтому быстрый пропуск не применяется.
let dbKeys = null;
if (!DRY_RUN && !OVERWRITE) {
    const r = await query(
        `SELECT lower(brand)||'|'||lower(model)||'|'||lower(coalesce(engine_code,''))
                  ||'|'||coalesce(engine_volume,0)::numeric(6,1)::text||'|'||year_from::text AS k,
                (jsonb_array_length(car_approvals) > 0) AS has_appr,
                (notes LIKE '⚠ Импортировано%') AS is_import
         FROM cars`);
    dbKeys = new Map(r.rows.map(x => [x.k, {
        hasAppr: x.has_appr === true || x.has_appr === 't',
        isImport: x.is_import === true || x.is_import === 't',
    }]));
    console.log(`в базе уже ${dbKeys.size} машин — трогаю только новые и недостающие`);
}

let inserted = 0, existing = 0, invalid = 0, skippedByState = 0, updatedApprovals = 0, failed = 0;
let dbWrites = 0;  // реальные записи в БД — по ним выдерживаем кадэнс
const invalidReport = [];
const failedReport = [];
const startedAt = Date.now();
const workCars = cars.slice(0, LIMIT);
const progress = (processed, force = false) => {
    if (!force && processed % PROGRESS_EVERY !== 0) return;
    const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const rate = (processed / seconds).toFixed(1);
    console.log(`  прогресс ${processed}/${workCars.length}: добавлено=${inserted}, уже=${existing}, дозаписей=${updatedApprovals}, битых=${invalid}, ошибок=${failed}, стейт=${skippedByState}, ${rate}/с`);
};

let processed = 0;
for (const rawCar of workCars) {
    processed++;
    // Каноническая идентичность (shared/carCanon.js): «GWM HAVAL» → «Haval»,
    // «VW» → «Volkswagen», Ford «Focus Mk II» → «Focus» + поколение — иначе
    // источники заново плодят дубли, склеенные merge-duplicates.js.
    const car = canonCar(rawCar);
    // Стейт-пропуск отключаем в режиме перезаписи допусков — иначе уже залитые
    // машины не получат исправленный набор.
    if (importedKeys && car._type_key && importedKeys.has(car._type_key) && !OVERWRITE_APPROVALS) {
        skippedByState++;
        progress(processed);
        continue;
    }
    const label = [car.brand, car.model, car.engine_code, car.year_from].filter(Boolean).join(' ');
    // Предохранитель: нереальный объём двигателя (>20 л) — почти всегда мусор,
    // выдранный источником из кода модели/поколения (напр. Лукойл «X290»→290.7).
    // Обнуляем, чтобы в БД не попал «290.7 л».
    if (car.engine_volume != null && Number(car.engine_volume) > 20) car.engine_volume = null;
    const problems = validate(car);
    if (problems.length) {
        invalid++;
        invalidReport.push(`${label || '(пустая запись)'}: ${problems.join(', ')}`);
        progress(processed);
        continue;
    }

    // Быстрый пропуск без запроса к БД: машина уже есть и ей ничего не нужно
    // (либо допуски уже есть, либо у нас их нет). Дозапись допусков нужна
    // только нашей импортной записи без допусков, когда у нас они появились.
    if (dbKeys) {
        const ex = dbKeys.get(carKey(car.brand, car.model, car.engine_code, car.engine_volume, car.year_from));
        if (ex) {
            // В обычном режиме дозаписываем допуски только импортной записи без
            // них; в режиме --overwrite-approvals — любой импортной записи с
            // новыми допусками (перезаписываем старую свалку). Ручные не трогаем.
            const needsBackfill = ex.isImport && car.car_approvals && car.car_approvals.length > 0
                && (!ex.hasAppr || OVERWRITE_APPROVALS);
            if (!needsBackfill) {
                existing++;
                if (importedKeys && car._type_key
                    && ((car.car_approvals && car.car_approvals.length) || car._rolf !== undefined)) {
                    importedKeys.add(car._type_key);
                }
                progress(processed);
                continue;
            }
        }
    }

    const notes = buildNotes(car);

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
        progress(processed);
        continue;
    }

    const { nameNormalized, nameCyrillic, nameTranslit, synonymTokens } = buildNameFields(
        car.brand, car.model, car.generation, car.engine_code,
        car.engine_volume, car.year_from, car.year_to);
    const svTokens = synonymTokens.flatMap(s => s.split(/\s+/)).filter(Boolean).join(' ');

    // Конфликт = машина уже в базе.
    //   • обычный режим: ручные записи не трогаем НИКОГДА; единственное
    //     исключение — наша же импортная запись без допусков, которой пришли
    //     непустые допуски (дозаписываем только их + notes);
    //   • --overwrite: перезаписываем oil/тех-поля на ВСЕХ совпавших строках
    //     (в т.ч. ручных), но БЕРЕЖЁМ допуски, фильтры и авторство — их источник
    //     не поставляет (иначе стёрли бы результат обогащения ROLF/MANN).
    const insertCols =
        `INSERT INTO cars (brand, model, generation, engine_code, engine_volume,
                           year_from, year_to, kw, bhp, fuel_type,
                           motul_name, engine_name,
                           fluid_capacities, filter_part_numbers, car_approvals,
                           notes, source_links, source_keys,
                           name_normalized, name_cyrillic, name_translit, search_vector,
                           created_by, service_flags)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                 $19,$20,$21,to_tsvector('simple', $22),$23,$24)`;

    let sql = OVERWRITE
        ? `${insertCols}
         ON CONFLICT (lower(brand), lower(model), lower(coalesce(engine_code,'')), coalesce(engine_volume,0), year_from)
         DO UPDATE SET
           generation      = EXCLUDED.generation,
           engine_name     = EXCLUDED.engine_name,
           kw              = EXCLUDED.kw,
           bhp             = EXCLUDED.bhp,
           fuel_type       = EXCLUDED.fuel_type,
           motul_name      = EXCLUDED.motul_name,
           fluid_capacities = EXCLUDED.fluid_capacities,
           notes           = EXCLUDED.notes,
           source_links    = COALESCE(cars.source_links, '{}'::jsonb) || EXCLUDED.source_links,
           source_keys     = (SELECT COALESCE(jsonb_agg(DISTINCT e), '[]'::jsonb)
                              FROM jsonb_array_elements(
                                     COALESCE(cars.source_keys, '[]'::jsonb)
                                     || COALESCE(EXCLUDED.source_keys, '[]'::jsonb)) e),
           name_normalized = EXCLUDED.name_normalized,
           name_cyrillic   = EXCLUDED.name_cyrillic,
           name_translit   = EXCLUDED.name_translit,
           search_vector   = EXCLUDED.search_vector,
           updated_at      = now()
         RETURNING id, (xmax = 0) AS inserted`
        : `${insertCols}
         ON CONFLICT (lower(brand), lower(model), lower(coalesce(engine_code,'')), coalesce(engine_volume,0), year_from)
         DO UPDATE SET
           car_approvals = EXCLUDED.car_approvals,
           notes         = EXCLUDED.notes,
           updated_at    = now()
         WHERE cars.notes LIKE '⚠ Импортировано%'
           ${OVERWRITE_APPROVALS ? '' : 'AND jsonb_array_length(cars.car_approvals) = 0'}
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
         nameNormalized, nameCyrillic, nameTranslit, svTokens, createdBy,
         JSON.stringify(car.service_flags || {})];

    if (importUser) {
        // Событие 'added' — по нему сайт считает топ и ачивки автора.
        // Только для настоящих вставок: дозапись допусков событий не плодит.
        sql = `WITH ins AS (${sql}),
               ev AS (INSERT INTO car_events (car_id, user_id, type)
                      SELECT id, $25, 'added' FROM ins WHERE inserted)
               SELECT id, inserted FROM ins`;
        params.push(importUser.id);
    }

    let wrote = false;
    try {
        const r = await query(sql, params, { label });
        if (!r.rows.length) existing++;
        else if (r.rows[0].inserted === true || r.rows[0].inserted === 't') { inserted++; wrote = true; }
        else { updatedApprovals++; wrote = true; }
    } catch (error) {
        failed++;
        failedReport.push(`${label || '(пустая запись)'}: ${error.message}`);
        console.error(`  ошибка записи: ${label || '(пустая запись)'} — ${error.message}`);
        progress(processed, true);
        continue;
    }

    // Кадэнс «N записей → пауза M мс» после каждой фактической записи в БД.
    // CAD_* объединяет --pace-* (ЛУКОЙЛ) и --batch-* (Liqui Moly).
    if (wrote && CAD_SIZE && CAD_PAUSE) {
        dbWrites++;
        if (dbWrites % CAD_SIZE === 0) {
            console.log(`  ⏳ записано ${dbWrites}; пауза ${Math.round(CAD_PAUSE / 1000)}с (темп ${CAD_SIZE}/${Math.round(CAD_PAUSE / 1000)}с)`);
            await sleep(CAD_PAUSE);
        }
    }

    // В стейт — только «финально» обработанные: с допусками, либо когда
    // обогащение уже прошло и допусков точно нет (_rolf есть в записи).
    // Машины без допусков и без _rolf ждут дозаписи следующим циклом.
    const enrichedDone = (car.car_approvals && car.car_approvals.length) || car._rolf !== undefined;
    if (importedKeys && car._type_key && enrichedDone) {
        importedKeys.add(car._type_key);
        writeJson(STATE_FILE, [...importedKeys]);
    }
    progress(processed);
}

// Финальная запись стейта: быстрые пропуски копились в памяти без записи
// (иначе тысячи writeJson на диск). Один раз в конце — и следующий прогон
// пролетит их мгновенно.
if (importedKeys && STATE_FILE && !DRY_RUN) writeJson(STATE_FILE, [...importedKeys]);

console.log(`${DRY_RUN ? '[dry-run] ' : ''}Импорт из ${path.relative(ROOT, IN_FILE)}:`);
console.log(`  ${DRY_RUN ? 'будет добавлено' : 'добавлено'}: ${inserted}`);
console.log(`  уже в базе (пропущено): ${existing}`);
console.log(`  битых записей: ${invalid}`);
console.log(`  ошибок записи: ${failed}`);
if (updatedApprovals) console.log(`  ${OVERWRITE ? 'перезаписано существующих' : 'дозаписаны допуски'}: ${updatedApprovals}`);
if (skippedByState) console.log(`  пропущено по стейту (залиты ранее): ${skippedByState}`);
if (failedReport.length) {
    console.log('\nОшибки записи (первые 30):');
    for (const line of failedReport.slice(0, 30)) console.log('  - ' + line);
    if (failedReport.length > 30) console.log(`  … и ещё ${failedReport.length - 30}`);
}
if (invalidReport.length) {
    console.log('\nБитые записи:');
    for (const line of invalidReport.slice(0, 30)) console.log('  - ' + line);
    if (invalidReport.length > 30) console.log(`  … и ещё ${invalidReport.length - 30}`);
}
progress(processed, true);
process.exit(failed ? 2 : 0);
