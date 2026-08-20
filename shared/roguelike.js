// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Рогалик»: правила забега одним файлом.
//
// Здесь ВСЁ, что знает про игру и фронт, и бэкенд: генератор случайного,
// колода, карта узлов, бой, лут, апгрейды, мутации и эскалация циклов. Окно
// игры (frontend/src/roguelike.js) только рисует состояние и зовёт функции
// отсюда, а сервер (backend/src/routes/roguelike.js) берёт проверку
// правдоподобности результата — иначе «сколько циклов бывает» пришлось бы
// держать в двух местах, и они разъехались бы на первой же правке баланса.
//
// ЗАБЕГ СЧИТАЕТСЯ В БРАУЗЕРЕ, как тетрис, тройка и пасьянс, и по той же
// причине: игрок ОДИН, прятать не от кого и не от чего. В бильярде и дураке
// партию ведёт сервер, потому что очко там отнято у живого человека, а карты
// чужой руки — чужие; здесь нет ни соперника, ни закрытой чужой информации:
// колода своя, враг ходит по видимому намерению. На сервер уходит ОДИН запрос
// в конце забега, и он проверяется на правдоподобность (isPlausibleRun) —
// защита от мусора, а не от человека с открытой консолью.
//
// ВСЁ СЛУЧАЙНОЕ ИДЁТ ЧЕРЕЗ ОДИН ГЕНЕРАТОР С СИДОМ (run.rng), а не через
// Math.random: забег обязан быть воспроизводим по сиду. Это нужно не ради
// красоты — по сиду ловятся жалобы («вот на этом забеге зависло»), на нём же
// стоят тесты, и на нём же однажды сделают забег дня, не переписывая игру.
// Отсюда правило: НИ ОДНОГО Math.random в этом файле и в окне игры.
//
// СОСТОЯНИЕ — ПРОСТОЙ ОБЪЕКТ БЕЗ ССЫЛОК НА ФУНКЦИИ И КЛАССЫ: забег длинный
// (десятки минут), окно закрывают, страницу перезагружают, поэтому run целиком
// уезжает в localStorage через JSON.stringify и поднимается обратно как есть.
// Из этого же следует, что в бою карты лежат НОМЕРАМИ (uid), а не объектами:
// иначе одна и та же карта после сохранения стала бы двумя разными.
//
// ЧТО В КОНТЕНТЕ, А ЧТО ЗДЕСЬ: движок не знает ни одной карты, ни одного врага
// по имени — всё это данные в shared/roguelikeContent.js. Здесь только правила,
// одинаковые для всего контента. Если в этом файле появляется
// `if (card.id === ...)`, значит, затея сломалась.
//
// ЧЕГО НЕТ СОЗНАТЕЛЬНО: магазина и валюты (роль «на что копить» уже играют
// камни и осколки), сюжета, PvP. Пасхалка должна открываться и играться, а не
// изучаться.
// ─────────────────────────────────────────────────────────────────────────────

import {
    CARDS, CARD_BY_ID, START_DECK, RARITY, COMMON, RARE, EPIC, LEGEND,
    CONDITIONS, MUTATIONS, MUTATION_BY_ID, MUTATORS, MUTATOR_BY_ID,
    ENEMIES, BOSSES, EVENTS, EVENT_BY_ID,
    DAMAGE, BLOCK, HEAL, DRAW, ENERGY, STATUS, UPGRADE, DOUBLE, AMPLIFY, RULE,
    ATTACK, SKILL, POWER, KIND_NAME,
    POISON, WEAK, VULN, STR, REGEN, THORNS, STATUS_INFO, WEAK_MULT, VULN_MULT,
    I_ATTACK, I_BLOCK, I_STATUS,
    NODE_FIGHT, NODE_ELITE, NODE_CHEST, NODE_EVENT, NODE_REST, NODE_BOSS, NODE_INFO,
} from './roguelikeContent.js';

export {
    CARDS, CARD_BY_ID, RARITY, COMMON, RARE, EPIC, LEGEND, MUTATIONS, MUTATION_BY_ID,
    MUTATORS, MUTATOR_BY_ID, ENEMIES, BOSSES, EVENTS,
    ATTACK, SKILL, POWER, KIND_NAME,
    POISON, WEAK, VULN, STR, REGEN, THORNS, STATUS_INFO,
    NODE_FIGHT, NODE_ELITE, NODE_CHEST, NODE_EVENT, NODE_REST, NODE_BOSS, NODE_INFO,
    I_ATTACK, I_BLOCK, I_STATUS,
};

// ── Числа забега ─────────────────────────────────────────────────────────────

export const START_HP = 80;
export const ENERGY_PER_TURN = 3;
export const HAND_SIZE = 5;
// Потолок руки. Нужен ровно против одной ситуации: колода из доборов тянет сама
// себя, и рука растёт до размеров колоды — играть в это невозможно, а считать
// тем более.
export const MAX_HAND = 10;

// Строк на карте узлов. Двенадцать — это примерно двадцать минут цикла: меньше
// не успеваешь собрать колоду до босса, больше — устаёшь до него дойти.
export const MAP_ROWS = 12;

// Эскалация. Здоровье врагов растёт быстрее урона намеренно: бой должен
// становиться ДЛИННЕЕ, а не смертельнее с первого удара — иначе на шестом цикле
// забег обрывался бы одним намерением, которое нечем перекрыть.
export const LOOP_HP = 0.35;
export const LOOP_DMG = 0.22;
// Сколько здоровья возвращает переход на новый цикл. Не полное лечение: забег
// должен накапливать усталость, иначе циклы просто складываются в бесконечную
// прогулку.
export const LOOP_HEAL = 0.3;

export const ELITE_HP = 1.4;
export const ELITE_DMG = 1.2;
export const BOSS_HP = 1.0;   // у боссов своё здоровье в контенте

// Сколько карт предлагают на выбор и сколько лечит отказ от карты. Отказ ДОЛЖЕН
// что-то давать: колода, которая только растёт, к третьему циклу перестаёт
// тянуть нужную карту, и «не брать» — это полноценная стратегия, а не пропуск
// хода.
export const REWARD_CARDS = 3;
export const SKIP_HEAL = 8;

// Уровень карты: +30% к числам за уровень, потолка нет. Одна формула на все
// карты — это и есть весь «line-scaling» из задумки: отдельной логики уровня у
// карт нет и заводить её нельзя.
export const LEVEL_STEP = 0.3;

// Сколько РАЗНЫХ мутаций помещается на одну карту. Дальше осколки усиливают
// уже висящие — см. useShard.
export const MAX_MUTATIONS = 4;

// Шанс точильного камня и осколка мутации по типу узла.
//
// КАМНИ ЧАСТЫЕ, ОСКОЛКИ РЕДКИЕ, и это главный баланс всей игры. Уровень растёт
// ровно (+30%), поэтому камень можно давать примерно за каждый четвёртый бой — за
// каждый второй выходило по пять камней за цикл, и к четвёртому колода
// обгоняла любую эскалацию (за элиту и босса камень по-прежнему обязателен:
// это плата за риск, а не лотерея). Мутация
// растёт УДВОЕНИЕМ (×2 → ×4 → ×8), поэтому осколок — это событие: на первом
// цикле его почти не бывает, а к пятому он приходит примерно раз в цикл. Расти
// шансу по циклам нужно потому, что и враги растут: без второй мутации на
// восьмом цикле забег упирается в стену не из-за решений игрока, а из-за
// арифметики.
export const STONE_CHANCE = { [NODE_FIGHT]: 0.22, [NODE_ELITE]: 1, [NODE_CHEST]: 0.6, [NODE_BOSS]: 1 };
export const SHARD_CHANCE = { [NODE_FIGHT]: 0, [NODE_ELITE]: 0.05, [NODE_CHEST]: 0.04, [NODE_BOSS]: 0.2 };
export const SHARD_LOOP_GAIN = 0.25;   // за каждый пройденный цикл
export const SHARD_CAP = 0.5;

// ── Подгонка врагов под игрока ───────────────────────────────────────────────
// Ровная эскалация по циклам (+35% здоровья) держится ровно до тех пор, пока
// колода растёт так же ровно. Но колода растёт УМНОЖЕНИЕМ: уровень карты, чары
// с их ×2 → ×4 → ×8 и легендарка вместе дают удар не на 30, а на 300 — и с
// четвёртого цикла забег превращается в прогулку, где враг не успевает сходить.
//
// Поэтому с ADAPT_LOOP враг перестаёт считаться только от номера цикла и
// начинает считаться ОТ ИГРОКА: сколько урона тот выдаёт за ход и сколько брони
// успевает набрать (обе величины — скользящее среднее по последним боям, а не
// один удачный ход). Здоровье врага подгоняется так, чтобы бой длился примерно
// ADAPT_TURNS ходов, а удар — так, чтобы броня не съедала его целиком.
//
// ПОТОЛКИ РАЗНЫЕ, и это главное: рядовой враг остаётся рядовым (крыса с девятью
// тысячами здоровья — не сложность, а тоска), элита заметно крепче, а босс
// становится настоящей стеной. Раньше четвёртого цикла подгонки нет вовсе:
// первые циклы должны читаться как «я стал сильнее», а не как «игра догоняет».
export const ADAPT_LOOP = 4;
export const ADAPT_TURNS = { fight: 2.5, elite: 4, boss: 6 };
export const ADAPT_HP_CAP = { fight: 3, elite: 5, boss: 10 };
export const ADAPT_DMG_CAP = { fight: 2, elite: 3, boss: 4 };
// Во сколько раз удар врага должен перекрывать набранную игроком броню.
export const ADAPT_HIT = 1.15;
// Насколько быстро «средний игрок» забывает прошлые бои.
export const ADAPT_EMA = 0.5;

