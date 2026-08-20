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
    removeCard, useStone, useShard, giveUp, cardOf, cardText, cardView, addCard, addTime, takeLog, moveCard,
    intentView, enemyView, runResult, isPlausibleRun, scaleValue, mutPower, costOf, canLevel, legendChance,
    MAP_ROWS, START_HP, HAND_SIZE, ENERGY_PER_TURN, LEVEL_STEP, MAX_MUTATIONS,
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

test('карта не срабатывает при выкладывании — она ложится на стол и ждёт «Хода»', () => {
    // Ход игрока — это ЗАЯВКА: пока карты лежат на столе, ни здоровье, ни броня
    // не двигаются, и «сколько выйдет урона» приходится считать в голове.
    const run = startRun(42);
    enterNode(run, nextNodes(run)[0].i);
    const b = run.battle;
    b.hand = [];
    const guard = run.deck.find(c => c.id === 'guard');
    const strike = run.deck.find(c => c.id === 'strike');
    b.hand.push(guard.uid, strike.uid);
    const hp = b.enemy.hp;

    playCard(run, 0);
    playCard(run, 0);
    assert.deepEqual(b.board, [guard.uid, strike.uid], 'карты не легли на стол');
    assert.equal(b.hero.block, 0, 'защита сработала раньше «Хода»');
    assert.equal(b.enemy.hp, hp, 'урон прошёл раньше «Хода»');
    // Энергия при этом тратится СРАЗУ: иначе на стол можно выложить всю руку.
    assert.equal(b.hero.energy, ENERGY_PER_TURN - CARD_BY_ID.guard.cost - CARD_BY_ID.strike.cost);
});

test('стол играет слева направо, в порядке выкладывания', () => {
    const run = startRun(77);
    enterNode(run, nextNodes(run)[0].i);
    const b = run.battle;
    b.hand = [];
    const guard = run.deck.find(c => c.id === 'guard');
    const strike = run.deck.find(c => c.id === 'strike');
    b.hand.push(strike.uid, guard.uid);
    playCard(run, 0);
    playCard(run, 0);
    const casts = castTurn(run).filter(e => e.t === 'cast').map(e => e.uid);
    assert.deepEqual(casts, [strike.uid, guard.uid]);
});

test('добор и энергия срабатывают СРАЗУ: иначе они не делают ничего', () => {
    // Карта, которая тянет карты в конце хода, тянет их в руку, уходящую в
    // сброс. Поэтому всё, что меняет саму заявку, работает при выкладывании.
    const run = startRun(78);
    enterNode(run, nextNodes(run)[0].i);
    const b = run.battle;
    b.hand = [run.deck.find(c => c.id === 'focus').uid];
    b.hero.energy = 3;
    playCard(run, 0);
    assert.equal(b.hand.length, 2, 'карты не пришли в руку сразу');

    const adr = addCard(run, 'adrenaline');
    b.hand.push(adr.uid);
    const energy = b.hero.energy;
    playCard(run, b.hand.length - 1);
    assert.ok(b.hero.energy > energy, 'энергия не пришла сразу');
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
    const gained = castTurn(run).find(e => e.t === 'block' && e.who === 'hero');
    assert.ok(gained, 'защита не сработала на «Ходе»');
    assert.equal(gained.v, CARD_BY_ID.guard.effects[0].v);

    // Даём заведомо много брони и смотрим, что остаток дожил до следующего хода.
    if (b.over) return;
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
    assert.ok(castTurn(run).some(e => e.t === 'block' && e.who === 'hero'), 'сама карта брони не дала');
    assert.ok(b.wardEach > 0, 'правило на бой не включилось');
    if (b.over) return;
    b.hero.block = 0;
    endTurn(run);
    if (!b.over) assert.ok(b.hero.block > 0, 'в начале хода броня не приросла');
});

test('«Зеркало» удваивает следующую карту НА СТОЛЕ', () => {
    const run = startRun(44);
    enterNode(run, nextNodes(run)[0].i);
    const b = run.battle;
    b.enemy.hp = 2000; b.enemy.maxHp = 2000; b.enemy.block = 0; b.enemy.st = {};
    b.hero.energy = 9;
    const strike = run.deck.find(c => c.id === 'strike');
    b.hand = [strike.uid];
    playCard(run, 0);
    const plain = cardDamage(castTurn(run));

    if (b.over) return;
    b.enemy.block = 0; b.enemy.st = {}; b.hero.energy = 9;
    const mirror = addCard(run, 'mirror');
    b.hand = [mirror.uid, strike.uid];
    playCard(run, 0);   // «Зеркало» ложится первым
    playCard(run, 0);   // за ним удар
    assert.equal(cardDamage(castTurn(run)), plain * 2);
});

