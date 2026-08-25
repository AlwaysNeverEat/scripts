// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Тетрис» — окно игры и мини-топ.
//
// Открывается ТОЛЬКО из меню игр (games.js), а оно — из поиска на главной:
// набрать «игры» и нажать Enter. Пока это слово набирают, поиск молчит.
//
// Правила игры целиком в shared/tetris.js — здесь ни одной строчки про формы
// фигур, вращение и очки. Этот файл занимается тремя вещами: рисует поле,
// слушает клавиши и один раз в конце партии относит результат на сервер.
//
// ПОЧЕМУ ПАРТИЯ СЧИТАЕТСЯ В БРАУЗЕРЕ, а не на сервере, как в сапёре: сапёр —
// десяток запросов за партию, тетрис — до тридцати действий в секунду, и
// каждое надо показать в том же кадре. Сеть сюда не помещается. Сервер отвечает
// только за мини-топ (backend/src/routes/tetris.js).
//
// Что сделано ради плавности — по убыванию важности:
//   • кадр рисуется ТОЛЬКО когда на поле что-то изменилось: tick() возвращает
//     флаг, и на стоящей фигуре мы не трогаем DOM вовсе;
//   • перерисовываются только изменившиеся клетки (сравнение с state.drawn) —
//     ход меняет 8–12 клеток из 200, а не все 200;
//   • класс клетки берётся из готовой таблицы CLASS_OF, а не собирается
//     строкой на каждую клетку каждого кадра;
//   • кадры вообще не запрашиваются, пока партия на паузе, кончилась или окно
//     свёрнуто, — фоновая вкладка не жжёт батарею;
//   • автоповтор (зажатая стрелка) живёт в том же кадре, а не отдельными
//     таймерами: два setInterval на клавишу дают дёрганое движение, потому что
//     их тики не совпадают с кадрами.
//
// Партия переживает закрытие окна: state кладётся в модульную переменную, и
// «Тетрис» из меню возвращает к тому же стакану. Перезагрузку страницы — нет,
// и это осознанно: хранить стакан в localStorage ради пасхалки не стоит того,
// а на сервере ему тем более не место (см. выше).
// ─────────────────────────────────────────────────────────────────────────────

import {
    createGame, tick, move, rotate, softStep, hardDrop, dropDistance, pieceCells,
    COLS, ROWS, HIDDEN_ROWS, TOTAL_ROWS, PIECE_TYPES,
} from '../../shared/tetris.js';
import {
    arrowLeftIcon, arrowRightIcon, arrowUpIcon, arrowDownIcon, rotateIcon, hardDropIcon,
} from './icons.js';
import { namePrefixHtml } from './namePrefix.js';
import { profileRowAttrs, bindProfileRows } from './topProfile.js';

const MODAL_ID = 'tetris-modal';
const VISIBLE_CELLS = COLS * ROWS;

// Автоповтор зажатой стрелки: задержка перед разгоном и шаг разгона. Числа
// стандартные для тетриса — с ними фигура доезжает до стенки за четверть
// секунды, но одиночное нажатие двигает ровно на клетку.
const DAS_MS = 150;
const ARR_MS = 40;

// Потолок на длину кадра. Вкладку свернули, поставили ноутбук на паузу — между
// кадрами может пройти минута, и без потолка фигура «телепортируется» на дно.
const MAX_FRAME_MS = 100;

// Классы клеток заранее: 0 — пусто, 1..7 — лежит, +10 — тень, +20 — живая
// фигура. Собирать эти строки на каждую клетку каждого кадра — самая дорогая
// глупость, которую тут можно сделать.
const GHOST = 10;
const LIVE = 20;
const CLASS_OF = (() => {
    const table = new Array(30).fill('tet-cell');
    PIECE_TYPES.forEach((type, i) => {
        table[i + 1] = `tet-cell is-lock p-${type}`;
        table[i + 1 + GHOST] = `tet-cell is-ghost p-${type}`;
        table[i + 1 + LIVE] = `tet-cell is-live p-${type}`;
    });
    return table;
})();

let openState = null;   // одно окно за раз
let saved = null;       // недоигранная партия: окно закрыли, но не сдались