// Легендарки. Их три на всю игру, и встретить их должно быть событием: обычным
// броском редкости они не выпадают вовсе (вес 0 в контенте), а шанс считается
// отдельно и по трём правилам.
//
//   1. ОН РАСТЁТ С ЦИКЛОМ. В первом цикле легендарка — почти случайность (около
//      одного забега из десяти), к третьему её видит примерно каждый второй, к
//      пятому — почти каждый. Иначе они либо не встречаются никогда, либо
//      обесцениваются на первом же сундуке.
//   2. ВЫПАВШАЯ ГАСИТ СЛЕДУЮЩИЕ. Каждая уже выпавшая делит шанс на пять: две
//      легендарки за забег — редкость, три — история, которую рассказывают.
//   3. ЭЛИТА И БОСС ТЯНУТ ВВЕРХ тем же множителем, что и остальная редкость:
//      легендарка с босса — то, чего от босса и ждут.
export const LEGEND_CHANCE = 0.008;    // базовый шанс на одну награду в первом цикле
export const LEGEND_LOOP_GAIN = 0.022; // +столько за каждый пройденный цикл
export const LEGEND_CAP = 0.12;
export const LEGEND_FADE = 0.22;       // во столько раз реже после каждой выпавшей

// ── Генератор случайного ─────────────────────────────────────────────────────
// xorshift32: три сдвига, целые числа, одинаковый результат в любом браузере и в
// node. Ровно та же причина, по которой в физике бильярда нет синусов — «почти
// одинаково» здесь означает «другой забег по тому же сиду».

export function makeSeed() {
    // Сид берётся ОДИН РАЗ на забег и дальше не трогается: это единственное
    // место во всей игре, где позволено обратиться к недетерминированному
    // источнику.
    return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
}

export function makeRng(seed) {
    return { s: (seed >>> 0) || 1 };
}

function rndNext(rng) {
    let x = rng.s >>> 0;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;  x >>>= 0;
    rng.s = x || 1;
    return rng.s;
}

function rnd(rng) { return rndNext(rng) / 4294967296; }
function rndInt(rng, n) { return n <= 1 ? 0 : rndNext(rng) % n; }
function pick(rng, arr) { return arr[rndInt(rng, arr.length)]; }

function shuffled(rng, arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = rndInt(rng, i + 1);
        const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
}

// ── Карты в колоде ───────────────────────────────────────────────────────────
// Карта в колоде — ЭКЗЕМПЛЯР, а не тип: два «Удара» качаются независимо, и
// мутация ложится на конкретный из них. Отсюда uid: и апгрейд, и мутация, и
// бой адресуют карту номером.

function newCard(run, id) {
    return { uid: run.nextUid++, id, lvl: 1, mut: {} };
}

export function addCard(run, id) {
    const card = newCard(run, id);
    run.deck.push(card);
    return card;
}

export function cardOf(run, uid) {
    return run.deck.find(c => c.uid === uid) || null;
}

/** Число карты с учётом её уровня. Одна формула на весь контент. */
export function scaleValue(v, lvl) {
    return Math.max(1, Math.round(v * (1 + LEVEL_STEP * (lvl - 1))));
}

/**
 * Сила мутации от числа стаков.
 *
 * Множители (odd, opener, finisher, fury) считаются как 2^стаков: ×2, ×4, ×8 —
 * повторная мутация УМНОЖАЕТ старую, а не ложится рядом второй строкой.
 * Числовые (venom, leech, insight, ward, echo, surge) — 2^(стаков−1): 1, 2, 4, 8.
 */
export function mutPower(id, stacks) {
    const def = MUTATION_BY_ID[id];
    if (!def || stacks <= 0) return 0;
    return def.mult ? 2 ** stacks : 2 ** (stacks - 1);
}

// ── Забег ────────────────────────────────────────────────────────────────────

/** Экраны, между которыми ходит забег. Окно игры рисует ровно то, что здесь. */
export const SCREEN_MAP = 'map';
export const SCREEN_BATTLE = 'battle';
export const SCREEN_REWARD = 'reward';
export const SCREEN_EVENT = 'event';
export const SCREEN_OVER = 'over';

export function startRun(seed = makeSeed()) {
    const run = {
        seed: seed >>> 0,
        rng: makeRng(seed),
        loop: 1,
        hp: START_HP,
        maxHp: START_HP,
        deck: [],
        nextUid: 1,
        stones: 0,
        shards: 0,
        legends: 0,     // сколько легендарок уже выпало: каждая гасит шанс следующей
        // Чем игрок стал к этому моменту: урон за ход и броня за ход, скользящим
        // средним по боям. Отсюда считается подгонка врагов (см. ADAPT_LOOP).
        power: 0,
        guard: 0,
        map: null,
        at: { row: -1, i: 0 },
        battle: null,
        reward: null,
        event: null,
        // Незакрытый выбор: «удалить карту» из события. Пока он висит, карта
        // узлов не принимает ходов — иначе награда потерялась бы молча.
        pending: null,
        screen: SCREEN_MAP,
        over: false,
        ms: 0,   // сколько игрок реально просидел в игре; копит окно (см. addTime)
        stats: { nodes: 0, kills: 0, elites: 0, bosses: 0, loops: 0, turns: 0, cards: 0, damage: 0 },
    };
    for (const id of START_DECK) addCard(run, id);
    run.map = makeMap(run);
    return run;
}

/** Время, проведённое в игре. Копит окно: закрытая вкладка забег не тратит. */
export function addTime(run, ms) {
    run.ms += Math.max(0, ms | 0);
}

// ── Карта узлов ──────────────────────────────────────────────────────────────
// Граф: строки по 2–3 узла, из узла ведут одна-две дороги в следующую строку.
// Смысл ровно один — ВЫБОР: пойти через элиту ради лучшего лута или в обход
// через событие. Поэтому строка из одного узла бывает только у босса.

function rowKinds(run, r) {
    const rng = run.rng;
    if (r === 0) return [NODE_FIGHT, NODE_FIGHT];              // старт всегда бой: колоду надо чем-то начать проверять
    if (r === MAP_ROWS - 1) return [NODE_BOSS];
    // Перед боссом — сундук с событием, а сразу перед ним костёр, и он ОДИН на
    // строку: мимо него не пройти. Иначе исход боя с боссом решала бы не колода,
    // а то, сколько здоровья случайно осталось за одиннадцать узлов до него.
    if (r === MAP_ROWS - 2) return [NODE_REST];
    if (r === MAP_ROWS - 3) return [NODE_CHEST, NODE_EVENT];

    const count = 2 + (rnd(rng) < 0.45 ? 1 : 0);
    const kinds = [];
    for (let i = 0; i < count; i++) {
        const x = rnd(rng);
        // Элита не встречается в первых строках: колода в это время ещё
        // стартовая, и «элита на втором узле» — это не сложность, а бросок
        // монетки за весь забег.
        if (r >= 3 && x < 0.18) kinds.push(NODE_ELITE);
        else if (x < 0.36) kinds.push(NODE_CHEST);
        else if (x < 0.58) kinds.push(NODE_EVENT);
        else kinds.push(NODE_FIGHT);
    }
    // Строка из одинаковых узлов — это не выбор, а коридор: разводим второй
    // узел в бой, чтобы дорога всегда о чём-то спрашивала.
    if (kinds.length > 1 && kinds.every(k => k === kinds[0])) {
        kinds[kinds.length - 1] = kinds[0] === NODE_FIGHT ? NODE_EVENT : NODE_FIGHT;
    }
    return kinds;
}

function makeMap(run) {
    const rows = [];
    for (let r = 0; r < MAP_ROWS; r++) {
        rows.push(rowKinds(run, r).map(t => ({ t, done: false })));
    }

    // Дороги. Узел ведёт к «своему по пропорции» соседу снизу и иногда ко
    // второму; потом каждому узлу снизу, до которого никто не дошёл, дорисовываем
    // дорогу от ближайшего сверху — тупиковых узлов на карте быть не должно.
    const links = [];
    for (let r = 0; r < rows.length - 1; r++) {
        const up = rows[r], down = rows[r + 1];
        const row = up.map((_, i) => {
            const base = Math.min(down.length - 1, Math.floor(i * down.length / up.length));
            const to = [base];
            if (down.length > 1 && rnd(run.rng) < 0.5) {
                const alt = base + (base === down.length - 1 ? -1 : 1);
                if (alt >= 0 && alt < down.length) to.push(alt);
            }
            return to.sort((a, b) => a - b);
        });
        for (let j = 0; j < down.length; j++) {
            if (row.some(to => to.includes(j))) continue;
            const from = Math.min(up.length - 1, Math.floor(j * up.length / down.length));
            row[from].push(j);
            row[from].sort((a, b) => a - b);
        }
        links.push(row);
    }
    return { rows, links };
}

