// ─────────────────────────────────────────────────────────────────────────────
// Режим «Клиент» на главной: поиск человека в CRM по телефону или гос. номеру и
// ОДНА карточка на весь его след в базе — имя, баллы, машины и все чеки.
//
// Зачем это здесь, если CRM и так открыта в соседней вкладке: в самой CRM
// путь до «что этому клиенту делали» — четыре страницы, и КАЖДЫЙ чек это
// отдельная ссылка, которая грузится секундами. Оператор с трубкой в руке
// столько не ждёт. Сайт обходит чеки САМ, фоном и по одному, а до готовности
// показывает на их месте плейсхолдеры: список обслуживаний виден сразу, а
// содержимое дозаполняется на глазах.
//
// Обходятся при этом только ПОКАЗАННЫЕ обслуживания (SALES_PAGE): у постоянного
// клиента чеков под полсотни, очередь к CRM последовательная, и «прочекать
// всё» — это минута ожидания ради строк, до которых разговор не дойдёт.
//
// ВСЕ значки тут — SVG (ICON ниже), эмодзи нет ни одного и быть не должно.
// Причина та же, что в сапёре и морском бое: эмодзи рисует операционная
// система, в каждой по-своему, и подогнать его под размер строки, под тему и
// под цвет (значок оплаты берёт цвет строки через currentColor) нельзя никак.
//
// Разбор страниц CRM и маски ввода — shared/crmClients.js (там же тесты).
// Сеть — backend/src/routes/crm.js под персональной сессией работника, поэтому
// тут возможен ответ «нет сессии CRM»: на него показываем маленькую форму
// входа, а не отсылаем человека на страницу машины за панелью наличия.
// ─────────────────────────────────────────────────────────────────────────────

import './clientSearch.css';
import {
    formatPhoneInput, formatPlateInput, phoneComplete, plateComplete, phoneDigits,
    maskedFieldEdit,
} from '../../shared/crmClients.js';
import { initSelects } from './select.js';

// Чеки добираются по одному, но не по очереди из одного соединения: очередь к
// CRM всё равно последовательная (backend/src/crm/client.js), а три запроса в
// полёте прячут накладные расходы HTTP и заполняют список заметно ровнее.
const PREFETCH_WORKERS = 3;
// Пауза перед автопоиском по набранному номеру.
const AUTO_SEARCH_DELAY_MS = 350;
// Сколько обслуживаний показываем сразу и сколько добавляет «показать ещё».
// Ограничение не про длину списка, а про походы в CRM: у постоянного клиента
// чеков бывает под полсотни, очередь к CRM последовательная, и обход всех
// занимал минуту — при том, что разговор идёт про последний визит. Чеки
// добираются только у ПОКАЗАННЫХ строк, и «показать ещё» дозаказывает их.
const SALES_PAGE = 8;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SEARCH_KINDS = [
    { id: 'phone', label: 'Телефон',   placeholder: '+7 (___) ___-__-__', hint: 'Номер, с которого звонят' },
    { id: 'plate', label: 'Гос. номер', placeholder: 'х111хх111',        hint: 'Номер машины, как на знаке' },
];

// ── Форматирование ───────────────────────────────────────────────────────────

// Копейки показываем, только если они есть: «2 416 ₽» читается быстрее, чем
// «2 416,00 ₽», а у баллов дробная часть как раз бывает.
function money(value) {
    if (value == null || !Number.isFinite(value)) return '—';
    const rounded = Math.round(value * 100) / 100;
    const text = Number.isInteger(rounded)
        ? String(rounded)
        : rounded.toFixed(2).replace('.', ',');
    return text.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
}

// Пробег разряжаем так же, как деньги: «99000 км» глазом не читается.
function km(value) {
    return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' км';
}

function points(value) {
    if (value == null || !Number.isFinite(value)) return '0';
    const rounded = Math.round(value * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace('.', ',');
}

// «28.07.2026 19:34:32» → { date: '28.07.2026', time: '19:34' }
function splitStamp(stamp) {
    const m = String(stamp || '').match(/([\d.]{8,10})(?:\s+(\d{2}:\d{2}))?/);
    return { date: m ? m[1] : '', time: m && m[2] ? m[2] : '' };
}

// Телефон из CRM приходит как «79819651916» — показываем его человеческим.
// Но только если это действительно мобильный из десяти цифр: в базе попадаются
// городские и обрезанные номера, и натянутая на них маска +7 (…) соврала бы.
function prettyPhone(raw) {
    return phoneComplete(raw) ? formatPhoneInput(raw) : String(raw || '');
}

// tel: только для полного номера — по половине номера всё равно не позвонить.
function telHref(raw) {
    return phoneComplete(raw) ? 'tel:+7' + phoneDigits(raw) : '';
}

function plural(n, one, few, many) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
}