/** Открыть игру. ctx: { apiFetch, user }. */
export function openTetris(ctx) {
    if (openState) return openState.modal;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'modal';
    modal.innerHTML = shellHtml();
    document.body.appendChild(modal);
    document.body.classList.add('modal-open');

    const state = {
        ctx,
        modal,
        game: saved || createGame(),
        cells: [],                          // узлы клеток по индексу
        drawn: new Uint8Array(VISIBLE_CELLS).fill(255),  // 255 — «ещё не рисовали»
        frame: new Uint8Array(VISIBLE_CELLS),            // буфер кадра, один на всё окно
        nextDrawn: '',                      // что нарисовано в «дальше»
        stats: { score: -1, lines: -1, level: -1 },
        raf: 0,
        last: 0,
        paused: false,
        repeat: { dir: 0, wait: 0 },        // автоповтор стрелок
        lastPieces: -1,                     // чтобы поймать момент уборки линий
        flashTimer: 0,
        top: null,                          // последний ответ /api/tetris/top
        topFailed: false,
        sending: false,
    };
    openState = state;
    // Вернулись к отложенной партии — «ускорение» могло остаться зажатым с
    // прошлого раза (клавишу отпускали уже при закрытом окне).
    state.game.soft = false;

    const close = () => {
        stopLoop(state);
        clearTimeout(state.flashTimer);
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('keyup', onKeyUp, true);
        document.removeEventListener('visibilitychange', onHide);
        // Недоигранную партию запоминаем: закрыть окно — не то же самое, что
        // проиграть. Доигранную забываем, иначе «Заново» открывало бы труп.
        saved = state.game.over ? null : state.game;
        modal.remove();
        document.body.classList.remove('modal-open');
        openState = null;
    };
    // Строка мини-топа ведёт в профиль, а профиль — обычная страница под
    // окном: чтобы её было видно, окно надо закрыть (см. topProfile.js).
    state.close = close;

    const onKeyDown = (e) => handleKeyDown(state, e, close);
    const onKeyUp = (e) => handleKeyUp(state, e);
    // Свернули вкладку — ставим на паузу. Без этого человек возвращается к
    // проигранной партии: фигура падала, пока он смотрел в другое место.
    const onHide = () => { if (document.hidden) setPaused(state, true); };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('visibilitychange', onHide);

    modal.querySelector('.modal-backdrop').onclick = close;
    modal.querySelector('#tet-close').onclick = close;
    modal.querySelector('#tet-restart').onclick = () => restart(state);
    modal.querySelector('#tet-resume').onclick = () => setPaused(state, false);
    bindPad(state);

    buildBoard(state);
    renderAll(state);
    startLoop(state);
    loadTop(state);
    return modal;
}

function shellHtml() {
    return `
        <div class="modal-backdrop"></div>
        <div class="modal-win tet-win">
            <div class="modal-head">
                <span>Тетрис</span>
                <button class="btn btn-sec" id="tet-close" title="Закрыть">✕</button>
            </div>
            <div class="tet-body">
                <div class="tet-play">
                    <div class="tet-board" id="tet-board"></div>
                    <div class="tet-side">
                        <div class="tet-stat"><span>Очки</span><b id="tet-score">0</b></div>
                        <div class="tet-stat"><span>Линии</span><b id="tet-lines">0</b></div>
                        <div class="tet-stat"><span>Уровень</span><b id="tet-level">1</b></div>
                        <div class="tet-mini">
                            <span class="tet-mini-label">Дальше</span>
                            <div class="tet-mini-grid" id="tet-next"></div>
                        </div>
                    </div>
                    <div class="tet-overlay hidden" id="tet-overlay">
                        <div class="tet-overlay-card">
                            <div class="tet-over-title" id="tet-over-title"></div>
                            <div class="tet-over-sub" id="tet-over-sub"></div>
                            <div class="tet-over-actions">
                                <button type="button" class="btn btn-pri" id="tet-restart">Заново</button>
                                <button type="button" class="btn btn-sec hidden" id="tet-resume">Продолжить</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="tet-pad" id="tet-pad">
                    <button type="button" class="btn btn-sec" data-act="left" aria-label="Влево">${arrowLeftIcon(20)}</button>
                    <button type="button" class="btn btn-sec" data-act="rotate" aria-label="Повернуть">${rotateIcon(20)}</button>
                    <button type="button" class="btn btn-sec" data-act="right" aria-label="Вправо">${arrowRightIcon(20)}</button>
                    <button type="button" class="btn btn-sec" data-act="soft" aria-label="Ускорить">${arrowDownIcon(20)}</button>
                    <button type="button" class="btn btn-sec" data-act="drop" aria-label="Сбросить">${hardDropIcon(20)}</button>
                </div>

                <div class="tet-top" id="tet-top"></div>
                <div class="tet-hint">${hintHtml()}</div>
            </div>
        </div>`;
}

