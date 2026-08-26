// ─────────────────────────────────────────────────────────────────────────────
// Клиент внутренней CRM (crm.zamena-masla-spot.ru) с ПЕРСОНАЛЬНЫМИ сессиями:
// каждый работник логинится через сайт под своей учёткой CRM.
//
// Учётка CRM ПРИВЯЗАНА к аккаунту сайта: логин и (зашифрованный, см.
// secretBox.js) пароль запоминаются в crm_links, куки живой сессии — в
// crm_sessions. Дальше вход в CRM происходит сам: сайт видит, что живой
// сессии нет, и логинится теми же данными, которыми работник входил в
// прошлый раз. Пароль в CRM сменили — автовход получает crm_auth_failed,
// привязка стирается и панель просит ввести данные заново.
//
// Выход, наоборот, доведён до конца: сначала закрываем сессию на стороне CRM
// и ПРОВЕРЯЕМ, что она действительно закрыта, и только потом забываем куки
// (и, если просили, привязку). Сайт выходит из аккаунта лишь после этого
// подтверждения — см. routes/crm.js и frontend/src/profile.js.
// ВАЖНО: CRM гасит сессию аккаунта везде. Если под одной учёткой CRM работают
// несколько человек, выход одного разлогинит и остальных — так теперь и
// задумано (раньше сессию намеренно не закрывали).
//
// Запросы ко CRM идут через общую последовательную очередь, а каждый запрос
// вдобавок разнесён на 400 мс (как в проверенном SPOT-скрипте) — CRM не
// заваливаем.
//
// Env (всё необязательное): CRM_BASE_URL — база CRM; CRM_LOGIN_PATH /
// CRM_LOGIN_FIELD / CRM_PASSWORD_FIELD — переопределения, если форма логина
// CRM не распознаётся автоматически; CRM_LOGOUT_PATH — если ссылку выхода не
// удаётся найти в разметке; CRM_FETCH_TIMEOUT_MS — таймаут запроса;
// CRM_THROTTLE_MS — пауза между запросами (по умолчанию 400);
// CRM_LINK_SECRET — ключ шифрования пароля (без него привязки нет);
// CRM_TLS_FINGERPRINT / CRM_TLS_CA_FILE / CRM_TLS_INSECURE — что делать, если
// CRM отдаёт просроченный или самоподписанный сертификат (http/tlsTrust.js).
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../db/client.js';
import { parseAnalyseFree } from '../../../shared/crmAnalyse.js';
import { linkSecretConfigured, openSecret, sealSecret } from './secretBox.js';
import { crmAutoLoginPaused, pauseCrmAutoLogin, resumeCrmAutoLogin } from './autoLoginPause.js';
import { fetchWithRetry, describeNetworkError } from '../http/netRetry.js';
import { crmTlsTransport, isTlsCertError } from '../http/tlsTrust.js';

const BASE = (process.env.CRM_BASE_URL || 'https://crm.zamena-masla-spot.ru').replace(/\/$/, '');
const BASE_URL = new URL(`${BASE}/`);
const CRM_ORIGIN = BASE_URL.origin;
// Пауза между запросами к CRM. Читается на каждый запрос, а не один раз при
// импорте: так её можно занулить в тестах (CRM_THROTTLE_MS=0), не завязываясь
// на порядок импортов.
const throttleMs = () => {
    const raw = Number(process.env.CRM_THROTTLE_MS);
    return Number.isFinite(raw) && raw >= 0 ? raw : 400;
};
const FETCH_TIMEOUT_MS = Math.max(1_000, Number(process.env.CRM_FETCH_TIMEOUT_MS) || 15_000);

export class CrmError extends Error {
    constructor(code, message) {
        super(message || code);
        // crm_auth_required — нет живой сессии CRM (не залогинен / разлогинен);
        // crm_auth_failed — CRM не приняла логин/пароль;
        // crm_logout_failed — CRM не подтвердила, что сессия закрыта;
        // crm_unavailable — сеть/таймаут/5xx/сломанный redirect.
        this.code = code;
    }
}

