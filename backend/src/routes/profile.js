import { Router } from 'express';
import multer from 'multer';
import { query } from '../db/client.js';
import { validateDisplayName } from '../auth/validate.js';
import { loadPublicUser } from '../auth/sessions.js';
import { uploadAvatar, isAllowedAvatarMime, AVATAR_MAX_BYTES } from '../storage/supabaseStorage.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: AVATAR_MAX_BYTES } });

const router = Router();

// ── PATCH /api/profile ────────────────────────────────────────────────────────
// Смена ника (display_name). Клик по нику/аватарке на странице профиля.

router.patch('/', async (req, res) => {
  const { display_name } = req.body || {};
  const err = validateDisplayName(display_name);
  if (err) return res.status(400).json({ error: err });

  try {
    await query('UPDATE users SET display_name = $1 WHERE id = $2', [display_name.trim(), req.user.id]);
    res.json({ user: await loadPublicUser(req.user.id) });
  } catch (e) {
    console.error('PATCH /api/profile', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/profile/avatar ───────────────────────────────────────────────────
// Загрузка файла в Supabase Storage (bucket 'avatars'). Только изображения,
// ограничение размера — AVATAR_MAX_BYTES (см. multer limits выше).

router.post('/avatar', upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'файл avatar обязателен' });
  if (!isAllowedAvatarMime(req.file.mimetype)) {
    return res.status(400).json({ error: 'разрешены только изображения (jpeg/png/webp/gif)' });
  }

  try {
    const url = await uploadAvatar(req.user.id, req.file.buffer, req.file.mimetype);
    await query('UPDATE users SET avatar = $1 WHERE id = $2', [url, req.user.id]);
    res.json({ user: await loadPublicUser(req.user.id) });
  } catch (err) {
    console.error('POST /api/profile/avatar', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/profile/stats ─────────────────────────────────────────────────────
// «Добавлено машин» / «Отредактировано машин» — считается по car_events,
// это тот же источник правды, что и фид на странице машины.

router.get('/stats', async (req, res) => {
  try {
    const r = await query(
      `SELECT type, count(*)::int AS n FROM car_events WHERE user_id = $1 GROUP BY type`,
      [req.user.id],
    );
    const stats = { added: 0, edited: 0 };
    for (const row of r.rows) stats[row.type] = row.n;
    res.json(stats);
  } catch (err) {
    console.error('GET /api/profile/stats', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/profile/achievements ──────────────────────────────────────────────
// Реальных достижений нет — готовый пустой расширяемый фид-заглушка.
// Формат карточки на вырост: { id, icon, title, description, unlockedAt, hint }.

router.get('/achievements', (_req, res) => {
  res.json([]);
});

export default router;
