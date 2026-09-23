// Разбор журнала записи новой CRM. Фикстура — настоящий ответ
// `section=journal` за один рабочий день (обезличенный: структура, времена,
// цепочки и статусы сохранены, имена с телефонами подменены).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
    parseJournal, parseJournalRecord, recordAuthor, crmAuthorUnknown, boardAuthor,
    journalSavePayload, journalDeletePayload,
    parseSaveResult, parseDeleteResult, parseUserPerms,
    journalSlots, durationSlots, DURATIONS, PRIV_RECORDS, journalToBoard,
    bookingOpen, BOOKING_LEAD_MIN,
} from './crmJournal.js';
import { isJunkPhone, timeToMin, SLOT_MINUTES } from './crmRecords.js';

const raw = JSON.parse(fs.readFileSync(
    new URL('./__fixtures__/crm-journal-day.json', import.meta.url), 'utf8'));

// ── Доска ────────────────────────────────────────────────────────────────────

test('журнал разбирается целиком: станции и записи за день', () => {
    const j = parseJournal(raw);
    assert.equal(j.ok, true);
    assert.equal(j.date, '2026-09-23');
    assert.equal(j.stations.length, 24);
    assert.equal(j.records.length, 144);
});

test('идентификаторы становятся ЧИСЛАМИ — CRM отдаёт их строками', () => {
    const j = parseJournal(raw);
    for (const s of j.stations) {
        assert.equal(typeof s.id, 'number', 'станция');
        assert.equal(typeof s.posts, 'number', 'постов');
        assert.ok(s.posts >= 1);
    }
    for (const r of j.records) {
        assert.equal(typeof r.id, 'number');
        assert.equal(typeof r.addressId, 'number');
    }
    // Ровно та ловушка, ради которой всё это: «8» !== 8.
    assert.ok(j.stations.some(s => s.id === 8), 'станция 8 найдена числом');
});

test('постов у станции 1 или 2 — это наши боксы', () => {
    const j = parseJournal(raw);
    const posts = new Set(j.stations.map(s => s.posts));
    assert.deepEqual([...posts].sort(), [1, 2]);
});

test('телефон берётся из phone_d и нормализуется, как ни написан исходный', () => {
    const j = parseJournal(raw);
    for (const r of j.records) {
        if (!r.phone) continue;
        assert.match(String(r.phone), /^\d{10,11}$/, `телефон записи ${r.id}: ${r.phone}`);
    }
    // В сыром ответе за один день три разных написания одного и того же.
    const writings = new Set(raw.records.map(r => String(r.phone).replace(/\d/g, '#')));
    assert.ok(writings.size > 1, 'в CRM телефон пишут по-разному — потому и нормализуем');
});

test('время и дата записи берутся из record_time, а не из даты запроса', () => {
    const j = parseJournal(raw);
    for (const r of j.records) {
        assert.equal(r.date, '2026-09-23');
        assert.match(r.time, /^\d{2}:\d{2}$/);
    }
});

test('записи отсортированы по станции и времени', () => {
    const j = parseJournal(raw);
    for (let i = 1; i < j.records.length; i++) {
        const a = j.records[i - 1], b = j.records[i];
        const ok = a.addressId < b.addressId
            || (a.addressId === b.addressId && timeToMin(a.time) <= timeToMin(b.time));
        assert.ok(ok, `порядок нарушен у ${a.id} → ${b.id}`);
    }
});

test('не-ok ответ не притворяется пустым днём', () => {
    const bad = parseJournal({ ok: false, message: 'Нет доступа' });
    assert.equal(bad.ok, false);
    assert.equal(bad.message, 'Нет доступа');
    assert.deepEqual(bad.records, []);
    // И мусор на входе тоже не должен читаться как «записей нет».
    assert.equal(parseJournal(null).ok, false);
    assert.equal(parseJournal({ ok: true, records: 'нет' }).records.length, 0);
});

// ── Авторство: ради него всё и затевалось ────────────────────────────────────

