// Обменник и маркет: настоящий роутер поверх хранилища в памяти — с тем же
// устройством «замок на кошельки», что у настоящего (одна очередь промисов
// вместо advisory lock: в памяти этого достаточно).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createTradesRouter } from './trades.js';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const cat = { pack: 'cat', part: 'frame' };
const fox = { pack: 'fox', part: 'cover' };

function memStore({ gems = {}, items = [] } = {}) {
    const db = {
        items: items.map(i => ({ ...i })),            // { user, pack, part }
        ledger: Object.entries(gems).map(([user, g]) => ({ user, gems: g })),
        offers: [], listings: [], skins: {},
    };
    const owned = (u) => db.items.filter(i => i.user === u).map(({ pack, part }) => ({ pack, part }));
    const gemsOf = (u) => db.ledger.filter(r => r.user === u).reduce((s, r) => s + r.gems, 0);
    let chain = Promise.resolve();
    const tx = {
        async owned(u) { return owned(u); },
        async gems(u) { return gemsOf(u); },
        async ledger(u, row) { db.ledger.push({ user: u, gems: row.gems || 0, kind: row.kind }); },
        async move(from, to, it) {
            const row = db.items.find(i => i.user === from && i.pack === it.pack && i.part === it.part);
            if (!row) throw new Error('нет вещи');
            row.user = to;
            for (const l of db.listings) if (l.seller === from && l.pack === it.pack && l.part === it.part && l.status === 'active') l.status = 'gone';
        },
        async offer(id) { const o = db.offers.find(x => x.id === id); return o && { ...o }; },
        async openOffers(u) { return db.offers.filter(o => o.from === u && o.status === 'pending').length; },
        async insertOffer(from, o) { const row = { ...o, id: db.offers.length + 1, from, status: 'pending' }; db.offers.push(row); return row; },
        async closeOffer(id, status, reason = null) { Object.assign(db.offers.find(o => o.id === id), { status, reason }); },
        async listing(id) { const l = db.listings.find(x => x.id === id); return l && { ...l }; },
        async activeListings(u) { return db.listings.filter(l => l.seller === u && l.status === 'active'); },
        async insertListing(seller, l) { const row = { ...l, id: db.listings.length + 1, seller, status: 'active' }; db.listings.push(row); return row; },
        async closeListing(id, status, buyer = null) { Object.assign(db.listings.find(l => l.id === id), { status, buyer }); },
    };
    return {
        db,
        withUsers(_ids, fn) {
            const run = chain.then(() => fn(tx));
            chain = run.catch(() => {});
            return run;
        },
        async offersOf(u) { return db.offers.filter(o => o.from === u || o.to === u).map(o => ({ ...o })); },
        async activeMarket() { return db.listings.filter(l => l.status === 'active'); },
        async mySales() { return []; },
        async people() { return []; },
        async personWithItems(id) { return [A, B, C].includes(id) ? { id, name: id[0], items: owned(id) } : null; },
        async peekOffer(id) { return tx.offer(id); },
        async peekListing(id) { return tx.listing(id); },
        async myWallet(u) { return { gems: gemsOf(u), owned: owned(u) }; },
    };
}

async function serve(t, store) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: req.get('x-user') }; next(); });
    app.use('/', createTradesRouter({ store }));
    const srv = app.listen(0);
    t.after(() => srv.close());
    const base = `http://127.0.0.1:${srv.address().port}`;
    return (user) => async (path, body) => {
        const r = await fetch(base + path, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { 'Content-Type': 'application/json', 'x-user': user },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: r.status, json: await r.json() };
    };
}

const has = (store, u, it) => store.db.items.some(i => i.user === u && i.pack === it.pack && i.part === it.part);
const gems = (store, u) => store.db.ledger.filter(r => r.user === u).reduce((s, r) => s + r.gems, 0);

test('вещь за вещь: оба согласия — и вещи меняются хозяевами', async (t) => {
    const store = memStore({ items: [{ user: A, ...cat }, { user: B, ...fox }] });
    const as = await serve(t, store);
    const sent = await as(A)('/offers', { to: B, give: [cat], want: [fox] });
    assert.equal(sent.status, 200);
    // Отправить — ещё не обменяться.
    assert.ok(has(store, A, cat));
    // Принять может только получатель.
    assert.equal((await as(A)(`/offers/${sent.json.id}/accept`, {})).status, 404);
    const ok = await as(B)(`/offers/${sent.json.id}/accept`, {});
    assert.equal(ok.status, 200);
    assert.ok(has(store, B, cat) && has(store, A, fox));
    assert.equal(store.db.offers[0].status, 'accepted');
    // Второй раз не принимается.
    assert.equal((await as(B)(`/offers/${sent.json.id}/accept`, {})).status, 409);
});

