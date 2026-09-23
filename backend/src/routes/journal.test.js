// Замок на разделе и разбор тела запроса. Отказы тут важнее успеха: раздел
// записей переехал на ПЕРСОНАЛЬНУЮ учётку CRM именно ради авторства, и
// дырка в замке вернула бы записи без автора — то, ради чего всё затевалось.

import test from 'node:test';
import assert from 'node:assert/strict';

import { crmGate, readBooking } from './journal.js';
import { DURATIONS } from '../../../shared/crmJournal.js';

function mockRes() {
    const res = { statusCode: 200, body: null, done: false };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; res.done = true; return res; };
    return res;
}

// ── Гейт ────────────────────────────────────────────────────────────────────
// Гоняем НАСТОЯЩИЙ crmGate, подсунув ему проверку сессии: иначе тест проверял
// бы свою копию ветвлений, а замок мог бы разойтись с ней молча.
async function gate(state, { user = { id: 'u1' } } = {}) {
    const res = mockRes();
    let passed = false;
    await crmGate(async () => state)({ user }, res, () => { passed = true; });
    return { res, passed };
}

test('гость в раздел не попадает вовсе', async () => {
    const { res, passed } = await gate({ loggedIn: true }, { user: null });
    assert.equal(passed, false, 'до CRM дело не доходит даже при живой сессии');
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error.code, 'auth_required');
});

test('нет привязки CRM — отказ с инструкцией, а не «forbidden»', async () => {
    const { res, passed } = await gate({ loggedIn: false, linked: false });
    assert.equal(passed, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, 'crm_link_required');
    assert.match(res.body.error.message, /привяжите её в профиле/);
});

test('пароль CRM сменили — текст другой, иначе человек будет жать ту же кнопку', async () => {
    const { res } = await gate({ loggedIn: false, linkRejected: true });
    assert.match(res.body.error.message, /больше не подходит/);
});

test('CRM не отвечает — это 502, а не «войдите заново»', async () => {
    const { res } = await gate({ loggedIn: false, linked: true, unavailable: 'CRM недоступна' });
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.error.code, 'crm_unavailable');
});

test('с живой сессией запрос идёт дальше', async () => {
    const { passed, res } = await gate({ loggedIn: true });
    assert.equal(passed, true);
    assert.equal(res.done, false, 'гейт ничего не отвечает сам');
});

// ── Разбор тела ─────────────────────────────────────────────────────────────

const OK = { addressId: 8, date: '2026-10-01', time: '10:30', durationMinutes: 30, phone: '79117917147' };

test('нормальное тело разбирается, СМС по умолчанию НЕ шлётся', () => {
    const r = readBooking({ ...OK, name: 'Андрей', carNumber: 'к753ае198', comment: 'двс' });
    assert.equal(r.error, undefined);
    assert.equal(r.fields.addressId, 8);
    assert.equal(r.fields.sms, false, 'молчание не согласие: галку надо ставить явно');
    assert.equal(readBooking({ ...OK, sms: true }).fields.sms, true);
    assert.equal(readBooking({ ...OK, sms: 'да' }).fields.sms, false, 'строка галкой не считается');
});

test('дата, время и длительность проверяются до похода в CRM', () => {
    assert.match(readBooking({ ...OK, date: '01.10.2026' }).error, /YYYY-MM-DD/);
    assert.match(readBooking({ ...OK, time: '10-30' }).error, /ЧЧ:ММ/);
    assert.match(readBooking({ ...OK, durationMinutes: 45 }).error, /длительность бывает/);
    assert.match(readBooking({ ...OK, addressId: 'восемь' }).error, /станция/);
    for (const d of DURATIONS) {
        assert.equal(readBooking({ ...OK, durationMinutes: d }).error, undefined, `${d} минут`);
    }
});

test('после закрытия станции записать нельзя', () => {
    assert.equal(readBooking({ ...OK, time: '20:30' }).error, undefined, '20:30 — последний слот');
    assert.match(readBooking({ ...OK, time: '21:00' }).error, /станция уже закрыта/);
});

test('нужен телефон ИЛИ имя — пустая запись не создаётся', () => {
    assert.match(readBooking({ ...OK, phone: '', name: '' }).error, /телефон или имя/);
    assert.equal(readBooking({ ...OK, phone: '', name: 'Бронь' }).error, undefined,
        'бронь без телефона — законная запись');
});

test('мусорный номер не запрещён, но помечен', () => {
    // «Бронь» и записи мастера приходят с +7 111 111-11-11. Это законные
    // записи — они просто не зачитываются в топ (см. creditSkipReason).
    const r = readBooking({ ...OK, phone: '+7 111 111-11-11', name: 'Бронь' });
    assert.equal(r.error, undefined);
    assert.equal(r.junkPhone, true);
    assert.equal(readBooking(OK).junkPhone, false);
});
