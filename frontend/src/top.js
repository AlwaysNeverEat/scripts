// ─────────────────────────────────────────────────────────────────────────────
// Вкладка «Топ»: рейтинг по числу СДЕЛАННЫХ ЗАПИСЕЙ за текущий месяц.
// Эмодзи запрещены — только инлайновые SVG из records/icons.js.
// 1-е место — золотая плашка, по которой раз в 5.5 с проходит блик: и по
// фону строки, и по буквам номера/имени/счёта (.top-row-gold, .gold-text
// в style.css).
//
// Месяц закрывается сам: 1-го числа список начинается с нуля, а над ним
// остаётся карточка «Топ в прошлом месяце» — кто был первым к концу месяца
// (данные считает backend/src/routes/top.js). Одна запись = один балл,
// длинная (продлённая) запись — тоже один.
//
// Прошлые месяцы открываются ЦЕЛИКОМ: стрелки у подписи месяца листают их, а
// «Вся таблица» на карточке прошлого месяца ведёт сразу туда. Карточка
// называет только победителя, а спор «какое место было у меня» решается
// таблицей, а не памятью. Листание только читает: сервер считает прошлый
// месяц из тех же строк record_credits, что и в его последний день, —
// обнулять, закрывать или переносить там нечего.
//
// Под списком — правила зачёта (rulesHtml): что считается, что нет и где
// посмотреть, за какие записи даны очки. Топ обещает прозрачность, и правила
// у него на виду, а не в новостях: строка любого человека ведёт в профиль, а
// клик по дню в ленте активности открывает сами записи.
//
// Последний ответ держим в кеше: возврат на вкладку показывает готовый список
// сразу, а свежие цифры доезжают фоном и подменяют его без «Загрузка…».
// ─────────────────────────────────────────────────────────────────────────────

import { icons } from './records/icons.js';
// Склонение «запись/записи/записей» общее с лентой активности в профиле —
// цифры там и тут считаются по одному источнику (record_credits).
import { recordsWord } from '../../shared/activityHeatmap.js';
import { namePrefixHtml, facultyClass } from './namePrefix.js';
import { profileRowAttrs, bindProfileRows } from './topProfile.js';

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function avatarHtml(row) {
    return row.avatar
        ? `<img src="${esc(row.avatar)}" alt=""/>`
        : `<span class="top-avatar-default"></span>`;
}

// 'YYYY-MM' → «июль 2026»
function monthLabel(month) {
    const m = String(month || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return '';
    const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
    return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '');
}

// Правая колонка: крупно число записей, под ним слово с правильным окончанием.
// gold — первая строка: по цифре идёт блик (.gold-text в style.css).
function countHtml(row, gold) {
    return `
        <div class="top-count">
            <span class="top-score${gold ? ' gold-text' : ''}">${row.records}</span>
            <span class="top-breakdown">${recordsWord(row.records)}</span>
        </div>`;
}

// Последние ответы /api/top по месяцам. Ключ '' — «текущий», без параметра:
// 1-го числа текущим становится другой месяц, и спрашивать его по имени,
// запомненному вчера, значило бы открыть вкладку на прошлом месяце.
const cache = new Map();
let viewMonth = '';  // '' — текущий месяц, иначе 'YYYY-MM'
let fetchApi = null;

export function resetTopCache() { cache.clear(); viewMonth = ''; }

// Заход на вкладку всегда открывает ТЕКУЩИЙ месяц: полистали август, ушли и
// вернулись — ждут сегодняшнего рейтинга, а не того, где остановились.
export function showTopPage({ apiFetch }) {
    fetchApi = apiFetch;
    viewMonth = '';
    return load();
}

async function load() {
    const body = document.getElementById('top-body');
    if (!body) return;
    bindMonthNav(body);

    const key = viewMonth;
    if (cache.has(key)) render(body, cache.get(key));
    else body.innerHTML = '<div class="search-empty">Загрузка…</div>';

    let data;
    try {
        data = await fetchApi('/api/top' + (key ? `?month=${encodeURIComponent(key)}` : ''));
    } catch (err) {
        if (key === viewMonth && !cache.has(key)) {
            body.innerHTML = `<div class="search-empty">Ошибка: ${esc(err.message)}</div>`;
        }
        return; // есть кеш — оставляем его на экране
    }
    cache.set(key, data);
    // Пока ходили на сервер, могли пролистать дальше — чужой ответ в кеш, но
    // не на экран. А вот уход на другую вкладку рисованию не мешает: страница
    // скрыта, но при возврате будет уже свежей.
    if (key === viewMonth) render(body, data);
}

function openMonth(month, current) {
    const key = !month || month === current ? '' : month;
    if (key === viewMonth) return;
    viewMonth = key;
    load();
}

// Один обработчик на контейнер, а не на кнопки: body.innerHTML
// пересобирается на каждый ответ, и кнопки каждый раз новые.
function bindMonthNav(body) {
    if (body.dataset.monthNav) return;
    body.dataset.monthNav = '1';
    body.addEventListener('click', e => {
        const btn = e.target.closest('[data-top-month]');
        if (!btn || btn.disabled || !body.contains(btn)) return;
        openMonth(btn.dataset.topMonth, btn.dataset.topCurrent);
    });
}

