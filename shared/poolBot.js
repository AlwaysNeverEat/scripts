// ─────────────────────────────────────────────────────────────────────────────
// Соперник-бот для пасхалки «Бильярд».
//
// Считает удар ТЕМ ЖЕ движком, которым партия и играется (shared/pool.js): берёт
// копию позиции, бьёт по ней и смотрит, что получилось. Поэтому бот не может
// «знать» больше игрока и не может смухлевать — у него ровно тот же стол и те же
// правила, отличается только количество проверенных вариантов.
//
// ПОЧЕМУ ПЕРЕБОРОМ, А НЕ ГЕОМЕТРИЕЙ. Классический бильярдный бот считает точку
// прицеливания формулой и бьёт. Такой соперник умеет закатывать шар, но не умеет
// ИГРАТЬ: он не видит, что биток после удара встанет вплотную к борту и следующий
// ход будет мучением, не видит, что заодно свалится чужой шар. Расчёт удара стоит
// пару миллисекунд, вариантов набирается несколько десятков — дешевле посмотреть,
// чем угадывать.
//
// Геометрия всё же нужна, но только чтобы НЕ СЧИТАТЬ заведомую ерунду: перебирать
// удары во все стороны подряд — это тысячи расчётов, из которых осмысленны
// единицы. Поэтому кандидаты рождаются осмысленными (свой шар × луза), а полный
// расчёт достаётся тем, кто прошёл проверку «а вообще-то так можно попасть».
//
// СЛОЖНОСТЬ — ЭТО ДРОЖЬ РУКИ, А НЕ ГЛУПОСТЬ. Бот всегда выбирает лучший из
// найденных ударов, а слабый просто хуже его исполняет: направление уводится на
// случайный угол (см. AIM_ERROR). Так проигрыш лёгкому боту выглядит как «он
// промазал», а не как «он зачем-то бил в другую сторону», — и это единственный
// вид поддавков, который не оскорбителен.
//
// Здесь МОЖНО пользоваться Math.sin/cos и случайными числами — в отличие от ядра
// физики (см. шапку shared/pool.js). Бот не считает партию, он лишь ПРИДУМЫВАЕТ
// удар, а дальше этот удар — обычные целые числа, такие же, как от человека.
// ─────────────────────────────────────────────────────────────────────────────

import {
    cloneGame, shoot, settle, legalTargets, canPlaceCue, aimCast, remaining, groupOf,
    ballById, powerForDistance, POCKETS, BALL_R, TABLE_W, TABLE_H, HEAD_X,
    CUE, EIGHT, DIR_SCALE, POS_SCALE, POWER_MAX,
} from './pool.js';

export const EASY = 'easy';
export const NORMAL = 'normal';
export const HARD = 'hard';

export const LEVELS = [
    { id: EASY, name: 'Новичок' },
    { id: NORMAL, name: 'Любитель' },
    { id: HARD, name: 'Катала' },
];

// Дрожь руки в радианах. Полградуса у сильного — это промах в четверть шара с
// другого конца стола: он ошибается редко и на длинных ударах, как человек.
// Два с половиной у слабого — он забивает только то, что стоит у лузы.
const AIM_ERROR = {
    [EASY]: 0.044,
    [NORMAL]: 0.020,
    [HARD]: 0.008,
};

// Сколько ударов бот вообще досчитывает. Потолок нужен не ради скорости (удар —
// две миллисекунды), а ради отзывчивости: полсекунды раздумий читаются как
// «думает», три секунды — как «зависло».
const MAX_SIMS = 90;

// Слишком тонкий срез не забивают и люди: если резать больше семидесяти
// градусов, попадание становится лотереей, а бот не должен на неё рассчитывать.
const MIN_CUT = 0.34;   // косинус угла между «куда бить» и «куда пойдёт шар»

// ── Выбор удара ──────────────────────────────────────────────────────────────

/**
 * Придумать удар за игрока `player`. Возвращает { dx, dy, power, cx, cy } —
 * такой же удар, какой присылает окно, и уезжает он тем же путём.
 *
 * rng — источник случайности (по умолчанию Math.random), отдельным параметром
 * ради тестов: бот без дрожи должен вести себя предсказуемо.
 */
export function pickShot(game, { level = NORMAL, rng = Math.random } = {}) {
    // Разбой — отдельный случай: целиться не во что, пирамида стоит одна.
    if (!game.broke) return breakShot(game, rng);

    const candidates = generate(game, game.turn);
    let best = null;

    for (const cand of candidates.slice(0, MAX_SIMS)) {
        const copy = cloneGame(game);
        if (!shoot(copy, cand.shot).ok) continue;
        const outcome = settle(copy);
        const score = judge(copy, outcome, game.turn) + cand.bonus;
        if (!best || score > best.score) best = { shot: cand.shot, score };
    }

    // Ни один осмысленный удар не прошёл — значит, всё заставлено. Тогда задача
    // меняется: не забить, а не отдать сопернику руку (см. safety).
    if (!best) best = safety(game, rng);

    return shake(best.shot, AIM_ERROR[level] ?? AIM_ERROR[NORMAL], rng);
}

