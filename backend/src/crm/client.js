// ─────────────────────────────────────────────────────────────────────────────
// Клиент внутренней CRM (crm.zamena-masla-spot.ru) с ПЕРСОНАЛЬНЫМИ сессиями:
// каждый работник логинится через сайт под своей учёткой CRM, пароль нигде
// не хранится — только куки сессии (таблица crm_sessions, переживает рестарты
// бэкенда). Выход через сайт только забывает куки этого работника — сессию на
// стороне CRM не завершаем: CRM гасит её «везде», и под общей учёткой это
// разлогинивало коллег. Если CRM закрыла сессию сама, первый же запрос это
// видит, чистит куки и просит войти заново.
//
// Запросы ко CRM идут через общую последовательную очередь с троттлингом
// 400 мс (как в проверенном SPOT-скрипте) — CRM не заваливаем.
//
// Env (всё необязательное): CRM_BASE_URL — база CRM; CRM_LOGIN_PATH /
// CRM_LOGIN_FIELD / CRM_PASSWORD_FIELD — переопределения, если форма логина
// CRM не распознаётся автоматически; CRM_FETCH_TIMEOUT_MS — таймаут запроса.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../db/client.js';
import { parseAnalyseFree } from '../../../shared/crmAnalyse.js';

const BASE = (process.env.CRM_BASE_URL || 'https://crm.zamena-masla-spot.ru').replace(/\/$/, '');
const BASE_URL = new URL(`${BASE}/`);
const CRM_ORIGIN = BASE_URL.origin;
const THROTTLE_MS = 400;
const FETCH_TIMEOUT_MS = Math.max(1_000, Number(process.env.CRM_FETCH_TIMEOUT_MS) || 15_000);

export class CrmError extends Error {
    constructor(code, message) {
        super(message || code);
        // crm_auth_required — нет живой сессии CRM (не залогинен / разлогинен);
        // crm_auth_failed — CRM не приняла логин/пароль;
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

export async function crmHasSession(userId) {
    const jar = await loadJar(userId);
    return Boolean(jar && jar.size);
}

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

function networkErrorDetail(err) {
    if (err?.name === 'AbortError') return `таймаут ${FETCH_TIMEOUT_MS} мс`;
    const code = err?.cause?.code || err?.code || err?.name;
    const message = err?.cause?.message || err?.message || 'неизвестная ошибка сети';
    return code && !String(message).includes(code) ? `${code}: ${message}` : String(message);
}

async function rawFetch(path, jar, opts = {}) {
    const target = resolveCrmUrl(path);
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
        res = await fetch(target, {
            redirect: 'manual',
            ...opts,
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (site-crm-proxy)',
                ...(cookie ? { Cookie: cookie } : {}),
                ...(opts.headers || {}),
            },
        });
    } catch (err) {
        throw new CrmError(
            'crm_unavailable',
            `CRM недоступна (${target.host}): ${networkErrorDetail(err)}`,
        );
    } finally {
        clearTimeout(timeout);
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

// Логин под учёткой работника. Пароль используется однократно и не сохраняется.
export async function crmLogin(userId, login, password) {
    const jar = new Map();
    await enqueue(async () => {
        const entryPath = process.env.CRM_LOGIN_PATH || '/analyse/free';
        let res = await followRedirects(await rawFetch(entryPath, jar), jar);
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
    });
    await saveJar(userId, jar);
}

// Выход: только забываем куки этого работника. Ссылку «выход» в самой CRM
// НЕ дёргаем — CRM завершает сессию аккаунта везде, и под общей учёткой это
// разлогинивало остальных работников. Куки живут только в нашей БД, так что
// после dropJar сессией всё равно никто не воспользуется.
export async function crmLogout(userId) {
    await dropJar(userId);
}

// GET страницы CRM под сессией работника. Если CRM отдала страницу логина —
// сессию завершили (напр., «выход» в самой CRM) → чистим куки и просим войти.
export async function crmGetHtml(userId, path) {
    const jar = await loadJar(userId);
    if (!jar || !jar.size) {
        throw new CrmError('crm_auth_required', 'нет сессии CRM — войдите');
    }
    return enqueue(async () => {
        const res = await followRedirects(await rawFetch(path, jar), jar);
        const html = res.status >= 300 ? '' : await res.text();
        if (!html || parseAnalyseFree(html).loginPage) {
            await dropJar(userId);
            throw new CrmError('crm_auth_required', 'сессия CRM завершена — войдите заново');
        }
        return html;
    });
}

// Последовательная очередь + троттлинг: одна на процесс, чтобы N работников
// суммарно не превращались в шквал запросов к CRM.
let queue = Promise.resolve();
let lastRequestAt = 0;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function enqueue(fn) {
    const run = queue.then(async () => {
        const wait = lastRequestAt + THROTTLE_MS - Date.now();
        if (wait > 0) await sleep(wait);
        lastRequestAt = Date.now();
        return fn();
    });
    queue = run.catch(() => {});
    return run;
}

export function buildAnalyseFreePath(stationId, searchQuery) {
    const station = stationId ? `stations%5B%5D=${encodeURIComponent(stationId)}&` : '';
    return `/analyse/free?${station}stationsColumns=&withCatalogItems=${encodeURIComponent(searchQuery)}`
        + '&selectionPeriod=&orderByField=price&orderByOrder=ASC';
}
