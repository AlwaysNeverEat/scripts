// ─────────────────────────────────────────────────────────────────────────────
// Общий цветной логгер для скриптов импорта. Держит два набора экспортов, чтобы
// сошлись обе линии работы:
//   • c / log / default — уровни с меткой времени и DEBUG (ЛУКОЙЛ-конвейер);
//   • color / mark / stage / carLabel / info / warn / fail / done — семантические
//     помощники (Liqui Moly, LYNX, фильтры).
//
//   IMPORT_COLOR=0 или NO_COLOR — выключить цвет (стандарт no-color.org)
//   DEBUG=1 или --debug         — включить подробный вывод log.debug()
//   IMPORT_TS=0                 — убрать метку времени в log.*
//
// На Windows цвета работают в conhost Win10+ / Windows Terminal; run-import.bat
// уже делает chcp 65001 для корректной кириллицы.
// ─────────────────────────────────────────────────────────────────────────────

const COLOR_ENABLED = !process.env.NO_COLOR && process.env.IMPORT_COLOR !== '0';
const SHOW_TS = process.env.IMPORT_TS !== '0';

const ansi = (code, text) => (COLOR_ENABLED ? `\x1b[${code}m${text}\x1b[0m` : String(text));

// Палитра ЛУКОЙЛ-логгера (совпадает с apply-filters.js).
export const c = {
    dim:     (s) => ansi(90, s),
    red:     (s) => ansi(31, s),
    green:   (s) => ansi(32, s),
    yellow:  (s) => ansi(33, s),
    blue:    (s) => ansi(94, s),
    magenta: (s) => ansi(35, s),
    cyan:    (s) => ansi(96, s),
    bold:    (s) => ansi(1, s),
    // семантические
    brand:   (s) => ansi(36, s),
    model:   (s) => ansi(35, s),
    engine:  (s) => ansi(33, s),
    year:    (s) => ansi(90, s),
    vol:     (s) => ansi(92, s),
    power:   (s) => ansi(94, s),
    ok:      (s) => ansi(32, s),
    link:    (s) => ansi(96, s),
    count:   (s) => ansi(96, s),
};

// Семантический color для Liqui Moly/LYNX/фильтров — супернабор с warn/err/
// filters/stage/dim, которых нет в c.
export const color = {
    ok:      (s) => ansi(32, s),
    warn:    (s) => ansi(33, s),
    err:     (s) => ansi(31, s),
    brand:   (s) => ansi(36, s),
    model:   (s) => ansi(35, s),
    engine:  (s) => ansi(33, s),
    year:    (s) => ansi(90, s),
    filters: (s) => ansi(92, s),
    power:   (s) => ansi(94, s),
    vol:     (s) => ansi(96, s),
    link:    (s) => ansi(96, s),
    dim:     (s) => ansi(2, s),
    stage:   (s) => ansi('1;95', s),
};

// Значки статуса.
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

let DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true'
    || process.argv.includes('--debug');

const stamp = () => (SHOW_TS ? c.dim(new Date().toTimeString().slice(0, 8)) + ' ' : '');

function emit(stream, sym, msg) {
    stream(`${stamp()}${sym} ${msg}`);
}

// Уровневый логгер ЛУКОЙЛ-конвейера.
export const log = {
    setDebug(value) { DEBUG = !!value; },
    debugEnabled() { return DEBUG; },

    info:    (msg) => emit(console.log,   c.dim('·'),  msg),
    ok:      (msg) => emit(console.log,   c.green('✓'), msg),
    warn:    (msg) => emit(console.warn,  c.yellow('⚠'), msg),
    error:   (msg) => emit(console.error, c.red('✗'),   msg),
    step:    (msg) => emit(console.log,   c.cyan('→'),  msg),
    debug:   (msg) => { if (DEBUG) emit(console.log, c.dim('debug'), c.dim(msg)); },

    section: (msg) => console.log('\n' + c.bold(c.cyan('══════ ' + msg + ' ══════'))),
    plain:   (msg) => console.log(msg),
    c,
};

// Плоские помощники для скраперов Liqui Moly/LYNX.
export function info(...args) { console.log(...args); }
export function warn(...args) { console.warn(`  ${mark.warn}`, ...args); }
export function fail(...args) { console.error(`  ${mark.fail}`, ...args); }
export function done(...args) { console.log(`  ${mark.ok}`, ...args); }

export { COLOR_ENABLED };
export default log;
