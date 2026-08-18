// Партии дурака: всё общение с базой и применение ходов.
//
// СЕРВЕР ЗДЕСЬ НЕ АРБИТР, А ЕДИНСТВЕННЫЙ, КТО ВООБЩЕ ЗНАЕТ ПОЗИЦИЮ. В бильярде
// клиент считает партию сам, а сервер сверяет отпечаток — там стол на виду у
// обоих. В картах так нельзя: рука соседа и колода закрыты, и браузер, которому
// их отдали, знает лишнее. Поэтому наружу уходит не позиция, а ВИД на неё
// (viewFor из shared/durak.js): своя рука, размеры чужих рук, стол и отбой.
//
// Клиент присылает ход из двух полей (что делаю и какой картой), сервер
// прикладывает его к своей копии теми же правилами и сохраняет результат.

import { query } from '../db/client.js';
import {
    createGame, deserialize, serialize, applyMove, toMove, viewFor,
    resign as resignRules, timeout as timeoutRules,
    MIN_SEATS, MAX_SEATS, PODKIDNOY, PEREVODNOY,
} from '../../../shared/durak.js';
import { addResult } from './scores.js';

// Сколько ждать хода, прежде чем партию можно закрыть без него. Сутки — это
// «человек ушёл домой и не вернулся», а не «отошёл на обед»: живая партия
// доигрывается за десять минут, и случайно попасть под это правило нельзя.
export const CLAIM_HOURS = 24;

// Сколько открытых комнат может висеть на одного человека. Без ограничения
// лобби превращается в стену из комнат одного скучающего.
const MAX_OPEN_PER_USER = 1;

// Игроки по местам, одним подзапросом: место в массиве и есть место за столом,
// поэтому порядок сохраняем через WITH ORDINALITY, а не надеемся на JOIN.
const PEOPLE = `
  (SELECT json_agg(json_build_object('id', u.id, 'name', u.display_name, 'avatar', u.avatar)
                   ORDER BY p.ord)
     FROM unnest(g.players) WITH ORDINALITY AS p(id, ord)
     JOIN users u ON u.id = p.id) AS people`;

const seatOf = (row, userId) => row.players.indexOf(userId);

/**
 * Партия для клиента.
 *
 * `full` — отдавать ли вид на позицию. При опросе «не сходил ли сосед» он не
 * нужен: если сервер не ушёл вперёд, показывать нечего, а руки и стол — это
 * весь ответ целиком.
 */
function present(row, userId, { full = true } = {}) {
    const seat = seatOf(row, userId);
    const state = row.state ? deserialize(row.state) : null;
    const mover = state ? toMove(state) : -1;
    const waited = Date.now() - new Date(row.moved_at).getTime();

    return {
        id: row.id,
        status: row.status,
        mode: row.mode,
        seats: row.seats,
        seat,
        host: row.host,
        is_host: row.host === userId,
        players: row.people || [],
        seq: row.seq,
        to_move: mover,
        my_turn: row.status === 'live' && mover === seat,
        // Дурак местом за столом, а не идентификатором: окно рисует стол, а не
        // список пользователей. null при законченной партии — это ничья.
        loser: row.loser ? row.players.indexOf(row.loser) : (row.status === 'done' ? -1 : null),
        reason: row.reason || '',
        created_at: row.created_at,
        moved_at: row.moved_at,
        // Соперник пропал — партию можно закрыть. Считаем здесь, а не на
        // клиенте: время на чужом компьютере может быть каким угодно.
        can_claim: row.status === 'live' && mover >= 0 && mover !== seat
            && waited > CLAIM_HOURS * 3600 * 1000,
        ...(full && state && seat >= 0 ? { view: viewFor(state, seat) } : {}),
    };
}

// ── Лобби ────────────────────────────────────────────────────────────────────

