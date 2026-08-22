// ОТЛОЖЕНО: вкладка «Лиды» выключена, проводка закомментирована
// (см. шапку docs/BITRIX.md). Файл оставлен целиком — возврат делается
// снятием комментариев, а не переписыванием.
// ─────────────────────────────────────────────────────────────────────────────
// Вкладка «Лиды»: лента обращений и карточка клиента во время звонка.
//
// Ради чего всё: оператор принимает звонок, и лид, который Битрикс уже завёл,
// открывается ЗДЕСЬ — сразу редактируемым, из пяти полей, которыми в разговоре
// и пользуются. Без прыжков по вкладкам и без ста кнопок, из которых нужны
// пять.
//
// Страница устроена как ЛЕНТА, а не как страница-инструкция: главное на ней —
// список обращений, карточка открывается рядом с ним (на узком экране — вместо
// него). Всё, что не лид и не список, убрано с глаз: учётка Битрикса живёт в
// кнопке в углу, потому что привязывают её раз в жизни, а место она занимала
// постоянно.
//
// Пока карточка едет из Битрикса, на её месте лежит СКЕЛЕТ той же формы, а
// нажатая строка ленты крутит колесо. Чтение чужого портала занимает секунду и
// больше, и пустое место всё это время читается как «нажал, и ничего не
// произошло».
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

// Иконки — инлайновые SVG, как и везде на сайте: эмодзи ✕ и ↗ каждая ОС рисует
// по-своему, и подогнать их под кнопку 30×30 и под тему нельзя.
const svg = (size, body) =>
    `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"
          stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
          aria-hidden="true">${body}</svg>`;

