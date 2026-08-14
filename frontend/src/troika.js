// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Тройка» (матч-3 на время) — окно игры и мини-топ.
//
// Открывается ТОЛЬКО из поиска на главной: набрать «тройка» и нажать Enter
// (см. main.js). Пока это слово набирают, поиск молчит.
//
// Правила игры целиком в shared/troika.js — здесь ни одной строчки про то, что
// считается тройкой, что даётся за четвёрку и сколько стоит каскад. Этот файл
// занимается тремя вещами: рисует поле, слушает клики с клавишами и один раз в
// конце партии относит результат на сервер (backend/src/routes/troika.js).
//
// Как показывается каскад. Правила убирают фишки, обваливают поле и досыпают
// новые ОДНИМ шагом (resolveStep), но показать это надо в два приёма: сначала
// подсветить то, что исчезает, и лишь потом перерисовать поле. Поэтому окно
// сначала вешает подсветку на клетки по индексам (в DOM ещё старая картинка),
// через CLEAR_MS перерисовывает поле и через FALL_MS берётся за следующий шаг.
// Без этой паузы каскад из пяти шагов выглядит одним мгновенным рывком — «что-то
// мигнуло, очков стало больше».
//
// Таймер во время каскада НЕ ОСТАНАВЛИВАЕТСЯ: время — главная валюта партии, и
// пауза на анимацию превращала бы длинные цепочки в бесплатные. Зато часы,
// собранные тем же каскадом, время и возвращают — так и задумано.
//
// Партия переживает закрытие окна: state кладётся в модульную переменную, и
// «тройка» + Enter возвращает к тому же полю — но НА ПАУЗЕ: таймер, который
// тикал бы в закрытом окне, просто съел бы партию, пока человек ищет машину.
// Перезагрузку страницы партия не переживает, и это осознанно: держать поле в
// localStorage ради пасхалки не стоит того.
// ─────────────────────────────────────────────────────────────────────────────

import {
    createGame, applySwap, resolveStep, hasMove, shuffle, tickTime,
    areNeighbours, idx, xOf, yOf,
    SIZE, CELLS, KINDS, SPECIAL_CLASS,
    NONE, ROCKET_H, ROCKET_V, BOMB, PRISM, CLOCK,
    MAX_MS, LOW_TIME_MS, CLOCK_MS, MAX_CASCADE_MULT,
} from '../../shared/troika.js';
import {
    ringIcon, squareIcon, triangleIcon, hexIcon, starIcon, dropIcon,
    rocketHIcon, rocketVIcon, prismIcon, clockIcon, shuffleIcon, mineIcon,
    arrowLeftIcon, arrowRightIcon, arrowUpIcon, arrowDownIcon,
} from './icons.js';

const MODAL_ID = 'troika-modal';

// Сколько показывается уборка и сколько — падение. Меньше — каскад сливается в
// рывок, больше — партия на время начинает раздражать ожиданием.
const CLEAR_MS = 150;
const FALL_MS = 90;

// Свайп: с какого смещения жест считается «потянул фишку», а не «ткнул». Меньше
// десятка пикселей — и обычный тап пальцем становится случайным ходом.
const SWIPE_PX = 12;

// Значок вида фишки. Порядок — как в KINDS: индекс вида и есть индекс иконки.
const KIND_ICON = [ringIcon, squareIcon, triangleIcon, hexIcon, starIcon, dropIcon];

// Значок специальной фишки. Бомба — та же мина, что в сапёре: рисовать вторую
// бомбу «почти как та» значило бы разъехаться с ней на первой же правке.
const SPECIAL_ICON = {
    [ROCKET_H]: rocketHIcon,
    [ROCKET_V]: rocketVIcon,
    [BOMB]: mineIcon,
    [PRISM]: prismIcon,
    [CLOCK]: clockIcon,
};

