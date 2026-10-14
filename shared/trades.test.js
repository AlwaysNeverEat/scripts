import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanOffer, tradeBlocker, cleanListing, buyBlocker, TRADE_ITEMS_MAX } from './trades.js';

const A = 'a', B = 'b';
const cat = { pack: 'cat', part: 'frame' };
const fox = { pack: 'fox', part: 'cover' };
const set = (...list) => new Set(list.map(it => `${it.pack}:${it.part}`));

test('предложение: вещь за вещь, вещь за гемы, без пустых сторон и встречных гемов', () => {
    assert.deepEqual(cleanOffer({ to: B, give: [cat], want: [fox] }, A).offer,
        { to: B, give: [cat], giveGems: 0, want: [fox], wantGems: 0, note: '' });
    assert.equal(cleanOffer({ to: B, give: [cat], wantGems: 500 }, A).offer.wantGems, 500);
    assert.equal(cleanOffer({ to: B, giveGems: 500, want: [fox] }, A).offer.giveGems, 500);

    assert.match(cleanOffer({ to: B, give: [cat] }, A).error, /взамен/);
    assert.match(cleanOffer({ to: B, want: [fox] }, A).error, /отдаёте/);
    assert.match(cleanOffer({ to: B, giveGems: 10, wantGems: 20, give: [cat] }, A).error, /одной стороны/);
    assert.match(cleanOffer({ to: A, give: [cat], want: [fox] }, A).error, /самим собой/);
    assert.match(cleanOffer({ to: B, give: [{ pack: 'nope', part: 'frame' }], want: [fox] }, A).error, /нет/);
    assert.match(cleanOffer({ to: B, give: [cat], wantGems: 1.5 }, A).error, /целое/);
    assert.match(cleanOffer({ to: B, give: [cat], wantGems: -3 }, A).error, /целое/);
});

test('предложение: повторы схлопываются, потолок вещей держится', () => {
    assert.equal(cleanOffer({ to: B, give: [cat, cat], want: [fox] }, A).offer.give.length, 1);
    const many = ['cat', 'fox', 'raccoon', 'bunny', 'halloween'].flatMap(pack => ['frame', 'cover', 'leads', 'records'].map(part => ({ pack, part })));
    assert.ok(many.length > TRADE_ITEMS_MAX);
    assert.match(cleanOffer({ to: B, give: many, want: [fox] }, A).error, /не больше/);
});

test('обмен не проходит, если вещи ушли, уже есть у получателя или не хватает гемов', () => {
    const offer = cleanOffer({ to: B, give: [cat], want: [fox] }, A).offer;
    const ok = { fromOwned: set(cat), toOwned: set(fox), fromGems: 0, toGems: 0 };
    assert.equal(tradeBlocker(offer, ok), null);
    assert.match(tradeBlocker(offer, { ...ok, fromOwned: set() }), /отправителя уже нет/);
    assert.match(tradeBlocker(offer, { ...ok, toOwned: set() }), /получателя уже нет/);
    // Копия у человека одна: прийти может только то, чего у него нет.
    assert.match(tradeBlocker(offer, { ...ok, toOwned: set(fox, cat) }), /получателя уже есть/);
    assert.match(tradeBlocker(offer, { ...ok, fromOwned: set(cat, fox) }), /отправителя уже есть/);

    const forGems = cleanOffer({ to: B, give: [cat], wantGems: 500 }, A).offer;
    assert.match(tradeBlocker(forGems, { fromOwned: set(cat), toOwned: set(), fromGems: 0, toGems: 499 }), /получателя не хватает/);
    assert.equal(tradeBlocker(forGems, { fromOwned: set(cat), toOwned: set(), fromGems: 0, toGems: 500 }), null);
});

test('маркет: цена целая и положительная, купить чужое и только то, чего нет', () => {
    assert.deepEqual(cleanListing({ ...cat, price: 300 }).listing, { ...cat, price: 300 });
    assert.match(cleanListing({ ...cat, price: 0 }).error, /цена/);
    assert.match(cleanListing({ pack: 'cat', part: 'hat', price: 5 }).error, /нет/);

    const l = { ...cat, price: 300, seller: A, status: 'active' };
    const ok = { buyerId: B, sellerOwned: set(cat), buyerOwned: set(), buyerGems: 300 };
    assert.equal(buyBlocker(l, ok), null);
    assert.match(buyBlocker(l, { ...ok, buyerId: A }), /ваш/);
    assert.match(buyBlocker(l, { ...ok, buyerGems: 100 }), /не хватает 200/);
    assert.match(buyBlocker(l, { ...ok, buyerOwned: set(cat) }), /уже есть/);
    assert.match(buyBlocker(l, { ...ok, sellerOwned: set() }), /уже нет/);
    assert.match(buyBlocker({ ...l, status: 'sold' }, ok), /снят или продан/);
});
