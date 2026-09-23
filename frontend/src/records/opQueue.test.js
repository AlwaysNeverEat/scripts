import { test } from 'node:test';
import assert from 'node:assert/strict';

import { settledSince, noticeOf } from './opNotices.js';

const NOTE = {
    kind: 'create', name: 'Андрей', phone: '+7 (911) 791-71-47',
    station: 'Выборгское шоссе 2', date: '01.10.2026', time: '14:00', duration: '1 ч',
};

test('уведомление приходит, когда операция доработала, — и только тогда', () => {
    const pending = [{ id: 1, type: 'create', status: 'pending', note: NOTE }];
    const done = [{ id: 1, type: 'create', status: 'done', note: NOTE, result: { author: 'Иванов Иван Иванович' } }];
    assert.equal(settledSince(pending, pending).length, 0, 'ещё ждёт');
    assert.equal(settledSince(pending, done).length, 1);
    assert.equal(settledSince(done, done).length, 0, 'второй раз о том же не говорим');
    assert.equal(settledSince([], done).length, 0, 'о старом после перезагрузки молчим');
});

test('правка из трёх шагов — одно уведомление, когда исполнилась вся', () => {
    const g = (status2) => [
        { id: 1, type: 'delete', status: 'done', group: 'x' },
        { id: 2, type: 'update', status: status2, group: 'x', note: { ...NOTE, kind: 'move' } },
    ];
    assert.equal(settledSince(g('pending'), g('pending')).length, 0);
    const units = settledSince(g('pending'), g('done'));
    assert.equal(units.length, 1);
    assert.equal(noticeOf(units[0]).title, 'Перенесено');
});

test('в уведомлении телефон, адрес, время и ответственный — и в удаче, и в отказе', () => {
    const ok = noticeOf([{ id: 1, type: 'create', status: 'done', note: NOTE, author: 'Серёга', result: { author: 'Иванов Иван Иванович' } }]);
    assert.equal(ok.ok, true);
    assert.equal(ok.title, 'Записано');
    assert.deepEqual(ok.lines, [
        'Андрей · +7 (911) 791-71-47',
        'Выборгское шоссе 2',
        '01.10.2026 14:00, 1 ч',
        'ответственный: Иванов Иван Иванович',
    ]);

    const bad = noticeOf([{ id: 1, type: 'create', status: 'failed', note: NOTE, author: 'Серёга', lastError: 'в 14:00 на станции нет свободного поста' }]);
    assert.equal(bad.ok, false);
    assert.equal(bad.title, 'Не записалось');
    assert.ok(bad.lines.includes('Андрей · +7 (911) 791-71-47'), 'перезванивать клиенту — нужен номер');
    assert.ok(bad.lines.includes('ответственный: Серёга'), 'CRM не ответила — ответственный тот, кто нажал');
    assert.equal(bad.reason, 'в 14:00 на станции нет свободного поста');
});

test('шаг правки не прошёл — уведомление об отказе с его причиной', () => {
    const n = noticeOf([
        { id: 1, type: 'delete', status: 'failed', group: 'x', lastError: 'Слот занят' },
        { id: 2, type: 'update', status: 'failed', group: 'x', note: { ...NOTE, kind: 'edit' }, lastError: 'не выполнено: предыдущий шаг этой правки не прошёл' },
    ]);
    assert.equal(n.title, 'Не сохранилось');
    assert.equal(n.reason, 'Слот занят', 'причина — первая, а не «предыдущий шаг не прошёл»');
});
