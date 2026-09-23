// ─────────────────────────────────────────────────────────────────────────────
// Журнал записи новой CRM (`/re/api.php`) — разбор ответов и сборка запросов.
//
// Записи переехали из старой админки (`zamena-masla-spot.ru/admin/record`,
// см. adminClient.js) в CRM, и главное, что это меняет, — АВТОРСТВО. В старой
// админке логин был ОДИН НА ВСЕХ, и кто сделал запись, оригиналу было не
// видно вовсе: автора мы восстанавливали сами, подбирая запись на доске по
// станции, времени и телефону (`resolveCreditRecordIds`), и честно
// отказывались угадывать, когда в ячейке подходили две.
//
// В CRM сессия персональная, и запись возвращается с полем `creator` —
// строкой ФИО из самой CRM. Поэтому правило тут жёсткое: АВТОР БЕРЁТСЯ С
// СЕРВЕРА, а не выводится из наших данных. Пустой `creator` — это НЕ «автор
// потерялся», а «клиент записался сам с сайта»: таких записей за обычный день
// больше сотни из полутора, и подставлять им автора нельзя ни при каких
// обстоятельствах.
//
// Всё в этом файле — чистые функции: ни сети, ни базы. Сеть живёт в
// backend/src/crm/journal.js, а формы ответов сняты с живой CRM и лежат в
// shared/__fixtures__/crm-journal-day.json (обезличенные).
// ─────────────────────────────────────────────────────────────────────────────

import { SLOT_MINUTES, timeToMin, minToTime, normPhoneDigits } from './crmRecords.js';

// Рабочий день станции: слоты с 09:00 до 20:30 включительно. Те же числа, что
// и в самой CRM (`slots()` в её журнале) и что в нашей доске.
export const DAY_START_MIN = 9 * 60;
export const DAY_END_MIN = 21 * 60;

export function journalSlots() {
    const out = [];
    for (let m = DAY_START_MIN; m < DAY_END_MIN; m += SLOT_MINUTES) out.push(minToTime(m));
    return out;
}

// Длительности, которые CRM принимает в `duration`. Это не «сколько минут
// занимает работа», а сколько ПОЛУЧАСОВЫХ СЛОТОВ подряд занять: 60 минут =
// два слота. Первый слот создаётся с этим полем, остальные CRM ставит сама.
export const DURATIONS = [30, 60, 90, 120, 150];

export function durationSlots(minutes) {
    const n = Math.round(Number(minutes) / SLOT_MINUTES);
    return Number.isFinite(n) && n >= 1 ? n : 1;
}

// ── Разбор ответа `section=journal` ──────────────────────────────────────────

// CRM отдаёт ВСЁ строками — и `id`, и `address_id`, и `posts_count`. Сравнивать
// их с нашими числами напрямую нельзя («8» !== 8), поэтому нормализуем на
// границе, один раз, здесь: дальше по коду ходят числа.
const toInt = (v) => {
    const n = parseInt(String(v ?? '').trim(), 10);
    return Number.isFinite(n) ? n : null;
};

const str = (v) => (v == null ? '' : String(v));

// Статус визита из CRM. Пустая строка — «ожидается», и это нормальное
// состояние большинства записей, а не отсутствие данных.
export const VISIT_STATUS = {
    '': 'ожидается',
    checked: 'приехал',
    late: 'не приехал',
};

export function parseJournalStation(s) {
    const id = toInt(s && s.id);
    if (id == null) return null;
    return {
        id,
        address: str(s.address),
        metro: str(s.metro),
        // Сколько записей влезает в один получасовой слот. У нас это же число
        // зовётся `boxes` (см. shared/stationsMeta.js) и совпадает с ним на
        // всех двадцати четырёх станциях — проверено на живой выгрузке.
        posts: Math.max(toInt(s.posts_count) || 1, 1),
        schedule: str(s.work_schedule),
    };
}

export function parseJournalRecord(r) {
    const id = toInt(r && r.id);
    const addressId = toInt(r && r.address_id);
    if (id == null || addressId == null) return null;
    // `phone` приходит как НАБРАЛИ («79117917147», «+7(921) 887-97-17»,
    // «+7 (921) 887-97-17» — три разных написания за один день), а `phone_d`
    // нормализован самой CRM. Берём второй и добиваем своей нормализацией:
    // на нём стоят и сравнение записей, и `isJunkPhone`.
    const phone = normPhoneDigits(str(r.phone_d) || str(r.phone));
    return {
        id,
        addressId,
        time: str(r.time),
        // `record_time` — «YYYY-MM-DD HH:MM:SS»; день записи берём из него, а
        // не из даты запроса: так запись остаётся самодостаточной.
        date: str(r.record_time).slice(0, 10),
        name: str(r.name),
        phone,
        phoneRaw: str(r.phone),
        carNumber: str(r.car_number).toUpperCase(),
        comment: str(r.comment),
        // Услуги — идентификаторы через запятую («21,5,6»), справочник лежит
        // отдельно (`section=servicelist`). Держим как есть: подставлять
        // названия из головы нельзя, а без справочника их взять неоткуда.
        serviceIds: str(r.services).split(',').map(s => s.trim()).filter(Boolean),
        createdAt: str(r.date_create),
        visit: str(r.st),
        isNew: Number(r.is_new) === 1,
        // ФИО из CRM либо пустая строка — см. шапку файла.
        creator: str(r.creator),
    };
}