/** Куда можно пойти сейчас. Пустой список означает «цикл пройден». */
export function nextNodes(run) {
    if (run.screen !== SCREEN_MAP || run.pending || run.over) return [];
    const { rows, links } = run.map;
    if (run.at.row < 0) return rows[0].map((node, i) => ({ row: 0, i, node }));
    const to = links[run.at.row]?.[run.at.i] || [];
    return to.map(i => ({ row: run.at.row + 1, i, node: rows[run.at.row + 1][i] }));
}

/** Войти в узел следующей строки. i — индекс узла в СВОЕЙ строке. */
export function enterNode(run, i) {
    const options = nextNodes(run);
    const chosen = options.find(o => o.i === i);
    if (!chosen) return { ok: false, reason: 'unreachable' };

    run.at = { row: chosen.row, i };
    run.stats.nodes++;
    const node = chosen.node;

    if (node.t === NODE_REST) {
        // Костёр — это то же событие «Костёр», просто гарантированное картой:
        // отдельной ветки правил ему не нужно, а выбор «отдохнуть или точить»
        // перед боссом как раз и есть решение, ради которого узел стоит.
        run.event = { id: 'campfire', done: false };
        run.screen = SCREEN_EVENT;
    } else if (node.t === NODE_EVENT) {
        run.event = { id: pick(run.rng, EVENTS).id, done: false };
        run.screen = SCREEN_EVENT;
    } else if (node.t === NODE_CHEST) {
        run.reward = rollReward(run, NODE_CHEST);
        run.screen = SCREEN_REWARD;
    } else {
        startBattle(run, node.t);
    }
    return { ok: true, node };
}

function finishNode(run) {
    // Босс — последний узел цикла: за ним не карта, а новый цикл.
    const node = run.map.rows[run.at.row]?.[run.at.i];
    if (node) node.done = true;
    if (node && node.t === NODE_BOSS) { nextLoop(run); return; }
    run.screen = SCREEN_MAP;
}

/** Новый цикл: карта заново, враги сильнее, немного лечения на дорогу. */
export function nextLoop(run) {
    run.loop++;
    run.stats.loops++;
    run.hp = Math.min(run.maxHp, run.hp + Math.round(run.maxHp * LOOP_HEAL));
    run.map = makeMap(run);
    run.at = { row: -1, i: 0 };
    run.battle = null;
    run.screen = SCREEN_MAP;
}

// ── Враг ─────────────────────────────────────────────────────────────────────

function rollMutators(run, kind) {
    // Обычный бой: 0–2 модификатора, элита и босс — гарантированно 2. Именно это
    // перемножение и заменяет собой полсотни написанных вручную врагов.
    const want = kind === NODE_FIGHT
        ? (rnd(run.rng) < 0.45 ? 0 : (rnd(run.rng) < 0.7 ? 1 : 2))
        : 2;
    const pool = shuffled(run.rng, MUTATORS);
    return pool.slice(0, want);
}

function makeEnemy(run, kind) {
    const rng = run.rng;
    const boss = kind === NODE_BOSS;
    const base = boss ? pick(rng, BOSSES) : pick(rng, ENEMIES);
    const mods = rollMutators(run, kind);

    let hpMult = (1 + LOOP_HP * (run.loop - 1)) * (kind === NODE_ELITE ? ELITE_HP : boss ? BOSS_HP : 1);
    let dmgMult = (1 + LOOP_DMG * (run.loop - 1)) * (kind === NODE_ELITE ? ELITE_DMG : 1);
    for (const m of mods) {
        if (m.hp) hpMult *= m.hp;
        if (m.dmg) dmgMult *= m.dmg;
    }
    // Подгонка под игрока: с ADAPT_LOOP здоровье и урон врага считаются не только
    // от номера цикла, но и от того, что игрок реально выдаёт (см. константы).
    const fit = adaptTo(run, kind);
    hpMult *= fit.hp;
    dmgMult *= fit.dmg;

    const maxHp = Math.max(12, Math.round(base.hp * hpMult));

    return {
        id: base.id, name: base.name, kind, boss,
        hp: maxHp, maxHp, block: 0, st: {},
        mods: mods.map(m => m.id),
        // Множитель урона едет ЧИСЛОМ вместе с врагом: намерение показывается
        // игроку заранее, и показанное число обязано совпадать с тем, что
        // прилетит. Считать множитель в двух местах — верный способ разойтись.
        dmg: dmgMult,
        turn: 0,
        intent: null,
        lastIntent: -1,
    };
}

/**
 * Насколько поднять врага под нынешнего игрока.
 *
 * Здоровье — чтобы бой длился примерно ADAPT_TURNS ходов при его уроне за ход.
 * Урон — чтобы удар перекрывал набираемую им броню: игрок с двумя сотнями брони
 * в ход неуязвим для врага, бьющего на тридцать, сколько бы здоровья тому ни
 * добавили.
 *
 * Оба множителя ограничены сверху И СВОИМ ПОТОЛКОМ НА ТИП ВРАГА: рядовой
 * остаётся рядовым, стеной становится босс.
 */
