// ─────────────────────────────────────────────────────────────────────────────
// Клиент оригинальной админки записей (zamena-masla-spot.ru/admin/record).
//
// В отличие от crm/client.js (персональные сессии по числу работников) здесь
// сессия ОДНА на всех: у оригинала общий логин/пароль, креды хранятся в
// zms_records_config (вводятся один раз кем угодно через UI), cookie-jar — в
// zms_records_session. Когда оригинал рвёт сессию, клиент сам перелогинивается
// сохранёнными кредами; «войдите заново» пользователи видят только если
// пароль реально сменили.
//
// Env: ZMS_ADMIN_BASE_URL (default https://zamena-masla-spot.ru),
//      ZMS_ADMIN_LOGIN_PATH / ZMS_ADMIN_LOGIN_FIELD / ZMS_ADMIN_PASSWORD_FIELD
//      — переопределения на случай нераспознанной формы логина,
//      ZMS_ADMIN_FETCH_TIMEOUT_MS — таймаут запроса.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../db/client.js';
import { parseLoginForm } from '../crm/client.js';
import { isRecordBoard, looksLikeLoginPage } from '../../../shared/crmRecords.js';

const BASE = (process.env.ZMS_ADMIN_BASE_URL || 'https://zamena-masla-spot.ru').replace(/\/$/, '');
const BASE_URL = new URL(`${BASE}/`);
const ORIGIN = BASE_URL.origin;
const LOGIN_ENTRY = process.env.ZMS_ADMIN_LOGIN_PATH || '/admin/record';
const THROTTLE_MS = 400;
const FETCH_TIMEOUT_MS = Math.max(1_000, Number(process.env.ZMS_ADMIN_FETCH_TIMEOUT_MS) || 20_000);

export class ZmsError extends Error {
    constructor(code, message) {
        super(message || code);
        // zms_credentials_required — креды не сохранены (или их отверг оригинал);
        // zms_auth_failed — оригинал не принял логин/пароль;
        // zms_unavailable — сеть/таймаут/5xx.
        this.code = code;
    }
}

function resolveUrl(path, base = BASE_URL) {
    const url = new URL(path instanceof URL ? path.href : String(path || ''), base instanceof URL ? base : BASE_URL);
    if (url.origin !== ORIGIN) {
        throw new ZmsError('zms_unavailable', `админка перенаправила на другой хост: ${url.origin}`);
    }
    return url;
}

// ── Креды и cookie-jar (по одной строке в БД) ────────────────────────────────

let credsCache; // undefined = не читали; null = нет; {login,password,updatedAt}
let jarCache;   // undefined = не читали; Map | null

export async function getCredentials() {
    if (credsCache !== undefined) return credsCache;
    const r = await query('SELECT login, password, updated_at FROM zms_records_config WHERE id = 1');
    credsCache = r.rows[0]
        ? { login: r.rows[0].login, password: r.rows[0].password, updatedAt: r.rows[0].updated_at }
        : null;
    return credsCache;
}

export async function saveCredentials(login, password) {
    await query(
        `INSERT INTO zms_records_config (id, login, password, updated_at)
         VALUES (1, $1, $2, now())
         ON CONFLICT (id) DO UPDATE SET login = $1, password = $2, updated_at = now()`,
        [login, password],
    );
    credsCache = { login, password, updatedAt: new Date() };
}

export async function hasCredentials() {
    return Boolean(await getCredentials());
}

async function loadJar() {
    if (jarCache !== undefined) return jarCache;
    const r = await query('SELECT cookies FROM zms_records_session WHERE id = 1');
    jarCache = r.rows[0] ? new Map(Object.entries(r.rows[0].cookies || {})) : null;
    return jarCache;
}

async function saveJar(jar) {
    jarCache = jar;
    await query(
        `INSERT INTO zms_records_session (id, cookies, updated_at)
         VALUES (1, $1, now())
         ON CONFLICT (id) DO UPDATE SET cookies = $1, updated_at = now()`,
        [Object.fromEntries(jar)],
    );
}