export function parseJournal(json) {
    if (!json || json.ok !== true) {
        const message = str(json && json.message) || 'CRM не отдала журнал';
        return { ok: false, message, date: '', stations: [], records: [] };
    }
    const stations = (Array.isArray(json.stations) ? json.stations : [])
        .map(parseJournalStation).filter(Boolean);
    const records = (Array.isArray(json.records) ? json.records : [])
        .map(parseJournalRecord).filter(Boolean);
    // Порядок в ответе CRM не обещан ничем, а доска рисуется по слотам —
    // сортируем сами: станция, потом время.
    records.sort((a, b) => a.addressId - b.addressId || timeToMin(a.time) - timeToMin(b.time));
    return { ok: true, date: str(json.date), stations, records };
}

// ── Автор записи ─────────────────────────────────────────────────────────────

// Кто сделал запись, по мнению CRM. null — записался сам клиент с сайта.
// Отдельная функция, а не чтение поля, ровно ради того, чтобы «пусто» нигде не
// подменялось догадкой: место, где автора нет, должно быть одно и заметное.
export function recordAuthor(record) {
    const who = str(record && record.creator).trim();
    return who || null;
}

export function isSelfBooked(record) {
    return recordAuthor(record) === null;
}

// ── Сборка запросов ──────────────────────────────────────────────────────────

// `journal_save` служит и созданием, и правкой, и переносом: разница только в
// наличии `id`. `duration` CRM принимает ТОЛЬКО при создании — у существующей
// записи длительность менять нечем, и лишнее поле она молча проглотит, создав
// ложное впечатление, что перенос её учёл.
export function journalSavePayload(fields = {}) {
    const {
        id = null, addressId, date, time,
        name = '', phone = '', carNumber = '', comment = '',
        sms = false, durationMinutes = SLOT_MINUTES,
    } = fields;

    const body = { action: 'journal_save' };
    const isCreate = id == null || id === '';
    if (!isCreate) body.id = String(id);
    body.address_id = String(addressId ?? '');
    body.date = String(date || '');
    body.time = String(time || '');
    body.name = String(name || '');
    // Телефон уезжает ЦИФРАМИ: CRM принимает любое написание, но хранит и
    // отдаёт нормализованное, и слать ей «+7 (921) …» значит заводить второе
    // написание там, где его быть не должно.
    body.phone = normPhoneDigits(phone);
    body.car_number = String(carNumber || '').toUpperCase();
    body.comment = String(comment || '');
    // СМС клиенту — ВСЕГДА явно, и по умолчанию НЕТ. В самой CRM галка при
    // создании стоит и вдобавок сама включается обратно при смене станции,
    // даты или времени, поэтому сообщение уезжает «потому что забыл снять».
    // Здесь наоборот: сообщение уходит, только когда его попросили.
    body.sms = sms ? '1' : '0';
    if (isCreate) body.duration = String(durationMinutes);
    return body;
}

export function journalDeletePayload({ id, addressId }) {
    return {
        action: 'journal_delete',
        id: String(id ?? ''),
        address_id: String(addressId ?? ''),
    };
}

// ── Разбор ответов на запись и удаление ──────────────────────────────────────

// `{"ok":true,"id":505859,"sms":false,"message":"","moved":null}`
//
// `id` в ответе — то, чего у старой админки не было вовсе: там номер записи
// приходилось искать следующим синком доски. Теперь он известен сразу, и это
// снимает всю ветку дозаполнения.
export function parseSaveResult(json) {
    if (!json || json.ok !== true) {
        return { ok: false, message: str(json && json.message) || 'CRM не сохранила запись' };
    }
    const moved = json.moved && typeof json.moved === 'object' ? json.moved : null;
    return {
        ok: true,
        id: toInt(json.id),
        // Отправила ли CRM клиенту СМС на самом деле — это её ответ, а не эхо
        // нашего поля: попросить можно, а отправки может не случиться.
        smsSent: json.sms === true,
        // Сколько связанных слотов CRM подвинула сама. null — двигать было
        // нечего (запись на один слот).
        movedSlots: moved ? (toInt(moved.moved) || 0) : 0,
        message: str(json.message),
    };
}

// `{"ok":true,"deleted":1,"group":1,"message":"Запись удалена"}`
export function parseDeleteResult(json) {
    if (!json || json.ok !== true) {
        return { ok: false, message: str(json && json.message) || 'CRM не удалила запись' };
    }
    return {
        ok: true,
        // Сколько слотов реально снесено и сколько их было в цепочке: длинную
        // запись CRM удаляет целиком, и знать об этом надо (иначе «удалил
        // один слот» оказывается «удалил полтора часа»).
        deleted: toInt(json.deleted) || 0,
        group: toInt(json.group) || 0,
        message: str(json.message),
    };
}

// ── Кто я в CRM ──────────────────────────────────────────────────────────────

// `section=userperms` — единственный источник «кто сейчас работает»: сервер
// знает это из сессии, а не с наших слов. Привилегия 7 («Клиенты, запись») и
// есть право создавать записи; без неё CRM запись не примет, и узнать об этом
// лучше до того, как оператор заполнил окно.
export const PRIV_RECORDS = 7;

export function parseUserPerms(json) {
    if (!json || typeof json !== 'object' || json.error) {
        return { ok: false, error: str(json && json.error) || 'crm_auth_required' };
    }
    const privileges = Array.isArray(json.privileges)
        ? json.privileges.map(toInt).filter(n => n != null) : [];
    return {
        ok: true,
        user: str(json.user),
        isAdmin: json.is_admin === true,
        role: toInt(json.role),
        roleName: str(json.role_name),
        privileges,
        canBook: json.is_admin === true || privileges.includes(PRIV_RECORDS),
    };
}
