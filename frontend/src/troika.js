// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Тройка» (матч-3 на время) — окно игры и мини-топ.
//
// Открывается ТОЛЬКО из меню игр (games.js), а оно — из поиска на главной:
// набрать «игры» и нажать Enter. Пока это слово набирают, поиск молчит.
//
// Правила игры целиком в shared/troika.js — здесь ни одной строчки про то, что
// считается тройкой, что даётся за четвёрку и сколько стоит каскад. Этот файл
// занимается тремя вещами: рисует поле, слушает клики с клавишами и один раз в
// конце партии относит результат на сервер (backend/src/routes/troika.js).
//
// Как показывается каскад. Правила считают шаг ЦЕЛИКОМ и сразу (resolveStep:
// убрать, обвалить, досыпать), а окно разбирает его на четыре фазы и играет их
// по очереди — выделение, уборка, очки, падение (playStep). Пока фазы идут, в
// DOM висит СТАРАЯ картинка: она и нужна, чтобы показать, что именно исчезает.
// Без этого шаг был бы одной мгновенной подменой поля — «что-то мигнуло, очков
// стало больше», и понять, за что их дали, нельзя.
//
// ТАЙМЕР НА ВРЕМЯ ФАЗ ОСТАНАВЛИВАЕТСЯ: игрок в этот момент не может сделать
// ровно ничего, и брать с него секунды не за что. Иначе длинная цепочка — лучшее,
// что бывает в этой игре — наказывала бы сильнее всего. Отсюда же следует, что
// партия не может кончиться посреди анимации: ноль наступает между ходами.
//
// Партия переживает закрытие окна: state кладётся в модульную переменную, и
// «Тройка» из меню возвращает к тому же полю — но НА ПАУЗЕ: таймер, который
// тикал бы в закрытом окне, просто съел бы партию, пока человек ищет машину.
// Перезагрузку страницы партия не переживает, и это осознанно: держать поле в
// localStorage ради пасхалки не стоит того.
// ─────────────────────────────────────────────────────────────────────────────

import {
    createGame, applySwap, resolveStep, hasMove, findMove, shuffle, tickTime,
    areNeighbours, idx, xOf, yOf,
    SIZE, CELLS, KINDS, SPECIAL_CLASS,
    NONE, CLOCK,
    MAX_MS, LOW_TIME_MS, CLOCK_MS, MAX_CASCADE_MULT,
} from '../../shared/troika.js';
// Значки интерфейса остаются SVG: часы в шапке таймера, стрелки в подсказке по
// клавишам и «перемешано» в строке новостей — это не фишки, а элементы окна, и
// картинке из спрайта там делать нечего.
import {
    clockIcon, shuffleIcon,
    arrowLeftIcon, arrowRightIcon, arrowUpIcon, arrowDownIcon,
} from './icons.js';
import tilesSheet from './assets/troika-tiles.webp';

const MODAL_ID = 'troika-modal';

// Длительности фаз одного шага цепочки (см. playStep). Подобраны так, чтобы шаг
// читался целиком примерно за секунду: меньше — фазы сливаются в рывок, больше —
// партия начинает раздражать ожиданием.
const PHASE_MARK = 260;    // вспыхнули те фишки, что засчитались
const PHASE_CLEAR = 190;   // исчезли
const PHASE_POP = 380;     // на их месте всплыли очки
const PHASE_FALL = 260;    // сверху всё съехало вниз

// Через сколько молчания показать подсказку. Пять секунд — это уже «сижу и ищу»,
// а не «думаю»: за это время человек успевает просмотреть поле один раз.
const HINT_AFTER_MS = 5_000;

// Свайп: с какого смещения жест считается «потянул фишку», а не «ткнул». Меньше
// десятка пикселей — и обычный тап пальцем становится случайным ходом.
const SWIPE_PX = 12;

// Фишки нарисованы картинками и лежат ОДНИМ спрайтом 6×6 (assets/troika-tiles):
// строка — вид фишки (порядок KINDS), столбец — состояние (порядок констант
// NONE…CLOCK из правил). Тридцать шесть отдельных файлов дали бы тридцать шесть
// запросов при открытии окна, и первые полсекунды поле стояло бы пустым.
//
// Из этого же спрайта берутся картинки в легенде — она обязана показывать ровно
// те фишки, которые лежат на поле, а не «похожие значки».
//
// Клетка кодируется одним числом (вид × 8 + состояние), и класс на неё посчитан
// заранее: 36 вариантов на всю игру. Собирать строку класса на каждую клетку
// каждого шага незачем — за партию это десятки тысяч склеек.
const CODE_OF = (color, special) => color * 8 + special;
const TILE = (() => {
    const table = [];
    for (let color = 0; color < KINDS.length; color++) {
        for (let special = NONE; special <= CLOCK; special++) {
            // Вид даёт строку спрайта и цвет подсветки, состояние — столбец.
            table[CODE_OF(color, special)] = `tro-cell k-${KINDS[color]} s-${SPECIAL_CLASS[special]}`;
        }
    }
    return table;
})();

let openState = null;   // одно окно за раз
let saved = null;       // недоигранная партия: окно закрыли, но время не вышло