test('вещь за гемы: гемы уходят от получателя к отправителю', async (t) => {
    const store = memStore({ gems: { [B]: 600 }, items: [{ user: A, ...cat }] });
    const as = await serve(t, store);
    const sent = await as(A)('/offers', { to: B, give: [cat], wantGems: 500 });
    assert.equal(sent.status, 200);
    assert.equal((await as(B)(`/offers/${sent.json.id}/accept`, {})).status, 200);
    assert.ok(has(store, B, cat));
    assert.equal(gems(store, A), 500);
    assert.equal(gems(store, B), 100);
});

test('не хватило гемов к моменту принятия — обмен закрыт как не прошедший, ничего не сдвинулось', async (t) => {
    const store = memStore({ gems: { [B]: 100 }, items: [{ user: A, ...cat }] });
    const as = await serve(t, store);
    const sent = await as(A)('/offers', { to: B, give: [cat], wantGems: 500 });
    const r = await as(B)(`/offers/${sent.json.id}/accept`, {});
    assert.equal(r.status, 409);
    assert.match(r.json.error.message, /не хватает гемов/);
    assert.equal(store.db.offers[0].status, 'failed');
    assert.ok(has(store, A, cat));
    assert.equal(gems(store, B), 100);
});

test('свои гемы проверяются уже при отправке, чужие — только при принятии', async (t) => {
    const store = memStore({ gems: { [A]: 50 }, items: [{ user: B, ...fox }] });
    const as = await serve(t, store);
    assert.equal((await as(A)('/offers', { to: B, giveGems: 500, want: [fox] })).status, 409);
    assert.equal((await as(A)('/offers', { to: B, giveGems: 50, want: [fox] })).status, 200);
});

test('вещь ушла в другой обмен — второй не проходит', async (t) => {
    const store = memStore({ gems: { [B]: 500, [C]: 500 }, items: [{ user: A, ...cat }] });
    const as = await serve(t, store);
    const toB = await as(A)('/offers', { to: B, give: [cat], wantGems: 100 });
    const toC = await as(A)('/offers', { to: C, give: [cat], wantGems: 200 });
    const [b, c] = await Promise.all([as(B)(`/offers/${toB.json.id}/accept`, {}), as(C)(`/offers/${toC.json.id}/accept`, {})]);
    assert.deepEqual([b.status, c.status].sort(), [200, 409]);
    assert.equal(gems(store, A), b.status === 200 ? 100 : 200);
});

test('отклонить — получатель, отменить — отправитель', async (t) => {
    const store = memStore({ items: [{ user: A, ...cat }, { user: B, ...fox }] });
    const as = await serve(t, store);
    const one = await as(A)('/offers', { to: B, give: [cat], want: [fox] });
    assert.equal((await as(A)(`/offers/${one.json.id}/decline`, {})).status, 404);
    assert.equal((await as(B)(`/offers/${one.json.id}/decline`, {})).status, 200);
    const two = await as(A)('/offers', { to: B, give: [cat], want: [fox] });
    assert.equal((await as(B)(`/offers/${two.json.id}/cancel`, {})).status, 404);
    assert.equal((await as(A)(`/offers/${two.json.id}/cancel`, {})).status, 200);
    assert.deepEqual(store.db.offers.map(o => o.status), ['declined', 'cancelled']);
    assert.ok(has(store, A, cat));
});

test('маркет: выставить, купить за гемы, лот закрыт, второй раз не купить', async (t) => {
    const store = memStore({ gems: { [B]: 300, [C]: 300 }, items: [{ user: A, ...cat }] });
    const as = await serve(t, store);
    assert.equal((await as(B)('/market', { ...cat, price: 250 })).status, 409);   // не своё
    const lot = await as(A)('/market', { ...cat, price: 250 });
    assert.equal(lot.status, 200);
    assert.equal((await as(A)(`/market/${lot.json.id}/buy`, {})).status, 409);    // своё
    const [b, c] = await Promise.all([as(B)(`/market/${lot.json.id}/buy`, {}), as(C)(`/market/${lot.json.id}/buy`, {})]);
    assert.deepEqual([b.status, c.status].sort(), [200, 409]);
    assert.equal(gems(store, A), 250);
    assert.equal(store.db.listings[0].status, 'sold');
});

test('маркет: повторное выставление меняет цену, вещь ушла обменом — лот снят', async (t) => {
    const store = memStore({ items: [{ user: A, ...cat }, { user: B, ...fox }] });
    const as = await serve(t, store);
    await as(A)('/market', { ...cat, price: 100 });
    const again = await as(A)('/market', { ...cat, price: 80 });
    assert.equal(again.json.listings.length, 1);
    assert.equal(again.json.listings[0].price, 80);
    const offer = await as(A)('/offers', { to: B, give: [cat], want: [fox] });
    await as(B)(`/offers/${offer.json.id}/accept`, {});
    assert.equal(store.db.listings.filter(l => l.status === 'active').length, 0);
});
