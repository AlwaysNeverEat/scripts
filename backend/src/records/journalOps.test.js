// Операции раздела поверх журнала CRM. Сеть подменяется через `io`, журнал
// дня — через `day`, зачёт — через `credit`: так проверяется сама логика
// (порядок переноса, откат, СМС, очко), а не заглушка транспорта.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyJournalOp, moveOrder, ddmmToIso, isoToDdmm, OpRefused } from './journalOps.js';
import { forgetActor } from '../crm/journal.js';
import { parseJournal } from '../../../shared/crmJournal.js';

const PERMS = { user: 'Иванов Иван Иванович', role_name: 'Call центр', privileges: [7] };

// Живой день из двух станций: на 8-й два поста, на 1-й один.
function dayWith(records = []) {
    return parseJournal({
        ok: true, date: '2026-10-01',
        stations: [
            { id: '8', address: 'СПб, Выборгское шоссе 2', posts_count: '2' },
            { id: '1', address: 'СПб, Фучика 23А', posts_count: '1' },
        ],
        records: records.map(r => ({
            record_time: `2026-10-01 ${r.time}:00`, creator: '', ...r,
        })),
    });
}

// Стенд CRM: копит запросы, раздаёт id, умеет объявлять время занятым.
function stand({ busyAt = [], journal = dayWith() } = {}) {
    const calls = [];
    let nextId = 700000;
    const io = {
        api: async (userId, req) => {
            calls.push({ userId, ...req });
            if (req.query === 'section=userperms') return PERMS;
            const b = req.body || {};
            if (b.action === 'journal_save') {
                if (busyAt.includes(b.time)) return { ok: false, message: 'Слот занят' };
                return { ok: true, id: b.id ? Number(b.id) : nextId++, sms: b.sms === '1', moved: null };
            }
            if (b.action === 'journal_delete') return { ok: true, deleted: 1, group: 1, message: 'Запись удалена' };
            throw new Error('неожиданный запрос ' + JSON.stringify(req));
        },
    };
    const credits = [];
    const deps = {
        io,
        day: async () => journal,
        credit: async (op, result) => { credits.push({ op, result }); return true; },
    };
    const saves = () => calls.filter(c => c.body?.action === 'journal_save').map(c => c.body);
    return { calls, deps, credits, saves };
}

const CREATE = {
    addressId: '8', date: '01.10.2026', time: '10:30', name: 'Андрей',
    phone: '+7 (911) 791-71-47', carNumber: 'к753ае198', comment: 'двс',
    durationMinutes: 60, byMaster: false, sms: true,
};

test('даты раздела переводятся в даты CRM и обратно', () => {
    assert.equal(ddmmToIso('01.10.2026'), '2026-10-01');
    assert.equal(isoToDdmm('2026-10-01'), '01.10.2026');
    assert.equal(ddmmToIso('2026-10-01'), null);
});

// ── create ──────────────────────────────────────────────────────────────────

test('создание: цепочка из двух слотов, СМС только за первый, очко с id записи', async () => {
    forgetActor('u1');
    const s = stand();
    const r = await applyJournalOp('u1', 'create', CREATE, s.deps);

    assert.equal(r.created.length, 2);
    assert.equal(r.author, 'Иванов Иван Иванович');
    assert.deepEqual(s.saves().map(b => [b.time, b.sms, b.date]),
        [['10:30', '1', '2026-10-01'], ['11:00', '0', '2026-10-01']]);

    assert.equal(s.credits.length, 1, 'одна запись — одно очко, как бы длинна она ни была');
    const { op, result } = s.credits[0];
    assert.equal(op.id, -r.created[0], 'op_id отрицательный — со старой очередью не пересечётся');
    assert.equal(op.userId, 'u1');
    assert.equal(op.progress.stationTitle, 'СПб, Выборгское шоссе 2');
    assert.equal(result.recordId, String(r.created[0]), 'номер записи известен сразу');
    assert.equal(result.continuation, false);
});

test('создание без галки СМС — сообщение не уходит вовсе', async () => {
    forgetActor('u1');
    const s = stand();
    await applyJournalOp('u1', 'create', { ...CREATE, sms: undefined }, s.deps);
    assert.ok(s.saves().every(b => b.sms === '0'));
});

test('занятый пост ловится ДО CRM — ни один слот не создан', async () => {
    forgetActor('u1');
    // На одностанционной точке (Фучика 23А, один пост) 11:00 уже занято.
    const journal = dayWith([{ id: '1', address_id: '1', time: '11:00', name: 'Кто-то', phone_d: '79990000000' }]);
    const s = stand({ journal });
    await assert.rejects(
        () => applyJournalOp('u1', 'create', { ...CREATE, addressId: '1' }, s.deps),
        (err) => {
            assert.ok(err instanceof OpRefused);
            assert.match(err.message, /11:00/);
            assert.match(err.message, /нет свободного поста/);
            return true;
        },
    );
    assert.equal(s.saves().length, 0);
});

test('хвост к своей же записи не даёт второго очка', async () => {
    forgetActor('u1');
    // Андрей уже стоит на 10:00, дописываем ему 10:30 — это продление.
    const journal = dayWith([{ id: '5', address_id: '8', time: '10:00', name: 'Андрей', phone_d: '79117917147' }]);
    const s = stand({ journal });
    await applyJournalOp('u1', 'create', { ...CREATE, durationMinutes: 30, sms: false }, s.deps);
    assert.equal(s.credits[0].result.continuation, true);
});

