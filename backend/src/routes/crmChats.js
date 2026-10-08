// ─────────────────────────────────────────────────────────────────────────────
// Вкладка «Чаты» — /api/crm/chats: «Открытые линии» новой CRM (MAX, Telegram,
// ВК) под ЛИЧНОЙ сессией работника — ответ клиенту CRM запишет на того, кто
// его написал. Разбор ответов и список ручек — shared/crmChats.js.
//
// Отдельно стоит `/pulse`: его спрашивает КАЖДАЯ открытая страница сайта, а не
// только вкладка «Чаты», — ради счётчика на вкладке и уведомления о новом
// сообщении. Поэтому он дешёвый (короткий кэш по человеку) и молчаливый: у
// кого чатов в CRM нет (нет права), тот получает `available: false`, и
// страница перестаёт спрашивать; повторно CRM об этом не дёргаем 15 минут.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';

import { crmApi, CrmError } from '../crm/client.js';
import { newCrmGetter, sendCrmError } from './crm.js';
import {
    parseDialogs, parseThread, parseUnread, parseWaiting, parseClientMatches, chatRefusal,
} from '../../../shared/crmChats.js';

const LIST_TTL_MS = 3000;
const PULSE_TTL_MS = 8000;
const DENIED_MS = 15 * 60 * 1000;
const ID_RE = /^\d{1,12}$/;
const STATUSES = new Set(['open', 'closed']);
const CHANNELS = new Set(['', 'max', 'tg', 'vk']);

function bad(res, message) {
    return res.status(400).json({ error: { code: 'bad_request', message } });
}

export function createChatsRouter({ api = crmApi, now = () => Date.now() } = {}) {
    const router = Router();
    const get = newCrmGetter(api);
    const denied = new Map(); // `${userId}|${раздел}` → до какого момента не спрашивать

    const isDenied = (userId, what) => (denied.get(`${userId}|${what}`) || 0) > now();
    const deny = (userId, what) => denied.set(`${userId}|${what}`, now() + DENIED_MS);

    // Действие в CRM: отказ — её словами (409).
    async function act(userId, section, body) {
        const json = await api(userId, { query: `section=${section}`, body });
        const why = chatRefusal(json);
        if (why) throw new CrmError('crm_refused', why);
        return json;
    }

    const idOf = (req, res) => {
        const id = String(req.params.id || '');
        if (!ID_RE.test(id)) { bad(res, 'id диалога — число'); return null; }
        return id;
    };

    // ── Счётчик и «ждут оператора» для всего сайта ───────────────────────────

    router.get('/pulse', async (req, res) => {
        const userId = req.user.id;
        if (isDenied(userId, 'counts')) return res.json({ available: false });
        try {
            let unread = 0;
            try {
                unread = parseUnread(await get(userId, 'section=omni_counts', PULSE_TTL_MS));
            } catch (err) {
                if (err instanceof CrmError && err.code === 'crm_refused') {
                    deny(userId, 'counts');
                    return res.json({ available: false });
                }
                throw err;
            }
            // «Ждут оператора» CRM показывает не всем ролям — нет права, значит
            // просто пусто, а счётчик живёт дальше.
            let waiting = [];
            if (!isDenied(userId, 'waiting')) {
                try {
                    waiting = parseWaiting(await get(userId, 'section=omni_waiting', PULSE_TTL_MS));
                } catch (err) {
                    if (!(err instanceof CrmError) || err.code === 'crm_auth_required') throw err;
                    if (err.code === 'crm_refused') deny(userId, 'waiting');
                }
            }
            res.json({ available: true, unread, waiting });
        } catch (err) {
            sendCrmError(res, err);
        }
    });

    // ── Чтение ───────────────────────────────────────────────────────────────

    router.get('/dialogs', async (req, res) => {
        const status = STATUSES.has(String(req.query.status)) ? String(req.query.status) : 'open';
        const channel = CHANNELS.has(String(req.query.channel || '')) ? String(req.query.channel || '') : '';
        const q = String(req.query.q || '').trim().slice(0, 80);
        try {
            const json = await get(req.user.id,
                `section=omni_dialogs&status=${status}&channel=${channel}&q=${encodeURIComponent(q)}`, LIST_TTL_MS);
            res.json({ dialogs: parseDialogs(json) });
        } catch (err) {
            sendCrmError(res, err);
        }
    });

    // Без кэша: открытие диалога CRM считает прочтением, а сообщения в нём
    // ждут прямо сейчас.
    router.get('/dialogs/:id', async (req, res) => {
        const id = idOf(req, res); if (!id) return;
        try {
            const json = await get(req.user.id, `section=omni_thread&id=${id}`, 0);
            const why = chatRefusal(json);
            if (why) throw new CrmError('crm_refused', why === 'CRM не приняла' ? 'диалог не открылся' : why);
            res.json(parseThread(json));
        } catch (err) {
            sendCrmError(res, err);
        }
    });

    router.get('/clients', async (req, res) => {
        const q = String(req.query.q || '').trim().slice(0, 80);
        if (q.length < 2) return bad(res, 'наберите хотя бы две буквы или цифры');
        try {
            const json = await get(req.user.id, `section=omni_client_search&q=${encodeURIComponent(q)}`, 0);
            res.json({ clients: parseClientMatches(json) });
        } catch (err) {
            sendCrmError(res, err);
        }
    });

    // ── Действия ─────────────────────────────────────────────────────────────

    router.post('/dialogs/:id/reply', async (req, res) => {
        const id = idOf(req, res); if (!id) return;
        const text = String(req.body?.text ?? '').trim().slice(0, 4000);
        if (!text) return bad(res, 'пустое сообщение');
        try {
            await act(req.user.id, 'omni_reply', { id, text });
            res.json({ ok: true });
        } catch (err) {
            sendCrmError(res, err);
        }
    });

    router.post('/dialogs/:id/assign', async (req, res) => {
        const id = idOf(req, res); if (!id) return;
        try {
            await act(req.user.id, 'omni_assign', { id });
            res.json({ ok: true });
        } catch (err) {
            sendCrmError(res, err);
        }
    });

    router.post('/dialogs/:id/status', async (req, res) => {
        const id = idOf(req, res); if (!id) return;
        const to = String(req.body?.to || '');
        if (!STATUSES.has(to)) return bad(res, 'статус — open | closed');
        try {
            await act(req.user.id, 'omni_status', { id, to });
            res.json({ ok: true });
        } catch (err) {
            sendCrmError(res, err);
        }
    });

    router.post('/dialogs/:id/link', async (req, res) => {
        const id = idOf(req, res); if (!id) return;
        const clientId = String(req.body?.clientId || '');
        if (!ID_RE.test(clientId)) return bad(res, 'id клиента — число');
        try {
            await act(req.user.id, 'omni_link', { id, client_id: clientId });
            res.json({ ok: true });
        } catch (err) {
            sendCrmError(res, err);
        }
    });

    return router;
}

export default createChatsRouter();
