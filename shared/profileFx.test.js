import test from 'node:test';
import assert from 'node:assert/strict';

import { AVATAR_FX, PROFILE_FX, normalizeFx } from './profileFx.js';

// id уходит в базу и в CSS-классы (.afx-<id>/.pfx-<id>) — повтор или пробел в
// id молча сломал бы и хранение, и рендер.
test('id эффектов уникальны и годятся в CSS-класс', () => {
    const all = [...AVATAR_FX, ...PROFILE_FX].map(f => f.id);
    assert.equal(new Set(all).size, all.length);
    for (const id of all) assert.match(id, /^[a-z][a-z0-9-]*$/);
});

test('у каждого эффекта есть имя, цена и описание', () => {
    for (const f of [...AVATAR_FX, ...PROFILE_FX]) {
        assert.ok(f.name && f.about, f.id);
        assert.ok(Number.isFinite(f.price) && f.price > 0, f.id);
    }
});

test('normalizeFx: мусор и чужие id превращаются в null, свои остаются', () => {
    assert.deepEqual(normalizeFx(null), { avatar: null, profile: null });
    assert.deepEqual(normalizeFx({ avatar: 'nope', profile: 42 }), { avatar: null, profile: null });
    // рамка не может встать эффектом обложки и наоборот
    assert.deepEqual(normalizeFx({ avatar: PROFILE_FX[0].id, profile: AVATAR_FX[0].id }),
        { avatar: null, profile: null });
    const ok = { avatar: AVATAR_FX[0].id, profile: PROFILE_FX[0].id };
    assert.deepEqual(normalizeFx(ok), ok);
});