// Любые относительные и абсолютные ссылки CRM приводим к URL через URL API,
// а не склеиваем строками. Второй аргумент нужен для корректного разрешения
// относительных Location/action относительно текущей страницы CRM.
export function resolveCrmUrl(path, base = BASE_URL) {
    const value = path instanceof URL ? path.href : String(path || '');
    const baseUrl = base instanceof URL ? base : new URL(String(base || ''), BASE_URL);
    const url = new URL(value, baseUrl);
    if (url.origin !== CRM_ORIGIN) {
        throw new CrmError(
            'crm_unavailable',
            `CRM перенаправила запрос на другой хост: ${url.origin}`,
        );
    }
    return url;
}

// ── Хранилище кук: БД + кэш в памяти ─────────────────────────────────────────

const jarCache = new Map(); // userId → Map(name → value) | null (точно нет)

async function loadJar(userId) {
    if (jarCache.has(userId)) return jarCache.get(userId);
    const r = await query('SELECT cookies FROM crm_sessions WHERE user_id = $1', [userId]);
    const jar = r.rows[0] ? new Map(Object.entries(r.rows[0].cookies || {})) : null;
    jarCache.set(userId, jar);
    return jar;
}

async function saveJar(userId, jar) {
    jarCache.set(userId, jar);
    await query(
        `INSERT INTO crm_sessions (user_id, cookies, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (user_id) DO UPDATE SET cookies = $2, updated_at = now()`,
        [userId, Object.fromEntries(jar)],
    );
}

async function dropJar(userId) {
    jarCache.set(userId, null);
    await query('DELETE FROM crm_sessions WHERE user_id = $1', [userId]);
}

// ── Привязка учётки CRM к аккаунту сайта ─────────────────────────────────────
// Логин лежит как есть, пароль — зашифрованным (secretBox.js). Нет ключа
// шифрования — привязки просто нет: сохранять пароль в открытом виде мы не
// станем даже ценой удобства.

// Пока миграция 021 не прогнана, таблицы нет — это не повод ронять панель:
// привязки просто не существует, вход руками работает как раньше.
let missingTableWarned = false;

async function linkQuery(sql, params) {
    try {
        return await query(sql, params);
    } catch (err) {
        if (err?.code !== '42P01') throw err; // undefined_table
        if (!missingTableWarned) {
            missingTableWarned = true;
            console.warn('нет таблицы crm_links — прогоните db/migrations/021_crm_link.sql');
        }
        return { rows: [] };
    }
}

async function saveLink(userId, login, password) {
    const sealed = sealSecret(password);
    if (!sealed) return false; // CRM_LINK_SECRET не задан — не запоминаем
    const r = await linkQuery(
        `INSERT INTO crm_links (user_id, crm_login, password_enc, linked_at, last_login_at)
         VALUES ($1, $2, $3, now(), now())
         ON CONFLICT (user_id) DO UPDATE
            SET crm_login = $2, password_enc = $3, linked_at = now(), last_login_at = now()
         RETURNING user_id`,
        [userId, login, sealed],
    );
    return r.rows.length > 0;
}

// { login, password } — или null, если привязки нет либо пароль не
// расшифровывается (сменили CRM_LINK_SECRET, битая строка): такую привязку
// сразу убираем, чтобы не притворяться, будто автовход возможен.
async function loadLink(userId) {
    if (!linkSecretConfigured()) return null;
    const r = await linkQuery('SELECT crm_login, password_enc FROM crm_links WHERE user_id = $1', [userId]);
    const row = r.rows[0];
    if (!row) return null;
    const password = openSecret(row.password_enc);
    if (!password) {
        await dropLink(userId);
        return null;
    }
    return { login: row.crm_login, password };
}

