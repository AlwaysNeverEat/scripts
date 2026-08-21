import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    SIZE, CELLS, FLEET, FLEET_CELLS, NONE, MISS, HIT, ACROSS, DOWN,
    cellAt, xOf, yOf, cellName, shipAt, shipCells, around, contour, isSunk,
    fleetError, normalizeFleet, randomFleet,
    createGame, applyMove, toMove, awaited, viewFor, enemyLeft, woundedCells,
    resign, timeout, serialize, deserialize, cloneGame,
} from './battleship.js';

// Генератор с зерном — тот же xorshift32, что в правилах: тесты обязаны
// повторяться, а Math.random в них означал бы «иногда красное».
function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
        s ^= s << 13; s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5; s >>>= 0;
        return s / 0x100000000;
    };
}

/** Флот, поставленный руками: [x, y, len, dir]. */
const fleetOf = list => list.map(([x, y, len, dir]) => shipAt(x, y, len, dir));

// Заведомо законная расстановка: ряды через клетку.
const NEAT = fleetOf([
    [0, 0, 4, ACROSS],
    [6, 0, 3, ACROSS],
    [0, 2, 3, ACROSS],
    [5, 2, 2, ACROSS],
    [8, 2, 2, ACROSS],
    [0, 4, 2, ACROSS],
    [4, 4, 1, ACROSS],
    [6, 4, 1, ACROSS],
    [8, 4, 1, ACROSS],
    [0, 6, 1, ACROSS],
]);

/** Партия, в которой оба уже расставились. */
function started(fleet0 = NEAT, fleet1 = NEAT, seed = 1) {
    const g = createGame({ seed });
    assert.equal(applyMove(g, 0, { type: 'place', ships: fleet0 }).ok, true);
    assert.equal(applyMove(g, 1, { type: 'place', ships: fleet1 }).ok, true);
    assert.equal(g.phase, 'play');
    return g;
}

// ── Поле и корабли ───────────────────────────────────────────────────────────

test('клетка — одно число, координаты считаются обратно', () => {
    for (let c = 0; c < CELLS; c++) assert.equal(cellAt(xOf(c), yOf(c)), c);
    assert.equal(cellName(0), 'А1');
    assert.equal(cellName(CELLS - 1), 'К10');
    assert.equal(cellName(cellAt(1, 6)), 'Б7');
});

test('корабль за краем поля не даёт клеток', () => {
    assert.deepEqual(shipCells(shipAt(6, 0, 4, ACROSS)), [6, 7, 8, 9]);
    assert.equal(shipCells(shipAt(7, 0, 4, ACROSS)), null);
    assert.equal(shipCells(shipAt(0, 8, 4, DOWN)), null);
    assert.equal(shipCells(shipAt(0, 0, 0, ACROSS)), null);
});

test('у клетки в углу три соседа, в середине — восемь', () => {
    assert.equal(around(0).length, 3);
    assert.equal(around(cellAt(5, 5)).length, 8);
});

test('вокруг корабля — только вода, сам он в контур не входит', () => {
    const ship = shipAt(0, 0, 2, ACROSS);
    const ring = contour(ship);
    assert.equal(ring.includes(cellAt(0, 0)), false);
    assert.equal(ring.includes(cellAt(1, 0)), false);
    assert.deepEqual(ring.sort((a, b) => a - b),
        [cellAt(2, 0), cellAt(0, 1), cellAt(1, 1), cellAt(2, 1)].sort((a, b) => a - b));
});

// ── Проверка расстановки ─────────────────────────────────────────────────────

test('ровная расстановка проходит проверку', () => {
    assert.equal(fleetError(NEAT), '');
});

test('проверка ловит неполный флот и не тот состав', () => {
    assert.equal(fleetError(NEAT.slice(0, 9)), 'count');
    const wrong = NEAT.map((s, i) => (i === 0 ? shipAt(s.x, s.y, 3, s.dir) : s));
    assert.equal(fleetError(wrong), 'fleet');
});

