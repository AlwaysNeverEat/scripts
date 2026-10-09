// ─────────────────────────────────────────────────────────────────────────────
// Вкладка «Лиды» — /api/crm/leads. Лента звонков и карточка лида из новой CRM
// под ЛИЧНОЙ сессией работника (как «Записи» и «Клиент»): что оператор
// поменял в карточке, CRM запишет на него, а не на общую учётку.
//
// Разбор ответов и обоснование — shared/crmLeads.js. Здесь три вещи:
//
//  1. ЛЕНТА. CRM отдаёт живые звонки (`incoming_active`) и журнал входящих
//     (`incoming_list`). На журнал у учётки может не быть права — в меню CRM
//     колл-центру он скрыт. Тогда лента живёт на живых звонках и на том, что
//     мы видели сами (`seen`, по человеку, полсуток в памяти процесса):
//     закончившийся звонок не должен исчезать из ленты вместе с трубкой, а
//     это ровно то, на что жаловались во всплывашках CRM. Отказ в журнале
//     запоминается на 15 минут — спрашивать каждые пять секунд то, чего не
//     дадут, значит забивать общую очередь запросов к CRM.
//
//  2. КАРТОЧКА — тем же путём, что всплывашка CRM: номер → client_by_phone →
//     clientcard. Каждое открытие — просмотр карточки клиента в CRM, ровно как
//     клик по её всплывашке, со всеми её лимитами и журналами; лишний раз не
//     ходим (склейка одинаковых запросов, без кэша: карточку тут правят).
//
//  3. ДЕЙСТВИЯ — те же, что кнопки карточки CRM, с теми же полями.
//
// Кэш и склейка — ПО СОТРУДНИКУ: ходим под личной сессией, полученное одной
// учёткой другой не отдаём (тот же довод, что у «Клиента» в routes/crm.js).
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';

import { crmApi, CrmError } from '../crm/client.js';
import { newCrmGetter, sendCrmError } from './crm.js';
import {
    phone11, normalizeCall, mergeFeed, settleGone, parseLeadCard, parseServices,
    cleanCalcItems, actionRefusal, LEAD_STATUSES,
} from '../../../shared/crmLeads.js';

const ACTIVE_TTL_MS = 3000;       // живые: раздел спрашивает раз в 5 с
const LIST_TTL_MS = 20 * 1000;    // журнал меняется со звонком, не с секундой
const SERVICES_TTL_MS = 60 * 60 * 1000;
const LIST_DENIED_MS = 15 * 60 * 1000;
const SEEN_KEEP_MS = 12 * 3600 * 1000;
const SEEN_MAX = 400;

const ID_RE = /^\d{1,12}$/;

function bad(res, message) {
    return res.status(400).json({ error: { code: 'bad_request', message } });
}

