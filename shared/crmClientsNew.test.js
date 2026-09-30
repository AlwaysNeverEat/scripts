// Разбор ответов новой CRM в форму карточки вкладки «Клиент». Строки обзвона —
// в той форме, в какой их отдаёт живой section=dial (снят при переезде
// записей), но с выдуманными людьми, телефонами и номерами.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    newDialQuery, parseDialPage, dialClients, parseNewSale, newCrmRefusal, isoToCrmStamp,
} from './crmClientsNew.js';

// Строка обзвона ровно в живой форме: продажа, а не клиент.
const row = (over) => ({
    id: 3639195, sb: 0, name: 'Продажа №3639195', date: '2026-09-23 11:11:49', total: 12203,
    pay: 'Б/н', pay_full: 'Безналичный расчёт', station: 'Караваевская 15А',
    client: 'Максим', phone: '79110000001', can_call: true, mark: 0,
    seller: 'Петров Пётр Петрович', plate: 'О160НВ178', mileage: 239000, comment: null,
    ...over,
});

test('запрос: обзвон за все даты, телефон одиннадцатью цифрами, госномер кириллицей', () => {
    assert.equal(newDialQuery({ phone: '+7 (911) 000-00-01' }), 'section=dial&page=1&all=1&phone=79110000001');
    assert.equal(newDialQuery({ phone: '89110000001', page: 3 }), 'section=dial&page=3&all=1&phone=79110000001');
    assert.equal(newDialQuery({ plate: 'o160hb178' }),
        `section=dial&page=1&all=1&plate=${encodeURIComponent('О160НВ178')}`);
});

test('страница обзвона: сколько всего и сколько страниц', () => {
    const p = parseDialPage({ section: 'dial', page: 1, per: 50, total: 120, rows: [row()] });
    assert.equal(p.rows.length, 1);
    assert.equal(p.pages, 3);
    assert.equal(parseDialPage({ rows: [] }).pages, 1);
});

test('по телефону: один клиент, все визиты свежими вперёд, карточка без второго запроса', () => {
    const [c, ...rest] = dialClients([
        row({ id: 1, date: '2025-03-01 10:00:00', client: 'Макс', total: 5000, mileage: 200000 }),
        row({ id: 2, date: '2026-09-23 11:11:49', client: 'Максим', total: 12203, comment: 'просил перезвонить' }),
    ]);
    assert.equal(rest.length, 0);
    assert.equal(c.id, '79110000001');
    assert.equal(c.name, 'Максим', 'имя — по последнему визиту');
    assert.equal(c.phone, '79110000001');
    assert.deepEqual(c.plates, ['О160НВ178']);
    assert.equal(c.visits, 2);
    const [last, first] = c.card.sales;
    assert.equal(last.id, '2');
    assert.equal(last.createdAt, '23.09.2026 11:11');
    assert.equal(last.sum, 12203);
    assert.equal(last.seller, 'Петров Пётр Петрович');
    assert.equal(last.station, 'Караваевская 15А');
    assert.equal(last.comment, 'просил перезвонить');
    assert.equal(first.mileage, 200000);
    assert.equal(c.card.bonus, null, 'баллов в обзвоне нет — не ноль, а «неизвестно»');
});

test('по госномеру: разные люди на одной машине — разные клиенты, свежий первым', () => {
    const list = dialClients([
        row({ id: 1, date: '2024-05-01 10:00:00', client: 'Олег', phone: '79110000002' }),
        row({ id: 2, date: '2026-09-01 10:00:00', client: 'Анна', phone: '79110000003' }),
        row({ id: 3, date: '2024-08-01 10:00:00', client: 'Олег', phone: '79110000002' }),
    ]);
    assert.deepEqual(list.map(c => c.name), ['Анна', 'Олег']);
    assert.equal(list[1].visits, 2);
});

test('продажи без телефона собираются по имени, а не к чужому клиенту', () => {
    const list = dialClients([
        row({ id: 1, client: 'Ольга', phone: '' }),
        row({ id: 2, client: 'Ольга', phone: null }),
        row({ id: 3, client: 'Максим', phone: '79110000001' }),
    ]);
    assert.equal(list.length, 2);
    const olga = list.find(c => c.name === 'Ольга');
    assert.equal(olga.visits, 2);
    assert.equal(olga.phone, '');
});

test('пробег «1» — это «не вписали», а не пробег', () => {
    const [c] = dialClients([row({ mileage: 1 }), row({ id: 2, mileage: '98 500' })]);
    const byId = Object.fromEntries(c.card.sales.map(s => [s.id, s.mileage]));
    assert.equal(byId['3639195'], null);
    assert.equal(byId['2'], 98500);
});

test('отказ новой CRM — отдельный код, с её текстом', () => {
    assert.deepEqual(newCrmRefusal({ error: 'daily_limit', message: 'Лимит 50 клиентов в день' }),
        { code: 'crm_daily_limit', message: 'Лимит 50 клиентов в день' });
    assert.equal(newCrmRefusal({ rows: [] }), null);
    assert.equal(newCrmRefusal(null), null);
});

test('время CRM переводится в формат карточки', () => {
    assert.equal(isoToCrmStamp('2026-07-28 19:34:32'), '28.07.2026 19:34');
    assert.equal(isoToCrmStamp('2026-07-28'), '28.07.2026');
    assert.equal(isoToCrmStamp(''), '');
});

test('чек: позиции, оплата, продавец и пробег', () => {
    const s = parseNewSale({
        header: { id: 3606371, name: 'Продажа №3606371', receipt: '0042', paid: 8500, pay: 'МИР', pay_full: 'Безнал расчёт', seller: 'Петров Пётр', station: 'Выборгское шоссе 2', mileage: 98500, vehicle: 'к926аа147' },
        client: { id: 157783, name: 'Марат', phone: '79110000009' },
        items: [
            { name: 'Услуги SPOT замена масла ДВС', price: 1000, count: 1, sum: 1000, disc_pct: 0, disc_sum: 0, total: 1000, time: 30 },
            { name: '3711 Моторное масло Motul 8100 5W-30', price: 1500, count: '4.5', sum: 6750, disc_pct: 10, disc_sum: 675, total: 6075 },
        ],
    }, '3606371');
    assert.equal(s.payment, 'cashless');
    assert.equal(s.paid, 8500);
    assert.equal(s.seller, 'Петров Пётр');
    assert.equal(s.plate, 'К926АА147');
    assert.equal(s.items[1].count, 4.5);
    assert.equal(s.items[1].discount, '10%');
    assert.equal(s.items[0].discount, '', 'без скидки — пусто, а не «0%»');
});

test('чек: «Б/н» из обзвона — картой, наличные узнаются, отложенный — без значка', () => {
    assert.equal(parseNewSale({ header: { pay: 'Б/н', pay_full: 'Безналичный расчёт' } }).payment, 'cashless');
    assert.equal(parseNewSale({ header: { pay: 'Нал', pay_full: 'Наличный расчёт' } }).payment, 'cash');
    assert.equal(parseNewSale({ header: { pay_full: 'Отложенный платёж' } }).payment, null);
});
