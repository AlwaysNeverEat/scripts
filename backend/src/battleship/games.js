// Партии морского боя: всё общение с базой и применение ходов.
//
// СЕРВЕР ЗДЕСЬ НЕ АРБИТР, А ЕДИНСТВЕННЫЙ, КТО ВООБЩЕ ЗНАЕТ ПОЗИЦИЮ. В бильярде
// клиент считает партию сам, а сервер сверяет отпечаток — там стол на виду у
// обоих. Здесь так нельзя, и даже сильнее, чем в дураке: там закрыта чужая рука,
// а тут — чужая расстановка, то есть вся игра целиком. Браузер, которому её
// отдали, не «может смухлевать», он уже выиграл. Поэтому наружу уходит не
// позиция, а ВИД на неё (viewFor из shared/battleship.js).
//
// Клиент присылает ход из одного-двух полей (расстановку флота или номер
// клетки), сервер прикладывает его к своей копии теми же правилами и сохраняет
// результат.

import { query } from '../db/client.js';
import {
    createGame, deserialize, serialize, applyMove, viewFor, awaited,
    fleetError, normalizeFleet,
    resign as resignRules, timeout as timeoutRules,
} from '../../../shared/battleship.js';
import { addResult } from './scores.js';

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
 * `full` — отдавать ли вид на позицию. При опросе «не сходил ли соперник» он не
 * нужен: если сервер не ушёл вперёд, показывать нечего, а два поля по сто клеток
 * — это весь ответ целиком.
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

    return {
        id: row.id,
        status: row.status,
        seat,
        players,
        seq: row.seq,
        // Расстановка и стрельба — разные экраны, и лобби подписывает строку
        // партии по-разному («расставляет флот» против «ваш ход»).
        phase: state?.phase || 'setup',
        // «Мне есть что делать»: в расстановке — пока не нажал «Готов», в
        // бою — пока мой ход.
        my_turn: row.status === 'live' && state
            ? (state.phase === 'setup' ? !state.ready[seat] : state.turn === seat)
            : false,
        // Победа местом, а не идентификатором: окно рисует поля, а не список
        // пользователей.
        winner: row.winner ? (row.winner === row.p0 ? 0 : 1) : null,
        reason: row.reason || '',
        created_at: row.created_at,
        moved_at: row.moved_at,
        // Соперник пропал — партию можно забрать. Считаем здесь, а не на
        // клиенте: время на чужом компьютере может быть каким угодно.
        can_claim: row.status === 'live' && waiting >= 0 && waiting !== seat
            && waited > CLAIM_HOURS * 3600 * 1000,
        ...(full && state && seat >= 0 ? { view: viewFor(state, seat) } : {}),
    };
}

// ── Лобби ────────────────────────────────────────────────────────────────────

