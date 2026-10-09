// Лента звонков и карточка лида новой CRM. Строки — в той форме, в какой их
// рисует код самой CRM (incoming_active / incoming_list / clientcard), с
// выдуманными людьми и номерами.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    phone11, normalizeCall, mergeFeed, settleGone, isLive, parseLeadCard, parseServices,
    cleanCalcItems, calcTotal, actionRefusal, LEAD_STATUSES, sortFeed, isMine, operatorKey,
} from './crmLeads.js';

// «Сейчас» для ленты — 08.10.2026 09:10 по Москве.
const NOW = Date.UTC(2026, 9, 8, 6, 10);

test('номер — одиннадцать цифр с семёркой', () => {
    assert.equal(phone11('+7 (931) 204-71-01'), '79312047101');
    assert.equal(phone11('89312047101'), '79312047101');
    assert.equal(phone11('9312047101'), '79312047101');
    assert.equal(phone11('204-71-01'), '');
});

test('живой звонок и строка журнала сводятся к одному виду', () => {
    const live = normalizeCall({
        id: 11, status: 'ringing', phone: '79312047101', operator: '78126034480', direction: 'in',
        created: '2026-10-08 09:07:31', client: { id: 199305, name: 'Ершов Андрей', car: 'Kia Rio', visits: 4, last_visit: '2026-06-20' },
    });
    assert.equal(live.clientId, '199305');
    assert.equal(live.name, 'Ершов Андрей');
    assert.equal(live.operator, '78126034480');
    assert.equal(live.client.visits, 4);
    assert.ok(isLive(live));

    const row = normalizeCall({ id: 12, created: '2026-10-08 08:00:00', name: 'Дамир', phone: '79293412767', line: 'Сайт', status: 'missed', recording: 'mango:abc' });
    assert.equal(row.name, 'Дамир');
    assert.equal(row.line, 'Сайт');
    assert.equal(row.recording, '', 'запись у телефонии — ссылки нет');
    assert.equal(row.hasRecording, true);
    assert.equal(row.client, null);
});

test('лента: все звонки, а не три; живые сверху, дальше свежие', () => {
    const list = [1, 2, 3, 4, 5].map(i => ({ id: i, created: `2026-10-08 0${i}:00:00`, phone: `7931000000${i}`, status: 'completed' }));
    const active = [{ id: 9, status: 'answered', phone: '79310000009', created: '2026-10-08 09:00:00' }];
    const feed = mergeFeed({ list, active, now: NOW });
    assert.equal(feed.length, 6);
    assert.deepEqual(feed.map(c => c.id), ['9', '5', '4', '3', '2', '1']);
});

test('лента: один звонок из двух источников — одна строка, живое состояние побеждает', () => {
    const feed = mergeFeed({ now: NOW,
        list: [{ id: 7, created: '2026-10-08 09:07:00', phone: '79312047101', status: 'completed', name: 'Ершов', line: 'Сайт' }],
        active: [{ id: 7, created: '2026-10-08 09:07:00', phone: '79312047101', status: 'answered' }],
    });
    assert.equal(feed.length, 1);
    assert.equal(feed[0].status, 'answered');
    assert.equal(feed[0].name, 'Ершов', 'имя из журнала не потерялось');
    assert.equal(feed[0].line, 'Сайт');
});

test('лента: без id склеиваем по номеру и минуте, исходящие не берём', () => {
    const feed = mergeFeed({ now: NOW,
        list: [{ created: '2026-10-08 09:07:10', phone: '79312047101', status: 'completed' }],
        active: [
            { created: '2026-10-08 09:07:40', phone: '79312047101', status: 'answered' },
            { created: '2026-10-08 09:08:00', phone: '79312047102', status: 'ringing', direction: 'out' },
        ],
    });
    assert.equal(feed.length, 1);
});

test('лента: сколько раз звонил номер', () => {
    const feed = mergeFeed({ now: NOW, list: [
        { id: 1, created: '2026-10-08 09:00:00', phone: '79312047101' },
        { id: 2, created: '2026-10-08 10:00:00', phone: '79312047101' },
        { id: 3, created: '2026-10-08 11:00:00', phone: '79312047102' },
    ] });
    assert.deepEqual(feed.map(c => c.callsFromPhone), [1, 2, 2]);
});

test('лента: запомненный звонок не пропадает, когда его нет ни в живых, ни в журнале', () => {
    const seen = [normalizeCall({ id: 5, status: 'answered', phone: '79312047101', created: '2026-10-08 09:00:00' })];
    settleGone(seen, new Set());
    assert.equal(seen[0].status, 'completed', 'кончился — не висит «разговор» вечно');
    const feed = mergeFeed({ remembered: seen, now: NOW });
    assert.equal(feed.length, 1);
});

