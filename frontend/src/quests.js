// ─────────────────────────────────────────────────────────────────────────────
// Задания в своём профиле: три дневных по играм и одно недельное по работе.
// Правила и тексты — shared/quests.js, прогресс считает сервер
// (/api/quests), окно только рисует его и забирает награду.
//
// Прогресс НЕ живой: партия идёт в окне игры поверх профиля, и опрашивать
// сервер, пока человек играет, незачем. Панель перечитывается, когда окно
// игры закрылось (класс modal-open ушёл с <body>) и когда вкладка снова стала
// видимой, — ровно в те моменты, когда на неё снова смотрят.
//
// Забранный опыт уходит в тот же кошелёк, что у кейсов, поэтому после
// «Забрать» панель кейсов перечитывает себя по событию wallet:changed.
// ─────────────────────────────────────────────────────────────────────────────

import './quests.css';
import { GAME_ICONS, openGameById } from './games.js';
import { toast } from './cases.js';
import { plural } from '../../shared/quests.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const svg = (body, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const checkIcon = (s) => svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', s);
const playIcon = (s) => svg('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>', s);
const carIcon = (s) => svg('<path d="M5 16.5h14M6.5 16.5v2M17.5 16.5v2M4.5 16.5V13l2-5h11l2 5v3.5"/><path d="M4.5 13h15"/><circle cx="8" cy="14.8" r=".6" fill="currentColor"/><circle cx="16" cy="14.8" r=".6" fill="currentColor"/>', s);
const calIcon = (s) => svg('<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/><path d="M8 14l2.5 2.5L16 12"/>', s);

// «через 7 ч 12 мин» / «через 2 дн 5 ч» — сколько осталось до смены.
function leftLabel(iso, now = Date.now()) {
    const ms = Math.max(0, Date.parse(iso) - now);
    const min = Math.floor(ms / 60000);
    const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
    if (d > 0) return `${d} ${plural(d, 'день', 'дня', 'дней')} ${h} ч`;
    if (h > 0) return `${h} ч ${m} мин`;
    return `${Math.max(1, m)} мин`;
}

