import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    parseLoginForm, buildAnalyseFreePath, resolveCrmUrl, findLogoutLink, closeCrmSession,
    fetchPage, loginIntoJar,
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

// ── Какая страница «это логин» ──────────────────────────────────────────────
// Прокси ходит не только на /analyse/free, ради которой писался, а на любую
// страницу CRM, и решает по ответу, жива ли сессия. Решать это по приметам
// одной конкретной страницы нельзя: у страниц клиента их нет, и живая сессия
// объявлялась мёртвой — куки стирались, а поиск клиента отвечал «войдите в
// CRM» даже сразу после успешного входа.

// Страницы CRM без единой приметы /analyse/free: ни фильтра станций, ни
// таблицы товаров. Разметка обрезана до сути с реальных страниц.
const DIAL_CLIENTS_PAGE = '<html><h3>Найденные клиенты</h3>'
    + '<div class="found-clients-list"><div><a href="/clients/151465">Георгий</a></div></div>'
    + '<form class="form" action="/dial_clients/"><input name="phone"></form></html>';
const DIAL_CLIENTS_EMPTY = '<html><h3>Ничего не найдено</h3>'
    + '<div class="found-clients-list"></div></html>';

function stubPages(pages) {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        const html = pages[new URL(url).pathname];
        return new Response(html ?? '', { status: html === undefined ? 404 : 200 });
    };
    return () => { globalThis.fetch = realFetch; };
}

test('страница поиска клиентов НЕ считается логином — иначе сессию рвёт на ровном месте', async () => {
    const restore = stubPages({
        '/dial_clients/': DIAL_CLIENTS_PAGE,
        '/clients/151465': '<html><p>Имя: Георгий</p><p>Бонусный счет: 334.50</p></html>',
    });
    try {
        assert.equal(await fetchPage(new Map(), '/dial_clients/'), DIAL_CLIENTS_PAGE);
        // Пустая выдача — тоже нормальная страница, а не «сессия кончилась».
        const restoreEmpty = stubPages({ '/dial_clients/': DIAL_CLIENTS_EMPTY });
        assert.equal(await fetchPage(new Map(), '/dial_clients/'), DIAL_CLIENTS_EMPTY);
        restoreEmpty();
        assert.match(await fetchPage(new Map(), '/clients/151465'), /Георгий/);
    } finally {
        restore();
    }
});

