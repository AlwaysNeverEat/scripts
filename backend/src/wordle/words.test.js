import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerFor, isKnownWord, ANSWERS_COUNT } from './words.js';
import { mskDay, nextMidnightMsk } from './day.js';
import { isWordShape } from '../../../shared/wordle.js';

test('слово дня не меняется в течение суток', () => {
    const a = answerFor('user-1', '2026-08-13');
    const b = answerFor('user-1', '2026-08-13');
    assert.equal(a, b);
    assert.equal(isWordShape(a), true);
});

test('у разных аккаунтов слова разные, у одного — разные по дням', () => {
    const day = '2026-08-13';
    const mine = answerFor('user-1', day);
    // Совпадение у двух конкретных людей возможно (слов всего ~900), поэтому
    // проверяем не пару, а то, что выборка вообще расходится по аккаунтам.
    const others = new Set(Array.from({ length: 50 }, (_, i) => answerFor(`user-${i}`, day)));
    assert.ok(others.size > 20, `слова слиплись: ${others.size} вариантов на 50 аккаунтов`);

    const week = new Set(Array.from({ length: 7 }, (_, i) => answerFor('user-1', `2026-08-1${i}`)));
    assert.ok(week.size >= 5, `за неделю всего ${week.size} разных слов`);
    assert.ok(mine.length === 5);
});

test('загаданное слово всегда принимается как попытка', () => {
    for (let i = 0; i < 200; i++) {
        const w = answerFor(`user-${i}`, '2026-08-13');
        assert.equal(isKnownWord(w), true, `${w} нет в словаре попыток`);
    }
});

test('словарь попыток: своё слово да, мусор нет', () => {
    assert.equal(isKnownWord('карта'), true);
    assert.equal(isKnownWord('КАРТА'), true);
    assert.equal(isKnownWord('ёлочк'), false);
    assert.equal(isKnownWord('ффффф'), false);
    assert.equal(isKnownWord('карт'), false);
    assert.equal(isKnownWord('cards'), false);
    assert.ok(ANSWERS_COUNT > 300, 'список ответов подозрительно короткий');
});

test('сутки считаются по МСК, а следующая полночь — ровно через сутки', () => {
    // 12 августа 22:30 UTC — это уже 13-е в Москве.
    const late = new Date('2026-08-12T22:30:00Z');
    assert.equal(mskDay(late), '2026-08-13');
    assert.equal(nextMidnightMsk(late).toISOString(), '2026-08-13T21:00:00.000Z');

    const early = new Date('2026-08-12T20:59:59Z');
    assert.equal(mskDay(early), '2026-08-12');
    assert.equal(answerFor('u', mskDay(early)) !== undefined, true);
});
