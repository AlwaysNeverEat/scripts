// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Гео» — правила: очки за угадывание, дуэль на здоровье, режимы.
//
// Общее для сервера и браузера, как у остальных игр. Но роли тут не такие, как
// в тетрисе: СЧИТАЕТ ВСЁ СЕРВЕР, и не потому, что дуэль парная, а потому что
// правильный ответ — это координата, и она же секрет. Отдай её браузеру ради
// подсчёта очков — и игра кончится: расстояние до точки, которую тебе уже
// сказали, считать незачем. Поэтому наружу уезжает id снимка, а лат/лон
// загаданного места живёт на сервере до конца раунда.
//
// Полностью спрятать место всё равно нельзя: снимок рисуется в том же браузере,
// и человек с открытой консолью вытащит из него координату. Это ровно та же
// цена, что у остальных пасхалок (см. шапку shared/tetris.js): защита от мусора
// и от случайного дубля, а не от того, кто специально сел ломать свой мини-топ.
//
// ОЧКИ. Формула оригинала: пять тысяч, умноженные на экспоненту от расстояния,
// поделённого на размер карты. Карта у нас всегда мир, поэтому знаменатель
// один и зашит числом. Что важно в ней сохранить: у неё нет «зоны нуля» —
// промах через полмира даёт не 0, а несколько очков, и это заметно в дуэли,
// где считается РАЗНИЦА. Ноль получает только тот, кто вообще не ткнул.
// ─────────────────────────────────────────────────────────────────────────────

// Потолок за раунд — во всех режимах одинаковый.
export const MAX_SCORE = 5000;

// Ближе этого — сразу максимум. Снимок сделан с проезжающей камеры, и «ткнул
// точно в точку съёмки» на карте мира неотличимо от «ткнул в тот же перекрёсток».
const PERFECT_KM = 0.025;

// Знаменатель экспоненты: десятая часть диагонали мировой карты в километрах
// (14916.862 / 10). Отсюда привычные ориентиры — 1 км это ~4997 очков,
// 100 км ~4675, 1000 км ~2565, 5000 км ~172.
const WORLD_SCALE_KM = 1491.6862;

const EARTH_R_KM = 6371.0088;
const rad = (deg) => (deg * Math.PI) / 180;

