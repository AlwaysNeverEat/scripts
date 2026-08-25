// Правила маджонга: набор, раскладка, свободность, раздача и перемешивание.
//
// Главный тест здесь один — «раздача разбирается». Всё остальное (144 фишки,
// пять этажей, свободна ли фишка) можно поправить и заметить глазами, а вот
// неразбираемая раскладка выглядит как обычная: игрок упирается в тупик и
// думает, что сам виноват. Поэтому проверяем не «примерно работает», а прогон
// решения ход за ходом по тем же canTake/take, которыми играет окно.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    KINDS, TILES, PAIRS, COPIES, LAYOUT, LAYERS, BOARD_W, BOARD_H, UNIT,
    FIRST_FLOWER, FIRST_SEASON,
    fullSet, matches, groupOf, tileLabel, spriteCol, spriteRow,
    createGame, isFree, freeTiles, canTake, take, findMove, hasMove, reshuffle,
    isPlausibleRun, MIN_SECONDS, MAX_SECONDS, MAX_SHUFFLES,
} from './mahjong.js';

// ── Набор фишек ──────────────────────────────────────────────────────────────

test('набор — 144 фишки: масти по четыре, цветы и времена года по одной', () => {
    const set = fullSet();
    assert.equal(set.length, TILES);
    assert.equal(PAIRS, 72);

    const count = new Map();
    for (const k of set) count.set(k, (count.get(k) || 0) + 1);
    assert.equal(count.size, KINDS.length);
    for (const [kind, n] of count) {
        assert.equal(n, kind >= FIRST_FLOWER ? 1 : COPIES, `${KINDS[kind]}: ${n} штук`);
    }
});

test('спрайт 7×6 покрывает все виды и ни одной клетки дважды', () => {
    assert.equal(KINDS.length, 42);
    const cells = new Set(KINDS.map((_, k) => `${spriteRow(k)}:${spriteCol(k)}`));
    assert.equal(cells.size, KINDS.length);
    for (let k = 0; k < KINDS.length; k++) {
        assert.ok(spriteCol(k) < 7 && spriteRow(k) < 6);
    }
});

test('сходятся одинаковые; цветы — с любым цветком, времена года — со своими', () => {
    assert.ok(matches(0, 0));
    assert.ok(!matches(0, 1));
    assert.ok(matches(FIRST_FLOWER, FIRST_FLOWER + 3));
    assert.ok(matches(FIRST_SEASON, FIRST_SEASON + 2));
    // Цветок и время года — разные группы, как бы похоже они ни выглядели.
    assert.ok(!matches(FIRST_FLOWER, FIRST_SEASON));
    assert.equal(groupOf(FIRST_FLOWER + 2), FIRST_FLOWER);
    // Снятой фишки (−1) не существует, и сходиться ей не с чем.
    assert.ok(!matches(-1, -1));
});

test('у каждой фишки есть человеческая подпись', () => {
    assert.equal(tileLabel(0), 'Точки 1');
    assert.equal(tileLabel(17), 'Бамбук 9');
    assert.equal(tileLabel(18), 'Символы 1');
    for (let k = 0; k < KINDS.length; k++) assert.match(tileLabel(k), /\S/);
});

// ── Раскладка ────────────────────────────────────────────────────────────────

test('«черепаха» — 144 места на пяти этажах, без наложений', () => {
    assert.equal(LAYOUT.length, TILES);
    assert.equal(LAYERS, 5);
    // 15 фишек в ширину (с головой и хвостом) и 8 рядов в высоту.
    assert.equal(BOARD_W, 15 * UNIT);
    assert.equal(BOARD_H, 8 * UNIT);

    const byLayer = [0, 0, 0, 0, 0];
    for (const p of LAYOUT) byLayer[p.z]++;
    assert.deepEqual(byLayer, [87, 36, 16, 4, 1]);

    LAYOUT.forEach((a, i) => {
        LAYOUT.forEach((b, j) => {
            if (j <= i || a.z !== b.z) return;
            const overlap = Math.abs(a.x - b.x) < UNIT && Math.abs(a.y - b.y) < UNIT;
            assert.ok(!overlap, `места ${i} и ${j} наложились`);
        });
    });
});

test('каждый верхний этаж лежит на нижнем, а не висит в воздухе', () => {
    LAYOUT.forEach((p, i) => {
        if (!p.z) return;
        const under = LAYOUT.some(q => q.z === p.z - 1
            && Math.abs(q.x - p.x) < UNIT && Math.abs(q.y - p.y) < UNIT);
        assert.ok(under, `место ${i} на этаже ${p.z} висит над пустотой`);
    });
});

test('на полном столе свободны концы рядов, бока этажей и макушка', () => {
    const game = createGame({ seed: 1 });
    const free = freeTiles(game).map(i => LAYOUT[i]);

    // 35 — это не «на глаз», а сумма по этажам:
    //   нижний: концы шести рядов (12) — у третьего и четвёртого ряда концы
    //           заняты головой и хвостом, — плюс сама голова и кончик хвоста;
    //   6×6:    два открытых столбца по краю (12);
    //   4×4:    то же самое (8);
    //   2×2:    ни одной — все четыре накрыты макушкой;
    //   макушка: она сама.
    assert.equal(free.length, 12 + 2 + 12 + 8 + 0 + 1);

    assert.ok(free.some(p => p.z === 4), 'макушка должна быть свободна');
    assert.ok(free.some(p => p.z === 0 && p.x === 0), 'голова должна быть свободна');
    assert.ok(free.some(p => p.z === 0 && p.x === 28), 'кончик хвоста должен быть свободен');
    // Средней фишке хвоста мешают с обеих сторон — она откроется следующей.
    assert.ok(!free.some(p => p.z === 0 && p.x === 26), 'хвост открывается с конца');
    // Ни одна фишка под макушкой не свободна.
    assert.ok(!free.some(p => p.z === 3));
});

