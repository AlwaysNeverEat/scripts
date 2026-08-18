// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Дурак»: правила одним файлом.
//
// Здесь ВСЁ, что знает про игру и фронт, и бэкенд: колода, раздача, кто кому чем
// отбивается, перевод, добор и конец партии. Окно игры (frontend/src/durak.js)
// только рисует стол и слушает мышь, бот (shared/durakBot.js) выбирает ход теми
// же функциями, что и человек, а сервер (backend/src/durak/games.js) применяет
// присланный ход к своей копии позиции.
//
// ГЛАВНОЕ ОТЛИЧИЕ ОТ ОСТАЛЬНЫХ ПАСХАЛОК: ЗДЕСЬ ЕСТЬ ЗАКРЫТАЯ ИНФОРМАЦИЯ.
// Тетрис, тройка и пасьянс считаются в браузере целиком — там нечего прятать.
// Бильярд считается в браузере У ОБОИХ, потому что стол виден обоим полностью, и
// сервер лишь сверяет отпечаток позиции. В дураке так нельзя: чужая рука и
// колода — тайна, и браузер, который их знает, знает лишнее. Поэтому партию с
// людьми ВЕДЁТ СЕРВЕР, а каждому игроку уезжает не позиция, а ЕГО ВИД на неё
// (viewFor): своя рука, размеры чужих рук, стол и отбой. Отпечатков и сверок,
// как в бильярде, тут нет — сверять нечего, клиент ничего не пересчитывает.
//
// ВИД (view) — ЕДИНСТВЕННЫЙ ИСТОЧНИК «ЧТО МНЕ МОЖНО». Легальность хода считают
// attackCards/defendCards/transferCards/canTake/canPass, и на вход они берут
// именно вид, а не позицию. Из этого следует нужное: бот физически не может
// смухлевать — ему дают ровно ту же картинку, что рисуют человеку, и другой у
// него нет (см. шапку durakBot.js).
//
// КАРТА — ОДНО ЧИСЛО и ровно то же, что в пасьянсе (shared/solitaire.js):
// масть × 13 + достоинство. Так у двух игр одна колода и одна картинка на неё —
// строка и столбец в спрайте считаются функциями оттуда, и таблицы соответствия
// «карта → картинка» по-прежнему нет нигде. Колода дурака — это те же карты, из
// которых выброшены двойки-пятёрки: 36 штук, туз старший.
//
// ЧЕТЫРЕ ИГРОКА И ПЕРЕВОДНОЙ. Движок с самого начала написан на N игроков (2..4)
// и на оба режима, а не «на двоих, потом расширим»: круг, добор и подкидывание
// в дураке устроены вокруг «следующего по кругу», и вкручивать это в готовую
// игру на двоих означало бы переписать её целиком. Партия на двоих — это тот же
// код при seats = 2.
//
// ЧЕГО ЗДЕСЬ НЕТ СОЗНАТЕЛЬНО: перевода козырем «в открытую» (показать козырь той
// же масти, не кладя карту), отбоя-в-открытую и погон. Это домашние правила, о
// которых за одним столом договариваются вслух, а в офисной пасхалке они дают
// только споры «а у нас так не играют».
// ─────────────────────────────────────────────────────────────────────────────

import {
    SUITS, RANKS, ACE, suitOf, rankOf, cardLabel, spriteCol, spriteRow, isRed,
} from './solitaire.js';

// Пробрасываем дальше то, что нужно окну и боту, — чтобы они не тянули пасьянс
// ради колоды и не гадали, откуда в дураке взялись функции косынки.
export { SUITS, RANKS, ACE, suitOf, rankOf, cardLabel, spriteCol, spriteRow, isRed };

// ── Колода ───────────────────────────────────────────────────────────────────