/**
 * Кандидаты «свой шар → луза», от самых перспективных к прочим.
 *
 * Тяжёлый расчёт здесь не делается вовсе: только геометрия, которая отсекает
 * удары, невозможные в принципе, — шар за чужой спиной, срез в девяносто
 * градусов, перекрытый путь до лузы.
 */
function generate(game, player) {
    const cue = ballById(game, CUE);
    const targets = legalTargets(game, player);
    const out = [];

    for (const id of targets) {
        const ball = ballById(game, id);
        for (const pocket of POCKETS) {
            // Куда шар должен уехать и где ради этого обязан оказаться биток:
            // «шар-призрак» — центр битка в момент касания.
            let ux = pocket.x - ball.x;
            let uy = pocket.y - ball.y;
            const toPocket = Math.sqrt(ux * ux + uy * uy);
            if (toPocket < 0.001) continue;
            ux /= toPocket;
            uy /= toPocket;

            const ghostX = ball.x - ux * BALL_R * 2;
            const ghostY = ball.y - uy * BALL_R * 2;

            // Рука: биток можно поставить самому — ставим на прямой удар, это
            // сильнейшее, что вообще даёт фол соперника.
            const places = game.ballInHand ? placements(game, ghostX, ghostY, ux, uy) : [null];

            for (const place of places) {
                const fromX = place ? place.x : cue.x;
                const fromY = place ? place.y : cue.y;

                let ax = ghostX - fromX;
                let ay = ghostY - fromY;
                const dist = Math.sqrt(ax * ax + ay * ay);
                if (dist < 0.001) continue;
                ax /= dist;
                ay /= dist;

                // Срез: насколько «вбок» приходится бить. Косинус около единицы —
                // прямой удар, около нуля — почти по касательной.
                const cut = ax * ux + ay * uy;
                if (cut < MIN_CUT) continue;

                // Путь битка до прицельного шара и путь шара до лузы должны быть
                // свободны. Иначе удар выглядит идеальным на бумаге и утыкается в
                // чужой шар на столе.
                if (!clearToBall(game, fromX, fromY, ax, ay, id)) continue;
                if (!clearPath(game, ball.x, ball.y, pocket.x, pocket.y, id)) continue;

                // Сила: доехать до лузы с запасом. Дальний шар и тонкий срез
                // требуют больше — при срезе прицельному достаётся лишь часть
                // скорости битка.
                const need = (dist + toPocket) / cut;
                for (const k of [0.85, 1.15, 1.6]) {
                    out.push({
                        shot: {
                            ...dirToShot(ax, ay),
                            power: powerForDistance(need * k),
                            ...(place ? { cx: Math.round(place.x * POS_SCALE), cy: Math.round(place.y * POS_SCALE) } : {}),
                        },
                        // Прямые и близкие удары стоит проверять первыми: если
                        // упрёмся в потолок расчётов, отброшены будут сомнительные.
                        bonus: cut * 12 - dist * 0.05,
                    });
                }
            }
        }
    }

    out.sort((a, b) => b.bonus - a.bonus);
    return out;
}

/** Куда поставить биток для прямого удара по этому «призраку». */
function placements(game, ghostX, ghostY, ux, uy) {
    const out = [];
    // Отходим назад по линии удара: ближе — точнее, дальше — можно взять разгон.
    for (const back of [14, 26]) {
        const x = ghostX - ux * back;
        const y = ghostY - uy * back;
        if (canPlaceCue(game, x, y)) out.push({ x, y });
    }
    return out;
}

/** Первым на пути битка должен оказаться именно тот шар, в который целимся. */
function clearToBall(game, fromX, fromY, dirX, dirY, id) {
    const hit = aimCast(game, fromX, fromY, dirX, dirY);
    return !!hit && hit.id === id;
}

/** Никто не стоит на отрезке между шаром и лузой. */
function clearPath(game, fromX, fromY, toX, toY, ignoreId) {
    let dx = toX - fromX;
    let dy = toY - fromY;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return true;
    dx /= len;
    dy /= len;

    for (const b of game.balls) {
        if (b.in || b.id === ignoreId || b.id === CUE) continue;
        const ox = b.x - fromX;
        const oy = b.y - fromY;
        const along = ox * dx + oy * dy;
        if (along <= 0 || along >= len) continue;
        const perp = Math.abs(ox * dy - oy * dx);
        if (perp < BALL_R * 2) return false;
    }
    return true;
}

// ── Оценка получившейся позиции ──────────────────────────────────────────────

/**
 * Насколько удар хорош — с точки зрения игрока `me`.
 *
 * Порядок величин важнее самих чисел: победа перевешивает всё, поражение
 * отбрасывается всегда, фол дороже любого забитого шара. Тонкая настройка «на
 * пол-очка» тут бессмысленна — соперник живой человек, а не другой бот.
 */
