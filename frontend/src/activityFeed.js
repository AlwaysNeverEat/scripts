// ─────────────────────────────────────────────────────────────────────────────
// Лента активности в профиле — «квадратики» как на GitHub: колонка = неделя
// (Пн…Вс), клетка = день, яркость = сколько записей человек сделал в этот день.
//
// СЕТКА ЗУМИТСЯ, и по умолчанию открыта на последних трёх месяцах, а не на
// целом годе. Раньше год влезал целиком всегда: 53 колонки делили ширину
// панели, и клетка выходила в десять пикселей — форма года читалась, а сам
// день нет, при том что клетка КЛИКАБЕЛЬНА и открывает окно записей. Целиться
// в десять пикселей мышью неудобно, а на телефоне нечем.
//
// Поэтому масштаба три («3 месяца», «Полгода», «Год»), и год из них НЕ УБРАН:
// картинка целого года — то, ради чего лента и заводилась, просто это теперь
// не единственный вид. Выбор лежит в localStorage, то есть на устройстве, как
// тема и акцент: это настройка глаза, а не аккаунта.
//
// Прокрутки вбок у сетки нет и тут: возить мышью год по кусочкам — ровно то,
// от чего в своё время ушли. Вместо неё ОДИН ползунок под сеткой (неделя =
// шаг) и подпись показанного периода рядом с масштабом, чтобы было видно, где
// мы находимся в году. Лента при этом одна на всю ширину: недели рисуются все,
// а окно показывает их кусок — колонки от этого становятся шире, клетка
// крупнее, и ничего не перерисовывается, то есть подсказки и обработчики
// переживают любое движение ползунка.
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
// КЛИК ПО КЛЕТКЕ ОТКРЫВАЕТ ДЕНЬ: окно с карточками записей, сделанных в этот
// день, — кого, куда и на какое время записали (dayRecordsHtml). Это и есть
// прозрачность топа: любое очко можно открыть и увидеть, за что оно дано. Дни
// до того, как сайт стал запоминать подробности, честно подписываются «до
// обновления» — очки за них остались, рассказать о них нечего.
//
// КАЖДАЯ КАРТОЧКА — ССЫЛКА НА САМУ ЗАПИСЬ (#/records?date=…&station=…): раздел
// записей встаёт на тот день, открывает ту станцию и показывает ту капсулу.
// Иначе проверка «а что это за запись» упиралась бы в ручной поиск по дате и
// адресу, то есть в то же самое недоверие, ради которого затевался список.
// Ссылка — настоящий <a href>: её можно открыть в новой вкладке и скопировать,
// а не только кликнуть.
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

// ── Масштаб ──────────────────────────────────────────────────────────────────
// Три ступени, и заданы они ЧИСЛОМ НЕДЕЛЬ, а не размером клетки: подпись
// «3 месяца» должна означать три месяца на любом экране, а не «сколько влезло
// клеток по 44 пикселя». Размер клетки — следствие: ширина панели делится на
// показанные недели, поэтому на телефоне те же тринадцать колонок просто мельче.
const ZOOMS = [
    { id: 'q', label: '3 месяца', weeks: 13 },
    { id: 'h', label: 'Полгода', weeks: 26 },
    { id: 'y', label: 'Год', weeks: 0 },      // 0 — «сколько есть», без ползунка
];
const ZOOM_KEY = 'cars_db_activity_zoom';
const DEFAULT_ZOOM = 'q';

// Хранится НА УСТРОЙСТВЕ, как тема и акцент: в базе для этого ничего нет.
// Инлайнового скрипта в <head>, как у темы, тоже нет и не нужно — лента
// приезжает вместе с профилем, мигать до загрузки CSS нечему.
function readZoom() {
    try {
        const v = localStorage.getItem(ZOOM_KEY);
        if (ZOOMS.some(z => z.id === v)) return v;
    } catch { /* приватный режим — просто масштаб по умолчанию */ }
    return DEFAULT_ZOOM;
}