export function mountQuests(host, { apiFetch, user }) {
    if (!host) return;
    host._questsOff?.abort();
    const off = new AbortController();
    host._questsOff = off;
    const state = { data: null, status: 'loading', error: '', busy: '' };

    async function load() {
        try {
            state.data = await apiFetch('/api/quests');
            state.status = 'ready';
        } catch (e) {
            if (!state.data) { state.status = 'error'; state.error = e.message || 'сервер не ответил'; }
        }
        render();
    }

    function buttonHtml(q, kind) {
        if (q.claimed) return `<span class="qt-got">${checkIcon(16)}Получено</span>`;
        if (q.done) {
            const busy = state.busy === `${kind}:${q.slot}`;
            return `<button class="btn btn-pri qt-claim" data-claim="${kind}" data-slot="${q.slot}" ${busy ? 'disabled' : ''}>
                ${busy ? 'Забираю…' : `Забрать ${q.xp} опыта`}</button>`;
        }
        if (kind === 'daily') return `<button class="btn btn-sec qt-play" data-play="${esc(q.game)}">${playIcon(14)}Играть</button>`;
        return '';
    }

    function barHtml(q) {
        const pct = Math.round(Math.min(1, Math.max(0, q.frac)) * 100);
        return `
            <div class="qt-progress">
                <span class="qt-bar${q.done ? ' qt-bar-done' : ''}"><i style="width:${pct}%"></i></span>
                <span class="qt-label">${esc(q.label)}</span>
            </div>`;
    }

    function dailyHtml(q) {
        const icon = GAME_ICONS[q.game];
        return `
        <div class="qt-card${q.done ? ' qt-done' : ''}${q.claimed ? ' qt-claimed' : ''}">
            <div class="qt-head">
                ${icon ? `<img class="qt-icon" src="${icon}" alt="" width="44" height="44" draggable="false">` : ''}
                <div class="qt-head-text">
                    <span class="qt-game">${esc(q.gameLabel)}</span>
                    <span class="qt-xp">+${q.xp} опыта</span>
                </div>
            </div>
            <p class="qt-text">${esc(q.text)}</p>
            ${barHtml(q)}
            <div class="qt-foot">${buttonHtml(q, 'daily')}</div>
        </div>`;
    }

    function weeklyHtml(q, d) {
        // Кнопка у недельного бывает только «Забрать»: «Играть» тут некуда.
        // Пустая колонка под неё отъедала бы ширину у полосы прогресса.
        const foot = buttonHtml(q, 'weekly');
        return `
        <div class="qt-week${foot ? ' qt-week-with-foot' : ''}${q.done ? ' qt-done' : ''}${q.claimed ? ' qt-claimed' : ''}">
            <div class="qt-week-ico">${q.kind === 'cars' ? carIcon(30) : calIcon(30)}</div>
            <div class="qt-week-body">
                <div class="qt-week-top">
                    <span class="qt-game">Задание недели · сменится через ${esc(leftLabel(d.weekResetAt))}</span>
                    <span class="qt-xp qt-xp-big">+${q.xp} опыта</span>
                </div>
                <p class="qt-text qt-week-text">${esc(q.text)}</p>
                <span class="qt-note">${esc(q.note)}</span>
                ${barHtml(q)}
            </div>
            ${foot ? `<div class="qt-foot qt-week-foot">${foot}</div>` : ''}
        </div>`;
    }

    function render() {
        if (state.status === 'loading') { host.innerHTML = '<div class="qt-wait">Загружаю задания…</div>'; return; }
        if (state.status === 'error') {
            host.innerHTML = `<div class="qt-wait">Задания не загрузились: ${esc(state.error)} <button class="btn btn-sec" data-retry>Ещё раз</button></div>`;
            return;
        }
        const d = state.data;
        host.innerHTML = `
            <div class="qt-sub">
                <span>Задания дня</span>
                <span class="qt-reset">новые через ${esc(leftLabel(d.resetAt))}</span>
            </div>
            <div class="qt-grid">${d.daily.map(dailyHtml).join('')}</div>
            ${d.weekly ? weeklyHtml(d.weekly, d) : ''}`;
    }

    host.addEventListener('click', async (e) => {
        if (e.target.closest('[data-retry]')) { state.status = 'loading'; render(); load(); return; }
        const play = e.target.closest('[data-play]');
        if (play) { openGameById(play.dataset.play, { apiFetch, user }).catch(() => {}); return; }
        const btn = e.target.closest('[data-claim]');
        if (!btn || state.busy) return;
        const kind = btn.dataset.claim, slot = Number(btn.dataset.slot);
        state.busy = `${kind}:${slot}`;
        render();
        try {
            const res = await apiFetch('/api/quests/claim', { method: 'POST', body: { kind, slot } });
            state.data = res;
            toast(`+${res.gained} опыта — уже в кошельке`);
            window.dispatchEvent(new CustomEvent('wallet:changed'));
        } catch (err) {
            toast(err.message || 'не получилось забрать', true);
            await load();
        }
        state.busy = '';
        render();
    }, { signal: off.signal });

    // Окно игры закрылось — партия могла закрыть задание.
    let wasModal = document.body.classList.contains('modal-open');
    const mo = new MutationObserver(() => {
        const now = document.body.classList.contains('modal-open');
        if (wasModal && !now && host.isConnected) load();
        wasModal = now;
    });
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && host.isConnected) load();
    }, { signal: off.signal });
    // Счётчик «новые через…» тикает раз в минуту, а в полночь МСК набор сменится.
    const tick = setInterval(() => {
        if (!host.isConnected) { clearInterval(tick); mo.disconnect(); off.abort(); return; }
        if (state.data && Date.parse(state.data.resetAt) <= Date.now()) load();
        else if (state.status === 'ready' && !state.busy) render();
    }, 60_000);
    off.signal.addEventListener('abort', () => { clearInterval(tick); mo.disconnect(); });

    render();
    load();
}
