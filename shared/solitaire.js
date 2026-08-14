// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Пасьянс» (косынка): правила одним файлом.
//
// Здесь ВСЁ, что знает про игру и фронт, и бэкенд: колода, раздача, куда какую
// карту можно положить, автосбор и проверка результата. Окно игры
// (frontend/src/solitaire.js) только рисует раскладку и слушает мышь, а сервер
// (backend/src/routes/solitaire.js) берёт отсюда проверку правдоподобности —
// иначе «а бывает ли такая партия» пришлось бы держать в двух местах.
//
// ПАРТИЯ СЧИТАЕТСЯ В БРАУЗЕРЕ, как в тетрисе и тройке (см. шапку
// shared/tetris.js), и по той же причине: карту тянут мышью, стопка едет за
// курсором в том же кадре, и спрашивать сервер «а можно?» на каждое движение
// нельзя. На сервер уходит ОДИН запрос — и только у ВЫИГРАННОЙ партии: топ тут
// по времени, а незаконченная раскладка времени не показывает.
//
// РЕЖИМ: классическая косынка, но по одной карте из колоды и с бесконечными
// перекладываниями. Это самый простой из вариантов — и выбран он именно
// поэтому: топ соревнуется ВРЕМЕНЕМ, а по три карты со счётом заходов половина
// раскладов не разбирается вовсе, и в топе сравнивалось бы не «кто быстрее», а
// «кому досталась разбираемая раздача».
//
// ОТМЕНЫ ХОДА НЕТ, и это тоже про время: партия на секундомере, а отмена
// превращает её в «тыкаю, пока не выйдет». Ошибся — «Заново», раздача новая, а
// стоит она полторы минуты.
//
// Карта — ОДНО ЧИСЛО 0..51 (масть × 13 + достоинство), а не объект: колода
// перебирается на каждый автосбор и на каждую проверку «куда это можно», и
// объекты тут не дают ничего, кроме мусора для сборщика.
// ─────────────────────────────────────────────────────────────────────────────

// Масти в порядке СТРОК спрайта frontend/src/assets/cards-8bit.png — таблицы
// соответствия «масть → картинка» нет нигде, строка считается прямо отсюда.
// Менять порядок нельзя, не пересобрав картинку (design/cards/README.md).
export const SUITS = ['hearts', 'clubs', 'diamonds', 'spades'];
export const RANKS = 13;
export const DECK = SUITS.length * RANKS;
export const PILES = 7;

// Достоинство: 1 — туз, 11..13 — валет, дама, король. Туз единицей, а не
// четырнадцаткой, потому что база (основание) растёт от туза к королю, и в
// косынке туз ниже двойки всегда — «старшего туза» тут не бывает.
export const ACE = 1;
export const KING = 13;

export const suitOf = card => (card / RANKS) | 0;
export const rankOf = card => (card % RANKS) + 1;

// Колода четырёхцветная (черви розовые, трефы зелёные, бубны оранжевые, пики
// синие), но правило косынки — про ЧЁРНОЕ И КРАСНОЕ, и оно остаётся прежним:
// красные масти — черви и бубны. На картинках это тёплые против холодных, так
// что чередование видно и не по названию мастей.
export const isRed = card => suitOf(card) === 0 || suitOf(card) === 2;

// Столбец карты в спрайте: там подряд лежат 2..10, валет, дама, король и туз —
// то есть туз в КОНЦЕ ряда, а не в начале.
export const spriteCol = card => (rankOf(card) === ACE ? RANKS - 1 : rankOf(card) - 2);
export const spriteRow = card => suitOf(card);

/** Человеческое имя карты — для подписи хода и для тестов. */
export const RANK_LABEL = ['', 'Т', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'В', 'Д', 'К'];
export const SUIT_LABEL = { hearts: '♥', clubs: '♣', diamonds: '♦', spades: '♠' };
export const cardLabel = card => RANK_LABEL[rankOf(card)] + SUIT_LABEL[SUITS[suitOf(card)]];

// Зоны раскладки. Строками, а не числами: место карты уезжает в разметку окна
// (data-атрибутами) и обратно, и читать в отладчике `{zone:'tab',pile:3}`
// куда проще, чем `{zone:2,pile:3}`.
export const STOCK = 'stock';
export const WASTE = 'waste';
export const TABLEAU = 'tab';
export const FOUNDATION = 'found';

// ── Проверка результата ──────────────────────────────────────────────────────

