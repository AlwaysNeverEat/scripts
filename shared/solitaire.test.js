import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createGame, move, draw, taken, canDrop, autoTarget, autoStep, canAutoFinish,
    hasMove, tick, isPlausibleRun,
    canDropOnFoundation, canDropOnTableau, topCard, cardLabel,
    suitOf, rankOf, isRed, spriteCol, spriteRow,
    SUITS, RANKS, DECK, PILES, ACE, KING, STOCK, WASTE, TABLEAU, FOUNDATION,
    MIN_MOVES, MIN_SECONDS,
} from './solitaire.js';

// Раздачи с зерном повторяемы — иначе половина тестов была бы «как повезёт».
const g = (seed = 1) => createGame({ seed });

// Карта по имени: масть строкой, достоинство числом (туз — 1, король — 13).
const card = (suit, rank) => SUITS.indexOf(suit) * RANKS + rank - 1;

// Тестам нужна не случайная раздача, а разобранная позиция: пустой стол, из
// которого руками выкладывается ровно проверяемое.
function empty() {
    const game = g();
    game.stock = [];
    game.waste = [];
    game.found = SUITS.map(() => []);
    game.piles = Array.from({ length: PILES }, () => ({ cards: [], down: 0 }));
    return game;
}

test('колода: 52 карты, каждая по разу, ни одна не потерялась при раздаче', () => {
    for (let seed = 1; seed <= 20; seed++) {
        const game = g(seed);
        const all = [
            ...game.stock, ...game.waste,
            ...game.found.flat(),
            ...game.piles.flatMap(p => p.cards),
        ];
        assert.equal(all.length, DECK);
        assert.equal(new Set(all).size, DECK, 'дублей нет');
        assert.ok(all.every(c => c >= 0 && c < DECK));
    }
});

test('раздача: столбцы 1..7 карт, открыта верхняя, в колоде остаток', () => {
    const game = g(7);
    game.piles.forEach((pile, i) => {
        assert.equal(pile.cards.length, i + 1);
        assert.equal(pile.down, i, 'закрыты все, кроме верхней');
    });
    assert.equal(game.stock.length, DECK - 28);
    assert.equal(game.waste.length, 0);
    assert.equal(game.moves, 0);
    assert.equal(game.won, false);
});

test('спрайт: строка — масть, столбец — достоинство, туз в конце ряда', () => {
    assert.equal(spriteRow(card('hearts', 5)), 0);
    assert.equal(spriteRow(card('spades', 5)), 3);
    assert.equal(spriteCol(card('clubs', 2)), 0, 'двойка — первый столбец');
    assert.equal(spriteCol(card('clubs', 10)), 8);
    assert.equal(spriteCol(card('clubs', 11)), 9, 'валет');
    assert.equal(spriteCol(card('clubs', KING)), 11);
    assert.equal(spriteCol(card('clubs', ACE)), 12, 'туз — последний столбец');
    // Ни одна карта не должна вылезти за 13×4 спрайта.
    for (let c = 0; c < DECK; c++) {
        assert.ok(spriteCol(c) >= 0 && spriteCol(c) < RANKS);
        assert.ok(spriteRow(c) >= 0 && spriteRow(c) < SUITS.length);
    }
});

test('красное и чёрное: черви и бубны — красные', () => {
    assert.ok(isRed(card('hearts', ACE)));
    assert.ok(isRed(card('diamonds', 7)));
    assert.ok(!isRed(card('clubs', 7)));
    assert.ok(!isRed(card('spades', KING)));
    assert.equal(cardLabel(card('spades', KING)), 'К♠');
    assert.equal(cardLabel(card('hearts', ACE)), 'Т♥');
});

test('на базу: своей мастью, по возрастанию, начиная с туза', () => {
    const game = empty();
    const suit = SUITS.indexOf('hearts');
    assert.ok(canDropOnFoundation(card('hearts', ACE), game, suit));
    assert.ok(!canDropOnFoundation(card('hearts', 2), game, suit), 'двойка вперёд туза не идёт');
    assert.ok(!canDropOnFoundation(card('clubs', ACE), game, suit), 'чужая масть');
    game.found[suit].push(card('hearts', ACE));
    assert.ok(canDropOnFoundation(card('hearts', 2), game, suit));
    assert.ok(!canDropOnFoundation(card('hearts', 3), game, suit), 'через одну нельзя');
});

