// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Тетрис»: правила игры одним файлом.
//
// Здесь ВСЁ, что знает про тетрис и фронт, и бэкенд: формы фигур, вращение с
// отталкиванием от стен (SRS), гравитация, задержка фиксации, счёт. Окно игры
// (frontend/src/tetris.js) занимается только рисованием и клавишами, а сервер
// (backend/src/routes/tetris.js) берёт отсюда проверку правдоподобности
// результата — иначе «сколько очков бывает» пришлось бы держать в двух местах и
// они бы разъехались на первой же правке таблицы очков.
//
// ПОЧЕМУ ПАРТИЯ СЧИТАЕТСЯ В БРАУЗЕРЕ, а не на сервере, как в сапёре: сапёр —
// это десяток запросов за партию, тетрис — до тридцати действий В СЕКУНДУ, и
// каждое надо показать в тот же кадр. Гонять их через сеть нельзя: на первом же
// подлагивании игра станет неиграбельной. Поэтому на сервер уходит ОДИН запрос
// в конце партии, а он проверяет результат на правдоподобность (isPlausibleRun)
// — это защита от опечатки и от «999999 за минуту», а не от человека с
// открытой консолью. Мини-топ пасхалки такой цены и стоит.
//
// Состояние партии — обычный объект с мутацией (а не новый на каждый кадр):
// ходов действительно тридцать в секунду, и плодить мусор для сборщика на
// каждое нажатие незачем. Функции возвращают true, если картинка изменилась, —
// по этому флагу окно решает, перерисовывать поле или нет.
// ─────────────────────────────────────────────────────────────────────────────

export const COLS = 10;
export const ROWS = 20;          // видимая часть стакана
// Две строки над стаканом: в них рождается фигура и туда же её может вытолкнуть
// вращение у самого верха. Не рисуются — но и не «съедаются»: линия, собранная
// в них, считается как любая другая.
export const HIDDEN_ROWS = 2;
export const TOTAL_ROWS = ROWS + HIDDEN_ROWS;
export const CELLS = COLS * TOTAL_ROWS;

export const PIECE_TYPES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

// Формы всех четырёх поворотов заданы списком клеток, а не матрицей, которую
// крутят на лету: клетки нужны на каждой проверке столкновения (то есть по
// нескольку раз за кадр), и считать их поворотом матрицы — лишняя работа на
// ровном месте. Координаты — смещения внутри рамки фигуры, x вправо, y ВНИЗ.
const SHAPES = {
    I: [
        [[0, 1], [1, 1], [2, 1], [3, 1]],
        [[2, 0], [2, 1], [2, 2], [2, 3]],
        [[0, 2], [1, 2], [2, 2], [3, 2]],
        [[1, 0], [1, 1], [1, 2], [1, 3]],
    ],
    J: [
        [[0, 0], [0, 1], [1, 1], [2, 1]],
        [[1, 0], [2, 0], [1, 1], [1, 2]],
        [[0, 1], [1, 1], [2, 1], [2, 2]],
        [[1, 0], [1, 1], [0, 2], [1, 2]],
    ],
    L: [
        [[2, 0], [0, 1], [1, 1], [2, 1]],
        [[1, 0], [1, 1], [1, 2], [2, 2]],
        [[0, 1], [1, 1], [2, 1], [0, 2]],
        [[0, 0], [1, 0], [1, 1], [1, 2]],
    ],
    // Квадрат не вращается вовсе — все четыре состояния одинаковы. Так вращение
    // не надо особо оговаривать в коде: оно просто ничего не двигает.
    O: [
        [[0, 0], [1, 0], [0, 1], [1, 1]],
        [[0, 0], [1, 0], [0, 1], [1, 1]],
        [[0, 0], [1, 0], [0, 1], [1, 1]],
        [[0, 0], [1, 0], [0, 1], [1, 1]],
    ],
    S: [
        [[1, 0], [2, 0], [0, 1], [1, 1]],
        [[1, 0], [1, 1], [2, 1], [2, 2]],
        [[1, 1], [2, 1], [0, 2], [1, 2]],
        [[0, 0], [0, 1], [1, 1], [1, 2]],
    ],
    T: [
        [[1, 0], [0, 1], [1, 1], [2, 1]],
        [[1, 0], [1, 1], [2, 1], [1, 2]],
        [[0, 1], [1, 1], [2, 1], [1, 2]],
        [[1, 0], [0, 1], [1, 1], [1, 2]],
    ],
    Z: [
        [[0, 0], [1, 0], [1, 1], [2, 1]],
        [[2, 0], [1, 1], [2, 1], [1, 2]],
        [[0, 1], [1, 1], [1, 2], [2, 2]],
        [[1, 0], [0, 1], [1, 1], [0, 2]],
    ],
};

