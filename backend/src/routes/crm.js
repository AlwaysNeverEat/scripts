import { Router } from 'express';
import { crmGetHtml, crmConfigured, buildAnalyseFreePath, CrmError } from '../crm/client.js';
import { parseStations, parseAnalyseFree } from '../../../shared/crmAnalyse.js';

const router = Router();

// Прокси к CRM /analyse/free: сайт спрашивает наличие фильтров/масел на станции,
// бэкенд ходит в CRM под служебной учёткой (env) и возвращает разобранный JSON.
// Разбор HTML — shared/crmAnalyse.js, доменная логика (литры, цены, матчинг
// с каталогом) — на фронте.

const STATIONS_TTL_MS = 24 * 60 * 60 * 1000;
const AVAIL_TTL_MS = 5 * 60 * 1000;
const MAX_ITEMS = 8; // 3 фильтра + масло с запасом; больше — похоже на злоупотребление

let stationsCache = null; // { at, data }
const availCache = new Map(); // `${stationId}|${query}` → { at, rows }

function sendCrmError(res, err) {
  if (err instanceof CrmError) {
    const status = err.code === 'crm_not_configured' ? 503
      : err.code === 'crm_auth_failed' ? 502
      : 502;
    return res.status(status).json({ error: { code: err.code, message: err.message } });
  }
  console.error('CRM proxy', err);
  return res.status(502).json({ error: { code: 'parse_failed', message: 'не удалось разобрать ответ CRM' } });
}

// ── GET /api/crm/stations ─────────────────────────────────────────────────────

router.get('/stations', async (_req, res) => {
  if (!crmConfigured()) {
    return res.status(503).json({ error: { code: 'crm_not_configured', message: 'CRM-учётка не настроена на сервере' } });
  }
  if (stationsCache && Date.now() - stationsCache.at < STATIONS_TTL_MS) {
    return res.json({ stations: stationsCache.data });
  }
  try {
    const html = await crmGetHtml('/analyse/free');
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
  if (!crmConfigured()) {
    return res.status(503).json({ error: { code: 'crm_not_configured', message: 'CRM-учётка не настроена на сервере' } });
  }
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
      const query = it.query.trim();
      const cacheKey = `${stationId}|${query.toLowerCase()}`;
      const cached = availCache.get(cacheKey);
      if (cached && Date.now() - cached.at < AVAIL_TTL_MS) {
        results.push({ key: it.key, query, rows: cached.rows });
        continue;
      }
      const html = await crmGetHtml(buildAnalyseFreePath(stationId, query));
      const { rows } = parseAnalyseFree(html, stationId);
      availCache.set(cacheKey, { at: Date.now(), rows });
      results.push({ key: it.key, query, rows });
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
