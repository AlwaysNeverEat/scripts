// ── Тема оформления (тёмная / светлая / «Жидкое стекло») ─────────────────────
// Выбор пользователя лежит в localStorage и применяется inline-скриптом в
// <head> (index.html) — ДО загрузки CSS, поэтому светлая тема не «мигает»
// тёмной на старте. Здесь — только переключение в уже работающем приложении.
//
// Всё остальное красится через токены в style.css: `<html data-theme="light">`
// подменяет их одним блоком. Канвас-сфера и тайлы карты нарисованы не CSS,
// поэтому они слушают событие `themechange` (см. sphere.js, records/map.js).
//
// ТРЕТЬЯ ТЕМА ПОД ЗАМКОМ. «Жидкое стекло» входит в подписку supp (см.
// supporter.js): её видно в списке всегда, но выбор без подписки не
// переключает тему, а открывает окно с условиями. Замок — вежливость, а не
// защита: тема — это CSS, и человек с открытой консолью включит её себе сам.
// Защищать тут нечего, платят не за невозможность, а за то, чтобы она
// работала на всех устройствах, переживала перезагрузку и не отваливалась.
//
// Настройки стекла (цвет, фон, размытие) — обычные CSS-переменные, которые
// кладутся в style элемента <html>. Что в них можно класть, решает не этот
// файл, а shared/supporterTheme.js: там же, где сервер проверяет пришедшее.
//
// САМО СТЕКЛО РИСУЕТ НЕ CSS, А WEBGL (liquidGlass.js): размытие фона — это
// матовое стекло, а настоящее СМЕЩАЕТ то, что за ним. Библиотека грузится
// только при включении темы, поэтому здесь она вызывается из applyTheme, а не
// импортируется в чанк сайта.
//
// СТЕКЛО — НЕ ТРЕТЬЕ ЗНАЧЕНИЕ data-theme, А НАДСТРОЙКА НАД ПЕРВЫМИ ДВУМЯ.
// На <html> оно ставит `data-glass` рядом с обычным data-theme="dark|light".
// Причина простая: в style.css полторы тысячи правил уже разведены по светлой и
// тёмной теме (золото топа, boot-экран, карта, тени). Заведи мы третье
// значение — каждое из них пришлось бы описать заново, и любое забытое место
// осталось бы с цветами тёмной темы под светлым стеклом. Так же решается и
// «светлое стекло»: это те же светлые токены, поверх которых лежит стекло.
// ─────────────────────────────────────────────────────────────────────────────

import './glass.css';
import { GLASS_THEME, themeStyleText, normalizeTheme } from '../../shared/supporterTheme.js';
import { enableGlass, disableGlass, updateGlassSettings } from './liquidGlass.js';

export const THEME_KEY = 'cars_db_theme';
// Кэш настроек стекла — чтобы после перезагрузки фон и цвет были на месте
// ДО ответа сервера. Источник правды всё равно сервер (GET /api/supporter/me),
// но ждать его, глядя на голый тёмный сайт, подписчику незачем.
export const SUPP_THEME_KEY = 'cars_db_supp_theme';

const THEMES = ['dark', 'light', GLASS_THEME];

// Цвет системной панели браузера (мобильный Chrome/Safari) — совпадает с
// фоном страницы, иначе сверху остаётся чёрная полоса на белой теме.
const META_COLOR = { dark: '#0f0f12', light: '#f6f7f9' };
const GLASS_META_COLOR = { dark: '#0b0f16', light: '#e8ecf4' };

export const THEME_LABELS = {
    dark: 'Тёмная',
    light: 'Светлая',
    [GLASS_THEME]: 'Жидкое стекло',
};

// Доступ к стеклу. Знать о подписке этому модулю больше нечего: активна она
// или нет, решает сервер, а сюда приезжает готовый ответ (см. main.js).
let glassUnlocked = false;
// Что делать, когда стекло выбрали без подписки. Ставится из main.js — сам
// theme.js окна подписки не знает и не тянет его чанк ради переключателя.
let onLocked = () => {};

// Основа, поверх которой лежит стекло: dark или light. Хранится тут же, потому
// что при переключении на стекло её надо знать до того, как приедут настройки.
let glassBase = 'dark';
// Последние применённые настройки — из них линзы берут матовость.
let lastSettings = null;

export function currentTheme() {
    if (document.documentElement.dataset.glass !== undefined) return GLASS_THEME;
    const t = document.documentElement.dataset.theme;
    return t === 'light' ? 'light' : 'dark';
}

export function storedTheme() {
    try {
        const t = localStorage.getItem(THEME_KEY);
        return THEMES.includes(t) ? t : null;
    } catch { return null; }
}

export function isGlassUnlocked() {
    return glassUnlocked;
}