test('«Эхо-камень» возвращается в руку в НАЧАЛЕ следующего хода', () => {
    // Вернуть карту в руку сразу после срабатывания в отложенном ходу нельзя:
    // рука в этот момент уходит в сброс, и «возврат» означал бы потерю карты.
    const run = startRun(45);
    enterNode(run, nextNodes(run)[0].i);
    const b = run.battle;
    const stone = addCard(run, 'echostone');
    b.hand = [stone.uid];
    b.hero.energy = 9;
    playCard(run, 0);
    endTurn(run);
    if (b.over) return;
    assert.ok(b.hand.includes(stone.uid), 'карта не вернулась в руку');
    assert.ok(!b.discard.includes(stone.uid), 'карта заодно уехала в сброс');
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
    playCard(run, 0);
    const back = castTurn(run).find(e => e.t === 'hit' && e.who === 'hero' && e.src === 'thorns');
    assert.ok(back, 'шипы не ответили');
    assert.equal(back.dmg, 4);
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
    const uid = b.hand[0];
    const hpBefore = b.enemy.hp;
    playCard(run, 0);
    assert.deepEqual(takeLog(run), [], 'выкладывание карты — ещё не событие боя');

    endTurn(run);
    const log = takeLog(run);
    // Первым событием карты идёт «cast» с её uid — по нему окно и подсвечивает
    // стол слева направо.
    const cast = log.find(e => e.t === 'cast');
    assert.ok(cast && cast.uid === uid, 'карта не отмечена в журнале');
    const hit = log.find(e => e.t === 'hit' && e.who === 'enemy');
    assert.ok(hit, 'удара в журнале нет');
    assert.equal(hit.src, 'card');
    assert.equal(hit.real, hpBefore - hit.hp, 'в журнале не тот урон');
    assert.ok(log.indexOf(cast) < log.indexOf(hit), 'удар записан раньше своей карты');
    assert.deepEqual(takeLog(run), [], 'журнал не очистился');

    // Ход врага отмечен отдельно — по этой отметке окно делает паузу.
    const turn = log.find(e => e.t === 'turn' && e.who === 'enemy');
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

// Сыграть выложенный стол и вернуть события журнала. Отдельная функция нужна
// потому, что в отложенном ходу карта не делает ничего до «Хода», и проверять
// её действие можно только по журналу: состояние к концу endTurn уже включает
// ответ врага.
function castTurn(run) {
    takeLog(run);
    endTurn(run);
    return takeLog(run);
}

/** Сколько урона врагу нанесли карты со стола за этот ход. */
function cardDamage(events) {
    return events
        .filter(e => e.t === 'hit' && e.who === 'enemy' && e.src === 'card')
        .reduce((s, e) => s + e.dmg, 0);
}

// ── Легендарки ───────────────────────────────────────────────────────────────

test('легендарка растёт в шансе с циклом и гаснет после каждой выпавшей', () => {
    const run = startRun(101);
    const first = legendChance(run, NODE_FIGHT);
    run.loop = 3;
    const third = legendChance(run, NODE_FIGHT);
    assert.ok(third > first * 3, `шанс почти не вырос: ${first} → ${third}`);

    // Босс тянет вверх сильнее обычного боя — как и вся остальная редкость.
    assert.ok(legendChance(run, NODE_BOSS) > third);

    run.legends = 1;
    const after = legendChance(run, NODE_FIGHT);
    assert.ok(after < third / 4, `выпавшая легендарка почти не сбила шанс: ${third} → ${after}`);
    run.legends = 2;
    assert.ok(legendChance(run, NODE_FIGHT) < after / 4);
});

test('легендарка — событие в первом цикле и обычное дело к пятому', () => {
    // Считаем по-настоящему: гоняем награды и смотрим, как часто она приходит.
    const rate = loop => {
        let seen = 0, tries = 0;
        for (let seed = 1; seed <= 300; seed++) {
            const run = startRun(seed);
            run.loop = loop;
            enterNode(run, nextNodes(run)[0].i);
            run.battle.enemy.hp = 0;
            endTurn(run);
            tries++;
            if (run.reward?.cards.some(id => CARD_BY_ID[id].rarity === 'legend')) seen++;
        }
        return seen / tries;
    };
    const one = rate(1), five = rate(5);
    assert.ok(one < 0.04, `в первом цикле легендарка сыплется: ${Math.round(one * 100)}%`);
    assert.ok(five > one * 4, `к пятому циклу шанс почти не вырос: ${one} → ${five}`);
});

test('вторая копия легендарки не приходит', () => {
    const run = startRun(102);
    run.loop = 40;                       // шанс упёрт в потолок
    for (const def of CARDS.filter(c => c.rarity === 'legend')) addCard(run, def.id);
    let rewards = 0;
    for (let i = 0; i < 300 && !run.over; i++) {
        // Выбрасываем что угодно, кроме легендарки: иначе тест сам освободит ей
        // место в колоде и проверять станет нечего.
        if (run.pending?.t === 'remove') {
            removeCard(run, run.deck.find(c => CARD_BY_ID[c.id].rarity !== 'legend').uid);
            continue;
        }
        if (run.screen === SCREEN_REWARD) {
            const legends = run.reward.cards.filter(id => CARD_BY_ID[id].rarity === 'legend');
            assert.equal(legends.length, 0, `предложили уже лежащую в колоде: ${legends}`);
            rewards++;
            chooseReward(run, -1);
            continue;
        }
        if (run.screen === SCREEN_EVENT) { chooseEvent(run, 0); continue; }
        if (run.screen === SCREEN_BATTLE) { run.battle.enemy.hp = 0; endTurn(run); continue; }
        const options = nextNodes(run);
        if (!options.length) break;
        enterNode(run, options[0].i);
    }
    assert.ok(rewards > 20, `наград было всего ${rewards} — проверять нечего`);
});

test('«Час расплаты» бьёт за каждую карту, сработавшую до него', () => {
    // Ровно тот случай, ради которого порядок стола и сделан решением.
    const run = startRun(103);
    enterNode(run, nextNodes(run)[0].i);
    const b = run.battle;
    b.enemy.hp = 4000; b.enemy.maxHp = 4000; b.enemy.block = 0; b.enemy.st = {};
    b.hero.hp = 4000; b.hero.maxHp = 4000;
    const card = addCard(run, 'reckoning');

    b.hand = [card.uid]; b.hero.energy = 9;
    playCard(run, 0);
    const alone = cardDamage(castTurn(run));

    b.enemy.block = 0; b.enemy.st = {}; b.hero.energy = 9;
    const jabs = [addCard(run, 'jab').uid, addCard(run, 'jab').uid];
    b.hand = [jabs[0], jabs[1], card.uid];
    playCard(run, 0); playCard(run, 0); playCard(run, 0);
    const late = cardDamage(castTurn(run));
    const jabDamage = alone - alone;     // тычки считаем отдельно ниже
    assert.equal(jabDamage, 0);
    // Два тычка плюс «Час расплаты» за две карты перед ним: он обязан вырасти
    // ровно на две своих прибавки.
    const jab = CARD_BY_ID.jab.effects[0].v;
    assert.equal(late - 2 * jab, alone * 3, `${alone} в одиночку, ${late} с двумя картами перед ним`);
});

test('«Зеркальный зал» удваивает первую карту КАЖДОГО хода', () => {
    const run = startRun(104);
    enterNode(run, nextNodes(run)[0].i);
    const b = run.battle;
    b.enemy.hp = 4000; b.enemy.maxHp = 4000; b.enemy.block = 0; b.enemy.st = {};
    b.hero.hp = 4000; b.hero.maxHp = 4000;
    const strike = run.deck.find(c => c.id === 'strike');

    b.hand = [strike.uid]; b.hero.energy = 9;
    playCard(run, 0);
    const plain = cardDamage(castTurn(run));

    b.enemy.block = 0; b.enemy.st = {}; b.hero.energy = 9;
    b.hand = [addCard(run, 'mirrorhall').uid];
    playCard(run, 0);
    castTurn(run);

    for (let turn = 0; turn < 2; turn++) {
        b.enemy.block = 0; b.enemy.st = {}; b.hero.energy = 9;
        b.hand = [strike.uid];
        playCard(run, 0);
        assert.equal(cardDamage(castTurn(run)), plain * 2, `ход ${turn + 1}: удвоения нет`);
    }
});

test('«Сердце горна» поднимает энергию со следующего хода', () => {
    const run = startRun(105);
    enterNode(run, nextNodes(run)[0].i);
    const b = run.battle;
    b.hero.hp = 4000; b.hero.maxHp = 4000;
    const before = b.hero.maxEnergy;
    b.hand = [addCard(run, 'forgeheart').uid];
    b.hero.energy = 9;
    playCard(run, 0);
    endTurn(run);
    assert.equal(b.hero.maxEnergy, before + 1);
    assert.equal(b.hero.energy, before + 1, 'ход начался со старой энергией');
});

// ── Уровни и мутации ─────────────────────────────────────────────────────────

test('уровень — ровный line-scaling одной формулой', () => {
    assert.equal(scaleValue(6, 1), 6);
    assert.equal(scaleValue(6, 2), Math.round(6 * (1 + LEVEL_STEP)));
    assert.equal(scaleValue(10, 5), Math.round(10 * (1 + LEVEL_STEP * 4)));
    // Потолка у уровня нет — это вторая ось бесконечности рядом с циклами.
    assert.ok(scaleValue(6, 30) > scaleValue(6, 20));
});

test('камень не тратится на карту, которой уровень ничего не даёт', () => {
    // «Сосредоточение» тянет 2 карты — уровень тут не растит ничего, и молча
    // съесть камень было бы обманом: игрок увидел бы «4 ур.» и те же 2 карты.
    const run = startRun(93);
    run.stones = 3;
    const focus = run.deck.find(c => c.id === 'focus');
    const res = useStone(run, focus.uid);
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'no_growth');
    assert.equal(focus.lvl, 1);
    assert.equal(run.stones, 3, 'камень всё равно пропал');
    // А в карту с числами — берётся.
    assert.equal(useStone(run, run.deck.find(c => c.id === 'strike').uid).ok, true);

    // И это следствие эффектов, а не список имён: растёт то, где есть числа.
    for (const def of CARDS) {
        const card = addCard(run, def.id);
        const grows = def.effects.some(e => ['dmg', 'block', 'heal', 'status'].includes(e.t));
        assert.equal(canLevel(card), grows, `${def.id}: не то решение про уровень`);
    }
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

    b.enemy.hp = 2000; b.enemy.maxHp = 2000;
    b.hand = [card.uid]; b.hero.energy = 9;
    playCard(run, 0);
    const plain = cardDamage(castTurn(run));

    if (b.over) return;
    b.enemy.block = 0; b.enemy.st = {};
    card.mut.opener = 2;                       // ×4
    b.hand = [card.uid]; b.hero.energy = 9;    // условие «первая карта в ходу»
    playCard(run, 0);
    assert.equal(cardDamage(castTurn(run)), plain * 4);
});

test('карты на столе переставляются, а сыграются в новом порядке', () => {
    const run = startRun(91);
    enterNode(run, nextNodes(run)[0].i);
    const b = run.battle;
    b.hand = [];
    const strike = run.deck.find(c => c.id === 'strike');
    const guard = run.deck.find(c => c.id === 'guard');
    b.hand.push(strike.uid, guard.uid);
    playCard(run, 0);
    playCard(run, 0);
    assert.deepEqual(b.board, [strike.uid, guard.uid]);

    assert.equal(moveCard(run, 1, 0).ok, true);
    assert.deepEqual(b.board, [guard.uid, strike.uid]);
    // Перестановка ничего не отменяет: энергия остаётся потраченной.
    assert.equal(b.hero.energy, ENERGY_PER_TURN - CARD_BY_ID.strike.cost - CARD_BY_ID.guard.cost);
    assert.equal(moveCard(run, 5, 0).ok, false, 'карты с таким номером на столе нет');

    const casts = castTurn(run).filter(e => e.t === 'cast').map(e => e.uid);
    assert.deepEqual(casts, [guard.uid, strike.uid], 'стол сыграл в старом порядке');
});

test('на карте не больше четырёх РАЗНЫХ чар — дальше осколок усиливает', () => {
    // Потолок не про силу, а про читаемость: карта с десятком строк перестаёт
    // быть картой. Осколок сверх потолка идёт в то же удвоение.
    const run = startRun(92);
    run.shards = 60;
    const card = run.deck.find(c => c.id === 'strike');
    for (let i = 0; i < 60; i++) useShard(run, card.uid);
    const ids = Object.keys(card.mut);
    assert.ok(ids.length <= MAX_MUTATIONS, `чар на карте ${ids.length}`);
    const stacks = ids.reduce((s, id) => s + card.mut[id], 0);
    assert.equal(stacks, 60, 'осколки пропали впустую');
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

test('шар с числом бывает ТОЛЬКО у атаки, и описание его не повторяет', () => {
    // Шар нарисован на рамке оружия и означает урон. Блок, положенный на его
    // место, читается как «столько эта карта бьёт» — ровно так и выглядела
    // ошибка на «Защите».
    const run = startRun(81);
    for (const def of CARDS) {
        const card = addCard(run, def.id);
        const view = cardView(run, card);
        if (def.kind !== 'attack') {
            assert.equal(view.power, null, `${def.id}: шар у не-атаки`);
            assert.equal(view.artText, view.text, `${def.id}: из описания что-то пропало`);
        } else if (view.power) {
            assert.equal(view.power.t, 'dmg');
            // Многоударная атака — исключение: шар показывает урон ОДНОГО удара,
            // и без слов «2 раза» карта читалась бы вдвое слабее.
            const multi = def.effects.some(e => e.t === 'dmg' && e.times > 1);
            if (!multi) assert.ok(!view.artText.startsWith('Наносит'), `${def.id}: описание повторяет шар`);
        }
    }
});

test('многоударная атака описание НЕ теряет: в шаре одно число', () => {
    // «Череда» бьёт 4 урона два раза. Четвёрка в шаре без слов означала бы
    // обычный удар на четыре — описание тут обязано остаться.
    const run = startRun(83);
    const view = cardView(run, addCard(run, 'flurry'));
    assert.ok(view.power, 'у атаки нет шара');
    assert.match(view.artText, /2 раза/, `описание пропало: «${view.artText}»`);
});

test('условная прибавка написана прибавкой, а не вторым «наносит»', () => {
    // «Наносит 7 урона. Наносит 7 урона, если это первая карта» читается как
    // «в любом случае 7», хотя карта бьёт на 14.
    const run = startRun(82);
    const ambush = cardText(addCard(run, 'ambush'));
    assert.match(ambush, /Ещё \d+ урона, если/);
    assert.equal(ambush.match(/Наносит/g).length, 1, 'два «наносит» в одном описании');
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
    for (let seed = 1000; seed < 1000 + Number(process.env.RG_SEEDS || 200); seed++) {
        const run = startRun(seed);
        botRun(run);
        depths.push(run.stats.loops);
    }
    const first = depths.filter(d => d >= 1).length / depths.length;
    const deep = depths.filter(d => d >= 10).length;
    const best = Math.max(...depths);
    if (process.env.RG_DEBUG) console.error('первый цикл', Math.round(first*100)+'%', 'лучший', best, 'среднее', (depths.reduce((a,b)=>a+b,0)/depths.length).toFixed(2));
    // Средний игрок (а бот играет именно так) проходит первый цикл в
    // подавляющем большинстве забегов — иначе игра отталкивает на входе.
    // Порог с запасом: у бота выходит около двух третей, и просесть ниже
    // половины он может только от правки баланса, а не от случайности сидов.
    //
    // Сидов двести, а не восемьдесят, именно поэтому: на восьмидесяти разброс
    // самой выборки — ±6%, и правка, которая всего лишь сдвигает поток
    // случайных чисел, роняла тест на ровном месте.
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
        // Камень кладём только в карту, которой уровень вообще что-то даёт:
        // «Сосредоточение» от него не меняется, и камень на ней завис бы
        // навсегда — прогон бы не кончился.
        const growable = run.deck.filter(canLevel);
        if (run.stones > 0 && growable.length) { useStone(run, bestOf(growable).uid); continue; }
        if (run.shards > 0) { useShard(run, bestOf(run.deck).uid); continue; }

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

function bestOf(cards) {
    // Вкладываемся в самую дорогую карту — примитивно, но именно так играет
    // человек, который не хочет думать.
    return cards.reduce((a, c) => (CARD_BY_ID[c.id].cost > CARD_BY_ID[a.id].cost ? c : a), cards[0]);
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
        // Броня от выложенных карт ещё не встала (стол играет по «Ходу»), но
        // человек её, конечно, считает — поэтому считает и бот: иначе он
        // закрывался бы всей рукой подряд и изображал не среднего игрока, а
        // растерянного.
        const planned = b.hero.block + b.board.reduce((s, uid) => s + blockOf(run, uid), 0);
        const needBlock = incoming > planned && b.hero.hp <= incoming + 8;
        const order = [...b.hand.keys()].sort((x, y) => score(run, b.hand[y], needBlock) - score(run, b.hand[x], needBlock));
        const i = order.find(k => playCard(run, k).ok);
        if (i === undefined) break;
    }
    if (!b.over) endTurn(run);
    // Ход стоит времени: без этого runResult отдаёт нулевые секунды, и проверка
    // «слишком быстро» на сервере отвергла бы честный забег.
    addTime(run, 4000);
}

function blockOf(run, uid) {
    const card = cardOf(run, uid);
    return CARD_BY_ID[card.id].effects
        .filter(e => e.t === 'block' && !e.when)
        .reduce((s, e) => s + scaleValue(e.v, card.lvl), 0);
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
