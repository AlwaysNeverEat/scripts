// ─────────────────────────────────────────────────────────────────────────────
// Зачёт записи в топ и всё, что из него читается: список записей человека за
// день (профиль) и авторство записей на доске.
//
// Одна успешно созданная запись = одна строка record_credits (миграции 020 и
// 039). С 039 рядом с очком лежит и САМА ЗАПИСЬ — станция, день и время, на
// которые записали, имя, телефон и госномер клиента: те же поля, что оператор
// заполнил в окне создания. Смысл — прозрачность: любое очко в топе можно
// открыть и увидеть, за кого оно дано. Строки со старых времён (до 039)
// подробностей не имеют, и это честно показывается как «до обновления», а не
// прячется: очки за них остаются.
//
// Что НЕ зачитывается (creditSkipReason):
//   • не создание (перенос, правка, удаление — не новая работа);
//   • гость без аккаунта — некому зачесть;
//   • продолжение продлённой записи — по телефону-заглушке или по доске
//     (слот встык к записи того же клиента): длинная запись — одна запись;
//   • ЗАПИСЬ МАСТЕРА — переключатель в окне создания: мастер звонит со станции
//     и диктует клиента, телефон при этом клиентский, и отличить такую запись
//     нечем, кроме как со слов того, кто её заводит;
//   • «мусорный» телефон — одна и та же цифра (+7 111 111-11-11 и подобные):
//     очко должно означать живого человека, а не строчку ради счётчика.
//
// Первые три причины строку НЕ создают вовсе: там нет ни новой записи, ни
// автора. Две последние — создают, но с counted = false (миграция 040): запись
// настоящая и сделал её известно кто, просто очка она не даёт. Иначе на доске
// она выглядела бы сделанной мимо сайта — та самая непрозрачность, ради
// которой всё и затевалось. Поэтому считающие запросы (топ, лента активности)
// фильтруют по counted, а показывающие (окно дня, авторы) — нет.
//
// Номер записи в оригинале (record_id) при создании неизвестен — оригинал его
// не возвращает. Его дописывает следующий синк доски (resolveCreditRecordIds):
// на доске ищется запись на той же станции и в то же время с тем же телефоном.
// Дальше авторство держится на id и переживает перенос записи.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../db/client.js';
import {
    normPhoneDigits, isExtensionCreate, isJunkPhone, SLOT_MINUTES,
} from '../../../shared/crmRecords.js';
import { findStationMeta } from '../../../shared/stationsMeta.js';

