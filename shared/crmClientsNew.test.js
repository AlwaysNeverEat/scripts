// Разбор ответов новой CRM в форму карточки вкладки «Клиент». Ответы собраны
// по тому, как их рисует сама новая CRM (её клиентский код), с выдуманными
// людьми и номерами.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    newClientSearchQuery, parseNewClientSearch, parseNewClientCard, parseNewSale,
    newCrmRefusal, isoToCrmStamp,
} from './crmClientsNew.js';

test('запрос: телефон одиннадцатью цифрами, госномер кириллицей', () => {
    assert.equal(newClientSearchQuery({ phone: '+7 (921) 950-38-08' }), 'section=clients&page=1&q=79219503808');
    assert.equal(newClientSearchQuery({ phone: '89219503808' }), 'section=clients&page=1&q=79219503808');
    assert.equal(newClientSearchQuery({ plate: 'k926aa147' }),
        `section=clients&page=1&q=${encodeURIComponent('К926АА147')}`);
});

test('поиск: строки раздела «Клиенты» → список карточки', () => {
    const r = parseNewClientSearch({
        section: 'clients', page: 1, per: 50, totals: { count: 1 },
        rows: [{ id: 157783, fio: 'Марат', phone: '79219503808', car: '—', changes: 9, bonus: 301.68, created: '2024-05-08 08:59:23' }],
    });
    assert.deepEqual(r.clients, [{ id: '157783', name: 'Марат', phone: '79219503808', plates: [], visits: 9 }]);
    assert.equal(r.needExact, false);
});

test('поиск: CRM просит полный номер — это не «не найдено»', () => {
    const r = parseNewClientSearch({ rows: [], need_exact: true, message: 'Введите полный номер телефона или госномер' });
    assert.equal(r.needExact, true);
    assert.equal(r.message, 'Введите полный номер телефона или госномер');
});

test('отказ по дневному лимиту — отдельный код, с текстом CRM', () => {
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

const CARD = {
    client: { id: 157783, fio: 'Марат', phone: '79219503808', car: 'К926АА147', bonus: '301.68', oil_changes: 9, created: '2024-05-08 08:59:23', comment: 'звонить после 18' },
    stats: { visits: 3, ltv: 21000, avg: 7000, last: '2026-07-28 19:34:32' },
    history: [
        { id: 3000001, name: 'Продажа №3000001', date: '2025-02-10 10:00:00', station: 'Руставели 69', items: 4, mileage: 90000, sum: 6000, comment: '' },
        { id: 3606371, name: 'Продажа №3606371', date: '2026-07-28 19:34:32', station: 'Выборгское шоссе 2', items: 6, mileage: '98 500', sum: 8500, comment: 'просил без промывки' },
    ],
    bonuses: [
        { set_id: 3606371, type: 'add', amount: 120, balance: 301.68 },
        { set_id: 3606371, type: 'spend', amount: 50, balance: 181.68 },
        { set_id: 3000001, type: 'add', amount: 30, correction: true },
        { set_id: null, type: 'add', amount: 500 },
    ],
};

test('карточка: клиент, номер машины и визиты свежими вперёд', () => {
    const c = parseNewClientCard(CARD, '157783');
    assert.equal(c.id, '157783');
    assert.equal(c.name, 'Марат');
    assert.equal(c.bonus, 301.68, 'баллы бывают строкой');
    assert.deepEqual(c.plates, ['К926АА147']);
    assert.equal(c.comment, 'звонить после 18');
    assert.deepEqual(c.sales.map(s => s.id), ['3606371', '3000001']);
    const last = c.sales[0];
    assert.equal(last.createdAt, '28.07.2026 19:34');
    assert.equal(last.station, 'Выборгское шоссе 2');
    assert.equal(last.mileage, 98500, 'пробег бывает строкой с пробелом');
    assert.equal(last.comment, 'просил без промывки');
});

test('карточка: бонусы раскладываются по визитам, корректировки и ручные правки — нет', () => {
    const [last, first] = parseNewClientCard(CARD, '157783').sales;
    assert.equal(last.receivedBonus, 120);
    assert.equal(last.paidBonus, 50);
    assert.equal(first.receivedBonus, null, 'корректировка к визиту не относится');
});

test('карточка без полей не падает и не выдумывает нули', () => {
    const c = parseNewClientCard({ client: { id: 1 } }, '1');
    assert.equal(c.name, 'Без имени');
    assert.equal(c.bonus, null);
    assert.deepEqual(c.sales, []);
    assert.deepEqual(c.plates, []);
});

test('чек: позиции, оплата, продавец и пробег', () => {
    const s = parseNewSale({
        header: { id: 3606371, name: 'Продажа №3606371', receipt: '0042', paid: 8500, pay: 'МИР', pay_full: 'Безнал расчёт', seller: 'Петров Пётр', station: 'Выборгское шоссе 2', mileage: 98500, vehicle: 'к926аа147' },
        client: { id: 157783, name: 'Марат', phone: '79219503808' },
        items: [
            { name: 'Услуги SPOT замена масла ДВС', price: 1000, count: 1, sum: 1000, disc_pct: 0, disc_sum: 0, total: 1000, time: 30 },
            { name: '3711 Моторное масло Motul 8100 5W-30', price: 1500, count: '4.5', sum: 6750, disc_pct: 10, disc_sum: 675, total: 6075 },
        ],
    }, '3606371');
    assert.equal(s.payment, 'cashless');
    assert.equal(s.paid, 8500);
    assert.equal(s.seller, 'Петров Пётр');
    assert.equal(s.mileage, 98500);
    assert.equal(s.plate, 'К926АА147');
    assert.equal(s.items.length, 2);
    assert.equal(s.items[1].count, 4.5);
    assert.equal(s.items[1].discount, '10%');
    assert.equal(s.items[0].discount, '', 'без скидки — пусто, а не «0%»');
    assert.equal(s.items[0].minutes, 30);
});

test('чек: наличные узнаются, отложенный платёж значка не получает', () => {
    assert.equal(parseNewSale({ header: { pay: 'Нал', pay_full: 'Наличный расчёт' } }).payment, 'cash');
    assert.equal(parseNewSale({ header: { pay_full: 'Отложенный платёж' } }).payment, null);
});
