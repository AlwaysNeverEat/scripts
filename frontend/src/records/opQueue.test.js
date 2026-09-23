import { test } from 'node:test';
import assert from 'node:assert/strict';

import { settledSince, describeUnit, unitsOf, unseenFailures } from './opQueue.js';

const NOTE = {
    kind: 'create', name: 'Марина двс', phone: '+7 (921) 642-02-82',
    station: 'СПб, Выборгское шоссе 2', date: '23.09.2026', time: '15:00', duration: '1 ч',
};

test('доработавшее действие ловится один раз, и только когда доработало', () => {
    const pending = [{ id: 1, type: 'create', status: 'pending', note: NOTE }];
    const done = [{ id: 1, type: 'create', status: 'done', note: NOTE }];
    assert.equal(settledSince(pending, pending).length, 0, 'ещё ждёт');
    assert.equal(settledSince(pending, done).length, 1);
    assert.equal(settledSince(done, done).length, 0, 'второй раз о том же не говорим');
    assert.equal(settledSince([], done).length, 0, 'о старом после перезагрузки молчим');
});

test('правка из нескольких шагов — одна строка очереди', () => {
    const ops = [
        { id: 3, type: 'create', status: 'done', group: 'x' },
        { id: 2, type: 'update', status: 'done', group: 'x', note: { ...NOTE, kind: 'move' } },
        { id: 1, type: 'create', status: 'done', note: NOTE },
    ];
    const units = unitsOf(ops);
    assert.equal(units.length, 2);
    assert.equal(describeUnit(units[0]).title, 'Перенос: Марина двс · +7 (921) 642-02-82');
    assert.equal(describeUnit(units[0]).outcome, 'перенесено');
});

test('в строке очереди телефон, адрес, время и ответственный — и в удаче, и в отказе', () => {
    const ok = describeUnit([{ id: 1, type: 'create', status: 'done', note: NOTE, author: 'Серёга',
        result: { author: 'Ищенко Сергей Александрович' }, createdAt: '2026-09-23T10:44:00Z' }]);
    assert.equal(ok.status, 'done');
    assert.equal(ok.title, 'Запись: Марина двс · +7 (921) 642-02-82');
    assert.equal(ok.station, 'СПб, Выборгское шоссе 2');
    assert.equal(ok.when, '23.09.2026 15:00, 1 ч');
    assert.equal(ok.author, 'Ищенко Сергей Александрович');
    assert.equal(ok.outcome, 'записано');

    const bad = describeUnit([{ id: 1, type: 'create', status: 'failed', note: NOTE, author: 'Серёга',
        lastError: 'в 15:00 на станции нет свободного поста' }]);
    assert.equal(bad.outcome, 'не записалось');
    assert.equal(bad.author, 'Серёга', 'CRM не ответила — ответственный тот, кто нажал');
    assert.equal(bad.reason, 'в 15:00 на станции нет свободного поста');
});

test('не прошёл шаг правки — причина первая, а не «предыдущий шаг не прошёл»', () => {
    const d = describeUnit([
        { id: 2, type: 'update', status: 'failed', group: 'x', note: { ...NOTE, kind: 'edit' }, lastError: 'не выполнено: предыдущий шаг этой правки не прошёл' },
        { id: 1, type: 'delete', status: 'failed', group: 'x', lastError: 'Слот занят' },
    ].reverse());
    assert.equal(d.outcome, 'не сохранилось');
    assert.equal(d.reason, 'Слот занят');
});

test('операция без подписи описывается по самой операции', () => {
    const d = describeUnit([{ id: 1, type: 'create', status: 'pending',
        payload: { name: 'Олег', phone: '+7 (900) 000-00-01', addressId: '8', date: '23.09.2026', time: '16:00' } }],
    { stationTitle: (id) => (id === '8' ? 'СПб, Выборгское шоссе 2' : '') });
    assert.equal(d.station, 'СПб, Выборгское шоссе 2');
    assert.equal(d.when, '23.09.2026 16:00');
    assert.equal(d.outcome, 'выполняется…');
});

test('плашка в шапке — только свои невиданные отказы, не отменённые руками', () => {
    const ops = [
        { id: 5, type: 'create', status: 'failed', mine: true, lastError: 'нет поста' },
        { id: 4, type: 'create', status: 'failed', mine: false, lastError: 'нет поста' },
        { id: 3, type: 'create', status: 'failed', mine: true, lastError: 'отменена вручную' },
        { id: 2, type: 'create', status: 'done', mine: true },
        { id: 1, type: 'create', status: 'failed', mine: true, lastError: 'нет поста' },
    ];
    assert.deepEqual(unseenFailures(ops, 0).map(u => u[0].id), [5, 1]);
    assert.deepEqual(unseenFailures(ops, 1).map(u => u[0].id), [5], 'увиденное не висит');
});
