// ── Акцентный цвет (ручка пользователя) ──────────────────────────────────────
// Устроено ровно как тема (theme.js), и это не подражание: выбор так же лежит
// в localStorage и так же применяется инлайновым скриптом в <head> (index.html)
// ДО загрузки CSS. Иначе на каждой загрузке сайт на кадр вспыхивал бы жёлтым,
// прежде чем стать выбранным цветом, — та же «мигающая тема», только цветом.
//
// НАРУЖУ УХОДИТ ОДНО ЧИСЛО — ТОН В ГРАДУСАХ. Светлоту и насыщенность
// пользователь не трогает: от светлоты зависит, каким цветом читается надпись
// поверх акцента (--accent-fg), и половина свободно выбранных цветов дала бы
// кнопку с нечитаемым текстом. Тон на контраст не влияет вовсе — его можно
// отдать целиком. Подробнее — комментарий у --accent-h в style.css.
//
// ЧТО НЕ КРАСИТСЯ АКЦЕНТОМ, и это осознанно:
//   • ЗОЛОТО ТОПА — медаль за первое место. Синяя медаль не медаль;
//   • зелёный/красный/синий — это СМЫСЛ (свободно, ошибка, ссылка), а не
//     украшение: перекрасив их, мы сломаем чтение статусов;
//   • цвета факультетов — Гриффиндор красный по определению.

export const ACCENT_KEY = 'cars_db_accent';

// Жёлтый, с которого сайт начинался. Тот же градус зашит запасным значением в
// style.css и в инлайновом скрипте — три места, но каждое обязано пережить
// отсутствие двух других.
export const DEFAULT_HUE = 83;

// Готовые тона. Смысл набора — не «палитра на любой вкус», а несколько
// заведомо разных направлений: между соседями не меньше 35°, иначе на плашках
// они выглядят одним цветом и выбор превращается в угадайку.
export const PRESETS = [
    { h: 83, name: 'Янтарь' },
    { h: 35, name: 'Кирпич' },
    { h: 15, name: 'Гранат' },
    { h: 330, name: 'Фуксия' },
    { h: 285, name: 'Аметист' },
    { h: 250, name: 'Ультрамарин' },
    { h: 215, name: 'Лазурь' },
    { h: 170, name: 'Бирюза' },
    { h: 140, name: 'Малахит' },
];

const clamp = (h) => ((Math.round(Number(h)) % 360) + 360) % 360;

export function currentHue() {
    const raw = document.documentElement.style.getPropertyValue('--accent-h');
    const n = Number(raw);
    return Number.isFinite(n) && raw !== '' ? clamp(n) : DEFAULT_HUE;
}

export function storedHue() {
    try {
        const raw = localStorage.getItem(ACCENT_KEY);
        if (raw === null) return null;
        const n = Number(raw);
        return Number.isFinite(n) ? clamp(n) : null;
    } catch { return null; }
}

// Насколько тон светлой темы ниже тёмной. Тот же тон на низкой светлоте
// читается не «оранжевым», а болотным: светлая тема с самого начала жила на
// 62°, а тёмная на 83°. Смещение сохраняет вид обеих тем при значении по
// умолчанию.
export const LIGHT_SHIFT = 21;

// Единственная точка, где меняется акцент. Пишет два числа на <html> — дальше
// всё красится само, потому что каждый акцентный токен в style.css посчитан от
// них (см. --accent-hh).
//
// Второе число — тон светлой темы — считается ЗДЕСЬ, а не calc() в CSS.
// Пользовательские свойства это поток токенов, а не числа: calc внутри них не
// вычисляется, и сфера на главной (канвас, ей нужно настоящее число) получила
// бы строку «calc(83 - 21)» вместо 62.
export function applyAccent(hue, { persist = true } = {}) {
    const h = clamp(hue);
    const root = document.documentElement.style;
    root.setProperty('--accent-h', String(h));
    root.setProperty('--accent-h-light', String(clamp(h - LIGHT_SHIFT)));

    if (persist) {
        try { localStorage.setItem(ACCENT_KEY, String(h)); } catch { /* приватный режим */ }
    }

    syncSwatches(h);
    // Сфера на главной и тайлы карты нарисованы не CSS и переменных не видят —
    // они слушают это событие (см. sphere.js), как и смену темы.
    document.dispatchEvent(new CustomEvent('accentchange', { detail: { hue: h } }));
    return h;
}

