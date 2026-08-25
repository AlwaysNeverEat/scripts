import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    SIZE, CELLS, EMPTY, W_MAN, W_KING, B_MAN, B_KING, WHITE, BLACK,
    IDLE_PLIES, at, xOf, yOf, isDark, cellName, colorOf, isKing,
    createGame, startBoard, legalMoves, movesFrom, mustCapture, hasMoves,
    applyMove, resign, timeout, agreeDraw, counts, toMove, awaited,
    serialize, deserialize, cloneGame, colorOfSeat, seatOfColor,
} from './checkers.js';

// ── Позиция из картинки ──────────────────────────────────────────────────────
// Позиции в тестах шашек нельзя писать списком клеток: «белая на 18, чёрные на
// 22 и 27» невозможно проверить глазами, а именно глазами их и проверяют. Восемь
// строк по восемь знаков читаются как доска: сверху восьмая горизонталь, слева
// поле «a». Знаки: w/W — белая простая и дамка, b/B — чёрные, точка — пусто.
function boardOf(rows) {
    assert.equal(rows.length, SIZE, 'доска — восемь строк');
    const board = new Array(CELLS).fill(EMPTY);
    rows.forEach((row, y) => {
        assert.equal(row.length, SIZE, `строка ${y} — восемь знаков`);
        [...row].forEach((ch, x) => {
            const piece = { w: W_MAN, W: W_KING, b: B_MAN, B: B_KING }[ch];
            if (!piece) return;
            assert.ok(isDark(at(x, y)), `${cellName(at(x, y))} — белое поле, на нём не играют`);
            board[at(x, y)] = piece;
        });
    });
    return board;
}

/** Партия из картинки. Всё остальное — как в начале: никто ничего не бил. */
function position(rows, turn = WHITE) {
    const game = createGame({ seed: 1 });
    game.board = boardOf(rows);
    game.turn = turn;
    game.seats = [WHITE, BLACK];
    return game;
}

const sq = name => at('abcdefgh'.indexOf(name[0]), SIZE - Number(name[1]));
/** Ходы человеческими именами полей — их и сверяем в тестах. */
const movesText = state => legalMoves(state)
    .map(m => `${cellName(m.from)}${m.cap >= 0 ? ':' : '-'}${cellName(m.to)}`).sort();

const go = (state, from, to) => applyMove(state, state.turn, { from: sq(from), to: sq(to) });

// ── Доска ────────────────────────────────────────────────────────────────────

test('поле — одно число, координаты и имя считаются обратно', () => {
    for (let i = 0; i < CELLS; i++) assert.equal(at(xOf(i), yOf(i)), i);
    assert.equal(cellName(sq('a1')), 'a1');
    assert.equal(cellName(sq('h8')), 'h8');
    // Играют по тёмным, и тёмная — слева снизу.
    assert.ok(isDark(sq('a1')));
    assert.ok(!isDark(sq('a8')));
});

test('в начале партии по двенадцать шашек и семь ходов у белых', () => {
    const game = createGame({ seed: 3 });
    assert.deepEqual(counts(game), [{ men: 12, kings: 0 }, { men: 12, kings: 0 }]);
    assert.equal(game.turn, WHITE);
    assert.deepEqual(movesText(game), [
        'a3-b4', 'c3-b4', 'c3-d4', 'e3-d4', 'e3-f4', 'g3-f4', 'g3-h4',
    ]);
    // Средний ряд пуст, крайние заняты — иначе картинка собрана неверно.
    assert.equal(startBoard()[sq('d4')], EMPTY);
    assert.equal(startBoard()[sq('a1')], W_MAN);
    assert.equal(startBoard()[sq('h8')], B_MAN);
});

