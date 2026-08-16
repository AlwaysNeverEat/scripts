// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Бильярд» (американка, восьмёрка): физика и правила одним файлом.
//
// Здесь ВСЁ, что знает про игру и фронт, и бэкенд: стол, шары, столкновения,
// лузы, правила восьмёрки и разбор последствий удара. Окно игры
// (frontend/src/pool.js) только рисует и слушает мышь, бот
// (shared/poolBot.js) перебирает удары ЭТИМ ЖЕ движком, а сервер
// (backend/src/routes/pool.js) применяет удар своей копией правил и хранит
// получившуюся позицию.
//
// СЕРВЕР ЗДЕСЬ — АРБИТР, и это главное отличие от остальных пасхалок. В тетрисе,
// тройке и пасьянсе накрутка портит только собственную строчку в топе, поэтому
// там хватает грубой проверки «бывает ли такой результат». Тут игра ПАРНАЯ:
// очко, которое я себе приписал, отнято у живого человека. Значит, позицию
// ведёт сервер, а браузер её только показывает.
//
// УДАР — ЭТО ЧЕТЫРЕ ЦЕЛЫХ ЧИСЛА (направление, сила и, если шар в руке, куда его
// поставили). Физика от них детерминированная, то есть один и тот же удар из
// одной и той же позиции даёт ОДИН И ТОТ ЖЕ результат в любом браузере и на
// сервере. Отсюда живая игра вдвоём почти бесплатно: по сети уезжает удар, а не
// координаты шестнадцати шаров, и оба клиента доигрывают его сами.
//
// ЧТО ДЕРЖИТ ДЕТЕРМИНИЗМ (ломать нельзя):
//
//  1. В ядре нет sin/cos/atan2/hypot. Стандарт языка НЕ фиксирует их результат
//     до последнего бита, и в разных движках он разный: партия, доигранная в
//     Firefox, разошлась бы с той же партией в Chrome. Направление приходит
//     готовым вектором (клиент считает его хоть через atan2 — это ВХОД, а не
//     часть расчёта), а нормируется он делением на Math.sqrt: сложение,
//     умножение, деление и корень стандартом заданы точно.
//  2. Вход целочисленный (см. DIR_SCALE, POWER_MAX, POS_SCALE). Так удар
//     переживает поездку в JSON и обратно из базы без единого младшего бита
//     разницы.
//  3. Шаг подстройки считается из состояния (см. substeps), а пары шаров
//     перебираются строго по возрастанию номеров. Порядок обработки на разбое,
//     где столкновений в одном шаге несколько, меняет исход — значит, он обязан
//     быть одинаковым везде.
//
// ПОЧЕМУ ПОДШАГИ, А НЕ ПРОСТО «КАДР». На разбое шар летит около пяти дюймов за
// кадр — это два своих диаметра. Проверка «пересекаются ли шары сейчас»
// пропустила бы столкновение целиком: шар прошёл бы сквозь пирамиду. Поэтому
// кадр режется на подшаги так, чтобы за подшаг никто не проезжал больше
// четверти радиуса (см. substeps): при таком шаге сблизившиеся шары физически
// не могут разминуться, и отдельный поиск момента касания не нужен.
//
// ЧЕГО ЗДЕСЬ СОЗНАТЕЛЬНО НЕТ:
//
//  · Подкрутки (винта, оттяжки). Она удваивает физику — скольжение с вращением,
//    снос после удара, борт с боковым, — а казуальному игроку чаще мешает.
//  · Третьего измерения: шары не прыгают и не вылетают со стола.
//  · Заказа лузы. Любой честно упавший шар считается; исключение одно — восьмёрка
//    забивается последней.
//  · Требования «четыре шара до борта» на разбое: слишком дотошно для пасхалки.
//    Разбой, не задевший пирамиду, всё равно фол — этого хватает.
// ─────────────────────────────────────────────────────────────────────────────

// ── Стол ─────────────────────────────────────────────────────────────────────
// Дюймы СЕМИФУТОВОГО стола: игровое поле 78×39, шар 2¼ в диаметре. Единицы
// настоящие не ради точности, а ради того, чтобы прикидки («шар прокатится
// полстола») сходились с ощущением от игры.
//
// Стол именно барный, а не турнирный девятифутовый, и по двум причинам сразу.
// Во-первых, шар на нём заметно крупнее относительно сукна — на экране, где стол
// целиком помещается в окно, это разница между «видно номер» и «видно цветную
// точку». Во-вторых, партия короче: меньше стол — меньше секунд катаются шары, а
// пасхалку открывают в обеденный перерыв, а не на турнир.
export const TABLE_W = 78;
export const TABLE_H = 39;
export const BALL_R = 1.125;