// Где фигура рождается по горизонтали: рамка 3×3 — по центру (столбцы 3–5),
// палка и квадрат — так, чтобы стакан делился поровну (классическая раскладка).
const SPAWN_X = { I: 3, J: 3, L: 3, O: 4, S: 3, T: 3, Z: 3 };

// Отталкивание от стен (SRS): если поворот не влез, фигуру пробуют сдвинуть по
// этому списку — первое место, куда она влезает, и становится результатом.
// Именно отсюда берутся «вкручивания» в щель, ради которых всё и затевалось.
// Таблица стандартная, но y здесь ВНИЗ (в оригинале вверх), поэтому знаки по
// вертикали перевёрнуты.
const KICKS = {
    // Все фигуры, кроме палки и квадрата.
    JLSTZ: {
        '01': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
        '10': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
        '12': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
        '21': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
        '23': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
        '32': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
        '30': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
        '03': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    },
    // У палки своя таблица: она длиннее и отталкивается на две клетки.
    I: {
        '01': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
        '10': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
        '12': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
        '21': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
        '23': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
        '32': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
        '30': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
        '03': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
    },
};

// Очки за линии — классическая таблица, умножается на уровень.
export const LINE_SCORES = [0, 100, 300, 500, 800];
// Тетрис за тетрисом (без «мелких» уборок между ними) идёт с полуторной ценой:
// это единственная причина не разбирать стакан по одной линии.
export const B2B_BONUS = 1.5;
const COMBO_SCORE = 50;          // за каждую уборку подряд, кроме первой
const SOFT_DROP_POINT = 1;       // за клетку ускоренного падения
const HARD_DROP_POINT = 2;       // за клетку мгновенного сброса

export const LINES_PER_LEVEL = 10;
const MAX_GRAVITY_LEVEL = 20;    // дальше падение уже не ускоряется
export const LOCK_DELAY_MS = 500;
// Сколько раз задержку фиксации можно продлить движением. Без потолка фигуру
// можно было бы возить по дну бесконечно — партия просто не кончалась бы.
const LOCK_RESETS = 15;

// Время падения на одну клетку по уровням. Считается формулой гайдлайна
// (0.8 − (n−1)·0.007)^(n−1), но ОДИН РАЗ при загрузке модуля: на каждом кадре
// возводить в степень незачем, а таблица из двадцати чисел ничего не стоит.
const GRAVITY_MS = (() => {
    const table = [];
    for (let level = 1; level <= MAX_GRAVITY_LEVEL; level++) {
        const sec = Math.pow(0.8 - (level - 1) * 0.007, level - 1);
        table.push(Math.max(Math.round(sec * 1000), 20));
    }
    return table;
})();

export function levelFor(lines) {
    return Math.floor(lines / LINES_PER_LEVEL) + 1;
}

export function gravityMs(level) {
    return GRAVITY_MS[Math.min(Math.max(level, 1), MAX_GRAVITY_LEVEL) - 1];
}

// ── Мешок и случайность ──────────────────────────────────────────────────────

