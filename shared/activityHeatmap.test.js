import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildHeatmap, activityLevel, dayTitle, formatDayRu, recordsWord,
    addDays, weekdayIndex, HEATMAP_DAYS,
} from './activityHeatmap.js';

// ── Яркость от среднего ──────────────────────────────────────────────────────

test('пустой день — нулевой уровень независимо от среднего', () => {
    assert.equal(activityLevel(0, 10), 0);
    assert.equal(activityLevel(0, 0), 0);
});

test('шкала считается от среднего, а не от абсолютных чисел', () => {
    // среднее 10: половина и меньше — тускло, ровно среднее — середина,
    // в полтора раза больше — ярче, дальше — максимум.
    assert.equal(activityLevel(5, 10), 1);
    assert.equal(activityLevel(9, 10), 2);
    assert.equal(activityLevel(10, 10), 2);
    assert.equal(activityLevel(15, 10), 3);
    assert.equal(activityLevel(16, 10), 4);
    // то же соотношение при другом масштабе даёт тот же уровень
    assert.equal(activityLevel(1, 2), 1);        // половина среднего — как 5 при 10
    assert.equal(activityLevel(2, 2), 2);
    assert.equal(activityLevel(150, 100), 3);
});

test('без среднего (первый день с записями) уровень минимальный, но не нулевой', () => {
    assert.equal(activityLevel(3, 0), 1);
});

// ── Сетка ────────────────────────────────────────────────────────────────────

const TO = '2026-08-04';   // вторник

test('окно по умолчанию — год, сетка начинается с понедельника', () => {
    const h = buildHeatmap({ days: [], to: TO });
    assert.equal(h.from, addDays(TO, -(HEATMAP_DAYS - 1)));
    assert.equal(weekdayIndex(h.weeks[0].find(Boolean).date), weekdayIndex(h.from));
    // первая клетка первой колонки — понедельник той же недели
    const firstReal = h.weeks[0].findIndex(Boolean);
    assert.equal(firstReal, weekdayIndex(h.from));
    // все колонки — по 7 клеток
    assert.ok(h.weeks.every(w => w.length === 7));
});

test('дни за границами окна — пустые клетки, внутри окна дырок нет', () => {
    const h = buildHeatmap({ days: [], from: '2026-08-01', to: TO });   // сб…вт
    const dates = h.weeks.flat().filter(Boolean).map(c => c.date);
    assert.deepEqual(dates, ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04']);
    // суббота-воскресенье в первой колонке, понедельник-вторник во второй
    assert.equal(h.weeks.length, 2);
    assert.deepEqual(h.weeks[0].map(c => c && c.date),
        [null, null, null, null, null, '2026-08-01', '2026-08-02']);
    assert.deepEqual(h.weeks[1].map(c => c && c.date),
        ['2026-08-03', '2026-08-04', null, null, null, null, null]);
});

test('счётчики раскладываются по своим дням, остальные дни нулевые', () => {
    const h = buildHeatmap({
        days: [{ date: '2026-08-03', count: 4 }, { date: '2026-08-01', count: 2 }],
        from: '2026-08-01', to: TO,
    });
    const byDate = Object.fromEntries(h.weeks.flat().filter(Boolean).map(c => [c.date, c.count]));
    assert.deepEqual(byDate, { '2026-08-01': 2, '2026-08-02': 0, '2026-08-03': 4, '2026-08-04': 0 });
});

test('итоги: среднее — по активным дням, пустые не занижают планку', () => {
    const h = buildHeatmap({
        days: [{ date: '2026-08-01', count: 2 }, { date: '2026-08-03', count: 4 }],
        from: '2026-08-01', to: TO,
    });
    assert.equal(h.total, 6);
    assert.equal(h.activeDays, 2);
    assert.equal(h.average, 3);      // 6 / 2 активных, а не 6 / 4 дня
    assert.equal(h.best, 4);
    // 2 — ниже среднего (2/3), 4 — выше (4/3)
    const byDate = Object.fromEntries(h.weeks.flat().filter(Boolean).map(c => [c.date, c.level]));
    assert.equal(byDate['2026-08-01'], 2);
    assert.equal(byDate['2026-08-03'], 3);
    assert.equal(byDate['2026-08-02'], 0);
});

test('дни вне окна игнорируются, дубли складываются', () => {
    const h = buildHeatmap({
        days: [
            { date: '2026-07-01', count: 99 },        // раньше from
            { date: '2026-09-01', count: 99 },        // позже to
            { date: '2026-08-02', count: 1 },
            { date: '2026-08-02', count: 2 },
        ],
        from: '2026-08-01', to: TO,
    });
    assert.equal(h.total, 3);
    assert.equal(h.activeDays, 1);
});

test('нет записей вовсе — сетка есть, все клетки нулевые', () => {
    const h = buildHeatmap({ days: [], to: TO });
    assert.equal(h.total, 0);
    assert.equal(h.average, 0);
    assert.ok(h.weeks.flat().filter(Boolean).every(c => c.level === 0));
});

test('без даты «по» отдаём пустую сетку, а не падаем', () => {
    const h = buildHeatmap({ days: [{ date: '2026-08-01', count: 1 }] });
    assert.deepEqual(h.weeks, []);
    assert.equal(h.total, 0);
});

test('подписи месяцев идут по порядку и не дублируются', () => {
    const h = buildHeatmap({ days: [], to: TO });
    const labels = h.months.map(m => m.label);
    assert.equal(new Set(h.months.map(m => m.month)).size, h.months.length);
    assert.ok(labels.includes('авг') && labels.includes('янв'));
    // подписи не наезжают друг на друга и не вылезают за сетку
    h.months.forEach((m, i) => {
        if (i < h.months.length - 1) assert.ok(m.span >= 2);
        if (i) assert.ok(m.weekIndex > h.months[i - 1].weekIndex);
        assert.ok(m.weekIndex + m.span <= h.weeks.length);
    });
});

test('текущий месяц подписан, даже если от него осталась одна колонка', () => {
    // 2026-08-04 — вторник первой полной недели августа: колонка всего одна.
    const h = buildHeatmap({ days: [], to: TO });
    const last = h.months[h.months.length - 1];
    assert.equal(last.label, 'авг');
    assert.equal(last.weekIndex, h.weeks.length - 1);
});

// ── Подписи ──────────────────────────────────────────────────────────────────

test('склонение слова «запись»', () => {
    assert.equal(recordsWord(1), 'запись');
    assert.equal(recordsWord(3), 'записи');
    assert.equal(recordsWord(5), 'записей');
    assert.equal(recordsWord(11), 'записей');
    assert.equal(recordsWord(21), 'запись');
    assert.equal(recordsWord(0), 'записей');
});

test('дата в подписи — в родительном падеже, без «г.»', () => {
    assert.equal(formatDayRu('2026-08-04'), '4 августа 2026');
    assert.equal(formatDayRu('2026-01-31'), '31 января 2026');
    assert.equal(formatDayRu('чепуха'), '');
});

test('подсказка при наведении показывает число записей и день', () => {
    assert.equal(dayTitle({ date: '2026-08-04', count: 3 }), '3 записи · 4 августа 2026');
    assert.equal(dayTitle({ date: '2026-08-04', count: 1 }), '1 запись · 4 августа 2026');
    assert.equal(dayTitle({ date: '2026-08-04', count: 0 }), 'Записей нет · 4 августа 2026');
});
