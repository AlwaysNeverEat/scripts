// ─────────────────────────────────────────────────────────────────────────────
// Свой выпадающий список вместо нативного <select>.
//
// Нативный не красится под тему сайта: в Chrome под Windows попап списка белый
// в любой теме, а под каждой ОС он ещё и своей формы и своего размера. Это же
// соображение уже было записано в шапке tagSearch.js, где по той же причине
// написан комбобокс для тегов; здесь оно распространено на остальные десять
// селектов сайта — станции в записях, топливо и агрегаты в редакторе машины,
// станция и фильтр в CRM-панели, поля лида.
//
// СЕЛЕКТ ОСТАЁТСЯ МОДЕЛЬЮ, И ЭТО ГЛАВНОЕ. Настоящий <select> никуда не
// девается: он прячется, но продолжает хранить значение и получать событие
// change. Весь остальной код читает `.value` и слушает `change` ровно как
// раньше — правок в местах вызова нет ни одной. Списки при этом собираются
// из его же <option> в момент открытия, поэтому перерисовка опций (станции
// подгружаются с сервера) подхватывается сама.
//
// НА ТАЧЕ ОСТАЁТСЯ НАТИВНЫЙ. На телефоне системный список объективно удобнее
// любого своего: он крупный, с инерцией и привычный. Улучшаем только там, где
// есть точный указатель.
//
// ПОПАП ЖИВЁТ В <body>, а не рядом с селектом. Селекты стоят внутри окон и
// прокручиваемых панелей с overflow: hidden — список, нарисованный на месте,
// обрезался бы их краем. Позиция считается от кнопки и пересчитывается на
// прокрутке и ресайзе, пока список открыт.
// ─────────────────────────────────────────────────────────────────────────────

const READY = 'data-sel-ready';
// Ниже этого числа пунктов строка поиска только мешает: пролистать глазами
// пять станций быстрее, чем набрать букву.
const SEARCH_FROM = 8;