/** Единственная точка, где меняется тема. */
export function applyTheme(theme, { persist = true } = {}) {
    const next = THEMES.includes(theme) ? theme : 'dark';
    const root = document.documentElement;
    const glass = next === GLASS_THEME;

    // Под стеклом data-theme остаётся обычным: это основа, по которой светлая и
    // тёмная половины сайта уже разведены (см. шапку файла).
    root.dataset.theme = glass ? glassBase : next;
    if (glass) root.dataset.glass = '';
    else delete root.dataset.glass;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = glass ? GLASS_META_COLOR[glassBase] : META_COLOR[next];

    if (persist) {
        try { localStorage.setItem(THEME_KEY, next); } catch { /* приватный режим */ }
    }

    // Линзы живут ровно столько, сколько включена тема: и растеризация
    // страницы, и кадровый цикл стоят денег, а платить их должен только тот,
    // кто стекло включил.
    if (glass) enableGlass(lastSettings);
    else disableGlass();

    syncToggles(next);
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next } }));
    return next;
}

/**
 * Применить настройки стекла: цвет, фон, размытие.
 *
 * Переменные ставятся по одной через setProperty, а не одной строкой в
 * style: так в разметку страницы физически не может попасть ничего, кроме
 * известных нам свойств, — что бы ни лежало в localStorage.
 */
export function applyGlassSettings(rawTheme) {
    const theme = normalizeTheme(rawTheme);
    const root = document.documentElement;
    for (const pair of themeStyleText(theme).split('; ')) {
        const i = pair.indexOf(':');
        if (i < 0) continue;
        const name = pair.slice(0, i).trim();
        if (!name.startsWith('--supp-')) continue;
        root.style.setProperty(name, pair.slice(i + 1).trim());
    }
    lastSettings = theme;
    updateGlassSettings(theme);

    // Светлое стекло — не отдельная тема, а та же тема на светлой основе.
    // Меняем основу под уже включённым стеклом, если оно включено.
    const baseChanged = glassBase !== theme.base;
    glassBase = theme.base;
    if (currentTheme() === GLASS_THEME) {
        applyTheme(GLASS_THEME, { persist: false });
        // Оттенок стекла линза запоминает при создании — сменилась основа,
        // значит линзы надо пересоздать, иначе светлое стекло останется с
        // подложкой тёмного.
        if (baseChanged) { disableGlass(); enableGlass(theme); }
    }
    try {
        // base и css — для inline-скрипта в <head>: он применяет их до первой
        // отрисовки и не может импортировать shared. theme — для соседней
        // вкладки, которая пересчитает то же самое сама.
        localStorage.setItem(SUPP_THEME_KEY, JSON.stringify({
            base: theme.base, css: themeStyleText(theme), theme,
        }));
    } catch { /* приватный режим — переживём, просто мигнёт на старте */ }
    return theme;
}

/**
 * Сообщить переключателю, что подписка есть (или кончилась).
 *
 * Кончилась — стекло гасится СРАЗУ, не дожидаясь перезагрузки: иначе человек
 * до конца дня видел бы оплаченный вид, которого у него уже нет, а потом
 * «сайт вдруг сломался». Возвращаемся в тёмную — она была до подписки.
 *
 * Но гасим БЕЗ persist, и это важнее, чем кажется: сессии сайта закрываются
 * каждую полночь МСК (см. auth/midnightMsk.js), а выход снимает доступ к
 * стеклу. Запиши мы при этом «тёмная», подписчик каждое утро входил бы в
 * тёмную тему и заново лез в меню за своей. Выбор остаётся записанным, и
 * обратный случай — доступ появился, а в выборе стекло — возвращает его сам.
 */
export function setGlassAccess(unlocked) {
    glassUnlocked = !!unlocked;
    if (!glassUnlocked && currentTheme() === GLASS_THEME) {
        applyTheme('dark', { persist: false });
    } else if (glassUnlocked && storedTheme() === GLASS_THEME && currentTheme() !== GLASS_THEME) {
        applyTheme(GLASS_THEME);
    }
    syncToggles(currentTheme());
}

export function setLockedHandler(fn) {
    onLocked = typeof fn === 'function' ? fn : () => {};
}

/** Выбор темы из меню: стекло без подписки открывает окно, а не тему. */
export function chooseTheme(theme) {
    if (theme === GLASS_THEME && !glassUnlocked) {
        onLocked();
        return currentTheme();
    }
    return applyTheme(theme);
}

function syncToggles(theme) {
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
        btn.setAttribute('aria-label', `Тема оформления: ${THEME_LABELS[theme] || ''}`);
        btn.setAttribute('title', `Тема: ${THEME_LABELS[theme] || ''}`);
        btn.setAttribute('aria-expanded', 'false');
    });
    document.querySelectorAll('.theme-menu').forEach(menu => renderMenu(menu, theme));
}

