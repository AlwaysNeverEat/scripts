// ─────────────────────────────────────────────────────────────────────────────
// Тесты «Рогалика».
//
// Половина файла — обычные проверки правил, вторая половина — АВТОИГРОК:
// простой бот, который играет забег целиком по тем же функциям, что и окно
// игры. Он тут не ради «покрытия», а ради двух вещей, которые иначе не поймать
// вовсе:
//
//   1. ЗАБЕГ ОБЯЗАН ЗАКАНЧИВАТЬСЯ. Игра бесконечная по задумке, и любая ошибка
//      в эскалации превращает её в вечную прогулку — заметить это глазами
//      нельзя, потому что первые десять минут выглядят нормально.
//   2. ПЛАНКА СЛОЖНОСТИ. Первый цикл средний игрок должен проходить почти
//      всегда, а десятый — не проходить никогда. Числа контента подобраны
//      именно этим прогоном, и он же их стережёт: одна правка баланса «на глаз»
//      ломает обе границы молча.
//
// Бот играет намеренно ПРОСТО (закрыться, если прилетает больше, чем есть
// блока, иначе бить) — он изображает не хорошего игрока, а среднего. Если
// планку держит он, человек с колодой пройдёт дальше.
// ─────────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    startRun, nextNodes, enterNode, playCard, endTurn, chooseReward, chooseEvent,
    removeCard, useStone, useShard, giveUp, cardOf, cardText, cardView, addCard, addTime, takeLog,
    intentView, enemyView, runResult, isPlausibleRun, scaleValue, mutPower, costOf,
    MAP_ROWS, START_HP, HAND_SIZE, ENERGY_PER_TURN, LEVEL_STEP,
    SCREEN_MAP, SCREEN_BATTLE, SCREEN_REWARD, SCREEN_EVENT, SCREEN_OVER,
    NODE_BOSS, NODE_ELITE, NODE_FIGHT, NODE_CHEST, NODE_EVENT,
    CARDS, CARD_BY_ID, MUTATIONS, MUTATORS, I_ATTACK,
    POISON, STR, THORNS,
} from './roguelike.js';

// ── Устройство карты узлов ───────────────────────────────────────────────────

test('карта: строк ровно столько, сколько обещано, и кончается боссом', () => {
    for (let seed = 1; seed <= 50; seed++) {
        const run = startRun(seed);
        const { rows, links } = run.map;
        assert.equal(rows.length, MAP_ROWS, `сид ${seed}`);
        assert.equal(rows.at(-1).length, 1);
        assert.equal(rows.at(-1)[0].t, NODE_BOSS);
        assert.ok(rows[0].every(n => n.t === NODE_FIGHT), 'первая строка — бой');
        assert.equal(links.length, MAP_ROWS - 1);
    }
});

test('карта: тупиков нет — в каждый узел кто-то ведёт и из каждого куда-то ведёт', () => {
    for (let seed = 1; seed <= 50; seed++) {
        const { rows, links } = startRun(seed).map;
        for (let r = 0; r < rows.length - 1; r++) {
            for (let i = 0; i < rows[r].length; i++) {
                assert.ok(links[r][i].length > 0, `сид ${seed}: узел ${r}:${i} никуда не ведёт`);
                assert.ok(links[r][i].every(j => j >= 0 && j < rows[r + 1].length));
            }
            for (let j = 0; j < rows[r + 1].length; j++) {
                assert.ok(links[r].some(to => to.includes(j)), `сид ${seed}: в узел ${r + 1}:${j} не попасть`);
            }
        }
    }
});

test('карта: элита не встречается на первых строках', () => {
    for (let seed = 1; seed <= 80; seed++) {
        const { rows } = startRun(seed).map;
        for (let r = 0; r < 3; r++) {
            assert.ok(rows[r].every(n => n.t !== NODE_ELITE), `сид ${seed}, строка ${r}`);
        }
    }
});

