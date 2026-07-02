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

// Настройки (для продакшена поменять и добавить хост в @connect в header.txt)
const API_BASE = 'https://cars-db-backend.onrender.com';
const API_KEY  = 'a56817cfece2ca6ad4bfdf7c2a7b83e1df99184d09daf574';
const SITE_URL = 'https://alwaysnevereat.github.io/scripts';

const CHECK_INTERVAL_MS = 1500;   // опрос смены URL (SPA-навигация Mann)

// cacheKey → 'pending' | 'notfound' | carRecord — чтобы не долбить API
const checked = new Map();

function apiMatch(car) {
    const params = new URLSearchParams();
    if (car.engineCode) params.set('engine_code', car.engineCode);
    if (car.makeShort)  params.set('brand', car.makeShort);
    if (car.modelShort) params.set('model', car.modelShort);
    if (car.yearFrom)   params.set('year', String(car.yearFrom));
    if (car.volume)     params.set('volume', String(car.volume));

    return new Promise((resolve) => {
        GM_xmlhttpRequest({
            method: 'GET',
            url: `${API_BASE}/api/cars/match?${params}`,
            headers: { 'x-api-key': API_KEY },
            timeout: 10000,
            onload: (resp) => {
                if (resp.status === 200) {
                    try { resolve(JSON.parse(resp.responseText)); return; } catch {}
                }
                resolve(null); // 404 и любые ошибки — молчим
            },
            onerror:   () => resolve(null),
            ontimeout: () => resolve(null),
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

    const state = checked.get(car.cacheKey);
    if (state === 'pending' || state === 'notfound') return;
    if (state && typeof state === 'object') {
        if (!checked.get('dismissed_' + state.id) && !document.getElementById('spot-db-banner')) {
            showBanner(state);
        }
        return;
    }

    checked.set(car.cacheKey, 'pending');
    const record = await apiMatch(car);
    if (record && record.id) {
        checked.set(car.cacheKey, record);
        if (!checked.get('dismissed_' + record.id)) showBanner(record);
    } else {
        checked.set(car.cacheKey, 'notfound');
        removeBanner();
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
