// Идущие партии сапёра — в памяти процесса, по одной на аккаунт.
//
// Почему не в базе: партия живёт минуты, пишется на каждый клик и никому,
// кроме самого игрока, не нужна, а результат нигде не хранится вовсе.
//
// Что это значит на практике: перезапуск бэкенда обрывает начатые партии. Это
// нормально — сапёр начинается заново одним кликом. Зато партия переживает F5
// и уход на другую вкладку, чего не дало бы хранение в браузере.

import { createField, openCell, chord, openedCells, minePositions } from './field.js';

// Партия без единого хода полчаса — это закрытая вкладка, а не игра.
const IDLE_MS = 30 * 60_000;
const SWEEP_EVERY = 200;

const games = new Map(); // userId → { field, startedAt, finishedAt, touchedAt }
let sinceSweep = 0;

function sweep() {
    if (++sinceSweep < SWEEP_EVERY) return;
    sinceSweep = 0;
    const deadline = Date.now() - IDLE_MS;
    for (const [userId, game] of games) {
        if (game.touchedAt < deadline) games.delete(userId);
    }
}

export function newGame(userId) {
    sweep();
    const game = { field: createField(), startedAt: null, finishedAt: null, touchedAt: Date.now() };
    games.set(userId, game);
    return game;
}

export function getGame(userId) {
    const game = games.get(userId);
    if (game) game.touchedAt = Date.now();
    return game || null;
}

/** Партия, которую можно показать: своя или новая, если её нет. */
export function currentGame(userId) {
    return getGame(userId) || newGame(userId);
}

// Время идёт с ПЕРВОГО хода, а не с открытия окна: иначе в зачёт попадёт время,
// пока человек отвлёкся на клиента.
function stamp(game) {
    if (!game.startedAt) game.startedAt = Date.now();
    if ((game.field.state === 'won' || game.field.state === 'lost') && !game.finishedAt) {
        game.finishedAt = Date.now();
    }
}

export function elapsedSeconds(game) {
    if (!game.startedAt) return 0;
    return Math.round(((game.finishedAt || Date.now()) - game.startedAt) / 1000);
}

export function play(userId, { index, flags, mode }) {
    const game = currentGame(userId);
    const before = game.field.state;
    const step = mode === 'chord'
        ? chord(game.field, index, flags)
        : openCell(game.field, index);
    if (before !== 'new' || step.revealed.length || step.hit) stamp(game);
    return { game, step };
}

/** Состояние для клиента. Мины отдаём только когда игра кончилась. */
export function present(game) {
    const { field } = game;
    const over = field.state === 'won' || field.state === 'lost';
    return {
        rows: field.rows,
        cols: field.cols,
        mines: field.mines,
        state: field.state,
        opened: openedCells(field),
        seconds: elapsedSeconds(game),
        ...(over ? { minePositions: minePositions(field) } : {}),
    };
}

// Только для тестов: между ними состояние не должно протекать.
export function _reset() {
    games.clear();
}