// ── Воспроизводимость по сиду ────────────────────────────────────────────────

test('один сид — один и тот же забег', () => {
    const a = playRun(startRun(777));
    const b = playRun(startRun(777));
    assert.deepEqual(a, b);
    // Разные сиды почти наверняка дают разные забеги — иначе генератор не
    // генератор. Сравниваем сразу десяток: совпадение двух бывает случайно.
    const many = new Set();
    for (let seed = 100; seed < 120; seed++) many.add(JSON.stringify(playRun(startRun(seed))));
    assert.ok(many.size > 15, `забеги слиплись: разных ${many.size} из 20`);
});

// ── Бой ──────────────────────────────────────────────────────────────────────

test('намерение врага видно ДО хода игрока и совпадает с прилетевшим уроном', () => {
    // Это главное правило игры: без видимого намерения блок ставится наугад.
    for (let seed = 1; seed <= 60; seed++) {
        const run = startRun(seed);
        enterNode(run, nextNodes(run)[0].i);
        assert.equal(run.screen, SCREEN_BATTLE);
        const intent = intentView(run);
        assert.ok(intent && intent.acts.length, `сид ${seed}: намерения нет`);

        const expect = intent.acts
            .filter(a => a.t === I_ATTACK)
            .reduce((s, a) => s + a.v * a.times, 0) * (intent.twice ? 2 : 1);
        const hpBefore = run.battle.hero.hp;
        endTurn(run);   // не играем ни одной карты: блока нет, прилетит всё
        if (run.battle && run.battle.over) continue;
        const lost = hpBefore - run.battle.hero.hp;
        // Разница возможна только за счёт яда и шипов — их намерение не
        // показывает числом, но урона они добавляют, а не убавляют.
        assert.ok(lost >= expect, `сид ${seed}: обещали ${expect}, прилетело ${lost}`);
    }
});

test('броня съедает урон и ОСТАТОК ПЕРЕЖИВАЕТ ход', () => {
    // Главное отличие от одноразового блока: поставленное сегодня работает и
    // завтра. Из-за этого числа защиты в контенте и маленькие.
    const run = startRun(42);
    enterNode(run, nextNodes(run)[0].i);
    const b = run.battle;
    b.hand = [];
    b.hero.st = {};
    b.enemy.st = {};
    const guard = run.deck.find(c => c.id === 'guard');
    b.hand.push(guard.uid);
    playCard(run, 0);
    // Число берём из контента, а не пишем цифрой: баланс правят, тест не должен
    // падать от «защита теперь на единицу больше».
    assert.equal(b.hero.block, CARD_BY_ID.guard.effects[0].v);

    // Даём заведомо много брони и слабое намерение: остаток обязан дожить до
    // следующего хода игрока.
    b.hero.block = 40;
    const hp = b.hero.hp;
    endTurn(run);
    if (!b.over) {
        assert.equal(b.hero.hp, hp, 'броня не удержала удар');
        assert.ok(b.hero.block > 0, 'остаток брони сгорел');
        assert.ok(b.hero.block < 40, 'броня не потратилась вовсе');
    }
});

test('«Запас» наращивает броню каждый ход', () => {
    const run = startRun(43);
    enterNode(run, nextNodes(run)[0].i);
    const b = run.battle;
    const card = addCard(run, 'vault');
    b.hand = [card.uid];
    b.hero.energy = 9;
    playCard(run, 0);
    const after = b.hero.block;
    b.hero.block = 0;
    endTurn(run);
    if (!b.over) assert.ok(b.hero.block > 0, 'в начале хода броня не приросла');
    assert.ok(after > 0, 'сама карта брони не дала');
});

test('яд идёт мимо блока и слабеет на единицу за ход', () => {
    const run = startRun(3);
    enterNode(run, nextNodes(run)[0].i);
    const b = run.battle;
    b.hero.block = 50;
    b.hero.st[POISON] = 5;
    const hp = b.hero.hp;
    endTurn(run);
    assert.equal(b.hero.hp, hp - 5, 'яд не заметил блока');
    assert.equal(b.hero.st[POISON], 4);
});