// Младшее достоинство в колоде. Всё, что ниже, из пасьянсовой колоды выброшено.
export const LOW_RANK = 6;
// Сколько карт на руке при доборе.
export const HAND = 6;
// Потолок карт в одном розыгрыше. Шесть — не «столько влезает на стол», а
// столько защитник может отбить с полной руки.
export const MAX_TABLE = 6;

// СКОЛЬКО РОЗЫГРЫШЕЙ ПОДРЯД КАРТЫ МОГУТ ХОДИТЬ ПО КРУГУ, прежде чем партию
// объявят ничьей. Нужно это ровно для одной дыры, и дыра настоящая: в
// переводном с пустой колодой двое могут крутить карты вечно — защитник берёт,
// на следующем розыгрыше переводит взятое обратно, второй берёт его же. В отбой
// при этом не уходит ничего, руки не пустеют, и партия не кончается никогда
// (проверено: 200 000 ходов и ни одного конца). За настоящим столом это
// кончается тем, что людям надоедает; здесь нужен счётчик — как правило
// пятидесяти ходов в шахматах.
//
// Шестьдесят — с большим запасом: в случайной игре (а она берёт куда чаще
// человека) самая длинная честная серия розыгрышей без единой карты в отбой была
// 34. Так что упереться в этот потолок нормальной партией нельзя.
export const STALL_BOUTS = 60;

export const MIN_SEATS = 2;
export const MAX_SEATS = 4;

export const PODKIDNOY = 'podkidnoy';
export const PEREVODNOY = 'perevodnoy';

export const MODES = [
    { id: PODKIDNOY, name: 'Подкидной' },
    { id: PEREVODNOY, name: 'Переводной' },
];

/** Все карты колоды: 6..10, В, Д, К, Т в четырёх мастях. */
export function buildDeck() {
    const deck = [];
    for (let s = 0; s < SUITS.length; s++) {
        for (let r = LOW_RANK; r <= RANKS; r++) deck.push(s * RANKS + (r - 1));
        // Туз в кодировке пасьянса стоит первым (достоинство 1), а в дураке он
        // старший — поэтому кладём его отдельно, а не продолжением цикла.
        deck.push(s * RANKS + (ACE - 1));
    }
    return deck;
}

export const DECK_SIZE = SUITS.length * (RANKS - LOW_RANK + 2);   // 36

/**
 * Сила карты: туз старше короля.
 *
 * В пасьянсе туз единица (база растёт от туза), здесь — четырнадцать. Это
 * единственное место, где колоды двух игр расходятся, и держать его надо
 * отдельной функцией, а не «поправкой» в сравнении.
 */
export const power = card => (rankOf(card) === ACE ? RANKS + 1 : rankOf(card));

/** Бьёт ли `defence` карту `attack` при козыре `trump`. */
export function beats(attack, defence, trump) {
    const at = suitOf(attack) === trump;
    const dt = suitOf(defence) === trump;
    if (dt && !at) return true;          // козырь бьёт некозырь
    if (at && !dt) return false;         // некозырем козырь не побить
    // Дальше обе карты либо козыри, либо нет: нужна та же масть и старше.
    return suitOf(attack) === suitOf(defence) && power(defence) > power(attack);
}

export const isTrump = (card, trump) => suitOf(card) === trump;

// Насколько козырь дороже некозыря. Двадцать — это «козырная шестёрка дороже
// некозырного туза» (26 против 14), но всё ещё СРАВНИМО: по этой же разнице бот
// решает «отбиться или взять», и с бесконечной надбавкой решать было бы нечего.
const TRUMP_PRICE = 20;

/**
 * Цена карты — насколько жалко её отдавать.
 *
 * Живёт в правилах, а не в боте: по этой же цене окно сортирует руку, и две
 * разные «цены» в одной игре означали бы, что рука разложена не так, как думает
 * тот, кто по ней ходит.
 */
export const cost = (card, trump) => power(card) + (isTrump(card, trump) ? TRUMP_PRICE : 0);

