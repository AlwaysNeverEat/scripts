import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canEditSkin, cleanSkin, publicSkin, skinForOperator, skinOperatorKey } from './skins.js';

test('ставить скин может только логин из списка', () => {
    assert.equal(canEditSkin({ login: 'gtrixoff' }), true);
    assert.equal(canEditSkin({ login: ' GTrixOff ' }), true);
    assert.equal(canEditSkin({ login: 'borya' }), false);
    assert.equal(canEditSkin(null), false);
});

test('пак проверяется, части по умолчанию включены', () => {
    assert.deepEqual(cleanSkin({ pack: 'cat', parts: { frame: false, junk: true }, operator: '0103' }),
        { skin: { pack: 'cat', parts: { frame: false, leads: true, records: true }, operator: '103' } });
    assert.deepEqual(cleanSkin({ pack: null }).skin.pack, null);
    assert.deepEqual(cleanSkin({}).skin.pack, null);
    assert.equal(cleanSkin({ pack: 'dragon' }).error, 'такого скина нет');
    assert.equal(cleanSkin({ pack: '__proto__' }).error, 'такого скина нет');
});

test('снятый и незнакомый скин в список не уходят', () => {
    assert.equal(publicSkin({ user_id: 'u', pack: null }), null);
    assert.equal(publicSkin({ user_id: 'u', pack: 'dragon' }), null);
    assert.deepEqual(publicSkin({ user_id: 'u', pack: 'cat', parts: { leads: false }, operator: '07' }),
        { userId: 'u', pack: 'cat', parts: { frame: true, leads: false, records: true }, operator: '7' });
});

test('лид узнаётся по коду оператора, спорный код — без скина', () => {
    const a = { userId: 'a', pack: 'cat', parts: { leads: true }, operator: '103' };
    const b = { userId: 'b', pack: 'cat', parts: { leads: true }, operator: '104' };
    assert.equal(skinForOperator([a, b], '0103'), a);
    assert.equal(skinForOperator([a, b], ''), null);
    assert.equal(skinForOperator([a, { ...b, operator: '103' }], '103'), null);
    assert.equal(skinForOperator([{ ...a, parts: { leads: false } }], '103'), null);
    assert.equal(skinOperatorKey('доб. 0042'), '42');
});
