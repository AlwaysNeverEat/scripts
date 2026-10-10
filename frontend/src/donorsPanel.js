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
//
// Над списком — блок «Сервер»: сколько ему осталось жить и сколько на счёте,
// из API Рег.облака (backend/src/donations/serverBalance.js). Это ответ на
// вопрос «зачем донатить» цифрой, а не словами. Счётчик тикает вниз сам, раз в
// минуту, от момента, когда приехал ответ: деньги списываются почасово, а
// ходить за ними чаще, чем раз в десять минут, незачем. Свёрнутая панель
// показывает на язычке дни — и краснеет, когда их мало: свёрнутой она бывает
// чаще всего, и именно тогда тревогу легко пропустить.
// ─────────────────────────────────────────────────────────────────────────────

import { rub, monthLabel, sortDonors } from '../../shared/donations.js';
import { hoursLeftAfter, formatLeft, lifeTone } from '../../shared/serverBalance.js';
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
    const state = { donors: [], month: '', status: 'loading', collapsed: loadCollapsed(), server: null, serverAt: 0 };
    let timer = null;
    let tick = null;

    // «Осталось» на эту минуту: сервер посчитал его на момент ответа.
    const hoursNow = () => (state.server?.available ? hoursLeftAfter(state.server.hoursLeft, Date.now() - state.serverAt) : null);

    function serverHtml() {
        const s = state.server;
        if (!s) return '';
        if (!s.available) return `<div class="dn-server dn-server-off">Счёт сервера пока не получен — Рег.облако не ответило.</div>`;
        const h = hoursNow();
        const when = s.stale && s.updatedAt
            ? `<div class="dn-server-note">по данным на ${esc(new Date(s.updatedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))} — Рег.облако не отвечает</div>`
            : '';
        return `
            <div class="dn-server dn-tone-${lifeTone(h)}">
                <div class="dn-server-top">
                    <span class="dn-server-label">Серверу осталось</span>
                    <b class="dn-server-left" data-dn-left>${esc(formatLeft(h))}</b>
                </div>
                <div class="dn-server-meta">
                    ${s.balance != null ? `<span>На счёте <b>${rub(s.balance)}</b></span>` : ''}
                    ${s.bonus ? `<span>бонусы ${rub(s.bonus)}</span>` : ''}
                    ${s.monthlyCost != null ? `<span>${rub(s.monthlyCost)}/мес</span>` : ''}
                </div>
                ${when}
            </div>`;
    }

    // Раз в минуту правим только число — перерисовка панели целиком сбивала
    // бы прокрутку списка и наведение.
    function retick() {
        const h = hoursNow();
        const el = root.querySelector('[data-dn-left]');
        if (el) el.textContent = formatLeft(h);
        const box = root.querySelector('.dn-server');
        if (box && state.server?.available) box.className = `dn-server dn-tone-${lifeTone(h)}`;
        const tab = root.querySelector('[data-dn-tab-left]');
        if (tab) {
            tab.textContent = tabLeft(h);
            tab.className = `dn-tab-left dn-tone-${lifeTone(h)}`;
        }
    }

    // На язычке места на одно короткое слово: дни, а последние сутки — часы.
    const tabLeft = (h) => (h == null ? '' : h >= 24 ? `${Math.floor(h / 24)}д` : `${Math.floor(h)}ч`);

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
            ? `<button type="button" class="dn-tab" data-act="toggle" title="Поддержали проект — развернуть${hoursNow() != null ? ` · серверу осталось ${formatLeft(hoursNow())}` : ''}">${STAR(15)}<span class="dn-tab-n">${state.donors.length || ''}</span>${hoursNow() != null ? `<span class="dn-tab-left dn-tone-${lifeTone(hoursNow())}" data-dn-tab-left>${tabLeft(hoursNow())}</span>` : ''}</button>`
            : `<div class="dn-box">
                <div class="dn-head">
                    <span class="dn-title">${STAR(15)} Поддержали проект</span>
                    <button type="button" class="dn-fold" data-act="toggle" title="Свернуть" aria-label="Свернуть">${CHEVRON}</button>
                </div>
                <div class="dn-sub">Донаты идут на сервер, на котором живёт сайт.</div>
                ${serverHtml()}
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
            state.server = data.server || null;
            state.serverAt = Date.now();
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
    tick = setInterval(retick, 60_000);

    return {
        refresh: load,
        destroy() { clearInterval(timer); clearInterval(tick); window.removeEventListener('donors-changed', load); root.remove(); },
    };
}
