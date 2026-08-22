// ─────────────────────────────────────────────────────────────────────────────
// Вкладка «Лиды»: карточка клиента во время звонка.
//
// Ради чего всё: оператор принимает звонок, и лид, который Битрикс уже завёл,
// открывается ЗДЕСЬ — сразу редактируемым, из пяти полей, которыми в разговоре
// и пользуются. Без прыжков по вкладкам и без ста кнопок, из которых нужны
// пять.
//
// Как сайт узнаёт о звонке: датчик на вкладке Битрикса (userscript/src/
// bitrix-call) сообщает бэкенду «идёт входящий, лид такой-то», а тут мы просто
// спрашиваем у своего сервера, есть ли открытый звонок. В Битрикс за этим не
// ходим вовсе — опрос чужого портала раз в несколько секунд был бы свинством.
//
// Звонок считается идущим, пока лид не сохранён или не закрыт: за стойкой
// трубку кладут раньше, чем дописывают комментарий.
//
// Разбор протокола и все ловушки Битрикса — docs/BITRIX.md.
// ─────────────────────────────────────────────────────────────────────────────

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Как часто спрашиваем свой сервер про звонок. Четыре секунды — компромисс:
// человек берёт трубку и первые слова говорит дольше, а чаще дёргать свой же
// бэкенд ради секунды выигрыша незачем.
const CALL_POLL_MS = 4000;

const state = {
    ready: false,
    linked: false,
    login: null,
    linkError: null,
    linkBusy: false,

    call: null,          // открытый звонок с сервера
    seenCallId: null,    // по какому звонку уже показали уведомление
    lead: null,          // { view } открытой карточки
    stages: [],
    sources: [],
    users: [],
    leadBusy: false,
    leadError: null,
    saved: false,

    feed: [],
    checkId: '',
    checking: false,
    checked: null,
    checkError: null,
};

let api = null;
let root = null;
let pollTimer = 0;

// ── Звонок: опрос и уведомление ──────────────────────────────────────────────

// Уведомление живёт вне вкладки: звонок приходит, когда оператор считает масло
// в калькуляторе, и тащить его на «Лиды» насильно нельзя — он сам решит, когда
// открыть карточку.
function showCallToast(call) {
    document.getElementById('lead-call-toast')?.remove();

    const box = document.createElement('div');
    box.id = 'lead-call-toast';
    box.className = 'lead-toast';
    box.innerHTML = `
        <div class="lead-toast-title">Входящий звонок</div>
        <div class="lead-toast-phone">${esc(formatPhone(call.phone))}</div>
        <div class="lead-toast-hint">${call.leadId ? 'нажмите, чтобы открыть лид' : 'лид ещё не создан'}</div>`;
    box.onclick = () => {
        box.remove();
        location.hash = '#/leads';
        if (call.leadId) openLead(call.leadId);
    };
    document.body.appendChild(box);

    // Само уведомление не исчезает по таймеру: разговор идёт минуту-другую, и
    // пропавшая плашка означала бы «ищи лид руками».
    requestAnimationFrame(() => box.classList.add('lead-toast-in'));
}

async function pollCall() {
    if (!state.linked) return;
    try {
        const { call } = await api('/api/bitrix/call');
        state.call = call || null;
        if (call && call.callId !== state.seenCallId) {
            state.seenCallId = call.callId;
            showCallToast(call);
            // Карточку подтягиваем сразу: пока оператор здоровается, она уже
            // будет открыта.
            if (call.leadId) openLead(call.leadId);
        }
        if (!call) document.getElementById('lead-call-toast')?.remove();
        if (root) render();
    } catch { /* сеть моргнула — попробуем на следующем тике */ }
}

export function startCallWatch({ apiFetch }) {
    api = apiFetch;
    if (pollTimer) return;
    loadLink().then(() => {
        pollCall();
        pollTimer = setInterval(pollCall, CALL_POLL_MS);
    });
}

// ── Данные ───────────────────────────────────────────────────────────────────

