// Партии бильярда: всё общение с базой и применение ударов.
//
// СЕРВЕР ЗДЕСЬ АРБИТР, а не почтальон. Клиент присылает четыре числа (куда и с
// какой силой бить), сервер прикладывает их к СВОЕЙ позиции теми же правилами
// (shared/pool.js) и сохраняет результат. Браузер потом проигрывает тот же удар
// у себя и получает ту же картинку — физика детерминированная, ради этого она
// такой и сделана.
//
// Почему не «клиент прислал новую позицию»: партия парная, и очко, которое
// игрок себе приписал, отнято у живого человека. Это единственная пасхалка, где
// доверять браузеру нельзя в принципе (у тетриса и тройки накрутка портит только
// свою же строчку в топе).

import { query } from '../db/client.js';
import {
    createGame, deserialize, serialize, shoot, settle, resign as resignRules,
    stateHash,
} from '../../../shared/pool.js';
import { addResult } from './scores.js';

// Сколько ждать хода соперника, прежде чем партию можно забрать себе. Сутки —
// это «человек ушёл домой и не вернулся», а не «отошёл на обед»: живая партия
// доигрывается за десять минут, и случайно попасть под это правило нельзя.
export const CLAIM_HOURS = 24;

// Сколько открытых вызовов может висеть на одного человека. Без ограничения
// лобби превращается в стену из вызовов одного скучающего.
const MAX_OPEN_PER_USER = 1;

// Кто есть кто за столом: 0 — создатель вызова, 1 — принявший.
const seatOf = (row, userId) => (row.p0 === userId ? 0 : row.p1 === userId ? 1 : -1);

const PLAYER_COLS = `
  u0.display_name AS p0_name, u0.avatar AS p0_avatar,
  u1.display_name AS p1_name, u1.avatar AS p1_avatar`;

const PLAYER_JOIN = `
  LEFT JOIN users u0 ON u0.id = g.p0
  LEFT JOIN users u1 ON u1.id = g.p1`;

/**
 * Партия для клиента.
 *
 * `full` — отдавать ли позицию целиком. При опросе «не сходил ли соперник» она
 * не нужна: клиент считает партию сам и берёт снимок, только когда разошёлся с
 * сервером или подключился к чужой партии посреди неё.
 */
function present(row, userId, { full = true } = {}) {
    const seat = seatOf(row, userId);
    const state = row.state;
    const players = [
        { id: row.p0, name: row.p0_name, avatar: row.p0_avatar },
        { id: row.p1, name: row.p1_name, avatar: row.p1_avatar },
    ];
    const waited = Date.now() - new Date(row.moved_at).getTime();
    return {
        id: row.id,
        status: row.status,
        seat,
        players,
        breaker: row.breaker,
        seq: row.seq,
        turn: state?.turn ?? 0,
        my_turn: row.status === 'live' && state?.turn === seat,
        last_shot: row.last_shot || null,
        winner: row.winner ? (row.winner === row.p0 ? 0 : 1) : null,
        reason: row.reason || '',
        moved_at: row.moved_at,
        // Соперник пропал — партию можно забрать. Считаем здесь, а не на клиенте:
        // время на чужом компьютере может быть каким угодно.
        can_claim: row.status === 'live'
            && state?.turn !== seat
            && waited > CLAIM_HOURS * 3600 * 1000,
        ...(full ? { state, hash: stateHash(deserialize(state)) } : {}),
    };
}

// ── Лобби ────────────────────────────────────────────────────────────────────

