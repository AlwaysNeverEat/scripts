// Таблица очков дурака: одна строка на игрока — победы и поражения
// (см. db/migrations/033_durak.sql).
//
// Устроена как в бильярде (pool/scores.js) и по той же причине: это НЕ РЕКОРД, а
// счётчик встреч с живыми людьми. Отличие одно, и оно из правил: в дураке
// проигравший ровно один — тот, у кого остались карты, — а победителей может
// быть до трёх. Поэтому строка проигравшего одна, а строк победителей столько,
// сколько за столом было остальных.
//
// Ничья (вышли разом или карты пошли по кругу) не пишется вовсе: дурака не было,
// а «сыграл вничью» в таблице из двух чисел показать негде.

import { query } from '../db/client.js';
import { FACULTY_JOIN, FACULTY_COLUMNS, facultyBadge } from '../faculty/store.js';
import { SUPPORTER_JOIN, SUPPORTER_COLUMNS, supporterBadge } from '../supporter/badge.js';

export const TOP_LIMIT = 10;

// Имя, аватарка и плашки роли с факультетом — как во всех остальных топах:
// человек должен узнавать коллег одинаково везде.
const TOP_QUERY = `
  SELECT u.id, u.display_name, u.avatar,
         rl.prefix_label, rl.color, rl.tooltip, ${FACULTY_COLUMNS}, ${SUPPORTER_COLUMNS},
         s.wins, s.losses, s.played_at
    FROM durak_scores s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN role_labels rl ON rl.role = u.role
    ${FACULTY_JOIN}${SUPPORTER_JOIN}
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
        supporter: supporterBadge(row),
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
                    (SELECT count(*) FROM durak_scores o
                      WHERE o.wins > s.wins
                         OR (o.wins = s.wins AND o.losses < s.losses)
                         OR (o.wins = s.wins AND o.losses = s.losses AND o.played_at < s.played_at))::int + 1 AS rank
               FROM durak_scores s
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
 * Записать законченную партию: дураку поражение, всем остальным по победе.
 *
 * Одним запросом на всех, чтобы половина результата не могла осесть в базе без
 * второй половины: партия заканчивается одновременно для всех, кто за столом.
 * Партия с ботом сюда не приходит вовсе — она целиком живёт в браузере.
 */
export async function addResult(loserId, winnerIds) {
    const winners = (winnerIds || []).filter(id => id && id !== loserId);
    if (!loserId || !winners.length) return;
    await query(
        `INSERT INTO durak_scores (user_id, wins, losses, played_at)
              SELECT id, 1, 0, now() FROM unnest($2::uuid[]) AS w(id)
               UNION ALL
              SELECT $1, 0, 1, now()
         ON CONFLICT (user_id) DO UPDATE SET
              wins      = durak_scores.wins   + EXCLUDED.wins,
              losses    = durak_scores.losses + EXCLUDED.losses,
              played_at = now()`,
        [loserId, winners],
    );
}
