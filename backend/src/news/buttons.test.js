import test from 'node:test';
import assert from 'node:assert/strict';

import { clampDelta, knownButton, MAX_DELTA, BUTTONS, counts, bump } from './buttons.js';

// Живого Postgres в node --test нет — подменяем db, как в credits.test.js:
// проверяем, с чем ходят в базу и во что превращают ответ.
function fakeDb(rows = []) {
    const calls = [];
    const db = async (text, params) => { calls.push({ text, params }); return { rows }; };
    return { db, calls };
}

test('clampDelta: обычное нажатие проходит как есть', () => {
    assert.equal(clampDelta(1), 1);
    assert.equal(clampDelta(7), 7);
});

test('clampDelta: пачка сверху обрезается потолком', () => {
    assert.equal(clampDelta(MAX_DELTA + 1), MAX_DELTA);
    assert.equal(clampDelta(1e9), MAX_DELTA);
});

// Ноль означает «ничего не прибавляем»: такой запрос просто вернёт счётчики.
test('clampDelta: мусор и минус — это ноль, а не отрицательный счётчик', () => {
    for (const bad of [0, -5, null, undefined, NaN, Infinity, 'много', {}]) {
        assert.equal(clampDelta(bad), 0, String(bad));
    }
});

test('clampDelta: дробное режется вниз', () => {
    assert.equal(clampDelta(3.9), 3);
});

test('knownButton: чужой id в базу не попадёт', () => {
    assert.equal(knownButton('bitrix-copy'), true);
    assert.equal(knownButton('всё что угодно'), false);
    // Свойства прототипа — тоже не кнопки.
    assert.equal(knownButton('constructor'), false);
    assert.equal(knownButton('toString'), false);
});

test('у каждой кнопки указан пост, в котором она живёт', () => {
    for (const [id, post] of Object.entries(BUTTONS)) {
        assert.ok(post, `у кнопки ${id} нет поста`);
    }
});

test('counts: bigint из pg приезжает строкой, а уехать должен числом', async () => {
    // Иначе окно склеит своё «+1» со строкой текстом: «17» + 1 = «171».
    const { db } = fakeDb([{ total: '17', mine: '4' }]);
    assert.deepEqual(await counts('bitrix-copy', 'u1', { db }), { total: 17, mine: 4 });
});

test('counts: кнопки ещё никто не касался — нули, а не пустота', async () => {
    const { db } = fakeDb([]);
    assert.deepEqual(await counts('bitrix-copy', 'u1', { db }), { total: 0, mine: 0 });
});

test('bump: нулевая пачка в базу не пишет, но счётчики возвращает', async () => {
    const { db, calls } = fakeDb([{ total: '3', mine: '3' }]);
    const res = await bump('bitrix-copy', 'u1', 0, { db });
    assert.equal(calls.length, 1);                       // только чтение
    assert.match(calls[0].text, /SELECT/);
    assert.deepEqual(res, { total: 3, mine: 3 });
});

test('bump: пачка прибавляется одним upsert-ом, а не чтением со сложением', async () => {
    // По кнопке щёлкают с нескольких вкладок сразу: «прочитать — сложить —
    // записать» теряло бы чужие нажатия между чтением и записью.
    const { db, calls } = fakeDb([{ total: '9', mine: '9' }]);
    await bump('bitrix-copy', 'u1', 5, { db });
    assert.equal(calls.length, 2);
    assert.match(calls[0].text, /INSERT INTO news_button_clicks/);
    assert.match(calls[0].text, /ON CONFLICT/);
    assert.deepEqual(calls[0].params, ['bitrix-copy', 'u1', 5]);
});