test('белые ходят первыми, а белый цвет достаётся жребию', () => {
    // Право первого хода в шашках заметное, поэтому разыгрывается не «кто
    // ходит», а «кому белые»: партия всегда начинается ходом белых.
    const seen = new Set();
    for (let seed = 1; seed <= 40; seed++) {
        const game = createGame({ seed });
        assert.equal(game.turn, WHITE);
        seen.add(seatOfColor(game, WHITE));
        assert.equal(colorOfSeat(game, seatOfColor(game, WHITE)), WHITE);
        assert.equal(toMove(game), seatOfColor(game, WHITE));
        assert.equal(awaited(game), toMove(game));
    }
    assert.deepEqual([...seen].sort(), [0, 1], 'белые достаются то одному месту, то другому');
});

// ── Простая ──────────────────────────────────────────────────────────────────

test('простая ходит только вперёд, а бьёт в обе стороны', () => {
    const forward = position([
        '........',
        '........',
        '........',
        '........',
        '........',
        '..w.....',
        '........',
        '........',
    ]);
    assert.deepEqual(movesText(forward), ['c3-b4', 'c3-d4']);

    // Назад ходить нельзя, а бить назад — можно: этим русские шашки отличаются
    // от английских, и на этом стоит половина комбинаций.
    const back = position([
        '........',
        '........',
        '........',
        '....w...',
        '...b....',
        '........',
        '........',
        '........',
    ]);
    assert.deepEqual(movesText(back), ['e5:c3']);
});

test('бить обязательно, но какой бой выбрать — дело игрока', () => {
    const game = position([
        '........',
        '........',
        '........',
        '..b.b...',
        '...w....',
        '........',
        '........',
        '........',
    ]);
    // Тихие ходы есть (d4-c5, d4-e5), но их не предлагают вовсе.
    assert.ok(mustCapture(game));
    assert.deepEqual(movesText(game), ['d4:b6', 'd4:f6']);
});

test('можно взять одну, когда рядом лежит цепочка из двух: большинство не обязательно', () => {
    const game = position([
        '........',
        '..b.....',
        '........',
        '..b.b...',
        '...w....',
        '........',
        '........',
        '........',
    ]);
    // Слева — цепочка (взяли c5, с b6 берём ещё и c7), справа — одинокая e5.
    // Обе законны:
    // в русских шашках бить максимум не обязательно.
    assert.deepEqual(movesText(game), ['d4:b6', 'd4:f6']);
    const one = cloneGame(game);
    assert.equal(go(one, 'd4', 'f6').again, false, 'взяли одну — ход окончен');
    assert.equal(one.turn, BLACK);
});

// ── Цепочка и турецкий удар ──────────────────────────────────────────────────

test('цепочка: ход остаётся у побившей шашки, и ходить можно только ею', () => {
    const game = position([
        '........',
        '..b.....',
        '........',
        '..b.b...',
        '...w....',
        '........',
        '........',
        '..w.....',
    ]);
    const first = go(game, 'd4', 'b6');
    assert.equal(first.again, true);
    assert.equal(game.turn, WHITE, 'очередь не перешла');
    assert.equal(game.chain, sq('b6'));
    // Вторая белая шашка на доске есть, но ходить ею нельзя.
    assert.deepEqual(movesText(game), ['b6:d8']);
});

test('побитая шашка остаётся на доске до конца цепочки и снимается вся разом', () => {
    const game = position([
        '........',
        '..b.....',
        '........',
        '..b.....',
        '...w....',
        '........',
        '........',
        '........',
    ]);
    go(game, 'd4', 'b6');
    // Турецкий удар: c5 побита, но ещё стоит — снимают побитое в конце хода.
    assert.equal(game.board[sq('c5')], B_MAN);
    assert.deepEqual(game.captured, [sq('c5')]);
    go(game, 'b6', 'd8');
    assert.equal(game.board[sq('c5')], EMPTY);
    assert.equal(game.board[sq('c7')], EMPTY);
    assert.deepEqual(game.captured, []);
    assert.equal(game.chain, -1);
    assert.equal(game.phase, 'over', 'чёрных не осталось');
    assert.deepEqual(counts(game), [{ men: 0, kings: 1 }, { men: 0, kings: 0 }]);
});

