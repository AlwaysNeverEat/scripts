import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PHRASES, isHalloweenSeason, phraseDeck } from './halloween.js';

test('сезон: весь октябрь и два дня ноября', () => {
    assert.equal(isHalloweenSeason(new Date(2026, 8, 30)), false);
    assert.equal(isHalloweenSeason(new Date(2026, 9, 1)), true);
    assert.equal(isHalloweenSeason(new Date(2026, 9, 31, 23, 59)), true);
    assert.equal(isHalloweenSeason(new Date(2026, 10, 2)), true);
    assert.equal(isHalloweenSeason(new Date(2026, 10, 3)), false);
});

// Детерминированный генератор, чтобы тесты не зависели от Math.random.
function seeded(seed) {
    let x = seed >>> 0 || 1;
    return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 2 ** 32; };
}

test('колода: все фразы прозвучат, прежде чем любая повторится', () => {
    const next = phraseDeck(seeded(7));
    const round = Array.from({ length: PHRASES.length }, next);
    assert.equal(new Set(round).size, PHRASES.length);
});

test('колода: на стыке перемешиваний фраза не повторяется подряд', () => {
    const small = ['а', 'б', 'в'];
    for (let seed = 1; seed < 200; seed++) {
        const next = phraseDeck(seeded(seed), small);
        let prev = next();
        for (let i = 0; i < 30; i++) {
            const cur = next();
            assert.notEqual(cur, prev, `сид ${seed}, шаг ${i}`);
            prev = cur;
        }
    }
});

test('колода: из одной фразы и из пустого пака', () => {
    assert.equal(phraseDeck(Math.random, ['бу'])(), 'бу');
    assert.equal(phraseDeck(Math.random, [])(), '');
});

test('пак фраз: без повторов и не простыней', () => {
    assert.equal(new Set(PHRASES).size, PHRASES.length);
    for (const p of PHRASES) assert.ok(p.length <= 80, `длинная фраза: ${p}`);
});