test('автор берётся С СЕРВЕРА, а пустой creator означает «CRM не знает»', () => {
    const j = parseJournal(raw);
    const known = j.records.filter(r => recordAuthor(r));
    const unknown = j.records.filter(crmAuthorUnknown);

    assert.equal(known.length + unknown.length, j.records.length, 'третьего не дано');
    assert.ok(known.length > 0, 'записи с автором в выгрузке есть');
    assert.ok(unknown.length > known.length, 'без автора их пока заметно больше');

    for (const r of known) assert.equal(typeof recordAuthor(r), 'string');
    for (const r of unknown) assert.equal(recordAuthor(r), null);
});

test('пустой creator — это НЕ «записался сам»: так же выглядит запись с нашего сайта', () => {
    // Проверено на живой базе: запись, сделанная через наш калькулятор (старая
    // админка, общая учётка), приходит в CRM с пустым creator — неотличимо от
    // самозаписи клиента. Автора такой записи знает только наш record_credits.
    const r = parseJournalRecord({
        id: '505881', address_id: '8', time: '10:30',
        record_time: '2026-10-10 10:30:00', name: 'тест', phone_d: '71111111111',
        creator: '',
    });
    assert.equal(recordAuthor(r), null, 'CRM автора не знает');

    // Наш зачёт знает — и он закрывает всё, что записано до переезда.
    const mine = boardAuthor(r, { 505881: 'Ищенко Сергей Александрович' });
    assert.equal(mine.name, 'Ищенко Сергей Александрович');
    assert.equal(mine.source, 'credits');

    // А вот когда не знает никто — тогда и правда никто.
    assert.equal(boardAuthor(r, {}), null);
    assert.equal(boardAuthor(r), null);
});

test('CRM важнее нашего зачёта: она знает автора точно, мы — по совпадению', () => {
    const r = parseJournalRecord({
        id: '1', address_id: '8', time: '10:00', record_time: '2026-10-01 10:00:00',
        creator: 'Иванов Иван Иванович',
    });
    const a = boardAuthor(r, { 1: 'Кто-то Другой' });
    assert.equal(a.name, 'Иванов Иван Иванович');
    assert.equal(a.source, 'crm');
});

test('автор не выдумывается из имени, телефона и станции', () => {
    // Запись клиента с сайта: имя есть, телефон есть, станция есть — и автора
    // всё равно нет. Ровно это раньше и приходилось угадывать.
    const r = parseJournalRecord({
        id: '1', address_id: '8', name: 'Андрей', phone_d: '79990001122',
        time: '10:00', record_time: '2026-10-01 10:00:00', creator: '',
    });
    assert.equal(recordAuthor(r), null);
    assert.equal(crmAuthorUnknown(r), true);
});

test('пробелы вокруг ФИО не превращаются в автора', () => {
    const r = parseJournalRecord({ id: '1', address_id: '8', creator: '   ' });
    assert.equal(recordAuthor(r), null);
});

// ── Цепочки: длинная запись — это N получасовых слотов подряд ────────────────

test('длинная запись лежит в журнале цепочкой подряд идущих слотов', () => {
    const j = parseJournal(raw);
    const byClient = new Map();
    for (const r of j.records) {
        const key = r.addressId + '|' + (r.phone || r.name);
        if (!byClient.has(key)) byClient.set(key, []);
        byClient.get(key).push(r);
    }
    let chains = 0;
    for (const list of byClient.values()) {
        list.sort((a, b) => timeToMin(a.time) - timeToMin(b.time));
        for (let i = 1; i < list.length; i++) {
            if (timeToMin(list[i].time) - timeToMin(list[i - 1].time) === SLOT_MINUTES) chains++;
        }
    }
    assert.ok(chains > 20, `стыков в цепочках должно быть много, найдено ${chains}`);
});

test('«бронь» приходит с телефоном-заглушкой — её ловит общий isJunkPhone', () => {
    const j = parseJournal(raw);
    const holds = j.records.filter(r => /бронь/i.test(r.name));
    assert.ok(holds.length > 0, 'брони в выгрузке есть');
    for (const h of holds) assert.ok(isJunkPhone(h.phone), `бронь ${h.id} должна быть мусорным номером`);
});

// ── Сетка слотов ─────────────────────────────────────────────────────────────

test('слоты — с 09:00 до 20:30 через полчаса', () => {
    const s = journalSlots();
    assert.equal(s[0], '09:00');
    assert.equal(s[s.length - 1], '20:30');
    assert.equal(s.length, 24);
});