// Год чека — по нему список обслуживаний делится на группы.
const yearOf = (stamp) => (String(stamp || '').match(/\.(\d{4})\b/) || [])[1] || '';

// Станция в CRM — это адрес, вписанный руками, и у части точек он записан
// полным административным именем: «деревня Новосаратовка Свердловское
// городское поселение 267А». В строку обслуживания это не помещается никак —
// а узнают точку по названию улицы и дому, а не по типу поселения. Выкидываем
// СЛУЖЕБНЫЕ слова, не трогая имена: полный адрес остаётся в подсказке (title),
// и если после чистки не осталось ничего — показываем как есть.
// Слова выкидываются ПОТОКЕНОВО, а не регуляркой с \b: границы слова в JS
// считаются по латинице, и /\bдеревня\b/ не совпадает вовсе.
const STATION_NOISE = new Set([
    'деревня', 'дер', 'село', 'посёлок', 'поселок', 'пос', 'город', 'г',
    'городское', 'сельское', 'поселение', 'округ', 'микрорайон', 'мкр',
    'улица', 'ул', 'проспект', 'пр-т', 'переулок', 'пер',
]);

function shortStation(name) {
    const raw = String(name || '').trim();
    const cut = raw.split(/\s+/)
        .filter(w => !STATION_NOISE.has(w.toLowerCase().replace(/\.$/, '')))
        .join(' ')
        .trim();
    return cut || raw;
}

// То же самое с названием позиции, но только в ОДНОЙ строке обслуживания:
// «3711 Моторное масло …» и «Услуги SPOT Замена масла» — это артикул и название
// прайса, одинаковые у всех строк, и в свёрнутом виде они съедают место у того
// единственного, что отличает чеки друг от друга. В раскрытом чеке позиции
// остаются как есть: артикул оператору иногда нужен вслух.
function shortItem(name) {
    const cut = String(name || '')
        .replace(/^\s*\d{3,7}\s+/, '')
        .replace(/^\s*услуги\s+spot\s+/i, '')
        .trim();
    if (!cut) return String(name || '');
    return cut[0].toUpperCase() + cut.slice(1);
}

// ── Иконки ───────────────────────────────────────────────────────────────────

const ICON = {
    chevron: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    card: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2.5"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
    cash: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/></svg>',
    retry: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 5 21 11 15 11"/><path d="M20 15a8 8 0 1 1-2.2-8.3L21 9"/></svg>',
};

// ── Разметка кусочков карточки ───────────────────────────────────────────────

// Номер рисуем НАСТОЯЩИМ знаком (буквы, цифры, регион в отдельном поле), а не
// строкой текста: оператор сверяет его с тем, что ему диктуют в трубку, и
// привычная форма читается быстрее любого моноширинного шрифта.
function plateHtml(plate) {
    const p = formatPlateInput(plate);
    if (!p) return '';
    const main = p.slice(0, 6);
    const region = p.slice(6);
    return `<span class="cs-plate"><span class="cs-plate-main">${esc(main)}</span>`
        + `<span class="cs-plate-region">${esc(region)}</span></span>`;
}

function skeletonSale() {
    return `
        <div class="cs-svc-skel">
            <span class="sk sk-line" style="width: 34%"></span>
            <span class="sk sk-line" style="width: 22%"></span>
            <span class="sk sk-line" style="width: 15%"></span>
        </div>`;
}

// ── Модуль ───────────────────────────────────────────────────────────────────