async function loadLink() {
    try {
        const st = await api('/api/bitrix/status');
        state.linked = Boolean(st.loggedIn);
        state.login = st.login || null;
        state.linkError = st.loggedIn ? null : (st.message || null);
    } catch (err) {
        state.linked = false;
        state.linkError = err.message || 'Битрикс не отвечает';
    }
    state.ready = true;
}

async function loadFeed() {
    try {
        const { leads } = await api('/api/bitrix/feed?limit=50');
        state.feed = leads || [];
    } catch { /* лента не главное — покажем пусто */ }
}

async function loadUsers() {
    if (state.users.length) return;
    try {
        const { users } = await api('/api/bitrix/users');
        state.users = users || [];
    } catch { /* выпадашка ответственного останется с одним текущим */ }
}

async function openLead(id) {
    state.leadBusy = true;
    state.leadError = null;
    state.saved = false;
    render();
    try {
        const data = await api(`/api/bitrix/lead/${id}`);
        state.lead = data.lead;
        state.stages = data.stages || [];
        state.sources = data.sources || [];
        loadUsers().then(render);
    } catch (err) {
        state.leadError = err.message || 'не удалось прочитать лид';
    }
    state.leadBusy = false;
    render();
}

async function saveLead(patch) {
    if (!state.lead) return;
    state.leadBusy = true;
    state.leadError = null;
    render();
    try {
        const { lead } = await api(`/api/bitrix/lead/${state.lead.id}`, { method: 'POST', body: patch });
        state.lead = lead;
        state.saved = true;
        state.call = null;
        document.getElementById('lead-call-toast')?.remove();
        await loadFeed();
    } catch (err) {
        state.leadError = err.message || 'не удалось сохранить';
    }
    state.leadBusy = false;
    render();
}

// ── Разметка ─────────────────────────────────────────────────────────────────

function formatPhone(raw) {
    const d = String(raw || '').replace(/\D+/g, '');
    if (d.length === 11) return `+${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
    return raw || '';
}

function selectHtml(id, list, current) {
    const options = list.map(item =>
        `<option value="${esc(item.id)}"${String(item.id) === String(current) ? ' selected' : ''}>${esc(item.name)}</option>`);
    // Значения, которого нет в справочнике, не теряем: молча подменить стадию
    // на первую попавшуюся — это испортить лид.
    if (current && !list.some(i => String(i.id) === String(current))) {
        options.unshift(`<option value="${esc(current)}" selected>${esc(current)}</option>`);
    }
    return `<select id="${id}" class="lead-select">${options.join('')}</select>`;
}

function leadCardHtml() {
    if (state.leadBusy && !state.lead) return '<div class="lead-empty">читаю карточку…</div>';
    if (!state.lead) {
        return `<div class="lead-empty">
            Карточка откроется сама, когда придёт звонок.
            ${state.feed.length ? 'Или выберите обращение из списка ниже.' : ''}
        </div>`;
    }

    const lead = state.lead;
    const callSource = String(lead.sourceId || '').toUpperCase() === 'CALL';

    return `
        <div class="lead-card">
            <div class="lead-card-head">
                <div>
                    <div class="lead-card-phone">${esc(formatPhone(lead.phones?.[0]))}</div>
                    <div class="lead-card-note">${esc(lead.sourceNote || lead.title || '')}</div>
                </div>
                <a class="lead-card-link" href="https://spotexpress.bitrix24.ru/crm/lead/details/${esc(lead.id)}/"
                   target="_blank" rel="noopener">Открыть в Битриксе</a>
            </div>

            <label class="lead-field">
                <span>Имя клиента</span>
                <input type="text" id="lead-name" class="lead-input" value="${esc(lead.name || '')}"
                       placeholder="как зовут" ${state.leadBusy ? 'disabled' : ''}/>
            </label>

            <label class="lead-field">
                <span>Стадия</span>
                ${selectHtml('lead-stage', state.stages, lead.statusId)}
            </label>

            <label class="lead-field${callSource ? ' lead-field-warn' : ''}">
                <span>Источник</span>
                ${selectHtml('lead-source', state.sources, lead.sourceId)}
            </label>
            ${callSource ? '<div class="lead-warn">Источник «Звонок» ставит телефония — выберите настоящий, иначе лид не сохранится.</div>' : ''}

            <label class="lead-field">
                <span>Ответственный</span>
                ${state.users.length
                    ? selectHtml('lead-user', state.users.map(u => ({ id: u.id, name: u.name })), lead.assignedById)
                    : `<input type="text" class="lead-input" value="${esc(lead.assignedByName || '')}" disabled/>`}
            </label>

            <label class="lead-field lead-field-wide">
                <span>Комментарий</span>
                <textarea id="lead-comments" class="lead-input lead-textarea" rows="5"
                          placeholder="о чём договорились" ${state.leadBusy ? 'disabled' : ''}>${esc(lead.comments || '')}</textarea>
            </label>

            <div class="lead-actions">
                <button class="btn" id="lead-save" ${state.leadBusy ? 'disabled' : ''}>
                    ${state.leadBusy ? 'сохраняю…' : 'Сохранить в Битрикс'}
                </button>
                <button class="btn btn-sec" id="lead-close">Закрыть</button>
                ${state.saved ? '<span class="lead-saved">сохранено</span>' : ''}
            </div>
            ${state.leadError ? `<div class="edit-error">${esc(state.leadError)}</div>` : ''}
        </div>`;
}

function feedHtml() {
    if (!state.feed.length) {
        return '<div class="lead-empty">Обращений пока нет — они появятся после первого звонка.</div>';
    }
    return `<div class="lead-feed">${state.feed.map(row => `
        <button class="lead-feed-row${row.unfilled ? ' lead-feed-unfilled' : ''}" data-lead="${esc(row.leadId)}">
            <span class="lead-feed-phone">${esc(formatPhone(row.phone) || row.title || row.leadId)}</span>
            <span class="lead-feed-name">${esc(row.name || '')}</span>
            ${row.unfilled ? '<span class="lead-feed-flag">не заполнено</span>' : ''}
            <span class="lead-feed-when">${esc(whenText(row.seenAt))}</span>
        </button>`).join('')}</div>`;
}

// Время в ленте — относительное: «12 минут назад» читается быстрее, чем
// «22.08.2026 11:30», а точная дата в разговоре не нужна никому.
function whenText(iso) {
    const at = Date.parse(iso || '');
    if (!Number.isFinite(at)) return '';
    const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
    if (mins < 1) return 'только что';
    if (mins < 60) return `${mins} мин назад`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} ч назад`;
    return `${Math.round(hours / 24)} дн назад`;
}

