import { test } from 'node:test';
import assert from 'node:assert/strict';

import { walletBalance, planExchange, planKeys, openCase, allItems, itemKey, KEY_PRICE, gemsWord } from './cases.js';

const bal = (o = {}) => ({ gems: 0, records: 0, rubles: 0, xp: 0, keys: 0, ...o });
const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };

test('баланс считается из фактов: записи и донаты минус потраченное', () => {
    assert.deepEqual(walletBalance({ recordsTotal: 57, rublesTotal: '500', sums: { gems: 12, records: -50, rubles: -175, xp: 25, keys: 1 } }),
        { gems: 12, records: 7, rubles: 325, xp: 25, keys: 1 });
    assert.deepEqual(walletBalance(), bal());
});

test('обмен: 10 записей, 1 ₽ и 100 опыта за гем', () => {
    assert.deepEqual(planExchange(bal({ records: 57 }), 'records', 5).row, { kind: 'exchange_records', gems: 5, records: -50 });
    assert.equal(planExchange(bal({ records: 57 }), 'records', 6).error, 'хватает только на 5 гемов');
    assert.deepEqual(planExchange(bal({ rubles: 300 }), 'rubles', 130).row, { kind: 'exchange_rubles', gems: 130, rubles: -130 });
    assert.deepEqual(planExchange(bal({ xp: 125 }), 'xp', 1).row, { kind: 'exchange_xp', gems: 1, xp: -100 });
    assert.equal(planExchange(bal({ xp: 99 }), 'xp', 1).error, 'не хватает опыта');
    assert.ok(planExchange(bal({ gems: 9 }), 'gems', 1).error);
    assert.ok(planExchange(bal({ rubles: 9 }), 'rubles', 1.5).error);
    assert.ok(planExchange(bal({ rubles: 9 }), 'rubles', -3).error);
});

test('ключ стоит 175 гемов и говорит, сколько не хватает', () => {
    assert.deepEqual(planKeys(bal({ gems: 200 })).row, { kind: 'buy_key', gems: -KEY_PRICE, keys: 1 });
    assert.equal(planKeys(bal({ gems: 100 })).short, 75);
});

test('малый кейс: 45 гемов, дубликат — 25 опыта и без выдачи', () => {
    const items = allItems();
    const first = items[0];
    const r = openCase('small', { balance: bal({ gems: 45 }), owned: new Set(), rand: seq(0) });
    assert.deepEqual(r.grant, [first]);
    assert.equal(r.row.gems, -45);
    assert.equal(r.row.xp, 0);
    const d = openCase('small', { balance: bal({ gems: 45 }), owned: new Set([itemKey(first)]), rand: seq(0) });
    assert.deepEqual(d.grant, []);
    assert.equal(d.row.xp, 25);
    assert.equal(openCase('small', { balance: bal({ gems: 44 }), owned: new Set(), rand: seq(0) }).short, 1);
});

test('большой кейс: пак целиком, за повтор — 75 опыта ОДИН раз', () => {
    const none = openCase('big', { balance: bal({ keys: 1 }), owned: new Set(), rand: seq(0) });
    assert.equal(none.grant.length, 4);
    assert.equal(none.row.xp, 0);
    assert.equal(none.row.keys, -1);

    const pack = none.prize.pack;
    const three = new Set(['frame', 'cover', 'leads'].map(part => itemKey({ pack, part })));
    const part = openCase('big', { balance: bal({ keys: 1 }), owned: three, rand: seq(0) });
    assert.deepEqual(part.grant, [{ pack, part: 'records' }]);
    assert.equal(part.row.xp, 75);

    const all = new Set(['frame', 'cover', 'leads', 'records'].map(p => itemKey({ pack, part: p })));
    const full = openCase('big', { balance: bal({ keys: 1 }), owned: all, rand: seq(0) });
    assert.deepEqual(full.grant, []);
    assert.equal(full.row.xp, 75);

    assert.equal(openCase('big', { balance: bal({ gems: 999 }), owned: new Set(), rand: seq(0) }).needKey, true);
});

test('склонение гемов', () => {
    assert.deepEqual([1, 2, 5, 11, 21, 175].map(gemsWord), ['гем', 'гема', 'гемов', 'гемов', 'гем', 'гемов']);
});
