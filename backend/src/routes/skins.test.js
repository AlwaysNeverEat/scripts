// Скины: настоящий роутер поверх маленькой базы в памяти — кто что может.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createSkinsRouter } from './skins.js';

const EDITOR = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', login: 'gtrixoff' };
const USER = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', login: 'borya' };

function fakeDb() {
    const rows = new Map();
    // operator_claims в памяти — те же три запроса, что у store.js. Сам SQL
    // проверялся на живом Postgres; тут — что роутер зовёт их как надо.
    const claims = [];
    const last = (code) => claims.filter(c => c.code === code).at(-1);
    return async (sql, p) => {
        if (sql.includes('FROM operator_claims c')) {
            return { rows: claims.map(c => ({ code: c.code, user_id: c.userId, at: new Date(c.at) })) };
        }
        if (sql.includes('INSERT INTO operator_claims') && sql.includes('NULL::uuid')) {
            const codes = [...new Set(claims.map(c => c.code))].filter(k => k !== p[1] && last(k).userId === p[0]);
            for (const code of codes) claims.push({ code, userId: null, at: Date.now() });
            return { rows: [], rowCount: codes.length };
        }
        if (sql.includes('INSERT INTO operator_claims')) {
            if (last(p[1])?.userId === p[0]) return { rows: [], rowCount: 0 };
            claims.push({ code: p[1], userId: p[0], at: Date.now() });
            return { rows: [], rowCount: 1 };
        }
        if (sql.trim() === 'SELECT user_id, parts, operator FROM user_skins') return { rows: [...rows.values()] };
        if (sql.startsWith('SELECT') && sql.includes('WHERE user_id = $1')) return { rows: rows.has(p[0]) ? [rows.get(p[0])] : [] };
        if (sql.startsWith('INSERT INTO user_skins')) {
            rows.set(p[0], { user_id: p[0], parts: JSON.parse(p[1]), operator: p[2] });
            return { rows: [] };
        }
        throw new Error('fakeDb: незнакомый запрос ' + sql);
    };
}

async function serve(t, owned = {}) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = req.get('x-editor') ? EDITOR : USER; next(); });
    app.use('/', createSkinsRouter({ db: fakeDb(), ownedOf: async (id) => owned[id] || [] }));
    const srv = app.listen(0);
    t.after(() => srv.close());
    const base = `http://127.0.0.1:${srv.address().port}`;
    return async (path, { method = 'GET', body, editor = false } = {}) => {
        const headers = { 'Content-Type': 'application/json', ...(editor ? { 'x-editor': '1' } : {}) };
        const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
        return { status: r.status, json: await r.json() };
    };
}

test('надеть можно только своё, редактор — что угодно, видят все', async (t) => {
    const call = await serve(t, { [USER.id]: [{ pack: 'fox', part: 'frame' }] });
    const foreign = await call('/me', { method: 'PUT', body: { parts: { frame: 'cat' } } });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.json.error.code, 'not_owned');
    assert.equal((await call('/me', { method: 'PUT', body: { parts: { frame: 'fox', cover: 'fox' } } })).status, 403);
    assert.equal((await call('/me', { method: 'PUT', body: { parts: { frame: 'fox' } } })).status, 200);
    assert.equal((await call('/')).json.mine.parts.frame, 'fox');

    const put = await call('/me', { method: 'PUT', editor: true, body: { parts: { frame: 'cat' }, operator: '0103' } });
    assert.equal(put.status, 200);

    const seen = await call('/');
    assert.equal(seen.json.canEdit, false);
    assert.deepEqual(seen.json.skins.find(s => s.userId === EDITOR.id),
        { userId: EDITOR.id, parts: { frame: 'cat', cover: null, leads: null, records: null }, operator: '103' });

    const own = await call('/', { editor: true });
    assert.equal(own.json.canEdit, true);
    assert.equal(own.json.mine.parts.frame, 'cat');
});

test('незнакомый пак — отказ, снятый скин пропадает из списка', async (t) => {
    const call = await serve(t);
    assert.equal((await call('/me', { method: 'PUT', editor: true, body: { parts: { leads: 'dragon' } } })).status, 400);
    await call('/me', { method: 'PUT', editor: true, body: { parts: { leads: 'cat' } } });
    assert.equal((await call('/')).json.skins.length, 1);
    await call('/me', { method: 'PUT', editor: true, body: { parts: {} } });
    assert.deepEqual((await call('/')).json.skins, []);
});

test('код оператора занимают: сменщик без скина забирает код себе', async (t) => {
    const call = await serve(t);
    await call('/me', { method: 'PUT', editor: true, body: { parts: { leads: 'cat' } } });
    assert.equal((await call('/me/operator', { method: 'PUT', editor: true, body: { operator: '0101' } })).json.changed, true);
    assert.equal((await call('/me/operator', { method: 'PUT', editor: true, body: { operator: '101' } })).json.changed, false, 'повтор не пишется');
    // Сменщик без строки скина вовсе — раньше его код никуда не записывался.
    assert.equal((await call('/me/operator', { method: 'PUT', body: { operator: '101' } })).json.changed, true);
    const { claims } = (await call('/')).json;
    assert.deepEqual(claims.map(c => [c.code, c.userId]), [['101', EDITOR.id], ['101', USER.id]]);
    // Пересел на другой код — прежний освобождается.
    await call('/me/operator', { method: 'PUT', body: { operator: '105' } });
    assert.deepEqual((await call('/')).json.claims.slice(-2).map(c => [c.code, c.userId]), [['101', null], ['105', USER.id]]);
});
