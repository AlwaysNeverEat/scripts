// Поддержавшие проект: настоящий роутер поверх маленькой базы в памяти. Сам
// SQL проверялся на живом Postgres; здесь — кто что может и что отказывается.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createDonorsRouter } from './donors.js';

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
    const call = await serve(t, createDonorsRouter({ db, now: () => NOW }));
    const pub = await call('/');
    assert.deepEqual(pub.json, { month: '2026-10', donors: [], canManage: false });
    assert.equal((await call('/', { admin: true })).json.canManage, true);
    assert.equal((await call('/entries', { method: 'POST', body: { userId: USER.id, date: '2026-10-01', amount: 500 } })).status, 403);
    assert.equal((await call('/users?q=бор')).status, 403);
    assert.equal((await call('/entries/1', { method: 'DELETE' })).status, 403);
});

test('пополнение попадает в «всего» и в «за месяц» своего месяца', async (t) => {
    const { db } = fakeDb();
    const call = await serve(t, createDonorsRouter({ db, now: () => NOW }));
    const a = await call('/entries', { method: 'POST', admin: true, body: { userId: USER.id, date: '2026-09-28', amount: '1 000' } });
    assert.equal(a.status, 201);
    await call('/entries', { method: 'POST', admin: true, body: { userId: USER.id, date: '2026-10-03', amount: 500 } });
    const { json } = await call('/');
    assert.deepEqual(json.donors.map(d => [d.id, d.total, d.month]), [[USER.id, 1500, 500]]);
});

test('ошибки внесения — словами, а не 500', async (t) => {
    const { db } = fakeDb();
    const call = await serve(t, createDonorsRouter({ db, now: () => NOW }));
    const future = await call('/entries', { method: 'POST', admin: true, body: { userId: USER.id, date: '2026-10-20', amount: 1 } });
    assert.equal(future.status, 400);
    assert.match(future.json.error.message, /будущем/);
    const nobody = await call('/entries', { method: 'POST', admin: true, body: { userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', date: '2026-10-01', amount: 1 } });
    assert.equal(nobody.status, 404);
    assert.equal((await call('/entries/abc', { method: 'DELETE', admin: true })).status, 400);
});
