// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Морской бой»: правила одним файлом.
//
// Здесь ВСЁ, что знает про игру и фронт, и бэкенд: поле, флот, проверка
// расстановки, выстрел, добивание и конец партии. Окно игры
// (frontend/src/battleship.js) только рисует поля и слушает мышь, бот
// (shared/battleshipBot.js) выбирает клетку теми же функциями, что и человек, а
// сервер (backend/src/battleship/games.js) применяет присланный ход к своей
// копии позиции.
//
// ЗАКРЫТАЯ ИНФОРМАЦИЯ ЗДЕСЬ — ВСЯ ИГРА, и этим морской бой ближе к дураку, чем
// к бильярду. В бильярде стол виден обоим, и сервер лишь сверяет отпечаток
// позиции. Тут наоборот: единственное, что игрок знает про соперника, — куда он
// сам стрелял и что из этого вышло. Браузер, которому отдали чужую расстановку,
// знает игру целиком — не «может смухлевать», а уже выиграл. Поэтому партию с
// людьми ВЕДЁТ СЕРВЕР, а каждому уезжает не позиция, а ЕГО ВИД на неё (viewFor):
// свой флот, чужие выстрелы по нему, свои выстрелы по чужому полю и потопленные
// чужие корабли. Сверять клиенту нечего — он ничего не пересчитывает.
//
// ВИД — ЕДИНСТВЕННЫЙ ИСТОЧНИК «ЧТО МНЕ СЕЙЧАС ИЗВЕСТНО»: enemyLeft и
// woundedCells берут на вход именно его. Из этого следует нужное — бот физически
// не может подглядеть чужую расстановку, ему дают ровно ту же картинку, что
// рисуют человеку, и другой у него нет (см. шапку battleshipBot.js).
//
// ПАРТИЯ ИДЁТ В ДВА ЭТАПА, и это не «экран настроек перед игрой», а часть
// правил: сначала оба РАССТАВЛЯЮТ флот (одновременно — ждать чужой расстановки
// незачем, она всё равно закрыта), и только когда готовы оба, начинается
// стрельба. Отсюда phase = setup | play | over и ready[] на двоих: пока хоть
// один не готов, стрелять нельзя, а «чей ход» в расстановке не значит ничего.
//
// КЛЕТКА — ОДНО ЧИСЛО (y * SIZE + x), как карта в дураке одно число: так по сети
// уезжает выстрел из одного целого, а не пара координат, которую на другом конце
// надо проверять дважды.
//
// ЧЕГО ЗДЕСЬ НЕТ СОЗНАТЕЛЬНО: залпового режима (стреляешь столько раз, сколько у
// тебя живых кораблей), поля 12×12 и «кораблей буквой Г». Это домашние правила,
// о которых за одним столом договариваются вслух, а в офисной пасхалке они дают
// только споры «а у нас так не играют». Зато классическое «попал — стреляй
// ещё» есть: без него партия превращается в размен промахами и тянется вдвое
// дольше.
// ─────────────────────────────────────────────────────────────────────────────

export const SIZE = 10;
export const CELLS = SIZE * SIZE;

// Флот от большего к меньшему: линкор, два крейсера, три эсминца, четыре катера.
// Порядок важен для расстановки (длинные ставятся первыми — им теснее), поэтому
// список отсортирован, а не «как вспомнилось».
export const FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
export const FLEET_CELLS = FLEET.reduce((sum, len) => sum + len, 0);   // 20

// Отметки выстрела на клетке.
export const NONE = 0;
export const MISS = 1;
export const HIT = 2;

// Направление корабля.
export const ACROSS = 0;    // вправо
export const DOWN = 1;      // вниз

// Буквы столбцов — классические русские, без Ё и Й: именно этот набор
// нарисован на всех бумажных полях, и «Б7» человек прочитает вслух не думая.
export const COLUMNS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К'];

export const xOf = cell => cell % SIZE;
export const yOf = cell => (cell / SIZE) | 0;
export const cellAt = (x, y) => y * SIZE + x;
export const onBoard = (x, y) => x >= 0 && x < SIZE && y >= 0 && y < SIZE;

