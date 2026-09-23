// ─────────────────────────────────────────────────────────────────────────────
// Журнал записи CRM под ПЕРСОНАЛЬНОЙ сессией работника.
//
// Смысл этого файла — авторство. В старой админке записей
// (records/adminClient.js) логин был один на всех, и «кто записал» оригиналу
// видно не было: автора мы восстанавливали сами, подбирая запись на доске по
// станции, времени и телефону, и честно отказывались угадывать, когда в
// ячейке подходили две.
//
// Здесь всё иначе: запрос уходит под сессией КОНКРЕТНОГО человека, и CRM сама
// проставляет записи `creator`. Поэтому тут нет и не должно быть ни одного
// места, где автор вычисляется из наших данных — он всегда либо приходит с
// сервера, либо его нет.
//
// Разбор ответов и сборка запросов — shared/crmJournal.js (чистые функции,
// тесты на живой обезличенной выгрузке). Сеть, сессия и очередь — crm/client.js.
// ─────────────────────────────────────────────────────────────────────────────

import { crmApi, CrmError } from './client.js';
import {
    parseJournal, parseSaveResult, parseDeleteResult, parseUserPerms,
    journalSavePayload, journalDeletePayload,
} from '../../../shared/crmJournal.js';
import {
    buildExtensionOps, isBookableTime, SLOT_MINUTES, MAX_OP_RECORDS, MAX_DURATION_MIN,
} from '../../../shared/crmRecords.js';