/** Открытые вызовы и незаконченные партии этого игрока. */
export async function lobby(userId) {
    const [open, mine] = await Promise.all([
        query(
            `SELECT g.*, ${PLAYER_COLS} FROM battleship_games g ${PLAYER_JOIN}
              WHERE g.status = 'open'
              ORDER BY g.created_at
              LIMIT 20`,
        ),
        query(
            `SELECT g.*, ${PLAYER_COLS} FROM battleship_games g ${PLAYER_JOIN}
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
        `SELECT count(*)::int AS n FROM battleship_games WHERE p0 = $1 AND status = 'open'`,
        [userId],
    );
    if (busy.rows[0].n >= MAX_OPEN_PER_USER) return { ok: false, reason: 'already_waiting' };

    // Зерно решает сервер: по нему выпадает, кто стреляет первым, и знать это
    // заранее не должен никто, включая создателя вызова.
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const game = createGame({ seed });

    const res = await query(
        `INSERT INTO battleship_games (p0, seed, status, state)
              VALUES ($1, $2, 'open', $3)
           RETURNING id`,
        [userId, seed, JSON.stringify(serialize(game))],
    );
    return { ok: true, id: res.rows[0].id };
}

/**
 * Принять чужой вызов. Партия сразу становится live — но в ней ещё расстановка,
 * а не стрельба (см. шапку миграции).
 */
export async function joinChallenge(gameId, userId) {
    // Один UPDATE с проверками внутри: если вызов уже приняли, строк не будет, и
    // двое, нажавшие одновременно, не окажутся оба за полем.
    const res = await query(
        `UPDATE battleship_games
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
        `DELETE FROM battleship_games WHERE id = $1 AND p0 = $2 AND status = 'open' RETURNING id`,
        [gameId, userId],
    );
    return { ok: !!res.rows.length };
}

// ── Партия ───────────────────────────────────────────────────────────────────

async function load(gameId, userId) {
    const res = await query(
        `SELECT g.*, ${PLAYER_COLS} FROM battleship_games g ${PLAYER_JOIN} WHERE g.id = $1`,
        [gameId],
    );
    const row = res.rows[0];
    if (!row) return null;
    // К чужому полю не пускаем даже посмотреть: зритель тут видит обе
    // расстановки, а подсказывающий из-за плеча — не шутка, а способ выиграть.
    if (seatOf(row, userId) < 0) return null;
    return row;
}

/**
 * Состояние партии.
 *
 * since — номер хода, который клиент уже видел. Если сервер не ушёл вперёд,
 * отвечаем коротко: при опросе раз в полторы секунды это девять ответов из
 * десяти, и гонять в них два поля по сто клеток незачем.
 */
export async function getGame(gameId, userId, since = -1) {
    const row = await load(gameId, userId);
    if (!row) return null;
    if (since >= 0 && row.seq === since) return present(row, userId, { full: false });
    return present(row, userId);
}

/**
 * Расставить флот.
 *
 * ЗДЕСЬ ЕДИНСТВЕННОЕ МЕСТО ПАРТИИ, ГДЕ ДВОЕ ПИШУТ В ОДНУ СТРОКУ ОДНОВРЕМЕННО:
 * расставляются оба разом, ждать чужой расстановки незачем. Поэтому обычная
 * защита по seq, как у выстрела, тут не годится — она объявила бы одного
 * «опоздавшим» и заставила расставлять флот заново, хотя он всё сделал
 * правильно.
 *
 * Вместо неё в базу уезжает ТОЛЬКО СВОЙ КУСОК позиции (jsonb_set по своему
 * месту), а условие «этот игрок ещё не готов» стоит внутри того же UPDATE. Двое
 * нажавших «Готов» в одну секунду меняют разные поля одной строки, и потерять
 * чужую расстановку, перезаписав её своей копией, невозможно.
 */
export async function place(gameId, userId, ships) {
    const row = await load(gameId, userId);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.status !== 'live') return { ok: false, reason: 'not_live' };

    const seat = seatOf(row, userId);
    const fleet = normalizeFleet(ships);
    // Проверяем ТЕМИ ЖЕ правилами, что и окно: присланный «линкор на десять
    // клеток» выиграл бы партию молча.
    const bad = fleetError(fleet);
    if (bad) return { ok: false, reason: bad };

    const saved = await query(
        // Место в jsonb-пути — текст ('0'/'1'), а в ->> — целое, поэтому и
        // параметра два: одному и тому же $n два разных приведения Postgres
        // выводить не обязан.
        `UPDATE battleship_games
            SET state = jsonb_set(
                          jsonb_set(state, ARRAY['fleets', $2], $3::jsonb),
                          ARRAY['ready', $2], 'true'::jsonb),
                seq = seq + 1, moved_at = now()
          WHERE id = $1 AND status = 'live'
            AND state ->> 'phase' = 'setup'
            AND (state -> 'ready' ->> $4::int)::boolean = false
        RETURNING id`,
        [gameId, String(seat), JSON.stringify(fleet), seat],
    );
    if (!saved.rows.length) return { ok: false, reason: 'already' };

    // Готовы оба — партия переходит к стрельбе. Отдельным запросом и с теми же
    // условиями внутри: его посылают оба игрока, и сработать он обязан ровно
    // один раз, чей бы «Готов» ни пришёл вторым.
    await query(
        `UPDATE battleship_games
            SET state = jsonb_set(jsonb_set(state, '{phase}', '"play"'), '{turn}', state -> 'first')
          WHERE id = $1 AND status = 'live'
            AND state ->> 'phase' = 'setup'
            AND (state -> 'ready' ->> 0)::boolean
            AND (state -> 'ready' ->> 1)::boolean`,
        [gameId],
    );

    const fresh = await load(gameId, userId);
    return fresh ? { ok: true, ...present(fresh, userId) } : { ok: false, reason: 'not_found' };
}

/**
 * Выстрелить.
 *
 * seq — номер хода, каким его видит клиент. Это защита от двойной отправки:
 * повторный запрос с тем же номером не пройдёт условие UPDATE и ничего не
 * применит. Дважды принятый выстрел здесь особенно вреден: попал — стреляй ещё,
 * и повтор незаметно съел бы клетку из очереди соперника.
 */
export async function playShot(gameId, userId, seq, cell) {
    const row = await load(gameId, userId);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.status !== 'live') return { ok: false, reason: 'not_live' };
    if (Number(seq) !== row.seq) return { ok: false, reason: 'stale' };

    const seat = seatOf(row, userId);
    const game = deserialize(row.state);
    const played = applyMove(game, seat, { type: 'shot', cell });
    if (!played.ok) return { ok: false, reason: played.reason };

    const saved = await finish(row, game);
    if (!saved) return { ok: false, reason: 'stale' };
    return { ok: true, ...present(saved, userId) };
}