test('проверка ловит выход за поле, наложение и касание', () => {
    const out = NEAT.slice();
    out[0] = shipAt(8, 0, 4, ACROSS);
    assert.equal(fleetError(out), 'bounds');

    const over = NEAT.slice();
    over[1] = shipAt(1, 0, 3, ACROSS);           // лёг поверх линкора
    assert.equal(fleetError(over), 'overlap');

    // Касание углом — тоже касание: между бортами обязана быть вода.
    const touch = NEAT.slice();
    touch[6] = shipAt(4, 1, 1, ACROSS);          // катер под линкором наискось
    assert.equal(fleetError(touch), 'touch');
});

test('случайная расстановка законна на любом зерне', () => {
    for (let seed = 1; seed <= 300; seed++) {
        const ships = randomFleet(rng(seed));
        assert.equal(fleetError(ships), '', `зерно ${seed}`);
        assert.equal(ships.flatMap(s => shipCells(s)).length, FLEET_CELLS);
    }
});

test('normalizeFleet чинит мусор с сети, а проверка его отвергает', () => {
    const ships = normalizeFleet([{ x: '1', y: null, len: '4', dir: '1' }, 'нет', undefined]);
    assert.equal(ships.length, 3);
    assert.deepEqual(ships[0], { x: 1, y: 0, len: 4, dir: DOWN });
    assert.equal(fleetError(ships), 'count');
});

// ── Расстановка в партии ─────────────────────────────────────────────────────

test('пока не готовы оба, стрелять нельзя', () => {
    const g = createGame({ seed: 7 });
    assert.equal(g.phase, 'setup');
    assert.equal(toMove(g), -1);
    assert.equal(applyMove(g, 0, { type: 'shot', cell: 0 }).ok, false);

    assert.equal(applyMove(g, 0, { type: 'place', ships: NEAT }).ok, true);
    assert.equal(g.phase, 'setup');
    assert.equal(applyMove(g, 0, { type: 'shot', cell: 0 }).ok, false);

    assert.equal(applyMove(g, 1, { type: 'place', ships: NEAT }).ok, true);
    assert.equal(g.phase, 'play');
    assert.equal(toMove(g), g.first);
});

test('переставить флот после «Готов» нельзя', () => {
    const g = createGame({ seed: 7 });
    applyMove(g, 0, { type: 'place', ships: NEAT });
    const again = applyMove(g, 0, { type: 'place', ships: randomFleet(rng(5)) });
    assert.equal(again.ok, false);
    assert.equal(again.reason, 'already');
});

test('незаконная расстановка не принимается и не делает игрока готовым', () => {
    const g = createGame({ seed: 7 });
    const bad = NEAT.slice();
    bad[0] = shipAt(8, 0, 4, ACROSS);
    const res = applyMove(g, 0, { type: 'place', ships: bad });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'bounds');
    assert.equal(g.ready[0], false);
    assert.equal(g.fleets[0], null);
});

test('ждут того, кто не расставился, — и только если второй уже готов', () => {
    const g = createGame({ seed: 7 });
    assert.equal(awaited(g), -1);
    applyMove(g, 0, { type: 'place', ships: NEAT });
    assert.equal(awaited(g), 1);
    applyMove(g, 1, { type: 'place', ships: NEAT });
    assert.equal(awaited(g), g.first);
});

// ── Выстрелы ─────────────────────────────────────────────────────────────────

test('промах отдаёт ход, попадание оставляет', () => {
    const g = started();
    const me = g.first;
    const foe = 1 - me;

    const miss = applyMove(g, me, { type: 'shot', cell: cellAt(9, 9) });
    assert.equal(miss.ok, true);
    assert.equal(miss.hit, false);
    assert.equal(g.shots[me][cellAt(9, 9)], MISS);
    assert.equal(g.turn, foe);

    g.turn = me;
    const hit = applyMove(g, me, { type: 'shot', cell: cellAt(0, 0) });
    assert.equal(hit.hit, true);
    assert.equal(hit.sunk, false);
    assert.equal(g.shots[me][cellAt(0, 0)], HIT);
    assert.equal(g.turn, me, 'попал — стреляй ещё');
});

