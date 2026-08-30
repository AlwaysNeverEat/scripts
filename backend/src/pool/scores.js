// Таблица очков бильярда: одна строка на игрока — победы и поражения
// (см. db/migrations/028_pool.sql).
//
// От мини-топов тетриса, тройки и пасьянса отличается тем, что здесь НЕ РЕКОРД,
// а счётчик: там строка — лучший результат одного человека, здесь — история его
// встреч с другими. Поэтому и обновляется она не «если лучше прежнего», а всегда
// и сразу у ДВОИХ: партия заканчивается одновременно для победителя и
// проигравшего, и записывать её двумя отдельными запросами было бы гонкой.

import { query } from '../db/client.js';
import { FACULTY_JOIN, FACULTY_COLUMNS, facultyBadge } from '../faculty/store.js';

export const TOP_LIMIT = 10;

// Имя, аватарка и плашка роли — как во всех остальных топах: человек должен
// узнавать коллег одинаково везде.
const TOP_QUERY = `
  SELECT u.id, u.display_name, u.avatar,
         rl.prefix_label, rl.color, rl.tooltip, ${FACULTY_COLUMNS},
         s.wins, s.losses, s.played_at
    FROM pool_scores s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN role_labels rl ON rl.role = u.role
    ${FACULTY_JOIN}
   WHERE s.wins > 0 OR s.losses > 0
   ORDER BY s.wins DESC, s.losses ASC, s.played_at
   LIMIT $1`;

function presentRow(row) {
    return {
        id: row.id,
        display_name: row.display_name,
        avatar: row.avatar,
        role_prefix: row.prefix_label
            ? { label: row.prefix_label, color: row.color, tooltip: row.tooltip }
            : null,
        faculty: facultyBadge(row.faculty),
        wins: row.wins,
        losses: row.losses,
    };
}

/**
 * Таблица и строка самого игрока.
 *
 * Своя строка возвращается всегда, даже если игрок не попал в десятку: место
 * считается одним COUNT (сколько игроков строго выше), а не выборкой всей
 * таблицы с нумерацией.
 */
export async function leaderboard(userId) {
    const [top, mine] = await Promise.all([
        query(TOP_QUERY, [TOP_LIMIT]),
        query(
            `SELECT s.wins, s.losses,
                    (SELECT count(*) FROM pool_scores o
                      WHERE o.wins > s.wins
                         OR (o.wins = s.wins AND o.losses < s.losses)
                         OR (o.wins = s.wins AND o.losses = s.losses AND o.played_at < s.played_at))::int + 1 AS rank
               FROM pool_scores s
              WHERE s.user_id = $1`,
            [userId],
        ),
    ]);

    const rows = top.rows.map((row, i) => ({ rank: i + 1, ...presentRow(row) }));
    const me = mine.rows[0]
        ? { rank: mine.rows[0].rank, wins: mine.rows[0].wins, losses: mine.rows[0].losses }
        : null;
    return { rows, me };
}

/**
 * Записать законченную партию: победителю очко, проигравшему поражение.
 *
 * Оба обновления — одним запросом, чтобы половина результата не могла осесть в
 * базе без второй половины. Партия с ботом сюда не приходит вовсе: она целиком
 * живёт в браузере и в таблицу не идёт (см. шапку миграции).
 */
export async function addResult(winnerId, loserId) {
    if (!winnerId || !loserId || winnerId === loserId) return;
    await query(
        `INSERT INTO pool_scores (user_id, wins, losses, played_at)
              VALUES ($1, 1, 0, now()), ($2, 0, 1, now())
         ON CONFLICT (user_id) DO UPDATE SET
              wins      = pool_scores.wins   + EXCLUDED.wins,
              losses    = pool_scores.losses + EXCLUDED.losses,
              played_at = now()`,
        [winnerId, loserId],
    );
}
