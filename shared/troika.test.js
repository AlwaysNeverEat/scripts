import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createGame, applySwap, swapKind, canSwap, resolveStep, findGroups, hasMatchAt,
    hasMove, findMove, shuffle, tickTime, levelFor, clockChance, maxPlausibleScore, isPlausibleRun,
    idx, areNeighbours,
    SIZE, CELLS, KIND_COUNT, NONE, ROCKET_H, ROCKET_V, BOMB, PRISM, CLOCK,
    START_MS, MAX_MS, CLOCK_MS, TILE_POINTS, CLOCK_POINTS, MAX_CASCADE_MULT, CREATE_BONUS,
} from './troika.js';

// Партии с зерном повторяемы — иначе половина тестов была бы «как повезёт».
const g = (seed = 1) => createGame({ seed });

// Тестам нужна разобранная позиция, а не случайное поле: раскладываем поле
// диагональными полосами из трёх видов и дальше ставим руками ровно то, что
// проверяем.
//
// Полосы по диагонали — единственная простая раскладка, в которой нет НИ линии
// из трёх, НИ квадрата 2×2 (в шахматке и в полосках по две клетки квадраты как
// раз есть, и с тех пор как квадрат стал фигурой, такая заготовка «срабатывала»
// бы сама). Виды 3, 4 и 5 в ней не заняты — ими и рисуются проверяемые фигуры,
// так что к заготовке они не прилипают.
function blank(seed = 1) {
    const game = g(seed);
    game.special.fill(NONE);
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) game.color[idx(x, y)] = (x + y) % 3;
    }
    assert.equal(findGroups(game).length, 0, 'в заготовке поля ничего не собрано');
    return game;
}

function paint(game, cells, color) {
    for (const [x, y] of cells) game.color[idx(x, y)] = color;
}

test('новая партия: полное поле без готовых троек, ход есть, таймер полон', () => {
    for (let seed = 1; seed <= 20; seed++) {
        const game = g(seed);
        assert.equal(game.color.length, CELLS);
        assert.ok([...game.color].every(c => c >= 0 && c < KIND_COUNT), 'пустых клеток на старте нет');
        assert.equal(findGroups(game).length, 0, 'готовых троек на старте нет');
        assert.ok(hasMove(game), 'ход на старте есть');
    }
    const game = g();
    assert.equal(game.timeMs, START_MS);
    assert.equal(game.score, 0);
    assert.equal(game.over, false);
});

test('обмен разрешён только если собирается тройка', () => {
    const game = blank();
    // Ставим три пятёрки: две рядом в строке 0 и одну под ними — обмен по
    // вертикали достроит тройку.
    paint(game, [[0, 0], [1, 0]], 5);
    paint(game, [[2, 1]], 5);
    paint(game, [[2, 0]], 4);

    assert.equal(swapKind(game, idx(2, 0), idx(2, 1)), 'match');
    // Соседей по диагонали не бывает, и «через клетку» тоже.
    assert.equal(canSwap(game, idx(0, 0), idx(1, 1)), false);
    assert.equal(canSwap(game, idx(0, 0), idx(2, 0)), false);
    // Обмен, ничего не собирающий, — не ход.
    assert.equal(swapKind(game, idx(6, 6), idx(7, 6)), null);
});

test('тройка: убирает три фишки, даёт очки, поле досыпается', () => {
    const game = blank();
    paint(game, [[0, 0], [1, 0]], 5);
    paint(game, [[2, 1]], 5);
    paint(game, [[2, 0]], 4);

    assert.equal(applySwap(game, idx(2, 0), idx(2, 1)), 'match');
    assert.equal(game.moves, 1);

    const step = resolveStep(game);
    assert.equal(step.tiles, 3);
    assert.equal(step.cascade, 1);
    assert.equal(step.gained, 3 * TILE_POINTS);
    assert.equal(step.created.length, 0, 'за тройку специальных не дают');
    assert.equal(game.score, 3 * TILE_POINTS);
    assert.equal(game.tiles, 3);
    // Пустых клеток после шага не остаётся: обвал и досыпка внутри шага.
    assert.ok([...game.color].every(c => c >= 0));
    assert.equal(step.spawned.length, 3);
});

