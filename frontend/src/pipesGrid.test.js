import test from 'node:test';
import assert from 'node:assert/strict';

import { createGrid, spawnPipe, stepPipe, rng, DIRS } from './pipesGrid.js';

// Прогон одной трубы до смерти: возвращает пройденные отрезки.
function runPipe(grid, rnd) {
    const pipe = spawnPipe(grid, rnd);
    if (!pipe) return [];
    const segs = [];
    for (let guard = 0; guard < 100000; guard++) {
        const seg = stepPipe(pipe, grid, rnd);
        if (!seg) break;
        segs.push(seg);
    }
    assert.equal(pipe.alive, false, 'труба обязана умереть, а не крутиться вечно');
    return segs;
}

test('узел не занимается дважды, а отрезок всегда длиной в одну клетку', () => {
    const half = 5;
    const grid = createGrid(half);
    const rnd = rng(20260902);
    const seen = new Set();

    for (let pipes = 0; pipes < 40; pipes++) {
        for (const s of runPipe(grid, rnd)) {
            const key = `${s.bx},${s.by},${s.bz}`;
            assert.equal(seen.has(key), false, `узел ${key} занят дважды`);
            seen.add(key);

            const d = Math.abs(s.ax - s.bx) + Math.abs(s.ay - s.by) + Math.abs(s.az - s.bz);
            assert.equal(d, 1, 'труба ходит по клеткам, а не по диагонали и не через клетку');
            for (const v of [s.bx, s.by, s.bz]) {
                assert.ok(v >= -half && v <= half, `узел ${key} вылез за куб`);
            }
        }
    }
    assert.ok(seen.size > 100, 'на кубе 11³ труба обязана вырасти заметно длиннее сотни клеток');
});

// Тупик — не гипотеза: к концу цикла клубок плотный, и оригинал в этот момент
// молча замирает. У нас труба обязана умереть, чтобы сверху пришла новая.
test('запертая труба умирает, а не встаёт навсегда', () => {
    const grid = createGrid(1);
    const rnd = rng(1);
    // Заняли весь куб, кроме центра, — из центра идти некуда.
    for (let x = -1; x <= 1; x++) {
        for (let y = -1; y <= 1; y++) {
            for (let z = -1; z <= 1; z++) {
                if (x || y || z) grid.take(x, y, z);
            }
        }
    }
    const pipe = spawnPipe(grid, rnd);
    assert.deepEqual([pipe.x, pipe.y, pipe.z], [0, 0, 0]);
    assert.equal(stepPipe(pipe, grid, rnd), null);
    assert.equal(pipe.alive, false);
    assert.equal(stepPipe(pipe, grid, rnd), null, 'мёртвая труба не оживает');
});

test('рост кончается: куб конечен, и трубы его добивают', () => {
    const grid = createGrid(3);
    const rnd = rng(42);
    const total = grid.size ** 3;
    let guard = 0;
    while (grid.taken() < total) {
        assert.ok(guard++ < total, 'сеятель труб зациклился');
        const pipe = spawnPipe(grid, rnd);
        if (!pipe) break;
        while (stepPipe(pipe, grid, rnd));
    }
    assert.equal(grid.taken(), total, 'куб обязан забиться целиком');
    assert.equal(spawnPipe(grid, rnd), null, 'в забитом кубе трубу сеять негде');
});

test('поворот отмечается ровно там, где меняется направление', () => {
    const grid = createGrid(6);
    const rnd = rng(777);
    const pipe = spawnPipe(grid, rnd);
    let prev = null;
    for (let i = 0; i < 200; i++) {
        const s = stepPipe(pipe, grid, rnd);
        if (!s) break;
        const dir = [s.bx - s.ax, s.by - s.ay, s.bz - s.az];
        assert.ok(DIRS.some(d => d[0] === dir[0] && d[1] === dir[1] && d[2] === dir[2]));
        if (prev) {
            const same = prev[0] === dir[0] && prev[1] === dir[1] && prev[2] === dir[2];
            assert.equal(s.turn, !same, 'шарнир ставится ровно на смене направления');
        } else {
            assert.equal(s.turn, false, 'первый отрезок поворотом не бывает');
        }
        prev = dir;
    }
});

test('сид повторяем: тот же клубок из того же числа', () => {
    const grow = () => {
        const grid = createGrid(4);
        const rnd = rng(2024);
        return runPipe(grid, rnd).map(s => `${s.bx},${s.by},${s.bz},${s.turn}`).join('|');
    };
    assert.equal(grow(), grow());
});
