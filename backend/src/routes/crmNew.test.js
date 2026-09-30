// Поход в новую CRM за клиентом: ходим под ЛИЧНОЙ сессией, поэтому кэш и
// склейка запросов — по сотруднику, а не общие. Тест гоняет ту самую функцию,
// что стоит в ручках.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { newCrmGetter } from './crm.js';

function fakeCrm(reply = () => ({ rows: [] })) {
    const calls = [];
    const api = async (userId, { query }) => {
        calls.push(`${userId}|${query}`);
        await new Promise(r => setTimeout(r, 10));
        return reply(userId, query);
    };
    return { calls, api };
}

test('два одинаковых запроса одного человека разом — один поход в CRM', async () => {
    const crm = fakeCrm();
    const get = newCrmGetter(crm.api);
    // Так приходит страховочный второй GET сайта (netRetry.js).
    await Promise.all([get('u1', 'section=dial&page=1&all=1&phone=79110000001', 60_000), get('u1', 'section=dial&page=1&all=1&phone=79110000001', 60_000)]);
    assert.equal(crm.calls.length, 1, 'страховочный второй GET не должен идти в CRM вторым походом');
});

test('кэш СВОЙ у каждого: полученное под чужой учёткой другому не отдаётся', async () => {
    const crm = fakeCrm();
    const get = newCrmGetter(crm.api);
    await get('masha', 'section=dial&page=1&all=1&phone=79110000001', 60_000);
    await get('masha', 'section=dial&page=1&all=1&phone=79110000001', 60_000);
    assert.equal(crm.calls.length, 1, 'свой повтор — из кэша');
    await get('vasya', 'section=dial&page=1&all=1&phone=79110000001', 60_000);
    assert.equal(crm.calls.length, 2, 'Вася ходит в CRM сам — под своей учёткой');
});

test('отказ по лимиту — ошибка с кодом, и в кэш он не ложится', async () => {
    let limited = true;
    const crm = fakeCrm(() => (limited ? { error: 'daily_limit', message: 'лимит 50' } : { rows: [] }));
    const get = newCrmGetter(crm.api);
    await assert.rejects(() => get('u1', 'section=dial&page=1&all=1&plate=К926АА147', 60_000),
        (e) => e.code === 'crm_daily_limit' && e.message === 'лимит 50');
    limited = false;
    await get('u1', 'section=dial&page=1&all=1&plate=К926АА147', 60_000);
    assert.equal(crm.calls.length, 2, 'после отказа спрашиваем снова, а не показываем отказ из кэша');
});
