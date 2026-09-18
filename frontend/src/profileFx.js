// ─────────────────────────────────────────────────────────────────────────────
// Кастомизация профиля: рамки аватара, эффекты обложки и окно магазина.
//
// Все эффекты рисуются ВЁРСТКОЙ и CSS-анимациями (блок «Кастомизация профиля»
// в style.css) — ни одной картинки. Причины две. Своя графика красится темой
// и акцентом: «Неон» у человека с синим акцентом синий, у жёлтого — жёлтый,
// картинка так не умеет. И это наш арт, а не выкачанный из чужого магазина.
//
// Разметка эффекта — чистая функция от id: те же функции рисуют аватар в
// профиле, строку топа и превью в магазине, поэтому эффект везде выглядит
// одинаково. Частицы раскладываются ДЕТЕРМИНИРОВАННО (псевдослучай от номера
// частицы, не Math.random): перерисовка профиля не должна перетасовывать снег.
//
// Ценники пока декорация — валюты нет, всё надевается бесплатно (см. шапку
// shared/profileFx.js). Кнопка покупки появится вместе с валютой.
// ─────────────────────────────────────────────────────────────────────────────

import {
    AVATAR_FX, PROFILE_FX, avatarFxById, profileFxById, normalizeFx,
} from '../../shared/profileFx.js';

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Псевдослучай от номера частицы: одна и та же метель у всех и всегда.
const rnd = (i, salt) => (((i + 1) * 137 + salt * 61) % 100) / 100;

function particles(n, salt, style) {
    let out = '';
    for (let i = 0; i < n; i++) out += `<i style="${style(i, (a) => rnd(i, salt + a))}"></i>`;
    return out;
}

/** Рамка аватара. Вставляется в контейнер с position: relative рядом с кругом. */
export function avatarFxHtml(id) {
    const fx = avatarFxById(id);
    if (!fx) return '';
    let inner = '';
    if (fx.id === 'orbit') inner = '<i></i><i></i>';
    if (fx.id === 'ember') {
        inner = particles(5, 7, (i, r) =>
            `left:${12 + r(1) * 76}%;animation-delay:${(r(2) * 2.4).toFixed(2)}s;animation-duration:${(1.6 + r(3) * 1.4).toFixed(2)}s`);
    }
    return `<span class="afx afx-${esc(fx.id)}" aria-hidden="true">${inner}</span>`;
}

/** Эффект обложки. Вставляется в .profile-cover (у неё overflow за счёт hero). */
export function profileFxHtml(id) {
    const fx = profileFxById(id);
    if (!fx) return '';
    let inner = '';
    switch (fx.id) {
        case 'snow':
            inner = particles(14, 1, (i, r) =>
                `left:${(r(1) * 98).toFixed(1)}%;animation-delay:${(-r(2) * 7).toFixed(2)}s;animation-duration:${(4.5 + r(3) * 4).toFixed(2)}s;transform:scale(${(0.6 + r(4) * 0.8).toFixed(2)})`);
            break;
        case 'rain':
            inner = particles(16, 2, (i, r) =>
                `left:${(r(1) * 100).toFixed(1)}%;animation-delay:${(-r(2) * 1.4).toFixed(2)}s;animation-duration:${(0.7 + r(3) * 0.5).toFixed(2)}s;opacity:${(0.35 + r(4) * 0.4).toFixed(2)}`);
            break;
        case 'stars':
            inner = particles(15, 3, (i, r) =>
                `left:${(r(1) * 98).toFixed(1)}%;top:${(r(2) * 85).toFixed(1)}%;animation-delay:${(-r(3) * 3).toFixed(2)}s;animation-duration:${(1.8 + r(4) * 2.4).toFixed(2)}s`)
                + '<b class="pfx-shoot" aria-hidden="true"></b>';
            break;
        case 'fireflies':
            inner = particles(9, 4, (i, r) =>
                `left:${(5 + r(1) * 90).toFixed(1)}%;top:${(15 + r(2) * 70).toFixed(1)}%;animation-delay:${(-r(3) * 6).toFixed(2)}s;animation-duration:${(4 + r(4) * 4).toFixed(2)}s`);
            break;
        case 'confetti':
            inner = particles(16, 5, (i, r) =>
                `left:${(r(1) * 98).toFixed(1)}%;animation-delay:${(-r(2) * 4).toFixed(2)}s;animation-duration:${(2.6 + r(3) * 2.2).toFixed(2)}s;--cf-h:${Math.round(r(4) * 360)}`);
            break;
        case 'aurora':
            inner = '<i></i><i></i><i></i>';
            break;
    }
    return `<span class="pfx pfx-${esc(fx.id)}" aria-hidden="true">${inner}</span>`;
}

