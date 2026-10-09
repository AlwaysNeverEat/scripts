// ─────────────────────────────────────────────────────────────────────────────
// Панель «Поддержали проект» — справа на всех страницах сайта.
//
// Донаты идут на сервер, на котором живёт сайт, и панель отвечает ровно на два
// вопроса: кто помогает и сколько — в этом месяце и за всё время. Порядок — по
// сумме за всё время (sortDonors в shared/donations.js), строки ведут в
// профиль, как строки любого топа.
//
// Панель не должна мешать работе, отсюда три правила:
//   • её можно СВЕРНУТЬ в узкий язычок у правого края, и выбор помнится на
//     устройстве;
//   • по умолчанию она развёрнута, только если справа от контента есть для неё
//     место (окно шире WIDE_ENOUGH), — на ноутбуке она стартует свёрнутой и не
//     наезжает на записи;
//   • на телефоне её нет вовсе (CSS): там некуда её поставить.
//
// Тот же ответ сервера раздаёт список поддержавших значкам у ников
// (setSupporters в nameBadges.js) — второй раз за ним никто не ходит.
// ─────────────────────────────────────────────────────────────────────────────

import { rub, monthLabel, sortDonors } from '../../shared/donations.js';
// Плашку факультета в узкой панели не ставим: она съедала бы имя, а значки
// после ника (галочка, звёздочка) — остаются.
import { nameSuffixHtml } from './namePrefix.js';
import { setSupporters } from './nameBadges.js';
import { profileRowAttrs, bindProfileRows } from './topProfile.js';
import './donorsPanel.css';

const COLLAPSE_KEY = 'zm_donors_collapsed';
const WIDE_ENOUGH = 1620;          // 1040 контента + по 290 с каждой стороны
const REFRESH_MS = 10 * 60 * 1000; // пополнения вносят руками — чаще незачем

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STAR = (s = 14) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 14.6 9l6 .6-4.5 4 1.3 5.9L12 16.6 6.6 19.5l1.3-5.9-4.5-4 6-.6z"/></svg>`;
const CHEVRON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>`;

function loadCollapsed() {
    try {
        const v = localStorage.getItem(COLLAPSE_KEY);
        if (v === '1') return true;
        if (v === '0') return false;
    } catch { /* приватный режим */ }
    return window.innerWidth < WIDE_ENOUGH;
}

function avatarHtml(d) {
    return d.avatar ? `<img src="${esc(d.avatar)}" alt="">` : `<span class="dn-ava-empty">${esc((d.display_name || '?').slice(0, 1))}</span>`;
}

export function initDonorsPanel({ apiFetch }) {
    let root = document.getElementById('donors-panel');
    if (!root) {
        root = document.createElement('aside');
        root.id = 'donors-panel';
        root.className = 'dn';
        root.setAttribute('aria-label', 'Поддержали проект');
        document.body.appendChild(root);
    }
    const state = { donors: [], month: '', status: 'loading', collapsed: loadCollapsed() };
    let timer = null;

    function setCollapsed(v) {
        state.collapsed = v;
        try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'); } catch { /* приватный режим */ }
        render();
    }

    function rowsHtml() {
        if (state.status === 'loading') return '<div class="dn-empty">Загружаю…</div>';
        if (state.status === 'error') return '<div class="dn-empty">Список не загрузился — попробуем позже.</div>';
        if (!state.donors.length) return '<div class="dn-empty">Пока никого. Сервер сайта живёт на донатах — можно стать первым.</div>';
        return `<ol class="dn-list">${state.donors.map((d, i) => `
            <li class="dn-row"${profileRowAttrs(d)}>
                <span class="dn-rank">${i + 1}</span>
                <span class="dn-ava">${avatarHtml(d)}</span>
                <span class="dn-who">
                    <span class="dn-name"><span class="dn-name-t">${esc(d.display_name)}</span>${nameSuffixHtml(d)}</span>
                    <span class="dn-sums"><span title="${esc(monthLabel(state.month))}">${d.month ? `${esc(monthLabel(state.month))} ${rub(d.month)}` : `<span class="dn-muted">${esc(monthLabel(state.month))} —</span>`}</span></span>
                </span>
                <span class="dn-total" title="Всего">${rub(d.total)}</span>
            </li>`).join('')}</ol>`;
    }

    function render() {
        const monthSum = state.donors.reduce((s, d) => s + (d.month || 0), 0);
        root.classList.toggle('dn-collapsed', state.collapsed);
        root.innerHTML = state.collapsed
            ? `<button type="button" class="dn-tab" data-act="toggle" title="Поддержали проект — развернуть">${STAR(15)}<span class="dn-tab-n">${state.donors.length || ''}</span></button>`
            : `<div class="dn-box">
                <div class="dn-head">
                    <span class="dn-title">${STAR(15)} Поддержали проект</span>
                    <button type="button" class="dn-fold" data-act="toggle" title="Свернуть" aria-label="Свернуть">${CHEVRON}</button>
                </div>
                <div class="dn-sub">Донаты идут на сервер, на котором живёт сайт.</div>
                ${rowsHtml()}
                ${state.donors.length ? `<div class="dn-foot"><span>${esc(monthLabel(state.month))}</span><b>${rub(monthSum)}</b></div>` : ''}
            </div>`;
        root.querySelectorAll('[data-act="toggle"]').forEach(b => { b.onclick = () => setCollapsed(!state.collapsed); });
        bindProfileRows(root);
    }

    async function load() {
        try {
            const data = await apiFetch('/api/donors');
            state.donors = sortDonors(data.donors || []);
            state.month = data.month || '';
            state.canManage = !!data.canManage;
            state.status = 'ready';
            setSupporters(state.donors.map(d => d.id));
        } catch {
            if (state.status !== 'ready') state.status = 'error';
        }
        render();
    }

    render();
    load();
    // Внесли пополнение в окне «Пополнения» — показываем сразу, не ждём таймера.
    window.addEventListener('donors-changed', load);
    timer = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);

    return {
        refresh: load,
        destroy() { clearInterval(timer); window.removeEventListener('donors-changed', load); root.remove(); },
    };
}