function adaptTo(run, kind) {
    const none = { hp: 1, dmg: 1 };
    if (run.loop < ADAPT_LOOP || !run.power) return none;
    const tier = kind === NODE_BOSS ? 'boss' : kind === NODE_ELITE ? 'elite' : 'fight';

    // Сколько здоровья нужно, чтобы игрок возился с врагом положенные ходы, — и
    // сколько у врага есть без подгонки (base.hp считается снаружи, поэтому
    // сравниваем в множителях: цикл уже учтён в hpMult).
    const want = run.power * ADAPT_TURNS[tier];
    const have = typicalHp(run, kind);
    const hp = clamp(want / Math.max(1, have), 1, ADAPT_HP_CAP[tier]);

    // Урон: чтобы броня не съедала удар целиком. Броня НЕ СГОРАЕТ, поэтому за
    // ориентир берём именно набираемое за ход.
    const wantHit = run.guard * ADAPT_HIT;
    const haveHit = typicalHit(run, kind);
    const dmg = clamp(wantHit / Math.max(1, haveHit), 1, ADAPT_DMG_CAP[tier]);
    return { hp, dmg };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/** Типичное здоровье врага этого узла на этом цикле — БЕЗ подгонки. */
function typicalHp(run, kind) {
    const boss = kind === NODE_BOSS;
    const list = boss ? BOSSES : ENEMIES;
    const avg = list.reduce((s, e) => s + e.hp, 0) / list.length;
    return avg * (1 + LOOP_HP * (run.loop - 1)) * (kind === NODE_ELITE ? ELITE_HP : 1);
}

/** Типичный урон врага за ход на этом цикле — БЕЗ подгонки. */
function typicalHit(run, kind) {
    const boss = kind === NODE_BOSS;
    const list = boss ? BOSSES : ENEMIES;
    let sum = 0, n = 0;
    for (const e of list) {
        for (const i of e.intents) {
            sum += i.acts.filter(a => a.t === I_ATTACK).reduce((s, a) => s + a.v * (a.times || 1), 0);
            n++;
        }
    }
    const avg = n ? sum / n : 1;
    return avg * (1 + LOOP_DMG * (run.loop - 1)) * (kind === NODE_ELITE ? ELITE_DMG : 1);
}

function modNum(enemy, field) {
    // Числа модификаторов растут вместе с уроном врага: шипы на седьмом цикле,
    // оставшиеся тройкой, просто перестали бы существовать.
    let v = 0;
    for (const id of enemy.mods) {
        const m = MUTATOR_BY_ID[id];
        if (m && m[field]) v += m[field];
    }
    if (!v) return 0;
    if (field === 'every') return v;                        // «каждый N-й ход» не масштабируется
    if (field === 'leech' || field === 'regen') return v;   // доли, а не числа
    return Math.max(1, Math.round(v * enemy.dmg));
}

function rollIntent(run) {
    const b = run.battle, e = b.enemy;
    const base = e.boss ? BOSSES.find(x => x.id === e.id) : ENEMIES.find(x => x.id === e.id);
    const list = base.intents;
    let i = rndInt(run.rng, list.length);
    // Одно и то же намерение два хода подряд читается как «игра залипла»,
    // особенно когда это блок. Один перебор — этого достаточно, зацикливаться
    // на поиске «любого другого» незачем.
    if (list.length > 1 && i === e.lastIntent) i = (i + 1) % list.length;
    e.lastIntent = i;
    e.intent = i;
}

/**
 * Что враг сделает следующим ходом — ГОТОВЫМИ ЧИСЛАМИ, с учётом его силы,
 * ослабления и множителя цикла.
 *
 * Это не украшение, а основа игры: игрок обязан видеть, во что ему прилетит, ДО
 * своего хода — иначе блок ставится наугад, и вся сборка колоды теряет смысл.
 */
export function intentView(run) {
    const b = run.battle;
    if (!b || b.over) return null;
    const e = b.enemy;
    const base = (e.boss ? BOSSES : ENEMIES).find(x => x.id === e.id);
    const acts = base.intents[e.intent].acts;
    const out = [];
    for (const a of acts) {
        if (a.t === I_ATTACK) {
            out.push({ t: I_ATTACK, v: enemyHitValue(b, a.v), times: a.times || 1 });
        } else if (a.t === I_BLOCK) {
            out.push({ t: I_BLOCK, v: Math.max(1, Math.round(a.v * e.dmg)) });
        } else {
            out.push({ t: I_STATUS, s: a.s, v: a.v, to: a.to });
        }
    }
    // «Ускоренный» показываем отдельным флагом, а не удвоенными числами: врать
    // в числах намерения нельзя, а «в этот ход он сходит дважды» — честно.
    const every = modNum(e, 'every');
    return { acts: out, twice: every > 0 && (b.turn % every === 0) };
}

function enemyHitValue(b, v) {
    const e = b.enemy;
    let dmg = Math.max(1, Math.round(v * e.dmg)) + (e.st[STR] | 0);
    if ((e.st[WEAK] | 0) > 0) dmg = Math.floor(dmg * WEAK_MULT);
    if ((b.hero.st[VULN] | 0) > 0) dmg = Math.floor(dmg * VULN_MULT);
    return Math.max(0, dmg);
}

// ── Бой ──────────────────────────────────────────────────────────────────────

function startBattle(run, kind) {
    const enemy = makeEnemy(run, kind);
    run.battle = {
        kind,
        enemy,
        hero: { hp: run.hp, maxHp: run.maxHp, block: 0, energy: 0, maxEnergy: ENERGY_PER_TURN, st: {} },
        draw: shuffled(run.rng, run.deck.map(c => c.uid)),
        hand: [],
        board: [],      // выложено на стол в этот ход, ещё не сработало
        hold: [],       // вернётся в руку в начале следующего хода («Эхо-камень»)
        discard: [],
        exhaust: [],
        turn: 0,
        dealt: 0,       // урона нанесено врагу за бой (из этого считается сила игрока)
        gained: 0,      // брони набрано за бой (из этого — насколько больно должен бить враг)
        played: 0,      // карт СРАБОТАЛО в этом ходу (условие «первая карта»)
        spent: 0,       // энергии потрачено в этом ходу (мутация «разгон»)
        double: 0,      // сколько ближайших карт сработают дважды («Зеркало»)
        wardEach: 0,    // столько брони прирастает в начале каждого хода («Запас»)
        doubleEach: 0,  // столько первых карт хода срабатывают дважды («Зеркальный зал»)
        echo: {},       // uid → сколько раз карта уже вернулась в руку за бой
        surge: {},      // uid → сколько раз карта сыграна бесплатно за бой
        log: [],
        over: null,     // null | 'win' | 'lose'
    };
    run.screen = SCREEN_BATTLE;
    heroTurn(run);
}

function heroTurn(run) {
    const b = run.battle;
    b.turn++;
    run.stats.turns++;
    // БРОНЯ НЕ СГОРАЕТ и копится от хода к ходу — как в карточных играх с
    // героем, а не как в рогаликах с одноразовым блоком. Разница принципиальная:
    // блок, сгорающий в конце хода, наказывает за «переставил лишнего», а броня
    // превращает защиту во вложение — поставленное сегодня работает и завтра.
    //
    // Из-за этого числа защиты В КОНТЕНТЕ намеренно маленькие: броня за энергию
    // обязана быть заметно меньше урона врага за ход, иначе выгодно закрыться
    // наглухо и не бить вовсе — бой перестанет кончаться, а забег превратится в
    // соревнование по терпению (тот же довод, что про часы в тройке).
    if (b.wardEach) addBlock(b, b.hero, b.wardEach);
    b.hero.energy = b.hero.maxEnergy;
    b.played = 0;
    b.spent = 0;
    b.double = b.doubleEach | 0;
    rollIntent(run);
    // Карты, которые «возвращаются в руку», приезжают в НАЧАЛЕ хода, а не сразу
    // после срабатывания: стол играет в конце хода, и возвращённая карта попала
    // бы в руку ровно в тот момент, когда рука целиком уходит в сброс.
    while (b.hold.length && b.hand.length < MAX_HAND) b.hand.push(b.hold.shift());
    b.hold = [];
    drawCards(run, HAND_SIZE);
}

function drawCards(run, n) {
    const b = run.battle;
    for (let k = 0; k < n; k++) {
        if (!b.draw.length) {
            if (!b.discard.length) return;   // карты кончились совсем — это нормально
            b.draw = shuffled(run.rng, b.discard);
            b.discard = [];
        }
        if (b.hand.length >= MAX_HAND) return;
        b.hand.push(b.draw.pop());
    }
}

// Что уровень вообще умеет растить. Добор, энергия и удвоение сюда не входят
// намеренно (см. applyEffect): «тянет 2.6 карты» — не число, а действие, и
// округление превратило бы уровень в лотерею «повезло/не повезло».
const SCALING = new Set([DAMAGE, BLOCK, HEAL, STATUS]);

/**
 * Растёт ли карта от уровня.
 *
 * У «Сосредоточения» (тянет 2 карты) расти нечему, и точильный камень в неё —
 * камень в никуда. Поэтому камень такие карты и НЕ БЕРЁТ: правило про «уровень
 * не трогает добор» честное, а вот дать игроку молча испортить камень — нет.
 * Знать список таких карт по именам никому не нужно: это следствие эффектов.
 */
export function canLevel(card) {
    return CARD_BY_ID[card.id].effects.some(e => SCALING.has(e.t));
}

/** Стоимость карты прямо сейчас: мутация «разгон» может сделать её бесплатной. */
export function costOf(run, card) {
    const def = CARD_BY_ID[card.id];
    return surgeFree(run, card) ? 0 : def.cost;
}

function surgeFree(run, card) {
    const b = run.battle;
    if (!b) return false;
    const stacks = card.mut?.surge | 0;
    if (!stacks) return false;
    const used = b.surge[card.uid] | 0;
    return b.spent >= 3 && used < mutPower('surge', stacks);
}

/**
 * Множитель к числам карты от мутаций.
 *
 * Множители кладутся ТОЛЬКО на урон, блок и лечение — то, что игрок и называет
 * «числами карты». Статусы под них не попадают сознательно: ×8 к восьми ядам
 * означало бы «карта убивает любого врага любого цикла», и вся игра свелась бы к
 * одной мутации на одной карте.
 */
function numMult(b, card, isDamage) {
    const mu = card.mut || {};
    let m = 1;
    if (mu.odd && isDamage && b.enemy.hp % 2 === 1) m *= mutPower('odd', mu.odd);
    if (mu.opener && b.played === 0) m *= mutPower('opener', mu.opener);
    if (mu.finisher && b.hand.length === 0) m *= mutPower('finisher', mu.finisher);
    if (mu.fury && isDamage && b.hero.hp * 2 < b.hero.maxHp) m *= mutPower('fury', mu.fury);
    return m;
}

/**
 * Выложить карту из руки НА СТОЛ. Энергия тратится сейчас, а сработает карта в
 * конце хода — см. resolveBoard.
 *
 * ПОЧЕМУ РОЗЫГРЫШ ОТЛОЖЕН. Ход игрока — это ЗАЯВКА: он выкладывает карты, видя
 * их числа и намерение врага, и только потом смотрит, что из этого вышло. Так
 * ход приходится считать в голове заранее, а не подбирать по одной карте,
 * глядя на уже уехавшее здоровье врага. Порядок карт на столе — тоже решение:
 * «Зеркало» перед «Размахом», «Порча» перед атаками, «Засада» первой.
 *
 * ЧТО СРАБАТЫВАЕТ СРАЗУ: добор, энергия и улучшение карты в руке (INSTANT).
 * Это не исключение «для удобства», а следствие того, что они меняют САМУ
 * ЗАЯВКУ: карта, которая тянет карты в конце хода, тянет их в руку, уходящую в
 * сброс, то есть не делает ничего. Всё, что трогает здоровье, броню и статусы,
 * ждёт «Хода» — иначе видно результат заранее, и заявки нет.
 */
export function playCard(run, handIdx) {
    const b = run.battle;
    if (!b || b.over) return { ok: false, reason: 'no_battle' };
    const uid = b.hand[handIdx];
    if (uid === undefined) return { ok: false, reason: 'no_card' };
    const card = cardOf(run, uid);
    const def = CARD_BY_ID[card.id];
    const free = surgeFree(run, card);
    const cost = free ? 0 : def.cost;
    if (cost > b.hero.energy) return { ok: false, reason: 'energy' };

    b.hand.splice(handIdx, 1);
    b.hero.energy -= cost;
    b.spent += cost;
    if (free) b.surge[uid] = (b.surge[uid] | 0) + 1;

    applyInstant(run, card, def);

    // Карта-вспышка своё уже сделала — на стол она не ложится, а сразу уходит в
    // сброс. В журнал при этом пишется отметка: окну надо её показать, иначе
    // карта просто исчезнет из руки без объяснений.
    if (isFlash(card)) {
        note(b, { t: 'flash', uid });
        run.stats.cards++;
        toPile(run, card, def, uid);
        return { ok: true, flash: true };
    }

    b.board.push(uid);
    return { ok: true };
}

/**
 * Переставить карту на столе.
 *
 * Порядок стола — это решение («Порча» перед атаками, «Зеркало» перед
 * «Размахом»), а ошибиться в нём легко: карты кладут быстро. Перестановка при
 * этом ничего не отменяет — ни потраченную энергию, ни уже случившийся добор, —
 * поэтому она безопасна, в отличие от возврата карты в руку.
 */
export function moveCard(run, from, to) {
    const b = run.battle;
    if (!b || b.over) return { ok: false, reason: 'no_battle' };
    if (!Number.isInteger(from) || !Number.isInteger(to)) return { ok: false, reason: 'shape' };
    if (from < 0 || from >= b.board.length) return { ok: false, reason: 'no_card' };
    const at = Math.max(0, Math.min(b.board.length - 1, to));
    if (at !== from) {
        const [uid] = b.board.splice(from, 1);
        b.board.splice(at, 0, uid);
    }
    return { ok: true };
}

/**
 * Сыграть стол СЛЕВА НАПРАВО. Один вызов — весь ход игрока: правила считают его
 * целиком и мгновенно, а окно потом проигрывает журнал по шагам.
 */
function resolveBoard(run) {
    const b = run.battle;
    while (b.board.length && !b.over) {
        const uid = b.board.shift();
        const card = cardOf(run, uid);
        const def = CARD_BY_ID[card.id];
        note(b, { t: 'cast', uid });

        // «Зеркало» — единственное место, где карта срабатывает дважды целиком,
        // со всеми условиями и мутациями. Именно поэтому оно и эпик.
        const times = b.double > 0 ? 2 : 1;
        if (b.double > 0) b.double--;
        for (let k = 0; k < times && !b.over; k++) applyCard(run, card, def);

        b.played++;
        run.stats.cards++;
        toPile(run, card, def, uid);
        checkEnd(run);
    }
    // Врага добили посреди стола — остальные карты просто уходят в сброс.
    if (b.board.length) { b.discard.push(...b.board); b.board = []; }
}

/**
 * Куда уходит сработавшая карта. Порядок важен: «эхо» сильнее изгнания — карта,
 * которая вернулась в руку, из боя не уходит.
 */
function toPile(run, card, def, uid) {
    const b = run.battle;
    const echoLeft = mutPower('echo', card.mut?.echo | 0) - (b.echo[uid] | 0);
    if (card.mut?.echo && echoLeft > 0) {
        b.echo[uid] = (b.echo[uid] | 0) + 1;
        b.hold.push(uid);
    } else if (def.bounce) {
        b.hold.push(uid);
    } else if (def.exhaust) {
        b.exhaust.push(uid);
    } else {
        b.discard.push(uid);
    }
}

// Эффекты, которые срабатывают ПРИ ВЫКЛАДЫВАНИИ, а не в конце хода: все три
// меняют не бой, а саму заявку — что ещё игрок успеет положить на стол.
const INSTANT = new Set([DRAW, ENERGY, UPGRADE]);

// Мутации, которые ДОБАВЛЯЮТ карте бой (см. applyCard): с любой из них даже
// «Адреналин» перестаёт быть чистой подготовкой.
const MUT_COMBAT = ['venom', 'leech', 'ward'];

/**
 * Карта-вспышка: вся её работа мгновенная — добор, энергия, улучшение.
 *
 * Такие карты НА СТОЛ НЕ ЛОЖАТСЯ. Стол — это заявка на бой, а «Адреналин» уже
 * отработал в тот момент, когда его вытянули из руки: лежать ему там нечего, он
 * только загораживает карты, которые действительно сработают по «Ходу».
 */
export function isFlash(card) {
    const def = CARD_BY_ID[card.id];
    return def.effects.every(e => INSTANT.has(e.t))
        && !MUT_COMBAT.some(id => card.mut?.[id]);
}

function applyCard(run, card, def) {
    const b = run.battle;
    for (const e of def.effects) {
        if (INSTANT.has(e.t)) continue;
        if (e.when && !CONDITIONS[e.when].test(b)) continue;
        applyEffect(run, card, e);
        if (b.over) return;
    }

    // Мутации-добавки. Они не эффекты карты, а надстройка над ней, поэтому
    // считаются после и не зависят от условий самой карты.
    const mu = card.mut || {};
    if (mu.venom && def.kind === ATTACK) addStatus(b, b.enemy, POISON, mutPower('venom', mu.venom));
    if (mu.leech) healUnit(b, b.hero, mutPower('leech', mu.leech));
    if (mu.ward) addBlock(b, b.hero, mutPower('ward', mu.ward));
}

/** Часть карты, которая срабатывает сразу при выкладывании. */
function applyInstant(run, card, def) {
    const b = run.battle;
    for (const e of def.effects) {
        if (!INSTANT.has(e.t)) continue;
        if (e.when && !CONDITIONS[e.when].test(b)) continue;
        applyEffect(run, card, e);
    }
    if (card.mut?.insight) drawCards(run, mutPower('insight', card.mut.insight));
}

// «За каждую…» — общий множитель числа от происходящего в бою, а не поле под
// одну карту. Считается на МОМЕНТ СРАБАТЫВАНИЯ, и в этом весь смысл: «Час
// расплаты», положенный на стол последним, бьёт за все карты перед собой, а
// положенный первым — не бьёт вовсе.
const PER = {
    played: b => b.played,
};

function perMult(b, e) {
    return e.per ? PER[e.per](b) : 1;
}

function applyEffect(run, card, e) {
    const b = run.battle;
    const lvl = card.lvl;
    switch (e.t) {
        case DAMAGE: {
            const n = Math.round(scaleValue(e.v, lvl) * numMult(b, card, true) * perMult(b, e));
            if (n <= 0) break;
            for (let i = 0; i < (e.times || 1); i++) {
                heroHit(run, n);
                if (b.over || b.enemy.hp <= 0) return;
            }
            break;
        }
        case BLOCK:
            addBlock(b, b.hero, Math.round(scaleValue(e.v, lvl) * numMult(b, card, false)));
            break;
        case HEAL:
            healUnit(b, b.hero, Math.round(scaleValue(e.v, lvl) * numMult(b, card, false)));
            break;
        case DRAW:
            // Добор, энергия и удвоение уровнем НЕ масштабируются: уровень — это
            // ровный рост чисел, а «тянет 2.6 карты» не число, а действие, и
            // округление превращало бы уровень в лотерею «повезло/не повезло».
            drawCards(run, e.v);
            break;
        case ENERGY:
            b.hero.energy += e.v;
            break;
        case STATUS: {
            const target = e.to === 'self' ? b.hero : b.enemy;
            addStatus(b, target, e.s, scaleValue(e.v, lvl));
            break;
        }
        case UPGRADE: {
            // Улучшает карту В РУКЕ и НАВСЕГДА — то есть на весь забег, а не «до
            // конца боя». В этом вся ценность эпика: он превращает бой в
            // вложение в колоду.
            // Карты, которым уровень ничего не даёт, «Кузница» пропускает по
            // той же причине, по которой их не берёт камень.
            const hand = b.hand.filter(uid => canLevel(cardOf(run, uid)));
            const inHand = hand.length > 0;
            const pool = inHand ? hand : run.deck.filter(canLevel).map(c => c.uid);
            if (pool.length) {
                const target = cardOf(run, pool[rndInt(run.rng, pool.length)]);
                if (target) {
                    target.lvl += e.v;
                    // Какую именно карту улучшили — окно обязано сказать: выбор
                    // случайный, и молча выросший уровень выглядит как ничего.
                    note(b, { t: 'upgrade', uid: target.uid, lvl: target.lvl, inHand });
                }
            }
            break;
        }
        case DOUBLE:
            b.double += e.v;
            break;
        case AMPLIFY: {
            const p = b.enemy.st[POISON] | 0;
            if (p > 0) b.enemy.st[POISON] = p * 2;
            break;
        }
        case RULE:
            // Правила, которые карта включает на весь бой. Каждое — ИМЕНОВАННОЕ
            // и общее; ветки «если это карта такая-то» в движке быть не должно.
            if (e.r === 'ward') b.wardEach = (b.wardEach | 0) + (e.v || 0);
            // Энергия прибавляется к ПОТОЛКУ, а не к текущей: карта сработала в
            // конце хода, и щедрость её видна со следующего.
            if (e.r === 'energy') b.hero.maxEnergy += e.v || 0;
            if (e.r === 'mirror') b.doubleEach = (b.doubleEach | 0) + (e.v || 0);
            break;
    }
}

// ── Журнал боя ───────────────────────────────────────────────────────────────
// Правила считают ход ЦЕЛИКОМ и мгновенно, а окно показывает его по шагам:
// карта прилетела на стол, у врага отлетели цифры урона, полоса здоровья
// поехала вниз, потом ответил враг. Чтобы показать это, окну мало итогового
// состояния — ему нужно, ЧТО ИМЕННО происходило и в каком порядке.
//
// Отсюда журнал: каждое событие несёт не только своё число, но и здоровье с
// блоком ПОСЛЕ себя. Первым событием каждой сработавшей карты идёт `cast` с её
// uid — по нему окно и подсвечивает стол слева направо; `sweep` означает, что
// невыложенная рука ушла в сброс. Окно проигрывает журнал по одному событию, ставя полосы в
// эти значения, — и ему не нужно ни повторять правила, ни угадывать порядок
// (сравните с дураком, где показ хода вычисляется разницей двух видов: там
// позиция приезжает с сервера без рассказа о том, что случилось, а здесь
// правила и окно в одном браузере, и рассказать честнее и проще).
//
// Журнал ОГРАНИЧЕН по длине: если окно закрыли посреди боя и никто его не
// разбирал, он не должен расти вместе с сохранённым забегом.
const LOG_LIMIT = 400;

function side(b, unit) { return unit === b.hero ? 'hero' : 'enemy'; }

function note(b, ev) {
    if (b && b.log && b.log.length < LOG_LIMIT) b.log.push(ev);
}

/** Забрать накопленные события и очистить журнал. Зовёт окно после действия. */
export function takeLog(run) {
    const b = run.battle;
    if (!b || !b.log?.length) return [];
    const out = b.log;
    b.log = [];
    return out;
}

function addStatus(b, unit, s, v) {
    unit.st[s] = (unit.st[s] | 0) + v;
    note(b, { t: 'status', who: side(b, unit), s, v, left: unit.st[s] });
}

function healUnit(b, unit, n) {
    const before = unit.hp;
    unit.hp = Math.min(unit.maxHp, unit.hp + Math.max(0, n));
    if (unit.hp !== before) note(b, { t: 'heal', who: side(b, unit), v: unit.hp - before, hp: unit.hp });
}

function addBlock(b, unit, n) {
    if (n <= 0) return;
    unit.block += n;
    if (unit === b.hero) b.gained += n;
    note(b, { t: 'block', who: side(b, unit), v: n, block: unit.block });
}

/**
 * Удар. Порядок множителей один на всю игру: сила, ослабление бьющего,
 * уязвимость получающего, потом блок.
 *
 * attack=false у яда и шипов — они не атака, силу и ослабление не считают.
 */
function strike(b, from, to, amount, attack, src) {
    let dmg = amount;
    if (attack) {
        dmg += from.st[STR] | 0;
        if ((from.st[WEAK] | 0) > 0) dmg = Math.floor(dmg * WEAK_MULT);
    }
    if ((to.st[VULN] | 0) > 0) dmg = Math.floor(dmg * VULN_MULT);
    dmg = Math.max(0, Math.round(dmg));
    const blocked = Math.min(to.block, dmg);
    to.block -= blocked;
    const real = dmg - blocked;
    to.hp = Math.max(0, to.hp - real);
    note(b, { t: 'hit', who: side(b, to), src, dmg, real, blocked, hp: to.hp, block: to.block });
    return real;
}

function heroHit(run, n) {
    const b = run.battle;
    const real = strike(b, b.hero, b.enemy, n, true, 'card');
    run.stats.damage += real;
    b.dealt += real;
    const thorns = b.enemy.st[THORNS] | 0;
    if (thorns > 0) strike(b, b.enemy, b.hero, thorns, false, 'thorns');
    checkEnd(run);
}

/** Передать ход. Отсюда и до начала следующего хода игрок ничего не решает. */
export function endTurn(run) {
    const b = run.battle;
    if (!b || b.over) return { ok: false };

    // Сначала играет СТОЛ — в том порядке, в каком игрок выкладывал карты.
    resolveBoard(run);
    if (b.over) return { ok: true };

    // Рука уходит в сброс целиком: карта, которую не выложили, потеряна. Это
    // главная причина считать энергию, а не копить «на потом». Считается это
    // ПОСЛЕ стола: условие «если рука пуста» смотрит на невыложенные карты, а
    // не на пустоту, наступившую от самого конца хода.
    if (b.hand.length) note(b, { t: 'sweep', n: b.hand.length });
    b.discard.push(...b.hand);
    b.hand = [];

    tickEnd(b, b.hero);
    checkEnd(run);
    if (b.over) return { ok: true };

    enemyAct(run);
    if (b.over) return { ok: true };

    tickEnd(b, b.enemy);
    const regen = modNum(b.enemy, 'regen');
    if (regen) healUnit(b, b.enemy, Math.max(1, Math.round(b.enemy.maxHp * regen)));
    checkEnd(run);
    if (b.over) return { ok: true };

    heroTurn(run);
    return { ok: true };
}

function tickEnd(b, unit) {
    const st = unit.st;
    const p = st[POISON] | 0;
    // Яд бьёт МИМО блока: иначе колода на яде проигрывала бы любому щитоносцу, а
    // весь смысл яда — в том, что он идёт другой дорогой.
    if (p > 0) {
        unit.hp = Math.max(0, unit.hp - p);
        st[POISON] = p - 1;
        // Яд на враге — это тоже урон игрока, и в силу игрока он обязан входить:
        // колода на яде иначе выглядела бы для подгонки беспомощной.
        if (unit === b.enemy) b.dealt += p;
        note(b, { t: 'poison', who: side(b, unit), v: p, hp: unit.hp });
    }
    const r = st[REGEN] | 0;
    if (r > 0) { healUnit(b, unit, r); st[REGEN] = r - 1; }
    for (const s of [WEAK, VULN]) if ((st[s] | 0) > 0) st[s]--;
    for (const k of Object.keys(st)) if (!st[k]) delete st[k];
}

function enemyAct(run) {
    const b = run.battle, e = b.enemy;
    // Броня врага, как и у игрока, не сгорает: правило одно на обоих, иначе
    // «почему у него держится, а у меня нет» пришлось бы объяснять в интерфейсе.
    // «Ход врага» — отдельная отметка в журнале: окно по ней делает паузу и
    // показывает, что дальше действует уже не игрок.
    note(b, { t: 'turn', who: 'enemy' });
    addBlock(b, e, modNum(e, 'block'));

    const base = (e.boss ? BOSSES : ENEMIES).find(x => x.id === e.id);
    const acts = base.intents[e.intent].acts;
    doActs(run, acts);
    const every = modNum(e, 'every');
    if (!b.over && every > 0 && b.turn % every === 0) doActs(run, acts);
}

function doActs(run, acts) {
    const b = run.battle, e = b.enemy;
    const poison = modNum(e, 'venom') ? MUTATOR_BY_ID.venom.poison : 0;
    const weak = e.mods.includes('curse') ? MUTATOR_BY_ID.curse.weak : 0;
    const leech = modNum(e, 'leech');

    for (const a of acts) {
        if (b.over || b.hero.hp <= 0) return;
        if (a.t === I_ATTACK) {
            for (let i = 0; i < (a.times || 1); i++) {
                const real = strike(b, e, b.hero, Math.max(1, Math.round(a.v * e.dmg)), true, 'enemy');
                if (leech) healUnit(b, e, Math.round(real * leech));
                if (poison) addStatus(b, b.hero, POISON, poison);
                if (weak) addStatus(b, b.hero, WEAK, weak);
                const thorns = b.hero.st[THORNS] | 0;
                if (thorns > 0) strike(b, b.hero, e, thorns, false, 'thorns');
                checkEnd(run);
                if (b.over || b.hero.hp <= 0) return;
            }
        } else if (a.t === I_BLOCK) {
            addBlock(b, e, Math.max(1, Math.round(a.v * e.dmg)));
        } else if (a.t === I_STATUS) {
            addStatus(b, a.to === 'self' ? e : b.hero, a.s, a.v);
        }
    }
    checkEnd(run);
}

function checkEnd(run) {
    const b = run.battle;
    if (!b || b.over) return;
    if (b.enemy.hp <= 0) { note(b, { t: 'over', result: 'win' }); b.over = 'win'; winBattle(run); }
    else if (b.hero.hp <= 0) { note(b, { t: 'over', result: 'lose' }); b.over = 'lose'; run.hp = 0; endRun(run); }
}

function winBattle(run) {
    const b = run.battle;
    measure(run, b);
    run.hp = b.hero.hp;
    run.stats.kills++;
    if (b.kind === NODE_ELITE) run.stats.elites++;
    if (b.kind === NODE_BOSS) run.stats.bosses++;
    run.reward = rollReward(run, b.kind);
    run.screen = SCREEN_REWARD;
}

/**
 * Запомнить, что игрок вытворял в этом бою: урон за ход и броня за ход.
 *
 * Считаем СКОЛЬЗЯЩИМ СРЕДНИМ, а не максимумом: один удачный ход с «Часом
 * расплаты» не должен объявлять игрока вдвое сильнее, чем он есть, — иначе
 * следующий бой окажется наказанием за хорошую руку.
 */
function measure(run, b) {
    const turns = Math.max(1, b.turn);
    const power = b.dealt / turns;
    const guard = b.gained / turns;
    run.power = run.power ? run.power * (1 - ADAPT_EMA) + power * ADAPT_EMA : power;
    run.guard = run.guard ? run.guard * (1 - ADAPT_EMA) + guard * ADAPT_EMA : guard;
}

function endRun(run) {
    run.over = true;
    run.screen = SCREEN_OVER;
}

/** Сдаться. Забег закрывается как проигранный — результат всё равно засчитан. */
export function giveUp(run) {
    if (run.over) return;
    run.battle = null;
    endRun(run);
}

// ── Лут ──────────────────────────────────────────────────────────────────────

function rollRarity(run, kind) {
    // Элита и босс тянут выбор вверх: не «дают эпик», а перевешивают шансы. Иначе
    // элита превращается в обязательный узел, а обход — в проигрыш по очкам.
    const bump = rarityBump(kind);
    const w = {
        [COMMON]: RARITY[COMMON].weight,
        [RARE]: RARITY[RARE].weight * bump,
        [EPIC]: RARITY[EPIC].weight * bump,
    };
    const total = w[COMMON] + w[RARE] + w[EPIC];
    let x = rnd(run.rng) * total;
    if ((x -= w[EPIC]) < 0) return EPIC;
    if ((x -= w[RARE]) < 0) return RARE;
    return COMMON;
}

/** Множитель редкости за узел: элита и босс тянут выбор вверх. */
function rarityBump(kind) {
    return kind === NODE_ELITE || kind === NODE_BOSS ? 2.5 : kind === NODE_CHEST ? 1.6 : 1;
}

/** Шанс легендарки на этой награде — см. константы выше. */
export function legendChance(run, kind) {
    const base = Math.min(LEGEND_CAP, LEGEND_CHANCE + LEGEND_LOOP_GAIN * (run.loop - 1));
    return base * rarityBump(kind) * Math.pow(LEGEND_FADE, run.legends | 0);
}

/**
 * Выпала ли легендарка. Уже лежащая в колоде повторно не приходит: их три на всю
 * игру, и вторая копия «Зеркального зала» — не подарок, а разбавленная колода.
 */
function rollLegend(run, kind) {
    const own = new Set(run.deck.map(c => c.id));
    const pool = CARDS.filter(c => c.rarity === LEGEND && !own.has(c.id));
    if (!pool.length || rnd(run.rng) >= legendChance(run, kind)) return null;
    run.legends = (run.legends | 0) + 1;
    return pick(run.rng, pool).id;
}

function rollReward(run, kind) {
    const cards = [];
    let guard = 0;
    while (cards.length < REWARD_CARDS && guard++ < 60) {
        const rarity = rollRarity(run, kind);
        const pool = CARDS.filter(c => c.rarity === rarity && !cards.includes(c.id));
        if (!pool.length) continue;
        cards.push(pick(run.rng, pool).id);
    }

    // Легендарка занимает ОДНО из трёх мест, а не приходит вместо выбора: даже
    // её берут не всегда — «Сердце горна» за три энергии в колоде из дешёвых
    // карт может оказаться хуже второго «Размаха».
    const legend = rollLegend(run, kind);
    if (legend) cards[0] = legend;

    const shardBase = (SHARD_CHANCE[kind] || 0) * Math.min(1 + SHARD_LOOP_GAIN * (run.loop - 1), 3);
    return {
        kind,
        cards,
        stone: rnd(run.rng) < (STONE_CHANCE[kind] || 0) ? 1 : 0,
        shard: rnd(run.rng) < Math.min(shardBase, SHARD_CAP) ? 1 : 0,
    };
}

/** Выбрать награду: i — номер карты, −1 — отказаться (за это лечат). */
export function chooseReward(run, i) {
    const r = run.reward;
    if (!r) return { ok: false };
    if (i >= 0 && r.cards[i]) addCard(run, r.cards[i]);
    else healRun(run, SKIP_HEAL);
    run.stones += r.stone;
    run.shards += r.shard;
    run.reward = null;
    run.battle = null;
    finishNode(run);
    return { ok: true };
}

function healRun(run, n) {
    run.hp = Math.min(run.maxHp, run.hp + Math.max(0, Math.round(n)));
}

/** Потратить точильный камень: +1 уровень конкретной карте в колоде. */
export function useStone(run, uid) {
    if (run.stones <= 0) return { ok: false, reason: 'no_stone' };
    const card = cardOf(run, uid);
    if (!card) return { ok: false, reason: 'no_card' };
    if (!canLevel(card)) return { ok: false, reason: 'no_growth' };
    card.lvl++;
    run.stones--;
    return { ok: true, card };
}

/**
 * Потратить осколок мутации: случайная мутация на выбранную карту.
 *
 * Карту выбирает игрок, мутацию — сид: иначе «выбрать нужную» превратилось бы в
 * очевидное «ещё раз ту же самую», и вся редкость осколка ушла бы в никуда.
 */
export function useShard(run, uid) {
    if (run.shards <= 0) return { ok: false, reason: 'no_shard' };
    const card = cardOf(run, uid);
    if (!card) return { ok: false, reason: 'no_card' };
    const def = CARD_BY_ID[card.id];
    const own = Object.keys(card.mut || {});
    // Разных мутаций на карте не больше MAX_MUTATIONS. Дальше осколок не
    // добавляет новую строку, а УСИЛИВАЕТ одну из уже висящих — то есть идёт по
    // тому же удвоению (×2 → ×4 → ×8), ради которого мутации и задуманы.
    // Причина потолка не в силе, а в читаемости: карта с десятком строк
    // перестаёт быть картой, её нельзя ни показать, ни удержать в голове.
    const pool = own.length >= MAX_MUTATIONS
        ? own.map(id => MUTATION_BY_ID[id])
        : MUTATIONS.filter(m => !m.kind || m.kind === def.kind);
    const m = pick(run.rng, pool);
    card.mut[m.id] = (card.mut[m.id] | 0) + 1;
    run.shards--;
    return { ok: true, card, mutation: m.id, stacks: card.mut[m.id] };
}

// ── События ──────────────────────────────────────────────────────────────────

/** Выбрать вариант в событии. */
export function chooseEvent(run, i) {
    const ev = run.event;
    if (!ev) return { ok: false };
    const def = EVENT_BY_ID[ev.id];
    const opt = def.options[i];
    if (!opt) return { ok: false };
    run.event = null;

    const notes = [];
    for (const g of opt.gain) {
        const res = applyGain(run, g);
        if (res) notes.push(res);
        if (run.screen === SCREEN_BATTLE || run.pending) break;   // бой и выбор карты ждать не могут
    }
    // Узел закрывается ТОЛЬКО когда выбор действительно доигран: если событие
    // попросило выбросить карту, узел ещё висит на игроке, и закрывать его
    // вторым finishNode после removeCard было бы лишним (а на боссе — вдвойне
    // опасным: цикл сменился бы дважды).
    if (run.screen === SCREEN_EVENT && !run.pending) finishNode(run);
    return { ok: true, notes };
}

function applyGain(run, g) {
    switch (g.t) {
        case 'heal':
            // Дробь — это доля от предела здоровья, целое — просто здоровье:
            // лечение «на треть» обязано оставаться заметным и на восьмом цикле.
            healRun(run, g.v < 1 ? run.maxHp * g.v : g.v);
            return 'лечение';
        case 'hurt':
            run.hp = Math.max(1, run.hp - g.v);   // событие не убивает: смерть от текста — это не игра
            return `−${g.v} здоровья`;
        case 'maxhp':
            run.maxHp = Math.max(20, run.maxHp + g.v);
            run.hp = Math.min(run.hp, run.maxHp);
            if (g.v > 0) healRun(run, g.v);
            return `предел здоровья ${g.v > 0 ? '+' : ''}${g.v}`;
        case 'stone':
            run.stones += g.v;
            return `камней +${g.v}`;
        case 'shard':
            run.shards += g.v;
            return `осколок мутации`;
        case 'card':
            addCard(run, g.id);
            return 'новая карта';
        case 'remove':
            // Выбор карты откладывается: игрок должен видеть колоду, а не гадать.
            run.pending = { t: 'remove' };
            return 'выбросить карту';
        case 'fight':
            startBattle(run, NODE_ELITE);
            return 'бой';
        case 'gamble': {
            const win = rnd(run.rng) < g.v;
            for (const inner of (win ? g.win : g.lose)) applyGain(run, inner);
            return win ? 'повезло' : 'не повезло';
        }
        default:
            return null;
    }
}

/** Выбросить карту из колоды — закрывает отложенный выбор из события. */
export function removeCard(run, uid) {
    if (run.pending?.t !== 'remove') return { ok: false };
    // Колода не должна опустеть: пустая колода — это бой, в котором нечем ходить.
    if (run.deck.length <= 4) return { ok: false, reason: 'too_small' };
    const i = run.deck.findIndex(c => c.uid === uid);
    if (i < 0) return { ok: false };
    run.deck.splice(i, 1);
    run.pending = null;
    finishNode(run);
    return { ok: true };
}

// ── Тексты карт ──────────────────────────────────────────────────────────────
// Описание карты СОБИРАЕТСЯ из её эффектов, а не пишется рядом с ними: карта с
// уровнем 4 и мутацией «Зачин» должна показывать те числа, которые реально
// прилетят, а написанный от руки текст разошёлся бы с ними в первый же апгрейд.

export function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
}

