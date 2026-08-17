// Три таблицы очков пасхалки «Гео» — по одной на режим (см. миграцию 031).
//
// Режимы меряют разное, и объединять их в одну таблицу нельзя: у дейли это
// сумма за все дни, у соло — рекорд одной партии из пяти точек, у дуэли —
// очки за встречи с живыми людьми. Общая таблица с колонкой режима стала бы
// набором полей, половина которых всегда пустая, — ровно то, от чего разведены
// топы тетриса и тройки.
//
// Имя, аватарка, плашка роли и факультета берутся одинаково во всех трёх: коллег
// человек должен узнавать везде одним и тем же способом.

import { query } from '../db/client.js';
import { FACULTY_JOIN, FACULTY_COLUMNS, facultyBadge } from '../faculty/store.js';

export const TOP_LIMIT = 10;

const PERSON = `u.id, u.display_name, u.avatar,
                rl.prefix_label, rl.color, rl.tooltip, ${FACULTY_COLUMNS}`;

const PERSON_JOIN = `JOIN users u ON u.id = s.user_id
                     LEFT JOIN role_labels rl ON rl.role = u.role
                     ${FACULTY_JOIN}`;

function person(row) {
    return {
        id: row.id,
        display_name: row.display_name,
        avatar: row.avatar,
        role_prefix: row.prefix_label
            ? { label: row.prefix_label, color: row.color, tooltip: row.tooltip }
            : null,
        faculty: facultyBadge(row.faculty),
    };
}

// ── Дейли ────────────────────────────────────────────────────────────────────

export async function dailyLeaderboard(userId) {
    const [top, mine] = await Promise.all([
        query(
            `SELECT ${PERSON}, s.total, s.days, s.best
               FROM geo_daily_scores s ${PERSON_JOIN}
              WHERE s.days > 0
              ORDER BY s.total DESC, s.days ASC, s.played_at
              LIMIT $1`,
            [TOP_LIMIT],
        ),
        query(
            `SELECT s.total, s.days, s.best,
                    (SELECT count(*) FROM geo_daily_scores o
                      WHERE o.days > 0
                        AND (o.total > s.total
                          OR (o.total = s.total AND o.days < s.days)
                          OR (o.total = s.total AND o.days = s.days AND o.played_at < s.played_at)))::int + 1 AS rank
               FROM geo_daily_scores s
              WHERE s.user_id = $1 AND s.days > 0`,
            [userId],
        ),
    ]);
    return {
        rows: top.rows.map((r, i) => ({
            rank: i + 1, ...person(r), total: r.total, days: r.days, best: r.best,
        })),
        me: mine.rows[0]
            ? { rank: mine.rows[0].rank, total: mine.rows[0].total, days: mine.rows[0].days, best: mine.rows[0].best }
            : null,
    };
}

/** Записать сыгранный день. Дейли играют раз в сутки, поэтому просто прибавляем. */
export async function addDailyResult(userId, score) {
    await query(
        `INSERT INTO geo_daily_scores (user_id, total, days, best, played_at)
              VALUES ($1, $2, 1, $2, now())
         ON CONFLICT (user_id) DO UPDATE SET
              total     = geo_daily_scores.total + EXCLUDED.total,
              days      = geo_daily_scores.days + 1,
              best      = GREATEST(geo_daily_scores.best, EXCLUDED.best),
              played_at = now()`,
        [userId, score],
    );
}

// ── Соло ─────────────────────────────────────────────────────────────────────

export async function soloLeaderboard(userId) {
    const [top, mine] = await Promise.all([
        query(
            `SELECT ${PERSON}, s.score, s.games
               FROM geo_solo_scores s ${PERSON_JOIN}
              WHERE s.games > 0
              ORDER BY s.score DESC, s.played_at
              LIMIT $1`,
            [TOP_LIMIT],
        ),
        query(
            `SELECT s.score, s.games,
                    (SELECT count(*) FROM geo_solo_scores o
                      WHERE o.games > 0
                        AND (o.score > s.score
                          OR (o.score = s.score AND o.played_at < s.played_at)))::int + 1 AS rank
               FROM geo_solo_scores s
              WHERE s.user_id = $1 AND s.games > 0`,
            [userId],
        ),
    ]);
    return {
        rows: top.rows.map((r, i) => ({ rank: i + 1, ...person(r), score: r.score, games: r.games })),
        me: mine.rows[0] ? { rank: mine.rows[0].rank, score: mine.rows[0].score, games: mine.rows[0].games } : null,
    };
}

