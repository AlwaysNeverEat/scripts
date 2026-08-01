import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    CRM_AUTO_LOGIN_PAUSE_MS, crmAutoLoginPaused, pauseCrmAutoLogin, resumeCrmAutoLogin,
} from './autoLoginPause.js';

test('по умолчанию паузы нет — автовход работает', () => {
    assert.equal(crmAutoLoginPaused('user-none'), false);
});

test('выход ставит паузу: пока она держится, сессию CRM не поднять автоматически', () => {
    pauseCrmAutoLogin('user-1');
    assert.equal(crmAutoLoginPaused('user-1'), true);
    // пауза персональная: соседа по смене она не касается
    assert.equal(crmAutoLoginPaused('user-2'), false);
    resumeCrmAutoLogin('user-1');
});

test('явный вход (в CRM руками или заново на сайт) снимает паузу', () => {
    pauseCrmAutoLogin('user-3');
    resumeCrmAutoLogin('user-3');
    assert.equal(crmAutoLoginPaused('user-3'), false);
});

test('забытая пауза истекает сама, а не висит вечно', () => {
    const now = Date.now();
    pauseCrmAutoLogin('user-4', now);
    assert.equal(crmAutoLoginPaused('user-4', now + CRM_AUTO_LOGIN_PAUSE_MS - 1), true);
    assert.equal(crmAutoLoginPaused('user-4', now + CRM_AUTO_LOGIN_PAUSE_MS), false);
    // истёкшая пауза забыта окончательно
    assert.equal(crmAutoLoginPaused('user-4', now), false);
});
