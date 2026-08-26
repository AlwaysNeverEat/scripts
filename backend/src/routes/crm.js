import { Router } from 'express';
import {
    crmLogin, crmLogout, crmEnsureSession, crmLinkedLogin, linkSecretConfigured,
    crmGetHtml, buildAnalyseFreePath, CrmError,
} from '../crm/client.js';
import { parseStations, parseAnalyseFree } from '../../../shared/crmAnalyse.js';
import {
    clientSearchPath, clientPath, salePath,
    parseClientSearch, parseClientCard, parseSale,
    formatPhoneInput, formatPlateInput, phoneComplete, plateComplete,
} from '../../../shared/crmClients.js';

const router = Router();

// Прокси к CRM /analyse/free под ПЕРСОНАЛЬНОЙ сессией работника: каждый входит
// в CRM через сайт своей учёткой, и эта учётка привязывается к аккаунту сайта —
// дальше сессия CRM поднимается сама (см. backend/src/crm/client.js). Разбор
// HTML — shared/crmAnalyse.js, доменная логика (литры, цены, матчинг с
// каталогом) — на фронте.
//
// Важно: ошибки CRM-авторизации отдаём как 403, НЕ 401 — 401 фронт трактует
// как «сессия САЙТА истекла» и выкидывает на гейт (apiFetch в main.js).

const STATIONS_TTL_MS = 24 * 60 * 60 * 1000;
const AVAIL_TTL_MS = 5 * 60 * 1000;
const MAX_ITEMS = 8; // 3 фильтра + масло с запасом; больше — похоже на злоупотребление

// Клиента и чеки кэшируем НАМНОГО короче остатков: оператор смотрит карточку,
// пока разговаривает с человеком, и «баллы пятиминутной давности» его устроят,
// а «баллы часовой давности» — уже нет. Чек, наоборот, закрыт и не меняется,
// поэтому живёт дольше: ради него и затевался автообход — тридцать чеков
// клиента через очередь к CRM идут заметное время, и повторно ходить за ними
// при возврате к тому же клиенту незачем.
const CLIENT_TTL_MS = 3 * 60 * 1000;
const SALE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_LIMIT = 500;

let stationsCache = null; // { at, data } — список станций общий для всех
const availCache = new Map(); // `${stationId}|${query}` → { at, rows } — остатки тоже общие
const clientCache = new Map(); // clientId → { at, client }
const saleCache = new Map();   // saleId → { at, sale }

// Общая уборка кэшей: ключи копятся от всех работников сразу, а чеков у
// постоянного клиента бывают десятки.
function cacheTake(cache, key, ttl) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    if (hit) cache.delete(key);
    return null;
}

function cachePut(cache, key, value, ttl) {
    cache.set(key, { at: Date.now(), value });
    if (cache.size > CACHE_LIMIT) {
        const cutoff = Date.now() - ttl;
        for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k);
        // Всё ещё свежее, но кэш переполнен — выкидываем самые старые записи
        // (Map перебирается в порядке вставки).
        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    }
}

function sendCrmError(res, err) {
    if (err instanceof CrmError) {
        // crm_logout_failed — 502: CRM ответила, но сессию не закрыла; фронт по
        // этому коду НЕ выпускает из аккаунта сайта.
        const status = err.code === 'crm_auth_required' ? 403
            : err.code === 'crm_auth_failed' ? 403
            : 502;
        return res.status(status).json({ error: { code: err.code, message: err.message } });
    }
    console.error('CRM proxy', err);
    return res.status(502).json({ error: { code: 'parse_failed', message: 'не удалось разобрать ответ CRM' } });
}

// ── Вход/выход/статус ─────────────────────────────────────────────────────────

// Вход руками: заодно привязываем учётку к аккаунту сайта (remember: false —
// не запоминать, тогда прошлая привязка снимается).
router.post('/login', async (req, res) => {
    const login = String(req.body?.login || '').trim();
    const password = String(req.body?.password || '');
    const remember = req.body?.remember !== false;
    if (!login || !password) {
        return res.status(400).json({ error: { code: 'bad_request', message: 'нужны login и password' } });
    }
    try {
        const { linked } = await crmLogin(req.user.id, login, password, { remember });
        res.json({ ok: true, linked });
    } catch (err) {
        sendCrmError(res, err);
    }
});

// Выход. Отвечаем ok только после того, как CRM подтвердила закрытие сессии —
// на этом ответе фронт и завершает выход из аккаунта сайта.
//
// unlink: true — снять и привязку учётки (кнопка выхода в панели CRM);
// по умолчанию привязка остаётся: выход из аккаунта сайта не должен заставлять
// человека вводить логин CRM заново при следующем входе.
router.post('/logout', async (req, res) => {
    const unlink = req.body?.unlink === true;
    try {
        const result = await crmLogout(req.user.id, { unlink });
        res.json({ ok: true, ...result });
    } catch (err) {
        sendCrmError(res, err);
    }
});

// Статус для панели: живая сессия поднимается тут же по привязке, поэтому
// первый заход на страницу машины уже видит наличие, ничего не спрашивая.
router.get('/status', async (req, res) => {
    try {
        const state = await crmEnsureSession(req.user.id);
        res.json({
            loggedIn: state.loggedIn,
            linked: state.linked,
            autoLogin: Boolean(state.auto),
            linkRejected: Boolean(state.linkRejected),
            unavailable: state.unavailable || null,
            crmLogin: state.loggedIn || state.linked ? await crmLinkedLogin(req.user.id) : null,
            canLink: linkSecretConfigured(),
        });
    } catch (err) {
        sendCrmError(res, err);
    }
});