// Карточка над списком: победитель(и) прошлого месяца. Если в прошлом месяце
// записей не делали вовсе — карточки нет, незачем занимать экран пустотой.
function previousHtml(previous) {
    const winners = previous?.winners || [];
    if (!winners.length) return '';
    const label = monthLabel(previous.month);
    const names = winners.map(w => `
        <div class="top-prev-user"${profileRowAttrs(w)}>
            <div class="top-avatar">${avatarHtml(w)}</div>
            <div class="top-prev-name">${namePrefixHtml(w)}${esc(w.display_name)}</div>
            <span class="top-prev-count">${w.records}&nbsp;${recordsWord(w.records)}</span>
        </div>`).join('');
    return `
        <div class="top-prev">
            <div class="top-prev-head">
                ${icons.award(14)}<span class="top-prev-title">Топ в прошлом месяце${label ? ` · ${esc(label)}` : ''}</span>
                <button type="button" class="top-prev-all" data-top-month="${esc(previous.month)}">Вся таблица${icons.chevronRight(12)}</button>
            </div>
            ${names}
        </div>`;
}

// Правила зачёта — текст, а не ссылка «подробнее»: их ровно четыре, и
// прочитать их здесь быстрее, чем искать пост.
function rulesHtml() {
    return `
        <div class="top-rules">
            <div class="top-rules-head">${icons.list(13)}Как считается</div>
            <ul>
                <li>Одна сделанная запись — одно очко, какой бы длины она ни была. Продление
                    своей же записи (слоты встык к записи того же клиента) — не новая запись.</li>
                <li>Запись с «телефоном» из одной и той же цифры (+7 111 111-11-11 и подобные)
                    в счёт не идёт.</li>
                <li>Запись, помеченная в окне создания переключателем «запись мастера», очка не даёт —
                    её завёл мастер со станции, а не оператор. На доске и в профиле она остаётся
                    видна с пометкой «не в счёт»: автор у неё есть, просто в рейтинг она не идёт.</li>
                <li>Очко даётся, когда запись реально встала в админку. Перенос, правка и
                    удаление очки не снимают: работа уже была сделана.</li>
                <li>За что даны очки, видно у каждого: откройте профиль и нажмите на день в
                    ленте активности — там карточки записей с клиентом, станцией и временем, и
                    каждая открывает саму запись в разделе «Записи».
                    Подробнее — во вкладке <a href="/news">Новости</a>.</li>
            </ul>
        </div>`;
}

// Подпись месяца со стрелками. Листаются только месяцы, где кто-то получил
// очко (и текущий), — пустой март между двумя полными не нужен никому.
// Стрелки не прячутся на краях, а гаснут: исчезающая кнопка сдвигает подпись,
// и следующий клик попадает мимо.
function monthNavHtml(data) {
    const current = data.current || data.month;
    const months = data.months?.length ? data.months : [data.month];
    const i = months.indexOf(data.month);
    const older = i >= 0 ? months[i + 1] : undefined;
    const newer = i > 0 ? months[i - 1] : undefined;
    const label = monthLabel(data.month);
    const past = data.month !== current;
    const btn = (month, icon, title) => `
        <button type="button" class="top-month-btn" title="${title}"
            data-top-month="${esc(month || '')}" data-top-current="${esc(current)}"${month ? '' : ' disabled'}>${icon}</button>`;
    return `
        <div class="top-month-nav">
            ${btn(older, icons.chevronLeft(16), 'Предыдущий месяц')}
            <div class="top-month">${esc(label)}${past ? ' · итог' : ''}</div>
            ${btn(newer, icons.chevronRight(16), 'Следующий месяц')}
        </div>`;
}

function render(body, data) {
    const rows = data.rows || [];
    const past = data.current && data.month !== data.current;
    // Карточка победителя прошлого месяца — только над текущим: над самой
    // таблицей прошлого месяца она повторяла бы её первую строку.
    const previous = past ? null : (data.previous || null);

    // Имя всегда в отдельном span: блик по буквам (background-clip: text)
    // должен резать только само имя, но не плашку роль-префикса рядом.
    const listHtml = rows.length
        ? rows.map(row => {
            const gold = row.rank === 1;
            const t = gold ? ' gold-text' : '';
            // Подложка строки — цвета факультета, но ТОЛЬКО не у первого места:
            // золото ни с чем не делится (правило .top-row.faculty-tint в
            // style.css отключено на .top-row-gold, класс тут не мешает).
            return `
            <div class="top-row ${gold ? 'top-row-gold' : ''}${facultyClass(row.faculty, 'faculty-tint')}"${profileRowAttrs(row)}>
                <span class="top-rank${t}">${row.rank}</span>
                <div class="top-avatar">${avatarHtml(row)}</div>
                <div class="top-name">${namePrefixHtml(row)}<span class="${t.trim()}">${esc(row.display_name)}</span></div>
                ${countHtml(row, gold)}
            </div>`;
        }).join('')
        : `<div class="search-empty">${past
            ? 'В этом месяце записей не было'
            : 'В этом месяце записей ещё никто не сделал'}</div>`;

    body.innerHTML = previousHtml(previous)
        + monthNavHtml(data)
        + listHtml
        + rulesHtml();

    // Переходы в профиль — общие с мини-топами пасхалок (topProfile.js):
    // закрывать тут нечего, вкладка «Топ» и так обычная страница.
    bindProfileRows(body);
}