function saveZoom(id) {
    try { localStorage.setItem(ZOOM_KEY, id); } catch { /* не критично */ }
}

// Сколько недель показываем. Год короче ступени (у нового аккаунта данных на
// месяц) — показываем что есть, иначе окно оказалось бы шире самой ленты.
function viewWeeks(zoomId, total) {
    const z = ZOOMS.find(x => x.id === zoomId) || ZOOMS[0];
    return Math.max(1, Math.min(z.weeks || total, total));
}

// «10 июня — 7 сентября 2026»: год у первой даты не повторяем, если он тот же.
function periodLabel(from, to) {
    const a = formatDayRu(from);
    const b = formatDayRu(to);
    if (!a || !b) return '';
    return `${a.slice(-4) === b.slice(-4) ? a.slice(0, -5) : a} — ${b}`;
}

// Период показанного окна — по самим датам показанных клеток, а не по
// арифметике «сегодня минус столько-то недель»: крайние колонки добиты до
// недели пустыми местами (дни за границей года), и считать их нельзя.
function periodOfDates(dates) {
    const seen = dates.filter(Boolean);
    return seen.length ? periodLabel(seen[0], seen[seen.length - 1]) : '';
}

export function activityFeedHtml(data) {
    const h = buildHeatmap(data || {});
    if (!h.weeks.length) {
        return `<div class="search-empty">Лента активности пока недоступна</div>`;
    }

    // Последняя подпись, если под неё осталась колонка-другая, ЗАНИМАЕТ ЕЩЁ ДВЕ
    // СЛЕВА и прижимается вправо: окно ленты теперь обрезает всё, что вылезло за
    // край, и «сен» превращался в «се». Одного text-align тут мало — строка
    // всё равно вылезает вправо из узкой колонки, ей нужно место, а не
    // выравнивание. Остальным подписям обрезаться не обо что: они вылезают на
    // соседнюю колонку внутри ленты.
    const months = h.months.map((m, i) => {
        const tail = i === h.months.length - 1 && m.span <= 2;
        const from = tail ? Math.max(1, m.weekIndex - 1) : m.weekIndex + 1;
        const to = tail ? '-1' : `span ${m.span}`;
        return `
        <span class="activity-month${tail ? ' activity-month-end' : ''}"
              style="grid-column: ${from} / ${to}">${esc(m.label)}</span>`;
    }).join('');

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

    // Начальный масштаб проставляется ПРЯМО В РАЗМЕТКЕ, а не после подключения
    // обработчиков: иначе лента на кадр показывала бы весь год и тут же
    // прыгала бы в свои три месяца.
    const total = h.weeks.length;
    const zoomId = readZoom();
    const view = viewWeeks(zoomId, total);
    // Окно стоит в КОНЦЕ года: последняя колонка — текущая неделя. Профиль
    // открывают, чтобы посмотреть, как идут дела сейчас, а не в прошлом ноябре.
    const pan = total - view;
    const zoom = ZOOMS.map(z => `
        <button class="chip chip-sm${z.id === zoomId ? ' active' : ''}"
            data-zoom="${z.id}">${esc(z.label)}</button>`).join('');

    // Колонка Пн/Ср/Пт — отдельным флекс-столбцом слева: её строки тянутся по
    // высоте сетки (клетка квадратная и потому зависит от ширины панели),
    // поэтому фиксированной высоты у подписей быть не может.
    //
    // Недели рисуются ВСЕ, а показывается кусок: .activity-view — окно с
    // overflow, .activity-strip — сама лента, которая под ним едет. Так смена
    // масштаба и ползунок не трогают разметку вовсе, и 365 клеток не рождаются
    // заново на каждое движение мыши.
    return `
        <div class="activity" data-weeks="${total}" style="--weeks:${total}; --view:${view}; --pan:${pan}">
            <div class="activity-head">
                <div class="activity-zoom" data-seg="activity-zoom">${zoom}</div>
                <span class="activity-period">${esc(periodOfDates(h.weeks.slice(pan, pan + view).flat().map(c => c?.date)))}</span>
            </div>
            <div class="activity-cols">
                <div class="activity-side">
                    <div class="activity-side-gap"></div>
                    <div class="activity-weekdays">${WEEKDAY_COLUMN}</div>
                </div>
                <div class="activity-main">
                    <div class="activity-view">
                        <div class="activity-strip">
                            <div class="activity-months">${months}</div>
                            <div class="activity-grid">${cells}</div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="activity-pan${total > view ? '' : ' hidden'}">
                <input type="range" class="activity-range" min="0" max="${Math.max(0, total - view)}"
                       value="${pan}" step="1" aria-label="Показанный период"/>
            </div>
            <div class="activity-legend">
                <span>Меньше</span>${legend}<span>Больше</span>
            </div>
            ${figuresHtml(h)}
        </div>`;
}

