import { Router } from 'express';
import { query } from '../db/client.js';
import { requireRole } from '../auth/middleware.js';
import { clearSessionCache } from '../auth/sessions.js';
import { listUserAchievements, syncAchievementsSafe } from '../achievements/achievements.js';

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
      `SELECT u.id, u.display_name, u.avatar, u.role, u.banned_at,
              rl.prefix_label, rl.color, rl.tooltip
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

    // Синк перед выдачей — иначе у пользователя, который добавлял машины
    // юзерскриптом и давно не заходил на сайт, чужой профиль показал бы
    // устаревший (или пустой) список. Себе такой же синк делает поллер
    // pending-ачивок; тут он ещё и не даёт разъехаться цифрам статистики
    // и медалям на одной странице.
    await syncAchievementsSafe(req.params.id);
    const achievements = await listUserAchievements(req.params.id);

    res.json({
      id: row.id,
      display_name: row.display_name,
      avatar: row.avatar,
      // role/banned нужны модераторским кнопкам на странице юзера («кого можно
      // банить»); чувствительного тут нет — роль и так видна в role_prefix.
      role: row.role,
      banned: !!row.banned_at,
      role_prefix: row.prefix_label
        ? { label: row.prefix_label, color: row.color, tooltip: row.tooltip }
        : null,
      stats,
      achievements,
    });
  } catch (err) {
    console.error('GET /api/users/:id/public', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/users/:id/ban ───────────────────────────────────────────────────
// Бан/разбан (body { banned: true|false }), только mod/admin.
// Правила: себя нельзя; админа нельзя никому; модератора банит только админ.
// При бане сессии пользователя удаляются сразу — его выкинет на гейт при
// первом же запросе, а логин под баном отвечает 403 (см. auth.js, sessions.js).

router.post('/:id/ban', requireRole('mod', 'admin'), async (req, res) => {
  const banned = req.body?.banned;
  if (typeof banned !== 'boolean') {
    return res.status(400).json({ error: 'banned must be true or false' });
  }
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'нельзя забанить самого себя' });
  }

  try {
    const r = await query('SELECT id, role FROM users WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'пользователь не найден' });
    const target = r.rows[0];

    if (target.role === 'admin') {
      return res.status(403).json({ error: 'администратора забанить нельзя' });
    }
    if (target.role === 'mod' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'модератора может забанить только администратор' });
    }

    await query(
      'UPDATE users SET banned_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1',
      [target.id, banned],
    );
    if (banned) {
      await query('DELETE FROM sessions WHERE user_id = $1', [target.id]);
      clearSessionCache(); // бан действует сразу, а не в пределах TTL кэша
    }
    res.json({ ok: true, banned });
  } catch (err) {
    console.error('POST /api/users/:id/ban', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
