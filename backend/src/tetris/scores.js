// Мини-топ пасхалки «Тетрис»: одна строка на игрока — его рекорд
// (см. db/migrations/025_tetris_scores.sql).
//
// Запросов здесь ровно два: список топа и upsert результата. Оба ходят в базу
// один раз за партию — это вся нагрузка, которую пасхалка создаёт.

import { query } from '../db/client.js';
import { FACULTY_JOIN, FACULTY_COLUMNS, facultyBadge } from '../faculty/store.js';
import { SUPPORTER_JOIN, SUPPORTER_COLUMNS, supporterBadge } from '../supporter/badge.js';

// Сколько строк показываем в окне игры. Больше десяти в модалку не влезает, а
// свою строку игрок увидит отдельно, даже если он двадцать пятый.
export const TOP_LIMIT = 10;

// Имя, аватарка и плашка роли — как в месячном топе (routes/top.js): человек
// должен узнавать коллег одинаково везде.
const TOP_QUERY = `
  SELECT u.id, u.display_name, u.avatar,
         rl.prefix_label, rl.color, rl.tooltip, ${FACULTY_COLUMNS}, ${SUPPORTER_COLUMNS},
         t.score, t.lines, t.level, t.games, t.played_at
    FROM tetris_scores t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN role_labels rl ON rl.role = u.role
    ${FACULTY_JOIN}${SUPPORTER_JOIN}
   ORDER BY t.score DESC, t.played_at
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
        supporter: supporterBadge(row),
        score: row.score,
        lines: row.lines,
        level: row.level,
        games: row.games,
    };
}

/**
 * Топ и строка самого игрока.
 *
 * Своя строка возвращается всегда, даже если игрок не попал в десятку: место
 * считается одним COUNT по индексу (сколько результатов строго выше), а не
 * выборкой всей таблицы с нумерацией.
 */
export async function leaderboard(userId) {
    const [top, mine] = await Promise.all([
        query(TOP_QUERY, [TOP_LIMIT]),
        query(
            `SELECT t.score, t.lines, t.level, t.games,
                    (SELECT count(*) FROM tetris_scores o
                      WHERE o.score > t.score
                         OR (o.score = t.score AND o.played_at < t.played_at))::int + 1 AS rank
               FROM tetris_scores t
              WHERE t.user_id = $1`,
            [userId],
        ),
    ]);

    const rows = top.rows.map((row, i) => ({ rank: i + 1, ...presentRow(row) }));
    const me = mine.rows[0]
        ? {
            rank: mine.rows[0].rank,
            score: mine.rows[0].score,
            lines: mine.rows[0].lines,
            level: mine.rows[0].level,
            games: mine.rows[0].games,
        }
        : null;
    return { rows, me };
}

/**
 * Записать доигранную партию. Рекорд обновляется только если он побит, счётчик
 * партий — всегда.
 *
 * improved считаем сравнением played_at с тем моментом, который сами же и
 * передали: RETURNING в ON CONFLICT видит только НОВУЮ строку, старого счёта в
 * нём уже нет, а лишний SELECT ради одного «побил/не побил» тут не нужен.
 */
export async function saveRun(userId, { score, lines, level, seconds }) {
    const now = new Date();
    const res = await query(
        `INSERT INTO tetris_scores (user_id, score, lines, level, seconds, games, played_at)
              VALUES ($1, $2, $3, $4, $5, 1, $6)
         ON CONFLICT (user_id) DO UPDATE SET
              games     = tetris_scores.games + 1,
              score     = GREATEST(tetris_scores.score, EXCLUDED.score),
              lines     = CASE WHEN EXCLUDED.score > tetris_scores.score THEN EXCLUDED.lines   ELSE tetris_scores.lines   END,
              level     = CASE WHEN EXCLUDED.score > tetris_scores.score THEN EXCLUDED.level   ELSE tetris_scores.level   END,
              seconds   = CASE WHEN EXCLUDED.score > tetris_scores.score THEN EXCLUDED.seconds ELSE tetris_scores.seconds END,
              played_at = CASE WHEN EXCLUDED.score > tetris_scores.score THEN EXCLUDED.played_at ELSE tetris_scores.played_at END
           RETURNING score, games, (played_at = $6) AS improved`,
        [userId, score, lines, level, seconds, now],
    );
    const row = res.rows[0];
    return { best: row.score, games: row.games, improved: !!row.improved };
}
