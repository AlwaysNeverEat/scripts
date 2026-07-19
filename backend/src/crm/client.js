// ─────────────────────────────────────────────────────────────────────────────
// Клиент внутренней CRM (crm.zamena-masla-spot.ru): логин по учёткам из env,
// сессионная кука в памяти процесса, последовательная очередь запросов с
// троттлингом (не долбить CRM), single-flight логин с backoff после неудачи.
//
// Env: CRM_LOGIN, CRM_PASSWORD — обязательные; CRM_BASE_URL — база CRM;
// CRM_LOGIN_PATH / CRM_LOGIN_FIELD / CRM_PASSWORD_FIELD — переопределения на
// случай нестандартной формы логина (по умолчанию форма ищется на странице,
// которую CRM отдаёт незалогиненным).
// ─────────────────────────────────────────────────────────────────────────────

import { parseAnalyseFree } from '../../../shared/crmAnalyse.js';

const BASE = (process.env.CRM_BASE_URL || 'https://crm.zamena-masla-spot.ru').replace(/\/$/, '');
const THROTTLE_MS = 400;          // как в проверенном SPOT-скрипте поиска цен
const LOGIN_BACKOFF_MS = 60_000;  // после неудачного логина не пробуем минуту

export class CrmError extends Error {
    constructor(code, message) {
        super(message || code);
        this.code = code; // crm_not_configured | crm_auth_failed | crm_unavailable
    }
}

export function crmConfigured() {
    return Boolean(process.env.CRM_LOGIN && process.env.CRM_PASSWORD);
}

// ── Кука сессии ──────────────────────────────────────────────────────────────

let cookies = new Map(); // name → value

function storeSetCookies(res) {
    const list = typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    for (const line of list) {
        const [pair] = line.split(';');
        const eq = pair.indexOf('=');
        if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
}

function cookieHeader() {
    return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function rawFetch(path, opts = {}) {
    let res;
    try {
        res = await fetch(BASE + path, {
            redirect: 'manual',
            ...opts,
            headers: {
                'User-Agent': 'Mozilla/5.0 (site-crm-proxy)',
                ...(cookieHeader() ? { Cookie: cookieHeader() } : {}),
                ...(opts.headers || {}),
            },
        });
    } catch (e) {
        throw new CrmError('crm_unavailable', `CRM недоступна: ${e.message}`);
    }
    storeSetCookies(res);
    return res;
}

// ── Логин ────────────────────────────────────────────────────────────────────

// Разбор формы логина из HTML: action + имя полей логина/пароля + hidden-поля
// (CSRF и т.п.). Форма CRM заранее неизвестна, поэтому парсер общий, а поля
// можно переопределить через env.
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
        else if (type === 'hidden') hidden[name] = value;
        else if ((type === 'text' || type === 'email' || type === 'tel') && !loginField) loginField = name;
    }
    if (!passwordField) return null;
    return { action, loginField, passwordField, hidden };
}

let loginInFlight = null;
let loginFailedAt = 0;

async function login() {
    if (loginInFlight) return loginInFlight;
    if (Date.now() - loginFailedAt < LOGIN_BACKOFF_MS) {
        throw new CrmError('crm_auth_failed', 'логин в CRM недавно не удался, повтор позже');
    }
    loginInFlight = (async () => {
        cookies = new Map();
        const entryPath = process.env.CRM_LOGIN_PATH || '/analyse/free';
        let res = await rawFetch(entryPath);
        // незалогиненных CRM обычно редиректит на страницу логина
        for (let hops = 0; hops < 3 && res.status >= 300 && res.status < 400; hops++) {
            const loc = res.headers.get('location');
            if (!loc) break;
            res = await rawFetch(loc.startsWith('http') ? loc.replace(BASE, '') : loc);
        }
        const html = await res.text();
        const form = parseLoginForm(html);

        const loginField = process.env.CRM_LOGIN_FIELD || form?.loginField;
        const passwordField = process.env.CRM_PASSWORD_FIELD || form?.passwordField;
        if (!loginField || !passwordField) {
            throw new CrmError('crm_auth_failed', 'не удалось распознать форму логина CRM');
        }
        const actionPath = form?.action
            ? (form.action.startsWith('http') ? form.action.replace(BASE, '') : form.action)
            : (res.url ? new URL(res.url).pathname : entryPath);

        const body = new URLSearchParams({
            ...(form?.hidden || {}),
            [loginField]: process.env.CRM_LOGIN,
            [passwordField]: process.env.CRM_PASSWORD,
        });
        const post = await rawFetch(actionPath || entryPath, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        // успешный логин — редирект внутрь CRM или страница без формы пароля
        if (post.status >= 400) {
            throw new CrmError('crm_auth_failed', `CRM ответила ${post.status} на логин`);
        }
        const check = await rawFetch('/analyse/free');
        const checkHtml = check.status >= 300 ? '' : await check.text();
        if (!checkHtml || parseAnalyseFree(checkHtml).loginPage) {
            throw new CrmError('crm_auth_failed', 'CRM не приняла логин/пароль');
        }
        return checkHtml;
    })();
    try {
        const html = await loginInFlight;
        loginFailedAt = 0;
        return html;
    } catch (e) {
        if (e instanceof CrmError && e.code === 'crm_auth_failed') loginFailedAt = Date.now();
        throw e;
    } finally {
        loginInFlight = null;
    }
}

// ── Публичный вход: последовательная очередь с троттлингом ───────────────────

let queue = Promise.resolve();
let lastRequestAt = 0;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// GET страницы CRM с гарантией залогиненности: если пришла страница логина —
// логинимся и повторяем один раз.
export function crmGetHtml(path) {
    if (!crmConfigured()) {
        return Promise.reject(new CrmError('crm_not_configured', 'CRM_LOGIN/CRM_PASSWORD не заданы'));
    }
    const run = queue.then(async () => {
        const wait = lastRequestAt + THROTTLE_MS - Date.now();
        if (wait > 0) await sleep(wait);
        lastRequestAt = Date.now();

        let res = await rawFetch(path);
        let html = res.status >= 300 && res.status < 400 ? '' : await res.text();
        if (!html || parseAnalyseFree(html).loginPage) {
            await login();
            lastRequestAt = Date.now();
            res = await rawFetch(path);
            if (res.status >= 300) throw new CrmError('crm_auth_failed', 'CRM снова требует логин');
            html = await res.text();
            if (parseAnalyseFree(html).loginPage) {
                throw new CrmError('crm_auth_failed', 'CRM снова требует логин');
            }
        }
        return html;
    });
    // очередь не должна ломаться от ошибки предыдущего запроса
    queue = run.catch(() => {});
    return run;
}

export function buildAnalyseFreePath(stationId, query) {
    const station = stationId ? `stations%5B%5D=${encodeURIComponent(stationId)}&` : '';
    return `/analyse/free?${station}stationsColumns=&withCatalogItems=${encodeURIComponent(query)}`
        + '&selectionPeriod=&orderByField=price&orderByOrder=ASC';
}