test('через уже побитую прыгнуть второй раз нельзя — она мешает, как своя', () => {
    const game = position([
        '........',
        '........',
        '.....b..',
        '........',
        '........',
        '..b.....',
        '........',
        'W.......',
    ]);
    go(game, 'a1', 'd4');
    // Побитая c3 всё ещё на доске, и путь назад через неё закрыт: без этого
    // правила дамка вернулась бы на b2, побив c3 второй раз.
    assert.equal(game.board[sq('c3')], B_MAN);
    assert.deepEqual(movesText(game), ['d4:g7', 'd4:h8']);
});

// ── Дамка ────────────────────────────────────────────────────────────────────

test('дамка летает по диагонали и бьёт на расстоянии, садясь где хочет', () => {
    const fly = position([
        '........',
        '........',
        '........',
        '........',
        '...W....',
        '........',
        '........',
        '........',
    ]);
    // Все четыре диагонали до края.
    assert.deepEqual(movesText(fly), [
        'd4-a1', 'd4-a7', 'd4-b2', 'd4-b6', 'd4-c3', 'd4-c5',
        'd4-e3', 'd4-e5', 'd4-f2', 'd4-f6', 'd4-g1', 'd4-g7', 'd4-h8',
    ]);

    const hit = position([
        '........',
        '........',
        '.....b..',
        '........',
        '........',
        '........',
        '........',
        'W.......',
    ]);
    // Сесть можно на любое свободное поле за побитой — это и есть «дамка бьёт
    // на расстоянии», а не «дамка прыгает через одну».
    assert.deepEqual(movesText(hit), ['a1:g7', 'a1:h8']);

    const blocked = position([
        '........',
        '......b.',
        '.....b..',
        '........',
        '........',
        '........',
        '........',
        'W.......',
    ]);
    // За побитой f6 стоит своя же чёрная g7 — сесть некуда, боя нет вовсе,
    // и дамка ходит тихо до упора в f6.
    assert.deepEqual(movesText(blocked), ['a1-b2', 'a1-c3', 'a1-d4', 'a1-e5']);
});

test('своя шашка на диагонали останавливает дамку, а не подставляется', () => {
    const game = position([
        '........',
        '........',
        '.....w..',
        '........',
        '........',
        '........',
        '........',
        'W.......',
    ]);
    // Своя f6 не бьётся и не перепрыгивается — дамка упирается в неё; сама f6
    // при этом ходит как обычная простая.
    assert.deepEqual(movesText(game), [
        'a1-b2', 'a1-c3', 'a1-d4', 'a1-e5', 'f6-e7', 'f6-g7',
    ]);
});

// ── Превращение ──────────────────────────────────────────────────────────────

test('простая, дошедшая до последнего ряда, становится дамкой', () => {
    const game = position([
        '........',
        '..w.....',
        '........',
        '........',
        '........',
        '........',
        '........',
        '........',
    ]);
    go(game, 'c7', 'd8');
    assert.equal(game.board[sq('d8')], W_KING);
    assert.equal(game.last.promoted, true);
});

test('простая, попавшая в дамки ПОСРЕДИ боя, бьёт дальше уже дамкой', () => {
    // Главное отличие русских шашек от международных, где она обязана
    // остановиться. На нём стоят все комбинации «в дамки с боем».
    const game = position([
        '........',
        '..b.....',
        '.w...b..',
        '........',
        '........',
        '........',
        '........',
        '........',
    ]);
    const hop = go(game, 'b6', 'd8');
    assert.equal(game.board[sq('d8')], W_KING, 'превратилась сразу');
    assert.equal(hop.again, true, 'и обязана продолжить бой');
    // Простая с d8 отсюда не побила бы ничего: f6 стоит через клетку.
    assert.deepEqual(movesText(game), ['d8:g5', 'd8:h4']);
    go(game, 'd8', 'h4');
    assert.deepEqual(counts(game), [{ men: 0, kings: 1 }, { men: 0, kings: 0 }]);
});