function effectText(card, e) {
    const lvl = card.lvl;
    const when = e.when ? `, ${CONDITIONS[e.when].text}` : '';
    switch (e.t) {
        case DAMAGE: {
            const n = scaleValue(e.v, lvl);
            const times = e.times || 1;
            if (e.per) return `Ещё ${n} урона за каждую карту, сработавшую до неё в этом ходу${when}.`;
            if (times > 1) return `Наносит ${n} урона ${times} ${plural(times, 'раз', 'раза', 'раз')}${when}.`;
            // Условный урон — это ПРИБАВКА к безусловному, и написан он должен
            // быть прибавкой: «Наносит 7 урона. Наносит 7 урона, если это первая
            // карта» читается как «в любом случае 7», хотя карта бьёт на 14.
            return e.when ? `Ещё ${n} урона${when}.` : `Наносит ${n} урона.`;
        }
        case BLOCK:  return e.when
            ? `Ещё ${scaleValue(e.v, lvl)} блока${when}.`
            : `Даёт ${scaleValue(e.v, lvl)} блока.`;
        case HEAL:   return e.when
            ? `Лечит ещё на ${scaleValue(e.v, lvl)}${when}.`
            : `Лечит на ${scaleValue(e.v, lvl)}.`;
        case DRAW:   return `Тянет ${e.v} ${plural(e.v, 'карту', 'карты', 'карт')}${when}.`;
        case ENERGY: return `Даёт ${e.v} ${plural(e.v, 'энергию', 'энергии', 'энергии')}${when}.`;
        case STATUS: {
            const name = STATUS_INFO[e.s].gen;
            const v = scaleValue(e.v, lvl);
            return e.to === 'self' ? `Даёт себе ${v} ${name}${when}.` : `Накладывает ${v} ${name}${when}.`;
        }
        case UPGRADE: return 'Улучшает случайную карту в руке на уровень — навсегда.';
        case DOUBLE:  return 'Следующая карта в этом ходу сработает дважды.';
        case AMPLIFY: return 'Удваивает яд, который уже висит на враге.';
        case RULE:
            if (e.r === 'ward') return `В начале каждого хода даёт ${e.v} брони.`;
            if (e.r === 'energy') {
                return `До конца боя каждый ход даёт на ${e.v} ${plural(e.v, 'энергию', 'энергии', 'энергии')} больше.`;
            }
            if (e.r === 'mirror') {
                return e.v > 1
                    ? `До конца боя первые ${e.v} карты каждого хода срабатывают дважды.`
                    : 'До конца боя первая карта каждого хода срабатывает дважды.';
            }
            return '';
        default:      return '';
    }
}

