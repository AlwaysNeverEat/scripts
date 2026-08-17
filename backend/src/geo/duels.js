// Режим «Дуэль»: одна точка на двоих, по 6000 здоровья, разница очков — урон.
//
// СЕРВЕР ЗДЕСЬ АРБИТР — по той же причине, что и в бильярде: очко, приписанное
// себе, отнято у живого человека. Но есть и вторая, своя: правильный ответ —
// это координата, и она обязана лежать там, куда браузер не дотянется. Поэтому
// наружу из состояния партии уезжает id панорамы и НИЧЕГО про место, а догадка
// соперника до конца раунда видна только как «уже ответил».
//
// Время партии двигается ЛЕНИВО, на любом обращении к ней: раунд закрывается,
// когда оба ответили или вышел срок, следующий начинается, когда оба посмотрели
// итог или прошли двенадцать секунд. Отдельного будильника у пасхалки нет и не
// надо — партию всё равно опрашивают обе стороны раз в полторы секунды.
//
// Гонку двух опросов (оба клиента разом решили, что раунд пора закрывать)
// снимает тот же приём, что в бильярде: UPDATE с условием на seq. Кто успел —
// тот и записал, второй перечитает партию и увидит уже закрытый раунд.

import { query } from '../db/client.js';
import {
    createDuel, startRound, submitGuess, resolveRound, canAdvance, markSeen,
    resignDuel, multiplierFor, DUEL_MODES, DUEL_HP, DUEL_WIN_PTS,
} from '../../../shared/geo.js';
import { nextPoint } from './panoramas.js';
import { addDuelResult } from './scores.js';

// Сколько открытых вызовов держит один человек. Без ограничения лобби
// превращается в стену вызовов одного скучающего.
const MAX_OPEN_PER_USER = 1;

const seatOf = (row, userId) => (row.p0 === userId ? 0 : row.p1 === userId ? 1 : -1);

const PLAYER_COLS = `
  u0.display_name AS p0_name, u0.avatar AS p0_avatar,
  u1.display_name AS p1_name, u1.avatar AS p1_avatar`;

const PLAYER_JOIN = `
  LEFT JOIN users u0 ON u0.id = g.p0
  LEFT JOIN users u1 ON u1.id = g.p1`;

/** Состояние партии глазами одного из игроков. Точка раунда сюда не попадает. */
function view(state, seat) {
    const opp = 1 - seat;
    const last = state.history[state.history.length - 1] || null;
    return {
        mode: state.mode,
        round: state.round,
        phase: state.phase,
        hp: state.hp,
        mult: multiplierFor(Math.max(1, state.round)),
        max_hp: DUEL_HP,
        // Панораму отдаём только пока раунд идёт: после него она уже в итоге.
        pano: state.phase === 'play' ? state.point?.pano || null : null,
        deadline: state.phase === 'play' ? state.deadline : 0,
        // Догадка соперника до конца раунда — только факт, без координат.
        answered: [!!state.guesses[0], !!state.guesses[1]],
        my_answer: state.guesses[seat] || null,
        seen: state.seen,
        waiting_for_me: state.phase === 'play' && !state.guesses[seat],
        waiting_for_opponent: state.phase === 'play' && !!state.guesses[seat] && !state.guesses[opp],
        last,
        rounds: state.history.map(h => ({ round: h.round, scores: h.scores, damage: h.damage, hit: h.hit })),
    };
}

function present(row, userId, { full = true } = {}) {
    const seat = seatOf(row, userId);
    const state = row.state;
    return {
        id: row.id,
        status: row.status,
        mode: row.mode,
        seat,
        seq: row.seq,
        players: [
            { id: row.p0, name: row.p0_name, avatar: row.p0_avatar },
            { id: row.p1, name: row.p1_name, avatar: row.p1_avatar },
        ],
        winner: row.winner ? (row.winner === row.p0 ? 0 : 1) : (row.status === 'done' ? null : undefined),
        reason: row.reason || '',
        created_at: row.created_at,
        // Часы клиента могут врать на минуты, а раунд идёт две: время до конца
        // раунда он считает от НАШЕГО now, а не от своего.
        now: Date.now(),
        ...(full ? { state: view(state, seat < 0 ? 0 : seat) } : {}),
    };
}

