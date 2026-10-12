import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canEditSkin, cleanSkin, publicSkin, skinForOperator, skinOperatorKey } from './skins.js';

test('ставить скин может только логин из списка', () => {
    assert.equal(canEditSkin({ login: 'gtrixoff' }), true);
    assert.equal(canEditSkin({ login: ' GTrixOff ' }), true);
    assert.equal(canEditSkin({ login: 'borya' }), false);
    assert.equal(canEditSkin(null), false);
});

test('части собираются из разных паков, стандартный вид — null', () => {
    assert.deepEqual(cleanSkin({ parts: { frame: 'cat', junk: 'cat' }, operator: '0103' }),
        { skin: { parts: { frame: 'cat', cover: null, leads: null, records: null }, operator: '103' } });
    assert.deepEqual(cleanSkin({}).skin.parts, { frame: null, cover: null, leads: null, records: null });
    assert.equal(cleanSkin({ parts: { leads: 'dragon' } }).error, 'такого скина нет');
    assert.equal(cleanSkin({ parts: { leads: '__proto__' } }).error, 'такого скина нет');
});

test('ничего не надето — в список не уходит, пропавший пак — стандартный вид', () => {
    assert.equal(publicSkin({ user_id: 'u', parts: {} }), null);
    assert.equal(publicSkin({ user_id: 'u', parts: { frame: 'dragon' } }), null);
    assert.deepEqual(publicSkin({ user_id: 'u', parts: { frame: 'cat', leads: 'dragon' }, operator: '07' }),
        { userId: 'u', parts: { frame: 'cat', cover: null, leads: null, records: null }, operator: '7' });
});

test('лид узнаётся по коду оператора, спорный код — без скина', () => {
    const a = { userId: 'a', parts: { leads: 'cat' }, operator: '103' };
    const b = { userId: 'b', parts: { leads: 'cat' }, operator: '104' };
    assert.equal(skinForOperator([a, b], '0103'), a);
    assert.equal(skinForOperator([a, b], ''), null);
    assert.equal(skinForOperator([a, { ...b, operator: '103' }], '103'), null);
    assert.equal(skinForOperator([{ ...a, parts: { leads: null, frame: 'cat' } }], '103'), null);
    assert.equal(skinOperatorKey('доб. 0042'), '42');
});