// ── Конец партии ─────────────────────────────────────────────────────────────

test('победа, когда у соперника не осталось шашек', () => {
    const game = position([
        '........',
        '........',
        '........',
        '........',
        '........',
        '..b.....',
        '.w......',
        '........',
    ]);
    go(game, 'b2', 'd4');
    assert.equal(game.phase, 'over');
    assert.equal(game.winner, WHITE);
    assert.equal(game.reason, 'wiped');
    assert.equal(toMove(game), -1);
});

test('запертый проигрывает так же, как съеденный', () => {
    const game = position([
        '........',
        '........',
        '........',
        '........',
        '........',
        'b.b.....',
        '........',
        'w.......',
    ], BLACK);
    go(game, 'a3', 'b2');
    assert.equal(game.phase, 'over');
    assert.equal(game.winner, BLACK);
    assert.equal(game.reason, 'blocked', 'шашка есть, а ходить нечем');
});

test('пятнадцать ходов дамками без взятий — ничья', () => {
    const game = position([
        '.B......',
        '........',
        '........',
        '........',
        '........',
        '........',
        '........',
        'W.......',
    ]);
    // Дамки ходят по своим углам и не встречаются: боя нет ни у кого, простых
    // на доске нет — партия стоит на месте, и счётчик это ловит.
    const cycle = [['a1', 'b2'], ['b8', 'a7'], ['b2', 'a1'], ['a7', 'b8']];
    for (let ply = 0; ply < IDLE_PLIES; ply++) {
        const [from, to] = cycle[ply % 4];
        assert.equal(go(game, from, to).ok, true, `полуход ${ply + 1}`);
        assert.equal(game.phase, ply === IDLE_PLIES - 1 ? 'over' : 'play');
    }
    assert.equal(game.phase, 'over');
    assert.equal(game.winner, null, 'ничья — победителя нет');
    assert.equal(game.reason, 'draw');
});

test('ход простой и взятие обнуляют счётчик ничьей', () => {
    const game = position([
        '.B......',
        '........',
        '........',
        '........',
        '........',
        '........',
        '........',
        'W.w.....',
    ]);
    go(game, 'a1', 'b2');
    assert.equal(game.idle, 1);
    go(game, 'b8', 'a7');
    assert.equal(game.idle, 2);
    go(game, 'c1', 'd2');
    assert.equal(game.idle, 0, 'простая пошла — партия сдвинулась');
});

test('сдача, брошенная партия и согласие на ничью', () => {
    const resigned = position(['........', '........', '........', '........', '........', '........', '.w......', '........']);
    resign(resigned, WHITE);
    assert.equal(resigned.winner, BLACK);
    assert.equal(resigned.reason, 'resign');
    assert.equal(resign(resigned, BLACK).ok, false, 'кончённую партию второй раз не закончить');

    const left = position(['........', '........', '........', '........', '........', '........', '.w......', '........']);
    timeout(left, BLACK);
    assert.equal(left.winner, WHITE);
    assert.equal(left.reason, 'timeout');

    const drawn = position(['........', '........', '........', '........', '........', '........', '.w......', '........']);
    agreeDraw(drawn);
    assert.equal(drawn.phase, 'over');
    assert.equal(drawn.winner, null);
    assert.equal(drawn.reason, 'agreed');
});

// ── Отказы ───────────────────────────────────────────────────────────────────

test('чужой ход, несуществующий ход и ход в кончённой партии не проходят', () => {
    const game = createGame({ seed: 5 });
    assert.equal(applyMove(game, BLACK, { from: sq('f6'), to: sq('e5') }).reason, 'not_your_turn');
    assert.equal(applyMove(game, WHITE, { from: sq('c3'), to: sq('c4') }).reason, 'illegal');
    assert.equal(applyMove(game, WHITE, { from: 999, to: -4 }).reason, 'illegal');
    game.phase = 'over';
    assert.equal(applyMove(game, WHITE, { from: sq('c3'), to: sq('d4') }).reason, 'over');
});