// ── Лобби ────────────────────────────────────────────────────────────────────

export async function lobby(userId) {
    const [open, mine] = await Promise.all([
        query(
            `SELECT g.*, ${PLAYER_COLS} FROM geo_duels g ${PLAYER_JOIN}
              WHERE g.status = 'open' ORDER BY g.created_at LIMIT 20`,
        ),
        query(
            `SELECT g.*, ${PLAYER_COLS} FROM geo_duels g ${PLAYER_JOIN}
              WHERE g.status = 'live' AND (g.p0 = $1 OR g.p1 = $1)
              ORDER BY g.moved_at DESC LIMIT 20`,
            [userId],
        ),
    ]);
    return {
        open: open.rows.map(r => present(r, userId, { full: false })),
        mine: mine.rows.map(r => present(r, userId, { full: false })),
    };
}

/** Бросить вызов: партия висит в лобби, пока её кто-нибудь не примет. */
export async function createChallenge(userId, mode) {
    if (!DUEL_MODES.includes(mode)) return { ok: false, reason: 'bad_mode' };
    const busy = await query(
        `SELECT count(*)::int AS n FROM geo_duels WHERE p0 = $1 AND status = 'open'`,
        [userId],
    );
    if (busy.rows[0].n >= MAX_OPEN_PER_USER) return { ok: false, reason: 'already_waiting' };

    const state = createDuel({ mode });
    const res = await query(
        `INSERT INTO geo_duels (p0, mode, status, state) VALUES ($1, $2, 'open', $3) RETURNING id`,
        [userId, mode, JSON.stringify(state)],
    );
    return { ok: true, id: res.rows[0].id };
}

/**
 * Принять вызов.
 *
 * Первую точку ищем ДО того, как посадить соперника за стол: справочник
 * панорам — сеть, он может не ответить, и лучше отказать на кнопке «принять»,
 * чем начать партию, в которой нечего показывать.
 */
export async function joinChallenge(duelId, userId) {
    const found = await query(`SELECT * FROM geo_duels WHERE id = $1`, [duelId]);
    const row = found.rows[0];
    if (!row || row.status !== 'open') return { ok: false, reason: 'gone' };
    if (row.p0 === userId) return { ok: false, reason: 'own' };

    const point = await nextPoint();
    if (!point) return { ok: false, reason: 'no_point' };

    const state = row.state;
    startRound(state, point);

    // Один UPDATE с проверками внутри: если вызов уже приняли, строк не будет,
    // и двое, нажавшие одновременно, не окажутся оба соперниками.
    const res = await query(
        `UPDATE geo_duels
            SET p1 = $2, status = 'live', state = $3, seq = seq + 1, moved_at = now()
          WHERE id = $1 AND status = 'open' AND p0 <> $2
        RETURNING id`,
        [duelId, userId, JSON.stringify(state)],
    );
    if (!res.rows.length) return { ok: false, reason: 'gone' };
    return { ok: true, id: duelId };
}

/** Снять свой вызов, пока его никто не принял. */
export async function cancelChallenge(duelId, userId) {
    const res = await query(
        `DELETE FROM geo_duels WHERE id = $1 AND p0 = $2 AND status = 'open' RETURNING id`,
        [duelId, userId],
    );
    return { ok: !!res.rows.length };
}

// ── Партия ───────────────────────────────────────────────────────────────────

async function fetchRow(duelId) {
    const res = await query(
        `SELECT g.*, ${PLAYER_COLS} FROM geo_duels g ${PLAYER_JOIN} WHERE g.id = $1`,
        [duelId],
    );
    return res.rows[0] || null;
}

async function load(duelId, userId) {
    const row = await fetchRow(duelId);
    if (!row) return null;
    // За чужую дуэль не пускаем даже посмотреть: зритель, знающий ответ, тут
    // лишний — он сидит рядом и подсказывает.
    if (seatOf(row, userId) < 0) return null;
    return row;
}

/**
 * Записать сдвинувшееся состояние.
 *
 * Условие на seq — от гонки двух опросов: раунд закрывают оба клиента
 * одновременно, но запись пройдёт у одного. Второй получит stale и перечитает.
 */
