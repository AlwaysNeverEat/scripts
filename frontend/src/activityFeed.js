// ─────────────────────────────────────────────────────────────────────────────
// Лента активности в профиле — «квадратики» как на GitHub: колонка = неделя
// (Пн…Вс), клетка = день, яркость = сколько записей человек сделал в этот день.
//
// Яркость СЧИТАЕТСЯ ОТ СРЕДНЕГО по активным дням (см. shared/activityHeatmap.js),
// а не от фиксированных порогов: лента должна одинаково читаться и у того, кто
// делает три записи в день, и у того, кто делает тридцать. Поэтому под сеткой
// подписано, от какого среднего она посчитана — иначе цвет выглядел бы
// произволом.
//
// Наведение (или тап на телефоне) на клетку показывает подсказку
// «3 записи · 4 августа 2026». Подсказка — не title: нативная всплывает через
// секунду и не переживает горизонтальную прокрутку сетки, а свою можно поставить
// ровно над клеткой. Она position: fixed и лежит внутри самой ленты — уходит
// со страницы вместе с ней, ничего не оставляя в body.
//
// Разметка общая для своего и чужого профиля (profile.js / publicProfile.js).
// ─────────────────────────────────────────────────────────────────────────────

import {
    buildHeatmap, dayTitle, recordsWord, WEEKDAYS_SHORT,
} from '../../shared/activityHeatmap.js';

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Среднее показываем округлённым до десятых, но без хвоста «.0» —
// «в среднем 3 записи в день» читается лучше, чем «3.0».
function formatAverage(avg) {
    const rounded = Math.round(avg * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace('.', ',');
}

// Строка-итог под заголовком: сколько всего за год и от какого среднего
// считалась яркость.
function summaryHtml(h) {
    if (!h.total) return `<div class="activity-summary">За год записей пока нет</div>`;
    const avg = formatAverage(h.average);
    return `
        <div class="activity-summary">
            <b>${h.total}</b> ${recordsWord(h.total)} за год ·
            в среднем <b>${avg}</b> в активный день ·
            лучший день — <b>${h.best}</b>
        </div>`;
}

// Подписи дней недели слева: только Пн/Ср/Пт, иначе не влезают в высоту клетки.
const WEEKDAY_COLUMN = WEEKDAYS_SHORT
    .map((d, i) => `<span>${i % 2 === 0 ? d : ''}</span>`)
    .join('');

export function activityFeedHtml(data) {
    const h = buildHeatmap(data || {});
    if (!h.weeks.length) {
        return `<div class="search-empty">Лента активности пока недоступна</div>`;
    }

    const months = h.months.map(m => `
        <span class="activity-month" style="grid-column: ${m.weekIndex + 1} / span ${m.span}">${esc(m.label)}</span>`).join('');

    // Клетки идут колонка за колонкой (grid-auto-flow: column) — порядок в
    // разметке совпадает с порядком недель в сетке.
    const cells = h.weeks.map(week => week.map(cell => {
        if (!cell) return `<i class="activity-cell activity-cell-off"></i>`;
        // Без tabindex сознательно: 365 клеток — это 365 остановок табом
        // между статистикой и кнопкой «Выйти».
        return `<i class="activity-cell activity-l${cell.level}" data-tip="${esc(dayTitle(cell))}"></i>`;
    }).join('')).join('');

    const legend = [0, 1, 2, 3, 4]
        .map(l => `<i class="activity-cell activity-l${l}"></i>`).join('');

    // Пн/Ср/Пт — ВНЕ прокручиваемой области: сетка на год уезжает вбок, и
    // подписи дней недели должны оставаться на месте, а не уплывать с ней.
    return `
        <div class="activity" style="--weeks:${h.weeks.length}">
            ${summaryHtml(h)}
            <div class="activity-cols">
                <div class="activity-side">
                    <div class="activity-side-gap"></div>
                    <div class="activity-weekdays">${WEEKDAY_COLUMN}</div>
                </div>
                <div class="activity-scroll">
                    <div class="activity-inner">
                        <div class="activity-months">${months}</div>
                        <div class="activity-grid">${cells}</div>
                    </div>
                </div>
            </div>
            <div class="activity-legend">
                <span>Меньше</span>${legend}<span>Больше</span>
            </div>
        </div>`;
}

// Слушатели на document/window переживают перерисовку профиля (сама лента —
// нет), поэтому старые снимаем при каждом новом подключении: иначе после
// десятка заходов в профиль их накопится десяток, и все — на удалённые узлы.
let detachPrev = null;

// Подсказки при наведении/тапе. root — контейнер, внутри которого лежит
// разметка из activityFeedHtml (перерисовали профиль — вызвать заново).
export function attachActivityFeed(root) {
    detachPrev?.();
    detachPrev = null;

    const box = root?.querySelector('.activity');
    if (!box) return;

    const tip = document.createElement('div');
    tip.className = 'activity-tip hidden';
    box.appendChild(tip);

    let shown = null;

    function hide() {
        shown = null;
        tip.classList.add('hidden');
    }

    function show(cell) {
        shown = cell;
        tip.textContent = cell.dataset.tip || '';
        tip.classList.remove('hidden');
        // Считаем позицию только после показа: у скрытого элемента нет размеров.
        const r = cell.getBoundingClientRect();
        const w = tip.offsetWidth;
        const h = tip.offsetHeight;
        // По центру клетки, но не за краем экрана (крайние недели у самой
        // границы, а сетка ещё и прокручивается вбок).
        const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
        // Сверху, а если ленту подняли к самой шапке — снизу.
        const above = r.top - h - 8;
        tip.style.left = `${Math.round(left)}px`;
        tip.style.top = `${Math.round(above < 8 ? r.bottom + 8 : above)}px`;
    }

    const grid = box.querySelector('.activity-grid');
    const cellAt = (e) => e.target.closest('.activity-cell:not(.activity-cell-off)');

    grid.addEventListener('mouseover', (e) => {
        const cell = cellAt(e);
        if (cell && cell !== shown) show(cell);
    });
    grid.addEventListener('mouseleave', hide);

    // Телефон: пальцем «навести» нельзя — показываем по тапу, второй тап по
    // той же клетке (или тап мимо) убирает.
    grid.addEventListener('click', (e) => {
        const cell = cellAt(e);
        if (!cell) return hide();
        if (cell === shown) hide(); else show(cell);
    });
    const onDocClick = (e) => {
        if (shown && !e.target.closest('.activity-cell')) hide();
    };
    document.addEventListener('click', onDocClick);

    // Прокрутка (сетки, страницы) сдвигает клетку из-под подсказки —
    // проще убрать, чем гнаться за ней.
    box.querySelector('.activity-scroll').addEventListener('scroll', hide);
    window.addEventListener('scroll', hide, { passive: true, capture: true });

    detachPrev = () => {
        document.removeEventListener('click', onDocClick);
        window.removeEventListener('scroll', hide, { capture: true });
    };
}

// Лента длиной в год шире карточки профиля: показывать её надо с конца —
// последняя неделя у правого края, как на GitHub.
export function scrollActivityToEnd(root) {
    const scroller = root?.querySelector('.activity-scroll');
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
}
