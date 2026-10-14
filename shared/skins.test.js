import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canEditSkin, cleanSkin, publicSkin, skinForOperator, skinOperatorKey, operatorAt } from './skins.js';

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

test('звонок — того, кто сидел под кодом в момент звонка, а не того, у кого скин', () => {
    // 101 — двое сменами 2/2: у Ани скин есть, у Бори нет.
    const ann = { userId: 'ann', parts: { leads: 'cat' } };
    const claims = [
        { code: '101', userId: 'ann', at: 1000 },
        { code: '101', userId: null, at: 2000 },     // Аня вышла из аккаунта
        { code: '101', userId: 'borya', at: 3000 },  // Боря открыл «Лиды»
        { code: '105', userId: 'ann', at: 500 },
    ];
    assert.equal(skinForOperator([ann], claims, '0101', 1500), ann);
    assert.equal(skinForOperator([ann], claims, '101', 2500), null, 'вышла — звонки ничьи');
    assert.equal(skinForOperator([ann], claims, '101', 3500), null, 'Боря без скина — без скина');
    assert.equal(skinForOperator([ann], claims, '101', 0), null, 'без времени — хозяин сейчас');
    assert.equal(skinForOperator([ann], claims, '101', 900), null, 'раньше всех строк — ничей');
    assert.equal(skinForOperator([ann], claims, '', 1500), null);
    assert.equal(operatorAt(claims, '105', 9999), 'ann');
    assert.equal(skinForOperator([{ ...ann, parts: { leads: null, frame: 'cat' } }], claims, '101', 1500), null);
    assert.equal(skinOperatorKey('доб. 0042'), '42');
});