// ── Окно дня ─────────────────────────────────────────────────────────────────

// Значки карточки. Свои и инлайновые — как везде на сайте: эмодзи рисует ОС, в
// каждой по-своему, и подогнать его под строку в двенадцать пикселей нельзя.
const SVG = (paths, size = 12) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON_PIN = SVG('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>', 13);
const ICON_PHONE = SVG('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>');
const ICON_CAR = SVG('<path d="M5 17H3v-4l2-5h14l2 5v4h-2"/><path d="M5 13h14"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/>');
const ICON_CLOCK = SVG('<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>');
const ICON_GO = SVG('<line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/>', 13);

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

// Адрес самой записи в разделе «Записи». Номер записи в оригинале известен не
// всегда (его проставляет синк доски), поэтому в ссылку идёт и время: по нему
// раздел находит ту же капсулу, даже когда номера ещё нет.
export function dayRecordHref(r) {
    const p = new URLSearchParams({ date: r.recordDate || '', station: r.stationId || '' });
    if (r.recordTime) p.set('time', r.recordTime);
    if (r.recordId) p.set('record', r.recordId);
    return `#/records?${p}`;
}

// Одна сделанная запись — КАРТОЧКА, а не строка списка: у неё пять разных
// сведений (клиент, телефон, номер машины, станция, время), и строкой они
// читаются как одна длинная фраза, в которой ничего не найти глазами.
// Госномер и телефон показываются как есть: те же данные видны на доске
// записей, а прятать их в окне «за что очки» значило бы прятать само очко.
function dayRecordHtml(r) {
    const end = r.recordTime ? addMinutes(r.recordTime, Number(r.durationMin) || 30) : '';
    const chip = (icon, text, title = '') => `
        <span class="day-chip"${title ? ` title="${esc(title)}"` : ''}>${icon}${esc(text)}</span>`;
    const chips = [
        r.phone ? chip(ICON_PHONE, formatRuPhone(r.phone)) : '',
        r.carNumber ? chip(ICON_CAR, r.carNumber) : '',
        chip(ICON_CLOCK, durationLabel(r.durationMin)),
    ].filter(Boolean).join('');

    return `
        <a class="day-card${r.counted === false ? ' day-card-skip' : ''}" href="${esc(dayRecordHref(r))}"
           title="Открыть эту запись в разделе «Записи»">
            <div class="day-card-head">
                <span class="day-card-station" title="${esc(r.stationTitle || '')}">${ICON_PIN}${esc(r.stationShort || r.stationTitle || `станция ${r.stationId || '?'}`)}</span>
                <span class="day-card-when">${esc(shortDayRu(r.recordDate))}${r.recordTime ? `, ${esc(r.recordTime)}–${esc(end)}` : ''}</span>
            </div>
            <div class="day-card-client">${esc(r.clientName || 'без имени')}</div>
            <div class="day-card-chips">${chips}</div>
            <div class="day-card-foot">
                <span>записано в ${esc(r.madeAt || '')}</span>
                ${r.counted === false
                    ? `<span class="day-card-skip-tag" title="В месячный топ такая запись не идёт">${esc(r.skipLabel || 'не в счёт')}</span>`
                    : ''}
                <span class="day-card-go">Открыть${ICON_GO}</span>
            </div>
        </a>`;
}