test('шипы отвечают тому, кто бьёт', () => {
    const run = startRun(5);
    enterNode(run, nextNodes(run)[0].i);
    const b = run.battle;
    b.enemy.st[THORNS] = 4;
    b.hand = [run.deck.find(c => c.id === 'strike').uid];
    const hp = b.hero.hp;
    playCard(run, 0);
    assert.equal(b.hero.hp, hp - 4);
});

test('энергия кончается, и карту без неё сыграть нельзя', () => {
    const run = startRun(9);
    enterNode(run, nextNodes(run)[0].i);
    const b = run.battle;
    b.hero.energy = 0;
    b.hand = [run.deck.find(c => c.id === 'strike').uid];
    assert.deepEqual(playCard(run, 0), { ok: false, reason: 'energy' });
    assert.equal(b.hand.length, 1, 'карта осталась в руке');
});

test('в начале хода тянут пять карт, а не сыгранное уходит в сброс', () => {
    const run = startRun(11);
    enterNode(run, nextNodes(run)[0].i);
    const b = run.battle;
    assert.equal(b.hand.length, HAND_SIZE);
    assert.equal(b.hero.energy, ENERGY_PER_TURN);
    endTurn(run);
    if (!b.over) {
        assert.equal(b.hand.length, HAND_SIZE);
        assert.ok(b.discard.length + b.draw.length + b.hand.length + b.exhaust.length >= run.deck.length);
    }
});

test('журнал боя рассказывает ход по шагам и совпадает с итогом', () => {
    // На журнале держится весь показ боя в окне: карта прилетает на стол, цифры
    // урона отлетают, полосы едут. Если журнал разойдётся с состоянием, окно
    // покажет одно, а правила посчитают другое.
    const run = startRun(64);
    enterNode(run, nextNodes(run)[0].i);
    const b = run.battle;
    takeLog(run);                       // выбрасываем события раздачи
    b.enemy.block = 0; b.enemy.st = {};
    b.hand = [run.deck.find(c => c.id === 'strike').uid];
    b.hero.energy = 3;
    const hpBefore = b.enemy.hp;
    playCard(run, 0);

    const log = takeLog(run);
    const hit = log.find(e => e.t === 'hit' && e.who === 'enemy');
    assert.ok(hit, 'удара в журнале нет');
    assert.equal(hit.src, 'card');
    assert.equal(hit.real, hpBefore - b.enemy.hp, 'в журнале не тот урон');
    assert.equal(hit.hp, b.enemy.hp, 'в журнале не то здоровье');
    assert.deepEqual(takeLog(run), [], 'журнал не очистился');

    // Ход врага отмечен отдельно — по этой отметке окно делает паузу.
    endTurn(run);
    const turn = takeLog(run).find(e => e.t === 'turn' && e.who === 'enemy');
    assert.ok(turn, 'начало хода врага в журнале не отмечено');
});

test('журнал не растёт бесконечно, если его никто не разбирает', () => {
    // Окно закрыли посреди боя — журнал уезжает в localStorage вместе с забегом,
    // и расти ему нельзя.
    const run = startRun(65);
    enterNode(run, nextNodes(run)[0].i);
    for (let i = 0; i < 300 && !run.battle?.over; i++) endTurn(run);
    assert.ok(!run.battle || run.battle.log.length <= 400, 'журнал разросся');
});

// ── Уровни и мутации ─────────────────────────────────────────────────────────

test('уровень — ровный line-scaling одной формулой', () => {
    assert.equal(scaleValue(6, 1), 6);
    assert.equal(scaleValue(6, 2), Math.round(6 * (1 + LEVEL_STEP)));
    assert.equal(scaleValue(10, 5), Math.round(10 * (1 + LEVEL_STEP * 4)));
    // Потолка у уровня нет — это вторая ось бесконечности рядом с циклами.
    assert.ok(scaleValue(6, 30) > scaleValue(6, 20));
});