/** Открытые вызовы и незаконченные партии этого игрока. */
export async function lobby(userId) {
    const [open, mine] = await Promise.all([
        query(
            `SELECT g.*, ${PLAYER_COLS} FROM pool_games g ${PLAYER_JOIN}
              WHERE g.status = 'open'
              ORDER BY g.created_at
              LIMIT 20`,
        ),
        query(
            `SELECT g.*, ${PLAYER_COLS} FROM pool_games g ${PLAYER_JOIN}
              WHERE g.status = 'live' AND (g.p0 = $1 OR g.p1 = $1)
              ORDER BY g.moved_at DESC
              LIMIT 20`,
            [userId],
        ),
    ]);
    return {
        // Позиция в списке не нужна — там показывают только имя и кнопку.
        open: open.rows.map(r => present(r, userId, { full: false })),
        mine: mine.rows.map(r => present(r, userId, { full: false })),
    };
}

/** Бросить вызов: партия появляется в лобби и ждёт любого желающего. */
export async function createChallenge(userId) {
    const busy = await query(
        `SELECT count(*)::int AS n FROM pool_games WHERE p0 = $1 AND status = 'open'`,
        [userId],
    );
    if (busy.rows[0].n >= MAX_OPEN_PER_USER) return { ok: false, reason: 'already_waiting' };

    // Зерно пирамиды и того, кто разбивает, решает сервер: разбой — заметное
    // преимущество, и отдавать его создателю вызова нечестно.
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const breaker = Math.random() < 0.5 ? 0 : 1;
    const game = createGame({ seed, breaker });

    const res = await query(
        `INSERT INTO pool_games (p0, seed, breaker, status, state)
              VALUES ($1, $2, $3, 'open', $4)
           RETURNING id`,
        [userId, seed, breaker, JSON.stringify(serialize(game))],
    );
    return { ok: true, id: res.rows[0].id };
}

/** Принять чужой вызов. */
export async function joinChallenge(gameId, userId) {
    // Один UPDATE с проверками внутри: если вызов уже приняли, строк не будет, и
    // двое, нажавшие одновременно, не окажутся оба за столом.
    const res = await query(
        `UPDATE pool_games
            SET p1 = $2, status = 'live', moved_at = now()
          WHERE id = $1 AND status = 'open' AND p0 <> $2
        RETURNING id`,
        [gameId, userId],
    );
    if (!res.rows.length) return { ok: false, reason: 'gone' };
    return { ok: true, id: gameId };
}

/** Снять свой вызов, пока его никто не принял. */
export async function cancelChallenge(gameId, userId) {
    const res = await query(
        `DELETE FROM pool_games WHERE id = $1 AND p0 = $2 AND status = 'open' RETURNING id`,
        [gameId, userId],
    );
    return { ok: !!res.rows.length };
}

// ── Партия ───────────────────────────────────────────────────────────────────

async function load(gameId, userId) {
    const res = await query(
        `SELECT g.*, ${PLAYER_COLS} FROM pool_games g ${PLAYER_JOIN} WHERE g.id = $1`,
        [gameId],
    );
    const row = res.rows[0];
    if (!row) return null;
    // За чужой стол не пускаем даже посмотреть: партия идёт живьём, и
    // подсказывающий из-за плеча зритель тут лишний.
    if (seatOf(row, userId) < 0) return null;
    return row;
}

/**
 * Состояние партии.
 *
 * since — номер удара, который клиент уже видел. Если сервер не ушёл вперёд,
 * отвечаем коротко: при опросе раз в полторы секунды это девять ответов из
 * десяти, и гонять в них шестнадцать шаров незачем.
 */
export async function getGame(gameId, userId, since = -1) {
    const row = await load(gameId, userId);
    if (!row) return null;
    if (since >= 0 && row.seq === since) return present(row, userId, { full: false });
    return present(row, userId);
}

/**
 * Сыграть удар.
 *
 * seq — номер хода, каким его видит клиент. Это защита от двойной отправки:
 * повторный запрос с тем же номером не пройдёт условие UPDATE и ничего не
 * применит. Дважды сыгранный удар в бильярде хуже потерянного — стол уедет
 * туда, где его никто не видел.
 */
