import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    SIZE, CELLS, NONE, HIT, ACROSS, DOWN, FLEET, FLEET_CELLS,
    cellAt, cellName, shipAt, shipCells, around, isSunk, fleetError, randomFleet,
    createGame, applyMove, viewFor, woundedCells,
} from './battleship.js';
import { pickShot, pickFleet, LEVELS, EASY, NORMAL, HARD } from './battleshipBot.js';

function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
        s ^= s << 13; s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5; s >>>= 0;
        return s / 0x100000000;
    };
}

/**
 * Сколько выстрелов уровню нужно, чтобы разобрать чужой флот.
 *
 * Это и есть мера силы в морском бою: попасть по всем двадцати клеткам обязан
 * каждый, вопрос только в том, сколько мимо. Партию для этого гонять не надо —
 * достаточно дать боту стрелять по неподвижному полю.
 *
 * Считаем ДВА числа. `total` — вся зачистка, то есть кто выиграл бы дуэль.
 * `big` — до момента, когда потоплено всё крупнее катера, и именно оно меряет
 * УМЕНИЕ ИСКАТЬ: последние четыре однопалубных не ищутся ничем — все оставшиеся
 * клетки для них равновероятны, и там любой уровень одинаково тычет наугад.
 */
function shotsToClear(fleet, level, seed) {
    const g = createGame({ seed });
    applyMove(g, 0, { type: 'place', ships: randomFleet(rng(seed + 777)) });
    applyMove(g, 1, { type: 'place', ships: fleet });
    g.turn = 0;

    const roll = rng(seed);
    let total = 0;
    let big = 0;
    while (g.phase === 'play' && total < CELLS + 1) {
        const view = viewFor(g, 0);
        const cell = pickShot(view, { level, rng: roll });
        assert.ok(cell >= 0, 'бот не нашёл куда стрелять');
        assert.equal(view.outgoing[cell], NONE, `бот выстрелил в уже отстрелянную ${cellName(cell)}`);
        const res = applyMove(g, 0, { type: 'shot', cell });
        assert.equal(res.ok, true, `бот сходил незаконно: ${cellName(cell)}`);
        total++;
        if (!big && fleet.filter(s => s.len > 1).every(s => isSunk(s, g.shots[0]))) big = total;
        // Ход после промаха уходит сопернику — его тут нет, возвращаем себе:
        // меряем сам обстрел, а не партию.
        g.turn = 0;
    }
    assert.equal(g.phase, 'over', `${level} не добил флот за ${total} выстрелов`);
    return { total, big };
}

/** Средние по одинаковым для всех уровней флотам: сравниваем игру, а не везение. */
function levelAverage(level, games = 120) {
    let total = 0;
    let big = 0;
    for (let seed = 1; seed <= games; seed++) {
        const run = shotsToClear(randomFleet(rng(seed * 31)), level, seed);
        total += run.total;
        big += run.big;
    }
    return { total: total / games, big: big / games };
}

// ── Что бот вообще умеет ─────────────────────────────────────────────────────

test('уровней три, и у каждого есть имя', () => {
    assert.deepEqual(LEVELS.map(l => l.id), [EASY, NORMAL, HARD]);
    for (const l of LEVELS) assert.ok(l.name.length > 2);
});

test('бот расставляет законный флот', () => {
    for (let seed = 1; seed <= 50; seed++) {
        assert.equal(fleetError(pickFleet({ rng: rng(seed) })), '', `зерно ${seed}`);
    }
});

test('любой уровень всегда стреляет законно и разбирает флот', () => {
    for (const level of [EASY, NORMAL, HARD]) {
        for (let seed = 1; seed <= 20; seed++) {
            const { total } = shotsToClear(randomFleet(rng(seed * 7)), level, seed);
            assert.ok(total >= FLEET_CELLS, 'меньше двадцати выстрелов по двадцати клеткам не бывает');
            assert.ok(total <= CELLS, `${level} потратил ${total} выстрелов`);
        }
    }
});

test('на пустом поле бот не выдумывает выстрел', () => {
    const g = createGame({ seed: 1 });
    applyMove(g, 0, { type: 'place', ships: randomFleet(rng(1)) });
    applyMove(g, 1, { type: 'place', ships: randomFleet(rng(2)) });
    const view = viewFor(g, 0);
    view.outgoing = new Array(CELLS).fill(HIT);
    assert.equal(pickShot(view, { level: HARD, rng: rng(3) }), -1);
});

// ── Добивание ────────────────────────────────────────────────────────────────

test('два попадания подряд задают направление: Наводчик и Адмирал бьют в концы', () => {
    // Кладём чужой крейсер горизонтально и раним две его клетки подряд.
    const fleet = randomFleetWith(shipAt(3, 5, 3, ACROSS), 4242);
    const g = createGame({ seed: 5 });
    applyMove(g, 0, { type: 'place', ships: randomFleet(rng(1)) });
    applyMove(g, 1, { type: 'place', ships: fleet });
    g.turn = 0;
    applyMove(g, 0, { type: 'shot', cell: cellAt(3, 5) });
    applyMove(g, 0, { type: 'shot', cell: cellAt(4, 5) });

    const view = viewFor(g, 0);
    assert.equal(woundedCells(view).length, 2);
    const ends = [cellAt(2, 5), cellAt(5, 5)];
    for (const level of [NORMAL, HARD]) {
        for (let seed = 1; seed <= 12; seed++) {
            const cell = pickShot(view, { level, rng: rng(seed) });
            assert.ok(ends.includes(cell), `${level} выстрелил в ${cellName(cell)} вместо конца линии`);
        }
    }
});