test('четвёрка даёт ракету, и она встаёт в тронутую клетку', () => {
    const game = blank();
    // Четыре в строке: три уже стоят, четвёртую подводим снизу.
    paint(game, [[1, 3], [2, 3], [3, 3]], 5);
    paint(game, [[4, 4]], 5);
    paint(game, [[4, 3]], 4);

    assert.equal(applySwap(game, idx(4, 3), idx(4, 4)), 'match');
    const step = resolveStep(game);
    assert.equal(step.tiles, 4);
    assert.equal(step.created.length, 1);
    assert.equal(step.created[0].special, ROCKET_H, 'четвёрка по горизонтали — ракета по строке');
    assert.equal(step.created[0].cell, idx(4, 3), 'награда появляется там, где игрок тронул');
    assert.equal(game.special[idx(4, 3)], ROCKET_H);
    assert.equal(step.gained, 4 * TILE_POINTS + CREATE_BONUS[ROCKET_H]);
});

test('четвёрка по вертикали даёт ракету по столбцу, пятёрка — призму', () => {
    const vert = blank();
    paint(vert, [[3, 1], [3, 2], [3, 3]], 5);
    paint(vert, [[4, 4]], 5);
    paint(vert, [[3, 4]], 4);
    assert.equal(applySwap(vert, idx(3, 4), idx(4, 4)), 'match');
    assert.equal(resolveStep(vert).created[0].special, ROCKET_V);

    const five = blank();
    paint(five, [[1, 5], [2, 5], [4, 5], [5, 5]], 5);
    paint(five, [[3, 6]], 5);
    paint(five, [[3, 5]], 4);
    assert.equal(applySwap(five, idx(3, 5), idx(3, 6)), 'match');
    const step = resolveStep(five);
    assert.equal(step.tiles, 5);
    assert.equal(step.created[0].special, PRISM);
});

test('квадрат 2×2 собирается и считается за четвёрку — даёт ракету', () => {
    const game = blank();
    // Три угла квадрата на месте, четвёртый подводим сбоку.
    paint(game, [[2, 2], [3, 2], [2, 3]], 5);
    paint(game, [[4, 3]], 5);
    paint(game, [[3, 3]], 4);
    assert.equal(findGroups(game).length, 0, 'три угла — ещё не квадрат');

    // Обмен по ГОРИЗОНТАЛИ — значит и ракета полетит по строке.
    assert.equal(swapKind(game, idx(3, 3), idx(4, 3)), 'match');
    assert.equal(applySwap(game, idx(3, 3), idx(4, 3)), 'match');

    const step = resolveStep(game);
    assert.equal(step.tiles, 4);
    assert.equal(step.created.length, 1);
    assert.equal(step.created[0].special, ROCKET_H);
    assert.equal(step.created[0].cell, idx(3, 3), 'награда — в тронутой клетке');
    assert.equal(step.gained, 4 * TILE_POINTS + CREATE_BONUS[ROCKET_H]);
});

test('квадрат, собранный ходом по вертикали, даёт ракету по столбцу', () => {
    const game = blank();
    paint(game, [[2, 2], [3, 2], [2, 3]], 5);
    paint(game, [[3, 4]], 5);
    paint(game, [[3, 3]], 4);

    assert.equal(applySwap(game, idx(3, 3), idx(3, 4)), 'match');
    assert.equal(resolveStep(game).created[0].special, ROCKET_V);
});

test('к линии прилипают соседние фишки того же вида — они тоже убираются', () => {
    const game = blank();
    // Тройка по строке 3 (x=2..4) плюс одиночки, приклеенные сверху и снизу:
    // сами по себе они ничего не собирают, но пятно на поле — одно.
    paint(game, [[2, 3], [3, 3]], 5);
    paint(game, [[4, 4]], 5);      // её и подведём
    paint(game, [[4, 3]], 4);
    paint(game, [[2, 2], [3, 4]], 5);

    assert.equal(findGroups(game).length, 0, 'до хода ничего не собрано');
    assert.equal(applySwap(game, idx(4, 3), idx(4, 4)), 'match');

    const groups = findGroups(game);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].cells.size, 5, 'тройка плюс две прилипшие');

    const step = resolveStep(game);
    assert.equal(step.tiles, 5);
    // Пять фишек — до бомбы (шесть) не хватило, но ракету пятно даёт: в счёт
    // идут ВСЕ убранные фишки, а не только вставшие в линию.
    assert.equal(step.created.length, 1);
    assert.equal(step.created[0].special, ROCKET_H, 'линия в пятне лежит по строке — туда и полетит');
    assert.equal(step.gained, 5 * TILE_POINTS + CREATE_BONUS[ROCKET_H]);
});