/** Рука в порядке показа: некозыри по мастям, козыри в конец. */
export function sortHand(hand, trump) {
    hand.sort((a, b) => {
        const ta = isTrump(a, trump) ? 1 : 0;
        const tb = isTrump(b, trump) ? 1 : 0;
        if (ta !== tb) return ta - tb;
        if (suitOf(a) !== suitOf(b)) return suitOf(a) - suitOf(b);
        return power(a) - power(b);
    });
    return hand;
}

// ── Раздача ──────────────────────────────────────────────────────────────────

// Генератор с зерном (mulberry32) — как в тетрисе, тройке и пасьянсе: нужен не
// ради «честности», а ради тестов, в которых раздачу надо повторить карта в
// карту, и ради партии на сервере, которую можно пересдать из одного числа.
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
 * Новая партия.
 *
 * Колода лежит «верхом в конце» (берут через pop), поэтому нижняя карта — это
 * deck[0]: она же козырная, она же уходит последней. Отдельного поля под неё нет
 * специально — иначе пришлось бы помнить в двух местах, взяли её уже или нет.
 *
 * Кто ходит первым, решает НЕ жребий, а младший козырь на руках: это правило
 * дурака, и оно же избавляет от спора «почему опять он». Козырей может не
 * оказаться ни у кого (12 карт из 36 — так бывает), тогда первым ходит тот, кому
 * выпало зерном.
 */
export function createGame({ seed, seats = 2, mode = PODKIDNOY } = {}) {
    const n = Math.max(MIN_SEATS, Math.min(MAX_SEATS, seats | 0));
    const rng = makeRng(seed == null ? (Math.random() * 0xffffffff) >>> 0 : seed);

    const deck = buildDeck();
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    const hands = Array.from({ length: n }, () => []);
    for (let k = 0; k < HAND; k++) {
        for (let p = 0; p < n; p++) hands[p].push(deck.pop());
    }
    const trump = suitOf(deck[0]);
    for (const hand of hands) sortHand(hand, trump);

    // Младший козырь. Если козырей нет ни у кого — первый ходящий из зерна.
    let attacker = Math.floor(rng() * n) % n;
    let low = Infinity;
    for (let p = 0; p < n; p++) {
        for (const card of hands[p]) {
            if (!isTrump(card, trump)) continue;
            if (power(card) < low) { low = power(card); attacker = p; }
        }
    }

    const defender = (attacker + 1) % n;
    return {
        mode: mode === PEREVODNOY ? PEREVODNOY : PODKIDNOY,
        seats: n,
        trump,
        deck,
        hands,
        discard: [],
        attacker,
        defender,
        table: [],              // [{ a: карта атаки, d: карта защиты | null }]
        taking: false,          // защитник сказал «беру», идёт подкидывание
        passed: Array.from({ length: n }, () => false),
        limit: Math.min(MAX_TABLE, hands[defender].length),
        // Розыгрышей подряд, за которые в отбой не ушло ни одной карты
        // (см. STALL_BOUTS).
        idle: 0,
        phase: 'play',
        // В дураке нет победителя, есть ДУРАК: тот, у кого остались карты.
        // -1 — ничья (вышли все разом), null — партия не кончена.
        loser: null,
        reason: '',
    };
}

// ── Кто сейчас ходит ─────────────────────────────────────────────────────────

const alive = (state, seat) => state.hands[seat].length > 0;

/** Следующий по кругу, у кого ещё есть карты. */
export function nextAlive(state, from) {
    for (let k = 1; k <= state.seats; k++) {
        const p = (from + k) % state.seats;
        if (alive(state, p)) return p;
    }
    return from;
}

/**
 * Чья очередь подкидывать.
 *
 * Право идёт по кругу ОТ ГЛАВНОГО АТАКУЮЩЕГО: сначала он, потом остальные, минуя
 * защитника. Кто сказал «хватит» — пропускается, пока на стол не легла новая
 * карта (тогда открылось новое достоинство, и отказ больше ничего не значит:
 * passed сбрасывается). Кому нечем подкинуть, пропускается молча — нажимать
 * «хватит» карт, которых нет, человек не должен.
 *
 * Возвращает -1, когда подкинуть некому: это и есть конец розыгрыша.
 */
