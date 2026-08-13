// Победы в сапёре и месячный мини-топ.
//
// Мерка месяца та же, что у топа по записям (routes/top.js): календарный месяц
// по МСК, поэтому 1-го числа мини-топ начинается с нуля сам собой, а прошлый
// месяц никуда не девается.

import { query } from '../db/client.js';

const MSK_NOW = `(now() AT TIME ZONE 'Europe/Moscow')`;

// Сортировка: сначала по числу побед, при равенстве — по лучшему времени, и
// только потом по имени, чтобы порядок не «плавал» между запросами.
const TOP_QUERY = `
  SELECT u.id, u.display_name, u.avatar,
         rl.prefix_label, rl.color, rl.tooltip,
         count(*)::int   AS wins,
         min(w.seconds)::int AS best_seconds
    FROM minesweeper_wins w
    JOIN users u ON u.id = w.user_id
    LEFT JOIN role_labels rl ON rl.role = u.role
   WHERE w.month = $1
   GROUP BY u.id, rl.prefix_label, rl.color, rl.tooltip
   ORDER BY count(*) DESC, min(w.seconds), u.display_name
   LIMIT $2`;

function presentRow(row, rank) {
    return {
        rank,
        id: row.id,
        display_name: row.display_name,
        avatar: row.avatar,
        role_prefix: row.prefix_label
            ? { label: row.prefix_label, color: row.color, tooltip: row.tooltip }
            : null,
        wins: row.wins || 0,
        best_seconds: row.best_seconds ?? null,
    };
}

export async function currentMonth() {
    const res = await query(`SELECT to_char(${MSK_NOW}, 'YYYY-MM') AS month`);
    return res.rows[0].month;
}

export async function recordWin(userId, seconds) {
    await query(
        'INSERT INTO minesweeper_wins (user_id, seconds) VALUES ($1, $2)',
        [userId, Math.max(0, Math.round(seconds))],
    );
}

/**
 * Мини-топ месяца: первые limit мест плюс своя строка отдельно — она нужна и
 * тому, кто в двадцатку не попал (иначе топ выглядит как «меня там нет»).
 */
export async function monthlyTop(userId, limit = 10) {
    const month = await currentMonth();
    const { rows } = await query(TOP_QUERY, [month, 200]);
    const all = rows.map((row, i) => presentRow(row, i + 1));
    const me = all.find(r => r.id === userId) || null;
    return { month, rows: all.slice(0, limit), me };
}
