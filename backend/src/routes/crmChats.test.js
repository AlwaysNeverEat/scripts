// Вкладка «Чаты»: ручки поверх «Открытых линий» новой CRM. Настоящий роутер с
// подменённой CRM — что уходит в неё и что возвращается сайту.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createChatsRouter } from './crmChats.js';

function fakeCrm(answers) {
    const calls = [];
    const api = async (userId, { query = null, body = null }) => {
        calls.push({ userId, query, body });
        const section = (query || '').match(/section=([a-z_]+)/)?.[1];
        const a = answers[section];
        return typeof a === 'function' ? a({ query, body }) : a;
    };
    return { calls, api };
}

async function serve(t, router) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 'u1' }; next(); });
    app.use('/', router);
    const srv = app.listen(0);
    t.after(() => srv.close());
    const base = `http://127.0.0.1:${srv.address().port}`;
    return async (path, { method = 'GET', body } = {}) => {
        const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        return { status: r.status, json: await r.json() };
    };
}

test('пульс: счётчик и «ждут оператора»', async (t) => {
    const crm = fakeCrm({
        omni_counts: { unread: 3 },
        omni_waiting: { waiting: [{ id: 9, who: 'Олег', channel: 'tg', last_text: 'позовите человека' }] },
    });
    const call = await serve(t, createChatsRouter({ api: crm.api }));
    const r = await call('/pulse');
    assert.deepEqual(r.json, { available: true, unread: 3, waiting: [{ id: '9', who: 'Олег', channel: 'tg', lastText: 'позовите человека' }] });
});

test('пульс: нет права на чаты — «недоступно», и CRM больше не дёргаем', async (t) => {
    const crm = fakeCrm({ omni_counts: { error: 'forbidden', message: 'нет доступа' } });
    const call = await serve(t, createChatsRouter({ api: crm.api }));
    assert.deepEqual((await call('/pulse')).json, { available: false });
    assert.deepEqual((await call('/pulse')).json, { available: false });
    assert.equal(crm.calls.length, 1);
});

test('пульс: «ждут оператора» закрыто роли — счётчик всё равно живёт', async (t) => {
    const crm = fakeCrm({ omni_counts: { unread: 1 }, omni_waiting: { error: 'forbidden' } });
    const call = await serve(t, createChatsRouter({ api: crm.api }));
    assert.deepEqual((await call('/pulse')).json, { available: true, unread: 1, waiting: [] });
});

test('список и диалог', async (t) => {
    const crm = fakeCrm({
        omni_dialogs: { dialogs: [{ id: 1, peer_name: 'Олег', channel: 'tg', unread: 2 }] },
        omni_thread: { ok: true, dialog: { id: 1, peer_name: 'Олег', channel: 'tg', status: 'open' }, messages: [{ dir: 'in', body: 'Привет' }] },
    });
    const call = await serve(t, createChatsRouter({ api: crm.api }));
    const list = await call('/dialogs?status=closed&channel=tg&q=%D0%BE%D0%BB');
    assert.equal(list.json.dialogs[0].who, 'Олег');
    assert.equal(crm.calls[0].query, `section=omni_dialogs&status=closed&channel=tg&q=${encodeURIComponent('ол')}`);
    const th = await call('/dialogs/1');
    assert.equal(th.json.messages[0].body, 'Привет');
    assert.equal((await call('/dialogs/abc')).status, 400);
});

test('ответ клиенту: текст уходит как в CRM, отказ — её словами', async (t) => {
    let ok = true;
    const crm = fakeCrm({ omni_reply: () => (ok ? { ok: true } : { ok: false, error: 'бот заблокирован клиентом' }) });
    const call = await serve(t, createChatsRouter({ api: crm.api }));
    assert.equal((await call('/dialogs/5/reply', { method: 'POST', body: { text: '  ' } })).status, 400);
    const r = await call('/dialogs/5/reply', { method: 'POST', body: { text: 'Добрый день' } });
    assert.equal(r.status, 200);
    assert.deepEqual(crm.calls.at(-1), { userId: 'u1', query: 'section=omni_reply', body: { id: '5', text: 'Добрый день' } });
    ok = false;
    const no = await call('/dialogs/5/reply', { method: 'POST', body: { text: 'ещё' } });
    assert.equal(no.status, 409);
    assert.equal(no.json.error.message, 'бот заблокирован клиентом');
});

test('взять, закрыть, привязать клиента', async (t) => {
    const crm = fakeCrm({ omni_assign: { ok: true }, omni_status: { ok: true }, omni_link: { ok: true } });
    const call = await serve(t, createChatsRouter({ api: crm.api }));
    await call('/dialogs/5/assign', { method: 'POST', body: {} });
    await call('/dialogs/5/status', { method: 'POST', body: { to: 'closed' } });
    assert.equal((await call('/dialogs/5/status', { method: 'POST', body: { to: 'spam' } })).status, 400);
    await call('/dialogs/5/link', { method: 'POST', body: { clientId: '199305' } });
    assert.deepEqual(crm.calls.map(c => c.body), [{ id: '5' }, { id: '5', to: 'closed' }, { id: '5', client_id: '199305' }]);
});
