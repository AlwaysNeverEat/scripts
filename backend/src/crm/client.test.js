import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    parseLoginForm, buildAnalyseFreePath, resolveCrmUrl, findLogoutLink, closeCrmSession,
} from './client.js';

// ── Заглушка CRM для проверки выхода ────────────────────────────────────────
// Отдаём либо страницу с фильтром станций (значит, сессия жива), либо страницу
// логина. Троттлинг клиента (400 мс на запрос) в тестах не выключаем — запросов
// единицы, зато проверяется настоящий путь.
const LOGGED_IN_PAGE = '<html><select id="field__stations"><option value="1">Софийская</option></select>'
    + '<nav><a href="/site/logout">Выход</a></nav></html>';
const LOGIN_PAGE = '<html><form><input type="text" name="login"/><input type="password" name="password"/></form></html>';

function stubCrm({ logoutPaths = ['/site/logout'], visited = [] } = {}) {
    let alive = true;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        const path = new URL(url).pathname;
        visited.push(path);
        if (logoutPaths.includes(path)) {
            alive = false;
            return new Response('', { status: 302, headers: { location: '/login' } });
        }
        return new Response(alive ? LOGGED_IN_PAGE : LOGIN_PAGE, { status: 200 });
    };
    return { visited, restore: () => { globalThis.fetch = realFetch; } };
}

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

test('parseLoginForm: реальная форма админки записей ZMS (пустой action, кнопка name=submit)', () => {
    // Сохранённая /admin/auth/login с zamena-masla-spot.ru: action="" означает
    // «POST на текущий URL», а именованная submit-кнопка обязана попасть в
    // тело POST'а — без неё бэкенд молча не принимает логин.
    const html = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '../../../shared/__fixtures__/admin-login-page.html'),
        'utf8',
    );
    assert.deepEqual(parseLoginForm(html), {
        action: '',
        loginField: 'login',
        passwordField: 'password',
        hidden: { submit: '' },
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

test('resolveCrmUrl корректно обрабатывает относительные и абсолютные URL CRM', () => {
    assert.equal(
        resolveCrmUrl('/site/login').href,
        'https://crm.zamena-masla-spot.ru/site/login',
    );
    assert.equal(
        resolveCrmUrl('https://crm.zamena-masla-spot.ru/analyse/free?x=1').href,
        'https://crm.zamena-masla-spot.ru/analyse/free?x=1',
    );
    assert.equal(
        resolveCrmUrl('login', 'https://crm.zamena-masla-spot.ru/analyse/free').href,
        'https://crm.zamena-masla-spot.ru/analyse/login',
    );
});

test('resolveCrmUrl не отправляет CRM-куки на другой хост', () => {
    assert.throws(
        () => resolveCrmUrl('https://example.com/login'),
        err => err?.code === 'crm_unavailable' && /другой хост/.test(err.message),
    );
});

test('findLogoutLink находит ссылку выхода по href и по тексту', () => {
    assert.deepEqual(
        findLogoutLink('<nav><a href="/analyse/free">Наличие</a><a href="/site/logout">Выход</a></nav>'),
        { path: '/site/logout', method: 'GET' },
    );
    // href ни о чём не говорит — узнаём выход по подписи
    assert.deepEqual(
        findLogoutLink('<a href="/u/42">Профиль</a><a href="/exit/7">Выйти</a>'),
        { path: '/exit/7', method: 'GET' },
    );
});

test('findLogoutLink уважает data-method="post" и форму выхода', () => {
    assert.deepEqual(
        findLogoutLink('<a href="/logout" data-method="post">Выход</a>'),
        { path: '/logout', method: 'POST' },
    );
    assert.deepEqual(
        findLogoutLink('<form action="/user/logout" method="post"><button>Выход</button></form>'),
        { path: '/user/logout', method: 'POST' },
    );
});

test('findLogoutLink не принимает заглушки и посторонние ссылки', () => {
    assert.equal(findLogoutLink('<a href="#" onclick="logout()">Выход</a>'), null);
    assert.equal(findLogoutLink('<a href="javascript:logout()">Выход</a>'), null);
    assert.equal(findLogoutLink('<a href="/analyse/free">Наличие на станции</a>'), null);
    assert.equal(findLogoutLink(''), null);
});

test('closeCrmSession: идёт по ссылке выхода и подтверждает, что сессия закрыта', async () => {
    process.env.CRM_THROTTLE_MS = '0';
    const crm = stubCrm();
    try {
        const jar = new Map([['PHPSESSID', 'abc']]);
        assert.equal(await closeCrmSession(jar), true);
        // страницу прочитали, по ссылке выхода прошли, закрытие проверили
        assert.ok(crm.visited.includes('/site/logout'));
        assert.equal(crm.visited.at(-1), '/analyse/free');
    } finally {
        crm.restore();
        delete process.env.CRM_THROTTLE_MS;
    }
});

test('closeCrmSession: CRM всё ещё пускает по кукам → выход не подтверждён', async () => {
    process.env.CRM_THROTTLE_MS = '0';
    // ни ссылка выхода, ни резервные пути ничего не закрывают
    const crm = stubCrm({ logoutPaths: [] });
    try {
        assert.equal(await closeCrmSession(new Map([['PHPSESSID', 'abc']])), false);
        // резервные пути тоже перепробовали, прежде чем сдаться
        assert.ok(crm.visited.includes('/logout'));
        assert.ok(crm.visited.includes('/user/logout'));
    } finally {
        crm.restore();
        delete process.env.CRM_THROTTLE_MS;
    }
});

test('closeCrmSession: сессия уже закрыта самой CRM — выход считается успешным', async () => {
    process.env.CRM_THROTTLE_MS = '0';
    const visited = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        visited.push(new URL(url).pathname);
        return new Response(LOGIN_PAGE, { status: 200 });
    };
    try {
        assert.equal(await closeCrmSession(new Map([['PHPSESSID', 'stale']])), true);
        assert.deepEqual(visited, ['/analyse/free']); // лишних запросов не делаем
    } finally {
        globalThis.fetch = realFetch;
        delete process.env.CRM_THROTTLE_MS;
    }
});

test('buildAnalyseFreePath кодирует станцию и запрос', () => {
    assert.equal(
        buildAnalyseFreePath('45', 'W 712/95'),
        '/analyse/free?stations%5B%5D=45&stationsColumns=&withCatalogItems=W%20712%2F95'
        + '&selectionPeriod=&orderByField=price&orderByOrder=ASC');
});
