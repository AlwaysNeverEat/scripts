import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWord, rankOf, closestWords, hintWord, ANSWERS, VOCAB_SIZE, ANSWERS_COUNT } from './tables.js';
import { pickForUser } from '../daily.js';

test('таблицы на месте и согласованы', () => {
    assert.ok(VOCAB_SIZE > 10000, `словарь подозрительно мал: ${VOCAB_SIZE}`);
    assert.ok(ANSWERS_COUNT >= 300, `ответов мало: ${ANSWERS_COUNT}`);
    // Каждое слово-ответ обязано быть и в словаре: иначе игрок не сможет его
    // назвать, даже угадав.
    for (const w of ANSWERS) assert.equal(resolveWord(w), w, `${w} нет в словаре`);
});

test('загаданное слово стоит на первом месте у самого себя', () => {
    for (const w of ANSWERS.slice(0, 50)) assert.equal(rankOf(w, w), 1);
});

test('ранги — это перестановка мест, а не повторы', () => {
    const answer = ANSWERS[0];
    const top = closestWords(answer, 20);
    assert.equal(top.length, 20);
    assert.equal(top[0].word, answer);
    assert.deepEqual(top.map(x => x.rank), Array.from({ length: 20 }, (_, i) => i + 1));
});

test('словоформы приводятся к слову словаря', () => {
    assert.equal(resolveWord('машиной'), 'машина');
    assert.equal(resolveWord('машины'), 'машина');
    assert.equal(resolveWord('МАШИНА'), 'машина');
    assert.equal(resolveWord('детей'), 'ребенок');   // супплетивная форма
    assert.equal(resolveWord('ребёнок'), 'ребенок'); // «ё» не должна мешать
    assert.equal(resolveWord('абырвалг'), null);
    assert.equal(resolveWord(''), null);
});

test('подсказки идут лесенкой и упираются во второе место', () => {
    // Та же арифметика, что в routes/kontekst.js: каждая подсказка вдвое
    // ближе найденного, но не дальше сотого места.
    const ladder = [];
    let best = Infinity;
    while (best > 2) {
        const half = Number.isFinite(best) && best > 1 ? Math.floor(best / 2) : 100;
        const to = Math.min(100, Math.max(2, half));
        const hint = hintWord(ANSWERS[0], Math.max(2, Math.floor(to / 2)), to);
        assert.ok(hint, 'подсказка не нашлась');
        assert.ok(hint.rank < best, `подсказка ${hint.rank} не ближе ${best}`);
        assert.ok(hint.rank >= 2, 'подсказка не должна выдавать само слово');
        ladder.push(hint.rank);
        best = hint.rank;
    }
    assert.ok(ladder.length >= 3, `лесенка вышла короткой: ${ladder}`);
    assert.equal(ladder.at(-1), 2);
});

test('слово дня своё у каждого аккаунта и меняется по дням', () => {
    const day = '2026-08-13';
    const salt = 'k-spot-kontekst';
    const mine = pickForUser(ANSWERS, 'user-1', day, salt);
    assert.equal(mine, pickForUser(ANSWERS, 'user-1', day, salt));
    const others = new Set(Array.from({ length: 50 }, (_, i) => pickForUser(ANSWERS, `user-${i}`, day, salt)));
    assert.ok(others.size > 20, `слова слиплись: ${others.size} вариантов на 50 аккаунтов`);
    const week = new Set(Array.from({ length: 7 }, (_, i) => pickForUser(ANSWERS, 'user-1', `2026-08-1${i}`, salt)));
    assert.ok(week.size >= 5, `за неделю всего ${week.size} разных слов`);
});

test('пасхалки не ходят парой: соли разводят их выбор', () => {
    const day = '2026-08-13';
    const a = Array.from({ length: 30 }, (_, i) => ANSWERS.indexOf(pickForUser(ANSWERS, `u${i}`, day, 'k-spot-kontekst')));
    const b = Array.from({ length: 30 }, (_, i) => ANSWERS.indexOf(pickForUser(ANSWERS, `u${i}`, day, 'k-spot-wordle')));
    assert.notDeepEqual(a, b);
});