// Содержимое окна дня. day — ответ GET /api/profile/day/:date:
// { date, count, skipped, legacy, records }. Чистая функция: тестируется без DOM.
export function dayRecordsHtml(day) {
    const count = Number(day?.count) || 0;
    const records = Array.isArray(day?.records) ? day.records : [];
    const legacy = Number(day?.legacy) || 0;

    // Пусто — только когда нет ни очков, ни записей: день с одной записью
    // мастера очков не даёт, но показать его надо, иначе выйдет, что сайт
    // о своей же незачтённой записи молчит.
    if (!count && !records.length) return `<div class="search-empty">В этот день записей не было</div>`;

    // Все очки дня — со старых времён: рассказать не о чем, и это не поломка.
    if (!records.length) {
        return `
            <div class="day-legacy">
                К сожалению, подробностей нет: ${count === 1 ? 'эта запись была сделана' : `эти ${count} ${recordsWord(count)} были сделаны`}
                до обновления, когда сайт запоминал только число записей, а не сами записи.
            </div>`;
    }
    const list = `<div class="day-cards">${records.map(dayRecordHtml).join('')}</div>`;
    const tail = legacy
        ? `<div class="day-legacy day-legacy-tail">Ещё ${legacy} ${recordsWord(legacy)} за этот день
            ${legacy === 1 ? 'сделана' : 'сделаны'} до обновления — подробностей по ${legacy === 1 ? 'ней' : 'ним'} нет.</div>`
        : '';
    return `${list}${tail}`;
}

// Подпись в шапке окна: сколько очков за день и, отдельным числом, сколько
// записей сделано мимо зачёта. Два числа, а не одно: очки обязаны совпадать с
// подсказкой над квадратом, по которому в окно и зашли.
function dayCountLabel(count, skipped) {
    const head = count ? `${count} ${recordsWord(count)}` : 'без очков';
    return skipped ? `${head} · ещё ${skipped} не в счёт` : head;
}

