// ─────────────────────────────────────────────────────────────────────────────
// Значки ПОСЛЕ ника: галочка модератора и звёздочка поддержавшего проект.
//
// Значок — анимация, но играет она не всегда, а по наведению и по клику, один
// раз. Значков на странице бывает десятки (топ, мини-топы игр), и
// крутящиеся без остановки галочки превратили бы список в мигающую гирлянду.
// Поэтому в разметке лежит СТАТИЧНАЯ картинка — первый кадр анимации, — а
// видео создаётся только на время проигрыша и убирается после: держать по
// видео на каждый ник — это десятки декодеров ради того, на что никто не
// смотрит. Картинки и их происхождение — design/badges/README.md.
//
// Анимации присланы на БЕЛОМ непрозрачном фоне. Статичная картинка из неё
// сделана честно прозрачной, а у видео белый фон убирает смешивание: в
// светлой теме multiply (белое исчезает), в тёмной — инверсия цвета (чёрные
// линии становятся белыми, фон — чёрным) и screen (чёрное исчезает).
//
// Звёздочка ставится по СПИСКУ поддержавших, а не по полю в каждом ответе
// сервера: ник рисуют полтора десятка мест сайта, у каждого свой запрос, и
// тащить в каждый сумму донатов незачем. Список приезжает с панелью
// поддержавших (donorsPanel.js) — и уже нарисованные ники дорисовываются сами
// (`setSupporters`), поэтому значок у ника всегда в обёртке с id человека.
// ─────────────────────────────────────────────────────────────────────────────

const BADGES = {
    mod: {
        title: 'Модератор',
        img: new URL('./assets/badges/mod.png', import.meta.url).href,
        video: new URL('./assets/badges/mod.webm', import.meta.url).href,
    },
    supporter: {
        title: 'Поддерживает проект — помогает серверу жить',
        img: new URL('./assets/badges/supporter.png', import.meta.url).href,
        video: new URL('./assets/badges/supporter.webm', import.meta.url).href,
    },
};

let supporters = new Set();

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const isModerator = (user) => user?.role === 'mod' || user?.role_prefix?.label === 'mod';

function badgeHtml(kind) {
    const b = BADGES[kind];
    return `<span class="nbadge nbadge-${kind}" data-nbadge="${kind}" title="${esc(b.title)}" aria-label="${esc(b.title)}" role="img" tabindex="0">`
        + `<img src="${b.img}" alt="" draggable="false"></span>`;
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

function play(el) {
    if (el.querySelector('video')) return; // уже играет — не перезапускаем
    const b = BADGES[el.dataset.nbadge];
    if (!b) return;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = b.video;
    const done = () => { el.classList.remove('is-playing'); v.remove(); };
    // Картинку прячем, только когда видео реально пошло: иначе на медленной
    // сети значок на миг пропадал бы целиком.
    v.addEventListener('playing', () => el.classList.add('is-playing'), { once: true });
    v.addEventListener('ended', done, { once: true });
    v.addEventListener('error', done, { once: true });
    el.appendChild(v);
    v.play().catch(done);
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
