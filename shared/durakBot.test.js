import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createGame, applyMove, toMove, viewFor, attackCards, defendCards,
    isTrump, suitOf, rankOf, cardLabel,
    SUITS, RANKS, MAX_TABLE, PODKIDNOY, PEREVODNOY,
} from './durak.js';
import { pickMove, LEVELS, EASY, NORMAL, HARD } from './durakBot.js';

const card = (suit, rank) => SUITS.indexOf(suit) * RANKS + rank - 1;

// Своя случайность с зерном: партия ботов должна повторяться ход в ход, иначе
// «сильный уровень выигрывает чаще» будет то проходить, то нет.
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

/** Партия ботов до конца. Возвращает, кто остался дураком (-1 — ничья). */
function play(levels, seed, mode = PODKIDNOY) {
    const game = createGame({ seed, seats: levels.length, mode });
    const rng = makeRng(seed * 131 + 7);
    for (let n = 0; game.phase === 'play'; n++) {
        assert.ok(n < 3000, 'партия ботов не кончается');
        const seat = toMove(game);
        assert.ok(seat >= 0, 'ходить некому, а партия жива');
        const move = pickMove(viewFor(game, seat), { level: levels[seat], rng });
        assert.ok(move, `бот (${levels[seat]}) не придумал ход`);
        const done = applyMove(game, seat, move);
        assert.ok(done.ok, `бот сходил незаконно: ${done.reason} ${JSON.stringify(move)}`);
    }
    return game.loser;
}

/** Сколько партий из ста выиграл уровень `a` у уровня `b` (без ничьих). */
function duel(a, b, games, mode) {
    let winsA = 0;
    let decided = 0;
    for (let seed = 1; seed <= games; seed++) {
        // Половину партий садим наоборот: заход в дураке — заметное
        // преимущество, и без пересадки мерился бы он, а не игра.
        const swap = seed % 2 === 0;
        const loser = play(swap ? [b, a] : [a, b], seed, mode);
        if (loser === -1) continue;
        const loserIsA = swap ? loser === 1 : loser === 0;
        if (!loserIsA) winsA++;
        decided++;
    }
    return winsA / decided;
}

test('уровней три, у каждого имя', () => {
    assert.deepEqual(LEVELS.map(l => l.id), [EASY, NORMAL, HARD]);
    for (const level of LEVELS) assert.ok(level.name.length);
});

test('бот всегда ходит законно и партия всегда кончается', () => {
    for (const seats of [2, 3, 4]) {
        for (const mode of [PODKIDNOY, PEREVODNOY]) {
            for (let seed = 1; seed <= 40; seed++) {
                const levels = [EASY, NORMAL, HARD, EASY].slice(0, seats);
                const loser = play(levels, seed, mode);
                assert.ok(loser === -1 || (loser >= 0 && loser < seats));
            }
        }
    }
});

test('уровни расставлены по силе, а не по названию', () => {
    // Числа деликатные: это не «бот обязан выигрывать столько-то», а «сильный
    // уровень обязан быть сильнее слабого». Зерно фиксировано, так что результат
    // повторяем — если правку бота эти проверки завалили, значит, она сдвинула
    // силу уровней, и это надо увидеть.
    const hardVsEasy = duel(HARD, EASY, 200, PODKIDNOY);
    const normalVsEasy = duel(NORMAL, EASY, 200, PODKIDNOY);
    const hardVsNormal = duel(HARD, NORMAL, 200, PODKIDNOY);

    assert.ok(hardVsEasy > 0.6, `Шулер против Новичка: ${(hardVsEasy * 100).toFixed(1)}%`);
    assert.ok(normalVsEasy > 0.6, `Любитель против Новичка: ${(normalVsEasy * 100).toFixed(1)}%`);
    // Разница между Любителем и Шулером МЕНЬШЕ, и это честно: счёт вышедших карт
    // решает в концовке, а до неё оба играют одинаково разумно.
    assert.ok(hardVsNormal > 0.5, `Шулер против Любителя: ${(hardVsNormal * 100).toFixed(1)}%`);
});

test('в переводном уровни тоже упорядочены', () => {
    assert.ok(duel(HARD, EASY, 150, PEREVODNOY) > 0.6);
});

test('новичок транжирит козыри, любитель и шулер — нет', () => {
    // Характер уровня виден не только по проценту побед: с одной и той же руки
    // новичок заходит козырной шестёркой (она младшая по номиналу), а те, кто
    // умеет считать, — некозырной девяткой.
    const game = createGame({ seed: 1, seats: 2 });
    game.trump = SUITS.indexOf('spades');
    game.hands = [
        [card('spades', 6), card('hearts', 9), card('hearts', 10)],
        [card('clubs', 11), card('clubs', 12), card('clubs', 13)],
    ];
    game.deck = [];
    game.table = [];
    game.attacker = 0;
    game.defender = 1;
    game.limit = 3;

    const view = viewFor(game, 0);
    const rng = makeRng(1);
    assert.equal(pickMove(view, { level: EASY, rng }).card, card('spades', 6));
    assert.equal(pickMove(view, { level: NORMAL, rng }).card, card('hearts', 9));
    assert.equal(pickMove(view, { level: HARD, rng }).card, card('hearts', 9));
});