export async function playShot(gameId, userId, seq, shot) {
    const row = await load(gameId, userId);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.status !== 'live') return { ok: false, reason: 'not_live' };

    const seat = seatOf(row, userId);
    const game = deserialize(row.state);
    if (game.turn !== seat) return { ok: false, reason: 'not_your_turn' };
    if (Number(seq) !== row.seq) return { ok: false, reason: 'stale' };

    const started = shoot(game, shot);
    if (!started.ok) return { ok: false, reason: started.reason };
    const outcome = settle(game);

    const done = game.phase === 'over';
    const winnerId = done ? (game.winner === 0 ? row.p0 : row.p1) : null;

    const saved = await query(
        `UPDATE pool_games
            SET state = $3, last_shot = $4, seq = seq + 1, moved_at = now(),
                status = CASE WHEN $5::boolean THEN 'done' ELSE status END,
                winner = COALESCE($6, winner),
                reason = CASE WHEN $5::boolean THEN $7 ELSE reason END
          WHERE id = $1 AND seq = $2 AND status = 'live'
        RETURNING seq`,
        [gameId, row.seq, JSON.stringify(serialize(game)), JSON.stringify(shot),
         done, winnerId, game.reason],
    );
    // Строку увели из-под нас (тот же удар прилетел дважды) — свой расчёт
    // выбрасываем и отвечаем «устарело»: клиент перечитает партию.
    if (!saved.rows.length) return { ok: false, reason: 'stale' };

    if (done) await addResult(winnerId, winnerId === row.p0 ? row.p1 : row.p0);

    return {
        ok: true,
        seq: saved.rows[0].seq,
        outcome,
        state: serialize(game),
        hash: stateHash(game),
    };
}

/** Сдаться. Единственный способ закончить партию, не доигрывая. */
export async function resignGame(gameId, userId) {
    const row = await load(gameId, userId);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.status !== 'live') return { ok: false, reason: 'not_live' };

    const seat = seatOf(row, userId);
    const game = deserialize(row.state);
    resignRules(game, seat);
    const winnerId = seat === 0 ? row.p1 : row.p0;

    const saved = await query(
        `UPDATE pool_games
            SET state = $2, status = 'done', winner = $3, reason = 'resign', moved_at = now()
          WHERE id = $1 AND status = 'live'
        RETURNING id`,
        [gameId, JSON.stringify(serialize(game)), winnerId],
    );
    if (!saved.rows.length) return { ok: false, reason: 'stale' };

    await addResult(winnerId, userId);
    return { ok: true, state: serialize(game) };
}

/**
 * Забрать партию, которую соперник бросил.
 *
 * Нужно ровно для одного случая: проигрывающий закрыл вкладку и не вернулся. Без
 * этого в таблице копились бы одни победы — доигрывать до конца было бы невыгодно
 * только тому, кто выигрывает.
 */
export async function claimGame(gameId, userId) {
    const row = await load(gameId, userId);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.status !== 'live') return { ok: false, reason: 'not_live' };

    const seat = seatOf(row, userId);
    const game = deserialize(row.state);
    if (game.turn === seat) return { ok: false, reason: 'your_turn' };

    const waited = Date.now() - new Date(row.moved_at).getTime();
    if (waited < CLAIM_HOURS * 3600 * 1000) return { ok: false, reason: 'too_early' };

    resignRules(game, 1 - seat);
    const loserId = seat === 0 ? row.p1 : row.p0;

    const saved = await query(
        `UPDATE pool_games
            SET state = $2, status = 'done', winner = $3, reason = 'timeout', moved_at = now()
          WHERE id = $1 AND status = 'live' AND moved_at = $4
        RETURNING id`,
        [gameId, JSON.stringify(serialize(game)), userId, row.moved_at],
    );
    // moved_at в условии — на случай, если соперник сходил ровно сейчас: тогда
    // партия жива, и забирать нечего.
    if (!saved.rows.length) return { ok: false, reason: 'stale' };

    await addResult(userId, loserId);
    return { ok: true, state: serialize(game) };
}
