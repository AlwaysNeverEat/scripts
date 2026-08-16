// Правила и физика бильярда — shared/pool.js.
//
// Проверяем не «красиво ли катится», а то, на чём стоит парная игра: один и тот
// же удар обязан давать один и тот же результат везде (иначе живая партия
// вдвоём разъедется), шары не должны проходить сквозь друг друга, а разбор
// восьмёрки — отдавать победу тому, кто её заслужил.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createGame, shoot, settle, stepFrame, cloneGame, stateHash, serialize, deserialize,
    canPlaceCue, legalTargets, remaining, ballById, resign, aimCast,
    TABLE_W, TABLE_H, BALL_R, HEAD_X, POS_SCALE, DIR_SCALE, POWER_MAX, POWER_MIN,
    CUE, EIGHT, SOLIDS, STRIPES, groupOf,
} from './pool.js';

// Разбой из дома — с него начинается любая партия, и он же самый тяжёлый удар
// для физики: пятнадцать шаров разлетаются из касания.
function breakShot(game, power = 900) {
    const cue = ballById(game, CUE);
    const res = shoot(game, {
        dx: DIR_SCALE, dy: 0, power,
        cx: Math.round(cue.x * POS_SCALE), cy: Math.round(cue.y * POS_SCALE),
    });
    assert.equal(res.ok, true, res.reason);
    return settle(game);
}

test('шары не пересекаются даже после разбоя', () => {
    const game = createGame({ seed: 7 });
    breakShot(game);
    const live = game.balls.filter(b => !b.in);
    for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
            const dx = live[i].x - live[j].x;
            const dy = live[i].y - live[j].y;
            const d = Math.sqrt(dx * dx + dy * dy);
            // Допуск в тысячную дюйма: расталкивание работает с числами с
            // плавающей точкой, идеального касания там не бывает.
            assert.ok(d >= BALL_R * 2 - 0.001, `шары ${live[i].id} и ${live[j].id} слиплись: ${d}`);
        }
    }
});

test('шары остаются на столе', () => {
    const game = createGame({ seed: 11 });
    breakShot(game);
    for (const b of game.balls) {
        if (b.in) continue;
        assert.ok(b.x >= BALL_R - 0.001 && b.x <= TABLE_W - BALL_R + 0.001, `шар ${b.id} за бортом по x: ${b.x}`);
        assert.ok(b.y >= BALL_R - 0.001 && b.y <= TABLE_H - BALL_R + 0.001, `шар ${b.id} за бортом по y: ${b.y}`);
    }
});

test('одинаковый удар из одинаковой позиции даёт одинаковый результат', () => {
    // Это тот самый инвариант, на котором держится игра вдвоём: клиент соперника
    // доигрывает удар у себя и обязан получить ровно ту же позицию.
    for (const seed of [1, 42, 2024]) {
        const a = createGame({ seed });
        const b = createGame({ seed });
        breakShot(a);
        breakShot(b);
        assert.equal(stateHash(a), stateHash(b), `разбой разошёлся на зерне ${seed}`);
    }
});

test('партия целиком повторяется по списку ударов', () => {
    const shots = [
        { dx: DIR_SCALE, dy: 0, power: 880 },
        { dx: 7000, dy: 3000, power: 500 },
        { dx: -4000, dy: 9000, power: 640 },
        { dx: 9000, dy: -2000, power: 300 },
    ];
    const play = () => {
        const game = createGame({ seed: 5 });
        const cue = ballById(game, CUE);
        shots.forEach((shot, i) => {
            if (game.phase === 'over') return;
            const full = { ...shot };
            // Первый удар — из дома, дальше биток ставим только когда дали руку.
            if (i === 0) { full.cx = Math.round(cue.x * POS_SCALE); full.cy = Math.round(cue.y * POS_SCALE); }
            else if (game.ballInHand) { full.cx = Math.round((HEAD_X - 2) * POS_SCALE); full.cy = Math.round((TABLE_H / 2) * POS_SCALE); }
            if (shoot(game, full).ok) settle(game);
        });
        return stateHash(game);
    };
    assert.equal(play(), play());
});

