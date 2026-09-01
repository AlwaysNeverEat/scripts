// ─────────────────────────────────────────────────────────────────────────────
// Состояние самого сервера — пока это только баланс облачного счёта
// Рег.облака и срок, на который его хватит (см. ../regcloud/balance.js).
//
// Видно ВСЕМ вошедшим, а не только модераторам, и это осознанно: сайт живёт на
// предоплаченном счёте, и когда он кончится, ляжет всё — записи, калькулятор,
// CRM-панель. Человеку, который придёт утром к мёртвому сайту, полезнее знать
// заранее, что «денег на четыре дня», чем гадать, что сломалось.
//
// Токен наружу не уходит ни в каком виде: браузер видит только разобранные
// цифры (см. шапку balance.js).
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { getBalance, isConfigured } from '../regcloud/balance.js';

const router = Router();

// ── GET /api/server/balance ──────────────────────────────────────────────────
// { configured: false }                                — токен не задан
// { configured: true, balance, bonus, hourly, monthly,
//   hoursLeft, daysLeft, items: [{ label, hourly, monthly }],
//   checkedAt, stale }
//
// «Токена нет» — это 200 с configured: false, а не ошибка: на машине
// разработчика и в чужой копии проекта его и не должно быть, а панель в этом
// случае просто не показывается. Ошибкой был бы недоступный API при живом
// токене — вот там 502.
router.get('/balance', async (req, res) => {
    if (!isConfigured()) return res.json({ configured: false });
    try {
        res.json({ configured: true, ...await getBalance() });
    } catch (err) {
        console.error('GET /api/server/balance', err);
        res.status(502).json({ error: err.message });
    }
});

export default router;
