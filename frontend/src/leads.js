// ─────────────────────────────────────────────────────────────────────────────
// Вкладка «Лиды»: карточка клиента во время звонка.
//
// Ради чего всё: оператор принимает звонок, и лид, который Битрикс уже завёл,
// открывается ЗДЕСЬ — сразу редактируемым, из пяти полей, которыми в разговоре
// и пользуются. Без прыжков по вкладкам и без ста кнопок, из которых нужны
// пять.
//
// Как сайт узнаёт о звонке: спрашиваем свой сервер, есть ли открытый звонок, а
// он смотрит в Битрикс сам (backend/src/bitrix/watch.js) и заодно слушает
// датчик на вкладке Битрикса (userscript/src/bitrix-call). Источников два, и
// сходятся они в одну запись звонка — здесь эта разница не видна вовсе.
//
// Звонок считается идущим, пока лид не сохранён или не закрыт: за стойкой
// трубку кладут раньше, чем дописывают комментарий.
//
// Разбор протокола и все ловушки Битрикса — docs/BITRIX.md.
// ─────────────────────────────────────────────────────────────────────────────

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Как часто спрашиваем свой сервер про звонок. Три секунды: за ними стоит
// поход в Битрикс, и уведомление должно успеть всплыть, пока оператор ещё
// здоровается. Частоту похода в портал держит сам сервер — здесь можно
// спрашивать чаще, лишнего он не сделает.
const CALL_POLL_MS = 3000;

const state = {
    ready: false,
    linked: false,
    login: null,
    linkError: null,
    linkBusy: false,

    call: null,          // открытый звонок с сервера
    seenCallId: null,    // по какому звонку уже показали уведомление
    lead: null,          // { view } открытой карточки
    // Набранное оператором живёт ЗДЕСЬ, а не в DOM: перерисовка не должна
    // стирать полфразы, которую человек печатает во время разговора.
    draft: null,
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

// Опрос идёт в Битрикс, и ответ может задержаться. Второй запрос поверх
// незаконченного не ускорит ничего, зато перепутает порядок ответов.
let polling = false;

async function pollCall() {
    if (!state.linked || polling) return;
    polling = true;
    try {
        const { call } = await api('/api/bitrix/call');
        state.call = call || null;

        if (call && call.callId !== state.seenCallId) {
            state.seenCallId = call.callId;
            showCallToast(call);
            // Карточку подтягиваем сразу — пока оператор здоровается, она уже
            // открыта. Но НЕ поверх недописанного: если в полях есть
            // несохранённые правки, подменять карточку под руками нельзя,
            // человек доведёт разговор и откроет новый лид с уведомления сам.
            if (call.leadId && !isDirty()) openLead(call.leadId);
        }
        if (!call) document.getElementById('lead-call-toast')?.remove();

        // ВАЖНО: опрос обновляет только плашку «идёт звонок», а не всю
        // страницу. Полная перерисовка каждые четыре секунды выбивала курсор
        // из поля прямо во время набора — а набирают тут как раз в разговоре,
        // когда переспросить нельзя.
        renderLive();
    } catch { /* сеть моргнула — попробуем на следующем тике */ } finally {
        polling = false;
    }
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
        state.draft = draftOf(data.lead);
        state.stages = data.stages || [];
        state.sources = data.sources || [];
        loadUsers().then(render);
    } catch (err) {
        state.leadError = err.message || 'не удалось прочитать лид';
    }
    state.leadBusy = false;
    render();
}

function draftOf(lead) {
    return {
        name: lead?.name || '',
        statusId: lead?.statusId || '',
        sourceId: lead?.sourceId || '',
        assignedById: lead?.assignedById ? String(lead.assignedById) : '',
        comments: lead?.comments || '',
    };
}

// Есть ли несохранённые правки. Нужно не для красоты: пока человек печатает,
// подъехавший второй звонок не должен подменить карточку под руками.
function isDirty() {
    if (!state.lead || !state.draft) return false;
    const clean = draftOf(state.lead);
    return Object.keys(clean).some(k => String(clean[k]) !== String(state.draft[k]));
}

