// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Шашки» — правила. РУССКИЕ шашки, а не международные и не чекерс.
//
// ЧТО ЭТО ЗА ФАЙЛ. Здесь вся игра целиком: доска, ходы, бой, дамки, конец
// партии. Окно (frontend/src/checkers.js) рисует и слушает мышь, сервер
// (backend/src/checkers/) хранит позицию и применяет присланный ход — но ни то,
// ни другое не знает, что во что бьётся. Один и тот же файл считает партию с
// ботом в браузере и партию с людьми на сервере, поэтому разойтись им негде.
//
// ПОЧЕМУ ТУТ НЕТ viewFor, КАК В ДУРАКЕ И МОРСКОМ БОЕ. Там сервер отдаёт игроку
// не позицию, а ЕГО ВИД на неё, потому что есть закрытая информация: чужая рука
// и чужая расстановка. В шашках закрытого нет ВООБЩЕ НИЧЕГО — доска на виду у
// обоих с первого хода. Прятать нечего, и городить вид ради симметрии значило бы
// делать вид, что тут есть тайна.
//
// ПОЧЕМУ ТОГДА ПАРТИЮ ВСЁ-ТАКИ ВЕДЁТ СЕРВЕР. По той же причине, что бильярд:
// игра ПАРНАЯ, и очко, которое игрок себе приписал, отнято у живого человека.
// Только бильярду сервер нужен как арбитр над физикой (шестнадцать шаров,
// которые надо посчитать одинаково), а здесь считать нечего — ход это два числа.
// Поэтому сверки отпечатков, как в бильярде, тут нет: сервер просто прикладывает
// присланный ход своими же правилами и хранит результат.
//
// ХОД — ЭТО ОДИН ПРЫЖОК, А НЕ ВСЯ ЦЕПОЧКА. По сети едет { from, to }, и если
// побившая шашка может бить дальше, ход ОСТАЁТСЯ У НЕЁ — ровно как «попал —
// стреляй ещё» в морском бое. Так соперник видит цепочку по шагам, а не готовую
// доску с четырьмя пропавшими шашками, и так же устроен ввод: игрок кликает
// клетку за клеткой, а не набирает d4:f6:h4 одним движением.
//
// ТУРЕЦКИЙ УДАР. Побитые шашки снимаются с доски НЕ СРАЗУ, а когда цепочка
// кончилась, и перепрыгнуть уже побитую нельзя — она стоит на доске и мешает.
// Это не мелочь и не украшение: без этого правила длинные цепочки считаются
// иначе, и половина комбинаций в русских шашках держится именно на нём. Поэтому
// побитые лежат в state.captured, окно рисует их погашенными, и человек ВИДИТ
// правило, а не читает о нём.
//
// ПРОСТАЯ, ДОШЕДШАЯ ДО ПОСЛЕДНЕГО РЯДА ПОСРЕДИ БОЯ, СТАНОВИТСЯ ДАМКОЙ СРАЗУ И
// БЬЁТ ДАЛЬШЕ УЖЕ ДАМКОЙ. В международных шашках наоборот — там она обязана
// остановиться. Это одно из двух главных отличий русских шашек, и путать их
// нельзя: на этом превращении стоят все комбинации «в дамки с боем».
//
// БИТЬ ОБЯЗАТЕЛЬНО, НО БОЛЬШИНСТВО НЕ ОБЯЗАТЕЛЬНО. Если бой есть, ходить чем-то
// другим нельзя; а вот КАКОЙ из боёв выбрать — дело игрока, даже если он бьёт
// одну шашку вместо трёх. Это второе главное отличие от международных, где
// обязательно бить максимум.
//
// ЧЕГО ЗДЕСЬ НЕТ СОЗНАТЕЛЬНО: поддавков, столбовых, «дамка ходит на одну»,
// доски 10×10. Это домашние правила, о которых за одним столом договариваются
// вслух, а в офисной пасхалке они дают только споры «а у нас так не играют».
// ─────────────────────────────────────────────────────────────────────────────

export const SIZE = 8;
export const CELLS = SIZE * SIZE;

// Клетки доски. Индекс — y * 8 + x, y = 0 это ВОСЬМАЯ горизонталь (верх доски),
// y = 7 — первая. Считаем все 64 клетки, а не 32 чёрные: экономия в тридцать
// чисел не стоит того, чтобы каждый раз переводить «номер поля» в координаты.
export const xOf = i => i % SIZE;
export const yOf = i => (i / SIZE) | 0;
export const at = (x, y) => y * SIZE + x;
export const onBoard = (x, y) => x >= 0 && x < SIZE && y >= 0 && y < SIZE;

