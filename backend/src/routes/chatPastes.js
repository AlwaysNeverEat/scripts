// ─────────────────────────────────────────────────────────────────────────────
// Пасты во вкладке «Чаты» — /api/chat/pastes. CRM здесь не участвует вовсе:
// пасты живут в нашей базе (backend/src/chat/pastes.js), а в CRM уезжает уже
// готовый ответ, который человек собрал из пасты в поле ответа.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';

import * as store from '../chat/pastes.js';
import { cleanPaste, PASTES_MAX } from '../../../shared/chatPastes.js';

const ID_RE = /^\d{1,18}$/;

export function createPastesRouter({ db } = {}) {
    const router = Router();
    const opts = db ? { db } : {};

    const fail = (res, where, err) => {
        console.error(where, err);
        res.status(500).json({ error: { code: 'internal', message: 'пасты не сохранились — попробуйте ещё раз' } });
    };
    const bad = (res, message) => res.status(400).json({ error: { code: 'bad_request', message } });

    async function cleaned(req, res) {
        const { paste, error } = cleanPaste(req.body, await store.topicsOf(req.user.id, opts));
        if (error) { bad(res, error); return null; }
        return paste;
    }

    router.get('/', async (req, res) => {
        try {
            res.json({ pastes: await store.listPastes(req.user.id, opts) });
        } catch (err) { fail(res, 'GET /api/chat/pastes', err); }
    });

    router.post('/', async (req, res) => {
        try {
            const paste = await cleaned(req, res); if (!paste) return;
            const row = await store.createPaste(req.user.id, paste, opts);
            if (!row) return res.status(409).json({ error: { code: 'too_many', message: `паст уже ${PASTES_MAX} — удалите ненужные` } });
            res.status(201).json({ paste: row });
        } catch (err) { fail(res, 'POST /api/chat/pastes', err); }
    });

    router.put('/:id', async (req, res) => {
        const id = String(req.params.id);
        if (!ID_RE.test(id)) return bad(res, 'id пасты — число');
        try {
            const paste = await cleaned(req, res); if (!paste) return;
            const row = await store.updatePaste(req.user.id, id, paste, opts);
            if (!row) return res.status(404).json({ error: { code: 'not_found', message: 'пасты уже нет — её удалили в другой вкладке' } });
            res.json({ paste: row });
        } catch (err) { fail(res, 'PUT /api/chat/pastes', err); }
    });

    // Удалить уже удалённое — не ошибка: итог тот, о котором просили.
    router.delete('/:id', async (req, res) => {
        const id = String(req.params.id);
        if (!ID_RE.test(id)) return bad(res, 'id пасты — число');
        try {
            await store.deletePaste(req.user.id, id, opts);
            res.json({ ok: true });
        } catch (err) { fail(res, 'DELETE /api/chat/pastes', err); }
    });

    return router;
}

export default createPastesRouter();
