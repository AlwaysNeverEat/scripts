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
// СЕРВЕРА, а не выводится из наших данных.
//
// Но пустой `creator` НЕ означает «клиент записался сам». Проверено на живой
// базе: запись, сделанная через НАШ САЙТ (старая админка, общая учётка),
// приходит в CRM ровно с таким же пустым полем. То есть пусто — это «CRM не
// знает автора», и за этим стоят два разных случая:
//
//   • клиент записался сам на сайте — автора и правда нет;
//   • запись ушла через старую админку под общей учёткой — автор есть, но
//     знает его только НАШ `record_credits`, а не CRM.
//
// Отсюда порядок, которого надо держаться в UI: сперва `creator` из CRM,
// потом наш зачёт по станции, времени и телефону, и только если пусто в
// обоих — «записался сам». Подставлять автора из головы нельзя ни в одном из
// случаев.
//
// Всё в этом файле — чистые функции: ни сети, ни базы. Сеть живёт в
// backend/src/crm/journal.js, а формы ответов сняты с живой CRM и лежат в
// shared/__fixtures__/crm-journal-day.json (обезличенные).
// ─────────────────────────────────────────────────────────────────────────────

import { SLOT_MINUTES, timeToMin, minToTime, addMinutes, normPhoneDigits } from './crmRecords.js';

// Рабочий день станции: слоты с 09:00 до 20:30 включительно. Те же числа, что
// и в самой CRM (`slots()` в её журнале) и что в нашей доске.
export const DAY_START_MIN = 9 * 60;
export const DAY_END_MIN = 21 * 60;

export function journalSlots() {
    const out = [];
    for (let m = DAY_START_MIN; m < DAY_END_MIN; m += SLOT_MINUTES) out.push(minToTime(m));
    return out;
}

// Длительности, которые предлагает окно записи: 60 минут — это два
// получасовых слота подряд, 150 — пять.
//
// Поле `duration` самой CRM мы при этом НЕ используем. Проверено на живой
// базе: `duration=150` на пустом дне создало ТРИ слота вместо пяти (13:30,
// 14:00, 14:30), то есть полтора часа вместо двух с половиной. Клиенту
// называют одно, на доске стоит другое. Цепочку собираем сами —
// backend/src/crm/journal.js, createBooking.
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

// Кто сделал запись, ПО МНЕНИЮ CRM. null — CRM автора не знает, и это ещё не
// значит, что его нет: так выглядит и самозапись клиента, и запись через
// старую админку под общей учёткой (см. шапку файла).
//
// Отдельная функция, а не чтение поля, ровно ради того, чтобы «пусто» нигде не
// подменялось догадкой: место, где автора нет, должно быть одно и заметное.
export function recordAuthor(record) {
    const who = str(record && record.creator).trim();
    return who || null;
}

// Намеренно называется «CRM не знает», а не «записался сам»: второе было бы
// прямым враньём про каждую запись, сделанную через наш же сайт до переезда.
export function crmAuthorUnknown(record) {
    return recordAuthor(record) === null;
}

// Автор записи для показа: сперва CRM, потом наш зачёт, иначе никто.
// `creditAuthors` — карта «id записи → кто сделал» из record_credits; её
// заполняет бэкенд, и она закрывает всё, что было записано до переезда.
//
// Источники именно в таком порядке: CRM знает автора ТОЧНО (сессия), а наш
// зачёт — по совпадению станции, времени и телефона, то есть с оговорками.
export function boardAuthor(record, creditAuthors = null) {
    const fromCrm = recordAuthor(record);
    if (fromCrm) return { name: fromCrm, source: 'crm' };
    const own = creditAuthors && creditAuthors[String(record && record.id)];
    if (own) return { name: own, source: 'credits' };
    return null;
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

// ── Журнал → доска раздела «Записи» ──────────────────────────────────────────
//
// Раздел рисует доску из формы, которую отдавал разбор HTML старой админки
// (`parseRecordBoard`): адреса, сетка времён и ячейки «станция × время».
// Форма рабочая и проверенная, менять её ради переезда незачем — поэтому
// журнал кладётся в неё же, и переключение раздела сводится к смене
// источника, а не к переписыванию рисования.
//
// Два отличия от старой доски, и оба в плюс:
//   • `creator` — автор записи с сервера. Раньше его вообще не было;
//   • `carNumber` и `comment` приезжают СРАЗУ. Старая админка их на доске не
//     показывала, и раздел тянул форму правки отдельным запросом на каждую
//     открытую запись.
//
// Идентификаторы тут СТРОКИ, а не числа, — ровно как их отдавал
// `parseRecordBoard`. Это не небрежность: ими индексируются ячейки, и менять
// тип на границе значит ловить «8» !== 8 по всему разделу. Числовая модель
// живёт в `parseJournal` и нужна бэкенду.

// Статус визита CRM → метка, которую раздел уже умеет рисовать.
function boardStatus(rec) {
    if (rec.visit === 'checked') return 'checked';
    if (rec.visit === 'late') return 'too-late';
    return rec.isNew ? 'is-new' : '';
}

export function journalToBoard(journal, { stubDigits = '71111111111' } = {}) {
    const j = journal && journal.ok ? journal : { date: '', stations: [], records: [] };

    const addresses = j.stations.map(s => ({
        id: String(s.id),
        title: s.address,
        // Метро и число постов старая доска выводила из своего справочника
        // (stationsMeta). Теперь их говорит сама CRM — справочник остаётся
        // для того, чего она не знает: этаж, ворота, гидростойка.
        metro: s.metro,
        posts: s.posts,
    }));

    const cells = {};
    const cell = (aid, time) => {
        const byAddr = cells[aid] || (cells[aid] = {});
        return byAddr[time] || (byAddr[time] = { records: [], free: 0 });
    };

    for (const r of j.records) {
        const aid = String(r.addressId);
        cell(aid, r.time).records.push({
            id: String(r.id),
            addressId: aid,
            timeStart: r.time,
            timeEnd: addMinutes(r.time, SLOT_MINUTES),
            name: r.name,
            phone: r.phoneRaw || r.phone,
            phoneDigits: r.phone,
            isStub: r.phone === stubDigits,
            status: boardStatus(r),
            // Старая доска склеивала «имя / телефон» из текста ячейки; тут
            // поля приходят порознь, и склейка нужна только для показа.
            customer: [r.name, r.phoneRaw || r.phone].filter(Boolean).join(' / '),
            deleteUrl: '',
            // Новое, чего у старой доски не было.
            creator: r.creator || '',
            carNumber: r.carNumber,
            comment: r.comment,
            serviceIds: r.serviceIds,
            createdAt: r.createdAt,
        });
    }

    // Свободные места — только там, где станция вообще есть: считать их по
    // каждому слоту заранее дешевле, чем искать станцию при каждой отрисовке.
    const slots = journalSlots();
    for (const a of addresses) {
        for (const t of slots) {
            const c = cell(a.id, t);
            c.free = Math.max(a.posts - c.records.length, 0);
        }
    }

    return { date: j.date, timeSlots: slots, addresses, cells };
}
