// Мини-топ пасхалки «Рогалик»: одна строка на игрока — его лучший забег
// (см. db/migrations/034_roguelike.sql).
//
// Запросов здесь ровно два: список топа и upsert результата. Оба ходят в базу
// один раз за забег — это вся нагрузка, которую пасхалка создаёт.
//
// Место считается по ПАРЕ (циклы, узлы): циклы — то, ради чего в эту игру
// играют, узлы — то, чем различаются два одинаково глубоких забега.

import { query } from '../db/client.js';
import { FACULTY_JOIN, FACULTY_COLUMNS, facultyBadge } from '../faculty/store.js';

// Сколько строк показываем в окне игры. Больше десяти в модалку не влезает, а
// свою строку игрок увидит отдельно, даже если он двадцать пятый.
export const TOP_LIMIT = 10;

// Имя, аватарка и плашка роли — как в месячном топе (routes/top.js) и в топах
// остальных пасхалок: человек должен узнавать коллег одинаково везде.
const TOP_QUERY = `
  SELECT u.id, u.display_name, u.avatar,
         rl.prefix_label, rl.color, rl.tooltip, ${FACULTY_COLUMNS},
         r.loops, r.floor, r.kills, r.elites, r.bosses,
         r.cards, r.best_level, r.mutations, r.runs, r.played_at
    FROM roguelike_scores r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN role_labels rl ON rl.role = u.role
    ${FACULTY_JOIN}
   ORDER BY r.loops DESC, r.floor DESC, r.played_at
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
        loops: row.loops,
        floor: row.floor,
        kills: row.kills,
        elites: row.elites,
        bosses: row.bosses,
        cards: row.cards,
        level: row.best_level,
        mutations: row.mutations,
        runs: row.runs,
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
            `SELECT r.loops, r.floor, r.kills, r.elites, r.bosses,
                    r.cards, r.best_level, r.mutations, r.runs,
                    (SELECT count(*) FROM roguelike_scores o
                      WHERE (o.loops, o.floor) > (r.loops, r.floor)
                         OR (o.loops = r.loops AND o.floor = r.floor AND o.played_at < r.played_at))::int + 1 AS rank
               FROM roguelike_scores r
              WHERE r.user_id = $1`,
            [userId],
        ),
    ]);

    const rows = top.rows.map((row, i) => ({ rank: i + 1, ...presentRow(row) }));
    const m = mine.rows[0];
    const me = m
        ? {
            rank: m.rank,
            loops: m.loops,
            floor: m.floor,
            kills: m.kills,
            elites: m.elites,
            bosses: m.bosses,
            cards: m.cards,
            level: m.best_level,
            mutations: m.mutations,
            runs: m.runs,
        }
        : null;
    return { rows, me };
}

/**
 * Записать доигранный забег. Рекорд обновляется только если он побит, счётчик
 * забегов — всегда.
 *
 * «Побит» — это сравнение ПАРЫ (циклы, узлы) построчным сравнением Postgres:
 * два цикла и семь узлов лучше двух циклов и трёх, и хуже трёх циклов с одним.
 *
 * improved считаем сравнением played_at с тем моментом, который сами же и
 * передали: RETURNING в ON CONFLICT видит только НОВУЮ строку, старого рекорда в
 * нём уже нет, а лишний SELECT ради одного «побил/не побил» тут не нужен.
 */
export async function saveRun(userId, { loops, floor, kills, elites, bosses, cards, level, mutations, seconds }) {
    const now = new Date();
    const res = await query(
        `INSERT INTO roguelike_scores
                (user_id, loops, floor, kills, elites, bosses, cards, best_level, mutations, seconds, runs, played_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11)
         ON CONFLICT (user_id) DO UPDATE SET
              runs       = roguelike_scores.runs + 1,
              loops      = CASE WHEN (EXCLUDED.loops, EXCLUDED.floor) > (roguelike_scores.loops, roguelike_scores.floor) THEN EXCLUDED.loops      ELSE roguelike_scores.loops      END,
              floor      = CASE WHEN (EXCLUDED.loops, EXCLUDED.floor) > (roguelike_scores.loops, roguelike_scores.floor) THEN EXCLUDED.floor      ELSE roguelike_scores.floor      END,
              kills      = CASE WHEN (EXCLUDED.loops, EXCLUDED.floor) > (roguelike_scores.loops, roguelike_scores.floor) THEN EXCLUDED.kills      ELSE roguelike_scores.kills      END,
              elites     = CASE WHEN (EXCLUDED.loops, EXCLUDED.floor) > (roguelike_scores.loops, roguelike_scores.floor) THEN EXCLUDED.elites     ELSE roguelike_scores.elites     END,
              bosses     = CASE WHEN (EXCLUDED.loops, EXCLUDED.floor) > (roguelike_scores.loops, roguelike_scores.floor) THEN EXCLUDED.bosses     ELSE roguelike_scores.bosses     END,
              cards      = CASE WHEN (EXCLUDED.loops, EXCLUDED.floor) > (roguelike_scores.loops, roguelike_scores.floor) THEN EXCLUDED.cards      ELSE roguelike_scores.cards      END,
              best_level = CASE WHEN (EXCLUDED.loops, EXCLUDED.floor) > (roguelike_scores.loops, roguelike_scores.floor) THEN EXCLUDED.best_level ELSE roguelike_scores.best_level END,
              mutations  = CASE WHEN (EXCLUDED.loops, EXCLUDED.floor) > (roguelike_scores.loops, roguelike_scores.floor) THEN EXCLUDED.mutations  ELSE roguelike_scores.mutations  END,
              seconds    = CASE WHEN (EXCLUDED.loops, EXCLUDED.floor) > (roguelike_scores.loops, roguelike_scores.floor) THEN EXCLUDED.seconds    ELSE roguelike_scores.seconds    END,
              played_at  = CASE WHEN (EXCLUDED.loops, EXCLUDED.floor) > (roguelike_scores.loops, roguelike_scores.floor) THEN EXCLUDED.played_at  ELSE roguelike_scores.played_at  END
           RETURNING loops, floor, runs, (played_at = $11) AS improved`,
        [userId, loops, floor, kills, elites, bosses, cards, level, mutations, seconds, now],
    );
    const row = res.rows[0];
    return { best: { loops: row.loops, floor: row.floor }, runs: row.runs, improved: !!row.improved };
}
