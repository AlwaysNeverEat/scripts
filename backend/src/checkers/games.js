// Партии в шашки: всё общение с базой и применение ходов.
//
// СЕРВЕР ЗДЕСЬ АРБИТР, А НЕ ХРАНИТЕЛЬ ТАЙНЫ. В дураке и морском бое наружу
// уезжает не позиция, а ВИД на неё, потому что чужая рука и чужая расстановка —
// закрытая информация. В шашках закрытого нет ничего: доска на виду у обоих с
// первого хода, и позиция уезжает целиком, как есть.
//
// Зачем тогда сервер вообще ведёт партию — потому что игра ПАРНАЯ, и очко,
// приписанное себе, отнято у живого человека (тот же довод, что в бильярде).
// Клиент присылает прыжок из двух чисел, сервер прикладывает его к своей копии
// ТЕМИ ЖЕ правилами (shared/checkers.js) и сохраняет результат.

import { query } from '../db/client.js';
import {
    createGame, deserialize, serialize, applyMove, awaited, counts,
    colorOfSeat, seatOfColor,
    resign as resignRules, timeout as timeoutRules, agreeDraw as agreeDrawRules,
} from '../../../shared/checkers.js';
import { addResult, addDraw } from './scores.js';

// Сколько ждать хода соперника, прежде чем партию можно забрать себе. Сутки —
// это «человек ушёл домой и не вернулся», а не «отошёл на обед»: живая партия
// доигрывается за десять минут, и случайно попасть под это правило нельзя.
export const CLAIM_HOURS = 24;

// Сколько открытых вызовов может висеть на одного человека. Без ограничения
// лобби превращается в стену из вызовов одного скучающего.
const MAX_OPEN_PER_USER = 1;

// Кто есть кто: 0 — создатель вызова, 1 — принявший.
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
 * `full` — отдавать ли позицию. При опросе «не сходил ли соперник» она не нужна:
 * если сервер не ушёл вперёд, показывать нечего, а доска на 64 клетки — это
 * почти весь ответ целиком.
 */
function present(row, userId, { full = true } = {}) {
    const seat = seatOf(row, userId);
    const state = row.state ? deserialize(row.state) : null;
    const waiting = state ? awaited(state) : -1;
    const waited = Date.now() - new Date(row.moved_at).getTime();
    const players = [
        { id: row.p0, name: row.p0_name, avatar: row.p0_avatar },
        { id: row.p1, name: row.p1_name, avatar: row.p1_avatar },
    ];
    // Победа МЕСТОМ, а не идентификатором: окно рисует доску, а не список
    // пользователей. Ничья при этом тоже null — их различает status и reason.
    const winner = row.winner ? (row.winner === row.p0 ? 0 : 1) : null;

    return {
        id: row.id,
        status: row.status,
        seat,
        players,
        seq: row.seq,
        // Каким цветом играет спросивший. Нужно ещё в лобби: строка партии
        // подписывается «вы за белых», и доска разворачивается своим цветом вниз.
        color: state && seat >= 0 ? colorOfSeat(state, seat) : null,
        my_turn: row.status === 'live' && state ? waiting === seat : false,
        // Сколько шашек осталось у обоих — для строки в лобби, чтобы не тянуть
        // ради неё всю позицию.
        left: state ? counts(state).map(s => s.men + s.kings) : null,
        winner,
        reason: row.reason || '',
        // Кто предложил ничью, местом за доской. Живёт до ближайшего хода
        // соперника: сходил — значит отказался.
        draw_offer: row.draw_offer == null ? null : row.draw_offer,
        created_at: row.created_at,
        moved_at: row.moved_at,
        // Соперник пропал — партию можно забрать. Считаем здесь, а не на
        // клиенте: время на чужом компьютере может быть каким угодно.
        can_claim: row.status === 'live' && waiting >= 0 && waiting !== seat
            && waited > CLAIM_HOURS * 3600 * 1000,
        ...(full && state ? { state: serialize(state) } : {}),
    };
}

// ── Лобби ────────────────────────────────────────────────────────────────────

/** Открытые вызовы и незаконченные партии этого игрока. */
export async function lobby(userId) {
    const [open, mine] = await Promise.all([
        query(
            `SELECT g.*, ${PLAYER_COLS} FROM checkers_games g ${PLAYER_JOIN}
              WHERE g.status = 'open'
              ORDER BY g.created_at
              LIMIT 20`,
        ),
        query(
            `SELECT g.*, ${PLAYER_COLS} FROM checkers_games g ${PLAYER_JOIN}
              WHERE g.status = 'live' AND (g.p0 = $1 OR g.p1 = $1)
              ORDER BY g.moved_at DESC
              LIMIT 20`,
            [userId],
        ),
    ]);
    return {
        open: open.rows.map(r => present(r, userId, { full: false })),
        mine: mine.rows.map(r => present(r, userId, { full: false })),
    };
}