/** Открытые комнаты и незаконченные партии этого игрока. */
export async function lobby(userId) {
    const [open, mine] = await Promise.all([
        query(
            `SELECT g.*, ${PEOPLE} FROM durak_games g
              WHERE g.status = 'open'
              ORDER BY g.created_at
              LIMIT 20`,
        ),
        query(
            `SELECT g.*, ${PEOPLE} FROM durak_games g
              WHERE g.status = 'live' AND $1 = ANY (g.players)
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

/** Собрать комнату: она висит в лобби, пока не наберётся народ. */
export async function createRoom(userId, { seats, mode } = {}) {
    const busy = await query(
        `SELECT count(*)::int AS n FROM durak_games WHERE host = $1 AND status = 'open'`,
        [userId],
    );
    if (busy.rows[0].n >= MAX_OPEN_PER_USER) return { ok: false, reason: 'already_waiting' };

    const size = Math.max(MIN_SEATS, Math.min(MAX_SEATS, Number(seats) | 0 || MIN_SEATS));
    const rules = mode === PEREVODNOY ? PEREVODNOY : PODKIDNOY;
    // Зерно решает сервер: по нему раскладывается колода, и знать его заранее
    // не должен никто, включая хозяина комнаты.
    const seed = (Math.random() * 0xffffffff) >>> 0;

    const res = await query(
        `INSERT INTO durak_games (host, players, seats, mode, seed, status)
              VALUES ($1, ARRAY[$1]::uuid[], $2, $3, $4, 'open')
           RETURNING id`,
        [userId, size, rules, seed],
    );
    return { ok: true, id: res.rows[0].id };
}

/**
 * Сесть в чужую комнату. Когда занято последнее место — партия начинается сама.
 *
 * Один UPDATE со всеми проверками внутри: если место увели, строк не будет, и
 * двое, нажавшие одновременно, не окажутся на одном стуле.
 */
export async function joinRoom(gameId, userId) {
    const res = await query(
        `UPDATE durak_games
            SET players = players || $2::uuid
          WHERE id = $1 AND status = 'open'
            AND NOT ($2 = ANY (players))
            AND coalesce(array_length(players, 1), 0) < seats
        RETURNING *`,
        [gameId, userId],
    );
    if (!res.rows.length) return { ok: false, reason: 'gone' };

    const row = res.rows[0];
    if (row.players.length >= row.seats) await deal(row);
    return { ok: true, id: gameId, started: row.players.length >= row.seats };
}

/**
 * Начать, не дожидаясь полного стола. Только хозяину комнаты и только вдвоём и
 * больше: играть в дурака одному не с кем.
 */
export async function startRoom(gameId, userId) {
    const res = await query(
        `SELECT * FROM durak_games WHERE id = $1 AND status = 'open' AND host = $2`,
        [gameId, userId],
    );
    const row = res.rows[0];
    if (!row) return { ok: false, reason: 'gone' };
    if (row.players.length < MIN_SEATS) return { ok: false, reason: 'alone' };
    const dealt = await deal(row);
    return dealt ? { ok: true, id: gameId } : { ok: false, reason: 'gone' };
}

/**
 * Раздача. Мест в партии столько, сколько людей реально село: комната на
 * четверых, начатая втроём, — это партия на троих, а не на четверых с пустым
 * стулом.
 */
async function deal(row) {
    const game = createGame({ seed: Number(row.seed), seats: row.players.length, mode: row.mode });
    const saved = await query(
        `UPDATE durak_games
            SET status = 'live', seats = $2, state = $3, seq = 0, moved_at = now()
          WHERE id = $1 AND status = 'open'
        RETURNING id`,
        [row.id, row.players.length, JSON.stringify(serialize(game))],
    );
    return !!saved.rows.length;
}

/** Уйти из комнаты. Хозяин уносит её с собой — без него садиться не к кому. */
export async function leaveRoom(gameId, userId) {
    const res = await query(
        `DELETE FROM durak_games WHERE id = $1 AND host = $2 AND status = 'open' RETURNING id`,
        [gameId, userId],
    );
    if (res.rows.length) return { ok: true };
    const left = await query(
        `UPDATE durak_games SET players = array_remove(players, $2)
          WHERE id = $1 AND status = 'open' AND $2 = ANY (players)
        RETURNING id`,
        [gameId, userId],
    );
    return { ok: !!left.rows.length };
}

// ── Партия ───────────────────────────────────────────────────────────────────

async function load(gameId, userId) {
    const res = await query(
        `SELECT g.*, ${PEOPLE} FROM durak_games g WHERE g.id = $1`,
        [gameId],
    );
    const row = res.rows[0];
    if (!row) return null;
    // За чужой стол не пускаем даже посмотреть: в дураке зритель видит чужие
    // руки, а подсказывающий из-за плеча тут не шутка, а способ выиграть.
    if (seatOf(row, userId) < 0) return null;
    return row;
}

/**
 * Состояние партии.
 *
 * since — номер хода, который клиент уже видел. Если сервер не ушёл вперёд,
 * отвечаем коротко: при опросе раз в полторы секунды это девять ответов из
 * десяти, и гонять в них весь стол незачем.
 */
export async function getGame(gameId, userId, since = -1) {
    const row = await load(gameId, userId);
    if (!row) return null;
    if (since >= 0 && row.seq === since) return present(row, userId, { full: false });
    return present(row, userId);
}

/**
 * Сыграть ход.
 *
 * seq — номер хода, каким его видит клиент. Это защита от двойной отправки:
 * повторный запрос с тем же номером не пройдёт условие UPDATE и ничего не
 * применит. Дважды сыгранная карта в дураке хуже потерянной — она уедет из руки
 * туда, где её никто не видел.
 */
export async function playMove(gameId, userId, seq, move) {
    const row = await load(gameId, userId);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.status !== 'live') return { ok: false, reason: 'not_live' };
    if (Number(seq) !== row.seq) return { ok: false, reason: 'stale' };

    const seat = seatOf(row, userId);
    const game = deserialize(row.state);
    const played = applyMove(game, seat, move);
    if (!played.ok) return { ok: false, reason: played.reason };

    const saved = await finish(row, game);
    if (!saved) return { ok: false, reason: 'stale' };
    return { ok: true, ...present(saved, userId) };
}

/** Сдаться: сдавшийся объявляет дураком себя. */
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
 * Закрыть партию, в которой соперник не ходит сутки.
 *
 * Нужно ровно для одного случая: проигрывающий закрыл вкладку и не вернулся. Без
 * этого в таблице копились бы одни поражения тех, кто доигрывает до конца.
 */
export async function claimGame(gameId, userId) {
    const row = await load(gameId, userId);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.status !== 'live') return { ok: false, reason: 'not_live' };

    const seat = seatOf(row, userId);
    const game = deserialize(row.state);
    const mover = toMove(game);
    if (mover === seat) return { ok: false, reason: 'your_turn' };

    const waited = Date.now() - new Date(row.moved_at).getTime();
    if (waited < CLAIM_HOURS * 3600 * 1000) return { ok: false, reason: 'too_early' };

    timeoutRules(game, mover);
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
    // loser = -1 это ничья: дурака нет, и в базе на его месте остаётся NULL.
    const loserId = done && game.loser >= 0 ? row.players[game.loser] : null;

    const saved = await query(
        `UPDATE durak_games
            SET state = $3, seq = seq + 1, moved_at = now(),
                status = CASE WHEN $4::boolean THEN 'done' ELSE status END,
                loser  = CASE WHEN $4::boolean THEN $5::uuid ELSE loser END,
                reason = CASE WHEN $4::boolean THEN $6 ELSE reason END
          WHERE id = $1 AND seq = $2 AND status = 'live'
        RETURNING *`,
        [row.id, row.seq, JSON.stringify(serialize(game)), done, loserId, game.reason],
    );
    if (!saved.rows.length) return null;

    if (loserId) await addResult(loserId, row.players.filter(id => id !== loserId));

    // Игроков подмешиваем из уже загруженной строки: второй раз ходить за ними
    // в базу незачем, они за партию не меняются.
    return { ...saved.rows[0], people: row.people };
}
