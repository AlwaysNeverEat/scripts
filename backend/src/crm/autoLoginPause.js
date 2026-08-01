// ─────────────────────────────────────────────────────────────────────────────
// Пауза автовхода в CRM на время выхода.
//
// Учётка CRM привязана к аккаунту сайта, поэтому любой запрос к CRM умеет сам
// поднять сессию по сохранённым логину и паролю (crm/client.js). На выходе это
// мешает: между «CRM подтвердила закрытие сессии» и «сессии сайта снесены»
// есть щель, и второй браузер того же работника успел бы открыть сессию CRM
// заново — выход из CRM оказался бы фикцией.
//
// Поэтому выход ставит паузу: пока она держится, автовход не срабатывает,
// войти можно только явным действием человека — вход в CRM руками или новый
// вход на сайт (оба снимают паузу). Пауза сама истекает через PAUSE_MS, чтобы
// забытая (например, браузер закрыли на полпути) не осталась навсегда.
//
// Живёт в памяти процесса, как и кэш кук: бэкенд один, а переживать рестарт
// паузе незачем — после рестарта живых сессий сайта всё равно нет.
// ─────────────────────────────────────────────────────────────────────────────

const PAUSE_MS = 5 * 60 * 1000;

const pausedUntil = new Map(); // userId → timestamp окончания паузы

export function pauseCrmAutoLogin(userId, now = Date.now()) {
    if (!userId) return;
    pausedUntil.set(userId, now + PAUSE_MS);
}

export function resumeCrmAutoLogin(userId) {
    if (!userId) return;
    pausedUntil.delete(userId);
}

export function crmAutoLoginPaused(userId, now = Date.now()) {
    const until = pausedUntil.get(userId);
    if (!until) return false;
    if (now >= until) {
        pausedUntil.delete(userId);
        return false;
    }
    return true;
}

export const CRM_AUTO_LOGIN_PAUSE_MS = PAUSE_MS;