test('прилипшая фишка идёт в счёт: четыре фишки разом — ракета, как ни лежат', () => {
    // Тройка в столбце плюс соседка сбоку — четыре фишки одного вида, убранные
    // разом. В легенде написано «четвёрка», и с поля видно ровно четыре фишки:
    // раньше за такое не давали ничего, потому что награду считала одна форма.
    const game = blank();
    paint(game, [[3, 2], [3, 3]], 5);
    paint(game, [[4, 4]], 5);
    paint(game, [[3, 4]], 4);
    paint(game, [[4, 2]], 5);          // прилипнет сбоку

    assert.equal(applySwap(game, idx(3, 4), idx(4, 4)), 'match');
    const step = resolveStep(game);
    assert.equal(step.tiles, 4);
    assert.equal(step.created.length, 1);
    // Ход был по ГОРИЗОНТАЛИ, а линия в пятне вертикальная: направление берётся
    // у линии, чтобы на одну и ту же картинку ответ был один и тот же.
    assert.equal(step.created[0].special, ROCKET_V);
    assert.equal(step.gained, 4 * TILE_POINTS + CREATE_BONUS[ROCKET_V]);
});

test('пятно без второй линии: шесть фишек — бомба, восемь — призма', () => {
    // Шесть: четвёрка по строке 4 (x=1..4) и две прилипшие снизу — под первой и
    // под третьей. Столбцы при этом остаются по ДВЕ фишки, то есть это не «угол»
    // и не квадрат: награду такому пятну даёт только размер.
    const six = blank();
    paint(six, [[1, 4], [2, 4], [4, 4]], 5);
    paint(six, [[3, 3]], 5);              // её и подведём в разрыв
    paint(six, [[1, 5], [3, 5]], 5);
    assert.equal(findGroups(six).length, 0, 'до хода ничего не собрано');

    assert.equal(applySwap(six, idx(3, 4), idx(3, 3)), 'match');
    const groups = findGroups(six);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].cells.size, 6);
    const sixStep = resolveStep(six);
    assert.equal(sixStep.tiles, 6);
    assert.equal(sixStep.created[0].special, BOMB,
        'по форме это была бы ракета за четвёрку — берём то, что сильнее');

    // Восемь: та же четвёрка, но прилипших четыре — и это уже призма.
    const eight = blank();
    paint(eight, [[1, 4], [2, 4], [4, 4]], 5);
    paint(eight, [[3, 5]], 5);
    paint(eight, [[0, 3], [1, 3], [3, 3]], 5);
    paint(eight, [[2, 5]], 5);
    assert.equal(findGroups(eight).length, 0, 'до хода ничего не собрано');

    assert.equal(applySwap(eight, idx(3, 4), idx(3, 5)), 'match');
    const eightStep = resolveStep(eight);
    assert.equal(eightStep.tiles, 8);
    assert.equal(eightStep.created[0].special, PRISM);
});

test('форма сильнее размера: пятёрка в ряд — призма, пересечение линий — бомба', () => {
    // Пять фишек — по размеру это ракета, но пятёрка В РЯД остаётся призмой:
    // её собирают специально, и она нарисована в легенде.
    const line = blank();
    paint(line, [[1, 5], [2, 5], [4, 5], [5, 5]], 5);
    paint(line, [[3, 6]], 5);
    paint(line, [[3, 5]], 4);
    assert.equal(applySwap(line, idx(3, 5), idx(3, 6)), 'match');
    const lineStep = resolveStep(line);
    assert.equal(lineStep.tiles, 5);
    assert.equal(lineStep.created[0].special, PRISM);

    // Т-образная фигура из пяти: строка 2 (x=2..4) и столбец 3 (y=2..4). Пяти
    // фишек на бомбу по размеру не хватает (нужно шесть), но линии пересекаются
    // — и это бомба, как было всегда.
    const tee = blank();
    paint(tee, [[2, 2], [4, 2], [3, 3], [3, 4]], 5);
    paint(tee, [[3, 1]], 5);              // подводим перекрестье сверху
    assert.equal(findGroups(tee).length, 0, 'до хода ничего не собрано');

    assert.equal(applySwap(tee, idx(3, 2), idx(3, 1)), 'match');
    const teeStep = resolveStep(tee);
    assert.equal(teeStep.tiles, 5);
    assert.equal(teeStep.created[0].special, BOMB);
});