test('раскладка переживает поездку в базу и обратно', () => {
    const game = createGame({ seed: 3 });
    breakShot(game);
    const back = deserialize(JSON.parse(JSON.stringify(serialize(game))));
    assert.equal(stateHash(back), stateHash(game));
});

test('счёт кадров не зависит от того, кто считает — окно или сервер', () => {
    // Окно зовёт stepFrame на каждый кадр, сервер крутит settle в цикле. Это
    // должен быть один и тот же расчёт.
    const byFrames = createGame({ seed: 9 });
    const byLoop = createGame({ seed: 9 });
    const cue = ballById(byFrames, CUE);
    const shot = { dx: DIR_SCALE, dy: 200, power: 750, cx: Math.round(cue.x * POS_SCALE), cy: Math.round(cue.y * POS_SCALE) };

    shoot(byFrames, { ...shot });
    for (let i = 0; i < 60 * 30; i++) if (stepFrame(byFrames).settled) break;

    shoot(byLoop, { ...shot });
    settle(byLoop);

    assert.equal(stateHash(byFrames), stateHash(byLoop));
});

test('биток нельзя ставить в чужой шар, за борт и вне дома до разбоя', () => {
    const game = createGame({ seed: 4 });
    assert.ok(canPlaceCue(game, HEAD_X - 5, TABLE_H / 2), 'дом должен пускать');
    assert.ok(!canPlaceCue(game, HEAD_X + 5, TABLE_H / 2), 'до разбоя бьют только из дома');
    assert.ok(!canPlaceCue(game, -1, TABLE_H / 2), 'за бортом ставить нельзя');
    assert.ok(!canPlaceCue(game, 0.5, TABLE_H / 2), 'шар не помещается в борт');

    game.broke = true;
    assert.ok(canPlaceCue(game, TABLE_W / 2, TABLE_H / 2), 'после разбоя рука свободна');
    const one = game.balls.find(b => b.id === 1);
    assert.ok(!canPlaceCue(game, one.x, one.y), 'на занятое место ставить нельзя');
});

test('удар отвергается, если он бессмысленный или не по правилам', () => {
    const game = createGame({ seed: 4 });
    assert.equal(shoot(game, { dx: 0, dy: 0, power: 500, cx: 10_000, cy: 19_000 }).reason, 'no_direction');
    assert.equal(shoot(game, { dx: DIR_SCALE, dy: 0, power: POWER_MAX + 1, cx: 10_000, cy: 19_000 }).reason, 'power');
    assert.equal(shoot(game, { dx: DIR_SCALE, dy: 0, power: POWER_MIN - 1, cx: 10_000, cy: 19_000 }).reason, 'power');
    // Биток в лузе — поставить его обязаны, иначе бить нечем.
    ballById(game, CUE).in = true;
    assert.equal(shoot(game, { dx: DIR_SCALE, dy: 0, power: 500 }).reason, 'must_place');
});

// ── Правила восьмёрки ────────────────────────────────────────────────────────
// Позиции собираем руками: ждать нужного расклада от случайного разбоя — это
// тест, который однажды перестанет проходить сам по себе.

// Ориентиры вместо чисел: середина длинного борта (там средняя луза, куда в
// тестах и забивают) и дальний конец стола, где шар просто стоит и не мешает.
const MID = TABLE_W / 2;
const FAR = TABLE_W - 10;

/** Пустой стол с заданными шарами: { id: [x, y] }. */
function table(where, patch = {}) {
    const game = createGame({ seed: 1 });
    game.broke = true;
    game.ballInHand = false;
    for (const b of game.balls) {
        const at = where[b.id];
        if (at) { b.x = at[0]; b.y = at[1]; b.in = false; }
        else b.in = true;
    }
    Object.assign(game, patch);
    return game;
}

// Прямой удар в заданную сторону. Позиции в тестах ниже выставлены так, чтобы
// прицельный шар шёл В СРЕДНЮЮ ЛУЗУ по прямой: у неё центр ровно на борту, и
// попадание не зависит от того, на сколько сотых долей радиус захвата больше
// радиуса шара, — угловые в этом смысле куда капризнее.
function straightShot(game, power = 400, dir = { dx: DIR_SCALE, dy: 0 }) {
    const res = shoot(game, { ...dir, power });
    assert.equal(res.ok, true, res.reason);
    return settle(game);
}