// Радиус захвата лузы. Больше радиуса шара вдвое: шар, добравшийся до этого
// круга, падает — и падает РАНЬШЕ, чем борт успеет его оттолкнуть, поэтому
// отдельного «выреза в борте» рисовать не нужно.
export const POCKET_R = 2.3;

// Шесть луз: четыре угловые и две средние на длинных бортах.
export const POCKETS = [
    { x: 0,           y: 0 },
    { x: TABLE_W / 2, y: 0 },
    { x: TABLE_W,     y: 0 },
    { x: 0,           y: TABLE_H },
    { x: TABLE_W / 2, y: TABLE_H },
    { x: TABLE_W,     y: TABLE_H },
];

// Дом («кухня»): четверть стола от заднего борта, из-за неё разбивают.
export const HEAD_X = TABLE_W / 4;
// Передняя точка пирамиды — на трёх четвертях стола, как на настоящем.
export const RACK_X = TABLE_W * 0.75;

// ── Шары ─────────────────────────────────────────────────────────────────────
export const CUE = 0;
export const EIGHT = 8;
export const BALLS = 16;

export const SOLIDS = 'solids';   // 1..7
export const STRIPES = 'stripes'; // 9..15

/** Группа шара: сплошной, полосатый или ничей (биток и восьмёрка). */
export function groupOf(id) {
    if (id >= 1 && id <= 7) return SOLIDS;
    if (id >= 9 && id <= 15) return STRIPES;
    return null;
}

export const otherGroup = group => (group === SOLIDS ? STRIPES : SOLIDS);

// ── Физика ───────────────────────────────────────────────────────────────────

// Замедление от сукна, дюймы за секунду в квадрате. Подобрано по расстоянию:
// средний удар (100 дюймов/с) проезжает около трёх длин стола, как на настоящем.
// Честное сопротивление качению дало бы вдесятеро меньше, и шары катились бы
// до вечера — играть в это невозможно.
const DECEL = 18;

// Сила удара: 0 отдаём как самый мягкий накат, 1000 — разбой.
const SPEED_MIN = 30;
const SPEED_MAX = 320;

// Сколько скорости остаётся после борта и после шара. Борт ест заметно больше:
// он мягкий, и это единственное, что мешает разбою греметь по столу минуту.
const CUSHION_KEEP = 0.72;
const BALL_KEEP = 0.96;

// Ниже этой скорости шар считается остановившимся. Без порога он «ползёт»
// бесконечно: трение линейное, а скорость к нулю подходит асимптотически.
const STOP_SPEED = 1.2;

// Кадр физики — 1/60 секунды. Показ и расчёт живут в одном темпе, поэтому у
// сервера и у браузера получается буквально одна и та же партия.
export const FRAME_MS = 1000 / 60;
const FRAME_DT = 1 / 60;

// Дальше четверти радиуса за подшаг никто не уезжает — см. шапку.
const MAX_STEP_TRAVEL = BALL_R * 0.25;

// Предохранитель: удар не может длиться дольше. По трению самый сильный удар
// затухает за восемнадцать секунд, так что сюда партия не упирается никогда —
// это защита от зацикливания, а не игровое правило.
const MAX_SHOT_SECONDS = 25;

// ── Формат удара ─────────────────────────────────────────────────────────────
// Всё целое — см. пункт 2 в шапке.
export const DIR_SCALE = 10_000;   // направление: два целых, нормируются здесь
export const POWER_MAX = 1000;
export const POWER_MIN = 40;
export const POS_SCALE = 1000;     // координаты шара в руке

// ── Генератор с зерном ───────────────────────────────────────────────────────
// mulberry32, как в тетрисе, тройке и пасьянсе: нужен не ради «честности», а
// ради тестов и ради того, чтобы сервер и оба клиента разложили одну пирамиду.
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
 * Новая партия. seed — зерно пирамиды, breaker — кто разбивает (0 или 1).
 *
 * Игроки здесь просто 0 и 1: кто из них какой аккаунт, знает сервер, а правилам
 * это неинтересно.
 */
