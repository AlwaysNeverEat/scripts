// Журнал записи под персональной сессией. Сеть подменяется через `io`, а
// сам транспорт проверен в client.test.js — здесь важно ровно одно: что
// запись уходит под конкретным человеком и возвращается с его авторством.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    mskDate, crmActor, forgetActor, fetchJournal,
    createRecord, createBooking, updateRecord, deleteRecord, deleteBooking,
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

test('createRecord — это ОДИН слот: duration у CRM мы не используем', async () => {
    forgetActor(2);
    const s = stubApi((req) => {
        if (req.query === 'section=userperms') return PERMS;
        return { ok: true, id: 505859, sms: false, message: '', moved: null };
    });
    try {
        const r = await createRecord(2, {
            addressId: 8, date: '2026-10-01', time: '10:30',
            name: 'Андрей', phone: '+7 (911) 791-71-47', carNumber: 'к753ае198',
            comment: 'тест', durationMinutes: 60,   // просили час…
        }, s.io);
        assert.equal(r.ok, true);
        assert.equal(r.id, 505859);
        assert.equal(r.author, 'Иванов Иван Иванович',
            'автор — человек из сессии CRM, а не из наших полей');

        const post = s.calls.find(c => c.body);
        assert.equal(post.body.action, 'journal_save');
        assert.equal(post.body.id, undefined, 'создание идёт без id');
        assert.equal(post.body.duration, '30',
            '…а уходит получас: длинную запись мы собираем сами, см. createBooking');
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

// ── Длинная запись: цепочку собираем САМИ ───────────────────────────────────
// У CRM для этого есть `duration`, и мы им не пользуемся: её сборка цепочки
// ведёт себя непредсказуемо. Длинная запись — это N получасовых записей
// подряд, как в старой админке.

// Стенд: журнал слотов, любой из которых можно объявить занятым.
function stubBooking({ busyAt = null, failDelete = false } = {}) {
    const created = new Map(); // id → time
    const calls = [];
    let nextId = 600000;
    const io = {
        api: async (userId, req) => {
            calls.push({ userId, ...req });
            if (req.query === 'section=userperms') return PERMS;
            const b = req.body;
            if (b.action === 'journal_save') {
                if (busyAt && b.time === busyAt) return { ok: false, message: 'Слот занят' };
                const id = nextId++;
                created.set(id, b.time);
                return { ok: true, id, sms: b.sms === '1', message: '', moved: null };
            }
            if (b.action === 'journal_delete') {
                if (failDelete) return { ok: false, message: 'Не удалось удалить' };
                created.delete(Number(b.id));
                return { ok: true, deleted: 1, group: 1, message: 'Запись удалена' };
            }
            throw new Error('неожиданный запрос');
        },
    };
    return { io, calls, created, saves: () => calls.filter(c => c.body?.action === 'journal_save') };
}

test('90 минут = три слота подряд, и СМС уходит ТОЛЬКО за первый', async () => {
    forgetActor(10);
    const s = stubBooking();
    try {
        const r = await createBooking(10, {
            addressId: 8, date: '2026-10-01', time: '10:30', durationMinutes: 90,
            name: 'Андрей', phone: '79117917147', carNumber: 'К753АЕ198',
            comment: 'двс+акпп', sms: true,
        }, s.io);

        assert.equal(r.ok, true);
        assert.equal(r.slots, 3);
        assert.equal(r.ids.length, 3);
        assert.equal(r.id, r.ids[0], 'голова цепочки — первый слот');
        assert.equal(r.author, 'Иванов Иван Иванович');

        const saves = s.saves();
        assert.deepEqual(saves.map(c => c.body.time), ['10:30', '11:00', '11:30']);
        assert.deepEqual(saves.map(c => c.body.sms), ['1', '0', '0'],
            'продление клиенту не шлют — три сообщения подряд выглядят поломкой');
        assert.deepEqual(saves.map(c => c.body.duration), ['30', '30', '30'],
            'duration у CRM не используем вовсе — всегда один слот');
        assert.deepEqual(saves.map(c => c.body.car_number), ['К753АЕ198', '', '']);
        assert.deepEqual(saves.map(c => c.body.comment), ['двс+акпп', '', '']);
        assert.ok(saves.every(c => c.body.phone === '79117917147'),
            'телефон на всех слотах тот же — по нему цепочка и узнаётся');
    } finally { forgetActor(10); }
});

test('30 минут — это по-прежнему одна запись', async () => {
    forgetActor(11);
    const s = stubBooking();
    try {
        const r = await createBooking(11, {
            addressId: 8, date: '2026-10-01', time: '10:30', durationMinutes: 30, sms: true,
        }, s.io);
        assert.equal(r.slots, 1);
        assert.equal(s.saves().length, 1);
        assert.equal(s.saves()[0].body.sms, '1');
    } finally { forgetActor(11); }
});

test('слот посреди цепочки занят — созданное сносится, полузаписи не остаётся', async () => {
    forgetActor(12);
    const s = stubBooking({ busyAt: '11:30' });
    try {
        const r = await createBooking(12, {
            addressId: 8, date: '2026-10-01', time: '10:30', durationMinutes: 120, sms: true,
        }, s.io);

        assert.equal(r.ok, false);
        assert.match(r.message, /Слот занят/);
        assert.match(r.message, /11:30/, 'видно, на каком получасе споткнулись');
        assert.deepEqual(r.ids, []);
        assert.equal(r.author, null);
        assert.equal(r.rolledBack, 2, 'оба созданных слота убраны');
        assert.deepEqual(r.orphans, []);
        assert.equal(s.created.size, 0, 'на доске не осталось ничего');
    } finally { forgetActor(12); }
});

test('откат тоже не удался — об осиротевших слотах говорим прямо', async () => {
    forgetActor(13);
    const s = stubBooking({ busyAt: '11:00', failDelete: true });
    try {
        const r = await createBooking(13, {
            addressId: 8, date: '2026-10-01', time: '10:30', durationMinutes: 60,
        }, s.io);
        assert.equal(r.ok, false);
        assert.equal(r.rolledBack, 0);
        assert.equal(r.orphans.length, 1,
            'слот, который не удалось снести, не должен потеряться молча');
    } finally { forgetActor(13); }
});

test('цепочка, не влезающая в рабочий день, не создаёт НИ ОДНОГО слота', async () => {
    forgetActor(14);
    const s = stubBooking();
    try {
        // 20:30 — последний слот дня, сеть работает до 21:00.
        await assert.rejects(
            () => createBooking(14, {
                addressId: 8, date: '2026-10-01', time: '20:00', durationMinutes: 90,
            }, s.io),
            /не помещаются в рабочий день/,
        );
        assert.equal(s.saves().length, 0, 'до CRM не дошло ничего');
    } finally { forgetActor(14); }
});

test('без права на запись длинная тоже не начинается', async () => {
    forgetActor(15);
    const s = stubApi(permsHandler(NO_BOOK));
    try {
        await assert.rejects(
            () => createBooking(15, {
                addressId: 8, date: '2026-10-01', time: '10:30', durationMinutes: 90,
            }, s.io),
            (err) => { assert.equal(err.code, 'crm_forbidden'); return true; },
        );
        assert.equal(s.calls.filter(c => c.body).length, 0);
    } finally { forgetActor(15); }
});

// ── Удаление цепочки ────────────────────────────────────────────────────────
// Свою цепочку (собранную по `duration`) CRM сносит одним запросом по голове —
// проверено на живой выгрузке: три слота ушли разом. Но НАШИ слоты создаются
// независимыми записями, и попадут ли они в её группировку, снаружи не видно.
// Поэтому удаление обязано работать в обоих случаях.

function stubDelete({ groupOf = () => 1, missing = [] } = {}) {
    const asked = [];
    const io = {
        api: async (userId, req) => {
            const id = Number(req.body.id);
            asked.push(id);
            if (missing.includes(id)) return { ok: false, message: 'Запись не найдена' };
            return { ok: true, deleted: groupOf(id), group: groupOf(id), message: 'Запись удалена' };
        },
    };
    return { io, asked };
}

test('CRM сгруппировала цепочку сама — добирать нечего, лишних запросов нет', async () => {
    const s = stubDelete({ groupOf: () => 3 });
    const r = await deleteBooking(9, { ids: [1, 2, 3], addressId: 8 }, s.io);
    assert.equal(r.ok, true);
    assert.equal(r.deleted, 3);
    assert.deepEqual(s.asked, [1], 'одного запроса хватило');
});

test('CRM сняла только голову — остальные слоты добираем сами', async () => {
    const s = stubDelete({ groupOf: () => 1 });
    const r = await deleteBooking(9, { ids: [1, 2, 3], addressId: 8 }, s.io);
    assert.equal(r.ok, true);
    assert.equal(r.deleted, 3);
    assert.deepEqual(s.asked, [1, 2, 3], 'каждый слот снесён отдельно');
});

test('слот, который не снялся, назван — молча оставлять его на доске нельзя', async () => {
    const s = stubDelete({ groupOf: () => 1, missing: [3] });
    const r = await deleteBooking(9, { ids: [1, 2, 3], addressId: 8 }, s.io);
    assert.equal(r.ok, false);
    assert.equal(r.deleted, 2);
    assert.deepEqual(r.left, [3]);
    assert.match(r.message, /не удалось снять: 1/);
});

test('голова не снялась — дальше не идём и говорим почему', async () => {
    const s = stubDelete({ missing: [1] });
    const r = await deleteBooking(9, { ids: [1, 2, 3], addressId: 8 }, s.io);
    assert.equal(r.ok, false);
    assert.equal(r.deleted, 0);
    assert.deepEqual(r.left, [1, 2, 3]);
    assert.deepEqual(s.asked, [1], 'после отказа на голове остальные не трогаем');
});

test('одиночная запись удаляется тем же путём', async () => {
    const s = stubDelete();
    const r = await deleteBooking(9, { ids: 505859, addressId: 8 }, s.io);
    assert.equal(r.ok, true);
    assert.equal(r.deleted, 1);
    await assert.rejects(() => deleteBooking(9, { ids: [], addressId: 8 }, s.io), /без id/);
});
