// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Тройка»: правила матч-3 одним файлом.
//
// Здесь ВСЁ, что знает про игру и фронт, и бэкенд: поле, обмен клеток, поиск
// троек, каскады, специальные фигуры и очки. Окно игры
// (frontend/src/troika.js) только рисует поле и слушает клики, а сервер
// (backend/src/routes/troika.js) берёт отсюда проверку правдоподобности
// результата — иначе «сколько очков бывает» пришлось бы держать в двух местах,
// и они разъехались бы на первой же правке таблицы очков.
//
// ПАРТИЯ СЧИТАЕТСЯ В БРАУЗЕРЕ, как в тетрисе (см. шапку shared/tetris.js), и по
// той же причине: партия идёт на время, каскад надо показать сразу же, а не
// через сеть. На сервер уходит ОДИН запрос в конце партии, и он проверяет
// результат на правдоподобность (isPlausibleRun). Это защита от мусора и
// «999999 за минуту», а не от человека с открытой консолью — мини-топ пасхалки
// такой цены и стоит.
//
// ЧТО СЧИТАЕТСЯ СОБРАННЫМ: связная область фишек одного вида, внутри которой
// есть линия из трёх или квадрат 2×2. Область убирается целиком — вместе с
// одиночками, прилипшими к ней по краям (см. findGroups). Награду при этом
// считает форма, а не число фишек: прилипшие дают очки, но не превращают тройку
// в четвёрку.
//
// РЕЖИМ: бесконечный, ограниченный временем. Таймер идёт вниз, часы на поле
// добавляют секунды — то есть партия продолжается ровно столько, сколько игрок
// успевает её «докупать». Отсюда и весь скилл: сама тройка почти ничего не
// стоит, зато каскад умножает очки, а собранные по пути часы дают время на
// следующий каскад. Сложность растёт уровнем: чем больше очков, тем реже
// сыпятся часы (clockChance), и любая партия рано или поздно кончается — иначе
// «бесконечный режим» означал бы «сиди пока не надоест», а мини-топ сравнивал
// бы терпение, а не игру.
//
// Состояние партии — обычный объект с мутацией: ходов за партию сотни, каскад
// перебирает поле по нескольку раз за ход, и плодить копии поля незачем. Поле
// хранится ДВУМЯ плоскими массивами (цвет и специальная фигура), а не массивом
// объектов: обращений к нему тысячи за партию.
// ─────────────────────────────────────────────────────────────────────────────

export const SIZE = 8;
export const CELLS = SIZE * SIZE;

// Виды фишек. Имя — это и класс в CSS, и ФОРМА нарисованной фишки: кольцо,
// квадрат, треугольник, шестиугольник, звезда, капля (картинки — спрайт
// frontend/src/assets/troika-tiles.webp, порядок строк в нём тот же, что здесь).
// Форма у каждого вида своя намеренно: играть в матч-3, где фишки различаются
// только цветом, с нарушением цветовосприятия нельзя вовсе.
export const KINDS = ['ring', 'square', 'triangle', 'hex', 'star', 'drop'];
export const KIND_COUNT = KINDS.length;

// Специальные фигуры. Лежат ОТДЕЛЬНЫМ полем на той же клетке, а не заменяют
// цвет: специальная фишка остаётся фишкой своего вида и собирается в тройки как
// любая другая. Так не нужно ни особого правила обмена, ни «а как её убрать».
export const NONE = 0;
export const ROCKET_H = 1;   // сносит свою СТРОКУ (даётся за четвёрку по горизонтали)
export const ROCKET_V = 2;   // сносит свой СТОЛБЕЦ (за четвёрку по вертикали)
export const BOMB = 3;       // сносит 5×5 без углов (за угол — тройка + тройка крестом)
export const PRISM = 4;      // сносит все фишки своего вида (за пятёрку в линию)
export const CLOCK = 5;      // не взрывается, а добавляет время, когда её убрали

// Классы для CSS — чтобы окно игры не держало свою копию этого соответствия.
// Порядок констант выше — это ещё и порядок СТОЛБЦОВ в спрайте фишек, так что
// менять их значения нельзя, не пересобрав картинку. Обычная фишка тоже
// названа: на поле она такой же столбец спрайта, как остальные.
export const SPECIAL_CLASS = {
    [NONE]: 'plain',
    [ROCKET_H]: 'rocket-h',
    [ROCKET_V]: 'rocket-v',
    [BOMB]: 'bomb',
    [PRISM]: 'prism',
    [CLOCK]: 'clock',
};

