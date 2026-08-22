// ─────────────────────────────────────────────────────────────────────────────
// Клиент Битрикса24 (spotexpress.bitrix24.ru) с ПЕРСОНАЛЬНЫМИ сессиями.
//
// Зачем не REST: портал облачный, прав разработчика у рядового работника нет,
// вебхук и локальное приложение заводить некому. Сам REST на портале включён и
// работает (проверено токеном стороннего приложения), но своего токена нам не
// получить, а на чужом строить нельзя — снесут приложение, встанем и мы.
// Поэтому ходим теми же служебными запросами, что и браузер оператора. Разбор
// протокола и все его ловушки — docs/BITRIX.md, читать ОБЯЗАТЕЛЬНО перед
// правками этого файла.
//
// Устройство повторяет backend/src/crm/client.js: учётка Битрикса привязана к
// аккаунту сайта, пароль зашифрован (crm/secretBox.js, ключ CRM_LINK_SECRET),
// куки живой сессии — в bitrix_sessions, автовход при потере сессии, пауза
// автовхода после неудачи. Отличий от CRM три, и все три вынужденные:
//
// 1. ДВА хоста. Портал не имеет своей формы входа и отправляет на
//    Bitrix24.Network (auth2.bitrix24.net), поэтому в белом списке два origin.
// 2. CSRF. Каждому запросу нужен sessid — в адресе, в теле и заголовком.
//    Живёт вместе с сессией, поэтому лежит рядом с куками.
// 3. Куки портал переписывает почти на каждый ответ (BITRIX_SM_kernel_0), так
//    что jar сохраняется после КАЖДОГО запроса, а не только после логина.
//
// Env: BITRIX_BASE_URL, BITRIX_NET_URL, BITRIX_FETCH_TIMEOUT_MS,
//      BITRIX_THROTTLE_MS, CRM_LINK_SECRET (общий с CRM).
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../db/client.js';
import { linkSecretConfigured, openSecret, sealSecret } from '../crm/secretBox.js';
import { fetchWithRetry, describeNetworkError } from '../http/netRetry.js';
import { parseFrameCacheVars, compositeHeaders, dynamicUrl, dynamicHtml } from './composite.js';

const BASE = (process.env.BITRIX_BASE_URL || 'https://spotexpress.bitrix24.ru').replace(/\/$/, '');
const BASE_URL = new URL(`${BASE}/`);
const NET = (process.env.BITRIX_NET_URL || 'https://auth2.bitrix24.net').replace(/\/$/, '');
const NET_URL = new URL(`${NET}/`);
const ALLOWED_ORIGINS = new Set([BASE_URL.origin, NET_URL.origin]);

const FETCH_TIMEOUT_MS = Math.max(1_000, Number(process.env.BITRIX_FETCH_TIMEOUT_MS) || 20_000);

// Пауза между запросами. Читается на каждый запрос (а не при импорте), чтобы
// тесты могли её занулить, не завязываясь на порядок импортов.
const throttleMs = () => {
    const raw = Number(process.env.BITRIX_THROTTLE_MS);
    return Number.isFinite(raw) && raw >= 0 ? raw : 400;
};

export class BitrixError extends Error {
    constructor(code, message) {
        super(message || code);
        // bitrix_auth_required — нет живой сессии и нечем войти;
        // bitrix_auth_failed  — портал не принял логин/пароль;
        // bitrix_captcha      — портал требует капчу (автовход дальше бесполезен);
        // bitrix_2fa_required — включено подтверждение по телефону;
        // bitrix_unavailable  — сеть, таймаут, 5xx, зацикленный редирект.
        this.code = code;
    }
}

function resolveUrl(path, base = BASE_URL) {
    const value = path instanceof URL ? path.href : String(path || '');
    const baseUrl = base instanceof URL ? base : new URL(String(base || ''), BASE_URL);
    const url = new URL(value, baseUrl);
    if (!ALLOWED_ORIGINS.has(url.origin)) {
        throw new BitrixError('bitrix_unavailable', `Битрикс увёл запрос на чужой хост: ${url.origin}`);
    }
    return url;
}

