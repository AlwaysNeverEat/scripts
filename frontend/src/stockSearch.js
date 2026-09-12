// ─────────────────────────────────────────────────────────────────────────────
// Вкладка «Склад» (#/stock): поиск по остаткам CRM, как на её странице
// /analyse/free, — выбираешь одну или несколько станций, набираешь что угодно
// (артикул, название, вязкость) и получаешь таблицу с колонкой остатка на
// каждую станцию. Плюс две вещи, которых в CRM нет:
//
//  1. ОБЩАЯ ИСТОРИЯ запросов (backend/src/crm/stockHistory.js): подсказки под
//     строкой — то, что искали все, свежее сверху. За стойкой работают
//     посменно, и артикулы напарника нужны точно так же, как свои.
//  2. ПОИСК СПИСКОМ — порт юзерскрипта «SPOT: Поиск цен по артикулам»: артикулы
//     с новой строки, на каждый своя группа найденного с типом фильтра
//     (вф/мф/сф) по названию, самая дешёвая в наличии отмечена, а выбранное
//     копируется строками «вф <имя> - <цена>р» — в том виде, в каком их ждёт
//     калькулятор.
//
// В таблице ровно три вещи: название, цена и остаток. Внутренний код CRM в
// начале названия («NSIN0018631072 …») убран — ищут и сверяют по артикулу
// производителя, а он стоит дальше. Цена округлена до рубля; у масла из бочки
// CRM держит и остаток, и цену в десятых долях литра (см. shared/crmAnalyse.js),
// поэтому остаток показан литрами, а цена — за литр (×10, с пометкой «₽/л»).
// Всё остальное — штуки и цена как есть.
//
// Выбранные станции помнятся на устройстве (localStorage): в отличие от
// панели на странице машины, тут поиск — главное действие, и человек работает
// со своей станции всю смену. Сеть — backend/src/routes/crm.js под
// персональной сессией, поэтому возможен ответ «нет сессии CRM»: на него
// показываем форму входа на месте, как во вкладке «Клиент».
//
// Значки — SVG, эмодзи нет ни одного (та же причина, что в «Клиенте»).
// ─────────────────────────────────────────────────────────────────────────────

import './stockSearch.css';
import { stripCrmCode, sortFilterRows, cleanFilterName } from '../../shared/crmAnalyse.js';
import { fmtPrice, fmtQty, copyLine, parseList, dominantType, filterTypeOf } from './stockFormat.js';

const STATIONS_KEY = 'cars_db_stock_stations';
// Сколько подсказок истории показываем разом.
const HISTORY_SHOWN = 8;
// Список артикулов идёт по одному запросу на строку; двух в полёте хватает,
// чтобы спрятать накладные расходы HTTP, — очередь к CRM всё равно одна.
const LIST_WORKERS = 2;
// Сколько вариантов показываем на артикул в режиме списком: как в юзерскрипте.
const LIST_ROWS = 10;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const KINDS = [
    { id: 'one',  label: 'Товар',   placeholder: 'Артикул, название или вязкость…', hint: 'Одна строка — как в CRM' },
    { id: 'list', label: 'Списком', placeholder: 'C 21 014\nW 712/95\nCU 26 010', hint: 'Артикулы с новой строки (Shift+Enter), группа на каждый' },
];

// Порядок групп в режиме списком — как в юзерскрипте: воздушный, масляный,
// салонный, топливный, потом неопознанные и пустые.
const TYPE_ORDER = { 'вф': 1, 'мф': 2, 'сф': 3, 'тф': 4 };
const TYPE_NAMES = { 'вф': 'воздушный', 'мф': 'масляный', 'сф': 'салонный', 'тф': 'топливный' };

const ICON = {
    chevron: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>',
    go: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    clock: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    retry: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="21 5 21 11 15 11"/><path d="M20 15a8 8 0 1 1-2.2-8.3L21 9"/></svg>',
};

// ── Мелочи ───────────────────────────────────────────────────────────────────
// Форматирование цены и остатка, строка для буфера и разбор списка живут в
// stockFormat.js — там их можно гонять тестами без CSS.

function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
}

function loadStations() {
    try {
        const raw = JSON.parse(localStorage.getItem(STATIONS_KEY) || '[]');
        return Array.isArray(raw) ? raw.map(String).filter(id => /^\d+$/.test(id)) : [];
    } catch { return []; }
}

function saveStations(ids) {
    try { localStorage.setItem(STATIONS_KEY, JSON.stringify(ids)); } catch { /* приватный режим */ }
}