const UP = { dx: 0, dy: -DIR_SCALE };

test('первый честно забитый шар назначает группы', () => {
    // Биток, шар 3 и средняя луза (50, 0) на одной вертикали.
    const game = table({ [CUE]: [MID, TABLE_H / 2], 3: [MID, 8], 11: [FAR, TABLE_H - 8], [EIGHT]: [12, TABLE_H / 2] });
    const out = straightShot(game, 500, UP);
    assert.ok(out.potted.includes(3), 'шар 3 должен упасть');
    assert.equal(out.foul, false, out.reason);
    assert.equal(game.groups[0], SOLIDS);
    assert.equal(game.groups[1], STRIPES);
    assert.equal(out.continues, true, 'забил — бьёт дальше');
    assert.equal(game.turn, 0);
});

test('чужой шар первым — фол и рука сопернику', () => {
    const game = table(
        { [CUE]: [MID, TABLE_H / 2], 11: [MID, 8], 3: [FAR, TABLE_H - 8], [EIGHT]: [12, TABLE_H / 2] },
        { groups: [SOLIDS, STRIPES] },
    );
    const out = straightShot(game, 500);
    assert.equal(out.foul, true);
    assert.equal(out.reason, 'wrong_ball');
    assert.equal(game.turn, 1);
    assert.equal(game.ballInHand, true);
    // Стол закрыт группами заранее, но и открытый фол бы не закрыл — см. ниже.
});

test('фол не назначает группу на открытом столе', () => {
    // Биток летит мимо всех и не доходит ни до кого: касания нет вовсе.
    const game = table({ [CUE]: [MID, TABLE_H / 2], 3: [MID, 5], 11: [MID, TABLE_H - 5], [EIGHT]: [FAR, TABLE_H / 2] });
    const out = shoot(game, { dx: 0, dy: 0, power: 500 });
    assert.equal(out.ok, false);
    // Настоящий промах. Биток пускаем вдоль стола по своей линии, а все шары
    // ставим на ДРУГОЙ высоте: удар вдоль оси меняет только знак скорости на
    // бортах, поэтому биток так и будет ходить туда-сюда по своей линии и не
    // встретит никого, сколько бы он ни катился. Расчёт на «не доедет» тут не
    // годится — стол живой, шар отражается и возвращается.
    const miss = table({ [CUE]: [MID, 5], 3: [20, TABLE_H - 5], 11: [40, TABLE_H - 5], [EIGHT]: [60, TABLE_H - 5] });
    const res = shoot(miss, { dx: DIR_SCALE, dy: 0, power: 300 });
    assert.equal(res.ok, true);
    const out2 = settle(miss);
    assert.equal(out2.foul, true);
    assert.equal(out2.reason, 'no_contact');
    assert.equal(miss.groups[0], null, 'после фола стол остаётся открытым');
});

test('биток в лузу — фол, даже если свой шар упал', () => {
    // Биток за прицельным, тот — у самой лузы, и бьём со всей силы: после
    // прямого попадания биток сохраняет несколько процентов скорости (шары не
    // абсолютно упругие) и на таком расстоянии доезжает до лузы следом.
    const game = table(
        { [CUE]: [MID, 7], 3: [MID, 3.4], [EIGHT]: [FAR, TABLE_H - 8], 11: [FAR, 8] },
        { groups: [SOLIDS, STRIPES] },
    );
    const res = straightShot(game, 1000, UP);
    assert.ok(res.potted.includes(3), 'свой шар упал');
    assert.equal(ballById(game, CUE).in, true, 'биток тоже');
    assert.equal(res.foul, true);
    assert.equal(res.reason, 'scratch');
    assert.equal(game.ballInHand, true);
    assert.equal(game.turn, 1, 'забитый свой шар фола не отменяет');
});