// ── Время ────────────────────────────────────────────────────────────────────

export const START_MS = 60_000;
// Потолок «банка»: больше этого времени не накопить, сколько часов ни собери.
// Без потолка удачный каскад в начале превращал бы партию в получасовую, а
// мини-топ — в таблицу «кому повезло на старте».
export const MAX_MS = 99_000;
export const CLOCK_MS = 3_000;
// Последние секунды окно подсвечивает — отсюда, а не своим числом: «мало
// времени» это правило игры, а не оформление.
export const LOW_TIME_MS = 10_000;

// ── Очки ─────────────────────────────────────────────────────────────────────

export const TILE_POINTS = 10;
export const CLOCK_POINTS = 25;
// Множитель каскада: первый шаг ×1, второй ×2 и так далее до потолка. Это
// главный источник очков и вся причина думать над ходом: тройка ради тройки даёт
// 30 очков, а тройка, обвалившая полполя, — несколько тысяч.
export const MAX_CASCADE_MULT = 8;
export const CREATE_BONUS = {
    [ROCKET_H]: 60,
    [ROCKET_V]: 60,
    [BOMB]: 120,
    [PRISM]: 250,
};

// ── Сложность ────────────────────────────────────────────────────────────────

// Пороги уровня и редкость часов пересчитаны под пятно с диагоналями: оно
// убирает в среднем на четверть больше фишек, а вместе с досыпкой — и заметно
// больше часов. С прежними числами сильная игра переставала кончаться вовсе
// (двухчасовые партии в прогоне), поэтому часы стали реже, а уровень — дороже.
export const POINTS_PER_LEVEL = 6_000;
const CLOCK_CHANCE_START = 0.04;
const CLOCK_CHANCE_STEP = 0.005;
const CLOCK_CHANCE_FLOOR = 0.004;

export function levelFor(score) {
    return Math.floor(Math.max(score, 0) / POINTS_PER_LEVEL) + 1;
}

/**
 * Шанс, что новая фишка окажется часами. Падает с уровнем — это и есть ход
 * сложности: время дорожает, и партия кончается тем позже, чем лучше играешь.
 */
export function clockChance(level) {
    return Math.max(CLOCK_CHANCE_FLOOR, CLOCK_CHANCE_START - (level - 1) * CLOCK_CHANCE_STEP);
}

// Бомба: квадрат 5×5 без четырёх углов. Ромб был бы слабее ракеты (а бомба
// даётся за более сложную фигуру), полный квадрат — сильнее призмы; «без углов»
// попадает между ними и хорошо читается на поле.
const BOMB_R = 2;

// ── Служебное ────────────────────────────────────────────────────────────────

export const xOf = i => i % SIZE;
export const yOf = i => (i - (i % SIZE)) / SIZE;
export const idx = (x, y) => y * SIZE + x;

/** Соседи по стороне (по диагонали фишки не меняются — это не шашки). */
export function areNeighbours(a, b) {
    if (a === b || a < 0 || b < 0 || a >= CELLS || b >= CELLS) return false;
    const d = Math.abs(a - b);
    if (d === SIZE) return true;
    return d === 1 && yOf(a) === yOf(b);
}

function activatable(special) {
    return special >= ROCKET_H && special <= PRISM;
}

// Генератор с зерном (mulberry32) — как в тетрисе: нужен не ради «честности», а
// ради тестов, в которых партию надо повторить ход в ход.
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

// ── Партия ───────────────────────────────────────────────────────────────────

/**
 * Новая партия. seed — зерно случайности (по умолчанию своё на каждую партию).
 *
 * color: вид фишки 0..5, −1 — пусто (клетка убрана и ещё не заполнена).
 * special: одна из констант выше.
 */
export function createGame({ seed } = {}) {
    const game = {
        color: new Int8Array(CELLS),
        special: new Uint8Array(CELLS),
        rng: makeRng(seed == null ? (Math.random() * 0xffffffff) >>> 0 : seed),
        score: 0,
        level: 1,
        moves: 0,          // сделанных обменов — серверу для проверки
        tiles: 0,          // убранных фишек всего
        clocks: 0,         // собранных часов
        bestCascade: 0,    // самая длинная цепочка за партию — в итог партии
        shuffles: 0,       // сколько раз поле пришлось перемешать
        timeMs: START_MS,
        elapsedMs: 0,      // сколько партия реально шла (пауза не считается)
        over: false,
        // Номер шага текущего каскада: 0 — поле спокойно и ход принимается.
        cascade: 0,
        // Клетки, ждущие взрыва без тройки (обмен двух специальных).
        pending: null,
        lastSwap: null,    // где был последний обмен — там и появится специальная
    };
    fillFresh(game);
    return game;
}

