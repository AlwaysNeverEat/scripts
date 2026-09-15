import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stationsWithFilter, stationsWithAll, rankStations, formatKm } from './filterScout.js';

// Строки — как их отдаёт parseStockTable: counts по id станций из колонок CRM.
const row = (name, counts) => ({ name, counts });

test('станция считается по остатку больше нуля', () => {
    const rows = [row('W 914/2 Масляный фильтр MANN', { 45: 2, 11: 0 })];
    const got = stationsWithFilter(rows, 'мф');
    assert.deepEqual([...got], ['45']);
});

test('чужой тип не считается, когда строки нужного типа есть', () => {
    // Артикул совпал и с масляным, и с топливным: топливный на 11-й не должен
    // красить её как «масляный есть».
    const rows = [
        row('W 914/2 Масляный фильтр MANN', { 45: 1 }),
        row('W 914/2 Топливный фильтр', { 11: 3 }),
    ];
    assert.deepEqual([...stationsWithFilter(rows, 'мф')], ['45']);
});

test('без строк нужного типа считаются все — как в панели наличия', () => {
    const rows = [row('W 914/2 Элемент фильтрующий', { 11: 3 })];
    assert.deepEqual([...stationsWithFilter(rows, 'мф')], ['11']);
});

test('колонка-сумма (без станций) станцией не считается', () => {
    const rows = [row('Масляный фильтр', { all: 7 })];
    assert.equal(stationsWithFilter(rows, 'мф').size, 0);
});

test('stationsWithAll — пересечение по всем фильтрам', () => {
    const results = [
        { crmType: 'вф', rows: [row('C 25 040 Воздушный фильтр', { 1: 1, 2: 1 })] },
        { crmType: 'мф', rows: [row('W 914/2 Масляный фильтр', { 2: 1, 3: 1 })] },
        { crmType: 'сф', rows: [row('CUK 25 001 Фильтр салона', { 2: 4 })] },
    ];
    assert.deepEqual([...stationsWithAll(results)], ['2']);
    assert.equal(stationsWithAll([]).size, 0);
});

test('rankStations — ближние сверху, без координат в конце', () => {
    const stations = [
        { id: '1', name: 'Фучика 23А' },        // в справочнике, рядом с Фучика 14
        { id: '2', name: 'Кудрово, Центральная 25' },
        { id: '3', name: 'Новая станция без меты' },
    ];
    const got = rankStations(new Set(['1', '2', '3']), stations, 'Фучика 14к4');
    assert.deepEqual(got.map(s => s.id), ['1', '2', '3']);
    assert.ok(got[0].km < 0.5);
    assert.ok(got[1].km > got[0].km);
    assert.equal(got[2].km, null);
});

test('rankStations — точка отсчёта без меты оставляет кандидатов без дистанции', () => {
    const stations = [{ id: '1', name: 'Оптиков 2' }];
    const got = rankStations(new Set(['1']), stations, 'Станция, которой нет в справочнике');
    assert.equal(got.length, 1);
    assert.equal(got[0].km, null);
});

test('formatKm — десятые до десяти, дальше целые, запятая как на сайте', () => {
    assert.equal(formatKm(4.23), '4,2 км');
    assert.equal(formatKm(0.12), '0,1 км');
    assert.equal(formatKm(12.7), '13 км');
    assert.equal(formatKm(null), '');
});
