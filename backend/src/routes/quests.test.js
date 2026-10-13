// Задания: настоящий роутер поверх хранилища в памяти — набор, прогресс по
// журналу, забор опыта ровно один раз, отчёты о партиях с ботом.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createQuestsRouter } from './quests.js';
import { DAILY_XP, WEEKLY_XP, BOT_REPORTS_PER_DAY, mskDay } from '../../../shared/quests.js';

const ME = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
const NOW = Date.parse('2026-10-13T09:00:00Z');

function memStore({ past = { records: 0, cars: 0 }, week = { records: 0, cars: 0 }, bests = {} } = {}) {
    const sets = new Map();
    const log = [];
    const claims = [];
    const ledger = [];
    let chain = Promise.resolve();
    return {
        log, claims, ledger, week,
        async getSet(_u, period) { return sets.get(period) || null; },
        async saveSet(_u, period, q) { if (!sets.has(period)) sets.set(period, q); return sets.get(period); },
        async bests() { return bests; },
        async results(_u, from, to) { return log.filter(r => r.at >= from && r.at < to); },
        // «Прошлые недели» и «эта неделя» различаются по началу отрезка.
        async workCounts(_u, from, to) { return to - from > 8 * 86400_000 ? past : week; },
        async claims() { return claims.map(c => ({ ...c })); },
        claim(_u, { period, slot, xp }) {
            const run = chain.then(() => {
                if (claims.some(c => c.period === period && c.slot === slot)) return false;
                claims.push({ period, slot });
                ledger.push({ kind: 'quest', xp });
                return true;
            });
            chain = run.catch(() => {});
            return run;
        },
        async botReportsSince(_u, from) { return log.filter(r => r.at >= from && r.data.vs === 'bot').length; },
        async logResult(_u, game, data) { log.push({ game, data, at: NOW }); },
    };
}

async function serve(t, store, now = () => NOW) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = ME; next(); });
    app.use('/q', createQuestsRouter({ store, now }));
    const srv = app.listen(0);
    t.after(() => srv.close());
    const base = `http://127.0.0.1:${srv.address().port}/q`;
    return async (path, body) => {
        const r = await fetch(base + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
        return { status: r.status, body: await r.json() };
    };
}

// Записать в журнал партию, которая закрывает дневное задание slot.
function satisfy(store, q) {
    const data = {
        'wordle-time': { won: true, seconds: 30, guesses: 3 }, 'wordle-tries': { won: true, guesses: 2, seconds: 60 },
        'kontekst-tries': { won: true, guesses: 10, hints: 0 }, 'kontekst-nohint': { won: true, guesses: 10, hints: 0 },
        'minesweeper-wins': { won: true, seconds: 100 }, 'minesweeper-time': { won: true, seconds: 100 },
        'tetris-score': { score: 99999, lines: 99 }, 'tetris-lines': { score: 99999, lines: 99 },
        'troika-score': { score: 99999, cascade: 8 }, 'troika-cascade': { score: 99999, cascade: 8 },
        'solitaire-time': { seconds: 60 }, 'solitaire-wins': { seconds: 60 },
        'mahjong-time': { seconds: 60, shuffles: 0 }, 'mahjong-clean': { seconds: 60, shuffles: 0 },
        'roguelike-floor': { floor: 99, elites: 1 }, 'roguelike-elite': { floor: 99, elites: 1 },
    }[q.id] || { won: true, vs: 'human' };
    const times = q.id === 'minesweeper-wins' || q.id === 'solitaire-wins' ? 2 : 1;
    for (let i = 0; i < times; i++) store.log.push({ game: q.game, data, at: NOW - 1000 });
}

test('набор: три дневных и недельное, второй заход отдаёт тот же', async (t) => {
    const store = memStore();
    const api = await serve(t, store);
    const a = await api('/');
    assert.equal(a.status, 200);
    assert.equal(a.body.daily.length, 3);
    assert.equal(a.body.day, mskDay(NOW));
    assert.equal(a.body.weekly.kind, 'cars');
    assert.equal(a.body.weekly.xp, WEEKLY_XP);
    assert.ok(a.body.daily.every(d => !d.done && !d.claimed && d.text));
    assert.deepEqual((await api('/')).body.daily, a.body.daily);
});

test('забрать: только выполненное и только один раз, опыт — строкой журнала', async (t) => {
    const store = memStore();
    const api = await serve(t, store);
    const { body } = await api('/');
    const q = body.daily[0];
    assert.equal((await api('/claim', { kind: 'daily', slot: q.slot })).body.error.code, 'not_done');

    satisfy(store, q);
    const after = await api('/');
    assert.equal(after.body.daily[0].done, true);

    // Двойной клик: два запроса разом — опыт один.
    const [r1, r2] = await Promise.all([
        api('/claim', { kind: 'daily', slot: q.slot }),
        api('/claim', { kind: 'daily', slot: q.slot }),
    ]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
    assert.deepEqual(store.ledger, [{ kind: 'quest', xp: DAILY_XP }]);
    const ok = r1.status === 200 ? r1.body : r2.body;
    assert.equal(ok.gained, DAILY_XP);
    assert.equal(ok.daily[0].claimed, true);
});

test('вчерашние партии сегодня не считаются', async (t) => {
    const store = memStore();
    const api = await serve(t, store);
    const q = (await api('/')).body.daily[0];
    satisfy(store, q);
    for (const r of store.log) r.at = NOW - 86400_000;
    assert.equal((await api('/')).body.daily[0].done, false);
});

test('недельное: записи оператору, цель от среднего, забирается тысяча', async (t) => {
    // Среднее 40 в неделю — и записи, и машины по силам; ищем неделю с записями.
    let api, store, w;
    for (let i = 0; i < 20 && w?.kind !== 'records'; i++) {
        store = memStore({ past: { records: 160, cars: 0 } });
        api = await serve(t, store, () => NOW + i * 7 * 86400_000);
        w = (await api('/')).body.weekly;
    }
    assert.equal(w.kind, 'records');
    assert.equal(w.label, '0 / 46');
    store.week.records = 46;
    const r = await api('/claim', { kind: 'weekly', slot: 0 });
    assert.equal(r.status, 200);
    assert.equal(r.body.weekly.claimed, true);
    assert.deepEqual(store.ledger, [{ kind: 'quest', xp: WEEKLY_XP }]);
});

test('отчёт о партии с ботом: принимается победа, мусор — 400, потолок в день', async (t) => {
    const store = memStore();
    const api = await serve(t, store);
    assert.equal((await api('/report', { game: 'durak', won: true, level: 'hard' })).body.ok, true);
    assert.deepEqual(store.log.at(-1).data, { won: true, vs: 'bot', level: 2 });
    assert.equal((await api('/report', { game: 'doom', won: true, level: 'hard' })).status, 400);
    for (let i = 1; i < BOT_REPORTS_PER_DAY; i++) await api('/report', { game: 'pool', won: true, level: 'easy' });
    assert.equal((await api('/report', { game: 'pool', won: true, level: 'easy' })).body.ok, false);
});