// Ходом считается ЛЮБОЕ действие игрока: перенос стопки, карта из колоды,
// перекладывание отбоя обратно и каждая карта автосбора. Меньше 52 ходов
// выигранной партии не бывает — каждая карта хотя бы раз уезжает на базу.
export const MIN_MOVES = DECK;
export const MAX_MOVES = 20_000;
// Ниже этого партия не раскладывается даже руками рекордсмена: 52 карты надо
// хотя бы довезти до баз. Тридцать секунд — это отсечка мусора («разложил за
// 0 секунд»), а не попытка угадать предел человека.
export const MIN_SECONDS = 30;
export const MIN_MS_PER_MOVE = 90;
// Партия длиннее шести часов — это забытая вкладка, а не игра. Таймер в окне
// на свёрнутой вкладке стоит, так что честно набрать столько нельзя.
export const MAX_SECONDS = 6 * 3600;

/**
 * Похоже ли на настоящую разложенную партию.
 *
 * Проверка ГРУБАЯ и такой задумана: это защита от мусора и от «разложил за
 * секунду», а не от человека с открытой консолью — мини-топ пасхалки большего
 * не стоит (та же цена, что у тетриса и тройки).
 */
export function isPlausibleRun({ seconds, moves, redeals }) {
    const sec = Number(seconds);
    const m = Number(moves);
    const r = Number(redeals);
    const all = [sec, m, r];

    if (!all.every(v => Number.isFinite(v) && v >= 0)) return { ok: false, reason: 'shape' };
    if (!all.every(Number.isInteger)) return { ok: false, reason: 'shape' };
    if (m < MIN_MOVES) return { ok: false, reason: 'too_few_moves' };
    if (m > MAX_MOVES) return { ok: false, reason: 'too_many_moves' };
    if (r > m) return { ok: false, reason: 'redeals_vs_moves' };
    if (sec > MAX_SECONDS) return { ok: false, reason: 'too_long' };
    if (sec < MIN_SECONDS) return { ok: false, reason: 'too_fast' };
    if (sec * 1000 < m * MIN_MS_PER_MOVE) return { ok: false, reason: 'too_fast' };
    return { ok: true };
}

// ── Партия ───────────────────────────────────────────────────────────────────

// Генератор с зерном (mulberry32) — как в тетрисе и тройке: нужен не ради
// «честности», а ради тестов, в которых раздачу надо повторить карта в карту.
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

/**
 * Новая раздача. seed — зерно случайности (по умолчанию своё на каждую партию).
 *
 * Стопка на столе — это `{ cards, down }`: сколько ПЕРВЫХ карт лежит рубашкой
 * вверх. Отдельного флага у карты нет намеренно — закрытые в косынке всегда
 * лежат снизу подряд и, открывшись, обратно не закрываются (отмены хода нет),
 * так что одного числа хватает, и «а эта открыта?» становится сравнением.
 */
export function createGame({ seed } = {}) {
    const rng = makeRng(seed == null ? (Math.random() * 0xffffffff) >>> 0 : seed);
    const deck = [];
    for (let c = 0; c < DECK; c++) deck.push(c);
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    const piles = [];
    for (let p = 0; p < PILES; p++) {
        // В p-й столбец идёт p+1 карт, из них открыта одна верхняя.
        piles.push({ cards: deck.splice(0, p + 1), down: p });
    }

    return {
        rng,
        stock: deck,                       // рубашкой вверх, тянем с КОНЦА
        waste: [],                         // отбой, лицом вверх
        found: SUITS.map(() => []),        // базы, индекс = масть
        piles,
        moves: 0,
        redeals: 0,
        elapsedMs: 0,                      // сколько партия реально шла
        won: false,
        // Сколько раз автосбор подряд крутнул колоду впустую (см. autoStep).
        autoSpins: 0,
    };
}

/** Секундомер. Пауза и свёрнутая вкладка сюда не попадают — см. окно игры. */
export function tick(game, ms) {
    if (game.won) return;
    game.elapsedMs += Math.max(0, ms);
}

const top = list => (list.length ? list[list.length - 1] : -1);

/** Верхняя (доступная) карта стопки стола, отбоя или базы. −1 — пусто. */
export function topCard(game, zone, i = 0) {
    if (zone === WASTE) return top(game.waste);
    if (zone === STOCK) return top(game.stock);
    if (zone === FOUNDATION) return top(game.found[i]);
    return top(game.piles[i].cards);
}

/** Открыта ли карта с этим номером в столбце стола. */
export const isFaceUp = (pile, index) => index >= pile.down;

// ── Что куда можно ───────────────────────────────────────────────────────────

/** На базу — своей мастью и ровно на единицу старше верхней (пустая ждёт туза). */
export function canDropOnFoundation(card, game, suit) {
    if (suit !== suitOf(card)) return false;
    const pile = game.found[suit];
    return rankOf(card) === pile.length + 1;
}