/** Человеческое имя клетки: «Б7». Им подписываются выстрелы в журнале партии. */
export const cellName = cell => `${COLUMNS[xOf(cell)]}${yOf(cell) + 1}`;

// ── Корабли ──────────────────────────────────────────────────────────────────
// Корабль — четыре числа: где нос, сколько клеток, куда идёт. Попадания в нём НЕ
// хранятся: они и так лежат в выстрелах соперника, а две записи об одном и том
// же рано или поздно разъезжаются.

export const shipAt = (x, y, len, dir) =>
    ({ x: x | 0, y: y | 0, len: len | 0, dir: (dir | 0) === DOWN ? DOWN : ACROSS });

/** Клетки корабля или null, если он вылез за поле. */
export function shipCells(ship) {
    if (!ship) return null;
    const len = ship.len | 0;
    if (len < 1 || len > SIZE) return null;
    const x = ship.x | 0;
    const y = ship.y | 0;
    const dx = ship.dir === DOWN ? 0 : 1;
    const dy = ship.dir === DOWN ? 1 : 0;
    if (!onBoard(x, y) || !onBoard(x + dx * (len - 1), y + dy * (len - 1))) return null;
    const cells = [];
    for (let i = 0; i < len; i++) cells.push(cellAt(x + dx * i, y + dy * i));
    return cells;
}

/** Восемь соседей клетки. Диагонали тоже: корабли не касаются углами. */
export function around(cell) {
    const x = xOf(cell);
    const y = yOf(cell);
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            if (onBoard(x + dx, y + dy)) out.push(cellAt(x + dx, y + dy));
        }
    }
    return out;
}

/** Клетки вокруг корабля — та самая «вода», в которой другого корабля быть не может. */
export function contour(ship) {
    const cells = shipCells(ship);
    if (!cells) return [];
    const own = new Set(cells);
    const out = new Set();
    for (const c of cells) for (const n of around(c)) if (!own.has(n)) out.add(n);
    return [...out];
}

/** Потоплен ли корабль: все его клетки отмечены попаданием в этих выстрелах. */
export function isSunk(ship, shots) {
    const cells = shipCells(ship);
    if (!cells) return false;
    return cells.every(c => shots[c] === HIT);
}

/**
 * Что не так с расстановкой. Пустая строка — всё в порядке.
 *
 * Проверок четыре, и все четыре нужны: игрок расставляет флот мышью и ошибается
 * (корабль наполовину за краем), а сервер получает то, что прислали, и верить
 * этому нельзя вовсе — присланный «линкор на десять клеток» выиграл бы партию
 * молча.
 */
export function fleetError(ships) {
    if (!Array.isArray(ships) || ships.length !== FLEET.length) return 'count';

    const want = FLEET.slice().sort((a, b) => b - a).join(',');
    const got = ships.map(s => s?.len | 0).sort((a, b) => b - a).join(',');
    if (want !== got) return 'fleet';

    // Кому принадлежит клетка: -1 — вода. По этой же карте ловится и наложение,
    // и касание, поэтому второго прохода по полю не нужно.
    const owner = new Int8Array(CELLS).fill(-1);
    const all = [];
    for (let i = 0; i < ships.length; i++) {
        const cells = shipCells(ships[i]);
        if (!cells) return 'bounds';
        for (const c of cells) {
            if (owner[c] >= 0) return 'overlap';
            owner[c] = i;
        }
        all.push(cells);
    }
    for (let i = 0; i < all.length; i++) {
        for (const c of all[i]) {
            for (const n of around(c)) if (owner[n] >= 0 && owner[n] !== i) return 'touch';
        }
    }
    return '';
}

/**
 * Клетки, занятые кораблями ВМЕСТЕ С ВОДОЙ вокруг них, — то есть всё, куда
 * следующий корабль встать уже не может.
 */
export function busyCells(ships) {
    const busy = new Set();
    for (const s of ships || []) {
        for (const c of shipCells(s) || []) {
            busy.add(c);
            for (const n of around(c)) busy.add(n);
        }
    }
    return busy;
}

