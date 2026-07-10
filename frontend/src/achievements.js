// ─────────────────────────────────────────────────────────────────────────────
// Достижения на фронте: стим-тосты справа снизу («Вы получили достижение…»)
// и общая карта картинок ачивок (используется и тостами, и карточками профиля).
//
// Как узнаём о новых ачивках: бэкенд держит у каждой выданной ачивки флаг
// notified_at (NULL = тост ещё не показывали). Фронт спрашивает
// GET /api/profile/achievements/pending при входе, после действий, которые
// могут дать ачивку (сохранение машины, назначение ответственного), и раз в
// пару минут фоном — так уведомление дойдёт и когда ачивку начислил модератор
// или машина добавлена через юзерскрипт с другого сайта. После показа тоста
// шлём POST /achievements/seen — второй раз тот же тост не появится.
// ─────────────────────────────────────────────────────────────────────────────

import achCarsAdded5 from './assets/ach-cars-added-5.png';

const ICONS = {
    cars_added_5: achCarsAdded5,
};

export function achievementIcon(id) {
    return ICONS[id] || null;
}

const POLL_INTERVAL_MS = 120_000;
const TOAST_LIFETIME_MS = 7_000;

let apiFetchRef = null;
let pollTimer = null;
let checking = false;

export function initAchievements({ apiFetch }) {
    apiFetchRef = apiFetch;
    checkAchievementsNow();
    clearInterval(pollTimer);
    pollTimer = setInterval(checkAchievementsNow, POLL_INTERVAL_MS);
}

// Дёргается после любых действий, которые могли изменить счётчики
// (и фоновым поллером). Молча ничего не делает, если новых ачивок нет.
export async function checkAchievementsNow() {
    if (!apiFetchRef || checking) return;
    checking = true;
    try {
        const pending = await apiFetchRef('/api/profile/achievements/pending');
        if (!Array.isArray(pending) || !pending.length) return;
        // Сначала подтверждаем показ, потом показываем: лучше один потерянный
        // тост, чем один и тот же тост при каждом заходе, если seen не дошёл.
        await apiFetchRef('/api/profile/achievements/seen', {
            method: 'POST',
            body: { ids: pending.map(a => a.id) },
        });
        pending.forEach((a, i) => setTimeout(() => showToast(a), i * 900));
    } catch { /* ачивки — не критичный путь, тихо пробуем в следующий раз */
    } finally {
        checking = false;
    }
}

function toastContainer() {
    let box = document.getElementById('achievement-toasts');
    if (!box) {
        box = document.createElement('div');
        box.id = 'achievement-toasts';
        document.body.appendChild(box);
    }
    return box;
}

function showToast(achievement) {
    const icon = achievementIcon(achievement.id);
    const toast = document.createElement('div');
    toast.className = 'ach-toast';
    toast.innerHTML = `
        <div class="ach-toast-icon">${icon ? `<img src="${esc(icon)}" alt=""/>` : '🏆'}</div>
        <div class="ach-toast-body">
            <div class="ach-toast-head">Вы получили достижение</div>
            <div class="ach-toast-title">${esc(achievement.title)}</div>
        </div>
    `;
    toastContainer().appendChild(toast);
    // рефлоу перед классом — иначе браузер склеит начальное и конечное
    // состояние и въезжающей анимации не будет
    toast.getBoundingClientRect();
    toast.classList.add('ach-toast-show');

    const dismiss = () => {
        toast.classList.remove('ach-toast-show');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
        setTimeout(() => toast.remove(), 600); // страховка, если transition не сработал
    };
    const timer = setTimeout(dismiss, TOAST_LIFETIME_MS);
    toast.onclick = () => { clearTimeout(timer); dismiss(); };
}

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