/**
 * Записать доигранную соло-партию. Рекорд обновляется, только если он побит,
 * счётчик партий — всегда; improved считаем сравнением played_at с переданным
 * моментом, как в тетрисе (RETURNING видит только новую строку).
 */
export async function saveSolo(userId, score) {
    const now = new Date();
    const res = await query(
        `INSERT INTO geo_solo_scores (user_id, score, games, played_at)
              VALUES ($1, $2, 1, $3)
         ON CONFLICT (user_id) DO UPDATE SET
              games     = geo_solo_scores.games + 1,
              score     = GREATEST(geo_solo_scores.score, EXCLUDED.score),
              played_at = CASE WHEN EXCLUDED.score > geo_solo_scores.score
                               THEN EXCLUDED.played_at ELSE geo_solo_scores.played_at END
           RETURNING score, games, (played_at = $3) AS improved`,
        [userId, score, now],
    );
    const row = res.rows[0];
    return { best: row.score, games: row.games, improved: !!row.improved };
}

// ── Дуэль ────────────────────────────────────────────────────────────────────

export async function duelLeaderboard(userId) {
    const [top, mine] = await Promise.all([
        query(
            `SELECT ${PERSON}, s.pts, s.wins, s.losses
               FROM geo_duel_scores s ${PERSON_JOIN}
              WHERE s.wins > 0 OR s.losses > 0
              ORDER BY s.pts DESC, s.wins DESC, s.played_at
              LIMIT $1`,
            [TOP_LIMIT],
        ),
        query(
            `SELECT s.pts, s.wins, s.losses,
                    (SELECT count(*) FROM geo_duel_scores o
                      WHERE (o.wins > 0 OR o.losses > 0)
                        AND (o.pts > s.pts
                          OR (o.pts = s.pts AND o.wins > s.wins)
                          OR (o.pts = s.pts AND o.wins = s.wins AND o.played_at < s.played_at)))::int + 1 AS rank
               FROM geo_duel_scores s
              WHERE s.user_id = $1 AND (s.wins > 0 OR s.losses > 0)`,
            [userId],
        ),
    ]);
    return {
        rows: top.rows.map((r, i) => ({ rank: i + 1, ...person(r), pts: r.pts, wins: r.wins, losses: r.losses })),
        me: mine.rows[0]
            ? { rank: mine.rows[0].rank, pts: mine.rows[0].pts, wins: mine.rows[0].wins, losses: mine.rows[0].losses }
            : null,
    };
}

/**
 * Записать законченную дуэль: победителю +25, проигравшему −25.
 *
 * Обе строки одним запросом — половина результата не должна осесть в базе без
 * второй половины, партия кончается для двоих одновременно.
 */
export async function addDuelResult(winnerId, loserId, pts) {
    if (!winnerId || !loserId || winnerId === loserId) return;
    await query(
        // Знак у второго игрока ставим явным умножением: у голого «-$3» тип
        // параметра для Postgres неизвестен, и он спотыкается об унарный минус.
        `INSERT INTO geo_duel_scores (user_id, pts, wins, losses, played_at)
              VALUES ($1, $3::int, 1, 0, now()), ($2, $3::int * -1, 0, 1, now())
         ON CONFLICT (user_id) DO UPDATE SET
              pts       = geo_duel_scores.pts    + EXCLUDED.pts,
              wins      = geo_duel_scores.wins   + EXCLUDED.wins,
              losses    = geo_duel_scores.losses + EXCLUDED.losses,
              played_at = now()`,
        [winnerId, loserId, pts],
    );
}
