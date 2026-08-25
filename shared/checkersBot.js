// ─────────────────────────────────────────────────────────────────────────────
// Бот для шашек.
//
// СЛОЖНОСТЬ ЗДЕСЬ — ЭТО ГЛУБИНА СЧЁТА, как в дураке и морском бое, а не дрожь
// руки, как в бильярде. Бильярду можно испортить исполнение (сдвинуть угол на
// полградуса) — и слабый бот честно мажет тем же лучшим ударом. В шашках
// исполнять нечего: ход это две клетки, и «слабо исполненный» ход — это просто
// другой ход. Поэтому слабый бот ДУМАЕТ КОРОЧЕ.
//
// Считает он тем же движком, что и человек (shared/checkers.js): берёт копию
// позиции, ходит, смотрит, что получилось. Знать больше игрока он поэтому не
// может физически — прятать в шашках нечего, доска и так на виду у обоих.
//
// ЧЕМ НОВИЧОК ОТЛИЧАЕТСЯ ОТ ОСТАЛЬНЫХ. Не только глубиной: он ЕДИНСТВЕННЫЙ, кто
// останавливается посреди размена. Любитель и Мастер, упершись в потолок счёта,
// досчитывают начатый бой до конца (это и есть quiesce ниже) — то есть видят,
// что после их взятия последует ответное. Новичок обрывает счёт на своём
// взятии и радуется съеденной шашке, не заметив, что её тут же съедят обратно.
// Это и есть главная беда живого новичка, и вычитается она из той же глубины, а
// не из отдельного «а тут мы нарочно ошибёмся».
//
// Ход бота — ОДИН ПРЫЖОК, а не вся цепочка: правила устроены так же (см. шапку
// checkers.js), и окно проигрывает цепочку по шагам с паузой — ровно как серию
// попаданий в морском бое. Спрашивать бота повторно, пока ход остаётся у него,
// — это и есть его цепочка.
//
// Партии с ботом живут ТОЛЬКО в браузере: сервер о них не знает, и в таблицу
// очков они не идут. Иначе первое место занял бы не тот, кто обыгрывает людей, а
// тот, кто набил побед по Новичку.
// ─────────────────────────────────────────────────────────────────────────────

import {
    CELLS, EMPTY, WHITE, SIZE, xOf, yOf, colorOf, isKing,
    legalMoves, applyMove, cloneGame, mustCapture,
} from './checkers.js';

// Уровни. Глубина считается в ХОДАХ (полуходах), цепочка боя за глубину не
// считается вовсе — она один ход, каким бы длинным ни был.
export const LEVELS = [
    {
        id: 'rookie',
        name: 'Новичок',
        // Второе имя — в творительном падеже: «продолжить с Новичком». Без него
        // подпись выходит «продолжить с Новичок», и это видно всем.
        whom: 'Новичком',
        depth: 1,
        // Ноль — тот самый обрыв счёта посреди размена (см. шапку).
        quiesce: 0,
    },
    { id: 'club', name: 'Любитель', whom: 'Любителем', depth: 3, quiesce: 6 },
    { id: 'master', name: 'Мастер', whom: 'Мастером', depth: 5, quiesce: 8 },
];

export const ROOKIE = 'rookie';
export const CLUB = 'club';
export const MASTER = 'master';

export const levelByName = id => LEVELS.find(l => l.id === id) || LEVELS[1];

// ── Оценка позиции ───────────────────────────────────────────────────────────
// Числа подобраны турниром бот-против-бота (checkersBot.test.js), а не на глаз.

const MAN = 100;
// Дамка в русских шашках сильна непропорционально: она летает и бьёт на
// расстоянии, поэтому стоит втрое, а не вдвое, как в английских.
const KING = 300;
// Каждый пройденный ряд приближает к превращению. Мелко нарочно: гнать простую
// в дамки, бросив позицию, — типичная ошибка, а не план.
const ADVANCE = 7;
// Шашку у борта не побить: бить можно только через неё, а «через» там нет доски.
const EDGE = 6;
// Своя последняя горизонталь — это не трусость, а единственное, что мешает
// чужой простой стать дамкой.
const HOME = 10;

const WIN = 100000;

/**
 * Чего стоит позиция для игрока `me`.
 *
 * Подвижности здесь нет сознательно: посчитать её — это ещё раз перебрать все
 * ходы обеих сторон в КАЖДОМ листе, а на глубине пяти это половина всего
 * времени. Запертые шашки счёт находит и так — он видит, что ходить нечем.
 */
