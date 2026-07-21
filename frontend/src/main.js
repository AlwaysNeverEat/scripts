import { initCarPage } from './carPage.js';
import { startSphere } from './sphere.js';
import { bootScreen } from './bootScreen.js';
import { initAuthGate } from './authGate.js';
import { initProfilePage } from './profile.js';
import { initPublicProfilePage } from './publicProfile.js';
import { initTopModal } from './top.js';
import { initAchievements } from './achievements.js';
import { initTagSearch } from './tagSearch.js';
import { initScriptsFeed } from './scriptsFeed.js';
import { rankCars, prepareCars } from '../../shared/carSearch.js';

// ── API config ────────────────────────────────────────────────────────────────
// In dev, Vite proxies /api → localhost:3001 so no key needed in the URL.
// In production build, these are injected by vite.config.js define().
const API_BASE = (typeof __API_BASE__ !== 'undefined' && __API_BASE__) ? __API_BASE__ : '';
const API_KEY  = (typeof __API_KEY__  !== 'undefined' && __API_KEY__)  ? __API_KEY__  : '';

// ── Сессия ────────────────────────────────────────────────────────────────────
// Токен хранится в localStorage; поверх x-api-key (грубый гейт) шлём
// Authorization: Bearer <token> — это личность залогиненного пользователя.
const TOKEN_KEY = 'cars_db_session_token';
let sessionToken = localStorage.getItem(TOKEN_KEY) || '';
let currentUser = null;
// true только после успешного входа — пока не залогинились, 401 от /me или
// от самого /login не должен трактоваться как "сессия протухла на лету".
let unlocked = false;

function setToken(token) {
    sessionToken = token || '';
    if (sessionToken) localStorage.setItem(TOKEN_KEY, sessionToken);
    else localStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch(path, { method = 'GET', body, isMultipart = false } = {}) {
    const headers = {};
    if (API_KEY) headers['x-api-key'] = API_KEY;
    if (sessionToken) headers['Authorization'] = 'Bearer ' + sessionToken;

    let fetchBody;
    if (isMultipart) {
        fetchBody = body; // FormData — браузер сам проставит Content-Type с boundary
    } else if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        fetchBody = JSON.stringify(body);
    }

    const res = await fetch(API_BASE + path, { method, headers, body: fetchBody });

    if (res.status === 401 && unlocked) {
        // Полночь МСК (или бан) разлогинили нас посреди работы — назад к гейту.
        unlocked = false;
        setToken('');
        currentUser = null;
        showGate('Сессия истекла — войдите заново');
        throw new Error('сессия истекла');
    }

    const json = await res.json().catch(() => null);
    if (!res.ok) {
        // error бывает строкой (старые роуты) или объектом {code, message} (CRM-прокси)
        const errVal = json && json.error;
        const isObj = errVal && typeof errVal === 'object';
        const err = new Error((isObj ? (errVal.message || errVal.code) : errVal) || `API ${res.status}`);
        if (isObj && errVal.code) err.code = errVal.code;
        throw err;
    }
    return json;
}

// ── Гейт входа/регистрации ──────────────────────────────────────────────────
// Без валидной сессии не видно ничего, кроме экрана входа/регистрации.

const pageAuth    = document.getElementById('page-auth');
const pageSearch  = document.getElementById('page-search');
const pageCalc    = document.getElementById('page-calc');
const pageProfile = document.getElementById('page-profile');

function hideAllPages() {
    pageAuth.classList.add('hidden');
    pageSearch.classList.add('hidden');
    pageCalc.classList.add('hidden');
    pageProfile.classList.add('hidden');
}

function showGate(message) {
    hideAllPages();
    pageAuth.classList.remove('hidden');
    initAuthGate({
        apiFetch,
        message,
        onLoggedIn: (user, token) => {
            setToken(token);
            currentUser = user;
            enterApp();
        },
    });
}