function judge(game, outcome, me) {
    if (!outcome) return -1e6;
    if (outcome.winner === me) return 1e6;
    if (outcome.winner != null) return -1e6;

    let score = 0;
    const group = game.groups[me];

    for (const id of outcome.potted) {
        if (id === EIGHT) continue;
        score += groupOf(id) === group ? 120 : -60;   // чужой шар помогает сопернику
    }
    if (outcome.foul) score -= 400;
    if (outcome.continues) score += 60;

    // Позиция для следующего удара — только если он мой. Считаем грубо: есть ли
    // вообще откуда бить. Полный перебор за себя же удвоил бы стоимость хода
    // ради выигрыша, которого на этом уровне никто не заметит.
    if (outcome.continues) {
        score += Math.min(3, generate(game, me).length) * 15;
    } else if (group != null && remaining(game, group) === 0) {
        // Своё разобрано, а восьмёрка осталась сопернику на блюде — это хорошо
        // только если ход всё-таки наш; иначе разницы нет.
        score += 10;
    }
    return score;
}

// ── Когда бить некуда ────────────────────────────────────────────────────────

/**
 * Отбойный удар. Забить нечего — задача не отдать фол: коснуться своего шара и
 * довести хоть кого-то до борта. Перебираем направления по кругу и берём то,
 * которое движок не назвал фолом.
 *
 * Направления считаются через sin/cos — здесь это можно, см. шапку.
 */
function safety(game, rng) {
    const cue = ballById(game, CUE);
    const start = rng() * Math.PI * 2;
    let best = null;

    const STEPS = 36;
    for (let i = 0; i < STEPS; i++) {
        const a = start + (i / STEPS) * Math.PI * 2;
        const shot = { ...dirToShot(Math.cos(a), Math.sin(a)), power: 260 };
        if (game.ballInHand) {
            // Руку тратим на самое безопасное: середина стола, откуда видно
            // больше всего.
            const spot = freeSpot(game);
            if (!spot) continue;
            shot.cx = Math.round(spot.x * POS_SCALE);
            shot.cy = Math.round(spot.y * POS_SCALE);
        }
        const copy = cloneGame(game);
        if (!shoot(copy, shot).ok) continue;
        const outcome = settle(copy);
        const score = judge(copy, outcome, game.turn);
        if (!best || score > best.score) best = { shot, score };
        // Нашли удар без фола — дальше искать незачем, это уже успех.
        if (outcome && !outcome.foul && outcome.winner == null) break;
    }

    // Совсем ничего не нашлось (так бывает, если стол пуст в тесте) — бьём
    // вперёд вполсилы: пусть движок сам решает, что это было.
    return best || { shot: { dx: DIR_SCALE, dy: 0, power: 300 }, score: 0 };
}

/** Свободное место под биток — от середины стола наружу. */
function freeSpot(game) {
    for (let r = 0; r < 40; r += 4) {
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const x = TABLE_W / 2 + Math.cos(a) * r;
            const y = TABLE_H / 2 + Math.sin(a) * r;
            if (canPlaceCue(game, x, y)) return { x, y };
        }
    }
    return null;
}

// ── Разбой ───────────────────────────────────────────────────────────────────

function breakShot(game, rng) {
    // Из дома чуть в стороне от центра: удар точно в лоб пирамиды раскатывает её
    // хуже, чем слегка боковой, — и партии перестают быть похожими одна на другую.
    const y = TABLE_H / 2 + (rng() - 0.5) * 8;
    const x = HEAD_X - 6;
    const spot = canPlaceCue(game, x, y) ? { x, y } : freeSpot(game);
    const apex = ballById(game, EIGHT);   // не важно, какой шар — целимся в пирамиду
    const dx = (apex ? apex.x : TABLE_W * 0.75) - spot.x;
    const dy = (apex ? apex.y : TABLE_H / 2) - spot.y;
    return {
        ...dirToShot(dx, dy),
        power: POWER_MAX,
        cx: Math.round(spot.x * POS_SCALE),
        cy: Math.round(spot.y * POS_SCALE),
    };
}

// ── Мелочи ───────────────────────────────────────────────────────────────────

/** Направление в целые числа удара. */
function dirToShot(dx, dy) {
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return {
        dx: Math.round((dx / len) * DIR_SCALE),
        dy: Math.round((dy / len) * DIR_SCALE),
    };
}

/** Дрожь руки: увести направление на случайный угол. */
function shake(shot, error, rng) {
    if (!error) return shot;
    // Нормальное-ish распределение из двух равномерных: чаще почти точно, изредка
    // заметно мимо. Одно равномерное давало бы ровный «шум» без узнаваемого
    // человеческого «обычно попадает, иногда срывается».
    const a = ((rng() + rng()) - 1) * error;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return {
        ...shot,
        dx: Math.round(shot.dx * cos - shot.dy * sin),
        dy: Math.round(shot.dx * sin + shot.dy * cos),
    };
}