/** Бросить вызов: партия появляется в лобби и ждёт любого желающего. */
export async function createChallenge(userId) {
    const busy = await query(
        `SELECT count(*)::int AS n FROM checkers_games WHERE p0 = $1 AND status = 'open'`,
        [userId],
    );
    if (busy.rows[0].n >= MAX_OPEN_PER_USER) return { ok: false, reason: 'already_waiting' };

    // Зерно решает сервер: по нему выпадает, кому достанутся белые, и знать это
    // заранее не должен никто, включая создателя вызова.
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const game = createGame({ seed });

    const res = await query(
        `INSERT INTO checkers_games (p0, seed, status, state)
              VALUES ($1, $2, 'open', $3)
           RETURNING id`,
        [userId, seed, JSON.stringify(serialize(game))],
    );
    return { ok: true, id: res.rows[0].id };
}

/** Принять чужой вызов — партия начинается сразу, расставлять тут нечего. */
export async function joinChallenge(gameId, userId) {
    // Один UPDATE с проверками внутри: если вызов уже приняли, строк не будет, и
    // двое, нажавшие одновременно, не окажутся оба за доской.
    const res = await query(
        `UPDATE checkers_games
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
        `DELETE FROM checkers_games WHERE id = $1 AND p0 = $2 AND status = 'open' RETURNING id`,
        [gameId, userId],
    );
    return { ok: !!res.rows.length };
}

// ── Партия ───────────────────────────────────────────────────────────────────

async function load(gameId, userId) {
    const res = await query(
        `SELECT g.*, ${PLAYER_COLS} FROM checkers_games g ${PLAYER_JOIN} WHERE g.id = $1`,
        [gameId],
    );
    const row = res.rows[0];
    if (!row) return null;
    // Смотреть чужую партию со стороны в шашках не вредно (прятать нечего), но
    // и незачем: зрителей у офисной пасхалки не бывает, а лишний вход — лишняя
    // дверь. Пускаем только игроков.
    if (seatOf(row, userId) < 0) return null;
    return row;
}

/**
 * Состояние партии.
 *
 * since — номер прыжка, который клиент уже видел. Если сервер не ушёл вперёд,
 * отвечаем коротко: при опросе раз в полторы секунды это девять ответов из
 * десяти.
 */
export async function getGame(gameId, userId, since = -1) {
    const row = await load(gameId, userId);
    if (!row) return null;
    if (since >= 0 && row.seq === since) return present(row, userId, { full: false });
    return present(row, userId);
}

/**
 * Сыграть ОДИН прыжок.
 *
 * seq — номер хода, каким его видит клиент. Это защита от двойной отправки:
 * повторный запрос с тем же номером не пройдёт условие UPDATE и ничего не
 * применит. В шашках это особенно важно: в цепочке ход остаётся у побившего, и
 * дважды принятый прыжок незаметно съел бы ещё одну шашку.
 */
export async function playHop(gameId, userId, seq, from, to) {
    const row = await load(gameId, userId);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.status !== 'live') return { ok: false, reason: 'not_live' };
    if (Number(seq) !== row.seq) return { ok: false, reason: 'stale' };

    const seat = seatOf(row, userId);
    const game = deserialize(row.state);
    const played = applyMove(game, colorOfSeat(game, seat), { from, to });
    if (!played.ok) return { ok: false, reason: played.reason };

    // Сходил — значит отказался: чужое предложение ничьей снимает свой же ход.
    const offer = row.draw_offer === seat ? row.draw_offer : null;
    const saved = await finish(row, game, { drawOffer: offer });
    if (!saved) return { ok: false, reason: 'stale' };
    return { ok: true, ...present(saved, userId) };
}

/** Сдаться. Единственный способ закончить партию, не доигрывая. */
export async function resignGame(gameId, userId) {
    const row = await load(gameId, userId);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.status !== 'live') return { ok: false, reason: 'not_live' };

    const game = deserialize(row.state);
    resignRules(game, colorOfSeat(game, seatOf(row, userId)));
    const saved = await finish(row, game);
    if (!saved) return { ok: false, reason: 'stale' };
    return { ok: true, ...present(saved, userId) };
}

/**
 * Предложить ничью, а если её уже предложил соперник — согласиться.
 *
 * Одна ручка на оба действия нарочно: с точки зрения игрока это одна кнопка
 * «ничья», и что именно она сделает, решает не он, а то, предлагали ли ему.
 */
export async function offerDraw(gameId, userId) {
    const row = await load(gameId, userId);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.status !== 'live') return { ok: false, reason: 'not_live' };

    const seat = seatOf(row, userId);
    if (row.draw_offer != null && row.draw_offer !== seat) {
        const game = deserialize(row.state);
        agreeDrawRules(game);
        const saved = await finish(row, game);
        if (!saved) return { ok: false, reason: 'stale' };
        return { ok: true, ...present(saved, userId) };
    }

    const saved = await query(
        `UPDATE checkers_games SET draw_offer = $2
          WHERE id = $1 AND status = 'live'
        RETURNING *`,
        [gameId, seat],
    );
    if (!saved.rows.length) return { ok: false, reason: 'not_live' };
    return { ok: true, ...present(withNames(saved.rows[0], row), userId) };
}

/** Снять своё предложение ничьей. */
export async function cancelDraw(gameId, userId) {
    const row = await load(gameId, userId);
    if (!row) return { ok: false, reason: 'not_found' };
    const saved = await query(
        `UPDATE checkers_games SET draw_offer = NULL
          WHERE id = $1 AND draw_offer = $2
        RETURNING *`,
        [gameId, seatOf(row, userId)],
    );
    if (!saved.rows.length) return { ok: false, reason: 'no_offer' };
    return { ok: true, ...present(withNames(saved.rows[0], row), userId) };
}

/**
 * Забрать партию, которую соперник бросил.
 *
 * Нужно ровно для одного случая: проигрывающий закрыл вкладку и не вернулся. Без
 * этого доигрывать до конца было бы невыгодно только тому, кто выигрывает.
 */
export async function claimGame(gameId, userId) {
    const row = await load(gameId, userId);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.status !== 'live') return { ok: false, reason: 'not_live' };

    const seat = seatOf(row, userId);
    const game = deserialize(row.state);
    const waiting = awaited(game);
    if (waiting < 0) return { ok: false, reason: 'nobody_waits' };
    if (waiting === seat) return { ok: false, reason: 'your_turn' };

    const waited = Date.now() - new Date(row.moved_at).getTime();
    if (waited < CLAIM_HOURS * 3600 * 1000) return { ok: false, reason: 'too_early' };

    timeoutRules(game, colorOfSeat(game, waiting));
    const saved = await finish(row, game);
    if (!saved) return { ok: false, reason: 'stale' };
    return { ok: true, ...present(saved, userId) };
}

/**
 * Записать позицию и, если партия кончилась, раздать очки.
 *
 * Условие `seq = $2` в UPDATE — та самая защита от двойной отправки: строку,
 * увезённую из-под нас другим запросом, мы не тронем и честно ответим
 * «устарело», а клиент перечитает партию.
 */
async function finish(row, game, { drawOffer = null } = {}) {
    const done = game.phase === 'over';
    const draw = done && game.winner == null;
    const winnerSeat = done && !draw ? seatOfColor(game, game.winner) : -1;
    const winnerId = winnerSeat < 0 ? null : (winnerSeat === 0 ? row.p0 : row.p1);
    const loserId = winnerSeat < 0 ? null : (winnerSeat === 0 ? row.p1 : row.p0);

    const saved = await query(
        `UPDATE checkers_games
            SET state = $3, seq = seq + 1, moved_at = now(), draw_offer = $7,
                status = CASE WHEN $4::boolean THEN 'done' ELSE status END,
                winner = CASE WHEN $4::boolean THEN $5::uuid ELSE winner END,
                reason = CASE WHEN $4::boolean THEN $6 ELSE reason END
          WHERE id = $1 AND seq = $2 AND status = 'live'
        RETURNING *`,
        [row.id, row.seq, JSON.stringify(serialize(game)), done, winnerId, game.reason, drawOffer],
    );
    if (!saved.rows.length) return null;

    if (done) {
        if (draw) await addDraw(row.p0, row.p1);
        else await addResult(winnerId, loserId);
    }
    return withNames(saved.rows[0], row);
}

// Имена игроков подмешиваем из уже загруженной строки: второй раз ходить за ними
// в базу незачем, они за партию не меняются.
const withNames = (fresh, row) => ({
    ...fresh,
    p0_name: row.p0_name, p0_avatar: row.p0_avatar,
    p1_name: row.p1_name, p1_avatar: row.p1_avatar,
});

