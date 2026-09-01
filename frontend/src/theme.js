// ── Тема оформления (тёмная / светлая) ───────────────────────────────────────
// Выбор пользователя лежит в localStorage и применяется inline-скриптом в
// <head> (index.html) — ДО загрузки CSS, поэтому светлая тема не «мигает»
// тёмной на старте. Здесь — только переключение в уже работающем приложении.
//
// Всё остальное красится через токены в style.css: `<html data-theme="light">`
// подменяет их одним блоком. Канвас-сфера и тайлы карты нарисованы не CSS,
// поэтому они слушают событие `themechange` (см. sphere.js, records/map.js).

export const THEME_KEY = 'cars_db_theme';
const THEMES = ['dark', 'light'];

// Цвет системной панели браузера (мобильный Chrome/Safari) — совпадает с
// фоном страницы, иначе сверху остаётся чёрная полоса на белой теме.
const META_COLOR = { dark: '#0f0f12', light: '#f6f7f9' };

export function currentTheme() {
    const t = document.documentElement.dataset.theme;
    return THEMES.includes(t) ? t : 'dark';
}

export function storedTheme() {
    try {
        const t = localStorage.getItem(THEME_KEY);
        return THEMES.includes(t) ? t : null;
    } catch { return null; }
}

// Единственная точка, где меняется тема: правит атрибут на <html>, meta
// theme-color, состояние тумблеров — и сообщает об этом остальным модулям.
// Как выглядит тумблер, тут не решается вовсе: ночь, день, звёзды и облако
// нарисованы от `:root[data-theme="light"]` в CSS (см. .theme-toggle).
export function applyTheme(theme, { persist = true } = {}) {
    const next = THEMES.includes(theme) ? theme : 'dark';
    document.documentElement.dataset.theme = next;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = META_COLOR[next];

    if (persist) {
        try { localStorage.setItem(THEME_KEY, next); } catch { /* приватный режим */ }
    }

    syncToggles(next);
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next } }));
    return next;
}

export function toggleTheme() {
    return applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
}

// ТУМБЛЕР НЕ ПЕРЕИМЕНОВЫВАЕТСЯ НА ХОДУ. Раньше кнопка показывала действие
// («Светлая тема», когда тема тёмная), и подпись ездила вместе с иконкой.
// У переключателя название — это то, что он включает, а включён он или нет,
// говорит aria-checked; меняющаяся подпись рядом с ним читалась бы наоборот
// («Тёмная тема» во включённом состоянии — что включено-то?). Подсказка,
// наоборот, про действие: на неё смотрят перед кликом, а не после.
function syncToggles(theme) {
    const light = theme === 'light';
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
        btn.setAttribute('aria-checked', light ? 'true' : 'false');
        btn.setAttribute('title', light ? 'Включить тёмную тему' : 'Включить светлую тему');
    });
}

export function initTheme() {
    const theme = currentTheme();
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
        btn.addEventListener('click', () => toggleTheme());
    });
    syncToggles(theme);

    // Сайт открыт в двух вкладках — переключение в одной подхватывается в
    // другой (localStorage шлёт storage только в «чужие» вкладки).
    window.addEventListener('storage', (e) => {
        if (e.key !== THEME_KEY || !THEMES.includes(e.newValue)) return;
        if (e.newValue !== currentTheme()) applyTheme(e.newValue, { persist: false });
    });

    return theme;
}