async function dropJar() {
    jarCache = null;
    await query('DELETE FROM zms_records_session WHERE id = 1');
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

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
    const target = resolveUrl(path, opts.base);
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
                'User-Agent': 'Mozilla/5.0 (site-records-proxy)',
                ...(cookie ? { Cookie: cookie } : {}),
                ...(opts.headers || {}),
            },
        });
    } catch (err) {
        throw new ZmsError('zms_unavailable', `админка недоступна (${target.host}): ${networkErrorDetail(err)}`);
    } finally {
        clearTimeout(timeout);
    }
    storeSetCookies(res, jar);
    if (res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500) {
        throw new ZmsError('zms_unavailable', `админка ответила HTTP ${res.status}`);
    }
    return res;
}

async function followRedirects(res, jar, hops = 5) {
    const maxHops = hops;
    while (hops-- > 0 && res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) break;
        res = await rawFetch(resolveUrl(loc, res.url || BASE_URL), jar);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        throw new ZmsError('zms_unavailable', `админка зациклила перенаправления (>${maxHops})`);
    }
    return res;
}

// Общая последовательная очередь с троттлингом — оригинал и так еле живой,
// не добиваем его параллельными запросами.
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

// ── Логин ────────────────────────────────────────────────────────────────────

// Логин в пустой jar. Успех подтверждаем реальной доской записей.
async function loginIntoJar(jar, login, password) {
    let res = await followRedirects(await rawFetch(LOGIN_ENTRY, jar), jar);
    let html = await res.text();
    if (isRecordBoard(html)) return; // куки в jar уже живые

    const form = parseLoginForm(html);
    const loginField = process.env.ZMS_ADMIN_LOGIN_FIELD || form?.loginField;
    const passwordField = process.env.ZMS_ADMIN_PASSWORD_FIELD || form?.passwordField;
    if (!loginField || !passwordField) {
        throw new ZmsError('zms_auth_failed', 'не удалось распознать форму логина админки');
    }
    const actionPath = form?.action ? resolveUrl(form.action, res.url || BASE_URL) : LOGIN_ENTRY;

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
        throw new ZmsError('zms_auth_failed', `админка ответила ${post.status} на логин`);
    }
    res = await followRedirects(await rawFetch('/admin/record', jar), jar);
    html = res.status >= 300 ? '' : await res.text();
    if (!isRecordBoard(html)) {
        throw new ZmsError('zms_auth_failed', 'админка не приняла логин или пароль');
    }
}

// Проверить пару логин/пароль (для POST /credentials): логинимся в свежий jar,
// при успехе сохраняем и креды, и куки.
export async function testAndSaveCredentials(login, password) {
    const jar = new Map();
    await enqueue(() => loginIntoJar(jar, login, password));
    await saveCredentials(login, password);
    await saveJar(jar);
}

// ── Запросы под сессией с автологином ────────────────────────────────────────

// fn(jar) выполняется под текущей сессией; если оригинал отдал страницу логина
// (сессию срубили) — перелогиниваемся сохранёнными кредами и повторяем один раз.
async function withSession(fn) {
    const creds = await getCredentials();
    if (!creds) throw new ZmsError('zms_credentials_required', 'логин/пароль админки ещё не введены');

    return enqueue(async () => {
        let jar = await loadJar();
        if (jar && jar.size) {
            try {
                return await fn(jar);
            } catch (err) {
                if (!(err instanceof ZmsError) || err.code !== 'zms_auth_required') throw err;
            }
        }
        // Сессии нет или её срубили — логинимся и повторяем.
        jar = new Map();
        try {
            await loginIntoJar(jar, creds.login, creds.password);
        } catch (err) {
            if (err instanceof ZmsError && err.code === 'zms_auth_failed') {
                // Пароль сменили — просим ввести новый, старый больше не мучаем.
                await dropJar();
                throw new ZmsError('zms_credentials_required', 'админка не приняла сохранённые логин/пароль — введите новые');
            }
            throw err;
        }
        await saveJar(jar);
        return fn(jar);
    });
}

