// ─────────────────────────────────────────────────────────────────────────────
// Прощальная страница — /api/farewell. Открыта без входа (за x-api-key, как всё
// под /api): сотрудники подписали отказ от сайта, и страница «спасибо» не
// должна требовать аккаунта.
//
// Отдаёт ровно три вещи: кто скидывался на сервер (только имя и аватар — сумм
// на открытой странице нет), сколько серверу осталось и счётчик «F».
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';

import { query } from '../db/client.js';
import * as donations from '../donations/store.js';
import { clampDelta } from '../news/buttons.js';
import { mskToday, monthOf } from '../../../shared/donations.js';

export function createFarewellRouter({ db = query, serverBalance, now = () => Date.now() } = {}) {
    const router = Router();
    const fail = (res, where, err) => {
        console.error(where, err);
        res.status(500).json({ error: 'сервер не ответил' });
    };
    const readF = async () => Number((await db('SELECT clicks FROM farewell_f WHERE id = 1')).rows[0]?.clicks || 0);

    router.get('/', async (req, res) => {
        try {
            const [donors, server, f] = await Promise.all([
                donations.listDonors(monthOf(mskToday(now())), { db }),
                serverBalance ? serverBalance.get().catch(() => null) : null,
                readF(),
            ]);
            res.json({
                donors: donors.map(d => ({ name: d.display_name, avatar: d.avatar || null })),
                server: server?.available ? { hoursLeft: server.hoursLeft, updatedAt: server.updatedAt } : null,
                f,
            });
        } catch (err) { fail(res, 'GET /api/farewell', err); }
    });

    // Нажатия приезжают пачкой (как у кнопки в новостях): по F жмут очередями.
    router.post('/f', async (req, res) => {
        const delta = clampDelta(req.body?.delta);
        try {
            if (!delta) return res.json({ f: await readF() });
            const { rows } = await db(
                `INSERT INTO farewell_f (id, clicks) VALUES (1, $1)
                 ON CONFLICT (id) DO UPDATE SET clicks = farewell_f.clicks + EXCLUDED.clicks
                 RETURNING clicks`,
                [delta],
            );
            res.json({ f: Number(rows[0].clicks) });
        } catch (err) { fail(res, 'POST /api/farewell/f', err); }
    });

    return router;
}