function linkHtml() {
    if (state.linked) {
        return `<div class="lead-link-ok">Связь с Битриксом есть — ${esc(state.login || '')}
            <button class="btn btn-sec btn-slim" id="lead-unlink">отвязать</button></div>`;
    }
    return `
        <div class="lead-link">
            <div class="lead-link-title">Войдите в Битрикс через сайт</div>
            ${state.linkError ? `<div class="lead-link-note">${esc(state.linkError)}</div>` : ''}
            <form id="lead-link-form" class="crm-login-form" autocomplete="off">
                <input type="text" id="lead-login" class="crm-input" placeholder="почта Битрикса"
                       autocomplete="username" value="${esc(state.login || '')}" ${state.linkBusy ? 'disabled' : ''}/>
                <input type="password" id="lead-password" class="crm-input" placeholder="пароль"
                       autocomplete="current-password" ${state.linkBusy ? 'disabled' : ''}/>
                <button class="btn" type="submit" ${state.linkBusy ? 'disabled' : ''}>
                    ${state.linkBusy ? 'вхожу…' : 'Привязать'}
                </button>
            </form>
            <div class="lead-link-hint">Пароль вводится один раз и хранится зашифрованным. Вводи внимательно:
                после нескольких неудачных попыток Битрикс включает капчу, и тогда вход встанет и у тебя в браузере.</div>
        </div>`;
}

