// Соперник-бот — shared/poolBot.js.
//
// Проверяем три вещи, без которых бот не соперник, а источник багов: он всегда
// придумывает удар, который движок принимает; он не проходит мимо шара у лузы;
// и уровни сложности отличаются в правильную сторону.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createGame, shoot, settle, ballById,
    CUE, EIGHT, SOLIDS, STRIPES, TABLE_W, TABLE_H,
} from './pool.js';

import { pickShot, EASY, NORMAL, HARD } from './poolBot.js';

// Ориентиры вместо чисел — как в pool.test.js: середина длинного борта (там
// средняя луза) и дальний конец стола, где шар стоит и не мешает.
const MID = TABLE_W / 2;
const FAR = TABLE_W - 10;

// Случайность с зерном: у бота она есть (дрожь руки, перебор отбойных ударов), а
// красный тест раз в двадцать прогонов хуже отсутствующего.
function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Партия ботов до конца. Возвращает победителя и число ударов. */
function playOut(seed, level0, level1, maxShots = 400) {
    const game = createGame({ seed });
    const rng = seeded(seed);
    let shots = 0;
    while (game.phase !== 'over' && shots < maxShots) {
        const shot = pickShot(game, { level: game.turn === 0 ? level0 : level1, rng });
        const res = shoot(game, shot);
        assert.equal(res.ok, true, `бот придумал удар, который движок не принял: ${res.reason}`);
        settle(game);
        shots++;
    }
    return { winner: game.winner, shots };
}

test('бот всегда придумывает удар, который принимает движок', () => {
    // Заодно проверяем, что партия вообще заканчивается: бот, не умеющий добить
    // восьмёрку, крутил бы стол вечно.
    for (const seed of [1, 18, 35, 52]) {
        const { winner, shots } = playOut(seed, HARD, NORMAL);
        assert.notEqual(winner, null, `партия на зерне ${seed} не доигралась за ${shots} ударов`);
    }
});

test('бот забивает шар, стоящий у лузы', () => {
    const game = createGame({ seed: 2 });
    game.broke = true;
    game.ballInHand = false;
    game.groups = [SOLIDS, STRIPES];
    // Только биток, свой шар в двух дюймах от средней лузы и чужой шар вдали.
    const where = { [CUE]: [MID, TABLE_H / 2], 3: [MID, 4], 11: [FAR, TABLE_H - 8], [EIGHT]: [12, TABLE_H - 8] };
    for (const b of game.balls) {
        const at = where[b.id];
        if (at) { b.x = at[0]; b.y = at[1]; b.in = false; } else b.in = true;
    }

    const shot = pickShot(game, { level: HARD, rng: seeded(4) });
    assert.equal(shoot(game, shot).ok, true);
    const out = settle(game);
    assert.ok(out.potted.includes(3), 'шар у лузы должен быть забит');
    assert.equal(out.foul, false, out.reason);
});

test('с рукой бот ставит биток и бьёт по своему шару', () => {
    const game = createGame({ seed: 6 });
    game.broke = true;
    game.ballInHand = true;
    game.groups = [SOLIDS, STRIPES];
    const where = { [CUE]: [10, 10], 3: [55, TABLE_H / 2], 11: [30, TABLE_H - 6], [EIGHT]: [65, TABLE_H - 5] };
    for (const b of game.balls) {
        const at = where[b.id];
        if (at) { b.x = at[0]; b.y = at[1]; b.in = false; } else b.in = true;
    }

    const shot = pickShot(game, { level: HARD, rng: seeded(9) });
    assert.ok(shot.cx != null && shot.cy != null, 'рука должна быть использована');
    assert.equal(shoot(game, shot).ok, true);
    const out = settle(game);
    assert.equal(out.foul, false, `с рукой фолить нечем: ${out.reason}`);
});

test('сильный бот обыгрывает слабого', () => {
    // Уровни отличаются только точностью, поэтому разрыв должен быть заметным,
    // но не обязан быть всухую — на то он и бильярд.
    let strong = 0;
    const seeds = [3, 21, 39, 57, 75, 93];
    for (const seed of seeds) {
        // Слабый разбивает — иначе к преимуществу в точности добавилось бы
        // преимущество первого удара, и тест мерил бы не то.
        const { winner } = playOut(seed, EASY, HARD);
        if (winner === 1) strong++;
    }
    assert.ok(strong >= 5, `сильный выиграл всего ${strong} из ${seeds.length}`);
});

test('бот не бьёт по восьмёрке, пока не разобрал свою группу', () => {
    const game = createGame({ seed: 5 });
    game.broke = true;
    game.ballInHand = false;
    game.groups = [SOLIDS, STRIPES];
    // Восьмёрка стоит у лузы соблазнительнее всех — но она чужая до поры.
    const where = { [CUE]: [MID, TABLE_H / 2], [EIGHT]: [MID, 4], 3: [FAR, TABLE_H - 8], 11: [12, TABLE_H - 8] };
    for (const b of game.balls) {
        const at = where[b.id];
        if (at) { b.x = at[0]; b.y = at[1]; b.in = false; } else b.in = true;
    }

    const shot = pickShot(game, { level: HARD, rng: seeded(7) });
    assert.equal(shoot(game, shot).ok, true);
    const out = settle(game);
    assert.equal(out.winner, null, 'бот проиграл сам себе, забив восьмёрку раньше срока');
});