/** На стол — на карту другого цвета и ровно на единицу младше (пустой ждёт короля). */
export function canDropOnTableau(card, game, pileIndex) {
    const pile = game.piles[pileIndex];
    const under = top(pile.cards);
    if (under < 0) return rankOf(card) === KING;
    // Верхняя карта непустого столбца всегда открыта: уехавшая стопка открывает
    // следующую тем же ходом (см. move), и других способов её закрыть нет.
    return isRed(card) !== isRed(under) && rankOf(card) === rankOf(under) - 1;
}

/**
 * Карты, которые уедут, если взять `from`.
 *
 * from: { zone: WASTE } | { zone: TABLEAU, pile, index } | { zone: FOUNDATION, pile }
 *
 * Со стола берётся карта ВМЕСТЕ СО ВСЕМИ, что лежат на ней. Проверять, что это
 * правильная последовательность, не нужно: открытая часть столбца всегда ею и
 * является — каждая карта попала туда через canDropOnTableau.
 */
export function taken(game, from) {
    if (!from) return [];
    if (from.zone === WASTE) {
        const card = top(game.waste);
        return card < 0 ? [] : [card];
    }
    if (from.zone === FOUNDATION) {
        // С базы карту забрать МОЖНО: иногда семёрка нужна обратно на стол,
        // чтобы под неё лёг шестой ряд. Запрет тут ничего не защищает — только
        // изредка портит партию.
        const card = top(game.found[from.pile]);
        return card < 0 ? [] : [card];
    }
    if (from.zone !== TABLEAU) return [];
    const pile = game.piles[from.pile];
    if (!pile || !isFaceUp(pile, from.index) || from.index >= pile.cards.length) return [];
    return pile.cards.slice(from.index);
}

/** Пустит ли `to` стопку `cards` (несколько карт бывает только на столе). */
export function canDrop(game, cards, to) {
    if (!cards.length || !to) return false;
    if (to.zone === FOUNDATION) return cards.length === 1 && canDropOnFoundation(cards[0], game, to.pile);
    if (to.zone === TABLEAU) return canDropOnTableau(cards[0], game, to.pile);
    return false;
}

/** Один и тот же адрес? Нужно, чтобы не считать ходом «взял и положил обратно». */
export function sameSpot(a, b) {
    return !!a && !!b && a.zone === b.zone && a.pile === b.pile;
}

/**
 * Перенести стопку. Возвращает true, если ход состоялся.
 *
 * Открытие карты под уехавшей — часть хода, а не отдельное действие: в косынке
 * оно происходит само и обратно не отменяется.
 */
export function move(game, from, to) {
    if (game.won) return false;
    const cards = taken(game, from);
    if (!cards.length || sameSpot(from, to) || !canDrop(game, cards, to)) return false;

    if (from.zone === WASTE) game.waste.pop();
    else if (from.zone === FOUNDATION) game.found[from.pile].pop();
    else {
        const pile = game.piles[from.pile];
        pile.cards.length = from.index;
        // Уехала вся открытая часть — открываем следующую карту. Это и держит
        // инвариант «верхняя карта непустого столбца открыта».
        if (pile.down === pile.cards.length && pile.down > 0) pile.down--;
    }

    if (to.zone === FOUNDATION) game.found[to.pile].push(cards[0]);
    else game.piles[to.pile].cards.push(...cards);

    game.moves++;
    game.won = game.found.every(f => f.length === RANKS);
    return true;
}

/**
 * Карта из колоды в отбой; колода кончилась — отбой возвращается в неё.
 * Возвращает 'draw' | 'redeal' | null (не из чего тянуть вовсе).
 */
export function draw(game) {
    if (game.won) return null;
    if (game.stock.length) {
        game.waste.push(game.stock.pop());
        game.moves++;
        return 'draw';
    }
    if (!game.waste.length) return null;
    // Отбой переворачивается целиком и ложится обратно тем же порядком.
    // Заходов не считаем (см. шапку) — считаем сами перекладывания, они уезжают
    // в топ строкой «кругов: N»: это единственное, что говорит, насколько
    // тяжело далась раздача.
    game.stock = game.waste.reverse();
    game.waste = [];
    game.moves++;
    game.redeals++;
    return 'redeal';
}

/**
 * Куда уедет карта по одному клику: сначала база, потом стол.
 *
 * На пустой столбец кликом кладём ТОЛЬКО короля и только если больше некуда:
 * «уехало в пустоту» — самый обидный случайный ход в косынке, а осмысленный
 * переезд туда всегда делают мышью.
 */
export function autoTarget(game, from) {
    const cards = taken(game, from);
    if (!cards.length) return null;

    if (cards.length === 1) {
        const suit = suitOf(cards[0]);
        if (from.zone !== FOUNDATION && canDropOnFoundation(cards[0], game, suit)) {
            return { zone: FOUNDATION, pile: suit };
        }
    }
    let empty = -1;
    for (let p = 0; p < PILES; p++) {
        if (from.zone === TABLEAU && from.pile === p) continue;
        if (!game.piles[p].cards.length) { if (empty < 0) empty = p; continue; }
        if (canDropOnTableau(cards[0], game, p)) return { zone: TABLEAU, pile: p };
    }
    if (empty >= 0 && canDropOnTableau(cards[0], game, empty)) return { zone: TABLEAU, pile: empty };
    return null;
}