test('восьмёрка раньше своих — поражение', () => {
    // Удар ЧЕСТНЫЙ: биток первым касается своего шара 3, а тот уже сталкивает
    // восьмёрку в лузу. Фола нет, но своя группа не разобрана — и это поражение.
    // Именно этот случай, а не «ударил по восьмёрке», и есть «забил рано».
    const game = table(
        { [CUE]: [MID, TABLE_H / 2], 3: [MID, 8.5], [EIGHT]: [MID, 4], 11: [FAR, TABLE_H - 8] },
        { groups: [SOLIDS, STRIPES] },
    );
    const out = straightShot(game, 500, UP);
    assert.equal(out.foul, false, out.reason);
    assert.equal(out.reason, 'eight_early');
    assert.equal(out.winner, 1, 'выигрывает соперник');
    assert.equal(game.phase, 'over');
    assert.equal(game.winner, 1);
});

test('удар по восьмёрке при неразобранной группе — фол и поражение', () => {
    const game = table(
        { [CUE]: [MID, TABLE_H / 2], [EIGHT]: [MID, 8], 3: [FAR, TABLE_H - 8] },
        { groups: [SOLIDS, STRIPES] },
    );
    // Своих шаров на столе ещё нет — целиться в восьмёрку нельзя вовсе.
    assert.deepEqual(legalTargets(game, 0), [3]);
    const out = straightShot(game, 500, UP);
    assert.equal(out.reason, 'eight_foul');
    assert.equal(out.winner, 1);
});

test('восьмёрка последней — победа', () => {
    const game = table(
        { [CUE]: [MID, TABLE_H / 2], [EIGHT]: [MID, 8], 11: [FAR, TABLE_H - 8] },
        { groups: [SOLIDS, STRIPES] },
    );
    // Сплошных на столе не осталось: восьмёрка — законная цель.
    assert.equal(remaining(game, SOLIDS), 0);
    assert.deepEqual(legalTargets(game, 0), [EIGHT]);
    const out = straightShot(game, 500, UP);
    assert.equal(out.winner, 0);
    assert.equal(game.reason, 'eight');
});

test('восьмёрка забита, но биток следом — поражение', () => {
    // Та же расстановка, что и в тесте про скретч со своим шаром, только у лузы
    // стоит восьмёрка: забить её и уронить биток — проигрыш, а не победа.
    const game = table(
        { [CUE]: [MID, 7], [EIGHT]: [MID, 3.4], 11: [FAR, TABLE_H - 8] },
        { groups: [SOLIDS, STRIPES] },
    );
    assert.equal(remaining(game, SOLIDS), 0, 'своё разобрано — бить по восьмёрке законно');
    const res = straightShot(game, 1000, UP);
    assert.equal(ballById(game, CUE).in, true, 'биток в лузе');
    assert.equal(res.reason, 'eight_foul');
    assert.equal(res.winner, 1, 'скретч на восьмёрке — проигрыш');
});

test('восьмёрка на разбое — переигровка, а не проигрыш', () => {
    const game = createGame({ seed: 1 });
    // Подменяем позицию: биток вплотную к восьмёрке у самой лузы. Ждать такого
    // разбоя от случайного зерна — значит однажды получить красный тест.
    game.balls.forEach(b => { if (b.id !== CUE && b.id !== EIGHT) b.in = true; });
    const cue = ballById(game, CUE);
    const eight = ballById(game, EIGHT);
    // Биток оставляем там, где он и стоит перед разбоем (в доме — иначе его туда
    // просто не поставить), а восьмёрку кладём на прямую от него до угловой лузы.
    // Направление считаем, а не подбираем: так тест переживёт правку размеров
    // стола, из-за которой подобранные числа однажды перестали бы сходиться.
    const dx = 0 - cue.x;
    const dy = 0 - cue.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    eight.x = cue.x + (dx / len) * 20;
    eight.y = cue.y + (dy / len) * 20;

    const out = shoot(game, {
        dx: Math.round((dx / len) * DIR_SCALE),
        dy: Math.round((dy / len) * DIR_SCALE),
        power: 500,
    });
    assert.equal(out.ok, true, out.reason);
    const res = settle(game);
    assert.equal(res.rerack, true);
    assert.equal(game.phase, 'aim');
    assert.equal(game.winner, null);
    assert.equal(game.broke, false, 'разбивают заново');
    assert.equal(game.turn, 0, 'разбивает тот же');
    assert.equal(game.balls.filter(b => !b.in).length, 16, 'пирамида собрана целиком');
});