test('movesFrom показывает ходы одной шашки и молчит про чужие', () => {
    const game = createGame({ seed: 5 });
    assert.deepEqual(movesFrom(game, sq('c3')).map(m => cellName(m.to)).sort(), ['b4', 'd4']);
    assert.deepEqual(movesFrom(game, sq('f6')), [], 'чужой шашкой ходить нельзя');
    assert.deepEqual(movesFrom(game, sq('d4')), [], 'с пустого поля ходить нечем');
});

// ── Хранение ─────────────────────────────────────────────────────────────────

test('позиция переживает поездку в базу и обратно', () => {
    const game = position([
        '........',
        '..b.....',
        '........',
        '..b.b...',
        '...w....',
        '........',
        '........',
        '........',
    ]);
    go(game, 'd4', 'b6');   // посреди цепочки: chain и captured тоже обязаны доехать
    const copy = deserialize(JSON.parse(JSON.stringify(serialize(game))));
    assert.deepEqual(copy, game);
    assert.deepEqual(cloneGame(game), game);
});

test('мусор из базы не роняет партию', () => {
    const junk = deserialize({ board: ['x', 9, null], turn: 'чёрные', chain: 500, captured: [-3], last: {} });
    assert.equal(junk.board.length, CELLS);
    assert.ok(junk.board.every(p => p === EMPTY));
    assert.equal(junk.turn, WHITE);
    assert.ok(junk.chain >= 0 && junk.chain < CELLS);
    assert.equal(junk.phase, 'play');
});

// ── Партия обязана кончаться ─────────────────────────────────────────────────

test('случайная партия всегда доходит до конца', () => {
    // Тот же довод, что у дурака: бесконечная партия — не теория. Две дамки,
    // ходящие друг вокруг друга, крутились бы вечно, и счётчик ничьей здесь
    // единственное, что этому мешает.
    let s = 12345;
    const rnd = (n) => {
        s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
        return s % n;
    };
    let longest = 0;
    for (let n = 0; n < 200; n++) {
        const game = createGame({ seed: n + 1 });
        let plies = 0;
        while (game.phase === 'play') {
            const moves = legalMoves(game);
            assert.ok(moves.length, 'у стороны, чей ход, всегда есть ход — иначе партия уже кончена');
            const move = moves[rnd(moves.length)];
            assert.equal(applyMove(game, game.turn, move).ok, true);
            plies++;
            assert.ok(plies < 4000, 'партия зациклилась');
        }
        longest = Math.max(longest, plies);
        assert.ok(['wiped', 'blocked', 'draw'].includes(game.reason));
        if (game.reason === 'draw') assert.equal(game.winner, null);
        else assert.ok(game.winner === WHITE || game.winner === BLACK);
    }
    assert.ok(longest > 20, `случайные партии подозрительно короткие (${longest})`);
});

test('на доске никогда не появляется шашка на белом поле', () => {
    let s = 777;
    const rnd = (n) => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s % n; };
    for (let n = 0; n < 30; n++) {
        const game = createGame({ seed: n + 100 });
        while (game.phase === 'play') {
            const moves = legalMoves(game);
            applyMove(game, game.turn, moves[rnd(moves.length)]);
            for (let i = 0; i < CELLS; i++) {
                if (!isDark(i)) assert.equal(game.board[i], EMPTY);
            }
        }
    }
});

test('дамка не превращается второй раз и не теряет звание', () => {
    const game = position([
        '........',
        '..W.....',
        '........',
        '........',
        '........',
        '........',
        '........',
        '........',
    ]);
    go(game, 'c7', 'd8');
    assert.equal(game.board[sq('d8')], W_KING);
    assert.equal(game.last.promoted, false, 'дамка уже дамка — превращать нечего');
    assert.ok(isKing(game.board[sq('d8')]));
    assert.equal(colorOf(game.board[sq('d8')]), WHITE);
    assert.equal(B_KING, 4);
});