// Легенда управления: в рамке — САМА КЛАВИША, рядом — что она делает. Поэтому
// у поворота нарисована стрелка вверх, а не «крутилка»: на клавиатуре нажимают
// именно её, и значок действия в рамке заставлял бы гадать, чем его нажать.
// «Пробел» и «P» остаются словами — это то, что написано на клавишах.
function hintHtml() {
    const key = inner => `<kbd class="tet-key">${inner}</kbd>`;
    const item = (keys, label) => `<span class="tet-legend-item">${keys}<span>${label}</span></span>`;
    return item(key(arrowLeftIcon(14)) + key(arrowRightIcon(14)), 'двигать')
        + item(key(arrowUpIcon(14)), 'повернуть')
        + item(key(arrowDownIcon(14)), 'ускорить')
        + item(key('пробел'), 'сбросить')
        + item(key('P'), 'пауза');
}

// ── Кадры ────────────────────────────────────────────────────────────────────

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

function frame(state, ts) {
    if (openState !== state) return;
    state.raf = requestAnimationFrame(t => frame(state, t));

    const dt = Math.min(ts - state.last, MAX_FRAME_MS);
    state.last = ts;

    let changed = autoRepeat(state, dt);
    if (tick(state.game, dt)) changed = true;

    if (state.game.over) { finish(state); return; }
    if (changed) renderAll(state);
}

// Зажатая стрелка: сначала пауза (DAS), потом шаг за шагом (ARR). Живёт в
// кадре, а не в setInterval, — так движение идёт ровно, кадр в кадр.
function autoRepeat(state, dt) {
    const r = state.repeat;
    if (!r.dir) return false;
    r.wait -= dt;
    let changed = false;
    while (r.wait <= 0) {
        if (!move(state.game, r.dir)) { r.wait = ARR_MS; break; }   // упёрлись в стенку
        changed = true;
        r.wait += ARR_MS;
    }
    return changed;
}

// ── Клавиши ──────────────────────────────────────────────────────────────────