test('угол (тройка + тройка) — одна фигура и одна бомба, а не две награды', () => {
    const game = blank();
    // Г-образная фигура из пяти: строка 2 (x=2..4) и столбец 2 (y=2..4).
    paint(game, [[3, 2], [4, 2], [2, 3], [2, 4]], 5);
    paint(game, [[2, 1]], 5);      // подводим угол сверху
    paint(game, [[2, 2]], 4);

    assert.equal(applySwap(game, idx(2, 2), idx(2, 1)), 'match');
    const groups = findGroups(game);
    assert.equal(groups.length, 1, 'пересекающиеся прогоны — одна группа');

    const step = resolveStep(game);
    assert.equal(step.tiles, 5);
    assert.equal(step.created.length, 1);
    assert.equal(step.created[0].special, BOMB);
});

test('ракета сносит свою строку целиком', () => {
    const game = blank();
    game.special[idx(0, 4)] = ROCKET_H;
    // Собираем тройку с участием ракеты: она попадает в свою же тройку и
    // срабатывает.
    paint(game, [[0, 4], [1, 4]], 5);
    paint(game, [[2, 5]], 5);
    paint(game, [[2, 4]], 4);

    assert.equal(applySwap(game, idx(2, 4), idx(2, 5)), 'match');
    const step = resolveStep(game);
    assert.equal(step.tiles, SIZE, 'вся строка');
    assert.ok(step.fired.some(f => f.special === ROCKET_H));
});

test('бомба сносит 5×5 без углов', () => {
    const game = blank();
    const cx = 4;
    const cy = 4;
    game.special[idx(cx, cy)] = BOMB;
    // Тройка по вертикали через клетку бомбы, чтобы она сработала.
    paint(game, [[cx, cy], [cx, cy + 1]], 5);
    paint(game, [[cx + 1, cy - 1]], 5);
    paint(game, [[cx, cy - 1]], 4);

    assert.equal(applySwap(game, idx(cx, cy - 1), idx(cx + 1, cy - 1)), 'match');
    const step = resolveStep(game);
    // 25 клеток квадрата минус четыре угла — все внутри поля для центра (4,4).
    assert.equal(step.tiles, 21);
    for (const [dx, dy] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
        assert.ok(!step.cells.includes(idx(cx + dx, cy + dy)), 'угол 5×5 остаётся на месте');
    }
});

test('призма: обмен с любым соседом разрешён и уносит все фишки её вида', () => {
    const game = blank();
    // Вид 5 в заготовке не встречается — раскладываем его сами, по углам, чтобы
    // ни одной тройки они не образовали и считать было что.
    paint(game, [[0, 0], [7, 0], [0, 7], [7, 7]], 5);
    game.special[idx(0, 0)] = PRISM;
    const same = [...game.color].filter(c => c === 5).length;
    assert.equal(same, 4);
    assert.notEqual(game.color[idx(1, 0)], 5, 'соседка призмы — другого вида');

    // Тройки обмен не собирает — законен он именно из-за призмы.
    assert.equal(swapKind(game, idx(0, 0), idx(1, 0)), 'special');
    assert.equal(applySwap(game, idx(0, 0), idx(1, 0)), 'special');

    const step = resolveStep(game);
    assert.ok(step.fired.some(f => f.special === PRISM));
    // Все фишки того вида плюс обменянная соседка, которая уехала в клетку призмы.
    assert.equal(step.tiles, same + 1);
});

test('две специальные рядом срабатывают обе, часы так обменять нельзя', () => {
    const game = blank();
    game.special[idx(5, 5)] = ROCKET_H;
    game.special[idx(6, 5)] = ROCKET_V;
    assert.equal(swapKind(game, idx(5, 5), idx(6, 5)), 'special');

    const clocks = blank();
    clocks.special[idx(5, 5)] = CLOCK;
    clocks.special[idx(6, 5)] = CLOCK;
    assert.equal(swapKind(clocks, idx(5, 5), idx(6, 5)), null, 'часы не взрываются — и обменивать их незачем');
});

