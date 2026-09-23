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

// Создание. Возвращает `id` (CRM отдаёт его сразу — искать запись следующим
// синком доски больше не нужно) и `author` — ФИО из сессии, то есть тот, кому
// эта запись и будет подписана в самой CRM.
//
// Право на запись проверяем ДО похода: CRM откажет своей формулировкой уже
// после того, как оператор заполнил окно, а «у твоей учётки нет права на
// запись» надо говорить до того.
export async function createRecord(userId, fields, io = realIo) {
    const actor = await crmActor(userId, {}, io);
    if (!actor.canBook) {
        throw new CrmError(
            'crm_forbidden',
            `у учётки CRM «${actor.user}» (${actor.roleName || 'без роли'}) нет права создавать записи`,
        );
    }
    requireIsoDate(fields.date);
    const res = parseSaveResult(await io.api(userId, {
        body: journalSavePayload({ ...fields, id: null }),
    }));
    if (!res.ok) return { ...res, author: null };
    // Автор — из сессии, а не из наших полей. Если CRM когда-нибудь начнёт
    // подписывать записи иначе, это расхождение вылезет на первом же чтении
    // доски (`creator` у записи), а не спрячется в нашей догадке.
    return { ...res, author: actor.user || null };
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

// Удаление. CRM сносит ВСЮ цепочку связанных слотов и говорит, сколько их
// было (`deleted` / `group`) — длинная запись уходит целиком, и вызывающий
// обязан это показать: «удалил слот» и «удалил полтора часа» — разные вещи.
export async function deleteRecord(userId, { id, addressId }, io = realIo) {
    return parseDeleteResult(await io.api(userId, {
        body: journalDeletePayload({ id, addressId }),
    }));
}