test('апгрейд ложится на ЭКЗЕМПЛЯР, а не на тип карты', () => {
    const run = startRun(1);
    const strikes = run.deck.filter(c => c.id === 'strike');
    run.stones = 1;
    useStone(run, strikes[0].uid);
    assert.equal(strikes[0].lvl, 2);
    assert.equal(strikes[1].lvl, 1, 'второй «Удар» не подрос');
    assert.equal(run.stones, 0);
    assert.equal(useStone(run, strikes[1].uid).ok, false, 'камня больше нет');
});

test('мутации стакаются умножением, а не сложением', () => {
    // ×2 → ×4 → ×8 у множителей и 1 → 2 → 4 у числовых.
    assert.equal(mutPower('odd', 1), 2);
    assert.equal(mutPower('odd', 2), 4);
    assert.equal(mutPower('odd', 3), 8);
    assert.equal(mutPower('venom', 1), 1);
    assert.equal(mutPower('venom', 2), 2);
    assert.equal(mutPower('venom', 3), 4);
});

test('мутация-множитель действительно множит урон при своём условии', () => {
    const run = startRun(21);
    enterNode(run, nextNodes(run)[0].i);
    const b = run.battle;
    b.enemy.block = 0;
    b.enemy.st = {};
    b.enemy.hp = 200; b.enemy.maxHp = 200;
    const card = run.deck.find(c => c.id === 'strike');

    b.hand = [card.uid]; b.played = 1; b.hero.energy = 9;
    const before = b.enemy.hp;
    playCard(run, 0);
    const plain = before - b.enemy.hp;

    card.mut.opener = 2;                       // ×4
    b.hand = [card.uid]; b.played = 0;         // условие «первая карта в ходу»
    const before2 = b.enemy.hp;
    playCard(run, 0);
    assert.equal(before2 - b.enemy.hp, plain * 4);
});

test('мутация на карту падает только подходящая по виду', () => {
    const run = startRun(31);
    run.shards = 40;
    const guard = run.deck.find(c => c.id === 'guard');
    for (let i = 0; i < 40; i++) useShard(run, guard.uid);
    for (const id of Object.keys(guard.mut)) {
        const def = MUTATIONS.find(m => m.id === id);
        assert.ok(!def.kind || def.kind === 'skill', `на защиту приехала ${id}`);
    }
});

test('«разгон» делает карту бесплатной только после трёх потраченных энергий', () => {
    const run = startRun(33);
    enterNode(run, nextNodes(run)[0].i);
    const b = run.battle;
    const card = run.deck.find(c => c.id === 'strike');
    card.mut.surge = 1;
    b.spent = 0;
    assert.equal(costOf(run, card), CARD_BY_ID.strike.cost);
    b.spent = 3;
    assert.equal(costOf(run, card), 0);
});

// ── Тексты ───────────────────────────────────────────────────────────────────

test('у каждой карты есть непустое описание, собранное из эффектов', () => {
    const run = startRun(7);
    // Числа, которые растут с уровнем: урон, блок, лечение и статусы. Добор,
    // энергия и удвоение в этот список НЕ входят намеренно (см. applyEffect) —
    // у «Сосредоточения» уровень и правда ничего не меняет, и это не ошибка.
    const scaling = new Set(['dmg', 'block', 'heal', 'status']);
    for (const def of CARDS) {
        const card = addCard(run, def.id);
        const text = cardText(card);
        assert.ok(text.length > 5, `${def.id}: пустое описание`);
        card.lvl = 3;
        const grown = cardText(card);
        if (def.effects.some(e => scaling.has(e.t))) {
            assert.notEqual(grown, text, `${def.id}: уровень не изменил числа`);
        } else {
            assert.equal(grown, text, `${def.id}: уровень изменил то, что меняться не должно`);
        }
    }
});