export function createGame({ seed = 1, breaker = 0 } = {}) {
    return {
        seed: seed >>> 0,
        balls: rack(seed),
        turn: breaker & 1,
        breaker: breaker & 1,
        // Группы игроков: null — стол ещё открыт, никто не «сплошной».
        groups: [null, null],
        // Шар в руке. Первый удар в партии — разбой из дома, и он тоже «в руке»:
        // биток ставят сами, просто область ограничена (см. canPlaceCue).
        ballInHand: true,
        broke: false,
        phase: 'aim',          // aim | moving | over
        winner: null,
        reason: '',
        shots: 0,
        // Что случилось за текущий удар — заполняется по ходу расчёта и
        // разбирается в resolveShot.
        ev: null,
        clock: 0,
    };
}

/** Расстановка пирамиды. */
function rack(seed) {
    const rng = makeRng(seed);
    const shuffle = list => {
        for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [list[i], list[j]] = [list[j], list[i]];
        }
        return list;
    };

    const solids = shuffle([1, 2, 3, 4, 5, 6, 7]);
    const stripes = shuffle([9, 10, 11, 12, 13, 14, 15]);

    // Пирамида по правилам: восьмёрка в середине третьего ряда, в задних углах —
    // по одному шару из каждой группы. Остальные как легли: это единственное,
    // что вообще отличает одну партию от другой до первого удара.
    const slots = new Array(15).fill(0);
    slots[4] = EIGHT;
    const backCorners = rng() < 0.5 ? [10, 14] : [14, 10];
    slots[backCorners[0]] = solids.pop();
    slots[backCorners[1]] = stripes.pop();
    const rest = shuffle([...solids, ...stripes]);
    for (let i = 0; i < slots.length; i++) if (!slots[i]) slots[i] = rest.pop();

    // Шаг между рядами — высота равностороннего треугольника со стороной в два
    // радиуса. Константа записана числом, а не через Math.sqrt(3): её значение
    // должно быть одинаковым всегда, а тут это просто размер.
    const ROW_DX = BALL_R * 2 * 0.8660254037844386;
    // Микрозазор между шарами: вплотную сложенная пирамида на первом же подшаге
    // начала бы расталкивать сама себя.
    const GAP = 1.0005;

    const balls = [makeBall(CUE, TABLE_W * 0.18, TABLE_H / 2)];
    let slot = 0;
    for (let row = 0; row < 5; row++) {
        for (let i = 0; i <= row; i++) {
            const x = RACK_X + row * ROW_DX;
            const y = TABLE_H / 2 + (i - row / 2) * BALL_R * 2 * GAP;
            balls.push(makeBall(slots[slot++], x, y));
        }
    }
    // По номерам, а не по месту в пирамиде: код, которому нужен шар 5, ищет его
    // индексом, и порядок массива не должен зависеть от раздачи.
    balls.sort((a, b) => a.id - b.id);
    return balls;
}

const makeBall = (id, x, y) => ({ id, x, y, vx: 0, vy: 0, in: false });

export const ballById = (game, id) => game.balls.find(b => b.id === id);
export const onTable = game => game.balls.filter(b => !b.in);

/** Сколько шаров группы ещё на столе. */
export function remaining(game, group) {
    let n = 0;
    for (const b of game.balls) if (!b.in && groupOf(b.id) === group) n++;
    return n;
}

/**
 * По какому шару игроку РАЗРЕШЕНО бить первым.
 *
 * Открытый стол — любой, кроме восьмёрки. Своя группа разобрана — только
 * восьмёрка. Это же и подсказка окну: по чему целиться.
 */
export function legalTargets(game, player = game.turn) {
    const group = game.groups[player];
    if (group == null) return game.balls.filter(b => !b.in && b.id !== CUE && b.id !== EIGHT).map(b => b.id);
    if (remaining(game, group) === 0) return [EIGHT];
    return game.balls.filter(b => !b.in && groupOf(b.id) === group).map(b => b.id);
}

// ── Шар в руке ───────────────────────────────────────────────────────────────

/**
 * Можно ли поставить биток сюда.
 *
 * До разбоя — только из дома: это единственное ограничение по площади, которое
 * в игре вообще есть. Всё остальное время рука свободна по всему столу — так
 * играют в баре, и объяснять коллеге «а теперь только из-за линии» ради
 * строгости незачем.
 */
