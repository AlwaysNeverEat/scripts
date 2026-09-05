// ─────────────────────────────────────────────────────────────────────────────
// Лента активности в профиле — «квадратики» как на GitHub: колонка = неделя
// (Пн…Вс), клетка = день, яркость = сколько записей человек сделал в этот день.
//
// Год ВСЕГДА влезает целиком: сетка тянется по ширине панели (колонки в 1fr,
// клетка квадратная через aspect-ratio), а не прокручивается вбок фиксированными
// клетками по 11px. Прокрутка сбоку стоила дорого — картинку «год работы» было
// видно только кусками, и приходилось возить её мышью, чтобы понять форму года.
// Цена решения: на телефоне клетка мельче спички. Это осознанно — целое важнее
// детали, а цифры под сеткой всё равно называют числа словами.
//
// Яркость СЧИТАЕТСЯ ОТ СРЕДНЕГО по активным дням (см. shared/activityHeatmap.js),
// а не от фиксированных порогов: лента должна одинаково читаться и у того, кто
// делает три записи в день, и у того, кто делает тридцать. Поэтому под сеткой
// подписано, от какого среднего она посчитана — иначе цвет выглядел бы
// произволом.
//
// Наведение на клетку показывает подсказку «3 записи · 4 августа 2026».
// Подсказка — не title: нативная всплывает через секунду и не переживает
// горизонтальную прокрутку сетки, а свою можно поставить ровно над клеткой.
// Она position: fixed и лежит внутри самой ленты — уходит со страницы вместе
// с ней, ничего не оставляя в body.
//
// КЛИК ПО КЛЕТКЕ ОТКРЫВАЕТ ДЕНЬ: окно со списком записей, сделанных в этот
// день, — кого, куда и на какое время записали (dayRecordsHtml). Это и есть
// прозрачность топа: любое очко можно открыть и увидеть, за что оно дано. Дни
// до того, как сайт стал запоминать подробности, честно подписываются «до
// обновления» — очки за них остались, рассказать о них нечего.
//
// Разметка общая для своего и чужого профиля (profile.js / publicProfile.js).
// ─────────────────────────────────────────────────────────────────────────────

import {
    buildHeatmap, dayTitle, recordsWord, formatDayRu, WEEKDAYS_SHORT,
} from '../../shared/activityHeatmap.js';
import { formatRuPhone, addMinutes } from '../../shared/crmRecords.js';

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