// Играют по ТЁМНЫМ клеткам, и тёмная стоит слева снизу (a1). Отсюда чётность:
// у a1 это x = 0, y = 7.
export const isDark = i => ((xOf(i) + yOf(i)) & 1) === 1;

// Что стоит на клетке.
export const EMPTY = 0;
export const W_MAN = 1;
export const W_KING = 2;
export const B_MAN = 3;
export const B_KING = 4;

export const WHITE = 0;
export const BLACK = 1;
export const foeOf = color => 1 - color;

export const colorOf = p => (p === EMPTY ? -1 : (p === W_MAN || p === W_KING) ? WHITE : BLACK);
export const isKing = p => p === W_KING || p === B_KING;
export const manOf = color => (color === WHITE ? W_MAN : B_MAN);
export const kingOf = color => (color === WHITE ? W_KING : B_KING);

// Белые идут вверх (y уменьшается), чёрные вниз. Простая ходит только вперёд,
// бьёт — в обе стороны.
const FORWARD = [-1, 1];
// Ряд превращения: для белых верхний, для чёрных нижний.
const LAST_ROW = [0, SIZE - 1];

const DIRS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

// Поля по-человечески: a1…h8. Нужны подписям доски и разбору жалоб («он побил
// с d4, а так нельзя»).
export const COLUMNS = 'abcdefgh';
export const cellName = i => `${COLUMNS[xOf(i)]}${SIZE - yOf(i)}`;

// Сколько полуходов без взятия и без хода простой считаются ничьей. Официальное
// правило русских шашек — пятнадцать ходов КАЖДОЙ стороны, то есть тридцать
// полуходов; здесь оно же.
//
// Считать это правило формальностью нельзя: без него две дамки ходят друг вокруг
// друга бесконечно, и партия не кончается ВООБЩЕ. Ровно так однажды зависли два
// бота (см. checkersBot.test.js) — тот же случай, что STALL_BOUTS в дураке.
// Честной игрой в этот потолок упереться нельзя: любой ход простой и любое
// взятие обнуляют счётчик, а без них позиция и правда никуда не движется.
export const IDLE_PLIES = 30;

export const SEATS = 2;

// ── Начальная расстановка ────────────────────────────────────────────────────

/** Доска в начале партии: по три ряда простых с каждой стороны. */
export function startBoard() {
    const board = new Array(CELLS).fill(EMPTY);
    for (let i = 0; i < CELLS; i++) {
        if (!isDark(i)) continue;
        const y = yOf(i);
        if (y <= 2) board[i] = B_MAN;
        else if (y >= SIZE - 3) board[i] = W_MAN;
    }
    return board;
}

// Тот же xorshift32, что во всех остальных пасхалках: случайное здесь идёт
// только через него, и по зерну партия воспроизводится целиком.
function makeRng(seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    const next = () => {
        s ^= s << 13; s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5; s >>>= 0;
        return s / 0x100000000;
    };
    // Первые числа xorshift32 у близких зёрен почти одинаковые: у зёрен 1…40
    // первое значение подряд меньше 0.0003, то есть жребий «кому белые» на них
    // выпадал бы ВСЕГДА одинаково. В бою зерно случайное и это незаметно, а в
    // тестах и на последовательных id заметно сразу — поэтому генератор
    // прокручивается вхолостую, прежде чем его начинают спрашивать.
    for (let i = 0; i < 8; i++) next();
    return next;
}

/**
 * Новая партия.
 *
 * Первыми ходят белые — это правило игры, а не жребий. Жребием решается ДРУГОЕ:
 * кому из двоих достанутся белые. Право первого хода в шашках заметное, и отдать
 * его тому, кто создал вызов, значило бы отдать ему пол-партии.
 */
