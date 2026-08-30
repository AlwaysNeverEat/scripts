import { Router } from 'express';
import { query } from '../db/client.js';
import { requireRole } from '../auth/middleware.js';
import { clearSessionCache } from '../auth/sessions.js';
import { listUserAchievements, syncAchievementsSafe } from '../achievements/achievements.js';
import { loadActivity } from '../records/activity.js';
import { FACULTY_JOIN, FACULTY_COLUMNS, facultyBadge, facultyCard } from '../faculty/store.js';

const router = Router();

// ── GET /api/users?q=&limit= ──────────────────────────────────────────────────
// Список пользователей: модалка «Назначить ответственного» и вкладка «Админка».
// Только для mod/admin — обычным пользователям перебирать список аккаунтов
// незачем.
//
// role/banned/created_at добавлены ради админки (там по ним и кнопки, и
// сортировка). Отдельный эндпоинт заводить не стали: список пользователей для
// модератора один, и раздваивать его — верный способ однажды закрыть замком
// только одну из копий. Пароль и его хэш сюда не попадают, а роль и бан
// модератору и так видны на странице пользователя.
//
// limit по умолчанию 20 — столько показывает модалка; админка просит больше,
// но потолок жёсткий, чтобы запрос не превращался в выгрузку всей базы.
const USERS_LIMIT_DEFAULT = 20;
const USERS_LIMIT_MAX = 200;

router.get('/', requireRole('mod', 'admin'), async (req, res) => {
  const q = String(req.query.q || '').trim();
  const askedLimit = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(askedLimit) && askedLimit > 0
    ? Math.min(askedLimit, USERS_LIMIT_MAX)
    : USERS_LIMIT_DEFAULT;
  try {
    const params = [];
    let where = '';
    if (q) {
      params.push(`%${q}%`);
      where = `WHERE u.display_name ILIKE $1 OR u.login ILIKE $1`;
    }
    params.push(limit);
    const r = await query(
      `SELECT u.id, u.display_name, u.login, u.role, u.avatar,
              u.banned_at, u.created_at,
              rl.prefix_label, rl.color, rl.tooltip, ${FACULTY_COLUMNS}
         FROM users u
         LEFT JOIN role_labels rl ON rl.role = u.role
         ${FACULTY_JOIN}
        ${where}
        ORDER BY u.display_name
        LIMIT $${params.length}`,
      params,
    );
    res.json(r.rows.map(row => ({
      id: row.id,
      display_name: row.display_name,
      login: row.login,
      role: row.role,
      banned: !!row.banned_at,
      created_at: row.created_at,
      avatar: row.avatar,
      role_prefix: row.prefix_label
        ? { label: row.prefix_label, color: row.color, tooltip: row.tooltip }
        : null,
      faculty: facultyBadge(row.faculty),
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
              rl.prefix_label, rl.color, rl.tooltip, ${FACULTY_COLUMNS}
         FROM users u
         LEFT JOIN role_labels rl ON rl.role = u.role
         ${FACULTY_JOIN}
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
      // В чужом профиле показывается вся карточка факультета, а не только
      // плашка: это единственное место, где её вообще видно у другого человека.
      faculty: facultyCard(row.faculty),
      stats,
      achievements,
    });
  } catch (err) {
    console.error('GET /api/users/:id/public', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/users/:id/activity ───────────────────────────────────────────────
// Лента активности ЧУЖОГО профиля — то же самое, что GET /api/profile/activity
// у себя. Отдельным запросом, а не полем в /public: сетка на год весит заметно
// больше остального профиля, и грузить её незачем тем страницам, где её нет.
// Ничего закрытого в ней нет — число сделанных записей и так видно в топе.

router.get('/:id/activity', async (req, res) => {
  try {
    res.json(await loadActivity(req.params.id));
  } catch (err) {
    console.error('GET /api/users/:id/activity', err);
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

// ── PATCH /api/users/:id/role ─────────────────────────────────────────────────
// Смена роли (body { role: 'user' | 'mod' }) — то же, что делала кнопка
// «Сделать модератором» в боте, только по HTTP: с российского сервера
// api.telegram.org недоступен, и бот до него не дозванивается.
//
// Правило ролей повторяет nextRoleForToggle (backend/src/bot/commands.js):
// admin — защищённая роль, через API её не выдают и не снимают, только руками
// в БД. Иначе любой модератор одним запросом получил бы полные права, а замок
// «модератора банит только админ» перестал бы что-либо значить.
//
// Себе роль менять нельзя по той же причине, что и банить себя: единственный
// модератор одним промахом снял бы себе права и остался без админки — вернуть
// их было бы можно только через SSH.

const API_ASSIGNABLE_ROLES = ['user', 'mod'];

// Фабрика: тесты подсовывают поддельный db вместо живого Postgres,
// которого в node --test нет (см. users.role.test.js).
export function roleChangeHandler({ db = query } = {}) {
  return async (req, res) => {
    const role = req.body?.role;
    if (!API_ASSIGNABLE_ROLES.includes(role)) {
      return res.status(403).json({
        error: `роль может быть только ${API_ASSIGNABLE_ROLES.join(' или ')} — admin через API не выдаётся`,
      });
    }
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'нельзя менять роль самому себе' });
    }

    try {
      const r = await db('SELECT id, role FROM users WHERE id = $1', [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'пользователь не найден' });
      const target = r.rows[0];

      if (target.role === 'admin') {
        return res.status(403).json({ error: 'роль администратора через API не снимается' });
      }
      if (target.role === role) return res.json({ ok: true, role });

      await db('UPDATE users SET role = $1 WHERE id = $2', [role, target.id]);
      // Роль лежит в кэше сессий (auth/sessions.js, TTL ~30 с) — без сброса
      // снятый модератор ещё полминуты проходил бы requireRole.
      clearSessionCache();
      res.json({ ok: true, role });
    } catch (err) {
      console.error('PATCH /api/users/:id/role', err);
      res.status(500).json({ error: err.message });
    }
  };
}

router.patch('/:id/role', requireRole('mod', 'admin'), roleChangeHandler());

export default router;
