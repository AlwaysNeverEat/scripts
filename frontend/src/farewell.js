// ─────────────────────────────────────────────────────────────────────────────
// Прощальная страница. С октября 2026 сотрудники подписали отказ от сайта, и
// вместо приложения index.html грузит этот модуль: пост «Спасибо», картинка,
// кнопка «F» со счётчиком, кто скидывался на сервер и сколько ему осталось.
//
// Приложение НЕ удалено: владелец (DONATION_ADMIN_LOGIN) со своей сессией
// получает сайт как раньше — модуль просто подгружает main.js. Вернуть сайт
// всем — одна строка в index.html (src обратно на main.js).
//
// Страница открыта без входа: ручка /api/farewell сессии не требует.
// ─────────────────────────────────────────────────────────────────────────────

import './farewell.css';
import { formatLeft } from '../../shared/serverBalance.js';
import { DONATION_ADMIN_LOGIN } from '../../shared/donations.js';

const API_BASE = (typeof __API_BASE__ !== 'undefined' && __API_BASE__) ? __API_BASE__ : '';
const API_KEY  = (typeof __API_KEY__  !== 'undefined' && __API_KEY__)  ? __API_KEY__  : '';
const TOKEN_KEY = 'cars_db_session_token';
const ART = new URL('./assets/farewell/sauron.jpg', import.meta.url).href;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');

async function api(path, { method = 'GET', body, token } = {}) {
    const headers = {};
    if (API_KEY) headers['x-api-key'] = API_KEY;
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
}

// Пока выясняем, кто пришёл, разметку приложения не показываем вовсе.
document.documentElement.classList.add('fw-mode');

async function isOwner() {
    let token = '';
    try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch { /* приватное окно */ }
    if (!token) return false;
    try {
        const me = await api('/api/auth/me', { token });
        return String(me?.user?.login || '').toLowerCase() === DONATION_ADMIN_LOGIN.toLowerCase();
    } catch { return false; }
}

const POST = [
    'Сегодня нас всех попросили подписать отказ от того, что мы делали вместе. Каждый подписал, и это правильно: у всех работа, семья и своя жизнь. Я ни на кого не обижаюсь.',
    'Этот сайт я когда-то сделал для себя. Потом поделился с вами, и он стал нашим. Вы подсказывали, ругались на ошибки, ждали новые вкладки и скидывались на сервер из своего кармана, хотя никто не просил. Ради этого всё и стоило делать.',
    'Мне жаль, что всё закончилось так. Не потому, что сайт что-то сломал или кому-то навредил, а потому, что он кому-то не понравился.',
    'Спасибо каждому, кто был рядом. Каждой смене, которая прошла чуть легче, каждой записи и каждой шутке в чате. Это у нас никто не отнимет.',
    'Берегите друг друга.',
];

const plural = (n, one, few, many) => {
    const a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return one;
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
    return many;
};

function render() {
    const root = document.createElement('main');
    root.id = 'farewell';
    root.innerHTML = `
        <article class="fw-card">
            <img class="fw-art" src="${ART}" alt="">
            <div class="fw-body">
                <h1 class="fw-title">Спасибо</h1>
                ${POST.map(p => `<p>${esc(p)}</p>`).join('')}
                <div class="fw-sign">Октябрь 2026</div>
                <div class="fw-f">
                    <button type="button" class="fw-f-btn" aria-label="Отдать дань уважения">F</button>
                    <span class="fw-f-count"><b data-f>…</b> <span data-f-word>раз</span> нажали F</span>
                </div>
            </div>
        </article>
        <section class="fw-card fw-side">
            <h2>Спасибо, что держали сервер</h2>
            <div class="fw-server" data-server></div>
            <ul class="fw-donors" data-donors><li class="fw-muted">Загружаю…</li></ul>
        </section>`;
    document.body.appendChild(root);
    return root;
}

function mountF(root, initial) {
    const btn = root.querySelector('.fw-f-btn');
    const out = root.querySelector('[data-f]');
    const word = root.querySelector('[data-f-word]');
    let total = initial, pending = 0, timer = 0, inflight = false;
    const show = () => { out.textContent = fmt(total + pending); word.textContent = plural(total + pending, 'раз', 'раза', 'раз'); };
    show();

    // Нажатия копятся и уходят пачкой: по F жмут очередями.
    async function flush() {
        clearTimeout(timer);
        if (inflight || !pending) return;
        const delta = Math.min(pending, 50);
        pending -= delta; inflight = true;
        try { total = (await api('/api/farewell/f', { method: 'POST', body: { delta } })).f; }
        catch { pending += delta; }
        inflight = false;
        show();
        if (pending) timer = setTimeout(flush, 700);
    }
    btn.addEventListener('click', () => {
        pending += 1;
        show();
        btn.classList.remove('fw-f-hit'); void btn.offsetWidth; btn.classList.add('fw-f-hit');
        clearTimeout(timer);
        timer = setTimeout(flush, pending >= 50 ? 0 : 700);
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
}

function fillSide(root, data) {
    const server = root.querySelector('[data-server]');
    const list = root.querySelector('[data-donors]');
    if (data?.server && data.server.hoursLeft != null) {
        server.innerHTML = `Серверу осталось <b>${esc(formatLeft(data.server.hoursLeft))}</b>`;
    }
    const donors = data?.donors || [];
    list.innerHTML = donors.length
        ? donors.map(d => `<li>${d.avatar ? `<img src="${esc(d.avatar)}" alt="">` : `<i>${esc(String(d.name || '?').charAt(0).toUpperCase())}</i>`}<span>${esc(d.name)}</span></li>`).join('')
        : '<li class="fw-muted">Список не загрузился</li>';
}

(async () => {
    if (await isOwner()) {
        document.documentElement.classList.remove('fw-mode');
        await import('./main.js');
        return;
    }
    document.title = 'Спасибо';
    const root = render();
    let data = null;
    try { data = await api('/api/farewell'); } catch { /* страница и без цифр — страница */ }
    mountF(root, data?.f || 0);
    fillSide(root, data);
})();
