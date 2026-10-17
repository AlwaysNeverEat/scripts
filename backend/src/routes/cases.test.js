// Кейсы: настоящий роутер поверх кошелька в памяти — с тем же устройством
// «замок на человека», что у настоящего (очередь промисов вместо advisory lock).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createCasesRouter } from './cases.js';
import { walletBalance, DUP_XP_SMALL, XP_PER_GEM } from '../../../shared/cases.js';

const ME = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };

function memStore({ recordsTotal = 0, rublesTotal = 0 } = {}) {
    const ledger = [];
    const items = [];
    let chain = Promise.resolve();
    const ops = () => ({
        async balance() {
            const sums = {};
            for (const r of ledger) for (const k of ['gems', 'records', 'rubles', 'xp', 'keys']) sums[k] = (sums[k] || 0) + (r[k] || 0);
            return walletBalance({ recordsTotal, rublesTotal, sums });
        },
        async owned() { return items.map(i => ({ ...i })); },
        async ledger(row) { ledger.push(row); },
        async grant(list) { for (const it of list) if (!items.some(i => i.pack === it.pack && i.part === it.part)) items.push(it); },
    });
    return {
        ledger, items,
        reader: () => ops(),
        withWallet(_id, fn) {
            const run = chain.then(() => fn(ops()));
            chain = run.catch(() => {});
            return run;
        },
    };
}

const OCT = Date.parse('2026-10-12T09:00:00Z');

async function serve(t, store, rand = () => 0, now = () => OCT, user = ME) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = user; next(); });
    app.use('/', createCasesRouter({ store, rand, now }));
    const srv = app.listen(0);
    t.after(() => srv.close());
    const base = `http://127.0.0.1:${srv.address().port}`;
    return async (path, body) => {
        const r = await fetch(base + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { status: r.status, json: await r.json() };
    };
}

test('записи и рубли меняются на гемы, ключ открывает большой кейс', async (t) => {
    const store = memStore({ recordsTotal: 105, rublesTotal: 200 });
    const call = await serve(t, store);
    assert.deepEqual((await call('/')).json.balance, { gems: 0, records: 105, rubles: 200, xp: 0, keys: 0 });

    assert.equal((await call('/exchange', { from: 'records', gems: 10 })).json.balance.gems, 10);
    assert.equal((await call('/exchange', { from: 'records', gems: 1 })).status, 409);
    const rub = await call('/exchange', { from: 'rubles', gems: 165 });
    assert.deepEqual(rub.json.balance, { gems: 175, records: 5, rubles: 35, xp: 0, keys: 0 });

    const noKey = await call('/open', { kind: 'big' });
    assert.equal(noKey.status, 409);
    assert.equal(noKey.json.error.code, 'need_key');

    assert.equal((await call('/key', {})).json.balance.keys, 1);
    const open = await call('/open', { kind: 'big' });
    assert.equal(open.status, 200);
    assert.equal(open.json.grant.length, 4);
    assert.equal(open.json.balance.keys, 0);
    assert.equal(open.json.owned.length, 4);
});

test('малый кейс: нехватка говорит сколько, дубликат даёт опыт, опыт меняется на гем', async (t) => {
    const store = memStore({ rublesTotal: 500 });
    const call = await serve(t, store);
    const short = await call('/open', { kind: 'small' });
    assert.equal(short.status, 409);
    assert.equal(short.json.error.short, 45);

    await call('/exchange', { from: 'rubles', gems: 45 * 5 });
    for (let i = 0; i < 4; i++) await call('/open', { kind: 'small' });   // одна и та же часть (rand → 0)
    const b = (await call('/')).json.balance;
    assert.equal(b.gems, 45);
    assert.equal(b.xp, 3 * DUP_XP_SMALL);
    assert.equal(store.items.length, 1);
    // Опыт меняется ровно на столько гемов, на сколько его хватает.
    const can = Math.floor(3 * DUP_XP_SMALL / XP_PER_GEM);
    assert.equal((await call('/exchange', { from: 'xp', gems: can + 1 })).status, 409);
    assert.equal((await call('/exchange', { from: 'xp', gems: can })).json.balance.gems, 45 + can);
});

test('двойной клик не открывает два кейса на одни гемы', async (t) => {
    const store = memStore({ rublesTotal: 45 });
    const call = await serve(t, store);
    await call('/exchange', { from: 'rubles', gems: 45 });
    const [a, b] = await Promise.all([call('/open', { kind: 'small' }), call('/open', { kind: 'small' })]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
});

test('вне сезона кейсы закрыты, обмен работает, сезон приезжает с балансом', async (t) => {
    const store = memStore({ rublesTotal: 100 });
    const call = await serve(t, store, () => 0, () => Date.parse('2027-04-20T09:00:00Z'));
    const g = (await call('/')).json;
    assert.equal(g.season, null);
    assert.deepEqual(g.next, { id: 'autumn-kawaii', title: 'Осенний кавай', starts: '2027-09-01' });
    assert.equal((await call('/exchange', { from: 'rubles', gems: 45 })).status, 200);
    const shut = await call('/open', { kind: 'small' });
    assert.equal(shut.status, 409);
    assert.equal(shut.json.error.code, 'season_closed');
    assert.equal((await call('/')).json.balance.gems, 45);
});

test('сезон на пробу: редактору — любой из SEASONS, остальным параметр ничего не даёт', async (t) => {
    const store = memStore({ rublesTotal: 100 });
    const plain = await serve(t, store);
    const p = (await plain('/?season=winter-cold')).json;
    assert.equal(p.season.id, 'autumn-kawaii');
    assert.equal(p.seasons, undefined);

    const editor = await serve(t, store, () => 0, () => OCT, { ...ME, login: 'gtrixoff' });
    const e = (await editor('/?season=winter-cold')).json;
    assert.equal(e.season.id, 'winter-cold');
    assert.equal(e.season.titleOnCover, false);
    assert.equal(e.forced, true);
    assert.ok(e.seasons.some(s => s.id === 'winter-cold'));
    // В кейсах — только нарисованные паки зимы, и выпадает зимнее.
    assert.ok(e.packs.includes('snowman') && !e.packs.includes('cat'));
    await editor('/exchange', { from: 'rubles', gems: 45 });
    const won = await editor('/open', { kind: 'small', season: 'winter-cold' });
    assert.ok(e.packs.includes(won.json.prize.pack));
    assert.equal((await editor('/?season=nope')).json.season.id, 'autumn-kawaii');
});