test('карточка лида: все блоки CRM', () => {
    const card = parseLeadCard({
        client: { id: 286805, fio: 'Дамир', phone: '79293412767', bonus: '0', oil_changes: 1, car: 'Lada Vesta', knew_from: 288 },
        stats: { visits: 1, ltv: 13754, avg: 13754 },
        metrics: { days_since: 109, freq_days: null },
        callplan: { status: 'Перезвонить', next_call: '2026-10-09' },
        last_call: '2026-10-08 09:07:00',
        calls: [{ id: 1, at: '2026-10-08 09:07:00', dir: 'in', status: 'answered', dur: 75, comment: 'спросил про АКПП' }],
        calcs: [{ id: 4, at: '2026-10-08 09:10:00', author: 'Ищенко', total: 2450, car: 'Vesta', items: [{ name: 'Замена масла и фильтра', price: 1900, qty: 1 }] }],
        notes: [{ id: 2, at: '2026-10-08 09:11:00', author: 'Ищенко', text: 'приедет в субботу' }],
        history: [{ id: 3606371, date: '2026-06-20 11:04:00', station: 'Жукова 21', vehicle: 'М248ОК142', mileage: 150150, items: 7, sum: 13754 }],
        sources: [{ id: 288, name: 'Yandex' }, { id: '', name: 'пусто' }],
        omni: [{ id: 1, channel: 'tg', peer: '@damir', status: 'closed', thread: [{ dir: 'out', body: 'Здравствуйте', at: '2026-10-08 09:00:00' }] }],
    });
    assert.equal(card.client.sourceId, '288');
    assert.equal(card.client.bonus, 0);
    assert.equal(card.stats.daysSince, 109);
    assert.equal(card.stats.freqDays, null, 'частоты нет — не ноль');
    assert.deepEqual(card.plan, { status: 'Перезвонить', nextCall: '2026-10-09' });
    assert.equal(card.calls[0].dur, 75);
    assert.equal(card.calcs[0].items[0].price, 1900);
    assert.equal(card.history[0].mileage, 150150);
    assert.equal(card.sources.length, 1);
    assert.equal(card.omni[0].closed, true);
    assert.equal(card.omni[0].thread[0].out, true);
});

test('карточка лида: пустой ответ не роняет разбор', () => {
    const card = parseLeadCard({});
    assert.equal(card.calls.length, 0);
    assert.equal(card.stats.visits, 0);
    assert.equal(card.plan.status, '');
});

test('статусы — ровно список CRM', () => {
    assert.deepEqual(LEAD_STATUSES, ['Активный', 'Недозвон', 'Перезвонить', 'Приедет сам', 'Отказался', 'Записан', 'Архив', 'У конкурента']);
});

test('прайс и строки расчёта', () => {
    assert.deepEqual(parseServices({ rows: [{ name: 'Замена масла', price: '1900' }, { name: '' }] }), [{ name: 'Замена масла', price: 1900 }]);
    const items = cleanCalcItems([
        { name: 'Замена масла', price: '1 900', qty: '2' },
        { name: '', price: '' },
        { name: 'Фильтр', price: -5, qty: 0 },
    ]);
    assert.deepEqual(items, [{ name: 'Замена масла', price: 1900, qty: 2 }, { name: 'Фильтр', price: 0, qty: 1 }]);
    assert.equal(calcTotal(items), 3800);
});

test('ответ CRM на действие', () => {
    assert.equal(actionRefusal({ ok: true }), null);
    assert.equal(actionRefusal({ ok: false, error: 'empty' }), 'пустое значение');
    assert.equal(actionRefusal({ error: 'no_client', message: 'Клиент не найден' }), 'Клиент не найден');
    assert.equal(actionRefusal(null), 'CRM не приняла');
});

test('живой звонок со вчера — «без исхода», а не «звонит» над всей лентой', () => {
    const feed = mergeFeed({ now: NOW, active: [
        { id: 1, status: 'ringing', phone: '79310000001', created: '2026-10-07 18:08:00' },
        { id: 2, status: 'ringing', phone: '79310000002', created: '2026-10-08 09:08:00' },
        { id: 3, status: 'answered', phone: '79310000003', created: '2026-10-08 08:55:00' },
        { id: 4, status: 'ringing', phone: '79310000004', created: '2026-10-08 09:00:00' },
    ] });
    const st = Object.fromEntries(feed.map(c => [c.id, c.status]));
    assert.deepEqual(st, { 1: 'stale', 2: 'ringing', 3: 'answered', 4: 'stale' });
    assert.deepEqual(feed.filter(isLive).map(c => c.id), ['2', '3']);
});

test('код оператора: свои только помечаются, «03» и «3» — один человек', () => {
    assert.equal(operatorKey('03'), '3');
    assert.equal(operatorKey('оператор 101'), '101');
    assert.equal(isMine({ operator: '03' }, '3'), true);
    assert.equal(isMine({ operator: '' }, ''), false, 'без кода своих нет');
    const calls = [
        { id: 'a', operator: '105', status: 'ringing', at: '2026-10-08 09:09:00' },
        { id: 'b', operator: '101', status: 'completed', at: '2026-10-08 08:00:00' },
        { id: 'c', operator: '101', status: 'answered', at: '2026-10-08 07:00:00' },
        { id: 'd', operator: '', status: 'completed', at: '2026-10-08 09:05:00' },
    ];
    assert.deepEqual(sortFeed([...calls]).map(c => c.id), ['a', 'c', 'd', 'b'], 'живые сверху, дальше свежие — чей звонок, порядок не меняет');
    assert.deepEqual(calls.filter(c => isMine(c, '101')).map(c => c.id), ['b', 'c']);
});
