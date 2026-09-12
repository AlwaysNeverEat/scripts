import test from 'node:test';
import assert from 'node:assert/strict';

import { cleanQuery, normQuery, remember, recent, MAX_QUERY_LEN } from './stockHistory.js';

// Живого Postgres в node --test нет — подменяем db, как в news/buttons.test.js.
function fakeDb(rows = []) {
    const calls = [];
    const db = async (text, params) => { calls.push({ text, params }); return { rows }; };
    return { db, calls };
}

test('cleanQuery: пробелы схлопываются, края режутся, длина ограничена', () => {
    assert.equal(cleanQuery('  W   712/95 \n'), 'W 712/95');
    assert.equal(cleanQuery('x'.repeat(MAX_QUERY_LEN + 20)).length, MAX_QUERY_LEN);
    assert.equal(cleanQuery(null), '');
    assert.equal(cleanQuery(42), '42');
});

test('normQuery: регистр не различается — одна подсказка, а не две', () => {
    assert.equal(normQuery('W 712/95'), normQuery('w 712/95'));
});

test('remember: пустой запрос в базу не идёт', async () => {
    const { db, calls } = fakeDb();
    await remember('   ', 'u1', { db });
    assert.equal(calls.length, 0);
});

test('remember: ключ нормализованный, а написание — как набрали', async () => {
    const { db, calls } = fakeDb();
    await remember('  W 712/95 ', 'u1', { db });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].params, ['w 712/95', 'W 712/95', 'u1']);
    assert.match(calls[0].text, /ON CONFLICT \(query_norm\)/);
    assert.match(calls[0].text, /uses \+ 1/);
});

test('recent: bigint приезжает строкой, а уезжает числом; дата — ISO', async () => {
    const at = new Date('2026-09-12T10:00:00Z');
    const { db } = fakeDb([{ query: 'W 712/95', uses: '7', last_at: at }]);
    assert.deepEqual(await recent({ db }), [{ query: 'W 712/95', uses: 7, lastAt: '2026-09-12T10:00:00.000Z' }]);
});