test('все времена записей попадают в сетку слотов', () => {
    const grid = new Set(journalSlots());
    for (const r of parseJournal(raw).records) {
        assert.ok(grid.has(r.time), `время ${r.time} вне сетки`);
    }
});

test('длительность считается слотами, а не минутами', () => {
    assert.deepEqual(DURATIONS.map(durationSlots), [1, 2, 3, 4, 5]);
    assert.equal(durationSlots(0), 1, 'меньше одного слота не бывает');
    assert.equal(durationSlots('не число'), 1);
});

// ── Запросы ──────────────────────────────────────────────────────────────────

test('создание несёт duration, правка — НЕ несёт', () => {
    const create = journalSavePayload({
        addressId: 8, date: '2026-10-01', time: '10:30',
        name: 'Андрей', phone: '+7 (911) 791-71-47', carNumber: 'к753ае198',
        comment: 'тест', durationMinutes: 60,
    });
    assert.equal(create.action, 'journal_save');
    assert.equal(create.id, undefined, 'у создания id нет');
    assert.equal(create.duration, '60');
    assert.equal(create.phone, '79117917147', 'телефон уезжает цифрами');
    assert.equal(create.car_number, 'К753АЕ198', 'госномер — в верхнем регистре');

    const edit = journalSavePayload({ id: 505859, addressId: 8, date: '2026-10-01', time: '11:00' });
    assert.equal(edit.id, '505859');
    assert.ok(!('duration' in edit),
        'у существующей записи длительность менять нечем — лишнее поле врёт, что перенос её учёл');
});

test('СМС по умолчанию НЕ отправляется', () => {
    const p = journalSavePayload({ addressId: 8, date: '2026-10-01', time: '10:30' });
    assert.equal(p.sms, '0');
    assert.equal(journalSavePayload({ addressId: 8, sms: true }).sms, '1');
    // Значение всегда явное: в самой CRM галка включается сама при смене
    // времени, и сообщение уезжает «потому что забыл снять».
    assert.equal(journalSavePayload({ addressId: 8, sms: undefined }).sms, '0');
});

test('удаление просит и запись, и станцию', () => {
    assert.deepEqual(journalDeletePayload({ id: 505859, addressId: 8 }),
        { action: 'journal_delete', id: '505859', address_id: '8' });
});

// ── Ответы ───────────────────────────────────────────────────────────────────

test('ответ на создание отдаёт id — искать запись синком больше не надо', () => {
    const r = parseSaveResult({ ok: true, id: 505859, sms: false, message: '', moved: null });
    assert.equal(r.ok, true);
    assert.equal(r.id, 505859);
    assert.equal(r.smsSent, false);
    assert.equal(r.movedSlots, 0);
});

test('smsSent — ответ CRM, а не эхо нашей галки', () => {
    assert.equal(parseSaveResult({ ok: true, id: 1, sms: true }).smsSent, true);
    assert.equal(parseSaveResult({ ok: true, id: 1, sms: false }).smsSent, false);
});

test('перенос длинной записи сообщает, сколько слотов подвинулось', () => {
    const r = parseSaveResult({ ok: true, id: 1, moved: { moved: 2 } });
    assert.equal(r.movedSlots, 2);
});

test('отказ CRM не притворяется успехом', () => {
    const r = parseSaveResult({ ok: false, message: 'Слот занят' });
    assert.equal(r.ok, false);
    assert.equal(r.message, 'Слот занят');
    assert.equal(parseSaveResult(null).ok, false);
    assert.equal(parseSaveResult({}).ok, false, 'ответ без ok — не успех');
});

test('удаление сообщает, сколько слотов снесено из цепочки', () => {
    const r = parseDeleteResult({ ok: true, deleted: 1, group: 1, message: 'Запись удалена' });
    assert.equal(r.ok, true);
    assert.equal(r.deleted, 1);
    assert.equal(r.group, 1);
    assert.equal(parseDeleteResult({ ok: false }).ok, false);
});

// ── Кто я в CRM ──────────────────────────────────────────────────────────────

test('userperms: имя и право на запись', () => {
    const p = parseUserPerms({
        user: 'Иванов Иван Иванович', is_admin: false, role: 4, role_name: 'Call центр',
        privileges: [7, 10, 15, 18, 24, 43, 44],
    });
    assert.equal(p.ok, true);
    assert.equal(p.user, 'Иванов Иван Иванович');
    assert.equal(p.roleName, 'Call центр');
    assert.equal(p.canBook, true);
    assert.ok(p.privileges.includes(PRIV_RECORDS));
});