function randColor(game) {
    return Math.floor(game.rng() * KIND_COUNT);
}

/**
 * Разложить поле заново: без готовых троек и с гарантией, что ход есть.
 *
 * Цвет клетки выбирается из перемешанного списка видов — первый, который не даёт
 * тройку с уже разложенными слева и сверху. Запрещённых видов не больше двух,
 * так что подходящий находится всегда, и «пока не подойдёт» тут не нужно.
 */
function fillFresh(game) {
    for (let attempt = 0; attempt < 50; attempt++) {
        game.color.fill(-1);
        game.special.fill(NONE);
        for (let i = 0; i < CELLS; i++) {
            const order = shuffledKinds(game);
            game.color[i] = order[0];
            for (const kind of order) {
                game.color[i] = kind;
                if (!hasMatchAt(game, i)) break;
            }
        }
        // Часы раскладываем ПОСЛЕ цветов: на тройки они не влияют, зато поле не
        // начинается пустым на «штучки» — иначе первые полминуты партия выглядит
        // обычным матч-3 без времени.
        const chance = clockChance(1);
        for (let i = 0; i < CELLS; i++) {
            if (game.rng() < chance) game.special[i] = CLOCK;
        }
        if (hasMove(game)) return;
    }
}

function shuffledKinds(game) {
    const order = [];
    for (let i = 0; i < KIND_COUNT; i++) order.push(i);
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(game.rng() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
}

// ── Поиск троек ──────────────────────────────────────────────────────────────

/**
 * Собралось ли что-нибудь на клетке i: линия из трёх или квадрат 2×2.
 *
 * Считает длину линии в обе стороны от клетки и проверяет четыре квадрата, в
 * которые клетка может входить, — это дешевле, чем искать все фигуры на поле, а
 * именно этот вопрос задаётся чаще всего: на каждую проверку «можно ли так
 * обменять», то есть по сотне раз за ход.
 */
export function hasMatchAt(game, i) {
    const c = game.color[i];
    if (c < 0) return false;
    const x = xOf(i);
    const y = yOf(i);

    let n = 1;
    for (let k = x - 1; k >= 0 && game.color[idx(k, y)] === c; k--) n++;
    for (let k = x + 1; k < SIZE && game.color[idx(k, y)] === c; k++) n++;
    if (n >= 3) return true;

    n = 1;
    for (let k = y - 1; k >= 0 && game.color[idx(x, k)] === c; k--) n++;
    for (let k = y + 1; k < SIZE && game.color[idx(x, k)] === c; k++) n++;
    if (n >= 3) return true;

    // Квадрат: клетка может быть любым из его четырёх углов.
    for (let dy = -1; dy <= 0; dy++) {
        for (let dx = -1; dx <= 0; dx++) {
            if (isSquare(game, x + dx, y + dy, c)) return true;
        }
    }
    return false;
}

/** Квадрат 2×2 одного вида с левым верхним углом в (x, y). */
function isSquare(game, x, y, c) {
    if (c < 0 || x < 0 || y < 0 || x + 1 >= SIZE || y + 1 >= SIZE) return false;
    return game.color[idx(x, y)] === c && game.color[idx(x + 1, y)] === c
        && game.color[idx(x, y + 1)] === c && game.color[idx(x + 1, y + 1)] === c;
}

/** Все прогоны (линии одного вида длиной 3+) на поле. */
function scanRuns(game) {
    const runs = [];
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE;) {
            const c = game.color[idx(x, y)];
            let n = 1;
            while (x + n < SIZE && game.color[idx(x + n, y)] === c) n++;
            if (c >= 0 && n >= 3) {
                const cells = [];
                for (let k = 0; k < n; k++) cells.push(idx(x + k, y));
                runs.push({ horiz: true, len: n, cells });
            }
            x += n;
        }
    }
    for (let x = 0; x < SIZE; x++) {
        for (let y = 0; y < SIZE;) {
            const c = game.color[idx(x, y)];
            let n = 1;
            while (y + n < SIZE && game.color[idx(x, y + n)] === c) n++;
            if (c >= 0 && n >= 3) {
                const cells = [];
                for (let k = 0; k < n; k++) cells.push(idx(x, y + k));
                runs.push({ horiz: false, len: n, cells });
            }
            y += n;
        }
    }
    return runs;
}

