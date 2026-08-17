// Подбор точки для «Гео»: разговор со справочником панорам Google.
//
// Настоящих запросов тут нет — fetch подменён. Проверяем ровно то, что
// сломается молча: что «тут нет панорамы» и «ключ не тот» разведены (первое
// значит «пробуем дальше», второе — «перебирать бессмысленно»), и что дейли
// выдаёт одному и тому же человеку в один и тот же день одну и ту же точку.

import test from 'node:test';
import assert from 'node:assert/strict';

import { nextPoint, dailyRand } from './panoramas.js';

const realFetch = globalThis.fetch;
process.env.GOOGLE_MAPS_KEY = 'test-key';

function stub(replies) {
    let i = 0;
    const calls = [];
    globalThis.fetch = async (url) => {
        calls.push(String(url));
        const body = replies[Math.min(i++, replies.length - 1)];
        return { ok: true, status: 200, json: async () => body };
    };
    return calls;
}

const ZERO = { status: 'ZERO_RESULTS' };
const FOUND = { status: 'OK', pano_id: 'ABC123', location: { lat: 48.85, lng: 2.29 } };

test.after(() => { globalThis.fetch = realFetch; });

test('точка берётся с первой панорамы, которая нашлась', async () => {
    const calls = stub([ZERO, ZERO, FOUND]);
    const point = await nextPoint();
    assert.equal(point.pano, 'ABC123');
    assert.equal(point.lat, 48.85);
    // Страна — от ОПОРНОЙ точки, а не от найденной панорамы: справочник
    // страну не возвращает вовсе.
    assert.ok(point.label.length > 0);
    assert.equal(calls.length, 3);
    // Съёмку внутри помещений не берём: угадывать страну по холлу нельзя.
    assert.ok(calls[0].includes('source=outdoor'));
    assert.ok(calls[0].includes('key=test-key'));
});

test('если панорам нет нигде — возвращается null, а не мусор', async () => {
    stub([ZERO]);
    assert.equal(await nextPoint(), null);
});

test('сломанный ключ — это ошибка, а не «тут нет панорамы»', async () => {
    // Перебирать дальше бессмысленно: все попытки упрутся в то же самое,
    // и молчаливый null увёл бы в «не удалось подобрать точку».
    stub([{ status: 'REQUEST_DENIED', error_message: 'ключ не тот' }]);
    await assert.rejects(nextPoint(), /REQUEST_DENIED/);
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
