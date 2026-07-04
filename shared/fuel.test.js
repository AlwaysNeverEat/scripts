import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDieselFuel, isPetrolFuel, normalizeFuelCode, fuelLabel, fuelSelectOptions } from './fuel.js';

test('коды дизеля 05/06 и текст «Дизель»', () => {
    assert.equal(isDieselFuel('05'), true);
    assert.equal(isDieselFuel('06'), true);
    assert.equal(isDieselFuel('Дизель'), true);
    assert.equal(isDieselFuel('diesel'), true);
    assert.equal(isDieselFuel('01'), false);
    assert.equal(isDieselFuel(''), false);
});

test('бензин: коды 01/02/04 и текст', () => {
    assert.equal(isPetrolFuel('01'), true);
    assert.equal(isPetrolFuel('02'), true);
    assert.equal(isPetrolFuel('Бензин'), true);
    assert.equal(isPetrolFuel('05'), false);
});

test('нераспознанный код НЕ считается бензином', () => {
    assert.equal(isPetrolFuel('08'), false);
    assert.equal(isDieselFuel('08'), false);
    assert.equal(normalizeFuelCode('08'), '');
});

test('normalizeFuelCode приводит к кодам селекта', () => {
    assert.equal(normalizeFuelCode('06'), '05');
    assert.equal(normalizeFuelCode('Дизель'), '05');
    assert.equal(normalizeFuelCode('04'), '01');
    assert.equal(normalizeFuelCode('бензин + газ'), '02');
    assert.equal(normalizeFuelCode(null), '');
});

test('fuelLabel: дизель/бензин/неизвестное', () => {
    assert.equal(fuelLabel('05'), '⛽ дизель');
    assert.equal(fuelLabel('01'), '⛽ бензин');
    assert.equal(fuelLabel(''), '');
    assert.equal(fuelLabel('08'), '⛽ топливо: 08?');
    assert.ok(!fuelLabel('<img>').includes('<img>'), 'сырое значение экранируется');
});

test('fuelSelectOptions отмечает текущее значение', () => {
    assert.ok(fuelSelectOptions('06').includes('value="05" selected'));
    assert.ok(fuelSelectOptions('08').includes('value="" selected'));
});
