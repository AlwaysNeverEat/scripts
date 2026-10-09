// ─────────────────────────────────────────────────────────────────────────────
// Вкладка «Лиды» (/leads): лента звонков из новой CRM и карточка лида.
//
// В самой CRM звонок показывается всплывашкой в углу экрана, и всплывашек не
// бывает больше трёх: четвёртый входящий не виден вовсе, а закончившийся
// исчезает вместе с карточкой, которую открыли по клику. Заполнить лид после
// разговора, когда трубку уже положили, там негде. Здесь — лента ВСЕХ звонков
// (журнал CRM + живые + то, что сайт видел сам), и из любой строки открывается
// карточка, в которой есть ВСЁ, что есть в карточке CRM: какие поля лида
// окажутся нужными, пока не ясно, поэтому взято всё, а не выбрано.
//
// Что где:
//   • разбор ответов CRM, статусы, чистка расчёта — shared/crmLeads.js;
//   • ручки под личной сессией CRM — backend/src/routes/crmLeads.js;
//   • песочница без CRM — frontend/dev-leads-crm.html.
//
// Лента перерисовывается на каждом опросе, карточка — НЕТ: в ней печатают
// (заметку, расчёт, комментарий к звонку), и перерисовка раз в пять секунд
// выбрасывала бы набранное. Поэтому у ленты и у карточки свои узлы и свои
// render, а всё набранное в карточке живёт в `draft` и переживает её
// собственные перерисовки после сохранения.
//
// Значки — SVG, эмодзи нет ни одного (та же причина, что во вкладке «Клиент»).
// ─────────────────────────────────────────────────────────────────────────────

import './crmLeads.css';
import { formatPhoneInput, phoneComplete, phoneDigits, formatPlateInput } from '../../shared/crmClients.js';
import { setPickedLead } from './leadPick.js';
import { LEAD_STATUSES, NEXT_CALL_QUICK, isLive, isMine, sortFeed, operatorKey, cleanCalcItems, calcTotal, callTime } from '../../shared/crmLeads.js';
import { openDateFor } from './datepicker.js';

const FEED_POLL_MS = 5000;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function money(v) {
    if (v == null || !Number.isFinite(v)) return '—';
    return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
}

const thousands = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

function prettyPhone(raw) {
    const d = String(raw || '').replace(/\D/g, '');
    return phoneComplete(d) ? formatPhoneInput(d) : String(raw || '');
}

const telHref = (raw) => (phoneComplete(raw) ? 'tel:+7' + phoneDigits(raw) : '');

