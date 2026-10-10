// Поддержавшие проект: настоящий роутер поверх маленькой базы в памяти. Сам
// SQL проверялся на живом Postgres; здесь — кто что может и что отказывается.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createDonorsRouter } from './donors.js';
import { createServerBalance, REFRESH_MS } from '../donations/serverBalance.js';

const ADMIN = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', login: 'gtrixoff' };
const USER = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', login: 'borya' };
const NOW = Date.UTC(2026, 9, 9, 9, 0);

function fakeDb() {
    const entries = [];
    let seq = 0;
    const db = async (sql, p) => {
        if (sql.startsWith('INSERT INTO donations')) {
            if (![ADMIN.id, USER.id].includes(p[0])) return { rows: [] };
            const r = { id: String(++seq), amount_rub: p[1], date: p[2], user_id: p[0] };
            entries.push(r);
            return { rows: [r] };
        }
        if (sql.includes('GROUP BY')) {
            const by = new Map();
            for (const e of entries) {
                const d = by.get(e.user_id) || { id: e.user_id, display_name: e.user_id === USER.id ? 'Боря' : 'Вася', total: 0, month: 0, last: '' };
                d.total += e.amount_rub;
                if (e.date.startsWith(p[0])) d.month += e.amount_rub;
                if (e.date > d.last) d.last = e.date;
                by.set(e.user_id, d);
            }
            return { rows: [...by.values()] };
        }
        if (sql.startsWith('DELETE')) {
            const i = entries.findIndex(e => e.id === p[0]);
            if (i >= 0) entries.splice(i, 1);
            return { rowCount: i >= 0 ? 1 : 0 };
        }
        if (sql.includes('FROM donations d')) return { rows: entries.map(e => ({ id: e.id, amount_rub: e.amount_rub, date: e.date, user_id: e.user_id, display_name: '?' })) };
        if (sql.includes('FROM users u')) return { rows: [{ id: USER.id, display_name: 'Боря', login: 'borya' }] };
        throw new Error('fakeDb: незнакомый запрос ' + sql);
    };
    return { db, entries };
}

async function serve(t, router) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = req.get('x-admin') ? ADMIN : USER; next(); });
    app.use('/', router);
    const srv = app.listen(0);
    t.after(() => srv.close());
    const base = `http://127.0.0.1:${srv.address().port}`;
    return async (path, { method = 'GET', body, admin = false } = {}) => {
        const headers = { 'Content-Type': 'application/json', ...(admin ? { 'x-admin': '1' } : {}) };
        const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
        return { status: r.status, json: await r.json() };
    };
}

test('список видят все, вносить может только один аккаунт', async (t) => {
    const { db } = fakeDb();
    const call = await serve(t, createDonorsRouter({ db, now: () => NOW, serverBalance: createServerBalance({ token: '' }) }));
    const pub = await call('/');
    assert.deepEqual(pub.json, { month: '2026-10', donors: [], canManage: false, server: null });
    assert.equal((await call('/', { admin: true })).json.canManage, true);
    assert.equal((await call('/entries', { method: 'POST', body: { userId: USER.id, date: '2026-10-01', amount: 500 } })).status, 403);
    assert.equal((await call('/users?q=бор')).status, 403);
    assert.equal((await call('/entries/1', { method: 'DELETE' })).status, 403);
});

test('пополнение попадает в «всего» и в «за месяц» своего месяца', async (t) => {
    const { db } = fakeDb();
    const call = await serve(t, createDonorsRouter({ db, now: () => NOW, serverBalance: createServerBalance({ token: '' }) }));
    const a = await call('/entries', { method: 'POST', admin: true, body: { userId: USER.id, date: '2026-09-28', amount: '1 000' } });
    assert.equal(a.status, 201);
    await call('/entries', { method: 'POST', admin: true, body: { userId: USER.id, date: '2026-10-03', amount: 500 } });
    const { json } = await call('/');
    assert.deepEqual(json.donors.map(d => [d.id, d.total, d.month]), [[USER.id, 1500, 500]]);
});