function enterApp() {
    unlocked = true;
    hideAllPages();
    renderUserBar();
    initTopModal({ apiFetch });
    initScriptsFeed(); // кнопка + фид юзерскриптов справа снизу на поиске
    initAchievements({ apiFetch }); // стим-тосты о новых ачивках (см. achievements.js)
    window.addEventListener('hashchange', renderRoute);
    renderRoute();
    loadSnapshot();   // прогреваем базу для поиска и тегов
    loadSphere();
}

function renderUserBar() {
    const img = document.getElementById('avatar-img');
    const defaultIcon = document.querySelector('#btn-avatar .avatar-default-icon');
    if (currentUser && currentUser.avatar) {
        img.src = currentUser.avatar;
        img.hidden = false;
        defaultIcon.hidden = true;
    } else {
        img.hidden = true;
        defaultIcon.hidden = false;
    }
}

document.getElementById('btn-avatar').onclick = () => { location.hash = '#/profile'; };

// ── Hash routing ──────────────────────────────────────────────────────────────
//   #/            — поиск
//   #/car/:id     — страница машины (прямая ссылка переживает F5)
//   #/profile     — свой профиль (редактируемый)
//   #/user/:id    — чужой профиль (read-only, из топа/ленты машины)

async function renderRoute() {
    const carMatch = location.hash.match(/^#\/car\/([0-9a-f-]{10,})/i);
    const userMatch = location.hash.match(/^#\/user\/([0-9a-f-]{10,})/i);
    const isProfile = location.hash === '#/profile';

    if (isProfile) {
        pageSearch.classList.add('hidden');
        pageCalc.classList.add('hidden');
        pageProfile.classList.remove('hidden');
        await initProfilePage({
            apiFetch,
            user: currentUser,
            onUserChanged: (user) => { currentUser = user; renderUserBar(); },
            onLogout: () => {
                unlocked = false;
                setToken('');
                currentUser = null;
                location.hash = '#/';
                showGate();
            },
        });
    } else if (userMatch) {
        // Клик по самому себе (в топе, в фиде машины) — открываем свой
        // редактируемый профиль, а не свою «зрительскую» страницу.
        if (currentUser && userMatch[1] === currentUser.id) {
            location.hash = '#/profile';
            return;
        }
        pageSearch.classList.add('hidden');
        pageCalc.classList.add('hidden');
        pageProfile.classList.remove('hidden');
        await initPublicProfilePage({ apiFetch, userId: userMatch[1], viewer: currentUser });
    } else if (carMatch) {
        pageProfile.classList.add('hidden');
        pageSearch.classList.add('hidden');
        pageCalc.classList.remove('hidden');
        try {
            const record = await apiFetch('/api/cars/' + carMatch[1]);
            initCarPage(record, { apiFetch, user: currentUser, onChanged: () => renderRoute() });
        } catch (e) {
            document.getElementById('car-head').innerHTML =
                `<div class="search-empty">Не удалось загрузить машину: ${esc(e.message)}</div>`;
            document.getElementById('calc-main').innerHTML = '';
            document.getElementById('crm-panel').innerHTML = '';
        }
    } else {
        pageProfile.classList.add('hidden');
        pageCalc.classList.add('hidden');
        pageSearch.classList.remove('hidden');
        searchInput.focus();
    }
}

// ── Снимок базы (мгновенный поиск и теги) ──────────────────────────────────────
// Тянем всю (небольшую) базу один раз и фильтруем в браузере — никакой сети на
// каждый символ/клик. Обновляем не чаще раза в минуту и при возврате на вкладку.
const SNAPSHOT_TTL_MS = 60_000;
let snapshot = { version: null, cars: [] };
let snapshotFetchedAt = 0;
let snapshotPromise = null;

function loadSnapshot(force = false) {
    const fresh = snapshot.cars.length && (Date.now() - snapshotFetchedAt < SNAPSHOT_TTL_MS);
    if (!force && fresh) return Promise.resolve(snapshot);
    if (!snapshotPromise) {
        snapshotPromise = apiFetch('/api/cars/index')
            .then(data => {
                // Храним сырые машины: search_text и триграммы досчитывает воркер
                // (или ленивый fallback) — главный поток снимок не обсчитывает.
                snapshot = { version: data.version, cars: data.cars || [] };
                snapshotFetchedAt = Date.now();
                postSnapshotToWorker();
                return snapshot;
            })
            .finally(() => { snapshotPromise = null; });
    }
    return snapshotPromise;
}

// Обновляем снимок при возврате на вкладку (не чаще, чем раз в TTL).
document.addEventListener('visibilitychange', () => { if (!document.hidden && unlocked) loadSnapshot(); });
window.addEventListener('focus', () => { if (unlocked) loadSnapshot(); });

// ── Search ────────────────────────────────────────────────────────────────────
const searchInput   = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');

// Скоринг ~15к машин живёт в воркере — главный поток не блокируется даже на
// слабом железе. Если воркер не поднялся (старый браузер), работает синхронный
// fallback по prepared-снимку + дебаунс.
const MIN_QUERY_LEN = 2;        // 1 символ — самый дорогой и бессмысленный запрос
const SEARCH_DEBOUNCE_MS = 150;
let searchDebounceTimer = 0;
let searchGen = 0;              // растёт на каждый ввод; рендерим только свежее
let pendingQuery = null;        // запрос, пришедший пока воркер готовит снимок

let searchWorker = null;
let workerReady = false;        // воркер получил и подготовил текущий снимок
let workerPostedVersion = null;
let preparedFallback = null;    // ленивый prepareCars для пути без воркера
let preparedFallbackVersion = null;

try {
    searchWorker = new Worker(new URL('./searchWorker.js', import.meta.url), { type: 'module' });
    searchWorker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'ready') {
            workerReady = true;
            if (pendingQuery) { const q = pendingQuery; pendingQuery = null; runLocalSearch(q); }
        } else if (msg.type === 'results') {
            // Устаревший ответ (ввод уже изменился) молча выбрасываем.
            if (msg.gen !== searchGen || searchInput.value.trim() !== msg.q) return;
            renderResults(msg.cars);
        }
    };
    searchWorker.onerror = () => {
        searchWorker = null;
        workerReady = false;
        const q = searchInput.value.trim();
        if (q.length >= MIN_QUERY_LEN) runLocalSearch(q);
    };
} catch { searchWorker = null; }

