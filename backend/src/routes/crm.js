import { Router } from 'express';
import {
    crmLogin, crmLogout, crmEnsureSession, crmLinkedLogin, linkSecretConfigured,
    crmGetHtml, buildAnalyseFreePath, CrmError, crmApi,
} from '../crm/client.js';
import {
    parseStations, parseAnalyseFree, parseStockTable, stockSearchPath,
} from '../../../shared/crmAnalyse.js';
import { remember as rememberStockQuery, recent as recentStockQueries, cleanQuery } from '../crm/stockHistory.js';
import {
    clientSearchPath, clientPath, salePath,
    parseClientSearch, parseClientCard, parseSale,
    formatPhoneInput, formatPlateInput, phoneComplete, plateComplete,
} from '../../../shared/crmClients.js';
import {
    newDialQuery, parseDialPage, dialClients, parseNewSale, newCrmRefusal,
} from '../../../shared/crmClientsNew.js';

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
            : err.code === 'crm_daily_limit' ? 429
            : err.code === 'crm_refused' ? 409
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

// Список станций CRM — один на всех и на сутки: станции открываются раз в
// месяцы. Нужен и окну (колонка станций на «Складе»), и самому поиску «на всех
// станциях» (см. /stock/search).
async function crmStations(userId) {
    if (stationsCache && Date.now() - stationsCache.at < STATIONS_TTL_MS) return stationsCache.data;
    const stations = parseStations(await crmGetHtml(userId, '/analyse/free'));
    if (!stations.length) throw new Error('пустой список станций');
    stationsCache = { at: Date.now(), data: stations };
    return stations;
}

