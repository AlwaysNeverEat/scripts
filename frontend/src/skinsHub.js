// ─────────────────────────────────────────────────────────────────────────────
// Панель «Скины» профиля — три вкладки: «Кейсы» (кошелёк, кейсы, магазин гемов
// и примерочная — cases.js), «Обмен» и «Маркет» (trades.js).
//
// Панель СВЁРНУТА, пока не нажали вкладку: кейсы с магазином и примерочной —
// это экран в высоту, и висеть развёрнутым посреди профиля ему незачем.
// Нажатая ещё раз вкладка сворачивает панель обратно. Что открыто — помнится
// на устройстве по аккаунту.
//
// Вкладка монтируется при первом открытии, а не все три сразу: каждая — свой
// запрос, и человеку, который зашёл посмотреть ленту активности, они не нужны.
// Исключение — число входящих предложений на «Обмене»: оно и есть повод
// открыть вкладку, поэтому спрашивается сразу.
// ─────────────────────────────────────────────────────────────────────────────

import { mountCases } from './cases.js';
import { mountTrades, mountMarket } from './trades.js';

const TABS = [
    { id: 'cases', label: 'Кейсы' },
    { id: 'trade', label: 'Обмен' },
    { id: 'market', label: 'Маркет' },
];
const storeKey = (userId) => `zm_skins_tab:${userId || 'anon'}`;
const readTab = (userId) => { try { return localStorage.getItem(storeKey(userId)) || ''; } catch { return ''; } };
const saveTab = (userId, tab) => { try { localStorage.setItem(storeKey(userId), tab); } catch { /* приватное окно */ } };

export function mountSkinsHub(host, { apiFetch, user }) {
    if (!host) return;
    // Повторный монтаж в тот же узел снимает прежний обработчик — иначе
    // клик по вкладке открывал бы её и тут же закрывал.
    host._hubOff?.abort();
    const off = new AbortController();
    host._hubOff = off;
    let open = TABS.some(t => t.id === readTab(user?.id)) ? readTab(user?.id) : '';
    let incoming = 0;
    const mounted = new Set();

    host.innerHTML = `
        <div class="tr-tabs" data-seg="skins-tab" role="tablist">
            ${TABS.map(t => `<button type="button" class="chip" role="tab" data-tab="${t.id}">${t.label}<span class="tr-badge" hidden></span></button>`).join('')}
        </div>
        ${TABS.map(t => `<div class="tr-pane" data-pane="${t.id}" role="tabpanel" hidden><div class="tr-pane-body"></div></div>`).join('')}`;

    const body = (id) => host.querySelector(`[data-pane="${id}"] .tr-pane-body`);
    function sync() {
        for (const t of TABS) {
            const btn = host.querySelector(`[data-tab="${t.id}"]`);
            btn.classList.toggle('active', t.id === open);
            btn.setAttribute('aria-selected', String(t.id === open));
            host.querySelector(`[data-pane="${t.id}"]`).hidden = t.id !== open;
        }
        const badge = host.querySelector('[data-tab="trade"] .tr-badge');
        badge.hidden = !incoming;
        badge.textContent = incoming ? String(incoming) : '';
        host.classList.toggle('tr-hub-open', Boolean(open));
        if (open && !mounted.has(open)) {
            mounted.add(open);
            if (open === 'cases') mountCases(body('cases'), { apiFetch, user });
            if (open === 'trade') mountTrades(body('trade'), { apiFetch, user, onIncoming });
            if (open === 'market') mountMarket(body('market'), { apiFetch, user });
        }
    }
    const onIncoming = (n) => { incoming = n; sync(); };

    host.addEventListener('click', (e) => {
        const tab = e.target.closest('[data-tab]');
        if (!tab || !host.contains(tab)) return;
        open = open === tab.dataset.tab ? '' : tab.dataset.tab;
        saveTab(user?.id, open);
        sync();
    }, { signal: off.signal });

    sync();
    // Бейдж входящих — без монтажа вкладки.
    if (!mounted.has('trade')) {
        apiFetch('/api/trades')
            .then(d => { if (!mounted.has('trade')) onIncoming((d.offers || []).filter(o => o.status === 'pending' && o.to === user?.id).length); })
            .catch(() => {});
    }
}