test('на стол: другим цветом и на единицу младше, пустой столбец ждёт короля', () => {
    const game = empty();
    assert.ok(canDropOnTableau(card('spades', KING), game, 0), 'пустой — только король');
    assert.ok(!canDropOnTableau(card('spades', 5), game, 0));

    game.piles[0].cards.push(card('spades', 8));
    assert.ok(canDropOnTableau(card('hearts', 7), game, 0), 'красная семёрка на чёрную восьмёрку');
    assert.ok(!canDropOnTableau(card('clubs', 7), game, 0), 'свой цвет нельзя');
    assert.ok(!canDropOnTableau(card('hearts', 6), game, 0), 'через одну нельзя');
    assert.ok(!canDropOnTableau(card('hearts', 9), game, 0), 'старше нельзя');
});

test('со стола берётся карта вместе со всем, что на ней; закрытую не взять', () => {
    const game = empty();
    game.piles[0] = {
        cards: [card('clubs', 4), card('spades', KING), card('hearts', 12), card('clubs', 11)],
        down: 1,
    };
    assert.deepEqual(taken(game, { zone: TABLEAU, pile: 0, index: 1 }).length, 3, 'король и всё на нём');
    assert.deepEqual(taken(game, { zone: TABLEAU, pile: 0, index: 3 }).length, 1, 'одна верхняя');
    assert.deepEqual(taken(game, { zone: TABLEAU, pile: 0, index: 0 }), [], 'закрытую не берём');
});

test('ход открывает карту под уехавшей стопкой и считается один раз', () => {
    const game = empty();
    game.piles[0] = { cards: [card('clubs', 4), card('hearts', 6)], down: 1 };
    game.piles[1] = { cards: [card('spades', 7)], down: 0 };

    assert.ok(move(game, { zone: TABLEAU, pile: 0, index: 1 }, { zone: TABLEAU, pile: 1 }));
    assert.equal(game.moves, 1);
    assert.deepEqual(game.piles[0].cards, [card('clubs', 4)]);
    assert.equal(game.piles[0].down, 0, 'нижняя открылась');
    assert.equal(game.piles[1].cards.length, 2);
});

test('ход не по правилам ничего не меняет', () => {
    const game = empty();
    game.piles[0] = { cards: [card('hearts', 6)], down: 0 };
    game.piles[1] = { cards: [card('hearts', 7)], down: 0 };
    assert.ok(!move(game, { zone: TABLEAU, pile: 0, index: 0 }, { zone: TABLEAU, pile: 1 }));
    assert.equal(game.moves, 0);
    assert.equal(game.piles[0].cards.length, 1);
    assert.equal(game.piles[1].cards.length, 1);
});

test('стопку из двух карт на базу не положить', () => {
    const game = empty();
    game.piles[0] = { cards: [card('spades', 2), card('hearts', ACE)], down: 0 };
    const cards = taken(game, { zone: TABLEAU, pile: 0, index: 0 });
    assert.equal(cards.length, 2);
    assert.ok(!canDrop(game, cards, { zone: FOUNDATION, pile: suitOf(card('spades', 2)) }));
});

test('карта возвращается с базы на стол', () => {
    const game = empty();
    const suit = SUITS.indexOf('hearts');
    game.found[suit] = [card('hearts', ACE), card('hearts', 2)];
    game.piles[0] = { cards: [card('spades', 3)], down: 0 };
    assert.ok(move(game, { zone: FOUNDATION, pile: suit }, { zone: TABLEAU, pile: 0 }));
    assert.equal(game.found[suit].length, 1);
    assert.equal(topCard(game, TABLEAU, 0), card('hearts', 2));
});

test('колода: карта в отбой, пустая колода перекладывается тем же порядком', () => {
    const game = empty();
    game.stock = [card('clubs', 2), card('clubs', 3)];

    assert.equal(draw(game), 'draw');
    assert.deepEqual(game.waste, [card('clubs', 3)], 'тянем с конца');
    assert.equal(draw(game), 'draw');
    assert.equal(game.stock.length, 0);

    assert.equal(draw(game), 'redeal');
    assert.equal(game.redeals, 1);
    assert.equal(game.waste.length, 0);
    // Круг повторяется: порядок карт после перекладывания тот же самый.
    assert.equal(draw(game), 'draw');
    assert.deepEqual(game.waste, [card('clubs', 3)]);

    const dead = empty();
    assert.equal(draw(dead), null, 'ни колоды, ни отбоя — тянуть нечего');
});

