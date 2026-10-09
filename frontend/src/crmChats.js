// ─────────────────────────────────────────────────────────────────────────────
// Вкладка «Чаты» (/chats): «Открытые линии» новой CRM — переписка с клиентами
// в MAX, Telegram и ВК. Слева диалоги, справа переписка и ответ.
//
// Что где:
//   • разбор ответов CRM — shared/crmChats.js;
//   • ручки под личной сессией — backend/src/routes/crmChats.js;
//   • счётчик на вкладке и уведомление о новом — chatPulse.js (он живёт на
//     всём сайте, а не только здесь);
//   • пасты справа (заготовленные ответы по темам) — chatPastes.js;
//   • песочница без CRM — frontend/dev-chats.html.
//
// Список и открытый диалог перечитываются раз в 8 секунд, пока вкладка
// открыта (в CRM — раз в 25). Поле ответа при этом НЕ пересобирается: в нём
// печатают, и опрос, съедающий набранное, хуже любого опоздания на секунды.
// Черновик помнится по диалогу — перешёл в другой и вернулся, текст на месте.
//
// Значки — SVG, эмодзи нет (та же причина, что во вкладке «Клиент»).
// ─────────────────────────────────────────────────────────────────────────────

import './crmLeads.css'; // общие кирпичики: чипы, поиск, пустые состояния, скелеты
import './crmChats.css';
import { CHANNELS, channelLabel } from '../../shared/crmChats.js';
import { firstBlank } from '../../shared/chatPastes.js';
import { initChatPastes } from './chatPastes.js';

const POLL_MS = 8000;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function stampShort(at) {
    const m = String(at || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (!m) return String(at || '');
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return `${m[1]}-${m[2]}-${m[3]}` === today ? `${m[4]}:${m[5]}` : `${m[3]}.${m[2]} ${m[4]}:${m[5]}`;
}

const svg = (body, size = 14) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
    chat: (s) => svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', s),
    send: (s) => svg('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>', s),
    clip: (s) => svg('<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>', s),
    back: (s) => svg('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>', s),
    search: (s) => svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', s),
    bell: (s) => svg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>', s),
    user: (s) => svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', s),
    paste: (s) => svg('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>', s),
};

const chanBadge = (ch) => `<span class="ch-chan ch-chan-${esc(ch || 'x')}">${esc(channelLabel(ch))}</span>`;