async function hasLink(userId) {
    if (!linkSecretConfigured()) return false;
    const r = await linkQuery('SELECT 1 FROM crm_links WHERE user_id = $1', [userId]);
    return r.rows.length > 0;
}

async function dropLink(userId) {
    await linkQuery('DELETE FROM crm_links WHERE user_id = $1', [userId]);
}

async function touchLink(userId) {
    await linkQuery('UPDATE crm_links SET last_login_at = now() WHERE user_id = $1', [userId]);
}

// Логин CRM, к которому привязан аккаунт (панель показывает его в подсказке).
export async function crmLinkedLogin(userId) {
    if (!linkSecretConfigured()) return null;
    const r = await linkQuery('SELECT crm_login FROM crm_links WHERE user_id = $1', [userId]);
    return r.rows[0]?.crm_login || null;
}

export { linkSecretConfigured };

// ── HTTP со сбором Set-Cookie в переданный jar ───────────────────────────────

function storeSetCookies(res, jar) {
    const list = typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    for (const line of list) {
        const [pair] = line.split(';');
        const eq = pair.indexOf('=');
        if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
}

// Текст «CRM недоступна» для панели. Сертификат CRM выделяем отдельно: это
// единственный вид отказа, который чинится НЕ на сайте, и оператор должен
// понимать, что повторять бессмысленно и звать надо администратора CRM.
// Подсказку про CRM_TLS_* пишем в лог сервера, а не в панель: работнику за
// стойкой имена переменных окружения ничего не говорят.
let certAdviceLogged = false;
function networkMessage(target, err) {
    const text = describeNetworkError(err, FETCH_TIMEOUT_MS);
    if (!isTlsCertError(err)) return `CRM недоступна (${target.host}): ${text}`;
    if (!certAdviceLogged) {
        certAdviceLogged = true;
        console.warn(
            `сертификат ${target.host} не проходит проверку: ${text}.`
            + ' Починить его на стороне CRM или разрешить на сервере:'
            + ' CRM_TLS_FINGERPRINT (отпечаток печатает backend/scripts/crm-tls-info.js),'
            + ' CRM_TLS_CA_FILE, в крайнем случае CRM_TLS_INSECURE=1.',
        );
    }
    return `CRM недоступна (${target.host}): ${text}.`
        + ' Это сертификат самой CRM — сайт тут ни при чём, нужен администратор CRM.';
}

// CRM, как и админка записей, закрывает keep-alive быстро: сокет из пула может
// умереть ровно между «взяли из пула» и «отправили запрос», и fetch падает без
// ответа. Читающие запросы в этом случае повторяем — см. http/netRetry.js.
async function rawFetch(path, jar, opts = {}) {
    const target = resolveCrmUrl(path);
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    let res;
    try {
        // null — сертификат CRM проверяется как обычно; иначе ходим отдельным
        // dispatcher'ом и парным ему fetch (см. http/tlsTrust.js).
        const tls = await crmTlsTransport();
        res = await fetchWithRetry(target, {
            redirect: 'manual',
            ...opts,
            headers: {
                'User-Agent': 'Mozilla/5.0 (site-crm-proxy)',
                ...(cookie ? { Cookie: cookie } : {}),
                ...(opts.headers || {}),
            },
            ...(tls ? { dispatcher: tls.dispatcher } : {}),
        }, {
            timeoutMs: FETCH_TIMEOUT_MS,
            // Троттлинг на КАЖДЫЙ запрос, а не на операцию: логин и выход
            // состоят из нескольких запросов подряд, и разносить их тоже нужно.
            // Повтор — такой же запрос, поэтому pace() идёт крючком в цикл.
            beforeAttempt: pace,
            fetchImpl: tls?.fetchImpl,
        });
    } catch (err) {
        throw new CrmError('crm_unavailable', networkMessage(target, err));
    }

    storeSetCookies(res, jar);
    if (res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500) {
        throw new CrmError('crm_unavailable', `CRM ответила HTTP ${res.status}`);
    }
    return res;
}

async function followRedirects(res, jar, hops = 5) {
    const maxHops = hops;
    while (hops-- > 0 && res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) break;
        res = await rawFetch(resolveCrmUrl(loc, res.url || BASE_URL), jar);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        throw new CrmError('crm_unavailable', `CRM зациклила перенаправления (>${maxHops})`);
    }
    return res;
}

