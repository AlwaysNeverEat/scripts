// Очередь операций раздела «Записи»: POST ставит и отвечает сразу, исполнение
// идёт фоном строго по порядку одного человека. Операция подменяется через
// `apply`, время — через `now`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createJournalQueue } from './journalQueue.js';
import { OpRefused } from './journalOps.js';
import { cleanNote } from '../routes/journal.js';

// Ручная «CRM»: каждая операция ждёт, пока тест её отпустит.
function manualApply() {
    const calls = [];
    const apply = (userId, type, payload) => new Promise((resolve, reject) => {
        calls.push({ userId, type, payload, resolve, reject });
    });
    return { calls, apply };
}

const tick = () => new Promise(r => setImmediate(r));

test('постановка отвечает сразу — операция ещё не исполнена', () => {
    const q = createJournalQueue({ apply: () => new Promise(() => {}) });
    const op = q.enqueue('u1', { type: 'create', payload: { time: '14:00' }, author: 'Серёга' });
    assert.equal(op.status, 'pending');
    assert.equal(op.author, 'Серёга');
    assert.equal(op.userId, undefined, 'id аккаунта наружу не уезжает');
    assert.equal(q.list('u1')[0].mine, true);
    assert.equal(q.list('u2')[0].mine, false, 'чужую видно (кто кого куда записал), но она не своя');
    assert.equal(q.list('u2')[0].author, 'Серёга');
});

test('операции одного человека идут строго по очереди', async () => {
    const m = manualApply();
    const q = createJournalQueue({ apply: m.apply });
    q.enqueue('u1', { type: 'delete', payload: {} });
    q.enqueue('u1', { type: 'update', payload: {} });
    q.enqueue('u2', { type: 'create', payload: {} });
    await tick();
    assert.deepEqual(m.calls.map(c => `${c.userId}:${c.type}`), ['u1:delete', 'u2:create'],
        'второй шаг первого ждёт, чужой — нет');
    m.calls[0].resolve({});
    await tick();
    assert.deepEqual(m.calls.map(c => c.type), ['delete', 'create', 'update']);
});

test('исход: удача с ответом CRM, отказ с её текстом', async () => {
    let n = 0;
    const q = createJournalQueue({
        apply: async () => {
            if (n++ === 0) return { created: [1], author: 'Иванов Иван Иванович' };
            throw new OpRefused('в 14:00 на станции нет свободного поста');
        },
    });
    q.enqueue('u1', { type: 'create', payload: {} });
    q.enqueue('u1', { type: 'create', payload: {} });
    await q.idle();
    const [second, first] = q.list('u1');
    assert.equal(first.mine, true);
    assert.equal(first.status, 'done');
    assert.equal(first.result.author, 'Иванов Иван Иванович');
    assert.equal(second.status, 'failed');
    assert.equal(second.lastError, 'в 14:00 на станции нет свободного поста');
});

test('наша поломка не утекает на экран сырым текстом', async () => {
    const q = createJournalQueue({
        apply: async () => { throw new TypeError('cannot read properties of undefined'); },
        log: { error() {} },
    });
    q.enqueue('u1', { type: 'create', payload: {} });
    await q.idle();
    assert.match(q.list('u1')[0].lastError, /внутренняя ошибка/);
});

test('не прошёл шаг правки — следующие шаги той же правки не исполняются', async () => {
    const seen = [];
    const q = createJournalQueue({
        apply: async (_u, type) => {
            seen.push(type);
            if (type === 'delete') throw new OpRefused('Слот занят');
            return {};
        },
    });
    q.enqueue('u1', { type: 'delete', payload: {}, group: 'g1' });
    q.enqueue('u1', { type: 'update', payload: {}, group: 'g1' });
    q.enqueue('u1', { type: 'create', payload: {} }); // другая запись — своя судьба
    await q.idle();
    assert.deepEqual(seen, ['delete', 'create']);
    const upd = q.list('u1').find(o => o.type === 'update');
    assert.equal(upd.status, 'failed');
    assert.match(upd.lastError, /предыдущий шаг/);
});

