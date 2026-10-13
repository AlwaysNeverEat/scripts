import { test } from 'node:test';
import assert from 'node:assert/strict';

import { walletBalance, planExchange, planKeys, openCase, allItems, itemKey, KEY_PRICE, gemsWord, activeSeason, nextSeason, packOdds, casePacks, rarityOdds } from './cases.js';
import { SKIN_PACKS } from './skins.js';

const season = { packs: ['cat', 'fox'] };

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
    const r = openCase('small', { balance: bal({ gems: 45 }), owned: new Set(), rand: seq(0), season });
    assert.deepEqual(r.grant, [first]);
    assert.equal(r.row.gems, -45);
    assert.equal(r.row.xp, 0);
    const d = openCase('small', { balance: bal({ gems: 45 }), owned: new Set([itemKey(first)]), rand: seq(0), season });
    assert.deepEqual(d.grant, []);
    assert.equal(d.row.xp, 25);
    assert.equal(openCase('small', { balance: bal({ gems: 44 }), owned: new Set(), rand: seq(0), season }).short, 1);
});

test('большой кейс: пак целиком, за повтор — 75 опыта ОДИН раз', () => {
    const none = openCase('big', { balance: bal({ keys: 1 }), owned: new Set(), rand: seq(0), season });
    assert.equal(none.grant.length, 4);
    assert.equal(none.row.xp, 0);
    assert.equal(none.row.keys, -1);

    const pack = none.prize.pack;
    const three = new Set(['frame', 'cover', 'leads'].map(part => itemKey({ pack, part })));
    const part = openCase('big', { balance: bal({ keys: 1 }), owned: three, rand: seq(0), season });
    assert.deepEqual(part.grant, [{ pack, part: 'records' }]);
    assert.equal(part.row.xp, 75);

    const all = new Set(['frame', 'cover', 'leads', 'records'].map(p => itemKey({ pack, part: p })));
    const full = openCase('big', { balance: bal({ keys: 1 }), owned: all, rand: seq(0), season });
    assert.deepEqual(full.grant, []);
    assert.equal(full.row.xp, 75);

    assert.equal(openCase('big', { balance: bal({ gems: 999 }), owned: new Set(), rand: seq(0), season }).needKey, true);
});

test('склонение гемов', () => {
    assert.deepEqual([1, 2, 5, 11, 21, 175].map(gemsWord), ['гем', 'гема', 'гемов', 'гемов', 'гем', 'гемов']);
});

test('сезон: «Осенний кавай» только осенью, возвращается следующей осенью', () => {
    const at = (iso) => Date.parse(iso);
    assert.deepEqual(activeSeason(at('2026-10-12T09:00:00Z')),
        { id: 'autumn-kawaii', title: 'Осенний кавай', packs: ['cat', 'fox', 'raccoon', 'halloween'], ends: '2026-11-30' });
    assert.equal(activeSeason(at('2026-09-01T09:00:00Z')).ends, '2026-11-30');
    assert.equal(activeSeason(at('2027-04-01T09:00:00Z')), null);
    // 30 ноября 23:00 UTC — это уже 1 декабря по Москве
    assert.equal(activeSeason(at('2026-11-30T23:00:00Z')), null);
    assert.equal(activeSeason(at('2027-07-10T09:00:00Z')), null);
    assert.deepEqual(nextSeason(at('2026-12-15T09:00:00Z')), { id: 'autumn-kawaii', title: 'Осенний кавай', starts: '2027-09-01' });
});

test('вне сезона кейс не открывается, а пак из чужого сезона не выпадает', () => {
    const r = openCase('small', { balance: bal({ gems: 99 }), owned: new Set(), rand: seq(0), season: null });
    assert.equal(r.closed, true);
    const fox = openCase('big', { balance: bal({ keys: 1 }), owned: new Set(), rand: seq(0), season: { packs: ['fox'] } });
    assert.equal(fox.prize.pack, 'fox');
});

test('паки тянутся по весам, редкий — реже, шансы видны числом', () => {
    const at = (r) => openCase('big', { balance: bal({ keys: 1 }), owned: new Set(), rand: () => r, season: { packs: ['cat', 'fox'] } }).prize.pack;
    assert.equal(at(0), 'cat');
    assert.equal(at(9), 'cat');
    assert.equal(at(10), 'fox');
    assert.equal(at(19), 'fox');
    assert.deepEqual(packOdds(['cat', 'fox']), [{ pack: 'cat', pct: 50 }, { pack: 'fox', pct: 50 }]);
    // Хэллоуин с весом 2 при двух паках по 10 — около 9%.
    const odds = packOdds(['cat', 'fox', 'halloween']);
    assert.equal(odds.find(o => o.pack === 'halloween').pct, 9.1);
});

test('шансы по редкости: доля из весов, а не сумма округлённого', () => {
    const [common, rare] = rarityOdds(['cat', 'fox', 'halloween']);
    assert.equal(common.rare, false);
    assert.equal(common.pct, 90.9);
    assert.equal(rare.pct, 9.1);
    assert.deepEqual(common.packs.map(p => p.pack), ['cat', 'fox']);
    // Часть в малом кейсе — четверть шанса пака.
    assert.equal(rare.packs[0].part, 2.3);
    // Без редких паков группа редких не показывается вовсе.
    assert.deepEqual(rarityOdds(['cat', 'fox']).map(g => g.rare), [false]);
});

test('пак без нарезанных картинок (ready: false) в кейсы не попадает', () => {
    const notReady = Object.keys(SKIN_PACKS).filter(p => SKIN_PACKS[p].ready === false);
    for (const p of notReady) {
        assert.equal(casePacks({ packs: ['cat', p] }).includes(p), false);
        assert.equal(allItems().some(i => i.pack === p), false);
    }
});
