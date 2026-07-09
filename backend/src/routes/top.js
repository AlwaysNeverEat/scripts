import { Router } from 'express';
import { query } from '../db/client.js';

const router = Router();

// ── GET /api/top ───────────────────────────────────────────────────────────────
// Топ пользователей по числу добавленных машин (car_events type='added' —
// тот же источник, что и фид на странице машины и статистика в профиле).

router.get('/', async (_req, res) => {
  try {
    const r = await query(
      `SELECT u.id, u.display_name, u.login, u.avatar,
              rl.prefix_label, rl.color, rl.tooltip,
              count(ce.id)::int AS added
         FROM users u
         JOIN car_events ce ON ce.user_id = u.id AND ce.type = 'added'
         LEFT JOIN role_labels rl ON rl.role = u.role
        GROUP BY u.id, rl.prefix_label, rl.color, rl.tooltip
        ORDER BY added DESC, u.display_name
        LIMIT 50`,
    );
    res.json(r.rows.map((row, i) => ({
      rank: i + 1,
      id: row.id,
      display_name: row.display_name,
      avatar: row.avatar,
      role_prefix: row.prefix_label
        ? { label: row.prefix_label, color: row.color, tooltip: row.tooltip }
        : null,
      added: row.added,
    })));
  } catch (err) {
    console.error('GET /api/top', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