export function resetAccent() {
    try { localStorage.removeItem(ACCENT_KEY); } catch { /* приватный режим */ }
    return applyAccent(DEFAULT_HUE, { persist: false });
}

// Ближайший пресет — только чтобы подсветить плашку. Ползунок стоит между
// готовыми тонами сплошь и рядом, и подсвечивать в этот момент нечего.
function syncSwatches(h) {
    document.querySelectorAll('[data-accent-hue]').forEach(el => {
        const on = Number(el.dataset.accentHue) === h;
        el.classList.toggle('is-current', on);
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
}

export function initAccent() {
    const h = currentHue();
    syncSwatches(h);

    // Сайт открыт в двух вкладках — выбор в одной подхватывается в другой
    // (localStorage шлёт storage только в «чужие» вкладки).
    window.addEventListener('storage', (e) => {
        if (e.key !== ACCENT_KEY) return;
        const next = e.newValue === null ? DEFAULT_HUE : Number(e.newValue);
        if (Number.isFinite(next) && clamp(next) !== currentHue()) {
            applyAccent(next, { persist: false });
        }
    });

    return h;
}

// ─────────────────────────────────────────────────────────────────────────────
// Сам выбор: девять готовых тонов и ползунок на всё остальное.
//
// Плашки НЕ КРАСЯТСЯ ЗАРАНЕЕ ПОСЧИТАННЫМ ЦВЕТОМ: каждая несёт свой тон в
// --sw-h, а цвет ей считает та же формула, что и кнопкам сайта (см. блок
// .accent-swatch в style.css). Поэтому в светлой теме плашки сами становятся
// бронзовыми, а не остаются яркими: человек видит цвет, который получит, а не
// образец из другой темы.
// ─────────────────────────────────────────────────────────────────────────────

export function accentPickerHtml() {
    const cur = currentHue();
    const swatches = PRESETS.map(p => `
        <button type="button" class="accent-swatch${p.h === cur ? ' is-current' : ''}"
                data-accent-hue="${p.h}" style="--sw-h:${p.h}"
                title="${p.name}" aria-label="${p.name}"
                aria-pressed="${p.h === cur ? 'true' : 'false'}"></button>`).join('');
    return `
        <div class="accent-picker">
            <div class="accent-swatches">${swatches}</div>
            <div class="accent-slider-row">
                <input type="range" class="accent-slider" min="0" max="359" step="1"
                       value="${cur}" aria-label="Тон акцента"/>
                <button type="button" class="btn btn-sec accent-reset">Сбросить</button>
            </div>
            <div class="accent-note">
                Меняется только тон. Светлота и насыщенность остаются нашими —
                на них держится контраст надписей на кнопках.
            </div>
        </div>`;
}

export function bindAccentPicker(root = document) {
    const box = root.querySelector?.('.accent-picker');
    if (!box || box.dataset.bound) return;
    box.dataset.bound = '1';

    const slider = box.querySelector('.accent-slider');

    box.addEventListener('click', (e) => {
        const sw = e.target.closest('[data-accent-hue]');
        if (sw) {
            const h = applyAccent(sw.dataset.accentHue);
            if (slider) slider.value = String(h);
            return;
        }
        if (e.target.closest('.accent-reset')) {
            const h = resetAccent();
            if (slider) slider.value = String(h);
        }
    });

    // input, а не change: цвет должен ехать под пальцем. Запись в localStorage
    // на каждый пиксель ползунка не страшна — это одна короткая строка, а
    // «сохранять по отпусканию» потеряло бы выбор при уходе со страницы.
    slider?.addEventListener('input', () => applyAccent(slider.value));
}