function nextThrower(state) {
    for (let k = 0; k < state.seats; k++) {
        const p = (state.attacker + k) % state.seats;
        if (p === state.defender || state.passed[p]) continue;
        // Именно baseView: toMove сам спрашивает про подкидывание, и полный вид
        // здесь увёл бы функцию в бесконечную рекурсию.
        if (!attackCards(baseView(state, p)).length) continue;
        return p;
    }
    return -1;
}

/** Чей сейчас ход. -1 — партия кончена или розыгрыш пора закрывать. */
export function toMove(state) {
    if (state.phase !== 'play') return -1;
    // Есть непобитая карта и защитник не сдался — слово за ним.
    if (!state.taking && state.table.some(p => p.d == null)) return state.defender;
    return nextThrower(state);
}

// ── Вид игрока ───────────────────────────────────────────────────────────────

/**
 * Что видит игрок `seat`. Наружу уезжает ТОЛЬКО это — ни колоды, ни чужих рук.
 *
 * Отбой отдаётся ЦЕЛИКОМ, и это осознанно. За настоящим столом отбой лежит
 * рубашкой вверх, но обе карты каждой пары все видели, когда они ложились, —
 * значит, считать вышедшее человеку никто не запрещает, просто это делается
 * памятью. Раз сильному боту счёт карт нужен (это и есть его сложность),
 * прятать отбой от человека нельзя: тогда бот знал бы больше, а не считал
 * лучше. Поэтому окно показывает панель «вышло», и у обоих одна и та же память.
 */
export function viewFor(state, seat) {
    return { ...baseView(state, seat), toMove: toMove(state) };
}

// Вид без «чей ход»: им пользуется nextThrower, у которого ответ на этот вопрос
// как раз и считается.
function baseView(state, seat) {
    return {
        mode: state.mode,
        seats: state.seats,
        seat,
        trump: state.trump,
        // Козырь на дне колоды виден, пока колода не кончилась.
        down: state.deck.length ? state.deck[0] : null,
        deckLeft: state.deck.length,
        hand: state.hands[seat].slice(),
        counts: state.hands.map(h => h.length),
        table: state.table.map(p => ({ a: p.a, d: p.d })),
        discard: state.discard.slice(),
        attacker: state.attacker,
        defender: state.defender,
        taking: state.taking,
        limit: state.limit,
        passed: state.passed.slice(),
        phase: state.phase,
        loser: state.loser,
        reason: state.reason,
    };
}

// ── Что игроку можно ─────────────────────────────────────────────────────────
// Все четыре функции берут ВИД, а не позицию: то же самое, что видит человек,
// видит и бот, и другого источника «что мне можно» в игре нет.

/** Достоинства, которые уже легли на стол, — только ими и подкидывают. */
function tableRanks(table) {
    const ranks = new Set();
    for (const p of table) {
        ranks.add(rankOf(p.a));
        if (p.d != null) ranks.add(rankOf(p.d));
    }
    return ranks;
}

/** Чем можно атаковать или подкинуть. */
export function attackCards(view) {
    if (view.phase !== 'play') return [];
    if (view.seat === view.defender) return [];
    if (view.table.length >= view.limit || view.table.length >= MAX_TABLE) return [];
    // Начинает розыгрыш только главный атакующий: подкидывать нечего, пока на
    // столе пусто.
    if (!view.table.length) return view.seat === view.attacker ? view.hand.slice() : [];
    // Пока на столе висит непобитая карта, слово за защитником: подкидывать
    // поверх неё нельзя (иначе непонятно, что он вообще отбивает).
    if (!view.taking && view.table.some(p => p.d == null)) return [];
    const ranks = tableRanks(view.table);
    return view.hand.filter(c => ranks.has(rankOf(c)));
}

