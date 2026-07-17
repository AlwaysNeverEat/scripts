// ─────────────────────────────────────────────────────────────────────────────
// Общий цветной логгер для скриптов импорта. Раньше ANSI-раскраска жила только
// в apply-filters.js — вынесли сюда, чтобы весь конвейер (Liqui Moly, фильтры,
// заливка) писал в консоль единообразно и разными цветами.
//
// Цвет гасится через NO_COLOR (стандарт) или IMPORT_COLOR=0. На Windows цвета
// работают в conhost Win10+ / Windows Terminal; run-import.bat уже делает
// chcp 65001 для корректной кириллицы.
// ─────────────────────────────────────────────────────────────────────────────

const COLOR_ENABLED = !process.env.NO_COLOR && process.env.IMPORT_COLOR !== '0';

const ansi = (code, text) => COLOR_ENABLED ? `\x1b[${code}m${text}\x1b[0m` : String(text);

// Палитра совпадает с прежней из apply-filters.js, плюс несколько ролей.
export const color = {
    ok: (s) => ansi(32, s),        // зелёный  — успех
    warn: (s) => ansi(33, s),      // жёлтый    — предупреждение
    err: (s) => ansi(31, s),       // красный   — ошибка
    brand: (s) => ansi(36, s),     // голубой   — марка
    model: (s) => ansi(35, s),     // magenta   — модель
    engine: (s) => ansi(33, s),    // жёлтый    — двигатель/модификация
    year: (s) => ansi(90, s),      // серый     — годы
    filters: (s) => ansi(92, s),   // ярко-зел. — артикулы фильтров
    power: (s) => ansi(94, s),     // синий     — кВт/л.с.
    vol: (s) => ansi(96, s),       // циан      — объёмы
    link: (s) => ansi(96, s),      // циан      — ссылки
    dim: (s) => ansi(2, s),        // тусклый   — второстепенное
    stage: (s) => ansi('1;95', s), // жирн.роз. — заголовок этапа
};

// Значки статуса — те же, что уже использовались в скраперах.
export const mark = {
    ok: color.ok('✓'),
    fail: color.err('✗'),
    warn: color.warn('⚠'),
    step: color.dim('→'),
    wait: color.dim('…'),
};

// Заголовок этапа: «── ЭТАП ──────────».
export function stage(title) {
    const line = `── ${title} `;
    console.log('\n' + color.stage(line + '─'.repeat(Math.max(0, 60 - line.length))));
}

// Единый ярлык машины во всех логах: Марка Модель Двигатель Год.
export function carLabel(car) {
    return [
        color.brand(car.brand),
        color.model(car.model),
        car.engine_code ? color.engine(car.engine_code) : '',
        car.year_from ? color.year(car.year_from) : '',
    ].filter(Boolean).join(' ');
}

export function info(...args) { console.log(...args); }
export function warn(...args) { console.warn(`  ${mark.warn}`, ...args); }
export function fail(...args) { console.error(`  ${mark.fail}`, ...args); }
export function done(...args) { console.log(`  ${mark.ok}`, ...args); }

export { COLOR_ENABLED };
