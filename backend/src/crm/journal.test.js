// Журнал записи под персональной сессией. Сеть подменяется через `io`, а
// сам транспорт проверен в client.test.js — здесь важно ровно одно: что
// запись уходит под конкретным человеком и возвращается с его авторством.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    mskDate, crmActor, forgetActor, fetchJournal,
    createRecord, updateRecord, deleteRecord,
} from './journal.js';

const PERMS = {
    user: 'Иванов Иван Иванович', is_admin: false, role: 4, role_name: 'Call центр',
    privileges: [7, 10, 18],
};
const NO_BOOK = { ...PERMS, user: 'Сидоров Олег Петрович', privileges: [10, 18] };

// Подменяем ровно ввод-вывод (`io.api`), как это делает opEngine.js. Всё, что
// ниже — куки, очередь, релогин, — проверяется своими тестами в client.test.js,
// и дублировать их тут значит проверять заглушку.
function stubApi(handler) {
    const calls = [];
    const io = {
        api: async (userId, req) => {
            calls.push({ userId, ...req });
            return handler(req, calls.length - 1);
        },
    };
    return { calls, io, restore: () => {} };
}

const permsHandler = (perms = PERMS) => (req) => {
    if (req.query === 'section=userperms') return perms;
    throw new Error('неожиданный запрос: ' + JSON.stringify(req));
};

test('дата журнала считается по Москве, а не по часовому поясу машины', () => {
    // 30 сентября 23:30 UTC — в Москве уже 1 октября. Именно в эти часы
    // записывают на завтра, и ошибка на день тут самая дорогая.
    assert.equal(mskDate(Date.parse('2026-09-30T23:30:00Z')), '2026-10-01');
    assert.equal(mskDate(Date.parse('2026-10-01T00:30:00Z')), '2026-10-01');
    assert.equal(mskDate(Date.parse('2026-09-30T20:00:00Z')), '2026-09-30');
});

test('кто работает — берётся у CRM и кэшируется', async () => {
    forgetActor(1);
    const s = stubApi(permsHandler());
    try {
        const a = await crmActor(1, {}, s.io);
        assert.equal(a.user, 'Иванов Иван Иванович');
        assert.equal(a.canBook, true);
        await crmActor(1, {}, s.io);
        assert.equal(s.calls.length, 1, 'второй раз спрашивать незачем');
        await crmActor(1, { fresh: true }, s.io);
        assert.equal(s.calls.length, 2, '…но по требованию — спрашиваем');
    } finally { s.restore(); forgetActor(1); }
});

test('создание уходит под сессией и возвращает id и АВТОРА', async () => {
    forgetActor(2);
    const s = stubApi((req) => {
        if (req.query === 'section=userperms') return PERMS;
        return { ok: true, id: 505859, sms: false, message: '', moved: null };
    });
    try {
        const r = await createRecord(2, {
            addressId: 8, date: '2026-10-01', time: '10:30',
            name: 'Андрей', phone: '+7 (911) 791-71-47', carNumber: 'к753ае198',
            comment: 'тест', durationMinutes: 60,
        }, s.io);
        assert.equal(r.ok, true);
        assert.equal(r.id, 505859);
        assert.equal(r.author, 'Иванов Иван Иванович',
            'автор — человек из сессии CRM, а не из наших полей');

        const post = s.calls.find(c => c.body);
        assert.equal(post.body.action, 'journal_save');
        assert.equal(post.body.id, undefined, 'создание идёт без id');
        assert.equal(post.body.duration, '60');
        assert.equal(post.body.phone, '79117917147');
        assert.equal(post.body.sms, '0', 'СМС по умолчанию не шлём');
        assert.equal(post.userId, 2, 'запрос ушёл под тем самым работником');
    } finally { s.restore(); forgetActor(2); }
});

test('без права на запись до CRM даже не идём', async () => {
    forgetActor(3);
    const s = stubApi(permsHandler(NO_BOOK));
    try {
        await assert.rejects(
            () => createRecord(3, { addressId: 8, date: '2026-10-01', time: '10:30' }, s.io),
            (err) => {
                assert.equal(err.code, 'crm_forbidden');
                assert.match(err.message, /Сидоров Олег Петрович/);
                assert.match(err.message, /нет права/);
                return true;
            },
        );
        assert.equal(s.calls.filter(c => c.body).length, 0, 'ни одного POST не сделано');
    } finally { s.restore(); forgetActor(3); }
});

test('отказ CRM не выдаёт себя за запись и автора не приписывает', async () => {
    forgetActor(4);
    const s = stubApi((req) => req.query ? PERMS : { ok: false, message: 'Слот занят' });
    try {
        const r = await createRecord(4, { addressId: 8, date: '2026-10-01', time: '10:30' }, s.io);
        assert.equal(r.ok, false);
        assert.equal(r.message, 'Слот занят');
        assert.equal(r.author, null, 'записи нет — и автора у неё нет');
    } finally { s.restore(); forgetActor(4); }
});

test('доска за день разбирается, кривая дата не доезжает до CRM', async () => {
    const s = stubApi(() => ({
        ok: true, date: '2026-10-01',
        stations: [{ id: '8', address: 'СПб, Выборгское шоссе 2', posts_count: '2', metro: 'Озерки' }],
        records: [{
            id: '505859', address_id: '8', time: '10:30', record_time: '2026-10-01 10:30:00',
            name: 'Андрей', phone_d: '79117917147', creator: 'Иванов Иван Иванович',
        }],
    }));
    try {
        const b = await fetchJournal(5, '2026-10-01', s.io);
        assert.equal(b.stations[0].id, 8);
        assert.equal(b.stations[0].posts, 2);
        assert.equal(b.records[0].creator, 'Иванов Иван Иванович');

        await assert.rejects(() => fetchJournal(5, '01.10.2026', s.io), /YYYY-MM-DD/);
        assert.equal(s.calls.length, 1, 'до CRM кривая дата не дошла');
    } finally { s.restore(); }
});

test('перенос идёт с id и БЕЗ длительности', async () => {
    const s = stubApi(() => ({ ok: true, id: 505859, sms: true, moved: { moved: 2 } }));
    try {
        const r = await updateRecord(6, {
            id: 505859, addressId: 8, date: '2026-10-01', time: '11:00',
            durationMinutes: 150, sms: true,
        }, s.io);
        assert.equal(r.ok, true);
        assert.equal(r.movedSlots, 2, 'CRM подвинула связанные слоты сама');
        assert.equal(r.smsSent, true);
        const body = s.calls[0].body;
        assert.equal(body.id, '505859');
        assert.ok(!('duration' in body), 'длительность существующей записи не меняется');

        await assert.rejects(() => updateRecord(6, { addressId: 8, date: '2026-10-01' }, s.io), /без id/);
    } finally { s.restore(); }
});

test('удаление сообщает, сколько слотов цепочки снесено', async () => {
    const s = stubApi(() => ({ ok: true, deleted: 3, group: 3, message: 'Запись удалена' }));
    try {
        const r = await deleteRecord(7, { id: 505859, addressId: 8 }, s.io);
        assert.equal(r.deleted, 3);
        assert.equal(r.group, 3, 'полтора часа — это три слота, и знать об этом надо');
        assert.deepEqual(s.calls[0].body,
            { action: 'journal_delete', id: '505859', address_id: '8' });
    } finally { s.restore(); }
});