/** Открыть игру. ctx: { apiFetch, user }. */
export function openTroika(ctx) {
    if (openState) return openState.modal;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'modal';
    modal.innerHTML = shellHtml();
    // Путь к спрайту знает сборщик (он его хэширует), а нужен он в CSS — поэтому
    // кладём его переменной на само окно, а не прописываем в style.css.
    const win = modal.querySelector('.tro-win');
    win.style.setProperty('--tro-sheet', `url(${tilesSheet})`);
    // Пока картинки нет, клетки красятся цветами своих видов: спрайт весит
    // полторы сотни килобайт, и на плохой связи поле иначе стояло бы пустым.
    // Если он не загрузится вовсе, класс так и останется — по цветам играть
    // можно, по пустым квадратам нельзя.
    win.classList.add('no-tiles');
    const sheet = new Image();
    sheet.onload = () => win.classList.remove('no-tiles');
    sheet.src = tilesSheet;
    document.body.appendChild(modal);
    document.body.classList.add('modal-open');

    const resumed = !!saved;
    const state = {
        ctx,
        modal,
        game: saved || createGame(),
        cells: [],
        drawn: new Int16Array(CELLS).fill(-1),   // −1 — «ещё не рисовали»
        sel: -1,                                 // выбранная фишка
        cursor: idx(SIZE >> 1, SIZE >> 1),       // курсор для игры с клавиатуры
        keyboard: false,                         // курсор показываем, только когда им играют
        drag: null,                              // { from, x, y } — начатый жест
        busy: false,                             // идёт каскад, ход не принимается
        idleMs: 0,                               // сколько игрок не делает ходов
        hint: null,                              // подсвеченная пара [a, b]
        countRaf: 0,                             // счётчик очков «доезжает» до нового
        // Партию, поднятую из отложенной, продолжают с паузы: см. шапку файла.
        paused: resumed,
        finished: false,
        raf: 0,
        last: 0,
        timers: [],
        stats: { score: -1, level: -1 },
        timeShown: -1,
        top: null,
        topFailed: false,
        sending: false,
    };
    openState = state;
    saved = null;

    const close = () => {
        stopLoop(state);
        cancelCount(state);
        clearTimers(state);
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('visibilitychange', onHide);
        // Каскад мог остаться недокрученным (окно закрыли посреди анимации) —
        // доводим его до конца сразу: иначе отложенная партия вернётся с полем,
        // которое не принимает ходов, пока цепочка не доиграна. И тем же
        // движением проверяем тупик: докрученный каскад мог оставить поле без
        // ходов, а перемешать его здесь больше некому.
        while (resolveStep(state.game));
        if (!state.game.over && !hasMove(state.game)) shuffle(state.game);
        // Недоигранную партию запоминаем: закрыть окно — не то же самое, что
        // проиграть. Доигранную забываем, иначе «Заново» открывало бы труп.
        saved = state.game.over ? null : state.game;
        modal.remove();
        document.body.classList.remove('modal-open');
        openState = null;
    };

    const onKeyDown = (e) => handleKey(state, e, close);
    // Свернули вкладку — ставим на паузу. Без этого человек возвращается к
    // проигранной партии: таймер шёл, пока он смотрел в другое место.
    const onHide = () => { if (document.hidden) setPaused(state, true); };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('visibilitychange', onHide);

    modal.querySelector('.modal-backdrop').onclick = close;
    modal.querySelector('#tro-close').onclick = close;
    modal.querySelector('#tro-restart').onclick = () => restart(state);
    modal.querySelector('#tro-resume').onclick = () => setPaused(state, false);

    buildBoard(state);
    bindBoard(state);
    renderAll(state);
    renderOverlay(state);
    if (!state.paused) startLoop(state);
    loadTop(state);
    return modal;
}

function shellHtml() {
    return `
        <div class="modal-backdrop"></div>
        <div class="modal-win tro-win">
            <div class="modal-head">
                <span>Тройка</span>
                <button class="btn btn-sec" id="tro-close" title="Закрыть">✕</button>
            </div>
            <div class="tro-body">
                <div class="tro-hud">
                    <div class="tro-time">
                        <div class="tro-time-row">
                            <span class="tro-time-label">${clockIcon(14)} Время</span>
                            <b id="tro-secs">0</b>
                            <span class="tro-time-gain" id="tro-time-gain"></span>
                        </div>
                        <div class="tro-time-bar"><i id="tro-time-fill"></i></div>
                    </div>
                    <div class="tro-stat"><span>Очки</span><b id="tro-score">0</b></div>
                    <div class="tro-stat"><span>Уровень</span><b id="tro-level">1</b></div>
                </div>

                <div class="tro-play">
                    <div class="tro-board" id="tro-board"></div>
                    <div class="tro-overlay hidden" id="tro-overlay">
                        <div class="tro-overlay-card">
                            <div class="tro-over-title" id="tro-over-title"></div>
                            <div class="tro-over-sub" id="tro-over-sub"></div>
                            <div class="tro-over-actions">
                                <button type="button" class="btn btn-pri" id="tro-restart">Заново</button>
                                <button type="button" class="btn btn-sec hidden" id="tro-resume">Продолжить</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="tro-note" id="tro-note"></div>
                <div class="tro-legend">${legendHtml()}</div>
                <div class="tro-top" id="tro-top"></div>
                <div class="tro-hint">${hintHtml()}</div>
            </div>
        </div>`;
}