function postSnapshotToWorker() {
    if (!searchWorker || !snapshot.cars.length) return;
    if (snapshot.version != null && snapshot.version === workerPostedVersion) return;
    workerPostedVersion = snapshot.version;
    workerReady = false;
    searchWorker.postMessage({ type: 'snapshot', version: snapshot.version, cars: snapshot.cars });
}

searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    clearTimeout(searchDebounceTimer);
    searchGen++;          // всё, что сейчас в полёте, устарело
    pendingQuery = null;
    if (!q) { searchResults.innerHTML = ''; return; }
    if (q.length < MIN_QUERY_LEN) {
        searchResults.innerHTML = '<div class="search-empty">Введите ещё хотя бы один символ…</div>';
        return;
    }
    searchDebounceTimer = setTimeout(() => runLocalSearch(q), SEARCH_DEBOUNCE_MS);
});

async function runLocalSearch(q) {
    if (!snapshot.cars.length) {
        searchResults.innerHTML = '<div class="search-empty">Загрузка базы…</div>';
        try { await loadSnapshot(); }
        catch { searchResults.innerHTML = '<div class="search-empty">Ошибка подключения к серверу</div>'; return; }
        // Пока грузилось, ввод мог измениться — не перетираем более свежий запрос.
        if (searchInput.value.trim() !== q) return;
    }
    if (searchWorker) {
        if (!workerReady) { pendingQuery = q; return; }  // выполнится по 'ready'
        searchWorker.postMessage({ type: 'query', q, gen: searchGen });
        return;
    }
    // Fallback без воркера: prepared-снимок считаем один раз на версию.
    if (!preparedFallback || preparedFallbackVersion !== snapshot.version) {
        preparedFallback = prepareCars(snapshot.cars);
        preparedFallbackVersion = snapshot.version;
    }
    renderResults(rankCars(q, preparedFallback));
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
document.getElementById('btn-profile-back').onclick = () => { location.hash = '#/'; };

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// Сфера из машин, которые уже есть в базе (до 50 случайных). Контроллер
// сохраняем в module-level переменную — режим «Теги» (tagSearch.js) дальше
// подменяет её узлы по мере выбора марки/модели/объёма и прячет сферу,
// когда подходящих машин остаётся мало.
let sphereController = null;

function carNode(c) {
    return { id: c.id, label: [c.brand, c.model, c.generation].filter(Boolean).join(' ') };
}

// Случайная выборка узлов для сферы — из снимка, без обращения к серверу.
function sampleNodes(limit = 50) {
    const arr = snapshot.cars.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, limit).map(carNode);
}

