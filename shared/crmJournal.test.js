// Разбор журнала записи новой CRM. Фикстура — настоящий ответ
// `section=journal` за один рабочий день (обезличенный: структура, времена,
// цепочки и статусы сохранены, имена с телефонами подменены).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
    parseJournal, parseJournalRecord, recordAuthor, isSelfBooked,
    journalSavePayload, journalDeletePayload,
    parseSaveResult, parseDeleteResult, parseUserPerms,
    journalSlots, durationSlots, DURATIONS, PRIV_RECORDS,
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

test('автор берётся С СЕРВЕРА, а пустой creator означает «записался сам»', () => {
    const j = parseJournal(raw);
    const byStaff = j.records.filter(r => recordAuthor(r));
    const bySelf = j.records.filter(isSelfBooked);

    assert.equal(byStaff.length + bySelf.length, j.records.length, 'третьего не дано');
    assert.ok(byStaff.length > 0, 'операторские записи в выгрузке есть');
    assert.ok(bySelf.length > byStaff.length,
        'клиентских записей за день заметно больше — это норма, а не потеря автора');

    for (const r of byStaff) assert.equal(typeof recordAuthor(r), 'string');
    for (const r of bySelf) assert.equal(recordAuthor(r), null);
});

test('автор не выдумывается из имени, телефона и станции', () => {
    // Запись клиента с сайта: имя есть, телефон есть, станция есть — и автора
    // всё равно нет. Ровно это раньше и приходилось угадывать.
    const r = parseJournalRecord({
        id: '1', address_id: '8', name: 'Андрей', phone_d: '79990001122',
        time: '10:00', record_time: '2026-10-01 10:00:00', creator: '',
    });
    assert.equal(recordAuthor(r), null);
    assert.equal(isSelfBooked(r), true);
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