export function createGame({ seed } = {}) {
    const rng = makeRng(seed == null ? (Math.random() * 0xffffffff) >>> 0 : seed);
    const whiteSeat = rng() < 0.5 ? 0 : 1;
    return {
        phase: 'play',
        board: startBoard(),
        turn: WHITE,
        // Каким цветом играет каждое место за доской: seats[место] = цвет.
        seats: whiteSeat === 0 ? [WHITE, BLACK] : [BLACK, WHITE],
        // Клетка шашки, которая ОБЯЗАНА продолжить бой. -1 — цепочки нет.
        chain: -1,
        // Побитое в текущей цепочке. Остаётся на доске до конца хода — это и
        // есть турецкий удар (см. шапку).
        captured: [],
        // Полуходы без взятия и без хода простой (см. IDLE_PLIES).
        idle: 0,
        // Последний прыжок — только для показа: окно подсвечивает, откуда и куда
        // сходил соперник. Ровно как last в морском бое.
        last: null,
        winner: null,
        reason: '',
    };
}

// ── Кто чем играет ───────────────────────────────────────────────────────────

export const colorOfSeat = (state, seat) => state.seats[seat];
export const seatOfColor = (state, color) => state.seats.indexOf(color);

/** Чьё сейчас место ходит. -1 — партия кончена. */
export function toMove(state) {
    return state.phase === 'play' ? seatOfColor(state, state.turn) : -1;
}

/** Кого ждут. По нему брошенная партия отдаётся тому, кто ждёт. */
export const awaited = toMove;

// ── Ходы ─────────────────────────────────────────────────────────────────────

/**
 * Бои конкретной шашки.
 *
 * `dead` — уже побитое в этой цепочке. Такая шашка ЕЩЁ СТОИТ на доске и через
 * неё нельзя прыгнуть второй раз (турецкий удар): для дамки она вдобавок
 * перекрывает линию, как своя.
 */
function capturesFrom(board, from, dead) {
    const piece = board[from];
    if (piece === EMPTY) return [];
    const color = colorOf(piece);
    const foe = foeOf(color);
    const out = [];
    const x0 = xOf(from), y0 = yOf(from);

    for (const [dx, dy] of DIRS) {
        if (isKing(piece)) {
            // Дамка идёт по всей диагонали: пропускаем пустые, упираемся в
            // первую занятую клетку.
            let x = x0 + dx, y = y0 + dy;
            while (onBoard(x, y) && board[at(x, y)] === EMPTY) { x += dx; y += dy; }
            if (!onBoard(x, y)) continue;
            const victim = at(x, y);
            if (colorOf(board[victim]) !== foe || dead.includes(victim)) continue;
            // Сесть можно на ЛЮБУЮ свободную клетку за побитой — это и есть
            // «дамка бьёт на расстоянии».
            let lx = x + dx, ly = y + dy;
            while (onBoard(lx, ly) && board[at(lx, ly)] === EMPTY) {
                out.push({ from, to: at(lx, ly), cap: victim });
                lx += dx; ly += dy;
            }
        } else {
            // Простая бьёт и вперёд, и назад — этим русские шашки отличаются от
            // английских, где назад бить нельзя.
            const vx = x0 + dx, vy = y0 + dy;
            const tx = x0 + dx * 2, ty = y0 + dy * 2;
            if (!onBoard(tx, ty)) continue;
            const victim = at(vx, vy);
            if (colorOf(board[victim]) !== foe || dead.includes(victim)) continue;
            if (board[at(tx, ty)] !== EMPTY) continue;
            out.push({ from, to: at(tx, ty), cap: victim });
        }
    }
    return out;
}

/** Тихие ходы конкретной шашки (без боя). */
function quietFrom(board, from) {
    const piece = board[from];
    if (piece === EMPTY) return [];
    const color = colorOf(piece);
    const out = [];
    const x0 = xOf(from), y0 = yOf(from);

    for (const [dx, dy] of DIRS) {
        if (isKing(piece)) {
            let x = x0 + dx, y = y0 + dy;
            while (onBoard(x, y) && board[at(x, y)] === EMPTY) {
                out.push({ from, to: at(x, y), cap: -1 });
                x += dx; y += dy;
            }
        } else {
            if (dy !== FORWARD[color]) continue;
            const x = x0 + dx, y = y0 + dy;
            if (onBoard(x, y) && board[at(x, y)] === EMPTY) out.push({ from, to: at(x, y), cap: -1 });
        }
    }
    return out;
}

/**
 * Все законные прыжки в текущей позиции.
 *
 * Здесь же живёт «бить обязательно»: если бой есть хоть у одной шашки, тихие
 * ходы не возвращаются вовсе. А вот выбор между боями остаётся за игроком —
 * большинство в русских шашках не обязательно (см. шапку).
 */