/** Индекс пары, которую сейчас отбивают. -1 — отбивать нечего. */
export function defenceTarget(view) {
    return view.table.findIndex(p => p.d == null);
}

/** Чем можно отбиться. */
export function defendCards(view) {
    if (view.phase !== 'play' || view.seat !== view.defender || view.taking) return [];
    const i = defenceTarget(view);
    if (i < 0) return [];
    return view.hand.filter(c => beats(view.table[i].a, c, view.trump));
}

/**
 * Чем можно перевести (только в переводном).
 *
 * Перевод возможен, пока НИ ОДНА карта не побита: перевести начатую защиту
 * значит отдать соседу стол, на котором уже лежат чужие отбитые карты, — за
 * настоящим столом так не делают, и в правилах этого нет.
 *
 * И второе условие, ради которого перевод вообще ограничен: следующему должно
 * хватить карт, чтобы отбиться. Иначе переводом в две руки можно завалить
 * человека с двумя картами шестью, и это не игра, а расстрел.
 */
export function transferCards(view) {
    if (view.mode !== PEREVODNOY) return [];
    if (view.phase !== 'play' || view.seat !== view.defender || view.taking) return [];
    if (!view.table.length || view.table.some(p => p.d != null)) return [];
    if (view.table.length >= MAX_TABLE) return [];
    const next = nextSeatWithCards(view.counts, view.defender, view.seats);
    if (next < 0 || next === view.seat) return [];
    if (view.counts[next] < view.table.length + 1) return [];
    const rank = rankOf(view.table[0].a);
    return view.hand.filter(c => rankOf(c) === rank);
}

/** Следующий по кругу с картами — по одним только размерам рук (для вида). */
function nextSeatWithCards(counts, from, seats) {
    for (let k = 1; k <= seats; k++) {
        const p = (from + k) % seats;
        if (counts[p] > 0) return p;
    }
    return -1;
}

/** Можно ли сказать «беру». */
export function canTake(view) {
    return view.phase === 'play' && view.seat === view.defender
        && !view.taking && defenceTarget(view) >= 0;
}

/**
 * Можно ли сказать «бито» (а во время «беру» — «хватит»).
 *
 * Кнопка есть только у того, чья сейчас очередь подкидывать: иначе трое
 * нажимают «бито» наперегонки, и розыгрыш заканчивает тот, у кого быстрее
 * интернет.
 */
export function canPass(view) {
    return view.phase === 'play' && view.toMove === view.seat
        && view.seat !== view.defender && view.table.length > 0;
}

// ── Ход ──────────────────────────────────────────────────────────────────────

function takeCard(hand, card) {
    const i = hand.indexOf(card);
    if (i < 0) return false;
    hand.splice(i, 1);
    return true;
}

/**
 * Сыграть ход. Меняет позицию на месте и возвращает { ok } или { ok: false, reason }.
 *
 * move — { type: 'attack' | 'defend' | 'transfer' | 'take' | 'pass', card }.
 * Ровно это уезжает по сети от окна к серверу, и ровно это придумывает бот.
 */