test('cardView отдаёт готовые числа и мутации', () => {
    const run = startRun(8);
    const card = run.deck[0];
    card.mut.odd = 2;
    const view = cardView(run, card);
    assert.equal(view.uid, card.uid);
    assert.equal(view.muts.length, 1);
    assert.equal(view.muts[0].power, 4);
    assert.match(view.muts[0].text, /×4/);
});

// ── Проверка результата на сервере ───────────────────────────────────────────

test('isPlausibleRun принимает настоящий забег и отвергает выдуманный', () => {
    for (let seed = 200; seed < 230; seed++) {
        const run = startRun(seed);
        botRun(run);
        const res = runResult(run);
        const check = isPlausibleRun(res);
        assert.ok(check.ok, `сид ${seed}: настоящий забег не принят (${check.reason})`);
    }
    const bad = [
        [{ loops: 50, floor: 3, kills: 1, turns: 5, cards: 10, level: 1, seconds: 600 }, 'floor_vs_loops'],
        [{ loops: 0, floor: 5, kills: 99, turns: 5, cards: 10, level: 1, seconds: 600 }, 'kills_vs_floor'],
        [{ loops: 0, floor: 5, kills: 3, turns: 1, cards: 10, level: 1, seconds: 600 }, 'turns_vs_kills'],
        [{ loops: 0, floor: 5, kills: 3, turns: 100, cards: 10, level: 1, seconds: 1 }, 'too_fast'],
        [{ loops: 0, floor: 5, kills: 3, turns: 5, cards: 999, level: 1, seconds: 600 }, 'cards_vs_floor'],
        [{ loops: 0, floor: 5, kills: 3, turns: 5, cards: 10, level: 999, seconds: 600 }, 'level_too_high'],
        [{ loops: 1.5, floor: 5, kills: 3, turns: 5, cards: 10, level: 1, seconds: 600 }, 'shape'],
    ];
    for (const [res, reason] of bad) {
        const check = isPlausibleRun(res);
        assert.equal(check.ok, false, JSON.stringify(res));
        assert.equal(check.reason, reason);
    }
});

// ── Автоигрок ────────────────────────────────────────────────────────────────

test('забег всегда кончается: бесконечность не значит вечность', () => {
    for (let seed = 1; seed <= 40; seed++) {
        const run = startRun(seed);
        const steps = botRun(run);
        assert.ok(run.over, `сид ${seed}: забег не кончился за ${steps} действий`);
        assert.ok(steps < 200_000, `сид ${seed}: подозрительно долго — ${steps}`);
    }
});

test('планка сложности: первый цикл берётся почти всегда, десятый — никогда', () => {
    const depths = [];
    for (let seed = 1000; seed < 1080; seed++) {
        const run = startRun(seed);
        botRun(run);
        depths.push(run.stats.loops);
    }
    const first = depths.filter(d => d >= 1).length / depths.length;
    const deep = depths.filter(d => d >= 10).length;
    const best = Math.max(...depths);
    // Средний игрок (а бот играет именно так) проходит первый цикл в
    // подавляющем большинстве забегов — иначе игра отталкивает на входе.
    // Порог с запасом: у бота выходит около двух третей, и просесть ниже
    // половины он может только от правки баланса, а не от случайности сидов.
    assert.ok(first > 0.55, `первый цикл берут только ${Math.round(first * 100)}% забегов`);
    // И упирается в стену задолго до десятого: эскалация обязана догонять.
    assert.equal(deep, 0, `бот дошёл до десятого цикла ${deep} раз (лучший ${best})`);
});

test('враги растут вместе с циклом', () => {
    const one = enemyHpOn(1), five = enemyHpOn(5);
    assert.ok(five > one * 2, `цикл 5 не сильнее цикла 1: ${one} → ${five}`);
});

