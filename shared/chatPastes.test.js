import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    cleanTopic, canonTopic, cleanTopics, cleanPaste, topicsOf, filterPastes, firstBlank,
    DEFAULT_PASTES, TOPIC_MAX, TOPICS_MAX, TITLE_MAX, BODY_MAX,
} from './chatPastes.js';

test('тема: короткая метка, а не абзац', () => {
    assert.equal(cleanTopic('  Сбор   данных '), 'Сбор данных');
    const long = cleanTopic('Война и мир, том первый, часть вторая, глава третья');
    assert.ok(long.length <= TOPIC_MAX);
    assert.equal(long, long.trim(), 'обрезка не оставляет хвостового пробела');
});

test('тема, набранная другим регистром, пишется как существующая', () => {
    assert.equal(canonTopic('запись', ['Сбор данных', 'Запись']), 'Запись');
    assert.equal(canonTopic('Новая тема', ['Запись']), 'Новая тема');
    assert.equal(canonTopic('   ', ['Запись']), '');
});

test('темы пасты: без повторов и не больше потолка', () => {
    assert.deepEqual(cleanTopics(['Запись', 'запись', ' ', 'Общее']), ['Запись', 'Общее']);
    assert.equal(cleanTopics(['а', 'б', 'в', 'г', 'д', 'е']).length, TOPICS_MAX);
    assert.deepEqual(cleanTopics('не массив'), []);
});

test('паста: текст обязателен, заголовок и темы чистятся', () => {
    assert.ok(cleanPaste({ body: '   ' }).error);
    assert.ok(cleanPaste({ body: 'я'.repeat(BODY_MAX + 1) }).error);
    const { paste } = cleanPaste({ title: '  Привет  ', body: 'Строка 1\r\nСтрока 2 ', topics: ['общее'] }, ['Общее']);
    assert.deepEqual(paste, { title: 'Привет', body: 'Строка 1\nСтрока 2', topics: ['Общее'] });
    assert.ok(cleanPaste({ title: 'х'.repeat(200), body: 'б' }).paste.title.length <= TITLE_MAX);
});

test('темы — в порядке разговора, а не по алфавиту', () => {
    assert.deepEqual(topicsOf(DEFAULT_PASTES), ['Сбор данных', 'Расчёт', 'Наличие', 'Запись', 'Общее']);
});

test('отбор по теме и поиску', () => {
    const list = [
        { title: 'Адрес', body: 'Уточните адрес', topics: ['Сбор данных'] },
        { title: 'Отмена', body: 'Запись отменили', topics: ['Запись', 'Общее'] },
    ];
    assert.equal(filterPastes(list).length, 2);
    assert.deepEqual(filterPastes(list, { topic: 'общее' }).map(p => p.title), ['Отмена']);
    assert.deepEqual(filterPastes(list, { q: 'уточните' }).map(p => p.title), ['Адрес']);
    assert.deepEqual(filterPastes(list, { topic: 'Запись', q: 'адрес' }), []);
});

test('пропуск «_» — первый после вставки', () => {
    assert.deepEqual(firstBlank('По адресу _ на Ваш _'), { start: 10, end: 11 });
    assert.deepEqual(firstBlank('По адресу _ на Ваш _', 11), { start: 19, end: 20 });
    assert.equal(firstBlank('Здравствуйте!'), null);
});

test('стартовый набор проходит те же правила, что и свои пасты', () => {
    assert.equal(DEFAULT_PASTES.length, 25);
    for (const p of DEFAULT_PASTES) {
        const { paste, error } = cleanPaste(p);
        assert.equal(error, undefined, p.title);
        assert.deepEqual(paste, p, `паста «${p.title}» меняется при чистке`);
    }
});