test('без привилегии 7 записывать нельзя, админу — можно всегда', () => {
    assert.equal(parseUserPerms({ user: 'Кто-то', privileges: [10, 18] }).canBook, false);
    assert.equal(parseUserPerms({ user: 'Босс', is_admin: true, privileges: [] }).canBook, true);
});

test('auth_required разбирается как отсутствие сессии, а не как пустые права', () => {
    const p = parseUserPerms({ error: 'auth_required' });
    assert.equal(p.ok, false);
    assert.equal(p.error, 'auth_required');
});

// ── Журнал → доска раздела ──────────────────────────────────────────────────
// Раздел рисует доску формой, которую отдавал разбор HTML старой админки.
// Форма рабочая, менять её ради переезда незачем — журнал кладётся в неё же.

test('доска собирается из журнала: адреса, сетка, ячейки', () => {
    const b = journalToBoard(parseJournal(raw));
    assert.equal(b.date, '2026-09-23');
    assert.equal(b.addresses.length, 24);
    assert.equal(b.timeSlots.length, 24);
    assert.equal(b.timeSlots[0], '09:00');
    assert.equal(b.timeSlots.at(-1), '20:30');

    const total = Object.values(b.cells)
        .flatMap(byTime => Object.values(byTime))
        .reduce((n, c) => n + c.records.length, 0);
    assert.equal(total, 144, 'ни одна запись не потерялась по дороге');
});

test('идентификаторы в доске — СТРОКИ: ими индексируются ячейки', () => {
    const b = journalToBoard(parseJournal(raw));
    for (const a of b.addresses) assert.equal(typeof a.id, 'string');
    assert.ok(b.cells[b.addresses[0].id], 'ячейки находятся по id адреса');
    const rec = Object.values(b.cells)
        .flatMap(byTime => Object.values(byTime))
        .flatMap(c => c.records)[0];
    assert.equal(typeof rec.id, 'string');
    assert.equal(typeof rec.addressId, 'string');
});

test('свободные места считаются от ЧИСЛА ПОСТОВ станции', () => {
    const j = parseJournal(raw);
    const b = journalToBoard(j);
    for (const a of b.addresses) {
        for (const t of b.timeSlots) {
            const c = b.cells[a.id][t];
            assert.equal(c.free, Math.max(a.posts - c.records.length, 0),
                `${a.title} ${t}`);
            assert.ok(c.free >= 0, 'отрицательных свободных мест не бывает');
        }
    }
    // На двухпостовой станции в пустом слоте должно быть именно два места.
    const two = b.addresses.find(a => a.posts === 2);
    const empty = b.timeSlots.find(t => b.cells[two.id][t].records.length === 0);
    assert.equal(b.cells[two.id][empty].free, 2);
});

test('автор доезжает до доски — раньше его на ней не было вовсе', () => {
    const b = journalToBoard(parseJournal(raw));
    const all = Object.values(b.cells)
        .flatMap(byTime => Object.values(byTime)).flatMap(c => c.records);
    const withAuthor = all.filter(r => r.creator);
    assert.ok(withAuthor.length > 0);
    assert.ok(all.every(r => typeof r.creator === 'string'),
        'у записи без автора поле пустое, а не отсутствует');
});

test('госномер и комментарий приезжают СРАЗУ, без похода за формой правки', () => {
    const b = journalToBoard(parseJournal({
        ok: true, date: '2026-10-01',
        stations: [{ id: '8', address: 'СПб, Выборгское шоссе 2', posts_count: '2' }],
        records: [{
            id: '505859', address_id: '8', time: '10:30', record_time: '2026-10-01 10:30:00',
            name: 'Андрей', phone_d: '79117917147', phone: '+7 (911) 791-71-47',
            car_number: 'к753ае198', comment: 'двс+акпп', services: '21,5',
            creator: 'Иванов Иван Иванович',
        }],
    }));
    const r = b.cells['8']['10:30'].records[0];
    assert.equal(r.carNumber, 'К753АЕ198');
    assert.equal(r.comment, 'двс+акпп');
    assert.deepEqual(r.serviceIds, ['21', '5']);
    assert.equal(r.creator, 'Иванов Иван Иванович');
    assert.equal(r.timeStart, '10:30');
    assert.equal(r.timeEnd, '11:00', 'слот всегда получас');
    assert.equal(r.phone, '+7 (911) 791-71-47', 'показываем как набрали');
    assert.equal(r.phoneDigits, '79117917147', 'сравниваем по цифрам');
});