// Что дают «штучки» — прямо в окне: искать это в голове посреди партии на время
// невозможно, а без них игра превращается в обычный матч-3 без причины думать.
//
// Показываем НАСТОЯЩИЕ фишки из того же спрайта (каждую своего вида — заодно
// видно, что специальная бывает любого): значок «вообще про ракету» пришлось бы
// сопоставлять с тем, что лежит на поле, а это ровно та работа, которую легенда
// и должна снимать.
function legendHtml() {
    const chip = (kind, state) => `<i class="tro-chip k-${kind} s-${state}"></i>`;
    const item = (tile, text) => `<span class="tro-legend-item">${tile}<span>${text}</span></span>`;
    return item(chip('square', 'rocket-h'), 'четвёрка или квадрат 2×2 — ракета, сносит линию')
        + item(chip('drop', 'bomb'), 'угол — бомба, сносит 5×5')
        + item(chip('star', 'prism'), 'пятёрка — призма, сносит все свои')
        + item(chip('triangle', 'clock'), `часы — плюс ${CLOCK_MS / 1000} с к таймеру`);
}

// Легенда управления: в рамке — САМА КЛАВИША, рядом — что она делает (так же,
// как в тетрисе). Мышью и пальцем играть можно, ничего не читая, — а вот про
// клавиатуру догадаться нельзя.
function hintHtml() {
    const key = inner => `<kbd class="tro-key">${inner}</kbd>`;
    const item = (keys, label) => `<span class="tro-legend-item">${keys}<span>${label}</span></span>`;
    return item(
        key(arrowLeftIcon(14)) + key(arrowUpIcon(14)) + key(arrowDownIcon(14)) + key(arrowRightIcon(14)),
        'курсор',
    )
        + item(key('пробел'), 'взять фишку, потом стрелка — обменять')
        + item(key('P'), 'пауза');
}

// ── Кадры и время ────────────────────────────────────────────────────────────

function startLoop(state) {
    if (state.raf || state.paused || state.game.over) return;
    state.last = performance.now();
    state.raf = requestAnimationFrame(ts => frame(state, ts));
}

function stopLoop(state) {
    if (!state.raf) return;
    cancelAnimationFrame(state.raf);
    state.raf = 0;
}

// Потолок на длину кадра: вкладку свернули, ноутбук поставили на паузу — между
// кадрами может пройти минута, и без потолка партия обрывается «сама».
const MAX_FRAME_MS = 100;

function frame(state, ts) {
    if (openState !== state) return;
    const dt = Math.min(ts - state.last, MAX_FRAME_MS);
    state.last = ts;

    // ТАЙМЕР СТОИТ, ПОКА ИДЁТ ЦЕПОЧКА. Пока показывается уборка, очки и падение,
    // игрок не может сделать ровно ничего — брать с него за это секунды нечестно,
    // а длинный каскад (он же лучший ход в игре) наказывался бы сильнее всего.
    // Заодно из этого следует, что партия не может кончиться посреди анимации:
    // ноль на таймере наступает только между ходами.
    let ended = false;
    if (!state.busy) {
        ended = tickTime(state.game, dt);
        renderTime(state);
        // Простой считаем там же: во время каскада игрок не бездельничает, он
        // смотрит, что натворил.
        if (!state.hint) {
            state.idleMs += dt;
            if (state.idleMs >= HINT_AFTER_MS) showHint(state);
        }
    }
    if (ended) {
        state.raf = 0;
        finish(state);
        return;
    }
    state.raf = requestAnimationFrame(t => frame(state, t));
}

function clearTimers(state) {
    state.timers.forEach(clearTimeout);
    state.timers = [];
}

function later(state, fn, ms) {
    const id = setTimeout(() => {
        state.timers = state.timers.filter(t => t !== id);
        if (openState === state) fn();
    }, ms);
    state.timers.push(id);
}

// ── Ход ──────────────────────────────────────────────────────────────────────

function tryMove(state, a, b) {
    if (state.busy || state.paused || state.game.over) return;
    if (a < 0 || b < 0) return;
    if (!applySwap(state.game, a, b)) {
        // Обмен не по правилам: не молчим, но и не ругаемся — короткий отказ
        // клетками понятнее любой надписи.
        shake(state, a);
        shake(state, b);
        return;
    }
    setSel(state, -1);
    clearHint(state);
    renderBoard(state);
    runCascade(state);
}

// ── Подсказка ────────────────────────────────────────────────────────────────

// Игрок несколько секунд не ходит — показываем ОДИН возможный обмен: обе фишки
// пары начинают пульсировать. Это подсказка «вот здесь», а не «сделай так»:
// ходов на поле обычно с десяток, и правила всегда возвращают один и тот же
// (см. findMove), чтобы подсветка не прыгала, пока человек на неё смотрит.
//
// Подсказка ничего не стоит игроку и никак не мешает: очки за неё не снимаются
// — партия и так идёт на время, и потерянные на поиск секунды это уже цена.
function showHint(state) {
    if (state.paused || state.game.over) return;
    const move = findMove(state.game);
    if (!move) return;              // тупик разберёт afterSettle
    state.hint = move;
    move.forEach(i => paintMarks(state, i));
}

