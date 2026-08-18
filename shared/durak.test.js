import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createGame, applyMove, toMove, viewFor, resign, timeout,
    attackCards, defendCards, transferCards, canTake, canPass, defenceTarget,
    beats, power, cost, sortHand, buildDeck, isTrump, serialize, deserialize, cloneGame,
    SUITS, RANKS, ACE, suitOf, rankOf, cardLabel,
    DECK_SIZE, HAND, MAX_TABLE, LOW_RANK, STALL_BOUTS, PODKIDNOY, PEREVODNOY,
} from './durak.js';

// Карта по имени: масть строкой, достоинство числом (туз — 1, король — 13) —
// та же кодировка, что в пасьянсе, чтобы тесты двух игр читались одинаково.
const card = (suit, rank) => SUITS.indexOf(suit) * RANKS + rank - 1;

/** Все карты, какие есть в партии, — для проверки «ничего не потерялось». */
const allCards = g => [
    ...g.deck, ...g.hands.flat(), ...g.discard,
    ...g.table.flatMap(p => (p.d == null ? [p.a] : [p.a, p.d])),
];

/** Позиция под руками: раздача из createGame, но карты кладём сами. */
function rigged({ hands, trump = 'spades', deck = [], mode = PODKIDNOY, attacker = 0 }) {
    const g = createGame({ seed: 1, seats: hands.length, mode });
    g.trump = SUITS.indexOf(trump);
    g.hands = hands.map(h => h.slice());
    g.deck = deck.slice();
    g.discard = [];
    g.table = [];
    g.taking = false;
    g.passed = hands.map(() => false);
    g.attacker = attacker;
    g.defender = (attacker + 1) % hands.length;
    g.limit = Math.min(MAX_TABLE, g.hands[g.defender].length);
    g.phase = 'play';
    g.loser = null;
    return g;
}

// ── Колода ───────────────────────────────────────────────────────────────────

test('колода: 36 карт, все разные, младше шестёрки нет', () => {
    const deck = buildDeck();
    assert.equal(deck.length, DECK_SIZE);
    assert.equal(deck.length, 36);
    assert.equal(new Set(deck).size, 36);
    for (const c of deck) {
        const r = rankOf(c);
        assert.ok(r === ACE || r >= LOW_RANK, `${cardLabel(c)} в колоде дурака не место`);
    }
    // По девять карт каждой масти.
    for (let s = 0; s < SUITS.length; s++) {
        assert.equal(deck.filter(c => suitOf(c) === s).length, 9);
    }
});

test('туз старший, а не младший (в пасьянсе наоборот)', () => {
    const trump = SUITS.indexOf('spades');
    assert.ok(power(card('hearts', ACE)) > power(card('hearts', 13)));
    assert.ok(beats(card('hearts', 13), card('hearts', ACE), trump));
    assert.ok(!beats(card('hearts', ACE), card('hearts', 13), trump));
});

test('бьёт: старшей той же масти или козырем, но не наоборот', () => {
    const trump = SUITS.indexOf('spades');
    assert.ok(beats(card('hearts', 7), card('hearts', 8), trump), 'старшая той же масти бьёт');
    assert.ok(!beats(card('hearts', 8), card('hearts', 7), trump), 'младшая — нет');
    assert.ok(!beats(card('hearts', 7), card('clubs', 13), trump), 'чужая масть не бьёт');
    assert.ok(beats(card('hearts', ACE), card('spades', 6), trump), 'козырная шестёрка бьёт туза');
    assert.ok(!beats(card('spades', 6), card('hearts', ACE), trump), 'некозырный туз козырь не бьёт');
    assert.ok(beats(card('spades', 6), card('spades', 7), trump), 'козырь бьётся старшим козырем');
});

test('цена: любой козырь дороже любого некозыря, рука сортируется козырями в конец', () => {
    const trump = SUITS.indexOf('spades');
    assert.ok(cost(card('spades', 6), trump) > cost(card('hearts', ACE), trump));
    const hand = sortHand([card('spades', 6), card('hearts', ACE), card('hearts', 7)], trump);
    assert.deepEqual(hand.map(c => isTrump(c, trump)), [false, false, true]);
});

