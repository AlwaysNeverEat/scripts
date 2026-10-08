// ─────────────────────────────────────────────────────────────────────────────
// Счётчик и уведомления «Чатов» на ВСЁМ сайте, а не только на вкладке.
//
// Новое сообщение клиента в MAX/Telegram/ВК в самой CRM видно только красной
// цифрой у пункта подменю — то есть никак, пока подменю не открыл. Здесь:
//   • число непрочитанных на кнопке «Чаты» (красная, если кто-то ЖДЁТ
//     оператора — бот сдался, клиент сидит и ждёт человека);
//   • то же число в заголовке окна — его видно на свёрнутой вкладке браузера;
//   • уведомление на рабочем столе, если человек его разрешил и сейчас не
//     смотрит в «Чаты». Клик по нему открывает этот диалог.
//
// Новость — это РОСТ непрочитанного и НОВЫЙ ждущий (newUnread в
// shared/crmChats.js): висящее с утра не повторяется на каждом опросе и на
// каждом F5. Опрос раз в 20 секунд (так же часто спрашивает и сама CRM);
// у кого чатов в CRM нет, сервер отвечает `available: false`, и кнопка
// прячется, а спрашиваем снова через 15 минут.
// ─────────────────────────────────────────────────────────────────────────────

import { newUnread, channelLabel } from '../../shared/crmChats.js';

const POLL_MS = 20 * 1000;
const RETRY_AUTH_MS = 5 * 60 * 1000;
const RETRY_DENIED_MS = 15 * 60 * 1000;

export function initChatPulse({ apiFetch, tabEl, badgeEl, isChatsOpen = () => false, onOpenDialog = () => {} }) {
    let timer = null;
    let running = false;
    let lastUnread = null;     // null — ещё не мерили: первый замер не новость
    let seenWaiting = null;
    let snapshot = { unread: 0, waiting: [] };
    const listeners = new Set();
    let baseTitle = document.title.replace(/^\(\d+\+?\)\s*/, '');

    function setTitle(n) {
        baseTitle = document.title.replace(/^\(\d+\+?\)\s*/, '') || baseTitle;
        document.title = n > 0 ? `(${n > 99 ? '99+' : n}) ${baseTitle}` : baseTitle;
    }

    function renderBadge({ unread, waiting }) {
        if (!badgeEl) return;
        const n = unread || waiting.length;
        badgeEl.textContent = n ? (n > 99 ? '99+' : String(n)) : '';
        badgeEl.classList.toggle('hidden', !n);
        badgeEl.classList.toggle('app-tab-badge-alert', waiting.length > 0);
        if (tabEl) tabEl.title = waiting.length ? `Чаты — ${waiting.length} ждут оператора` : 'Чаты';
    }

    function notify(title, body, dialogId) {
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
        if (!document.hidden && isChatsOpen()) return;
        try {
            const n = new Notification(title, { body, tag: `chat-${dialogId || 'any'}`, renotify: true });
            n.onclick = () => { window.focus(); onOpenDialog(dialogId); n.close(); };
        } catch { /* браузер без конструктора уведомлений (мобильный Chrome) */ }
    }

    async function poll() {
        timer = null;
        let next = POLL_MS;
        try {
            const data = await apiFetch('/api/crm/chats/pulse');
            if (!data.available) {
                if (tabEl) tabEl.classList.add('hidden');
                snapshot = { unread: 0, waiting: [] };
                renderBadge(snapshot);
                setTitle(0);
                next = RETRY_DENIED_MS;
            } else {
                if (tabEl) tabEl.classList.remove('hidden');
                const waiting = data.waiting || [];
                const fresh = newUnread(lastUnread, data.unread);
                const newWaiting = seenWaiting ? waiting.filter(w => !seenWaiting.has(w.id)) : [];
                if (newWaiting.length) {
                    const w = newWaiting[0];
                    notify(`${w.who} ждёт оператора`, `${channelLabel(w.channel)}: ${w.lastText || 'новое сообщение'}`, w.id);
                } else if (fresh) {
                    notify('Новое сообщение в «Чатах»', fresh === 1 ? 'Клиент написал в мессенджер' : `Новых сообщений: ${fresh}`, null);
                }
                lastUnread = data.unread;
                seenWaiting = new Set(waiting.map(w => w.id));
                snapshot = { unread: data.unread, waiting };
                renderBadge(snapshot);
                setTitle(data.unread || waiting.length);
                for (const fn of listeners) fn(snapshot);
            }
        } catch (e) {
            // Нет сессии CRM — не долбим: человек войдёт, и через пять минут
            // счётчик оживёт сам.
            if (e.code === 'crm_auth_required' || e.code === 'crm_auth_failed') next = RETRY_AUTH_MS;
        }
        if (running) timer = setTimeout(poll, next);
    }

    return {
        start() {
            if (running) return;
            running = true;
            poll();
        },
        stop() {
            running = false;
            clearTimeout(timer);
            timer = null;
            lastUnread = null;
            seenWaiting = null;
            renderBadge({ unread: 0, waiting: [] });
            setTitle(0);
        },
        // Диалог прочитали — спросить сразу, а не через двадцать секунд.
        refresh() {
            if (!running) return;
            clearTimeout(timer);
            timer = setTimeout(poll, 400);
        },
        subscribe(fn) {
            listeners.add(fn);
            fn(snapshot);
            return () => listeners.delete(fn);
        },
    };
}
