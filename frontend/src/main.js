import { initCarPage } from './carPage.js';
import { startSphere } from './sphere.js';
import { bootScreen } from './bootScreen.js';
import { fetchRetry } from './netRetry.js';
import { startKeepAlive } from './keepAlive.js';
import { connectApi, getApiBase, apiCandidates } from './apiBase.js';
import { initAuthGate } from './authGate.js';
import { initProfilePage } from './profile.js';
import { initPublicProfilePage } from './publicProfile.js';
import { showTopPage, resetTopCache } from './top.js';
import { initAchievements } from './achievements.js';
import { initTagSearch } from './tagSearch.js';
import { initScriptsFeed } from './scriptsFeed.js';
import { rankCars, prepareCars } from '../../shared/carSearch.js';
import { carCardInner } from './carCard.js';

// ── API config ────────────────────────────────────────────────────────────────
// In dev, Vite proxies /api → localhost:3001 so no key needed in the URL.
// In production build, these are injected by vite.config.js define().
// Адрес бэкенда не константа: у сервера несколько имён, и рабочее выбирается на
// старте гонкой пингов — см. apiBase.js.
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

    const res = await fetchRetry(getApiBase() + path, { method, headers, body: fetchBody });

    const json = await res.json().catch(() => null);

    if (res.status === 401 && unlocked) {
        // 401 прилетает из двух разных мест, и путать их нельзя:
        //   requireSession → 'invalid or expired session' — полночь МСК или бан,
        //     сессии правда конец, гасим токен и уводим на гейт;
        //   гейт x-api-key в index.js → 'invalid or missing x-api-key' — это
        //     проблема деплоя (ключ на Render разъехался с ключом в сборке), а
        //     токен юзера при этом целый. Стереть его тут — значит разлогинить
        //     всех разом из-за серверной оплошности и заставить входить заново.
        const reason = (json && typeof json.error === 'string') ? json.error : '';
        if (!reason.includes('x-api-key')) {
            unlocked = false;
            setToken('');
            currentUser = null;
            showGate('Сессия истекла — войдите заново');
            throw new Error('сессия истекла');
        }
    }
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

const appTabs     = document.getElementById('app-tabs');
const pageAuth    = document.getElementById('page-auth');
const pageSearch  = document.getElementById('page-search');
const pageCalc    = document.getElementById('page-calc');
const pageProfile = document.getElementById('page-profile');
const pageRecords = document.getElementById('page-records');
const pageScripts = document.getElementById('page-scripts');
const pageTop     = document.getElementById('page-top');

const ALL_PAGES = [pageAuth, pageSearch, pageCalc, pageProfile, pageRecords, pageScripts, pageTop];

function hideAllPages() {
    for (const page of ALL_PAGES) page.classList.add('hidden');
}

// Показать ровно одну страницу (вкладки при этом видны).
function showPage(page) {
    for (const p of ALL_PAGES) p.classList.toggle('hidden', p !== page);
    appTabs.classList.remove('hidden');
}

function showGate(message) {
    hideAllPages();
    appTabs.classList.add('hidden');
    pauseRecords();
    resetTabsState();
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
    initAchievements({ apiFetch }); // стим-тосты о новых ачивках (см. achievements.js)
    renderRoute();
    loadSnapshot();   // прогреваем базу для поиска и тегов
    loadSphere();
}

// Выход из аккаунта (или протухшая сессия): чужие данные не должны
// «просвечивать» через сохранённое состояние вкладок, когда войдёт кто-то другой.
function resetTabsState() {
    renderedCarId = null;
    profileKey = null;
    resetTopCache();
    searchInput.value = '';
    searchResults.innerHTML = '';
    scrollByRoute.clear();
    Object.assign(lastRoute, DEFAULT_TAB_ROUTE);
}

// Аватарка живёт в кнопке вкладки «Профиль».
function renderUserBar() {
    const img = document.getElementById('avatar-img');
    const defaultIcon = document.querySelector('.app-tab-avatar .avatar-default-icon');
    if (currentUser && currentUser.avatar) {
        img.src = currentUser.avatar;
        img.hidden = false;
        defaultIcon.hidden = true;
    } else {
        img.hidden = true;
        defaultIcon.hidden = false;
    }
}

// ── Вкладки ───────────────────────────────────────────────────────────────────
// Пять разделов одним рядом сверху. Каждая вкладка помнит свой последний роут,
// а страницы не пересобираются при возврате: найденная машина, набранный поиск,
// открытая станция в записях — всё остаётся ровно таким, каким его оставили.

const DEFAULT_TAB_ROUTE = {
    profile: '#/profile',
    calc:    '#/',
    records: '#/records',
    scripts: '#/scripts',
    top:     '#/top',
};
const lastRoute = { ...DEFAULT_TAB_ROUTE };

