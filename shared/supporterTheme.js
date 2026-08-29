// ─────────────────────────────────────────────────────────────────────────────
// Тема «Жидкое стекло» — что в ней можно настроить и в каких границах.
//
// Файл лежит в shared/ по той же причине, что маски телефона и гос. номера
// (shared/crmClients.js): «какая настройка правильная» — это ОДНО знание, и
// оно нужно сразу в трёх местах. Окно настроек рисует ползунки по этим же
// границам, сервер по ним же проверяет пришедшее (клиенту верить нельзя —
// значения уезжают прямо в CSS), а отдаёт он обратно уже нормализованный
// объект, который окно применяет, не пересчитывая.
//
// Настройки живут ОТДЕЛЬНО от срока подписки (см. db/migrations/039_supporter.sql):
// подписка кончилась — тема выключилась, но подобранный цвет и фон остались на
// месте, и продление возвращает человеку его вид, а не пустой бланк.
//
// Главное про безопасность: всё отсюда уезжает в атрибут style элемента <html>.
// Поэтому проверка значений — не вежливость к пользователю, а единственное, что
// стоит между полем ввода и разметкой страницы: hex сверяется с шаблоном, ссылка
// на фон — со списком разрешённых форм, числа зажимаются в диапазон. Любое
// непонятное значение молча заменяется значением по умолчанию, а не
// «подчищается»: подчищенная строка — это всё ещё чужая строка.
// ─────────────────────────────────────────────────────────────────────────────

/** Идентификатор темы в data-theme и в localStorage. */
export const GLASS_THEME = 'glass';

/** Цена подписки. Одно число на весь проект — в окне, в профиле и в тексте. */
export const SUPP_PRICE_RUB = 350;

/** Сколько длится выданная подписка. */
export const SUPP_DAYS = 30;

// Что просить у человека, который несёт свою картинку. Числа не с потолка:
// фон растягивается на весь экран (background-size: cover), а самый большой
// монитор в конторе — 2560×1440. Меньше 1920 по ширине картинка на нём
// заметно мылится, больше 4K — это уже лишние мегабайты по каналу, который у
// нас и так узкий (ради него весь сервер и переезжал).
export const BG_ADVICE = {
    width: 2560,
    height: 1440,
    minWidth: 1920,
    maxBytes: 6 * 1024 * 1024,
    formats: ['jpeg', 'png', 'webp'],
};