// Фабрика — ради теста: он гоняет ровно этот код с подменённой CRM.
export function createLeadsRouter({ api = crmApi, now = () => Date.now(), activeTtl = ACTIVE_TTL_MS } = {}) {
    const router = Router();
    const get = newCrmGetter(api);
    const seen = new Map();       // userId → Map(id → звонок)
    const listDenied = new Map(); // userId → до какого момента не спрашивать журнал

    // Действие в CRM: отказ — её словами (409), а не «ок» молча.
    async function act(userId, { query = null, body }) {
        const json = await api(userId, { query, body });
        const why = actionRefusal(json);
        if (why) throw new CrmError('crm_refused', why);
        return json;
    }

    function remember(userId, calls) {
        let mine = seen.get(userId);
        if (!mine) { mine = new Map(); seen.set(userId, mine); }
        for (const c of calls) mine.set(c.id, { ...c });
        const edge = now() - SEEN_KEEP_MS;
        for (const [id, c] of mine) if ((c.seenAt || 0) < edge) mine.delete(id);
        while (mine.size > SEEN_MAX) mine.delete(mine.keys().next().value);
        return mine;
    }

    // ── Лента ────────────────────────────────────────────────────────────────

    router.get('/feed', async (req, res) => {
        const userId = req.user.id;
        try {
            const activeJson = await get(userId, 'section=incoming_active', activeTtl);
            const active = activeJson?.active || activeJson?.rows || activeJson?.calls || [];

            let list = [];
            let journal = 'ok';
            if ((listDenied.get(userId) || 0) > now()) {
                journal = 'denied';
            } else {
                try {
                    const listJson = await get(userId, 'section=incoming_list', LIST_TTL_MS);
                    list = listJson?.rows || [];
                } catch (err) {
                    // Нет права или журнал упал — лента живёт без него.
                    if (!(err instanceof CrmError) || err.code === 'crm_auth_required') throw err;
                    journal = err.code === 'crm_refused' ? 'denied' : 'failed';
                    if (journal === 'denied') listDenied.set(userId, now() + LIST_DENIED_MS);
                }
            }

            const liveNow = active.map(normalizeCall).filter(Boolean);
            const mine = seen.get(userId) || new Map();
            settleGone([...mine.values()], new Set(liveNow.map(c => c.id)));
            const calls = mergeFeed({ list, active, remembered: [...mine.values()], now: now() });
            const stamp = now();
            remember(userId, calls.map(c => ({ ...c, seenAt: mine.get(c.id)?.seenAt || stamp })));
            res.json({ calls, journal, fetchedAt: new Date(stamp).toISOString() });
        } catch (err) {
            sendCrmError(res, err);
        }
    });

    // ── Карточка ─────────────────────────────────────────────────────────────

    async function cardOf(userId, clientId) {
        const json = await get(userId, `section=clientcard&id=${clientId}`, 0);
        if (!json || json.error) throw new CrmError('crm_refused', 'клиент не найден в CRM');
        return parseLeadCard(json);
    }

    // По номеру: есть клиент — его карточка, нет — `{ client: null }`, и
    // раздел предложит завести карточку, как это делает CRM.
    router.get('/card', async (req, res) => {
        const userId = req.user.id;
        const id = String(req.query.id || '');
        const phone = phone11(req.query.phone);
        try {
            if (ID_RE.test(id)) return res.json({ card: await cardOf(userId, id) });
            if (!phone) return bad(res, 'нужен номер телефона или id клиента');
            const found = await get(userId, `section=client_by_phone&phone=${phone}`, 0);
            const clientId = String(found?.client?.id || '');
            if (!ID_RE.test(clientId)) return res.json({ card: null, phone });
            res.json({ card: await cardOf(userId, clientId) });
        } catch (err) {
            sendCrmError(res, err);
        }
    });

    router.get('/services', async (req, res) => {
        try {
            res.json({ services: parseServices(await get(req.user.id, 'section=calc_services', SERVICES_TTL_MS)) });
        } catch (err) {
            sendCrmError(res, err);
        }
    });

    // ── Действия ─────────────────────────────────────────────────────────────

    const text = (v, max) => String(v ?? '').trim().slice(0, max);

    function clientIdOf(req, res) {
        const id = String(req.params.clientId || '');
        if (!ID_RE.test(id)) { bad(res, 'id клиента — число'); return null; }
        return id;
    }

    // Новая карточка по номеру — клиента в CRM ещё нет.
    router.post('/clients', async (req, res) => {
        const phone = phone11(req.body?.phone);
        if (!phone) return bad(res, 'номер введён не полностью');
        const body = { action: 'save_client', phone };
        const name = text(req.body?.name, 120);
        const car = text(req.body?.car, 120);
        if (name) body.name = name;
        if (car) body.car = car;
        try {
            const json = await act(req.user.id, { body });
            if (!ID_RE.test(String(json.id || ''))) throw new CrmError('crm_refused', 'CRM не вернула номер карточки');
            res.json({ card: await cardOf(req.user.id, String(json.id)) });
        } catch (err) {
            sendCrmError(res, err);
        }
    });

    router.post('/clients/:clientId/name', async (req, res) => {
        const clientId = clientIdOf(req, res); if (!clientId) return;
        const fio = text(req.body?.fio, 120);
        if (!fio) return bad(res, 'введите имя');
        try {
            const json = await act(req.user.id, { query: 'section=client_name_save', body: { client_id: clientId, fio } });
            res.json({ ok: true, fio: String(json.fio || fio) });
        } catch (err) {
            sendCrmError(res, err);
        }
    });

    router.post('/clients/:clientId/source', async (req, res) => {
        const clientId = clientIdOf(req, res); if (!clientId) return;
        const source = String(req.body?.sourceId ?? '');
        if (source && !ID_RE.test(source)) return bad(res, 'источник — число');
        try {
            await act(req.user.id, { query: 'section=client_source_save', body: { client_id: clientId, knew_from: source } });
            res.json({ ok: true });
        } catch (err) {
            sendCrmError(res, err);
        }
    });

    // Статус и дата следующего звонка — одно действие CRM. Окно сайта шлёт
    // статус с той датой, что уже стоит в CRM (блока даты на карточке нет).
    router.post('/clients/:clientId/plan', async (req, res) => {
        const clientId = clientIdOf(req, res); if (!clientId) return;
        const status = String(req.body?.status || '');
        const nextCall = String(req.body?.nextCall || '');
        if (status && !LEAD_STATUSES.includes(status)) return bad(res, 'неизвестный статус');
        if (nextCall && !/^\d{4}-\d{2}-\d{2}$/.test(nextCall)) return bad(res, 'дата — ГГГГ-ММ-ДД');
        try {
            await act(req.user.id, { body: { action: 'cc_callplan_save', client_id: clientId, next_call: nextCall, status } });
            res.json({ ok: true });
        } catch (err) {
            sendCrmError(res, err);
        }
    });

    router.post('/clients/:clientId/notes', async (req, res) => {
        const clientId = clientIdOf(req, res); if (!clientId) return;
        const note = text(req.body?.text, 2000);
        if (!note) return bad(res, 'пустая заметка');
        try {
            await act(req.user.id, { body: { action: 'cc_note_add', client_id: clientId, text: note } });
            res.json({ card: await cardOf(req.user.id, clientId) });
        } catch (err) {
            sendCrmError(res, err);
        }
    });

    router.delete('/notes/:id', async (req, res) => {
        const id = String(req.params.id || '');
        if (!ID_RE.test(id)) return bad(res, 'id заметки — число');
        try {
            await act(req.user.id, { body: { action: 'cc_note_del', id } });
            res.json({ ok: true });
        } catch (err) {
            sendCrmError(res, err);
        }
    });

    // Комментарий к звонку. Пустой текст — стереть комментарий, это законно.
    router.post('/calls/:id/comment', async (req, res) => {
        const id = String(req.params.id || '');
        if (!ID_RE.test(id)) return bad(res, 'id звонка — число');
        try {
            await act(req.user.id, { query: 'section=call_note_save', body: { id, text: text(req.body?.text, 2000) } });
            res.json({ ok: true });
        } catch (err) {
            sendCrmError(res, err);
        }
    });

    // Расчёт к звонку: позиции JSON-строкой, как их шлёт CRM.
    router.post('/clients/:clientId/calcs', async (req, res) => {
        const clientId = clientIdOf(req, res); if (!clientId) return;
        const items = cleanCalcItems(req.body?.items);
        if (!items.length) return bad(res, 'добавьте позиции');
        const callId = String(req.body?.callId || '');
        const body = { client_id: clientId, car: text(req.body?.car, 160), items: JSON.stringify(items) };
        if (ID_RE.test(callId)) body.call_id = callId;
        try {
            await act(req.user.id, { query: 'section=calc_save', body });
            res.json({ card: await cardOf(req.user.id, clientId) });
        } catch (err) {
            sendCrmError(res, err);
        }
    });

    router.delete('/calcs/:id', async (req, res) => {
        const id = String(req.params.id || '');
        if (!ID_RE.test(id)) return bad(res, 'id расчёта — число');
        try {
            await act(req.user.id, { query: 'section=calc_del', body: { id } });
            res.json({ ok: true });
        } catch (err) {
            sendCrmError(res, err);
        }
    });

    return router;
}

export default createLeadsRouter();