export function canPlaceCue(game, x, y) {
    if (x < BALL_R || x > TABLE_W - BALL_R || y < BALL_R || y > TABLE_H - BALL_R) return false;
    if (!game.broke && x > HEAD_X) return false;
    // Впритык к чужому шару ставить нельзя: шары не могут пересекаться, а
    // «почти касается» физика на первом же подшаге растолкает сама.
    const min = (BALL_R * 2) * (BALL_R * 2);
    for (const b of game.balls) {
        if (b.in || b.id === CUE) continue;
        const dx = b.x - x;
        const dy = b.y - y;
        if (dx * dx + dy * dy < min) return false;
    }
    // В лузу биток тоже не ставят.
    for (const p of POCKETS) {
        const dx = p.x - x;
        const dy = p.y - y;
        if (dx * dx + dy * dy < POCKET_R * POCKET_R) return false;
    }
    return true;
}

// ── Удар ─────────────────────────────────────────────────────────────────────

/**
 * Начать удар. shot: { dx, dy, power, cx, cy } — целые (см. формат выше).
 * Возвращает { ok: true } или { ok: false, reason } — тем же кодом пользуется
 * сервер, отказывая клиенту.
 *
 * Проверяется ВСЁ, включая то, что клиент и так не даст сделать: сервер не имеет
 * права верить окну игры на слово.
 */
export function shoot(game, shot) {
    if (game.phase !== 'aim') return { ok: false, reason: 'not_aiming' };

    const dx = Math.trunc(Number(shot?.dx));
    const dy = Math.trunc(Number(shot?.dy));
    const power = Math.trunc(Number(shot?.power));
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(power)) {
        return { ok: false, reason: 'shape' };
    }
    if (Math.abs(dx) > DIR_SCALE || Math.abs(dy) > DIR_SCALE) return { ok: false, reason: 'shape' };
    if (power < POWER_MIN || power > POWER_MAX) return { ok: false, reason: 'power' };

    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return { ok: false, reason: 'no_direction' };

    const cue = ballById(game, CUE);

    // Постановка битка. Обязательна, если он в лузе, — иначе бить нечем.
    const placing = shot?.cx != null && shot?.cy != null;
    if (placing) {
        if (!game.ballInHand) return { ok: false, reason: 'no_ball_in_hand' };
        const x = Math.trunc(Number(shot.cx)) / POS_SCALE;
        const y = Math.trunc(Number(shot.cy)) / POS_SCALE;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, reason: 'shape' };
        if (!canPlaceCue(game, x, y)) return { ok: false, reason: 'bad_place' };
        cue.x = x;
        cue.y = y;
        cue.in = false;
    } else if (cue.in) {
        return { ok: false, reason: 'must_place' };
    }

    const len = Math.sqrt(len2);
    // Сила ползунка — это ЭНЕРГИЯ удара, а не скорость: скорость растёт как её
    // корень. Так и честнее (кий передаёт шару энергию), и, главное, играбельнее.
    // При линейной шкале половина ползунка гнала шар на восемь длин стола, и вся
    // тонкая игра — накат, выход, аккуратная подстава — жалась в первую четверть.
    // Здесь же половина силы даёт три длины стола, а нижняя треть шкалы наконец
    // различима на глаз.
    const t = power / POWER_MAX;
    const speed = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * t * t;
    cue.vx = (dx / len) * speed;
    cue.vy = (dy / len) * speed;

    game.ballInHand = false;
    game.phase = 'moving';
    game.clock = 0;
    game.ev = {
        // По каким шарам этому игроку МОЖНО бить первым. Снимок делается здесь,
        // до расчёта, и это принципиально: к моменту разбора прицельный шар уже
        // лежит в лузе, и список целей, посчитанный тогда, объявил бы фолом как
        // раз тот удар, который забил.
        targets: legalTargets(game, game.turn),
        firstHit: null,     // по какому шару биток попал первым
        potted: [],         // что упало, в порядке падения
        cueIn: false,
        railAfterHit: false, // дошёл ли хоть кто-то до борта после касания
        // Для показа: сколько раз стукнуло за кадр — окну на звук и вспышку.
        frameHits: 0,
        framePots: [],
    };
    return { ok: true };
}