// Генератор с зерном (mulberry32): нужен не ради «честности», а ради тестов и
// дев-песочницы — партию с тем же зерном можно повторить клавиша в клавишу.
function makeRng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// «Мешок»: семь фигур перемешиваются и выдаются подряд, потом мешок
// наполняется заново. Так не бывает ни пяти палок подряд, ни партии без палки
// вовсе — чистый random() даёт и то, и другое, и играть в это невозможно.
function refillBag(game) {
    const bag = PIECE_TYPES.slice();
    for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(game.rng() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    game.bag = bag;
}

function nextType(game) {
    if (!game.bag.length) refillBag(game);
    return game.bag.pop();
}

// ── Партия ───────────────────────────────────────────────────────────────────

// Показываем ровно одну следующую фигуру — как в том тетрисе, который все и
// помнят. Очередь из трёх превращает игру в другую: планировать становится
// сильно легче, и «мини-топ» перестаёт сравнивать одинаковые партии.
export const NEXT_COUNT = 1;

/**
 * Новая партия. seed — зерно случайности (по умолчанию своё на каждую партию).
 *
 * board — плоский Uint8Array: 0 — пусто, иначе номер типа фигуры + 1. Плоский
 * массив, а не массив массивов: обращений к нему за кадр сотни, и лишний
 * разыменованный указатель на каждое обращение — ровно тот случай, когда
 * «читабельнее» стоит кадров.
 */
export function createGame({ seed } = {}) {
    const game = {
        board: new Uint8Array(CELLS),
        rng: makeRng(seed == null ? (Math.random() * 0xffffffff) >>> 0 : seed),
        bag: [],
        next: [],
        piece: null,        // { type, rot, x, y }
        score: 0,
        lines: 0,
        level: 1,
        combo: -1,          // -1 — цепочки нет; 0 — первая уборка в цепочке
        b2b: false,
        pieces: 0,          // сколько фигур поставлено — нужно серверу для проверки
        over: false,
        // Таймеры партии: считаются в tick(), наружу торчат только для тестов.
        gravityAcc: 0,
        lockAcc: 0,
        locking: false,
        lockResets: 0,
        soft: false,
        elapsedMs: 0,
        // Что случилось последним ходом — окну для анимаций, и обнуляется им же.
        clearedRows: [],
        lastGain: 0,
    };
    for (let i = 0; i < NEXT_COUNT; i++) game.next.push(nextType(game));
    spawn(game);
    return game;
}

function cellsOf(type, rot, x, y, out) {
    const shape = SHAPES[type][rot];
    for (let i = 0; i < 4; i++) {
        out[i * 2] = x + shape[i][0];
        out[i * 2 + 1] = y + shape[i][1];
    }
    return out;
}

// Один общий буфер на все проверки: cellsOf вызывается по нескольку раз за
// кадр, и каждый раз выделять восьмиэлементный массив — мусор на пустом месте.
const probe = new Int16Array(8);

function fits(game, type, rot, x, y) {
    cellsOf(type, rot, x, y, probe);
    for (let i = 0; i < 4; i++) {
        const cx = probe[i * 2];
        const cy = probe[i * 2 + 1];
        if (cx < 0 || cx >= COLS || cy >= TOTAL_ROWS) return false;
        if (cy < 0) continue;                     // над стаканом пусто всегда
        if (game.board[cy * COLS + cx]) return false;
    }
    return true;
}

/** Клетки фигуры в координатах поля: [x0,y0, x1,y1, …]. */
export function pieceCells(piece, out = new Int16Array(8)) {
    return cellsOf(piece.type, piece.rot, piece.x, piece.y, out);
}

function spawn(game) {
    const t = game.next.shift();
    game.next.push(nextType(game));
    // Фигура рождается сразу под потолком видимой части: если родить её в
    // скрытых строках, первую секунду человек смотрит в пустой стакан и не
    // понимает, чем играет.
    const piece = { type: t, rot: 0, x: SPAWN_X[t], y: HIDDEN_ROWS };
    game.piece = piece;
    game.gravityAcc = 0;
    game.lockAcc = 0;
    game.locking = false;
    game.lockResets = 0;
    // Родиться некуда — стакан переполнен, партия кончилась.
    if (!fits(game, piece.type, piece.rot, piece.x, piece.y)) {
        game.over = true;
        game.piece = null;
    }
}

/** Насколько глубоко фигура упадёт отсюда (для «тени» и мгновенного сброса). */
export function dropDistance(game, piece = game.piece) {
    if (!piece) return 0;
    let d = 0;
    while (fits(game, piece.type, piece.rot, piece.x, piece.y + d + 1)) d++;
    return d;
}

// ── Действия ─────────────────────────────────────────────────────────────────

// Любое удавшееся движение по дну продлевает задержку фиксации — иначе фигуру
// нельзя было бы довернуть в последний момент, а это половина игры.
function touchLock(game) {
    if (!game.locking || game.lockResets >= LOCK_RESETS) return;
    game.lockResets++;
    game.lockAcc = 0;
}

export function move(game, dx) {
    const p = game.piece;
    if (!p || game.over) return false;
    if (!fits(game, p.type, p.rot, p.x + dx, p.y)) return false;
    p.x += dx;
    touchLock(game);
    return true;
}

/** dir: 1 — по часовой, -1 — против. */
export function rotate(game, dir) {
    const p = game.piece;
    if (!p || game.over) return false;
    const to = (p.rot + (dir > 0 ? 1 : 3)) % 4;
    if (to === p.rot) return false;
    const table = p.type === 'I' ? KICKS.I : KICKS.JLSTZ;
    // Квадрату таблица не нужна: он одинаков во всех положениях.
    const kicks = p.type === 'O' ? [[0, 0]] : table[`${p.rot}${to}`];
    for (const [dx, dy] of kicks) {
        if (!fits(game, p.type, to, p.x + dx, p.y + dy)) continue;
        p.rot = to;
        p.x += dx;
        p.y += dy;
        touchLock(game);
        return true;
    }
    return false;
}

/**
 * Шаг вниз «руками» (стрелка вниз). Возвращает true, если фигура сдвинулась.
 * Очки за ускоренное падение начисляются здесь же — по очку за клетку.
 */
export function softStep(game) {
    const p = game.piece;
    if (!p || game.over) return false;
    if (!fits(game, p.type, p.rot, p.x, p.y + 1)) return false;
    p.y++;
    game.score += SOFT_DROP_POINT;
    game.gravityAcc = 0;
    return true;
}

/** Мгновенный сброс: фигура падает до упора и фиксируется сразу. */
export function hardDrop(game) {
    const p = game.piece;
    if (!p || game.over) return false;
    const d = dropDistance(game);
    p.y += d;
    game.score += d * HARD_DROP_POINT;
    lock(game);
    return true;
}

// ── Фиксация и уборка линий ──────────────────────────────────────────────────

function lock(game) {
    const p = game.piece;
    if (!p) return;
    pieceCells(p, probe);
    const code = PIECE_TYPES.indexOf(p.type) + 1;
    for (let i = 0; i < 4; i++) {
        const cy = probe[i * 2 + 1];
        if (cy < 0) continue;
        game.board[cy * COLS + probe[i * 2]] = code;
    }
    game.pieces++;
    const cleared = clearLines(game);
    award(game, cleared);
    game.piece = null;
    spawn(game);
}

/** Убрать заполненные линии, сдвинув всё сверху вниз. Возвращает их номера. */
function clearLines(game) {
    const rows = [];
    const board = game.board;
    for (let y = TOTAL_ROWS - 1; y >= 0; y--) {
        let full = true;
        const base = y * COLS;
        for (let x = 0; x < COLS; x++) {
            if (!board[base + x]) { full = false; break; }
        }
        if (full) rows.push(y);
    }
    // Список убранных строк окно берёт для вспышки — поэтому пишем его и когда
    // строк нет: иначе вспышка от прошлой уборки повторилась бы на следующей
    // фигуре.
    game.clearedRows = rows;
    if (!rows.length) return rows;
    // Сдвигаем одним проходом снизу вверх: строка-приёмник идёт своим шагом,
    // строка-источник своим. Так уборка четырёх линий стоит столько же, сколько
    // одной, и не зависит от того, сколько раз копировать массив.
    let write = TOTAL_ROWS - 1;
    for (let read = TOTAL_ROWS - 1; read >= 0; read--) {
        if (rows.includes(read)) continue;
        if (write !== read) board.copyWithin(write * COLS, read * COLS, read * COLS + COLS);
        write--;
    }
    for (; write >= 0; write--) board.fill(0, write * COLS, write * COLS + COLS);
    return rows;
}

function award(game, cleared) {
    const n = cleared.length;
    if (!n) {
        game.combo = -1;         // цепочка рвётся на первой же фигуре без линий
        game.lastGain = 0;
        return;
    }
    game.lines += n;
    game.level = levelFor(game.lines);

    const tetris = n === 4;
    let gain = LINE_SCORES[n] * game.level;
    if (tetris && game.b2b) gain = Math.round(gain * B2B_BONUS);
    game.combo++;
    if (game.combo > 0) gain += COMBO_SCORE * game.combo * game.level;
    game.b2b = tetris;

    game.score += gain;
    game.lastGain = gain;
}

// ── Ход времени ──────────────────────────────────────────────────────────────

/**
 * Прокрутить партию на dtMs миллисекунд: гравитация и задержка фиксации.
 * Возвращает true, если на поле что-то изменилось (окно перерисовывает только
 * тогда — на статичной картинке рисовать по кадру в 16 мс незачем).
 *
 * Соль — в накоплении времени, а не в «одном шаге за кадр»: на девятом уровне
 * фигура падает быстрее, чем идут кадры, и шаг за кадр просто не успевал бы.
 */
export function tick(game, dtMs) {
    if (game.over || !game.piece) return false;
    game.elapsedMs += dtMs;
    let changed = false;

    // Фигуру увели с дна (сдвинули в яму или довернули над ней) — отсчёт
    // фиксации отменяется, дальше опять обычная гравитация.
    if (game.locking) {
        const p = game.piece;
        if (fits(game, p.type, p.rot, p.x, p.y + 1)) { game.locking = false; game.lockAcc = 0; }
    }
    // Приземлилась ли фигура ПРЯМО СЕЙЧАС, в этом же вызове: тогда время этого
    // кадра в задержку фиксации не идёт. Иначе на первом уровне (шаг 800 мс)
    // фигура касалась бы дна и в тот же миг фиксировалась — вся задержка, ради
    // которой она и заведена, съедалась бы одним кадром.
    const wasLocking = game.locking;

    const step = game.soft
        // Ускоренное падение — двадцатая доля обычного, но не быстрее 15 мс:
        // иначе на первом уровне фигура «телепортируется» и её не поймать.
        ? Math.max(gravityMs(game.level) / 20, 15)
        : gravityMs(game.level);

    game.gravityAcc += dtMs;
    while (game.gravityAcc >= step) {
        game.gravityAcc -= step;
        const p = game.piece;
        if (fits(game, p.type, p.rot, p.x, p.y + 1)) {
            p.y++;
            if (game.soft) game.score += SOFT_DROP_POINT;
            game.locking = false;
            game.lockAcc = 0;
            changed = true;
        } else {
            // Дно: дальше не гравитация, а задержка фиксации.
            game.gravityAcc = 0;
            if (!game.locking) { game.locking = true; game.lockAcc = 0; game.lockResets = 0; }
            break;
        }
    }

    if (game.locking && wasLocking) {
        game.lockAcc += dtMs;
        if (game.lockAcc >= LOCK_DELAY_MS) {
            lock(game);
            changed = true;
        }
    }
    return changed;
}

// ── Проверка результата на сервере ───────────────────────────────────────────

// Линия — это десять клеток, фигура даёт четыре: меньше 2.5 фигур на линию не
// бывает физически. Округляем вниз с запасом.
const MIN_PIECES_PER_LINE = 2.5;
// Самый быстрый человек ставит фигуру примерно за 150 мс; 60 — заведомо ниже
// любого живого темпа, но отсекает «тысяча фигур за секунду».
const MIN_MS_PER_PIECE = 60;

/**
 * Верхняя граница счёта для партии из lines линий и pieces фигур.
 *
 * Считаем по самому щедрому сценарию: каждая уборка — тетрис за тетрисом
 * (800 × 1.5 = 1200 очков за четыре линии, то есть 300 на линию) на текущем
 * уровне, к этому комбо на каждую фигуру и мгновенный сброс с самого верха.
 * Настоящая игра до этой границы не доходит никогда — она и не должна: это
 * проверка на бессмыслицу, а не подсчёт «сколько можно было выжать».
 */
export function maxPlausibleScore(lines, pieces) {
    const level = levelFor(Math.max(lines, 0));
    const fromLines = Math.max(lines, 0) * 300 * level;
    const fromCombo = Math.max(pieces, 0) * COMBO_SCORE * level;
    // Сброс с потолка: 20 клеток по два очка, плюс те же 20 по очку за
    // ускоренное падение — одновременно так не бывает, но граница на то и
    // граница.
    const fromDrops = Math.max(pieces, 0) * ROWS * (HARD_DROP_POINT + SOFT_DROP_POINT);
    return fromLines + fromCombo + fromDrops;
}

/**
 * Похож ли присланный результат на настоящую партию.
 *
 * Отсекает мусор и опечатки, а не человека с открытой консолью: партия целиком
 * считается в браузере (см. шапку файла), и «непробиваемо» здесь не бывает по
 * устройству. Возвращает { ok: true } или { ok: false, reason } — reason нужен
 * логу сервера, игроку он не показывается.
 */
export function isPlausibleRun({ score, lines, pieces, seconds }) {
    const s = Number(score);
    const l = Number(lines);
    const p = Number(pieces);
    const sec = Number(seconds);

    if (![s, l, p, sec].every(v => Number.isFinite(v) && v >= 0)) return { ok: false, reason: 'shape' };
    if (![s, l, p, sec].every(Number.isInteger)) return { ok: false, reason: 'shape' };
    // Партия длиннее суток — это забытая вкладка, а не результат.
    if (sec > 86_400) return { ok: false, reason: 'too_long' };
    if (p > 100_000) return { ok: false, reason: 'too_many_pieces' };
    if (l > p / MIN_PIECES_PER_LINE) return { ok: false, reason: 'lines_vs_pieces' };
    if (sec * 1000 < p * MIN_MS_PER_PIECE) return { ok: false, reason: 'too_fast' };
    if (s > maxPlausibleScore(l, p)) return { ok: false, reason: 'score_too_high' };
    return { ok: true };
}