// Клетка кодируется одним числом (вид × 8 + специальная), и вся её разметка
// посчитана заранее: 36 вариантов на всю игру. Собирать SVG строкой на каждую
// клетку каждого шага — самая дорогая глупость, которую тут можно сделать: за
// партию это десятки тысяч склеек.
const CODE_OF = (color, special) => color * 8 + special;
const TILE = (() => {
    const table = [];
    for (let color = 0; color < KINDS.length; color++) {
        for (let special = NONE; special <= CLOCK; special++) {
            const cls = `tro-cell k-${KINDS[color]}`
                + (special ? ` is-special is-${SPECIAL_CLASS[special]}` : '');
            // У специальной фишки крупно рисуется ОНА, а вид уходит в уголок:
            // знать надо и что это за фигура, и по какому виду она соберётся.
            const html = special
                ? `<span class="tro-glyph">${SPECIAL_ICON[special](22)}</span>`
                  + `<span class="tro-badge">${KIND_ICON[color](12)}</span>`
                : `<span class="tro-glyph">${KIND_ICON[color](22)}</span>`;
            table[CODE_OF(color, special)] = { cls, html };
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
                    <div class="tro-gain" id="tro-gain"></div>
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
function legendHtml() {
    const item = (icon, text) => `<span class="tro-legend-item">${icon}<span>${text}</span></span>`;
    return item(rocketHIcon(16), 'четвёрка — ракета, сносит линию')
        + item(mineIcon(16), 'угол — бомба, сносит 5×5')
        + item(prismIcon(16), 'пятёрка — призма, сносит все свои')
        + item(clockIcon(16), `часы — плюс ${CLOCK_MS / 1000} с к таймеру`);
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

    const ended = tickTime(state.game, dt);
    renderTime(state);
    if (ended) {
        state.raf = 0;
        // Каскад, начатый до нуля на таймере, доигрывается — и только потом
        // итог: обрывать цепочку на середине значило бы отобрать уже
        // заработанные очки.
        if (!state.busy) finish(state);
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
    renderBoard(state);
    runCascade(state);
}

// Каскад: шаг правил — подсветка — перерисовка — следующий шаг. Пока цепочка
// идёт, ходы не принимаются (state.busy): поле в этот момент уже другое, и
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
        markCleared(state, step);
        showGain(state, step);
        later(state, () => {
            renderBoard(state, step);
            renderStats(state);
            later(state, stepOnce, FALL_MS);
        }, CLEAR_MS);
    };
    stepOnce();
}

function afterSettle(state) {
    // Ходов не осталось — перемешиваем. Партия идёт на время, и «ходов нет, вы
    // проиграли» было бы наказанием за случайность, а не за игру.
    if (!state.game.over && !hasMove(state.game)) {
        shuffle(state.game);
        renderBoard(state);
        note(state, `${shuffleIcon(14)} Ходов не осталось — поле перемешано`);
    }
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
    clearTimers(state);
    state.game = createGame();
    saved = null;
    state.busy = false;
    state.paused = false;
    state.finished = false;
    state.sel = -1;
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
 * Перерисовать поле. step (если передан) — только что показанный шаг каскада:
 * тогда сдвинувшиеся фишки помечаются как упавшие, а выданные за фигуру
 * специальные — как появившиеся.
 *
 * Трогаем только изменившиеся клетки: шаг меняет десяток из шестидесяти
 * четырёх, а className и innerHTML — самые дорогие операции в этом окне.
 */
function renderBoard(state, step = null) {
    const born = step ? new Set(step.created.map(c => c.cell)) : null;
    const { game, cells, drawn } = state;
    for (let i = 0; i < CELLS; i++) {
        const color = game.color[i];
        if (color < 0) continue;                 // пустых клеток снаружи не бывает
        const code = CODE_OF(color, game.special[i]);
        // Клетка могла не измениться по виду, но всё равно получить подсветку
        // уборки — её надо снять, поэтому здесь не continue, а paintMarks.
        if (drawn[i] === code && !(step && born.has(i))) { paintMarks(state, i); continue; }
        drawn[i] = code;
        const tile = TILE[code];
        let extra = '';
        if (step) extra = born.has(i) ? ' is-born' : ' is-fall';
        cells[i].innerHTML = tile.html;
        cells[i].className = tile.cls + extra + marks(state, i);
    }
}

// Выбор и курсор живут поверх обычного класса клетки: их две штуки на поле, и
// перерисовывать из-за них всё поле незачем.
function marks(state, i) {
    return (state.sel === i ? ' is-sel' : '')
        + (state.keyboard && state.cursor === i ? ' is-cursor' : '');
}

function paintMarks(state, i) {
    const node = state.cells[i];
    const want = TILE[state.drawn[i]].cls + marks(state, i);
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

// Подсветка исчезающих фишек: вешается на клетки ДО перерисовки, пока в DOM ещё
// старая картинка (см. шапку файла). Отдельно помечаются те, что сработали, —
// у ракеты и бомбы должно быть видно, что рвануло именно тут.
function markCleared(state, step) {
    const fired = new Set(step.fired.map(f => f.cell));
    for (const i of step.cells) {
        const node = state.cells[i];
        if (!node) continue;
        node.classList.add(fired.has(i) ? 'is-boom' : 'is-clear');
    }
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

function renderStats(state) {
    const { game, stats } = state;
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

// Сколько дал шаг: множитель каскада показывается ровно тогда, когда он есть, —
// именно он и есть та причина думать над ходом.
function showGain(state, step) {
    const box = state.modal.querySelector('#tro-gain');
    if (box && step.gained > 0) {
        const mult = step.mult > 1
            ? `<span class="tro-gain-mult">×${step.mult}${step.mult === MAX_CASCADE_MULT ? '!' : ''}</span>`
            : '';
        box.innerHTML = `${mult}+${step.gained.toLocaleString('ru-RU')}`;
        box.classList.remove('is-show');
        void box.offsetWidth;
        box.classList.add('is-show');
    }
    if (step.timeGained > 0) {
        const gain = state.modal.querySelector('#tro-time-gain');
        if (!gain) return;
        gain.textContent = `+${Math.round(step.timeGained / 1000)} с`;
        gain.classList.remove('is-show');
        void gain.offsetWidth;
        gain.classList.add('is-show');
    }
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