test('«толкнуть и отдать ход» невозможно даже слабейшим ударом', () => {
    // Правило «после касания кто-то обязан дойти до борта» существует ровно
    // против этого: иначе можно двинуть шар на полдюйма и сидеть.
    //
    // На нынешней шкале силы фол no_rail недостижим — самый слабый удар всё
    // равно доводит шар до борта (см. SPEED_MIN в pool.js), и тест проверяет
    // именно ЭТО, а не сам фол: если однажды нижний край шкалы опустят, тест
    // покраснеет и напомнит, что правило снова начало работать.
    const game = table(
        { [CUE]: [20, TABLE_H / 2], 3: [23, TABLE_H / 2], [EIGHT]: [FAR, TABLE_H - 8], 11: [FAR, 8] },
        { groups: [SOLIDS, STRIPES] },
    );
    const out = shoot(game, { dx: DIR_SCALE, dy: 0, power: POWER_MIN });
    assert.equal(out.ok, true);
    const res = settle(game);
    assert.equal(res.foul, false, `слабейший удар не должен быть фолом: ${res.reason}`);
    assert.equal(res.continues, false, 'не забил — ход переходит');
    assert.equal(game.ballInHand, false, 'фола не было — руки не дают');
});

test('не забил — ход переходит', () => {
    // Бьём вдоль длинного борта: там шар доезжает до борта и возвращается, но ни
    // в одну лузу не попадает — ровно тот случай, ради которого тест и написан.
    const game = table(
        { [CUE]: [MID, TABLE_H / 2], 3: [MID - 20, TABLE_H / 2], [EIGHT]: [FAR, TABLE_H / 2], 11: [FAR, TABLE_H - 8] },
        { groups: [SOLIDS, STRIPES] },
    );
    const out = shoot(game, { dx: -DIR_SCALE, dy: 0, power: 600 });
    assert.equal(out.ok, true);
    const res = settle(game);
    assert.equal(res.potted.length, 0, 'ничего не упало');
    assert.equal(res.foul, false, res.reason);
    assert.equal(res.continues, false);
    assert.equal(game.turn, 1);
    assert.equal(game.ballInHand, false, 'без фола руки не дают');
});

test('сдача отдаёт партию сопернику', () => {
    const game = createGame({ seed: 2 });
    assert.equal(resign(game, 1), true);
    assert.equal(game.winner, 0);
    assert.equal(game.phase, 'over');
    assert.equal(resign(game, 0), false, 'законченную партию не сдают дважды');
});

test('линия прицела упирается в первый шар на пути', () => {
    const game = table({ [CUE]: [8, TABLE_H / 2], 3: [30, TABLE_H / 2], 11: [50, TABLE_H / 2], [EIGHT]: [FAR, TABLE_H / 2] });
    const hit = aimCast(game, 8, TABLE_H / 2, 1, 0);
    assert.equal(hit.id, 3, 'ближний шар заслоняет дальний');
    assert.ok(hit.x < 30 && hit.x > 24, 'точка касания перед шаром, а не в центре');

    const rail = aimCast(game, 8, TABLE_H / 2, -1, 0);
    assert.equal(rail.id, null, 'в ту сторону шаров нет — упираемся в борт');
});

test('клон не тянет за собой оригинал', () => {
    const game = createGame({ seed: 8 });
    const copy = cloneGame(game);
    breakShot(copy);
    assert.notEqual(stateHash(copy), stateHash(game), 'копия отыграла, оригинал стоит');
    assert.equal(game.phase, 'aim');
});

test('группы шаров распределены по номерам', () => {
    assert.equal(groupOf(1), SOLIDS);
    assert.equal(groupOf(7), SOLIDS);
    assert.equal(groupOf(9), STRIPES);
    assert.equal(groupOf(15), STRIPES);
    assert.equal(groupOf(EIGHT), null);
    assert.equal(groupOf(CUE), null);
});