// ── Раздача ──────────────────────────────────────────────────────────────────

test('раздача разбирается: порядок сборки — законное решение', () => {
    // Двадцать разных зёрен: раздача случайна, и одна удачная ничего не
    // доказывает.
    for (let seed = 1; seed <= 20; seed++) {
        const game = createGame({ seed });
        assert.equal(game.tiles.filter(k => k >= 0).length, TILES);
        assert.equal(game.solution.length, PAIRS);

        for (const [a, b] of game.solution) {
            assert.ok(canTake(game, a, b), `зерно ${seed}: ход ${a}—${b} оказался незаконным`);
            assert.ok(take(game, a, b));
        }
        assert.ok(game.won, `зерно ${seed}: стол не разобран до конца`);
        assert.equal(game.left, 0);
        assert.equal(game.pairs, PAIRS);
    }
});

test('в раздаче ровно тот же набор фишек, что и в наборе', () => {
    const game = createGame({ seed: 7 });
    const sort = a => a.slice().sort((x, y) => x - y);
    assert.deepEqual(sort(game.tiles), sort(fullSet()));
});

test('снять можно только свободную пару и только сходящуюся', () => {
    const game = createGame({ seed: 3 });
    const [a, b] = findMove(game);
    assert.ok(take(game, a, b));
    assert.equal(game.left, TILES - 2);
    // Второй раз те же места снять нельзя — их уже нет.
    assert.ok(!take(game, a, b));

    // Закрытая фишка не снимается, даже если пара ей найдётся: ищем накрытую
    // сверху и проверяем, что она не свободна.
    const covered = game.tiles.findIndex((k, i) => k >= 0 && LAYOUT[i].z === 0 && !isFree(game, i));
    assert.ok(covered >= 0);
    const partner = game.tiles.findIndex((k, i) => i !== covered && matches(k, game.tiles[covered]));
    assert.ok(!canTake(game, covered, partner));
});

test('жадный автоигрок доигрывает партию до конца или до честного тупика', () => {
    // Жадность — не решение (снимая первую попавшуюся пару, легко загнать себя
    // в тупик), и тест этого не требует: он стережёт, что игра ВСЕГДА
    // кончается — либо стол разобран, либо ходов нет и предлагается
    // перемешивание. Зацикливание тут страшнее проигрыша.
    let wins = 0;
    for (let seed = 100; seed < 130; seed++) {
        const game = createGame({ seed });
        let guard = 0;
        while (hasMove(game) && !game.won) {
            const [a, b] = findMove(game);
            assert.ok(take(game, a, b));
            assert.ok(++guard <= PAIRS, 'партия не кончается');
        }
        if (game.won) wins++;
        else assert.ok(game.left > 0 && !findMove(game));
    }
    // Хоть сколько-то партий жадный игрок всё-таки разбирает — иначе раздача
    // подозрительно недружелюбна.
    assert.ok(wins > 0, `жадный автоигрок не разобрал ни одной партии из 30`);
});

// ── Перемешивание ────────────────────────────────────────────────────────────

test('перемешивание сохраняет фишки и снова даёт разбираемый стол', () => {
    const game = createGame({ seed: 42 });
    for (let n = 0; n < 20; n++) {
        const [a, b] = findMove(game);
        take(game, a, b);
    }
    const before = game.tiles.filter(k => k >= 0).sort((x, y) => x - y);
    const places = game.tiles.map(k => k >= 0);

    assert.ok(reshuffle(game));
    assert.equal(game.shuffles, 1);
    assert.deepEqual(game.tiles.filter(k => k >= 0).sort((x, y) => x - y), before);
    // Места не двигаются: перемешиваются фишки, а не раскладка.
    assert.deepEqual(game.tiles.map(k => k >= 0), places);

    // И снова разбирается до конца — иначе кнопка «нет ходов» могла бы выдать
    // второй тупик подряд.
    for (const [a, b] of game.solution) assert.ok(take(game, a, b));
    assert.ok(game.won);
});

test('разобранную партию перемешивать нечего', () => {
    const game = createGame({ seed: 5 });
    for (const [a, b] of game.solution) take(game, a, b);
    assert.ok(!reshuffle(game));
});

// ── Проверка результата ──────────────────────────────────────────────────────

test('правдоподобность отсекает мусор, но пропускает обычную партию', () => {
    assert.ok(isPlausibleRun({ seconds: 480, shuffles: 0 }).ok);
    assert.ok(isPlausibleRun({ seconds: MIN_SECONDS, shuffles: MAX_SHUFFLES }).ok);

    assert.equal(isPlausibleRun({ seconds: MIN_SECONDS - 1, shuffles: 0 }).reason, 'too_fast');
    assert.equal(isPlausibleRun({ seconds: MAX_SECONDS + 1, shuffles: 0 }).reason, 'too_long');
    assert.equal(isPlausibleRun({ seconds: 300, shuffles: MAX_SHUFFLES + 1 }).reason, 'too_many_shuffles');
    assert.equal(isPlausibleRun({ seconds: 300.5, shuffles: 0 }).reason, 'shape');
    assert.equal(isPlausibleRun({ seconds: -1, shuffles: 0 }).reason, 'shape');
    assert.equal(isPlausibleRun({ seconds: 'много', shuffles: 0 }).reason, 'shape');
    assert.equal(isPlausibleRun({ seconds: 300 }).reason, 'shape');
});
