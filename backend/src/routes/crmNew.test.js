// Поход в новую CRM за клиентом: просмотр там НЕ бесплатен (дневной лимит на
// сотрудника и журнал просмотров СБ), поэтому кэш и склейка запросов — по
// сотруднику. Тест гоняет ту самую функцию, что стоит в ручках.

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
    await Promise.all([get('u1', 'section=clientcard&id=1', 60_000), get('u1', 'section=clientcard&id=1', 60_000)]);
    assert.equal(crm.calls.length, 1, 'иначе минус два просмотра из лимита и две строки в журнале СБ');
});

test('кэш СВОЙ у каждого: чужой просмотр не отдаётся мимо лимита', async () => {
    const crm = fakeCrm();
    const get = newCrmGetter(crm.api);
    await get('masha', 'section=clientcard&id=1', 60_000);
    await get('masha', 'section=clientcard&id=1', 60_000);
    assert.equal(crm.calls.length, 1, 'свой повтор — из кэша');
    await get('vasya', 'section=clientcard&id=1', 60_000);
    assert.equal(crm.calls.length, 2, 'Вася ходит в CRM сам — под своим лимитом и в своём журнале');
});

test('отказ по лимиту — ошибка с кодом, и в кэш он не ложится', async () => {
    let limited = true;
    const crm = fakeCrm(() => (limited ? { error: 'daily_limit', message: 'лимит 50' } : { rows: [] }));
    const get = newCrmGetter(crm.api);
    await assert.rejects(() => get('u1', 'section=clients&page=1&q=1', 60_000),
        (e) => e.code === 'crm_daily_limit' && e.message === 'лимит 50');
    limited = false;
    await get('u1', 'section=clients&page=1&q=1', 60_000);
    assert.equal(crm.calls.length, 2, 'после отказа спрашиваем снова, а не показываем отказ из кэша');
});
