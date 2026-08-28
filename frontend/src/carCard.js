// ── Карточка машины в выпадашках поиска (свободный поиск и режим «Теги») ──────
// Общая разметка для main.js и tagSearch.js. Раньше строка была сплошным
// текстом одного цвета — глазами тяжело выхватить нужную машину из списка.
// Чтобы список не рябил, а взгляду было за что зацепиться, задана иерархия:
//   • Заголовок — «имя» машины: марка золотом-акцентом (якорь), модель белым,
//     поколение и код двигателя приглушены серым (при поиске они вторичны).
//   • Подпись (топливо, объём, кВт, л.с., годы) — округлые «кирпичики»-чипы: тут
//     и живёт цвет — у каждого спека своя полупрозрачная заливка, рамка и текст.
// Цвета заданы в style.css токенами --cc-*, чипы — классом .cc-chip.
//
// Топливо стоит ПЕРВЫМ чипом и своим цветом (бензин зелёный, дизель фиолетовый):
// в выдаче по модели подряд идут два десятка строк, отличающихся только объёмом,
// и «мне нужен дизель» — первое, чем человек их отсеивает. У левого края чип
// ловится взглядом сверху вниз одним движением, а внутри строки его пришлось бы
// каждый раз искать заново. Подпись берётся из shared/fuel.js — там же, где её
// берут страница машины и юзерскрипт.

import { fuelLabel, isDieselFuel, isPetrolFuel } from '../../shared/fuel.js';

export function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const SEP = '<span class="cc-sep">·</span>';

// Дизель и бензин разведены цветом, а не только словом: список читают по
// диагонали. Нераспознанный код («топливо: X?») красим приглушённо — это повод
// поправить машину, а не признак топлива.
function fuelChipClass(fuelType) {
    if (isDieselFuel(fuelType)) return 'cc-diesel';
    if (isPetrolFuel(fuelType)) return 'cc-petrol';
    return 'cc-fuel-unknown';
}

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
    // fuelLabel уже экранирует нераспознанное значение и отдаёт '' у пустого:
    // «не указано» отдельным чипом не рисуем — пустое место честнее.
    const fuel = fuelLabel(car.fuel_type);
    if (fuel) sub += `<span class="cc-chip ${fuelChipClass(car.fuel_type)}">${fuel}</span>`;
    if (car.engine_volume) sub += `<span class="cc-chip cc-vol">${car.engine_volume}<span class="cc-unit">л</span></span>`;
    if (car.kw) sub += `<span class="cc-chip cc-kw">${car.kw}<span class="cc-unit">кВт</span></span>`;
    if (car.bhp) sub += `<span class="cc-chip cc-hp">${car.bhp}<span class="cc-unit">л.с.</span></span>`;
    if (car.year_from) sub += `<span class="cc-chip cc-year">${car.year_from}${car.year_to ? '–' + car.year_to : '+'}</span>`;

    return `<div class="car-card-title">${title}</div>` +
           `<div class="car-card-sub">${sub}</div>`;
}