test('клик: сначала база, потом стол, на пустой столбец — в последнюю очередь', () => {
    const game = empty();
    const hearts = SUITS.indexOf('hearts');
    game.waste = [card('hearts', ACE)];
    assert.deepEqual(autoTarget(game, { zone: WASTE }), { zone: FOUNDATION, pile: hearts });

    game.waste = [card('hearts', 7)];
    game.piles[3] = { cards: [card('spades', 8)], down: 0 };
    assert.deepEqual(autoTarget(game, { zone: WASTE }), { zone: TABLEAU, pile: 3 });

    // Королю деваться некуда, кроме пустого столбца, — туда и уедет.
    game.waste = [card('hearts', KING)];
    assert.deepEqual(autoTarget(game, { zone: WASTE }), { zone: TABLEAU, pile: 0 });

    // А обычной карте пустой столбец кликом не предлагаем вовсе.
    game.waste = [card('hearts', 4)];
    assert.equal(autoTarget(game, { zone: WASTE }), null);
});

// Позиция «всё открыто»: четыре столбца, сложенные по правилам от короля к
// тузу. Именно так выглядит партия, доигранная руками, — и только такую
// раскладку автосбор обязан добивать (см. canAutoFinish).
function allFaceUp() {
    const game = empty();
    const run = (odd, even) => {
        const cards = [];
        for (let rank = KING; rank >= ACE; rank--) {
            cards.push(card(rank % 2 ? odd : even, rank));
        }
        return cards;
    };
    game.piles[0].cards = run('spades', 'hearts');
    game.piles[1].cards = run('hearts', 'spades');
    game.piles[2].cards = run('clubs', 'diamonds');
    game.piles[3].cards = run('diamonds', 'clubs');
    // Раскладка обязана быть законной, иначе тест проверяет не то, что кажется.
    for (const pile of game.piles) {
        for (let i = 1; i < pile.cards.length; i++) {
            const under = pile.cards[i - 1];
            const over = pile.cards[i];
            assert.ok(isRed(under) !== isRed(over) && rankOf(over) === rankOf(under) - 1);
        }
    }
    return game;
}

test('автосбор доигрывает открытую раскладку до победы', () => {
    const game = allFaceUp();
    assert.ok(canAutoFinish(game));

    let steps = 0;
    while (!game.won && steps < 5_000) { if (!autoStep(game)) break; steps++; }
    assert.ok(game.won, 'партия разложена');
    assert.ok(game.found.every(f => f.length === RANKS));
    assert.equal(game.moves, DECK, 'ровно 52 хода — каждая карта уехала один раз');
    assert.equal(autoStep(game), null, 'после победы шагов нет');
});

test('автосбор достаёт карты из колоды, а не только со стола', () => {
    const game = allFaceUp();
    // Четвёртый столбец убираем в колоду: до этих карт автосбор доберётся,
    // только прокрутив её.
    game.stock = game.piles[3].cards;
    game.piles[3].cards = [];

    let steps = 0;
    while (!game.won && steps < 5_000) { if (!autoStep(game)) break; steps++; }
    assert.ok(game.won, 'партия разложена');
    assert.ok(game.moves > DECK, 'колоду пришлось крутить, и это тоже ходы');
});

test('автосбор перекладывает колоду, когда нужная карта в отбое под чужой', () => {
    const game = empty();
    const diamonds = SUITS.indexOf('diamonds');
    // Тянем с конца: сначала двойка (класть её ещё некуда), потом король
    // (накрывает её в отбое), потом туз. После туза двойка лежит ПОД королём —
    // достать её можно только перекладыванием.
    game.stock = [card('diamonds', ACE), card('diamonds', KING), card('diamonds', 2)];

    let steps = 0;
    while (steps < 500) { if (!autoStep(game)) break; steps++; }
    assert.deepEqual(game.found[diamonds], [card('diamonds', ACE), card('diamonds', 2)]);
    assert.ok(game.redeals > 0, 'колоду переложили');
});