test('отменить можно только не ушедшую в CRM', async () => {
    const m = manualApply();
    const q = createJournalQueue({ apply: m.apply });
    const a = q.enqueue('u1', { type: 'create', payload: {} });
    const b = q.enqueue('u1', { type: 'create', payload: {} });
    await tick();
    assert.equal(q.cancel('u1', a.id), false, 'первая уже в CRM');
    assert.equal(q.cancel('u2', b.id), false, 'чужую — нельзя');
    assert.equal(q.cancel('u1', b.id), true);
    m.calls[0].resolve({});
    await q.idle();
    assert.equal(m.calls.length, 1, 'отменённая в CRM не ушла');
    assert.equal(q.list('u1').find(o => o.id === b.id).lastError, 'отменена вручную');
});

test('id растут и после перезапуска не начинаются с единицы', () => {
    let t = 1_800_000_000_000;
    const q = createJournalQueue({ apply: () => new Promise(() => {}), now: () => t });
    const a = q.enqueue('u1', { type: 'create', payload: {} });
    const b = q.enqueue('u1', { type: 'create', payload: {} });
    assert.ok(a.id >= t, 'раздел помнит «последнюю увиденную» — id не должен откатиться');
    assert.ok(b.id > a.id);
});

test('исполненные забываются через полсуток, невыполненные — никогда', async () => {
    let t = 1_800_000_000_000;
    const q = createJournalQueue({ apply: async () => ({}), now: () => t });
    q.enqueue('u1', { type: 'create', payload: {} });
    await q.idle();
    t += 13 * 3600 * 1000;
    assert.equal(q.list('u1').length, 0);
});

test('подпись операции: только короткие строки из известных полей', () => {
    assert.equal(cleanNote(null), null);
    assert.equal(cleanNote('текст'), null);
    const n = cleanNote({ kind: 'create', name: ' Андрей ', phone: '+7 (911) 791-71-47', station: 'x'.repeat(500), evil: '<b>', time: 14 });
    assert.equal(n.name, 'Андрей');
    assert.equal(n.time, '14');
    assert.equal(n.station.length, 160);
    assert.equal(n.evil, undefined);
});

test('повторить: заново ставятся только не прошедшие шаги, старая строка помечена', async () => {
    let fail = true;
    const seen = [];
    const q = createJournalQueue({
        apply: async (_u, type) => {
            seen.push(type);
            if (type === 'update' && fail) throw new OpRefused('окно занято');
            return {};
        },
    });
    q.enqueue('u1', { type: 'delete', payload: { a: 1 }, group: 'g1', note: { name: 'Олег' } });
    q.enqueue('u1', { type: 'update', payload: { b: 2 }, group: 'g1', note: { name: 'Олег' } });
    q.enqueue('u1', { type: 'create', payload: { c: 3 }, group: 'g1', note: { name: 'Олег' } });
    await q.idle();
    assert.deepEqual(seen, ['delete', 'update']);
    const failedId = q.list('u1').find(o => o.type === 'update').id;

    assert.match(q.retry('u2', failedId).error, /не ваша/, 'чужое не повторить');

    fail = false;
    const out = q.retry('u1', failedId);
    assert.deepEqual(out.ops.map(o => o.type), ['update', 'create'], 'снятый хвост второй раз не снимаем');
    assert.equal(out.ops[0].note.name, 'Олег', 'подпись едет с повтором');
    assert.equal(out.ops[0].status, 'pending');
    await q.idle();
    assert.deepEqual(seen, ['delete', 'update', 'update', 'create']);
    const old = q.list('u1').filter(o => o.group === 'g1');
    assert.ok(old.every(o => o.retriedBy), 'у старой строки отметка «повторили»');
    assert.match(q.retry('u1', failedId).error, /уже повторили/);
});

test('повторить: проверка без CRM отказывает до постановки', async () => {
    const q = createJournalQueue({ apply: async () => { throw new OpRefused('нет поста'); } });
    const op = q.enqueue('u1', { type: 'create', payload: {} });
    await q.idle();
    assert.throws(() => q.retry('u1', op.id, { check: () => { throw new OpRefused('до визита меньше часа'); } }),
        /меньше часа/);
    assert.equal(q.list('u1').length, 1, 'ничего не поставлено');
    assert.equal(q.list('u1')[0].retriedBy, undefined);
});

test('повторить: выполняющееся и прошедшее не повторяются', async () => {
    const m = manualApply();
    const q = createJournalQueue({ apply: m.apply });
    const op = q.enqueue('u1', { type: 'create', payload: {} });
    await tick();
    assert.match(q.retry('u1', op.id).error, /выполняется/);
    m.calls[0].resolve({});
    await q.idle();
    assert.match(q.retry('u1', op.id).error, /прошла/);
});