// Позиция прокрутки на момент ухода с роута — возвращаемся туда же.
const scrollByRoute = new Map();
let currentRoute = null;

function tabOfHash(hash) {
    if (hash.startsWith('#/records')) return 'records';
    if (hash === '#/scripts') return 'scripts';
    if (hash === '#/top') return 'top';
    if (hash === '#/profile' || /^#\/user\/[0-9a-f-]{10,}/i.test(hash)) return 'profile';
    return 'calc'; // #/ и #/car/:id
}

function setActiveTab(tab) {
    appTabs.querySelectorAll('.app-tab').forEach(btn => {
        const active = btn.dataset.tab === tab;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
}

appTabs.querySelectorAll('.app-tab').forEach(btn => {
    btn.onclick = () => {
        const tab = btn.dataset.tab;
        // Клик по активной вкладке ничего не сбрасывает: это её же экран.
        if (lastRoute[tab] === location.hash) return;
        location.hash = lastRoute[tab];
    };
});

function restoreScroll(hash) {
    window.scrollTo(0, scrollByRoute.get(hash) || 0);
}

// ── Hash routing ──────────────────────────────────────────────────────────────
//   #/            — поиск (вкладка «Калькулятор»)
//   #/car/:id     — страница машины (прямая ссылка переживает F5)
//   #/profile     — свой профиль (редактируемый)
//   #/user/:id    — чужой профиль (read-only, из топа/ленты машины)
//   #/records     — записи по станциям
//   #/scripts     — фид юзерскриптов
//   #/top         — рейтинг пользователей

let renderedCarId = null;  // машина, уже отрисованная на #page-calc
let profileKey = null;     // 'self' или id чужого профиля на #page-profile

async function renderRoute() {
    const hash = location.hash || '#/';
    if (currentRoute && currentRoute !== hash) scrollByRoute.set(currentRoute, window.scrollY);
    currentRoute = hash;

    const tab = tabOfHash(hash);
    // Вкладка «Профиль» всегда ведёт к своему профилю: чужой (#/user/:id)
    // открывается из топа и ленты, но вкладкой не запоминается.
    if (tab !== 'profile' || hash === '#/profile') lastRoute[tab] = hash;
    setActiveTab(tab);

    // Записи живут до гейта: у них свой вход — общий логин/пароль админки
    // ZMS, аккаунт сайта для них не нужен (см. backend/src/routes/records.js).
    if (tab === 'records') {
        await showRecords();
        restoreScroll(hash);
        return;
    }
    // Уходим с записей — гасим их опросы, но раздел оставляем собранным.
    pauseRecords();
    // Без сессии сайта всё остальное закрыто.
    if (!unlocked) { showGate(); return; }

    const carMatch = hash.match(/^#\/car\/([0-9a-f-]{10,})/i);
    const userMatch = hash.match(/^#\/user\/([0-9a-f-]{10,})/i);

    if (tab === 'profile') {
        // Клик по самому себе (в топе, в фиде машины) — открываем свой
        // редактируемый профиль, а не свою «зрительскую» страницу.
        if (userMatch && currentUser && userMatch[1] === currentUser.id) {
            location.hash = '#/profile';
            return;
        }
        showPage(pageProfile);
        const key = userMatch ? userMatch[1] : 'self';
        if (profileKey !== key) {
            profileKey = key;
            if (userMatch) await initPublicProfilePage({ apiFetch, userId: userMatch[1], viewer: currentUser });
            else await initSelfProfilePage();
        }
    } else if (tab === 'scripts') {
        showPage(pageScripts);
        initScriptsFeed(); // фид статичный — собирается один раз
    } else if (tab === 'top') {
        showPage(pageTop);
        showTopPage({ apiFetch }); // из кеша мгновенно, свежие данные подтянутся
    } else if (carMatch) {
        showPage(pageCalc);
        // Та же машина, что и была — не пересобираем: выбранные агрегаты,
        // раскрытые блоки и заметки остаются на месте.
        if (renderedCarId !== carMatch[1]) await loadCarPage(carMatch[1]);
    } else {
        showPage(pageSearch);
        // Запрос и выдача не чистятся при уходе — возвращаемся к тому же экрану,
        // курсор ставим в строку, только если открыт режим «Поиск», а не «Теги».
        if (tagSearchEl.classList.contains('hidden')) searchInput.focus();
    }
    restoreScroll(hash);
}

async function loadCarPage(carId) {
    try {
        const record = await apiFetch('/api/cars/' + carId);
        renderedCarId = carId;
        initCarPage(record, {
            apiFetch,
            user: currentUser,
            onChanged: () => loadCarPage(carId), // после правки перечитываем машину
        });
    } catch (e) {
        renderedCarId = null; // следующий заход попробует ещё раз
        document.getElementById('car-head').innerHTML =
            `<div class="search-empty">Не удалось загрузить машину: ${esc(e.message)}</div>`;
        document.getElementById('calc-main').innerHTML = '';
        document.getElementById('crm-panel').innerHTML = '';
    }
}

function initSelfProfilePage() {
    return initProfilePage({
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
}

// ── Раздел «Записи» (ленивая загрузка) ────────────────────────────────────────
// Модуль записей тянет за собой Leaflet и свои стили, поэтому грузится только
// при первом заходе на #/records. При уходе на другую вкладку раздел не
// разбирается, а замирает (pauseRecords): выбранный день, открытая станция и
// поиск остаются на месте, но фоновых опросов и таймеров не остаётся —
// калькулятор работает так же налегке, как раньше.

let recordsMod = null;      // загруженный модуль (кэшируется на сессию)
let recordsMounted = false; // раздел собран в #page-records
let recordsRunning = false; // ...и его таймеры сейчас живы
let recordsLoading = null;

async function showRecords() {
    showPage(pageRecords);
    if (recordsRunning) return;
    if (recordsMounted) {
        recordsMod.resumeRecords();
        recordsRunning = true;
        return;
    }
    if (!recordsMod) {
        pageRecords.innerHTML = '<div class="rc-boot">Загрузка записей…</div>';
        recordsLoading = recordsLoading || import('./records/records.js');
        try {
            recordsMod = await recordsLoading;
        } catch (e) {
            pageRecords.innerHTML = `<div class="rc-boot">Не удалось загрузить записи: ${esc(e.message)}</div>`;
            recordsLoading = null;
            return;
        }
        recordsLoading = null;
        // Пока грузился модуль, могли уйти на другой роут.
        if (!location.hash.startsWith('#/records')) return;
    }
    recordsMod.startRecords(pageRecords);
    recordsMounted = true;
    recordsRunning = true;
}

function pauseRecords() {
    if (!recordsRunning) return;
    recordsRunning = false;
    recordsMod?.pauseRecords();
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
        <div class="car-card" data-id="${car.id}">${carCardInner(car)}</div>
    `).join('');

    // Запрос и выдачу не стираем: вернувшись на вкладку «Калькулятор», человек
    // видит тот же список, из которого уходил, и может открыть соседнюю машину.
    searchResults.querySelectorAll('.car-card').forEach(card => {
        card.onclick = () => { location.hash = '#/car/' + card.dataset.id; };
    });
}

// ── Back button ───────────────────────────────────────────────────────────────
document.getElementById('btn-back').onclick = () => { location.hash = '#/'; };
// Профиль открывают и с вкладки, и из топа/ленты машины — возвращаем туда,
// откуда пришли, а не жёстко на поиск.
document.getElementById('btn-profile-back').onclick = () => {
    if (history.length > 1) history.back();
    else location.hash = '#/';
};

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
    onPick: id => { location.hash = '#/car/' + id; },
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
    // На записи заходят и без аккаунта сайта, и база машин там не нужна —
    // не заставляем ждать её загрузку.
    const recordsFirst = location.hash.startsWith('#/records');
    const authLine = log.line('Authenticating session...');
    try {
        const me = await apiFetch('/api/auth/me');
        currentUser = me.user;
        log.set(authLine, 'Authenticating session... OK');
    } catch {
        log.set(authLine, recordsFirst ? 'Opening records...' : 'No active session — login required');
        return { authed: false };
    }
    if (recordsFirst) return { authed: true };
    const dbLine = log.line('Loading vehicle database...');
    try {
        const snap = await loadSnapshot();
        log.set(dbLine, `Vehicle database loaded — ${snap.cars.length} entries`);
    } catch {
        log.set(dbLine, 'Vehicle database unavailable — will retry in app');
    }
    return { authed: true };
}

// Роутер слушаем всегда, а не только после входа: раздел «Записи» открыт и
// без аккаунта сайта, и переключение туда-обратно не должно перезагружать
// приложение.
window.addEventListener('hashchange', renderRoute);

bootScreen(connectApi, { prepare: bootPrepare }).then(async (result) => {
    // Соединение до бэкенда дорого только на этапе установки — дальше держим
    // его открытым, чтобы каждый клик не начинался с нового хендшейка.
    startKeepAlive(getApiBase() + '/health');

    let authed = result && result.authed;
    if (authed === undefined) {
        // Skip-путь: юзер нажал «Continue» до пробуждения сервера — как раньше.
        try {
            const me = await apiFetch('/api/auth/me');
            currentUser = me.user;
            authed = true;
        } catch {
            authed = false;
        }
    }
    if (authed) enterApp();
    else if (location.hash.startsWith('#/records')) renderRoute(); // записи без гейта
    else showGate();
});