const CHEVRON = `<svg class="sel-btn-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Единственный попап на страницу: двух открытых списков не бывает, а один узел
// избавляет от уборки за собой.
let pop = null;
let open = null;   // { select, btn, opts, index }

function popNode() {
    if (pop) return pop;
    pop = document.createElement('div');
    pop.className = 'sel-pop hidden';
    pop.setAttribute('role', 'listbox');
    document.body.appendChild(pop);
    pop.addEventListener('mousedown', (e) => {
        // Не даём кнопке потерять фокус раньше, чем обработаем выбор.
        e.preventDefault();
        const el = e.target.closest('.sel-opt');
        if (el) choose(Number(el.dataset.i));
    });
    return pop;
}

function labelOf(select) {
    const o = select.selectedOptions[0];
    return o ? o.textContent.trim() : '';
}

function syncLabel(select) {
    const btn = select.nextElementSibling;
    if (!btn || !btn.classList.contains('sel-btn')) return;
    const text = labelOf(select);
    btn.querySelector('.sel-btn-text').textContent = text;
    btn.classList.toggle('is-empty', !text);
    btn.disabled = select.disabled;
}

function optionsOf(select) {
    return [...select.options].map((o, i) => ({
        i, value: o.value, label: o.textContent.trim(),
        disabled: o.disabled, group: o.parentElement.label || '',
    }));
}

function place() {
    if (!open) return;
    const r = open.btn.getBoundingClientRect();
    const gap = 4;
    const below = window.innerHeight - r.bottom - gap;
    const above = r.top - gap;
    // Открываемся вниз, если снизу помещается больше — иначе вверх. Список
    // ограничен местом до края экрана, а не выдуманной высотой: у станций
    // пунктов сорок, и обрезать их наугад значит прятать половину.
    const down = below >= Math.min(280, above);
    pop.style.left = `${Math.round(r.left)}px`;
    pop.style.width = `${Math.round(r.width)}px`;
    pop.style.maxHeight = `${Math.round(Math.max(120, (down ? below : above) - 8))}px`;
    if (down) { pop.style.top = `${Math.round(r.bottom + gap)}px`; pop.style.bottom = 'auto'; }
    else { pop.style.bottom = `${Math.round(window.innerHeight - r.top + gap)}px`; pop.style.top = 'auto'; }
}

function renderList(query = '') {
    const q = query.trim().toLowerCase();
    const shown = q ? open.opts.filter(o => o.label.toLowerCase().includes(q)) : open.opts;
    open.shown = shown;
    const cur = open.select.value;
    const list = pop.querySelector('.sel-list');
    list.innerHTML = shown.length
        ? shown.map(o => `<div class="sel-opt${o.value === cur ? ' is-current' : ''}${o.disabled ? ' is-disabled' : ''}"
              role="option" aria-selected="${o.value === cur}" data-i="${o.i}">${esc(o.label)}</div>`).join('')
        : '<div class="sel-empty">Ничего не найдено</div>';
    open.index = shown.findIndex(o => o.value === cur);
    highlight();
}

function highlight() {
    const list = pop.querySelector('.sel-list');
    [...list.children].forEach((el, i) => el.classList.toggle('is-active', i === open.index));
    list.children[open.index]?.scrollIntoView({ block: 'nearest' });
}

function choose(optionIndex) {
    const { select } = open;
    const o = select.options[optionIndex];
    if (!o || o.disabled) return;
    select.value = o.value;
    syncLabel(select);
    closeList();
    // Настоящее событие с настоящего селекта: слушатели в записях, редакторе и
    // CRM-панели навешаны на него и ничего не знают про эту надстройку.
    select.dispatchEvent(new Event('change', { bubbles: true }));
}

function closeList() {
    if (!open) return;
    open.btn.setAttribute('aria-expanded', 'false');
    pop.classList.add('hidden');
    open = null;
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
}

function openList(select, btn) {
    if (open?.select === select) { closeList(); return; }
    closeList();
    const opts = optionsOf(select);
    open = { select, btn, opts, shown: opts, index: -1 };
    const p = popNode();
    const withSearch = opts.length >= SEARCH_FROM;
    p.innerHTML = (withSearch
        ? '<input class="sel-search" type="text" placeholder="Поиск…" autocomplete="off"/>'
        : '') + '<div class="sel-list"></div>';
    p.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
    renderList();
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    if (withSearch) {
        const s = p.querySelector('.sel-search');
        s.addEventListener('input', () => renderList(s.value));
        s.addEventListener('keydown', onKeys);
        s.focus();
    }
}

function onKeys(e) {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); closeList(); open?.btn?.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        open.index = Math.max(0, Math.min(open.index + d, open.shown.length - 1));
        highlight();
        return;
    }
    if (e.key === 'Enter' || (e.key === 'Tab' && open.index >= 0)) {
        const o = open.shown[open.index];
        if (o) { e.preventDefault(); choose(o.i); }
    }
}

function enhance(select) {
    if (select.hasAttribute(READY) || select.multiple) return;
    select.setAttribute(READY, '');

    const btn = document.createElement('button');
    btn.type = 'button';
    // Класс селекта переезжает на кнопку целиком: все существующие правила
    // (.crm-station-select, .lead-select и прочие) написаны на них, и так
    // кнопка выглядит ровно как выглядел селект, без второго набора стилей.
    btn.className = `sel-btn ${select.className}`.trim();
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    if (select.id) btn.setAttribute('aria-labelledby', select.id);
    btn.innerHTML = `<span class="sel-btn-text"></span>${CHEVRON}`;
    select.after(btn);
    select.classList.add('sel-native-hidden');
    select.setAttribute('tabindex', '-1');
    select.setAttribute('aria-hidden', 'true');
    syncLabel(select);

    btn.addEventListener('click', () => openList(select, btn));
    btn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!open) openList(select, btn); else onKeys(e);
            return;
        }
        onKeys(e);
    });
    // Значение могли поменять и мимо нас — из кода или другим селектом каскада.
    select.addEventListener('change', () => syncLabel(select));
}

let started = false;

/**
 * Заменяет нативные <select> своими списками и следит за появлением новых.
 * Идемпотентна: зовётся из main.js и из модулей, которые рисуют свои селекты
 * (дев-песочницы импортируют их напрямую, мимо главного входа).
 */
export function initSelects() {
    if (started) return;
    started = true;
    // Тач-устройства оставляем с нативным списком (см. шапку файла).
    if (!window.matchMedia?.('(pointer: fine)')?.matches) return;

    const scan = () => {
        for (const s of document.querySelectorAll(`select:not([${READY}]):not([data-native])`)) enhance(s);
        // Подписи обновляем заодно: программная запись .value события не шлёт,
        // а в этом коде она почти всегда идёт вместе с перерисовкой.
        for (const s of document.querySelectorAll(`select[${READY}]`)) syncLabel(s);
    };
    scan();

    let queued = false;
    new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; scan(); });
    }).observe(document.body, { childList: true, subtree: true });

    document.addEventListener('mousedown', (e) => {
        if (!open) return;
        if (!pop.contains(e.target) && e.target !== open.btn && !open.btn.contains(e.target)) closeList();
    });
    document.addEventListener('keydown', (e) => { if (open && e.key === 'Escape') closeList(); });
}