test('козырь в подкидку не идёт (кроме новичка, который об этом не думает)', () => {
    const game = createGame({ seed: 1, seats: 2 });
    game.trump = SUITS.indexOf('spades');
    // На столе побитая шестёрка, на руках — только козырная шестёрка: подкинуть
    // её можно, но для сильных уровней это плохой размен.
    game.hands = [[card('spades', 6)], [card('clubs', 12), card('clubs', 13)]];
    game.deck = [];
    game.table = [{ a: card('hearts', 6), d: card('hearts', 7) }];
    game.attacker = 0;
    game.defender = 1;
    game.limit = 2;

    const view = viewFor(game, 0);
    assert.deepEqual(attackCards(view), [card('spades', 6)], 'подкинуть козырь МОЖНО');
    const rng = makeRng(1);
    assert.equal(pickMove(view, { level: NORMAL, rng }).type, 'pass', 'но любитель не станет');
    assert.equal(pickMove(view, { level: HARD, rng }).type, 'pass');
});

test('шулер при равной цене заходит с того, что соперник не побьёт', () => {
    // Колода пуста и играют двое — значит, всё, чего нет ни в своей руке, ни в
    // отбое, ни на столе, лежит у соперника. Это вычитание, а не подглядывание:
    // отбой окно показывает и человеку.
    //
    // Заход выбирается ИЗ РАВНЫХ ПО ЦЕНЕ: счёт карт не должен перевешивать
    // «ходи с младшего». Турнир это подтвердил — бот, который ради «не побьют»
    // придерживал мелочь, играл ХУЖЕ: в концовке выигрывает тот, кто быстрее
    // остаётся без карт, а не тот, кто чаще заставляет брать.
    const game = createGame({ seed: 1, seats: 2 });
    game.trump = SUITS.indexOf('spades');
    game.hands = [
        [card('hearts', 6), card('clubs', 6)],
        [card('hearts', 10), card('diamonds', 8)],
    ];
    game.deck = [];
    game.table = [];
    game.attacker = 0;
    game.defender = 1;
    game.limit = 2;
    // Отбой — всё остальное: тогда «неизвестное» это ровно рука соперника.
    const known = new Set(game.hands.flat());
    game.discard = [];
    for (let s = 0; s < SUITS.length; s++) {
        for (const r of [6, 7, 8, 9, 10, 11, 12, 13, 1]) {
            const c = s * RANKS + r - 1;
            if (!known.has(c)) game.discard.push(c);
        }
    }

    const view = viewFor(game, 0);
    const rng = makeRng(1);
    // Шестёрку червей соперник побьёт десяткой, шестёрку треф — нечем.
    assert.equal(pickMove(view, { level: HARD, rng }).card, card('clubs', 6),
        'из двух одинаковых по цене выбрал ту, что не бьётся');
    // Любитель считать не умеет: для него шестёрки неразличимы, и он берёт первую.
    assert.equal(pickMove(view, { level: NORMAL, rng }).card, card('hearts', 6));
});

test('отбиться нечем — бот берёт, а не встаёт', () => {
    const game = createGame({ seed: 1, seats: 2 });
    game.trump = SUITS.indexOf('spades');
    game.hands = [[card('hearts', 13)], [card('clubs', 8), card('diamonds', 9)]];
    game.deck = [];
    game.table = [{ a: card('hearts', 13), d: null }];
    game.hands[0] = [card('hearts', 6)];
    game.attacker = 0;
    game.defender = 1;
    game.limit = 2;

    const view = viewFor(game, 1);
    assert.deepEqual(defendCards(view), [], 'бить нечем');
    for (const level of [EASY, NORMAL, HARD]) {
        assert.equal(pickMove(view, { level, rng: makeRng(1) }).type, 'take');
    }
});

test('бот получает только вид: чужих карт в нём нет физически', () => {
    const game = createGame({ seed: 4, seats: 3 });
    const view = viewFor(game, 0);
    // Единственный список карт в виде — своя рука, стол и отбой. Ни колоды, ни
    // чужих рук в объекте не существует, поэтому подглядеть боту нечего.
    assert.ok(!('hands' in view));
    assert.ok(!('deck' in view));
    const move = pickMove(view, { level: HARD, rng: makeRng(1) });
    assert.ok(move && applyMove(game, 0, move).ok || toMove(game) !== 0);
});
