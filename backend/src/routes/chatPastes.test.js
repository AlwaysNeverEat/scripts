// Пасты «Чатов»: настоящий роутер поверх маленькой базы в памяти. Сам SQL
// проверялся на живом Postgres; здесь — что ручки пропускают, чистят и
// отказывают.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createPastesRouter } from './chatPastes.js';
import { DEFAULT_PASTES } from '../../../shared/chatPastes.js';

// База в памяти: ровно те запросы, что шлёт chat/pastes.js.
function fakeDb() {
    const rows = [];
    const seeded = new Set();
    let seq = 0;
    const pub = (r) => ({ id: String(r.id), title: r.title, body: r.body, topics: r.topics });
    const db = async (sql, p) => {
        if (sql.includes('INSERT INTO chat_paste_seeded')) {
            if (!seeded.has(p[0])) {
                seeded.add(p[0]);
                for (const d of JSON.parse(p[1])) rows.push({ id: ++seq, user: p[0], ...d });
            }
            return { rows: [] };
        }
        if (sql.includes('SELECT DISTINCT unnest')) return { rows: [...new Set(rows.filter(r => r.user === p[0]).flatMap(r => r.topics))].map(t => ({ t })) };
        if (sql.startsWith('SELECT')) return { rows: rows.filter(r => r.user === p[0]).map(pub) };
        if (sql.includes('INSERT INTO chat_pastes')) {
            if (rows.filter(r => r.user === p[0]).length >= p[4]) return { rows: [] };
            const r = { id: ++seq, user: p[0], title: p[1], body: p[2], topics: p[3] };
            rows.push(r);
            return { rows: [pub(r)] };
        }
        if (sql.startsWith('UPDATE')) {
            const r = rows.find(x => String(x.id) === p[1] && x.user === p[0]);
            if (!r) return { rows: [] };
            Object.assign(r, { title: p[2], body: p[3], topics: p[4] });
            return { rows: [pub(r)] };
        }
        if (sql.startsWith('DELETE')) {
            const i = rows.findIndex(x => String(x.id) === p[1] && x.user === p[0]);
            if (i >= 0) rows.splice(i, 1);
            return { rowCount: i >= 0 ? 1 : 0 };
        }
        throw new Error('fakeDb: незнакомый запрос ' + sql);
    };
    return { db, rows };
}

async function serve(t, router, userId = 'u1') {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: req.get('x-user') || userId }; next(); });
    app.use('/', router);
    const srv = app.listen(0);
    t.after(() => srv.close());
    const base = `http://127.0.0.1:${srv.address().port}`;
    return async (path, { method = 'GET', body, user } = {}) => {
        const headers = { 'Content-Type': 'application/json', ...(user ? { 'x-user': user } : {}) };
        const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
        return { status: r.status, json: await r.json() };
    };
}

test('первое открытие — стартовый набор, по порядку', async (t) => {
    const { db } = fakeDb();
    const call = await serve(t, createPastesRouter({ db }));
    const { json } = await call('/');
    assert.deepEqual(json.pastes.map(p => p.title), DEFAULT_PASTES.map(p => p.title));
    assert.equal((await call('/')).json.pastes.length, DEFAULT_PASTES.length, 'второй раз набор не добавляется');
});

test('новая паста: тема другим регистром пишется как существующая', async (t) => {
    const { db } = fakeDb();
    const call = await serve(t, createPastesRouter({ db }));
    await call('/');
    const r = await call('/', { method: 'POST', body: { title: ' Акция ', body: 'Счастливые часы с 9 до 11', topics: ['расчёт', 'Акции', 'акции'] } });
    assert.equal(r.status, 201);
    assert.deepEqual(r.json.paste.topics, ['Расчёт', 'Акции']);
    assert.equal(r.json.paste.title, 'Акция');
});

test('пустая паста не сохраняется', async (t) => {
    const call = await serve(t, createPastesRouter(fakeDb()));
    const r = await call('/', { method: 'POST', body: { title: 'x', body: '  ' } });
    assert.equal(r.status, 400);
    assert.match(r.json.error.message, /пустой/);
});

test('правка и удаление — только своих паст', async (t) => {
    const { db } = fakeDb();
    const call = await serve(t, createPastesRouter({ db }));
    const id = (await call('/')).json.pastes[0].id;
    assert.equal((await call(`/${id}`, { method: 'PUT', body: { body: 'чужое', topics: [] }, user: 'u2' })).status, 404);
    const r = await call(`/${id}`, { method: 'PUT', body: { title: 'Авто', body: 'Марка и год?', topics: ['Сбор данных', 'Общее'] } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.paste.topics, ['Сбор данных', 'Общее']);
    assert.equal((await call(`/${id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await call(`/${id}`, { method: 'DELETE' })).status, 200, 'удалить удалённое — не ошибка');
    assert.equal((await call(`/${id}`, { method: 'PUT', body: { body: 'x' } })).status, 404);
    assert.equal((await call('/abc', { method: 'DELETE' })).status, 400);
});
