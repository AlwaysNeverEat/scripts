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

test('главная строка — срок, а не сумма', () => {
    const html = serverCardHtml(base);
    assert.match(html, /Хватит на 2 дня/);
    assert.match(html, /srv-alarm/);      // двое суток — это «пора пополнить»
});

test('меньше двух суток считается часами: «0 дней» сроком не является', () => {
    const html = serverCardHtml({ ...base, hoursLeft: 9, daysLeft: 0 });
    assert.match(html, /Хватит на 9 часов/);
});

test('запаса на месяц — спокойный вид', () => {
    const html = serverCardHtml({ ...base, balance: 3000, hoursLeft: 1400, daysLeft: 58 });
    assert.match(html, /Хватит на 58 дней/);
    assert.match(html, /srv-ok/);
});

test('неделя запаса — предупреждение, но не тревога', () => {
    const html = serverCardHtml({ ...base, hoursLeft: 24 * 6, daysLeft: 6 });
    assert.match(html, /srv-warn/);
});

test('расхода нет — срока нет тоже', () => {
    const html = serverCardHtml({ ...base, hourly: 0, hoursLeft: null, daysLeft: null });
    assert.match(html, /Расхода нет/);
    assert.doesNotMatch(html, /Хватит/);
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

test('сумма пишется по-русски и с рублём отдельным знаком', () => {
    const html = serverCardHtml({ ...base, balance: 1500 });
    // Пробел в тысячах ставит Intl (он неразрывный), поэтому сверяем шаблоном
    assert.match(html, /1\s500,00<span class="srv-card__currency">₽/);
});

test('полоса и легенда собираются из детализации, имя экранируется', () => {
    const html = serverCardHtml({ ...base, items: [
        { kind: 'Сервер', name: '<Cars DB>', label: 'Сервер — <Cars DB>', hourly: 1.76204 },
        { kind: 'Плавающий IP', name: '', label: 'Плавающий IP', hourly: 0.25669 },
    ] });
    assert.match(html, /&lt;Cars DB&gt;/);
    assert.match(html, /Плавающий IP/);
    // Ширины сегментов — это сами цены: доли полосы всегда сходятся с легендой
    assert.match(html, /flex:1\.76204/);
    assert.match(html, /flex:0\.25669/);
});

test('лишние ресурсы схлопываются в «прочее», а не растягивают легенду', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((n, i) => (
        { kind: 'Бэкап', name: n, label: 'Бэкап — ' + n, hourly: 1 - i * 0.1 }));
    const html = serverCardHtml({ ...base, items: many });
    assert.match(html, /Прочее/);
    assert.equal(html.match(/srv-card__legend[\s\S]*$/)[0].match(/<i /g).length, 4);
});

test('нет детализации — нет ни полосы, ни легенды', () => {
    const html = serverCardHtml({ ...base, items: [] });
    assert.doesNotMatch(html, /srv-card__bar/);
    assert.doesNotMatch(html, /srv-card__legend/);
});

test('устаревший снимок помечается временем замера вместо «Рег.облако»', () => {
    const html = serverCardHtml({ ...base, stale: true });
    assert.match(html, /srv-card__range">на \d\d:\d\d/);
    assert.doesNotMatch(html, /Рег\.облако<\/span>/);
});
