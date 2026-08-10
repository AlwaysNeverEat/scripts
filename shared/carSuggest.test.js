import test from 'node:test';
import assert from 'node:assert/strict';

import { normKey, similarity, exactMatch, similarValues, rankOptions } from './carSuggest.js';

const BRANDS = [
    { value: 'Volkswagen', count: 312 },
    { value: 'Volvo', count: 88 },
    { value: 'Toyota', count: 401 },
    { value: 'Land Rover', count: 24 },
];

test('normKey: регистр, пунктуация и пробелы не создают разных значений', () => {
    assert.equal(normKey('Land Rover'), normKey('  land-rover '));
    assert.equal(normKey('VW'), normKey('vw'));
});

test('normKey: кириллические двойники латиницы схлопываются', () => {
    // «С5 (Т19С)» набрано в русской раскладке — визуально не отличить
    assert.equal(normKey('С5 (Т19С)'), normKey('C5 (T19C)'));
});

test('exactMatch отдаёт написание ИЗ БАЗЫ, а не набранное', () => {
    const hit = exactMatch('  volkswagen ', BRANDS);
    assert.equal(hit.value, 'Volkswagen');
    assert.equal(exactMatch('Cupra', BRANDS), null);
});

test('«VW» опознаётся как Volkswagen — ради этого всё и затевалось', () => {
    const [top] = similarValues('VW', BRANDS);
    assert.equal(top.value, 'Volkswagen');
    assert.equal(top.reason, 'synonym');
});

test('кириллица тоже: «фольксваген» ведёт к латинской марке из базы', () => {
    const [top] = similarValues('Фольксваген', BRANDS);
    assert.equal(top.value, 'Volkswagen');
});

test('опечатка ловится похожестью букв', () => {
    const [top] = similarValues('Voklswagen', BRANDS);
    assert.equal(top.value, 'Volkswagen');
    assert.equal(top.reason, 'similar');
});

test('то же значение другим регистром — reason=same, а не «похоже»', () => {
    const [top] = similarValues('volvo', BRANDS);
    assert.equal(top.reason, 'same');
});

test('совсем чужое значение подсказок не даёт — новую марку заводить можно', () => {
    assert.deepEqual(similarValues('Zeekr', BRANDS), []);
});

test('similarity: одинаковые ключи — 1, разные строки — меньше порога', () => {
    assert.equal(similarity('Volvo', 'volvo'), 1);
    assert.ok(similarity('Volvo', 'Toyota') < 0.3);
});

test('rankOptions: пустой ввод отдаёт список как есть', () => {
    assert.deepEqual(rankOptions('', BRANDS).map(o => o.value),
        BRANDS.map(o => o.value));
});

test('rankOptions: совпадение по началу выше, чем по середине', () => {
    const names = rankOptions('vol', BRANDS).map(o => o.value);
    assert.deepEqual(names.slice(0, 2), ['Volkswagen', 'Volvo']);
    assert.ok(!names.includes('Toyota'));
});

test('rankOptions: синоним находит запись, которой нет по буквам', () => {
    assert.deepEqual(rankOptions('фольксваген', BRANDS).map(o => o.value), ['Volkswagen']);
});

test('rankOptions: список строк принимается наравне с {value,count}', () => {
    assert.deepEqual(rankOptions('vol', ['Volvo', 'Toyota']).map(o => o.value), ['Volvo']);
});