// ── GET /api/crm/stations ─────────────────────────────────────────────────────

router.get('/stations', async (req, res) => {
    if (stationsCache && Date.now() - stationsCache.at < STATIONS_TTL_MS) {
        return res.json({ stations: stationsCache.data });
    }
    try {
        const html = await crmGetHtml(req.user.id, '/analyse/free');
        const stations = parseStations(html);
        if (!stations.length) throw new Error('пустой список станций');
        stationsCache = { at: Date.now(), data: stations };
        res.json({ stations });
    } catch (err) {
        sendCrmError(res, err);
    }
});

// ── POST /api/crm/availability ────────────────────────────────────────────────
// body: { stationId, items: [{ key, query }] } — key эхом возвращается,
// query — артикул фильтра или вязкость масла («5w-30»).

router.post('/availability', async (req, res) => {
    const stationId = String(req.body?.stationId || '').trim();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!/^\d+$/.test(stationId) || !items.length || items.length > MAX_ITEMS) {
        return res.status(400).json({ error: { code: 'bad_request', message: 'нужны stationId и 1–8 items' } });
    }
    for (const it of items) {
        if (!it || typeof it.key !== 'string' || typeof it.query !== 'string' || !it.query.trim()) {
            return res.status(400).json({ error: { code: 'bad_request', message: 'каждый item: { key, query }' } });
        }
    }

    try {
        const results = [];
        for (const it of items) {
            const searchQuery = it.query.trim();
            const cacheKey = `${stationId}|${searchQuery.toLowerCase()}`;
            const cached = availCache.get(cacheKey);
            if (cached && Date.now() - cached.at < AVAIL_TTL_MS) {
                results.push({ key: it.key, query: searchQuery, rows: cached.rows });
                continue;
            }
            const html = await crmGetHtml(req.user.id, buildAnalyseFreePath(stationId, searchQuery));
            const { rows } = parseAnalyseFree(html, stationId);
            availCache.set(cacheKey, { at: Date.now(), rows });
            results.push({ key: it.key, query: searchQuery, rows });
        }
        // не даём кэшу расти бесконечно
        if (availCache.size > 500) {
            const cutoff = Date.now() - AVAIL_TTL_MS;
            for (const [k, v] of availCache) if (v.at < cutoff) availCache.delete(k);
        }
        res.json({ stationId, results });
    } catch (err) {
        sendCrmError(res, err);
    }
});

// ── Клиенты: поиск, карточка, чек ─────────────────────────────────────────────
// Три страницы CRM, из которых собирается ОДНА карточка клиента на сайте
// (frontend/src/clientSearch.js). Разбор — shared/crmClients.js.
//
// Обход чеков сайт делает не пачкой, а по одному запросу на чек: очередь к CRM
// последовательная (см. crm/client.js), так что «прочекать всё сразу» на
// сервере означало бы держать ответ открытым минуту. Вместо этого фронт просит
// чеки по одному и показывает их по мере готовности.

// ── GET /api/crm/clients?phone=… | ?plate=… ──────────────────────────────────

router.get('/clients', async (req, res) => {
    const phone = String(req.query.phone || '').trim();
    const plate = String(req.query.plate || '').trim();
    // Ходить в CRM с половиной номера незачем: она ищет по точному совпадению,
    // а очередь запросов у нас одна на всех.
    if (phone && !phoneComplete(phone)) {
        return res.status(400).json({ error: { code: 'bad_request', message: 'телефон введён не полностью' } });
    }
    if (!phone && !plateComplete(plate)) {
        return res.status(400).json({ error: { code: 'bad_request', message: 'нужен телефон или гос. номер' } });
    }
    try {
        const html = await crmGetHtml(req.user.id, clientSearchPath({ phone, plate }));
        const { clients, searched } = parseClientSearch(html);
        if (!searched) throw new Error('на странице обзвона нет списка клиентов');
        res.json({
            query: phone ? { kind: 'phone', value: formatPhoneInput(phone) }
                : { kind: 'plate', value: formatPlateInput(plate) },
            clients,
        });
    } catch (err) {
        sendCrmError(res, err);
    }
});

// ── GET /api/crm/clients/:id ─────────────────────────────────────────────────
// Карточка + список обслуживаний БЕЗ содержимого чеков: содержимое фронт
// добирает отдельными запросами, показывая до тех пор плейсхолдеры.

router.get('/clients/:id', async (req, res) => {
    const id = String(req.params.id || '');
    if (!/^\d+$/.test(id)) {
        return res.status(400).json({ error: { code: 'bad_request', message: 'id клиента — число' } });
    }
    const cached = cacheTake(clientCache, id, CLIENT_TTL_MS);
    if (cached) return res.json({ client: cached, cached: true });
    try {
        const client = parseClientCard(await crmGetHtml(req.user.id, clientPath(id)), id);
        cachePut(clientCache, id, client, CLIENT_TTL_MS);
        res.json({ client });
    } catch (err) {
        sendCrmError(res, err);
    }
});

// ── GET /api/crm/sales/:id ───────────────────────────────────────────────────

router.get('/sales/:id', async (req, res) => {
    const id = String(req.params.id || '');
    if (!/^\d+$/.test(id)) {
        return res.status(400).json({ error: { code: 'bad_request', message: 'id чека — число' } });
    }
    const cached = cacheTake(saleCache, id, SALE_TTL_MS);
    if (cached) return res.json({ sale: cached, cached: true });
    try {
        const sale = parseSale(await crmGetHtml(req.user.id, salePath(id)), id);
        cachePut(saleCache, id, sale, SALE_TTL_MS);
        res.json({ sale });
    } catch (err) {
        sendCrmError(res, err);
    }
});

export default router;