/**
 * Полное описание карты.
 *
 * skipMain убирает из текста эффект, который И ТАК стоит в шаре нарисованной
 * карточки: «Удар» с семёркой в шаре не должен ещё раз писать «Наносит 7
 * урона» — в карточных играх число на карте не дублируют текстом, а свиток
 * описания у рамки маленький, и каждая лишняя строка выдавливает нужную.
 */
export function cardText(card, { skipMain = false } = {}) {
    const def = CARD_BY_ID[card.id];
    // Умолчать про эффект можно, только если шар рассказывает о нём ВСЁ:
    // многоударная атака числом в шаре не описывается (см. mainNumber).
    const m = skipMain ? mainNumber(card) : null;
    const main = m?.plain ? m.e : null;
    const parts = def.effects.filter(e => e !== main).map(e => effectText(card, e)).filter(Boolean);
    if (def.bounce) parts.push('Вернётся в руку в начале следующего хода.');
    if (def.exhaust) parts.push('Уходит из боя.');
    return parts.join(' ');
}

/** Мутации карты списком — окно рисует их отдельными значками. */
export function mutationList(card) {
    return Object.entries(card.mut || {}).map(([id, stacks]) => {
        const def = MUTATION_BY_ID[id];
        const power = mutPower(id, stacks);
        // mult отдаём наружу, чтобы окно не гадало, писать «×4» или «+4»: это
        // свойство самой мутации, и знать его должен контент, а не вёрстка.
        return { id, name: def.name, stacks, power, mult: !!def.mult, text: def.text(power) };
    });
}

