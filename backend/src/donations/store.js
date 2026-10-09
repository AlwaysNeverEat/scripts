// ─────────────────────────────────────────────────────────────────────────────
// Поддержавшие проект — хранение. Правила (кто вносит, какая сумма и дата
// правильные, порядок в списке) — shared/donations.js, таблица — миграция
// 044_donations.sql.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../db/client.js';
import { FACULTY_JOIN, FACULTY_COLUMNS, facultyBadge } from '../faculty/store.js';

const publicUser = (row) => ({
    id: row.id,
    display_name: row.display_name,
    avatar: row.avatar,
    role_prefix: row.prefix_label
        ? { label: row.prefix_label, color: row.color, tooltip: row.tooltip }
        : null,
    faculty: facultyBadge(row.faculty),
});

/**
 * Список поддержавших: всего, за месяц и день последнего пополнения.
 * Порядок — как в sortDonors (shared/donations.js): всего ↓, месяц ↓,
 * последнее пополнение ↓. Суммы — bigint, в JSON уходят числами.
 */
export async function listDonors(month, { db = query } = {}) {
    const { rows } = await db(
        `SELECT u.id, u.display_name, u.avatar,
                rl.prefix_label, rl.color, rl.tooltip, ${FACULTY_COLUMNS},
                SUM(d.amount_rub)::bigint AS total,
                COALESCE(SUM(d.amount_rub) FILTER (WHERE to_char(d.donated_on, 'YYYY-MM') = $1), 0)::bigint AS month,
                to_char(MAX(d.donated_on), 'YYYY-MM-DD') AS last
           FROM donations d
           JOIN users u ON u.id = d.user_id
           LEFT JOIN role_labels rl ON rl.role = u.role
           ${FACULTY_JOIN}
          GROUP BY u.id, u.display_name, u.avatar, rl.prefix_label, rl.color, rl.tooltip, ${FACULTY_COLUMNS}
          ORDER BY total DESC, month DESC, last DESC`,
        [month],
    );
    return rows.map(r => ({ ...publicUser(r), total: Number(r.total), month: Number(r.month), last: r.last }));
}

// Пополнения по одному — для окна внесения: свежие сверху.
export async function listEntries({ limit = 200, db = query } = {}) {
    const { rows } = await db(
        `SELECT d.id::text AS id, d.amount_rub, to_char(d.donated_on, 'YYYY-MM-DD') AS date,
                u.id AS user_id, u.display_name
           FROM donations d
           JOIN users u ON u.id = d.user_id
          ORDER BY d.donated_on DESC, d.id DESC
          LIMIT $1`,
        [limit],
    );
    return rows.map(r => ({ id: r.id, amount: r.amount_rub, date: r.date, userId: r.user_id, name: r.display_name }));
}

/** @returns {Promise<object|null>} null — такого человека нет */
export async function addEntry({ userId, date, amount, createdBy }, { db = query } = {}) {
    const { rows } = await db(
        `INSERT INTO donations (user_id, amount_rub, donated_on, created_by)
         SELECT u.id, $2, $3::date, $4 FROM users u WHERE u.id = $1
         RETURNING id::text AS id, amount_rub, to_char(donated_on, 'YYYY-MM-DD') AS date, user_id`,
        [userId, amount, date, createdBy],
    );
    const r = rows[0];
    return r ? { id: r.id, amount: r.amount_rub, date: r.date, userId: r.user_id } : null;
}

export async function deleteEntry(id, { db = query } = {}) {
    const { rowCount } = await db('DELETE FROM donations WHERE id = $1', [id]);
    return rowCount > 0;
}

// Кого можно выбрать в окне внесения: поиск по имени и логину. Общий список
// пользователей (/api/users) открыт только модераторам, а вносящий
// модератором быть не обязан.
export async function searchUsers(q, { db = query } = {}) {
    const { rows } = await db(
        `SELECT u.id, u.display_name, u.login
           FROM users u
          WHERE u.banned_at IS NULL AND ($1 = '' OR u.display_name ILIKE $2 OR u.login ILIKE $2)
          ORDER BY u.display_name
          LIMIT 20`,
        [q, `%${q}%`],
    );
    return rows.map(r => ({ id: r.id, name: r.display_name, login: r.login }));
}