export function applyMove(state, seat, move) {
    if (state.phase !== 'play') return { ok: false, reason: 'over' };
    if (!(seat >= 0 && seat < state.seats)) return { ok: false, reason: 'no_seat' };
    if (toMove(state) !== seat) return { ok: false, reason: 'not_your_turn' };

    const view = viewFor(state, seat);
    const card = move?.card == null ? null : move.card | 0;

    switch (move?.type) {
        case 'attack': {
            if (!attackCards(view).includes(card)) return { ok: false, reason: 'illegal' };
            takeCard(state.hands[seat], card);
            state.table.push({ a: card, d: null });
            // Новое достоинство на столе — прежние отказы больше ничего не
            // значат: подкинуть теперь может и тот, кто только что спасовал.
            state.passed = state.passed.map(() => false);
            break;
        }
        case 'defend': {
            if (!defendCards(view).includes(card)) return { ok: false, reason: 'illegal' };
            takeCard(state.hands[seat], card);
            state.table[defenceTarget(view)].d = card;
            break;
        }
        case 'transfer': {
            if (!transferCards(view).includes(card)) return { ok: false, reason: 'illegal' };
            takeCard(state.hands[seat], card);
            state.table.push({ a: card, d: null });
            // Роли сдвигаются по кругу: переводивший становится атакующим, а
            // отбивается следующий за ним.
            state.attacker = seat;
            state.defender = nextAlive(state, seat);
            state.limit = Math.max(state.table.length,
                                   Math.min(MAX_TABLE, state.hands[state.defender].length));
            state.passed = state.passed.map(() => false);
            break;
        }
        case 'take': {
            if (!canTake(view)) return { ok: false, reason: 'illegal' };
            state.taking = true;
            // Подкидывают заново: пока защитник отбивался, кто-то мог сказать
            // «хватит», а теперь ему есть чем догрузить.
            state.passed = state.passed.map(() => false);
            break;
        }
        case 'pass': {
            if (!canPass(view)) return { ok: false, reason: 'illegal' };
            state.passed[seat] = true;
            break;
        }
        default:
            return { ok: false, reason: 'bad_move' };
    }

    autoResolve(state);
    return { ok: true };
}

/**
 * Закрыть розыгрыш, если подкидывать больше некому.
 *
 * Кнопку «бито» в таком случае нажимать не за чем: карт нужного достоинства нет
 * ни у кого, и единственное, что можно сделать, — закончить. Нажатие, у которого
 * нет альтернативы, — это не решение игрока, а лишний клик.
 */
function autoResolve(state) {
    if (state.phase !== 'play' || !state.table.length) return;
    if (!state.taking && state.table.some(p => p.d == null)) return;   // ход защитника
    if (nextThrower(state) < 0) finishBout(state);
}

/** Порядок добора: главный атакующий, за ним подкидывавшие, защитник последним. */
function refillOrder(state) {
    const order = [];
    for (let k = 0; k < state.seats; k++) {
        const p = (state.attacker + k) % state.seats;
        if (p !== state.defender) order.push(p);
    }
    order.push(state.defender);
    return order;
}

/** Конец розыгрыша: карты со стола, добор и новые роли. */
function finishBout(state) {
    const def = state.defender;
    const took = state.taking;

    for (const pair of state.table) {
        if (took) {
            state.hands[def].push(pair.a);
            if (pair.d != null) state.hands[def].push(pair.d);
        } else {
            state.discard.push(pair.a);
            if (pair.d != null) state.discard.push(pair.d);
        }
    }
    if (took) sortHand(state.hands[def], state.trump);

    state.table = [];
    state.taking = false;
    state.passed = state.passed.map(() => false);

    for (const p of refillOrder(state)) {
        while (state.hands[p].length < HAND && state.deck.length) {
            state.hands[p].push(state.deck.pop());
        }
        sortHand(state.hands[p], state.trump);
    }

    // Розыгрыш, который кончился «бито», всегда отправляет карты в отбой —
    // значит, партия сдвинулась. Взятие не двигает ничего: те же карты остались
    // на руках, только в другой руке.
    state.idle = took && !state.deck.length ? state.idle + 1 : 0;

    if (checkOver(state)) return;

    // Отбился — ходит сам, взял — пропускает ход. Если отбившийся вышел из
    // партии (отбился последними картами), ходит следующий за ним.
    state.attacker = took || !alive(state, def) ? nextAlive(state, def) : def;
    state.defender = nextAlive(state, state.attacker);
    state.limit = Math.min(MAX_TABLE, state.hands[state.defender].length);
}

/**
 * Не кончилась ли партия.
 *
 * Пока в колоде есть карты, выйти нельзя: пустая рука доберётся. А когда колода
 * кончилась, вышедшие уходят из круга, и партия идёт до последнего с картами —
 * он и дурак. Разом опустевшие руки — ничья: дурака нет.
 */