// ── Автосбор ─────────────────────────────────────────────────────────────────

/**
 * Партия уже выиграна руками: закрытых карт не осталось.
 *
 * Дальше всё раскладывается механически — по одной карте из колоды и с
 * бесконечными перекладываниями до любой карты отбоя можно добраться всегда, —
 * и заставлять человека делать полсотни кликов ради этого незачем. Из-за них же
 * секундомер и наказывал бы за уже выигранную партию.
 */
export function canAutoFinish(game) {
    return !game.won && game.piles.every(p => p.down === 0);
}

/**
 * Один шаг автосбора: увезти на базу что-нибудь сверху, а если сверху нечего —
 * подкрутить колоду. Возвращает описание шага (окну — чтобы показать) или null,
 * когда всё разложено или шагов больше нет.
 *
 * Колода крутится ТОЛЬКО пока автосбор что-то увозит: счётчик пустых оборотов
 * живёт в самой партии, иначе цикл «перекладываю отбой» стал бы вечным.
 */
export function autoStep(game) {
    if (game.won) return null;

    const send = (from, suit) => {
        const to = { zone: FOUNDATION, pile: suit };
        if (!move(game, from, to)) return null;
        // Карта уехала — значит, колода крутилась не впустую, и счётчик пустых
        // оборотов начинается заново.
        game.autoSpins = 0;
        return { from, to };
    };

    const wasteCard = top(game.waste);
    if (wasteCard >= 0 && canDropOnFoundation(wasteCard, game, suitOf(wasteCard))) {
        return send({ zone: WASTE }, suitOf(wasteCard));
    }
    for (let p = 0; p < PILES; p++) {
        const card = top(game.piles[p].cards);
        if (card < 0) continue;
        if (canDropOnFoundation(card, game, suitOf(card))) {
            return send({ zone: TABLEAU, pile: p, index: game.piles[p].cards.length - 1 }, suitOf(card));
        }
    }
    // Наверху ничего не подошло — крутим колоду. Больше 53 оборотов подряд без
    // единой увезённой карты означает, что круг пройден целиком (в колоде и
    // отбое вместе не бывает больше 52 карт) и автосбор встал: так бывает,
    // когда на столе всё открыто, но столбцы сложены не по правилам. Тогда шаги
    // кончились, и дальше играет человек.
    const spins = (game.autoSpins || 0) + 1;
    if (spins > DECK + 1) { game.autoSpins = 0; return null; }
    const what = draw(game);
    if (!what) { game.autoSpins = 0; return null; }
    game.autoSpins = spins;
    return { draw: what };
}

/**
 * Есть ли ход, который что-то меняет. Нужно окну, чтобы не молчать в глухой
 * раздаче: сама по себе колода крутится вечно, и без этой проверки человек
 * щёлкал бы её по кругу, не понимая, что партия кончилась.
 *
 * Карты колоды и отбоя проверяются ВСЕ, а не только верхняя: перекладывания
 * бесконечны и по одной карте, то есть до любой из них можно докрутить.
 *
 * Проверка нарочно грубая в другую сторону — перекладывание стопки со стола на
 * стол считается ходом, даже если оно ничего не даёт. Честный ответ на «а не
 * тупик ли это» требует перебора партии до конца, а цена ошибки здесь — лишняя
 * строчка «ходов больше нет», показанная на ход позже.
 */
export function hasMove(game) {
    if (game.won) return false;

    const fits = card => {
        if (canDropOnFoundation(card, game, suitOf(card))) return true;
        for (let q = 0; q < PILES; q++) if (canDropOnTableau(card, game, q)) return true;
        return false;
    };
    for (const card of game.stock) if (fits(card)) return true;
    for (const card of game.waste) if (fits(card)) return true;

    for (let p = 0; p < PILES; p++) {
        const pile = game.piles[p];
        const card = top(pile.cards);
        if (card < 0) continue;
        if (canDropOnFoundation(card, game, suitOf(card))) return true;
        for (let i = pile.down; i < pile.cards.length; i++) {
            for (let q = 0; q < PILES; q++) {
                if (q === p) continue;
                // Переезд всего столбца на пустое место ничего не меняет: было
                // пятно из одного столбца, стало из другого.
                const whole = i === 0;
                if (whole && !game.piles[q].cards.length) continue;
                if (canDropOnTableau(pile.cards[i], game, q)) return true;
            }
        }
    }
    return false;
}