/** Все квадраты 2×2 одного вида на поле. */
function scanSquares(game) {
    const squares = [];
    for (let y = 0; y + 1 < SIZE; y++) {
        for (let x = 0; x + 1 < SIZE; x++) {
            const c = game.color[idx(x, y)];
            if (!isSquare(game, x, y, c)) continue;
            squares.push({ cells: [idx(x, y), idx(x + 1, y), idx(x, y + 1), idx(x + 1, y + 1)] });
        }
    }
    return squares;
}

/**
 * Что собралось на поле — списком ГРУПП.
 *
 * Группа — это СВЯЗНАЯ ОБЛАСТЬ фишек одного вида, внутри которой есть хоть одна
 * фигура: линия из трёх или квадрат 2×2. Убирается вся область целиком, вместе с
 * «прилипшими» по краям одиночками, — потому что игрок видит на поле пятно
 * одного вида, а не «вот эти три в счёт, а эта, четвёртая, сбоку — нет».
 *
 * Связность — ПО ВОСЬМИ СОСЕДЯМ, вместе с диагональю. Глаз считает пятном всё,
 * что соприкасается, и на фишке, приклеенной углом, останавливаться не умеет:
 * убирали пять, исчезало три, и это выглядело поломкой. Правило «что касается
 * пятна, то и убирается» — единственное, у которого не остаётся видимого края:
 * любое частичное (только по сторонам, или по сторонам плюс один слой углов)
 * оставляет на поле фишку того же вида впритык к дырке.
 *
 * Стоит это недёшево, и это стоит знать: пятно растёт в среднем с 4.2 до 5.3
 * фишек, цепочки удлиняются вдвое, и партия перестала бы кончаться вовсе, если
 * бы не пересчитанная под это редкость часов (см. CLOCK_CHANCE_*). Разрыв между
 * случайной и внимательной игрой при этом сузился: раньше сильный игрок набирал
 * в шесть с половиной раз больше случайного, теперь — вчетверо.
 *
 * ФИГУРУ при этом по-прежнему ищем по прямым линиям и квадратам: она решает,
 * какая будет награда, а «линия по диагонали» — это не линия.
 *
 * Из этого же следует, что пять фишек углом — ОДНА фигура (за неё даётся одна
 * бомба, а не две награды за две тройки): область-то связная. Раньше для этого
 * приходилось склеивать пересекающиеся прогоны руками.
 */
export function findGroups(game) {
    const runs = scanRuns(game);
    const squares = scanSquares(game);
    if (!runs.length && !squares.length) return [];

    // Клетки, с которых начинается разрастание: всё, что вошло хоть в одну
    // фигуру. Без них областью считалось бы любое пятно одного вида, включая
    // случайную пару соседей.
    const seeds = [];
    for (const r of runs) seeds.push(r.cells[0]);
    for (const q of squares) seeds.push(q.cells[0]);

    const groupOf = new Int8Array(CELLS).fill(-1);
    const groups = [];
    for (const seed of seeds) {
        if (groupOf[seed] >= 0) continue;          // уже в разросшейся области
        const color = game.color[seed];
        const gi = groups.length;
        const cells = new Set([seed]);
        const queue = [seed];
        groupOf[seed] = gi;
        for (let head = 0; head < queue.length; head++) {
            const i = queue[head];
            const x = xOf(i);
            const y = yOf(i);
            // Все восемь соседей, включая диагональ (см. шапку функции).
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (!dx && !dy) continue;
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
                    const j = idx(nx, ny);
                    if (groupOf[j] >= 0 || game.color[j] !== color) continue;
                    groupOf[j] = gi;
                    cells.add(j);
                    queue.push(j);
                }
            }
        }
        groups.push({ cells, runs: [], squares: [] });
    }

    // Раскидываем фигуры по областям: по ним считается награда за группу.
    for (const r of runs) groups[groupOf[r.cells[0]]].runs.push(r);
    for (const q of squares) groups[groupOf[q.cells[0]]].squares.push(q);
    return groups;
}