// ── Очередь и троттлинг ──────────────────────────────────────────────────────
// Запросы идут строго по одному и разнесены паузой: портал общий на всю
// компанию, и заваливать его пачкой параллельных запросов нельзя.

let chain = Promise.resolve();
let lastAt = 0;

function pace() {
    const run = async () => {
        const wait = lastAt + throttleMs() - Date.now();
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        lastAt = Date.now();
    };
    chain = chain.then(run, run);
    return chain;
}

// ── Хранилище кук и CSRF: БД + кэш в памяти ──────────────────────────────────

// Пока миграция 036 не прогнана, таблиц нет — это не повод ронять весь сайт:
// панель Битрикса просто не работает, остальное живёт.
let missingTableWarned = false;

async function tolerantQuery(sql, params) {
    try {
        return await query(sql, params);
    } catch (err) {
        if (err?.code !== '42P01') throw err; // undefined_table
        if (!missingTableWarned) {
            missingTableWarned = true;
            console.warn('нет таблиц Битрикса — прогоните db/migrations/036_bitrix.sql');
        }
        return { rows: [] };
    }
}

const jarCache = new Map(); // userId → { jar: Map, sessid: string|null } | null

async function loadState(userId) {
    if (jarCache.has(userId)) return jarCache.get(userId);
    const r = await tolerantQuery(
        'SELECT cookies, sessid FROM bitrix_sessions WHERE user_id = $1', [userId],
    );
    const row = r.rows[0];
    const state = row
        ? { jar: new Map(Object.entries(row.cookies || {})), sessid: row.sessid || null }
        : null;
    jarCache.set(userId, state);
    return state;
}

async function saveState(userId, state) {
    jarCache.set(userId, state);
    await tolerantQuery(
        `INSERT INTO bitrix_sessions (user_id, cookies, sessid, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id) DO UPDATE
            SET cookies = $2, sessid = $3, updated_at = now()`,
        [userId, Object.fromEntries(state.jar), state.sessid],
    );
}

async function dropState(userId) {
    jarCache.set(userId, null);
    await tolerantQuery('DELETE FROM bitrix_sessions WHERE user_id = $1', [userId]);
}

// ── Привязка учётки Битрикса к аккаунту сайта ────────────────────────────────

async function saveLink(userId, login, password) {
    const sealed = sealSecret(password);
    if (!sealed) return false; // нет CRM_LINK_SECRET — пароли не запоминаем
    const r = await tolerantQuery(
        `INSERT INTO bitrix_links (user_id, bitrix_login, password_enc, linked_at, last_login_at)
         VALUES ($1, $2, $3, now(), now())
         ON CONFLICT (user_id) DO UPDATE
            SET bitrix_login = $2, password_enc = $3, linked_at = now(), last_login_at = now()
         RETURNING user_id`,
        [userId, login, sealed],
    );
    return r.rows.length > 0;
}

async function loadLink(userId) {
    if (!linkSecretConfigured()) return null;
    const r = await tolerantQuery(
        'SELECT bitrix_login, password_enc FROM bitrix_links WHERE user_id = $1', [userId],
    );
    const row = r.rows[0];
    if (!row) return null;
    const password = openSecret(row.password_enc);
    if (!password) {
        // Ключ шифрования сменили или строка побилась: делать вид, что автовход
        // возможен, нельзя — привязку убираем и просим войти заново.
        await dropLink(userId);
        return null;
    }
    return { login: row.bitrix_login, password };
}

async function dropLink(userId) {
    await tolerantQuery('DELETE FROM bitrix_links WHERE user_id = $1', [userId]);
}

// Обратный поиск: по учётке Битрикса найти аккаунт сайта. Нужен датчику —
// он живёт на вкладке Битрикса, где сессии сайта нет и быть не может, зато
// точно известно, под кем работают в самом Битриксе.
export async function userByBitrixLogin(login) {
    const value = String(login ?? '').trim();
    if (!value) return null;
    const r = await tolerantQuery(
        'SELECT user_id FROM bitrix_links WHERE lower(bitrix_login) = lower($1) LIMIT 1', [value],
    );
    return r.rows[0]?.user_id || null;
}