/**
 * Влезает ли корабль к уже стоящим: не за краем, не поверх и не борт к борту.
 *
 * Этим же вопросом занято окно, пока игрок водит кораблём по полю (подсветка
 * «сюда можно / сюда нельзя»), поэтому функция живёт здесь, а не там: правило
 * «между бортами вода» одно, и второй его копии в разметке быть не должно.
 */
export const canPlace = (ships, ship) => {
    const cells = shipCells(ship);
    if (!cells) return false;
    const busy = busyCells(ships);
    return cells.every(c => !busy.has(c));
};

export const FLEET_ERROR_TEXT = {
    count: 'не все корабли расставлены',
    fleet: 'флот не тот: нужны один четырёхпалубный, два трёх-, три двух- и четыре однопалубных',
    bounds: 'корабль вылез за поле',
    overlap: 'корабли наложились друг на друга',
    touch: 'корабли касаются — между ними нужна вода',
};

/** Приводим присланное к своим числам: с сети приходит что угодно. */
export function normalizeFleet(ships) {
    if (!Array.isArray(ships)) return [];
    return ships.slice(0, FLEET.length + 1).map(s => shipAt(s?.x, s?.y, s?.len, s?.dir));
}

/**
 * Случайная расстановка.
 *
 * Ставим от длинных к коротким и выбираем из ВСЕХ подходящих мест, а не тыкаем
 * наугад, пока не попадём: линкору к концу расстановки может остаться два места
 * на всё поле, и «сто попыток наугад» промахивались бы мимо них раз за разом.
 */
export function randomFleet(rng = Math.random) {
    // Перезапуск нужен не от невезения, а от тупика: последнему катеру может не
    // остаться места вовсе. Двадцати попыток хватает с огромным запасом — флот
    // занимает пятую часть поля.
    for (let attempt = 0; attempt < 20; attempt++) {
        const ships = [];
        let busy = new Set();
        let stuck = false;

        for (const len of FLEET) {
            const spots = [];
            for (let dir = ACROSS; dir <= DOWN; dir++) {
                const maxX = dir === ACROSS ? SIZE - len : SIZE - 1;
                const maxY = dir === ACROSS ? SIZE - 1 : SIZE - len;
                for (let y = 0; y <= maxY; y++) {
                    for (let x = 0; x <= maxX; x++) {
                        const ship = shipAt(x, y, len, dir);
                        if (shipCells(ship).every(c => !busy.has(c))) spots.push(ship);
                    }
                }
                // Однопалубному вертикаль и горизонталь — одно и то же место, и
                // без этого он вдвое чаще занимал бы уже посчитанные клетки.
                if (len === 1) break;
            }
            if (!spots.length) { stuck = true; break; }
            ships.push(spots[Math.floor(rng() * spots.length) % spots.length]);
            busy = busyCells(ships);
        }
        if (!stuck) return ships;
    }
    // Сюда не приходят, но вернуть половину флота нельзя: это молча сломало бы
    // партию. Ровные ряды по краям поля — заведомо законная расстановка.
    return FALLBACK_FLEET.map(s => shipAt(s.x, s.y, s.len, s.dir));
}

// Запасная расстановка на случай, который не случается: корабли стоят рядами
// через клетку, ни один не касается соседа.
const FALLBACK_FLEET = [
    { x: 0, y: 0, len: 4, dir: ACROSS },
    { x: 6, y: 0, len: 3, dir: ACROSS },
    { x: 0, y: 2, len: 3, dir: ACROSS },
    { x: 5, y: 2, len: 2, dir: ACROSS },
    { x: 8, y: 2, len: 2, dir: ACROSS },
    { x: 0, y: 4, len: 2, dir: ACROSS },
    { x: 4, y: 4, len: 1, dir: ACROSS },
    { x: 6, y: 4, len: 1, dir: ACROSS },
    { x: 8, y: 4, len: 1, dir: ACROSS },
    { x: 0, y: 6, len: 1, dir: ACROSS },
];