/**
 * Что даётся за группу и куда это положить.
 *
 * Награда считается по ФОРМЕ, а не по числу убранных фишек: «прилипшие» по краям
 * одиночки дают очки, но не превращают тройку в четвёрку — иначе достаточно было
 * бы копить пятна одного вида, и специальные сыпались бы сами.
 *
 * Специальная фигура появляется в клетке, которую игрок ТРОНУЛ, — иначе она
 * возникает где-то в середине фигуры, и понять, за что её дали, нельзя.
 */
function rewardFor(game, group) {
    const hasH = group.runs.some(r => r.horiz);
    const hasV = group.runs.some(r => !r.horiz);
    const longest = group.runs.length
        ? group.runs.reduce((a, b) => (b.len > a.len ? b : a))
        : null;

    let special = NONE;
    if (hasH && hasV) special = BOMB;
    else if (longest && longest.len >= 5) special = PRISM;
    else if (longest && longest.len === 4) special = longest.horiz ? ROCKET_H : ROCKET_V;
    // Квадрат 2×2 — это те же четыре фишки, что и четвёрка в линию, поэтому и
    // награда та же. Направление ракеты берём у ХОДА: двигал по горизонтали —
    // полетит по строке. У квадрата своего направления нет, а «случайно куда»
    // игрок прочесть не может.
    else if (group.squares.length) special = swapWasVertical(game) ? ROCKET_V : ROCKET_H;
    if (special === NONE) return null;

    const touched = (game.lastSwap || []).find(i => group.cells.has(i));
    const fallback = longest
        ? longest.cells[Math.floor(longest.len / 2)]
        : group.squares[0].cells[0];
    const cell = touched != null ? touched : fallback;
    return { cell, special, color: game.color[cell] };
}

function swapWasVertical(game) {
    const swap = game.lastSwap;
    return !!swap && Math.abs(swap[0] - swap[1]) === SIZE;
}

// ── Обмен ────────────────────────────────────────────────────────────────────

function swapCells(game, a, b) {
    const c = game.color[a]; game.color[a] = game.color[b]; game.color[b] = c;
    const s = game.special[a]; game.special[a] = game.special[b]; game.special[b] = s;
}

function makesMatch(game, a, b) {
    swapCells(game, a, b);
    const ok = hasMatchAt(game, a) || hasMatchAt(game, b);
    swapCells(game, a, b);
    return ok;
}

/**
 * Чем обмен этих двух клеток законен: 'match' — собирается тройка,
 * 'special' — тройки нет, но обмен всё равно разрешён. null — нельзя.
 *
 * Второй случай — те самые «штучки», ради которых специальные и собирают:
 *   • призму можно обменять с ЛЮБОЙ соседней фишкой — она сработает, и это
 *     единственный способ подорвать её тогда, когда это выгодно;
 *   • две любые специальные рядом срабатывают обе — ракета плюс бомба уносит
 *     полполя, и такой ход стоит готовить.
 * Часы к этому не относятся: они не взрываются, и обменивать их «просто так»
 * значило бы дарить время без тройки.
 */
export function swapKind(game, a, b) {
    if (!areNeighbours(a, b)) return null;
    if (game.color[a] < 0 || game.color[b] < 0) return null;
    // Тройку проверяем ПЕРВОЙ: если обмен специальных ещё и собирает линию, это
    // обычный ход — специальные всё равно сработают, попав в свою же тройку, но
    // сверху дадут и награду за фигуру.
    if (makesMatch(game, a, b)) return 'match';
    if (game.special[a] === PRISM || game.special[b] === PRISM) return 'special';
    if (activatable(game.special[a]) && activatable(game.special[b])) return 'special';
    return null;
}

export function canSwap(game, a, b) {
    return swapKind(game, a, b) !== null;
}

/**
 * Сделать ход. Возвращает 'match' | 'special' | null (обмен не по правилам).
 *
 * Сам обмен ничего не убирает: дальше окно крутит resolveStep, пока тот не
 * скажет «поле спокойно». Так каскад можно показывать шаг за шагом, а правила
 * при этом не знают ни про кадры, ни про задержки.
 */
export function applySwap(game, a, b) {
    if (game.over || game.cascade > 0) return null;   // предыдущий каскад ещё идёт
    const kind = swapKind(game, a, b);
    if (!kind) return null;
    swapCells(game, a, b);
    game.moves++;
    game.lastSwap = [a, b];
    // Тройки нет — значит убирать нечего, кроме самих обменянных клеток: с них
    // и начнётся цепочка взрывов.
    game.pending = kind === 'special' ? [a, b] : null;
    return kind;
}