// «2026-10-08 09:07:31» → «09:07» сегодня и «07.10 09:07» в другие дни.
function stampShort(at) {
    const m = String(at || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (!m) return String(at || '');
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return `${m[1]}-${m[2]}-${m[3]}` === today ? `${m[4]}:${m[5]}` : `${m[3]}.${m[2]} ${m[4]}:${m[5]}`;
}

function stampFull(at) {
    const m = String(at || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    if (!m) return String(at || '') || '—';
    return `${m[3]}.${m[2]}.${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}`;
}

function isoDay(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(iso) {
    if (!iso) return 'не назначен';
    const [y, mo, d] = iso.split('-').map(Number);
    const dt = new Date(y, mo - 1, d);
    const wd = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][dt.getDay()];
    return `${String(d).padStart(2, '0')}.${String(mo).padStart(2, '0')}.${y}, ${wd}`;
}

function duration(sec) {
    if (!sec) return '—';
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
}

// Статус звонка словами — и в ленте, и в истории звонков карточки.
const CALL_STATUS = {
    ringing: ['звонит', 'ring'],
    answered: ['разговор', 'talk'],
    completed: ['принят', 'done'],
    missed: ['пропущен', 'miss'],
    // CRM не получила конца звонка (см. settleStale в shared/crmLeads.js).
    stale: ['без исхода', 'done'],
    robot: ['робот', 'robot'],
};
const callStatus = (s) => CALL_STATUS[s] || [s || '—', 'done'];

const OMNI = { max: 'MAX', tg: 'Telegram', vk: 'ВК' };

const svg = (body, size = 14) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
    phoneIn: (s) => svg('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.18 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.1 9.9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/><polyline points="16 2 16 8 22 8"/><line x1="23" y1="1" x2="16" y2="8"/>', s),
    phoneOut: (s) => svg('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.18 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.1 9.9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/><polyline points="23 7 23 1 17 1"/><line x1="16" y1="8" x2="23" y2="1"/>', s),
    robot: (s) => svg('<rect x="4" y="8" width="16" height="12" rx="2"/><line x1="12" y1="4" x2="12" y2="8"/><circle cx="12" cy="3" r="1"/><line x1="9" y1="13" x2="9" y2="14"/><line x1="15" y1="13" x2="15" y2="14"/>', s),
    edit: (s) => svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', s),
    x: (s) => svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', s),
    plus: (s) => svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>', s),
    refresh: (s) => svg('<polyline points="21 5 21 11 15 11"/><path d="M20 15a8 8 0 1 1-2.2-8.3L21 9"/>', s),
    back: (s) => svg('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>', s),
    play: (s) => svg('<polygon points="6 4 20 12 6 20 6 4"/>', s),
    calendar: (s) => svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>', s),
    check: (s) => svg('<polyline points="20 6 9 17 4 12"/>', s),
    chevron: (s) => svg('<polyline points="6 9 12 15 18 9"/>', s),
    search: (s) => svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', s),
};

// Код оператора (внутренний номер телефонии) человек вводит сам: CRM не
// говорит, какой номер у её учётки. Помнится на устройстве ПО АККАУНТУ сайта —
// за одним компьютером колл-центра сидят по сменам, и чужой код поднимал бы
// наверх чужие звонки.
const OPERATOR_KEY = 'zm_leads_operator';

export function initCrmLeads({ apiFetch, getUserId = () => '' }) {
    const host = document.getElementById('leads-body');
    host.innerHTML = `
        <div class="ld">
            <aside class="ld-feed" id="ld-feed"></aside>
            <section class="ld-card" id="ld-card"></section>
        </div>`;
    const feedEl = host.querySelector('#ld-feed');
    const cardEl = host.querySelector('#ld-card');
    const shell = host.querySelector('.ld');

    const state = {
        calls: [],
        journal: 'ok',
        feedStatus: 'loading', // loading | ready | error | auth
        feedError: '',
        filter: 'all',
        query: '',
        selected: null,        // звонок, из которого открыта карточка
        card: { status: 'idle' }, // idle | loading | none | ready | error | auth
        services: null,
        busy: new Set(),       // какие действия карточки сейчас уходят в CRM
        flash: '',             // «Сохранено» у последнего действия
        errors: {},            // ошибка по блоку карточки
        draft: freshDraft(),
        openSales: new Map(),  // id чека → { status, sale }
        editingName: false,
        editingComment: null,
        authNote: '',
        operator: '',          // свой код оператора — его звонки помечены «мой»
    };

    const operatorStoreKey = () => `${OPERATOR_KEY}:${getUserId() || 'anon'}`;
    function loadOperator() {
        try { state.operator = operatorKey(localStorage.getItem(operatorStoreKey()) || ''); } catch { state.operator = ''; }
    }
    function saveOperator(code) {
        state.operator = operatorKey(code);
        try {
            if (state.operator) localStorage.setItem(operatorStoreKey(), state.operator);
            else localStorage.removeItem(operatorStoreKey());
        } catch { /* приватный режим — код живёт до перезагрузки */ }
        if (!state.operator && state.filter === 'mine') state.filter = 'all';
            }

    function freshDraft() {
        return { name: '', car: '', note: '', calcCar: null, lines: [{ name: '', price: '', qty: '1' }], status: null, nextCall: null, source: null, comment: '' };
    }

    // ── Лента ────────────────────────────────────────────────────────────────

    let pollTimer = null;
    let active = false;

    async function loadFeed() {
        try {
            const data = await apiFetch('/api/crm/leads/feed');
            state.calls = sortFeed(data.calls || []);
            state.journal = data.journal || 'ok';
            state.feedStatus = 'ready';
            state.feedError = '';
        } catch (e) {
            if (e.code === 'crm_auth_required' || e.code === 'crm_auth_failed') {
                state.feedStatus = 'auth';
            } else if (!state.calls.length) {
                state.feedStatus = 'error';
            }
            state.feedError = e.message || 'CRM не ответила';
        }
        renderFeed();
    }

    function schedule() {
        clearTimeout(pollTimer);
        if (!active) return;
        pollTimer = setTimeout(async () => {
            if (active && !document.hidden && state.feedStatus !== 'auth') await loadFeed();
            schedule();
        }, FEED_POLL_MS);
    }

    function visibleCalls() {
        const q = state.query.trim().toLowerCase();
        const qd = q.replace(/\D/g, '');
        return state.calls.filter(c => {
            if (state.filter === 'live' && !isLive(c)) return false;
            if (state.filter === 'mine' && !isMine(c, state.operator)) return false;
            if (state.filter === 'missed' && c.status !== 'missed') return false;
            if (!q) return true;
            return (qd.length >= 3 && c.phone.includes(qd)) || c.name.toLowerCase().includes(q);
        });
    }

    function feedRowHtml(c) {
        const [label, cls] = callStatus(c.status);
        const sel = state.selected && state.selected.id === c.id;
        const mine = isMine(c, state.operator);
        const who = c.name ? esc(c.name) : '<span class="ld-muted">новый номер</span>';
        const meta = [c.line, c.operator && `оператор ${c.operator}`].filter(Boolean).join(' · ');
        const extra = c.client && c.client.visits != null
            ? `визитов: ${c.client.visits}${c.client.car ? ` · ${esc(c.client.car)}` : ''}`
            : '';
        return `
        <button type="button" class="ld-call ld-call--${cls}${sel ? ' ld-call-sel' : ''}${mine ? ' ld-call-mine' : ''}" data-call="${esc(c.id)}">
            <span class="ld-call-ico">${ICON.phoneIn(15)}</span>
            <span class="ld-call-main">
                <span class="ld-call-top">
                    <span class="ld-call-phone">${esc(prettyPhone(c.phone))}</span>
                    <span class="ld-call-time">${esc(stampShort(c.at))}</span>
                </span>
                <span class="ld-call-who">${who}${c.callsFromPhone > 1 ? ` <span class="ld-badge" title="Звонков с этого номера в ленте">${c.callsFromPhone} ${plural(c.callsFromPhone, 'звонок', 'звонка', 'звонков')}</span>` : ''}</span>
                ${extra ? `<span class="ld-call-meta">${extra}</span>` : ''}
                ${c.robot ? `<span class="ld-call-robot">${ICON.robot(12)} ${esc(c.robot)}${c.transferred ? ' — переведён на оператора' : ''}</span>` : ''}
                <span class="ld-call-bottom">
                    <span class="ld-st ld-st-${cls}">${esc(label)}</span>
                    ${mine ? '<span class="ld-badge ld-badge-mine">мой</span>' : ''}
                    ${meta ? `<span class="ld-call-meta">${esc(meta)}</span>` : ''}
                </span>
            </span>
        </button>`;
    }

    function renderFeed() {
        const live = state.calls.filter(isLive).length;
        const missed = state.calls.filter(c => c.status === 'missed').length;
        const mineCount = state.operator ? state.calls.filter(c => isMine(c, state.operator)).length : 0;
        const list = visibleCalls();
        let body;
        if (state.feedStatus === 'loading') {
            body = '<div class="ld-skel-list">' + '<div class="ld-skel"><span class="sk sk-line" style="width:60%"></span><span class="sk sk-line" style="width:40%"></span></div>'.repeat(5) + '</div>';
        } else if (state.feedStatus === 'auth') {
            body = loginHtml();
        } else if (state.feedStatus === 'error') {
            body = `<div class="ld-empty ld-error">Лента не загрузилась: ${esc(state.feedError)}<br><button type="button" class="btn btn-sec" data-act="feed-retry">${ICON.refresh(13)} Ещё раз</button></div>`;
        } else if (!list.length) {
            body = `<div class="ld-empty">${state.calls.length ? 'Под фильтр ничего не попало' : 'Звонков пока нет. Новые появятся сами — лента обновляется каждые пять секунд.'}</div>`;
        } else {
            body = list.map(feedRowHtml).join('');
        }
        const note = state.feedStatus === 'ready' && state.journal !== 'ok'
            ? `<div class="ld-feed-note">${state.journal === 'denied'
                ? 'Журнал входящих вашей учётке CRM закрыт — в ленте живые звонки и те, что сайт застал с момента, как вкладку открыли.'
                : 'Журнал входящих CRM сейчас не ответил — в ленте живые звонки и уже виденные.'}</div>`
            : '';
        const stale = state.feedStatus === 'ready' && state.feedError
            ? `<div class="ld-feed-note ld-feed-warn">Обновить ленту не вышло: ${esc(state.feedError)}</div>` : '';
        // Строку поиска не пересобираем, если она в фокусе: иначе каждый опрос
        // сбрасывал бы каретку посреди набора.
        const searchFocused = document.activeElement && ['ld-q', 'ld-op'].includes(document.activeElement.id);
        if (!feedEl.querySelector('.ld-feed-head') || !searchFocused) {
            feedEl.innerHTML = `
            <div class="ld-feed-head">
                <div class="ld-feed-top">
                    <div class="ld-feed-title">Звонки <span class="ld-muted">${state.calls.length || ''}</span></div>
                    <label class="ld-op" title="Ваш внутренний номер в телефонии: звонки на него будут помечены «мой». Помнится на этом компьютере.">
                        <span>Мой код</span>
                        <input id="ld-op" class="ld-in" inputmode="numeric" maxlength="6" placeholder="101" value="${esc(state.operator)}" autocomplete="off">
                    </label>
                </div>
                <div class="ld-chips" role="tablist">
                    ${[['all', 'Все', state.calls.length], ...(state.operator ? [['mine', 'Мои', mineCount]] : []), ['live', 'Сейчас', live], ['missed', 'Пропущенные', missed]].map(([id, t, n]) =>
                        `<button type="button" class="ld-chip${state.filter === id ? ' on' : ''}" data-filter="${id}">${t}${n ? ` <b>${n}</b>` : ''}</button>`).join('')}
                </div>
                <label class="ld-search">${ICON.search(14)}<input id="ld-q" type="search" placeholder="Телефон или имя" value="${esc(state.query)}" autocomplete="off"></label>
            </div>
            <div class="ld-feed-list" id="ld-feed-list"></div>
            <div id="ld-feed-foot"></div>`;
            bindFeedHead();
        } else {
            feedEl.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('on', b.dataset.filter === state.filter));
            // Счётчики у чипов меняются с каждым опросом — правим их на месте.
            const counts = { all: state.calls.length, mine: mineCount, live, missed };
            feedEl.querySelectorAll('[data-filter]').forEach(b => {
                const n = counts[b.dataset.filter];
                const label = b.textContent.replace(/\s*\d+$/, '');
                b.innerHTML = `${esc(label)}${n ? ` <b>${n}</b>` : ''}`;
            });
        }
        feedEl.querySelector('#ld-feed-list').innerHTML = body;
        feedEl.querySelector('#ld-feed-foot').innerHTML = stale + note;
        feedEl.querySelectorAll('[data-call]').forEach(b => { b.onclick = () => openCall(b.dataset.call); });
        const retry = feedEl.querySelector('[data-act="feed-retry"]');
        if (retry) retry.onclick = () => { state.feedStatus = 'loading'; renderFeed(); loadFeed(); };
        bindLogin(feedEl);
    }

    function bindFeedHead() {
        feedEl.querySelectorAll('[data-filter]').forEach(b => {
            b.onclick = () => { state.filter = b.dataset.filter; renderFeed(); };
        });
        const q = feedEl.querySelector('#ld-q');
        q.oninput = () => { state.query = q.value; renderFeed(); };
        const op = feedEl.querySelector('#ld-op');
        op.oninput = () => {
            const digits = op.value.replace(/\D/g, '').slice(0, 6);
            if (digits !== op.value) op.value = digits;
            saveOperator(digits);
            renderFeed();
        };
        // Ушёл из поля — шапка пересоберётся со своими чипами («Мои»).
        op.onchange = () => { op.blur(); renderFeed(); };
    }

    // ── Вход в CRM ───────────────────────────────────────────────────────────

    function loginHtml() {
        return `
        <form class="ld-login" id="ld-login">
            <div class="ld-login-title">Войдите в CRM своей учёткой</div>
            <div class="ld-muted">Звонки и карточки берутся из CRM под вашим логином — что вы заполните в лиде, CRM запишет на вас.</div>
            <input name="login" class="ld-in" placeholder="Логин CRM" autocomplete="username">
            <input name="password" class="ld-in" type="password" placeholder="Пароль" autocomplete="current-password">
            ${state.authNote ? `<div class="ld-err">${esc(state.authNote)}</div>` : ''}
            <button class="btn btn-pri" type="submit">Войти</button>
        </form>`;
    }

    function bindLogin(scope) {
        const form = scope.querySelector('#ld-login');
        if (!form) return;
        form.onsubmit = async (e) => {
            e.preventDefault();
            const login = form.login.value.trim();
            const password = form.password.value;
            if (!login || !password) return;
            form.querySelector('button').disabled = true;
            try {
                await apiFetch('/api/crm/login', { method: 'POST', body: { login, password } });
                state.authNote = '';
                state.feedStatus = 'loading';
                renderFeed();
                await loadFeed();
                if (state.card.status === 'auth' && state.selected) openCall(state.selected.id);
            } catch (err) {
                state.authNote = err.message || 'Не удалось войти в CRM';
                renderFeed();
            }
        };
    }

    // ── Карточка: загрузка ───────────────────────────────────────────────────

    async function openCall(id) {
        const call = state.calls.find(c => c.id === id);
        if (!call) return;
        state.selected = call;
        state.draft = freshDraft();
        state.errors = {};
        state.flash = '';
        state.openSales = new Map();
        state.editingName = false;
        state.editingComment = null;
        state.card = { status: 'loading', phone: call.phone };
        shell.classList.add('ld-has-card');
        renderFeed();
        renderCard();
        const q = call.clientId ? `id=${encodeURIComponent(call.clientId)}` : `phone=${encodeURIComponent(call.phone)}`;
        await fetchCard(q, call.phone);
    }

    async function fetchCard(q, phone) {
        try {
            const data = await apiFetch(`/api/crm/leads/card?${q}`);
            if (state.card.phone !== phone) return; // пока ждали, открыли другой звонок
            state.card = data.card ? { status: 'ready', phone, data: data.card } : { status: 'none', phone };
            if (data.card) ensureServices();
        } catch (e) {
            if (state.card.phone !== phone) return;
            state.card = e.code === 'crm_auth_required' || e.code === 'crm_auth_failed'
                ? { status: 'auth', phone }
                : { status: 'error', phone, error: e.message || 'CRM не ответила' };
        }
        renderCard();
    }

    async function ensureServices() {
        if (state.services) return;
        try {
            state.services = (await apiFetch('/api/crm/leads/services')).services || [];
            if (state.card.status === 'ready') renderCalcServices();
        } catch { state.services = null; }
    }

    // Обёртка действия карточки: кнопка гаснет, пока CRM думает, ошибка
    // пишется в тот блок, где нажали, удача — коротким «Сохранено» там же.
    async function act(key, fn, { flash = 'Сохранено', rerender = true } = {}) {
        if (state.busy.has(key)) return;
        state.busy.add(key);
        delete state.errors[key];
        state.flash = '';
        if (rerender) renderCard();
        try {
            const out = await fn();
            if (out && out.card) state.card.data = out.card;
            state.flash = flash ? key : '';
            setTimeout(() => { if (state.flash === key) { state.flash = ''; renderCard(); } }, 2200);
            return out;
        } catch (e) {
            state.errors[key] = e.message || 'CRM не приняла';
            return null;
        } finally {
            state.busy.delete(key);
            renderCard();
        }
    }

    const busyAttr = (key) => (state.busy.has(key) ? ' disabled aria-busy="true"' : '');
    const btnLabel = (key, idle, busy) => (state.busy.has(key)
        ? `<span class="ld-spin" aria-hidden="true"></span>${busy}`
        : state.flash === key ? `${ICON.check(13)} Сохранено` : idle);
    const errHtml = (key) => (state.errors[key] ? `<div class="ld-err">${esc(state.errors[key])}</div>` : '');

    // ── Карточка: разметка ───────────────────────────────────────────────────

    // Открытая карточка — «выбранный лид» для окна создания записи
    // (leadPick.js): имя и телефон подставятся туда сами. Имя — из CRM, если
    // карточка приехала, иначе из строки звонка или из набранного для нового
    // клиента; телефон — клиента или звонка («client:ID» из «Чатов» — не номер).
    function publishPick() {
        const st = state.card.status;
        if (st === 'idle') return setPickedLead(null);
        const c = st === 'ready' ? state.card.data.client : null;
        const keyPhone = /^\d+$/.test(state.card.phone || '') ? state.card.phone : '';
        setPickedLead({
            name: c?.fio || state.selected?.name || state.draft?.name || '',
            phone: c?.phone || state.selected?.phone || keyPhone,
        });
    }

    function renderCard() {
        publishPick();
        const st = state.card.status;
        let html;
        if (st === 'idle') {
            html = `<div class="ld-card-empty">${ICON.phoneIn(28)}<div>Выберите звонок слева — откроется карточка лида: всё, что есть о клиенте в CRM, и поля, которые надо заполнить.</div></div>`;
        } else if (st === 'loading') {
            html = `${backHtml()}<div class="ld-skel-card">${'<span class="sk sk-line"></span>'.repeat(6)}</div>`;
        } else if (st === 'auth') {
            html = backHtml() + loginHtml();
        } else if (st === 'error') {
            html = `${backHtml()}<div class="ld-empty ld-error">Карточка не открылась: ${esc(state.card.error)}<br><button type="button" class="btn btn-sec" data-act="card-retry">${ICON.refresh(13)} Ещё раз</button></div>`;
        } else if (st === 'none') {
            html = backHtml() + newClientHtml();
        } else {
            html = backHtml() + cardHtml(state.card.data);
        }
        cardEl.innerHTML = html;
        bindCard();
    }

    function backHtml() {
        return `<button type="button" class="ld-back btn btn-sec" data-act="back">${ICON.back(14)} К звонкам</button>`;
    }

    function callContextHtml() {
        const c = state.selected;
        if (!c) return '';
        const [label, cls] = callStatus(c.status);
        return `
        <div class="ld-ctx">
            <span class="ld-st ld-st-${cls}">${esc(label)}</span>
            <span>звонок ${esc(stampFull(c.at))}</span>
            ${c.line ? `<span class="ld-muted">${esc(c.line)}</span>` : ''}
            ${c.operator ? `<span class="ld-muted">оператор ${esc(c.operator)}</span>` : ''}
            ${c.recording ? `<a href="${esc(c.recording)}" target="_blank" rel="noopener" class="ld-link">${ICON.play(11)} запись</a>` : ''}
            ${c.robot ? `<div class="ld-ctx-robot">${ICON.robot(13)} ${esc(c.robot)}${c.transferred ? ' — переведён на оператора' : ''}</div>` : ''}
        </div>`;
    }

    function newClientHtml() {
        const d = state.draft;
        return `
        ${callContextHtml()}
        <div class="ld-block">
            <div class="ld-h">Номера ${esc(prettyPhone(state.card.phone))} нет в CRM</div>
            <div class="ld-muted">Заведите карточку — она сразу откроется, дальше заполняется как обычный лид.</div>
            <div class="ld-grid2">
                <label class="ld-field"><span>Имя / ФИО</span><input class="ld-in" data-draft="name" value="${esc(d.name)}" placeholder="Как зовут клиента"></label>
                <label class="ld-field"><span>Авто</span><input class="ld-in" data-draft="car" value="${esc(d.car)}" placeholder="марка / модель, госномер"></label>
            </div>
            ${errHtml('create')}
            <button type="button" class="btn btn-pri" data-act="create"${busyAttr('create')}>${btnLabel('create', `${ICON.plus(14)} Создать карточку`, 'Создаю…')}</button>
        </div>`;
    }

    function cardHtml(D) {
        const c = D.client;
        const d = state.draft;
        const status = d.status ?? D.plan.status;
        const next = d.nextCall ?? D.plan.nextCall;
        const source = d.source ?? c.sourceId;
        const nameBlock = state.editingName
            ? `<span class="ld-name-edit"><input class="ld-in ld-in-name" id="ld-name" value="${esc(d.name || c.fio)}" placeholder="Фамилия Имя Отчество">
                <button type="button" class="btn btn-pri" data-act="name-save"${busyAttr('name')}>${btnLabel('name', 'Сохранить', 'Сохраняю…')}</button>
                <button type="button" class="btn btn-sec" data-act="name-cancel">Отмена</button></span>`
            : `<span class="ld-name">${esc(c.fio || 'Без имени')}</span>
               <button type="button" class="ld-icon-btn" data-act="name-edit" title="Исправить имя">${ICON.edit(14)}</button>
               ${state.flash === 'name' ? `<span class="ld-ok">${ICON.check(12)} имя сохранено</span>` : ''}`;
        const tel = telHref(c.phone);
        const kpi = [
            ['Визитов', D.stats.visits],
            ['LTV', money(D.stats.ltv)],
            ['Средний чек', money(D.stats.avg)],
            ['Дней с визита', D.stats.daysSince ?? '—'],
            ['Частота, дн', D.stats.freqDays ?? '—'],
            ['Бонусы', c.bonus == null ? '—' : thousands(c.bonus)],
            ['Замен масла', c.oilChanges ?? 0],
        ];
        return `
        <div class="ld-head">
            <div class="ld-head-row">${nameBlock}</div>
            <div class="ld-head-row ld-muted">
                ${tel ? `<a href="${tel}" class="ld-link ld-phone">${esc(prettyPhone(c.phone))}</a>` : esc(c.phone)}
                ${c.car ? `<span>· ${esc(c.car)}</span>` : ''}
                <button type="button" class="ld-icon-btn" data-act="card-retry" title="Перечитать карточку из CRM">${ICON.refresh(13)}</button>
            </div>
            ${errHtml('name')}
        </div>
        ${callContextHtml()}

        <div class="ld-block ld-lead">
            <div class="ld-h">Лид</div>
            <div class="ld-grid3">
                <label class="ld-field"><span>Статус</span>
                    <select class="ld-in" data-draft="status">
                        <option value="">—</option>
                        ${LEAD_STATUSES.map(s => `<option${s === status ? ' selected' : ''}>${esc(s)}</option>`).join('')}
                    </select>
                </label>
                <div class="ld-field"><span>Следующий звонок</span>
                    <button type="button" class="ld-in ld-date-btn" data-act="pick-date">${ICON.calendar(14)} ${esc(dayLabel(next))}</button>
                    <input type="date" id="ld-next" class="ld-date-model" value="${esc(next)}" tabindex="-1" aria-hidden="true">
                </div>
                <label class="ld-field"><span>Источник</span>
                    <select class="ld-in" data-draft="source">
                        <option value="">(не указан)</option>
                        ${D.sources.map(s => `<option value="${esc(s.id)}"${s.id === source ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}
                    </select>
                </label>
            </div>
            <div class="ld-quick">
                ${NEXT_CALL_QUICK.map(([t, n]) => `<button type="button" class="ld-chip" data-quick="${n}">${t}</button>`).join('')}
                ${next ? '<button type="button" class="ld-chip" data-quick="clear">без даты</button>' : ''}
            </div>
            <div class="ld-lead-foot">
                <span class="ld-muted">Последний звонок: <b>${esc(D.lastCall ? stampFull(D.lastCall) : '—')}</b></span>
                <button type="button" class="btn btn-pri" data-act="lead-save"${busyAttr('lead')}>${btnLabel('lead', 'Сохранить лид', 'Сохраняю…')}</button>
            </div>
            ${errHtml('lead')}
        </div>

        <div class="ld-kpi">${kpi.map(([k, v]) => `<div class="ld-kpi-cell"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>

        ${callsHtml(D)}
        ${calcsHtml(D)}
        ${notesHtml(D)}
        ${omniHtml(D)}
        ${historyHtml(D)}`;
    }

    function callsHtml(D) {
        const openedAt = state.selected ? callTime(state.selected) : 0;
        const rows = D.calls.map(x => {
            const [label, cls] = x.status === 'completed' || x.status === 'answered' ? ['ответили', 'done'] : callStatus(x.status);
            const near = openedAt && Math.abs(callTime(x) - openedAt) < 120_000 && x.dir === 'in';
            const editing = state.editingComment === x.id;
            const comment = editing
                ? `<textarea class="ld-in ld-comment-in" id="ld-comment" rows="2" placeholder="Комментарий к звонку">${esc(state.draft.comment)}</textarea>
                   <span class="ld-row-btns">
                     <button type="button" class="btn btn-pri ld-mini" data-act="comment-save" data-id="${esc(x.id)}"${busyAttr('comment')}>${btnLabel('comment', 'Сохранить', 'Сохраняю…')}</button>
                     <button type="button" class="btn btn-sec ld-mini" data-act="comment-cancel">Отмена</button>
                   </span>`
                : `<button type="button" class="ld-comment" data-act="comment-edit" data-id="${esc(x.id)}">${x.comment ? esc(x.comment) : '<span class="ld-muted">— добавить комментарий —</span>'}</button>`;
            return `
            <div class="ld-callrow${near ? ' ld-callrow-this' : ''}">
                <div class="ld-callrow-top">
                    <span class="ld-callrow-dir">${x.dir === 'in' ? ICON.phoneIn(13) : ICON.phoneOut(13)} ${x.dir === 'in' ? 'вх' : 'исх'}</span>
                    <span>${esc(stampFull(x.at))}</span>
                    <span class="ld-st ld-st-${cls}">${esc(label)}</span>
                    <span class="ld-muted">${duration(x.dur)}</span>
                    ${x.rec ? `<a href="${esc(x.rec)}" target="_blank" rel="noopener" class="ld-link">${ICON.play(11)} запись</a>` : ''}
                    ${near ? '<span class="ld-badge">этот звонок</span>' : ''}
                </div>
                ${x.summary ? `<div class="ld-call-robot">${ICON.robot(12)} ${esc(x.summary)}</div>` : ''}
                <div class="ld-callrow-cmt">${comment}</div>
            </div>`;
        }).join('');
        return `
        <details class="ld-block" open>
            <summary class="ld-h">История звонков (${D.calls.length})</summary>
            ${errHtml('comment')}
            <div class="ld-calls">${rows || '<div class="ld-muted">Звонков не найдено.</div>'}</div>
        </details>`;
    }

    function calcsHtml(D) {
        const d = state.draft;
        const list = D.calcs.map(cc => `
            <div class="ld-item">
                <div class="ld-item-top">
                    <b>${money(cc.total)}</b>${cc.car ? ` · ${esc(cc.car)}` : ''}
                    <span class="ld-muted ld-item-when">${esc(stampFull(cc.at))}${cc.author ? ` · ${esc(cc.author)}` : ''}</span>
                    <button type="button" class="ld-icon-btn ld-del" data-act="calc-del" data-id="${esc(cc.id)}" title="Удалить расчёт"${busyAttr('calc-del')}>${ICON.x(13)}</button>
                </div>
                ${cc.items.length ? `<div class="ld-muted">${cc.items.map(it => `${esc(it.name)}${it.qty > 1 ? ` ×${it.qty}` : ''} — ${money(it.price * it.qty)}`).join(', ')}</div>` : ''}
            </div>`).join('');
        const lines = d.lines.map((l, i) => `
            <div class="ld-line">
                <input class="ld-in" data-line="${i}" data-k="name" value="${esc(l.name)}" placeholder="Услуга / товар">
                <input class="ld-in ld-num" data-line="${i}" data-k="price" value="${esc(l.price)}" placeholder="Цена" inputmode="decimal">
                <input class="ld-in ld-qty" data-line="${i}" data-k="qty" value="${esc(l.qty)}" inputmode="numeric" title="Количество">
                <button type="button" class="ld-icon-btn ld-del" data-act="line-del" data-i="${i}" title="Убрать строку">${ICON.x(13)}</button>
            </div>`).join('');
        return `
        <details class="ld-block" open>
            <summary class="ld-h">Расчёты (${D.calcs.length})</summary>
            ${errHtml('calc-del')}
            ${list || '<div class="ld-muted">Расчётов нет.</div>'}
            <div class="ld-sub">
                <div class="ld-h2">Новый расчёт к звонку</div>
                <input class="ld-in" data-draft="calcCar" value="${esc(d.calcCar ?? D.client.car)}" placeholder="Авто (марка / модель / госномер)">
                <select class="ld-in" id="ld-svc"><option value="">+ услуга из прайса…</option></select>
                <div id="ld-lines">${lines}</div>
                <button type="button" class="ld-chip" data-act="line-add">${ICON.plus(12)} позиция</button>
                <div class="ld-lead-foot">
                    <b>Итого: <span id="ld-total">${money(calcTotal(d.lines))}</span></b>
                    <button type="button" class="btn btn-pri" data-act="calc-save"${busyAttr('calc')}>${btnLabel('calc', 'Сохранить расчёт', 'Сохраняю…')}</button>
                </div>
                ${errHtml('calc')}
            </div>
        </details>`;
    }

    function notesHtml(D) {
        const list = D.notes.map(n => `
            <div class="ld-item">
                <div class="ld-item-top"><span class="ld-muted">${esc(stampFull(n.at))}${n.author ? ` · ${esc(n.author)}` : ''}</span>
                    <button type="button" class="ld-icon-btn ld-del" data-act="note-del" data-id="${esc(n.id)}" title="Удалить заметку"${busyAttr('note-del')}>${ICON.x(13)}</button></div>
                <div class="ld-note-text">${esc(n.text)}</div>
            </div>`).join('');
        return `
        <details class="ld-block"${D.notes.length || state.draft.note ? ' open' : ''}>
            <summary class="ld-h">Заметки (${D.notes.length})</summary>
            <div class="ld-note-add">
                <textarea class="ld-in" data-draft="note" rows="2" placeholder="Новая заметка о клиенте…">${esc(state.draft.note)}</textarea>
                <button type="button" class="btn btn-pri" data-act="note-add"${busyAttr('note')}>${btnLabel('note', 'Добавить', 'Добавляю…')}</button>
            </div>
            ${errHtml('note')}${errHtml('note-del')}
            ${list || '<div class="ld-muted">Заметок нет.</div>'}
        </details>`;
    }

    function omniHtml(D) {
        if (!D.omni.length) return '';
        return `
        <details class="ld-block">
            <summary class="ld-h">Обращения в мессенджерах (${D.omni.length})</summary>
            ${D.omni.map(o => `
            <div class="ld-item">
                <div class="ld-item-top"><b>${esc(OMNI[o.channel] || o.channel)} · ${esc(o.peer)}</b>${o.closed ? ' <span class="ld-muted">(закрыт)</span>' : ''}</div>
                ${o.thread.length ? o.thread.map(m => `<div class="ld-msg${m.out ? ' ld-msg-out' : ''}"><div>${esc(m.body)}</div><span>${esc(stampShort(m.at))}</span></div>`).join('')
                    : `<div class="ld-muted">${esc(o.lastText)}</div>`}
            </div>`).join('')}
        </details>`;
    }

    function historyHtml(D) {
        const rows = D.history.map(h => {
            const open = state.openSales.get(h.id);
            let items = '';
            if (open?.status === 'loading') items = '<div class="ld-sale-items"><span class="sk sk-line" style="width:50%"></span></div>';
            else if (open?.status === 'error') items = '<div class="ld-sale-items ld-err">Чек не загрузился</div>';
            else if (open?.status === 'ready') {
                items = `<div class="ld-sale-items">${open.sale.items.map(it => `
                    <div class="ld-sale-line"><span>${esc(it.name)}</span><span class="ld-muted">${it.count ?? ''}${it.count != null ? ' ×' : ''}</span><b>${money(it.total ?? it.sum)}</b></div>`).join('') || '<span class="ld-muted">Позиций нет</span>'}</div>`;
            }
            return `
            <div class="ld-sale${open ? ' open' : ''}">
                <button type="button" class="ld-sale-head" data-act="sale" data-id="${esc(h.id)}">
                    <span>${esc(stampFull(h.date))}</span>
                    <span class="ld-sale-station">${esc(h.station || '—')}</span>
                    <span>${h.vehicle ? esc(formatPlateInput(h.vehicle) || h.vehicle) : ''}</span>
                    <span class="ld-muted">${h.mileage ? `${thousands(h.mileage)} км` : ''}</span>
                    <span class="ld-muted">${h.items} поз.</span>
                    <b>${money(h.sum)}</b>
                    <span class="ld-sale-chev">${ICON.chevron(13)}</span>
                </button>
                ${items}
            </div>`;
        }).join('');
        return `
        <details class="ld-block" open>
            <summary class="ld-h">История покупок (${D.history.length})</summary>
            ${rows || '<div class="ld-muted">Покупок пока не было.</div>'}
        </details>`;
    }

    // Прайс приезжает отдельно и позже карточки — дописываем его в список на
    // месте, а не перерисовываем карточку (в ней уже могут печатать).
    function renderCalcServices() {
        const sel = cardEl.querySelector('#ld-svc');
        if (!sel || !state.services) return;
        sel.innerHTML = '<option value="">+ услуга из прайса…</option>' + state.services.map((s, i) =>
            `<option value="${i}">${esc(s.name)} — ${money(s.price)}</option>`).join('');
    }

    // ── Карточка: действия ───────────────────────────────────────────────────

    function bindCard() {
        renderCalcServices();
        const on = (sel, fn) => cardEl.querySelectorAll(sel).forEach(el => { el.onclick = (e) => fn(el, e); });

        on('[data-act="back"]', () => { shell.classList.remove('ld-has-card'); });
        on('[data-act="card-retry"]', () => {
            const D = state.card.data;
            const phone = state.card.phone;
            state.card = { status: 'loading', phone };
            renderCard();
            fetchCard(D?.client?.id ? `id=${D.client.id}` : `phone=${encodeURIComponent(phone)}`, phone);
        });
        bindLogin(cardEl);

        // Набранное — сразу в черновик: перерисовка после любого действия его
        // не потеряет.
        cardEl.querySelectorAll('[data-draft]').forEach(el => {
            const k = el.dataset.draft;
            const ev = el.tagName === 'SELECT' ? 'change' : 'input';
            el.addEventListener(ev, () => { state.draft[k] = el.value; if (k === 'name') publishPick(); });
        });
        cardEl.querySelectorAll('[data-line]').forEach(el => {
            el.addEventListener('input', () => {
                state.draft.lines[+el.dataset.line][el.dataset.k] = el.value;
                const t = cardEl.querySelector('#ld-total');
                if (t) t.textContent = money(calcTotal(state.draft.lines));
            });
        });
        const name = cardEl.querySelector('#ld-name');
        if (name) {
            name.addEventListener('input', () => { state.draft.name = name.value; publishPick(); });
            name.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); saveName(); }
                if (e.key === 'Escape') { state.editingName = false; renderCard(); }
            });
            name.focus();
        }
        const comment = cardEl.querySelector('#ld-comment');
        if (comment) {
            comment.addEventListener('input', () => { state.draft.comment = comment.value; });
            comment.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveComment(state.editingComment); }
                if (e.key === 'Escape') { state.editingComment = null; renderCard(); }
            });
            comment.focus();
        }

        const next = cardEl.querySelector('#ld-next');
        if (next) next.addEventListener('change', () => { state.draft.nextCall = next.value; renderCard(); });
        on('[data-act="pick-date"]', (btn) => openDateFor(next, btn));
        on('[data-quick]', (b) => {
            state.draft.nextCall = b.dataset.quick === 'clear' ? '' : isoDay(Number(b.dataset.quick));
            renderCard();
        });

        const svc = cardEl.querySelector('#ld-svc');
        if (svc) svc.addEventListener('change', () => {
            const s = state.services?.[Number(svc.value)];
            if (!s) return;
            const lines = state.draft.lines;
            const empty = lines.findIndex(l => !l.name && !l.price);
            const line = { name: s.name, price: String(s.price), qty: '1' };
            if (empty >= 0) lines[empty] = line; else lines.push(line);
            renderCard();
        });
        on('[data-act="line-add"]', () => { state.draft.lines.push({ name: '', price: '', qty: '1' }); renderCard(); });
        on('[data-act="line-del"]', (b) => {
            state.draft.lines.splice(Number(b.dataset.i), 1);
            if (!state.draft.lines.length) state.draft.lines.push({ name: '', price: '', qty: '1' });
            renderCard();
        });

        on('[data-act="name-edit"]', () => { state.editingName = true; state.draft.name = state.card.data.client.fio; renderCard(); });
        on('[data-act="name-cancel"]', () => { state.editingName = false; renderCard(); });
        on('[data-act="name-save"]', () => saveName());
        on('[data-act="lead-save"]', () => saveLead());
        on('[data-act="comment-edit"]', (b) => {
            const call = state.card.data.calls.find(x => x.id === b.dataset.id);
            state.editingComment = b.dataset.id;
            state.draft.comment = call?.comment || '';
            renderCard();
        });
        on('[data-act="comment-cancel"]', () => { state.editingComment = null; renderCard(); });
        on('[data-act="comment-save"]', (b) => saveComment(b.dataset.id));
        on('[data-act="calc-save"]', () => saveCalc());
        on('[data-act="calc-del"]', (b) => delCalc(b.dataset.id));
        on('[data-act="note-add"]', () => addNote());
        on('[data-act="note-del"]', (b) => delNote(b.dataset.id));
        on('[data-act="sale"]', (b) => toggleSale(b.dataset.id));
        on('[data-act="create"]', () => createClient());
    }

    const clientId = () => state.card.data.client.id;

    async function saveName() {
        const fio = (state.draft.name || '').trim();
        if (!fio) { state.errors.name = 'Введите имя'; return renderCard(); }
        const out = await act('name', () => apiFetch(`/api/crm/leads/clients/${clientId()}/name`, { method: 'POST', body: { fio } }));
        if (out) {
            state.card.data.client.fio = out.fio || fio;
            state.editingName = false;
            if (state.selected) state.selected.name = out.fio || fio;
            renderCard();
            renderFeed();
        }
    }

    // «Сохранить лид»: статус с датой следующего звонка — одно действие CRM,
    // источник — другое, и уходит он, только если его поменяли.
    async function saveLead() {
        const D = state.card.data;
        const status = state.draft.status ?? D.plan.status;
        const nextCall = state.draft.nextCall ?? D.plan.nextCall;
        const source = state.draft.source ?? D.client.sourceId;
        const out = await act('lead', async () => {
            await apiFetch(`/api/crm/leads/clients/${clientId()}/plan`, { method: 'POST', body: { status, nextCall } });
            if (source !== D.client.sourceId) {
                await apiFetch(`/api/crm/leads/clients/${clientId()}/source`, { method: 'POST', body: { sourceId: source } });
            }
            return { ok: true };
        });
        if (out) {
            D.plan = { status, nextCall };
            D.client.sourceId = source;
            state.draft.status = state.draft.nextCall = state.draft.source = null;
            renderCard();
        }
    }

    async function saveComment(id) {
        const text = (state.draft.comment || '').trim();
        const out = await act('comment', () => apiFetch(`/api/crm/leads/calls/${id}/comment`, { method: 'POST', body: { text } }));
        if (out) {
            const call = state.card.data.calls.find(x => x.id === id);
            if (call) call.comment = text;
            state.editingComment = null;
            renderCard();
        }
    }

    async function saveCalc() {
        const items = cleanCalcItems(state.draft.lines);
        if (!items.length) { state.errors.calc = 'Добавьте позиции'; return renderCard(); }
        const D = state.card.data;
        // Расчёт привязывается к звонку: к тому, из которого открыли карточку,
        // если CRM его знает, иначе — к последнему, как это делает сама CRM.
        const opened = state.selected && D.calls.find(x => x.dir === 'in' && Math.abs(callTime(x) - callTime(state.selected)) < 120_000);
        const callId = opened?.id || D.calls[0]?.id || '';
        const out = await act('calc', () => apiFetch(`/api/crm/leads/clients/${clientId()}/calcs`, {
            method: 'POST', body: { callId, car: state.draft.calcCar ?? D.client.car, items },
        }));
        if (out) {
            state.draft.lines = [{ name: '', price: '', qty: '1' }];
            renderCard();
        }
    }

    async function delCalc(id) {
        if (!confirm('Удалить расчёт?')) return;
        const out = await act('calc-del', () => apiFetch(`/api/crm/leads/calcs/${id}`, { method: 'DELETE' }), { flash: '' });
        if (out) {
            const D = state.card.data;
            D.calcs = D.calcs.filter(x => x.id !== id);
            renderCard();
        }
    }

    async function addNote() {
        const text = (state.draft.note || '').trim();
        if (!text) return;
        const out = await act('note', () => apiFetch(`/api/crm/leads/clients/${clientId()}/notes`, { method: 'POST', body: { text } }));
        if (out) { state.draft.note = ''; renderCard(); }
    }

    async function delNote(id) {
        if (!confirm('Удалить заметку?')) return;
        const out = await act('note-del', () => apiFetch(`/api/crm/leads/notes/${id}`, { method: 'DELETE' }), { flash: '' });
        if (out) {
            const D = state.card.data;
            D.notes = D.notes.filter(x => x.id !== id);
            renderCard();
        }
    }

    async function createClient() {
        const phone = state.card.phone;
        const out = await act('create', () => apiFetch('/api/crm/leads/clients', {
            method: 'POST', body: { phone, name: state.draft.name, car: state.draft.car },
        }), { flash: '' });
        if (out?.card) {
            state.card = { status: 'ready', phone, data: out.card };
            state.draft = freshDraft();
            ensureServices();
            renderCard();
        }
    }

    // Чек покупки — тем же путём, что во вкладке «Клиент» (/api/crm/new/sales).
    async function toggleSale(id) {
        if (state.openSales.has(id)) { state.openSales.delete(id); return renderCard(); }
        state.openSales.set(id, { status: 'loading' });
        renderCard();
        try {
            const { sale } = await apiFetch(`/api/crm/new/sales/${id}`);
            if (state.openSales.has(id)) state.openSales.set(id, { status: 'ready', sale });
        } catch {
            if (state.openSales.has(id)) state.openSales.set(id, { status: 'error' });
        }
        renderCard();
    }

    renderFeed();
    renderCard();

    return {
        activate() {
            active = true;
            loadOperator();
                        if (state.feedStatus !== 'auth') loadFeed();
            schedule();
        },
        // Ушли с вкладки — опрос встаёт: ходить в CRM за лентой, которую
        // никто не видит, значит занимать общую очередь запросов к ней.
        deactivate() {
            active = false;
            clearTimeout(pollTimer);
        },
        // Карточка клиента не из звонка — например, из «Чатов» (переписка
        // привязана к клиенту CRM). Звонка-контекста у неё нет.
        openClient(clientId) {
            if (!/^\d+$/.test(String(clientId || ''))) return;
            const key = `client:${clientId}`;
            state.selected = null;
            state.draft = freshDraft();
            state.errors = {};
            state.flash = '';
            state.openSales = new Map();
            state.editingName = false;
            state.editingComment = null;
            state.card = { status: 'loading', phone: key };
            shell.classList.add('ld-has-card');
            renderFeed();
            renderCard();
            fetchCard(`id=${encodeURIComponent(clientId)}`, key);
        },
    };
}