export function legalMoves(state) {
    if (state.phase !== 'play') return [];
    const { board, turn } = state;

    // Цепочка: ходить можно только той шашкой и только боем.
    if (state.chain >= 0) return capturesFrom(board, state.chain, state.captured);

    const caps = [];
    for (let i = 0; i < CELLS; i++) {
        if (colorOf(board[i]) === turn) caps.push(...capturesFrom(board, i, state.captured));
    }
    if (caps.length) return caps;

    const quiet = [];
    for (let i = 0; i < CELLS; i++) {
        if (colorOf(board[i]) === turn) quiet.push(...quietFrom(board, i));
    }
    return quiet;
}

/** Куда можно пойти конкретной шашкой. Нужно окну: подсветить клетки под кликом. */
export function movesFrom(state, from) {
    return legalMoves(state).filter(m => m.from === from);
}

/** Есть ли у стороны, чей ход, вообще что-то законное. */
export const hasMoves = state => legalMoves(state).length > 0;

/** Бой ли сейчас обязателен. Окну — чтобы написать «бить обязательно». */
export const mustCapture = state => legalMoves(state).some(m => m.cap >= 0);

// ── Ход ──────────────────────────────────────────────────────────────────────

/**
 * Сыграть ОДИН прыжок. Меняет позицию на месте.
 *
 * Возвращает { ok: true, again } — again означает «цепочка продолжается, ход
 * остался у того же игрока». Ровно это уезжает по сети от окна к серверу, и
 * ровно это придумывает бот.
 */
export function applyMove(state, color, move) {
    if (state.phase !== 'play') return { ok: false, reason: 'over' };
    if (color !== state.turn) return { ok: false, reason: 'not_your_turn' };

    const from = Math.trunc(Number(move?.from));
    const to = Math.trunc(Number(move?.to));
    const legal = legalMoves(state).find(m => m.from === from && m.to === to);
    if (!legal) return { ok: false, reason: 'illegal' };

    const board = state.board;
    const piece = board[from];
    const wasMan = !isKing(piece);
    board[from] = EMPTY;
    board[to] = piece;

    // Простая, ДОШЕДШАЯ до последнего ряда, становится дамкой немедленно —
    // и, если бой продолжается, бьёт дальше уже дамкой (см. шапку).
    const promoted = wasMan && yOf(to) === LAST_ROW[color];
    if (promoted) board[to] = kingOf(color);

    if (legal.cap >= 0) state.captured.push(legal.cap);
    state.last = { from, to, cap: legal.cap, promoted, color };

    if (legal.cap >= 0 && capturesFrom(board, to, state.captured).length) {
        state.chain = to;
        return { ok: true, again: true };
    }

    endTurn(state, color, legal.cap >= 0, wasMan);
    return { ok: true, again: false };
}

/**
 * Ход кончился: снять побитое, посчитать простой, передать очередь.
 *
 * Побитое снимается ИМЕННО ЗДЕСЬ, а не в момент прыжка, — это турецкий удар, и
 * он же причина, по которой captured вообще существует.
 */
function endTurn(state, color, wasCapture, wasMan) {
    for (const c of state.captured) state.board[c] = EMPTY;
    state.captured = [];
    state.chain = -1;

    // Счётчик ничьей: ход простой или взятие двигают партию вперёд, всё
    // остальное — топтание дамками.
    state.idle = (wasCapture || wasMan) ? 0 : state.idle + 1;

    state.turn = foeOf(color);

    // Проиграл тот, кому нечем ходить, — и неважно, съели у него всё или просто
    // заперли. Запертая шашка проигрывает так же, как отсутствующая.
    if (!hasMoves(state)) {
        const alive = state.board.some(p => colorOf(p) === state.turn);
        finish(state, color, alive ? 'blocked' : 'wiped');
        return;
    }
    if (state.idle >= IDLE_PLIES) finish(state, null, 'draw');
}

function finish(state, winner, reason) {
    state.phase = 'over';
    state.winner = winner;
    state.reason = reason;
}

/** Сдаться. Иначе проигрывающему выгодно просто закрыть вкладку. */
export function resign(state, color) {
    if (state.phase !== 'play') return { ok: false, reason: 'over' };
    finish(state, foeOf(color), 'resign');
    return { ok: true };
}