export function initClientSearch({ apiFetch }) {
    initSelects();   // свои выпадающие списки вместо нативных, см. select.js
    const root = document.getElementById('client-search');
    if (!root) return { activate() {}, deactivate() {} };

    const state = {
        kind: 'phone',
        value: '',
        kindOpen: false,
        stage: 'idle',      // idle | searching | list | client | empty | error | auth
        error: '',
        authNote: '',
        loggingIn: false,
        clients: [],        // найдено больше одного — показываем выбор
        client: null,       // разобранная карточка
        sales: new Map(),   // saleId → { status: 'load'|'ok'|'error', sale, message }
        open: new Set(),    // раскрытые чеки
        shown: SALES_PAGE,  // сколько обслуживаний показано (и, значит, заказано в CRM)
    };
    // Каждый новый поиск/клиент отменяет предыдущий: ответы старого запроса
    // приходят и после ухода с карточки, и рисовать их нельзя.
    let token = 0;

    // Поле — та же «таблетка» с лупой слева, что и главный поиск (.search-box в
    // style.css): режимы одной строки поиска не должны выглядеть как разные
    // сайты. Кнопки «найти» тут поэтому нет — как и там, ищем сами, едва номер
    // набран целиком.
    root.innerHTML = `
        <div class="cs-bar">
            <input class="cs-input" id="cs-input" type="text" autocomplete="off" spellcheck="false"
                   inputmode="tel" aria-label="Что ищем">
            <div class="cs-kind" id="cs-kind">
                <button type="button" class="cs-kind-btn" id="cs-kind-btn"></button>
                <div class="cs-kind-list hidden" id="cs-kind-list"></div>
            </div>
        </div>
        <div class="cs-body" id="cs-body"></div>`;

    const kindBtn = root.querySelector('#cs-kind-btn');
    const kindList = root.querySelector('#cs-kind-list');
    const input = root.querySelector('#cs-input');
    const body = root.querySelector('#cs-body');

    // ── Строка поиска ─────────────────────────────────────────────────────────

    const currentKind = () => SEARCH_KINDS.find(k => k.id === state.kind) || SEARCH_KINDS[0];
    const complete = () => (state.kind === 'phone' ? phoneComplete(state.value) : plateComplete(state.value));

    function renderBar() {
        const kind = currentKind();
        kindBtn.innerHTML = `<span>${esc(kind.label)}</span>${ICON.chevron}`;
        kindBtn.setAttribute('aria-expanded', String(state.kindOpen));
        kindList.classList.toggle('hidden', !state.kindOpen);
        kindList.innerHTML = SEARCH_KINDS.map(k => `
            <button type="button" class="cs-kind-opt${k.id === state.kind ? ' active' : ''}" data-kind="${k.id}">
                <span class="cs-kind-opt-label">${esc(k.label)}</span>
                <span class="cs-kind-opt-hint">${esc(k.hint)}</span>
            </button>`).join('');
        input.placeholder = kind.placeholder;
        input.inputMode = kind.id === 'phone' ? 'tel' : 'text';
        input.classList.toggle('cs-input-plate', kind.id === 'plate');
    }

    function setKind(id) {
        if (state.kind !== id) {
            state.kind = id;
            state.value = '';
            input.value = '';
        }
        state.kindOpen = false;
        renderBar();
        input.focus();
    }

    // stopPropagation тут обязателен, и причина неочевидная: renderBar()
    // перерисовывает саму кнопку, поэтому к моменту, когда клик доходит до
    // document, e.target уже выброшен из DOM — и проверка «клик внутри
    // выпадашки» ниже считает его чужим и закрывает список сразу же.
    kindBtn.onclick = (e) => {
        e.stopPropagation();
        state.kindOpen = !state.kindOpen;
        renderBar();
    };
    kindList.onclick = (e) => {
        e.stopPropagation();
        const opt = e.target.closest('.cs-kind-opt');
        if (opt) setKind(opt.dataset.kind);
    };
    document.addEventListener('click', () => {
        if (state.kindOpen) { state.kindOpen = false; renderBar(); }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && state.kindOpen) { state.kindOpen = false; renderBar(); }
    });

    // Маска ставится на КАЖДУЮ правку, включая вставку из буфера и удаление:
    // номер копируют из CRM и из мессенджера в самых разных видах, а Backspace
    // по дорисованной скобке иначе выглядит как «поле не стирается»
    // (maskedFieldEdit в shared/crmClients.js — там же и тесты).
    input.addEventListener('input', (e) => {
        const type = String(e.inputType || '');
        const next = maskedFieldEdit(state.kind, {
            value: input.value,
            caret: input.selectionStart,
            deleting: type.startsWith('deleteContent')
                ? (type.endsWith('Forward') ? 'forward' : 'back')
                : null,
            previous: state.value,
        });
        input.value = next.value;
        input.setSelectionRange(next.caret, next.caret);
        state.value = next.value;
        autoSearch();
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });

    // Кнопки «найти» нет — ищем, как только номер набран целиком. Пауза нужна
    // не для красоты: последнюю цифру часто исправляют сразу же, а каждый заход
    // — это поход в CRM через общую очередь.
    let autoTimer = null;
    let lastAuto = '';
    function autoSearch() {
        clearTimeout(autoTimer);
        if (!complete()) { lastAuto = ''; return; }
        if (state.value === lastAuto) return; // уже искали ровно это
        const value = state.value;
        autoTimer = setTimeout(() => {
            if (state.value !== value) return;
            lastAuto = value;
            runSearch();
        }, AUTO_SEARCH_DELAY_MS);
    }

    // ── Поиск ─────────────────────────────────────────────────────────────────

    async function runSearch() {
        if (!complete()) {
            input.focus();
            return;
        }
        const mine = ++token;
        state.stage = 'searching';
        state.error = '';
        state.client = null;
        state.clients = [];
        state.sales = new Map();
        state.open = new Set();
        state.shown = SALES_PAGE;
        render();
        const q = state.kind === 'phone' ? 'phone' : 'plate';
        try {
            const resp = await apiFetch(`/api/crm/clients?${q}=${encodeURIComponent(state.value)}`);
            if (mine !== token) return;
            state.clients = resp.clients || [];
            if (!state.clients.length) {
                state.stage = 'empty';
                render();
            } else if (state.clients.length === 1) {
                // Один найденный — сразу карточка: промежуточный список из
                // одной строки это лишний клик и лишняя секунда.
                openClient(state.clients[0].id);
            } else {
                state.stage = 'list';
                render();
            }
        } catch (e) {
            if (mine !== token) return;
            failed(e);
        }
    }

    async function openClient(id) {
        const mine = ++token;
        state.stage = 'searching';
        state.client = null;
        state.sales = new Map();
        state.open = new Set();
        state.shown = SALES_PAGE;
        render();
        try {
            const resp = await apiFetch('/api/crm/clients/' + encodeURIComponent(id));
            if (mine !== token) return;
            state.client = resp.client;
            state.stage = 'client';
            render();
            prefetchSales(mine);
        } catch (e) {
            if (mine !== token) return;
            failed(e);
        }
    }

    // Обход чеков: тот самый «сайт сам всё прочекал». Идёт фоном и НЕ мешает
    // смотреть карточку — список уже нарисован, приезжает только содержимое.
    //
    // Заказываем ТОЛЬКО показанные строки: обойти полсотни чеков через
    // последовательную очередь CRM — это минута, за которую оператор уже
    // положил трубку. «Показать ещё» вызывает этот же обход для добавленных.
    async function prefetchSales(mine) {
        const queue = visibleSales().map(s => s.id).filter(id => !state.sales.has(id));
        for (const id of queue) state.sales.set(id, { status: 'load' });
        const worker = async () => {
            while (queue.length) {
                if (mine !== token) return;
                const id = queue.shift();
                try {
                    const resp = await apiFetch('/api/crm/sales/' + encodeURIComponent(id));
                    if (mine !== token) return;
                    state.sales.set(id, { status: 'ok', sale: resp.sale });
                } catch (e) {
                    if (mine !== token) return;
                    // Один упавший чек не должен рвать обход остальных: у
                    // строки появится «не загрузилось» и кнопка повтора.
                    if (e.code === 'crm_auth_required') { failed(e); return; }
                    state.sales.set(id, { status: 'error', message: e.message });
                }
                refreshSale(id);
            }
        };
        await Promise.all(Array.from({ length: PREFETCH_WORKERS }, worker));
    }

    async function retrySale(id) {
        const mine = token;
        state.sales.set(id, { status: 'load' });
        refreshSale(id);
        try {
            const resp = await apiFetch('/api/crm/sales/' + encodeURIComponent(id));
            if (mine !== token) return;
            state.sales.set(id, { status: 'ok', sale: resp.sale });
        } catch (e) {
            if (mine !== token) return;
            state.sales.set(id, { status: 'error', message: e.message });
        }
        refreshSale(id);
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
            render();
            runSearch();
        } catch (e) {
            state.loggingIn = false;
            state.authNote = e.message || 'Не удалось войти в CRM';
            render();
        }
    }

    // ── Рендер ────────────────────────────────────────────────────────────────

    function render() {
        renderBar();
        if (state.stage === 'idle')      body.innerHTML = viewIdle();
        else if (state.stage === 'searching') body.innerHTML = viewSearching();
        else if (state.stage === 'empty')     body.innerHTML = viewEmpty();
        else if (state.stage === 'error')     body.innerHTML = viewError();
        else if (state.stage === 'auth')      body.innerHTML = viewAuth();
        else if (state.stage === 'list')      body.innerHTML = viewList();
        else if (state.stage === 'client')    body.innerHTML = viewClient();
        bind();
    }

    // Пустой экран до поиска — это и есть «ничего не найдено ещё»: плашка с
    // объяснением, что тут делать, висела бы под полем всё время, а прочитали
    // бы её один раз. Что вводить, написано в самом поле подсказкой.
    const viewIdle = () => '';

    function viewSearching() {
        return `
            <div class="cs-card cs-card-skel">
                <div class="cs-head">
                    <span class="sk cs-ava-sk"></span>
                    <div class="cs-head-main">
                        <span class="sk sk-line sk-wide"></span>
                        <span class="sk sk-line sk-narrow"></span>
                    </div>
                </div>
                <div class="cs-stats">
                    ${'<div class="cs-stat"><span class="sk sk-line cs-stat-sk"></span></div>'.repeat(4)}
                </div>
                <div class="cs-svc-list">${skeletonSale()}${skeletonSale()}${skeletonSale()}</div>
            </div>`;
    }

    function viewEmpty() {
        const what = state.kind === 'phone' ? 'этим телефоном' : 'этим номером';
        return `
            <div class="cs-note cs-note-empty">
                <div class="cs-note-title">Ничего не найдено</div>
                <p>В CRM нет клиента с ${what} — <b>${esc(state.value)}</b>.</p>
                <p class="cs-note-sub">Стоит проверить второй тип поиска: клиента заводят
                   и на телефон, и на машину, но не всегда на оба сразу.</p>
            </div>`;
    }

    function viewError() {
        return `
            <div class="cs-note cs-note-error">
                <div class="cs-note-title">CRM не ответила</div>
                <p>${esc(state.error)}</p>
                <button type="button" class="btn cs-retry" data-act="research">Попробовать снова</button>
            </div>`;
    }

    function viewAuth() {
        return `
            <div class="cs-note cs-note-auth">
                <div class="cs-note-title">Нужен вход в CRM</div>
                <p>${esc(state.authNote)}</p>
                <form class="cs-login" id="cs-login">
                    <input class="cs-login-input" name="login" placeholder="Логин CRM" autocomplete="username">
                    <input class="cs-login-input" name="password" type="password" placeholder="Пароль"
                           autocomplete="current-password">
                    <button type="submit" class="btn cs-login-go"${state.loggingIn ? ' disabled' : ''}>
                        ${state.loggingIn ? 'Вхожу…' : 'Войти'}
                    </button>
                </form>
            </div>`;
    }

    function viewList() {
        return `
            <div class="cs-note">
                <div class="cs-note-title">Нашлось ${state.clients.length}
                    ${plural(state.clients.length, 'клиент', 'клиента', 'клиентов')}</div>
                <div class="cs-pick">
                    ${state.clients.map(c => `
                        <button type="button" class="cs-pick-item" data-client="${esc(c.id)}">
                            <span class="cs-ava">${esc((c.name || '?').trim()[0] || '?')}</span>
                            <span class="cs-pick-name">${esc(c.name)}</span>
                        </button>`).join('')}
                </div>
            </div>`;
    }

    // Показанная часть списка. Чеки уже отсортированы от свежих к старым
    // (shared/crmClients.js), поэтому «показать ещё» просто отодвигает границу.
    const visibleSales = () => (state.client ? state.client.sales.slice(0, state.shown) : []);

    // Карточка клиента: шапка (кто и на чём ездит), полоска итогов и список
    // обслуживаний. Всё, ради чего открывали, — в первом экране.
    //
    // Баллы стоят В ПОЛОСКЕ ИТОГОВ, а не отдельной плашкой в шапке: это такое
    // же число про клиента, как сумма чеков и дата последнего визита, и
    // золотая коробка сбоку от имени спорила с ним за взгляд — тем сильнее,
    // чем меньше в ней было написано («0 баллов» в рамке выглядит наградой).
    function viewClient() {
        const c = state.client;
        const sales = c.sales;
        const total = sales.reduce((acc, s) => acc + (s.sum || 0), 0);
        // Чеки уже отсортированы от свежих к старым (shared/crmClients.js),
        // поэтому последний визит — просто первая строка.
        const last = sales.length ? (sales[0].closedAt || sales[0].createdAt) : '';
        // Номера из панели клиента и из чеков — это разные списки: в панель
        // номер добавляют руками, а в чеке он проставляется на месте. Показываем
        // объединение, иначе машина «из чека» на карточке не видна вовсе.
        const plates = [...new Set([...c.plates, ...sales.map(s => s.plate).filter(Boolean)])];
        const back = state.clients.length > 1
            ? `<button type="button" class="cs-back" data-act="back">${ICON.back}<span>К списку</span></button>`
            : '';
        const rest = sales.length - visibleSales().length;
        const bonus = Number(c.bonus) || 0;

        return `
            <div class="cs-card">
                ${back}
                <div class="cs-head">
                    <span class="cs-ava cs-ava-big">${esc((c.name || '?').trim()[0] || '?')}</span>
                    <div class="cs-head-main">
                        <div class="cs-name">${esc(c.name)}</div>
                        <div class="cs-contacts">
                            ${c.phone
                                ? (telHref(c.phone)
                                    ? `<a class="cs-phone" href="${esc(telHref(c.phone))}">${esc(prettyPhone(c.phone))}</a>`
                                    : `<span class="cs-phone cs-phone-raw">${esc(prettyPhone(c.phone))}</span>`)
                                : ''}
                            ${c.birthday ? `<span class="cs-bday">др ${esc(c.birthday)}</span>` : ''}
                        </div>
                    </div>
                    ${plates.length ? `<div class="cs-plates">${plates.map(plateHtml).join('')}</div>` : ''}
                </div>

                <div class="cs-stats">
                    <div class="cs-stat" title="Бонусный счёт в CRM">
                        <span class="cs-stat-val">${points(bonus)}</span>
                        <span class="cs-stat-cap">баллы</span>
                    </div>
                    <div class="cs-stat">
                        <span class="cs-stat-val">${sales.length}</span>
                        <span class="cs-stat-cap">${plural(sales.length, 'обслуживание', 'обслуживания', 'обслуживаний')}</span>
                    </div>
                    <div class="cs-stat">
                        <span class="cs-stat-val">${money(total)}</span>
                        <span class="cs-stat-cap">сумма чеков</span>
                    </div>
                    <div class="cs-stat">
                        <span class="cs-stat-val">${esc(splitStamp(last).date || '—')}</span>
                        <span class="cs-stat-cap">последний визит</span>
                    </div>
                </div>

                ${sales.length
                    ? `<div class="cs-svc-list" id="cs-svc-list">${renderSales(visibleSales(), plates.length > 1)}</div>`
                    : '<div class="cs-svc-none">Обслуживаний в CRM нет — клиент заведён, но ещё не приезжал.</div>'}
                ${rest > 0
                    ? `<button type="button" class="cs-more" data-act="more">
                           Показать ещё ${Math.min(rest, SALES_PAGE)}
                           <span class="cs-more-rest">осталось ${rest}</span>
                       </button>`
                    : ''}
            </div>`;
    }

    // Чеки сгруппированы по годам: у постоянного клиента их два десятка, и
    // сплошной лентой «когда это было» не читается. Заголовок года прилипает к
    // верху списка при прокрутке — потому в строке и стоит дата без года.
    function renderSales(sales, showPlate) {
        let out = '';
        let year = null;
        for (const s of sales) {
            const y = yearOf(s.closedAt || s.createdAt);
            if (y && y !== year) {
                year = y;
                out += `<div class="cs-year">${esc(y)}</div>`;
            }
            out += saleRowHtml(s, showPlate);
        }
        return out;
    }

    // Строка обслуживания: слева дата, дальше ЧТО ДЕЛАЛИ (главное, ради чего
    // строку и читают), под ним станция мелким, справа сумма.
    //
    // Раньше первой строкой стояла станция, потому что она известна сразу, а
    // содержимое чека ещё едет. Но станция — это адрес из CRM, и на длинном
    // («деревня Новосаратовка Свердловское городское поселение 267А») строка
    // разъезжалась на четыре ряда, а список переставал читаться столбцом.
    // Теперь у станции своя строка с многоточием, а место главной занимает
    // плейсхолдер чека — он ровно той же высоты, и список не прыгает.
    //
    // Номер машины показываем, ТОЛЬКО если машин у клиента несколько: один и
    // тот же знак в каждой из двадцати строк — это шум, а не сведения.
    function saleRowHtml(s, showPlate) {
        const stamp = splitStamp(s.closedAt || s.createdAt);
        const opened = state.open.has(s.id);
        const station = String(s.station || '').trim();
        return `
            <div class="cs-svc${opened ? ' open' : ''}" data-sale="${esc(s.id)}">
                <button type="button" class="cs-svc-head" data-toggle="${esc(s.id)}" aria-expanded="${opened}">
                    <span class="cs-svc-when">
                        <span class="cs-svc-date">${esc(stamp.date.slice(0, 5))}</span>
                        <span class="cs-svc-time">${esc(stamp.time)}</span>
                    </span>
                    <span class="cs-svc-mid">
                        <span class="cs-svc-what" data-what="${esc(s.id)}">${saleSummaryHtml(s)}</span>
                        <span class="cs-svc-where">
                            ${showPlate && s.plate ? plateHtml(s.plate) : ''}
                            <span class="cs-svc-station"${station ? ` title="${esc(station)}"` : ''}>${
                                esc(shortStation(station) || 'станция не указана')}</span>
                        </span>
                    </span>
                    <span class="cs-svc-sum">${money(s.sum)}</span>
                    <span class="cs-svc-chevron">${ICON.chevron}</span>
                </button>
                <div class="cs-svc-body" data-body="${esc(s.id)}">${opened ? saleBodyHtml(s) : ''}</div>
            </div>`;
    }

    // Главная строка обслуживания: пока чек едет — бегущий плейсхолдер, потом
    // главная позиция чека (обычно это масло) и сколько было остальных.
    function saleSummaryHtml(s) {
        const st = state.sales.get(s.id);
        if (!st || st.status === 'load') return '<span class="sk sk-line cs-what-sk"></span>';
        if (st.status === 'error') return '<span class="cs-svc-failed">чек не загрузился</span>';
        const items = st.sale.items || [];
        if (!items.length) return '<span class="cs-svc-dim">позиций в чеке нет</span>';
        const rest = items.length - 1;
        return `<span class="cs-svc-main-item">${esc(shortItem(items[0].name))}</span>`
            + (rest > 0 ? `<span class="cs-svc-more">+${rest} ${plural(rest, 'позиция', 'позиции', 'позиций')}</span>` : '');
    }

    function saleBodyHtml(s) {
        const st = state.sales.get(s.id);
        if (!st || st.status === 'load') {
            return `<div class="cs-items-skel">${skeletonSale()}${skeletonSale()}</div>`;
        }
        if (st.status === 'error') {
            return `
                <div class="cs-svc-err">
                    <span>${esc(st.message || 'CRM не отдала чек')}</span>
                    <button type="button" class="cs-svc-retry" data-retry="${esc(s.id)}">${ICON.retry}Повторить</button>
                </div>`;
        }
        const sale = st.sale;
        const payIcon = sale.payment === 'cash' ? ICON.cash : sale.payment === 'cashless' ? ICON.card : '';
        const payText = sale.payment === 'cash' ? 'наличными' : sale.payment === 'cashless' ? 'картой' : '';
        return `
            <div class="cs-receipt">
                <div class="cs-items">${itemsHtml(sale.items || [])}</div>
                <div class="cs-svc-foot">
                    <span class="cs-svc-meta">
                        ${payIcon ? `<span class="cs-chip cs-pay">${payIcon}${esc(payText)}</span>` : ''}
                        ${s.seller ? `<span class="cs-chip cs-seller">${esc(s.seller)}</span>` : ''}
                        ${s.mileage ? `<span class="cs-chip cs-mileage">${esc(km(s.mileage))}</span>` : ''}
                        ${s.receivedBonus ? `<span class="cs-chip cs-earned">+${points(s.receivedBonus)} ${plural(Math.round(s.receivedBonus), 'балл', 'балла', 'баллов')}</span>` : ''}
                        ${s.paidBonus ? `<span class="cs-chip cs-spent">−${points(s.paidBonus)} ${plural(Math.round(s.paidBonus), 'балл', 'балла', 'баллов')}</span>` : ''}
                    </span>
                    <span class="cs-svc-paid">Оплачено <b>${money(sale.paid ?? s.sum)}</b></span>
                </div>
                ${s.comment ? `<div class="cs-comment">${esc(s.comment)}</div>` : ''}
            </div>`;
    }

    // Позиции чека — не сплошной столбец текста: в CRM работа и товар видны по
    // названию («Услуги SPOT …» — работа), и оператору нужно разное — что
    // ДЕЛАЛИ и что при этом ЗАЛИЛИ или поставили. Заголовки ставим, только
    // когда в чеке есть и то, и другое: над однородным списком это лишняя
    // строка, а лишних строк в чеке и так хватало.
    // «Расходники» из-под этого правила выведены нарочно: в прайсе они заведены
    // с той же приставкой «Услуги SPOT», но бутылка и воронка — это материал, а
    // не работа, и в списке работ они выглядят как выполненная услуга.
    const isWork = (name) => /^\s*услуги\s+spot\s+(?!расходники)/i.test(String(name || ''));

    function itemsHtml(items) {
        const works = items.filter(it => isWork(it.name));
        const goods = items.filter(it => !isWork(it.name));
        const both = works.length > 0 && goods.length > 0;
        const group = (title, list) => (list.length
            ? (both ? `<div class="cs-item-group">${title}</div>` : '') + list.map(itemRowHtml).join('')
            : '');
        return group('Работы', works) + group('Товары', goods);
    }

    // Артикул («3711 Моторное масло …») уезжает в отдельную бледную метку: он
    // бывает нужен вслух, но в начале названия читается как часть названия — и
    // столбец позиций перестаёт начинаться с того, ЧТО это.
    function itemRowHtml(it) {
        const m = String(it.name || '').match(/^\s*(\d{3,7})\s+(.*)$/);
        const art = m ? m[1] : '';
        const name = m ? m[2] : String(it.name || '');
        const count = it.count == null ? '' : '×' + it.count;
        return `
            <div class="cs-item">
                <span class="cs-item-main">
                    ${art ? `<span class="cs-item-art">${esc(art)}</span>` : ''}
                    <span class="cs-item-name">${esc(shortItem(name))}</span>
                </span>
                ${count ? `<span class="cs-item-count">${esc(count)}</span>` : ''}
                <span class="cs-item-sum">${money(it.total ?? it.sum)}</span>
            </div>`;
    }

    // Точечное обновление одной строки: перерисовывать всю карточку на каждый
    // приехавший чек нельзя — она дёргалась бы двадцать раз подряд и теряла
    // раскрытые строки.
    function refreshSale(id) {
        const sale = state.client && state.client.sales.find(s => s.id === id);
        if (!sale) return;
        const what = body.querySelector(`[data-what="${CSS.escape(id)}"]`);
        if (what) what.innerHTML = saleSummaryHtml(sale);
        if (state.open.has(id)) {
            const holder = body.querySelector(`[data-body="${CSS.escape(id)}"]`);
            if (holder) holder.innerHTML = saleBodyHtml(sale);
        }
    }

    // «Показать ещё»: список перерисовывается целиком (год-заголовки считаются
    // по всей показанной части), но прокрутку возвращаем на место — иначе она
    // прыгала бы в начало на каждом нажатии.
    function showMore() {
        if (!state.client) return;
        state.shown = Math.min(state.shown + SALES_PAGE, state.client.sales.length);
        const list = body.querySelector('#cs-svc-list');
        const top = list ? list.scrollTop : 0;
        render();
        const next = body.querySelector('#cs-svc-list');
        if (next) next.scrollTop = top;
        prefetchSales(token);
    }

    function toggleSale(id) {
        const sale = state.client && state.client.sales.find(s => s.id === id);
        if (!sale) return;
        const row = body.querySelector(`[data-sale="${CSS.escape(id)}"]`);
        const holder = body.querySelector(`[data-body="${CSS.escape(id)}"]`);
        if (state.open.has(id)) {
            state.open.delete(id);
            if (holder) holder.innerHTML = '';
        } else {
            state.open.add(id);
            if (holder) holder.innerHTML = saleBodyHtml(sale);
        }
        if (row) row.classList.toggle('open', state.open.has(id));
        const head = row && row.querySelector('.cs-svc-head');
        if (head) head.setAttribute('aria-expanded', String(state.open.has(id)));
    }

    function bind() {
        body.querySelectorAll('[data-toggle]').forEach(el => {
            el.onclick = () => toggleSale(el.dataset.toggle);
        });
        body.querySelectorAll('[data-retry]').forEach(el => {
            el.onclick = (e) => { e.stopPropagation(); retrySale(el.dataset.retry); };
        });
        body.querySelectorAll('[data-client]').forEach(el => {
            el.onclick = () => openClient(el.dataset.client);
        });
        const backBtn = body.querySelector('[data-act="back"]');
        if (backBtn) backBtn.onclick = () => { state.stage = 'list'; render(); };
        const more = body.querySelector('[data-act="more"]');
        if (more) more.onclick = () => showMore();
        const again = body.querySelector('[data-act="research"]');
        if (again) again.onclick = () => runSearch();
        const loginForm = body.querySelector('#cs-login');
        if (loginForm) {
            loginForm.onsubmit = (e) => {
                e.preventDefault();
                const login = loginForm.login.value.trim();
                const password = loginForm.password.value;
                if (login && password) doLogin(login, password);
            };
        }
    }

    render();

    return {
        activate() {
            renderBar();
            input.focus();
        },
        // Уходя, гасим только незавершённый обход: найденного клиента
        // оставляем — вернувшись в режим, человек видит тот же экран, как и в
        // «Поиске» с «Тегами».
        deactivate() {
            state.kindOpen = false;
            renderBar();
        },
    };
}