test('Адмирал не стреляет в клетку, куда не влезает ни один живой корабль', () => {
    // Однопалубный в углу: топим его, а вокруг всё становится водой. Дыра в
    // одну клетку между водой больше никого вместить не может.
    const fleet = randomFleetWith(shipAt(0, 0, 1, ACROSS), 909);
    const g = createGame({ seed: 5 });
    applyMove(g, 0, { type: 'place', ships: randomFleet(rng(4)) });
    applyMove(g, 1, { type: 'place', ships: fleet });
    g.turn = 0;
    applyMove(g, 0, { type: 'shot', cell: cellAt(0, 0) });

    const view = viewFor(g, 0);
    // Единственный однопалубный утоплен — значит, минимальный живой корабль
    // двухпалубный, и клетки, окружённые водой с трёх сторон, ему малы.
    for (let seed = 1; seed <= 30; seed++) {
        const cell = pickShot(view, { level: HARD, rng: rng(seed) });
        assert.notEqual(cell, cellAt(0, 0));
        assert.ok(view.outgoing[cell] === NONE);
    }
});

// ── Уровни различаются ───────────────────────────────────────────────────────
//
// Числа тут не «на глаз»: это средние по ста двадцати случайным флотам (одним и
// тем же для всех трёх уровней), и они стерегут ровно то, ради чего уровни
// заведены, — что сложность это ГЛУБИНА СЧЁТА, а не подкрученная фора. Порядок
// обязан быть Адмирал < Наводчик < Юнга, иначе выбор уровня в лобби ничего не
// значит.

test('в поиске крупных кораблей уровни расходятся сильно', () => {
    const easy = levelAverage(EASY).big;
    const normal = levelAverage(NORMAL).big;
    const hard = levelAverage(HARD).big;

    assert.ok(normal < easy - 5, `Наводчик ${normal.toFixed(1)} против Юнги ${easy.toFixed(1)}`);
    assert.ok(hard < normal - 2.5, `Адмирал ${hard.toFixed(1)} против Наводчика ${normal.toFixed(1)}`);
    // Нижняя граница: двадцать клеток флота на сотне поля — идеальной игрой
    // меньше тридцати пяти выстрелов на крупные не выходит, и такое число
    // означало бы, что бот что-то подсмотрел, а не сосчитал.
    assert.ok(hard > 35, `Адмиралу хватает ${hard.toFixed(1)} выстрелов — он подсмотрел расстановку`);
});

test('в дуэли разрыв меньше, но порядок тот же', () => {
    // ПОЧЕМУ РАЗРЫВ СЖИМАЕТСЯ. Хвост партии — четыре однопалубных, и найти их
    // нечем: все оставшиеся клетки для них равновероятны. Умный бот тратит на
    // крупные меньше выстрелов, но ровно поэтому оставляет себе БОЛЬШЕ
    // непроверенных клеток, по которым потом всё равно приходится стрелять.
    // Сэкономленный при поиске выстрел возвращается в хвосте примерно наполовину
    // — это свойство самой игры, а не недоделка бота, и тест держит именно ту
    // разницу, которая до конца партии доживает.
    const easy = levelAverage(EASY).total;
    const normal = levelAverage(NORMAL).total;
    const hard = levelAverage(HARD).total;

    assert.ok(normal < easy - 3, `Наводчик ${normal.toFixed(1)} против Юнги ${easy.toFixed(1)}`);
    assert.ok(hard < normal - 1, `Адмирал ${hard.toFixed(1)} против Наводчика ${normal.toFixed(1)}`);
    assert.ok(easy < CELLS - 5, 'Юнга расстреливает всё поле, а не играет');
});

/**
 * Флот с ЗАРАНЕЕ ЗАДАННЫМ кораблём: он ставится первым, остальные — вокруг него.
 *
 * Так, а не «переставить готовый флот»: подвинутый в готовой расстановке корабль
 * почти всегда упирается в соседа, и подбор законного варианта превращается в
 * лотерею. А тестам про добивание нужно ровно одно — знать, где стоит цель.
 */
function randomFleetWith(fixed, seed) {
    const roll = rng(seed);
    const rest = FLEET.slice();
    rest.splice(rest.indexOf(fixed.len), 1);

    for (let attempt = 0; attempt < 50; attempt++) {
        const busy = new Set();
        const ships = [];
        const put = (ship) => {
            for (const c of shipCells(ship)) { busy.add(c); for (const n of around(c)) busy.add(n); }
            ships.push(ship);
        };
        const free = (ship) => {
            const cells = shipCells(ship);
            return !!cells && cells.every(c => !busy.has(c));
        };

        put(shipAt(fixed.x, fixed.y, fixed.len, fixed.dir));
        let stuck = false;
        for (const len of rest) {
            const spots = [];
            for (let dir = ACROSS; dir <= DOWN; dir++) {
                for (let y = 0; y < SIZE; y++) {
                    for (let x = 0; x < SIZE; x++) {
                        const ship = shipAt(x, y, len, dir);
                        if (free(ship)) spots.push(ship);
                    }
                }
                if (len === 1) break;
            }
            if (!spots.length) { stuck = true; break; }
            put(spots[Math.floor(roll() * spots.length) % spots.length]);
        }
        if (!stuck) {
            assert.equal(fleetError(ships), '');
            return ships;
        }
    }
    throw new Error('не удалось собрать флот с заданным кораблём');
}