// ── Цепочка взрывов ──────────────────────────────────────────────────────────

/**
 * Разрастить список убираемых клеток: каждая специальная в нём срабатывает и
 * добавляет свои, те тоже могут оказаться специальными, и так до конца.
 *
 * Обход в ширину с пометкой «уже убрана» — цепочка из ракет и бомб иначе
 * зацикливалась бы, снося друг друга по кругу.
 */
function expand(game, seeds) {
    const clear = new Set();
    const queue = [];
    const push = (i) => {
        if (i < 0 || i >= CELLS) return;
        if (game.color[i] < 0 || clear.has(i)) return;
        clear.add(i);
        queue.push(i);
    };
    for (const i of seeds) push(i);

    const fired = [];    // сработавшие специальные — окну для анимации
    for (let head = 0; head < queue.length; head++) {
        const i = queue[head];
        const sp = game.special[i];
        if (!activatable(sp)) continue;
        fired.push({ cell: i, special: sp });
        if (sp === ROCKET_H) {
            const y = yOf(i);
            for (let x = 0; x < SIZE; x++) push(idx(x, y));
        } else if (sp === ROCKET_V) {
            const x = xOf(i);
            for (let y = 0; y < SIZE; y++) push(idx(x, y));
        } else if (sp === BOMB) {
            const cx = xOf(i);
            const cy = yOf(i);
            for (let dy = -BOMB_R; dy <= BOMB_R; dy++) {
                for (let dx = -BOMB_R; dx <= BOMB_R; dx++) {
                    if (Math.abs(dx) === BOMB_R && Math.abs(dy) === BOMB_R) continue;  // углы
                    const x = cx + dx;
                    const y = cy + dy;
                    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) continue;
                    push(idx(x, y));
                }
            }
        } else if (sp === PRISM) {
            const c = game.color[i];
            for (let j = 0; j < CELLS; j++) if (game.color[j] === c) push(j);
        }
    }
    return { clear, fired };
}

/**
 * Один шаг каскада: убрать всё, что сложилось, начислить очки, обвалить поле и
 * досыпать новые фишки. Возвращает описание шага — или null, когда поле
 * спокойно (и тогда каскад считается законченным).
 *
 * Шаг возвращает ровно то, что окну нужно нарисовать: какие клетки исчезли, что
 * сработало, что появилось, сколько дали очков и времени. Само окно правил не
 * знает и пересчитывать за ними ничего не должно.
 */
export function resolveStep(game) {
    let groups = [];
    let seeds;
    if (game.pending) {
        seeds = game.pending.filter(i => game.color[i] >= 0);
        game.pending = null;
    } else {
        groups = findGroups(game);
        seeds = [];
        for (const g of groups) for (const i of g.cells) seeds.push(i);
    }
    if (!seeds.length) {
        game.cascade = 0;
        return null;
    }

    game.cascade++;
    const mult = Math.min(game.cascade, MAX_CASCADE_MULT);

    // Награды считаем ДО уборки: после неё групп уже нет, а знать, что за фигуру
    // собрали, надо именно по ним.
    const created = [];
    for (const g of groups) {
        const reward = rewardFor(game, g);
        if (reward) created.push(reward);
    }

    const { clear, fired } = expand(game, seeds);

    let clocks = 0;
    for (const i of clear) {
        if (game.special[i] === CLOCK) clocks++;
        game.color[i] = -1;
        game.special[i] = NONE;
    }
    const tiles = clear.size;

    // Награда возвращается на поле в ту же клетку, которую только что убрали:
    // фигура исчезла, а на её месте осталась специальная фишка.
    for (const c of created) {
        game.color[c.cell] = c.color;
        game.special[c.cell] = c.special;
    }

    let gained = tiles * TILE_POINTS * mult + clocks * CLOCK_POINTS;
    for (const c of created) gained += CREATE_BONUS[c.special] || 0;
    game.score += gained;
    game.tiles += tiles;
    game.clocks += clocks;
    game.level = levelFor(game.score);
    if (game.cascade > game.bestCascade) game.bestCascade = game.cascade;

    // Время добавляется, только пока партия идёт: часы, убранные последним
    // каскадом уже после нуля на таймере, партию не продлевают — иначе конец
    // партии зависел бы от того, докрутился каскад или нет.
    let timeGained = 0;
    if (!game.over && clocks) {
        timeGained = Math.max(0, Math.min(clocks * CLOCK_MS, MAX_MS - game.timeMs));
        game.timeMs += timeGained;
    }

    const { spawned, fall, movedTo } = collapse(game);
    // Выданная за фигуру специальная могла тут же уехать вниз — если под ней
    // убрали клетки. Окну она нужна там, где ВСТАЛА: иначе «рождение» покажется
    // на её старом месте, где к этому времени лежит уже другая фишка.
    for (const c of created) {
        if (movedTo[c.cell] >= 0) c.cell = movedTo[c.cell];
    }
    return {
        cells: [...clear], created, fired, spawned, fall,
        tiles, clocks, gained, timeGained, cascade: game.cascade, mult,
    };
}