// Цифры ПОД сеткой, тремя колонками: сколько всего за год, от какого среднего
// считалась яркость и каким был лучший день. Раньше это была одна серая строчка
// над лентой — её проматывали глазами, хотя среднее объясняет всю раскраску.
function figuresHtml(h) {
    if (!h.total) return `<div class="activity-figures activity-figures-empty">За год записей пока нет</div>`;
    const figure = (value, label) => `
        <div class="activity-figure"><b>${value}</b><span>${label}</span></div>`;
    return `
        <div class="activity-figures">
            ${figure(h.total, `${recordsWord(h.total)} за год`)}
            ${figure(formatAverage(h.average), 'в среднем в активный день')}
            ${figure(h.best, 'лучший день')}
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
        return `<i class="activity-cell activity-l${cell.level}" data-tip="${esc(dayTitle(cell))}"
                   data-date="${esc(cell.date)}" data-count="${cell.count}" role="button"></i>`;
    }).join('')).join('');

    const legend = [0, 1, 2, 3, 4]
        .map(l => `<i class="activity-cell activity-legend-cell activity-l${l}"></i>`).join('');

    // Колонка Пн/Ср/Пт — отдельным флекс-столбцом слева: её строки тянутся по
    // высоте сетки (клетка квадратная и потому зависит от ширины панели),
    // поэтому фиксированной высоты у подписей быть не может.
    return `
        <div class="activity" style="--weeks:${h.weeks.length}">
            <div class="activity-cols">
                <div class="activity-side">
                    <div class="activity-side-gap"></div>
                    <div class="activity-weekdays">${WEEKDAY_COLUMN}</div>
                </div>
                <div class="activity-main">
                    <div class="activity-months">${months}</div>
                    <div class="activity-grid">${cells}</div>
                </div>
            </div>
            <div class="activity-legend">
                <span>Меньше</span>${legend}<span>Больше</span>
            </div>
            ${figuresHtml(h)}
        </div>`;
}

// ── Окно дня ─────────────────────────────────────────────────────────────────

// «30 мин», «1 ч», «1 ч 30 мин».
function durationLabel(min) {
    const n = Number(min) || 0;
    const h = Math.floor(n / 60);
    const m = n % 60;
    if (!h) return `${m} мин`;
    return m ? `${h} ч ${m} мин` : `${h} ч`;
}

// Дата записи без года: «5 сентября».
function shortDayRu(iso) {
    return formatDayRu(iso).replace(/\s\d{4}$/, '');
}

// Одна сделанная запись: слева — во сколько её сделали, справа — кого и куда.
// Госномер и телефон показываются как есть: те же данные видны на доске
// записей, а прятать их в окне «за что очки» значило бы прятать само очко.
function dayRecordHtml(r) {
    const who = [
        `<b>${esc(r.clientName || 'без имени')}</b>`,
        r.phone ? esc(formatRuPhone(r.phone)) : '',
        r.carNumber ? esc(r.carNumber) : '',
    ].filter(Boolean).join(' · ');
    const end = r.recordTime ? addMinutes(r.recordTime, Number(r.durationMin) || 30) : '';
    const when = r.recordTime
        ? `${esc(shortDayRu(r.recordDate))}, ${esc(r.recordTime)}–${esc(end)} (${durationLabel(r.durationMin)})`
        : esc(shortDayRu(r.recordDate));
    return `
        <div class="day-rec">
            <span class="day-rec-made" title="Во сколько сделана запись">${esc(r.madeAt || '')}</span>
            <div class="day-rec-main">
                <div class="day-rec-who">${who}</div>
                <div class="day-rec-where">${esc(r.stationTitle || `станция ${r.stationId || '?'}`)} · ${when}</div>
            </div>
        </div>`;
}

// Содержимое окна дня. day — ответ GET /api/profile/day/:date:
// { date, count, legacy, records }. Чистая функция: тестируется без DOM.
export function dayRecordsHtml(day) {
    const count = Number(day?.count) || 0;
    const records = Array.isArray(day?.records) ? day.records : [];
    const legacy = Number(day?.legacy) || 0;

    if (!count) return `<div class="search-empty">В этот день записей не было</div>`;

    // Все очки дня — со старых времён: рассказать не о чем, и это не поломка.
    if (!records.length) {
        return `
            <div class="day-legacy">
                К сожалению, подробностей нет: ${count === 1 ? 'эта запись была сделана' : `эти ${count} ${recordsWord(count)} были сделаны`}
                до обновления, когда сайт запоминал только число записей, а не сами записи.
            </div>`;
    }
    const list = records.map(dayRecordHtml).join('');
    const tail = legacy
        ? `<div class="day-legacy day-legacy-tail">Ещё ${legacy} ${recordsWord(legacy)} за этот день
            ${legacy === 1 ? 'сделана' : 'сделаны'} до обновления — подробностей по ${legacy === 1 ? 'ней' : 'ним'} нет.</div>`
        : '';
    return `<div class="day-list">${list}</div>${tail}`;
}

// Окно со списком записей за день. loadDay(date) → Promise<day>; окно
// открывается сразу, список доезжает. Один экземпляр: повторный клик
// заменяет предыдущее окно.
function openDayModal(cell, loadDay) {
    document.getElementById('activity-day-modal')?.remove();
    const date = cell.dataset.date;
    const count = Number(cell.dataset.count) || 0;

    const modal = document.createElement('div');
    modal.id = 'activity-day-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-backdrop"></div>
        <div class="modal-win">
            <div class="modal-head">
                <span class="day-head">
                    <span>${esc(formatDayRu(date))}</span>
                    <span class="day-head-count">${count ? `${count} ${recordsWord(count)}` : 'записей нет'}</span>
                </span>
                <button class="btn btn-sec" id="activity-day-close" aria-label="Закрыть">✕</button>
            </div>
            <div class="modal-body" id="activity-day-body">
                ${count ? '<div class="search-empty">Загрузка…</div>' : dayRecordsHtml({ count: 0 })}
            </div>
        </div>`;
    document.body.appendChild(modal);

    const close = () => { modal.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    modal.querySelector('.modal-backdrop').onclick = close;
    modal.querySelector('#activity-day-close').onclick = close;
    document.addEventListener('keydown', onKey);

    if (!count || typeof loadDay !== 'function') return;
    loadDay(date).then((day) => {
        const body = modal.querySelector('#activity-day-body');
        if (body) body.innerHTML = dayRecordsHtml(day);
    }).catch((err) => {
        const body = modal.querySelector('#activity-day-body');
        if (body) body.innerHTML = `<div class="search-empty">Не удалось загрузить: ${esc(err?.message || err)}</div>`;
    });
}

// Слушатели на document/window переживают перерисовку профиля (сама лента —
// нет), поэтому старые снимаем при каждом новом подключении: иначе после
// десятка заходов в профиль их накопится десяток, и все — на удалённые узлы.
let detachPrev = null;

// Подсказки при наведении и окно дня по клику. root — контейнер, внутри
// которого лежит разметка из activityFeedHtml (перерисовали профиль — вызвать
// заново). loadDay(date) — откуда брать записи дня; без него клик ничего не
// открывает (лента в песочнице).
export function attachActivityFeed(root, { loadDay } = {}) {
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

    // Клик (и тап на телефоне) открывает день: в окне и дата, и число записей,
    // так что подсказка ему не нужна — убираем её, чтобы не висела под окном.
    grid.addEventListener('click', (e) => {
        const cell = cellAt(e);
        hide();
        if (!cell) return;
        if (loadDay) openDayModal(cell, loadDay);
    });
    const onDocClick = (e) => {
        if (shown && !e.target.closest('.activity-cell')) hide();
    };
    document.addEventListener('click', onDocClick);

    // Прокрутка страницы сдвигает клетку из-под подсказки — проще убрать,
    // чем гнаться за ней.
    window.addEventListener('scroll', hide, { passive: true, capture: true });

    detachPrev = () => {
        document.removeEventListener('click', onDocClick);
        window.removeEventListener('scroll', hide, { capture: true });
    };
}