// 'DD.MM.YYYY' → 'YYYY-MM-DD' (null, если строка не дата). Дублирует
// sync.js сознательно: sync.js импортирует этот модуль, и тянуть его обратно
// ради одной строки значило бы завести цикл импортов.
function ddmmyyyyToIso(d) {
    const m = String(d || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// Почему операция НЕ даёт очка. null — даёт.
export function creditSkipReason(op, result = {}) {
    if (op?.type !== 'create') return 'not_create';
    if (!op.userId) return 'guest';
    if (isExtensionCreate(op.payload) || result.continuation) return 'continuation';
    if (op.payload?.byMaster === true) return 'by_master';
    if (isJunkPhone(op.payload?.phone)) return 'junk_phone';
    return null;
}

// Причины, при которых строка ВСЁ РАВНО пишется — с counted = false. Это
// настоящие записи с настоящим автором, и скрывать их нельзя: пропадёт подпись
// на доске и строка в окне дня, то есть ровно то, что делает топ проверяемым.
const RECORDED_SKIPS = new Set(['by_master', 'junk_phone']);

// Человеческая расшифровка для окна дня. Показываем ПРИЧИНУ, а не просто
// «не в счёт»: иначе строка выглядит отобранным очком.
export const SKIP_LABELS = {
    by_master: 'запись мастера',
    junk_phone: 'номер из одной цифры',
};

// Подробности записи для строки зачёта — из payload операции и её progress
// (название станции туда кладёт applyCreate в opEngine.js: по одному id доска
// прошлых дней его уже не расскажет).
export function creditDetails(op) {
    const p = op?.payload || {};
    return {
        stationId: p.addressId != null ? String(p.addressId) : null,
        stationTitle: String(op?.progress?.stationTitle || ''),
        recordDate: ddmmyyyyToIso(p.date),
        recordTime: String(p.time || ''),
        durationMin: Number(p.durationMinutes) || SLOT_MINUTES,
        clientName: String(p.name || ''),
        phone: normPhoneDigits(p.phone),
        carNumber: String(p.carNumber || ''),
    };
}

// Записать операцию: очком (counted = true) или без него, но с автором и
// причиной. Идемпотентно по op_id: повторная отметка done не удвоит счётчик.
// → true, если строка нужна была (и появилась), false — если писать нечего.
export async function creditOp(op, result = {}, { db = query } = {}) {
    const skip = creditSkipReason(op, result);
    if (skip && !RECORDED_SKIPS.has(skip)) return false;
    const d = creditDetails(op);
    await db(
        `INSERT INTO record_credits
            (op_id, user_id, station_id, station_title, record_date, record_time,
             duration_min, client_name, phone, car_number, counted, skip_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (op_id) DO NOTHING`,
        [op.id, op.userId, d.stationId, d.stationTitle, d.recordDate, d.recordTime,
         d.durationMin, d.clientName, d.phone, d.carNumber, !skip, skip || ''],
    );
    return true;
}

// ── Поиск записи на доске ────────────────────────────────────────────────────

function normName(name) {
    return String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Какая запись на доске — эта зачтённая. Ищем в ячейке (станция, время):
// сначала по телефону, а без телефона — по имени. Две подходящие записи в
// одной ячейке (мультибокс, два одинаковых клиента) — не угадываем: лучше
// оставить без автора, чем подписать чужую запись.
// credit = { stationId, recordTime, phone, clientName }
export function findCreditRecord(board, credit) {
    const cell = board?.cells?.[String(credit?.stationId)]?.[credit?.recordTime];
    if (!cell) return null;
    const live = (cell.records || []).filter(r => !r.isStub);
    const byPhone = credit.phone ? live.filter(r => r.phoneDigits === credit.phone) : [];
    let found = byPhone;
    if (!found.length) {
        const name = normName(credit.clientName);
        found = name ? live.filter(r => normName(r.name) === name && !r.phoneDigits) : [];
    } else if (found.length > 1) {
        const name = normName(credit.clientName);
        const narrowed = found.filter(r => normName(r.name) === name);
        if (narrowed.length) found = narrowed;
    }
    return found.length === 1 ? found[0] : null;
}

// Дописать record_id зачётам этого дня, у которых его ещё нет. Зовётся после
// каждого удачного синка доски: создание уходит в оригинал и тут же (POST /ops
// пинает syncTick) доска перечитывается — id находится через секунды.
// Три дня, а не вечно: запись на «завтра», которую успели перенести до первого
// синка, так и останется без id, и перебирать её каждую минуту незачем.
export async function resolveCreditRecordIds(isoDay, board, { db = query } = {}) {
    if (!isoDay || !board) return 0;
    const r = await db(
        `SELECT id, station_id, record_time, phone, client_name
           FROM record_credits
          WHERE record_date = $1 AND record_id IS NULL AND station_id IS NOT NULL
            AND created_at > now() - interval '3 days'`,
        [isoDay],
    );
    let resolved = 0;
    for (const row of r.rows) {
        const rec = findCreditRecord(board, {
            stationId: row.station_id, recordTime: row.record_time,
            phone: row.phone, clientName: row.client_name,
        });
        if (!rec) continue;
        await db('UPDATE record_credits SET record_id = $2 WHERE id = $1 AND record_id IS NULL', [row.id, String(rec.id)]);
        resolved++;
    }
    return resolved;
}

// ── Авторство на доске ───────────────────────────────────────────────────────

// { [recordId]: { id, display_name, avatar, counted, skipReason } } по всем
// записям дня, сделанным через сайт. Незачтённые (запись мастера) идут сюда
// наравне с зачтёнными: автор у них есть, и прятать его — значит выдавать
// такую запись за сделанную мимо сайта.
// Зачёт без record_id (синк ещё не дошёл) подписывается по месту на доске —
// тем же поиском, что и resolveCreditRecordIds.
export async function loadBoardAuthors(dateDDMMYYYY, board, { db = query } = {}) {
    const iso = ddmmyyyyToIso(dateDDMMYYYY);
    if (!iso) return {};
    const r = await db(
        `SELECT rc.record_id, rc.station_id, rc.record_time, rc.phone, rc.client_name,
                rc.counted, rc.skip_reason,
                u.id, u.display_name, u.avatar
           FROM record_credits rc
           JOIN users u ON u.id = rc.user_id
          WHERE rc.record_date = $1 AND rc.station_id IS NOT NULL`,
        [iso],
    );
    const authors = {};
    for (const row of r.rows) {
        const user = {
            id: row.id, display_name: row.display_name, avatar: row.avatar,
            counted: row.counted !== false,
            skipLabel: SKIP_LABELS[row.skip_reason] || '',
        };
        let recordId = row.record_id;
        if (!recordId) {
            const rec = findCreditRecord(board, {
                stationId: row.station_id, recordTime: row.record_time,
                phone: row.phone, clientName: row.client_name,
            });
            recordId = rec ? String(rec.id) : null;
        }
        // Уже подписанную запись не переписываем: две операции на одну запись
        // (дубль в очереди) — авторство у первой.
        if (recordId && !authors[recordId]) authors[recordId] = user;
    }
    return authors;
}

// ── Записи человека за день ──────────────────────────────────────────────────

// День — в МСК, как и клетка ленты (activity.js): границы суток считает БД
// тем же приведением, иначе вечерняя запись не совпала бы с квадратом, по
// которому кликнули.
const DAY_QUERY = `
  SELECT id,
         to_char(created_at AT TIME ZONE 'Europe/Moscow', 'HH24:MI') AS made_at,
         record_id, station_id, station_title,
         to_char(record_date, 'YYYY-MM-DD') AS record_date,
         record_time, duration_min, client_name, phone, car_number,
         counted, skip_reason
    FROM record_credits
   WHERE user_id = $1
     AND created_at >= ($2::date::timestamp AT TIME ZONE 'Europe/Moscow')
     AND created_at <  (($2::date + 1)::timestamp AT TIME ZONE 'Europe/Moscow')
   ORDER BY created_at`;

// → { date, count, legacy, records: [{ madeAt, stationId, stationTitle,
//     stationShort, recordDate, recordTime, durationMin, clientName, phone,
//     carNumber, recordId, counted, skipLabel }] }
// count — ОЧКИ за день (то же число, что в клетке ленты): незачтённые записи
// в него не входят, иначе окно спорило бы с подсказкой над квадратом.
// skipped — сколько записей сделано, но в топ не пошло (мастер, мусорный
// номер): в шапке окна это отдельное число, а не потерянные очки.
// legacy — сколько очков без подробностей (строки до миграции 039);
// records — все строки, про которые есть что рассказать, вместе с незачтёнными.
//
// Короткое имя станции считаем ЗДЕСЬ, а не в браузере: в базе лежит адрес из
// оригинала («деревня Новосаратовка … 267А»), а справочник (shared/
// stationsMeta.js) на бэкенде уже есть и в бандл сайта не тянется.
export async function loadDayRecords(userId, isoDay, { db = query } = {}) {
    const r = await db(DAY_QUERY, [userId, isoDay]);
    const records = [];
    let legacy = 0;
    let count = 0;
    let skipped = 0;
    for (const row of r.rows) {
        const counted = row.counted !== false;
        if (counted) count++; else skipped++;
        if (!row.station_id) { if (counted) legacy++; continue; }
        const title = row.station_title || '';
        records.push({
            madeAt: row.made_at,
            recordId: row.record_id || null,
            stationId: row.station_id,
            stationTitle: title,
            stationShort: findStationMeta(title)?.short || title,
            recordDate: row.record_date,
            recordTime: row.record_time,
            durationMin: row.duration_min,
            clientName: row.client_name || '',
            phone: row.phone || '',
            carNumber: row.car_number || '',
            counted,
            skipLabel: SKIP_LABELS[row.skip_reason] || '',
        });
    }
    return { date: isoDay, count, skipped, legacy, records };
}