/**
 * Один кадр расчёта. Возвращает { settled, hits, potted, outcome }.
 *
 * Окно вызывает его на каждый кадр отрисовки и показывает движение, сервер —
 * в цикле до остановки (см. settle). Результат в обоих случаях один и тот же:
 * шаг по времени фиксированный и от реальной частоты кадров не зависит.
 */
export function stepFrame(game) {
    if (game.phase !== 'moving') return { settled: true, hits: 0, potted: [], outcome: null };

    game.ev.frameHits = 0;
    game.ev.framePots = [];

    const n = substeps(game);
    const dt = FRAME_DT / n;
    for (let i = 0; i < n; i++) advance(game, dt);

    game.clock += FRAME_DT;
    const stopped = !game.balls.some(b => !b.in && (b.vx !== 0 || b.vy !== 0));

    if (stopped || game.clock >= MAX_SHOT_SECONDS) {
        // Предохранитель по времени сработал — гасим всё, чтобы позиция была
        // определённой, а не «шары ещё едут, но мы решили, что хватит».
        for (const b of game.balls) { b.vx = 0; b.vy = 0; }
        // События последнего кадра забираем ДО разбора: он закрывает удар и
        // обнуляет их, а окну этот кадр ещё нужно нарисовать.
        const hits = game.ev.frameHits;
        const potted = game.ev.framePots;
        const outcome = resolveShot(game);
        return { settled: true, hits, potted, outcome };
    }
    return { settled: false, hits: game.ev.frameHits, potted: game.ev.framePots, outcome: null };
}

/** Сколько подшагов нужно этому кадру, чтобы самый быстрый шар не «прыгнул». */
function substeps(game) {
    let fastest = 0;
    for (const b of game.balls) {
        if (b.in) continue;
        const v2 = b.vx * b.vx + b.vy * b.vy;
        if (v2 > fastest) fastest = v2;
    }
    if (fastest === 0) return 1;
    const travel = Math.sqrt(fastest) * FRAME_DT;
    return Math.max(1, Math.ceil(travel / MAX_STEP_TRAVEL));
}

/** Досчитать удар до остановки — для сервера и для перебора у бота. */
export function settle(game) {
    let last = null;
    // Потолок по кадрам страхует от бесконечного цикла, даже если предохранитель
    // по времени кто-то однажды сломает правкой.
    for (let i = 0; i < 60 * (MAX_SHOT_SECONDS + 1); i++) {
        const res = stepFrame(game);
        last = res.outcome;
        if (res.settled) break;
    }
    return last;
}

// ── Шаг физики ───────────────────────────────────────────────────────────────

