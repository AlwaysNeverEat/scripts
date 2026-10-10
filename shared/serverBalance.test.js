import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseJsonLoose, parseBalanceData, hoursLeftAfter, formatLeft, lifeTone } from './serverBalance.js';

// Пример из документации Рег.облака — с той самой висящей запятой после
// monthly_cost.
const DOC_EXAMPLE = `{
    "balance_data": {
        "balance": 2154.55,
        "bonus_balance": 41736.72,
        "days_left": 424,
        "detalization": [
            { "linked": [], "name": "Filipino Bird", "plan": "cloud-3", "price": "1.30952", "price_month": "880.00", "resource_id": 321, "state": "active", "type": "reglet" }
        ],
        "hourly_cost": 4.31128,
        "hours_left": 10180,
        "monthly_cost": 2896.83,
    }
}`;

test('пример из документации разбирается, несмотря на висящую запятую', () => {
    const json = parseJsonLoose(DOC_EXAMPLE);
    assert.ok(json);
    assert.deepEqual(parseBalanceData(json), {
        balance: 2154.55, bonus: 41736.72, hourlyCost: 4.31128, monthlyCost: 2896.83, hoursLeft: 10180,
    });
});

test('детализация по ресурсам наружу не уезжает', () => {
    const b = parseBalanceData(parseJsonLoose(DOC_EXAMPLE));
    assert.equal(JSON.stringify(b).includes('Filipino'), false);
});

test('строки вместо чисел и пропуски', () => {
    assert.deepEqual(parseBalanceData({ balance_data: { balance: '120.5', hourly_cost: '2', monthly_cost: '' } }),
        { balance: 120.5, bonus: 0, hourlyCost: 2, monthlyCost: null, hoursLeft: 60.25 });
    assert.equal(parseBalanceData({ balance_data: { days_left: 3 } }).hoursLeft, 72);
    assert.equal(parseBalanceData({}), null);
    assert.equal(parseBalanceData({ balance_data: {} }), null);
    assert.equal(parseJsonLoose('<html>'), null);
});

test('в минус «осталось» не уходит', () => {
    assert.equal(parseBalanceData({ balance_data: { balance: -50, hours_left: -3 } }).hoursLeft, 0);
    assert.equal(hoursLeftAfter(1, 2 * 3_600_000), 0);
});

test('счётчик идёт вниз между опросами', () => {
    assert.equal(hoursLeftAfter(100, 30 * 60_000), 99.5);
    assert.equal(hoursLeftAfter(null, 1000), null);
});

test('дни и часы', () => {
    assert.equal(formatLeft(10180), '424 д 4 ч');
    assert.equal(formatLeft(566.4), '23 д 14 ч');
    assert.equal(formatLeft(24), '1 д 0 ч');
    assert.equal(formatLeft(14.9), '14 ч');
    assert.equal(formatLeft(0.4), 'меньше часа');
    assert.equal(formatLeft(0), '0 ч');
    assert.equal(formatLeft(null), '—');
});

test('тон: меньше трёх дней — красный, меньше недели — золотой', () => {
    assert.equal(lifeTone(71), 'red');
    assert.equal(lifeTone(72), 'gold');
    assert.equal(lifeTone(7 * 24 - 1), 'gold');
    assert.equal(lifeTone(7 * 24), 'green');
    assert.equal(lifeTone(null), 'muted');
});