function clearHint(state) {
    state.idleMs = 0;
    const hint = state.hint;
    if (!hint) return;
    state.hint = null;
    hint.forEach(i => paintMarks(state, i));
}

// Каскад показывается ФАЗАМИ, по одному шагу за раз. Пока цепочка идёт, ходы не
// принимаются (state.busy) и таймер стоит: поле в этот момент уже другое, и
// «успеть ткнуть» означало бы ткнуть не туда, куда смотришь.
function runCascade(state) {
    state.busy = true;
    const stepOnce = () => {
        const step = resolveStep(state.game);
        if (!step) {
            state.busy = false;
            afterSettle(state);
            return;
        }
        playStep(state, step, stepOnce);
    };
    stepOnce();
}

/**
 * Один шаг цепочки — четыре фазы подряд, и порядок в них весь смысл:
 *
 *   1. ВЫДЕЛЕНИЕ — вспыхивают ровно те фишки, которые засчитались. Это главная
 *      фаза: без неё игрок видит, что очков стало больше, но не видит, за что;
 *   2. УБОРКА — они исчезают, на их месте остаются дырки;
 *   3. ОЧКИ — на месте убранного всплывает «+540» (и «+3 с», если там были
 *      часы), а счётчик в шапке доезжает до нового значения;
 *   4. ПАДЕНИЕ — фишки сверху съезжают в дырки, новые прилетают из-за края.
 *
 * Раньше всё это было двумя мгновенными перерисовками, и цепочка из пяти шагов
 * выглядела одним рывком: «что-то мигнуло, очков стало больше».
 *
 * Глубокие цепочки идут быстрее (stepSpeed): десять шагов по полной длительности
 * — это десять секунд наблюдения, а игрок в этот момент уже понял, что происходит,
 * и хочет продолжать.
 */
function playStep(state, step, next) {
    const k = stepSpeed(step.cascade);
    const phases = [
        [() => markCleared(state, step), PHASE_MARK],
        [() => clearCells(state, step), PHASE_CLEAR],
        [() => popScore(state, step, k), PHASE_POP],
        [() => dropBoard(state, step, k), PHASE_FALL],
    ];
    let i = 0;
    const run = () => {
        if (i >= phases.length) { next(); return; }
        const [enter, ms] = phases[i++];
        enter();
        later(state, run, Math.round(ms * k));
    };
    run();
}

// Чем глубже цепочка, тем короче её показ — но не быстрее, чем вдвое: иначе
// самый красивый момент партии превращается в мельтешение.
function stepSpeed(cascade) {
    return Math.max(0.5, 1 - (cascade - 1) * 0.12);
}

function afterSettle(state) {
    // Ходов не осталось — перемешиваем. Партия идёт на время, и «ходов нет, вы
    // проиграли» было бы наказанием за случайность, а не за игру.
    if (!state.game.over && !hasMove(state.game)) {
        shuffle(state.game);
        renderBoard(state);
        note(state, `${shuffleIcon(14)} Ходов не осталось — поле перемешано`);
    }
    // Каскад кончился — поле другое, и отсчёт «сижу и ищу» начинается заново.
    clearHint(state);
    if (state.game.over) finish(state);
}

// ── Клавиши, мышь, палец ─────────────────────────────────────────────────────

function bindBoard(state) {
    const board = state.modal.querySelector('#tro-board');

    board.addEventListener('pointerdown', (e) => {
        const cell = e.target.closest('[data-i]');
        if (!cell || state.busy || state.paused || state.game.over) return;
        e.preventDefault();          // иначе палец «выделяет» клетку и скроллит окно
        cell.setPointerCapture?.(e.pointerId);
        state.drag = { from: Number(cell.dataset.i), x: e.clientX, y: e.clientY };
    });

    const finishDrag = (e) => {
        const drag = state.drag;
        if (!drag) return;
        state.drag = null;
        if (state.busy || state.paused || state.game.over) return;

        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        // Потянули фишку — ход в сторону жеста. Это основной способ играть
        // пальцем: тыкать дважды на телефоне неудобно и медленно.
        if (Math.max(Math.abs(dx), Math.abs(dy)) > SWIPE_PX) {
            const dir = Math.abs(dx) > Math.abs(dy)
                ? (dx > 0 ? 'right' : 'left')
                : (dy > 0 ? 'down' : 'up');
            tryMove(state, drag.from, neighbour(drag.from, dir));
            setSel(state, -1);
            return;
        }
        // Просто ткнули: первый тап выбирает фишку, второй по соседке — обменивает.
        if (state.sel === drag.from) { setSel(state, -1); return; }
        if (state.sel >= 0 && areNeighbours(state.sel, drag.from)) {
            const from = state.sel;
            setSel(state, -1);
            tryMove(state, from, drag.from);
            return;
        }
        setSel(state, drag.from);
    };
    board.addEventListener('pointerup', finishDrag);
    board.addEventListener('pointercancel', () => { state.drag = null; });
}