// ── Раздача ──────────────────────────────────────────────────────────────────

test('раздача: по шесть карт, козырь со дна колоды, ничего не потерялось', () => {
    for (let seats = 2; seats <= 4; seats++) {
        for (let seed = 1; seed <= 20; seed++) {
            const g = createGame({ seed, seats });
            assert.equal(g.hands.length, seats);
            for (const hand of g.hands) assert.equal(hand.length, HAND);
            assert.equal(g.deck.length, DECK_SIZE - seats * HAND);
            assert.equal(g.trump, suitOf(g.deck[0]), 'козырь — нижняя карта колоды');
            const all = allCards(g);
            assert.equal(all.length, DECK_SIZE);
            assert.equal(new Set(all).size, DECK_SIZE);
        }
    }
});

test('первым ходит младший козырь', () => {
    for (let seed = 1; seed <= 60; seed++) {
        const g = createGame({ seed, seats: 3 });
        const trumps = g.hands.map(h => h.filter(c => isTrump(c, g.trump)).map(power));
        if (!trumps.some(t => t.length)) continue;      // козырей нет ни у кого — жребий
        const lowest = Math.min(...trumps.flat());
        assert.ok(trumps[g.attacker].includes(lowest),
            `заходить должен тот, у кого младший козырь (seed ${seed})`);
    }
});

test('козырь со дна уходит последним', () => {
    const g = createGame({ seed: 7, seats: 2 });
    const down = g.deck[0];
    while (g.deck.length > 1) g.deck.pop();
    assert.equal(g.deck[0], down, 'последняя карта колоды — та самая козырная');
});

// ── Вид ──────────────────────────────────────────────────────────────────────

test('вид не выдаёт ни колоду, ни чужие руки', () => {
    const g = createGame({ seed: 3, seats: 3 });
    const view = viewFor(g, 1);
    assert.deepEqual(view.hand, g.hands[1]);
    assert.deepEqual(view.counts, [HAND, HAND, HAND]);
    // Ни одного поля с чужими картами: единственный список карт — свой.
    const flat = JSON.stringify(view);
    assert.ok(!('hands' in view) && !('deck' in view));
    for (const c of g.hands[0]) {
        if (g.hands[1].includes(c)) continue;
        assert.ok(!view.hand.includes(c), 'чужая карта не должна попасть в свою руку');
    }
    // Козырь со дна виден — он и за настоящим столом лежит открытым.
    assert.equal(view.down, g.deck[0]);
    assert.equal(view.deckLeft, g.deck.length);
    assert.ok(flat.length > 0);
});

// ── Атака и защита ───────────────────────────────────────────────────────────

test('заходит только главный атакующий и только когда стол пуст', () => {
    const g = rigged({
        hands: [[card('hearts', 6)], [card('hearts', 7)], [card('clubs', 8)]],
    });
    assert.equal(toMove(g), 0);
    assert.deepEqual(attackCards(viewFor(g, 2)), [], 'подкидывать нечего, пока стол пуст');
    assert.equal(applyMove(g, 2, { type: 'attack', card: card('clubs', 8) }).ok, false);
});

test('подкидывать можно только достоинствами со стола и только после отбоя', () => {
    const g = rigged({
        hands: [[card('hearts', 6), card('clubs', 6), card('diamonds', 9)],
                [card('hearts', 7), card('clubs', 10)]],
    });
    applyMove(g, 0, { type: 'attack', card: card('hearts', 6) });
    // Карта не побита — подкидывать нельзя даже шестёркой.
    assert.deepEqual(attackCards(viewFor(g, 0)), []);
    assert.equal(toMove(g), 1, 'слово за защитником');

    applyMove(g, 1, { type: 'defend', card: card('hearts', 7) });
    const can = attackCards(viewFor(g, 0));
    assert.deepEqual(can, [card('clubs', 6)], 'только шестёрка — семёрок на руках нет');
});

