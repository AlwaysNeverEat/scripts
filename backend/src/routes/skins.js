// ─────────────────────────────────────────────────────────────────────────────
// Скины — /api/skins. Список надетых видят все вошедшие (его рисуют профиль,
// доска записей и лента лидов). Надеть можно только то, что ЕСТЬ — выпало из
// кейса (skin_items, см. routes/cases.js); логины из SKIN_EDITOR_LOGINS
// (shared/skins.js) надевают что угодно — это проверка паков, а не подарок.
// Сервер проверяет это сам: спрятанная кнопка не запрет.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';

import * as store from '../skins/store.js';
import { reader as walletReader } from '../cases/store.js';
import { canEditSkin, cleanSkin, skinOperatorKey } from '../../../shared/skins.js';

export function createSkinsRouter({ db, ownedOf = (id) => walletReader(id).owned() } = {}) {
    const router = Router();
    const opts = db ? { db } : {};
    const fail = (res, where, err) => {
        console.error(where, err);
        res.status(500).json({ error: { code: 'internal', message: 'сервер не ответил — попробуйте ещё раз' } });
    };
    router.get('/', async (req, res) => {
        try {
            const [skins, mine, claims] = await Promise.all([
                store.listSkins(opts), store.mySkin(req.user.id, opts), store.listClaims(opts)]);
            res.json({ skins, claims, canEdit: canEditSkin(req.user), mine });
        } catch (err) { fail(res, 'GET /api/skins', err); }
    });

    router.put('/me', async (req, res) => {
        const { skin, error } = cleanSkin(req.body);
        if (error) return res.status(400).json({ error: { code: 'bad_request', message: error } });
        try {
            if (!canEditSkin(req.user)) {
                const owned = new Set((await ownedOf(req.user.id)).map(o => `${o.pack}:${o.part}`));
                const foreign = Object.entries(skin.parts).find(([part, pack]) => pack && !owned.has(`${pack}:${part}`));
                if (foreign) {
                    return res.status(403).json({ error: { code: 'not_owned', message: 'этой части скина у вас ещё нет — она выпадает из кейсов' } });
                }
            }
            await store.saveSkin(req.user.id, skin, opts);
            res.json({ ok: true, mine: skin });
        } catch (err) { fail(res, 'PUT /api/skins/me', err); }
    });

    // Сел под код во вкладке «Лиды» (её открытие и смена кода). Зовут ВСЕ, а
    // не только носящие скин: сменщик без скина тоже должен занять код, иначе
    // его звонки достанутся тому, у кого скин есть.
    router.put('/me/operator', async (req, res) => {
        try {
            const changed = await store.claimOperator(req.user.id, skinOperatorKey(req.body?.operator), opts);
            res.json({ ok: true, changed });
        } catch (err) { fail(res, 'PUT /api/skins/me/operator', err); }
    });

    return router;
}

export default createSkinsRouter();