function enemyHpOn(loop) {
    // Средний потолок здоровья врага на цикле: усредняем, потому что и враг, и
    // его модификаторы выпадают случайно.
    let sum = 0, n = 0;
    for (let seed = 1; seed <= 40; seed++) {
        const run = startRun(seed);
        run.loop = loop;
        enterNode(run, nextNodes(run)[0].i);
        sum += run.battle.enemy.maxHp; n++;
    }
    return sum / n;
}

// Бот. Играет по тем же функциям, что и окно игры, — если ему что-то нужно
// сверх них, значит, окну этого тоже не хватит.
function botRun(run, limit = 200_000) {
    let steps = 0;
    while (!run.over && steps < limit) {
        steps++;
        if (run.pending?.t === 'remove') {
            // Выбрасываем самое слабое — так и человек делает.
            const worst = run.deck.find(c => c.id === 'strike') || run.deck[0];
            removeCard(run, worst.uid);
            continue;
        }
        if (run.stones > 0) { useStone(run, bestCard(run).uid); continue; }
        if (run.shards > 0) { useShard(run, bestCard(run).uid); continue; }

        switch (run.screen) {
            case SCREEN_MAP: {
                const options = nextNodes(run);
                if (!options.length) { giveUp(run); break; }
                // Элиту бот обходит, если здоровья мало, — как и живой игрок.
                const safe = options.find(o => o.node.t !== NODE_ELITE);
                const pickNode = run.hp * 2 < run.maxHp && safe ? safe : options[0];
                enterNode(run, pickNode.i);
                break;
            }
            case SCREEN_BATTLE: botTurn(run); break;
            case SCREEN_REWARD: {
                // Мало здоровья — лечимся отказом, иначе берём первую карту.
                chooseReward(run, run.hp * 3 < run.maxHp ? -1 : 0);
                break;
            }
            case SCREEN_EVENT: chooseEvent(run, 0); break;
            default: giveUp(run); break;
        }
    }
    return steps;
}

function bestCard(run) {
    // Вкладываемся в самую дорогую карту колоды — примитивно, но именно так
    // играет человек, который не хочет думать.
    return run.deck.reduce((a, c) => (CARD_BY_ID[c.id].cost > CARD_BY_ID[a.id].cost ? c : a), run.deck[0]);
}

function botTurn(run) {
    const b = run.battle;
    if (!b || b.over) return;
    const intent = intentView(run);
    const incoming = intent
        ? intent.acts.filter(a => a.t === I_ATTACK).reduce((s, a) => s + a.v * a.times, 0) * (intent.twice ? 2 : 1)
        : 0;

    let guard = 0;
    while (!b.over && guard++ < 40) {
        const needBlock = incoming > b.hero.block && b.hero.hp <= incoming + 8;
        const order = [...b.hand.keys()].sort((x, y) => score(run, b.hand[y], needBlock) - score(run, b.hand[x], needBlock));
        const i = order.find(k => playCard(run, k).ok);
        if (i === undefined) break;
    }
    if (!b.over) endTurn(run);
    // Ход стоит времени: без этого runResult отдаёт нулевые секунды, и проверка
    // «слишком быстро» на сервере отвергла бы честный забег.
    addTime(run, 4000);
}

function score(run, uid, needBlock) {
    const def = CARD_BY_ID[cardOf(run, uid).id];
    const has = t => def.effects.some(e => e.t === t);
    if (needBlock && has('block')) return 3;
    if (has('dmg')) return 2;
    return 1;
}

// Короткая «подпись» забега для сравнения по сиду: сравнивать сами объекты
// нельзя — в них лежит состояние генератора, и совпадение стало бы тавтологией.
function playRun(run) {
    botRun(run);
    const r = runResult(run);
    return [r.loops, r.floor, r.kills, r.cards, r.level, run.hp];
}