/**
 * Обвалить столбцы вниз и досыпать сверху новые фишки.
 *
 * Возвращает { spawned, fall, movedTo }: клетки, которых на поле раньше не было,
 * «на сколько строк фишка приехала вниз» для КАЖДОЙ клетки и «куда уехала» для
 * тех, что сдвинулись. Второе нужно окну, чтобы показать падение: без него оно
 * знает только, что картинка стала другой, и фишки просто подменяются на месте —
 * рывком, из которого не понять, что вообще произошло. Третье — чтобы найти
 * специальную фишку, выданную за фигуру: если под ней тоже убрали клетки, она
 * едет вниз вместе со всеми, и «родиться» должна там, где встала.
 *
 * Досыпанные считаются приехавшими из-за верхнего края: сколько клеток в столбце
 * досыпали, столько строк они и «пролетели».
 *
 * Проход по столбцу один: клетка-приёмник идёт своим шагом, клетка-источник
 * своим — как в уборке линий тетриса.
 */
function collapse(game) {
    const spawned = [];
    const fall = new Uint8Array(CELLS);
    const movedTo = new Int8Array(CELLS).fill(-1);
    const chance = clockChance(game.level);
    for (let x = 0; x < SIZE; x++) {
        let write = SIZE - 1;
        for (let y = SIZE - 1; y >= 0; y--) {
            const i = idx(x, y);
            if (game.color[i] < 0) continue;
            if (write !== y) {
                const w = idx(x, write);
                game.color[w] = game.color[i];
                game.special[w] = game.special[i];
                game.color[i] = -1;
                game.special[i] = NONE;
                fall[w] = write - y;
                movedTo[i] = w;
            }
            write--;
        }
        const fresh = write + 1;          // столько клеток сверху досыпаем
        for (; write >= 0; write--) {
            const w = idx(x, write);
            game.color[w] = randColor(game);
            game.special[w] = game.rng() < chance ? CLOCK : NONE;
            fall[w] = fresh;
            spawned.push(w);
        }
    }
    return { spawned, fall, movedTo };
}

// ── Тупик ────────────────────────────────────────────────────────────────────

/**
 * Первый разрешённый обмен на поле — или null, если ходов не осталось.
 *
 * Нужен дважды: проверить, не тупик ли (hasMove), и показать подсказку тому, кто
 * ищет ход уже несколько секунд. Обход идёт слева направо сверху вниз, то есть
 * ответ ОДИН И ТОТ ЖЕ на одном и том же поле: подсказка не должна прыгать
 * с фишки на фишку, пока игрок на неё смотрит.
 */
export function findMove(game) {
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const i = idx(x, y);
            if (x + 1 < SIZE && canSwap(game, i, i + 1)) return [i, i + 1];
            if (y + 1 < SIZE && canSwap(game, i, i + SIZE)) return [i, i + SIZE];
        }
    }
    return null;
}

/** Есть ли хоть один разрешённый обмен. */
export function hasMove(game) {
    return findMove(game) !== null;
}

/**
 * Перемешать поле, не меняя набор фишек: ходов не осталось, но партия идёт на
 * время — «ходов нет, вы проиграли» здесь было бы наказанием за случайность.
 *
 * Специальные переезжают вместе со своими фишками: отобрать у игрока
 * заготовленную бомбу из-за тупика — то же самое наказание, только незаметное.
 */