export function initCrmChats({ apiFetch, pulse = null, onOpenClient = () => {}, getUserId = () => null }) {
    const host = document.getElementById('chats-body');
    host.innerHTML = `
        <div class="ch">
            <aside class="ch-side">
                <div class="ch-filters" id="ch-filters"></div>
                <div class="ch-list" id="ch-list"></div>
            </aside>
            <section class="ch-thread" id="ch-thread"></section>
            <aside class="ch-pastes" id="ch-pastes"></aside>
        </div>`;
    const shell = host.querySelector('.ch');
    const filtersEl = host.querySelector('#ch-filters');
    const listEl = host.querySelector('#ch-list');
    const threadEl = host.querySelector('#ch-thread');

    // Пасты — справа на широком экране, выезжающей панелью на узком (кнопка
    // «Пасты» у поля ответа). Вставка идёт в поле ответа открытого диалога.
    const pastes = initChatPastes({
        host: host.querySelector('#ch-pastes'),
        apiFetch,
        getUserId,
        onInsert: (text) => insertIntoReply(text),
        onClose: () => shell.classList.remove('ch-pastes-open'),
    });
    let pastesLoaded = false;

    const state = {
        status: 'open',
        channel: '',
        q: '',
        dialogs: [],
        listStatus: 'loading', // loading | ready | error | auth
        listError: '',
        waiting: new Set(),    // id диалогов, где клиент ждёт оператора
        activeId: null,
        thread: null,          // { dialog, messages }
        threadStatus: 'idle',  // idle | loading | ready | error
        threadError: '',
        drafts: new Map(),     // id диалога → набранный ответ
        sending: false,
        sendError: '',
        busy: '',              // какое действие шапки уходит в CRM
        actError: '',
        linking: null,         // { q, results, status }
    };

    let timer = null;
    let active = false;
    let qTimer = null;

    // ── Список ───────────────────────────────────────────────────────────────

    async function loadList() {
        const params = new URLSearchParams({ status: state.status, channel: state.channel, q: state.q });
        try {
            const data = await apiFetch(`/api/crm/chats/dialogs?${params}`);
            state.dialogs = data.dialogs || [];
            state.listStatus = 'ready';
            state.listError = '';
        } catch (e) {
            if (e.code === 'crm_auth_required' || e.code === 'crm_auth_failed') state.listStatus = 'auth';
            else if (!state.dialogs.length) state.listStatus = 'error';
            state.listError = e.message || 'CRM не ответила';
        }
        renderList();
    }

    function renderFilters() {
        const chip = (attr, val, label, on) => `<button type="button" class="ld-chip${on ? ' on' : ''}" data-${attr}="${val}">${label}</button>`;
        const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
        filtersEl.innerHTML = `
            <div class="ld-chips">
                ${chip('st', 'open', 'Открытые', state.status === 'open')}
                ${chip('st', 'closed', 'Закрытые', state.status === 'closed')}
            </div>
            <div class="ld-chips">
                ${chip('chan', '', 'Все', !state.channel)}
                ${CHANNELS.map(c => chip('chan', c.id, c.label, state.channel === c.id)).join('')}
            </div>
            <label class="ld-search">${ICON.search(14)}<input id="ch-q" type="search" placeholder="Имя, телефон, текст" value="${esc(state.q)}" autocomplete="off"></label>
            ${perm === 'default' ? `<button type="button" class="ch-notify" data-act="notify">${ICON.bell(13)} Включить уведомления на рабочем столе</button>` : ''}
            ${perm === 'denied' ? '<div class="ch-note">Уведомления на рабочем столе запрещены в браузере — о новых сообщениях скажет счётчик на вкладке и заголовок окна.</div>' : ''}`;
        filtersEl.querySelectorAll('[data-st]').forEach(b => { b.onclick = () => { state.status = b.dataset.st; renderFilters(); state.listStatus = 'loading'; renderList(); loadList(); }; });
        filtersEl.querySelectorAll('[data-chan]').forEach(b => { b.onclick = () => { state.channel = b.dataset.chan; renderFilters(); loadList(); }; });
        const q = filtersEl.querySelector('#ch-q');
        q.oninput = () => {
            clearTimeout(qTimer);
            qTimer = setTimeout(() => { state.q = q.value.trim(); loadList(); }, 350);
        };
        const nb = filtersEl.querySelector('[data-act="notify"]');
        if (nb) nb.onclick = async () => {
            try { await Notification.requestPermission(); } catch { /* старый браузер */ }
            renderFilters();
        };
    }

    function renderList() {
        let html;
        if (state.listStatus === 'loading') {
            html = '<div class="ld-skel-list">' + '<div class="ld-skel"><span class="sk sk-line" style="width:55%"></span><span class="sk sk-line" style="width:80%"></span></div>'.repeat(5) + '</div>';
        } else if (state.listStatus === 'auth') {
            html = '<div class="ld-empty">Нет сессии CRM — войдите своей учёткой на вкладке «Лиды» или «Клиент».</div>';
        } else if (state.listStatus === 'error') {
            html = `<div class="ld-empty ld-error">Чаты не загрузились: ${esc(state.listError)}</div>`;
        } else if (!state.dialogs.length) {
            html = `<div class="ld-empty">${state.status === 'open' ? 'Открытых диалогов нет. Как только клиент напишет в MAX, Telegram или ВК — он появится здесь.' : 'Закрытых диалогов нет.'}</div>`;
        } else {
            // Ждущие оператора — первыми: бот уже сдался, клиент сидит и ждёт.
            const rows = [...state.dialogs].sort((a, b) => state.waiting.has(b.id) - state.waiting.has(a.id));
            html = rows.map(d => {
                const wait = state.waiting.has(d.id);
                return `
                <button type="button" class="ch-row${d.id === state.activeId ? ' ch-row-sel' : ''}${d.unread ? ' ch-row-unread' : ''}${wait ? ' ch-row-wait' : ''}" data-id="${esc(d.id)}">
                    <span class="ch-row-top">
                        <b class="ch-row-who">${esc(d.who)}</b>
                        ${chanBadge(d.channel)}
                        ${d.unread ? `<span class="ch-unread">${d.unread}</span>` : ''}
                    </span>
                    <span class="ch-row-text">${d.lastOut ? '<span class="ld-muted">Вы: </span>' : ''}${esc(d.lastText) || '<span class="ld-muted">—</span>'}</span>
                    <span class="ch-row-bottom">
                        ${wait ? '<span class="ch-wait">ждёт оператора</span>'
                            : d.assignee ? `<span class="ld-muted">${ICON.user(11)} ${esc(d.assignee)}</span>`
                            : '<span class="ch-free">не взят</span>'}
                        <span class="ld-muted">${esc(stampShort(d.lastAt))}</span>
                    </span>
                </button>`;
            }).join('');
        }
        const stale = state.listStatus === 'ready' && state.listError
            ? `<div class="ld-feed-note ld-feed-warn">Обновить список не вышло: ${esc(state.listError)}</div>` : '';
        listEl.innerHTML = html + stale;
        listEl.querySelectorAll('[data-id]').forEach(b => { b.onclick = () => openDialog(b.dataset.id); });
    }

    // ── Диалог ───────────────────────────────────────────────────────────────

    async function openDialog(id) {
        if (state.activeId !== id) {
            state.activeId = id;
            state.thread = null;
            state.threadStatus = 'loading';
            state.sendError = '';
            state.actError = '';
            state.linking = null;
            shell.classList.add('ch-has-thread');
            renderList();
            renderThread();
        }
        await loadThread({ scroll: true });
    }

    async function loadThread({ scroll = false } = {}) {
        const id = state.activeId;
        if (!id) return;
        try {
            const data = await apiFetch(`/api/crm/chats/dialogs/${id}`);
            if (state.activeId !== id) return;
            const before = state.thread?.messages.length || 0;
            state.thread = data;
            state.threadStatus = 'ready';
            state.threadError = '';
            // Открытие диалога CRM считает прочтением — счётчик на вкладке
            // и цифра в списке гаснут сразу, а не через опрос.
            const row = state.dialogs.find(d => d.id === id);
            if (row && row.unread) { row.unread = 0; renderList(); }
            pulse?.refresh();
            renderThread({ scroll: scroll || data.messages.length !== before });
        } catch (e) {
            if (state.activeId !== id) return;
            if (state.threadStatus !== 'ready') {
                state.threadStatus = 'error';
                state.threadError = e.message || 'CRM не ответила';
                renderThread();
            }
        }
    }

    function messagesHtml(messages) {
        if (!messages.length) return '<div class="ld-empty">Сообщений пока нет</div>';
        return messages.map(m => `
            <div class="ch-msg${m.out ? ' ch-msg-out' : ''}">
                <div class="ch-bubble">
                    <div class="ch-body">${esc(m.body)}</div>
                    ${m.attachments ? `<div class="ch-att">${ICON.clip(11)} вложение${m.attachments > 1 ? ` ×${m.attachments}` : ''}</div>` : ''}
                    <div class="ch-meta">${m.out && m.author ? `${esc(m.author)} · ` : ''}${esc(stampShort(m.at))}${m.failed ? ' · <span class="ch-failed">не доставлено</span>' : ''}</div>
                </div>
            </div>`).join('');
    }

    function headHtml(dg) {
        const busy = (k) => (state.busy === k ? ' disabled aria-busy="true"' : '');
        const link = state.linking;
        return `
        <div class="ch-head">
            <button type="button" class="ld-back btn btn-sec" data-act="back">${ICON.back(14)} К диалогам</button>
            <div class="ch-head-who">
                ${chanBadge(dg.channel)}
                <b>${esc(dg.who)}</b>
                ${dg.username ? `<span class="ld-muted">@${esc(dg.username)}</span>` : ''}
                ${dg.phone ? `<span class="ld-muted">${esc(dg.phone)}</span>` : ''}
                ${state.waiting.has(dg.id) ? '<span class="ch-wait">ждёт оператора</span>' : ''}
            </div>
            <div class="ch-head-acts">
                ${dg.clientId
                    ? `<button type="button" class="ld-chip" data-act="card">Карточка клиента</button>`
                    : `<button type="button" class="ld-chip" data-act="link-open">Привязать клиента</button>`}
                <button type="button" class="ld-chip" data-act="assign"${busy('assign')}>${dg.assigned ? 'Переназначить на себя' : 'Взять в работу'}</button>
                ${dg.closed
                    ? `<button type="button" class="ld-chip" data-act="reopen"${busy('status')}>Вернуть в работу</button>`
                    : `<button type="button" class="ld-chip" data-act="close"${busy('status')}>Закрыть</button>`}
            </div>
            ${state.actError ? `<div class="ld-err">${esc(state.actError)}</div>` : ''}
            ${link ? `
            <div class="ch-link">
                <input id="ch-link-q" class="ld-in" placeholder="Имя или телефон клиента" value="${esc(link.q)}" autocomplete="off">
                <button type="button" class="btn btn-sec" data-act="link-search">Найти</button>
                <button type="button" class="btn btn-sec" data-act="link-cancel">Отмена</button>
                <div class="ch-link-res">
                    ${link.status === 'loading' ? '<span class="ld-muted">Ищу…</span>' : ''}
                    ${link.status === 'empty' ? '<span class="ld-muted">Не нашлось</span>' : ''}
                    ${link.status === 'error' ? `<span class="ld-err">${esc(link.error)}</span>` : ''}
                    ${(link.results || []).map(c => `<button type="button" class="ld-chip" data-link="${esc(c.id)}">${esc(c.name)}${c.phone ? ` · ${esc(c.phone)}` : ''}</button>`).join('')}
                </div>
            </div>` : ''}
        </div>`;
    }

    // Переписка и шапка перерисовываются, поле ответа — никогда: в нём печатают.
    function renderThread({ scroll = false } = {}) {
        if (state.threadStatus === 'idle') {
            threadEl.innerHTML = `<div class="ld-card-empty">${ICON.chat(28)}<div>Выберите диалог слева — откроется переписка, ответить можно прямо отсюда.</div></div>`;
            return;
        }
        if (state.threadStatus === 'loading') {
            threadEl.innerHTML = `<div class="ld-skel-card">${'<span class="sk sk-line"></span>'.repeat(5)}</div>`;
            return;
        }
        if (state.threadStatus === 'error') {
            threadEl.innerHTML = `<button type="button" class="ld-back btn btn-sec" data-act="back">${ICON.back(14)} К диалогам</button><div class="ld-empty ld-error">Диалог не открылся: ${esc(state.threadError)}</div>`;
            bindThread();
            return;
        }
        const { dialog, messages } = state.thread;
        if (!threadEl.querySelector('.ch-compose') || threadEl.dataset.id !== dialog.id) {
            threadEl.dataset.id = dialog.id;
            threadEl.innerHTML = `
                <div id="ch-head"></div>
                <div class="ch-msgs" id="ch-msgs"></div>
                <div class="ch-compose">
                    <textarea id="ch-reply" class="ld-in" rows="2" placeholder="Ответ клиенту… Enter — отправить, Shift+Enter — новая строка"></textarea>
                    <div class="ch-compose-acts">
                        <button type="button" class="btn btn-sec ch-pastes-toggle" data-act="pastes">${ICON.paste(14)} Пасты</button>
                        <button type="button" class="btn btn-pri ch-send" data-act="send">${ICON.send(14)} Отправить</button>
                    </div>
                </div>
                <div id="ch-send-err"></div>`;
            const ta = threadEl.querySelector('#ch-reply');
            ta.value = state.drafts.get(dialog.id) || '';
            ta.addEventListener('input', () => state.drafts.set(dialog.id, ta.value));
            // Enter — отправить, как в самой CRM и в любом мессенджере.
            ta.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
            });
            threadEl.querySelector('[data-act="send"]').onclick = () => send();
            threadEl.querySelector('[data-act="pastes"]').onclick = () => shell.classList.toggle('ch-pastes-open');
            scroll = true;
        }
        threadEl.querySelector('#ch-head').innerHTML = headHtml(dialog);
        const box = threadEl.querySelector('#ch-msgs');
        // Человек отлистал историю вверх — опрос его вниз не дёргает.
        const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
        box.innerHTML = messagesHtml(messages);
        if (scroll || atBottom) box.scrollTop = box.scrollHeight;
        const sendBtn = threadEl.querySelector('[data-act="send"]');
        sendBtn.disabled = state.sending;
        sendBtn.innerHTML = state.sending ? '<span class="ld-spin" aria-hidden="true"></span>Отправляю…' : `${ICON.send(14)} Отправить`;
        threadEl.querySelector('#ch-send-err').innerHTML = state.sendError ? `<div class="ld-err">Не отправлено: ${esc(state.sendError)}</div>` : '';
        bindThread();
    }

    function bindThread() {
        const on = (sel, fn) => threadEl.querySelectorAll(sel).forEach(el => { el.onclick = () => fn(el); });
        on('[data-act="back"]', () => { shell.classList.remove('ch-has-thread'); });
        on('[data-act="card"]', () => onOpenClient(state.thread.dialog.clientId));
        on('[data-act="assign"]', () => headAct('assign', 'assign', {}));
        on('[data-act="close"]', () => headAct('status', 'status', { to: 'closed' }));
        on('[data-act="reopen"]', () => headAct('status', 'status', { to: 'open' }));
        on('[data-act="link-open"]', () => { state.linking = { q: '', results: [], status: 'idle' }; renderThread(); threadEl.querySelector('#ch-link-q')?.focus(); });
        on('[data-act="link-cancel"]', () => { state.linking = null; renderThread(); });
        on('[data-act="link-search"]', () => linkSearch());
        on('[data-link]', (b) => linkClient(b.dataset.link));
        const lq = threadEl.querySelector('#ch-link-q');
        if (lq) {
            lq.oninput = () => { state.linking.q = lq.value; };
            lq.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); linkSearch(); } };
        }
    }

    // Паста ложится на место каретки (или вместо выделенного), а выделяется
    // первый пропуск «_» внутри неё — его сразу перепечатывают адресом или
    // ценой. Отправляет всё равно человек: в пасте почти всегда есть что
    // дописать.
    function insertIntoReply(text) {
        const ta = threadEl.querySelector('#ch-reply');
        if (!ta || state.threadStatus !== 'ready') return false;
        const start = ta.selectionStart ?? ta.value.length;
        const end = ta.selectionEnd ?? start;
        ta.focus();
        ta.setRangeText(text, start, end, 'end');
        ta.dispatchEvent(new Event('input', { bubbles: true })); // черновик диалога
        const blank = firstBlank(ta.value, start);
        if (blank && blank.end <= start + text.length) ta.setSelectionRange(blank.start, blank.end);
        // На узком экране панель закрывает переписку — после вставки ей там
        // делать нечего.
        shell.classList.remove('ch-pastes-open');
        return true;
    }

    async function send() {
        const id = state.activeId;
        const ta = threadEl.querySelector('#ch-reply');
        const text = (ta?.value || '').trim();
        if (!text || state.sending) return;
        state.sending = true;
        state.sendError = '';
        renderThread();
        try {
            await apiFetch(`/api/crm/chats/dialogs/${id}/reply`, { method: 'POST', body: { text } });
            state.drafts.delete(id);
            if (state.activeId === id && ta) ta.value = '';
        } catch (e) {
            state.sendError = e.message || 'CRM не приняла';
        }
        state.sending = false;
        await loadThread({ scroll: true });
        if (state.threadStatus !== 'ready') renderThread();
        loadList();
    }

    async function headAct(busyKey, path, body) {
        const id = state.activeId;
        state.busy = busyKey;
        state.actError = '';
        renderThread();
        try {
            await apiFetch(`/api/crm/chats/dialogs/${id}/${path}`, { method: 'POST', body });
        } catch (e) {
            state.actError = e.message || 'CRM не приняла';
        }
        state.busy = '';
        await loadThread();
        loadList();
    }

    async function linkSearch() {
        const q = (state.linking?.q || '').trim();
        if (q.length < 2) return;
        state.linking = { q, results: [], status: 'loading' };
        renderThread();
        try {
            const { clients } = await apiFetch(`/api/crm/chats/clients?q=${encodeURIComponent(q)}`);
            if (!state.linking) return;
            state.linking = { q, results: clients || [], status: clients?.length ? 'ready' : 'empty' };
        } catch (e) {
            if (!state.linking) return;
            state.linking = { q, results: [], status: 'error', error: e.message || 'CRM не ответила' };
        }
        renderThread();
    }

    async function linkClient(clientId) {
        const id = state.activeId;
        try {
            await apiFetch(`/api/crm/chats/dialogs/${id}/link`, { method: 'POST', body: { clientId } });
            state.linking = null;
        } catch (e) {
            state.actError = e.message || 'CRM не приняла';
        }
        await loadThread();
        loadList();
    }

    // ── Опрос ────────────────────────────────────────────────────────────────

    function schedule() {
        clearTimeout(timer);
        if (!active) return;
        timer = setTimeout(async () => {
            if (active && !document.hidden && state.listStatus !== 'auth') {
                await loadList();
                if (state.activeId && state.threadStatus === 'ready') await loadThread();
            }
            schedule();
        }, POLL_MS);
    }

    // «Ждут оператора» приезжает с пульсом сайта (chatPulse.js), а не
    // отдельным запросом: тот и так спрашивает раз в двадцать секунд.
    pulse?.subscribe(({ waiting = [] }) => {
        const next = new Set(waiting.map(w => w.id));
        const changed = next.size !== state.waiting.size || [...next].some(id => !state.waiting.has(id));
        state.waiting = next;
        if (changed && state.listStatus === 'ready') renderList();
    });

    renderFilters();
    renderList();
    renderThread();

    return {
        activate() {
            active = true;
            if (!pastesLoaded) { pastesLoaded = true; pastes.load(); }
            renderFilters(); // разрешение на уведомления могли дать в другом месте
            loadList();
            if (state.activeId) loadThread();
            schedule();
        },
        deactivate() {
            active = false;
            clearTimeout(timer);
        },
        // Открыть конкретный диалог — по клику на уведомление.
        open(id) {
            if (!/^\d+$/.test(String(id || ''))) return;
            openDialog(String(id));
        },
    };
}
