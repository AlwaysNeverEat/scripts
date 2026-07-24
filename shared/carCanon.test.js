import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brandKey, canonicalBrand, canonCar } from './carCanon.js';

test('canonicalBrand склеивает варианты Haval', () => {
  assert.equal(canonicalBrand('GWM HAVAL'), 'Haval');
  assert.equal(canonicalBrand('HAVAL'), 'Haval');
  assert.equal(canonicalBrand('Haval'), 'Haval');
  assert.equal(canonicalBrand('Great Wall Haval'), 'Haval');
});

test('canonicalBrand: VW → Volkswagen, LADA / AVTOVAZ → Lada', () => {
  assert.equal(canonicalBrand('VW'), 'Volkswagen');
  assert.equal(canonicalBrand('vw'), 'Volkswagen');
  assert.equal(canonicalBrand('VOLKSWAGEN'), 'Volkswagen');
  assert.equal(canonicalBrand('LADA / AVTOVAZ'), 'Lada');
  assert.equal(canonicalBrand('LADA'), 'Lada');
  assert.equal(canonicalBrand('VAZ'), 'Lada');
});

test('canonicalBrand: неизвестная марка — без правила', () => {
  assert.equal(canonicalBrand('FORD'), null);
  assert.equal(canonicalBrand('Geely'), null);
});

test('brandKey сводит все варианты одной марки к одному ключу', () => {
  assert.equal(brandKey('GWM HAVAL'), brandKey('Haval'));
  assert.equal(brandKey('VW'), brandKey('VOLKSWAGEN'));
  assert.equal(brandKey('LADA / AVTOVAZ'), brandKey('lada'));
  assert.equal(brandKey('FORD'), 'ford');
  assert.notEqual(brandKey('Geely'), brandKey('Haval'));
});

test('canonCar: Ford «Focus Mk II» → «Focus» + поколение', () => {
  const car = canonCar({ brand: 'FORD', model: 'Focus Mk II', generation: 'C307' });
  assert.equal(car.brand, 'FORD'); // написание марки без правила не трогаем
  assert.equal(car.model, 'Focus');
  assert.equal(car.generation, '2 (C307)');
});

test('canonCar: Mk без кузовного кода — только номер поколения', () => {
  const car = canonCar({ brand: 'Ford', model: 'Fiesta Mk VII', generation: null });
  assert.equal(car.model, 'Fiesta');
  assert.equal(car.generation, '7');
});

test('canonCar: поколение уже совпадает с номером — не дублируем', () => {
  const car = canonCar({ brand: 'Ford', model: 'Focus Mk 2', generation: '2' });
  assert.equal(car.model, 'Focus');
  assert.equal(car.generation, '2');
});

test('canonCar: «Focus C-Max» и Geely «MK» не трогаются', () => {
  assert.equal(canonCar({ brand: 'FORD', model: 'Focus C-Max' }).model, 'Focus C-Max');
  assert.equal(canonCar({ brand: 'GEELY', model: 'MK' }).model, 'MK');
  // Mk-правило только для Ford: чужие марки с похожими моделями не трогаем
  assert.equal(canonCar({ brand: 'Rover', model: 'Mini Mk II' }).model, 'Mini Mk II');
});

test('canonCar не трогает остальные поля и не мутирует вход', () => {
  const src = { brand: 'VW', model: 'Golf', engine_code: 'BSE', tags: ['гольфик'] };
  const out = canonCar(src);
  assert.equal(out.brand, 'Volkswagen');
  assert.equal(out.model, 'Golf');
  assert.equal(out.engine_code, 'BSE');
  assert.deepEqual(out.tags, ['гольфик']);
  assert.equal(src.brand, 'VW');
});
