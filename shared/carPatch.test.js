import test from 'node:test';
import assert from 'node:assert/strict';

import { changedCarFields, normalizeField, sameValue } from './carPatch.js';

// Форма отдаёт полный набор полей — в PATCH должно уйти только изменённое,
// иначе правка заметки перезаписывает объёмы, которые правит коллега.
test('не изменённые поля в патч не попадают', () => {
    const record = {
        brand: 'Kia', model: 'Rio', notes: 'старая заметка',
        tags: ['табуретка'], service_flags: { atNoFull: true },
    };
    const patch = {
        brand: 'Kia', model: 'Rio', notes: 'новая заметка',
        tags: ['табуретка'], service_flags: { atNoFull: true },
    };
    assert.deepEqual(changedCarFields(record, patch), { notes: 'новая заметка' });
});

test('numeric из базы приходит строкой — это не изменение', () => {
    const record = { engine_volume: '1.600', year_from: '2011', kw: null };
    const patch  = { engine_volume: 1.6,     year_from: 2011,   kw: null };
    assert.deepEqual(changedCarFields(record, patch), {});
});

test('изменение числа ловится', () => {
    assert.deepEqual(
        changedCarFields({ engine_volume: '1.600' }, { engine_volume: 1.8 }),
        { engine_volume: 1.8 },
    );
});

test('порядок ключей внутри объекта изменением не считается', () => {
    const record = { fluid_capacities: { engine: { volumeService: 4.2, label: 'ДВС' } } };
    const patch  = { fluid_capacities: { engine: { label: 'ДВС', volumeService: 4.2 } } };
    assert.deepEqual(changedCarFields(record, patch), {});
});

test('снятый флаг и «флага не было» — одно и то же', () => {
    assert.deepEqual(
        changedCarFields({ service_flags: { atNoFull: false } }, { service_flags: {} }),
        {},
    );
    assert.deepEqual(
        changedCarFields({ service_flags: {} }, { service_flags: { atNoFull: true } }),
        { service_flags: { atNoFull: true } },
    );
});

test('пустой список своих агрегатов не считается правкой машины', () => {
    const record = { fluid_capacities: { engine: { volumeService: 4 } } };
    const patch  = { fluid_capacities: { engine: { volumeService: 4 }, custom: [] } };
    assert.deepEqual(changedCarFields(record, patch), {});
});

// Пустой артикул = «не знаем», absent:true = «фильтра у машины нет». Первое не
// должно выглядеть правкой, второе — обязано.
test('фильтры: пустой артикул не правка, «отсутствует» — правка', () => {
    const record = { filter_part_numbers: {} };
    const empty  = { filter_part_numbers: {
        vf: { part: '', absent: false },
        mf: { part: '', absent: false },
        sf: { part: '', absent: false },
    } };
    assert.deepEqual(changedCarFields(record, empty), {});

    const absent = { filter_part_numbers: {
        vf: { part: '', absent: false },
        mf: { part: '', absent: false },
        sf: { part: null, absent: true },
    } };
    assert.deepEqual(Object.keys(changedCarFields(record, absent)), ['filter_part_numbers']);
});

test('фильтры: артикул сравнивается без лишних пробелов', () => {
    const record = { filter_part_numbers: { mf: { part: 'W 811/80', absent: false } } };
    const same   = { filter_part_numbers: { mf: { part: ' W 811/80 ', absent: false } } };
    assert.deepEqual(changedCarFields(record, same), {});
});

test('пустая заметка: null и пустая строка — одно и то же', () => {
    assert.deepEqual(changedCarFields({ notes: null }, { notes: null }), {});
    assert.equal(sameValue('notes', '', null), true);
    assert.equal(sameValue('notes', null, 'текст'), false);
});

test('отсутствующие теги и допуска равны пустому списку', () => {
    assert.deepEqual(changedCarFields({ tags: null, car_approvals: undefined },
                                      { tags: [], car_approvals: [] }), {});
    assert.deepEqual(normalizeField('tags', null), []);
});

test('ссылки сравниваются после чистки: пробелы и чужие ключи не в счёт', () => {
    const record = { source_links: { motul: ' https://motul.example/car ', mystery: 'x' } };
    const patch  = { source_links: { motul: 'https://motul.example/car' } };
    assert.deepEqual(changedCarFields(record, patch), {});
});

// Записи из импорта и из формы описывают одно и то же по-разному: где-то
// `isCvt:false`, где-то поля нет; объём то числом, то строкой.
test('агрегаты: разное описание одного и того же — не правка', () => {
    const record = { fluid_capacities: {
        automatic: { volumeTotal: '6.800', isCvt: false, motulProducts: [] },
        custom: [{ key: 'k1', label: 'Задний мост', group: 'gear', volumeTotal: 1.2 }],
    } };
    const patch = { fluid_capacities: {
        automatic: { volumeTotal: 6.8 },
        custom: [{ key: 'k1', label: ' Задний мост ', group: 'gear', isCvt: false,
                   volumeTotal: 1.2, motulProducts: [] }],
    } };
    assert.deepEqual(changedCarFields(record, patch), {});
});

test('агрегаты: изменённый объём и допуска ловятся', () => {
    const record = { fluid_capacities: { automatic: { volumeTotal: 6.8 } } };
    assert.deepEqual(
        Object.keys(changedCarFields(record, { fluid_capacities: { automatic: { volumeTotal: 7.2 } } })),
        ['fluid_capacities'],
    );
    assert.deepEqual(
        Object.keys(changedCarFields(record, {
            fluid_capacities: { automatic: { volumeTotal: 6.8, motulProducts: ['SP-III'] } },
        })),
        ['fluid_capacities'],
    );
});

test('агрегаты: удаление своего агрегата — правка', () => {
    const record = { fluid_capacities: { custom: [{ key: 'k1', label: 'Мост', group: 'gear' }] } };
    assert.deepEqual(
        Object.keys(changedCarFields(record, { fluid_capacities: {} })),
        ['fluid_capacities'],
    );
});