/** Расстояние по большому кругу, км. */
export function haversineKm(a, b) {
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2
        + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Очки за раунд по расстоянию (0…5000). */
export function roundScore(distanceKm) {
    if (!Number.isFinite(distanceKm) || distanceKm < 0) return 0;
    if (distanceKm <= PERFECT_KM) return MAX_SCORE;
    return Math.round(MAX_SCORE * Math.exp(-distanceKm / WORLD_SCALE_KM));
}

/** Очки за ткнутую точку. null (не ткнул вовсе) — ноль. */
export function scoreGuess(target, guess) {
    if (!isGuess(guess)) return { score: 0, distance_km: null };
    const distance = haversineKm(target, guess);
    return { score: roundScore(distance), distance_km: Math.round(distance * 10) / 10 };
}

/** Похоже ли это на точку на карте. Кривые числа — не «0 очков», а отказ. */
export function isGuess(g) {
    return !!g
        && Number.isFinite(g.lat) && Number.isFinite(g.lng)
        && g.lat >= -90 && g.lat <= 90
        && g.lng >= -180 && g.lng <= 180;
}

// ── Соло ─────────────────────────────────────────────────────────────────────

// Пять точек за партию — как просили. Сумма и идёт в топ.
export const SOLO_ROUNDS = 5;
export const SOLO_MAX = SOLO_ROUNDS * MAX_SCORE;

// ── Дуэль ────────────────────────────────────────────────────────────────────

export const DUEL_HP = 6000;

// Победа плюс двадцать пять, поражение минус двадцать пять. Ничья не двигает
// ничего: она бывает только когда оба бросили партию.
export const DUEL_WIN_PTS = 25;

// Режимы передвижения. nomove — ходить нельзя, крутиться и зумить можно;
// nmpz — нельзя ничего, кроме как смотреть в одну сторону.
export const DUEL_MODES = ['move', 'nomove', 'nmpz'];
export const DUEL_MODE_NAMES = {
    move: 'Обычный',
    nomove: 'Без ходьбы',
    nmpz: 'NMPZ',
};

// Сколько даётся на раунд. В правилах, которые просили, таймера нет вовсе — но
// без него дуэль встаёт навсегда, как только один закрыл вкладку: второй сидит
// перед снимком и не может ни доиграть, ни выйти с победой. Две минуты — это
// «посмотреть по сторонам и подумать», а не «поискать в интернете».
export const DUEL_ROUND_SECONDS = 120;

// Сколько показываем итог раунда, прежде чем ехать дальше. Дальше можно и
// раньше — кнопкой, когда оба нажали.
export const DUEL_REVEAL_SECONDS = 12;

// Пропущенных подряд раундов, после которых засчитывается поражение. Один
// пропуск — «отвлекли»; два подряд означают, что человека нет.
export const DUEL_FORFEIT_MISSES = 2;

// Потолок раундов. При одинаковой игре двоих урон каждый раунд крошечный, и
// без потолка партия шла бы часами. С множителем, который растёт каждые два
// раунда, до двадцатого не доживает ни одна честная дуэль — это страховка, а
// не игровое правило.
export const DUEL_MAX_ROUNDS = 20;

/**
 * Множитель урона в раунде (раунды считаются с единицы).
 *
 * Как просили: на втором раунде 1.5, на четвёртом 2, дальше по 0.5 за каждые
 * два раунда. То есть множитель меняется на ЧЁТНЫХ раундах и держится до
 * следующего чётного.
 */
export function multiplierFor(round) {
    return 1 + 0.5 * Math.floor(round / 2);
}

/** Новая дуэль. Точку раунда сюда кладёт сервер — правила её не выбирают. */
export function createDuel({ mode = 'move' } = {}) {
    return {
        mode: DUEL_MODES.includes(mode) ? mode : 'move',
        round: 0,
        hp: [DUEL_HP, DUEL_HP],
        misses: [0, 0],
        // ready — ждём начала раунда, play — смотрят и тыкают, reveal —
        // показываем итог, over — доиграли.
        phase: 'ready',
        point: null,        // { lat, lng, pano, label } — тайна до конца раунда
        guesses: [null, null],
        seen: [false, false],
        deadline: 0,        // мс, до которого принимаем догадки
        reveal_at: 0,
        history: [],
        winner: null,       // 0 | 1 | null (ничья)
        reason: '',
    };
}

/** Начать раунд с этой точкой. */
export function startRound(duel, point, now = Date.now()) {
    duel.round += 1;
    duel.point = point;
    duel.guesses = [null, null];
    duel.seen = [false, false];
    duel.deadline = now + DUEL_ROUND_SECONDS * 1000;
    duel.phase = 'play';
    return duel;
}

/**
 * Принять догадку.
 *
 * Небольшой запас после дедлайна — сознательный: между «нажал» и «дошло до
 * сервера» лежит сеть, и терять из-за неё раунд человек не должен. Сервер всё
 * равно закрывает раунд только когда сам увидит просроченный дедлайн.
 */
const SUBMIT_GRACE_MS = 3000;

export function submitGuess(duel, seat, guess, now = Date.now()) {
    if (duel.phase !== 'play') return { ok: false, reason: 'not_playing' };
    if (seat !== 0 && seat !== 1) return { ok: false, reason: 'not_playing' };
    if (duel.guesses[seat]) return { ok: false, reason: 'already' };
    if (!isGuess(guess)) return { ok: false, reason: 'bad_guess' };
    if (now > duel.deadline + SUBMIT_GRACE_MS) return { ok: false, reason: 'too_late' };
    duel.guesses[seat] = { lat: guess.lat, lng: guess.lng, at: now };
    return { ok: true };
}

/**
 * Закрыть раунд, если он уже закрыт по сути: оба ткнули или вышло время.
 *
 * Вызывается на любом обращении к партии, в том числе на опросе «сходил ли
 * соперник» — отдельного будильника у пасхалки нет и не надо.
 */
export function resolveRound(duel, now = Date.now()) {
    if (duel.phase !== 'play') return false;
    const both = duel.guesses[0] && duel.guesses[1];
    if (!both && now <= duel.deadline) return false;

    const results = [0, 1].map(seat => scoreGuess(duel.point, duel.guesses[seat]));
    for (const seat of [0, 1]) {
        duel.misses[seat] = duel.guesses[seat] ? 0 : duel.misses[seat] + 1;
    }

    const mult = multiplierFor(duel.round);
    const diff = Math.abs(results[0].score - results[1].score);
    const damage = Math.round(diff * mult);
    // Кому прилетело: тому, кто набрал меньше. При равенстве — никому.
    const hit = results[0].score === results[1].score ? -1 : (results[0].score > results[1].score ? 1 : 0);
    if (hit >= 0) duel.hp[hit] = Math.max(0, duel.hp[hit] - damage);

    duel.history.push({
        round: duel.round,
        mult,
        point: duel.point,
        scores: [results[0].score, results[1].score],
        distances: [results[0].distance_km, results[1].distance_km],
        guesses: [duel.guesses[0], duel.guesses[1]],
        damage: hit >= 0 ? damage : 0,
        hit,
        hp: [duel.hp[0], duel.hp[1]],
    });

    duel.phase = 'reveal';
    duel.reveal_at = now;
    finishIfOver(duel);
    return true;
}

/** Проверить условия конца партии после закрытого раунда. */
function finishIfOver(duel) {
    // Здоровье кончилось — это главный и обычный конец.
    if (duel.hp[0] <= 0 || duel.hp[1] <= 0) {
        return end(duel, duel.hp[0] <= 0 ? 1 : 0, 'hp');
    }
    // Оба перестали играть: партии нет, и победителя в ней нет тоже.
    const gone = [0, 1].filter(s => duel.misses[s] >= DUEL_FORFEIT_MISSES);
    if (gone.length === 2) return end(duel, null, 'abandoned');
    if (gone.length === 1) return end(duel, 1 - gone[0], 'afk');
    // Потолок раундов: побеждает тот, у кого больше здоровья.
    if (duel.round >= DUEL_MAX_ROUNDS) {
        if (duel.hp[0] === duel.hp[1]) return end(duel, null, 'draw');
        return end(duel, duel.hp[0] > duel.hp[1] ? 0 : 1, 'rounds');
    }
    return false;
}

function end(duel, winner, reason) {
    duel.phase = 'over';
    duel.winner = winner;
    duel.reason = reason;
    return true;
}

/** Игрок посмотрел итог и готов дальше. */
export function markSeen(duel, seat) {
    if (duel.phase !== 'reveal') return false;
    duel.seen[seat] = true;
    return true;
}

/** Пора ли начинать следующий раунд. */
export function canAdvance(duel, now = Date.now()) {
    if (duel.phase !== 'reveal') return false;
    if (duel.seen[0] && duel.seen[1]) return true;
    return now >= duel.reveal_at + DUEL_REVEAL_SECONDS * 1000;
}

/** Сдаться. Единственный способ выйти из дуэли, не доигрывая. */
export function resignDuel(duel, seat) {
    if (duel.phase === 'over') return false;
    return end(duel, 1 - seat, 'resign');
}

// ── Проверка присланного результата ──────────────────────────────────────────

/**
 * Правдоподобна ли соло-партия. Считает её сервер, поэтому проверять по сути
 * нечего — это защита от кривой строки в базе, если раунды сложились неверно.
 */
export function isPlausibleRun(run) {
    if (!Number.isInteger(run?.score) || run.score < 0 || run.score > SOLO_MAX) {
        return { ok: false, reason: 'score' };
    }
    if (!Number.isInteger(run?.rounds) || run.rounds !== SOLO_ROUNDS) {
        return { ok: false, reason: 'rounds' };
    }
    return { ok: true };
}