function advance(game, dt) {
    const balls = game.balls;

    // 1. Едем и тормозим. Трение снимает скорость по модулю, направление не
    //    трогая: качение замедляется вдоль движения, и разложение по осям тут
    //    только исказило бы траекторию по диагонали.
    for (const b of balls) {
        if (b.in || (b.vx === 0 && b.vy === 0)) continue;
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        const v = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        const nv = v - DECEL * dt;
        if (nv <= STOP_SPEED) { b.vx = 0; b.vy = 0; continue; }
        const k = nv / v;
        b.vx *= k;
        b.vy *= k;
    }

    // 2. Лузы — раньше бортов: шар, докатившийся до лузы в углу, должен упасть,
    //    а не оттолкнуться от борта в паре дюймов от неё.
    for (const b of balls) {
        if (b.in) continue;
        for (const p of POCKETS) {
            const dx = b.x - p.x;
            const dy = b.y - p.y;
            if (dx * dx + dy * dy <= POCKET_R * POCKET_R) {
                b.in = true;
                b.vx = 0;
                b.vy = 0;
                if (b.id === CUE) game.ev.cueIn = true;
                else game.ev.potted.push(b.id);
                game.ev.framePots.push(b.id);
                // Упавший шар засчитывается как «дошёл до борта»: правило про
                // борт существует, чтобы нельзя было толкнуть шар на полдюйма и
                // отдать ход, а забитый шар — это точно не оно.
                if (game.ev.firstHit != null) game.ev.railAfterHit = true;
                break;
            }
        }
    }

    // 3. Борта.
    for (const b of balls) {
        if (b.in) continue;
        let hit = false;
        if (b.x < BALL_R)            { b.x = BALL_R;            b.vx = -b.vx * CUSHION_KEEP; hit = true; }
        else if (b.x > TABLE_W - BALL_R) { b.x = TABLE_W - BALL_R; b.vx = -b.vx * CUSHION_KEEP; hit = true; }
        if (b.y < BALL_R)            { b.y = BALL_R;            b.vy = -b.vy * CUSHION_KEEP; hit = true; }
        else if (b.y > TABLE_H - BALL_R) { b.y = TABLE_H - BALL_R; b.vy = -b.vy * CUSHION_KEEP; hit = true; }
        if (hit) {
            game.ev.frameHits++;
            if (game.ev.firstHit != null) game.ev.railAfterHit = true;
        }
    }

    // 4. Шары между собой. Пары строго по возрастанию номеров — см. шапку.
    const D = BALL_R * 2;
    for (let i = 0; i < balls.length; i++) {
        const a = balls[i];
        if (a.in) continue;
        for (let j = i + 1; j < balls.length; j++) {
            const b = balls[j];
            if (b.in) continue;

            let nx = b.x - a.x;
            let ny = b.y - a.y;
            const d2 = nx * nx + ny * ny;
            if (d2 >= D * D || d2 === 0) continue;

            const d = Math.sqrt(d2);
            nx /= d;
            ny /= d;

            // Расталкиваем поровну: шары равной массы, и «утонувший» в соседе
            // шар иначе застревает в нём на следующем шаге.
            const push = (D - d) / 2;
            a.x -= nx * push;
            a.y -= ny * push;
            b.x += nx * push;
            b.y += ny * push;

            // Скорость сближения вдоль линии центров. Если шары расходятся —
            // это остаток предыдущего шага, бить второй раз не надо.
            const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rel >= 0) continue;

            // Равные массы: вдоль линии центров шары просто меняются этой
            // составляющей скорости, поперечная не меняется вовсе. Это и есть
            // тот самый «прицельный шар пошёл по линии центров», ради которого
            // в бильярд и целятся.
            const imp = rel * BALL_KEEP;
            a.vx += imp * nx;
            a.vy += imp * ny;
            b.vx -= imp * nx;
            b.vy -= imp * ny;

            game.ev.frameHits++;
            // Первое касание битка решает, был ли фол, — запоминаем его один раз.
            if (game.ev.firstHit == null) {
                if (a.id === CUE) game.ev.firstHit = b.id;
                else if (b.id === CUE) game.ev.firstHit = a.id;
            }
        }
    }
}

// ── Разбор удара ─────────────────────────────────────────────────────────────

/**
 * Что означал только что закончившийся удар: фол, продолжение, победа.
 *
 * Возвращает описание для окна ({ foul, reason, potted, continues, winner,
 * rerack, group }) и приводит партию к следующему ходу.
 */
function resolveShot(game) {
    const ev = game.ev;
    const me = game.turn;
    const opp = 1 - me;
    const wasBreak = !game.broke;
    game.broke = true;
    game.shots++;
    game.phase = 'aim';

    const pottedEight = ev.potted.includes(EIGHT);

    // Восьмёрка на разбое — не поражение, а переигровка. Наказывать за случайный
    // результат первого удара, когда игрок ещё ничего не решал, глупо: пирамида
    // складывается заново, разбивает тот же.
    if (wasBreak && pottedEight) {
        const fresh = createGame({ seed: (game.seed * 1103515245 + 12345) >>> 0, breaker: me });
        game.seed = fresh.seed;
        game.balls = fresh.balls;
        game.groups = [null, null];
        game.ballInHand = true;
        game.broke = false;
        game.turn = me;
        game.ev = null;
        return { rerack: true, foul: false, potted: ev.potted, continues: true, winner: null, reason: 'eight_on_break' };
    }

    // ── Фол ──────────────────────────────────────────────────────────────────
    let foul = false;
    let reason = '';

    if (ev.cueIn) { foul = true; reason = 'scratch'; }
    else if (ev.firstHit == null) { foul = true; reason = 'no_contact'; }
    else if (!wasBreak && !ev.targets.includes(ev.firstHit)) {
        foul = true;
        reason = 'wrong_ball';
    }
    // Никто не дошёл до борта и ничего не упало — «толкнул и сижу». Проверяем
    // последним: если фол уже есть, вторая причина ничего не добавит.
    if (!foul && !ev.railAfterHit) { foul = true; reason = 'no_rail'; }

    // ── Восьмёрка ────────────────────────────────────────────────────────────
    if (pottedEight) {
        const group = game.groups[me];
        // Своя группа разобрана? Считаем ПОСЛЕ этого удара: положить последний
        // свой шар и восьмёрку одним ударом — законная и красивая победа.
        const cleared = group != null && remaining(game, group) === 0;
        if (!foul && cleared) {
            return finish(game, me, 'eight', false, ev.potted);
        }
        // Всё остальное — поражение: рано, не своим ходом или с фолом (в том
        // числе биток в лузу на восьмёрке).
        return finish(game, opp, foul ? 'eight_foul' : 'eight_early', foul, ev.potted);
    }

    // ── Группы ───────────────────────────────────────────────────────────────
    // Стол закрывается только ЧЕСТНО забитым шаром: после фола он остаётся
    // открытым, иначе фол назначал бы сопернику группу.
    let assigned = null;
    if (!foul && game.groups[me] == null) {
        const first = ev.potted.find(id => id !== EIGHT);
        if (first != null) {
            // Упало и своё, и чужое — берём то, что упало ПЕРВЫМ. По правилам
            // выбирает игрок, но выбор посреди чужого удара пришлось бы спрашивать
            // по сети, а случай этот редкий.
            assigned = groupOf(first);
            game.groups[me] = assigned;
            game.groups[opp] = otherGroup(assigned);
        }
    }

    // ── Чей ход ──────────────────────────────────────────────────────────────
    let continues = false;
    if (!foul) {
        const group = game.groups[me];
        if (group == null) continues = ev.potted.length > 0;      // стол ещё открыт
        else continues = ev.potted.some(id => groupOf(id) === group);
    }

    if (foul) {
        game.turn = opp;
        game.ballInHand = true;
    } else if (!continues) {
        game.turn = opp;
    }

    game.ev = null;
    return { foul, reason, potted: ev.potted, continues, winner: null, assigned, rerack: false };
}