// Смотрим на e.code, а не на e.key: код клавиши не зависит от раскладки, и «C»
// откладывает фигуру и в русской, и в английской.
function handleKeyDown(state, e, close) {
    if (e.code === 'Escape') { e.preventDefault(); close(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

    if (e.code === 'KeyP') { e.preventDefault(); setPaused(state, !state.paused); return; }
    if (state.paused || state.game.over) {
        // На паузе и после проигрыша играют только «Заново»/«Продолжить», но
        // прокрутку страницы стрелками гасим всё равно: окно-то открыто.
        if (isGameKey(e.code)) e.preventDefault();
        if (e.code === 'Enter' || e.code === 'Space') {
            e.preventDefault();
            if (state.game.over) restart(state); else setPaused(state, false);
        }
        return;
    }
    if (!isGameKey(e.code)) return;
    e.preventDefault();
    // Системный автоповтор игнорируем: у нас свой, с нормальными DAS/ARR.
    if (e.repeat) return;

    let changed = false;
    switch (e.code) {
        case 'ArrowLeft':  changed = move(state.game, -1); state.repeat = { dir: -1, wait: DAS_MS }; break;
        case 'ArrowRight': changed = move(state.game, 1);  state.repeat = { dir: 1, wait: DAS_MS }; break;
        case 'ArrowDown':  changed = softStep(state.game); state.game.soft = true; break;
        case 'ArrowUp':
        case 'KeyX':       changed = rotate(state.game, 1); break;
        case 'KeyZ':       changed = rotate(state.game, -1); break;
        case 'Space':      changed = hardDrop(state.game); break;
    }
    if (state.game.over) { finish(state); return; }
    if (changed) renderAll(state);
}

function handleKeyUp(state, e) {
    if (e.code === 'ArrowLeft' && state.repeat.dir === -1) state.repeat.dir = 0;
    if (e.code === 'ArrowRight' && state.repeat.dir === 1) state.repeat.dir = 0;
    if (e.code === 'ArrowDown') state.game.soft = false;
}

function isGameKey(code) {
    return code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowDown'
        || code === 'ArrowUp' || code === 'Space' || code === 'KeyX' || code === 'KeyZ';
}

// Кнопки для телефона: те же действия, но с автоповтором на стрелках и
// ускорении. pointer-события, а не touch: тем же кодом работает и мышь.
function bindPad(state) {
    const pad = state.modal.querySelector('#tet-pad');
    const act = (name, down) => {
        if (state.paused || state.game.over) return;
        let changed = false;
        if (name === 'left' || name === 'right') {
            const dir = name === 'left' ? -1 : 1;
            if (down) { changed = move(state.game, dir); state.repeat = { dir, wait: DAS_MS }; }
            else if (state.repeat.dir === dir) state.repeat.dir = 0;
        } else if (name === 'soft') {
            state.game.soft = down;
            if (down) changed = softStep(state.game);
        } else if (down) {
            if (name === 'rotate') changed = rotate(state.game, 1);
            if (name === 'drop') changed = hardDrop(state.game);
        }
        if (state.game.over) { finish(state); return; }
        if (changed) renderAll(state);
    };

    pad.addEventListener('pointerdown', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        e.preventDefault();          // без этого палец «выделяет» кнопку и скроллит окно
        btn.setPointerCapture?.(e.pointerId);
        act(btn.dataset.act, true);
    });
    const up = (e) => {
        const btn = e.target.closest('[data-act]');
        if (btn) act(btn.dataset.act, false);
    };
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
}

// ── Пауза, конец партии, новая партия ────────────────────────────────────────

function setPaused(state, on) {
    if (state.game.over || state.paused === on) return;
    state.paused = on;
    state.repeat.dir = 0;
    state.game.soft = false;
    if (on) stopLoop(state); else startLoop(state);
    renderOverlay(state);
}

function restart(state) {
    stopLoop(state);
    state.game = createGame();
    saved = null;
    state.paused = false;
    state.repeat = { dir: 0, wait: 0 };
    state.lastPieces = -1;
    state.drawn.fill(255);
    state.nextDrawn = '';
    state.stats = { score: -1, lines: -1, level: -1 };
    renderAll(state);
    renderOverlay(state);
    startLoop(state);
}

// Партия кончилась: показать итог и отнести результат в мини-топ. Ровно один
// запрос за партию — весь сетевой трафик пасхалки.
function finish(state) {
    stopLoop(state);
    state.repeat.dir = 0;
    renderAll(state);
    renderOverlay(state);
    sendScore(state);
}

async function sendScore(state) {
    if (state.sending) return;
    const { score, lines, pieces, elapsedMs } = state.game;
    // Партию, в которой ничего не набрали, в топ не несём: она никому не
    // интересна, а строку в базе завела бы.
    if (score <= 0) return;
    state.sending = true;
    try {
        const res = await state.ctx.apiFetch('/api/tetris/score', {
            method: 'POST',
            body: { score, lines, pieces, seconds: Math.round(elapsedMs / 1000) },
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
    const sub = state.modal.querySelector('#tet-over-sub');
    if (sub) sub.innerHTML += ' <b class="tet-record">Личный рекорд!</b>';
}

// ── Отрисовка поля ───────────────────────────────────────────────────────────

function buildBoard(state) {
    const board = state.modal.querySelector('#tet-board');
    board.innerHTML = Array.from({ length: VISIBLE_CELLS }, () => '<i class="tet-cell"></i>').join('');
    state.cells = [...board.children];

    // Клетки превью строим один раз: дальше им меняется только класс.
    state.modal.querySelector('#tet-next').innerHTML = miniCellsHtml();
}

function miniCellsHtml() {
    return '<i class="tet-cell"></i>'.repeat(16);
}

function renderAll(state) {
    renderBoard(state);
    renderStats(state);
    renderPreviews(state);
    checkClearFlash(state);
}

function renderBoard(state) {
    const { game, frame: buf } = state;

    // Кадр собирается в плоский буфер: сначала лежащие клетки, потом тень, потом
    // живая фигура. Буфер один на всё окно — новый Uint8Array на кадр давал бы
    // 60 выделений в секунду на ровном месте.
    buf.set(game.board.subarray(HIDDEN_ROWS * COLS, TOTAL_ROWS * COLS));

    const piece = game.piece;
    if (piece && !game.over) {
        const code = PIECE_TYPES.indexOf(piece.type) + 1;
        const cells = pieceCells(piece);
        // Тень — куда фигура упадёт, если отпустить. Без неё в высоком стакане
        // не попасть в нужный столбец, сколько ни смотри.
        const d = dropDistance(game);
        if (d > 0) {
            for (let i = 0; i < 4; i++) {
                const y = cells[i * 2 + 1] + d - HIDDEN_ROWS;
                if (y < 0) continue;
                buf[y * COLS + cells[i * 2]] = code + GHOST;
            }
        }
        for (let i = 0; i < 4; i++) {
            const y = cells[i * 2 + 1] - HIDDEN_ROWS;
            if (y < 0) continue;                 // часть фигуры ещё над стаканом
            buf[y * COLS + cells[i * 2]] = code + LIVE;
        }
    }

    // Трогаем только те клетки, что изменились: ход меняет десяток из двухсот.
    const { drawn, cells: nodes } = state;
    for (let i = 0; i < VISIBLE_CELLS; i++) {
        const v = buf[i];
        if (drawn[i] === v) continue;
        drawn[i] = v;
        nodes[i].className = CLASS_OF[v];
    }
}

function renderStats(state) {
    const { game, stats } = state;
    if (stats.score !== game.score) {
        stats.score = game.score;
        setStat(state, '#tet-score', game.score.toLocaleString('ru-RU'));
    }
    if (stats.lines !== game.lines) {
        stats.lines = game.lines;
        setStat(state, '#tet-lines', String(game.lines));
    }
    if (stats.level !== game.level) {
        stats.level = game.level;
        setStat(state, '#tet-level', String(game.level));
    }
}

function setStat(state, sel, text) {
    const box = state.modal.querySelector(sel);
    if (!box || box.textContent === text) return;
    box.textContent = text;
    box.classList.remove('is-bump');
    void box.offsetWidth;      // перезапуск анимации
    box.classList.add('is-bump');
}

function renderPreviews(state) {
    const type = state.game.next[0] || '';
    if (state.nextDrawn === type) return;
    state.nextDrawn = type;
    drawMini(state.modal.querySelector('#tet-next'), type);
}

// Превью 4×4: фигура первым поворотом, по центру рамки.
function drawMini(grid, type) {
    const nodes = grid.children;
    for (let i = 0; i < 16; i++) nodes[i].className = 'tet-cell';
    if (!type) return;
    const cells = pieceCells({ type, rot: 0, x: 0, y: 0 });
    // Палку и квадрат подвигаем к центру: в рамке 4×4 они иначе висят с краю.
    const dx = type === 'I' ? 0 : type === 'O' ? 1 : 0;
    const cls = `tet-cell is-lock p-${type}`;
    for (let i = 0; i < 4; i++) {
        const x = cells[i * 2] + dx;
        const y = cells[i * 2 + 1] + 1;
        if (x < 0 || x > 3 || y < 0 || y > 3) continue;
        nodes[y * 4 + x].className = cls;
    }
}

// Вспышка на уборке линий: ловим момент, когда фигура легла и линии убрались.
// Сама уборка мгновенная (её делает shared/tetris.js) — анимировать «падение»
// верхних строк значило бы задерживать игру ради красоты.
function checkClearFlash(state) {
    const { game } = state;
    if (state.lastPieces === game.pieces) return;
    state.lastPieces = game.pieces;
    const n = game.clearedRows.length;
    if (!n) return;
    const board = state.modal.querySelector('#tet-board');
    board.classList.remove('is-clear');
    void board.offsetWidth;
    board.dataset.clear = String(n);
    board.classList.add('is-clear');
    clearTimeout(state.flashTimer);
    state.flashTimer = setTimeout(() => {
        if (openState === state) board.classList.remove('is-clear');
    }, 320);
}

function renderOverlay(state) {
    const { game } = state;
    const box = state.modal.querySelector('#tet-overlay');
    const show = game.over || state.paused;
    box.classList.toggle('hidden', !show);
    state.modal.querySelector('#tet-resume').classList.toggle('hidden', !state.paused || game.over);
    if (!show) return;
    state.modal.querySelector('#tet-over-title').textContent = game.over ? 'Стакан переполнен' : 'Пауза';
    state.modal.querySelector('#tet-over-sub').textContent = game.over
        ? `${game.score.toLocaleString('ru-RU')} ${pointsWord(game.score)}, ${game.lines} ${linesWord(game.lines)}, уровень ${game.level}`
        : 'P или «Продолжить»';
}

// Склонения: «174 очка» и «21 линия». Строка итога — последнее, что человек
// видит за партию, и «174 очков» в ней смотрится опечаткой.
function plural(n, one, few, many) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
}

function linesWord(n) { return plural(n, 'линия', 'линии', 'линий'); }
function pointsWord(n) { return plural(n, 'очко', 'очка', 'очков'); }

// ── Мини-топ ─────────────────────────────────────────────────────────────────

async function loadTop(state) {
    try {
        const res = await state.ctx.apiFetch('/api/tetris/top');
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
    const box = state.modal.querySelector('#tet-top');
    if (!box) return;
    const data = state.top;
    if (!data) {
        box.innerHTML = state.topFailed
            ? '<div class="tet-top-head">Мини-топ</div><div class="tet-top-empty">Сервер не ответил — топ будет позже.</div>'
            : '<div class="tet-top-empty">Мини-топ загружается…</div>';
        return;
    }

    const rows = data.rows || [];
    const meId = state.ctx.user?.id;
    if (!rows.length) {
        box.innerHTML = '<div class="tet-top-head">Мини-топ</div>'
            + '<div class="tet-top-empty">Никто ещё не играл — первый результат будет вашим.</div>';
        return;
    }

    const list = rows.map(row => `
        <div class="tet-top-row${row.id === meId ? ' is-me' : ''}${row.rank === 1 ? ' is-first' : ''}"${profileRowAttrs(row)}>
            <span class="tet-top-rank">${row.rank}</span>
            <div class="tet-top-avatar">${row.avatar
                ? `<img src="${esc(row.avatar)}" alt=""/>`
                : '<span class="top-avatar-default"></span>'}</div>
            <div class="tet-top-name">${namePrefixHtml(row)}${esc(row.display_name)}</div>
            <span class="tet-top-score">${Number(row.score).toLocaleString('ru-RU')}</span>
        </div>`).join('');

    // Своя строка отдельно — только если в показанную десятку не попал: иначе
    // это был бы дубль той же строки, подсвеченной выше.
    const me = data.me;
    const inList = rows.some(r => r.id === meId);
    const mine = me && !inList
        ? `<div class="tet-top-row is-me is-mine-extra">
               <span class="tet-top-rank">${me.rank}</span>
               <div class="tet-top-name">Ваш рекорд</div>
               <span class="tet-top-score">${Number(me.score).toLocaleString('ru-RU')}</span>
           </div>`
        : '';

    // Своя строка — ВНЕ прокручиваемого списка: её человек должен видеть сразу,
    // а не искать, домотав до конца.
    box.innerHTML = `<div class="tet-top-head">Мини-топ</div><div class="tet-top-list">${list}</div>${mine}`;
    bindProfileRows(box, state.close);
}

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
