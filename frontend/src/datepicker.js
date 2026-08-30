// ─────────────────────────────────────────────────────────────────────────────
// Свой календарь вместо нативного <input type="date">.
//
// Причина та же, что у выпадающих списков (см. select.js): нативный пикер
// рисует операционная система — своей формы, своего размера и своих цветов, и
// под тему сайта он не красится ничем. Рядом с окном записи в тёмной теме
// белый системный календарь выглядит как чужое приложение.
//
// ИНПУТ ОСТАЁТСЯ МОДЕЛЬЮ, как и селект. Скрытый <input type="date"> никуда не
// девается: мы записываем в него значение и шлём `change`, а дальше работает
// тот же обработчик, что работал с нативным пикером. В records.js правится
// только место открытия — вся логика смены даты не тронута.
//
// НА ТАЧЕ ОСТАЁТСЯ НАТИВНЫЙ. На телефоне системный календарь объективно
// удобнее: крупный, привычный, с барабанами. Мы открываем свой только там, где
// есть точный указатель, — ровно как со списками.
//
// НЕДЕЛЯ НАЧИНАЕТСЯ С ПОНЕДЕЛЬНИКА. Это не мелочь и не вкус: сайт русский, а
// getDay() у JS считает от воскресенья, и без сдвига весь месяц уезжает на
// день. Отсюда `(d.getDay() + 6) % 7` во всех расчётах сетки.
// ─────────────────────────────────────────────────────────────────────────────

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

const ARROW = (dir) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${
        dir < 0 ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'}"/></svg>`;

// Локальная дата в YYYY-MM-DD. Через toISOString() нельзя: он переводит в UTC,
// и для Москвы вечер 30-го числа превращается в 30-е или 31-е в зависимости от
// часа — календарь начинал подсвечивать «сегодня» не тем днём.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseIso = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};

let pop = null;
let open = null;   // { input, anchor, view: Date, sel: Date|null }

function node() {
    if (pop) return pop;
    pop = document.createElement('div');
    pop.className = 'dp-pop hidden';
    document.body.appendChild(pop);
    pop.addEventListener('mousedown', (e) => e.preventDefault());
    pop.addEventListener('click', (e) => {
        const nav = e.target.closest('[data-dp-nav]');
        if (nav) { shiftMonth(Number(nav.dataset.dpNav)); return; }
        const cell = e.target.closest('[data-dp-day]');
        if (cell) pick(cell.dataset.dpDay);
    });
    return pop;
}

function shiftMonth(delta) {
    open.view = new Date(open.view.getFullYear(), open.view.getMonth() + delta, 1);
    render();
}

function pick(isoDate) {
    const { input } = open;
    input.value = isoDate;
    close();
    // Настоящее событие с настоящего инпута: обработчик смены даты в records.js
    // навешан на него и про эту надстройку ничего не знает.
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

function place() {
    if (!open) return;
    const r = open.anchor.getBoundingClientRect();
    const h = pop.offsetHeight || 300;
    const gap = 6;
    const down = window.innerHeight - r.bottom - gap >= h || r.top - gap < h;
    pop.style.top = down ? `${Math.round(r.bottom + gap)}px`
                         : `${Math.round(r.top - gap - h)}px`;
    // Не даём вылезти за правый край: у окна записи кнопка стоит близко к нему.
    const left = Math.min(Math.round(r.left), window.innerWidth - pop.offsetWidth - 8);
    pop.style.left = `${Math.max(8, left)}px`;
}

function render() {
    const view = open.view;
    const y = view.getFullYear(), m = view.getMonth();
    const first = new Date(y, m, 1);
    // Сколько дней предыдущего месяца показать, чтобы неделя начиналась с пн.
    const lead = (first.getDay() + 6) % 7;
    const start = new Date(y, m, 1 - lead);
    const todayIso = iso(new Date());
    const selIso = open.sel ? iso(open.sel) : null;

    let cells = '';
    for (let i = 0; i < 42; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const s = iso(d);
        const cls = ['dp-day'];
        if (d.getMonth() !== m) cls.push('is-out');
        if (s === todayIso) cls.push('is-today');
        if (s === selIso) cls.push('is-sel');
        cells += `<button type="button" class="${cls.join(' ')}" data-dp-day="${s}"
            ${s === selIso ? 'aria-current="date"' : ''}>${d.getDate()}</button>`;
    }
    pop.innerHTML = `
        <div class="dp-head">
            <button type="button" class="dp-nav" data-dp-nav="-1" aria-label="Предыдущий месяц">${ARROW(-1)}</button>
            <div class="dp-title">${MONTHS[m]} ${y}</div>
            <button type="button" class="dp-nav" data-dp-nav="1" aria-label="Следующий месяц">${ARROW(1)}</button>
        </div>
        <div class="dp-week">${WEEKDAYS.map(w => `<span>${w}</span>`).join('')}</div>
        <div class="dp-grid">${cells}</div>`;
    place();
}

function close() {
    if (!open) return;
    pop.classList.add('hidden');
    open = null;
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
    document.removeEventListener('keydown', onKey, true);
}

function onKey(e) {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); open?.anchor?.focus?.(); return; }
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step) {
        e.preventDefault();
        const base = open.sel || new Date();
        open.sel = new Date(base.getFullYear(), base.getMonth(), base.getDate() + step);
        open.view = new Date(open.sel.getFullYear(), open.sel.getMonth(), 1);
        render();
        return;
    }
    if (e.key === 'Enter' && open.sel) { e.preventDefault(); pick(iso(open.sel)); }
}

/**
 * Открыть календарь для скрытого <input type="date">.
 * На тач-устройствах отдаёт нативный пикер — там он удобнее.
 *
 * @param {HTMLInputElement} input  скрытый инпут: он и есть модель значения
 * @param {HTMLElement} anchor      кнопка, от которой позиционируем окошко
 */
export function openDateFor(input, anchor) {
    if (!input) return;
    if (!window.matchMedia?.('(pointer: fine)')?.matches) {
        // Запасной путь ровно тот, что был до нас.
        if (typeof input.showPicker === 'function') {
            try { input.showPicker(); return; } catch { /* ниже */ }
        }
        input.focus();
        input.click();
        return;
    }
    if (open?.input === input) { close(); return; }
    close();
    const sel = parseIso(input.value);
    open = { input, anchor: anchor || input, sel, view: new Date((sel || new Date()).getFullYear(), (sel || new Date()).getMonth(), 1) };
    node().classList.remove('hidden');
    render();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    document.addEventListener('keydown', onKey, true);
    // Клик мимо закрывает. Вешаем на следующий тик, иначе тот же клик, который
    // календарь открыл, его же и закроет.
    setTimeout(() => {
        document.addEventListener('mousedown', outside, { once: false });
    }, 0);
}

function outside(e) {
    if (!open) { document.removeEventListener('mousedown', outside); return; }
    if (pop.contains(e.target) || open.anchor.contains(e.target)) return;
    close();
    document.removeEventListener('mousedown', outside);
}
