// Поле сапёра: раскладка мин и открытие клеток.
//
// Логика живёт на сервере целиком, и это не паранойя, а условие честного топа:
// если раскладку знает браузер, «пройденный сапёр» рисуется в консоли за
// секунду. Клиент шлёт «открыть клетку», сервер отвечает тем, что открылось;
// где мины — он узнаёт только в конце игры.
//
// Клетки нумеруем одним числом: index = row * cols + col.

import { randomInt } from 'node:crypto';

export const ROWS = 18;
export const COLS = 18;
// 50 из 324 — это 15,4%: плотность «среднего» поля классического сапёра
// (16×16 на 40 мин — 15,6%). На 20% поле превращается в угадайку, на 10% —
// в подметание.
export const MINES = 50;

export function createField(rows = ROWS, cols = COLS, mines = MINES) {
    const size = rows * cols;
    if (mines >= size) throw new Error('мин больше, чем клеток');
    return {
        rows, cols, mines, size,
        mine: new Uint8Array(size),
        count: new Uint8Array(size),   // сколько мин рядом
        opened: new Uint8Array(size),
        placed: false,                 // мины ставятся после первого клика
        state: 'new',                  // 'new' | 'play' | 'won' | 'lost'
    };
}

export function neighbours(field, index) {
    const { rows, cols } = field;
    const r = Math.floor(index / cols);
    const c = index % cols;
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) out.push(nr * cols + nc);
        }
    }
    return out;
}

/**
 * Расставить мины так, чтобы первый клик и всё вокруг него были пустыми.
 * Первый ход в сапёре не должен убивать — иначе игра начинается с монетки, а
 * свободный «пятачок» вокруг даёт полю раскрыться и не гадать с первого шага.
 */
export function placeMines(field, safeIndex, random = randomInt) {
    let forbidden = new Set([safeIndex, ...neighbours(field, safeIndex)]);
    // На крошечном поле (тесты, возможные «лёгкие» размеры) пятачок может не
    // поместиться — тогда бережём только клетку под курсором, иначе мины
    // некуда ставить и цикл ниже не кончится никогда.
    if (field.mines > field.size - forbidden.size) forbidden = new Set([safeIndex]);
    let placed = 0;
    while (placed < field.mines) {
        const i = random(field.size);
        if (field.mine[i] || forbidden.has(i)) continue;
        field.mine[i] = 1;
        placed++;
    }
    for (let i = 0; i < field.size; i++) {
        if (field.mine[i]) continue;
        field.count[i] = neighbours(field, i).reduce((n, j) => n + field.mine[j], 0);
    }
    field.placed = true;
    field.state = 'play';
    return field;
}

export function isWin(field) {
    // Победа — это когда открыто всё, кроме мин. Расставлять флажки не
    // обязательно: в сапёре они помощь себе, а не условие.
    for (let i = 0; i < field.size; i++) {
        if (!field.mine[i] && !field.opened[i]) return false;
    }
    return true;
}

/**
 * Открыть клетку. Возвращает { revealed: [index…], hit } — hit означает мину.
 * Пустые клетки раскрываются волной, как и положено сапёру.
 */
export function openCell(field, index, random = randomInt) {
    if (field.state === 'won' || field.state === 'lost') return { revealed: [], hit: false };
    if (index < 0 || index >= field.size) return { revealed: [], hit: false };
    if (!field.placed) placeMines(field, index, random);
    if (field.opened[index]) return { revealed: [], hit: false };

    if (field.mine[index]) {
        field.state = 'lost';
        return { revealed: [], hit: true };
    }

    const revealed = [];
    const queue = [index];
    field.opened[index] = 1;
    revealed.push(index);
    while (queue.length) {
        const cur = queue.pop();
        if (field.count[cur] !== 0) continue;
        for (const n of neighbours(field, cur)) {
            if (field.opened[n] || field.mine[n]) continue;
            field.opened[n] = 1;
            revealed.push(n);
            queue.push(n);
        }
    }
    if (isWin(field)) field.state = 'won';
    return { revealed, hit: false };
}

/**
 * «Аккорд»: клик по открытой цифре, вокруг которой расставлено ровно столько
 * флажков, сколько она показывает, открывает все остальные соседние клетки.
 * Без этого поле 18×18 разминается вдвое дольше, чем играется.
 *
 * Флажки живут в браузере (сервер их не хранит: это пометки для себя, а не
 * состояние игры), поэтому их присылают вместе с ходом. Соврать ими можно
 * только себе: если под неотмеченной клеткой окажется мина — это проигрыш.
 */
export function chord(field, index, flags = [], random = randomInt) {
    if (field.state !== 'play' || !field.opened[index] || !field.count[index]) {
        return { revealed: [], hit: false };
    }
    const flagged = new Set(flags);
    const around = neighbours(field, index);
    if (around.filter(i => flagged.has(i)).length !== field.count[index]) {
        return { revealed: [], hit: false };
    }
    const revealed = [];
    for (const n of around) {
        if (field.opened[n] || flagged.has(n)) continue;
        const step = openCell(field, n, random);
        revealed.push(...step.revealed);
        if (step.hit) return { revealed, hit: true };
    }
    return { revealed, hit: false };
}

/** Клетки с минами — только для конца игры. */
export function minePositions(field) {
    const out = [];
    for (let i = 0; i < field.size; i++) if (field.mine[i]) out.push(i);
    return out;
}

/** Открытое поле для клиента: [[index, цифра], …]. */
export function openedCells(field) {
    const out = [];
    for (let i = 0; i < field.size; i++) if (field.opened[i]) out.push([i, field.count[i]]);
    return out;
}