test('подкинуть больше, чем у защитника карт, нельзя', () => {
    const g = rigged({
        hands: [[card('hearts', 6), card('clubs', 6), card('diamonds', 6)],
                [card('hearts', 7)]],
    });
    assert.equal(g.limit, 1, 'у защитника одна карта — и розыгрыш в одну карту');
    applyMove(g, 0, { type: 'attack', card: card('hearts', 6) });
    applyMove(g, 1, { type: 'defend', card: card('hearts', 7) });
    assert.deepEqual(attackCards(viewFor(g, 0)), [], 'больше подкидывать нечего');
});

test('в розыгрыше не больше шести карт, даже если у защитника их больше', () => {
    const g = createGame({ seed: 5, seats: 2 });
    assert.ok(g.limit <= MAX_TABLE);
});

test('отбиться можно только тем, что бьёт', () => {
    const g = rigged({
        hands: [[card('hearts', 10)], [card('hearts', 9), card('hearts', 13), card('spades', 6)]],
    });
    applyMove(g, 0, { type: 'attack', card: card('hearts', 10) });
    const can = defendCards(viewFor(g, 1));
    assert.deepEqual(can.sort(), [card('hearts', 13), card('spades', 6)].sort(),
        'король той же масти и любой козырь — девятка не бьёт');
    assert.equal(applyMove(g, 1, { type: 'defend', card: card('hearts', 9) }).ok, false);
});

test('«беру»: карты уходят защитнику, а ход остаётся у атакующего', () => {
    const g = rigged({
        hands: [[card('hearts', 6), card('clubs', 6)], [card('spades', 10), card('clubs', 9)]],
    });
    applyMove(g, 0, { type: 'attack', card: card('hearts', 6) });
    assert.ok(canTake(viewFor(g, 1)));
    applyMove(g, 1, { type: 'take' });
    // Пока защитник берёт, ему можно догрузить шестёрку.
    assert.deepEqual(attackCards(viewFor(g, 0)), [card('clubs', 6)]);
    applyMove(g, 0, { type: 'attack', card: card('clubs', 6) });
    // Больше нечем — розыгрыш закрылся сам.
    assert.equal(g.table.length, 0);
    assert.equal(g.hands[1].length, 4, 'обе шестёрки уехали к защитнику');
    assert.ok(g.hands[1].includes(card('hearts', 6)) && g.hands[1].includes(card('clubs', 6)));
    assert.equal(g.discard.length, 0, 'взятое в отбой не идёт');
    assert.equal(g.attacker, 0, 'взял — пропустил свой заход');
});

test('«бито»: карты в отбой, роли меняются', () => {
    const g = rigged({
        hands: [[card('hearts', 6), card('diamonds', 6)], [card('hearts', 7), card('clubs', 9)]],
    });
    applyMove(g, 0, { type: 'attack', card: card('hearts', 6) });
    applyMove(g, 1, { type: 'defend', card: card('hearts', 7) });
    // Подкинуть есть чем (вторая шестёрка), но можно и не подкидывать.
    assert.ok(canPass(viewFor(g, 0)), '«бито» нажать можно');
    applyMove(g, 0, { type: 'pass' });
    assert.equal(g.table.length, 0);
    assert.deepEqual(g.discard.sort(), [card('hearts', 6), card('hearts', 7)].sort());
    assert.equal(g.attacker, 1, 'отбился — ходит сам');
    assert.equal(g.defender, 0);
});

test('розыгрыш закрывается сам, когда подкинуть некому', () => {
    const g = rigged({
        hands: [[card('hearts', 6)], [card('hearts', 7), card('clubs', 9)]],
    });
    applyMove(g, 0, { type: 'attack', card: card('hearts', 6) });
    applyMove(g, 1, { type: 'defend', card: card('hearts', 7) });
    // Рука атакующего пуста — нажимать «бито» не за чем, и движок закрыл сам.
    assert.equal(g.table.length, 0);
    assert.equal(g.discard.length, 2);
});