// ── Меню выбора темы ─────────────────────────────────────────────────────────
// Раньше кнопка просто переключала светлую и тёмную. С третьей темой это
// перестало работать: перебирать три состояния по кругу, чтобы вернуться к
// своему, — это тыкать вслепую. Поэтому теперь кнопка открывает список, где
// видно все три сразу и понятно, какая включена.

function menuItemHtml(theme, current) {
    const locked = theme === GLASS_THEME && !glassUnlocked;
    return `
        <button type="button" class="theme-menu-item${current === theme ? ' is-current' : ''}${locked ? ' is-locked' : ''}"
                data-theme-pick="${theme}" role="menuitemradio" aria-checked="${current === theme}">
            <span class="theme-swatch theme-swatch-${theme}" aria-hidden="true"></span>
            <span class="theme-menu-label">${THEME_LABELS[theme]}</span>
            ${locked
                ? `<span class="theme-menu-lock" title="Входит в подписку supp">${lockSvg()}</span>`
                : `<span class="theme-menu-check" aria-hidden="true"></span>`}
        </button>`;
}

function lockSvg() {
    return `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/>
                <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/>
            </svg>`;
}

function renderMenu(menu, theme) {
    menu.innerHTML = THEMES.map(t => menuItemHtml(t, theme)).join('')
        + `<div class="theme-menu-foot">
               <button type="button" class="theme-menu-supp" data-theme-supp>
                   <span class="supp-mark">supp</span>
                   ${glassUnlocked ? 'Настроить стекло' : 'Что даёт подписка'}
               </button>
           </div>`;
    menu.querySelectorAll('[data-theme-pick]').forEach(btn => {
        btn.onclick = () => {
            const picked = btn.dataset.themePick;
            const applied = chooseTheme(picked);
            // Окно подписки закрывает меню собой; в остальных случаях меню
            // закрывается выбором — держать его открытым не за чем.
            closeMenus();
            return applied;
        };
    });
    menu.querySelector('[data-theme-supp]').onclick = () => { closeMenus(); onLocked(); };
}

function closeMenus() {
    document.querySelectorAll('.theme-menu.is-open').forEach(m => m.classList.remove('is-open'));
    document.querySelectorAll('[data-theme-toggle]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}

// Меню каждой кнопки живёт в конце <body> и позиционируется по её координатам.
//
// Класть его рядом с кнопкой нельзя: кнопок две (ряд вкладок и экран входа), и
// их родители — совсем разные контейнеры, часть из которых обрезает выходящее
// за край (overflow) и ни один не обещает быть точкой отсчёта для absolute.
// Фиксированное меню от координат кнопки одинаково всплывает у обеих.
const menus = new WeakMap();

function menuFor(btn) {
    let menu = menus.get(btn);
    if (!menu) {
        menu = document.createElement('div');
        menu.className = 'theme-menu';
        menu.setAttribute('role', 'menu');
        document.body.appendChild(menu);
        menus.set(btn, menu);
    }
    return menu;
}

// Ставим меню под кнопку, выравнивая по правому краю, и не даём вылезти за
// экран: на телефоне кнопка стоит у самого края.
function placeMenu(menu, btn) {
    const rect = btn.getBoundingClientRect();
    const width = menu.offsetWidth || 224;
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    menu.style.top = `${Math.round(rect.bottom + 8)}px`;
    menu.style.left = `${Math.round(left)}px`;
}

export function initTheme() {
    const theme = currentTheme();

    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const menu = menuFor(btn);
            const open = menu.classList.contains('is-open');
            closeMenus();
            if (!open) {
                renderMenu(menu, currentTheme());
                menu.classList.add('is-open');
                placeMenu(menu, btn);
                btn.setAttribute('aria-expanded', 'true');
            }
        });
    });

    // Клик мимо и Escape закрывают меню — как любое всплывающее окно на сайте.
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.theme-menu') && !e.target.closest('[data-theme-toggle]')) closeMenus();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });
    // Меню зафиксировано на экране, а кнопка едет вместе со страницей —
    // проще закрыть, чем возить меню за ней.
    window.addEventListener('scroll', () => closeMenus(), true);
    window.addEventListener('resize', () => closeMenus());

    syncToggles(theme);

    // Сайт открыт в двух вкладках — переключение в одной подхватывается в
    // другой (localStorage шлёт storage только в «чужие» вкладки).
    window.addEventListener('storage', (e) => {
        if (e.key === THEME_KEY && THEMES.includes(e.newValue)) {
            if (e.newValue !== currentTheme()) applyTheme(e.newValue, { persist: false });
            return;
        }
        // Настройки стекла тоже общие: подобрал цвет в одной вкладке — вторая
        // не должна остаться со старым.
        if (e.key === SUPP_THEME_KEY && e.newValue) {
            try { applyGlassSettings(JSON.parse(e.newValue).theme); } catch { /* чужой формат — не трогаем */ }
        }
    });

    return theme;
}