export async function bitrixLinkedLogin(userId) {
    if (!linkSecretConfigured()) return null;
    const r = await tolerantQuery('SELECT bitrix_login FROM bitrix_links WHERE user_id = $1', [userId]);
    return r.rows[0]?.bitrix_login || null;
}

export { linkSecretConfigured };

// ── HTTP ─────────────────────────────────────────────────────────────────────

function storeSetCookies(res, jar) {
    const list = typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    for (const line of list) {
        const [pair] = line.split(';');
        const eq = pair.indexOf('=');
        if (eq <= 0) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        // Портал гасит куку, присылая пустое значение: это выход, а не мусор.
        if (value === '' || value === 'deleted') jar.delete(name);
        else jar.set(name, value);
    }
}

// Куки шлём только тому хосту, от которого их получили: портал и
// Bitrix24.Network — разные origin, и мешать их сессии нельзя.
const NET_COOKIE_PREFIX = 'net:';

function cookieHeader(jar, url) {
    const forNet = url.origin === NET_URL.origin;
    const parts = [];
    for (const [name, value] of jar) {
        const isNet = name.startsWith(NET_COOKIE_PREFIX);
        if (isNet !== forNet) continue;
        parts.push(`${isNet ? name.slice(NET_COOKIE_PREFIX.length) : name}=${value}`);
    }
    return parts.join('; ');
}

function rememberCookies(res, jar, url) {
    if (url.origin !== NET_URL.origin) {
        storeSetCookies(res, jar);
        return;
    }
    const tmp = new Map();
    storeSetCookies(res, tmp);
    for (const [name, value] of tmp) jar.set(NET_COOKIE_PREFIX + name, value);
}

async function rawFetch(path, jar, opts = {}, base = BASE_URL) {
    const target = resolveUrl(path, base);
    const cookie = cookieHeader(jar, target);
    let res;
    try {
        res = await fetchWithRetry(target, {
            redirect: 'manual',
            ...opts,
            headers: {
                // Портал смотрит на User-Agent: с пустым или совсем нетипичным
                // он охотнее считает сессию подозрительной.
                'User-Agent': 'Mozilla/5.0 (site-bitrix-proxy)',
                ...(cookie ? { Cookie: cookie } : {}),
                ...(opts.headers || {}),
            },
        }, {
            // Троттлинг на КАЖДЫЙ запрос, а не на операцию: вход состоит из
            // нескольких запросов подряд, разносить надо и их.
            timeoutMs: FETCH_TIMEOUT_MS,
            beforeAttempt: pace,
        });
    } catch (err) {
        throw new BitrixError(
            'bitrix_unavailable',
            `Битрикс недоступен (${target.host}): ${describeNetworkError(err, FETCH_TIMEOUT_MS)}`,
        );
    }

    rememberCookies(res, jar, target);
    if (res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500) {
        throw new BitrixError('bitrix_unavailable', `Битрикс ответил HTTP ${res.status}`);
    }
    return res;
}

async function followRedirects(res, jar, hops = 8) {
    const maxHops = hops;
    while (hops-- > 0 && res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) break;
        const from = new URL(res.url || BASE_URL.href);
        res = await rawFetch(resolveUrl(loc, from), jar, {}, from);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        throw new BitrixError('bitrix_unavailable', `Битрикс зациклил перенаправления (>${maxHops})`);
    }
    return res;
}

// ── CSRF ─────────────────────────────────────────────────────────────────────

