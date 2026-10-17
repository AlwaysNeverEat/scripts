// Машины клиента: настоящий роутер поверх таблицы в памяти.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createLeadCarsRouter } from './leadCars.js';

const USER = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', login: 'borya' };
const RIO = '11111111-1111-1111-1111-111111111111';
const SOLARIS = '22222222-2222-2222-2222-222222222222';
const GONE = '33333333-3333-3333-3333-333333333333';
const CARS = {
    [RIO]: { id: RIO, brand: 'Kia', model: 'Rio', generation: 'III', year_from: 2011, year_to: 2017, engine_volume: '1.6', fuel_type: 'petrol' },
    [SOLARIS]: { id: SOLARIS, brand: 'Hyundai', model: 'Solaris', generation: null, year_from: 2017, year_to: null, engine_volume: null, fuel_type: null },
};

// Те же три запроса, что у leads/cars.js; SQL — на живом Postgres.
function fakeDb() {
    const rows = [];
    let tick = 0;
    return async (sql, p) => {
        if (sql.includes('FROM client_cars cc JOIN cars')) {
            return { rows: rows.filter(r => r.phone === p[0]).sort((a, b) => b.at - a.at).map(r => ({ ...CARS[r.carId], added_at: new Date(r.at) })) };
        }
        if (sql.includes('INSERT INTO client_cars')) {
            if (!CARS[p[1]]) throw Object.assign(new Error('fk'), { code: '23503' });
            if (!rows.some(r => r.phone === p[0] && r.carId === p[1])) rows.push({ phone: p[0], carId: p[1], at: ++tick });
            return { rows: [] };
        }
        if (sql.includes('DELETE FROM client_cars')) {
            const i = rows.findIndex(r => r.phone === p[0] && r.carId === p[1]);
            if (i >= 0) rows.splice(i, 1);
            return { rows: [] };
        }
        throw new Error('fakeDb: незнакомый запрос ' + sql);
    };
}

async function serve(t) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = USER; next(); });
    app.use('/', createLeadCarsRouter({ db: fakeDb() }));
    const srv = app.listen(0);
    t.after(() => srv.close());
    const base = `http://127.0.0.1:${srv.address().port}`;
    return async (path, { method = 'GET', body } = {}) => {
        const r = await fetch(base + path, {
            method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
        });
        return { status: r.status, json: await r.json() };
    };
}

test('привязать несколько машин, повтор не дублирует, отвязать одну', async (t) => {
    const call = await serve(t);
    assert.deepEqual((await call('/?phone=79312047101')).json.cars, []);

    await call('/', { method: 'POST', body: { phone: '+7 (931) 204-71-01', carId: RIO } });
    await call('/', { method: 'POST', body: { phone: '89312047101', carId: SOLARIS } });
    const twice = await call('/', { method: 'POST', body: { phone: '9312047101', carId: RIO } });
    assert.equal(twice.status, 200);
    // Все три записи телефона — один клиент; свежая машина первой.
    assert.deepEqual(twice.json.cars.map(c => c.model), ['Solaris', 'Rio']);
    assert.equal(twice.json.cars[1].engineVolume, 1.6);

    const left = await call(`/?phone=79312047101&carId=${SOLARIS}`, { method: 'DELETE' });
    assert.deepEqual(left.json.cars.map(c => c.id), [RIO]);
});

test('плохой телефон и машина — 400, удалённая машина — 404', async (t) => {
    const call = await serve(t);
    assert.equal((await call('/?phone=123')).status, 400);
    assert.equal((await call('/', { method: 'POST', body: { phone: '79312047101', carId: 'rio' } })).status, 400);
    const gone = await call('/', { method: 'POST', body: { phone: '79312047101', carId: GONE } });
    assert.equal(gone.status, 404);
    assert.equal(gone.json.error.code, 'not_found');
});
