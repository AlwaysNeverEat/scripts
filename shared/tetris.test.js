import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createGame, move, rotate, hardDrop, tick, dropDistance, pieceCells,
    levelFor, gravityMs, maxPlausibleScore, isPlausibleRun,
    COLS, ROWS, TOTAL_ROWS, HIDDEN_ROWS, PIECE_TYPES, LINE_SCORES, LOCK_DELAY_MS, NEXT_COUNT,
} from './tetris.js';

// Партии с зерном повторяемы — иначе тест на мешок был бы «как повезёт».
const g = (seed = 1) => createGame({ seed });

// Заполнить строку целиком, кроме указанных столбцов.
function fillRow(game, y, holes = []) {
    for (let x = 0; x < COLS; x++) {
        if (!holes.includes(x)) game.board[y * COLS + x] = 1;
    }
}

function rowFilled(game, y) {
    for (let x = 0; x < COLS; x++) if (!game.board[y * COLS + x]) return false;
    return true;
}

// Поставить конкретную фигуру в конкретное место — тестам нужна не случайная
// партия, а разобранная позиция.
function place(game, type, rot, x, y) {
    game.piece = { type, rot, x, y };
    game.locking = false;
    game.lockAcc = 0;
    game.gravityAcc = 0;
}

test('новая партия: пустой стакан, фигура в игре, очередь заполнена', () => {
    const game = g();
    assert.equal(game.board.length, COLS * TOTAL_ROWS);
    assert.ok(game.board.every(v => v === 0));
    assert.ok(PIECE_TYPES.includes(game.piece.type));
    assert.equal(game.next.length, NEXT_COUNT);
    assert.equal(game.score, 0);
    assert.equal(game.lines, 0);
    assert.equal(game.level, 1);
    assert.equal(game.over, false);
});

test('мешок: каждые семь фигур — все семь типов ровно по разу', () => {
    const game = g(42);
    const seen = [game.piece.type, ...game.next];
    // Вытягиваем фигуры дальше через hardDrop: очередь сама дотягивает мешок.
    // Стакан перед каждым сбросом чистим — иначе он заполнится к десятой фигуре
    // и партия кончится посреди подсчёта.
    while (seen.length < 14) {
        game.board.fill(0);
        hardDrop(game);
        seen.push(game.next[game.next.length - 1]);
    }
    for (const chunk of [seen.slice(0, 7), seen.slice(7, 14)]) {
        assert.deepEqual([...chunk].sort(), PIECE_TYPES.slice().sort());
    }
});

test('стенка не пускает: фигуру нельзя увести за край стакана', () => {
    const game = g();
    place(game, 'O', 0, 0, HIDDEN_ROWS);
    assert.equal(move(game, -1), false);
    assert.equal(game.piece.x, 0);
    place(game, 'O', 0, COLS - 2, HIDDEN_ROWS);
    assert.equal(move(game, 1), false);
});

test('вращение отталкивается от стены (SRS), а не отменяется', () => {
    const game = g();
    // Палка вертикально в самом левом столбце: поворот в горизонталь на месте
    // увёл бы её за стенку — таблица отталкивания сдвигает её вправо.
    place(game, 'I', 1, -2, HIDDEN_ROWS);
    assert.equal(rotate(game, -1), true);
    assert.equal(game.piece.rot, 0);
    assert.equal(game.piece.x, 0);
    const cells = pieceCells(game.piece);
    for (let i = 0; i < 4; i++) {
        assert.ok(cells[i * 2] >= 0 && cells[i * 2] < COLS, 'палка осталась в стакане');
    }
});

test('квадрат не двигается от вращения', () => {
    const game = g();
    place(game, 'O', 0, 4, HIDDEN_ROWS);
    rotate(game, 1);
    assert.equal(game.piece.x, 4);
    assert.equal(game.piece.y, HIDDEN_ROWS);
});

test('мгновенный сброс: фигура ложится на дно и даёт по два очка за клетку', () => {
    const game = g();
    place(game, 'O', 0, 0, HIDDEN_ROWS);
    const d = dropDistance(game);
    hardDrop(game);
    assert.equal(game.score, d * 2);
    assert.equal(game.pieces, 1);
    // Квадрат лёг в две нижние строки левого угла.
    assert.ok(game.board[(TOTAL_ROWS - 1) * COLS] > 0);
    assert.ok(game.board[(TOTAL_ROWS - 2) * COLS] > 0);
});

test('полная линия убирается, а всё, что было выше, съезжает вниз', () => {
    const game = g();
    fillRow(game, TOTAL_ROWS - 1, [0]);            // не хватает левой клетки
    game.board[(TOTAL_ROWS - 2) * COLS + 5] = 2;   // метка этажом выше
    place(game, 'I', 1, -2, HIDDEN_ROWS);          // палка вертикально в столбце 0
    hardDrop(game);

    assert.equal(game.lines, 1);
    assert.equal(rowFilled(game, TOTAL_ROWS - 1), false);
    // Метка была на предпоследней строке — после уборки она стала последней.
    assert.equal(game.board[(TOTAL_ROWS - 1) * COLS + 5], 2);
});

test('очки за линии считаются по таблице и на уровень', () => {
    const game = g();
    for (let y = TOTAL_ROWS - 4; y < TOTAL_ROWS; y++) fillRow(game, y, [0]);
    place(game, 'I', 1, -2, HIDDEN_ROWS);
    const before = game.score;
    const d = dropDistance(game);
    hardDrop(game);
    assert.equal(game.lines, 4);
    // 800 за тетрис на первом уровне плюс по два очка за каждую клетку сброса.
    assert.equal(game.score - before, LINE_SCORES[4] + d * 2);
});