async function toClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}

// ── Модуль ───────────────────────────────────────────────────────────────────

export function initStockSearch({ apiFetch }) {
    const root = document.getElementById('stock-search');
    if (!root) return { preload() {}, activate() {}, deactivate() {} };

    const state = {
        kind: 'one',            // one | list
        kindOpen: false,
        query: '',
        listText: '',
        stations: loadStations(),   // выбранные id
        stationsAll: null,          // [{id, name}] | null пока не грузили | [] не вышло
        history: [],                // [{ query, uses }]
        historyOpen: false,
        historyIdx: -1,
        stage: 'idle',      // idle | loading | result | empty | groups | auth | error
        result: null,       // ответ /stock/search в режиме «товар»
        groups: [],         // режим «списком»: [{ query, status, rows, columns, type, picked, message }]
        stale: false,       // станции сменили после поиска списком — результат устарел
        error: '',
        authNote: '',
        loggingIn: false,
        copyNote: null,     // { ok, text, count }
    };
    let token = 0;

    root.innerHTML = `
        <div class="ss-stations" id="ss-stations"></div>
        <div class="ss-bar-wrap">
            <div class="ss-bar" id="ss-bar">
                <input class="ss-input" id="ss-input" type="text" autocomplete="off" spellcheck="false" aria-label="Что ищем на складе">
                <textarea class="ss-list hidden" id="ss-list" rows="4" spellcheck="false" aria-label="Артикулы, по одному в строке"></textarea>
                <button type="button" class="ss-go" id="ss-go" title="Найти" aria-label="Найти">${ICON.go}</button>
                <div class="ss-kind" id="ss-kind">
                    <button type="button" class="ss-kind-btn" id="ss-kind-btn"></button>
                    <div class="ss-kind-list hidden" id="ss-kind-list"></div>
                </div>
            </div>
            <div class="ss-history hidden" id="ss-history"></div>
        </div>
        <div class="ss-body" id="ss-body"></div>`;

    const stationsEl = root.querySelector('#ss-stations');
    const bar = root.querySelector('#ss-bar');
    const input = root.querySelector('#ss-input');
    const list = root.querySelector('#ss-list');
    const goBtn = root.querySelector('#ss-go');
    const kindBtn = root.querySelector('#ss-kind-btn');
    const kindList = root.querySelector('#ss-kind-list');
    const historyEl = root.querySelector('#ss-history');
    const body = root.querySelector('#ss-body');

    const currentKind = () => KINDS.find(k => k.id === state.kind) || KINDS[0];
    const stationName = (id) => (state.stationsAll || []).find(s => s.id === id)?.name || `#${id}`;

    // ── Данные ────────────────────────────────────────────────────────────────

    let stationsLoading = false;
    async function loadStationsAll() {
        if (stationsLoading) return;
        stationsLoading = true;
        try {
            const { stations } = await apiFetch('/api/crm/stations');
            state.stationsAll = stations || [];
            // Станция, которой в CRM больше нет, из выбора уходит сама.
            const known = new Set(state.stationsAll.map(s => s.id));
            const pruned = state.stations.filter(id => known.has(id));
            if (pruned.length !== state.stations.length) { state.stations = pruned; saveStations(pruned); }
            if (state.stage === 'auth') state.stage = 'idle';
        } catch (e) {
            stationsLoading = false;
            if (e.code === 'crm_auth_required' || e.code === 'crm_auth_failed') { failed(e); return; }
            // Список не приехал — не ошибка на весь экран, а строка в самом
            // списке с кнопкой повтора: искать по всем станциям можно и так.
            state.stationsAll = [];
        }
        stationsLoading = false;
        render();
    }

    // Станции не загрузились или их ещё не спрашивали — спросить снова. Зовётся
    // после каждого удачного поиска: раз CRM ответила, ответит и на список.
    function ensureStations() {
        if (!state.stationsAll || !state.stationsAll.length) loadStationsAll();
    }

    async function loadHistory() {
        try {
            const { items } = await apiFetch('/api/crm/stock/history');
            state.history = items || [];
            renderHistory();
        } catch { /* подсказки — удобство, без них поиск работает */ }
    }

    function failed(e) {
        if (e.code === 'crm_auth_required' || e.code === 'crm_auth_failed') {
            state.stage = 'auth';
            state.authNote = e.code === 'crm_auth_failed'
                ? 'CRM не приняла логин или пароль.'
                : 'Нет живой сессии CRM — войди своей учёткой.';
        } else {
            state.stage = 'error';
            state.error = e.message || 'CRM недоступна';
        }
        render();
    }

    async function doLogin(login, password) {
        state.loggingIn = true;
        render();
        try {
            await apiFetch('/api/crm/login', { method: 'POST', body: { login, password } });
            state.loggingIn = false;
            state.stage = 'idle';
            state.stationsAll = null;
            render();
            await loadStationsAll();
            run();
        } catch (e) {
            state.loggingIn = false;
            state.authNote = e.message || 'Не удалось войти в CRM';
            render();
        }
    }

    // Поиск того, что в строке сейчас, — по кнопке, Enter и после входа в CRM.
    function run() {
        if (state.kind === 'list') runList(); else runOne();
    }

    async function runOne() {
        const q = state.query.replace(/\s+/g, ' ').trim();
        if (!q) { input.focus(); return; }
        const mine = ++token;
        state.stage = 'loading';
        state.historyOpen = false;
        state.copyNote = null;
        render();
        try {
            const r = await apiFetch('/api/crm/stock/search', {
                method: 'POST', body: { stationIds: state.stations, query: q },
            });
            if (mine !== token) return;
            state.result = r;
            state.stage = r.rows.length ? 'result' : 'empty';
            render();
            ensureStations();
            // Запрос ушёл в общую историю — подтягиваем её, чтобы и чужие
            // свежие подсказки не ждали перезахода в режим.
            loadHistory();
        } catch (e) {
            if (mine !== token) return;
            failed(e);
        }
    }

    // Список: группа на артикул, запросы по одному, показ по мере готовности —
    // ровно как обходятся чеки в режиме «Клиент».
    async function runList() {
        const lines = parseList(state.listText);
        if (!lines.length) { list.focus(); return; }
        const mine = ++token;
        state.groups = lines.map(q => ({ query: q, status: 'load', rows: [], columns: [], type: null, picked: new Set() }));
        state.stage = 'groups';
        state.stale = false;
        state.copyNote = null;
        render();
        const queue = state.groups.map((_, i) => i);
        const worker = async () => {
            while (queue.length) {
                if (mine !== token) return;
                const g = state.groups[queue.shift()];
                try {
                    const r = await apiFetch('/api/crm/stock/search', {
                        method: 'POST', body: { stationIds: state.stations, query: g.query, remember: false },
                    });
                    if (mine !== token) return;
                    // В наличии и дешевле — выше; самая дешёвая из имеющихся
                    // отмечена сразу, как в юзерскрипте.
                    g.rows = sortFilterRows(r.rows).slice(0, LIST_ROWS);
                    g.columns = r.columns || [];
                    g.type = dominantType(g.rows);
                    g.status = 'ok';
                    const best = g.rows.find(x => x.count > 0) || g.rows[0];
                    if (best) g.picked.add(rowKey(best));
                } catch (e) {
                    if (mine !== token) return;
                    if (e.code === 'crm_auth_required' || e.code === 'crm_auth_failed') { failed(e); return; }
                    // Один упавший артикул не рвёт остальные: у группы кнопка повтора.
                    g.status = 'error';
                    g.message = e.message || 'CRM не ответила';
                }
                renderBody();
            }
        };
        await Promise.all(Array.from({ length: LIST_WORKERS }, worker));
        if (mine === token && state.groups.some(g => g.status === 'ok')) ensureStations();
    }

    async function retryGroup(i) {
        const g = state.groups[i];
        if (!g) return;
        const mine = token;
        g.status = 'load';
        renderBody();
        try {
            const r = await apiFetch('/api/crm/stock/search', {
                method: 'POST', body: { stationIds: state.stations, query: g.query, remember: false },
            });
            if (mine !== token) return;
            g.rows = sortFilterRows(r.rows).slice(0, LIST_ROWS);
            g.columns = r.columns || [];
            g.type = dominantType(g.rows);
            g.status = 'ok';
            g.picked = new Set();
            const best = g.rows.find(x => x.count > 0) || g.rows[0];
            if (best) g.picked.add(rowKey(best));
        } catch (e) {
            if (mine !== token) return;
            g.status = 'error';
            g.message = e.message || 'CRM не ответила';
        }
        renderBody();
    }

    const rowKey = (r) => r.id || `${r.name}|${r.priceRaw}`;

    function selectedLines() {
        const lines = [];
        for (const g of sortedGroups()) {
            for (const r of g.rows) if (g.picked.has(rowKey(r))) lines.push(copyLine(r, g.type));
        }
        return lines;
    }

    // Копирование — только по живому клику: после первого же await браузер
    // может отобрать разрешение на буфер (см. записи, «сперва буфер»).
    async function copySelected() {
        const lines = selectedLines();
        if (!lines.length) return;
        const text = lines.join('\n');
        const ok = await toClipboard(text);
        state.copyNote = { ok, text, count: lines.length };
        renderBody();
    }

    function setStations(ids) {
        state.stations = ids;
        saveStations(ids);
        if (state.kind === 'one' && state.query.trim() && ['result', 'empty', 'loading'].includes(state.stage)) {
            // Одна строка — один запрос: по новым станциям ищем сами. Идущий
            // поиск тоже перезапускаем — он был по прежним станциям, и его
            // ответ уже не про то (старый отбрасывается по token).
            runOne();
        } else if (state.stage === 'groups') {
            // А список — это десяток запросов, их не повторяем молча.
            state.stale = true;
            render();
        } else {
            render();
        }
    }

    // ── Рендер ────────────────────────────────────────────────────────────────

    function render() {
        renderStations();
        renderBar();
        renderHistory();
        renderBody();
    }

    // Список станций — как в CRM, всегда на виду колонкой слева от строки:
    // клик выбирает ОДНУ станцию,
    // Ctrl/Cmd+клик добавляет или снимает ещё одну, Shift+клик берёт всё
    // между прошлым кликом и этим, «Все станции» снимает выбор. Это поведение
    // родного <select multiple>, только нарисованное под тему сайта (нативный
    // не красится, см. select.js). Выбранные подсвечены, и других чипов или
    // счётчиков не нужно — список и есть ответ «по чему ищем».
    function renderStations() {
        const all = state.stationsAll;
        const chosen = new Set(state.stations);
        const none = !chosen.size;
        const hint = none ? 'клик — одна, Shift или Ctrl — несколько'
            : `${chosen.size} ${plural(chosen.size, 'станция', 'станции', 'станций')}`;
        const items = all === null
            ? '<div class="ss-st-note">Загружаю список станций…</div>'
            : !all.length
                ? `<div class="ss-st-note">Список станций не загрузился. <button type="button" class="ss-link" data-act="stations-retry">${ICON.retry} ещё раз</button></div>`
                : all.map(s => `
                    <button type="button" class="ss-st-item${chosen.has(s.id) ? ' is-on' : ''}" data-st="${esc(s.id)}" role="option" aria-selected="${chosen.has(s.id)}">
                        ${esc(s.name)}
                    </button>`).join('');
        stationsEl.innerHTML = `
            <div class="ss-st-head">
                <span class="ss-st-title">${ICON.pin}Станции</span>
                <span class="ss-dim">${esc(hint)}</span>
            </div>
            <div class="ss-st-list" role="listbox" aria-multiselectable="true" aria-label="Станции">
                <button type="button" class="ss-st-item ss-st-all${none ? ' is-on' : ''}" data-st="" role="option" aria-selected="${none}">Все станции</button>
                ${items}
            </div>`;

        stationsEl.querySelectorAll('.ss-st-item').forEach(el => {
            el.onclick = (e) => pickStation(el.dataset.st, e);
        });
        const retry = stationsEl.querySelector('[data-act="stations-retry"]');
        if (retry) retry.onclick = () => { state.stationsAll = null; renderStations(); loadStationsAll(); };
    }

    // Порядок выбранных — как в списке CRM, чтобы колонки таблицы не прыгали
    // от того, в какой последовательности станции нажимали.
    function orderStations(ids) {
        const order = new Map((state.stationsAll || []).map((s, i) => [s.id, i]));
        return [...new Set(ids)].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
    }

    let stationAnchor = null; // откуда считать Shift-диапазон
    function pickStation(id, e) {
        if (!id) { stationAnchor = null; setStations([]); return; }
        const all = state.stationsAll || [];
        let next;
        if (e.shiftKey && stationAnchor && all.some(s => s.id === stationAnchor)) {
            const a = all.findIndex(s => s.id === stationAnchor);
            const b = all.findIndex(s => s.id === id);
            next = all.slice(Math.min(a, b), Math.max(a, b) + 1).map(s => s.id);
        } else if (e.ctrlKey || e.metaKey) {
            next = state.stations.includes(id) ? state.stations.filter(x => x !== id) : [...state.stations, id];
            stationAnchor = id;
        } else {
            next = [id];
            stationAnchor = id;
        }
        setStations(orderStations(next));
    }

    function renderBar() {
        const kind = currentKind();
        const isList = kind.id === 'list';
        bar.classList.toggle('ss-bar-list', isList);
        input.classList.toggle('hidden', isList);
        list.classList.toggle('hidden', !isList);
        input.placeholder = kind.placeholder;
        list.placeholder = KINDS[1].placeholder;
        if (input.value !== state.query) input.value = state.query;
        if (list.value !== state.listText) list.value = state.listText;
        kindBtn.innerHTML = `<span>${esc(kind.label)}</span>${ICON.chevron}`;
        kindBtn.setAttribute('aria-expanded', String(state.kindOpen));
        kindList.classList.toggle('hidden', !state.kindOpen);
        kindList.innerHTML = KINDS.map(k => `
            <button type="button" class="ss-kind-opt${k.id === state.kind ? ' active' : ''}" data-kind="${k.id}">
                <span class="ss-kind-opt-label">${esc(k.label)}</span>
                <span class="ss-kind-opt-hint">${esc(k.hint)}</span>
            </button>`).join('');
        goBtn.title = isList ? 'Найти все (Enter; новая строка — Shift+Enter)' : 'Найти (Enter)';
    }

    // Подсказки: последние запросы всех, отфильтрованные по набранному.
    function historyItems() {
        const q = state.query.trim().toLowerCase();
        const items = q ? state.history.filter(h => h.query.toLowerCase().includes(q) && h.query.toLowerCase() !== q) : state.history;
        return items.slice(0, HISTORY_SHOWN);
    }

    function renderHistory() {
        const items = state.kind === 'one' && state.historyOpen ? historyItems() : [];
        historyEl.classList.toggle('hidden', !items.length);
        if (!items.length) { state.historyIdx = -1; return; }
        if (state.historyIdx >= items.length) state.historyIdx = items.length - 1;
        historyEl.innerHTML = items.map((h, i) => `
            <button type="button" class="ss-hist-item${i === state.historyIdx ? ' is-cur' : ''}" data-q="${esc(h.query)}">
                ${ICON.clock}<span class="ss-hist-q">${esc(h.query)}</span>
                ${h.uses > 1 ? `<span class="ss-hist-uses">${h.uses}</span>` : ''}
            </button>`).join('');
        historyEl.querySelectorAll('.ss-hist-item').forEach(el => {
            el.onclick = () => pickHistory(el.dataset.q);
        });
    }

    function pickHistory(q) {
        state.query = q;
        state.historyOpen = false;
        renderBar();
        renderHistory();
        runOne();
    }

    function renderBody() {
        if (state.stage === 'idle')         body.innerHTML = '';
        else if (state.stage === 'loading') body.innerHTML = viewLoading();
        else if (state.stage === 'empty')   body.innerHTML = viewEmpty();
        else if (state.stage === 'error')   body.innerHTML = viewError();
        else if (state.stage === 'auth')    body.innerHTML = viewAuth();
        else if (state.stage === 'result')  body.innerHTML = viewResult();
        else if (state.stage === 'groups')  body.innerHTML = viewGroups();
        bindBody();
    }

    function skeletonRows(n) {
        return Array.from({ length: n }, () => `
            <div class="ss-skel-row">
                <span class="sk sk-line" style="width: 58%"></span>
                <span class="sk sk-line" style="width: 12%"></span>
                <span class="sk sk-line" style="width: 10%"></span>
            </div>`).join('');
    }

    function viewLoading() {
        return `<div class="ss-card"><div class="ss-skel">${skeletonRows(5)}</div></div>`;
    }

    function viewEmpty() {
        return `
            <div class="ss-note ss-note-empty">
                <div class="ss-note-title">Ничего не найдено</div>
                <p>По запросу <b>${esc(state.result?.query || state.query)}</b> ${whereText()} пусто.</p>
            </div>`;
    }

    function whereText() {
        const n = state.stations.length;
        return !n ? 'на всех станциях' : n === 1 ? `на станции ${esc(stationName(state.stations[0]))}` : `на выбранных ${n} станциях`;
    }

    function viewError() {
        return `
            <div class="ss-note ss-note-error">
                <div class="ss-note-title">CRM не ответила</div>
                <p>${esc(state.error)}</p>
                <button type="button" class="btn ss-retry" data-act="research">Попробовать снова</button>
            </div>`;
    }

    function viewAuth() {
        return `
            <div class="ss-note ss-note-auth">
                <div class="ss-note-title">Нужен вход в CRM</div>
                <p>${esc(state.authNote)}</p>
                <form class="ss-login" id="ss-login">
                    <input class="ss-login-input" name="login" placeholder="Логин CRM" autocomplete="username">
                    <input class="ss-login-input" name="password" type="password" placeholder="Пароль" autocomplete="current-password">
                    <button type="submit" class="btn ss-login-go"${state.loggingIn ? ' disabled' : ''}>${state.loggingIn ? 'Вхожу…' : 'Войти'}</button>
                </form>
            </div>`;
    }

    // Колонки остатка: по станции из ответа CRM, либо одна общая.
    function countCols(columns) {
        return columns && columns.length ? columns : [{ id: 'all', name: state.stations.length ? 'Остаток' : 'Всего' }];
    }

    // В группах по артикулу название показывается БЕЗ слов типа («Масляный
    // фильтр …»): тип уже стоит бейджем в шапке группы, а колонок станций
    // рядом три-четыре, и каждое лишнее слово в названии — это многоточие
    // вместо артикула. Позиция ЧУЖОГО типа (по артикулу воздушного нашёлся
    // салонный) получает свой бейдж в строке — как в юзерскрипте.
    function tableHtml(rows, columns, { pick = null, groupIdx = -1, groupType = null } = {}) {
        const cols = countCols(columns);
        const head = `
            <thead><tr>
                ${pick ? '<th class="ss-th-pick"></th>' : ''}
                <th class="ss-th-name">Название</th>
                <th class="ss-th-num ss-th-price">Цена</th>
                ${cols.map(c => `<th class="ss-th-num" title="${esc(c.name)}"><span class="ss-th-wrap">${esc(c.name)}</span></th>`).join('')}
            </tr></thead>`;
        const trs = rows.map(r => {
            const zero = !(r.count > 0);
            const key = rowKey(r);
            const cells = cols.map(c => {
                const n = r.counts?.[c.id] ?? (c.id === 'all' ? r.count : 0);
                return `<td class="ss-td-num ss-qty${n > 0 ? '' : ' ss-qty-zero'}">${esc(fmtQty(r.name, n))}</td>`;
            }).join('');
            const pickCell = pick
                ? `<td class="ss-td-pick"><input type="checkbox" data-pick="${groupIdx}" data-key="${esc(key)}"${pick.has(key) ? ' checked' : ''} aria-label="Взять эту позицию"></td>`
                : '';
            let nameHtml = esc(stripCrmCode(r.name));
            if (pick) {
                const rowType = filterTypeOf(r.name);
                nameHtml = (rowType && rowType !== groupType ? `<span class="ss-type ss-type-row">${esc(rowType)}</span> ` : '')
                    + esc(cleanFilterName(r.name));
            }
            // Кнопка «скопировать строку» у КАЖДОЙ позиции, в обоих режимах:
            // та же строка «мф <имя> - <цена>р», что уходит из списка пачкой,
            // — её вставляют в калькулятор по одной ничуть не реже.
            const copyBtn = `<button type="button" class="ss-row-copy" data-copy="${esc(copyLine(r, groupType))}" title="Скопировать строку для калькулятора" aria-label="Скопировать строку">${ICON.copy}</button>`;
            return `
                <tr class="ss-row${zero ? ' ss-row-zero' : ''}${pick ? ' ss-row-pick' : ''}" ${pick ? `data-rowpick="${groupIdx}" data-rowkey="${esc(key)}"` : ''}>
                    ${pickCell}
                    <td class="ss-td-name" title="${esc(r.name)}"><span class="ss-name-text">${nameHtml}</span>${copyBtn}</td>
                    <td class="ss-td-num ss-price">${fmtPrice(r.name, r.priceRaw)}</td>
                    ${cells}
                </tr>`;
        }).join('');
        return `<div class="ss-table-wrap"><table class="ss-table${pick ? ' ss-table-pick' : ''}">${head}<tbody>${trs}</tbody></table></div>`;
    }

    function viewResult() {
        const r = state.result;
        const n = r.rows.length;
        const more = r.total > n
            ? `<span class="ss-more">показаны первые ${n} из ${r.total} — уточните запрос</span>`
            : '';
        return `
            <div class="ss-card">
                <div class="ss-card-head">
                    <span class="ss-head-q">${esc(r.query)}</span>
                    <span class="ss-dim">${n} ${plural(n, 'позиция', 'позиции', 'позиций')} · ${whereText()}</span>
                    ${more}
                </div>
                ${tableHtml(r.rows, r.columns)}
            </div>`;
    }

    function sortedGroups() {
        return state.groups.map((g, i) => ({ ...g, idx: i })).sort((a, b) => {
            const oa = a.status !== 'ok' ? 50 : !a.rows.length ? 99 : (TYPE_ORDER[a.type] || 40);
            const ob = b.status !== 'ok' ? 50 : !b.rows.length ? 99 : (TYPE_ORDER[b.type] || 40);
            return oa - ob || a.idx - b.idx;
        });
    }

    function viewGroups() {
        const groups = sortedGroups().map(g => {
            const head = `<div class="ss-group-head">
                ${g.type ? `<span class="ss-type" title="${esc(TYPE_NAMES[g.type] || '')}">${esc(g.type)}</span>` : ''}
                <span class="ss-head-q">${esc(g.query)}</span>
                ${g.status === 'ok' && g.rows.length ? `<span class="ss-dim">${g.rows.length} ${plural(g.rows.length, 'вариант', 'варианта', 'вариантов')}</span>
                    <button type="button" class="ss-link ss-group-all" data-all="${g.idx}">выбрать все</button>` : ''}
            </div>`;
            let content;
            if (g.status === 'load') content = `<div class="ss-skel">${skeletonRows(2)}</div>`;
            else if (g.status === 'error') content = `<div class="ss-group-err">${esc(g.message)} <button type="button" class="ss-link" data-retry="${g.idx}">${ICON.retry} ещё раз</button></div>`;
            else if (!g.rows.length) content = '<div class="ss-group-none">по этому артикулу ничего не нашлось</div>';
            else content = tableHtml(g.rows, g.columns, { pick: g.picked, groupIdx: g.idx, groupType: g.type });
            return `<div class="ss-group${g.status === 'ok' && !g.rows.length ? ' ss-group-empty' : ''}">${head}${content}</div>`;
        }).join('');

        const count = selectedLines().length;
        const stale = state.stale
            ? '<div class="ss-stale">Станции изменились — нажмите «Найти», чтобы пересчитать остатки.</div>'
            : '';
        let note = '';
        if (state.copyNote?.ok) {
            note = `<span class="ss-copy-ok">${ICON.check} Скопировано: ${state.copyNote.count} ${plural(state.copyNote.count, 'строка', 'строки', 'строк')}</span>`;
        } else if (state.copyNote && !state.copyNote.ok) {
            // Буфер отвалился (http, старый браузер) — строки остаются на
            // экране, откуда их можно выделить и скопировать руками.
            note = `<div class="ss-copy-fail">
                <b>Браузер не дал записать в буфер</b> — скопируйте руками:
                <textarea class="ss-copy-text" readonly rows="${Math.min(6, state.copyNote.count)}">${esc(state.copyNote.text)}</textarea>
            </div>`;
        }
        return `
            <div class="ss-card ss-groups">
                ${stale}
                ${groups}
                <div class="ss-copy-row">
                    <button type="button" class="btn btn-pri ss-copy-btn" data-act="copy"${count ? '' : ' disabled'}>${ICON.copy} Скопировать выбранное${count ? ` (${count})` : ''}</button>
                    ${note}
                </div>
            </div>`;
    }

    // ── События ───────────────────────────────────────────────────────────────

    function bindBody() {
        body.querySelector('[data-act="research"]')?.addEventListener('click', () => run());
        body.querySelector('[data-act="copy"]')?.addEventListener('click', () => copySelected());
        body.querySelectorAll('input[data-pick]').forEach(box => {
            box.onchange = () => {
                const g = state.groups[Number(box.dataset.pick)];
                if (!g) return;
                if (box.checked) g.picked.add(box.dataset.key); else g.picked.delete(box.dataset.key);
                state.copyNote = null;
                renderBody();
            };
        });
        // Клик по всей строке — тот же выбор, что по галочке: целиться в
        // квадратик 14 пикселей незачем.
        body.querySelectorAll('tr[data-rowpick]').forEach(tr => {
            tr.onclick = (e) => {
                if (e.target.closest('input')) return;
                const box = tr.querySelector('input[data-pick]');
                if (box) { box.checked = !box.checked; box.onchange(); }
            };
        });
        // Копирование одной строки — по живому клику, иначе буфер не даст
        // записать. Галочка на полторы секунды вместо иконки — и назад.
        body.querySelectorAll('.ss-row-copy').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation(); // в списке клик по строке переключает выбор
                const ok = await toClipboard(btn.dataset.copy);
                btn.classList.add(ok ? 'is-done' : 'is-fail');
                btn.innerHTML = ok ? ICON.check : ICON.x;
                btn.title = ok ? 'Скопировано' : 'Браузер не дал записать в буфер';
                setTimeout(() => {
                    btn.classList.remove('is-done', 'is-fail');
                    btn.innerHTML = ICON.copy;
                    btn.title = 'Скопировать строку для калькулятора';
                }, 1500);
            };
        });
        body.querySelectorAll('[data-all]').forEach(el => {
            el.onclick = () => {
                const g = state.groups[Number(el.dataset.all)];
                if (!g) return;
                for (const r of g.rows) g.picked.add(rowKey(r));
                state.copyNote = null;
                renderBody();
            };
        });
        body.querySelectorAll('[data-retry]').forEach(el => {
            el.onclick = () => retryGroup(Number(el.dataset.retry));
        });
        const loginForm = body.querySelector('#ss-login');
        if (loginForm) {
            loginForm.onsubmit = (e) => {
                e.preventDefault();
                const login = loginForm.login.value.trim();
                const password = loginForm.password.value;
                if (login && password) doLogin(login, password);
            };
        }
        const copyText = body.querySelector('.ss-copy-text');
        if (copyText) copyText.onfocus = () => copyText.select();
    }

    // stopPropagation: renderBar() перерисовывает саму кнопку, и к моменту, когда
    // клик доходит до document, e.target уже вне DOM — проверка «клик внутри»
    // сочла бы его чужим и закрыла список сразу (см. clientSearch.js).
    kindBtn.onclick = (e) => {
        e.stopPropagation();
        state.kindOpen = !state.kindOpen;
        renderBar();
    };
    kindList.onclick = (e) => {
        e.stopPropagation();
        const opt = e.target.closest('.ss-kind-opt');
        if (!opt) return;
        state.kind = opt.dataset.kind;
        state.kindOpen = false;
        state.historyOpen = false;
        renderBar();
        renderHistory();
        (state.kind === 'list' ? list : input).focus();
    };
    document.addEventListener('click', () => {
        let changed = false;
        if (state.kindOpen) { state.kindOpen = false; changed = true; }
        if (changed) renderBar();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (state.kindOpen) { state.kindOpen = false; renderBar(); }
    });

    input.addEventListener('input', () => {
        state.query = input.value;
        state.historyOpen = true;
        state.historyIdx = -1;
        renderHistory();
    });
    input.addEventListener('focus', () => { state.historyOpen = true; renderHistory(); });
    input.addEventListener('blur', () => { state.historyOpen = false; renderHistory(); });
    // mousedown по подсказке не должен уводить фокус из поля — иначе blur
    // закроет список раньше, чем дойдёт клик.
    historyEl.addEventListener('mousedown', (e) => e.preventDefault());
    input.addEventListener('keydown', (e) => {
        const items = state.historyOpen ? historyItems() : [];
        if (e.key === 'ArrowDown' && items.length) {
            e.preventDefault();
            state.historyIdx = (state.historyIdx + 1) % items.length;
            renderHistory();
        } else if (e.key === 'ArrowUp' && items.length) {
            e.preventDefault();
            state.historyIdx = (state.historyIdx - 1 + items.length) % items.length;
            renderHistory();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (state.historyIdx >= 0 && items[state.historyIdx]) pickHistory(items[state.historyIdx].query);
            else runOne();
        } else if (e.key === 'Escape' && state.historyOpen) {
            state.historyOpen = false;
            renderHistory();
        }
    });
    list.addEventListener('input', () => { state.listText = list.value; });
    // Enter в списке — ПОИСК, как и в строке: артикулы обычно вставляют из
    // буфера уже с переносами, а руками добавляют одну строку — Shift+Enter.
    list.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.shiftKey) return;
        e.preventDefault();
        runList();
    });
    goBtn.onclick = () => run();

    render();

    // Станции и историю подтягиваем заранее — из main.js после прогрева сессии
    // CRM, — чтобы вкладка открывалась уже с готовым списком.
    function preload() {
        if (state.stationsAll === null) loadStationsAll();
        if (!state.history.length) loadHistory();
    }

    return {
        preload,
        activate() {
            renderBar();
            preload();
            (state.kind === 'list' ? list : input).focus();
        },
        // Уходя, закрываем только выпадашки: найденное остаётся — вернувшись,
        // человек видит тот же экран, как и в других режимах.
        deactivate() {
            state.kindOpen = false;
            state.historyOpen = false;
            renderBar();
            renderHistory();
        },
    };
}
