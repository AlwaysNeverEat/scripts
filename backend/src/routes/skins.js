// ─────────────────────────────────────────────────────────────────────────────
// Скины — /api/skins. Список надетых видят все вошедшие (его рисуют профиль,
// доска записей и карточка лида), ставить может только логин из
// SKIN_EDITOR_LOGINS (shared/skins.js) — спрятанная кнопка не запрет.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';

import * as store from '../skins/store.js';
import { canEditSkin, cleanSkin, skinOperatorKey } from '../../../shared/skins.js';

export function createSkinsRouter({ db } = {}) {
    const router = Router();
    const opts = db ? { db } : {};
    const fail = (res, where, err) => {
        console.error(where, err);
        res.status(500).json({ error: { code: 'internal', message: 'сервер не ответил — попробуйте ещё раз' } });
    };
    const editorOnly = (req, res, next) => (canEditSkin(req.user)
        ? next()
        : res.status(403).json({ error: { code: 'forbidden', message: 'скины пока только смотрят' } }));

    router.get('/', async (req, res) => {
        try {
            const canEdit = canEditSkin(req.user);
            const [skins, mine] = await Promise.all([
                store.listSkins(opts),
                canEdit ? store.mySkin(req.user.id, opts) : null,
            ]);
            res.json({ skins, canEdit, mine });
        } catch (err) { fail(res, 'GET /api/skins', err); }
    });

    router.put('/me', editorOnly, async (req, res) => {
        const { skin, error } = cleanSkin(req.body);
        if (error) return res.status(400).json({ error: { code: 'bad_request', message: error } });
        try {
            await store.saveSkin(req.user.id, skin, opts);
            res.json({ ok: true, mine: skin });
        } catch (err) { fail(res, 'PUT /api/skins/me', err); }
    });

    router.put('/me/operator', editorOnly, async (req, res) => {
        try {
            await store.saveOperator(req.user.id, skinOperatorKey(req.body?.operator), opts);
            res.json({ ok: true });
        } catch (err) { fail(res, 'PUT /api/skins/me/operator', err); }
    });

    return router;
}

export default createSkinsRouter();