export function evaluate(state, me) {
    let score = 0;
    for (let i = 0; i < CELLS; i++) {
        const piece = state.board[i];
        if (piece === EMPTY) continue;
        const color = colorOf(piece);
        let v;
        if (isKing(piece)) {
            v = KING;
        } else {
            const y = yOf(i);
            const advanced = color === WHITE ? (SIZE - 1 - y) : y;
            const home = color === WHITE ? y === SIZE - 1 : y === 0;
            const x = xOf(i);
            v = MAN + ADVANCE * advanced + (x === 0 || x === SIZE - 1 ? EDGE : 0) + (home ? HOME : 0);
        }
        score += color === me ? v : -v;
    }
    return score;
}

/** Счёт кончившейся партии. Чем меньше ходов до победы, тем она дороже. */
function terminal(state, me, depth) {
    if (state.winner == null) return 0;      // ничья — ровно ноль, а не «почти проигрыш»
    return state.winner === me ? WIN + depth : -(WIN + depth);
}

/**
 * Порядок перебора. Альфа-бета режет тем больше, чем раньше встретился хороший
 * ход, поэтому сначала смотрим взятия, потом превращения, потом всё остальное.
 * На результат порядок не влияет — только на время.
 */
function order(moves) {
    return moves
        .map(m => ({ m, w: (m.cap >= 0 ? 2 : 0) + (m.to < SIZE || m.to >= CELLS - SIZE ? 1 : 0) }))
        .sort((a, b) => b.w - a.w)
        .map(x => x.m);
}

/**
 * Перебор с альфа-бетой.
 *
 * ЦЕПОЧКА БОЯ НЕ ТРАТИТ ГЛУБИНУ: если ход остался у той же стороны, счёт идёт с
 * тем же depth. Иначе «на два хода вперёд» означало бы разное в зависимости от
 * того, сколько шашек побили по дороге, — а для игрока это один ход.
 *
 * `extra` — сколько полуходов разрешено досчитать ПОСЛЕ потолка, если на доске
 * идёт бой. Без этого счёт обрывается посреди размена, и бот радуется съеденной
 * шашке ровно за полхода до того, как её съедят обратно (см. шапку).
 */
function search(state, depth, alpha, beta, me, extra) {
    if (state.phase === 'over') return terminal(state, me, depth);
    if (depth <= 0) {
        const calm = state.chain < 0 && !mustCapture(state);
        if (calm || extra <= 0) return evaluate(state, me);
    }

    const moves = order(legalMoves(state));
    const maximizing = state.turn === me;
    let best = maximizing ? -Infinity : Infinity;

    for (const move of moves) {
        const next = cloneGame(state);
        const played = applyMove(next, state.turn, move);
        if (!played.ok) continue;
        const value = search(
            next,
            played.again ? depth : depth - 1,
            alpha, beta, me,
            depth <= 0 ? extra - 1 : extra,
        );
        if (maximizing) {
            if (value > best) best = value;
            if (best > alpha) alpha = best;
        } else {
            if (value < best) best = value;
            if (best < beta) beta = best;
        }
        if (alpha >= beta) break;
    }
    return Number.isFinite(best) ? best : evaluate(state, me);
}

/**
 * Что бот сыграет. Возвращает ОДИН прыжок { from, to } или null, если ходов нет.
 *
 * Из равных по счёту ходов выбирается случайный: без этого бот на одной и той же
 * позиции играет одно и то же, и вторая партия повторяет первую до хода.
 */
export function pickMove(state, { level = CLUB, rng = Math.random } = {}) {
    const conf = levelByName(level);
    const moves = legalMoves(state);
    if (!moves.length) return null;
    if (moves.length === 1) return { from: moves[0].from, to: moves[0].to };

    const me = state.turn;
    let best = -Infinity;
    let tied = [];

    for (const move of order(moves)) {
        const next = cloneGame(state);
        const played = applyMove(next, me, move);
        if (!played.ok) continue;
        const value = search(
            next,
            played.again ? conf.depth : conf.depth - 1,
            -Infinity, Infinity, me, conf.quiesce,
        );
        if (value > best) { best = value; tied = [move]; }
        else if (value === best) tied.push(move);
    }

    const pick = tied[Math.min(tied.length - 1, Math.floor(rng() * tied.length))] || moves[0];
    return { from: pick.from, to: pick.to };
}
