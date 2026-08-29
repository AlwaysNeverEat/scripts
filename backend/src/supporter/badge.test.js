// Проверяем ту часть подписки, которая считается БЕЗ БАЗЫ: кто владелец и что
// показывается рядом с ником. Живого Postgres в node --test нет, поэтому эти
// правила и лежат отдельно от store.js — иначе тест на плашку требовал бы
// поднятой базы. Сроки и продление — в shared/supporterTheme.test.js, там же,
// где сама арифметика.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supporterBadge, isOwnerLogin, isOwner, OWNER_LOGIN } from './badge.js';

test('владелец узнаётся по логину, без учёта регистра и пробелов', () => {
    assert.ok(isOwnerLogin(OWNER_LOGIN));
    assert.ok(isOwnerLogin(OWNER_LOGIN.toUpperCase()));
    assert.ok(isOwnerLogin(` ${OWNER_LOGIN} `));
    assert.ok(isOwner({ login: OWNER_LOGIN }));
    for (const bad of [null, undefined, '', 'gtrixoff2', 'admin', {}]) {
        assert.equal(isOwnerLogin(bad), false, String(bad));
    }
    assert.equal(isOwner(null), false);
    assert.equal(isOwner({ login: 'kolya' }), false);
});

test('без строки подписки плашки нет', () => {
    assert.equal(supporterBadge(null), null);
    assert.equal(supporterBadge({}), null);
    // supp_id пустой — значит JOIN не нашёл ДЕЙСТВУЮЩЕЙ подписки: истёкшая
    // сюда не доезжает вовсе (условие срока стоит в самом JOIN).
    assert.equal(supporterBadge({ supp_id: null, supp_theme: { accent: '#3aa7ff' } }), null);
});

test('плашка несёт цвет подписчика — им же красится его строка в топе', () => {
    const badge = supporterBadge({
        supp_id: 'u1',
        supp_expires: '2026-09-28T00:00:00.000Z',
        supp_theme: { accent: '#3AA7FF', glow: true },
    });
    assert.equal(badge.label, 'supp');
    assert.equal(badge.color, '#3aa7ff');
    assert.equal(badge.glow, true);
    assert.equal(badge.forever, false);
});

test('сломанные настройки не уносят плашку с собой', () => {
    // Тема могла быть записана старой версией окна или руками в psql. Плашка
    // от этого пропадать не должна: подписка оплачена.
    const badge = supporterBadge({ supp_id: 'u1', supp_theme: 'мусор' });
    assert.equal(badge.label, 'supp');
    assert.match(badge.color, /^#[0-9a-f]{6}$/);
});

test('подписка без срока — бессрочная (владелец)', () => {
    const badge = supporterBadge({ supp_id: 'u1', supp_expires: null, supp_theme: {} });
    assert.equal(badge.forever, true);
    assert.equal(badge.until, null);
});

test('«красить строку в топе» выключается настройкой, а плашка остаётся', () => {
    const badge = supporterBadge({ supp_id: 'u1', supp_theme: { glow: false } });
    assert.equal(badge.glow, false);
    assert.equal(badge.label, 'supp');
});