test('статус визита переводится в метку, которую доска уже умеет рисовать', () => {
    const mk = (st, isNew = 0) => journalToBoard(parseJournal({
        ok: true, date: '2026-10-01',
        stations: [{ id: '8', address: 'X', posts_count: '1' }],
        records: [{ id: '1', address_id: '8', time: '09:00',
            record_time: '2026-10-01 09:00:00', st, is_new: isNew }],
    })).cells['8']['09:00'].records[0].status;

    assert.equal(mk('checked'), 'checked');
    assert.equal(mk('late'), 'too-late');
    assert.equal(mk(''), '', 'ожидается — это нормальное состояние, а не метка');
    assert.equal(mk('', 1), 'is-new');
});

test('телефон-заглушка помечается — на нём держатся продления и брони', () => {
    const b = journalToBoard(parseJournal(raw));
    const stubs = Object.values(b.cells)
        .flatMap(byTime => Object.values(byTime))
        .flatMap(c => c.records).filter(r => r.isStub);
    assert.ok(stubs.length > 0);
    assert.ok(stubs.every(r => isJunkPhone(r.phoneDigits)));
});

test('пустой журнал даёт пустую доску, а не падает', () => {
    const b = journalToBoard(parseJournal({ ok: false, message: 'нет доступа' }));
    assert.deepEqual(b.addresses, []);
    assert.equal(b.timeSlots.length, 24, 'сетка времён есть всегда — по ней рисуют пустой день');
});

// ── Не позднее чем за час ───────────────────────────────────────────────────

test('запас до визита — час, по московскому времени', () => {
    assert.equal(BOOKING_LEAD_MIN, 60);
    const now = Date.parse('2026-09-23T12:00:00+03:00');
    assert.equal(bookingOpen('2026-09-23', '12:30', now), false, 'через полчаса — нельзя');
    assert.equal(bookingOpen('2026-09-23', '13:00', now), true, 'ровно через час — можно');
    assert.equal(bookingOpen('2026-09-23', '11:00', now), false, 'в прошлое — нельзя');
    assert.equal(bookingOpen('2026-09-24', '09:00', now), true, 'завтра — можно');
    // Машина в UTC, а в Москве уже полночь: 23:30 UTC 23-го = 02:30 МСК 24-го.
    const lateUtc = Date.parse('2026-09-23T23:30:00Z');
    assert.equal(bookingOpen('2026-09-24', '03:00', lateUtc), false, 'считается по Москве');
});

test('доска с `now` закрывает слоты ближе часа так же, как старая админка', () => {
    const j = parseJournal({
        ok: true, date: '2026-09-23',
        stations: [{ id: '8', address: 'X', posts_count: '2' }],
        records: [{ id: '1', address_id: '8', time: '12:30', record_time: '2026-09-23 12:30:00', name: 'Ольга' }],
    });
    const b = journalToBoard(j, { now: Date.parse('2026-09-23T12:00:00+03:00') });
    const c = b.cells['8'];

    // Пустой слот ближе часа — без ячейки: раздел рисует его «уже не записать».
    assert.equal(c['12:00'], undefined);
    // Занятый слот ближе часа — остаётся с записью, но без свободных мест.
    assert.equal(c['12:30'].records.length, 1);
    assert.equal(c['12:30'].free, 0, 'второй пост тоже уже не предлагаем');
    // Через час и дальше — как обычно.
    assert.equal(c['13:00'].free, 2);
    // Прошлое утро — тоже без ячеек.
    assert.equal(c['09:00'], undefined);
});

test('доска без `now` отдаёт день как есть — для разбора и тестов', () => {
    const j = parseJournal({ ok: true, date: '2020-01-01', stations: [{ id: '8', address: 'X', posts_count: '1' }], records: [] });
    assert.equal(journalToBoard(j).cells['8']['09:00'].free, 1);
});