test('тетрис за тетрисом идёт с полуторной ценой', () => {
    const game = g();
    const tetris = () => {
        for (let y = TOTAL_ROWS - 4; y < TOTAL_ROWS; y++) fillRow(game, y, [0]);
        place(game, 'I', 1, -2, HIDDEN_ROWS);
        const before = game.score;
        hardDrop(game);
        return game.score - before;
    };
    const first = tetris();
    const second = tetris();
    // Второй тетрис дороже первого: b2b × 1.5 плюс комбо. Сравниваем «очки за
    // линии», сброс в обоих случаях одинаковой глубины.
    assert.ok(second > first * 1.4, `второй тетрис (${second}) должен быть дороже первого (${first})`);
});

test('уровень растёт каждые десять линий, падение ускоряется', () => {
    assert.equal(levelFor(0), 1);
    assert.equal(levelFor(9), 1);
    assert.equal(levelFor(10), 2);
    assert.equal(levelFor(25), 3);
    assert.ok(gravityMs(1) > gravityMs(5));
    assert.ok(gravityMs(5) > gravityMs(10));
    // Выше двадцатого уровня таблица упирается в потолок и не ломается.
    assert.equal(gravityMs(50), gravityMs(20));
});

test('гравитация копит время, а не «шаг за кадр»', () => {
    const game = g();
    place(game, 'O', 0, 4, HIDDEN_ROWS);
    const step = gravityMs(1);
    tick(game, step * 3 + 1);     // три шага одним куском
    assert.equal(game.piece.y, HIDDEN_ROWS + 3);
});

test('фигура фиксируется не мгновенно: есть задержка на доворот', () => {
    const game = g();
    place(game, 'O', 0, 4, TOTAL_ROWS - 2);   // уже на дне
    tick(game, gravityMs(1));                  // упереться в дно
    assert.equal(game.piece && game.piece.type, 'O', 'фигура ещё в игре');
    tick(game, LOCK_DELAY_MS + 1);
    assert.equal(game.pieces, 1, 'после задержки фигура легла');
});

test('движение по дну продлевает задержку, но не бесконечно', () => {
    const game = g();
    place(game, 'O', 0, 4, TOTAL_ROWS - 2);
    tick(game, gravityMs(1));                  // упёрлись в дно
    // Двигаем чаще, чем истекает задержка: пока продления не кончились, фигура
    // лежать не должна — на этом держится доворот в последний момент.
    for (let i = 0; i < 5; i++) { move(game, i % 2 ? -1 : 1); tick(game, LOCK_DELAY_MS - 100); }
    assert.equal(game.pieces, 0, 'доворот у дна продлевает задержку');

    let steps = 0;
    while (game.pieces === 0 && steps < 100) {
        move(game, steps % 2 ? -1 : 1);
        tick(game, LOCK_DELAY_MS - 100);
        steps++;
    }
    assert.equal(game.pieces, 1, 'но не бесконечно: продления кончаются и фигура ложится');
    assert.ok(steps < 100, 'фигура легла, а не «доехала» до конца цикла');
});

test('переполненный стакан заканчивает партию', () => {
    const game = g();
    // Дырка в правом столбце — иначе строки уберутся как собранные линии,
    // и стакан окажется пустым вместо переполненного.
    for (let y = HIDDEN_ROWS; y < TOTAL_ROWS; y++) fillRow(game, y, [COLS - 1]);
    place(game, 'O', 0, 4, HIDDEN_ROWS - 2);
    hardDrop(game);
    assert.equal(game.over, true);
    assert.equal(game.piece, null);
});

test('видимая часть стакана — двадцать строк, над ней две скрытые', () => {
    assert.equal(ROWS, 20);
    assert.equal(TOTAL_ROWS, ROWS + HIDDEN_ROWS);
});

// ── Проверка результата на сервере ───────────────────────────────────────────

test('настоящая партия проходит проверку', () => {
    // 40 линий, 120 фигур, 6 минут — обычная партия середнячка.
    assert.deepEqual(isPlausibleRun({ score: 12_000, lines: 40, pieces: 120, seconds: 360 }), { ok: true });
    // И пустая партия тоже: уронил фигуру и проиграл — это результат.
    assert.deepEqual(isPlausibleRun({ score: 0, lines: 0, pieces: 3, seconds: 5 }), { ok: true });
});

test('счёт больше физически возможного не принимается', () => {
    const r = isPlausibleRun({ score: 999_999, lines: 4, pieces: 12, seconds: 30 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'score_too_high');
    // Граница считается от линий и фигур, а не «на глазок».
    assert.ok(maxPlausibleScore(4, 12) < 999_999);
    assert.ok(maxPlausibleScore(400, 1200) > maxPlausibleScore(40, 120));
});

test('линий больше, чем можно собрать из этих фигур, — не принимается', () => {
    // Четыре линии — это минимум десять фигур: одна фигура даёт четыре клетки.
    const r = isPlausibleRun({ score: 100, lines: 4, pieces: 4, seconds: 30 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'lines_vs_pieces');
});

test('невозможный темп и мусор в полях не принимаются', () => {
    assert.equal(isPlausibleRun({ score: 10, lines: 0, pieces: 500, seconds: 1 }).reason, 'too_fast');
    assert.equal(isPlausibleRun({ score: -5, lines: 0, pieces: 1, seconds: 10 }).reason, 'shape');
    assert.equal(isPlausibleRun({ score: 1.5, lines: 0, pieces: 1, seconds: 10 }).reason, 'shape');
    assert.equal(isPlausibleRun({ score: 'много', lines: 0, pieces: 1, seconds: 10 }).reason, 'shape');
    assert.equal(isPlausibleRun({ score: 0, lines: 0, pieces: 1, seconds: 90_000 }).reason, 'too_long');
});
