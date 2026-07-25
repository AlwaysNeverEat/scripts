// ─────────────────────────────────────────────────────────────────────────────
// Раздел «Записи» — клон-обложка админки записей ZMS.
//
// Читает доску из кеша бэкенда (обновляется воркером раз в минуту), поэтому
// работает даже когда оригинал лежит: показывает «обновлено N назад», а все
// изменения (создание/перенос/продление/удаление) складывает в очередь
// операций, которая проталкивается автоматически после восстановления.
//
// Паттерн тот же, что в crmPanel.js: plain-state + полный render() + bind().
// Клики — через делегирование по data-action, чтобы переживать перерисовки.
//
// Модуль подключается лениво из главного приложения (main.js, роут #/records)
// через startRecords(mount) и полностью гасится через stopRecords() — чтобы
// уход на калькулятор не оставлял за собой опросы и живую карту.
// ─────────────────────────────────────────────────────────────────────────────

import '../style.css';
import './records.css';
import { apiFetch } from './api.js';
import { icons } from './icons.js';
import { createStationsMap, geocodeStreet, stationsNear } from './map.js';
import { findStationMeta, LINE_COLORS, LINE_NAMES } from '../../../shared/stationsMeta.js';
import {
    detectChains, assignLanes, flattenAddressRecords, buildCopyLine,
    timeToMin, addMinutes, formatRuPhone,
    EXTENSION_STUB_PHONE, SLOT_MINUTES,
} from '../../../shared/crmRecords.js';

let root = null; // узел раздела; задаётся в startRecords()

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ROW_H = 36; // px на 30-минутный слот в виде станции

const state = {
    status: null,          // GET /status
    credsNeeded: false,
    credsError: '',
    date: null,            // выбранный день DD.MM.YYYY
    board: null,           // parseRecordBoard() с бэкенда
    fetchedAt: null,
    boardOk: true,
    boardError: '',
    boardLoading: false,
    ops: [],               // последние операции (очередь)
    view: 'overview',      // 'overview' | 'station'
    stationId: null,
    search: '',
    highlightId: null,     // подсветить запись после перехода из поиска
    modal: null,           // { kind, ... } | null
};

let mapCtl = null;         // Leaflet-контроллер открытой карты (модалки)
let geocodeTimer = 0;
let boardReloadTimers = [];

// ── Загрузка данных ──────────────────────────────────────────────────────────

async function loadStatus() {
    try {
        state.status = await apiFetch('/api/records/status');
        state.credsNeeded = !state.status.credentials;
        if (!state.date) state.date = state.status.today;
    } catch (err) {
        if (err.code === 'zms_credentials_required') state.credsNeeded = true;
    }
    renderStatusOnly();
}

async function loadBoard({ silent = false } = {}) {
    if (!state.date) return;
    if (!silent) { state.boardLoading = true; render(); }
    try {
        const data = await apiFetch(`/api/records/board?date=${encodeURIComponent(state.date)}`);
        state.board = data.board;
        state.fetchedAt = data.fetchedAt;
        state.boardOk = data.ok;
        state.boardError = data.error || '';
        state.ops = data.ops || [];
        state.credsNeeded = false;
    } catch (err) {
        if (err.code === 'zms_credentials_required') {
            state.credsNeeded = true;
            state.boardLoading = false;
            // Гейт уже показан? Не перерисовываем — там кто-то вводит пароль.
            if (!root?.querySelector('#rc-creds-form')) render();
            return;
        }
        if (!state.board) {
            state.boardOk = false;
            state.boardError = err.message;
        } else {
            // Доска уже есть (из кеша) — тихо помечаем, что свежее взять не вышло.
            state.boardOk = false;
            state.boardError = err.message;
        }
    }
    state.boardLoading = false;
    render();
}

async function loadOps() {
    try {
        const data = await apiFetch('/api/records/ops?limit=100');
        state.ops = data.ops || [];
    } catch { /* очередь — вспомогательная информация */ }
}

// После постановки операции: доска перечитывается с задержками, чтобы успел
// отработать «пинок» очереди на бэкенде.
function scheduleBoardReload() {
    for (const t of boardReloadTimers) clearTimeout(t);
    boardReloadTimers = [4_000, 12_000].map(ms =>
        setTimeout(() => loadBoard({ silent: true }), ms));
}

async function postOp(type, payload) {
    await apiFetch('/api/records/ops', { method: 'POST', body: { type, payload } });
    await loadOps();
    scheduleBoardReload();
}

// ── Производные данные ───────────────────────────────────────────────────────

function stationById(id, board = state.board) {
    return board?.addresses.find(a => a.id === String(id))
        || state.board?.addresses.find(a => a.id === String(id))
        || null;
}

function metaFor(addr) {
    return addr ? findStationMeta(addr.title) : null;
}

// Число боксов станции. Главный источник — сама доска: в открытом слоте
// оригинал рисует по «Добавить» на каждый свободный бокс, поэтому
// «записей + свободных» в слоте и есть количество боксов. Это точнее
// захардкоженной меты (у неё бывает физическое число постов, а не рабочих
// боксов) и подхватывает изменения без правки справочника.
function boxesFor(addr) {
    let max = 0;
    const byTime = state.board?.cells[addr.id] || {};
    for (const t of Object.keys(byTime)) {
        max = Math.max(max, byTime[t].records.length + byTime[t].free);
    }
    if (max > 0) return max;
    return metaFor(addr)?.boxes || 1; // день целиком закрыт — верим справочнику
}

function chainsFor(addressId) {
    return detectChains(flattenAddressRecords(state.board?.cells || {}, String(addressId)));
}

function pendingOps() {
    return state.ops.filter(o => o.status === 'pending');
}

// Бейдж на «Очереди» считает только то, чего пользователь ещё не видел:
// после открытия окна счётчик гаснет, а новые операции снова его зажигают.
// Отметка живёт в localStorage — переживает перезагрузку страницы.
const SEEN_OP_KEY = 'zm_records_seen_op';
let seenOpId = Number(localStorage.getItem(SEEN_OP_KEY) || 0);

function unseenOps() {
    let pending = 0;
    let failed = 0;
    for (const op of state.ops) {
        if (Number(op.id) <= seenOpId) continue;
        if (op.status === 'pending') pending++;
        else if (op.status === 'failed' && !op.lastError.includes('отменена')) failed++;
    }
    return { pending, failed };
}

function markOpsSeen() {
    const maxId = state.ops.reduce((m, o) => Math.max(m, Number(o.id) || 0), 0);
    if (maxId > seenOpId) {
        seenOpId = maxId;
        try { localStorage.setItem(SEEN_OP_KEY, String(maxId)); } catch { /* приватный режим */ }
    }
}

// Записи, которые прямо сейчас в очереди на удаление/перенос.
function pendingRecordIds() {
    const del = new Set();
    const moved = new Set();
    for (const op of pendingOps()) {
        if (op.type === 'delete') for (const r of op.payload.records || []) del.add(String(r.id));
        if (op.type === 'update') for (const r of op.payload.records || []) moved.add(String(r.id));
    }
    return { del, moved };
}

// «Призраки» — pending-создания на выбранную дату (для сетки и карточек).
function ghostsFor(addressId) {
    return pendingOps()
        .filter(o => o.type === 'create'
            && o.payload.date === state.date
            && String(o.payload.addressId) === String(addressId))
        .map(o => {
            const n = Math.max(1, Math.round((Number(o.payload.durationMinutes) || SLOT_MINUTES) / SLOT_MINUTES));
            return {
                opId: o.id,
                timeStart: o.payload.time,
                timeEnd: addMinutes(o.payload.time, n * SLOT_MINUTES),
                parts: n,
                name: o.payload.name,
            };
        });
}

