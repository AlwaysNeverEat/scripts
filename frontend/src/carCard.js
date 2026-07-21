// ── Карточка машины в выпадашках поиска (свободный поиск и режим «Теги») ──────
// Общая разметка для main.js и tagSearch.js. Раньше строка была сплошным
// текстом одного цвета — глазами тяжело выхватить нужную машину из списка.
// Чтобы список не рябил, а взгляду было за что зацепиться, задана иерархия:
//   • Заголовок — «имя» машины: марка золотом-акцентом (якорь), модель белым,
//     поколение и код двигателя приглушены серым (при поиске они вторичны).
//   • Подпись (объём, кВт, л.с., годы) — округлые «кирпичики»-чипы: тут и живёт
//     цвет — у каждого спека своя полупрозрачная заливка, рамка и яркий текст.
// Цвета заданы в style.css токенами --cc-*, чипы — классом .cc-chip.

export function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const SEP = '<span class="cc-sep">·</span>';

// Внутренняя разметка одной карточки. Числовые поля из базы в esc не
// заворачиваем (как было раньше — они числовые).
export function carCardInner(car) {
    let title =
        `<span class="cc-brand">${esc(car.brand)}</span> ` +
        `<span class="cc-model">${esc(car.model)}</span>`;
    if (car.generation) title += ` ${SEP} <span class="cc-gen">${esc(car.generation)}</span>`;
    if (car.engine_code) title += ` ${SEP} <span class="cc-engine">${esc(car.engine_code)}</span>`;

    // Спеки — чипы-кирпичики; разделители не нужны, границы чипов и так делят.
    let sub = '';
    if (car.engine_volume) sub += `<span class="cc-chip cc-vol">${car.engine_volume}<span class="cc-unit">л</span></span>`;
    if (car.kw) sub += `<span class="cc-chip cc-kw">${car.kw}<span class="cc-unit">кВт</span></span>`;
    if (car.bhp) sub += `<span class="cc-chip cc-hp">${car.bhp}<span class="cc-unit">л.с.</span></span>`;
    if (car.year_from) sub += `<span class="cc-chip cc-year">${car.year_from}${car.year_to ? '–' + car.year_to : '+'}</span>`;

    return `<div class="car-card-title">${title}</div>` +
           `<div class="car-card-sub">${sub}</div>`;
}