test('форма логина вместо запрошенной страницы — это «сессии нет»', async () => {
    const restore = stubPages({ '/dial_clients/': LOGIN_PAGE, '/clients/1': '' });
    try {
        assert.equal(await fetchPage(new Map(), '/dial_clients/'), '');
        assert.equal(await fetchPage(new Map(), '/clients/1'), '');
    } finally {
        restore();
    }
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

test('просроченный сертификат CRM: понятный текст и «сайт тут ни при чём»', async () => {
    process.env.CRM_THROTTLE_MS = '0';
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        const err = new TypeError('fetch failed');
        err.cause = Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' });
        throw err;
    };
    try {
        await assert.rejects(
            closeCrmSession(new Map([['PHPSESSID', 'abc']])),
            (err) => {
                assert.equal(err.code, 'crm_unavailable');
                // Оператор видел голое «CERT_HAS_EXPIRED: certificate has
                // expired» и звал за помощью не туда.
                assert.match(err.message, /сертификат сервера просрочен/);
                assert.match(err.message, /сайт тут ни при чём/);
                return true;
            },
        );
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

// ── Вход в переписанную CRM ─────────────────────────────────────────────────
// На хосте живут две CRM разом: новая (`/re/api.php`, JSON, журнал записи) и
// прежняя (`/analyse/free`, `/dial_clients/` — «Склад» и «Клиент»). Логинимся
// обоими способами в ОДИН jar, потому что снаружи не видно, чьи куки кого
// пускают. Без персональной сессии CRM не знает, кто работает, и записи
// уходят без автора — ради этого всё и затевалось.

const CRM_PERMS = { user: 'Иванов Иван Иванович', role_name: 'Call центр', privileges: [7] };

// Прежняя форма логина, снятая с живой CRM: action ПУСТОЙ (значит «на эту же
// страницу»), рядом hidden-поле, без которого бэкенд логин не принимает.
const OLD_LOGIN_PAGE = "<html><form action='' method='post'>"
    + "<input type='hidden' name='user_login' value='1' />"
    + "<input class=\"auth_input\" type='text' name='login' value='' />"
    + "<input class=\"auth_input\" type='password' name='password' value='' />"
    + '<button class="auth_submit" type=\'submit\'>Войти</button></form></html>';

// Стенд CRM: журнал запросов + переключатель «вошли или нет».
function stubCrmHost({ api = true, old = true, apiStatus = null } = {}) {
    const seen = [];
    // Сессии У КАЖДОЙ СВОЯ — это и есть случай, ради которого мы логинимся
    // дважды: снаружи не видно, пускают ли куки одной CRM в другую.
    let loggedApi = false;
    let loggedOld = false;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
        const u = new URL(url);
        const method = opts.method || 'GET';
        const body = typeof opts.body === 'string' ? opts.body : '';
        seen.push({ path: u.pathname, search: u.search, method, body });

        if (u.pathname === '/re/api.php') {
            if (apiStatus) return new Response('', { status: apiStatus });
            if (!api) return new Response('not found', { status: 404 });
            if (method === 'POST' && /action=login/.test(body)) {
                if (/password=verno/.test(body)) loggedApi = true;
                return new Response(JSON.stringify({ ok: loggedApi }), { status: 200 });
            }
            if (u.search.includes('section=userperms')) {
                return loggedApi
                    ? new Response(JSON.stringify(CRM_PERMS), { status: 200 })
                    : new Response(JSON.stringify({ error: 'auth_required' }), { status: 401 });
            }
            return new Response('{}', { status: 200 });
        }
        if (!old) return new Response('', { status: 404 });
        // Прежняя CRM: защищённая страница уводит редиректом на корень, а форма
        // логина приезжает уже оттуда — из-за этого пустой action и важен.
        if (u.pathname === '/analyse/free') {
            return loggedOld
                ? new Response(LOGGED_IN_PAGE, { status: 200 })
                : new Response('', { status: 302, headers: { location: '/' } });
        }
        if (u.pathname === '/') {
            if (method === 'POST') {
                if (/password=verno/.test(body)) loggedOld = true;
                return new Response('', { status: 200 });
            }
            return new Response(OLD_LOGIN_PAGE, { status: 200 });
        }
        return new Response('', { status: 404 });
    };
    return { seen, restore: () => { globalThis.fetch = realFetch; } };
}

test('вход: JSON-ручка нынешней CRM — без неё сессия не персональная', async () => {
    const s = stubCrmHost({ old: false });
    try {
        await loginIntoJar(new Map(), 'ivanov', 'verno');
        const post = s.seen.find(r => r.path === '/re/api.php' && r.method === 'POST');
        assert.ok(post, 'логин ушёл на /re/api.php');
        assert.match(post.body, /action=login/);
        assert.ok(s.seen.some(r => r.search.includes('section=userperms')),
            'вход подтверждается вопросом «кто я», а не кодом 200');
    } finally { s.restore(); }
});

test('вход: ПУСТОЙ action формы означает «на эту же страницу», а не путь входа', async () => {
    // Регрессия. Раньше сюда подставлялся entryPath (/analyse/free), и это
    // работало, пока форма жила там же. Теперь /analyse/free отвечает 302 на
    // `/`, форма приезжает оттуда — и логин уходил обратно на /analyse/free,
    // где его встречал новый редирект и терял тело запроса. Вход «проходил»,
    // сессии не появлялось, «Клиент» и «Склад» просили войти заново.
    const s = stubCrmHost({ api: false });
    try {
        await loginIntoJar(new Map(), 'ivanov', 'verno');
        const form = s.seen.filter(r => r.method === 'POST' && r.path !== '/re/api.php');
        assert.equal(form.length, 1, 'ровно один POST формы');
        assert.equal(form[0].path, '/', 'логин ушёл на страницу с формой, а не на /analyse/free');
        assert.match(form[0].body, /user_login=1/, 'hidden-поле формы уехало вместе с логином');
    } finally { s.restore(); }
});

test('вход: обе CRM разом — куки копятся в одном jar', async () => {
    const s = stubCrmHost();
    try {
        await loginIntoJar(new Map(), 'ivanov', 'verno');
        assert.ok(s.seen.some(r => r.path === '/re/api.php' && r.method === 'POST'), 'новая');
        assert.ok(s.seen.some(r => r.path === '/' && r.method === 'POST'), 'прежняя');
    } finally { s.restore(); }
});

test('вход: неверный пароль — crm_auth_failed, а не «разметка сменилась»', async () => {
    const s = stubCrmHost();
    try {
        await assert.rejects(
            () => loginIntoJar(new Map(), 'ivanov', 'neverno'),
            (err) => {
                assert.equal(err.code, 'crm_auth_failed');
                assert.match(err.message, /не приняла логин или пароль/);
                return true;
            },
        );
    } finally { s.restore(); }
});

test('вход: новая CRM лежит — прежняя всё равно пускает', async () => {
    // Без этого пятисотка на /re/ уносила бы с собой «Клиент» и «Склад»,
    // которые живут на прежней CRM и к журналу записи отношения не имеют.
    const s = stubCrmHost({ apiStatus: 500 });
    try {
        await loginIntoJar(new Map(), 'ivanov', 'verno');
        assert.ok(s.seen.some(r => r.path === '/' && r.method === 'POST'),
            'логин ушёл в прежнюю CRM');
    } finally { s.restore(); }
});

test('вход: «пароль не подошёл» важнее «CRM не отвечает»', async () => {
    // Оба пути отказали по разным причинам. Человеку надо сказать про пароль:
    // на него он идёт менять пароль, а на «недоступна» — ждать.
    const s = stubCrmHost({ apiStatus: 503 });
    try {
        await assert.rejects(
            () => loginIntoJar(new Map(), 'ivanov', 'neverno'),
            (err) => {
                assert.equal(err.code, 'crm_auth_failed');
                assert.match(err.message, /не приняла логин или пароль/);
                return true;
            },
        );
    } finally { s.restore(); }
});