/** Партию бросили — победа тому, кто ждал. */
export function timeout(state, color) {
    if (state.phase !== 'play') return { ok: false, reason: 'over' };
    finish(state, foeOf(color), 'timeout');
    return { ok: true };
}

/**
 * Согласиться на ничью. В шашках это ЧАСТЬ ИГРЫ, а не капитуляция пополам:
 * ничейных окончаний тут больше, чем выигранных, и доигрывать три дамки против
 * трёх до тридцатого полухода — не партия, а ожидание счётчика.
 */
export function agreeDraw(state) {
    if (state.phase !== 'play') return { ok: false, reason: 'over' };
    finish(state, null, 'agreed');
    return { ok: true };
}

// ── Счёт на доске ────────────────────────────────────────────────────────────

/** Сколько у кого простых и дамок. Окну — в счётчики над доской. */
export function counts(state) {
    const out = [{ men: 0, kings: 0 }, { men: 0, kings: 0 }];
    for (const p of state.board) {
        if (p === EMPTY) continue;
        const side = out[colorOf(p)];
        if (isKing(p)) side.kings++; else side.men++;
    }
    return out;
}

// ── Хранение ─────────────────────────────────────────────────────────────────
// Позиция простая (числа и массивы чисел), но serialize/deserialize пишем явно:
// строка в базе не должна зависеть от того, какие служебные поля мы когда-нибудь
// заведём в объекте партии.

export function serialize(state) {
    return {
        phase: state.phase,
        board: state.board.slice(),
        turn: state.turn,
        seats: state.seats.slice(),
        chain: state.chain,
        captured: state.captured.slice(),
        idle: state.idle,
        last: state.last ? { ...state.last } : null,
        winner: state.winner,
        reason: state.reason,
    };
}

const cell = v => Math.max(0, Math.min(CELLS - 1, Math.trunc(Number(v)) || 0));

export function deserialize(data) {
    const board = new Array(CELLS).fill(EMPTY);
    const src = Array.isArray(data?.board) ? data.board : [];
    for (let i = 0; i < CELLS; i++) {
        const p = Math.trunc(Number(src[i])) || EMPTY;
        // Чужие числа и шашки на белых клетках отбрасываем молча: битая строка в
        // базе не повод уронить партию, а «доска без одной шашки» видна сразу.
        board[i] = (p >= W_MAN && p <= B_KING && isDark(i)) ? p : EMPTY;
    }
    const phase = data?.phase === 'over' ? 'over' : 'play';
    const seats = data?.seats?.[0] === BLACK ? [BLACK, WHITE] : [WHITE, BLACK];
    return {
        phase,
        board,
        turn: data?.turn === BLACK ? BLACK : WHITE,
        seats,
        chain: data?.chain == null || data.chain < 0 ? -1 : cell(data.chain),
        captured: Array.isArray(data?.captured) ? data.captured.map(cell) : [],
        idle: Math.max(0, Math.trunc(Number(data?.idle)) || 0),
        last: data?.last
            ? {
                from: cell(data.last.from),
                to: cell(data.last.to),
                cap: data.last.cap == null || data.last.cap < 0 ? -1 : cell(data.last.cap),
                promoted: !!data.last.promoted,
                color: data.last.color === BLACK ? BLACK : WHITE,
            }
            : null,
        winner: data?.winner == null ? null : (data.winner === BLACK ? BLACK : WHITE),
        reason: data?.reason || '',
    };
}

/** Копия партии — боту и тестам, чтобы считать ходы, не трогая настоящую. */
export function cloneGame(state) {
    return deserialize(serialize(state));
}

// ── Человеческие подписи ─────────────────────────────────────────────────────

export const END_TEXT = {
    wiped: 'шашек не осталось',
    blocked: 'ходить было нечем',
    resign: 'сдача',
    timeout: 'не дождались хода',
    draw: 'пятнадцать ходов без взятий и без ходов простыми',
    agreed: 'по согласию',
};

export const MOVE_ERROR_TEXT = {
    illegal: 'Так пойти нельзя',
    not_your_turn: 'Сейчас ход соперника',
    over: 'Партия уже кончена',
};

// Цвет словами. Два падежа, потому что подписи в окне разные: «ход белых» и
// «играете белыми», и родительный с творительным по одному слову не собрать.
export const COLOR_NAME = ['белые', 'чёрные'];
export const COLOR_WHOM = ['белыми', 'чёрными'];
