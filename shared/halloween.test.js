import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PHRASES, isHalloweenSeason, pickPhrase } from './halloween.js';

test('сезон: весь октябрь и два дня ноября', () => {
    assert.equal(isHalloweenSeason(new Date(2026, 8, 30)), false);
    assert.equal(isHalloweenSeason(new Date(2026, 9, 1)), true);
    assert.equal(isHalloweenSeason(new Date(2026, 9, 31, 23, 59)), true);
    assert.equal(isHalloweenSeason(new Date(2026, 10, 2)), true);
    assert.equal(isHalloweenSeason(new Date(2026, 10, 3)), false);
});

test('фраза не повторяется подряд', () => {
    const first = PHRASES[0];
    assert.notEqual(pickPhrase(first, () => 0), first);
    assert.equal(pickPhrase(null, () => 0), first);
    assert.equal(pickPhrase(null, () => 0.9999), PHRASES[PHRASES.length - 1]);
});

test('пак фраз: без повторов и не простыней', () => {
    assert.equal(new Set(PHRASES).size, PHRASES.length);
    for (const p of PHRASES) assert.ok(p.length <= 80, `длинная фраза: ${p}`);
});
