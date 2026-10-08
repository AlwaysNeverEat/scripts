// Вкладка «Лиды»: ручки поверх новой CRM. Тест гоняет настоящий роутер с
// подменённой CRM — что уходит в неё и что возвращается разделу.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createLeadsRouter } from './crmLeads.js';

// Подставная CRM: ответы по разделу (или action), каждый вызов записывается.
function fakeCrm(answers) {
    const calls = [];
    const api = async (userId, { query = null, body = null }) => {
        calls.push({ userId, query, body });
        const section = (query || '').match(/section=([a-z_]+)/)?.[1] || body?.action;
        const a = answers[section];
        if (a instanceof Error) throw a;
        return typeof a === 'function' ? a({ query, body }) : a;
    };
    return { calls, api };
}

async function serve(t, router, userId = 'u1') {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: userId }; next(); });
    app.use('/', router);
    const srv = app.listen(0);
    t.after(() => srv.close());
    const base = `http://127.0.0.1:${srv.address().port}`;
    return async (path, { method = 'GET', body } = {}) => {
        const r = await fetch(base + path, {
            method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
        });
        return { status: r.status, json: await r.json() };
    };
}

test('лента: нет права на журнал — живёт на живых звонках и помнит закончившиеся', async (t) => {
    let active = [{ id: 1, status: 'answered', phone: '79312047101', created: '2026-10-08 09:07:00', client: { id: 5, name: 'Ершов' } }];
    const crm = fakeCrm({
        incoming_active: () => ({ rows: active }),
        incoming_list: { error: 'forbidden', message: 'нет доступа' },
    });
    let clock = 1_000_000;
    const call = await serve(t, createLeadsRouter({ api: crm.api, now: () => clock, activeTtl: 0 }));

    const first = await call('/feed');
    assert.equal(first.status, 200);
    assert.equal(first.json.journal, 'denied');
    assert.equal(first.json.calls.length, 1);
    assert.equal(first.json.calls[0].name, 'Ершов');

    // Звонок кончился — CRM его больше не отдаёт, а лента помнит.
    active = [];
    clock += 10_000;
    const second = await call('/feed');
    assert.equal(second.json.calls.length, 1);
    assert.equal(second.json.calls[0].status, 'completed');
    assert.equal(crm.calls.filter(c => c.query === 'section=incoming_list').length, 1,
        'отказ в журнале запомнен — не спрашиваем его на каждом опросе');
});

test('лента: журнал есть — в ленте все звонки, а не три', async (t) => {
    const list = [1, 2, 3, 4, 5].map(i => ({ id: i, created: `2026-10-08 0${i}:00:00`, phone: `7931000000${i}`, status: 'completed' }));
    const crm = fakeCrm({ incoming_active: { rows: [] }, incoming_list: { rows: list, summary: {} } });
    const call = await serve(t, createLeadsRouter({ api: crm.api }));
    const r = await call('/feed');
    assert.equal(r.json.journal, 'ok');
    assert.equal(r.json.calls.length, 5);
});

test('карточка по номеру: нет клиента — пусто, есть — карточка', async (t) => {
    let known = false;
    const crm = fakeCrm({
        client_by_phone: () => (known ? { client: { id: 286805 } } : { client: null }),
        clientcard: { client: { id: 286805, fio: 'Дамир', phone: '79293412767' }, calls: [{ id: 1, at: '2026-10-08 09:07:00', dir: 'in' }] },
    });
    const call = await serve(t, createLeadsRouter({ api: crm.api }));
    const none = await call('/card?phone=%2B7%20(929)%20341-27-67');
    assert.equal(none.json.card, null);
    assert.equal(crm.calls[0].query, 'section=client_by_phone&phone=79293412767');
    known = true;
    const hit = await call('/card?phone=79293412767');
    assert.equal(hit.json.card.client.fio, 'Дамир');
    assert.equal(hit.json.card.calls.length, 1);
    assert.equal((await call('/card')).status, 400);
});

test('статус и следующий звонок уходят тем же действием, что в CRM', async (t) => {
    const crm = fakeCrm({ cc_callplan_save: { ok: true } });
    const call = await serve(t, createLeadsRouter({ api: crm.api }));
    assert.equal((await call('/clients/286805/plan', { method: 'POST', body: { status: 'Сам придумал' } })).status, 400);
    const r = await call('/clients/286805/plan', { method: 'POST', body: { status: 'Перезвонить', nextCall: '2026-10-09' } });
    assert.equal(r.status, 200);
    assert.deepEqual(crm.calls.at(-1).body, { action: 'cc_callplan_save', client_id: '286805', next_call: '2026-10-09', status: 'Перезвонить' });
});

test('расчёт: позиции чистятся и уезжают JSON-строкой к звонку', async (t) => {
    const crm = fakeCrm({ calc_save: { ok: true }, clientcard: { client: { id: 7 } } });
    const call = await serve(t, createLeadsRouter({ api: crm.api }));
    const r = await call('/clients/7/calcs', { method: 'POST', body: {
        callId: '55', car: 'Kia Rio', items: [{ name: 'Замена масла', price: '1 900', qty: 1 }, { name: '', price: '' }],
    } });
    assert.equal(r.status, 200);
    const sent = crm.calls.find(c => c.query === 'section=calc_save');
    assert.equal(sent.body.call_id, '55');
    assert.deepEqual(JSON.parse(sent.body.items), [{ name: 'Замена масла', price: 1900, qty: 1 }]);
    assert.equal((await call('/clients/7/calcs', { method: 'POST', body: { items: [] } })).status, 400);
});

test('отказ CRM на действие — её словами, а не «ок»', async (t) => {
    const crm = fakeCrm({ call_note_save: { ok: false, message: 'звонок не найден' } });
    const call = await serve(t, createLeadsRouter({ api: crm.api }));
    const r = await call('/calls/12/comment', { method: 'POST', body: { text: 'перезвонить в 18' } });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.message, 'звонок не найден');
});

test('новая карточка по номеру — и сразу открывается', async (t) => {
    const crm = fakeCrm({ save_client: { ok: true, id: 900 }, clientcard: { client: { id: 900, fio: 'Олег' } } });
    const call = await serve(t, createLeadsRouter({ api: crm.api }));
    const r = await call('/clients', { method: 'POST', body: { phone: '8 931 204 71 01', name: 'Олег' } });
    assert.equal(r.json.card.client.id, '900');
    assert.deepEqual(crm.calls[0].body, { action: 'save_client', phone: '79312047101', name: 'Олег' });
});