test('сбой зачёта запись не отменяет', async () => {
    forgetActor('u1');
    const s = stand();
    s.deps.credit = async () => { throw new Error('база легла'); };
    const r = await applyJournalOp('u1', 'create', { ...CREATE, durationMinutes: 30 }, s.deps);
    assert.equal(r.created.length, 1, 'запись в CRM есть — топ переживёт');
});

// ── update ──────────────────────────────────────────────────────────────────

const CHAIN = dayWith([
    { id: '11', address_id: '1', time: '10:00', name: 'Андрей', phone_d: '79117917147', car_number: 'К1', comment: 'двс' },
    { id: '12', address_id: '1', time: '10:30', name: 'Андрей', phone_d: '79117917147' },
]);

const moveBy = (deltaSlots) => ({
    boardDate: '01.10.2026',
    records: [
        { id: '11', name: 'Андрей', addressId: '1', date: '01.10.2026',
          time: ['10:00', '10:30', '11:00'][deltaSlots], from: { addressId: '1', date: '01.10.2026', time: '10:00' } },
        { id: '12', name: 'Андрей', addressId: '1', date: '01.10.2026',
          time: ['10:30', '11:00', '11:30'][deltaSlots], from: { addressId: '1', date: '01.10.2026', time: '10:30' } },
    ],
});

test('сдвиг вперёд двигается С ХВОСТА — иначе слот упрётся в свой же', async () => {
    forgetActor('u1');
    const s = stand({ journal: CHAIN });
    await applyJournalOp('u1', 'update', moveBy(1), s.deps);
    assert.deepEqual(s.saves().map(b => [b.id, b.time]), [['12', '11:00'], ['11', '10:30']]);
});

test('перенос СМС не шлёт никогда — даже если время поменялось', async () => {
    forgetActor('u1');
    const s = stand({ journal: CHAIN });
    await applyJournalOp('u1', 'update', moveBy(1), s.deps);
    assert.ok(s.saves().every(b => b.sms === '0'));
});

test('чего окно не прислало — берётся из CRM, а не стирается', async () => {
    forgetActor('u1');
    const s = stand({ journal: CHAIN });
    // Правка только имени: ни переноса, ни госномера с комментарием.
    await applyJournalOp('u1', 'update', {
        boardDate: '01.10.2026', records: [{ id: '11', name: 'Андрей Петров' }],
    }, s.deps);
    const b = s.saves()[0];
    assert.equal(b.name, 'Андрей Петров');
    assert.equal(b.time, '10:00', 'осталась на месте');
    assert.equal(b.car_number, 'К1', 'госномер не стёрся');
    assert.equal(b.comment, 'двс', 'комментарий не стёрся');
    assert.equal(b.phone, '79117917147');
});

test('перенос упёрся на втором слоте — первый возвращается на место', async () => {
    forgetActor('u1');
    // Сдвиг вперёд идёт с хвоста: 12 → 11:00 проходит, 11 → 10:30 отказ.
    const s = stand({ journal: CHAIN, busyAt: ['10:30'] });
    await assert.rejects(
        () => applyJournalOp('u1', 'update', moveBy(1), s.deps),
        (err) => { assert.match(err.message, /Слот занят/); return true; },
    );
    const last = s.saves().at(-1);
    assert.deepEqual([last.id, last.time], ['12', '10:30'], 'слот 12 вернулся туда, откуда уехал');
});

test('записи, которой уже нет, говорит прямо', async () => {
    forgetActor('u1');
    const s = stand({ journal: dayWith() });
    await assert.rejects(
        () => applyJournalOp('u1', 'update', { boardDate: '01.10.2026', records: [{ id: '999', name: 'X' }] }, s.deps),
        /больше нет/,
    );
});

test('порядок переноса: назад и на другой день — с головы', () => {
    const m = (cur, target) => ({ cur, target });
    const back = [m({ addressId: 1, date: 'd', time: '10:30' }, { addressId: 1, date: 'd', time: '10:00' }), {}];
    assert.equal(moveOrder(back)[0], back[0]);
    const other = [m({ addressId: 1, date: 'd', time: '10:00' }, { addressId: 2, date: 'd', time: '11:00' }), {}];
    assert.equal(moveOrder(other)[0], other[0], 'на другой станции своих слотов на пути нет');
});

// ── delete ──────────────────────────────────────────────────────────────────

test('удаление сносит все слоты записи по станциям', async () => {
    const s = stand();
    const r = await applyJournalOp('u1', 'delete', {
        records: [{ id: '11', addressId: '1' }, { id: '12', addressId: '1' }],
    }, s.deps);
    assert.equal(r.deleted, 2);
    const dels = s.calls.filter(c => c.body?.action === 'journal_delete').map(c => c.body.id);
    assert.deepEqual(dels, ['11', '12']);
});

test('удаление без станции не уходит в CRM', async () => {
    const s = stand();
    await assert.rejects(
        () => applyJournalOp('u1', 'delete', { records: [{ id: '11' }] }, s.deps),
        /не указана станция/,
    );
    assert.equal(s.calls.length, 0);
});

test('неизвестная операция — отказ', async () => {
    await assert.rejects(() => applyJournalOp('u1', 'purge', {}, stand().deps), /create \| update \| delete/);
});
