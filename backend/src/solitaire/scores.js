// Мини-топ пасхалки «Пасьянс»: одна строка на игрока — его лучшее ВРЕМЯ
// (см. db/migrations/027_solitaire_scores.sql).
//
// Запросов здесь ровно два: список топа и upsert результата. Оба ходят в базу
// один раз за партию — это вся нагрузка, которую пасхалка создаёт.
//
// Отличие от тетриса и тройки одно, но сквозное: рекорд — МИНИМУМ. Поэтому
// LEAST вместо GREATEST, ASC вместо DESC и «строго меньше» там, где у соседей
// «строго больше».

import { query } from '../db/client.js';
import { FACULTY_JOIN, FACULTY_COLUMNS, facultyBadge } from '../faculty/store.js';

// Сколько строк показываем в окне игры. Больше десяти в модалку не влезает, а
// свою строку игрок увидит отдельно, даже если он двадцать пятый.
export const TOP_LIMIT = 10;

// Имя, аватарка и плашка роли — как в месячном топе (routes/top.js) и в топах
// тетриса и тройки: человек должен узнавать коллег одинаково везде.
const TOP_QUERY = `
  SELECT u.id, u.display_name, u.avatar,
         rl.prefix_label, rl.color, rl.tooltip, ${FACULTY_COLUMNS},
         s.seconds, s.moves, s.redeals, s.wins, s.played_at
    FROM solitaire_scores s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN role_labels rl ON rl.role = u.role
    ${FACULTY_JOIN}
   ORDER BY s.seconds, s.played_at
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
        seconds: row.seconds,
        moves: row.moves,
        redeals: row.redeals,
        wins: row.wins,
    };
}

/**
 * Топ и строка самого игрока.
 *
 * Своя строка возвращается всегда, даже если игрок не попал в десятку: место
 * считается одним COUNT по индексу (сколько результатов строго лучше), а не
 * выборкой всей таблицы с нумерацией.
 */
export async function leaderboard(userId) {
    const [top, mine] = await Promise.all([
        query(TOP_QUERY, [TOP_LIMIT]),
        query(
            `SELECT s.seconds, s.moves, s.redeals, s.wins,
                    (SELECT count(*) FROM solitaire_scores o
                      WHERE o.seconds < s.seconds
                         OR (o.seconds = s.seconds AND o.played_at < s.played_at))::int + 1 AS rank
               FROM solitaire_scores s
              WHERE s.user_id = $1`,
            [userId],
        ),
    ]);

    const rows = top.rows.map((row, i) => ({ rank: i + 1, ...presentRow(row) }));
    const me = mine.rows[0]
        ? {
            rank: mine.rows[0].rank,
            seconds: mine.rows[0].seconds,
            moves: mine.rows[0].moves,
            redeals: mine.rows[0].redeals,
            wins: mine.rows[0].wins,
        }
        : null;
    return { rows, me };
}

/**
 * Записать разложенную партию. Рекорд обновляется, только если время меньше
 * прежнего, счётчик разложенных — всегда.
 *
 * improved считаем сравнением played_at с тем моментом, который сами же и
 * передали: RETURNING в ON CONFLICT видит только НОВУЮ строку, старого времени
 * в нём уже нет, а лишний SELECT ради одного «побил/не побил» тут не нужен.
 */
export async function saveRun(userId, { seconds, moves, redeals }) {
    const now = new Date();
    const res = await query(
        `INSERT INTO solitaire_scores (user_id, seconds, moves, redeals, wins, played_at)
              VALUES ($1, $2, $3, $4, 1, $5)
         ON CONFLICT (user_id) DO UPDATE SET
              wins      = solitaire_scores.wins + 1,
              seconds   = LEAST(solitaire_scores.seconds, EXCLUDED.seconds),
              moves     = CASE WHEN EXCLUDED.seconds < solitaire_scores.seconds THEN EXCLUDED.moves     ELSE solitaire_scores.moves     END,
              redeals   = CASE WHEN EXCLUDED.seconds < solitaire_scores.seconds THEN EXCLUDED.redeals   ELSE solitaire_scores.redeals   END,
              played_at = CASE WHEN EXCLUDED.seconds < solitaire_scores.seconds THEN EXCLUDED.played_at ELSE solitaire_scores.played_at END
           RETURNING seconds, wins, (played_at = $5) AS improved`,
        [userId, seconds, moves, redeals, now],
    );
    const row = res.rows[0];
    return { best: row.seconds, wins: row.wins, improved: !!row.improved };
}
