import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    cleanDonation, isDonationAdmin, mskToday, monthOf, monthLabel, parseAmount, sortDonors, rub, AMOUNT_MAX,
} from './donations.js';

// 09.10.2026 23:30 по Москве = 20:30 UTC.
const NOW = Date.UTC(2026, 9, 9, 20, 30);

test('вносит ровно один аккаунт — по логину, без учёта регистра', () => {
    assert.equal(isDonationAdmin({ login: 'gtrixoff' }), true);
    assert.equal(isDonationAdmin({ login: ' GTRIXOFF ' }), true);
    assert.equal(isDonationAdmin({ login: 'gtrixof' }), false);
    assert.equal(isDonationAdmin(null), false);
});

test('сегодня и месяц — по Москве, а не по UTC', () => {
    assert.equal(mskToday(Date.UTC(2026, 9, 31, 21, 30)), '2026-11-01', 'полночь в Москве наступила раньше');
    assert.equal(monthOf('2026-10-09'), '2026-10');
    assert.equal(monthLabel('2026-10'), 'в октябре');
});

test('сумма: целые рубли в любом привычном написании', () => {
    assert.equal(parseAmount('1 500'), 1500);
    assert.equal(parseAmount('1500 ₽'), 1500);
    assert.equal(parseAmount('1500,00'), 1500);
    assert.equal(parseAmount('1500 р.'), 1500);
    assert.equal(parseAmount('2000руб'), 2000);
    assert.equal(parseAmount(700), 700);
    assert.equal(parseAmount('15.5'), null);
    assert.equal(parseAmount('-5'), null);
    assert.equal(parseAmount('сто'), null);
});

test('пополнение: человек, настоящая дата не в будущем, сумма в разумных пределах', () => {
    const ok = cleanDonation({ userId: 'u1', date: '2026-10-09', amount: '2 000' }, NOW);
    assert.deepEqual(ok, { donation: { userId: 'u1', date: '2026-10-09', amount: 2000 } });
    assert.match(cleanDonation({ date: '2026-10-09', amount: 1 }, NOW).error, /человек/);
    assert.match(cleanDonation({ userId: 'u1', date: '2026-02-30', amount: 1 }, NOW).error, /ГГГГ/);
    assert.match(cleanDonation({ userId: 'u1', date: '2026-10-10', amount: 1 }, NOW).error, /будущем/);
    assert.match(cleanDonation({ userId: 'u1', date: '2016-10-09', amount: 1 }, NOW).error, /опечатка/);
    assert.match(cleanDonation({ userId: 'u1', date: '2026-10-09', amount: 0 }, NOW).error, /больше нуля/);
    assert.match(cleanDonation({ userId: 'u1', date: '2026-10-09', amount: AMOUNT_MAX + 1 }, NOW).error, /нули/);
});

test('порядок: всего ↓, при равенстве — за месяц ↓, потом кто пополнял позже', () => {
    const list = [
        { id: 'a', total: 1300, month: 300, last: '2026-10-02' },
        { id: 'b', total: 1300, month: 1300, last: '2026-10-05' },
        { id: 'c', total: 5000, month: 0, last: '2026-08-01' },
        { id: 'd', total: 1300, month: 300, last: '2026-10-07' },
    ];
    assert.deepEqual(sortDonors(list).map(d => d.id), ['c', 'b', 'd', 'a']);
});

test('рубли с пробелом между разрядами', () => {
    assert.equal(rub(1500), '1 500 ₽');
    assert.equal(rub(0), '0 ₽');
});
