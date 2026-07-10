import { Router } from 'express';
import { query } from '../db/client.js';

const router = Router();

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

    const statsR = await query(
      `SELECT type, count(*)::int AS n FROM car_events WHERE user_id = $1 GROUP BY type`,
      [req.params.id],
    );
    const stats = { added: 0, edited: 0 };
    for (const s of statsR.rows) stats[s.type] = s.n;

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