export function shuffle(game) {
    const colors = [...game.color];
    const specials = [...game.special];
    for (let attempt = 0; attempt < 100; attempt++) {
        for (let i = CELLS - 1; i > 0; i--) {
            const j = Math.floor(game.rng() * (i + 1));
            [colors[i], colors[j]] = [colors[j], colors[i]];
            [specials[i], specials[j]] = [specials[j], specials[i]];
        }
        game.color.set(colors);
        game.special.set(specials);
        // Готовых троек после перемешивания быть не должно: они сработали бы
        // сами и выглядели бы как очки из воздуха.
        if (!findGroups(game).length && hasMove(game)) {
            game.shuffles++;
            return true;
        }
    }
    // Не сошлось (бывает, когда фишек одного вида осталось слишком мало) —
    // раскладываем поле заново. Специальные при этом теряются, зато партия
    // продолжается.
    fillFresh(game);
    game.shuffles++;
    return true;
}

// ── Ход времени ──────────────────────────────────────────────────────────────

/**
 * Прокрутить таймер на dtMs. Возвращает true, если партия только что кончилась.
 *
 * Пауза — это просто не вызывать tickTime: время партии (elapsedMs) считается
 * здесь же, поэтому «отошёл от компьютера» в результат не попадает.
 */
export function tickTime(game, dtMs) {
    if (game.over || dtMs <= 0) return false;
    game.elapsedMs += dtMs;
    game.timeMs -= dtMs;
    if (game.timeMs > 0) return false;
    game.timeMs = 0;
    game.over = true;
    return true;
}

// ── Проверка результата на сервере ───────────────────────────────────────────

// Самый быстрый игрок делает ход примерно за 400 мс (найти, ткнуть, дождаться
// обвала); 120 — заведомо ниже любого живого темпа, но отсекает «тысяча ходов за
// секунду».
const MIN_MS_PER_MOVE = 120;
// Сколько фишек может унести ОДИН ход в самом щедром случае: цепочка призм и
// бомб убирает поле по нескольку раз, пока сыплются новые. Прогон двухсот партий
// «жадным» игроком, который каждый раз выбирает самый жирный ход, дал максимум
// 153 фишки за ход — граница вчетверо выше, потому что она отсекает бессмыслицу
// («миллион фишек за два хода»), а не считает, сколько бывает на самом деле.
const MAX_TILES_PER_MOVE = 400;
// Партия длится ровно столько, сколько ей отсыпали часы (плюс округление и
// последний кадр).
const TIME_SLACK_MS = 5_000;

/**
 * Верхняя граница счёта для партии из tiles фишек и moves ходов.
 *
 * Считаем по самому щедрому сценарию: каждая фишка убрана на предельном
 * множителе каскада и каждая была часами, а каждый ход дал призму. Настоящая
 * игра до этой границы не доходит никогда — она и не должна: это проверка на
 * бессмыслицу, а не подсчёт «сколько можно было выжать».
 */
export function maxPlausibleScore(tiles, moves) {
    return Math.max(tiles, 0) * (TILE_POINTS * MAX_CASCADE_MULT + CLOCK_POINTS)
        + Math.max(moves, 0) * CREATE_BONUS[PRISM];
}

/**
 * Похож ли присланный результат на настоящую партию.
 *
 * Отсекает мусор и опечатки, а не человека с открытой консолью: партия целиком
 * считается в браузере (см. шапку файла). Возвращает { ok: true } или
 * { ok: false, reason } — reason нужен логу сервера, игроку он не показывается.
 *
 * Главная проверка здесь своя, тетрису такой не досталось: длина партии
 * ОДНОЗНАЧНО ограничена собранными часами. Минута на старте плюс три секунды за
 * часы — больше партия идти не может, сколько бы очков ни присылали.
 */
export function isPlausibleRun({ score, tiles, moves, clocks, seconds }) {
    const s = Number(score);
    const t = Number(tiles);
    const m = Number(moves);
    const c = Number(clocks);
    const sec = Number(seconds);
    const all = [s, t, m, c, sec];

    if (!all.every(v => Number.isFinite(v) && v >= 0)) return { ok: false, reason: 'shape' };
    if (!all.every(Number.isInteger)) return { ok: false, reason: 'shape' };
    if (m > 100_000) return { ok: false, reason: 'too_many_moves' };
    if (c > t) return { ok: false, reason: 'clocks_vs_tiles' };
    if (t > m * MAX_TILES_PER_MOVE) return { ok: false, reason: 'tiles_vs_moves' };
    if (sec * 1000 > START_MS + c * CLOCK_MS + TIME_SLACK_MS) return { ok: false, reason: 'too_long' };
    if (sec * 1000 < m * MIN_MS_PER_MOVE) return { ok: false, reason: 'too_fast' };
    if (s > maxPlausibleScore(t, m)) return { ok: false, reason: 'score_too_high' };
    return { ok: true };
}
