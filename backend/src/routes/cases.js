// ─────────────────────────────────────────────────────────────────────────────
// Кейсы и кошелёк — /api/cases (правила — shared/cases.js). Всё, что тратит,
// идёт под замком на человека (cases/store.js → withWallet), а случайность —
// crypto.randomInt на сервере: приз браузер получает готовым.
// ─────────────────────────────────────────────────────────────────────────────

import { randomInt } from 'node:crypto';
import { Router } from 'express';

import defaultStore from '../cases/store.js';
import { planExchange, planKeys, openCase, itemKey, CASES, KEY_PRICE, SMALL_CASE_PRICE,
    RECORDS_PER_GEM, RUBLES_PER_GEM, XP_PER_GEM, DUP_XP_SMALL, DUP_XP_BIG, casePacks } from '../../../shared/cases.js';

export const PRICES = {
    key: KEY_PRICE, small: SMALL_CASE_PRICE, recordsPerGem: RECORDS_PER_GEM,
    rublesPerGem: RUBLES_PER_GEM, xpPerGem: XP_PER_GEM, dupXpSmall: DUP_XP_SMALL, dupXpBig: DUP_XP_BIG,
};

export function createCasesRouter({ store = defaultStore, rand = (n) => randomInt(n) } = {}) {
    const router = Router();
    const fail = (res, where, err) => {
        console.error(where, err);
        res.status(500).json({ error: { code: 'internal', message: 'сервер не ответил — попробуйте ещё раз' } });
    };
    // Отказ по делу — 409 с цифрами: окно по ним предлагает обмен.
    const refuse = (res, plan) => res.status(409).json({
        error: { code: plan.needKey ? 'need_key' : 'refused', message: plan.error, short: plan.short ?? null },
    });

    router.get('/', async (req, res) => {
        try {
            const r = store.reader(req.user.id);
            const [balance, owned] = await Promise.all([r.balance(), r.owned()]);
            res.json({ balance, owned, prices: PRICES, packs: casePacks() });
        } catch (err) { fail(res, 'GET /api/cases', err); }
    });

    router.post('/exchange', async (req, res) => {
        try {
            const out = await store.withWallet(req.user.id, async (w) => {
                const plan = planExchange(await w.balance(), String(req.body?.from || ''), req.body?.gems);
                if (plan.error) return { plan };
                await w.ledger(plan.row);
                return { balance: await w.balance() };
            });
            if (out.plan) return refuse(res, out.plan);
            res.json(out);
        } catch (err) { fail(res, 'POST /api/cases/exchange', err); }
    });

    router.post('/key', async (req, res) => {
        try {
            const out = await store.withWallet(req.user.id, async (w) => {
                const plan = planKeys(await w.balance(), req.body?.count ?? 1);
                if (plan.error) return { plan };
                await w.ledger(plan.row);
                return { balance: await w.balance() };
            });
            if (out.plan) return refuse(res, out.plan);
            res.json(out);
        } catch (err) { fail(res, 'POST /api/cases/key', err); }
    });

    router.post('/open', async (req, res) => {
        const kind = String(req.body?.kind || '');
        if (!CASES[kind]) return res.status(400).json({ error: { code: 'bad_request', message: 'такого кейса нет' } });
        try {
            const out = await store.withWallet(req.user.id, async (w) => {
                const owned = new Set((await w.owned()).map(itemKey));
                const plan = openCase(kind, { balance: await w.balance(), owned, rand });
                if (plan.error) return { plan };
                await w.ledger(plan.row);
                await w.grant(plan.grant, `case_${kind}`);
                return {
                    prize: plan.prize, grant: plan.grant, dup: plan.dup, xp: plan.row.xp,
                    balance: await w.balance(), owned: await w.owned(),
                };
            });
            if (out.plan) return refuse(res, out.plan);
            res.json(out);
        } catch (err) { fail(res, 'POST /api/cases/open', err); }
    });

    return router;
}

export default createCasesRouter();