/**
 * «Главное число» карты — то, что стоит в шаре на нарисованной карточке.
 *
 * ШАР БЫВАЕТ ТОЛЬКО У АТАК, и это не оформление, а правило. Шар нарисован на
 * рамке оружия и означает ровно одно — урон; у умения рамка заклинания, шара на
 * ней нет вовсе, и блок, положенный на её место, читается как «столько эта
 * карта бьёт». Всё, что делает умение, живёт в описании.
 *
 * Берётся первый БЕЗУСЛОВНЫЙ урон: у «Засады» на шаре её базовые 7, а прибавка
 * «если это первая карта в ходу» — в описании, ей на шаре не место.
 */
function mainNumber(card) {
    const def = CARD_BY_ID[card.id];
    if (def.kind !== ATTACK) return null;
    // Эффект «за каждую…» в шар не идёт: там стоит число, а не формула.
    const e = def.effects.find(x => !x.when && !x.per && x.t === DAMAGE);
    if (!e) return null;
    // plain — исчерпывается ли карта этим числом. У «Череды» нет: она бьёт 4
    // урона ДВА РАЗА, и одна четвёрка в шаре означала бы совсем другую карту.
    return { t: 'dmg', v: scaleValue(e.v, card.lvl), e, plain: !(e.times > 1) };
}