test('автосбор не зацикливается на колоде, из которой ничего не разложить', () => {
    const game = empty();
    // Ни одного туза наверху и класть некуда: единственное, что может делать
    // автосбор, — крутить колоду. Он обязан остановиться.
    game.stock = [card('clubs', 5), card('hearts', 9), card('spades', 4)];
    game.piles[0] = { cards: [card('diamonds', 6)], down: 0 };
    let steps = 0;
    while (autoStep(game) && steps < 1_000) steps++;
    assert.ok(steps < 1_000, 'шаги кончились');
    assert.ok(!game.won);
});

test('автосбор недоступен, пока на столе есть закрытые карты', () => {
    assert.ok(!canAutoFinish(g(3)));
});

test('ходы кончились: колода пуста, разложить нечего', () => {
    const game = empty();
    game.piles[0] = { cards: [card('clubs', 5)], down: 0 };
    game.piles[1] = { cards: [card('spades', 9)], down: 0 };
    assert.ok(!hasMove(game), 'на базы рано, друг на друга не ложатся');

    game.piles[1] = { cards: [card('hearts', 6)], down: 0 };
    assert.ok(hasMove(game), 'чёрная пятёрка ложится на красную шестёрку');

    // Карта в колоде тоже ход: до неё можно докрутить.
    const withStock = empty();
    withStock.piles[0] = { cards: [card('clubs', 5)], down: 0 };
    withStock.stock = [card('hearts', 4)];
    assert.ok(hasMove(withStock));
    // А если та же карта никуда не ложится — ход крутить колоду не считается.
    withStock.stock = [card('hearts', 9)];
    assert.ok(!hasMove(withStock));
});

test('новая раздача играется: ход есть всегда', () => {
    for (let seed = 1; seed <= 30; seed++) assert.ok(hasMove(g(seed)));
});

test('секундомер стоит на выигранной партии', () => {
    const game = empty();
    tick(game, 1_500);
    assert.equal(game.elapsedMs, 1_500);
    game.won = true;
    tick(game, 1_000);
    assert.equal(game.elapsedMs, 1_500);
});

test('проверка результата: настоящая партия проходит, мусор отсеивается', () => {
    assert.ok(isPlausibleRun({ seconds: 240, moves: 180, redeals: 3 }).ok);
    assert.ok(isPlausibleRun({ seconds: MIN_SECONDS, moves: MIN_MOVES, redeals: 0 }).ok);

    const bad = run => {
        const res = isPlausibleRun(run);
        assert.ok(!res.ok, `должно быть отклонено: ${JSON.stringify(run)}`);
        return res.reason;
    };
    assert.equal(bad({ seconds: 0, moves: 200, redeals: 0 }), 'too_fast');
    assert.equal(bad({ seconds: 240, moves: 10, redeals: 0 }), 'too_few_moves');
    assert.equal(bad({ seconds: 60, moves: 5_000, redeals: 0 }), 'too_fast', 'полтысячи ходов в минуту');
    assert.equal(bad({ seconds: 99_999, moves: 200, redeals: 0 }), 'too_long');
    assert.equal(bad({ seconds: 240, moves: 200, redeals: 500 }), 'redeals_vs_moves');
    assert.equal(bad({ seconds: 240.5, moves: 200, redeals: 1 }), 'shape');
    assert.equal(bad({ seconds: -1, moves: 200, redeals: 1 }), 'shape');
    assert.equal(bad({ seconds: 240, moves: 'сто', redeals: 1 }), 'shape');
});

test('партия целиком: раздачу с зерном можно разложить и она это признаёт', () => {
    // Проверяем не «выигрышность раздачи», а связность правил: раскладываем
    // партию не по правилам, а прямо на базы через ходы — и смотрим, что
    // победа наступает ровно после последней карты.
    const game = empty();
    for (let suit = 0; suit < SUITS.length; suit++) {
        for (let rank = ACE; rank <= KING; rank++) {
            game.piles[0].cards = [suit * RANKS + rank - 1];
            assert.ok(move(game, { zone: TABLEAU, pile: 0, index: 0 }, { zone: FOUNDATION, pile: suit }));
            const last = suit === SUITS.length - 1 && rank === KING;
            assert.equal(game.won, last);
        }
    }
    assert.equal(game.moves, DECK);
    assert.equal(topCard(game, STOCK), -1);
});
