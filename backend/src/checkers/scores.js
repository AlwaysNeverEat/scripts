// Таблица очков шашек: одна строка на игрока — победы, ничьи и поражения
// (см. db/migrations/038_checkers.sql).
//
// От мини-топов тетриса, тройки и пасьянса отличается тем же, чем таблицы
// бильярда, дурака и морского боя: здесь НЕ РЕКОРД, а счётчик встреч с другими.
// Поэтому строка обновляется не «если лучше прежнего», а всегда и сразу у
// ДВОИХ: партия заканчивается одновременно для обоих, и записывать её двумя
// отдельными запросами было бы гонкой.
//
// НИЧЬЯ — ТРЕТЬЯ КОЛОНКА, КОТОРОЙ НЕТ НИ У ОДНОЙ ДРУГОЙ ПАСХАЛКИ, потому что ни
// в одной из них ничьей не бывает вовсе. В шашках она законный исход, и
// показывать её надо; а вот на МЕСТО в таблице она не влияет сознательно —
// половина победы за ничью поощряет размен до голых дамок.

import { query } from '../db/client.js';
import { FACULTY_JOIN, FACULTY_COLUMNS, facultyBadge } from '../faculty/store.js';
import { SUPPORTER_JOIN, SUPPORTER_COLUMNS, supporterBadge } from '../supporter/badge.js';

export const TOP_LIMIT = 10;

// Имя, аватарка и плашка роли — как во всех остальных топах: человек должен
// узнавать коллег одинаково везде.
const TOP_QUERY = `
  SELECT u.id, u.display_name, u.avatar,
         rl.prefix_label, rl.color, rl.tooltip, ${FACULTY_COLUMNS}, ${SUPPORTER_COLUMNS},
         s.wins, s.draws, s.losses, s.played_at
    FROM checkers_scores s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN role_labels rl ON rl.role = u.role
    ${FACULTY_JOIN}${SUPPORTER_JOIN}
   WHERE s.wins > 0 OR s.losses > 0 OR s.draws > 0
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
        draws: row.draws,
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
            `SELECT s.wins, s.draws, s.losses,
                    (SELECT count(*) FROM checkers_scores o
                      WHERE o.wins > s.wins
                         OR (o.wins = s.wins AND o.losses < s.losses)
                         OR (o.wins = s.wins AND o.losses = s.losses AND o.played_at < s.played_at))::int + 1 AS rank
               FROM checkers_scores s
              WHERE s.user_id = $1`,
            [userId],
        ),
    ]);

    const rows = top.rows.map((row, i) => ({ rank: i + 1, ...presentRow(row) }));
    const row = mine.rows[0];
    const me = row
        ? { rank: row.rank, wins: row.wins, draws: row.draws, losses: row.losses }
        : null;
    return { rows, me };
}

/**
 * Записать законченную партию.
 *
 * Оба обновления — одним запросом, чтобы половина результата не могла осесть в
 * базе без второй половины. Партия с ботом сюда не приходит вовсе: она целиком
 * живёт в браузере и в таблицу не идёт (см. шапку миграции).
 */
export async function addResult(winnerId, loserId) {
    if (!winnerId || !loserId || winnerId === loserId) return;
    await query(
        `INSERT INTO checkers_scores (user_id, wins, losses, played_at)
              VALUES ($1, 1, 0, now()), ($2, 0, 1, now())
         ON CONFLICT (user_id) DO UPDATE SET
              wins      = checkers_scores.wins   + EXCLUDED.wins,
              losses    = checkers_scores.losses + EXCLUDED.losses,
              played_at = now()`,
        [winnerId, loserId],
    );
}

/** Ничья: обоим по строчке в третью колонку, места в таблице она не двигает. */
export async function addDraw(oneId, twoId) {
    if (!oneId || !twoId || oneId === twoId) return;
    await query(
        `INSERT INTO checkers_scores (user_id, draws, played_at)
              VALUES ($1, 1, now()), ($2, 1, now())
         ON CONFLICT (user_id) DO UPDATE SET
              draws     = checkers_scores.draws + 1,
              played_at = now()`,
        [oneId, twoId],
    );
}