const ICON = {
    phone: (s = 16) => svg(s, '<path d="M15.5 21A12.5 12.5 0 0 1 3 8.5 2.5 2.5 0 0 1 5.5 6h2L9 9.5 7.2 11a10 10 0 0 0 5.8 5.8L14.5 15l3.5 1.5v2a2.5 2.5 0 0 1-2.5 2.5Z"/>'),
    chevron: (s = 14) => svg(s, '<path d="m6 9 6 6 6-6"/>'),
    close: (s = 16) => svg(s, '<path d="M6 6l12 12M18 6 6 18"/>'),
    back: (s = 16) => svg(s, '<path d="M15 18 9 12l6-6"/>'),
    ext: (s = 16) => svg(s, '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
    plug: (s = 16) => svg(s, '<path d="M9 3v6M15 3v6"/><path d="M6 9h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6V9Z"/><path d="M12 18v3"/>'),
};

const state = {
    ready: false,
    linked: false,
    login: null,
    linkError: null,
    linkBusy: false,
    acctOpen: false,     // раскрыта ли карточка учётки в углу

    call: null,          // открытый звонок с сервера
    seenCallId: null,    // по какому звонку уже показали уведомление
    lead: null,          // view открытой карточки
    draft: null,         // что оператор набрал в форме, но ещё не сохранил
    openingId: null,     // какой лид сейчас читается — под него скелет и колесо
    stages: [],
    sources: [],
    users: [],
    leadBusy: false,
    leadError: null,
    saved: false,

    feed: [],
    feedReady: false,
};

let api = null;
let root = null;
let pollTimer = 0;
let outsideBound = false;

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
        <span class="lead-toast-dot" aria-hidden="true"></span>
        <span class="lead-toast-body">
            <span class="lead-toast-title">Входящий звонок</span>
            <span class="lead-toast-phone">${esc(formatPhone(call.phone))}</span>
            <span class="lead-toast-hint">${call.leadId ? 'нажмите, чтобы открыть карточку' : 'лид ещё не создан'}</span>
        </span>
        <button type="button" class="lead-toast-x" aria-label="Скрыть">${ICON.close(15)}</button>`;
    box.onclick = () => {
        box.remove();
        location.hash = '#/leads';
        if (call.leadId) openLead(call.leadId);
    };
    // Крестик убирает только плашку: звонок при этом идёт дальше, и карточку
    // потом открывают из ленты.
    box.querySelector('.lead-toast-x').onclick = e => { e.stopPropagation(); box.remove(); };
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
            // Карточку подтягиваем сразу: пока оператор здоровается, она уже
            // будет открыта. Но НЕ поверх недописанного: звонок приходит и
            // тогда, когда предыдущий разговор ещё дописывают, а подмена
            // карточки стёрла бы набранное молча. В этом случае остаётся
            // уведомление — по нему на новый лид переходят руками.
            if (call.leadId && !hasUnsavedChanges()) openLead(call.leadId);
            // Ленту перечитываем следом — новое обращение должно появиться в
            // списке само.
            loadFeed().then(render);
        }
        if (!call) document.getElementById('lead-call-toast')?.remove();

        // ВАЖНО: опрос обновляет ТОЛЬКО плашку «идёт звонок», в своём гнезде, а
        // не всю страницу. Полная перерисовка каждые три секунды выбивала
        // курсор из поля прямо во время набора — а набирают тут как раз в
        // разговоре, когда переспросить нельзя.
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
        // «Войдите в Битрикс» — это не поломка, а первый заход: краснеть тут
        // нечему, форма входа и так на экране. Красным показываем только то, о
        // чём человеку правда надо знать: капчу, отказ по паролю, подтверждение
        // по телефону.
        state.linkError = st.loggedIn || !st.reason || st.reason === 'bitrix_auth_required'
            ? null
            : (st.message || null);
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
    state.feedReady = true;
}

async function loadUsers() {
    if (state.users.length) return;
    try {
        const { users } = await api('/api/bitrix/users');
        state.users = users || [];
    } catch { /* выпадашка ответственного останется с одним текущим */ }
}

async function openLead(id) {
    const leadId = String(id);
    // Старую карточку убираем сразу: показывать чужие поля, пока едут новые, —
    // это дать оператору дописать комментарий не тому клиенту.
    state.openingId = leadId;
    state.lead = null;
    state.draft = null;
    state.leadBusy = true;
    state.leadError = null;
    state.saved = false;
    render();
    try {
        const data = await api(`/api/bitrix/lead/${leadId}`);
        // Пока читали, оператор мог нажать другое обращение — тогда ответ уже
        // не нужен, и подменять им открытую карточку нельзя.
        if (state.openingId !== leadId) return;
        state.lead = data.lead;
        state.stages = data.stages || [];
        state.sources = data.sources || [];
        state.draft = draftOf(data.lead);
        loadUsers().then(() => { if (state.openingId === leadId) render(); });
    } catch (err) {
        if (state.openingId !== leadId) return;
        state.leadError = err.message || 'не удалось прочитать лид';
    }
    state.leadBusy = false;
    render();
}

// Форма живёт отдельным черновиком, а не читается из DOM в момент сохранения:
// страницу перерисовывает и опрос звонка, и приход справочника сотрудников, а
// набранный текст должен это переживать.
function draftOf(lead) {
    return {
        id: lead.id,
        name: lead.name || '',
        statusId: lead.statusId || '',
        sourceId: lead.sourceId || '',
        assignedById: lead.assignedById == null ? '' : String(lead.assignedById),
        comments: lead.comments || '',
    };
}

// Есть ли в форме то, чего ещё нет в Битриксе. Нужно ровно в одном месте: не
// подменять открытую карточку новым звонком, пока в ней недописано.
function hasUnsavedChanges() {
    if (!state.lead || !state.draft) return false;
    const saved = draftOf(state.lead);
    return Object.keys(saved).some(key => String(saved[key]) !== String(state.draft[key]));
}

function closeLead() {
    state.lead = null;
    state.draft = null;
    state.openingId = null;
    state.leadError = null;
    state.saved = false;
}

async function saveLead() {
    if (!state.lead || !state.draft) return;
    const d = state.draft;
    state.leadBusy = true;
    state.leadError = null;
    render();
    try {
        const { lead } = await api(`/api/bitrix/lead/${state.lead.id}`, {
            method: 'POST',
            body: {
                name: d.name.trim(),
                statusId: d.statusId,
                sourceId: d.sourceId,
                assignedById: d.assignedById || undefined,
                comments: d.comments,
            },
        });
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

// ── Мелочи разметки ──────────────────────────────────────────────────────────

function formatPhone(raw) {
    const d = String(raw || '').replace(/\D+/g, '');
    if (d.length === 11) return `+${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
    return raw || '';
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

// Цвет кружка с буквой — от номера лида, а не случайный: один и тот же клиент
// в ленте и в карточке должен быть одного цвета, иначе кружок ничего не
// подсказывает. Светлота и насыщенность берутся из темы (--ava-l/--ava-c),
// поэтому на белом фоне буква не выцветает.
function hueOf(id) {
    const s = String(id ?? '');
    let h = 7;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
}

function avatarHtml({ id, name }, big = false) {
    const letter = String(name || '').trim().slice(0, 1).toUpperCase();
    return `<span class="lead-ava${big ? ' lead-ava-lg' : ''}" style="--h:${hueOf(id)}" aria-hidden="true">${
        letter ? esc(letter) : ICON.phone(big ? 22 : 15)}</span>`;
}

function selectHtml(id, list, current, disabled) {
    const options = list.map(item =>
        `<option value="${esc(item.id)}"${String(item.id) === String(current) ? ' selected' : ''}>${esc(item.name)}</option>`);
    // Значения, которого нет в справочнике, не теряем: молча подменить стадию
    // на первую попавшуюся — это испортить лид.
    if (current && !list.some(i => String(i.id) === String(current))) {
        options.unshift(`<option value="${esc(current)}" selected>${esc(current)}</option>`);
    }
    return `<select id="${id}" class="lead-input lead-select"${disabled ? ' disabled' : ''}>${options.join('')}</select>`;
}

// ── Учётка Битрикса ──────────────────────────────────────────────────────────

function acctHtml() {
    // Кнопка в углу — ТОЛЬКО у привязанного. Пока привязки нет, вкладка и так
    // состоит из одной карточки со входом, и вторая точка входа рядом с ней
    // только заставляет выбирать, куда нажать.
    if (!state.linked) return '';
    return `
        <div class="lead-acct">
            <button type="button" class="lead-acct-btn" id="lead-acct-toggle"
                    aria-expanded="${state.acctOpen ? 'true' : 'false'}">
                <span class="lead-acct-dot" aria-hidden="true"></span>
                <span class="lead-acct-name">${esc(state.login || 'Битрикс подключён')}</span>
                ${ICON.chevron()}
            </button>
            ${state.acctOpen ? `<div class="lead-acct-pop">
                <div class="lead-acct-row">
                    <span class="lead-acct-cap">Учётка Битрикса</span>
                    <b>${esc(state.login || '')}</b>
                </div>
                <p class="lead-acct-note">Карточки читаются и сохраняются от этого имени.</p>
                <button class="btn lead-acct-unlink" id="lead-unlink">Отвязать</button>
            </div>` : ''}
        </div>`;
}

// Вход в Битрикс. Живёт в карточке на месте лида, а не в форме наверху
// страницы: пока учётки нет, показывать больше нечего.
function linkCardHtml() {
    return `
        <div class="lead-idle lead-idle-link">
            <span class="lead-idle-icon">${ICON.plug(26)}</span>
            <div class="lead-idle-title">Подключите Битрикс</div>
            <p class="lead-idle-note">Тогда карточка клиента будет открываться сама на входящем звонке.</p>
            ${state.linkError ? `<div class="edit-error">${esc(state.linkError)}</div>` : ''}
            <form id="lead-link-form" class="lead-acct-form" autocomplete="off">
                <input type="text" id="lead-login" class="lead-input" placeholder="почта Битрикса"
                       autocomplete="username" value="${esc(state.login || '')}" ${state.linkBusy ? 'disabled' : ''}/>
                <input type="password" id="lead-password" class="lead-input" placeholder="пароль"
                       autocomplete="current-password" ${state.linkBusy ? 'disabled' : ''}/>
                <button class="btn btn-pri" type="submit" ${state.linkBusy ? 'disabled' : ''}>
                    ${state.linkBusy ? 'вхожу…' : 'Привязать'}
                </button>
            </form>
            <p class="lead-acct-note">Пароль хранится зашифрованным и вводится один раз. Вводи внимательно:
                после нескольких промахов Битрикс включает капчу, и вход встанет и в браузере тоже.</p>
        </div>`;
}

// ── Лента ────────────────────────────────────────────────────────────────────

function feedHtml() {
    // Пока лента не пришла — строки-скелеты. Пустое место в этот момент
    // читается как «обращений нет», а это разные вещи.
    if (!state.feedReady) {
        return `<div class="lead-rows">${'<div class="lead-row lead-row-skel"></div>'.repeat(4)}</div>`;
    }
    if (!state.feed.length) {
        return `<div class="lead-note-empty">Обращений пока нет — они появятся после первого звонка.</div>`;
    }
    return `<div class="lead-rows">${state.feed.map(row => {
        const opening = String(row.leadId) === String(state.openingId) && !state.lead;
        const active = state.lead && String(row.leadId) === String(state.lead.id);
        return `
        <button type="button" class="lead-row${active ? ' is-active' : ''}${opening ? ' is-loading' : ''}${row.unfilled ? ' is-unfilled' : ''}"
                data-lead="${esc(row.leadId)}">
            ${avatarHtml({ id: row.leadId, name: row.name })}
            <span class="lead-row-main">
                <span class="lead-row-phone">${esc(formatPhone(row.phone) || row.title || `Лид №${row.leadId}`)}</span>
                <span class="lead-row-name">${esc(row.name || 'имя не записано')}</span>
            </span>
            <span class="lead-row-side">
                <span class="lead-row-when">${opening ? '<span class="lead-spin"></span>' : esc(whenText(row.seenAt))}</span>
                ${row.unfilled ? '<span class="lead-row-flag">не заполнено</span>' : ''}
            </span>
        </button>`;
    }).join('')}</div>`;
}

// ── Карточка ─────────────────────────────────────────────────────────────────

// Скелет повторяет ФОРМУ карточки, а не «крутилку по центру»: место, куда
// приедут поля, видно заранее, и переход в готовую карточку не дёргает страницу.
function skeletonHtml() {
    const field = '<div class="lead-skel-field"><span class="sk sk-cap"></span><span class="sk sk-box"></span></div>';
    return `
        <article class="lead-card lead-card-skel" aria-busy="true">
            <header class="lead-card-head">
                <span class="sk sk-ava"></span>
                <span class="lead-card-id">
                    <span class="sk sk-line sk-wide"></span>
                    <span class="sk sk-line sk-narrow"></span>
                </span>
            </header>
            <div class="lead-fields">${field.repeat(4)}
                <div class="lead-skel-field lead-field-wide">
                    <span class="sk sk-cap"></span><span class="sk sk-box sk-tall"></span>
                </div>
            </div>
            <div class="lead-skel-hint"><span class="lead-spin"></span>читаю карточку в Битриксе…</div>
        </article>`;
}

function idleHtml() {
    return `
        <div class="lead-idle">
            <span class="lead-idle-icon">${ICON.phone(24)}</span>
            <div class="lead-idle-title">Ждём звонок</div>
            <p class="lead-idle-note">Карточка откроется сама. Или выберите обращение из списка.</p>
        </div>`;
}

function leadCardHtml() {
    if (state.leadBusy && !state.lead) return skeletonHtml();
    if (!state.lead) {
        return state.leadError
            ? `<div class="lead-idle"><div class="lead-idle-title">Карточка не открылась</div>
                 <p class="lead-idle-note">${esc(state.leadError)}</p></div>`
            : idleHtml();
    }

    const lead = state.lead;
    const d = state.draft;
    const dis = state.leadBusy ? ' disabled' : '';
    // Пока источник «Звонок», сохранение не пройдёт (правило компании, см.
    // backend/src/bitrix/leads.js) — и узнать об этом надо ДО нажатия кнопки.
    const callSource = String(d.sourceId || '').toUpperCase() === 'CALL';
    const phone = formatPhone(lead.phones?.[0]);
    const meta = [lead.name || null, `Лид №${lead.id}`].filter(Boolean).join(' · ');

    return `
        <article class="lead-card">
            <header class="lead-card-head">
                ${avatarHtml({ id: lead.id, name: lead.name }, true)}
                <div class="lead-card-id">
                    <div class="lead-card-phone">${phone
                        ? `<a href="tel:${esc(String(lead.phones[0]).replace(/[^\d+]/g, ''))}">${esc(phone)}</a>`
                        : esc(lead.title || `Лид №${lead.id}`)}</div>
                    <div class="lead-card-meta">${esc(meta)}</div>
                </div>
                <div class="lead-card-tools">
                    <a class="lead-icon-btn" title="Открыть в Битриксе" aria-label="Открыть в Битриксе"
                       href="https://spotexpress.bitrix24.ru/crm/lead/details/${esc(lead.id)}/"
                       target="_blank" rel="noopener">${ICON.ext()}</a>
                    <button type="button" class="lead-icon-btn" id="lead-close"
                            title="Закрыть карточку" aria-label="Закрыть карточку">${ICON.close()}</button>
                </div>
            </header>

            ${lead.sourceNote ? `<div class="lead-card-note">${esc(lead.sourceNote)}</div>` : ''}

            <div class="lead-fields">
                <label class="lead-field">
                    <span class="lead-lbl">Имя клиента</span>
                    <input type="text" id="lead-name" class="lead-input" value="${esc(d.name)}"
                           placeholder="как зовут"${dis}/>
                </label>

                <label class="lead-field">
                    <span class="lead-lbl">Стадия</span>
                    ${selectHtml('lead-stage', state.stages, d.statusId, state.leadBusy)}
                </label>

                <label class="lead-field${callSource ? ' is-warn' : ''}">
                    <span class="lead-lbl">Источник</span>
                    ${selectHtml('lead-source', state.sources, d.sourceId, state.leadBusy)}
                    ${callSource ? '<span class="lead-warn">«Звонок» ставит телефония — выберите настоящий, иначе лид не сохранится.</span>' : ''}
                </label>

                <label class="lead-field">
                    <span class="lead-lbl">Ответственный</span>
                    ${state.users.length
                        ? selectHtml('lead-user', state.users.map(u => ({ id: u.id, name: u.name })), d.assignedById, state.leadBusy)
                        : `<input type="text" class="lead-input" value="${esc(lead.assignedByName || '')}" disabled/>`}
                </label>

                <label class="lead-field lead-field-wide">
                    <span class="lead-lbl">Комментарий</span>
                    <textarea id="lead-comments" class="lead-input lead-textarea" rows="4"
                              placeholder="о чём договорились"${dis}>${esc(d.comments)}</textarea>
                </label>
            </div>

            ${state.leadError ? `<div class="edit-error">${esc(state.leadError)}</div>` : ''}

            <footer class="lead-foot">
                <button class="btn btn-pri" id="lead-save"${dis}>
                    ${state.leadBusy ? 'сохраняю…' : 'Сохранить в Битрикс'}
                </button>
                ${state.saved ? '<span class="lead-saved">сохранено</span>' : ''}
            </footer>
        </article>`;
}

// ── Сборка страницы ──────────────────────────────────────────────────────────

// Плашка «идёт звонок» — единственное, что обновляет опрос. Живёт в своём
// гнезде, чтобы менять её, не трогая поля ввода.
function liveHtml() {
    return state.call
        ? `<div class="lead-live"><span class="lead-live-dot"></span>Идёт звонок — ${esc(formatPhone(state.call.phone))}</div>`
        : '';
}

function renderLive() {
    const slot = document.getElementById('lead-live-slot');
    if (!slot) return;
    const html = liveHtml();
    if (slot.innerHTML !== html) slot.innerHTML = html;
}

// Перерисовка бывает и по делу (сохранили, открыли другой лид, приехал
// справочник сотрудников), а курсор при ней всё равно теряется — возвращаем
// его туда же, где он был, вместе с положением каретки.
function render() {
    if (!root) return;
    const focused = document.activeElement;
    const focusId = focused && root.contains(focused) ? focused.id : null;
    const caret = focusId && 'selectionStart' in focused
        ? [focused.selectionStart, focused.selectionEnd] : null;

    paint();

    if (!focusId) return;
    const back = root.querySelector(`#${CSS.escape(focusId)}`);
    if (!back) return;
    back.focus();
    if (caret && 'setSelectionRange' in back) {
        try { back.setSelectionRange(caret[0], caret[1]); } catch { /* не текстовое поле */ }
    }
}

function paint() {
    if (!state.ready) {
        root.innerHTML = `<div class="lead-boot"><span class="lead-spin"></span>проверяю связь с Битриксом…</div>`;
        return;
    }

    if (!state.linked) {
        root.innerHTML = `<div class="lead-solo">${linkCardHtml()}</div>`;
        bind();
        return;
    }

    const open = Boolean(state.lead || state.leadBusy || state.leadError);
    root.innerHTML = `
        <div class="lead-bar">
            <div id="lead-live-slot" class="lead-live-slot">${liveHtml()}</div>
            ${acctHtml()}
        </div>
        <div class="lead-cols${open ? ' is-open' : ''}">
            <section class="lead-list">
                <div class="lead-list-head">
                    <h3 class="lead-sec-title">Обращения</h3>
                    ${state.feed.length ? `<span class="lead-count">${state.feed.length}</span>` : ''}
                </div>
                ${feedHtml()}
            </section>
            <section class="lead-pane">
                ${open ? `<button type="button" class="lead-back" id="lead-back">${ICON.back()}Все обращения</button>` : ''}
                ${leadCardHtml()}
            </section>
        </div>`;
    bind();
}

// Какие поля формы куда кладутся в черновик.
const FIELD_KEYS = {
    'lead-name': 'name',
    'lead-stage': 'statusId',
    'lead-source': 'sourceId',
    'lead-user': 'assignedById',
    'lead-comments': 'comments',
};

function bind() {
    const acct = root.querySelector('#lead-acct-toggle');
    if (acct) {
        acct.onclick = () => {
            state.acctOpen = !state.acctOpen;
            render();
            root.querySelector('#lead-login')?.focus();
        };
    }

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
                state.acctOpen = false;
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
                state.acctOpen = false;
                state.feed = [];
                closeLead();
            } catch (err) {
                state.linkError = err.message;
            }
            render();
        };
    }

    // Форма пишется в черновик на каждый ввод: перерисовка от звонка или от
    // приехавшего справочника сотрудников не должна стирать набранное.
    const fields = root.querySelector('.lead-fields');
    if (fields && state.draft) {
        const put = e => {
            const key = FIELD_KEYS[e.target.id];
            if (key) state.draft[key] = e.target.value;
        };
        fields.oninput = put;
        fields.onchange = e => {
            put(e);
            // Предупреждение про источник «Звонок» должно гаснуть сразу, как
            // выбрали настоящий, — а это перерисовка.
            if (e.target.id === 'lead-source') render();
        };
    }

    const save = root.querySelector('#lead-save');
    if (save) save.onclick = () => saveLead();

    const closers = [root.querySelector('#lead-close'), root.querySelector('#lead-back')].filter(Boolean);
    for (const btn of closers) {
        btn.onclick = async () => {
            closeLead();
            state.call = null;
            document.getElementById('lead-call-toast')?.remove();
            render();
            try { await api('/api/bitrix/call/close', { method: 'POST', body: {} }); } catch { /* не критично */ }
        };
    }

    root.querySelectorAll('[data-lead]').forEach(btn => {
        btn.onclick = () => openLead(btn.dataset.lead);
    });
}

export function initLeadsPage({ apiFetch }) {
    api = apiFetch;
    root = document.getElementById('leads-body');
    if (!root) return;

    // Клик мимо карточки учётки закрывает её — как ведёт себя любое меню.
    if (!outsideBound) {
        outsideBound = true;
        document.addEventListener('click', e => {
            if (!state.acctOpen || !root) return;
            if (e.target.closest?.('.lead-acct')) return;
            state.acctOpen = false;
            render();
        });
    }

    render();
    if (!state.ready) loadLink().then(() => { render(); loadFeed().then(render); });
    else loadFeed().then(render);
}