async function saveLead(patch) {
    if (!state.lead) return;
    state.leadBusy = true;
    state.leadError = null;
    render();
    try {
        const { lead } = await api(`/api/bitrix/lead/${state.lead.id}`, { method: 'POST', body: patch });
        state.lead = lead;
        state.draft = draftOf(lead);
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
    // Поля показываем из черновика: он и есть то, что человек набрал.
    const d = state.draft || draftOf(lead);
    const callSource = String(d.sourceId || '').toUpperCase() === 'CALL';

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
                <input type="text" id="lead-name" class="lead-input" value="${esc(d.name)}"
                       placeholder="как зовут" ${state.leadBusy ? 'disabled' : ''}/>
            </label>

            <label class="lead-field">
                <span>Стадия</span>
                ${selectHtml('lead-stage', state.stages, d.statusId)}
            </label>

            <label class="lead-field${callSource ? ' lead-field-warn' : ''}">
                <span>Источник</span>
                ${selectHtml('lead-source', state.sources, d.sourceId)}
            </label>
            ${callSource ? '<div class="lead-warn">Источник «Звонок» ставит телефония — выберите настоящий, иначе лид не сохранится.</div>' : ''}

            <label class="lead-field">
                <span>Ответственный</span>
                ${state.users.length
                    ? selectHtml('lead-user', state.users.map(u => ({ id: u.id, name: u.name })), d.assignedById)
                    : `<input type="text" class="lead-input" value="${esc(lead.assignedByName || '')}" disabled/>`}
            </label>

            <label class="lead-field lead-field-wide">
                <span>Комментарий</span>
                <textarea id="lead-comments" class="lead-input lead-textarea" rows="5"
                          placeholder="о чём договорились" ${state.leadBusy ? 'disabled' : ''}>${esc(d.comments)}</textarea>
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

// Плашка «идёт звонок» — единственное, что обновляет опрос. Живёт в своём
// гнезде, чтобы менять её, не трогая поля ввода.
function liveHtml() {
    return state.call
        ? `<div class="lead-live">Идёт звонок — ${esc(formatPhone(state.call.phone))}</div>`
        : '';
}

function renderLive() {
    const slot = document.getElementById('lead-live-slot');
    if (!slot) return;
    const html = liveHtml();
    if (slot.innerHTML !== html) slot.innerHTML = html;
}

function render() {
    if (!root) return;
    if (!state.ready) {
        root.innerHTML = '<div class="lead-empty">проверяю связь с Битриксом…</div>';
        return;
    }

    // Перерисовка бывает и по делу (сохранили, открыли другой лид), а курсор
    // при ней всё равно теряется — возвращаем его туда же, где он был, вместе
    // с положением каретки.
    const focused = document.activeElement;
    const focusId = focused && root.contains(focused) ? focused.id : null;
    const caret = focusId && 'selectionStart' in focused
        ? [focused.selectionStart, focused.selectionEnd] : null;

    root.innerHTML = `
        ${linkHtml()}
        ${state.linked ? `
            <div id="lead-live-slot">${liveHtml()}</div>
            ${leadCardHtml()}
            <h3 class="lead-sec-title">Обращения</h3>
            ${feedHtml()}
            ${checkHtml()}
        ` : ''}`;
    bind();

    if (focusId) {
        const back = root.querySelector(`#${CSS.escape(focusId)}`);
        if (back) {
            back.focus();
            if (caret && 'setSelectionRange' in back) {
                try { back.setSelectionRange(caret[0], caret[1]); } catch { /* не текстовое поле */ }
            }
        }
    }
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

    // Набранное складываем в черновик на каждый символ. Читать значения из
    // полей в момент сохранения нельзя: между набором и нажатием кнопки
    // карточка может перерисоваться (пришёл ответ сервера, закрылся звонок), и
    // тогда в Битрикс уехало бы то, что осталось в DOM, а не то, что человек
    // написал.
    const name = root.querySelector('#lead-name');
    if (name) name.oninput = () => { state.draft.name = name.value; };

    const comments = root.querySelector('#lead-comments');
    if (comments) comments.oninput = () => { state.draft.comments = comments.value; };

    const stage = root.querySelector('#lead-stage');
    if (stage) stage.onchange = () => { state.draft.statusId = stage.value; };

    const user = root.querySelector('#lead-user');
    if (user) user.onchange = () => { state.draft.assignedById = user.value; };

    const source = root.querySelector('#lead-source');
    if (source) {
        source.onchange = () => {
            state.draft.sourceId = source.value;
            // Единственное поле, из-за которого перерисовываем: с него снимается
            // (или на него вешается) предупреждение про «Звонок».
            render();
        };
    }

    const save = root.querySelector('#lead-save');
    if (save) {
        save.onclick = () => saveLead({
            name: (state.draft.name || '').trim(),
            statusId: state.draft.statusId,
            sourceId: state.draft.sourceId,
            assignedById: state.draft.assignedById || undefined,
            comments: state.draft.comments,
        });
    }

    const close = root.querySelector('#lead-close');
    if (close) {
        close.onclick = async () => {
            state.lead = null;
            state.draft = null;
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
                state.draft = draftOf(state.checked.lead);
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