/**
 * Закончить партию.
 *
 * foul здесь — БЫЛ ЛИ ФОЛ САМ ПО СЕБЕ, а не «кончилось не победой»: восьмёрку
 * можно уронить рано совершенно честным ударом (свой шар докатил её до лузы), и
 * подписывать такой удар фолом было бы враньём в лицо игроку.
 */
function finish(game, winner, reason, foul = false, potted = []) {
    game.phase = 'over';
    game.winner = winner;
    game.reason = reason;
    game.ev = null;
    return { foul, reason, potted, continues: false, winner, rerack: false };
}

/**
 * Сдаться. Отдельно от ударов: это единственный способ закончить партию, не
 * доигрывая, и он нужен — без него проигрывающий просто закрывает вкладку, и в
 * таблице копятся одни победы.
 */
export function resign(game, player) {
    if (game.phase === 'over') return false;
    finish(game, 1 - (player & 1), 'resign');
    return true;
}

// ── Прицел ───────────────────────────────────────────────────────────────────

/**
 * Куда упрётся биток, если пустить его в этом направлении: до первого шара или
 * до борта. Нужно окну для линии прицела и боту — для быстрой отбраковки ударов
 * «в спину своему шару» без полного расчёта.
 *
 * Геометрия, а не физика: считается пересечение луча с окружностями радиуса 2R
 * вокруг чужих шаров — классический «шар-призрак».
 */
export function aimCast(game, fromX, fromY, dirX, dirY) {
    const len = Math.sqrt(dirX * dirX + dirY * dirY);
    if (len === 0) return null;
    const ux = dirX / len;
    const uy = dirY / len;

    let best = Infinity;
    let hitId = null;
    const D = BALL_R * 2;

    for (const b of game.balls) {
        if (b.in || b.id === CUE) continue;
        const ox = b.x - fromX;
        const oy = b.y - fromY;
        const along = ox * ux + oy * uy;
        if (along <= 0) continue;                       // шар позади
        const perp2 = ox * ox + oy * oy - along * along;
        if (perp2 > D * D) continue;                    // мимо
        const t = along - Math.sqrt(D * D - perp2);
        if (t >= 0 && t < best) { best = t; hitId = b.id; }
    }

    // До борта. Луза в этом расчёте не участвует: линия прицела показывает, куда
    // ПОЙДЁТ биток, а провалится он там или нет, видно и так.
    const tx = ux > 0 ? (TABLE_W - BALL_R - fromX) / ux : (ux < 0 ? (BALL_R - fromX) / ux : Infinity);
    const ty = uy > 0 ? (TABLE_H - BALL_R - fromY) / uy : (uy < 0 ? (BALL_R - fromY) / uy : Infinity);
    const tRail = Math.min(tx, ty);
    if (tRail < best) return { x: fromX + ux * tRail, y: fromY + uy * tRail, id: null, dist: tRail };
    if (hitId == null) return null;
    return { x: fromX + ux * best, y: fromY + uy * best, id: hitId, dist: best };
}