// Внутри withSession: HTML-ответ, который оказался страницей логина.
function authRequired() {
    return new ZmsError('zms_auth_required', 'сессия админки завершена');
}

// GET /admin/record?date=DD.MM.YYYY → HTML доски.
export async function fetchBoardHtml(date) {
    return withSession(async (jar) => {
        const path = date ? `/admin/record?date=${encodeURIComponent(date)}` : '/admin/record';
        const res = await followRedirects(await rawFetch(path, jar), jar);
        const html = res.status >= 300 ? '' : await res.text();
        if (!isRecordBoard(html)) {
            if (looksLikeLoginPage(html) || !html) throw authRequired();
            throw new ZmsError('zms_unavailable', 'админка вернула неожиданную страницу вместо доски записей');
        }
        return html;
    });
}

// GET /admin/record/edit?id=… → HTML формы редактирования.
export async function fetchEditFormHtml(id) {
    return withSession(async (jar) => {
        const res = await followRedirects(await rawFetch(`/admin/record/edit?id=${encodeURIComponent(id)}`, jar), jar);
        const html = res.status >= 300 ? '' : await res.text();
        if (!html || looksLikeLoginPage(html)) throw authRequired();
        return html;
    });
}

// POST /admin/record/update — и создание (id=''), и правка (id=N).
// fields: { id, addressId, date, time, name, phone, carNumber, comment }
export async function postRecordUpdate(fields) {
    return withSession(async (jar) => {
        const fd = new FormData();
        fd.append('id', fields.id == null ? '' : String(fields.id));
        fd.append('address_id', String(fields.addressId));
        fd.append('date', String(fields.date));
        fd.append('time', String(fields.time));
        fd.append('name', String(fields.name ?? ''));
        fd.append('phone', String(fields.phone ?? ''));
        fd.append('car_number', String(fields.carNumber ?? ''));
        fd.append('comment', String(fields.comment ?? ''));
        fd.append('back', '/admin/record');
        const res = await rawFetch('/admin/record/update', jar, { method: 'POST', body: fd });
        if (res.status >= 400) {
            throw new ZmsError('zms_unavailable', `админка ответила ${res.status} на сохранение записи`);
        }
        // Успех — это 302 на back либо 200; страница логина = сессию срубили.
        if (res.status < 300) {
            const html = await res.text();
            if (looksLikeLoginPage(html)) throw authRequired();
        }
        return true;
    });
}

// Удаление — GET-ссылка из доски (относительный /admin/record/delete?…).
export async function deleteRecordByUrl(deleteUrl) {
    return withSession(async (jar) => {
        const res = await followRedirects(await rawFetch(deleteUrl, jar), jar);
        if (res.status >= 400) {
            throw new ZmsError('zms_unavailable', `админка ответила ${res.status} на удаление записи`);
        }
        if (res.status < 300) {
            const html = await res.text();
            if (looksLikeLoginPage(html)) throw authRequired();
        }
        return true;
    });
}

// POST /jsApi/serviceTimes — расписание слотов адреса. ВНИМАНИЕ: семантика
// инвертирована, isAvailable=false означает СВОБОДНЫЙ слот (так в оригинале).
export async function fetchServiceTimes(addressId, dateDDMMYYYY) {
    const day = String(dateDDMMYYYY).replace(/(\d+)\.(\d+)\.(\d+)/, '$3-$2-$1') + 'T00:00:00';
    return withSession(async (jar) => {
        const path = `/jsApi/serviceTimes?addressId=${encodeURIComponent(addressId)}`
            + `&day=${encodeURIComponent(day)}&duration=30&format=full&source=admin`;
        const res = await rawFetch(path, jar, { method: 'POST' });
        if (res.status >= 300) throw authRequired();
        try {
            return await res.json();
        } catch {
            throw new ZmsError('zms_unavailable', 'jsApi/serviceTimes вернул не-JSON');
        }
    });
}
