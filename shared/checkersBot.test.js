import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    WHITE, BLACK, W_MAN, W_KING, B_MAN, B_KING, SIZE, at, isDark, cellName,
    createGame, legalMoves, applyMove, counts, cloneGame,
} from './checkers.js';
import { pickMove, evaluate, LEVELS, ROOKIE, CLUB, MASTER, levelByName } from './checkersBot.js';

// Позиции — картинками, как в checkers.test.js: список клеток глазами не
// проверить, а именно глазами их и проверяют.
function position(rows, turn = WHITE) {
    const game = createGame({ seed: 1 });
    game.board = new Array(SIZE * SIZE).fill(0);
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
        const piece = { w: W_MAN, W: W_KING, b: B_MAN, B: B_KING }[ch];
        if (!piece) return;
        assert.ok(isDark(at(x, y)), `${cellName(at(x, y))} — белое поле`);
        game.board[at(x, y)] = piece;
    }));
    game.turn = turn;
    game.seats = [WHITE, BLACK];
    return game;
}

const move = m => `${cellName(m.from)}:${cellName(m.to)}`;

// Генератор с зерном: тесты обязаны повторяться, а Math.random в них означал бы
// «иногда красное».
function rng(seed) {
    let s = seed >>> 0 || 1;
    const next = () => {
        s ^= s << 13; s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5; s >>>= 0;
        return s / 0x100000000;
    };
    // Холостая прокрутка — та же, что в правилах: у близких зёрен первые числа
    // xorshift32 почти нулевые, и «случайный» выбор из равных ходов всегда
    // выпадал бы на первый.
    for (let i = 0; i < 8; i++) next();
    return next;
}

/**
 * Партия бота против бота. Возвращает счёт со стороны первого уровня.
 *
 * Герой играет то белыми, то чёрными: право первого хода в шашках заметное, и
 * турнир, в котором сильный всегда белыми, ничего не измеряет.
 */
function duel(hero, foe, games) {
    const out = { win: 0, loss: 0, draw: 0, longest: 0 };
    for (let i = 0; i < games; i++) {
        const game = createGame({ seed: i + 1 });
        const heroColor = i % 2 === 0 ? WHITE : BLACK;
        const random = rng(i * 7919 + 13);
        let plies = 0;
        while (game.phase === 'play') {
            const level = game.turn === heroColor ? hero : foe;
            const hop = pickMove(game, { level, rng: random });
            assert.ok(hop, 'бот обязан найти ход, пока партия идёт');
            assert.equal(applyMove(game, game.turn, hop).ok, true, `бот сходил незаконно: ${move(hop)}`);
            plies++;
            assert.ok(plies < 400, 'партия ботов зациклилась');
        }
        out.longest = Math.max(out.longest, plies);
        if (game.winner == null) out.draw++;
        else if (game.winner === heroColor) out.win++;
        else out.loss++;
    }
    return out;
}

// ── Законность ───────────────────────────────────────────────────────────────

test('бот ходит только тем, что разрешают правила', () => {
    for (const level of LEVELS) {
        const game = createGame({ seed: 42 });
        const random = rng(7);
        let plies = 0;
        while (game.phase === 'play' && plies < 60) {
            const hop = pickMove(game, { level: level.id, rng: random });
            const legal = legalMoves(game);
            assert.ok(
                legal.some(m => m.from === hop.from && m.to === hop.to),
                `${level.name} предложил ${move(hop)}, которого нет в правилах`,
            );
            applyMove(game, game.turn, hop);
            plies++;
        }
    }
});

test('бот не придумывает ход в кончённой партии', () => {
    const game = position([
        '........', '........', '........', '........',
        '........', '........', '.w......', '........',
    ]);
    game.phase = 'over';
    assert.equal(pickMove(game, { level: MASTER }), null);
});

test('в цепочке бот продолжает бить той же шашкой', () => {
    const game = position([
        '........',
        '..b.....',
        '........',
        '..b.....',
        '...w....',
        '........',
        '........',
        '..w.....',
    ]);
    applyMove(game, WHITE, legalMoves(game)[0]);
    assert.ok(game.chain >= 0, 'цепочка началась');
    const hop = pickMove(game, { level: CLUB });
    assert.equal(hop.from, game.chain, 'бот обязан продолжать той же шашкой, а не искать другую');
});

// ── Счёт материала ───────────────────────────────────────────────────────────

test('из двух боёв бот берёт дамку, а не простую', () => {
    const game = position([
        '.......b',
        '........',
        '........',
        '........',
        '.b.B....',
        '..w.....',
        '........',
        'w.w.....',
    ]);
    // Слева простая, справа дамка — и та, и другая берутся одинаково легко.
    for (const level of LEVELS) {
        assert.equal(move(pickMove(game, { level: level.id, rng: rng(3) })), 'c3:e5',
            `${level.name} прошёл мимо дамки`);
    }
});

test('дамка дороже простой, а простая у последнего ряда дороже своей же в начале', () => {
    const kings = position([
        '........', '........', '........', '........',
        '...W....', '........', '........', '........',
    ]);
    const men = position([
        '........', '........', '........', '........',
        '...w....', '........', '........', '........',
    ]);
    assert.ok(evaluate(kings, WHITE) > evaluate(men, WHITE) * 2, 'дамка стоит больше двух простых');
    assert.ok(evaluate(men, WHITE) > 0 && evaluate(men, BLACK) < 0, 'счёт считается со стороны спрошенного');

    const far = position([
        '........', '..w.....', '........', '........',
        '........', '........', '........', '........',
    ]);
    const near = position([
        '........', '........', '........', '........',
        '........', '..w.....', '........', '........',
    ]);
    assert.ok(evaluate(far, WHITE) > evaluate(near, WHITE), 'шашка в шаге от дамок стоит дороже');
});