test('часы: дают время и очки, но не больше потолка банка', () => {
    const game = blank();
    game.special[idx(0, 0)] = CLOCK;
    paint(game, [[0, 0], [1, 0]], 5);
    paint(game, [[2, 1]], 5);
    paint(game, [[2, 0]], 4);
    game.timeMs = 30_000;

    assert.equal(applySwap(game, idx(2, 0), idx(2, 1)), 'match');
    const step = resolveStep(game);
    assert.equal(step.clocks, 1);
    assert.equal(step.timeGained, CLOCK_MS);
    assert.equal(game.timeMs, 30_000 + CLOCK_MS);
    assert.equal(step.gained, 3 * TILE_POINTS + CLOCK_POINTS);
    assert.equal(game.clocks, 1);

    // Тот же ход у потолка времени: очки дают, а секунды уже нет.
    const full = blank();
    full.special[idx(0, 0)] = CLOCK;
    paint(full, [[0, 0], [1, 0]], 5);
    paint(full, [[2, 1]], 5);
    paint(full, [[2, 0]], 4);
    full.timeMs = MAX_MS;
    applySwap(full, idx(2, 0), idx(2, 1));
    const capped = resolveStep(full);
    assert.equal(capped.timeGained, 0);
    assert.equal(full.timeMs, MAX_MS);
});

test('каскад: второй шаг дороже первого, множитель упирается в потолок', () => {
    const game = blank();
    // Позиция собрана так, чтобы после первой тройки поле сложилось САМО:
    // столбец 3 проседает на три клетки, и пятёрка из (3,1) приезжает в строку 4,
    // где её уже ждут соседки в столбцах 2 и 4.
    paint(game, [[3, 5], [3, 6]], 4);
    paint(game, [[4, 4]], 4);
    paint(game, [[3, 4], [2, 4], [3, 1]], 5);

    assert.equal(findGroups(game).length, 0, 'готовых троек в позиции нет');
    assert.equal(applySwap(game, idx(3, 4), idx(4, 4)), 'match');

    const first = resolveStep(game);
    assert.equal(first.cascade, 1);
    assert.equal(first.mult, 1);
    assert.equal(first.tiles, 3);
    assert.equal(first.gained, 3 * TILE_POINTS);

    const second = resolveStep(game);
    assert.ok(second, 'упавшие пятёрки складываются сами — это второй шаг');
    assert.equal(second.cascade, 2);
    assert.equal(second.mult, 2);
    // Фишки второго шага стоят вдвое: в этом весь смысл каскада. Сравниваем с
    // «нижней границей», потому что досыпанные сверху фишки могли сложиться
    // заодно и дать ещё и награду за фигуру.
    assert.ok(second.gained >= second.tiles * TILE_POINTS * 2);
    assert.ok(game.bestCascade >= 2);
});

test('каскад заканчивается, и только тогда принимается новый ход', () => {
    const game = g(7);
    // Ход на случайном поле: находим первый разрешённый обмен.
    let done = false;
    for (let i = 0; i < CELLS && !done; i++) {
        for (const j of [i + 1, i + SIZE]) {
            if (!areNeighbours(i, j)) continue;
            if (applySwap(game, i, j)) { done = true; break; }
        }
    }
    assert.ok(done, 'на поле есть ход');

    let steps = 0;
    while (resolveStep(game)) {
        steps++;
        assert.ok(steps < 200, 'каскад не бесконечный');
    }
    assert.equal(game.cascade, 0, 'после последнего шага поле спокойно');
    assert.equal(findGroups(game).length, 0, 'троек на спокойном поле не остаётся');
});

test('шаг рассказывает, откуда упала каждая фишка', () => {
    const game = blank();
    // Тройка в столбце 3 (строки 5,6,7) — над ней в столбце всё съедет на три
    // клетки вниз, а сверху досыплется три новые.
    paint(game, [[3, 5], [3, 6]], 5);
    paint(game, [[4, 7]], 5);
    paint(game, [[3, 7]], 4);

    assert.equal(applySwap(game, idx(3, 7), idx(4, 7)), 'match');
    const step = resolveStep(game);
    assert.equal(step.fall.length, CELLS);

    // Всё, что было в столбце 3 выше тройки, приехало ровно на три строки.
    for (let y = 3; y <= 7; y++) assert.equal(step.fall[idx(3, y)], 3, `строка ${y}`);
    // Три досыпанные сверху «пролетели» столько же — они прилетели из-за края.
    for (let y = 0; y <= 2; y++) assert.equal(step.fall[idx(3, y)], 3);
    assert.deepEqual(step.spawned.sort((a, b) => a - b), [idx(3, 0), idx(3, 1), idx(3, 2)]);
    // Соседние столбцы не двигались.
    for (let y = 0; y < SIZE; y++) assert.equal(step.fall[idx(0, y)], 0);
});

