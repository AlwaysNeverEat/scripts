// Мини-топ пасхалки «Маджонг»: одна строка на игрока — его лучшее ВРЕМЯ
// (см. db/migrations/037_mahjong_scores.sql).
//
// Запросов здесь ровно два: список топа и upsert результата. Оба ходят в базу
// один раз за партию — это вся нагрузка, которую пасхалка создаёт.
//
// Устроено как у пасьянса (backend/src/solitaire/scores.js), включая главное
// отличие от тетриса и тройки: рекорд — МИНИМУМ. Поэтому LEAST вместо GREATEST,
// ASC вместо DESC и «строго меньше» там, где у соседей «строго больше».

import { query } from '../db/client.js';
import { FACULTY_JOIN, FACULTY_COLUMNS, facultyBadge } from '../faculty/store.js';

// Сколько строк показываем в окне игры. Больше десяти в модалку не влезает, а
// свою строку игрок увидит отдельно, даже если он двадцать пятый.
export const TOP_LIMIT = 10;

// Имя, аватарка и плашка роли — как в месячном топе (routes/top.js) и в топах
// остальных пасхалок: человек должен узнавать коллег одинаково везде. Id тоже
// уезжает в ответ — по нему строка топа открывает профиль.
const TOP_QUERY = `
  SELECT u.id, u.display_name, u.avatar,
         rl.prefix_label, rl.color, rl.tooltip, ${FACULTY_COLUMNS},
         s.seconds, s.shuffles, s.wins, s.played_at
    FROM mahjong_scores s
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
        shuffles: row.shuffles,
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
            `SELECT s.seconds, s.shuffles, s.wins,
                    (SELECT count(*) FROM mahjong_scores o
                      WHERE o.seconds < s.seconds
                         OR (o.seconds = s.seconds AND o.played_at < s.played_at))::int + 1 AS rank
               FROM mahjong_scores s
              WHERE s.user_id = $1`,
            [userId],
        ),
    ]);

    const rows = top.rows.map((row, i) => ({ rank: i + 1, ...presentRow(row) }));
    const me = mine.rows[0]
        ? {
            rank: mine.rows[0].rank,
            seconds: mine.rows[0].seconds,
            shuffles: mine.rows[0].shuffles,
            wins: mine.rows[0].wins,
        }
        : null;
    return { rows, me };
}

/**
 * Записать разобранную партию. Рекорд обновляется, только если время меньше
 * прежнего, счётчик разобранных — всегда.
 *
 * improved считаем сравнением played_at с тем моментом, который сами же и
 * передали: RETURNING в ON CONFLICT видит только НОВУЮ строку, старого времени
 * в нём уже нет, а лишний SELECT ради одного «побил/не побил» тут не нужен.
 */
export async function saveRun(userId, { seconds, shuffles }) {
    const now = new Date();
    const res = await query(
        `INSERT INTO mahjong_scores (user_id, seconds, shuffles, wins, played_at)
              VALUES ($1, $2, $3, 1, $4)
         ON CONFLICT (user_id) DO UPDATE SET
              wins      = mahjong_scores.wins + 1,
              seconds   = LEAST(mahjong_scores.seconds, EXCLUDED.seconds),
              shuffles  = CASE WHEN EXCLUDED.seconds < mahjong_scores.seconds THEN EXCLUDED.shuffles  ELSE mahjong_scores.shuffles  END,
              played_at = CASE WHEN EXCLUDED.seconds < mahjong_scores.seconds THEN EXCLUDED.played_at ELSE mahjong_scores.played_at END
           RETURNING seconds, wins, (played_at = $4) AS improved`,
        [userId, seconds, shuffles, now],
    );
    const row = res.rows[0];
    return { best: row.seconds, wins: row.wins, improved: !!row.improved };
}
