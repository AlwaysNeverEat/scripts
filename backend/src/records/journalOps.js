// ─────────────────────────────────────────────────────────────────────────────
// Операции раздела «Записи» поверх журнала CRM — под ЛИЧНОЙ учёткой.
//
// Раздел разговаривает операциями create / update / delete в той же форме,
// что и раньше (routes/records.js → очередь → opEngine), и эта форма
// проверенная: окна создания и правки собирают её годами. Поэтому здесь не
// новый протокол, а тот же самый, только исполняется он СРАЗУ и через CRM:
//
//   • запрос уходит под сессией того, кто нажал кнопку, — CRM сама ставит
//     записи `creator`, и «кто записал» перестаёт быть нашей догадкой;
//   • ответ приходит сразу и с id, поэтому очередь с прогрессом в базе, воркер
//     и откат через минуты тут не нужны: откат укладывается в тот же запрос.
//
// Длинная запись — НАША цепочка получасовых слотов (createBooking), а не поле
// `duration` CRM: проверено, что `duration=150` на пустом дне создаёт три
// слота вместо пяти. СМС уходит только за первый слот и только если попросили.
//
// Даты в операциях — DD.MM.YYYY, как их шлёт раздел; в CRM — YYYY-MM-DD.
// Перевод живёт здесь и больше нигде.
// ─────────────────────────────────────────────────────────────────────────────

import {
    fetchJournal, createBooking, updateRecord, deleteBooking,
} from '../crm/journal.js';
import { CrmError } from '../crm/client.js';
import { journalToBoard, bookingOpen, BOOKING_LEAD_MIN } from '../../../shared/crmJournal.js';
import {
    extendsExistingRecord, findSlotConflict, addMinutes, timeToMin, SLOT_MINUTES,
} from '../../../shared/crmRecords.js';
import { creditOp } from './credits.js';