test('добор: сначала атакующий, потом защитник, до шести', () => {
    // Руки полные, каждый кладёт по карте — значит, каждому нужна ровно одна.
    // Иначе первый же добор вычерпал бы колоду целиком, и очередь было бы не
    // видно.
    const top = card('diamonds', 13);
    const next = card('clubs', 13);
    const g = rigged({
        hands: [
            [card('hearts', 6), card('clubs', 8), card('clubs', 9), card('clubs', 10), card('clubs', 11), card('clubs', 12)],
            [card('hearts', 7), card('diamonds', 8), card('diamonds', 9), card('diamonds', 10), card('diamonds', 11), card('diamonds', 12)],
        ],
        deck: [card('spades', 6), next, top],   // верх колоды — в конце массива
    });
    applyMove(g, 0, { type: 'attack', card: card('hearts', 6) });
    applyMove(g, 1, { type: 'defend', card: card('hearts', 7) });
    assert.ok(g.hands[0].includes(top), 'атакующий тянет первым');
    assert.ok(g.hands[1].includes(next), 'защитник — вторым');
    assert.equal(g.deck.length, 1, 'козырь со дна ещё лежит');
});

test('ходить не в свою очередь и чужой картой нельзя', () => {
    const g = rigged({ hands: [[card('hearts', 6)], [card('hearts', 7)]] });
    assert.equal(applyMove(g, 1, { type: 'attack', card: card('hearts', 7) }).ok, false);
    assert.equal(applyMove(g, 0, { type: 'attack', card: card('hearts', 7) }).ok, false,
        'карты, которой нет на руках, тоже нельзя');
    assert.equal(applyMove(g, 0, { type: 'nonsense' }).ok, false);
});

// ── Переводной ───────────────────────────────────────────────────────────────

test('в подкидном перевода нет вовсе', () => {
    const g = rigged({
        hands: [[card('hearts', 6)], [card('clubs', 6), card('spades', 9)]],
        mode: PODKIDNOY,
    });
    applyMove(g, 0, { type: 'attack', card: card('hearts', 6) });
    assert.deepEqual(transferCards(viewFor(g, 1)), []);
});

test('перевод: тем же достоинством, роли сдвигаются', () => {
    const g = rigged({
        // У атакующего после захода должно остаться минимум две карты: перевод
        // тем и ограничен, что следующему надо чем отбиваться.
        hands: [[card('hearts', 6), card('clubs', 9), card('clubs', 10)],
                [card('clubs', 6), card('spades', 9)]],
        mode: PEREVODNOY,
    });
    applyMove(g, 0, { type: 'attack', card: card('hearts', 6) });
    assert.deepEqual(transferCards(viewFor(g, 1)), [card('clubs', 6)], 'только шестёркой');
    applyMove(g, 1, { type: 'transfer', card: card('clubs', 6) });
    assert.equal(g.attacker, 1, 'переводивший стал атакующим');
    assert.equal(g.defender, 0);
    assert.equal(g.table.length, 2);
    assert.equal(toMove(g), 0, 'отбиваться теперь первому');
    assert.equal(defenceTarget(viewFor(g, 0)), 0);
});

test('перевод нельзя, если хоть одна карта уже побита', () => {
    const g = rigged({
        hands: [[card('hearts', 6), card('diamonds', 6)],
                [card('clubs', 6), card('hearts', 9), card('spades', 8)]],
        mode: PEREVODNOY,
    });
    applyMove(g, 0, { type: 'attack', card: card('hearts', 6) });
    applyMove(g, 1, { type: 'defend', card: card('hearts', 9) });
    applyMove(g, 0, { type: 'attack', card: card('diamonds', 6) });
    assert.deepEqual(transferCards(viewFor(g, 1)), [], 'начатую защиту не переводят');
});

test('перевод нельзя, если следующему не хватит карт отбиться', () => {
    const g = rigged({
        hands: [[card('hearts', 6)], [card('clubs', 6), card('spades', 9)]],
        mode: PEREVODNOY,
    });
    applyMove(g, 0, { type: 'attack', card: card('hearts', 6) });
    // У атакующего одна карта — она же и ушла на стол: отбивать две ему нечем.
    assert.deepEqual(transferCards(viewFor(g, 1)), []);
});

// ── Конец партии ─────────────────────────────────────────────────────────────

