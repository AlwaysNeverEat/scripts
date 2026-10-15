// ─────────────────────────────────────────────────────────────────────────────
// Задания — /api/quests (правила — shared/quests.js, хранение —
// quests/store.js).
//
//   GET  /         — набор на сегодня и на неделю с прогрессом;
//   POST /claim    — { kind: 'daily' | 'weekly', slot } → опыт в кошелёк;
//   POST /report   — победа над ботом в парной игре (сервер её не видит).
//
// Прогресс считается ЗДЕСЬ, по журналу партий и рабочим таблицам, а не
// приезжает из браузера: «Забрать» проверяет его заново, кнопка — не довод.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';

import defaultStore from '../quests/store.js';
import {
    pickDaily, pickWeekly, measureDaily, measureWeekly, questText, weeklyNote, cleanBotReport,
    GAMES, BEST_KEYS, BOT_REPORTS_PER_DAY, WEEKLY_HISTORY_WEEKS, DAILY_XP, WEEKLY_XP,
    mskDay, mskWeek, dayStart, weekStart,
} from '../../../shared/quests.js';

const DAY = 24 * 3600_000;
const WEEK = 7 * DAY;

export function createQuestsRouter({ store = defaultStore, now = () => Date.now() } = {}) {
    const router = Router();
    const fail = (res, where, err) => {
        console.error(where, err);
        res.status(500).json({ error: { code: 'internal', message: 'сервер не ответил — попробуйте ещё раз' } });
    };

    async function dailySet(userId, t) {
        const period = `d:${mskDay(t)}`;
        let quests = await store.getSet(userId, period);
        if (!quests) {
            const raw = await store.bests(userId);
            const bests = Object.fromEntries(Object.keys(BEST_KEYS).map(g => [g, Number(raw?.[g]) || 0]));
            quests = await store.saveSet(userId, period, pickDaily({ userId, day: mskDay(t), bests }));
        }
        return { period, quests };
    }

    async function weeklySet(userId, t) {
        const period = `w:${mskWeek(t)}`;
        let quests = await store.getSet(userId, period);
        if (!quests) {
            const ws = weekStart(t);
            const past = await store.workCounts(userId, ws - WEEKLY_HISTORY_WEEKS * WEEK, ws);
            const avg = {
                records: (Number(past?.records) || 0) / WEEKLY_HISTORY_WEEKS,
                cars: (Number(past?.cars) || 0) / WEEKLY_HISTORY_WEEKS,
            };
            quests = await store.saveSet(userId, period, [pickWeekly({ userId, week: mskWeek(t), avg })]);
        }
        return { period, quests };
    }

    // Всё состояние разом: окно перерисовывается целиком, а «Забрать» отвечает
    // тем же, чтобы второй запрос за состоянием не понадобился.
    async function snapshot(userId) {
        const t = now();
        const ds = dayStart(t), ws = weekStart(t);
        const [daily, weekly, results, counts] = await Promise.all([
            dailySet(userId, t), weeklySet(userId, t),
            store.results(userId, ds, ds + DAY), store.workCounts(userId, ws, ws + WEEK),
        ]);
        const claims = await store.claims(userId, [daily.period, weekly.period]);
        const claimed = (period, slot) => claims.some(c => c.period === period && Number(c.slot) === slot);
        return {
            day: mskDay(t), resetAt: new Date(ds + DAY).toISOString(),
            week: mskWeek(t), weekResetAt: new Date(ws + WEEK).toISOString(),
            daily: daily.quests.map(q => ({
                // Награда — НЫНЕШНЯЯ, а не замороженная в наборе: заморозка
                // держит пороги, а поднятая награда достаётся и уже выданному.
                slot: q.slot, id: q.id, game: q.game, gameLabel: GAMES[q.game], xp: DAILY_XP,
                text: questText(q),
                ...measureDaily(q, results.filter(r => r.game === q.game)),
                claimed: claimed(daily.period, q.slot),
            })),
            weekly: weekly.quests.map(q => ({
                slot: q.slot, id: q.id, kind: q.kind, xp: WEEKLY_XP,
                text: questText(q), note: weeklyNote(q),
                ...measureWeekly(q, counts),
                claimed: claimed(weekly.period, q.slot),
            }))[0],
            _periods: { daily: daily.period, weekly: weekly.period },
        };
    }

    const present = ({ _periods, ...rest }) => rest;

    router.get('/', async (req, res) => {
        try {
            res.json(present(await snapshot(req.user.id)));
        } catch (err) { fail(res, 'GET /api/quests', err); }
    });

    router.post('/claim', async (req, res) => {
        try {
            const kind = req.body?.kind === 'weekly' ? 'weekly' : 'daily';
            const slot = Math.trunc(Number(req.body?.slot));
            const snap = await snapshot(req.user.id);
            const q = kind === 'weekly' ? (slot === 0 ? snap.weekly : null) : snap.daily.find(d => d.slot === slot);
            if (!q) return res.status(404).json({ error: { code: 'no_quest', message: 'такого задания нет' } });
            if (q.claimed) return res.status(409).json({ error: { code: 'claimed', message: 'награда уже забрана' } });
            if (!q.done) return res.status(409).json({ error: { code: 'not_done', message: 'задание ещё не выполнено' } });
            const ok = await store.claim(req.user.id, { period: snap._periods[kind], slot, questId: q.id, xp: q.xp });
            if (!ok) return res.status(409).json({ error: { code: 'claimed', message: 'награда уже забрана' } });
            res.json({ ...present(await snapshot(req.user.id)), gained: q.xp });
        } catch (err) { fail(res, 'POST /api/quests/claim', err); }
    });

    router.post('/report', async (req, res) => {
        try {
            const row = cleanBotReport(req.body);
            if (!row) return res.status(400).json({ error: { code: 'bad_report', message: 'не похоже на партию' } });
            const n = await store.botReportsSince(req.user.id, dayStart(now()));
            if (n >= BOT_REPORTS_PER_DAY) return res.json({ ok: false });
            await store.logResult(req.user.id, row.game, row.data);
            res.json({ ok: true });
        } catch (err) { fail(res, 'POST /api/quests/report', err); }
    });

    return router;
}

export default createQuestsRouter();
