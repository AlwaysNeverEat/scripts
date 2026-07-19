import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLoginForm, findLogoutHref, buildAnalyseFreePath } from './client.js';

test('parseLoginForm: action, поля логина/пароля и hidden (CSRF)', () => {
    const html = `<html><form action="/site/login" method="POST">
        <input type="hidden" name="_csrf" value="tok123"/>
        <input type="text" name="LoginForm[username]"/>
        <input type="password" name="LoginForm[password]"/>
    </form></html>`;
    assert.deepEqual(parseLoginForm(html), {
        action: '/site/login',
        loginField: 'LoginForm[username]',
        passwordField: 'LoginForm[password]',
        hidden: { _csrf: 'tok123' },
    });
});

test('parseLoginForm: игнорирует формы без пароля, терпит отсутствие action', () => {
    const html = `<form action="/search"><input type="text" name="q"/></form>
        <form><input type="email" name="email"/><input type="password" name="pw"/></form>`;
    const form = parseLoginForm(html);
    assert.equal(form.action, '');
    assert.equal(form.loginField, 'email');
    assert.equal(form.passwordField, 'pw');
    assert.equal(parseLoginForm('<html>нет форм</html>'), null);
});

test('findLogoutHref находит ссылку выхода', () => {
    assert.equal(findLogoutHref('<a href="/site/logout">Выход</a>'), '/site/logout');
    assert.equal(findLogoutHref('<a class="x" href="/user/signout?x=1">exit</a>'), '/user/signout?x=1');
    assert.equal(findLogoutHref('<a href="/home">Главная</a>'), null);
});

test('buildAnalyseFreePath кодирует станцию и запрос', () => {
    assert.equal(
        buildAnalyseFreePath('45', 'W 712/95'),
        '/analyse/free?stations%5B%5D=45&stationsColumns=&withCatalogItems=W%20712%2F95'
        + '&selectionPeriod=&orderByField=price&orderByOrder=ASC');
});