router.get('/stations', async (req, res) => {
    try {
        res.json({ stations: await crmStations(req.user.id) });
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

// ── Поиск по складу (режим «Склад» на главной) ───────────────────────────────
// Та же /analyse/free, что и у /availability, но так, как ею пользуются в самой
// CRM: выбрал одну или несколько станций, набрал что угодно — получил таблицу
// с колонкой остатка на каждую. Разбор — parseStockTable в shared/crmAnalyse.js.
//
// Один запрос — одна страница CRM. Список артикулов (режим «списком» в окне)
// фронт шлёт по одному запросу на строку и рисует группы по мере готовности:
// очередь к CRM последовательная, и «десять артикулов одним ответом» держали
// бы запрос открытым, пока не отработает последний.

const STOCK_MAX_STATIONS = 40;
const stockCache = new Map(); // `${stations}|${query}` → { at, value }

// POST /api/crm/stock/search  body: { stationIds: ['45', '11'], query, remember }
// remember: false — в общую историю не писать (так шлёт режим «списком»:
// десять артикулов разом вытеснили бы из подсказок всё, что искали руками).
router.post('/stock/search', async (req, res) => {
    const rawIds = Array.isArray(req.body?.stationIds) ? req.body.stationIds : [];
    const stationIds = [...new Set(rawIds.map(id => String(id ?? '').trim()))].filter(Boolean);
    const query = cleanQuery(req.body?.query);
    const remember = req.body?.remember !== false;
    if (!query) {
        return res.status(400).json({ error: { code: 'bad_request', message: 'нужен query' } });
    }
    if (stationIds.length > STOCK_MAX_STATIONS || stationIds.some(id => !/^\d+$/.test(id))) {
        return res.status(400).json({ error: { code: 'bad_request', message: 'stationIds — до 40 числовых id' } });
    }
    // Историю пишем ДО похода в CRM и независимо от его исхода: запрос, на
    // котором CRM не ответила, повторят — и ему место в подсказках.
    if (remember) {
        try { await rememberStockQuery(query, req.user.id); }
        catch (e) { console.warn('stock history', e.message); }
    }
    // «Все станции» — это НЕ пустой выбор в CRM. Пустой выбор CRM отвечает
    // одной колонкой — суммой по всем складам, и где именно лежит позиция, из
    // неё не узнать, а ради этого «на всех» и ищут. Поэтому просим у CRM все
    // станции разом, как если бы их выделили руками, и окно пишет у позиции,
    // на каких станциях она есть (`everywhere`).
    const everywhere = !stationIds.length;
    const cacheKey = `${everywhere ? '*' : [...stationIds].sort().join(',')}|${query.toLowerCase()}`;
    const cached = cacheTake(stockCache, cacheKey, AVAIL_TTL_MS);
    if (cached) return res.json({ ...cached, cached: true });
    try {
        const ids = everywhere ? (await crmStations(req.user.id)).map(st => st.id) : stationIds;
        const html = await crmGetHtml(req.user.id, stockSearchPath(ids, query));
        const { columns, rows, total } = parseStockTable(html);
        const value = { query, stationIds, everywhere, columns, rows, total, shown: rows.length };
        cachePut(stockCache, cacheKey, value, AVAIL_TTL_MS);
        res.json(value);
    } catch (err) {
        sendCrmError(res, err);
    }
});

// GET /api/crm/stock/history — общая история, свежее сверху. Сессии CRM не
// требует: подсказки должны появляться и до входа.
router.get('/stock/history', async (req, res) => {
    try {
        res.json({ items: await recentStockQueries() });
    } catch (err) {
        console.error('stock history', err);
        res.status(500).json({ error: { code: 'db_failed', message: 'история недоступна' } });
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

// ── Новая CRM: /api/crm/new/clients… ─────────────────────────────────────────
// Та же вкладка «Клиент», но из новой CRM (re/api.php) — поиск идёт сюда
// ПЕРВЫМ, а старая подгружается кнопкой. Ищем в ОБЗВОНЕ (section=dial), как и
// в старой (/dial_clients/): он по телефону или госномеру сразу отдаёт все
// продажи, и из них собираются и список клиентов, и их карточки
// (shared/crmClientsNew.js). Второй запрос за карточкой не нужен; за
// содержимым чека фронт ходит, как и раньше, по одному.
//
// Кэш и склейка запросов — ПО СОТРУДНИКУ, а не общие, как у старой: ходим под
// личной сессией, и у новой CRM есть дневной лимит просмотра клиентов и журнал
// просмотров для СБ. Обзвон и чек в тот журнал, судя по её коду, не пишутся,
// но общий кэш отдавал бы одному данные, полученные под учёткой другого, — а
// этого нельзя при любом лимите. Склейка нужна потому, что GET сайта при
// медленном ответе страхуется вторым таким же (netRetry.js).

const NEW_CLIENT_TTL_MS = CLIENT_TTL_MS;

// Поход в новую CRM с кэшем и склейкой, ОБА по сотруднику. Фабрика — ради
// теста: он гоняет ровно этот код с подменённым походом в CRM.
export function newCrmGetter(api = crmApi) {
    const cache = new Map();     // `${userId}|${query}` → { at, value }
    const inFlight = new Map();  // `${userId}|${query}` → Promise
    return async function get(userId, query, ttl) {
        const key = `${userId}|${query}`;
        const hit = cacheTake(cache, key, ttl);
        if (hit) return hit;
        if (inFlight.has(key)) return inFlight.get(key);
        const p = (async () => {
            const json = await api(userId, { query });
            const refusal = newCrmRefusal(json);
            if (refusal) throw new CrmError(refusal.code, refusal.message);
            cachePut(cache, key, json, ttl);
            return json;
        })();
        inFlight.set(key, p);
        try {
            return await p;
        } finally {
            inFlight.delete(key);
        }
    };
}

const newCrmGet = newCrmGetter();

// У постоянного клиента визитов бывает под сотню, а обзвон отдаёт по 50.
// Больше шести страниц не листаем: карточку всё равно показывают по восемь
// визитов, а за это время очередь к CRM стоит у всех.
const DIAL_MAX_PAGES = 6;

router.get('/new/clients', async (req, res) => {
    const phone = String(req.query.phone || '').trim();
    const plate = String(req.query.plate || '').trim();
    if (phone && !phoneComplete(phone)) {
        return res.status(400).json({ error: { code: 'bad_request', message: 'телефон введён не полностью' } });
    }
    if (!phone && !plateComplete(plate)) {
        return res.status(400).json({ error: { code: 'bad_request', message: 'нужен телефон или гос. номер' } });
    }
    try {
        const get = (page) => newCrmGet(req.user.id, newDialQuery({ phone, plate, page }), NEW_CLIENT_TTL_MS);
        const first = parseDialPage(await get(1));
        const rows = [...first.rows];
        const pages = Math.min(first.pages, DIAL_MAX_PAGES);
        for (let page = 2; page <= pages; page++) rows.push(...parseDialPage(await get(page)).rows);
        const clients = dialClients(rows);
        res.json({
            source: 'new',
            query: phone ? { kind: 'phone', value: formatPhoneInput(phone) }
                : { kind: 'plate', value: formatPlateInput(plate) },
            // Список — как у старой ({ id, name }), а карточки отдельно: фронт
            // открывает клиента из них, не ходя в CRM второй раз.
            clients: clients.map(({ card, ...c }) => c),
            cards: Object.fromEntries(clients.map(c => [c.id, c.card])),
            truncated: first.pages > DIAL_MAX_PAGES ? first.total : 0,
        });
    } catch (err) {
        sendCrmError(res, err);
    }
});

router.get('/new/sales/:id', async (req, res) => {
    const id = String(req.params.id || '');
    if (!/^\d+$/.test(id)) {
        return res.status(400).json({ error: { code: 'bad_request', message: 'id чека — число' } });
    }
    try {
        const json = await newCrmGet(req.user.id, `section=sale&id=${id}`, SALE_TTL_MS);
        res.json({ sale: parseNewSale(json, id) });
    } catch (err) {
        sendCrmError(res, err);
    }
});

export default router;
