// Тема подписчика уезжает в атрибут style элемента <html>, поэтому главное,
// что тут проверяется, — что мимо normalizeTheme в CSS не пролезает ничего
// чужого. Остальное — границы ползунков и арифметика срока.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_THEME, PRESET_IDS, normalizeTheme, themeStyleText, themeVars,
    accentInk, hexToRgbTriplet, nextExpiry, daysLeft, SUPP_DAYS,
} from './supporterTheme.js';

test('мусор вместо настроек даёт настройки по умолчанию', () => {
    for (const bad of [null, undefined, 'тема', 42, []]) {
        assert.deepEqual(normalizeTheme(bad), { ...DEFAULT_THEME });
    }
});

test('цвет принимается только шестизначным hex', () => {
    assert.equal(normalizeTheme({ accent: '#3AA7FF' }).accent, '#3aa7ff');
    for (const bad of ['red', '#fff', 'rgb(1,2,3)', '#3aa7ff; background: url(x)', '']) {
        assert.equal(normalizeTheme({ accent: bad }).accent, DEFAULT_THEME.accent);
    }
});

test('ссылка на фон — только свой сервер или https, всё остальное отбрасывается', () => {
    assert.equal(normalizeTheme({ background: '/avatars/u-supp-bg.jpg' }).background, '/avatars/u-supp-bg.jpg');
    assert.equal(
        normalizeTheme({ background: 'https://cdn.example.com/a/b.webp' }).background,
        'https://cdn.example.com/a/b.webp',
    );
    // Каждая из этих строк, попав в CSS как есть, закрывает url() и дописывает
    // своё правило — ровно от этого проверка и стоит.
    for (const bad of [
        'javascript:alert(1)',
        'data:image/svg+xml,<svg onload=alert(1)>',
        '/avatars/a.jpg"); background: url("http://evil/x',
        "/avatars/a.jpg'); }",
        '/avatars/a.jpg) no-repeat',
        'http://plain.example.com/a.jpg',
        '  ',
    ]) {
        assert.equal(normalizeTheme({ background: bad }).background, null, bad);
    }
});

test('ползунки зажимаются в свои границы, а не отбрасывают всю тему', () => {
    const t = normalizeTheme({ accent: '#112233', dim: 400, blur: -8 });
    assert.equal(t.dim, 85);
    assert.equal(t.blur, 0);
    assert.equal(t.accent, '#112233', 'сломанный ползунок не должен стоить человеку цвета');
    assert.equal(normalizeTheme({ dim: 'много' }).dim, DEFAULT_THEME.dim);
});

test('неизвестный пресет заменяется первым, известный сохраняется', () => {
    assert.equal(normalizeTheme({ preset: 'нет-такого' }).preset, DEFAULT_THEME.preset);
    for (const id of PRESET_IDS) assert.equal(normalizeTheme({ preset: id }).preset, id);
});

test('своя картинка важнее пресета и растягивается на экран', () => {
    const vars = themeVars({ background: '/avatars/u-supp-bg.jpg', preset: 'amber' });
    assert.equal(vars['--supp-bg'], 'url("/avatars/u-supp-bg.jpg")');
    assert.equal(vars['--supp-bg-size'], 'cover');
    // Градиенту cover не нужен: у него нет своего размера (см. themeVars).
    assert.equal(themeVars({ preset: 'amber' })['--supp-bg-size'], 'auto');
});

test('в строку стилей не попадает ничего, кроме наших переменных', () => {
    const text = themeStyleText({
        accent: '#000000"; background:url(http://evil/x); a:"',
        background: 'javascript:alert(1)',
        preset: '"><script>',
    });
    assert.ok(!text.includes('evil'));
    assert.ok(!text.includes('script'));
    assert.ok(!text.includes('javascript'));
    assert.ok(text.startsWith('--supp-accent: #'));
});

test('текст на акценте выбирается по светлоте цвета', () => {
    assert.equal(accentInk('#ffe680'), '#14161c', 'на светлом акценте — тёмный текст');
    assert.equal(accentInk('#1b3a6b'), '#ffffff', 'на тёмном — светлый');
    assert.equal(hexToRgbTriplet('#d4a017'), '212, 160, 23');
});

test('выдача считает срок от сегодня, продление — от конца текущего', () => {
    const now = new Date('2026-08-29T12:00:00Z');
    const fresh = nextExpiry(null, now);
    assert.equal(daysLeft(fresh, now), SUPP_DAYS);

    // Продление НЕ обнуляет остаток: заплативший за второй месяц, пока идёт
    // первый, получает их подряд, а не теряет оплаченное.
    const later = nextExpiry(new Date('2026-09-10T12:00:00Z'), now);
    assert.equal(daysLeft(later, now), 12 + SUPP_DAYS);

    // Истёкшая — тот же случай, что «не было вовсе».
    const afterGap = nextExpiry(new Date('2026-07-01T12:00:00Z'), now);
    assert.equal(daysLeft(afterGap, now), SUPP_DAYS);
});

test('бессрочная подписка не истекает', () => {
    assert.equal(daysLeft(null), Infinity);
    assert.equal(daysLeft(new Date('2000-01-01')), 0);
});
