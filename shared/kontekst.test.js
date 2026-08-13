import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWord, isWordShape, rankHeat, rankProgress } from './kontekst.js';

test('слово приводится к нижнему регистру без «ё»', () => {
    assert.equal(normalizeWord('  Ёлка '), 'елка');
    assert.equal(normalizeWord('РЕБЁНОК'), 'ребенок');
});

test('isWordShape пропускает только русские слова от двух букв', () => {
    assert.equal(isWordShape('кот'), true);
    assert.equal(isWordShape('к'), false);
    assert.equal(isWordShape('cat'), false);
    assert.equal(isWordShape('кот!'), false);
    assert.equal(isWordShape('два слова'), false);
});

test('температура догадки', () => {
    assert.equal(rankHeat(1), 'hot');
    assert.equal(rankHeat(300), 'hot');
    assert.equal(rankHeat(301), 'warm');
    assert.equal(rankHeat(2000), 'warm');
    assert.equal(rankHeat(2001), 'cold');
});

test('полоска логарифмическая: у близких догадок она заметно длиннее', () => {
    const p = (rank) => rankProgress(rank, 30000);
    assert.equal(p(1), 1);
    assert.equal(p(30000), 0);
    // Линейная шкала дала бы 5-му и 500-му месту 99,98% и 98,3% — на глаз
    // одинаково. Логарифмическая разводит их на четверть полоски.
    assert.ok(p(5) - p(500) > 0.2, `разница вышла ${p(5) - p(500)}`);
    assert.ok(p(5) > p(50) && p(50) > p(500) && p(500) > p(5000), 'порядок нарушен');
    // За пределами словаря полоска не уходит в минус.
    assert.equal(p(999999), 0);
});