/** Сдаться. Единственный способ закончить партию, не доигрывая. */
export async function resignGame(gameId, userId) {
    const row = await load(gameId, userId);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.status !== 'live') return { ok: false, reason: 'not_live' };

    const game = deserialize(row.state);
    resignRules(game, seatOf(row, userId));
    const saved = await finish(row, game);
    if (!saved) return { ok: false, reason: 'stale' };
    return { ok: true, ...present(saved, userId) };
}

/**
 * Забрать партию, которую соперник бросил.
 *
 * Нужно ровно для одного случая: проигрывающий закрыл вкладку и не вернулся. Без
 * этого доигрывать до конца было бы невыгодно только тому, кто выигрывает.
 * Работает и в расстановке: соперник, который принял вызов и ушёл, не должен
 * держать чужую партию вечно.
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

    timeoutRules(game, waiting);
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
async function finish(row, game) {
    const done = game.phase === 'over';
    const winnerId = done ? (game.winner === 0 ? row.p0 : row.p1) : null;
    const loserId = done ? (game.winner === 0 ? row.p1 : row.p0) : null;

    const saved = await query(
        `UPDATE battleship_games
            SET state = $3, seq = seq + 1, moved_at = now(),
                status = CASE WHEN $4::boolean THEN 'done' ELSE status END,
                winner = CASE WHEN $4::boolean THEN $5::uuid ELSE winner END,
                reason = CASE WHEN $4::boolean THEN $6 ELSE reason END
          WHERE id = $1 AND seq = $2 AND status = 'live'
        RETURNING *`,
        [row.id, row.seq, JSON.stringify(serialize(game)), done, winnerId, game.reason],
    );
    if (!saved.rows.length) return null;

    if (done) await addResult(winnerId, loserId);

    // Имена игроков подмешиваем из уже загруженной строки: второй раз ходить за
    // ними в базу незачем, они за партию не меняются.
    return {
        ...saved.rows[0],
        p0_name: row.p0_name, p0_avatar: row.p0_avatar,
        p1_name: row.p1_name, p1_avatar: row.p1_avatar,
    };
}