function neighbour(i, dir) {
    const x = xOf(i);
    const y = yOf(i);
    if (dir === 'left') return x > 0 ? i - 1 : -1;
    if (dir === 'right') return x < SIZE - 1 ? i + 1 : -1;
    if (dir === 'up') return y > 0 ? i - SIZE : -1;
    return y < SIZE - 1 ? i + SIZE : -1;
}

const ARROW_DIR = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
};

// Смотрим на e.code, а не на e.key: код клавиши не зависит от раскладки, и «P»
// ставит на паузу и в русской, и в английской.
function handleKey(state, e, close) {
    if (e.code === 'Escape') { e.preventDefault(); close(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

    if (e.code === 'KeyP') { e.preventDefault(); setPaused(state, !state.paused); return; }

    const dir = ARROW_DIR[e.code];
    const isPick = e.code === 'Space' || e.code === 'Enter';
    if (!dir && !isPick) return;
    e.preventDefault();          // стрелки не должны прокручивать страницу под окном

    if (state.paused || state.game.over) {
        if (isPick) {
            if (state.game.over) restart(state); else setPaused(state, false);
        }
        return;
    }
    if (state.busy) return;

    // Первое нажатие только ПОКАЗЫВАЕТ курсор: он появляется в середине поля, и
    // двигать его тем же нажатием значило бы «стрелка сдвинула что-то, чего я не
    // видел». Дальше курсор уже на месте и ходит нормально.
    if (!state.keyboard) {
        state.keyboard = true;
        paintMarks(state, state.cursor);
        if (dir) return;
    }
    if (dir) {
        // Фишка взята — стрелка не двигает курсор, а делает ход в её сторону:
        // ровно то, что человек и хочет сказать, «взяв» фишку.
        if (state.sel >= 0) {
            const from = state.sel;
            setSel(state, -1);
            setCursor(state, from);
            tryMove(state, from, neighbour(from, dir));
            return;
        }
        const to = neighbour(state.cursor, dir);
        if (to >= 0) setCursor(state, to);
        return;
    }
    setSel(state, state.sel === state.cursor ? -1 : state.cursor);
}

// ── Пауза, конец партии, новая партия ────────────────────────────────────────

function setPaused(state, on) {
    if (state.game.over || state.paused === on) return;
    state.paused = on;
    state.drag = null;
    setSel(state, -1);
    if (on) stopLoop(state); else startLoop(state);
    renderOverlay(state);
}

function restart(state) {
    stopLoop(state);
    cancelCount(state);
    clearTimers(state);
    state.modal.querySelectorAll('.tro-pop').forEach(n => n.remove());
    state.game = createGame();
    saved = null;
    state.busy = false;
    state.paused = false;
    state.finished = false;
    state.sel = -1;
    state.hint = null;
    state.idleMs = 0;
    state.drag = null;
    state.drawn.fill(-1);
    state.stats = { score: -1, level: -1 };
    state.timeShown = -1;
    note(state, '');
    renderAll(state);
    renderOverlay(state);
    startLoop(state);
}

// Время вышло: показать итог и отнести результат в мини-топ. Ровно один запрос
// за партию — весь сетевой трафик пасхалки.
function finish(state) {
    if (state.finished) return;
    state.finished = true;
    stopLoop(state);
    setSel(state, -1);
    renderAll(state);
    renderOverlay(state);
    sendScore(state);
}

async function sendScore(state) {
    if (state.sending) return;
    const { score, moves, tiles, clocks, bestCascade, elapsedMs } = state.game;
    // Партию, в которой ничего не набрали, в топ не несём: она никому не
    // интересна, а строку в базе завела бы.
    if (score <= 0) return;
    state.sending = true;
    try {
        const res = await state.ctx.apiFetch('/api/troika/score', {
            method: 'POST',
            body: {
                score, moves, tiles, clocks,
                cascade: bestCascade,
                seconds: Math.round(elapsedMs / 1000),
            },
        });
        if (openState !== state) return;
        if (res && res.ok) {
            state.top = { rows: res.rows, me: res.me };
            renderTop(state);
            if (res.improved) markRecord(state);
        }
    } catch {
        // Сеть отвалилась — партию это не портит, результат просто не попал в
        // топ. Ругаться на человека за это нечем.
    }
    state.sending = false;
}

function markRecord(state) {
    const sub = state.modal.querySelector('#tro-over-sub');
    if (sub) sub.innerHTML += ' <b class="tro-record">Личный рекорд!</b>';
}

// ── Отрисовка поля ───────────────────────────────────────────────────────────

function buildBoard(state) {
    const board = state.modal.querySelector('#tro-board');
    // Внутри клетки ничего нет: фишка — это картинка со спрайта, то есть фон
    // самой кнопки. Поэтому шаг каскада меняет только className, и innerHTML за
    // партию не трогается ни разу.
    board.innerHTML = Array.from({ length: CELLS },
        (_, i) => `<button type="button" class="tro-cell" data-i="${i}" tabindex="-1"></button>`).join('');
    // Узлы клеток запоминаем один раз: искать их по data-i на каждый шаг каскада
    // значило бы обходить поддерево 64 раза за 240 мс.
    state.cells = [...board.children];
}

function renderAll(state) {
    renderBoard(state);
    renderStats(state);
    renderTime(state);
}

/**
 * Перерисовать поле. step (если передан) — шаг каскада, который сейчас
 * показывается: тогда фишки ЕДУТ на свои места сверху (step.fall говорит, с
 * какой высоты каждая), а выданные за фигуру специальные — появляются на месте.
 *
 * Падение рисуется сдвигом: клетка сразу ставится туда, где фишка окажется, но
 * начинает движение на --fall строк выше. Двигать сами клетки по сетке нельзя —
 * это перекладка всего поля на каждый кадр.
 *
 * Трогаем только изменившиеся клетки: шаг меняет десяток из шестидесяти
 * четырёх, а className — самая дорогая операция в этом окне.
 */
function renderBoard(state, step = null) {
    const born = step ? new Set(step.created.map(c => c.cell)) : null;
    const { game, cells, drawn } = state;
    for (let i = 0; i < CELLS; i++) {
        const color = game.color[i];
        if (color < 0) continue;                 // пустых клеток снаружи не бывает
        const code = CODE_OF(color, game.special[i]);
        const fall = step ? step.fall[i] : 0;
        // Клетка могла не измениться по виду, но всё равно получить подсветку
        // уборки — её надо снять, поэтому здесь не continue, а paintMarks.
        if (drawn[i] === code && !fall && !(step && born.has(i))) { paintMarks(state, i); continue; }
        drawn[i] = code;
        let extra = '';
        if (step && born.has(i)) extra = ' is-born';
        else if (fall) {
            extra = ' is-fall';
            cells[i].style.setProperty('--fall', String(fall));
        }
        cells[i].className = TILE[code] + extra + marks(state, i);
    }
}

// Выбор и курсор живут поверх обычного класса клетки: их две штуки на поле, и
// перерисовывать из-за них всё поле незачем.
function marks(state, i) {
    return (state.sel === i ? ' is-sel' : '')
        + (state.keyboard && state.cursor === i ? ' is-cursor' : '')
        + (state.hint && (state.hint[0] === i || state.hint[1] === i) ? ' is-hint' : '');
}

function paintMarks(state, i) {
    const node = state.cells[i];
    const want = TILE[state.drawn[i]] + marks(state, i);
    if (node.className !== want) node.className = want;
}

function setSel(state, i) {
    if (state.sel === i) return;
    const prev = state.sel;
    state.sel = i;
    if (prev >= 0) paintMarks(state, prev);
    if (i >= 0) paintMarks(state, i);
}

function setCursor(state, i) {
    if (state.cursor === i) return;
    const prev = state.cursor;
    state.cursor = i;
    paintMarks(state, prev);
    paintMarks(state, i);
}

// ── Фазы шага цепочки ────────────────────────────────────────────────────────
//
// Все они работают ПО ИНДЕКСАМ клеток: правила уже посчитали шаг целиком, а в
// DOM до последней фазы висит старая картинка — она и нужна, чтобы показать, что
// именно исчезает.

// 1. Выделение: вспыхивают те фишки, которые засчитались. Сработавшие
// специальные помечаются отдельно — у ракеты и бомбы должно быть видно, что
// рвануло именно тут, а не просто «полполя пропало».
function markCleared(state, step) {
    const fired = new Set(step.fired.map(f => f.cell));
    for (const i of step.cells) {
        const node = state.cells[i];
        if (!node) continue;
        node.classList.add('is-mark');
        if (fired.has(i)) node.classList.add('is-fired');
    }
}

// 2. Уборка: выделенные фишки уходят в точку, на их месте остаются дырки.
function clearCells(state, step) {
    const fired = new Set(step.fired.map(f => f.cell));
    for (const i of step.cells) {
        const node = state.cells[i];
        if (!node) continue;
        node.classList.remove('is-mark', 'is-fired');
        node.classList.add(fired.has(i) ? 'is-boom' : 'is-clear');
    }
}

// 3. Очки — НА МЕСТЕ убранного, а не где-то в углу: цифра должна отвечать на
// вопрос «за что», а для этого ей надо всплыть там, куда игрок и смотрит.
// Заодно счётчик в шапке доезжает до нового значения (countTo): цифра, которая
// перескакивает, читается как чужая.
function popScore(state, step, k) {
    if (step.gained > 0) {
        const mult = step.mult > 1
            ? `<span class="tro-pop-mult">×${step.mult}${step.mult === MAX_CASCADE_MULT ? '!' : ''}</span>`
            : '';
        const time = step.timeGained > 0
            ? `<span class="tro-pop-time">+${Math.round(step.timeGained / 1000)} с</span>`
            : '';
        const pop = document.createElement('div');
        pop.className = 'tro-pop';
        pop.innerHTML = `${mult}<span class="tro-pop-score">+${step.gained.toLocaleString('ru-RU')}</span>${time}`;
        const at = centerOf(state, step.cells);
        pop.style.left = `${at.x}px`;
        pop.style.top = `${at.y}px`;
        // Цифра живёт ровно свою фазу плюс падение: к следующему шагу от неё не
        // должно остаться ничего, иначе на поле копится столбик чисел.
        const life = Math.round((PHASE_POP + PHASE_FALL) * k);
        pop.style.setProperty('--pop-ms', `${life}ms`);
        state.modal.querySelector('.tro-play').appendChild(pop);
        later(state, () => pop.remove(), life);
        countTo(state, state.game.score, Math.round(PHASE_POP * k));
    }
    // «+N с» у таймера — там же, где секунды: часы это продолжение партии, и
    // заметить их надо в том месте, которое от них зависит.
    if (step.timeGained > 0) {
        const gain = state.modal.querySelector('#tro-time-gain');
        if (gain) {
            gain.textContent = `+${Math.round(step.timeGained / 1000)} с`;
            gain.classList.remove('is-show');
            void gain.offsetWidth;
            gain.classList.add('is-show');
        }
        renderTime(state);
    }
}

// 4. Падение: поле перерисовывается уже новым, и всё, что съехало вниз,
// приезжает сверху (см. renderBoard). На время падения поле обрезает вылезающее
// за край — новые фишки прилетают из-за верхней рамки, а не из шапки окна.
function dropBoard(state, step, k) {
    const board = state.modal.querySelector('#tro-board');
    const ms = Math.round(PHASE_FALL * k);
    board.style.setProperty('--fall-ms', `${ms}ms`);
    board.classList.add('is-falling');
    renderBoard(state, step);
    later(state, () => board.classList.remove('is-falling'), ms);
}

/** Середина набора клеток в координатах окна игры — куда всплыть цифре. */
function centerOf(state, cells) {
    const play = state.modal.querySelector('.tro-play').getBoundingClientRect();
    const first = state.cells[0].getBoundingClientRect();
    // Шаг сетки меряем по соседней клетке, а не берём из CSS: промежуток между
    // клетками задан там, и держать его копией здесь — верный способ разъехаться.
    const stepPx = state.cells[1].getBoundingClientRect().left - first.left;
    let sx = 0;
    let sy = 0;
    for (const i of cells) {
        sx += xOf(i);
        sy += yOf(i);
    }
    const n = cells.length || 1;
    // Цифру держим внутри поля: у тройки в верхнем ряду середина приходится на
    // самый край, и всплывающая надпись уезжала бы на счётчики над полем.
    const pad = 22;
    const clamp = (v, max) => Math.min(Math.max(v, pad), Math.max(max - pad, pad));
    return {
        x: clamp(first.left - play.left + first.width / 2 + (sx / n) * stepPx, play.width),
        y: clamp(first.top - play.top + first.height / 2 + (sy / n) * stepPx, play.height),
    };
}

// Счётчик очков доезжает до нового значения за время фазы. Считаем по кадрам, а
// не шагами по таймеру: на медленном шаге цифра иначе дёргается.
function countTo(state, target, ms) {
    cancelCount(state);
    const from = state.stats.score < 0 ? target : state.stats.score;
    if (from === target) { setStat(state, '#tro-score', target.toLocaleString('ru-RU')); return; }
    const t0 = performance.now();
    const box = state.modal.querySelector('#tro-score');
    const tick = (ts) => {
        if (openState !== state) return;
        const p = Math.min((ts - t0) / ms, 1);
        // Замедление к концу: так последняя цифра «доезжает», а не обрывается.
        const value = Math.round(from + (target - from) * (1 - (1 - p) * (1 - p)));
        state.stats.score = value;
        if (box) box.textContent = value.toLocaleString('ru-RU');
        if (p < 1) { state.countRaf = requestAnimationFrame(tick); return; }
        state.countRaf = 0;
        state.stats.score = target;
        setStat(state, '#tro-score', target.toLocaleString('ru-RU'));
    };
    state.countRaf = requestAnimationFrame(tick);
}

function cancelCount(state) {
    if (!state.countRaf) return;
    cancelAnimationFrame(state.countRaf);
    state.countRaf = 0;
}

function shake(state, i) {
    const node = state.cells[i];
    if (!node) return;
    node.classList.remove('is-nope');
    void node.offsetWidth;      // перезапуск анимации
    node.classList.add('is-nope');
    later(state, () => node.classList.remove('is-nope'), 300);
}

// ── Очки, время, надписи ─────────────────────────────────────────────────────

// Итоговая отрисовка счётчиков: если очки сейчас «доезжают» (countTo), она их
// обгоняет и ставит точное значение — иначе после конца партии в шапке осталось
// бы промежуточное число.
function renderStats(state) {
    const { game, stats } = state;
    cancelCount(state);
    if (stats.score !== game.score) {
        stats.score = game.score;
        setStat(state, '#tro-score', game.score.toLocaleString('ru-RU'));
    }
    if (stats.level !== game.level) {
        stats.level = game.level;
        setStat(state, '#tro-level', String(game.level));
    }
}

function setStat(state, sel, text) {
    const box = state.modal.querySelector(sel);
    if (!box || box.textContent === text) return;
    box.textContent = text;
    box.classList.remove('is-bump');
    void box.offsetWidth;
    box.classList.add('is-bump');
}

// Таймер: цифры меняем раз в секунду, полосу — когда сдвинулась хотя бы на
// процент. Писать в style на каждом кадре ради одного пикселя незачем.
//
// Полоса считается от ПОТОЛКА банка (MAX_MS), а не от стартовой минуты: на старте
// она заполнена на две трети, и это правильно — оставшаяся треть и есть то, что
// можно набрать часами. Полная полоса на старте врала бы, что больше не бывает.
function renderTime(state) {
    const ms = state.game.timeMs;
    const secs = Math.ceil(ms / 1000);
    const pct = Math.round((ms / MAX_MS) * 100);
    if (state.timeShown === secs * 1000 + pct) return;
    state.timeShown = secs * 1000 + pct;

    const box = state.modal.querySelector('#tro-secs');
    if (box) box.textContent = String(secs);
    const fill = state.modal.querySelector('#tro-time-fill');
    if (fill) fill.style.width = `${Math.max(pct, 0)}%`;
    state.modal.querySelector('.tro-time')?.classList.toggle('is-low', ms <= LOW_TIME_MS);
}

function note(state, html) {
    const box = state.modal.querySelector('#tro-note');
    if (!box) return;
    box.innerHTML = html;
    box.classList.toggle('is-show', !!html);
    if (html) later(state, () => note(state, ''), 2600);
}

function renderOverlay(state) {
    const { game } = state;
    const box = state.modal.querySelector('#tro-overlay');
    const show = game.over || state.paused;
    box.classList.toggle('hidden', !show);
    state.modal.querySelector('#tro-resume').classList.toggle('hidden', !state.paused || game.over);
    if (!show) return;
    state.modal.querySelector('#tro-over-title').textContent = game.over ? 'Время вышло' : 'Пауза';
    state.modal.querySelector('#tro-over-sub').textContent = game.over
        ? `${game.score.toLocaleString('ru-RU')} ${pointsWord(game.score)}, `
          + `уровень ${game.level}, лучшая цепочка ×${Math.max(game.bestCascade, 1)}, `
          + `часов: ${game.clocks}`
        : 'P или «Продолжить»';
}

// Склонения: «174 очка». Строка итога — последнее, что человек видит за партию,
// и «174 очков» в ней смотрится опечаткой.
function plural(n, one, few, many) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
}

function pointsWord(n) { return plural(n, 'очко', 'очка', 'очков'); }

// ── Мини-топ ─────────────────────────────────────────────────────────────────

async function loadTop(state) {
    try {
        const res = await state.ctx.apiFetch('/api/troika/top');
        if (openState !== state) return;
        state.top = res;
        renderTop(state);
    } catch {
        // Без топа игра играется — говорим об этом одной строкой и всё.
        if (openState !== state) return;
        state.topFailed = true;
        renderTop(state);
    }
}

function renderTop(state) {
    const box = state.modal.querySelector('#tro-top');
    if (!box) return;
    const data = state.top;
    if (!data) {
        box.innerHTML = state.topFailed
            ? '<div class="tro-top-head">Мини-топ</div><div class="tro-top-empty">Сервер не ответил — топ будет позже.</div>'
            : '<div class="tro-top-empty">Мини-топ загружается…</div>';
        return;
    }

    const rows = data.rows || [];
    const meId = state.ctx.user?.id;
    if (!rows.length) {
        box.innerHTML = '<div class="tro-top-head">Мини-топ</div>'
            + '<div class="tro-top-empty">Никто ещё не играл — первый результат будет вашим.</div>';
        return;
    }

    const list = rows.map(row => `
        <div class="tro-top-row${row.id === meId ? ' is-me' : ''}${row.rank === 1 ? ' is-first' : ''}">
            <span class="tro-top-rank">${row.rank}</span>
            <div class="tro-top-avatar">${row.avatar
                ? `<img src="${esc(row.avatar)}" alt=""/>`
                : '<span class="top-avatar-default"></span>'}</div>
            <div class="tro-top-name">${rolePrefixHtml(row.role_prefix)}${esc(row.display_name)}</div>
            <span class="tro-top-score">${Number(row.score).toLocaleString('ru-RU')}</span>
        </div>`).join('');

    // Своя строка отдельно — только если в показанную десятку не попал: иначе
    // это был бы дубль той же строки, подсвеченной выше.
    const me = data.me;
    const inList = rows.some(r => r.id === meId);
    const mine = me && !inList
        ? `<div class="tro-top-row is-me is-mine-extra">
               <span class="tro-top-rank">${me.rank}</span>
               <div class="tro-top-name">Ваш рекорд</div>
               <span class="tro-top-score">${Number(me.score).toLocaleString('ru-RU')}</span>
           </div>`
        : '';

    // Своя строка — ВНЕ прокручиваемого списка: её человек должен видеть сразу,
    // а не искать, домотав до конца.
    box.innerHTML = `<div class="tro-top-head">Мини-топ</div><div class="tro-top-list">${list}</div>${mine}`;
}

function rolePrefixHtml(rolePrefix) {
    if (!rolePrefix) return '';
    return `<span class="role-prefix role-prefix-${esc(rolePrefix.color)}" title="${esc(rolePrefix.tooltip || '')}">${esc(rolePrefix.label)}</span> `;
}

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