test('чужой ход не проходит, и дважды в одну клетку не стреляют', () => {
    const g = started();
    const me = g.first;
    assert.equal(applyMove(g, 1 - me, { type: 'shot', cell: 0 }).reason, 'not_your_turn');
    applyMove(g, me, { type: 'shot', cell: cellAt(0, 0) });
    assert.equal(applyMove(g, me, { type: 'shot', cell: cellAt(0, 0) }).reason, 'spent');
    assert.equal(applyMove(g, me, { type: 'shot', cell: 999 }).reason, 'bounds');
});

test('потопленный корабль сам обводится водой', () => {
    const g = started();
    const me = g.first;
    // Катер в одну клетку на (4,4) — топится одним выстрелом.
    const cell = cellAt(4, 4);
    const res = applyMove(g, me, { type: 'shot', cell });
    assert.equal(res.sunk, true);
    for (const c of contour(shipAt(4, 4, 1, ACROSS))) {
        assert.equal(g.shots[me][c], MISS, `клетка ${cellName(c)} должна стать водой`);
    }
    // Ход остаётся: потопил — тоже попал.
    assert.equal(g.turn, me);
});

test('партия кончается, когда потоплен весь флот', () => {
    const g = started();
    const me = g.first;
    for (const ship of NEAT) {
        for (const c of shipCells(ship)) {
            if (g.phase !== 'play') break;
            g.turn = me;
            applyMove(g, me, { type: 'shot', cell: c });
        }
    }
    assert.equal(g.phase, 'over');
    assert.equal(g.winner, me);
    assert.equal(g.reason, 'fleet');
    assert.equal(applyMove(g, me, { type: 'shot', cell: cellAt(9, 9) }).ok, false);
});

test('сдача и брошенная партия отдают победу второму', () => {
    const one = started();
    resign(one, 0);
    assert.equal(one.winner, 1);
    assert.equal(one.reason, 'resign');

    const two = started();
    timeout(two, 1);
    assert.equal(two.winner, 0);
    assert.equal(two.reason, 'timeout');
});

// ── Вид ──────────────────────────────────────────────────────────────────────

test('в виде нет чужой расстановки, пока корабль не потоплен', () => {
    const g = started();
    const me = g.first;
    const view = viewFor(g, me);
    assert.equal(view.sunk.length, 0);
    assert.equal(view.reveal, null);
    // Свой флот — есть, чужого нет ни под каким полем.
    assert.equal(view.fleet.length, FLEET.length);
    const text = JSON.stringify(view);
    assert.equal(text.includes('"fleets"'), false);
    assert.deepEqual(Object.keys(view).filter(k => k === 'foeFleet' || k === 'enemy'), []);
});

test('потопленный чужой корабль виден целиком, живые — нет', () => {
    const g = started();
    const me = g.first;
    g.turn = me;
    applyMove(g, me, { type: 'shot', cell: cellAt(4, 4) });     // катер
    g.turn = me;
    applyMove(g, me, { type: 'shot', cell: cellAt(0, 0) });     // ранили линкор

    const view = viewFor(g, me);
    assert.equal(view.sunk.length, 1);
    assert.deepEqual(view.sunk[0], { x: 4, y: 4, len: 1, dir: ACROSS });
    assert.deepEqual(woundedCells(view), [cellAt(0, 0)]);
    // Живых длин стало на катер меньше.
    assert.deepEqual(enemyLeft(view).sort((a, b) => b - a), [4, 3, 3, 2, 2, 2, 1, 1, 1]);
});

test('после конца партии чужой флот открывается', () => {
    const g = started();
    resign(g, 1);
    const view = viewFor(g, 0);
    assert.equal(view.reveal.length, FLEET.length);
    assert.equal(viewFor(g, 1).reveal.length, FLEET.length);
});