export function ddmmToIso(d) {
    const m = String(d || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function isoToDdmm(d) {
    const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

// Отказ, который надо показать человеку как есть: «занято», «записи больше
// нет». От ошибок CRM (сеть, сессия) отличается тем, что повтор не поможет —
// нужно другое время или свежая доска.
export class OpRefused extends Error {}

function requireDate(d, what) {
    const iso = ddmmToIso(d);
    if (!iso) throw new OpRefused(`${what}: дата должна быть ДД.ММ.ГГГГ`);
    return iso;
}

// Запас до визита — не позднее чем за час. Проверка СЕРВЕРНАЯ: доска прячет
// кнопки у слотов ближе часа, но спрятанная кнопка — это не запрет, и запрос
// в обход неё обязан получить отказ здесь.
function requireLead(iso, time, now) {
    if (!bookingOpen(iso, time, now)) {
        throw new OpRefused(
            `на ${time} уже не записать — записываем не позднее чем за ${BOOKING_LEAD_MIN} минут до визита`);
    }
}

// Журналы дней, которые понадобились одной операции: правка может трогать и
// день, откуда запись уезжает, и день, куда она едет.
function journalCache(userId, io) {
    const days = new Map();
    return async (iso) => {
        if (!days.has(iso)) days.set(iso, fetchJournal(userId, iso, io));
        return days.get(iso);
    };
}

// ── create ───────────────────────────────────────────────────────────────────

async function applyCreate(userId, p, deps) {
    const iso = requireDate(p.date, 'запись');
    // Хватает первого слота: остальные в цепочке идут после него.
    requireLead(iso, p.time, deps.now());
    const journal = await deps.day(iso);
    const board = journalToBoard(journal);

    // Сперва сверяемся с доской: «занято» лучше сказать до того, как в CRM
    // появится первый слот цепочки, который потом придётся сносить.
    const minutes = Number(p.durationMinutes) || SLOT_MINUTES;
    const n = Math.max(1, Math.ceil(minutes / SLOT_MINUTES));
    const times = Array.from({ length: n }, (_, i) => addMinutes(p.time, i * SLOT_MINUTES));
    const conflict = findSlotConflict(board, p.addressId, times);
    if (conflict) {
        throw new OpRefused(conflict.reason === 'closed'
            ? `в ${conflict.time} станция не работает`
            : `в ${conflict.time} на станции нет свободного поста`);
    }

    const res = await createBooking(userId, {
        addressId: p.addressId,
        date: iso,
        time: p.time,
        name: p.name,
        phone: p.phone,
        carNumber: p.carNumber,
        comment: p.comment,
        durationMinutes: minutes,
        // СМС — только если окно ЯВНО попросило. Галка в окне создания стоит
        // по умолчанию, а дописывание хвоста в окне правки шлёт false.
        sms: p.sms === true,
    }, deps.io);
    if (!res.ok) throw new OpRefused(res.message);

    // Очко в топ. id записи в CRM известен сразу, поэтому искать её
    // следующим синком не нужно, а op_id берём ОТРИЦАТЕЛЬНЫМ: bigserial
    // старой очереди положительный, и пересечься они не могут никогда.
    // Сбой зачёта запись НЕ отменяет — работа сделана, а топ переживёт.
    if (deps.credit && userId) {
        try {
            const station = journal.stations.find(s => s.id === Number(p.addressId));
            await deps.credit({
                id: -res.id,
                type: 'create',
                userId,
                payload: p,
                progress: { stationTitle: station ? station.address : '' },
            }, {
                continuation: extendsExistingRecord(board, p),
                recordId: String(res.id),
            });
        } catch (err) {
            console.warn('зачёт записи не записался', err);
        }
    }
    return { created: res.ids, author: res.author };
}

// ── update ───────────────────────────────────────────────────────────────────

// Перенос цепочки слот за слотом упирается в собственные слоты: сдвиг на
// получас вперёд на одном посту — это «10:00 → 10:30», а 10:30 ещё занят
// вторым слотом той же записи. Поэтому при сдвиге вперёд двигаем с хвоста,
// назад — с головы: так каждый слот уезжает на место, которое уже свободно.
export function moveOrder(moves) {
    if (moves.length < 2) return moves;
    const head = moves[0];
    const samePlace = head.target.addressId === head.cur.addressId && head.target.date === head.cur.date;
    const later = timeToMin(head.target.time) > timeToMin(head.cur.time);
    return samePlace && later ? [...moves].reverse() : moves;
}

async function applyUpdate(userId, p, deps) {
    const list = Array.isArray(p.records) ? p.records : [];
    if (!list.length) throw new OpRefused('нечего менять');

    const moves = [];
    for (const r of list) {
        // Где запись лежит СЕЙЧАС: при переносе это `from`, при правке полей —
        // день доски, с которой её открыли.
        const fromIso = r.from ? requireDate(r.from.date, 'перенос') : requireDate(p.boardDate, 'правка');
        const journal = await deps.day(fromIso);
        const cur = journal.records.find(x => x.id === Number(r.id));
        if (!cur) throw new OpRefused('этой записи больше нет — обновите доску');

        const target = {
            addressId: r.addressId != null ? Number(r.addressId) : cur.addressId,
            date: r.date ? requireDate(r.date, 'перенос') : cur.date,
            time: r.time || cur.time,
        };
        // Запас до визита проверяется только там, куда запись ЕДЕТ. Правка
        // полей у записи, до которой полчаса, — законное дело (клиент звонит
        // уточнить госномер), и прятать её за правилом нельзя.
        const moved = target.addressId !== cur.addressId || target.date !== cur.date || target.time !== cur.time;
        if (moved) requireLead(target.date, target.time, deps.now());
        moves.push({
            id: cur.id,
            cur,
            target,
            fields: {
                id: cur.id,
                ...target,
                // Чего окно не прислало — берём из CRM как есть: пустое поле в
                // операции означает «не трогали», а не «стереть».
                name: r.name != null ? r.name : cur.name,
                phone: r.phone ? r.phone : cur.phone,
                carNumber: 'carNumber' in r ? r.carNumber : cur.carNumber,
                comment: 'comment' in r ? r.comment : cur.comment,
                // Правка и перенос СМС не шлют никогда. В самой CRM галка при
                // смене времени включается сама, и сообщение уходило «потому
                // что забыл снять» — ровно так и случилось на первой проверке.
                sms: false,
            },
        });
    }

    const done = [];
    for (const m of moveOrder(moves)) {
        let res;
        try {
            res = await updateRecord(userId, m.fields, deps.io);
        } catch (err) {
            await rollbackMoves(userId, done, deps.io);
            throw err;
        }
        if (!res.ok) {
            const left = await rollbackMoves(userId, done, deps.io);
            throw new OpRefused(
                `${res.message || 'CRM не сохранила запись'} (слот ${m.target.time})`
                + (left.length ? ` — вернуть на место не удалось слотов: ${left.length}` : ''));
        }
        done.push(m);
    }
    return { updated: done.length };
}

// Вернуть уже переехавшие слоты туда, откуда их взяли. Половина записи на
// новом месте и половина на старом — хуже, чем «перенос не удался».
async function rollbackMoves(userId, done, io) {
    const left = [];
    for (const m of [...done].reverse()) {
        try {
            const back = await updateRecord(userId, {
                id: m.cur.id,
                addressId: m.cur.addressId,
                date: m.cur.date,
                time: m.cur.time,
                name: m.cur.name,
                phone: m.cur.phone,
                carNumber: m.cur.carNumber,
                comment: m.cur.comment,
                sms: false,
            }, io);
            if (!back.ok) left.push(m.id);
        } catch {
            left.push(m.id);
        }
    }
    return left;
}

// ── delete ───────────────────────────────────────────────────────────────────

async function applyDelete(userId, p, deps) {
    const list = Array.isArray(p.records) ? p.records : [];
    if (!list.length) throw new OpRefused('нечего удалять');
    // Слоты одной станции сносятся вместе: свою цепочку CRM снимает по голове
    // целиком, нашу — по одному, и deleteBooking различает это по ответу.
    const byStation = new Map();
    for (const r of list) {
        const aid = Number(r.addressId);
        if (!Number.isFinite(aid)) throw new OpRefused('не указана станция записи');
        if (!byStation.has(aid)) byStation.set(aid, []);
        byStation.get(aid).push(Number(r.id));
    }
    let deleted = 0;
    for (const [addressId, ids] of byStation) {
        const res = await deleteBooking(userId, { ids, addressId }, deps.io);
        deleted += res.deleted || 0;
        if (!res.ok) throw new OpRefused(res.message);
    }
    return { deleted };
}

// ── Вход ─────────────────────────────────────────────────────────────────────

export async function applyJournalOp(userId, type, payload, deps = {}) {
    const full = {
        io: deps.io,
        credit: deps.credit === undefined ? creditOp : deps.credit,
        now: deps.now || (() => Date.now()),
    };
    full.day = deps.day || journalCache(userId, full.io);
    if (type === 'create') return applyCreate(userId, payload || {}, full);
    if (type === 'update') return applyUpdate(userId, payload || {}, full);
    if (type === 'delete') return applyDelete(userId, payload || {}, full);
    throw new OpRefused('операция бывает create | update | delete');
}

export { CrmError };