async function save(row, state) {
    const done = state.phase === 'over';
    const winnerId = done && state.winner !== null
        ? (state.winner === 0 ? row.p0 : row.p1)
        : null;

    const res = await query(
        `UPDATE geo_duels
            SET state = $3, seq = seq + 1, moved_at = now(),
                status = CASE WHEN $4::boolean THEN 'done' ELSE status END,
                winner = COALESCE($5, winner),
                reason = CASE WHEN $4::boolean THEN $6 ELSE reason END
          WHERE id = $1 AND seq = $2 AND status = 'live'
        RETURNING seq`,
        [row.id, row.seq, JSON.stringify(state), done, winnerId, state.reason || ''],
    );
    if (!res.rows.length) return false;

    // Очки пишет тот же запрос, что закрыл партию, — значит, ровно один раз.
    // Ничья (оба бросили) не двигает ничего: победы в ней не было.
    if (done && winnerId) {
        await addDuelResult(winnerId, winnerId === row.p0 ? row.p1 : row.p0, DUEL_WIN_PTS);
    }
    return true;
}

/**
 * Подвинуть партию во времени: закрыть просроченный раунд, начать следующий.
 * Возвращает свежую строку (свою или перечитанную, если нас опередили).
 */
async function tick(row) {
    if (row.status !== 'live') return row;
    const state = row.state;
    let changed = resolveRound(state);

    if (state.phase === 'reveal' && canAdvance(state)) {
        const point = await nextPoint();
        // Справочник не ответил — просто не двигаем раунд: итог предыдущего
        // висит на экране, следующий опрос попробует ещё раз. Ронять партию
        // из-за одного неудачного запроса нельзя.
        if (point) { startRound(state, point); changed = true; }
    }
    if (!changed) return row;

    // Читаем заново в обоих случаях: и когда записали мы (в строке появились
    // winner с reason, которых нет в нашей копии), и когда нас опередили.
    await save(row, state);
    return (await fetchRow(row.id)) || row;
}

/**
 * Состояние партии.
 *
 * since — номер, который клиент уже видел. Если сервер не ушёл вперёд, отвечаем
 * коротко: при опросе раз в полторы секунды это большинство ответов, и гонять
 * в них историю раундов незачем. Но раунд идёт по часам, а не по ходам, поэтому
 * короткий ответ всё равно несёт время до конца раунда.
 */
export async function getDuel(duelId, userId, since = -1) {
    let row = await load(duelId, userId);
    if (!row) return null;
    row = await tick(row);
    if (since >= 0 && row.seq === since) return present(row, userId, { full: false });
    return present(row, userId);
}

/** Ткнуть в карту. Раунд закрывается сам, когда ответят оба. */
export async function submit(duelId, userId, guess) {
    let row = await load(duelId, userId);
    if (!row) return { ok: false, reason: 'not_found' };
    row = await tick(row);
    if (row.status !== 'live') return { ok: false, reason: 'not_live' };

    const seat = seatOf(row, userId);
    const state = row.state;
    const res = submitGuess(state, seat, guess);
    if (!res.ok) return res;

    // Если соперник уже ответил, этот же вызов закрывает раунд — иначе итог
    // ждал бы следующего опроса, то есть до полутора секунд на пустом месте.
    resolveRound(state);

    if (!await save(row, state)) return { ok: false, reason: 'stale' };
    return { ok: true, ...present(await fetchRow(duelId), userId) };
}

/** «Посмотрел итог, поехали дальше». */
export async function ready(duelId, userId) {
    let row = await load(duelId, userId);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.status !== 'live') return { ok: false, reason: 'not_live' };

    const state = row.state;
    if (!markSeen(state, seatOf(row, userId))) return { ok: false, reason: 'not_reveal' };
    if (!await save(row, state)) return { ok: false, reason: 'stale' };

    // Оба нажали — следующий раунд начинаем сразу, не дожидаясь опроса.
    const moved = await tick(await fetchRow(duelId));
    return { ok: true, ...present(moved, userId) };
}

/** Сдаться. Единственный способ выйти из дуэли, не доигрывая. */
export async function resign(duelId, userId) {
    const row = await load(duelId, userId);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.status !== 'live') return { ok: false, reason: 'not_live' };

    const state = row.state;
    resignDuel(state, seatOf(row, userId));
    if (!await save(row, state)) return { ok: false, reason: 'stale' };
    return { ok: true, ...present(await fetchRow(duelId), userId) };
}