// Готовые фоны — для тех, у кого своей картинки нет. Это ГРАДИЕНТЫ, а не
// файлы: они ничего не весят, не мылятся ни на каком экране и не требуют
// хранилища. Подписка при этом остаётся подпиской и без загрузки — человек
// выбрал цвет и фон и получил свой сайт в первую же минуту.
//
// У каждого фона помечено, СВЕТЛЫЙ он или тёмный (light), и это не украшение
// списка: под тёмным фоном текст обязан быть светлым, под светлым — тёмным,
// иначе сайт читается через раз. Выбор фона поэтому сам переключает основу
// темы (см. окно настроек), а не оставляет человека гадать, почему у него
// серые буквы на сером.
//
// Первыми идут СВЕТЛЫЕ, и это тоже решение: стекло — светлая история (белая
// пластина с ярким срезом), а тёмный фон с затемнением превращает сайт в
// тёмное пятно, на котором стекла не видно вовсе.
export const PRESETS = [
    {
        id: 'daylight',
        name: 'Дневной',
        light: true,
        css: 'radial-gradient(120% 90% at 12% 8%, #dfe7f5 0%, transparent 55%),'
            + ' radial-gradient(110% 80% at 88% 18%, #e9e2f6 0%, transparent 52%),'
            + ' radial-gradient(120% 120% at 50% 100%, #e2f0ef 0%, transparent 60%),'
            + ' linear-gradient(160deg, #f4f6fb 0%, #e8ecf4 100%)',
    },
    {
        id: 'pearl',
        name: 'Жемчуг',
        light: true,
        css: 'radial-gradient(100% 80% at 20% 10%, #ffffff 0%, transparent 60%),'
            + ' radial-gradient(120% 90% at 85% 25%, #f2e8ef 0%, transparent 55%),'
            + ' linear-gradient(165deg, #f7f7fa 0%, #e6e8ef 100%)',
    },
    {
        id: 'sky',
        name: 'Небо',
        light: true,
        css: 'radial-gradient(110% 85% at 15% 5%, #d8e9ff 0%, transparent 58%),'
            + ' radial-gradient(120% 90% at 90% 30%, #e6f6ff 0%, transparent 55%),'
            + ' linear-gradient(160deg, #eef5fd 0%, #dfe9f5 100%)',
    },
    {
        id: 'aurora',
        name: 'Аврора',
        light: false,
        css: 'radial-gradient(120% 90% at 12% 8%, #1b3a6b 0%, transparent 55%),'
            + ' radial-gradient(110% 80% at 88% 18%, #6d2a7a 0%, transparent 52%),'
            + ' radial-gradient(120% 120% at 50% 100%, #0d5c63 0%, transparent 60%),'
            + ' linear-gradient(160deg, #0b0f1a 0%, #131a2b 100%)',
    },
    {
        id: 'amber',
        name: 'Янтарь',
        light: false,
        css: 'radial-gradient(100% 80% at 15% 12%, #6b4310 0%, transparent 55%),'
            + ' radial-gradient(120% 90% at 85% 20%, #8a5a12 0%, transparent 50%),'
            + ' linear-gradient(165deg, #100c07 0%, #1b1610 100%)',
    },
    {
        id: 'graphite',
        name: 'Графит',
        light: false,
        css: 'radial-gradient(120% 90% at 30% 0%, #2a3140 0%, transparent 60%),'
            + ' linear-gradient(170deg, #0c0e13 0%, #171b23 100%)',
    },
    {
        id: 'bloom',
        name: 'Цветение',
        light: false,
        css: 'radial-gradient(90% 70% at 20% 15%, #7a1f4b 0%, transparent 55%),'
            + ' radial-gradient(100% 80% at 80% 25%, #2b3f8f 0%, transparent 55%),'
            + ' radial-gradient(120% 100% at 50% 95%, #1c6f5e 0%, transparent 60%),'
            + ' linear-gradient(160deg, #0d0a12 0%, #171225 100%)',
    },
];

export const PRESET_IDS = PRESETS.map(p => p.id);

/**
 * Настройки по умолчанию — их же видит человек в первую секунду после выдачи.
 *
 * Светлые не потому, что светлое красивее, а потому, что стекло — это про свет:
 * белая пластина, яркий срез, тень под ней. На тёмном фоне с сильным
 * затемнением ничего этого не видно, и «тема за 350 рублей» выглядит как
 * обычный сайт, которому прикрутили яркость. Первое впечатление должно
 * показывать, за что заплачено, а тёмную основу человек включит сам одной
 * кнопкой.
 */
export const DEFAULT_THEME = Object.freeze({
    base: 'light',       // под каким стеклом: 'dark' | 'light'
    accent: '#7c4dff',   // акцент сайта и цвет своей строки в топе
    preset: 'daylight',  // фон, когда своей картинки нет
    background: null,    // URL загруженной картинки — важнее пресета
    // Вуаль поверх фона. Не «затемнение»: на светлой основе она белая, на
    // тёмной чёрная — задача одна, приглушить фон, чтобы панели читались.
    dim: 22,
    blur: 18,            // размытие фона, 0…40 px
    glow: true,          // красить ли свою строку в топе (см. shared ниже)
});

const HEX_RE = /^#[0-9a-f]{6}$/i;

// Разрешённые формы ссылки на фон. Своя картинка приезжает с нашего же
// сервера ('/avatars/…'), а старые аккаунты могут ещё указывать на Supabase
// (https://…) — как и аватарки, см. storage/avatarStorage.js. Всё остальное
// (data:, javascript:, кавычки, скобки, пробелы) не проходит: строка уходит
// в CSS, и одна закрывающая скобка там значит больше, чем весь остальной файл.
const URL_RE = /^(?:\/[\w.\-/]+|https:\/\/[\w.\-]+\/[\w.\-/%]*)$/;

