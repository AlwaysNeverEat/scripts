// ─────────────────────────────────────────────────────────────────────────────
// Общий цветной логгер для скрейперов импорта. По образцу цветов из
// apply-filters.js, вынесен в переиспользуемый модуль с уровнями и дебагом.
//
//   IMPORT_COLOR=0 или NO_COLOR   — выключить цвет (стандарт no-color.org)
//   DEBUG=1 или флаг --debug      — включить подробный вывод log.debug()
//   IMPORT_TS=0                    — убрать метку времени в начале строк
// ─────────────────────────────────────────────────────────────────────────────

const COLOR_ENABLED = !process.env.NO_COLOR && process.env.IMPORT_COLOR !== '0';
const SHOW_TS = process.env.IMPORT_TS !== '0';

const ansi = (code, text) => (COLOR_ENABLED ? `\x1b[${code}m${text}\x1b[0m` : String(text));

// Палитра. Семантические цвета совпадают с apply-filters.js, чтобы вывод
// всех этапов пайплайна выглядел единообразно.
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

let DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true'
    || process.argv.includes('--debug');

const stamp = () => (SHOW_TS ? c.dim(new Date().toTimeString().slice(0, 8)) + ' ' : '');

function emit(stream, sym, msg) {
    stream(`${stamp()}${sym} ${msg}`);
}

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

export default log;
