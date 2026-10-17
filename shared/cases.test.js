import { test } from 'node:test';
import assert from 'node:assert/strict';

import { walletBalance, planExchange, planKeys, openCase, allItems, itemKey, KEY_PRICE, DUP_XP_SMALL, DUP_XP_BIG, gemsWord, activeSeason, nextSeason, seasonById, packOdds, casePacks, rarityOdds } from './cases.js';
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

test('малый кейс: 45 гемов, дубликат — DUP_XP_SMALL опыта и без выдачи', () => {
    const items = allItems();
    const first = items[0];
    const r = openCase('small', { balance: bal({ gems: 45 }), owned: new Set(), rand: seq(0), season });
    assert.deepEqual(r.grant, [first]);
    assert.equal(r.row.gems, -45);
    assert.equal(r.row.xp, 0);
    const d = openCase('small', { balance: bal({ gems: 45 }), owned: new Set([itemKey(first)]), rand: seq(0), season });
    assert.deepEqual(d.grant, []);
    assert.equal(d.row.xp, DUP_XP_SMALL);
    assert.equal(openCase('small', { balance: bal({ gems: 44 }), owned: new Set(), rand: seq(0), season }).short, 1);
});

test('большой кейс: пак целиком, за повтор — DUP_XP_BIG опыта ОДИН раз', () => {
    const none = openCase('big', { balance: bal({ keys: 1 }), owned: new Set(), rand: seq(0), season });
    assert.equal(none.grant.length, 4);
    assert.equal(none.row.xp, 0);
    assert.equal(none.row.keys, -1);

    const pack = none.prize.pack;
    const three = new Set(['frame', 'cover', 'leads'].map(part => itemKey({ pack, part })));
    const part = openCase('big', { balance: bal({ keys: 1 }), owned: three, rand: seq(0), season });
    assert.deepEqual(part.grant, [{ pack, part: 'records' }]);
    assert.equal(part.row.xp, DUP_XP_BIG);

    const all = new Set(['frame', 'cover', 'leads', 'records'].map(p => itemKey({ pack, part: p })));
    const full = openCase('big', { balance: bal({ keys: 1 }), owned: all, rand: seq(0), season });
    assert.deepEqual(full.grant, []);
    assert.equal(full.row.xp, DUP_XP_BIG);

    assert.equal(openCase('big', { balance: bal({ gems: 999 }), owned: new Set(), rand: seq(0), season }).needKey, true);
});

test('склонение гемов', () => {
    assert.deepEqual([1, 2, 5, 11, 21, 175].map(gemsWord), ['гем', 'гема', 'гемов', 'гемов', 'гем', 'гемов']);
});

test('сезон: «Осенний кавай» только осенью, возвращается следующей осенью', () => {
    const at = (iso) => Date.parse(iso);
    assert.deepEqual(activeSeason(at('2026-10-12T09:00:00Z')),
        { id: 'autumn-kawaii', title: 'Осенний кавай', titleOnCover: true, packs: ['cat', 'fox', 'raccoon', 'bunny', 'halloween', 'matiz'], ends: '2026-11-30' });
    assert.equal(activeSeason(at('2026-09-01T09:00:00Z')).ends, '2026-11-30');
    assert.equal(activeSeason(at('2027-04-01T09:00:00Z')), null);
    // 30 ноября 23:00 UTC — это уже 1 декабря по Москве: зима
    assert.equal(activeSeason(at('2026-11-30T23:00:00Z')).id, 'winter-cold');
    assert.equal(activeSeason(at('2027-07-10T09:00:00Z')), null);
    assert.deepEqual(nextSeason(at('2026-12-15T09:00:00Z')), { id: 'autumn-kawaii', title: 'Осенний кавай', starts: '2027-09-01' });
});

test('сезон: «Холодрыжество» — через Новый год, с декабря по февраль', () => {
    const at = (iso) => Date.parse(iso);
    const dec = activeSeason(at('2026-12-15T09:00:00Z'));
    assert.equal(dec.id, 'winter-cold');
    assert.equal(dec.ends, '2027-02-28');
    assert.equal(dec.titleOnCover, false);
    assert.equal(activeSeason(at('2027-01-10T09:00:00Z')).ends, '2027-02-28');
    assert.equal(activeSeason(at('2028-02-29T09:00:00Z')).ends, '2028-02-29');
    // 28 февраля 21:00 UTC — уже 1 марта по Москве
    assert.equal(activeSeason(at('2027-02-28T21:00:00Z')), null);
    assert.deepEqual(nextSeason(at('2026-10-15T09:00:00Z')), { id: 'winter-cold', title: 'Холодрыжество', starts: '2026-12-01' });
    // На пробу — в октябре, со сроком своего окна.
    assert.equal(seasonById('winter-cold', at('2026-10-15T09:00:00Z')).ends, '2027-02-28');
    assert.equal(seasonById('nope'), null);
    // В кейсы попадают только нарисованные паки.
    assert.ok(casePacks(dec).includes('snowman'));
    assert.ok(!casePacks(dec).includes('lichking') || SKIN_PACKS.lichking.ready !== false);
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
    assert.equal(at(19), 'cat');
    assert.equal(at(20), 'fox');
    assert.equal(at(39), 'fox');
    assert.deepEqual(packOdds(['cat', 'fox']), [{ pack: 'cat', pct: 50 }, { pack: 'fox', pct: 50 }]);
    // Хэллоуин с весом 6 при двух паках по 20 — около 13%.
    const odds = packOdds(['cat', 'fox', 'halloween']);
    assert.equal(odds.find(o => o.pack === 'halloween').pct, 13);
});

test('шансы по редкости: три ступени, доля из весов, а не сумма округлённого', () => {
    const autumn = ['cat', 'fox', 'raccoon', 'bunny', 'halloween', 'matiz'];
    const [common, rare, legend] = rarityOdds(autumn);
    assert.deepEqual([common.tier, rare.tier, legend.tier], ['common', 'rare', 'legendary']);
    // 80 + 6 + 1 = 87.
    assert.equal(common.pct, 92);
    assert.equal(rare.pct, 6.9);
    assert.equal(legend.pct, 1.1);
    assert.deepEqual(common.packs.map(p => p.pack), ['cat', 'fox', 'raccoon', 'bunny']);
    // Часть в малом кейсе — четверть шанса пака; меньше процента — два знака.
    assert.equal(rare.packs[0].part, 1.7);
    assert.equal(legend.packs[0].part, 0.29);
    // Ступени без паков не показываются вовсе.
    assert.deepEqual(rarityOdds(['cat', 'fox']).map(g => g.tier), ['common']);
});

test('легендарка в двадцать раз реже обычного пака и в шесть — редкого', () => {
    assert.equal(SKIN_PACKS.cat.weight / SKIN_PACKS.matiz.weight, 20);
    assert.equal(SKIN_PACKS.halloween.weight / SKIN_PACKS.matiz.weight, 6);
    for (const p of Object.values(SKIN_PACKS)) assert.ok(Number.isInteger(p.weight), 'веса целые — на сервере crypto.randomInt');
});

test('пак без нарезанных картинок (ready: false) в кейсы не попадает', () => {
    const notReady = Object.keys(SKIN_PACKS).filter(p => SKIN_PACKS[p].ready === false);
    for (const p of notReady) {
        assert.equal(casePacks({ packs: ['cat', p] }).includes(p), false);
        assert.equal(allItems().some(i => i.pack === p), false);
    }
});
