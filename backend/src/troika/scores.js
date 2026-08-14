// Мини-топ пасхалки «Тройка»: одна строка на игрока — его рекорд
// (см. db/migrations/026_troika_scores.sql).
//
// Запросов здесь ровно два: список топа и upsert результата. Оба ходят в базу
// один раз за партию — это вся нагрузка, которую пасхалка создаёт.

import { query } from '../db/client.js';

// Сколько строк показываем в окне игры. Больше десяти в модалку не влезает, а
// свою строку игрок увидит отдельно, даже если он двадцать пятый.
export const TOP_LIMIT = 10;

// Имя, аватарка и плашка роли — как в месячном топе (routes/top.js) и в топе
// тетриса: человек должен узнавать коллег одинаково везде.
const TOP_QUERY = `
  SELECT u.id, u.display_name, u.avatar,
         rl.prefix_label, rl.color, rl.tooltip,
         t.score, t.level, t.clocks, t.best_cascade, t.games, t.played_at
    FROM troika_scores t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN role_labels rl ON rl.role = u.role
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
        score: row.score,
        level: row.level,
        clocks: row.clocks,
        cascade: row.best_cascade,
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
            `SELECT t.score, t.level, t.clocks, t.best_cascade, t.games,
                    (SELECT count(*) FROM troika_scores o
                      WHERE o.score > t.score
                         OR (o.score = t.score AND o.played_at < t.played_at))::int + 1 AS rank
               FROM troika_scores t
              WHERE t.user_id = $1`,
            [userId],
        ),
    ]);

    const rows = top.rows.map((row, i) => ({ rank: i + 1, ...presentRow(row) }));
    const me = mine.rows[0]
        ? {
            rank: mine.rows[0].rank,
            score: mine.rows[0].score,
            level: mine.rows[0].level,
            clocks: mine.rows[0].clocks,
            cascade: mine.rows[0].best_cascade,
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
export async function saveRun(userId, { score, level, moves, tiles, clocks, cascade, seconds }) {
    // Наружу поле зовётся cascade (так его шлёт браузер и так оно уезжает в JSON
    // топа), в базе — best_cascade: см. миграцию.
    const now = new Date();
    const res = await query(
        `INSERT INTO troika_scores
                (user_id, score, level, moves, tiles, clocks, best_cascade, seconds, games, played_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9)
         ON CONFLICT (user_id) DO UPDATE SET
              games     = troika_scores.games + 1,
              score     = GREATEST(troika_scores.score, EXCLUDED.score),
              level     = CASE WHEN EXCLUDED.score > troika_scores.score THEN EXCLUDED.level     ELSE troika_scores.level     END,
              moves     = CASE WHEN EXCLUDED.score > troika_scores.score THEN EXCLUDED.moves     ELSE troika_scores.moves     END,
              tiles     = CASE WHEN EXCLUDED.score > troika_scores.score THEN EXCLUDED.tiles     ELSE troika_scores.tiles     END,
              clocks    = CASE WHEN EXCLUDED.score > troika_scores.score THEN EXCLUDED.clocks    ELSE troika_scores.clocks    END,
              best_cascade = CASE WHEN EXCLUDED.score > troika_scores.score THEN EXCLUDED.best_cascade ELSE troika_scores.best_cascade END,
              seconds   = CASE WHEN EXCLUDED.score > troika_scores.score THEN EXCLUDED.seconds   ELSE troika_scores.seconds   END,
              played_at = CASE WHEN EXCLUDED.score > troika_scores.score THEN EXCLUDED.played_at ELSE troika_scores.played_at END
           RETURNING score, games, (played_at = $9) AS improved`,
        [userId, score, level, moves, tiles, clocks, cascade, seconds, now],
    );
    const row = res.rows[0];
    return { best: row.score, games: row.games, improved: !!row.improved };
}