// ── Партия ───────────────────────────────────────────────────────────────────

// Генератор для раздачи первого хода и случайной расстановки — тот же
// xorshift32, что в остальных пасхалках. Случайное здесь идёт только через него:
// по зерну партия воспроизводится целиком.
function makeRng(seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    return () => {
        s ^= s << 13; s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5; s >>>= 0;
        return s / 0x100000000;
    };
}

export const SEATS = 2;

/**
 * Новая партия. Флотов ещё нет — их расставляют игроки, и до этого показывать
 * нечего: выдуманная за человека расстановка честнее не станет от того, что он
 * её потом поменяет.
 */
export function createGame({ seed } = {}) {
    const rng = makeRng(seed == null ? (Math.random() * 0xffffffff) >>> 0 : seed);
    return {
        phase: 'setup',
        // Кто стреляет первым. Первый выстрел — заметное преимущество, поэтому
        // жребий, а не «кто создал комнату».
        first: rng() < 0.5 ? 0 : 1,
        turn: -1,
        fleets: [null, null],
        ready: [false, false],
        // shots[p] — выстрелы игрока p по ЧУЖОМУ полю. Одно поле на двоих не
        // сделать: по одной и той же клетке стреляют оба.
        shots: [new Array(CELLS).fill(NONE), new Array(CELLS).fill(NONE)],
        // Последний выстрел — только для показа: соперник видит, куда и с каким
        // исходом по нему стреляли. Ровно как last_shot в бильярде.
        last: null,
        winner: null,
        reason: '',
    };
}

/** Чей сейчас ход. -1 — идёт расстановка (ходят оба разом) или партия кончена. */
export function toMove(state) {
    return state.phase === 'play' ? state.turn : -1;
}

/**
 * Кого сейчас ждут. По нему брошенная партия отдаётся тому, кто ждёт.
 *
 * В расстановке ждать можно только вдвоём и только пока сам не готов: если не
 * готовы оба, никто никого не задерживает, и забирать партию не за что.
 */
export function awaited(state) {
    if (state.phase === 'play') return state.turn;
    if (state.phase !== 'setup') return -1;
    if (state.ready[0] === state.ready[1]) return -1;
    return state.ready[0] ? 1 : 0;
}

// ── Вид игрока ───────────────────────────────────────────────────────────────

/**
 * Что видит игрок `seat`. Наружу уезжает ТОЛЬКО это — чужой расстановки здесь
 * нет вовсе, пока корабль не потоплен.
 *
 * Потопленные чужие корабли отдаются ЦЕЛИКОМ, и это не поблажка: все их клетки
 * игрок уже видит как попадания, а объект нужен, чтобы обвести корабль рамкой и
 * закрасить воду вокруг — по правилам она пуста, и человек всё равно вычёркивает
 * её карандашом. Отдать её отметками, а корабль спрятать, значило бы показать то
 * же самое, но неудобно.
 *
 * После конца партии открывается и живое: смотреть, где стояли ненайденные
 * корабли, — половина удовольствия, а испортить этим уже нечего.
 */
export function viewFor(state, seat) {
    const foe = 1 - seat;
    const mine = state.fleets[seat] || [];
    const foeFleet = state.fleets[foe] || [];
    const my = state.shots[seat];
    const over = state.phase === 'over';

    return {
        phase: state.phase,
        seat,
        turn: state.turn,
        first: state.first,
        toMove: toMove(state),
        ready: state.ready.slice(),
        // Свой флот. Пока не расставлен — пустой список, а не null: окну и боту
        // проще всегда получать массив.
        fleet: mine.map(cloneShip),
        // Чужие выстрелы по МОЕМУ полю.
        incoming: state.shots[foe].slice(),
        // Мои выстрелы по ЧУЖОМУ полю.
        outgoing: my.slice(),
        sunk: foeFleet.filter(s => isSunk(s, my)).map(cloneShip),
        // Сколько моих кораблей ещё живо — соперник видит то же самое про мои,
        // считая потопленные, и прятать это не от кого.
        myLeft: mine.filter(s => !isSunk(s, state.shots[foe])).length,
        last: state.last ? { ...state.last } : null,
        // Чужой флот целиком — только после конца партии.
        reveal: over ? foeFleet.map(cloneShip) : null,
        winner: state.winner,
        reason: state.reason,
    };
}