test('специальная, выданная за фигуру, едет вниз вместе с полем', () => {
    const game = blank();
    // Четвёрка в строке 2 даёт ракету в тронутой клетке (3,2), а строкой ниже —
    // тройка того же вида в столбце 3: она уберётся тем же шагом, и ракета
    // должна оказаться на две клетки ниже, чем родилась.
    paint(game, [[1, 2], [2, 2], [4, 2]], 5);
    paint(game, [[3, 1]], 5);
    paint(game, [[3, 2]], 4);
    paint(game, [[3, 3], [3, 4]], 5);

    assert.equal(applySwap(game, idx(3, 2), idx(3, 1)), 'match');
    const step = resolveStep(game);
    assert.equal(step.created.length, 1);
    const at = step.created[0].cell;
    assert.equal(game.special[at], step.created[0].special,
        'окну назвали ту клетку, в которой специальная и лежит после обвала');
    assert.notEqual(at, idx(3, 2), 'а не ту, в которой она родилась');
});

test('тупик: перемешивание возвращает ход и не создаёт готовых троек', () => {
    const game = blank();
    // Диагональные полосы из трёх видов — настоящий тупик: любой обмен даёт
    // только пару. (Шахматка из двух видов тупиком НЕ является: там обмен
    // сдвигает цвет по столбцу и тройка складывается сразу.)
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) game.color[idx(x, y)] = (x + y) % 3;
    }
    assert.equal(findGroups(game).length, 0);
    assert.equal(hasMove(game), false, 'на таком поле ходов нет');

    assert.equal(shuffle(game), true);
    assert.equal(game.shuffles, 1);
    assert.ok(hasMove(game));
    assert.equal(findGroups(game).length, 0);
});

test('время: таймер идёт вниз, на нуле партия кончается, пауза в счёт не идёт', () => {
    const game = g();
    assert.equal(tickTime(game, 1_000), false);
    assert.equal(game.timeMs, START_MS - 1_000);
    assert.equal(game.elapsedMs, 1_000);

    assert.equal(tickTime(game, START_MS), true, 'ноль на таймере — конец партии');
    assert.equal(game.over, true);
    assert.equal(game.timeMs, 0);

    // После конца партии время не считается вовсе.
    const elapsed = game.elapsedMs;
    assert.equal(tickTime(game, 5_000), false);
    assert.equal(game.elapsedMs, elapsed);
});

test('после конца партии ход не принимается', () => {
    const game = blank();
    paint(game, [[0, 0], [1, 0]], 5);
    paint(game, [[2, 1]], 5);
    paint(game, [[2, 0]], 4);
    game.over = true;
    assert.equal(applySwap(game, idx(2, 0), idx(2, 1)), null);
});

test('уровень и шанс часов: чем больше очков, тем реже время', () => {
    assert.equal(levelFor(0), 1);
    assert.equal(levelFor(2_499), 1);
    assert.equal(levelFor(2_500), 2);
    assert.ok(clockChance(2) < clockChance(1));
    assert.ok(clockChance(50) > 0, 'часы не исчезают совсем — иначе партия обрывается вслепую');
    assert.equal(clockChance(50), clockChance(99), 'ниже пола шанс не падает');
});

test('hasMatchAt смотрит только через свою клетку — и знает про квадрат', () => {
    const game = blank();
    paint(game, [[1, 1], [2, 1], [3, 1]], 5);
    assert.ok(hasMatchAt(game, idx(2, 1)));
    assert.ok(hasMatchAt(game, idx(1, 1)));
    assert.ok(!hasMatchAt(game, idx(5, 5)));

    const square = blank();
    paint(square, [[5, 5], [6, 5], [5, 6], [6, 6]], 4);
    // Квадрат виден из любого своего угла и не виден снаружи.
    for (const [x, y] of [[5, 5], [6, 5], [5, 6], [6, 6]]) assert.ok(hasMatchAt(square, idx(x, y)));
    assert.ok(!hasMatchAt(square, idx(4, 5)));
});

