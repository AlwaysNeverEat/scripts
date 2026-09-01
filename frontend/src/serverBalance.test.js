// Панель баланса — чистая функция от ответа сервера, поэтому проверяется без
// браузера: на вход цифры, на выходе разметка.
import test from 'node:test';
import assert from 'node:assert/strict';
import { serverBalanceHtml } from './serverBalance.js';

const base = {
    balance: 134.18, bonus: 0, hourly: 2.01873, monthly: 1473.67,
    hoursLeft: 66, daysLeft: 2, items: [], checkedAt: '2026-09-01T10:00:00.000Z',
    stale: false,
};

test('главная строка — срок, а не сумма', () => {
    const html = serverBalanceHtml(base);
    assert.match(html, /Хватит на 2 дня/);
    assert.match(html, /srv-alarm/);      // двое суток — это «пора пополнить»
});

test('меньше двух суток считается часами: «0 дней» сроком не является', () => {
    const html = serverBalanceHtml({ ...base, hoursLeft: 9, daysLeft: 0 });
    assert.match(html, /Хватит на 9 часов/);
});

test('запаса на месяц — спокойный вид и полная полоса', () => {
    const html = serverBalanceHtml({ ...base, balance: 3000, hoursLeft: 1400, daysLeft: 58 });
    assert.match(html, /Хватит на 58 дней/);
    assert.match(html, /srv-ok/);
    assert.match(html, /width:100%/);
});

test('неделя запаса — предупреждение, но не тревога', () => {
    const html = serverBalanceHtml({ ...base, hoursLeft: 24 * 6, daysLeft: 6 });
    assert.match(html, /srv-warn/);
});

test('расхода нет — срока нет тоже', () => {
    const html = serverBalanceHtml({ ...base, hourly: 0, hoursLeft: null, daysLeft: null });
    assert.match(html, /Расхода нет/);
    assert.doesNotMatch(html, /Хватит/);
});

test('дата конца считается от момента замера, а не от «сейчас»', () => {
    // Тот же остаток часов, снятый в разные моменты, даёт разные даты конца.
    // Считай мы от Date.now(), обе строки были бы одинаковыми — а ответ живёт
    // в кэше бэкенда до пяти минут, и дата ползала бы между заходами.
    const early = serverBalanceHtml({ ...base, checkedAt: '2026-09-01T10:00:00.000Z' });
    const later = serverBalanceHtml({ ...base, checkedAt: '2026-09-03T10:00:00.000Z' });
    const dateOf = (html) => html.match(/до [^<]+/)[0];
    assert.notEqual(dateOf(early), dateOf(later));
    assert.match(dateOf(early), /до \d+ сентября/);
});

test('бонусный счёт показывается, только когда он есть', () => {
    assert.doesNotMatch(serverBalanceHtml(base), /Бонусы/);
    assert.match(serverBalanceHtml({ ...base, bonus: 500 }), /Бонусы/);
});

test('детализация — строка на ресурс, имя экранируется', () => {
    const html = serverBalanceHtml({ ...base, items: [
        { label: 'Сервер — <Cars DB>', hourly: 1.76204, monthly: 1286.29 },
    ] });
    assert.match(html, /&lt;Cars DB&gt;/);
    assert.match(html, /1,76 ₽\/час/);
});

test('устаревший снимок помечается временем замера', () => {
    assert.match(serverBalanceHtml({ ...base, stale: true }), /Рег\.облако не отвечает/);
});
