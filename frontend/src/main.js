import { initCalculator } from './calculator.js';

// ── API config ────────────────────────────────────────────────────────────────
// In dev, Vite proxies /api → localhost:3001 so no key needed in the URL.
// In production build, these are injected by vite.config.js define().
const API_BASE = (typeof __API_BASE__ !== 'undefined' && __API_BASE__) ? __API_BASE__ : '';
const API_KEY  = (typeof __API_KEY__  !== 'undefined' && __API_KEY__)  ? __API_KEY__  : '';

async function apiFetch(path) {
    const headers = API_KEY ? { 'x-api-key': API_KEY } : {};
    const res = await fetch(API_BASE + path, { headers });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
}

// ── Search ────────────────────────────────────────────────────────────────────
const searchInput   = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const pageSearch    = document.getElementById('page-search');
const pageCalc      = document.getElementById('page-calc');

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
                ${car.fuel_type ? ' · ' + esc(car.fuel_type) : ''}
            </div>
        </div>
    `).join('');

    searchResults.querySelectorAll('.car-card').forEach(card => {
        card.onclick = () => openCar(card.dataset.id);
    });
}

async function openCar(id) {
    try {
        const car = await apiFetch('/api/cars/' + id);
        searchResults.innerHTML = '';
        searchInput.value = '';
        pageSearch.classList.add('hidden');
        pageCalc.classList.remove('hidden');
        initCalculator(car, () => {
            pageCalc.classList.add('hidden');
            pageSearch.classList.remove('hidden');
        });
    } catch (e) {
        alert('Не удалось загрузить данные: ' + e.message);
    }
}

// ── Back button ───────────────────────────────────────────────────────────────
document.getElementById('btn-back').onclick = () => {
    pageCalc.classList.add('hidden');
    pageSearch.classList.remove('hidden');
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
