// Замок на разделе и разбор тела запроса. Отказы тут важнее успеха: раздел
// записей переехал на ПЕРСОНАЛЬНУЮ учётку CRM именно ради авторства, и
// дырка в замке вернула бы записи без автора — то, ради чего всё затевалось.

import test from 'node:test';
import assert from 'node:assert/strict';

import { crmGate, mergeAuthors } from './journal.js';

function mockRes() {
    const res = { statusCode: 200, body: null, done: false };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; res.done = true; return res; };
    return res;
}

// ── Гейт ────────────────────────────────────────────────────────────────────
// Гоняем НАСТОЯЩИЙ crmGate, подсунув ему проверку сессии: иначе тест проверял
// бы свою копию ветвлений, а замок мог бы разойтись с ней молча.
async function gate(state, { user = { id: 'u1' } } = {}) {
    const res = mockRes();
    let passed = false;
    await crmGate(async () => state)({ user }, res, () => { passed = true; });
    return { res, passed };
}

test('гость в раздел не попадает вовсе', async () => {
    const { res, passed } = await gate({ loggedIn: true }, { user: null });
    assert.equal(passed, false, 'до CRM дело не доходит даже при живой сессии');
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error.code, 'auth_required');
});

test('нет привязки CRM — отказ с инструкцией, а не «forbidden»', async () => {
    const { res, passed } = await gate({ loggedIn: false, linked: false });
    assert.equal(passed, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, 'crm_link_required');
    assert.match(res.body.error.message, /привяжите её в профиле/);
});

test('пароль CRM сменили — текст другой, иначе человек будет жать ту же кнопку', async () => {
    const { res } = await gate({ loggedIn: false, linkRejected: true });
    assert.match(res.body.error.message, /больше не подходит/);
});

test('CRM не отвечает — это 502, а не «войдите заново»', async () => {
    const { res } = await gate({ loggedIn: false, linked: true, unavailable: 'CRM недоступна' });
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.error.code, 'crm_unavailable');
});

test('с живой сессией запрос идёт дальше', async () => {
    const { passed, res } = await gate({ loggedIn: true });
    assert.equal(passed, true);
    assert.equal(res.done, false, 'гейт ничего не отвечает сам');
});

// ── Кто записал ─────────────────────────────────────────────────────────────

const board = {
    cells: {
        '8': {
            '10:00': { records: [{ id: '1', creator: 'Иванов Иван Иванович' }], free: 1 },
            '10:30': { records: [{ id: '2', creator: '' }], free: 1 },
            '11:00': { records: [{ id: '3', creator: 'Петрова Мария Сергеевна' }], free: 1 },
        },
    },
};

test('автор из CRM доезжает до доски, если сайт его не знает', () => {
    const a = mergeAuthors(board, {});
    assert.equal(a['1'].display_name, 'Иванов Иван Иванович');
    assert.equal(a['1'].crm, true);
    assert.equal(a['1'].id, null, 'профиля на сайте у него может и не быть');
});

test('пусто в обоих источниках — автора нет, и он не выдумывается', () => {
    assert.equal(mergeAuthors(board, {})['2'], undefined);
});

test('наш зачёт важнее: там человек с профилем и аватаркой', () => {
    const site = { id: 'u1', display_name: 'Серёга', avatar: '/a.png', counted: true };
    const a = mergeAuthors(board, { '3': site });
    assert.equal(a['3'], site);
    assert.equal(a['1'].crm, true, 'остальные — из CRM');
});
