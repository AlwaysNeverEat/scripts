// Подбор места для «Гео»: разговор с банком уличных снимков Mapillary.
//
// Настоящих запросов тут нет — fetch подменён. Проверяем ровно то, что
// сломается молча: что сферические снимки берутся раньше плоских (вокруг
// сферического можно оглядеться, и в этом вся игра), что «тут ничего нет» и
// «токен не тот» разведены, и что дейли выдаёт одному и тому же человеку в один
// и тот же день одну и ту же точку.

import test from 'node:test';
import assert from 'node:assert/strict';

import { nextPoint, dailyRand } from './panoramas.js';

const realFetch = globalThis.fetch;
process.env.MAPILLARY_TOKEN = 'MLY|test|token';

const img = (id, isPano, lng = 2.29, lat = 48.85) => ({
    id,
    computed_geometry: { type: 'Point', coordinates: [lng, lat] },
    is_pano: isPano,
});

function stub(data) {
    const calls = [];
    globalThis.fetch = async (url) => {
        calls.push(String(url));
        return { ok: true, status: 200, json: async () => ({ data }) };
    };
    return calls;
}

test.after(() => { globalThis.fetch = realFetch; });

test('из найденного берётся сферический снимок, а не первый попавшийся', async () => {
    const calls = stub([img('flat-1', false), img('pano-1', true), img('flat-2', false)]);
    const point = await nextPoint();
    assert.equal(point.pano, 'pano-1');
    assert.equal(point.is_pano, true);
    assert.equal(point.lat, 48.85);
    assert.equal(point.lng, 2.29);
    // Страна — от ОПОРНОЙ точки: Mapillary страну не возвращает вовсе.
    assert.ok(point.label.length > 0);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('bbox='));
    assert.ok(calls[0].includes('is_pano'));
});

test('если сферических нет нигде — вторым проходом берётся плоский', async () => {
    // Лучше кадр в одну сторону, чем «не удалось подобрать точку».
    const calls = stub([img('flat-1', false)]);
    const point = await nextPoint();
    assert.equal(point.pano, 'flat-1');
    assert.equal(point.is_pano, false);
    // Первый проход отработал вхолостую целиком, второй нашёл с первой попытки.
    assert.equal(calls.length, 11);
});

test('если снимков нет вовсе — возвращается null, а не мусор', async () => {
    stub([]);
    assert.equal(await nextPoint(), null);
});

test('снимок без координат не берётся', async () => {
    // У части снимков геометрии не приходит — записать такую точку значило бы
    // положить в базу раунд, за который нельзя начислить очки.
    stub([{ id: 'broken', is_pano: true }]);
    assert.equal(await nextPoint(), null);
});

test('сломанный токен — это ошибка, а не «тут ничего нет»', async () => {
    // Перебирать дальше бессмысленно: все попытки упрутся в то же самое,
    // и молчаливый null увёл бы в «не удалось подобрать точку».
    globalThis.fetch = async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Invalid access token' } }),
    });
    await assert.rejects(nextPoint(), /Invalid access token/);
});

test('дейли выдаёт одному человеку в один день одну и ту же точку', async () => {
    const seq = (rand) => Array.from({ length: 6 }, () => rand());
    assert.deepEqual(seq(dailyRand('user-1', '2026-08-17')), seq(dailyRand('user-1', '2026-08-17')));
    assert.notDeepEqual(seq(dailyRand('user-1', '2026-08-17')), seq(dailyRand('user-1', '2026-08-18')));
    assert.notDeepEqual(seq(dailyRand('user-1', '2026-08-17')), seq(dailyRand('user-2', '2026-08-17')));
    for (const v of seq(dailyRand('user-3', '2026-08-17'))) {
        assert.ok(v >= 0 && v < 1, `вышло за [0,1): ${v}`);
    }
});