const cloneShip = s => shipAt(s.x, s.y, s.len, s.dir);

/**
 * Длины ЖИВЫХ чужих кораблей — по виду, то есть по тому же, что видит человек:
 * полный флот минус потопленные. Этим пользуется и панель «осталось» в окне, и
 * бот, когда считает, куда ещё может влезть четырёхпалубный.
 */
export function enemyLeft(view) {
    const left = FLEET.slice();
    for (const ship of view.sunk || []) {
        const i = left.indexOf(ship.len);
        if (i >= 0) left.splice(i, 1);
    }
    return left;
}

/** Клетки, по которым я уже стрелял и попал, но корабль ещё не добит. */
export function woundedCells(view) {
    const dead = new Set();
    for (const ship of view.sunk || []) for (const c of shipCells(ship) || []) dead.add(c);
    const out = [];
    for (let c = 0; c < CELLS; c++) if (view.outgoing[c] === HIT && !dead.has(c)) out.push(c);
    return out;
}

// ── Ход ──────────────────────────────────────────────────────────────────────

/**
 * Сыграть ход. Меняет позицию на месте и возвращает { ok } или { ok: false, reason }.
 *
 * move — { type: 'place', ships } в расстановке и { type: 'shot', cell } в бою.
 * Ровно это уезжает по сети от окна к серверу, и ровно это придумывает бот.
 */
export function applyMove(state, seat, move) {
    if (!(seat === 0 || seat === 1)) return { ok: false, reason: 'no_seat' };
    if (state.phase === 'over') return { ok: false, reason: 'over' };

    switch (move?.type) {
        case 'place': {
            if (state.phase !== 'setup') return { ok: false, reason: 'late' };
            // Переставить флот после «Готов» нельзя: соперник уже мог начать
            // стрелять, и подвинутый из-под выстрела корабль — это и есть
            // жульничество, ради защиты от которого партию ведёт сервер.
            if (state.ready[seat]) return { ok: false, reason: 'already' };
            const ships = normalizeFleet(move.ships);
            const bad = fleetError(ships);
            if (bad) return { ok: false, reason: bad };
            state.fleets[seat] = ships;
            state.ready[seat] = true;
            if (state.ready[0] && state.ready[1]) {
                state.phase = 'play';
                state.turn = state.first;
            }
            return { ok: true };
        }

        case 'shot': {
            if (state.phase !== 'play') return { ok: false, reason: 'not_play' };
            if (state.turn !== seat) return { ok: false, reason: 'not_your_turn' };
            const cell = move.cell | 0;
            if (!(cell >= 0 && cell < CELLS)) return { ok: false, reason: 'bounds' };
            // По одной клетке дважды не стреляют. Это не придирка: свободных
            // клеток конечное число, и без проверки партия могла бы не кончиться
            // вовсе.
            if (state.shots[seat][cell] !== NONE) return { ok: false, reason: 'spent' };
            return fire(state, seat, cell);
        }

        default:
            return { ok: false, reason: 'unknown' };
    }
}

/**
 * Выстрел.
 *
 * ПОПАЛ — СТРЕЛЯЙ ЕЩЁ: ход остаётся у стрелявшего. Без этого правила партия
 * превращается в размен промахами и тянется вдвое дольше, а найденный корабль
 * приходится добивать через ход — по одной клетке за раз.
 */