/** Всё, что окну нужно про карту: числа уже посчитаны. */
export function cardView(run, card) {
    const def = CARD_BY_ID[card.id];
    return {
        uid: card.uid,
        id: card.id,
        name: def.name,
        kind: def.kind,
        rarity: def.rarity,
        cost: run?.battle ? costOf(run, card) : def.cost,
        baseCost: def.cost,
        lvl: card.lvl,
        canLevel: canLevel(card),
        text: cardText(card),
        artText: cardText(card, { skipMain: true }),
        power: mainNumber(card) && { t: 'dmg', v: mainNumber(card).v },
        muts: mutationList(card),
    };
}

/** Описание врага для окна: имя, модификаторы и их пояснения. */
export function enemyView(run) {
    const b = run.battle;
    if (!b) return null;
    const e = b.enemy;
    return {
        name: e.name,
        id: e.id,
        kind: e.kind,
        hp: e.hp, maxHp: e.maxHp, block: e.block, st: e.st,
        mods: e.mods.map(id => ({ id, name: MUTATOR_BY_ID[id].name, hint: MUTATOR_BY_ID[id].hint })),
    };
}

// ── Итог забега ──────────────────────────────────────────────────────────────

export function runResult(run) {
    let level = 1, mutations = 0;
    for (const c of run.deck) {
        if (c.lvl > level) level = c.lvl;
        for (const s of Object.values(c.mut || {})) mutations += s;
    }
    return {
        loops: run.stats.loops,
        floor: run.stats.nodes,
        kills: run.stats.kills,
        elites: run.stats.elites,
        bosses: run.stats.bosses,
        turns: run.stats.turns,
        cards: run.deck.length,
        level,
        mutations,
        seconds: Math.round(run.ms / 1000),
    };
}

// Потолки правдоподобности. Считаются от устройства игры, а не «на глаз»:
// узел даёт максимум один камень (событие — два), бой — минимум один ход, цикл —
// ровно MAP_ROWS узлов.
const MAX_LOOPS = 500;
const MIN_MS_PER_TURN = 400;   // быстрее живой человек карты не кликает

/**
 * Похож ли присланный результат на настоящий забег.
 *
 * Это защита от мусора и от «сто циклов за минуту», а не от человека с открытой
 * консолью: забег считается в браузере, и большего мини-топ пасхалки не стоит.
 */
export function isPlausibleRun(res) {
    const nums = ['loops', 'floor', 'kills', 'turns', 'cards', 'level', 'seconds'].map(k => Number(res?.[k]));
    if (!nums.every(v => Number.isInteger(v) && v >= 0)) return { ok: false, reason: 'shape' };
    const { loops, floor, kills, turns, cards, level, seconds } = res;

    if (loops > MAX_LOOPS) return { ok: false, reason: 'too_many_loops' };
    // Цикл — это ровно MAP_ROWS узлов, пройденных подряд, и не больше.
    if (floor < loops * MAP_ROWS) return { ok: false, reason: 'floor_vs_loops' };
    if (floor > (loops + 1) * MAP_ROWS) return { ok: false, reason: 'floor_too_high' };
    // Бой бывает не в каждом узле, но узлов не бывает меньше, чем боёв.
    if (kills > floor) return { ok: false, reason: 'kills_vs_floor' };
    // Врага нельзя убить, не сделав хода.
    if (turns < kills) return { ok: false, reason: 'turns_vs_kills' };
    if (seconds * 1000 < turns * MIN_MS_PER_TURN) return { ok: false, reason: 'too_fast' };
    if (seconds > 24 * 3600) return { ok: false, reason: 'too_long' };
    // Колода: стартовые десять плюс не больше карты за узел.
    if (cards > START_DECK.length + floor) return { ok: false, reason: 'cards_vs_floor' };
    if (cards < 1) return { ok: false, reason: 'no_deck' };
    // Уровень карты: каждый узел даёт максимум один камень, событие — два.
    if (level > 1 + floor * 2) return { ok: false, reason: 'level_too_high' };
    return { ok: true };
}