// Окно с карточками записей за день. loadDay(date) → Promise<day>; окно
// открывается сразу, карточки доезжают. Один экземпляр: повторный клик
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
                    <span class="day-head-count" id="activity-day-count">${esc(dayCountLabel(count, 0))}</span>
                </span>
                <button class="btn btn-sec" id="activity-day-close" aria-label="Закрыть">✕</button>
            </div>
            <div class="modal-body" id="activity-day-body">
                <div class="search-empty">Загрузка…</div>
            </div>
        </div>`;
    document.body.appendChild(modal);

    const close = () => { modal.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    modal.querySelector('.modal-backdrop').onclick = close;
    modal.querySelector('#activity-day-close').onclick = close;
    document.addEventListener('keydown', onKey);

    // Карточка — обычная ссылка, переход делает браузер; наше дело — убрать
    // окно, иначе оно накроет собой раздел записей, на который мы уехали.
    modal.addEventListener('click', (e) => {
        if (e.target.closest('a.day-card')) close();
    });

    if (typeof loadDay !== 'function') return;
    loadDay(date).then((day) => {
        const body = modal.querySelector('#activity-day-body');
        if (body) body.innerHTML = dayRecordsHtml(day);
        const head = modal.querySelector('#activity-day-count');
        if (head) head.textContent = dayCountLabel(Number(day?.count) || 0, Number(day?.skipped) || 0);
    }).catch((err) => {
        const body = modal.querySelector('#activity-day-body');
        if (body) body.innerHTML = `<div class="search-empty">Не удалось загрузить: ${esc(err?.message || err)}</div>`;
    });
}

// ── Масштаб и ползунок ───────────────────────────────────────────────────────
// Двигаем ТОЛЬКО два числа в стиле ленты (--view и --pan), разметку не трогаем:
// ширина ленты и её сдвиг считаются в CSS от них, а клетки, подсказки и
// обработчики остаются те же самые. Перерисовывай мы сетку на каждое движение
// ползунка — 365 узлов рождались бы заново по нескольку раз в секунду.
//
// onPan — «спрятать подсказку»: под курсором после сдвига оказывается другой
// день, а висящая подсказка называла бы старый.
function setupZoom(box, onPan) {
    const total = Number(box.dataset.weeks) || 0;
    const range = box.querySelector('.activity-range');
    const panRow = box.querySelector('.activity-pan');
    const period = box.querySelector('.activity-period');
    const chips = [...box.querySelectorAll('.activity-zoom .chip')];
    const viewport = box.querySelector('.activity-view');
    // Порядок клеток в разметке — колонка за колонкой (grid-auto-flow: column),
    // поэтому день недели i недели w лежит ровно на месте w * 7 + i.
    const cells = [...box.querySelectorAll('.activity-grid .activity-cell')];
    if (!total || !cells.length) return;

    let weeks = viewWeeks(readZoom(), total);
    let pan = total - weeks;

    function apply() {
        const max = Math.max(0, total - weeks);
        pan = Math.min(Math.max(0, pan), max);
        box.style.setProperty('--view', String(weeks));
        box.style.setProperty('--pan', String(pan));
        if (range) {
            range.max = String(max);
            if (Number(range.value) !== pan) range.value = String(pan);
        }
        panRow?.classList.toggle('hidden', max === 0);
        if (period) {
            period.textContent = periodOfDates(
                cells.slice(pan * 7, (pan + weeks) * 7).map(c => c.dataset.date));
        }
    }

    for (const chip of chips) {
        chip.addEventListener('click', () => {
            if (chip.classList.contains('active')) return;
            for (const c of chips) c.classList.toggle('active', c === chip);
            saveZoom(chip.dataset.zoom);
            // Держим СЕРЕДИНУ окна, а не его край: человек смотрел на май —
            // после «Полгода» май должен остаться на экране, а не уехать за
            // границу вместе с прижатым к сегодняшнему дню правым краем.
            const center = pan + weeks / 2;
            weeks = viewWeeks(chip.dataset.zoom, total);
            pan = Math.round(center - weeks / 2);
            apply();
        });
    }

    range?.addEventListener('input', () => {
        pan = Number(range.value) || 0;
        onPan?.();
        apply();
    });

    // Горизонтальное колесо (двумя пальцами по тачпаду) двигает ленту так же,
    // как ползунок. Вертикальное не трогаем вовсе: страница должна
    // прокручиваться сквозь ленту, а не застревать в ней.
    let acc = 0;
    viewport?.addEventListener('wheel', (e) => {
        if (total <= weeks || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
        e.preventDefault();
        const step = viewport.clientWidth / weeks;   // ширина колонки-недели
        if (!(step > 0)) return;
        acc += e.deltaX;
        const move = Math.trunc(acc / step);
        if (!move) return;
        acc -= move * step;
        pan += move;
        onPan?.();
        apply();
    }, { passive: false });

    apply();
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

    // Масштаб и ползунок: подсказку при сдвиге ленты прячем — день под
    // курсором сменился, а она называла бы прежний.
    setupZoom(box, () => hide());

    const grid = box.querySelector('.activity-grid');
    const cellAt = (e) => e.target.closest('.activity-cell:not(.activity-cell-off)');

    grid.addEventListener('mouseover', (e) => {
        const cell = cellAt(e);
        if (cell && cell !== shown) show(cell);
    });
    grid.addEventListener('mouseleave', hide);

    // Клик (и тап на телефоне) открывает день: в окне и дата, и число записей,
    // так что подсказка ему не нужна — убираем её, чтобы не висела под окном.
    // Открываем день ЛЮБОЙ клетки, даже пустой: очков в ней может не быть, а
    // записи — быть (мастер), и молчать о них нельзя.
    grid.addEventListener('click', (e) => {
        const cell = cellAt(e);
        hide();
        if (cell && loadDay) openDayModal(cell, loadDay);
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