async function loadSphere() {
    const canvas = document.getElementById('sphere-canvas');
    if (!canvas) return;
    try {
        await loadSnapshot();
        const nodes = sampleNodes();
        if (!nodes.length) return;
        sphereController = startSphere(canvas, nodes);
    } catch { /* сфера — украшение, без неё страшного нет */ }
}

// ── Переключатель «Поиск / Теги» ────────────────────────────────────────────
const modeBtnSearch = document.getElementById('mode-btn-search');
const modeBtnTags   = document.getElementById('mode-btn-tags');
const searchBoxEl   = document.querySelector('.search-box');
const tagSearchEl   = document.getElementById('tag-search');

const tagSearch = initTagSearch({
    getCars: () => loadSnapshot().then(s => s.cars),
    onPick: id => {
        searchResults.innerHTML = '';
        location.hash = '#/car/' + id;
    },
    sphere: {
        setNodes: nodes => sphereController?.setNodes(nodes),
        setVisible: v => sphereController?.setVisible(v),
        resetRandom() {
            try { sphereController?.setNodes(sampleNodes()); }
            catch { /* сфера — украшение, без неё страшного нет */ }
        },
    },
});

function setSearchMode(mode) {
    const isTags = mode === 'tags';
    modeBtnSearch.classList.toggle('active', !isTags);
    modeBtnTags.classList.toggle('active', isTags);
    searchBoxEl.classList.toggle('hidden', isTags);
    searchResults.classList.toggle('hidden', isTags);
    tagSearchEl.classList.toggle('hidden', !isTags);
    if (isTags) {
        tagSearch.activate();
    } else {
        tagSearch.deactivate();
    }
}

modeBtnSearch.onclick = () => setSearchMode('search');
modeBtnTags.onclick = () => setSearchMode('tags');

// ── Старт ─────────────────────────────────────────────────────────────────────
// Boot-экран ждёт пробуждения бэкенда (/health), а затем — пока оверлей ещё
// виден — прогоняет bootPrepare: проверяет сессию и грузит снимок базы. Всё,
// что раньше «доподгружалось» уже в приложении (и мигало), теперь готово к
// моменту скрытия лоадера. Строки лога показывают реальный прогресс.
async function bootPrepare(log) {
    const authLine = log.line('Authenticating session...');
    try {
        const me = await apiFetch('/api/auth/me');
        currentUser = me.user;
        log.set(authLine, 'Authenticating session... OK');
    } catch {
        log.set(authLine, 'No active session — login required');
        return { authed: false };
    }
    const dbLine = log.line('Loading vehicle database...');
    try {
        const snap = await loadSnapshot();
        log.set(dbLine, `Vehicle database loaded — ${snap.cars.length} entries`);
    } catch {
        log.set(dbLine, 'Vehicle database unavailable — will retry in app');
    }
    return { authed: true };
}

bootScreen((API_BASE || '') + '/health', { prepare: bootPrepare }).then(async (result) => {
    if (result && result.authed) {
        enterApp();
    } else if (result && result.authed === false) {
        showGate();
    } else {
        // Skip-путь: юзер нажал «Continue» до пробуждения сервера — как раньше.
        try {
            const me = await apiFetch('/api/auth/me');
            currentUser = me.user;
            enterApp();
        } catch {
            showGate();
        }
    }
});