// ── Чем уровни отличаются ────────────────────────────────────────────────────

test('Новичок хватает две шашки и остаётся ни с чем, Любитель берёт одну', () => {
    // Ровно та разница, ради которой уровни и заведены (см. шапку бота):
    // Новичок обрывает счёт на СВОЁМ взятии, а Любитель досчитывает размен.
    //
    // Слева одинокая b4 — взять и уйти. Справа цепочка d4 и f6, но севшую на g7
    // шашку тут же забирает h8, и белые остаются без своей.
    const rows = [
        '.......b',
        '........',
        '.....b..',
        '........',
        '.b.b....',
        '..w.....',
        '........',
        'w.w.....',
    ];
    assert.deepEqual(
        legalMoves(position(rows)).map(move).sort(),
        ['c3:a5', 'c3:e5'],
        'у белых ровно два боя — жадный и скромный',
    );

    assert.equal(move(pickMove(position(rows), { level: ROOKIE, rng: rng(1) })), 'c3:e5');
    assert.equal(move(pickMove(position(rows), { level: CLUB, rng: rng(1) })), 'c3:a5');
    assert.equal(move(pickMove(position(rows), { level: MASTER, rng: rng(1) })), 'c3:a5');

    // И это не придирка к вкусу: после жадной цепочки белых на доске ровно
    // столько же, сколько чёрных, а после скромного взятия — на одну больше.
    const greedy = position(rows);
    for (const hop of ['c3:e5', 'e5:g7']) {
        const m = legalMoves(greedy).find(x => move(x) === hop);
        applyMove(greedy, WHITE, m);
    }
    const answer = pickMove(greedy, { level: CLUB, rng: rng(2) });
    applyMove(greedy, BLACK, answer);
    assert.deepEqual(counts(greedy).map(s => s.men + s.kings), [2, 2]);

    const modest = position(rows);
    applyMove(modest, WHITE, legalMoves(modest).find(x => move(x) === 'c3:a5'));
    assert.deepEqual(counts(modest).map(s => s.men + s.kings), [3, 3]);
});

test('уровень — это глубина счёта: Любитель обыгрывает Новичка, Мастер — Любителя', () => {
    // ТУРНИР ЗДЕСЬ МАЛЕНЬКИЙ, И ЭТО НЕ ЛЕНЬ: Мастер считает партию на пять
    // полуходов вперёд, партия ботов идёт больше сотни ходов, и сотня партий
    // превратила бы прогон тестов в перекур. Это сторож, а не статистика:
    // он ловит правку, после которой уровни перестали различаться, — а такая
    // правка видна и на четырёх партиях, потому что разрыв тут огромный.
    const easy = duel(CLUB, ROOKIE, 12);
    assert.ok(easy.win >= 9, `Любитель выиграл у Новичка только ${easy.win} из 12`);
    assert.equal(easy.loss, 0, 'Новичок не должен обыгрывать Любителя вовсе');

    const hard = duel(MASTER, CLUB, 4);
    assert.ok(hard.win >= 2, `Мастер выиграл у Любителя только ${hard.win} из 4`);
    assert.equal(hard.loss, 0, 'Мастер не должен проигрывать Любителю');

    // Партии обязаны кончаться: без счётчика ничьей две дамки крутились бы
    // друг вокруг друга бесконечно (см. IDLE_PLIES в правилах).
    assert.ok(easy.longest < 400 && hard.longest < 400);
});

test('у каждого уровня есть имя и своя глубина, а неизвестный уровень не роняет бота', () => {
    assert.deepEqual(LEVELS.map(l => l.id), [ROOKIE, CLUB, MASTER]);
    assert.deepEqual(LEVELS.map(l => l.depth), [1, 3, 5]);
    assert.ok(LEVELS.every(l => l.name && l.name === l.name.trim()));
    // Второе имя — в творительном падеже, для подписи «продолжить с …».
    assert.deepEqual(LEVELS.map(l => l.whom), ['Новичком', 'Любителем', 'Мастером']);
    // Новичок — единственный, кто обрывает размен.
    assert.equal(levelByName(ROOKIE).quiesce, 0);
    assert.ok(LEVELS.slice(1).every(l => l.quiesce > 0));
    assert.equal(levelByName('чемпион мира').id, CLUB, 'неизвестный уровень — это Любитель, а не падение');

    const game = createGame({ seed: 9 });
    assert.ok(pickMove(game, { level: 'нет такого' }));
});

test('бот из равных ходов выбирает разные — вторая партия не повторяет первую', () => {
    // Дамка посреди пустой доски: куда ни пойди, на счёт материала это не
    // влияет, и все тринадцать ходов для бота одинаковы. Без выбора наугад он
    // играл бы первый из списка — то есть одно и то же всю партию и все партии.
    const rows = [
        '.......b', '........', '........', '........',
        '...W....', '........', '........', '........',
    ];
    const seen = new Set();
    for (let seed = 1; seed <= 30; seed++) {
        seen.add(move(pickMove(position(rows), { level: ROOKIE, rng: rng(seed) })));
    }
    assert.ok(seen.size > 1, 'на одной и той же позиции бот играет одно и то же');
});

test('бот не портит переданную ему позицию', () => {
    const game = createGame({ seed: 11 });
    const before = cloneGame(game);
    pickMove(game, { level: MASTER, rng: rng(5) });
    assert.deepEqual(game, before, 'бот считает на копии, а не на настоящей доске');
});