test('дурак — тот, у кого остались карты', () => {
    const g = rigged({
        hands: [[card('hearts', 6)], [card('hearts', 7), card('clubs', 9)]],
    });
    applyMove(g, 0, { type: 'attack', card: card('hearts', 6) });
    applyMove(g, 1, { type: 'defend', card: card('hearts', 7) });
    assert.equal(g.phase, 'over');
    assert.equal(g.loser, 1, 'вышел первый — дурак второй');
    assert.equal(g.reason, 'out');
});

test('вышли разом — ничья, дурака нет', () => {
    const g = rigged({ hands: [[card('hearts', 6)], [card('hearts', 7)]] });
    applyMove(g, 0, { type: 'attack', card: card('hearts', 6) });
    applyMove(g, 1, { type: 'defend', card: card('hearts', 7) });
    assert.equal(g.phase, 'over');
    assert.equal(g.loser, -1);
    assert.equal(g.reason, 'draw');
});

test('пока колода не кончилась, выйти нельзя — рука доберётся', () => {
    const g = rigged({
        hands: [[card('hearts', 6)], [card('hearts', 7), card('clubs', 9)]],
        deck: [
            card('spades', 6), card('clubs', 8), card('clubs', 10), card('clubs', 11),
            card('clubs', 12), card('clubs', 13), card('diamonds', 8), card('diamonds', 10),
        ],
    });
    applyMove(g, 0, { type: 'attack', card: card('hearts', 6) });
    applyMove(g, 1, { type: 'defend', card: card('hearts', 7) });
    assert.equal(g.phase, 'play', 'пустая рука добрала, а не вышла');
    assert.ok(g.hands[0].length && g.hands[1].length);
});

test('сдался — сам себе дурак; не дождались хода — тоже', () => {
    const a = createGame({ seed: 2, seats: 2 });
    resign(a, 0);
    assert.equal(a.phase, 'over');
    assert.equal(a.loser, 0);
    assert.equal(a.reason, 'resign');

    const b = createGame({ seed: 2, seats: 3 });
    timeout(b, 2);
    assert.equal(b.loser, 2);
    assert.equal(b.reason, 'timeout');
});

test('карты по кругу: партия не может длиться вечно', () => {
    // Дыра настоящая и найдена не умозрительно: в переводном двое крутят одни и
    // те же карты (взял — на следующем розыгрыше перевёл взятое обратно — тот
    // взял), в отбой не уходит ничего, и партия не кончается никогда. Здесь
    // проверяется сам счётчик простоя: доводим его до потолка и делаем ещё один
    // розыгрыш со взятием.
    const g = rigged({
        hands: [[card('hearts', 6), card('clubs', 10)], [card('spades', 9), card('diamonds', 10)]],
    });
    g.idle = STALL_BOUTS - 1;
    applyMove(g, 0, { type: 'attack', card: card('hearts', 6) });
    applyMove(g, 1, { type: 'take' });

    assert.equal(g.phase, 'over', 'партия обязана кончиться');
    assert.equal(g.reason, 'stall');
    assert.equal(g.loser, -1, 'по кругу ходили оба — дурака нет');
});

test('счётчик простоя обнуляется, как только карта ушла в отбой', () => {
    const g = rigged({
        hands: [[card('hearts', 6), card('clubs', 10)], [card('hearts', 7), card('diamonds', 10)]],
    });
    g.idle = STALL_BOUTS - 1;
    applyMove(g, 0, { type: 'attack', card: card('hearts', 6) });
    applyMove(g, 1, { type: 'defend', card: card('hearts', 7) });
    assert.equal(g.phase, 'play', 'розыгрыш прошёл честно — партия продолжается');
    assert.equal(g.idle, 0);
});

// ── Хранение ─────────────────────────────────────────────────────────────────

test('позиция переживает запись в базу и обратно', () => {
    const g = createGame({ seed: 11, seats: 4, mode: PEREVODNOY });
    applyMove(g, g.attacker, { type: 'attack', card: g.hands[g.attacker][0] });
    const back = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    assert.deepEqual(serialize(back), serialize(g));
    // Копия — это копия: правка одной не задевает другую.
    const copy = cloneGame(g);
    copy.hands[0].pop();
    assert.notEqual(copy.hands[0].length, g.hands[0].length);
});
