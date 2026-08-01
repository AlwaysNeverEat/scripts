// ─────────────────────────────────────────────────────────────────────────────
// Вкладка «Что нового?»: посты об изменениях сайта (newsData.js).
//
// Непрочитанное. Прочитанные посты запоминаются списком id в localStorage —
// не «датой последнего визита»: посты можно править и переставлять, а список id
// от этого не врёт, и удалённый пост не делает всю ленту снова непрочитанной.
// Счётчик на вкладке гаснет в тот момент, когда вкладку открыли (main.js
// вызывает markNewsSeen), но плашка «новое» у самих постов остаётся до ухода
// со вкладки — иначе непонятно, что именно было новым.
//
// Оформление — только inline SVG, без эмодзи (как в фиде скриптов).
// ─────────────────────────────────────────────────────────────────────────────

import { NEWS_POSTS } from './newsData.js';

const SEEN_KEY = 'news_seen_post_ids';

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Прочитанное ──────────────────────────────────────────────────────────────

function readSeen() {
    try {
        const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
        return new Set(Array.isArray(raw) ? raw.filter(v => typeof v === 'string') : []);
    } catch {
        return new Set(); // мусор в хранилище — считаем, что не читали ничего
    }
}

function writeSeen(ids) {
    // Храним только существующие посты: список не растёт от удалённых.
    const alive = NEWS_POSTS.map(p => p.id).filter(id => ids.has(id));
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(alive)); } catch { /* приватный режим */ }
}

export function unseenNewsCount() {
    const seen = readSeen();
    return NEWS_POSTS.filter(p => !seen.has(p.id)).length;
}

// Вкладку открыли — весь непрочитанный список считается прочитанным.
export function markNewsSeen() {
    const seen = readSeen();
    let changed = false;
    for (const p of NEWS_POSTS) if (!seen.has(p.id)) { seen.add(p.id); changed = true; }
    if (changed) writeSeen(seen);
    return changed;
}

// ── Иконки ───────────────────────────────────────────────────────────────────
// id из newsData.js → inline SVG. Незнакомый id рисуется точкой-маркером,
// чтобы новый пост не остался без оформления.

const SVG_HEAD = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"'
    + ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

const ICONS = {
    link: `${SVG_HEAD}<path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L10.6 5.24"/><path d="M14 11a5 5 0 0 0-7.07 0L4.8 13.12a5 5 0 0 0 7.07 7.07L13.4 18.76"/></svg>`,
    refresh: `${SVG_HEAD}<polyline points="21 4 21 10 15 10"/><path d="M18.5 15a7.5 7.5 0 1 1-1.77-7.8L21 10"/></svg>`,
    exit: `${SVG_HEAD}<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
    devices: `${SVG_HEAD}<rect x="2" y="4" width="13" height="10" rx="2"/><path d="M5 18h7"/><rect x="16" y="9" width="6" height="11" rx="1.5"/></svg>`,
    shield: `${SVG_HEAD}<path d="M12 3l7 3v5.5c0 4.2-2.9 7.9-7 9.5-4.1-1.6-7-5.3-7-9.5V6l7-3z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="16" x2="12" y2="16"/></svg>`,
    key: `${SVG_HEAD}<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3"/><path d="M17 6l3 3"/><path d="M14.5 8.5l2.5 2.5"/></svg>`,
    lock: `${SVG_HEAD}<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><line x1="12" y1="14" x2="12" y2="17"/></svg>`,
    bell: `${SVG_HEAD}<path d="M18 15V10a6 6 0 1 0-12 0v5l-1.6 2.4A1 1 0 0 0 5.2 19h13.6a1 1 0 0 0 .8-1.6L18 15z"/><path d="M9.5 22a2.6 2.6 0 0 0 5 0"/></svg>`,
    dot: `${SVG_HEAD}<circle cx="12" cy="12" r="4"/></svg>`,
};

const ICON_NEW = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 14.3 9l5.7.5-4.3 3.9 1.2 5.7L12 16.2 7.1 19.1l1.2-5.7L4 9.5 9.7 9z"/></svg>`;
const ICON_CALENDAR = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;

// ── Рендер ───────────────────────────────────────────────────────────────────

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// '2026-07-29' → '29 июля 2026'. Разбираем строкой, а не через Date: часовой
// пояс браузера не должен сдвигать дату поста на сутки назад.
function humanDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    const month = MONTHS[Number(m[2]) - 1] || '';
    return `${Number(m[3])} ${month} ${m[1]}`;
}

function sectionHtml(sec) {
    const icon = ICONS[sec.icon] || ICONS.dot;
    const list = Array.isArray(sec.list) && sec.list.length
        ? `<ul class="news-list">${sec.list.map(li => `<li>${esc(li)}</li>`).join('')}</ul>`
        : '';
    return `
        <section class="news-sec">
            <div class="news-sec-icon">${icon}</div>
            <div class="news-sec-body">
                <h4 class="news-sec-title">${esc(sec.title)}</h4>
                <p class="news-sec-text">${esc(sec.text)}</p>
                ${list}
            </div>
        </section>`;
}

function postHtml(post, isNew) {
    return `
        <article class="news-post${isNew ? ' news-post-new' : ''}">
            <header class="news-post-head">
                <div class="news-post-meta">
                    ${post.tag ? `<span class="news-tag">${esc(post.tag)}</span>` : ''}
                    <span class="news-date">${ICON_CALENDAR}${esc(humanDate(post.date))}</span>
                    ${isNew ? `<span class="news-new">${ICON_NEW}новое</span>` : ''}
                </div>
                <h3 class="news-post-title">${esc(post.title)}</h3>
                ${post.lead ? `<p class="news-post-lead">${esc(post.lead)}</p>` : ''}
            </header>
            ${(post.sections || []).map(sectionHtml).join('')}
        </article>`;
}

// Собираем при каждом заходе: плашки «новое» зависят от того, что уже прочитано.
export function initNewsFeed() {
    const body = document.getElementById('news-body');
    if (!body) return;
    if (!NEWS_POSTS.length) {
        body.innerHTML = '<div class="search-empty">Пока новостей нет.</div>';
        return;
    }
    const seen = readSeen();
    body.innerHTML = NEWS_POSTS.map(p => postHtml(p, !seen.has(p.id))).join('');
}
