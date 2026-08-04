import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadActivity } from './activity.js';
import { HEATMAP_DAYS } from '../../../shared/activityHeatmap.js';

// Живого Postgres в node --test нет — подменяем db, как в users.role.test.js.
// Проверяем ровно то, за что отвечает этот модуль: во что превращается ответ
// БД и с чем к ней ходят. Сам SQL (границы суток в МСК) проверен на живой базе.

function fakeDb(rows) {
    const calls = [];
    const db = async (text, params) => { calls.push({ text, params }); return { rows }; };
    return { db, calls };
}

test('дни превращаются в [{date, count}], границы окна берутся из ответа БД', async () => {
    const { db, calls } = fakeDb([
        { to_day: '2026-08-04', from_day: '2025-08-05', day: '2025-08-05', count: 1 },
        { to_day: '2026-08-04', from_day: '2025-08-05', day: '2026-08-04', count: 3 },
    ]);
    const a = await loadActivity('user-1', { db });

    assert.deepEqual(a, {
        from: '2025-08-05',
        to: '2026-08-04',
        days: [{ date: '2025-08-05', count: 1 }, { date: '2026-08-04', count: 3 }],
    });
    assert.deepEqual(calls[0].params, ['user-1', HEATMAP_DAYS]);
});

test('у пользователя без записей окно всё равно есть, а дней нет', async () => {
    // LEFT JOIN отдаёт одну строку с пустым day — сетку рисовать всё равно надо.
    const { db } = fakeDb([{ to_day: '2026-08-04', from_day: '2025-08-05', day: null, count: 0 }]);
    const a = await loadActivity('user-2', { db });

    assert.equal(a.from, '2025-08-05');
    assert.equal(a.to, '2026-08-04');
    assert.deepEqual(a.days, []);
});

test('пустой ответ БД не роняет ленту', async () => {
    const { db } = fakeDb([]);
    assert.deepEqual(await loadActivity('user-3', { db }), { from: null, to: null, days: [] });
});