test('findMove: находит ход, молчит в тупике и отвечает одинаково на одном поле', () => {
    const game = blank();
    paint(game, [[0, 0], [1, 0]], 5);
    paint(game, [[2, 1]], 5);
    paint(game, [[2, 0]], 4);

    const move = findMove(game);
    assert.ok(move, 'ход есть');
    assert.equal(canSwap(game, move[0], move[1]), true);
    assert.deepEqual(findMove(game), move, 'подсказка не должна прыгать между вызовами');

    // Диагональные полосы из трёх видов — тупик (см. blank).
    const dead = blank();
    assert.equal(findMove(dead), null);
    assert.equal(hasMove(dead), false);
});

// ── Проверка результата на сервере ───────────────────────────────────────────

const run = (over = {}) => ({ score: 1_000, tiles: 200, moves: 40, clocks: 12, seconds: 90, ...over });

test('isPlausibleRun: настоящая партия проходит', () => {
    assert.deepEqual(isPlausibleRun(run()), { ok: true });
    // Партия ровно на стартовом времени, без единых часов — тоже нормально.
    assert.deepEqual(isPlausibleRun({ score: 300, tiles: 30, moves: 10, clocks: 0, seconds: 60 }), { ok: true });
});

test('isPlausibleRun: мусор и невозможные партии отсекаются', () => {
    assert.equal(isPlausibleRun(run({ score: 'много' })).ok, false);
    assert.equal(isPlausibleRun(run({ score: -5 })).ok, false);
    assert.equal(isPlausibleRun(run({ seconds: 1.5 })).ok, false);
    // Часов больше, чем убранных фишек, — часы это тоже фишка.
    assert.equal(isPlausibleRun(run({ clocks: 500 })).reason, 'clocks_vs_tiles');
    // Фишек больше, чем один ход может унести.
    assert.equal(isPlausibleRun(run({ tiles: 100_000, moves: 2, clocks: 0 })).reason, 'tiles_vs_moves');
    // Партия длиннее, чем ей отсыпали часы: минута плюс три секунды за часы.
    assert.equal(isPlausibleRun(run({ seconds: 600 })).reason, 'too_long');
    // Тысяча ходов за секунду.
    assert.equal(isPlausibleRun(run({ moves: 5_000, tiles: 20_000, seconds: 90 })).reason, 'too_fast');
    assert.equal(isPlausibleRun(run({ score: 9_999_999 })).reason, 'score_too_high');
});

test('maxPlausibleScore: щедрая, но конечная граница', () => {
    assert.equal(
        maxPlausibleScore(10, 1),
        10 * (TILE_POINTS * MAX_CASCADE_MULT + CLOCK_POINTS) + CREATE_BONUS[PRISM],
    );
    assert.equal(maxPlausibleScore(0, 0), 0);
    assert.equal(maxPlausibleScore(-5, -5), 0);
});

test('очки честной партии до границы не дотягивают', () => {
    // Прогоняем сотню ходов «как получится» и сверяем результат с той самой
    // границей, которой проверяет сервер: настоящая игра обязана в неё влезать
    // с запасом, иначе проверка начнёт отбрасывать живые партии.
    const game = g(11);
    for (let n = 0; n < 100; n++) {
        let moved = false;
        for (let i = 0; i < CELLS && !moved; i++) {
            for (const j of [i + 1, i + SIZE]) {
                if (areNeighbours(i, j) && applySwap(game, i, j)) { moved = true; break; }
            }
        }
        if (!moved) { shuffle(game); continue; }
        while (resolveStep(game));
    }
    assert.ok(game.score > 0);
    assert.ok(game.score <= maxPlausibleScore(game.tiles, game.moves));
    assert.deepEqual(
        isPlausibleRun({
            score: game.score,
            tiles: game.tiles,
            moves: game.moves,
            clocks: game.clocks,
            // Настоящая партия столько бы и шла: стартовое время плюс часы.
            seconds: Math.round((START_MS + game.clocks * CLOCK_MS) / 1000),
        }),
        { ok: true },
    );
});