// ── Окно магазина ────────────────────────────────────────────────────────────

const MODAL_ID = 'fx-shop-modal';

// Монетка у ценника — свой SVG, как все значки сайта (см. icons.js): эмодзи
// рисует ОС и не красится ни темой, ни акцентом.
const COIN = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="6.4"/><circle cx="8" cy="8" r="2.6"/></svg>`;

function cardHtml(kind, fx, currentId) {
    const on = fx.id === currentId;
    const prev = kind === 'avatar'
        ? `<span class="fxshop-ava">${avatarFxHtml(fx.id)}</span>`
        : `<span class="fxshop-cover">${profileFxHtml(fx.id)}</span>`;
    return `
        <button type="button" class="fxshop-card${on ? ' is-on' : ''}" data-fx-kind="${kind}" data-fx-id="${esc(fx.id)}"
                title="${esc(fx.about || '')}">
            <span class="fxshop-prev">${prev}</span>
            <span class="fxshop-name">${esc(fx.name)}</span>
            <span class="fx-price">${fx.price}${COIN}</span>
            <span class="fxshop-state">${on ? 'Надето — снять' : 'Надеть'}</span>
        </button>`;
}

/**
 * Магазин: две полки — рамки и эффекты. Клик по карточке надевает эффект (или
 * снимает уже надетый), выбор сразу уезжает на сервер (POST /api/profile/fx).
 * onChanged(fx) зовётся после каждого сохранения — профиль перерисовывает
 * обложку, не перечитывая себя целиком.
 */
export function openFxShop({ apiFetch, fx, onChanged }) {
    document.getElementById(MODAL_ID)?.remove();

    let current = normalizeFx(fx);

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-backdrop"></div>
        <div class="modal-win fxshop-win">
            <div class="modal-head">
                <span>Магазин</span>
                <button class="btn btn-sec" id="fxshop-close">✕</button>
            </div>
            <div class="modal-body">
                <div class="pset-head"><span class="pset-title">Рамка аватара</span></div>
                <div class="fxshop-grid" id="fxshop-avatar"></div>
                <div class="pset-head fxshop-sec"><span class="pset-title">Эффект обложки</span></div>
                <div class="fxshop-grid" id="fxshop-profile"></div>
                <div class="accent-note fxshop-note">
                    Цены пока примерочные: валюта ещё не завезена, всё надевается
                    бесплатно. Заработанное здесь однажды станет тратиться здесь же.
                </div>
                <div id="fxshop-error" class="edit-error hidden"></div>
            </div>
        </div>`;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('.modal-backdrop').onclick = close;
    modal.querySelector('#fxshop-close').onclick = close;
    const errBox = modal.querySelector('#fxshop-error');

    function renderShelves() {
        modal.querySelector('#fxshop-avatar').innerHTML =
            AVATAR_FX.map(f => cardHtml('avatar', f, current.avatar)).join('');
        modal.querySelector('#fxshop-profile').innerHTML =
            PROFILE_FX.map(f => cardHtml('profile', f, current.profile)).join('');
    }
    renderShelves();

    let saving = false;
    modal.addEventListener('click', async (e) => {
        const card = e.target.closest('.fxshop-card');
        if (!card || saving) return;
        const kind = card.dataset.fxKind;
        const id = card.dataset.fxId;
        // Повторный клик по надетому — снять: отдельной кнопки «снять» не
        // нужно, состояние и так написано на карточке.
        const next = { ...current, [kind]: current[kind] === id ? null : id };
        saving = true;
        errBox.classList.add('hidden');
        try {
            const resp = await apiFetch('/api/profile/fx', { method: 'POST', body: next });
            current = normalizeFx(resp.fx);
            renderShelves();
            onChanged?.(current);
        } catch (err) {
            errBox.textContent = `Не удалось сохранить: ${err.message}`;
            errBox.classList.remove('hidden');
        }
        saving = false;
    });
}
