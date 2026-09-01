// Карточка баланса — чистая функция от ответа сервера, поэтому проверяется без
// браузера: на вход цифры, на выходе разметка.
import test from 'node:test';
import assert from 'node:assert/strict';
import { serverCardHtml } from './serverBalance.js';

const base = {
    balance: 134.18, bonus: 0, hourly: 2.01873, monthly: 1473.67,
    hoursLeft: 66, daysLeft: 2, items: [], checkedAt: '2026-09-01T10:00:00.000Z',
    stale: false,
};

test('самое крупное в карточке — срок, а не сумма', () => {
    const html = serverCardHtml(base);
    assert.match(html, /srv-card__big">2<\/span>\s*<span class="srv-card__unit">дня/);
    assert.match(html, /srv-alarm/);      // двое суток — это «пора пополнить»
});

test('меньше двух суток считается часами: «0 дней» сроком не является', () => {
    const html = serverCardHtml({ ...base, hoursLeft: 9, daysLeft: 0 });
    assert.match(html, /srv-card__big">9<\/span>\s*<span class="srv-card__unit">часов/);
});

test('запаса на месяц — спокойный вид и полная полоса', () => {
    const html = serverCardHtml({ ...base, balance: 3000, hoursLeft: 1400, daysLeft: 58 });
    assert.match(html, /srv-card__big">58</);
    assert.match(html, /srv-ok/);
    assert.match(html, /width:100%/);
});

test('полоса — ЗАПАС ВРЕМЕНИ: неделя из двух даёт половину', () => {
    const html = serverCardHtml({ ...base, hoursLeft: 24 * 7, daysLeft: 7 });
    assert.match(html, /width:50%/);
});

test('последние часы — полоса не стирается в ноль совсем', () => {
    const html = serverCardHtml({ ...base, hoursLeft: 1, daysLeft: 0 });
    assert.match(html, /width:2%/);
});

test('неделя запаса — предупреждение, но не тревога', () => {
    const html = serverCardHtml({ ...base, hoursLeft: 24 * 6, daysLeft: 6 });
    assert.match(html, /srv-warn/);
});

test('расхода нет — вместо срока бесконечность, полоса полная', () => {
    const html = serverCardHtml({ ...base, hourly: 0, hoursLeft: null, daysLeft: null });
    assert.match(html, /srv-card__big">∞/);
    assert.match(html, /не тратится/);
    assert.match(html, /width:100%/);
});

test('дата конца считается от момента замера, а не от «сейчас»', () => {
    // Тот же остаток часов, снятый в разные моменты, даёт разные даты конца.
    // Считай мы от Date.now(), обе строки были бы одинаковыми — а ответ живёт
    // в кэше бэкенда до пяти минут, и дата ползала бы между заходами.
    const early = serverCardHtml({ ...base, checkedAt: '2026-09-01T10:00:00.000Z' });
    const later = serverCardHtml({ ...base, checkedAt: '2026-09-03T10:00:00.000Z' });
    const dateOf = (html) => html.match(/до [^<]+/)[0];
    assert.notEqual(dateOf(early), dateOf(later));
    assert.match(dateOf(early), /до \d+ сентября/);
});

test('сумма стоит мелкой подписью вместе с датой конца', () => {
    const html = serverCardHtml({ ...base, balance: 1500 });
    // Пробел в тысячах ставит Intl (он неразрывный), поэтому сверяем шаблоном
    assert.match(html, /srv-card__sub[\s\S]*1\s500,00 ₽ · до \d+ сентября/);
});

test('на что уходит расход — в подсказке к сумме, а не в карточке', () => {
    const html = serverCardHtml({ ...base, items: [
        { kind: 'Сервер', name: '<Cars DB>', label: 'Сервер — <Cars DB>', hourly: 1.76204 },
        { kind: 'Плавающий IP', name: '', label: 'Плавающий IP', hourly: 0.25669 },
    ] });
    assert.match(html, /title="Расход 2,02 ₽\/час/);
    assert.match(html, /Сервер — &lt;Cars DB&gt;: 1,76 ₽\/час/);
    assert.match(html, /Плавающий IP: 0,26 ₽\/час/);
});

test('нет детализации — карточка всё равно целая: срок важнее её', () => {
    const html = serverCardHtml({ ...base, items: [] });
    assert.match(html, /srv-card__bar/);
    assert.match(html, /srv-card__big">2</);
});

test('устаревший снимок помечается временем замера вместо «Рег.облако»', () => {
    const html = serverCardHtml({ ...base, stale: true });
    assert.match(html, /srv-card__range">на \d\d:\d\d/);
    assert.doesNotMatch(html, /Рег\.облако<\/span>/);
});
