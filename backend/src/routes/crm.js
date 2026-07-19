import { Router } from 'express';
import {
    crmLogin, crmLogout, crmHasSession, crmGetHtml, buildAnalyseFreePath, CrmError,
} from '../crm/client.js';
import { parseStations, parseAnalyseFree } from '../../../shared/crmAnalyse.js';

const router = Router();

// Прокси к CRM /analyse/free под ПЕРСОНАЛЬНОЙ сессией работника: каждый входит
// в CRM через сайт своей учёткой (пароль не хранится — только куки, см.
// backend/src/crm/client.js). Разбор HTML — shared/crmAnalyse.js, доменная
// логика (литры, цены, матчинг с каталогом) — на фронте.
//
// Важно: ошибки CRM-авторизации отдаём как 403, НЕ 401 — 401 фронт трактует
// как «сессия САЙТА истекла» и выкидывает на гейт (apiFetch в main.js).

const STATIONS_TTL_MS = 24 * 60 * 60 * 1000;
const AVAIL_TTL_MS = 5 * 60 * 1000;
const MAX_ITEMS = 8; // 3 фильтра + масло с запасом; больше — похоже на злоупотребление

let stationsCache = null; // { at, data } — список станций общий для всех
const availCache = new Map(); // `${stationId}|${query}` → { at, rows } — остатки тоже общие

function sendCrmError(res, err) {
    if (err instanceof CrmError) {
        const status = err.code === 'crm_auth_required' ? 403
            : err.code === 'crm_auth_failed' ? 403
            : 502;
        return res.status(status).json({ error: { code: err.code, message: err.message } });
    }
    console.error('CRM proxy', err);
    return res.status(502).json({ error: { code: 'parse_failed', message: 'не удалось разобрать ответ CRM' } });
}

// ── Вход/выход/статус ─────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
    const login = String(req.body?.login || '').trim();
    const password = String(req.body?.password || '');
    if (!login || !password) {
        return res.status(400).json({ error: { code: 'bad_request', message: 'нужны login и password' } });
    }
    try {
        await crmLogin(req.user.id, login, password);
        res.json({ ok: true });
    } catch (err) {
        sendCrmError(res, err);
    }
});

router.post('/logout', async (req, res) => {
    try {
        await crmLogout(req.user.id);
        res.json({ ok: true });
    } catch (err) {
        sendCrmError(res, err);
    }
});

router.get('/status', async (req, res) => {
    try {
        res.json({ loggedIn: await crmHasSession(req.user.id) });
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

export default router;