test('своих потерь в виде ровно столько, сколько живых кораблей', () => {
    const g = started();
    const me = g.first;
    const foe = 1 - me;
    // Соперник топит катер на (0,6).
    g.turn = foe;
    applyMove(g, foe, { type: 'shot', cell: cellAt(0, 6) });
    assert.equal(viewFor(g, me).myLeft, FLEET.length - 1);
    assert.equal(viewFor(g, foe).myLeft, FLEET.length);
});

// ── Хранение ─────────────────────────────────────────────────────────────────

test('позиция переживает запись и чтение', () => {
    const g = started(randomFleet(rng(11)), randomFleet(rng(12)), 42);
    g.turn = g.first;
    applyMove(g, g.first, { type: 'shot', cell: cellAt(3, 3) });
    const copy = cloneGame(g);
    assert.deepEqual(serialize(copy), serialize(g));
});

test('чтение чинит мусор: чужие поля, кривые числа, лишние клетки', () => {
    const broken = deserialize({
        phase: 'что-то',
        turn: 5,
        fleets: ['нет', [{ x: 1, y: 2, len: 3, dir: 9 }]],
        ready: [1, 0],
        shots: [[7, -3], null],
        last: { seat: 4, cell: 5000, hit: 1, sunk: 0 },
        winner: 3,
    });
    assert.equal(broken.phase, 'setup');
    assert.equal(broken.turn, -1);
    assert.equal(broken.fleets[0], null);
    assert.deepEqual(broken.fleets[1], [{ x: 1, y: 2, len: 3, dir: ACROSS }]);
    assert.equal(broken.shots[0].length, CELLS);
    assert.equal(broken.shots[0][0], NONE, 'неизвестная отметка — как будто не стреляли');
    assert.equal(broken.shots[1].length, CELLS);
    assert.equal(broken.last.cell, CELLS - 1);
    assert.equal(broken.last.seat, 1);
    assert.equal(broken.winner, 1);
});

// ── Партия всегда кончается ──────────────────────────────────────────────────

test('поле конечно: партию нельзя тянуть дольше, чем клеток на двоих', () => {
    const g = started(randomFleet(rng(3)), randomFleet(rng(4)), 9);
    let shots = 0;
    while (g.phase === 'play' && shots < CELLS * 2 + 10) {
        const seat = toMove(g);
        const free = [];
        for (let c = 0; c < CELLS; c++) if (g.shots[seat][c] === NONE) free.push(c);
        assert.ok(free.length, 'стрелять некуда, а партия ещё идёт');
        applyMove(g, seat, { type: 'shot', cell: free[0] });
        shots++;
    }
    assert.equal(g.phase, 'over');
    assert.ok(shots <= CELLS * 2, `выстрелов ${shots}`);
});

test('каждый выстрел закрывает клетку — ни один не проходит впустую', () => {
    const g = started(randomFleet(rng(21)), randomFleet(rng(22)), 5);
    while (g.phase === 'play') {
        const seat = toMove(g);
        const before = g.shots[seat].filter(v => v === NONE).length;
        const cell = g.shots[seat].findIndex(v => v === NONE);
        applyMove(g, seat, { type: 'shot', cell });
        assert.ok(g.shots[seat].filter(v => v === NONE).length < before);
    }
    assert.equal(g.phase, 'over');
});

test('размер поля и флот сходятся', () => {
    assert.equal(CELLS, SIZE * SIZE);
    assert.equal(FLEET.length, 10);
    assert.equal(FLEET_CELLS, 20);
    // Флот занимает пятую часть поля — на этом стоит и расстановка, и оценка
    // «сколько выстрелов нужно» в тестах бота.
    assert.equal(FLEET_CELLS * 5, CELLS);
});

test('корабль считается потопленным только когда попали во все его клетки', () => {
    const shots = new Array(CELLS).fill(NONE);
    const ship = shipAt(0, 0, 2, ACROSS);
    shots[cellAt(0, 0)] = HIT;
    assert.equal(isSunk(ship, shots), false);
    shots[cellAt(1, 0)] = MISS;
    assert.equal(isSunk(ship, shots), false, 'промах по своей же клетке кораблём не считается');
    shots[cellAt(1, 0)] = HIT;
    assert.equal(isSunk(ship, shots), true);
});