// Весь ввод-вывод — через `io`, как в records/opEngine.js: так журнал можно
// гонять тестами без сети и без сессии. В бою параметр не передают вовсе.
const realIo = { api: (userId, req) => crmApi(userId, req) };

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// CRM работает по Москве независимо от часового пояса машины — и станции, и
// журнал. Собираем дату сдвигом на +3 и чтением UTC-полей: `toISOString()` по
// местному времени врёт на день ровно в те вечерние часы, когда записывают
// на завтра.
export function mskDate(now = Date.now()) {
    const d = new Date(now + 3 * 3600 * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function requireIsoDate(date) {
    const d = String(date || '');
    if (!ISO_DATE_RE.test(d)) {
        throw new CrmError('crm_unavailable', `дата журнала должна быть YYYY-MM-DD, а не «${date}»`);
    }
    return d;
}

// ── Кто работает ─────────────────────────────────────────────────────────────

// `userperms` меняется редко, а спрашивать его приходится перед каждой
// записью — держим короткий кэш на процесс. Минута выбрана так, чтобы снятые
// права доехали на глазах у человека, а не через смену.
const ACTOR_TTL_MS = 60_000;
const actorCache = new Map(); // userId → { at, actor }

export function forgetActor(userId) {
    actorCache.delete(userId);
}

export async function crmActor(userId, { fresh = false } = {}, io = realIo) {
    const hit = actorCache.get(userId);
    if (!fresh && hit && Date.now() - hit.at < ACTOR_TTL_MS) return hit.actor;
    const actor = parseUserPerms(await io.api(userId, { query: 'section=userperms' }));
    if (!actor.ok) {
        actorCache.delete(userId);
        throw new CrmError('crm_auth_required', 'CRM не подтвердила, кто вошёл — войдите заново');
    }
    actorCache.set(userId, { at: Date.now(), actor });
    return actor;
}

// ── Доска ────────────────────────────────────────────────────────────────────

// Весь день целиком: станции с числом постов и все записи всех станций одним
// запросом. Старая админка отдавала день ОДНОЙ станции страницей HTML —
// здесь двадцать четыре станции и полторы сотни записей приезжают разом.
export async function fetchJournal(userId, date, io = realIo) {
    const day = requireIsoDate(date);
    const board = parseJournal(await io.api(userId, { query: `section=journal&date=${day}` }));
    if (!board.ok) throw new CrmError('crm_unavailable', board.message);
    return board;
}

// ── Запись ───────────────────────────────────────────────────────────────────

// Право на запись проверяем ДО похода: CRM откажет своей формулировкой уже
// после того, как оператор заполнил окно, а «у твоей учётки нет права на
// запись» надо говорить до того.
async function requireBooker(userId, io) {
    const actor = await crmActor(userId, {}, io);
    if (!actor.canBook) {
        throw new CrmError(
            'crm_forbidden',
            `у учётки CRM «${actor.user}» (${actor.roleName || 'без роли'}) нет права создавать записи`,
        );
    }
    return actor;
}

// ОДИН получасовой слот. Длительность всегда 30 минут — длинную запись мы
// собираем сами (см. createBooking), а `duration` CRM не используем вовсе.
//
// Возвращает `id` (CRM отдаёт его сразу — искать запись следующим синком
// доски больше не нужно) и `author` — ФИО из сессии, то есть того, кому эта
// запись и будет подписана в самой CRM.
export async function createRecord(userId, fields, io = realIo) {
    const actor = await requireBooker(userId, io);
    requireIsoDate(fields.date);
    const res = parseSaveResult(await io.api(userId, {
        body: journalSavePayload({ ...fields, id: null, durationMinutes: SLOT_MINUTES }),
    }));
    if (!res.ok) return { ...res, author: null };
    // Автор — из сессии, а не из наших полей. Если CRM когда-нибудь начнёт
    // подписывать записи иначе, это расхождение вылезет на первом же чтении
    // доски (`creator` у записи), а не спрячется в нашей догадке.
    return { ...res, author: actor.user || null };
}

// ── Длинная запись: продление НАШЕЙ сборкой ──────────────────────────────────
//
// У CRM для этого есть `duration`, и мы им НЕ пользуемся: её сборка цепочки
// ведёт себя непредсказуемо, а разбираться в чужом коде, который и так
// переписывают, дороже, чем собрать цепочку самим. Поэтому длинная запись —
// это N отдельных получасовых записей подряд, ровно как в старой админке
// (`buildExtensionOps`), и слоты 2..N отличаются от первого тремя вещами:
// у них нет госномера, нет комментария и НЕ УХОДИТ СМС. Последнее — главное:
// клиент записался один раз, и три сообщения подряд о «записи на 11:00,
// 11:30 и 12:00» выглядят поломкой.
//
// Транзакций у CRM нет, поэтому цепочка собирается «всё или ничего» вручную:
// не удался слот посреди — уже созданные сносим. Это та же причина, по
// которой существует records/opEngine.js, только здесь всё умещается в один
// проход: каждый слот создаётся одним запросом и сразу отдаёт свой id.
async function rollbackSlots(userId, ids, addressId, io) {
    const left = [];
    for (const id of ids) {
        try {
            const res = await deleteRecord(userId, { id, addressId }, io);
            if (!res.ok) left.push(id);
        } catch {
            // Сеть отвалилась посреди отката — молчать об этом нельзя:
            // на доске останутся слоты, которых никто не заказывал.
            left.push(id);
        }
    }
    return left;
}

export async function createBooking(userId, fields, io = realIo) {
    const actor = await requireBooker(userId, io);
    const date = requireIsoDate(fields.date);
    const minutes = Math.min(Number(fields.durationMinutes) || SLOT_MINUTES, MAX_DURATION_MIN);

    const slots = buildExtensionOps({
        addressId: fields.addressId,
        date,
        time: fields.time,
        name: fields.name,
        phone: fields.phone,
        carNumber: fields.carNumber,
        comment: fields.comment,
    }, minutes);

    if (slots.length > MAX_OP_RECORDS) {
        throw new CrmError('crm_unavailable',
            `запись на ${minutes} минут — это ${slots.length} слотов, больше ${MAX_OP_RECORDS} за раз не делаем`);
    }
    // Проверяем ВЕСЬ хвост до первого запроса: цепочка, упирающаяся в конец
    // рабочего дня, не должна оставлять после себя половину.
    const tail = slots.find(s => !isBookableTime(s.time));
    if (tail) {
        throw new CrmError('crm_unavailable',
            `${minutes} минут с ${fields.time} не помещаются в рабочий день — последний слот ${tail.time}`);
    }

    const ids = [];
    for (let i = 0; i < slots.length; i++) {
        let res;
        try {
            res = parseSaveResult(await io.api(userId, {
                body: journalSavePayload({
                    ...slots[i],
                    id: null,
                    durationMinutes: SLOT_MINUTES,
                    // СМС — только за ПЕРВЫЙ слот: продление клиенту не шлём.
                    sms: i === 0 ? Boolean(fields.sms) : false,
                }),
            }));
        } catch (err) {
            const left = await rollbackSlots(userId, ids, fields.addressId, io);
            throw Object.assign(err, { rolledBack: ids.length - left.length, orphans: left });
        }
        if (!res.ok) {
            const left = await rollbackSlots(userId, ids, fields.addressId, io);
            return {
                ok: false,
                // Говорим, на каком слоте споткнулись: «занято» на третьем
                // получасе — это не то же самое, что «занято» на первом.
                message: slots.length > 1
                    ? `${res.message || 'CRM не сохранила запись'} (слот ${slots[i].time})`
                    : (res.message || 'CRM не сохранила запись'),
                ids: [], author: null,
                rolledBack: ids.length - left.length,
                orphans: left,
            };
        }
        ids.push(res.id);
    }

    return {
        ok: true,
        // Голова цепочки — та запись, на которую подписывается зачёт и по
        // которой её потом находят.
        id: ids[0],
        ids,
        slots: ids.length,
        author: actor.user || null,
        smsAsked: Boolean(fields.sms),
        message: '',
    };
}

// Правка и перенос — та же ручка, но с `id`. Длительность тут не передаётся
// вовсе: у существующей записи её менять нечем, а CRM молча проглотила бы
// поле, создав впечатление, что перенос её учёл.
export async function updateRecord(userId, fields, io = realIo) {
    if (fields.id == null || fields.id === '') {
        throw new CrmError('crm_unavailable', 'правка записи без id');
    }
    requireIsoDate(fields.date);
    return parseSaveResult(await io.api(userId, { body: journalSavePayload(fields) }));
}

// Удаление ОДНОГО слота — точнее, одного запроса: свою цепочку CRM сносит
// целиком и говорит, сколько слотов ушло (`deleted` / `group`). «Удалил слот»
// и «удалил полтора часа» для оператора разные вещи, поэтому числа идут
// наружу как есть.
export async function deleteRecord(userId, { id, addressId }, io = realIo) {
    return parseDeleteResult(await io.api(userId, {
        body: journalDeletePayload({ id, addressId }),
    }));
}

// Удаление ЦЕЛОЙ записи, включая продление.
//
// Тут нельзя положиться на группировку CRM, и вот почему. Свою цепочку (ту,
// что она собрала по `duration`) она действительно сносит одним запросом по
// id головы — проверено: три слота ушли разом. Но наши слоты создаются
// НЕЗАВИСИМЫМИ записями, и попадут ли они в её группировку, снаружи не видно:
// если группа хранится отдельным полем, проставленным при создании с
// `duration`, то у наших его нет, и по голове снесётся ровно один слот.
//
// Поэтому: сносим голову, смотрим, сколько CRM сняла на самом деле, и
// добираем остальные по одному. Слот, которого уже нет, ошибкой не считаем —
// это ровно тот случай, когда группировка сработала и добирать нечего.
export async function deleteBooking(userId, { ids, addressId }, io = realIo) {
    const list = (Array.isArray(ids) ? ids : [ids]).filter(id => id != null);
    if (!list.length) throw new CrmError('crm_unavailable', 'удаление записи без id');

    const head = await deleteRecord(userId, { id: list[0], addressId }, io);
    if (!head.ok) return { ok: false, deleted: 0, message: head.message, left: list };

    let deleted = head.deleted || 1;
    const left = [];
    // CRM уже сняла всю цепочку — добирать нечего.
    if (deleted < list.length) {
        for (const id of list.slice(1)) {
            const r = await deleteRecord(userId, { id, addressId }, io);
            if (r.ok) deleted += r.deleted || 1;
            else left.push(id);
        }
    }
    return {
        ok: left.length === 0,
        deleted,
        left,
        message: left.length
            ? `удалено слотов: ${deleted}, не удалось снять: ${left.length}`
            : head.message,
    };
}
