// ─────────────────────────────────────────────────────────────────────────────
// Вкладка «Новости»: сами посты лежат в frontend/src/newsData.js и серверу не
// нужны вовсе. Серверу нужна одна вещь — счётчик нажатий на кнопку внутри
// поста (backend/src/news/buttons.js).
//
// Ручек две: спросить счётчики при открытии вкладки и прибавить пачку
// нажатий. Пачку — потому что по кнопке щёлкают очередями, и запрос на каждый
// щелчок превратил бы пасхалку в обстрел базы.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { counts, bump, clampDelta, knownButton } from '../news/buttons.js';

const router = Router();

// ── GET /api/news/buttons/:id ────────────────────────────────────────────────
// → { total, mine }
router.get('/buttons/:id', async (req, res) => {
    const id = String(req.params.id);
    if (!knownButton(id)) return res.status(404).json({ error: 'нет такой кнопки' });
    try {
        res.json(await counts(id, req.user.id));
    } catch (err) {
        console.error('GET /api/news/buttons', err);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/news/buttons/:id/click ─────────────────────────────────────────
// { delta } → { total, mine }
//
// Мусорная и отрицательная пачка не ошибка, а ноль: ответ тот же самый, просто
// без прибавки. Окно на этом месте ничего осмысленного показать не может, а
// 400 на кнопке-пасхалке выглядел бы как поломка сайта.
router.post('/buttons/:id/click', async (req, res) => {
    const id = String(req.params.id);
    if (!knownButton(id)) return res.status(404).json({ error: 'нет такой кнопки' });
    try {
        res.json(await bump(id, req.user.id, clampDelta(req.body?.delta)));
    } catch (err) {
        console.error('POST /api/news/buttons/click', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;
