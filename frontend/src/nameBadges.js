// ─────────────────────────────────────────────────────────────────────────────
// Значки ПОСЛЕ ника: галочка модератора и звёздочка поддержавшего проект.
//
// Галочка модератора — SVG, и её анимация играет не всегда, а по наведению и
// по клику, один раз (CSS по классу is-playing, стили — `.nbadge` в
// style.css): значков на странице десятки, и крутящиеся без остановки
// галочки превратили бы список в мигающую гирлянду.
//
// У поддержавшего — наоборот: анимированный камень из набора анимированных
// эмодзи Telegram, и он ИГРАЕТ ВСЕГДА — так попросили (design/badges/README.md).
// Сам файл ужат до 64px: оригинал 512px весил почти мегабайт ради значка в
// двадцать пикселей. Кто в системе попросил меньше движения, видит первый
// кадр — `<picture>` с запросом prefers-reduced-motion.
//
// Звёздочка ставится по СПИСКУ поддержавших, а не по полю в каждом ответе
// сервера: ник рисуют полтора десятка мест сайта, у каждого свой запрос, и
// тащить в каждый сумму донатов незачем. Список приезжает с панелью
// поддержавших (donorsPanel.js) — и уже нарисованные ники дорисовываются сами
// (`setSupporters`), поэтому значок у ника всегда в обёртке с id человека.
// ─────────────────────────────────────────────────────────────────────────────

// Значки нарисованы заново, в линиях сайта: присланные анимации были на
// белом непрозрачном фоне и с волосяной линией — в двадцать пикселей у ника
// они читались серым пятнышком. Формы и движение взяты оттуда же: розетка с
// галочкой (галочка прорисовывается заново, розетка проворачивается) и звезда
// (сжимается, распрямляется, вокруг вспыхивают лучи). Оригиналы —
// design/badges/.
const ROSETTE = 'M12.0 2.0L13.2 2.9L14.2 3.9L15.5 3.5L17.0 3.3L17.6 4.7L17.9 6.1L19.3 6.4L20.7 7.0L20.5 8.5L20.1 9.8L21.1 10.8L22.0 12.0L21.1 13.2L20.1 14.2L20.5 15.5L20.7 17.0L19.3 17.6L17.9 17.9L17.6 19.3L17.0 20.7L15.5 20.5L14.2 20.1L13.2 21.1L12.0 22.0L10.8 21.1L9.8 20.1L8.5 20.5L7.0 20.7L6.4 19.3L6.1 17.9L4.7 17.6L3.3 17.0L3.5 15.5L3.9 14.2L2.9 13.2L2.0 12.0L2.9 10.8L3.9 9.8L3.5 8.5L3.3 7.0L4.7 6.4L6.1 6.1L6.4 4.7L7.0 3.3L8.5 3.5L9.8 3.9L10.8 2.9Z';
const GEM = new URL('./assets/badges/supporter-gem.webp', import.meta.url).href;
const GEM_STILL = new URL('./assets/badges/supporter-gem-still.webp', import.meta.url).href;

// Камень отдельно от значка — для заголовка и язычка панели «Поддержали
// проект» (donorsPanel.js): там он рядом с надписью и ничего не означает сам,
// поэтому без подсказки и пустой alt.
export const gemImgHtml = (px) => `<picture class="gem-pic"><source srcset="${GEM_STILL}" media="(prefers-reduced-motion: reduce)">`
    + `<img src="${GEM}" alt="" width="${px}" height="${px}" decoding="async" draggable="false"></picture>`;

const BADGES = {
    mod: {
        title: 'Модератор',
        svg: `<path class="nb-rosette" d="${ROSETTE}"/><path class="nb-check" pathLength="1" d="M8.2 12.4l2.6 2.6 5-5.2"/>`,
    },
    supporter: {
        title: 'Поддерживает проект — помогает серверу жить',
        img: gemImgHtml(64),
    },
};

// Сколько длится проигрыш — по самой долгой CSS-анимации значка.
const PLAY_MS = 950;

let supporters = new Set();

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const isModerator = (user) => user?.role === 'mod' || user?.role_prefix?.label === 'mod';

function badgeHtml(kind) {
    const b = BADGES[kind];
    return `<span class="nbadge nbadge-${kind}" data-nbadge="${kind}" title="${esc(b.title)}" aria-label="${esc(b.title)}" role="img" tabindex="0">`
        + (b.img || `<svg viewBox="0 0 24 24" aria-hidden="true">${b.svg}</svg>`) + '</span>';
}

function badgesInner(id, mod) {
    return (mod ? badgeHtml('mod') : '') + (id && supporters.has(String(id)) ? badgeHtml('supporter') : '');
}

// Значки после ника. Обёртка ставится всегда, когда известен id: звёздочка
// может приехать позже самого ника (см. шапку).
export function nameSuffixHtml(user) {
    if (!user) return '';
    const mod = isModerator(user);
    const id = user.id ? String(user.id) : '';
    if (!id && !mod) return '';
    return `<span class="nbadges" data-nb-user="${esc(id)}"${mod ? ' data-nb-mod="1"' : ''}>${badgesInner(id, mod)}</span>`;
}

export function setSupporters(ids) {
    const next = new Set((ids || []).map(String));
    const same = next.size === supporters.size && [...next].every(id => supporters.has(id));
    supporters = next;
    if (same || typeof document === 'undefined') return;
    document.querySelectorAll('.nbadges[data-nb-user]').forEach(el => {
        const html = badgesInner(el.dataset.nbUser, el.dataset.nbMod === '1');
        if (el.innerHTML !== html) el.innerHTML = html;
    });
}

// ── Проигрыш по наведению и клику ───────────────────────────────────────────

const timers = new WeakMap();

// Проиграть один раз. Повторное наведение во время проигрыша его не
// перезапускает — значок не должен дёргаться, пока по нему водят мышью.
function play(el) {
    if (el.classList.contains('is-playing')) return;
    el.classList.add('is-playing');
    clearTimeout(timers.get(el));
    timers.set(el, setTimeout(() => el.classList.remove('is-playing'), PLAY_MS));
}

let wired = false;
export function initNameBadges() {
    if (wired || typeof document === 'undefined') return;
    wired = true;
    document.addEventListener('pointerover', (e) => {
        const el = e.target.closest?.('.nbadge');
        if (el && !el.contains(e.relatedTarget)) play(el);
    });
    // Клик по значку только проигрывает его. Ник часто стоит внутри
    // кликабельной строки (топ открывает профиль) — нажатие на значок не
    // должно уводить со страницы, поэтому ловим его на погружении.
    document.addEventListener('click', (e) => {
        const el = e.target.closest?.('.nbadge');
        if (!el) return;
        e.stopPropagation();
        e.preventDefault();
        play(el);
    }, true);
    document.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('nbadge')) {
            e.preventDefault();
            play(e.target);
        }
    });
}