function clamp(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Привести пришедшие настройки к безопасному виду.
 *
 * Ничего не бракует целиком: непонятное поле заменяется значением по
 * умолчанию, а остальные сохраняются. Человек, который подобрал цвет и
 * сломался на картинке, не должен терять цвет.
 */
export function normalizeTheme(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const accent = typeof src.accent === 'string' && HEX_RE.test(src.accent.trim())
        ? src.accent.trim().toLowerCase()
        : DEFAULT_THEME.accent;
    const preset = PRESET_IDS.includes(src.preset) ? src.preset : DEFAULT_THEME.preset;
    const background = typeof src.background === 'string' && URL_RE.test(src.background.trim())
        ? src.background.trim()
        : null;
    return {
        // Основа читается строго: 'dark' и 'light' — всё остальное (пусто,
        // мусор, старый формат) значит «как по умолчанию», а не «тёмная».
        base: src.base === 'light' || src.base === 'dark' ? src.base : DEFAULT_THEME.base,
        accent,
        preset,
        background,
        dim: clamp(src.dim, 0, 85, DEFAULT_THEME.dim),
        blur: clamp(src.blur, 0, 40, DEFAULT_THEME.blur),
        glow: src.glow !== false,
    };
}

/** '#d4a017' → '212, 160, 23'. Нужно, чтобы CSS мог делать rgba() от акцента. */
export function hexToRgbTriplet(hex) {
    const safe = HEX_RE.test(String(hex || '')) ? hex : DEFAULT_THEME.accent;
    const n = parseInt(safe.slice(1), 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** Насколько цвет светлый (0…1) — по формуле яркости sRGB. */
export function hexLuminance(hex) {
    const [r, g, b] = hexToRgbTriplet(hex).split(', ').map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Текст, который читается на заливке этим цветом. Акцент выбирает человек, а
 * подписи на кнопках должны остаться читаемыми и на лимонном, и на тёмно-синем:
 * на светлом акценте текст тёмный, на тёмном — светлый.
 */
export function accentInk(hex) {
    return hexLuminance(hex) > 0.6 ? '#14161c' : '#ffffff';
}

export function presetCss(id) {
    const found = PRESETS.find(p => p.id === id);
    return (found || PRESETS[0]).css;
}

/** Светлый ли фон — по нему выбирается основа темы, а значит и цвет текста. */
export function presetIsLight(id) {
    const found = PRESETS.find(p => p.id === id);
    return found ? found.light !== false : true;
}

/**
 * Основа под картинку: светлая или тёмная — по средней яркости самой картинки.
 *
 * Это и есть «текст подстраивается под фон»: на светлом снимке буквы должны
 * быть тёмными, на ночном — светлыми, и решать это человеку вручную незачем,
 * он и так видит результат. Яркость считает окно настроек (у него есть
 * canvas), а порог живёт здесь — рядом с остальными правилами темы.
 */
export function baseForLuminance(luma) {
    return luma >= 0.55 ? 'light' : 'dark';
}

/**
 * Набор CSS-переменных темы: то, что уезжает в style элемента <html>.
 * Всё, что рисует стекло, читает ТОЛЬКО эти переменные (frontend/src/glass.css) —
 * поэтому новая настройка добавляется сюда и в окно, а не правкой правил.
 */
export function themeVars(theme) {
    const t = normalizeTheme(theme);
    return {
        '--supp-accent': t.accent,
        '--supp-accent-rgb': hexToRgbTriplet(t.accent),
        '--supp-accent-ink': accentInk(t.accent),
        '--supp-bg': t.background ? `url("${t.background}")` : presetCss(t.preset),
        // Своя картинка растягивается на экран, градиент — нет: у него нет
        // «размера», и cover заставил бы браузер пересчитывать его на каждом
        // кадре прокрутки.
        '--supp-bg-size': t.background ? 'cover' : 'auto',
        '--supp-dim': String(t.dim / 100),
        '--supp-blur': `${t.blur}px`,
    };
}

/** Те же переменные строкой — для атрибута style. */
export function themeStyleText(theme) {
    return Object.entries(themeVars(theme))
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ');
}

/** Дата окончания подписки, выданной сейчас (или продлённой с текущей). */
export function nextExpiry(currentExpiry, now = new Date()) {
    const from = currentExpiry && new Date(currentExpiry) > now ? new Date(currentExpiry) : new Date(now);
    const next = new Date(from);
    next.setDate(next.getDate() + SUPP_DAYS);
    return next;
}

/** Сколько дней осталось (для подписи «ещё 12 дней»). Истёкшая даёт 0. */
export function daysLeft(expiresAt, now = new Date()) {
    if (!expiresAt) return Infinity;      // бессрочная — у владельца
    const ms = new Date(expiresAt).getTime() - now.getTime();
    return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}
