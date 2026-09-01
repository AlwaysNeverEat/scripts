// Тесты разбора ответа Рег.облака и кэша. Живого облака в node --test нет,
// поэтому ответ подсовывается фиктивным fetchImpl, а форма ответа взята из
// документации: https://developers.cloudvps.reg.ru/billing/balance.html
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBalanceData, getBalance, resetCache } from './balance.js';

const SAMPLE = {
    balance_data: {
        balance: 134.18,
        bonus_balance: 0,
        days_left: 2,
        hourly_cost: 2.01873,
        hours_left: 66,
        monthly_cost: 1473.67,
        detalization: [
            {
                name: 'Cars DB', plan: 'Stdp C2-M2-D40', price: '1.76204',
                price_month: '1286.29', resource_id: 321, state: 'active', type: 'reglet',
                linked: [
                    { plan: 'backup', price: '0.10000', price_month: '73.00',
                      resource_id: 123, type: 'backup' },
                ],
            },
            { name: '', plan: 'ip', price: '0.25669', price_month: '187.38',
              resource_id: 777, state: 'active', type: 'floating_ip' },
        ],
    },
};

test('разбирает баланс, расход и срок', () => {
    const d = parseBalanceData(SAMPLE);
    assert.equal(d.balance, 134.18);
    assert.equal(d.hourly, 2.01873);
    assert.equal(d.monthly, 1473.67);
    assert.equal(d.hoursLeft, 66);
    assert.equal(d.daysLeft, 2);
});

test('детализация разворачивается в плоский список, бэкап знает своего хозяина', () => {
    const { items } = parseBalanceData(SAMPLE);
    assert.deepEqual(items.map(i => i.label), [
        'Сервер — Cars DB',
        'Бэкап — Cars DB',   // имени у бэкапа своего нет, берём от сервера
        'Плавающий IP',      // а тут имени нет ни у кого — остаётся тип
    ]);
    assert.equal(items[0].hourly, 1.76204);
    assert.equal(items[0].monthly, 1286.29);
    // Короткое имя лежит отдельно: карточке на главной длинная подпись не по
    // размеру, а у безымянного ресурса остаётся только его тип.
    assert.deepEqual(items.map(i => i.name || i.kind), ['Cars DB', 'Cars DB', 'Плавающий IP']);
});

test('нет расхода — нет и срока: деньги не кончатся, а не кончатся сегодня', () => {
    const d = parseBalanceData({ balance_data: { balance: 500, hourly_cost: 0 } });
    assert.equal(d.hoursLeft, null);
    assert.equal(d.daysLeft, null);
});

test('срок считается сам, если облако его не прислало', () => {
    const d = parseBalanceData({ balance_data: { balance: 100, bonus_balance: 20, hourly_cost: 2 } });
    assert.equal(d.hoursLeft, 60);
    assert.equal(d.daysLeft, 2);
});

test('мусор вместо ответа не роняет разбор', () => {
    const d = parseBalanceData(null);
    assert.equal(d.balance, 0);
    assert.deepEqual(d.items, []);
});

test('в пределах TTL второго похода в облако не делаем', async () => {
    resetCache();
    process.env.REG_CLOUD_TOKEN = 'test';
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return SAMPLE; };

    const first = await getBalance({ now: 1_000_000, fetchImpl });
    const second = await getBalance({ now: 1_000_000 + 60_000, fetchImpl });
    assert.equal(calls, 1);
    assert.equal(second.balance, first.balance);
    assert.equal(second.stale, false);

    // TTL истёк — идём в облако снова
    await getBalance({ now: 1_000_000 + 10 * 60_000, fetchImpl });
    assert.equal(calls, 2);
});

test('облако молчит — отдаём прошлый снимок с пометкой, а не ошибку', async () => {
    resetCache();
    process.env.REG_CLOUD_TOKEN = 'test';
    await getBalance({ now: 1_000_000, fetchImpl: async () => SAMPLE });

    const down = async () => { throw new Error('облако недоступно'); };
    const stale = await getBalance({ now: 1_000_000 + 10 * 60_000, fetchImpl: down });
    assert.equal(stale.stale, true);
    assert.equal(stale.balance, 134.18);
    assert.equal(stale.checkedAt, new Date(1_000_000).toISOString());

    // Снимок старше суток уже ничего не говорит про «сколько осталось»
    await assert.rejects(() => getBalance({ now: 1_000_000 + 25 * 3600_000, fetchImpl: down }));
});

test('без токена — отдельная ошибка, а не поход в облако', async () => {
    resetCache();
    delete process.env.REG_CLOUD_TOKEN;
    await assert.rejects(
        () => getBalance({ fetchImpl: async () => SAMPLE }),
        (err) => err.code === 'not_configured',
    );
});