// ── Позиция: хранение и сверка ───────────────────────────────────────────────

/** Позиция для базы и для сети: только то, без чего партию не восстановить. */
export function serialize(game) {
    return {
        seed: game.seed,
        balls: game.balls.map(b => ({
            id: b.id,
            // Округляем до тысячных дюйма — этого хватает с запасом (шар 2¼"),
            // а числа в базе остаются короткими и одинаковыми у всех.
            x: Math.round(b.x * POS_SCALE) / POS_SCALE,
            y: Math.round(b.y * POS_SCALE) / POS_SCALE,
            in: b.in,
        })),
        turn: game.turn,
        breaker: game.breaker,
        groups: game.groups,
        ballInHand: game.ballInHand,
        broke: game.broke,
        phase: game.phase,
        winner: game.winner,
        reason: game.reason,
        shots: game.shots,
    };
}

/** Обратно. Скорости не хранятся: сохраняется только позиция покоя. */
export function deserialize(data) {
    return {
        seed: data.seed >>> 0,
        balls: data.balls.map(b => ({ id: b.id, x: b.x, y: b.y, vx: 0, vy: 0, in: !!b.in })),
        turn: data.turn & 1,
        breaker: (data.breaker ?? 0) & 1,
        groups: [data.groups?.[0] ?? null, data.groups?.[1] ?? null],
        ballInHand: !!data.ballInHand,
        broke: !!data.broke,
        phase: data.phase || 'aim',
        winner: data.winner == null ? null : data.winner & 1,
        reason: data.reason || '',
        shots: data.shots | 0,
        ev: null,
        clock: 0,
    };
}

/**
 * Отпечаток позиции — окну, чтобы поймать расхождение с сервером.
 *
 * Партия у обоих игроков считается в браузере, и если картинки когда-нибудь
 * разойдутся (кривой округлённый удар, правка физики на сервере раньше, чем на
 * сайте), молча играть дальше нельзя: люди будут видеть разные столы. Окно
 * сверяет отпечаток после каждого удара и, если он не сошёлся, берёт позицию с
 * сервера как есть.
 */
export function stateHash(game) {
    let h = 0x811c9dc5;
    const mix = v => {
        h ^= v | 0;
        h = Math.imul(h, 0x01000193) >>> 0;
    };
    for (const b of game.balls) {
        mix(b.id);
        mix(b.in ? 1 : 0);
        if (b.in) continue;
        mix(Math.round(b.x * POS_SCALE));
        mix(Math.round(b.y * POS_SCALE));
    }
    mix(game.turn);
    mix(game.ballInHand ? 1 : 0);
    mix(game.broke ? 1 : 0);
    mix(game.groups[0] === SOLIDS ? 1 : game.groups[0] === STRIPES ? 2 : 0);
    mix(game.groups[1] === SOLIDS ? 1 : game.groups[1] === STRIPES ? 2 : 0);
    return h >>> 0;
}

/** Копия партии — боту, чтобы перебирать удары, не трогая настоящую. */
export function cloneGame(game) {
    return {
        ...game,
        balls: game.balls.map(b => ({ ...b })),
        groups: [game.groups[0], game.groups[1]],
        ev: null,
    };
}

// ── Человеческие подписи ─────────────────────────────────────────────────────
// Держим здесь, а не в окне: те же слова уходят в историю партии на сервере.

export const FOUL_TEXT = {
    scratch: 'биток в лузе',
    no_contact: 'мимо всех шаров',
    wrong_ball: 'первым задет чужой шар',
    no_rail: 'ни один шар не дошёл до борта',
};

export const END_TEXT = {
    eight: 'восьмёрка забита последней',
    eight_early: 'восьмёрка забита раньше своих',
    eight_foul: 'восьмёрка забита с фолом',
    resign: 'соперник сдался',
    timeout: 'соперник не доиграл',
};

export const GROUP_TEXT = {
    [SOLIDS]: 'сплошные',
    [STRIPES]: 'полосатые',
};
