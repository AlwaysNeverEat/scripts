import { Router } from 'express';
import { query } from '../db/client.js';
import { requireRole } from '../auth/middleware.js';

const router = Router();

// ── GET /api/users?q= ─────────────────────────────────────────────────────────
// Список пользователей для модалки «Назначить ответственного». Только для
// mod/admin — обычным пользователям перебирать список аккаунтов незачем.

router.get('/', requireRole('mod', 'admin'), async (req, res) => {
  const q = String(req.query.q || '').trim();
  try {
    const params = [];
    let where = '';
    if (q) {
      params.push(`%${q}%`);
      where = `WHERE u.display_name ILIKE $1 OR u.login ILIKE $1`;
    }
    const r = await query(
      `SELECT u.id, u.display_name, u.avatar,
              rl.prefix_label, rl.color, rl.tooltip
         FROM users u
         LEFT JOIN role_labels rl ON rl.role = u.role
        ${where}
        ORDER BY u.display_name
        LIMIT 20`,
      params,
    );
    res.json(r.rows.map(row => ({
      id: row.id,
      display_name: row.display_name,
      avatar: row.avatar,
      role_prefix: row.prefix_label
        ? { label: row.prefix_label, color: row.color, tooltip: row.tooltip }
        : null,
    })));
  } catch (err) {
    console.error('GET /api/users', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/users/:id/public ─────────────────────────────────────────────────
// Публичный (read-only) профиль ЧУЖОГО пользователя — для клика по строке в
// топе и по автору в ленте машины. Ничего чувствительного (логин/роль как
// таковая тут не нужна) — только то, что уже и так видно на сайте.

router.get('/:id/public', async (req, res) => {
  try {
    const userR = await query(
      `SELECT u.id, u.display_name, u.avatar, rl.prefix_label, rl.color, rl.tooltip
         FROM users u
         LEFT JOIN role_labels rl ON rl.role = u.role
        WHERE u.id = $1`,
      [req.params.id],
    );
    if (!userR.rows.length) return res.status(404).json({ error: 'not found' });
    const row = userR.rows[0];

    // edited — по МАШИНАМ (DISTINCT car_id), не по числу правок: 100 правок
    // одной машины = 1 отредактированная машина.
    const statsR = await query(
      `SELECT
         count(*)               FILTER (WHERE type = 'added')  ::int AS added,
         count(DISTINCT car_id) FILTER (WHERE type = 'edited') ::int AS edited
       FROM car_events WHERE user_id = $1`,
      [req.params.id],
    );
    const stats = statsR.rows[0];

    res.json({
      id: row.id,
      display_name: row.display_name,
      avatar: row.avatar,
      role_prefix: row.prefix_label
        ? { label: row.prefix_label, color: row.color, tooltip: row.tooltip }
        : null,
      stats,
    });
  } catch (err) {
    console.error('GET /api/users/:id/public', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