function checkHtml() {
    const rows = [`
        <details class="lead-check">
            <summary>Проверка чтения</summary>
            <form id="lead-check-form" class="crm-login-form">
                <input type="text" id="lead-check-id" class="crm-input" placeholder="номер лида"
                       value="${esc(state.checkId)}" ${state.checking ? 'disabled' : ''}/>
                <button class="btn btn-sec" type="submit" ${state.checking ? 'disabled' : ''}>
                    ${state.checking ? 'читаю…' : 'Прочитать'}
                </button>
            </form>`];
    if (state.checkError) rows.push(`<div class="edit-error">${esc(state.checkError)}</div>`);
    if (state.checked) {
        rows.push(`<div class="lead-check-out">стадий ${state.checked.stages.length},
            источников ${state.checked.sources.length} — справочники читаются</div>`);
    }
    rows.push('</details>');
    return rows.join('');
}

function render() {
    if (!root) return;
    if (!state.ready) {
        root.innerHTML = '<div class="lead-empty">проверяю связь с Битриксом…</div>';
        return;
    }

    root.innerHTML = `
        ${linkHtml()}
        ${state.linked ? `
            ${state.call ? `<div class="lead-live">Идёт звонок — ${esc(formatPhone(state.call.phone))}</div>` : ''}
            ${leadCardHtml()}
            <h3 class="lead-sec-title">Обращения</h3>
            ${feedHtml()}
            ${checkHtml()}
        ` : ''}`;
    bind();
}

function bind() {
    const linkForm = root.querySelector('#lead-link-form');
    if (linkForm) {
        linkForm.onsubmit = async (e) => {
            e.preventDefault();
            const login = root.querySelector('#lead-login').value.trim();
            const password = root.querySelector('#lead-password').value;
            if (!login || !password) return;
            state.linkBusy = true;
            state.linkError = null;
            render();
            try {
                await api('/api/bitrix/login', { method: 'POST', body: { login, password } });
                state.linked = true;
                state.login = login;
                await loadFeed();
            } catch (err) {
                state.linkError = err.message || 'не удалось войти';
            }
            state.linkBusy = false;
            render();
        };
    }

    const unlink = root.querySelector('#lead-unlink');
    if (unlink) {
        unlink.onclick = async () => {
            unlink.disabled = true;
            try {
                await api('/api/bitrix/logout', { method: 'POST', body: { unlink: true } });
                state.linked = false;
                state.lead = null;
            } catch (err) {
                state.linkError = err.message;
            }
            render();
        };
    }

    const save = root.querySelector('#lead-save');
    if (save) {
        save.onclick = () => saveLead({
            name: root.querySelector('#lead-name').value.trim(),
            statusId: root.querySelector('#lead-stage')?.value,
            sourceId: root.querySelector('#lead-source')?.value,
            assignedById: root.querySelector('#lead-user')?.value || undefined,
            comments: root.querySelector('#lead-comments').value,
        });
    }

    const close = root.querySelector('#lead-close');
    if (close) {
        close.onclick = async () => {
            state.lead = null;
            state.call = null;
            document.getElementById('lead-call-toast')?.remove();
            render();
            try { await api('/api/bitrix/call/close', { method: 'POST', body: {} }); } catch { /* не критично */ }
        };
    }

    root.querySelectorAll('[data-lead]').forEach(btn => {
        btn.onclick = () => openLead(btn.dataset.lead);
    });

    const check = root.querySelector('#lead-check-form');
    if (check) {
        check.onsubmit = async (e) => {
            e.preventDefault();
            const id = root.querySelector('#lead-check-id').value.trim();
            if (!/^\d+$/.test(id)) { state.checkError = 'номер лида — это число'; return render(); }
            state.checkId = id;
            state.checking = true;
            state.checkError = null;
            state.checked = null;
            render();
            try {
                state.checked = await api(`/api/bitrix/lead/${id}`);
                state.lead = state.checked.lead;
                state.stages = state.checked.stages || [];
                state.sources = state.checked.sources || [];
                loadUsers().then(render);
            } catch (err) {
                state.checkError = err.message || 'не удалось прочитать';
            }
            state.checking = false;
            render();
        };
    }
}

export function initLeadsPage({ apiFetch }) {
    api = apiFetch;
    root = document.getElementById('leads-body');
    if (!root) return;
    render();
    if (!state.ready) loadLink().then(() => { render(); loadFeed().then(render); });
    else loadFeed().then(render);
}
