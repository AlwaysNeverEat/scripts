// ── Карточка машины в выпадашках поиска (свободный поиск и режим «Теги») ──────
// Общая разметка для main.js и tagSearch.js: раньше строка была сплошным
// текстом одного цвета — глазами тяжело выхватить нужную машину из списка.
// Теперь каждая смысловая часть (марка, модель, поколение, двигатель, объём,
// кВт, л.с., годы) получает свой ПОСТОЯННЫЙ цвет — цвета заданы в style.css
// как токены --cc-*. Разделители и единицы измерения приглушены, чтобы
// значения читались первыми.

export function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const SEP = '<span class="cc-sep">·</span>';
const SLASH = '<span class="cc-sep">/</span>';

// Внутренняя разметка одной карточки: заголовок (марка·модель·поколение·двигатель)
// и подпись (объём·кВт/л.с.·годы). Порядок и разделители — как были, добавлены
// только цветные обёртки. Числовые поля из базы в esc не заворачиваем (как раньше).
export function carCardInner(car) {
    let title =
        `<span class="cc-brand">${esc(car.brand)}</span> ` +
        `<span class="cc-model">${esc(car.model)}</span>`;
    if (car.generation) title += ` ${SEP} <span class="cc-gen">${esc(car.generation)}</span>`;
    if (car.engine_code) title += ` ${SEP} <span class="cc-engine">${esc(car.engine_code)}</span>`;

    let sub = '';
    if (car.engine_volume) sub += `<span class="cc-vol">${car.engine_volume}<span class="cc-unit">л</span></span>`;
    if (car.kw) sub += ` ${SEP} <span class="cc-kw">${car.kw}<span class="cc-unit">кВт</span></span>`;
    if (car.bhp) sub += ` ${SLASH} <span class="cc-hp">${car.bhp}<span class="cc-unit">л.с.</span></span>`;
    if (car.year_from) sub += ` ${SEP} <span class="cc-year">${car.year_from}${car.year_to ? '–' + car.year_to : '+'}</span>`;

    return `<div class="car-card-title">${title}</div>` +
           `<div class="car-card-sub">${sub}</div>`;
}