// sessid лежит в разметке любой страницы портала, но в разном виде: в конфиге
// ядра, в старой переменной, а на динамических блоках — вообще без кавычек,
// внутри адреса какого-нибудь lazyload.ajax.php?sessid=… Последний случай
// нашёлся на живом ответе портала: без него страница выглядела как «сессии
// нет», хотя сессия была.
export function extractSessid(html) {
    const text = String(html || '');
    const m = text.match(/['"]bitrix_sessid['"]\s*:\s*['"]([a-f0-9]{16,64})['"]/i)
        || text.match(/bx_sessid\s*=\s*['"]([a-f0-9]{16,64})['"]/i)
        || text.match(/sessid['"]?\s*[:=]\s*['"]([a-f0-9]{32})['"]/i)
        || text.match(/[?&]sessid=([a-f0-9]{32})\b/i);
    return m ? m[1] : null;
}

// Страница портала целиком, с учётом композитного кэша (composite.js): на
// первый GET приходит общий для всех каркас, и настоящее содержимое надо
// спросить вторым запросом. Отсюда же берётся ответ на вопрос «жива ли
// сессия»: каркас отдают кому угодно, а вот sessid есть только у вошедшего.
async function loadPage(state, path) {
    const first = await followRedirects(await rawFetch(path, state.jar), state.jar);
    const url = new URL(first.url || BASE_URL.href);
    if (url.origin !== BASE_URL.origin) return { html: '', url, authed: false };

    const shell = await first.text();
    const vars = parseFrameCacheVars(shell);
    let html = shell;

    if (vars) {
        const res = await rawFetch(dynamicUrl(path), state.jar, {
            headers: compositeHeaders(vars, { referer: BASE_URL.href }),
        });
        const text = await res.text();
        let body = text;
        try {
            body = dynamicHtml(JSON.parse(text));
        } catch {
            // Портал ответил не JSON — это либо страница входа, либо поломка.
            // Разбираем как разметку: sessid в ней всё равно не найдётся, и
            // вызывающий получит честное «сессии нет».
        }
        html = `${shell}\n${body}`;
    }

    const sessid = extractSessid(html);
    if (sessid) state.sessid = sessid;
    return { html, url, authed: Boolean(sessid) };
}

// Живая ли сессия. Проверяем списком лидов, а не главной: главная зависит от
// шаблона портала, а список лидов — та самая часть, ради которой мы и ходим.
async function probeSession(state) {
    const { authed } = await loadPage(state, '/crm/lead/list/');
    return authed;
}

// ── Вход ─────────────────────────────────────────────────────────────────────
// Портал перекидывает на Bitrix24.Network, где вход идёт двумя ajax-ступенями:
// verifyLogin (есть ли такой аккаунт) → check (пароль). После второй ступени
// возвращаемся на портал по redirect_uri, и уже портал выдаёт свои куки.
//
// ВНИМАНИЕ: имена ступеней сняты с бандла формы (docs/BITRIX.md), а имена ПОЛЕЙ
// в теле — предположение по тем же бандлам. Первый живой вход их уточнит;
// поэтому неизвестный ответ считается ОТКАЗОМ, а не успехом.

const NET_AJAX = '/bitrix/services/main/ajax.php';

async function netAction(action, payload, jar, sessid) {
    const res = await rawFetch(`${NET_AJAX}?action=${encodeURIComponent(action)}`, jar, {
        method: 'POST',
        headers: {
            'Bx-ajax': 'true',
            'Content-Type': 'application/json',
            // У Bitrix24.Network СВОЙ CSRF-токен, к порталу отношения не
            // имеющий: он лежит в разметке страницы входа. Без него ручка
            // отвечает «Invalid csrf token» — и это, кстати, хороший признак,
            // что до неё вообще достучались.
            ...(sessid ? { 'X-Bitrix-Csrf-Token': sessid } : {}),
            'X-Bitrix-Site-Id': 's1',
        },
        body: JSON.stringify({ ...payload, ...(sessid ? { sessid } : {}) }),
    }, NET_URL);
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        throw new BitrixError('bitrix_unavailable', `Bitrix24.Network ответил не JSON (HTTP ${res.status})`);
    }
}

// Ошибки входа разбираем по коду, а не по тексту: тексты локализованы и
// меняются, а коды взяты из самого сценария входа.
function loginFailure(answer) {
    const errors = [
        ...(Array.isArray(answer?.errors) ? answer.errors : []),
        ...(Array.isArray(answer?.data?.errors) ? answer.data.errors : []),
    ];
    const codes = errors.map(e => String(e?.code || '')).join(' ');
    const texts = errors.map(e => String(e?.message || '')).join(' ');

    // «Неверный токен» — не про пароль, а про то, что мы неправильно
    // разговариваем с формой входа. Считать это отказом авторизации нельзя:
    // на автовходе такой ответ СТЁР БЫ привязку учётки, то есть за нашу ошибку
    // расплатился бы работник, которому пришлось бы вводить пароль заново.
    if (/csrf/i.test(codes) || /csrf/i.test(texts)) {
        return new BitrixError(
            'bitrix_unavailable',
            'Bitrix24.Network не принял токен формы входа — форма изменилась, нужна правка на сайте',
        );
    }

    if (/CAPTCHA/i.test(codes)) {
        return new BitrixError(
            'bitrix_captcha',
            'Битрикс просит капчу — войдите в него браузером вручную, потом повторите привязку',
        );
    }
    if (/OTP|PHONE|TWO_FA/i.test(codes)) {
        return new BitrixError(
            'bitrix_2fa_required',
            'у учётки включено подтверждение по телефону — сайт войти не сможет',
        );
    }
    if (errors.length) {
        return new BitrixError('bitrix_auth_failed', errors[0]?.message || 'Битрикс не принял логин или пароль');
    }
    return null;
}

async function performLogin(login, password) {
    const jar = new Map();

    // 1. Идём на портал и доезжаем до формы Bitrix24.Network: по дороге
    //    забираем и куки, и параметры OAuth (client_id, state, redirect_uri).
    const entry = await followRedirects(await rawFetch('/', jar), jar);
    const authUrl = new URL(entry.url || NET_URL.href);
    const entryHtml = await entry.text();
    if (authUrl.origin === BASE_URL.origin) {
        // Портал не стал спрашивать вход — сессия уже есть, доделывать нечего.
        return { jar, sessid: extractSessid(entryHtml) };
    }

    const params = Object.fromEntries(authUrl.searchParams);
    const netSessid = extractSessid(entryHtml);
    if (!netSessid) {
        throw new BitrixError(
            'bitrix_unavailable',
            'на странице входа Bitrix24.Network нет токена — форма входа изменилась',
        );
    }

    // 2. Есть ли такой аккаунт и пускают ли его паролем.
    const verify = await netAction('b24network.authorize.verifyLogin', { login, ...params }, jar, netSessid);
    const verifyFail = loginFailure(verify);
    if (verifyFail) throw verifyFail;

    // 3. Пароль. Он может быть каким угодно, включая кириллицу: тело уезжает
    //    JSON'ом в UTF-8, и перекодировать его по дороге некому.
    const check = await netAction('b24network.authorize.check', { login, password, ...params }, jar, netSessid);
    const checkFail = loginFailure(check);
    if (checkFail) throw checkFail;

    // 4. Возврат на портал по адресу из ответа: именно на нём портал выдаёт
    //    свои куки. Без этого шага у нас останется сессия Bitrix24.Network,
    //    которая сама по себе бесполезна.
    const back = check?.data?.redirectUrl || check?.data?.redirect_url || check?.data?.url;
    if (!back) {
        throw new BitrixError('bitrix_auth_failed', 'Битрикс не вернул адрес возврата после входа');
    }
    await followRedirects(await rawFetch(back, jar, {}, NET_URL), jar);

    const state = { jar, sessid: null };
    if (!await probeSession(state)) {
        throw new BitrixError('bitrix_auth_failed', 'Битрикс не открыл сессию после входа');
    }
    return state;
}

// Вход руками из панели: заодно привязываем учётку к аккаунту сайта.
export async function bitrixLogin(userId, login, password, { remember = true } = {}) {
    const state = await performLogin(login, password);
    await saveState(userId, state);
    let linked = false;
    if (remember) linked = await saveLink(userId, login, password);
    else await dropLink(userId);
    return { linked };
}

// Сессия для запроса: живая — берём её, нет — входим сохранённой привязкой.
export async function bitrixEnsureSession(userId) {
    const state = await loadState(userId);
    if (state?.jar?.size) {
        try {
            if (await probeSession(state)) {
                await saveState(userId, state);
                return state;
            }
        } catch (err) {
            if (err instanceof BitrixError && err.code === 'bitrix_unavailable') throw err;
        }
    }

    const link = await loadLink(userId);
    if (!link) {
        await dropState(userId);
        throw new BitrixError('bitrix_auth_required', 'войдите в Битрикс через сайт');
    }

    try {
        const fresh = await performLogin(link.login, link.password);
        await saveState(userId, fresh);
        await tolerantQuery('UPDATE bitrix_links SET last_login_at = now() WHERE user_id = $1', [userId]);
        return fresh;
    } catch (err) {
        // Пароль сменили (или уже прилетела капча) — привязку стираем.
        // Продолжать долбиться устаревшим паролем нельзя: за несколько попыток
        // Битрикс включит капчу, и тогда встанет вход и у живого человека.
        if (err instanceof BitrixError && err.code !== 'bitrix_unavailable') {
            await dropLink(userId);
            await dropState(userId);
        }
        throw err;
    }
}

// ── Запросы к интерфейсу портала ─────────────────────────────────────────────

// Служебный ajax-запрос интерфейса. Тело — FormData, URLSearchParams или
// обычный объект. sessid подставляется сам: он нужен и в адресе, и в теле, и
// заголовком, а забыть его где-то одном — верный способ получить «Access
// denied» без объяснений.
export async function bitrixAjax(userId, path, body = null, { method = 'POST', json = false } = {}) {
    const state = await bitrixEnsureSession(userId);
    const url = resolveUrl(path);
    if (state.sessid && !url.searchParams.has('sessid')) url.searchParams.set('sessid', state.sessid);

    const headers = {
        'Bx-ajax': 'true',
        'X-Bitrix-Site-Id': 's1',
        ...(state.sessid ? { 'X-Bitrix-Csrf-Token': state.sessid } : {}),
        Referer: BASE_URL.href,
    };

    let payload = body;
    if (json) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body ?? {});
    } else if (body instanceof FormData || body instanceof URLSearchParams) {
        if (state.sessid) body.set('sessid', state.sessid);
    } else if (body) {
        const form = new URLSearchParams();
        for (const [k, v] of Object.entries(body)) form.set(k, v == null ? '' : String(v));
        if (state.sessid) form.set('sessid', state.sessid);
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        payload = form;
    }

    const res = await rawFetch(url, state.jar, { method, headers, body: payload ?? undefined });
    // Куки портал переписывает почти на каждый ответ — сохраняем всегда.
    await saveState(userId, state);

    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        return { raw: text, status: res.status };
    }
}

// Страница портала (карточка лида, список) — для того, чего в ajax нет.
// Возвращается уже СОБРАННАЯ разметка: каркас плюс динамические блоки, иначе
// в ответе не окажется ни одного значения лида (см. composite.js).
export async function bitrixGetHtml(userId, path) {
    const state = await bitrixEnsureSession(userId);
    const { html, authed } = await loadPage(state, path);
    if (!authed) {
        await dropState(userId);
        throw new BitrixError('bitrix_auth_required', 'сессия Битрикса закрылась');
    }
    await saveState(userId, state);
    return html;
}

// Выход: гасим куки у себя. Сессию на стороне портала специально НЕ закрываем —
// в отличие от старой CRM, где выход обязателен: там одна учётка на нескольких
// человек, а тут у каждого своя, и разлогинивать заодно браузер оператора, в
// котором открыт тот же Битрикс, незачем.
export async function bitrixLogout(userId, { unlink = false } = {}) {
    await dropState(userId);
    if (unlink) await dropLink(userId);
    return { unlinked: unlink };
}
