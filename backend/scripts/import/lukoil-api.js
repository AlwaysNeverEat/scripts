// ─────────────────────────────────────────────────────────────────────────────
// Клиент API подбора ЛУКОЙЛ (платформа lubribase / BrandSelector2).
// Инкапсулирует сессию (одноразовый Bearer-токен из window.gon лендинга),
// вежливые GET к JSON-API и загрузку HTML-страницы рекомендации по mid.
// Используется и scrape-lukoil.js, и scrape-lukoil-all.js.
// ─────────────────────────────────────────────────────────────────────────────

import { politeFetch } from './http.js';
import log from './log.js';

const DEFAULT_SITE = (process.env.LUKOIL_SITE || 'https://lukoil.lubribase.ru').replace(/\/+$/, '');
export const CATEGORY_GROUP = Number(process.env.LUKOIL_CATEGORY_GROUP || 2); // 2 = легковые

function parseGon(html) {
    const tk = html.match(/gon\.req_tk="([^"]*)"/);
    const url = html.match(/gon\.lubribase_url="([^"]*)"/);
    const loc = html.match(/gon\.locale="([^"]*)"/);
    const sym = html.match(/gon\.site_symbol="([^"]*)"/);
    if (!tk) throw new Error('на лендинге не найден gon.req_tk (токен)');
    const tkb64 = tk[1].replace(/\\n/g, '');
    const auth = Buffer.from(tkb64, 'base64').toString('utf8'); // «Bearer eyJ…»
    const base = (url ? url[1] : 'https://api.lubribase.ru/').replace(/\/+$/, '');
    const locale = loc ? loc[1] : 'ru';
    return { auth, tkb64, apiBase: `${base}/${locale}/api/v1`, locale, symbol: sym ? sym[1] : 'lukoil', at: Date.now() };
}

export function createLukoilClient({ siteBase = DEFAULT_SITE } = {}) {
    const session = { auth: null, tkb64: null, apiBase: null, locale: 'ru', symbol: 'lukoil', at: 0 };

    async function refreshSession() {
        const res = await politeFetch(`${siteBase}/ru/lukoil`, {
            headers: { Accept: 'text/html', 'Accept-Language': 'ru-RU,ru;q=0.9', Referer: `${siteBase}/` },
        });
        if (res.status !== 200) throw new Error(`лендинг вернул HTTP ${res.status}`);
        Object.assign(session, parseGon(await res.text()));
        log.debug(`сессия обновлена: apiBase=${session.apiBase}, symbol=${session.symbol}`);
    }

    async function ensureSession() {
        // Токен живёт недолго — обновляем при отсутствии или раз в ~5 минут.
        if (!session.auth || Date.now() - session.at > 5 * 60 * 1000) await refreshSession();
    }

    async function getJson(pathPart, { retryAuth = true } = {}) {
        await ensureSession();
        const res = await politeFetch(`${session.apiBase}${pathPart}`, {
            headers: { Authorization: session.auth, Accept: 'application/json', Referer: `${siteBase}/` },
        });
        if ((res.status === 401 || res.status === 403) && retryAuth) {
            log.warn(`API ${res.status} — обновляю токен и повторяю`);
            await refreshSession();
            return getJson(pathPart, { retryAuth: false });
        }
        const text = await res.text();
        if (res.status !== 200) throw new Error(`API ${res.status} на ${pathPart}: ${text.slice(0, 120)}`);
        try { return JSON.parse(text); }
        catch { throw new Error(`API вернул не-JSON на ${pathPart}`); }
    }

    async function getRecommendationHtml(mid) {
        await ensureSession();
        const url = `${siteBase}/${session.locale}/${session.symbol}/0`
            + `?mid=${encodeURIComponent(mid)}&session=${encodeURIComponent(session.tkb64)}`;
        const res = await politeFetch(url, {
            headers: { Accept: 'text/html', 'Accept-Language': 'ru-RU,ru;q=0.9', Referer: `${siteBase}/` },
        });
        const html = res.status === 200 ? await res.text() : '';
        return { url, status: res.status, html, ok: res.status === 200 && /component_type_header_/i.test(html) };
    }

    // Список легковых марок [{ id, name }].
    async function listManufacturers() {
        const r = await getJson(`/category_groups/${CATEGORY_GROUP}/manufacturers`);
        return r.results || [];
    }

    // Все модификации марки одним запросом.
    async function listEquipment(manufacturerId) {
        const r = await getJson(`/category_groups/${CATEGORY_GROUP}/manufacturers/${manufacturerId}/equipment/`);
        return r.results || [];
    }

    // Стабильная (без токена) ссылка выбора для source_links.
    function sourceUrl(manufacturerId, modelStr) {
        const vol = String(modelStr || '').match(/\d+\.\d+/)?.[0] || '';
        return `${siteBase}/${session.locale}/${session.symbol}`
            + `?category_group_id=${CATEGORY_GROUP}&manufacturer_id=${manufacturerId}`
            + (vol ? `&engine_volume=${encodeURIComponent(vol)}` : '');
    }

    return { session, siteBase, ensureSession, refreshSession, getJson,
             getRecommendationHtml, listManufacturers, listEquipment, sourceUrl };
}