test('ошибки внесения — словами, а не 500', async (t) => {
    const { db } = fakeDb();
    const call = await serve(t, createDonorsRouter({ db, now: () => NOW, serverBalance: createServerBalance({ token: '' }) }));
    const future = await call('/entries', { method: 'POST', admin: true, body: { userId: USER.id, date: '2026-10-20', amount: 1 } });
    assert.equal(future.status, 400);
    assert.match(future.json.error.message, /будущем/);
    const nobody = await call('/entries', { method: 'POST', admin: true, body: { userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', date: '2026-10-01', amount: 1 } });
    assert.equal(nobody.status, 404);
    assert.equal((await call('/entries/abc', { method: 'DELETE', admin: true })).status, 400);
});

// ── Счёт сервера из Рег.облака ───────────────────────────────────────────────

const quiet = { warn() {} };
const BALANCE = { balance_data: { balance: 2154.55, bonus_balance: 0, hourly_cost: 4, hours_left: 538, monthly_cost: 2896.83, detalization: [{ name: 'k-spot', plan: 'cloud-3' }] } };

function fakeCloud(reply) {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, auth: init.headers.Authorization });
        const r = typeof reply === 'function' ? reply() : reply;
        if (r instanceof Error) throw r;
        return { ok: r.status === 200, status: r.status, text: async () => r.body };
    };
    return { calls, fetchImpl };
}

test('счёт: без токена его нет вовсе, и в Рег.облако никто не ходит', async () => {
    const cloud = fakeCloud({ status: 200, body: JSON.stringify(BALANCE) });
    const sb = createServerBalance({ token: '', fetchImpl: cloud.fetchImpl, log: quiet });
    assert.equal(await sb.get(), null);
    assert.equal(cloud.calls.length, 0);
});

test('счёт: токен уходит только в Рег.облако, наружу — цифры без детализации', async (t) => {
    const { db } = fakeDb();
    const cloud = fakeCloud({ status: 200, body: JSON.stringify(BALANCE) });
    const serverBalance = createServerBalance({ token: 'SECRET', fetchImpl: cloud.fetchImpl, now: () => NOW, log: quiet });
    const call = await serve(t, createDonorsRouter({ db, now: () => NOW, serverBalance }));
    const { json } = await call('/');
    assert.equal(cloud.calls[0].url, 'https://api.cloudvps.reg.ru/v1/balance_data');
    assert.equal(cloud.calls[0].auth, 'Bearer SECRET');
    assert.deepEqual(json.server, {
        available: true, balance: 2154.55, bonus: 0, monthlyCost: 2896.83, hoursLeft: 538,
        updatedAt: new Date(NOW).toISOString(), stale: false,
    });
    const raw = JSON.stringify(json);
    assert.equal(raw.includes('SECRET'), false);
    assert.equal(raw.includes('k-spot'), false);
});

test('счёт: в Рег.облако — раз в 15 минут, а «осталось» между опросами тикает вниз', async () => {
    let t = NOW;
    const cloud = fakeCloud({ status: 200, body: JSON.stringify(BALANCE) });
    const sb = createServerBalance({ token: 'x', fetchImpl: cloud.fetchImpl, now: () => t, log: quiet });
    await sb.get();
    t += 14 * 60_000; // 15 минут ещё не прошло — в Рег.облако рано
    const v = await sb.get();
    assert.equal(cloud.calls.length, 1);
    assert.equal(v.hoursLeft, 538 - 14 / 60);
    t += 2 * 60_000;
    await sb.get();
    assert.equal(cloud.calls.length, 2, `снимок старше ${REFRESH_MS / 60_000} минут — обновляем фоном`);
});

test('счёт: упал Рег.облако — отдаём последний удачный, а не ошибку', async () => {
    let t = NOW;
    let reply = { status: 200, body: JSON.stringify(BALANCE) };
    const cloud = fakeCloud(() => reply);
    const sb = createServerBalance({ token: 'x', fetchImpl: cloud.fetchImpl, now: () => t, log: quiet });
    await sb.get();
    reply = { status: 503, body: 'down' };
    t += 40 * 60_000;
    await sb.get();                 // запускает фоновое обновление
    await new Promise(r => setImmediate(r));
    const v = await sb.get();
    assert.equal(v.available, true);
    assert.equal(v.stale, true);
    assert.equal(v.balance, 2154.55);
});

test('счёт: первый запрос не прошёл — панель получает «нет данных», список не страдает', async (t) => {
    const { db } = fakeDb();
    const cloud = fakeCloud(new Error('ECONNREFUSED'));
    const serverBalance = createServerBalance({ token: 'x', fetchImpl: cloud.fetchImpl, now: () => NOW, log: quiet });
    const call = await serve(t, createDonorsRouter({ db, now: () => NOW, serverBalance }));
    const r = await call('/');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.server, { available: false });
});

test('счёт: висящая запятая из примера документации не ломает разбор', async () => {
    const cloud = fakeCloud({ status: 200, body: '{"balance_data":{"balance":10,"hours_left":5,"monthly_cost":7,}}' });
    const sb = createServerBalance({ token: 'x', fetchImpl: cloud.fetchImpl, now: () => NOW, log: quiet });
    assert.equal((await sb.get()).hoursLeft, 5);
});