function fire(state, seat, cell) {
    const foe = 1 - seat;
    const shots = state.shots[seat];
    const ship = (state.fleets[foe] || []).find(s => (shipCells(s) || []).includes(cell));

    if (!ship) {
        shots[cell] = MISS;
        state.turn = foe;
        state.last = { seat, cell, hit: false, sunk: false };
        return { ok: true, hit: false, sunk: false };
    }

    shots[cell] = HIT;
    const sunk = isSunk(ship, shots);
    if (sunk) {
        // Вода вокруг потопленного отмечается САМА. По правилам корабли не
        // касаются, значит, там пусто — и заставлять человека расстреливать
        // заведомо пустые клетки значит удлинять партию ничем.
        for (const c of contour(ship)) if (shots[c] === NONE) shots[c] = MISS;
    }
    state.last = { seat, cell, hit: true, sunk };

    if ((state.fleets[foe] || []).every(s => isSunk(s, shots))) {
        state.phase = 'over';
        state.winner = seat;
        state.reason = 'fleet';
    }
    return { ok: true, hit: true, sunk };
}

/**
 * Сдаться. Единственный способ закончить партию, не доигрывая, — иначе
 * проигрывающему выгодно просто закрыть вкладку.
 */
export function resign(state, seat) {
    if (state.phase === 'over') return { ok: false, reason: 'over' };
    state.phase = 'over';
    state.winner = 1 - seat;
    state.reason = 'resign';
    return { ok: true };
}

/** Партию бросили — победа достаётся тому, кто ждал. */
export function timeout(state, seat) {
    if (state.phase === 'over') return { ok: false, reason: 'over' };
    state.phase = 'over';
    state.winner = 1 - seat;
    state.reason = 'timeout';
    return { ok: true };
}

// ── Хранение ─────────────────────────────────────────────────────────────────
// Позиция и так простая (числа и массивы чисел), но пишем serialize/deserialize
// явно: строка в базе не должна зависеть от того, какие служебные поля мы
// когда-нибудь заведём в объекте партии.

export function serialize(state) {
    return {
        phase: state.phase,
        first: state.first,
        turn: state.turn,
        fleets: state.fleets.map(f => (f ? f.map(cloneShip) : null)),
        ready: state.ready.slice(),
        shots: state.shots.map(s => s.slice()),
        last: state.last ? { ...state.last } : null,
        winner: state.winner,
        reason: state.reason,
    };
}

export function deserialize(data) {
    const shots = (side) => {
        const src = data?.shots?.[side] || [];
        const out = new Array(CELLS).fill(NONE);
        for (let c = 0; c < CELLS; c++) {
            const v = src[c] | 0;
            out[c] = v === HIT ? HIT : v === MISS ? MISS : NONE;
        }
        return out;
    };
    const fleet = (side) => {
        const src = data?.fleets?.[side];
        return Array.isArray(src) ? src.map(s => shipAt(s?.x, s?.y, s?.len, s?.dir)) : null;
    };
    const phase = data?.phase === 'play' ? 'play' : data?.phase === 'over' ? 'over' : 'setup';
    return {
        phase,
        first: data?.first ? 1 : 0,
        turn: phase === 'play' ? (data?.turn ? 1 : 0) : -1,
        fleets: [fleet(0), fleet(1)],
        ready: [!!data?.ready?.[0], !!data?.ready?.[1]],
        shots: [shots(0), shots(1)],
        last: data?.last
            ? {
                seat: data.last.seat ? 1 : 0,
                cell: Math.max(0, Math.min(CELLS - 1, data.last.cell | 0)),
                hit: !!data.last.hit,
                sunk: !!data.last.sunk,
            }
            : null,
        winner: data?.winner == null ? null : (data.winner ? 1 : 0),
        reason: data?.reason || '',
    };
}

/** Копия партии — боту и тестам, чтобы проверять ходы, не трогая настоящую. */
export function cloneGame(state) {
    return deserialize(serialize(state));
}

// ── Человеческие подписи ─────────────────────────────────────────────────────
// Держим здесь, а не в окне: те же слова показывает и итог партии на сервере.

export const END_TEXT = {
    fleet: 'флот потоплен',
    resign: 'сдался',
    timeout: 'не дождались хода',
};

export const SHIP_NAMES = {
    4: 'линкор',
    3: 'крейсер',
    2: 'эсминец',
    1: 'катер',
};