// DD.MM.YYYY → YYYY-MM-DD (значение для <input type="date">) и обратно.
function ddmmToIso(d) {
    const m = String(d || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

function isoToDdmm(v) {
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

// Маска телефона (формат — formatRuPhone из shared/crmRecords.js), не
// мешающая правкам в середине: курсор возвращаем на ту же «цифру по счёту»,
// а не в конец строки.
function bindPhoneMask(input) {
    if (!input) return;
    const apply = () => {
        const before = input.value;
        const caret = input.selectionStart ?? before.length;
        const digitsLeft = before.slice(0, caret).replace(/\D/g, '').length;
        const formatted = formatRuPhone(before);
        if (formatted === before) return;
        input.value = formatted;
        let pos = formatted.length;
        if (digitsLeft > 0) {
            // +7 всегда впереди — отсчёт значимых цифр начинаем после него
            let seen = 0;
            for (let i = 3; i < formatted.length; i++) {
                if (/\d/.test(formatted[i])) seen++;
                if (seen === digitsLeft) { pos = i + 1; break; }
            }
        } else if (formatted) {
            pos = 4; // сразу внутрь скобок
        }
        input.setSelectionRange(pos, pos);
    };
    input.addEventListener('input', apply);
    input.addEventListener('paste', () => setTimeout(apply, 0));
}

function fmtAgo(iso) {
    if (!iso) return 'ещё не обновлялось';
    const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (sec < 15) return 'только что';
    if (sec < 60) return `${sec} сек назад`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} мин назад`;
    const h = Math.floor(min / 60);
    return `${h} ч ${min % 60} мин назад`;
}

// Оригинал считается «живым», если последний успешный синк недавно.
function isDown() {
    if (state.credsNeeded) return false;
    if (state.status && state.status.alive === false) return true;
    if (!state.fetchedAt) return !state.boardOk;
    const ageSec = (Date.now() - new Date(state.fetchedAt).getTime()) / 1000;
    return !state.boardOk || ageSec > 180;
}

function statusDotClass() {
    if (state.credsNeeded) return 'rc-dot-warn';
    return isDown() ? 'rc-dot-down' : 'rc-dot-ok';
}

// ── Иконки статусов записи ───────────────────────────────────────────────────

function statusIcon(status) {
    if (status === 'checked') return `<span class="rc-st rc-st-ok" title="Клиент приехал">${icons.check(11)}</span>`;
    if (status === 'late') return `<span class="rc-st rc-st-late" title="Клиент не приехал">${icons.x(11)}</span>`;
    if (status === 'new') return `<span class="rc-st rc-st-new" title="Новая запись">${icons.clock(11)}</span>`;
    return '';
}

// ── Рендер ───────────────────────────────────────────────────────────────────

function render() {
    if (!root) return;
    // Карта живёт внутри перерисовываемого DOM — запоминаем, куда её увели
    // мышью, иначе каждый чих в окне отбрасывал бы её к общему виду города.
    // Исключение — вид, только что заданный кодом (выбрали станцию): его
    // перетирать положением ещё живой старой карты нельзя.
    if (state.modal && mapCtl && !state.modal.mapViewForced) {
        try { state.modal.mapView = mapCtl.getView(); } catch { /* карта уже снята */ }
    }
    if (state.modal) state.modal.mapViewForced = false;
    if (state.credsNeeded) {
        root.innerHTML = renderCredsGate();
        bindCredsGate();
        return;
    }
    const content = !state.board
        ? `<div class="rc-boot">${state.boardLoading ? 'Загрузка записей…' : esc(state.boardError || 'Нет данных')}</div>`
        : state.view === 'station' ? renderStation() : renderOverview();

    root.innerHTML = `
        <div class="rc-shell">
            ${renderHeader()}
            ${renderBanner()}
            ${content}
        </div>
        ${state.modal ? renderModal() : ''}`;
    bind();
}

// Лёгкое обновление строки статуса без полной перерисовки (тикает раз в 10с).
// НИКОГДА не перерисовывает открытые формы: пока показан гейт кредов или
// модалка, ввод пользователя священен — иначе поля стираются под руками.
function renderStatusOnly() {
    if (state.modal) return;
    if (state.credsNeeded) {
        if (root?.querySelector('#rc-creds-form')) return; // форма уже на экране
        render();
        return;
    }
    const el = root?.querySelector('.rc-updated');
    if (!el) { render(); return; }
    el.innerHTML = statusLineHtml();
    const dot = root.querySelector('.rc-dot');
    if (dot) dot.className = `rc-dot ${statusDotClass()}`;
    const banner = root.querySelector('.rc-banner-slot');
    if (banner) banner.innerHTML = bannerHtml();
}

function statusLineHtml() {
    const pending = pendingOps().length;
    const queueNote = pending ? ` · в очереди: ${pending}` : '';
    const agoNote = state.fetchedAt ? `обновлено ${esc(fmtAgo(state.fetchedAt))}` : 'данных ещё нет';
    return `${agoNote}${queueNote}`;
}

function renderHeader() {
    const { pending, failed } = unseenOps();
    const today = state.status?.today;
    const tomorrow = state.status?.tomorrow;
    return `
    <header class="rc-top">
        <a class="btn btn-sec rc-home" href="#/" title="К калькулятору">${icons.back(15)}</a>
        <div class="rc-brand">${icons.pin(18)}<span>Записи</span></div>
        <nav class="rc-tabs">
            <button class="chip ${state.date === today ? 'active' : ''}" data-action="set-date" data-date="${esc(today)}">Сегодня</button>
            <button class="chip ${state.date === tomorrow ? 'active' : ''}" data-action="set-date" data-date="${esc(tomorrow)}">Завтра</button>
            <button class="chip rc-date-pick ${state.date && state.date !== today && state.date !== tomorrow ? 'active' : ''}" data-action="pick-date">
                ${icons.calendar(13)}<span>${state.date && state.date !== today && state.date !== tomorrow ? esc(state.date) : 'Дата'}</span>
            </button>
            <input type="date" id="rc-date-input" class="rc-date-input" value="${esc(ddmmToIso(state.date))}" tabindex="-1" aria-hidden="true"/>
        </nav>
        <div class="rc-searchbox">
            ${icons.search(14)}
            <input id="rc-search" type="search" placeholder="Имя, телефон или адрес…" autocomplete="off" value="${esc(state.search)}"/>
            <div id="rc-search-drop" class="rc-search-drop hidden"></div>
        </div>
        <div class="rc-topbtns">
            <button class="btn btn-sec" data-action="open-map" title="Карта станций">${icons.map(15)}<span class="rc-btn-label">Карта</span></button>
            <button class="btn btn-sec" data-action="open-queue" title="Очередь операций">
                ${icons.list(15)}<span class="rc-btn-label">Очередь</span>
                ${pending ? `<span class="rc-queue-badge">${pending}</span>` : ''}
                ${failed ? `<span class="rc-queue-badge rc-queue-badge-err">${failed}</span>` : ''}
            </button>
            <button class="btn btn-sec" data-action="refresh" title="Обновить сейчас">${icons.refresh(15)}</button>
            <button class="btn btn-sec" data-action="open-creds" title="Сменить логин/пароль админки">${icons.key(15)}</button>
        </div>
    </header>
    <div class="rc-statusline">
        <span class="rc-dot ${statusDotClass()}"></span>
        <span class="rc-updated">${statusLineHtml()}</span>
    </div>
    <div class="rc-banner-slot">${bannerHtml()}</div>`;
}

function bannerHtml() {
    if (state.credsNeeded || !isDown()) return '';
    const pending = pendingOps().length;
    return `
    <div class="rc-banner">
        ${icons.wifiOff(18)}
        <div>
            <b>Записи оригинала сейчас не работают.</b>
            Показаны данные, обновлённые ${esc(fmtAgo(state.fetchedAt))}.
            Записи можно создавать и менять — изменения встанут в очередь
            (${pending} шт.) и применятся автоматически, как только админка оживёт.
        </div>
    </div>`;
}

function renderBanner() { return ''; } // баннер живёт внутри header-блока (rc-banner-slot)

// ── Обзор всех станций ───────────────────────────────────────────────────────

function renderOverview() {
    const addrs = [...state.board.addresses];
    const withMeta = addrs.map(a => ({ addr: a, meta: metaFor(a) }));
    withMeta.sort((x, y) =>
        (x.meta?.line || 9) - (y.meta?.line || 9)
        || String(x.meta?.short || x.addr.title).localeCompare(String(y.meta?.short || y.addr.title), 'ru'));

    return `<main class="rc-overview">${withMeta.map(({ addr, meta }) => overviewCard(addr, meta)).join('')}</main>`;
}

function overviewCard(addr, meta) {
    const slots = state.board.timeSlots;
    const byTime = state.board.cells[addr.id] || {};
    const boxes = boxesFor(addr);
    const { del } = pendingRecordIds();
    const ghosts = ghostsFor(addr.id);
    const ghostTimes = new Set(ghosts.flatMap(g => {
        const out = [];
        for (let t = g.timeStart; timeToMin(t) < timeToMin(g.timeEnd); t = addMinutes(t, SLOT_MINUTES)) out.push(t);
        return out;
    }));

    let booked = 0;
    let free = 0;
    const ticks = slots.map(t => {
        const cell = byTime[t];
        if (!cell) return `<i class="rc-tick rc-tick-closed"></i>`;
        const alive = cell.records.filter(r => !del.has(String(r.id))).length;
        booked += alive;
        free += cell.free;
        const ghost = ghostTimes.has(t);
        if (alive >= boxes && boxes > 0) return `<i class="rc-tick rc-tick-full${ghost ? ' rc-tick-ghost' : ''}"></i>`;
        if (alive > 0) return `<i class="rc-tick rc-tick-part${ghost ? ' rc-tick-ghost' : ''}"></i>`;
        return `<i class="rc-tick rc-tick-free${ghost ? ' rc-tick-ghost' : ''}"></i>`;
    }).join('');

    const line = meta?.line;
    // Свободных мест мало/нет — это то, ради чего в карточку смотрят, поэтому
    // цветом выделена только эта таблетка; остальные держим нейтральными,
    // чтобы сетка не пестрела.
    const freeTone = free === 0 ? 'rc-pill-none' : free <= 5 ? 'rc-pill-low' : 'rc-pill-ok';
    return `
    <button class="rc-card" data-action="open-station" data-id="${esc(addr.id)}">
        <div class="rc-card-head">
            <span class="rc-line-dot" style="background:${line ? LINE_COLORS[line] : 'var(--sub)'}"></span>
            <b class="rc-card-name">${esc(meta?.short || addr.title)}</b>
        </div>
        <div class="rc-card-strip">${ticks}</div>
        <div class="rc-card-foot">
            <span class="rc-pill ${freeTone}">${free} свободно</span>
            <span class="rc-pill rc-pill-mute">${booked} зап.</span>
            <span class="rc-pill rc-pill-mute">${boxes} ${boxes === 1 ? 'бокс' : boxes < 5 ? 'бокса' : 'боксов'}</span>
            ${ghosts.length ? `<span class="rc-pill rc-pill-queue">${icons.clock(10)}${ghosts.length} в очереди</span>` : ''}
        </div>
    </button>`;
}

// ── Вид станции: дорожки-боксы и «червячки» ──────────────────────────────────

function renderStation() {
    const addr = stationById(state.stationId);
    if (!addr) { state.view = 'overview'; return renderOverview(); }
    const meta = metaFor(addr);
    const slots = state.board.timeSlots;
    const byTime = state.board.cells[addr.id] || {};
    const boxes = boxesFor(addr);
    const chains = chainsFor(addr.id);
    const { lanes, byHeadId } = assignLanes(chains, boxes);
    const { del, moved } = pendingRecordIds();
    const ghosts = ghostsFor(addr.id);

    const gridH = slots.length * ROW_H;

    const rows = slots.map((t, i) => {
        const cell = byTime[t];
        const closed = !cell;
        const freeN = cell ? cell.free : 0;
        return `
        <div class="rc-row ${closed ? 'rc-row-closed' : ''}" style="top:${i * ROW_H}px">
            <span class="rc-row-time">${esc(t)}</span>
            ${freeN > 0
                ? `<button class="rc-row-free" data-action="create-at" data-time="${esc(t)}" title="Свободно боксов: ${freeN} — создать запись">${icons.plus(12)}<i>${freeN}</i></button>`
                : (closed ? '<span class="rc-row-closed-label">закрыто</span>' : '')}
        </div>`;
    }).join('');

    const startIdx = (t) => slots.indexOf(t);

    const caps = chains.map(chain => {
        const lane = byHeadId[chain.head.id] ?? 0;
        const i0 = startIdx(chain.timeStart);
        if (i0 === -1) return '';
        const nParts = chain.parts.length;
        const isDeleting = chain.parts.some(p => del.has(String(p.id)));
        const isMoving = chain.parts.some(p => moved.has(String(p.id)));
        const segs = chain.parts.map((p, idx) => idx === 0 ? '' :
            `<i class="rc-cap-seg" style="top:${idx * ROW_H - 1}px"></i>`).join('');
        return `
        <button class="rc-cap rc-cap-st-${chain.head.status || 'none'}
                ${nParts > 1 ? 'rc-cap-worm' : ''}
                ${isDeleting ? 'rc-cap-deleting' : ''} ${isMoving ? 'rc-cap-moving' : ''}
                ${String(state.highlightId) === String(chain.head.id) ? 'rc-cap-hot' : ''}"
            data-action="open-chain" data-head="${esc(chain.head.id)}"
            style="top:${i0 * ROW_H + 2}px; height:${nParts * ROW_H - 5}px;
                   left:calc((100% / ${lanes}) * ${lane} + 3px);
                   width:calc(100% / ${lanes} - 7px)">
            ${segs}
            <span class="rc-cap-line1">
                ${statusIcon(chain.head.status)}
                <b>${esc(chain.head.name || chain.head.customer || 'без имени')}</b>
                ${nParts > 1 ? `<span class="rc-cap-worm-badge">${icons.link(10)}${nParts}</span>` : ''}
            </span>
            <span class="rc-cap-line2">${esc(chain.timeStart)}–${esc(chain.timeEnd)}${chain.head.phone && !chain.head.isStub ? ` · ${esc(chain.head.phone)}` : ''}</span>
            ${isDeleting ? `<span class="rc-cap-flag">${icons.trash(10)} удаляется…</span>` : ''}
            ${isMoving ? `<span class="rc-cap-flag">${icons.move(10)} переносится…</span>` : ''}
        </button>`;
    }).join('');

    const ghostCaps = ghosts.map(g => {
        const i0 = startIdx(g.timeStart);
        if (i0 === -1) return '';
        return `
        <div class="rc-cap rc-cap-ghost" style="top:${i0 * ROW_H + 2}px; height:${g.parts * ROW_H - 5}px;
                left:3px; width:calc(100% - 7px)"
             title="В очереди — создастся, когда админка оживёт">
            <span class="rc-cap-line1">${icons.clock(11)}<b>${esc(g.name)}</b></span>
            <span class="rc-cap-line2">${esc(g.timeStart)}–${esc(g.timeEnd)} · в очереди</span>
        </div>`;
    }).join('');

    const laneHeads = Array.from({ length: lanes }, (_, i) =>
        `<span class="rc-lane-head">Бокс ${i + 1}</span>`).join('');

    return `
    <main class="rc-station">
        <div class="rc-station-head">
            <button class="btn btn-sec" data-action="back">${icons.back(15)}<span class="rc-btn-label">Все станции</span></button>
            <div class="rc-station-title">
                <span class="rc-line-dot" style="background:${meta?.line ? LINE_COLORS[meta.line] : 'var(--sub)'}"></span>
                <b>${esc(meta?.short || addr.title)}</b>
                <span class="rc-station-full">${esc(addr.title)}</span>
            </div>
            <div class="rc-station-chips">
                ${meta?.metro ? `<span class="rc-chip-meta">${esc(meta.metro)}${meta.line ? ` · ${esc(LINE_NAMES[meta.line] || '')}` : ''}</span>` : ''}
                ${meta?.layout ? `<span class="rc-chip-meta">${esc(meta.layout)}</span>` : ''}
                ${meta?.height ? `<span class="rc-chip-meta">до ${esc(meta.height)}</span>` : ''}
                ${meta?.note ? `<span class="rc-chip-meta rc-chip-note">${esc(meta.note)}</span>` : ''}
            </div>
            <button class="btn btn-pri" data-action="create-at" data-time="">${icons.plus(14)} Новая запись</button>
        </div>
        <div class="rc-lanes-heads" style="--lanes:${lanes}">${laneHeads}</div>
        <div class="rc-grid" style="height:${gridH}px">
            <div class="rc-rows">${rows}</div>
            <div class="rc-lanes" style="--lanes:${lanes}">
                ${Array.from({ length: Math.max(0, lanes - 1) }, (_, i) =>
                    `<i class="rc-lane-sep" style="left:calc((100% / ${lanes}) * ${i + 1})"></i>`).join('')}
                ${ghostCaps}${caps}
            </div>
        </div>
    </main>`;
}

// ── Модалки ──────────────────────────────────────────────────────────────────

function renderModal() {
    const m = state.modal;
    const inner = m.kind === 'create' ? modalCreate(m)
        : m.kind === 'chain' ? modalChain(m)
        : m.kind === 'move' ? modalMove(m)
        : m.kind === 'extend' ? modalExtend(m)
        : m.kind === 'delete' ? modalDelete(m)
        : m.kind === 'edit' ? modalEdit(m)
        : m.kind === 'queue' ? modalQueue()
        : m.kind === 'map' ? modalMap(m)
        : m.kind === 'creds' ? modalCreds()
        : '';
    return `
    <div class="modal rc-modal">
        <div class="modal-backdrop" data-action="close-modal"></div>
        ${inner}
    </div>`;
}

function modalShell(title, body, { wide = false, map = false } = {}) {
    return `
    <div class="modal-win ${map ? 'rc-win-map' : wide ? 'rc-win-wide' : ''}">
        <div class="modal-head"><span>${title}</span>
            <button class="btn btn-sec" data-action="close-modal">${icons.x(14)}</button>
        </div>
        <div class="modal-body rc-modal-body ${map ? 'rc-modal-body-map' : ''}">${body}</div>
    </div>`;
}

// Свободен ли слот t на станции addr (для превью длительности и окон переноса).
function slotFree(addrId, t, board = state.board) {
    const cell = board?.cells?.[String(addrId)]?.[t];
    return Boolean(cell && cell.free > 0);
}

function durationChips(selected) {
    const opts = [30, 60, 90, 120, 150, 180];
    return opts.map(min => `
        <button class="chip ${min === selected ? 'active' : ''}" data-action="set-duration" data-min="${min}">
            ${min % 60 === 0 ? `${min / 60} ч` : min < 60 ? `${min} мин` : `${Math.floor(min / 60)} ч ${min % 60} м`}
        </button>`).join('');
}

// Превью занимаемого места: вертикальная лента слотов от выбранного времени.
function durationPreview(addrId, time, durationMin, board = state.board) {
    if (!time || !board) return '';
    const need = Math.ceil(durationMin / SLOT_MINUTES);
    const slots = board.timeSlots;
    const items = [];
    let ok = true;
    for (let i = 0; i < need; i++) {
        const t = addMinutes(time, i * SLOT_MINUTES);
        const free = slots.includes(t) && slotFree(addrId, t, board);
        if (!free) ok = false;
        items.push(`<span class="rc-prev-slot ${free ? 'rc-prev-ok' : 'rc-prev-bad'}">${esc(t)}</span>`);
    }
    return `
    <div class="rc-duration-preview ${ok ? '' : 'rc-duration-conflict'}">
        <div class="rc-prev-track">${items.join('')}</div>
        <div class="rc-prev-note">${ok
            ? `займёт ${need} ${need === 1 ? 'слот' : need < 5 ? 'слота' : 'слотов'} · до ${esc(addMinutes(time, durationMin))}`
            : `${icons.alert(12)} не влезает: часть слотов занята или закрыта`}</div>
    </div>`;
}

function freeTimesFor(addrId, board = state.board) {
    if (!board) return [];
    return board.timeSlots.filter(t => slotFree(addrId, t, board));
}

// Доска, к которой относится окно создания: для чужой даты — своя,
// подгруженная отдельно (пока грузится — null, время выбирать не из чего).
function createBoard(m) {
    if (!m.date || m.date === state.date) return state.board;
    return m.dateBoard || null;
}

function modalCreate(m) {
    const board = createBoard(m);
    const addr = stationById(m.addressId, board);
    const meta = metaFor(addr);
    const free = freeTimesFor(m.addressId, board);
    const today = state.status?.today;
    const tomorrow = state.status?.tomorrow;
    const otherDate = m.date && m.date !== today && m.date !== tomorrow;
    const body = `
    <div class="rc-create">
        <div class="rc-create-form">
            <div class="rc-field-row">
                <label class="edit-field rc-grow"><span>Имя клиента</span>
                    <input id="rc-f-name" type="text" value="${esc(m.name || '')}" placeholder="Иван двс"/></label>
                <label class="edit-field rc-grow"><span>Телефон</span>
                    <input id="rc-f-phone" type="tel" value="${esc(m.phone || '')}" placeholder="+7 (9__) ___-__-__"/></label>
            </div>
            <div class="rc-field-row">
                <label class="edit-field rc-grow"><span>Госномер</span>
                    <input id="rc-f-car" type="text" value="${esc(m.carNumber || '')}"/></label>
            </div>
            <label class="edit-field"><span>Комментарий</span>
                <textarea id="rc-f-comment" rows="2">${esc(m.comment || '')}</textarea></label>

            <div class="rc-sub">Станция — <b>${esc(meta?.short || addr?.title || '')}</b>
                <button class="btn btn-sec rc-mini-btn" data-action="toggle-create-map">${icons.map(13)} сменить на карте</button>
            </div>
            <div class="rc-station-select">
                <select id="rc-f-station">
                    ${(board?.addresses || state.board.addresses).map(a => {
                        const am = metaFor(a);
                        return `<option value="${esc(a.id)}" ${String(a.id) === String(m.addressId) ? 'selected' : ''}>${esc(am?.short || a.title)}</option>`;
                    }).join('')}
                </select>
            </div>
            <div id="rc-create-map" class="rc-create-map ${m.showMap ? '' : 'hidden'}"></div>

            <div class="rc-sub">Дата</div>
            <div class="rc-times">
                <button class="chip ${m.date === today ? 'active' : ''}" data-action="set-create-date" data-date="${esc(today)}">Сегодня</button>
                <button class="chip ${m.date === tomorrow ? 'active' : ''}" data-action="set-create-date" data-date="${esc(tomorrow)}">Завтра</button>
                <button class="chip rc-date-pick ${otherDate ? 'active' : ''}" data-action="pick-create-date">
                    ${icons.calendar(13)}<span>${otherDate ? esc(m.date) : 'Другая дата'}</span>
                </button>
                <input type="date" id="rc-f-date" class="rc-date-input" value="${esc(ddmmToIso(m.date))}" tabindex="-1" aria-hidden="true"/>
            </div>

            <div class="rc-sub">Время (${esc(m.date || '')})</div>
            <div class="rc-times rc-times-scroll">
                ${m.dateLoading ? '<span class="rc-empty-note">смотрю свободные слоты на ' + esc(m.date) + '…</span>'
                    : m.dateError ? `<span class="rc-empty-note">${esc(m.dateError)}</span>`
                    : free.length ? free.map(t => `
                        <button class="chip ${t === m.time ? 'active' : ''}" data-action="set-create-time" data-time="${esc(t)}">${esc(t)}</button>`).join('')
                    : '<span class="rc-empty-note">свободных слотов нет — выбери другую станцию или дату</span>'}
            </div>

            <div class="rc-sub">Длительность</div>
            <div class="rc-times">${durationChips(m.durationMinutes)}</div>
            ${durationPreview(m.addressId, m.time, m.durationMinutes, board)}

            ${m.error ? `<div class="rc-form-error">${icons.alert(13)} ${esc(m.error)}</div>` : ''}
            <div class="modal-actions">
                <button class="btn btn-pri" data-action="submit-create">${icons.plus(14)} Записать${isDown() ? ' (встанет в очередь)' : ''}</button>
            </div>
        </div>
    </div>`;
    return modalShell('Новая запись', body, { wide: true });
}

function chainByHead(headId) {
    for (const addr of state.board.addresses) {
        const chain = chainsFor(addr.id).find(c => String(c.head.id) === String(headId));
        if (chain) return { chain, addr };
    }
    return null;
}

function modalChain(m) {
    const found = chainByHead(m.headId);
    if (!found) return modalShell('Запись', '<div class="rc-empty-note">Запись уже исчезла с доски (обновите)</div>');
    const { chain, addr } = found;
    const meta = metaFor(addr);
    const n = chain.parts.length;
    const body = `
    <div class="rc-chain">
        <div class="rc-chain-info">
            <div class="rc-chain-name">${statusIcon(chain.head.status)}<b>${esc(chain.head.name || 'без имени')}</b></div>
            ${chain.head.phone && !chain.head.isStub ? `<div class="rc-chain-row">${esc(chain.head.phone)}</div>` : ''}
            <div class="rc-chain-row">${esc(meta?.short || addr.title)} · ${esc(state.date || '')} · ${esc(chain.timeStart)}–${esc(chain.timeEnd)}</div>
            ${n > 1 ? `<div class="rc-chain-row rc-chain-worm">${icons.link(12)} продлённая запись: ${n} слотов по 30 минут</div>` : ''}
        </div>
        <div class="rc-chain-actions">
            <button class="btn btn-sec" data-action="open-move" data-head="${esc(chain.head.id)}">${icons.move(14)} Перенести ${n > 1 ? 'всю запись' : ''}</button>
            <button class="btn btn-sec" data-action="open-extend" data-head="${esc(chain.head.id)}">${icons.clock(14)} Продлить</button>
            <button class="btn btn-sec" data-action="open-edit" data-head="${esc(chain.head.id)}">${icons.edit(14)} Изменить данные</button>
            <button class="btn btn-sec" data-action="copy-chain" data-head="${esc(chain.head.id)}">${icons.copy(14)} Копировать</button>
            <button class="btn btn-sec rc-btn-danger" data-action="open-delete" data-head="${esc(chain.head.id)}">${icons.trash(14)} Удалить</button>
        </div>
        ${m.copied ? `<div class="rc-copied-note">${icons.check(12)} Скопировано в буфер</div>` : ''}
    </div>`;
    return modalShell('Запись', body);
}

function modalExtend(m) {
    const found = chainByHead(m.headId);
    if (!found) return modalShell('Продлить', '<div class="rc-empty-note">Запись уже исчезла с доски</div>');
    const { chain, addr } = found;
    // Непрерывные свободные слоты сразу после конца записи.
    const options = [];
    let t = chain.timeEnd;
    while (state.board.timeSlots.includes(t) && slotFree(addr.id, t) && options.length < 8) {
        options.push(t);
        t = addMinutes(t, SLOT_MINUTES);
    }
    const body = `
    <div>
        <div class="rc-chain-row"><b>${esc(chain.head.name)}</b> · сейчас до ${esc(chain.timeEnd)}</div>
        ${options.length ? `
            <div class="rc-sub">Продлить на</div>
            <div class="rc-times">
                ${options.map((_, i) => {
                    const min = (i + 1) * SLOT_MINUTES;
                    return `<button class="chip ${m.extendMinutes === min ? 'active' : ''}" data-action="set-extend" data-min="${min}">
                        +${min % 60 === 0 ? `${min / 60} ч` : min < 60 ? `${min} мин` : `${Math.floor(min / 60)} ч ${min % 60} м`}
                        <small>до ${esc(addMinutes(chain.timeEnd, min))}</small></button>`;
                }).join('')}
            </div>
            <div class="rc-prev-note">Продолжения создаются отдельными слотами с телефоном-заглушкой — SMS клиенту не уйдёт (как в оригинальном скрипте).</div>
            <div class="modal-actions">
                <button class="btn btn-pri" data-action="submit-extend" ${m.extendMinutes ? '' : 'disabled'}>${icons.clock(14)} Продлить${isDown() ? ' (в очередь)' : ''}</button>
            </div>`
            : '<div class="rc-empty-note">Сразу после записи свободных слотов нет — продлить некуда.</div>'}
    </div>`;
    return modalShell('Продлить запись', body);
}

function modalEdit(m) {
    const found = chainByHead(m.headId);
    if (!found) return modalShell('Изменить', '<div class="rc-empty-note">Запись уже исчезла с доски</div>');
    const { chain } = found;
    const body = `
    <div class="rc-create-form">
        <label class="edit-field"><span>Имя</span>
            <input id="rc-e-name" type="text" value="${esc(m.name ?? chain.head.name)}"/></label>
        <label class="edit-field"><span>Телефон</span>
            <input id="rc-e-phone" type="tel" value="${esc(m.phone ?? (chain.head.isStub ? '' : chain.head.phone))}"/></label>
        <label class="edit-field"><span>Госномер <small class="rc-dim">(пусто = не менять)</small></span>
            <input id="rc-e-car" type="text" value="${esc(m.carNumber || '')}"/></label>
        <label class="edit-field"><span>Комментарий <small class="rc-dim">(пусто = не менять)</small></span>
            <textarea id="rc-e-comment" rows="2">${esc(m.comment || '')}</textarea></label>
        <div class="rc-prev-note">Имя меняется у всех ${chain.parts.length} слотов записи, остальное — только у первого.</div>
        ${m.error ? `<div class="rc-form-error">${icons.alert(13)} ${esc(m.error)}</div>` : ''}
        <div class="modal-actions">
            <button class="btn btn-pri" data-action="submit-edit">${icons.check(14)} Сохранить${isDown() ? ' (в очередь)' : ''}</button>
        </div>
    </div>`;
    return modalShell('Изменить данные', body);
}

function modalDelete(m) {
    const found = chainByHead(m.headId);
    if (!found) return modalShell('Удалить', '<div class="rc-empty-note">Запись уже исчезла с доски</div>');
    const { chain } = found;
    const checked = m.checked || new Set(chain.parts.map(p => String(p.id)));
    const body = `
    <div>
        ${chain.parts.length > 1
            ? `<div class="rc-chain-row rc-chain-worm">${icons.link(12)} Это продлённая запись — выбери, какие слоты удалить (по умолчанию все):</div>`
            : `<div class="rc-chain-row">Удалить запись?</div>`}
        <div class="rc-del-list">
            ${chain.parts.map(p => `
                <label class="rc-del-item">
                    <input type="checkbox" data-action="toggle-del" data-id="${esc(p.id)}" ${checked.has(String(p.id)) ? 'checked' : ''}/>
                    <span>${esc(p.timeStart)}–${esc(p.timeEnd)} · ${esc(p.name || p.customer)}${p.isStub ? ' <small class="rc-dim">(продление)</small>' : ''}</span>
                </label>`).join('')}
        </div>
        <div class="modal-actions">
            <button class="btn btn-pri rc-btn-danger" data-action="submit-delete">${icons.trash(14)} Удалить выбранное${isDown() ? ' (в очередь)' : ''}</button>
        </div>
    </div>`;
    return modalShell('Удаление', body);
}

function modalMove(m) {
    const found = chainByHead(m.headId);
    if (!found) return modalShell('Перенести', '<div class="rc-empty-note">Запись уже исчезла с доски</div>');
    const { chain, addr } = found;
    const n = chain.parts.length;
    const targetAddrId = m.targetAddressId || addr.id;
    const targetBoard = m.targetDate === state.date ? state.board : m.targetBoard;

    // Стартовые времена, куда влезает вся цепочка (n подряд свободных слотов).
    let starts = [];
    if (targetBoard) {
        const slots = targetBoard.timeSlots;
        starts = slots.filter(t0 => {
            for (let i = 0; i < n; i++) {
                const t = addMinutes(t0, i * SLOT_MINUTES);
                if (!slots.includes(t)) return false;
                const cell = targetBoard.cells[String(targetAddrId)]?.[t];
                // при переносе в пределах той же станции/даты свои же слоты считаем свободными
                const own = m.targetDate === state.date && String(targetAddrId) === String(addr.id)
                    && chain.parts.some(p => p.timeStart === t);
                if (!own && !(cell && cell.free > 0)) return false;
            }
            return true;
        });
    }

    const today = state.status?.today;
    const tomorrow = state.status?.tomorrow;
    const body = `
    <div class="rc-move">
        <div class="rc-chain-row"><b>${esc(chain.head.name)}</b> · ${n > 1 ? `вся запись (${n} слотов), ` : ''}${esc(chain.timeStart)}–${esc(chain.timeEnd)}</div>
        <div class="rc-sub">Куда</div>
        <div class="rc-times">
            <button class="chip ${m.targetDate === today ? 'active' : ''}" data-action="move-date" data-date="${esc(today)}">Сегодня</button>
            <button class="chip ${m.targetDate === tomorrow ? 'active' : ''}" data-action="move-date" data-date="${esc(tomorrow)}">Завтра</button>
        </div>
        <div class="rc-station-select">
            <select id="rc-move-station">
                ${(targetBoard?.addresses || state.board.addresses).map(a => {
                    const am = findStationMeta(a.title);
                    return `<option value="${esc(a.id)}" ${String(a.id) === String(targetAddrId) ? 'selected' : ''}>${esc(am?.short || a.title)}</option>`;
                }).join('')}
            </select>
            <button class="btn btn-sec rc-mini-btn" data-action="toggle-move-map">${icons.map(13)} карта</button>
        </div>
        <div id="rc-move-map" class="rc-create-map ${m.showMap ? '' : 'hidden'}"></div>
        <div class="rc-sub">Начало (нужно ${n} подряд свободных слотов)</div>
        <div class="rc-times rc-times-scroll">
            ${!targetBoard ? '<span class="rc-empty-note">загружаю день…</span>'
                : starts.length ? starts.map(t => `
                    <button class="chip ${m.targetTime === t ? 'active' : ''}" data-action="move-time" data-time="${esc(t)}">${esc(t)}</button>`).join('')
                : '<span class="rc-empty-note">нет окна нужной длины — выбери другую станцию или день</span>'}
        </div>
        ${m.error ? `<div class="rc-form-error">${icons.alert(13)} ${esc(m.error)}</div>` : ''}
        <div class="modal-actions">
            <button class="btn btn-pri" data-action="submit-move" ${m.targetTime ? '' : 'disabled'}>
                ${icons.move(14)} Перенести${isDown() ? ' (в очередь)' : ''}</button>
        </div>
    </div>`;
    return modalShell(`Перенос ${n > 1 ? 'всей записи' : 'записи'}`, body, { wide: true });
}

function modalQueue() {
    const ops = state.ops;
    const opLabel = (op) => {
        const p = op.payload || {};
        if (op.type === 'create') return `Создать: ${p.name || ''} · ${p.date || ''} ${p.time || ''} (${(Number(p.durationMinutes) || 30)} мин)`;
        if (op.type === 'update') return `Перенос/правка: ${(p.records || []).length} слот(ов)`;
        if (op.type === 'delete') return `Удалить: ${(p.records || []).length} слот(ов)`;
        return op.type;
    };
    const stIcon = (op) => op.status === 'pending' ? `<span class="rc-st rc-st-new">${icons.clock(11)}</span>`
        : op.status === 'done' ? `<span class="rc-st rc-st-ok">${icons.check(11)}</span>`
        : `<span class="rc-st rc-st-late">${icons.x(11)}</span>`;
    const body = `
    <div class="rc-queue">
        ${ops.length ? ops.map(op => `
            <div class="rc-queue-item rc-queue-${op.status}">
                ${stIcon(op)}
                <div class="rc-queue-main">
                    <div>${esc(opLabel(op))}</div>
                    <div class="rc-queue-sub">${new Date(op.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                        ${op.status === 'failed' && op.lastError ? ` · ${esc(op.lastError)}` : ''}
                        ${op.status === 'pending' && op.attempts > 0 ? ` · попыток: ${op.attempts}` : ''}</div>
                </div>
                ${op.status === 'pending' ? `<button class="btn btn-sec rc-mini-btn" data-action="cancel-op" data-id="${op.id}">${icons.x(12)} отменить</button>` : ''}
            </div>`).join('')
            : '<div class="rc-empty-note">Операций пока не было</div>'}
    </div>`;
    return modalShell('Очередь операций', body);
}

function modalMap(m) {
    const body = `
    <div class="rc-map-modal">
        <div class="rc-map-search">
            ${icons.search(14)}
            <input id="rc-map-q" type="search" placeholder="Улица или адрес — покажу ближайшие станции…" autocomplete="off" value="${esc(m.query || '')}"/>
        </div>
        <div class="rc-map-layout">
            <div id="rc-map-near" class="rc-map-near">
                ${m.near ? m.near.map(s => `
                    <button class="rc-near-item" data-action="near-pick" data-short="${esc(s.short)}" data-lat="${s.lat}" data-lng="${s.lng}">
                        <span class="rc-line-dot" style="background:${LINE_COLORS[s.line] || 'var(--sub)'}"></span>
                        <b>${esc(s.short)}</b>
                        <span class="rc-near-dist">${s.distanceKm < 1 ? `${Math.round(s.distanceKm * 1000)} м` : `${s.distanceKm.toFixed(1)} км`}</span>
                    </button>`).join('')
                    : '<div class="rc-empty-note">Введи улицу — подскажу, какие станции рядом. Клик по плашке на карте открывает станцию.</div>'}
            </div>
            <div id="rc-big-map" class="rc-big-map"></div>
        </div>
    </div>`;
    return modalShell('Карта станций', body, { map: true });
}

function modalCreds() {
    return modalShell('Логин и пароль админки', credsFormHtml());
}

function credsFormHtml() {
    return `
    <form id="rc-creds-form" class="rc-creds-form">
        <p class="rc-creds-note">Один общий логин/пароль от оригинальной админки
        (zamena-masla-spot.ru). Вводится один раз — сервер сохранит его,
        будет сам продлевать сессию, и страница заработает у всех сразу.</p>
        <label class="edit-field"><span>Логин</span>
            <input id="rc-creds-login" type="text" autocomplete="username" required/></label>
        <label class="edit-field"><span>Пароль</span>
            <input id="rc-creds-password" type="password" autocomplete="current-password" required/></label>
        <div id="rc-creds-error" class="rc-form-error ${state.credsError ? '' : 'hidden'}">${esc(state.credsError)}</div>
        <div class="modal-actions">
            <button type="submit" class="btn btn-pri">${icons.key(14)} Сохранить и подключиться</button>
        </div>
    </form>`;
}

function renderCredsGate() {
    return `
    <div class="rc-shell rc-gate">
        <div class="rc-gate-card">
            <div class="rc-brand rc-gate-brand">${icons.pin(20)}<span>Записи</span></div>
            ${credsFormHtml()}
        </div>
    </div>`;
}

// ── Поиск ────────────────────────────────────────────────────────────────────

function runSearch(q) {
    const drop = document.getElementById('rc-search-drop');
    if (!drop) return;
    const query = q.trim().toLowerCase();
    if (query.length < 2 || !state.board) { drop.classList.add('hidden'); drop.innerHTML = ''; return; }
    const digits = query.replace(/\D/g, '');
    const out = [];
    for (const addr of state.board.addresses) {
        const meta = metaFor(addr);
        const addrLabel = (meta?.short || addr.title);
        const addrMatch = addr.title.toLowerCase().includes(query)
            || addrLabel.toLowerCase().includes(query)
            || (meta?.metro || '').toLowerCase().includes(query);
        for (const chain of chainsFor(addr.id)) {
            const r = chain.head;
            const nameMatch = (r.name || '').toLowerCase().includes(query);
            const phoneMatch = digits.length >= 3 && r.phoneDigits.includes(digits) && !r.isStub;
            if (nameMatch || phoneMatch || addrMatch) {
                out.push({ addr, addrLabel, chain });
                if (out.length >= 30) break;
            }
        }
        if (out.length >= 30) break;
    }
    // Телефон показываем всегда: при поиске по цифрам иначе непонятно, почему
    // выпала именно эта запись.
    drop.innerHTML = out.length ? out.map(({ addr, addrLabel, chain }) => `
        <button class="rc-search-item" data-action="search-pick" data-station="${esc(addr.id)}" data-head="${esc(chain.head.id)}">
            <span class="rc-search-line">
                <b>${esc(chain.head.name || 'без имени')}</b>
                ${chain.head.phone && !chain.head.isStub ? `<em class="rc-search-phone">${esc(chain.head.phone)}</em>` : ''}
            </span>
            <span>${esc(addrLabel)} · ${esc(chain.timeStart)}–${esc(chain.timeEnd)}${chain.parts.length > 1 ? ` · ${chain.parts.length} слота` : ''}</span>
        </button>`).join('')
        : '<div class="rc-empty-note rc-search-empty">Ничего не нашлось на этот день</div>';
    drop.classList.remove('hidden');
}

// ── Карты в модалках ─────────────────────────────────────────────────────────

function destroyMapCtl() {
    if (mapCtl) { try { mapCtl.destroy(); } catch { /* уже снят */ } mapCtl = null; }
}

function busyCountByShort(board = state.board) {
    const counts = {};
    if (!board) return counts;
    for (const addr of board.addresses) {
        const meta = metaFor(addr);
        if (!meta) continue;
        let n = 0;
        const byTime = board.cells[addr.id] || {};
        for (const t of Object.keys(byTime)) n += byTime[t].records.length;
        counts[meta.short] = (counts[meta.short] || 0) + n;
    }
    return counts;
}

// Клик по плашке на карте → address_id на текущей доске.
function addrIdByMeta(meta, board = state.board) {
    if (!board) return null;
    for (const addr of board.addresses) {
        if (findStationMeta(addr.title)?.short === meta.short) return addr.id;
    }
    return null;
}

// activeShort — станция, которую подсветить (выбранная в окне записи).
// board — доска, по которой считать загрузку станций (в окне записи это может
// быть другой день, а не тот, что открыт на экране).
function initModalMap(containerId, onPickMeta, activeShort = null, board = state.board) {
    const el = document.getElementById(containerId);
    if (!el) return;
    destroyMapCtl();
    mapCtl = createStationsMap(el, { onPick: onPickMeta, view: state.modal?.mapView });
    mapCtl.setBusy(busyCountByShort(board));
    if (activeShort) mapCtl.highlight(activeShort);
    mapCtl.invalidate();
}

// Клик по станции на карте в окне записи: центрируем карту на ней и
// отдаляем ровно настолько, чтобы соседние станции остались на виду —
// иначе следующий выбор пришлось бы искать заново.
function focusPickedStation(meta) {
    if (!state.modal) return;
    state.modal.mapView = { lat: meta.lat, lng: meta.lng, zoom: 12 };
    state.modal.mapViewForced = true; // ближайший render() этот вид не тронет
}

// Стартовый вид мини-карты — вокруг уже выбранной станции.
function ensureMapViewFor(addressId) {
    if (!state.modal || state.modal.mapView) return;
    const meta = metaFor(stationById(addressId));
    if (meta) state.modal.mapView = { lat: meta.lat, lng: meta.lng, zoom: 12 };
}

// ── Бинды ────────────────────────────────────────────────────────────────────

function bindCredsGate() {
    bindCredsForm();
}

function bindCredsForm() {
    const form = document.getElementById('rc-creds-form');
    if (!form) return;
    form.onsubmit = async (e) => {
        e.preventDefault();
        const login = document.getElementById('rc-creds-login').value.trim();
        const password = document.getElementById('rc-creds-password').value;
        const errEl = document.getElementById('rc-creds-error');
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Проверяю…';
        try {
            await apiFetch('/api/records/credentials', { method: 'POST', body: { login, password } });
            state.credsNeeded = false;
            state.credsError = '';
            state.modal = null;
            render();
            await loadStatus();
            await loadBoard();
        } catch (err) {
            state.credsError = err.message;
            if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
            btn.disabled = false;
            btn.innerHTML = `${icons.key(14)} Сохранить и подключиться`;
        }
    };
}

function bind() {
    // Поиск
    const search = document.getElementById('rc-search');
    if (search) {
        search.oninput = () => { state.search = search.value; runSearch(search.value); };
        search.onfocus = () => runSearch(search.value);
    }
    // Выбор произвольной даты
    const dateInput = document.getElementById('rc-date-input');
    if (dateInput) {
        dateInput.onchange = () => {
            const date = isoToDdmm(dateInput.value);
            if (!date) return;
            state.date = date;
            state.view = 'overview';
            state.highlightId = null;
            loadBoard();
        };
    }

    // Маска телефона в окнах создания и правки
    bindPhoneMask(document.getElementById('rc-f-phone'));
    bindPhoneMask(document.getElementById('rc-e-phone'));
    // Произвольная дата в окне создания записи
    const createDate = document.getElementById('rc-f-date');
    if (createDate) {
        createDate.onchange = () => {
            const date = isoToDdmm(createDate.value);
            if (date) setCreateDate(date);
        };
    }
    // Селекты в модалках
    const stSel = document.getElementById('rc-f-station');
    if (stSel) {
        stSel.onchange = () => {
            keepCreateFields();
            state.modal.addressId = stSel.value;
            revalidateCreatePick();
            const meta = metaFor(stationById(state.modal.addressId, createBoard(state.modal)));
            if (meta) focusPickedStation(meta); // карта едет за выбором из списка
            render();
        };
    }
    const mvSel = document.getElementById('rc-move-station');
    if (mvSel) {
        mvSel.onchange = () => {
            state.modal.targetAddressId = mvSel.value;
            state.modal.targetTime = null;
            const meta = metaFor(stationById(mvSel.value));
            if (meta) focusPickedStation(meta);
            render();
        };
    }
    bindCredsForm();

    // Карты в модалках
    if (state.modal?.kind === 'map') {
        initModalMap('rc-big-map', (meta) => {
            const id = addrIdByMeta(meta);
            if (id) {
                destroyMapCtl();
                state.modal = null;
                state.view = 'station';
                state.stationId = id;
                render();
            }
        }, state.view === 'station' ? metaFor(stationById(state.stationId))?.short : null);
        const q = document.getElementById('rc-map-q');
        if (q) {
            q.oninput = () => {
                clearTimeout(geocodeTimer);
                const val = q.value.trim();
                state.modal.query = val;
                if (val.length < 3) return;
                const nearEl = () => document.getElementById('rc-map-near');
                const setNearHtml = (html) => { const el = nearEl(); if (el) el.innerHTML = html; };
                setNearHtml('<div class="rc-empty-note">Ищу адрес…</div>');
                geocodeTimer = setTimeout(async () => {
                    let hits;
                    try {
                        hits = await geocodeStreet(val);
                    } catch {
                        // Молчать нельзя: пустой список неотличим от «ничего не
                        // нашлось», а причина другая — геокодер не ответил.
                        if (state.modal?.kind === 'map') {
                            setNearHtml('<div class="rc-empty-note">Поиск по адресу сейчас недоступен — выбери станцию на карте.</div>');
                        }
                        return;
                    }
                    if (state.modal?.kind !== 'map') return;
                    if (!hits.length) {
                        state.modal.near = null;
                        setNearHtml('<div class="rc-empty-note">Такой адрес не нашёлся. Попробуй иначе: «Оптиков 2», «проспект Ветеранов».</div>');
                        return;
                    }
                    state.modal.near = stationsNear(hits[0].lat, hits[0].lng, 6);
                    mapCtl?.focus(hits[0].lat, hits[0].lng, 13);
                    setNearHtml(
                        `<div class="rc-near-head">${esc(hits[0].label)}</div>`
                        + state.modal.near.map(s => `
                            <button class="rc-near-item" data-action="near-pick" data-short="${esc(s.short)}" data-lat="${s.lat}" data-lng="${s.lng}">
                                <span class="rc-line-dot" style="background:${LINE_COLORS[s.line] || 'var(--sub)'}"></span>
                                <b>${esc(s.short)}</b>
                                <span class="rc-near-dist">${s.distanceKm < 1 ? `${Math.round(s.distanceKm * 1000)} м` : `${s.distanceKm.toFixed(1)} км`}</span>
                            </button>`).join(''),
                    );
                }, 500);
            };
        }
    }
    if (state.modal?.kind === 'create' && state.modal.showMap) {
        initModalMap('rc-create-map', (meta) => {
            const id = addrIdByMeta(meta, createBoard(state.modal) || state.board);
            if (!id) return;
            keepCreateFields();
            focusPickedStation(meta);
            state.modal.addressId = id;
            // Время сохраняем, если оно свободно и на новой станции (в выбранный день).
            revalidateCreatePick();
            render();
        }, metaFor(stationById(state.modal.addressId, createBoard(state.modal)))?.short,
        createBoard(state.modal));
    }
    if (state.modal?.kind === 'move' && state.modal.showMap) {
        const found = chainByHead(state.modal.headId);
        const current = state.modal.targetAddressId || found?.addr.id;
        initModalMap('rc-move-map', (meta) => {
            const id = addrIdByMeta(meta);
            if (!id) return;
            focusPickedStation(meta);
            state.modal.targetAddressId = id;
            state.modal.targetTime = null;
            render();
        }, metaFor(stationById(current))?.short);
    }

    // Подсветку из поиска доводим до экрана.
    if (state.highlightId) {
        const cap = root.querySelector('.rc-cap-hot');
        if (cap) cap.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
}

// Поля создания записи переживают смену станции (клиент передумал — адрес
// другой, а имя/телефон уже введены).
function keepCreateFields() {
    if (state.modal?.kind !== 'create') return;
    state.modal.name = document.getElementById('rc-f-name')?.value ?? state.modal.name;
    state.modal.phone = document.getElementById('rc-f-phone')?.value ?? state.modal.phone;
    state.modal.carNumber = document.getElementById('rc-f-car')?.value ?? state.modal.carNumber;
    state.modal.comment = document.getElementById('rc-f-comment')?.value ?? state.modal.comment;
}

// ── Действия (делегирование) ─────────────────────────────────────────────────

async function handleAction(btn) {
    const a = btn.dataset.action;

    if (a === 'set-date') {
        state.date = btn.dataset.date;
        state.view = 'overview';
        state.highlightId = null;
        return loadBoard();
    }
    if (a === 'pick-date') {
        // Нативный календарь: у скрытого input'а клик пикер не открывает,
        // нужен showPicker() (в старых браузерах — обычный focus+click).
        const input = document.getElementById('rc-date-input');
        if (!input) return;
        if (typeof input.showPicker === 'function') {
            try { input.showPicker(); return; } catch { /* ниже — запасной путь */ }
        }
        input.focus();
        input.click();
        return;
    }
    if (a === 'refresh') {
        apiFetch('/api/records/refresh', { method: 'POST' }).catch(() => {});
        return loadBoard({ silent: true });
    }
    if (a === 'open-station') {
        state.view = 'station';
        state.stationId = btn.dataset.id;
        state.highlightId = null;
        return render();
    }
    if (a === 'back') {
        state.view = 'overview';
        state.highlightId = null;
        return render();
    }
    if (a === 'open-map') { state.modal = { kind: 'map' }; return render(); }
    if (a === 'open-queue') {
        await loadOps();
        markOpsSeen(); // окно открыли — бейдж гасим до следующей операции
        state.modal = { kind: 'queue' };
        return render();
    }
    if (a === 'open-creds') { state.credsError = ''; state.modal = { kind: 'creds' }; return render(); }
    if (a === 'close-modal') { destroyMapCtl(); state.modal = null; return render(); }

    if (a === 'search-pick') {
        state.view = 'station';
        state.stationId = btn.dataset.station;
        state.highlightId = btn.dataset.head;
        state.search = '';
        return render();
    }
    if (a === 'near-pick') {
        // Клик по «ближайшей станции» в поиске по улице
        mapCtl?.focus(Number(btn.dataset.lat), Number(btn.dataset.lng), 13);
        mapCtl?.highlight(btn.dataset.short);
        return;
    }

    if (a === 'create-at') {
        const addr = stationById(state.stationId) || state.board.addresses[0];
        state.modal = {
            kind: 'create',
            addressId: addr.id,
            date: state.date,
            time: btn.dataset.time || null,
            durationMinutes: 30,
            name: '', phone: '', carNumber: '', comment: '',
        };
        return render();
    }
    if (a === 'set-create-date') return setCreateDate(btn.dataset.date);
    if (a === 'pick-create-date') {
        keepCreateFields();
        const input = document.getElementById('rc-f-date');
        if (!input) return;
        if (typeof input.showPicker === 'function') {
            try { input.showPicker(); return; } catch { /* ниже — запасной путь */ }
        }
        input.focus();
        input.click();
        return;
    }
    if (a === 'set-create-time') { keepCreateFields(); state.modal.time = btn.dataset.time; return render(); }
    if (a === 'set-duration') { keepCreateFields(); state.modal.durationMinutes = Number(btn.dataset.min); return render(); }
    if (a === 'toggle-create-map') {
        keepCreateFields();
        state.modal.showMap = !state.modal.showMap;
        ensureMapViewFor(state.modal.addressId);
        return render();
    }
    if (a === 'submit-create') return submitCreate();

    if (a === 'open-chain') { state.modal = { kind: 'chain', headId: btn.dataset.head }; return render(); }
    if (a === 'open-move') {
        state.modal = { kind: 'move', headId: btn.dataset.head, targetDate: state.date, targetTime: null };
        return render();
    }
    if (a === 'move-date') {
        state.modal.targetDate = btn.dataset.date;
        state.modal.targetTime = null;
        state.modal.targetBoard = null;
        render();
        if (state.modal.targetDate !== state.date) {
            try {
                const data = await apiFetch(`/api/records/board?date=${encodeURIComponent(state.modal.targetDate)}`);
                if (state.modal?.kind === 'move') { state.modal.targetBoard = data.board; render(); }
            } catch (err) {
                if (state.modal?.kind === 'move') { state.modal.error = `не удалось получить ${state.modal.targetDate}: ${err.message}`; render(); }
            }
        }
        return;
    }
    if (a === 'toggle-move-map') {
        state.modal.showMap = !state.modal.showMap;
        ensureMapViewFor(state.modal.targetAddressId || chainByHead(state.modal.headId)?.addr.id);
        return render();
    }
    if (a === 'move-time') { state.modal.targetTime = btn.dataset.time; return render(); }
    if (a === 'submit-move') return submitMove();

    if (a === 'open-extend') { state.modal = { kind: 'extend', headId: btn.dataset.head, extendMinutes: 0 }; return render(); }
    if (a === 'set-extend') { state.modal.extendMinutes = Number(btn.dataset.min); return render(); }
    if (a === 'submit-extend') return submitExtend();

    if (a === 'open-edit') { state.modal = { kind: 'edit', headId: btn.dataset.head }; return render(); }
    if (a === 'submit-edit') return submitEdit();

    if (a === 'open-delete') { state.modal = { kind: 'delete', headId: btn.dataset.head }; return render(); }
    if (a === 'toggle-del') {
        const found = chainByHead(state.modal.headId);
        if (!found) return;
        if (!state.modal.checked) state.modal.checked = new Set(found.chain.parts.map(p => String(p.id)));
        const id = String(btn.dataset.id);
        if (state.modal.checked.has(id)) state.modal.checked.delete(id);
        else state.modal.checked.add(id);
        return; // чекбокс сам отрисовался, полный render не нужен
    }
    if (a === 'submit-delete') return submitDelete();

    if (a === 'copy-chain') {
        const found = chainByHead(btn.dataset.head);
        if (!found) return;
        const line = buildCopyLine(state.date, found.chain.timeStart, found.addr.title);
        try { await navigator.clipboard.writeText(line); } catch { /* нет прав на буфер */ }
        state.modal.copied = true;
        render();
        setTimeout(() => { if (state.modal?.kind === 'chain') { state.modal.copied = false; render(); } }, 1600);
        return;
    }

    if (a === 'cancel-op') {
        try { await apiFetch(`/api/records/ops/${btn.dataset.id}`, { method: 'DELETE' }); } catch { /* уже применилась */ }
        await loadOps();
        return render();
    }
}

// Смена даты в окне записи: клиент передумал на другой день — тянем расписание
// того дня и заново проверяем, свободны ли выбранные станция и время.
async function setCreateDate(date) {
    const m = state.modal;
    if (!date || m?.kind !== 'create' || m.date === date) return;
    keepCreateFields();
    m.date = date;
    m.dateBoard = null;
    m.dateError = '';
    m.error = '';
    if (date === state.date) { revalidateCreatePick(); return render(); }

    m.dateLoading = true;
    render();
    try {
        const data = await apiFetch(`/api/records/board?date=${encodeURIComponent(date)}`);
        if (state.modal !== m || m.date !== date) return; // дату успели сменить снова
        m.dateBoard = data.board;
        m.dateLoading = false;
        revalidateCreatePick();
    } catch (err) {
        if (state.modal !== m || m.date !== date) return;
        m.dateLoading = false;
        m.dateError = `не удалось получить расписание на ${date}: ${err.message}`;
        m.time = null;
    }
    render();
}

// Выбранные станция и время должны существовать и быть свободны на текущей
// доске окна: станции нет — берём первую, слот занят/закрыт — сбрасываем время.
function revalidateCreatePick() {
    const m = state.modal;
    if (m?.kind !== 'create') return;
    const board = createBoard(m);
    if (!board) { m.time = null; return; }
    if (!board.addresses.some(a => String(a.id) === String(m.addressId))) {
        m.error = `этой станции нет в расписании на ${m.date} — выбрана первая из списка`;
        m.addressId = board.addresses[0]?.id ?? m.addressId;
        m.time = null;
        return;
    }
    if (m.time && !slotFree(m.addressId, m.time, board)) m.time = null;
}

// ── Сабмиты операций ─────────────────────────────────────────────────────────

async function submitCreate() {
    keepCreateFields();
    const m = state.modal;
    const date = m.date || state.date;
    if (m.dateLoading) { m.error = `расписание на ${date} ещё грузится`; return render(); }
    if (!m.time) { m.error = 'выбери время'; return render(); }
    if (!String(m.name || '').trim()) { m.error = 'имя обязательно'; return render(); }
    try {
        await postOp('create', {
            addressId: m.addressId,
            date,
            time: m.time,
            name: m.name.trim(),
            phone: m.phone.trim(),
            carNumber: m.carNumber.trim(),
            comment: m.comment.trim(),
            durationMinutes: m.durationMinutes,
        });
        destroyMapCtl();
        state.modal = null;
        // Записали на другой день — переводим доску туда, иначе запись
        // появится «где-то там», а на экране останется прежний день.
        if (date !== state.date) {
            state.date = date;
            state.highlightId = null;
            return loadBoard();
        }
        render();
    } catch (err) {
        m.error = err.message;
        render();
    }
}

async function submitMove() {
    const m = state.modal;
    const found = chainByHead(m.headId);
    if (!found || !m.targetTime) return;
    const { chain, addr } = found;
    const records = chain.parts.map((p, i) => ({
        id: p.id,
        addressId: m.targetAddressId || addr.id,
        date: m.targetDate,
        time: addMinutes(m.targetTime, i * SLOT_MINUTES),
    }));
    try {
        await postOp('update', { records });
        state.modal = null;
        destroyMapCtl();
        render();
    } catch (err) {
        m.error = err.message;
        render();
    }
}

async function submitExtend() {
    const m = state.modal;
    const found = chainByHead(m.headId);
    if (!found || !m.extendMinutes) return;
    const { chain, addr } = found;
    try {
        await postOp('create', {
            addressId: addr.id,
            date: state.date,
            time: chain.timeEnd,
            name: chain.head.name,
            phone: EXTENSION_STUB_PHONE,
            carNumber: '',
            comment: '',
            durationMinutes: m.extendMinutes,
        });
        state.modal = null;
        render();
    } catch (err) {
        m.error = err.message;
        render();
    }
}

async function submitEdit() {
    const m = state.modal;
    const found = chainByHead(m.headId);
    if (!found) return;
    const { chain } = found;
    const name = document.getElementById('rc-e-name')?.value.trim() || '';
    const phone = document.getElementById('rc-e-phone')?.value.trim() || '';
    const carNumber = document.getElementById('rc-e-car')?.value.trim() || '';
    const comment = document.getElementById('rc-e-comment')?.value.trim() || '';
    if (!name) { m.error = 'имя обязательно'; return render(); }
    const records = chain.parts.map((p, i) => {
        const r = { id: p.id, name };
        if (i === 0) {
            if (phone) r.phone = phone;
            if (carNumber) r.carNumber = carNumber;
            if (comment) r.comment = comment;
        }
        return r;
    });
    try {
        await postOp('update', { records });
        state.modal = null;
        render();
    } catch (err) {
        m.error = err.message;
        render();
    }
}

async function submitDelete() {
    const m = state.modal;
    const found = chainByHead(m.headId);
    if (!found) return;
    const { chain } = found;
    const checked = m.checked || new Set(chain.parts.map(p => String(p.id)));
    const records = chain.parts
        .filter(p => checked.has(String(p.id)) && p.deleteUrl)
        .map(p => ({ id: p.id, deleteUrl: p.deleteUrl }));
    if (!records.length) { state.modal = null; return render(); }
    try {
        await postOp('delete', { records });
        state.modal = null;
        render();
    } catch (err) {
        m.error = err.message;
        render();
    }
}

// ── Запуск и остановка раздела ───────────────────────────────────────────────

const timers = [];
let onClick = null;
let onVisibility = null;

// Второй заход на раздел не должен доедать состояние первого: доска и
// выбранный день пересобираются, а даты берутся заново — иначе после
// полуночи открылся бы вчерашний день.
function resetState() {
    Object.assign(state, {
        status: null,
        credsNeeded: false,
        credsError: '',
        date: null,
        board: null,
        fetchedAt: null,
        boardOk: true,
        boardError: '',
        boardLoading: false,
        ops: [],
        view: 'overview',
        stationId: null,
        search: '',
        highlightId: null,
        modal: null,
    });
}

export function startRecords(mount) {
    if (!mount) return;
    stopRecords(); // повторный вход — начинаем с чистого листа
    root = mount;
    resetState();
    root.innerHTML = '<div class="rc-boot">Загрузка записей…</div>';

    onClick = (e) => {
        const btn = e.target.closest('[data-action]');
        if (btn) handleAction(btn);
        // клик мимо поиска закрывает выпадашку
        if (!e.target.closest('.rc-searchbox')) {
            root?.querySelector('#rc-search-drop')?.classList.add('hidden');
        }
    };
    root.addEventListener('click', onClick);

    onVisibility = () => {
        if (document.hidden) return;
        loadStatus();
        if (!state.modal && !state.credsNeeded) loadBoard({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisibility);

    timers.push(setInterval(loadStatus, 30_000));
    timers.push(setInterval(() => {
        // не дёргаем доску, пока открыта модалка или гейт кредов
        // (перерисовка сбила бы ввод)
        if (!document.hidden && !state.modal && !state.credsNeeded) loadBoard({ silent: true });
    }, 45_000));
    timers.push(setInterval(renderStatusOnly, 10_000));

    (async () => {
        await loadStatus();
        await loadBoard();
    })();
}

export function stopRecords() {
    for (const t of timers.splice(0)) clearInterval(t);
    clearTimeout(geocodeTimer);
    for (const t of boardReloadTimers.splice(0)) clearTimeout(t);
    destroyMapCtl();
    if (root && onClick) root.removeEventListener('click', onClick);
    if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
    onClick = null;
    onVisibility = null;
    root = null;
}