function checkOver(state) {
    if (state.deck.length) return false;
    const left = [];
    for (let p = 0; p < state.seats; p++) if (alive(state, p)) left.push(p);
    if (left.length > 1) {
        // Карты ходят по кругу и партия не двигается — расходимся без дурака
        // (см. STALL_BOUTS).
        if (state.idle < STALL_BOUTS) return false;
        state.phase = 'over';
        state.loser = -1;
        state.reason = 'stall';
        return true;
    }
    state.phase = 'over';
    state.loser = left.length === 1 ? left[0] : -1;
    state.reason = left.length === 1 ? 'out' : 'draw';
    return true;
}

/**
 * Сдаться: сдавшийся объявляет дураком себя, партия кончается.
 *
 * Иначе проигрывающему выгодно закрыть вкладку — ровно та же причина, по которой
 * кнопка есть в бильярде.
 */
export function resign(state, seat) {
    if (state.phase !== 'play') return { ok: false, reason: 'over' };
    state.phase = 'over';
    state.loser = seat;
    state.reason = 'resign';
    return { ok: true };
}

/** Партию бросили — дураком становится тот, кого ждали. */
export function timeout(state, seat) {
    if (state.phase !== 'play') return { ok: false, reason: 'over' };
    state.phase = 'over';
    state.loser = seat;
    state.reason = 'timeout';
    return { ok: true };
}

// ── Хранение ─────────────────────────────────────────────────────────────────
// Позиция и так простая (числа и массивы чисел), но пишем serialize/deserialize
// явно: строка в базе не должна зависеть от того, какие служебные поля мы
// когда-нибудь заведём в объекте партии.

export function serialize(state) {
    return {
        mode: state.mode,
        seats: state.seats,
        trump: state.trump,
        deck: state.deck.slice(),
        hands: state.hands.map(h => h.slice()),
        discard: state.discard.slice(),
        attacker: state.attacker,
        defender: state.defender,
        table: state.table.map(p => ({ a: p.a, d: p.d })),
        taking: state.taking,
        passed: state.passed.slice(),
        limit: state.limit,
        idle: state.idle,
        phase: state.phase,
        loser: state.loser,
        reason: state.reason,
    };
}

export function deserialize(data) {
    const seats = Math.max(MIN_SEATS, Math.min(MAX_SEATS, data.seats | 0));
    return {
        mode: data.mode === PEREVODNOY ? PEREVODNOY : PODKIDNOY,
        seats,
        trump: data.trump | 0,
        deck: (data.deck || []).slice(),
        hands: Array.from({ length: seats }, (_, i) => (data.hands?.[i] || []).slice()),
        discard: (data.discard || []).slice(),
        attacker: data.attacker | 0,
        defender: data.defender | 0,
        table: (data.table || []).map(p => ({ a: p.a | 0, d: p.d == null ? null : p.d | 0 })),
        taking: !!data.taking,
        passed: Array.from({ length: seats }, (_, i) => !!data.passed?.[i]),
        limit: data.limit == null ? MAX_TABLE : data.limit | 0,
        idle: data.idle | 0,
        phase: data.phase === 'over' ? 'over' : 'play',
        loser: data.loser == null ? null : data.loser | 0,
        reason: data.reason || '',
    };
}

/** Копия партии — боту и тестам, чтобы проверять ходы, не трогая настоящую. */
export function cloneGame(state) {
    return deserialize(serialize(state));
}

// ── Человеческие подписи ─────────────────────────────────────────────────────
// Держим здесь, а не в окне: те же слова показывает и итог партии на сервере.

export const END_TEXT = {
    out: 'карты кончились',
    draw: 'вышли оба — ничья',
    stall: 'карты пошли по кругу — ничья',
    resign: 'сдался',
    timeout: 'не дождались хода',
};