// ── Форма логина ─────────────────────────────────────────────────────────────

// Разбор формы логина из HTML: action + имена полей логина/пароля + hidden-поля
// (CSRF и т.п.). Именованные submit-кнопки тоже попадают в hidden — браузер
// отправляет их вместе с формой, и часть бэкендов (например админка записей
// ZMS: <button name="submit">) без этого поля логин не принимает. Форма CRM
// заранее неизвестна, поэтому парсер общий, а поля можно переопределить
// через env.
export function parseLoginForm(html) {
    const src = String(html || '');
    const formRe = /<form\b[^>]*>[\s\S]*?<\/form>/gi;
    let form;
    let f;
    while ((f = formRe.exec(src))) {
        if (/type=["']?password/i.test(f[0])) { form = f[0]; break; }
    }
    if (!form) return null;

    const action = (form.match(/<form\b[^>]*\baction=["']([^"']*)["']/i) || [])[1] || '';
    const hidden = {};
    let passwordField = null;
    let loginField = null;
    const inputRe = /<input\b[^>]*>/gi;
    let inp;
    while ((inp = inputRe.exec(form))) {
        const tag = inp[0];
        const type = ((tag.match(/\btype=["']?([\w-]+)/i) || [])[1] || 'text').toLowerCase();
        const name = (tag.match(/\bname=["']([^"']+)["']/i) || [])[1];
        if (!name) continue;
        const value = (tag.match(/\bvalue=["']([^"']*)["']/i) || [])[1] || '';
        if (type === 'password') passwordField = passwordField || name;
        else if (type === 'hidden' || type === 'submit') hidden[name] = value;
        else if ((type === 'text' || type === 'email' || type === 'tel') && !loginField) loginField = name;
    }
    const buttonRe = /<button\b[^>]*>/gi;
    let btn;
    while ((btn = buttonRe.exec(form))) {
        const tag = btn[0];
        const type = ((tag.match(/\btype=["']?([\w-]+)/i) || [])[1] || 'submit').toLowerCase();
        const name = (tag.match(/\bname=["']([^"']+)["']/i) || [])[1];
        if (type !== 'submit' || !name) continue;
        hidden[name] = (tag.match(/\bvalue=["']([^"']*)["']/i) || [])[1] || '';
    }
    if (!passwordField) return null;
    return { action, loginField, passwordField, hidden };
}

// ── Вход / выход / запросы ───────────────────────────────────────────────────

// Один вход в CRM в переданный jar. Без очереди и без записи в базу — это
// кирпич, из которого собраны и ручной вход, и автовход по привязке.
async function loginIntoJar(jar, login, password) {
    const entryPath = process.env.CRM_LOGIN_PATH || '/analyse/free';
    const res = await followRedirects(await rawFetch(entryPath, jar), jar);
    const html = await res.text();
    const form = parseLoginForm(html);

    const loginField = process.env.CRM_LOGIN_FIELD || form?.loginField;
    const passwordField = process.env.CRM_PASSWORD_FIELD || form?.passwordField;
    if (!loginField || !passwordField) {
        // формы нет — возможно, эта пара кук уже залогинена (маловероятно
        // для пустого jar) или CRM сменила разметку
        throw new CrmError('crm_auth_failed', 'не удалось распознать форму логина CRM');
    }
    const actionPath = form?.action
        ? resolveCrmUrl(form.action, res.url || BASE_URL)
        : entryPath;

    const body = new URLSearchParams({
        ...(form?.hidden || {}),
        [loginField]: login,
        [passwordField]: password,
    });
    const post = await rawFetch(actionPath, jar, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });
    if (post.status >= 400) {
        throw new CrmError('crm_auth_failed', `CRM ответила ${post.status} на логин`);
    }
    const check = await followRedirects(await rawFetch('/analyse/free', jar), jar);
    const checkHtml = check.status >= 300 ? '' : await check.text();
    if (!checkHtml || parseAnalyseFree(checkHtml).loginPage) {
        throw new CrmError('crm_auth_failed', 'CRM не приняла логин или пароль');
    }
}

// Ручной вход из панели: логинимся и, если есть чем шифровать пароль,
// запоминаем учётку за аккаунтом сайта — со следующего раза сайт войдёт сам.
export async function crmLogin(userId, login, password, { remember = true } = {}) {
    const jar = new Map();
    resumeCrmAutoLogin(userId); // вход руками отменяет паузу после выхода
    await enqueue(() => loginIntoJar(jar, login, password));
    await saveJar(userId, jar);
    const linked = remember ? await saveLink(userId, login, password) : false;
    if (!remember) await dropLink(userId);
    return { linked };
}

// Живая сессия CRM для этого работника: есть куки — берём их, нет — входим
// сами по привязке. Возвращаем не только факт входа, но и причину отказа:
// панели надо показать разное на «привязки нет», «пароль больше не подходит»
// и «CRM не отвечает».
export async function crmEnsureSession(userId) {
    const jar = await loadJar(userId);
    if (jar && jar.size) return { loggedIn: true, linked: await hasLink(userId), auto: false };

    const link = await loadLink(userId);
    if (!link) return { loggedIn: false, linked: false, auto: false };
    // Идёт выход — автовходом сессию CRM не воскрешаем.
    if (crmAutoLoginPaused(userId)) return { loggedIn: false, linked: true, auto: false };

    const fresh = new Map();
    try {
        await enqueue(() => loginIntoJar(fresh, link.login, link.password));
    } catch (err) {
        if (err instanceof CrmError && err.code === 'crm_auth_failed') {
            // Пароль в CRM сменили (или учётку закрыли) — привязка мертва.
            await dropLink(userId);
            return { loggedIn: false, linked: false, auto: false, linkRejected: true };
        }
        // CRM недоступна — привязку не рвём, попробуем в следующий раз.
        return {
            loggedIn: false,
            linked: true,
            auto: false,
            unavailable: err instanceof CrmError ? err.message : 'CRM недоступна',
        };
    }
    await saveJar(userId, fresh);
    await touchLink(userId);
    return { loggedIn: true, linked: true, auto: true };
}

// Вход заново посреди уже начатой операции (сессию закрыли, пока мы работали).
// Без enqueue: вызывается ИЗНУТРИ enqueue-задачи, см. комментарий у очереди.
async function reloginIntoJar(userId, jar) {
    if (crmAutoLoginPaused(userId)) return false; // идёт выход
    const link = await loadLink(userId);
    if (!link) return false;
    jar.clear();
    try {
        await loginIntoJar(jar, link.login, link.password);
    } catch (err) {
        if (err instanceof CrmError && err.code === 'crm_auth_failed') await dropLink(userId);
        return false;
    }
    await saveJar(userId, jar);
    await touchLink(userId);
    return true;
}

// ── Выход из CRM ─────────────────────────────────────────────────────────────
// Пути выхода на случай, если ссылку не удалось найти в разметке страницы.
const LOGOUT_FALLBACK_PATHS = ['/logout', '/site/logout', '/auth/logout', '/user/logout'];
const LOGOUT_HINT_RE = /logout|log-?out|sign-?out|выход|выйти/i;

// Ссылка (или форма) выхода на странице CRM. Разметка CRM заранее неизвестна,
// поэтому ищем по href/тексту, а метод берём из data-method (Yii2 отправляет
// выход POST-ом). Экспортируем для теста.
export function findLogoutLink(html) {
    const src = String(html || '');
    const anchorRe = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
    let m;
    while ((m = anchorRe.exec(src))) {
        const tag = m[0];
        const href = (tag.match(/\bhref=["']([^"']+)["']/i) || [])[1];
        if (!href || /^(#|javascript:|mailto:)/i.test(href.trim())) continue;
        const text = tag.replace(/<[^>]*>/g, ' ');
        if (!LOGOUT_HINT_RE.test(href) && !LOGOUT_HINT_RE.test(text)) continue;
        const method = (tag.match(/\bdata-method=["']([^"']+)["']/i) || [])[1] || 'GET';
        return { path: href.trim(), method: /post/i.test(method) ? 'POST' : 'GET' };
    }
    const formRe = /<form\b[^>]*>/gi;
    while ((m = formRe.exec(src))) {
        const action = (m[0].match(/\baction=["']([^"']+)["']/i) || [])[1];
        if (action && LOGOUT_HINT_RE.test(action)) return { path: action.trim(), method: 'POST' };
    }
    return null;
}

// Сессия действительно закрыта? Единственная надёжная проверка — попросить
// защищённую страницу теми же куками: пустила → сессия ещё жива.
async function sessionClosed(jar) {
    const res = await followRedirects(await rawFetch('/analyse/free', jar), jar);
    if (res.status >= 300) return true; // не пустила даже после редиректов
    const html = await res.text();
    return !html || parseAnalyseFree(html).loginPage;
}

// Закрываем сессию на стороне CRM и проверяем результат. true — закрыта
// (это и подтверждение для выхода из аккаунта сайта), false — CRM всё ещё
// пускает по этим кукам. Работает только с jar, без базы — поэтому его можно
// проверить тестом на подменённом fetch.
export async function closeCrmSession(jar) {
    const candidates = [];
    const explicit = process.env.CRM_LOGOUT_PATH;
    if (explicit) {
        candidates.push({ path: explicit, method: 'GET' });
    } else {
        const page = await followRedirects(await rawFetch('/analyse/free', jar), jar);
        const html = page.status >= 300 ? '' : await page.text();
        // CRM уже сама закрыла сессию — закрывать нечего, это успех.
        if (!html || parseAnalyseFree(html).loginPage) return true;
        const found = findLogoutLink(html);
        if (found) {
            candidates.push({
                path: resolveCrmUrl(found.path, page.url || BASE_URL),
                method: found.method,
            });
        }
    }
    for (const path of LOGOUT_FALLBACK_PATHS) candidates.push({ path, method: 'GET' });

    for (const c of candidates) {
        const opts = c.method === 'POST'
            ? { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '' }
            : {};
        // 404 на угаданном пути — не повод падать: пробуем следующий. А вот
        // «CRM недоступна» пробрасываем: подтвердить закрытие мы не можем.
        await followRedirects(await rawFetch(c.path, jar, opts), jar);
        if (await sessionClosed(jar)) return true;
    }
    return false;
}

// Выход: сначала закрываем сессию в самой CRM и убеждаемся, что она закрыта,
// и только потом забываем куки. Не подтвердилось — бросаем crm_logout_failed,
// и сайт НЕ выходит из аккаунта (frontend/src/profile.js).
//
// unlink: true — заодно снять привязку учётки (кнопка «Выйти» в панели CRM);
// false — привязку сохранить, чтобы следующий вход на сайт снова поднял
// сессию CRM сам (выход из аккаунта сайта).
export async function crmLogout(userId, { unlink = false } = {}) {
    const jar = await loadJar(userId);
    const hadSession = Boolean(jar && jar.size);

    // Выключаем автовход СРАЗУ, до закрытия: пока идёт выход, второй браузер
    // того же человека не должен поднять сессию CRM заново.
    pauseCrmAutoLogin(userId);
    if (hadSession) {
        let closed;
        try {
            closed = await enqueue(() => closeCrmSession(jar));
        } catch (err) {
            // Выход не состоялся — человек остаётся работать, автовход нужен.
            resumeCrmAutoLogin(userId);
            throw err;
        }
        if (!closed) {
            resumeCrmAutoLogin(userId);
            throw new CrmError(
                'crm_logout_failed',
                'CRM не подтвердила закрытие сессии — попробуйте ещё раз',
            );
        }
    }
    await dropJar(userId);
    if (unlink) await dropLink(userId);
    return { closed: hadSession, unlinked: unlink };
}

// GET страницы CRM под сессией работника. Сессии нет — поднимаем по привязке;
// CRM отдала страницу логина (сессию завершили извне) — один раз входим заново
// и повторяем запрос, и только потом просим войти руками.
export async function crmGetHtml(userId, path) {
    const ready = await crmEnsureSession(userId);
    if (!ready.loggedIn) {
        // Привязка есть, но CRM не ответила — это не «войдите заново», а
        // «CRM недоступна»: панель не должна зря просить пароль.
        if (ready.unavailable) throw new CrmError('crm_unavailable', ready.unavailable);
        throw new CrmError('crm_auth_required', 'нет сессии CRM — войдите');
    }
    const jar = await loadJar(userId);
    return enqueue(async () => {
        let html = await fetchPage(jar, path);
        if (html) return html;
        if (await reloginIntoJar(userId, jar)) {
            html = await fetchPage(jar, path);
            if (html) return html;
        }
        await dropJar(userId);
        throw new CrmError('crm_auth_required', 'сессия CRM завершена — войдите заново');
    });
}

// Страница или '' — если CRM вместо неё показала логин (сессии больше нет).
//
// «Это логин» узнаётся ПО САМОЙ ФОРМЕ ЛОГИНА (parseLoginForm), и это важно:
// раньше тут стоял parseAnalyseFree(...).loginPage, а он считает логином всё,
// где нет ни фильтра станций, ни таблицы товаров. Приметы у него от
// /analyse/free, ради которой прокси и писался, — но crmGetHtml ходит и на
// другие страницы CRM, а на /dial_clients/ (поиск клиента) нет ни того, ни
// другого. Живая сессия объявлялась мёртвой, куки стирались (dropJar), и поиск
// клиента отвечал «войдите в CRM» — в том числе сразу после успешного входа,
// потому что следующий же запрос повторял тот же вывод.
export async function fetchPage(jar, path) {
    const res = await followRedirects(await rawFetch(path, jar), jar);
    const html = res.status >= 300 ? '' : await res.text();
    return !html || parseLoginForm(html) ? '' : html;
}

// Последовательная очередь + троттлинг: одна на процесс, чтобы N работников
// суммарно не превращались в шквал запросов к CRM. Очередь держит операции
// (логин, страница, выход) неперекрывающимися, pace() — разносит сами запросы.
//
// ВАЖНО: внутри enqueue-задачи нельзя вызывать enqueue снова — задача ждала бы
// сама себя. Поэтому «войти заново по привязке» посреди запроса делает
// reloginIntoJar, который дёргает loginIntoJar напрямую, без очереди.
let queue = Promise.resolve();
let lastRequestAt = 0;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function pace() {
    const wait = lastRequestAt + throttleMs() - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
}

function enqueue(fn) {
    const run = queue.then(() => fn());
    queue = run.catch(() => {});
    return run;
}

export function buildAnalyseFreePath(stationId, searchQuery) {
    const station = stationId ? `stations%5B%5D=${encodeURIComponent(stationId)}&` : '';
    return `/analyse/free?${station}stationsColumns=&withCatalogItems=${encodeURIComponent(searchQuery)}`
        + '&selectionPeriod=&orderByField=price&orderByOrder=ASC';
}
