import { initCarPage } from './carPage.js';
import { startSphere } from './sphere.js';
import { bootScreen } from './bootScreen.js';
import { SOURCE_SITES, SOURCE_LABELS } from '../../shared/sourceLinks.js';

// ── API config ────────────────────────────────────────────────────────────────
// In dev, Vite proxies /api → localhost:3001 so no key needed in the URL.
// In production build, these are injected by vite.config.js define().
const API_BASE = (typeof __API_BASE__ !== 'undefined' && __API_BASE__) ? __API_BASE__ : '';
const API_KEY  = (typeof __API_KEY__  !== 'undefined' && __API_KEY__)  ? __API_KEY__  : '';

export async function apiFetch(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (API_KEY) headers['x-api-key'] = API_KEY;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(API_BASE + path, {
        method, headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error((json && json.error) || `API ${res.status}`);
    return json;
}

// ── Hash routing ──────────────────────────────────────────────────────────────
//   #/            — поиск
//   #/car/:id     — страница машины (прямая ссылка переживает F5)

const pageSearch = document.getElementById('page-search');
const pageCalc   = document.getElementById('page-calc');

async function renderRoute() {
    const m = location.hash.match(/^#\/car\/([0-9a-f-]{10,})/i);
    if (m) {
        pageSearch.classList.add('hidden');
        pageCalc.classList.remove('hidden');
        try {
            const record = await apiFetch('/api/cars/' + m[1]);
            initCarPage(record, { apiFetch, onChanged: () => renderRoute() });
        } catch (e) {
            document.getElementById('car-head').innerHTML =
                `<div class="search-empty">Не удалось загрузить машину: ${esc(e.message)}</div>`;
            document.getElementById('calc-main').innerHTML = '';
        }
    } else {
        pageCalc.classList.add('hidden');
        pageSearch.classList.remove('hidden');
        searchInput.focus();
    }
}

// ── Search ────────────────────────────────────────────────────────────────────
const searchInput   = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');

let searchTimer = null;

searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (!q) { searchResults.innerHTML = ''; return; }
    searchTimer = setTimeout(() => doSearch(q), 250);
});

async function doSearch(q) {
    try {
        const results = await apiFetch('/api/cars/search?q=' + encodeURIComponent(q));
        renderResults(results);
    } catch {
        searchResults.innerHTML = '<div class="search-empty">Ошибка подключения к серверу</div>';
    }
}

function renderResults(cars) {
    if (!cars.length) {
        searchResults.innerHTML = '<div class="search-empty">К сожалению, такой машины ещё нет в базе</div>';
        return;
    }
    searchResults.innerHTML = cars.map(car => `
        <div class="car-card" data-id="${car.id}">
            <div class="car-card-title">
                ${esc(car.brand)} ${esc(car.model)}
                ${car.generation ? ' · ' + esc(car.generation) : ''}
                ${car.engine_code ? ' · ' + esc(car.engine_code) : ''}
            </div>
            <div class="car-card-sub">
                ${car.engine_volume ? car.engine_volume + 'л' : ''}
                ${car.kw ? ' · ' + car.kw + 'кВт' : ''}
                ${car.bhp ? ' / ' + car.bhp + 'л.с.' : ''}
                ${car.year_from ? ' · ' + car.year_from + (car.year_to ? '–' + car.year_to : '+') : ''}
            </div>
        </div>
    `).join('');

    searchResults.querySelectorAll('.car-card').forEach(card => {
        card.onclick = () => {
            searchResults.innerHTML = '';
            searchInput.value = '';
            location.hash = '#/car/' + card.dataset.id;
        };
    });
}

// ── Back button ───────────────────────────────────────────────────────────────
document.getElementById('btn-back').onclick = () => { location.hash = '#/'; };

// ── Временный полный список машин ─────────────────────────────────────────────
// Нужен, пока дозаполняем старые машины сурс-ссылками. Порядок стабильный
// (backend отдаёт по brand, model, year_from), строки пронумерованы. Убрать
// вместе с кнопкой #btn-list-all, когда все ссылки проставлены.
const listToggle = document.getElementById('btn-list-all');
const listBox = document.getElementById('list-all');
let listLoaded = false;

async function fetchAllCars() {
    const limit = 100;
    let page = 1, all = [], total = Infinity;
    while (all.length < total) {
        const res = await apiFetch(`/api/cars?page=${page}&limit=${limit}`);
        total = res.total;
        all = all.concat(res.data);
        if (!res.data.length) break;
        page += 1;
    }
    return all;
}

function renderAllCars(cars) {
    const rows = cars.map((car, i) => {
        const links = car.source_links || {};
        const present = SOURCE_SITES.filter(s => links[s]);
        const tags = present.length
            ? present.map(s => `<span class="list-all-tag">${esc(SOURCE_LABELS[s])}</span>`).join('')
            : '<span class="list-all-none">нет ссылок</span>';
        const name = [car.brand, car.model, car.generation].filter(Boolean).join(' ');
        const sub = [
            car.engine_code, car.engine_volume ? car.engine_volume + 'л' : '',
            car.year_from ? car.year_from + (car.year_to ? '–' + car.year_to : '+') : '',
        ].filter(Boolean).join(' · ');
        return `
            <div class="list-all-row" data-id="${car.id}">
                <span class="list-all-num">${i + 1}.</span>
                <span class="list-all-name">${esc(name)}${sub ? ` <span class="mono">${esc(sub)}</span>` : ''}</span>
                <span class="list-all-links">${tags}</span>
            </div>`;
    }).join('');
    const withLinks = cars.filter(c => SOURCE_SITES.some(s => (c.source_links || {})[s])).length;
    listBox.innerHTML =
        `<div class="list-all-head">Всего ${cars.length} · со ссылками ${withLinks} · без ссылок ${cars.length - withLinks}</div>` +
        (rows || '<div class="search-empty">База пуста</div>');
    listBox.querySelectorAll('.list-all-row').forEach(row => {
        row.onclick = () => { location.hash = '#/car/' + row.dataset.id; };
    });
}

if (listToggle) listToggle.onclick = async () => {
    if (!listBox.classList.contains('hidden')) { listBox.classList.add('hidden'); return; }
    listBox.classList.remove('hidden');
    if (!listLoaded) {
        listBox.innerHTML = '<div class="search-empty">Загрузка…</div>';
        try {
            renderAllCars(await fetchAllCars());
            listLoaded = true;
        } catch (e) {
            listBox.innerHTML = `<div class="search-empty">Ошибка загрузки: ${esc(e.message)}</div>`;
        }
    }
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// Сфера из машин, которые уже есть в базе (до 50 случайных)
async function loadSphere() {
    const canvas = document.getElementById('sphere-canvas');
    if (!canvas) return;
    try {
        const cars = await apiFetch('/api/cars/random?limit=50');
        if (!cars.length) return;
        const nodes = cars.map(c => ({
            id: c.id,
            label: [c.brand, c.model, c.generation].filter(Boolean).join(' '),
        }));
        startSphere(canvas, nodes, id => { location.hash = '#/car/' + id; });
    } catch { /* сфера — украшение, без неё страшного нет */ }
}

// ── Старт ─────────────────────────────────────────────────────────────────────
// Сначала boot-экран ждёт, пока бэкенд на Render проснётся (/health),
// и только потом запускаем роутинг и загрузку данных.
bootScreen((API_BASE || '') + '/health').then(() => {
    window.addEventListener('hashchange', renderRoute);
    renderRoute();
    loadSphere();
});
