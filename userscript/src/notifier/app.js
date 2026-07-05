// ─────────────────────────────────────────────────────────────────────────────
// SPOT DB Notifier — лёгкий юзерскрипт для коллег.
// Видит машину на сайте подбора (Mann Filter / LYNXauto) → спрашивает базу
// рассчитанных машин → показывает баннер «✓ эта машина уже рассчитана».
// Клик по баннеру открывает страницу машины на нашем сайте со всеми данными.
//
// Никакого калькулятора внутри нет — если у тебя стоит основной
// «Mann + Motul Oil Calculator», этот скрипт не нужен.
// ─────────────────────────────────────────────────────────────────────────────

import { parseMannUrl } from '../parsers.js';
import { sourceSignature } from '../../../shared/sourceLinks.js';

// Настройки (для продакшена поменять и добавить хост в @connect в header.txt)
const API_BASE = 'https://cars-db-backend.onrender.com';
const API_KEY  = 'a56817cfece2ca6ad4bfdf7c2a7b83e1df99184d09daf574';
const SITE_URL = 'https://alwaysnevereat.github.io/scripts';

const CHECK_INTERVAL_MS = 1500;   // опрос смены URL (SPA-навигация Mann)

// Бэкенд на бесплатном Render засыпает и просыпается до минуты —
// таймаут должен пережить холодный старт, а сбои надо переспрашивать.
const REQUEST_TIMEOUT_MS = 60000;
const RETRY_DELAYS_MS    = [5000, 15000, 30000];
const NOTFOUND_TTL_MS    = 5 * 60 * 1000; // машину могли рассчитать только что

// cacheKey → 'pending' | {notFoundAt} | {record} ; dismissed_<id> → true
const checked = new Map();
const retries = new Map();  // cacheKey → число сделанных повторов

function apiMatch(car) {
    // Матчим ТОЛЬКО по сурс-ссылке: сигнатура текущей страницы (mann:type:…,
    // lynx:…) устойчива к «мусорным» id в URL. Если ссылка совпала с базой —
    // это та самая машина; фаззи-подбор по марке/модели больше не нужен.
    const sig = sourceSignature(location.href);
    if (!sig) return Promise.resolve({ status: 'notfound' });
    const params = new URLSearchParams();
    params.set('source_key', sig);

    return new Promise((resolve) => {
        GM_xmlhttpRequest({
            method: 'GET',
            url: `${API_BASE}/api/cars/match?${params}`,
            headers: { 'x-api-key': API_KEY },
            timeout: REQUEST_TIMEOUT_MS,
            onload: (resp) => {
                if (resp.status === 200) {
                    try {
                        const record = JSON.parse(resp.responseText);
                        if (record && record.id) { resolve({ status: 'found', record }); return; }
                    } catch {}
                    resolve({ status: 'error' });
                    return;
                }
                if (resp.status === 404) { resolve({ status: 'notfound' }); return; }
                resolve({ status: 'error' }); // 5xx и прочее — временный сбой
            },
            onerror:   () => resolve({ status: 'error' }),
            ontimeout: () => resolve({ status: 'error' }),
        });
    });
}

function removeBanner() {
    const el = document.getElementById('spot-db-banner');
    if (el) el.remove();
}

function showBanner(record) {
    removeBanner();
    const carUrl = `${SITE_URL}/#/car/${record.id}`;
    const title = [record.brand, record.model, record.engine_name || record.engine_volume]
        .filter(Boolean).join(' ');

    const el = document.createElement('div');
    el.id = 'spot-db-banner';
    el.innerHTML = `
        <div class="sdb-check">✓</div>
        <div class="sdb-text">
            <div class="sdb-title">Эта машина уже рассчитана</div>
            <div class="sdb-sub">${escapeHtml(title)} — открыть расчёт ↗</div>
        </div>
        <button class="sdb-close" title="Скрыть">✕</button>
    `;
    el.style.cssText = `
        position:fixed;bottom:18px;left:18px;z-index:2147483647;
        display:flex;align-items:center;gap:10px;
        background:#0f1117;color:#e8eaf6;border:1px solid #43a047;border-radius:12px;
        padding:12px 16px;font:13px Arial;cursor:pointer;
        box-shadow:0 8px 32px rgba(0,0,0,.55);max-width:340px`;

    if (!document.getElementById('spot-db-style')) {
        const st = document.createElement('style');
        st.id = 'spot-db-style';
        st.textContent = `
            #spot-db-banner:hover{border-color:#66bb6a;box-shadow:0 8px 32px rgba(67,160,71,.35)}
            #spot-db-banner .sdb-check{width:28px;height:28px;border-radius:50%;flex:none;
                background:#1b5e20;color:#a5d6a7;display:flex;align-items:center;
                justify-content:center;font-size:16px;font-weight:bold}
            #spot-db-banner .sdb-title{font-weight:bold;color:#81c784}
            #spot-db-banner .sdb-sub{font-size:11px;color:#9aa0b0;margin-top:2px}
            #spot-db-banner .sdb-close{background:none;border:none;color:#5a6070;
                cursor:pointer;font-size:13px;padding:4px;flex:none}
            #spot-db-banner .sdb-close:hover{color:#e8eaf6}
        `;
        document.head.appendChild(st);
    }

    el.querySelector('.sdb-close').onclick = (e) => {
        e.stopPropagation();
        checked.set('dismissed_' + record.id, true);
        removeBanner();
    };
    el.onclick = () => window.open(carUrl, '_blank');
    document.body.appendChild(el);
}

async function checkCurrentCar() {
    const car = parseMannUrl();
    if (!car) { removeBanner(); return; }

    const key = car.cacheKey;
    const state = checked.get(key);
    if (state === 'pending') return;
    if (state && state.record) {
        if (!checked.get('dismissed_' + state.record.id) && !document.getElementById('spot-db-banner')) {
            showBanner(state.record);
        }
        return;
    }
    if (state && state.notFoundAt && Date.now() - state.notFoundAt < NOTFOUND_TTL_MS) return;

    checked.set(key, 'pending');
    const res = await apiMatch(car);

    if (res.status === 'found') {
        retries.delete(key);
        checked.set(key, { record: res.record });
        if (!checked.get('dismissed_' + res.record.id)) showBanner(res.record);
        return;
    }

    removeBanner();

    if (res.status === 'notfound') {
        retries.delete(key);
        checked.set(key, { notFoundAt: Date.now() });
        return;
    }

    // Сеть/таймаут/5xx: не записываем «нет в базе», пробуем ещё раз —
    // типовой случай это спящий Render, который к повтору уже проснётся.
    checked.delete(key);
    const attempt = retries.get(key) || 0;
    if (attempt < RETRY_DELAYS_MS.length) {
        retries.set(key, attempt + 1);
        setTimeout(() => {
            const cur = parseMannUrl();
            if (cur && cur.cacheKey === key) checkCurrentCar();
        }, RETRY_DELAYS_MS[attempt]);
    }
}

if (typeof location !== 'undefined' && typeof document !== 'undefined') {
    let lastUrl = location.href;
    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            removeBanner();
            checkCurrentCar();
        }
    }, CHECK_INTERVAL_MS);
    checkCurrentCar();
}

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
        '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[c]));
}
