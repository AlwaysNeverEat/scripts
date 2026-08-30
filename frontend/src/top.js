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

let cache = null;   // последний успешный ответ /api/top

export function resetTopCache() { cache = null; }

export async function showTopPage({ apiFetch }) {
    const body = document.getElementById('top-body');
    if (!body) return;

    if (cache) render(body, cache);
    else body.innerHTML = '<div class="search-empty">Загрузка…</div>';

    try {
        cache = await apiFetch('/api/top');
    } catch (err) {
        if (!cache) body.innerHTML = `<div class="search-empty">Ошибка: ${esc(err.message)}</div>`;
        return; // есть кеш — оставляем его на экране
    }
    // Пока ходили на сервер, могли уйти на другую вкладку — рисуем всё равно:
    // страница скрыта, но при возврате будет уже свежей.
    render(body, cache);
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
            <div class="top-prev-head">${icons.award(14)}Топ в прошлом месяце${label ? ` · ${esc(label)}` : ''}</div>
            ${names}
        </div>`;
}

function render(body, data) {
    const rows = data.rows || [];
    const previous = data.previous || null;
    const label = monthLabel(data.month);

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
        : '<div class="search-empty">В этом месяце записей ещё никто не сделал</div>';

    body.innerHTML = previousHtml(previous)
        + (label ? `<div class="top-month">${esc(label)}</div>` : '')
        + listHtml;

    // Переходы в профиль — общие с мини-топами пасхалок (topProfile.js):
    // закрывать тут нечего, вкладка «Топ» и так обычная страница.
    bindProfileRows(body);
}
