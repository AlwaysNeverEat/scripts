import { Router } from 'express';
import multer from 'multer';
import { query } from '../db/client.js';
import { validateDisplayName } from '../auth/validate.js';
import { loadPublicUser } from '../auth/sessions.js';
import {
  uploadAvatarOriginal, uploadAvatarCropped, isAllowedAvatarMime, AVATAR_MAX_BYTES,
} from '../storage/supabaseStorage.js';

const uploadFull = multer({ storage: multer.memoryStorage(), limits: { fileSize: AVATAR_MAX_BYTES } })
  .fields([{ name: 'avatar_original', maxCount: 1 }, { name: 'avatar', maxCount: 1 }]);
const uploadCroppedOnly = multer({ storage: multer.memoryStorage(), limits: { fileSize: AVATAR_MAX_BYTES } })
  .single('avatar');

const router = Router();

// crop — {x,y,zoom} из кроппера, чисто для UX (предзаполнить редактор при
// повторном открытии), на отображение не влияет — парсим нестрого.
function parseCrop(raw) {
  if (typeof raw !== 'string') return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

// ── PATCH /api/profile ────────────────────────────────────────────────────────
// Смена ника (display_name). Клик по нику на странице профиля.

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
// Первая загрузка ИЛИ «Загрузить новую»: приходит оригинал (avatar_original)
// + уже обрезанная на клиенте квадратная картинка (avatar, всегда jpeg).
// Оба кладутся в Storage по ДЕТЕРМИНИРОВАННОМУ пути (см. supabaseStorage.js) —
// повторная загрузка сама перезаписывает предыдущий файл, мусор не копится.

router.post('/avatar', uploadFull, async (req, res) => {
  const originalFile = req.files?.avatar_original?.[0];
  const croppedFile = req.files?.avatar?.[0];
  if (!originalFile || !croppedFile) {
    return res.status(400).json({ error: 'нужны оба файла: avatar_original (исходник) и avatar (обрезка)' });
  }
  if (!isAllowedAvatarMime(originalFile.mimetype)) {
    return res.status(400).json({ error: 'разрешены только изображения (jpeg/png/webp/gif)' });
  }
  // avatar — всегда jpeg с кроппера (canvas.toBlob('image/jpeg')); не доверяем
  // клиенту слепо, проверяем и на бэке.
  if (croppedFile.mimetype !== 'image/jpeg') {
    return res.status(400).json({ error: 'avatar должен быть image/jpeg' });
  }

  try {
    const originalUrl = await uploadAvatarOriginal(req.user.id, originalFile.buffer, originalFile.mimetype);
    const croppedUrl = await uploadAvatarCropped(req.user.id, croppedFile.buffer);
    await query(
      'UPDATE users SET avatar = $1, avatar_original = $2, avatar_crop = $3 WHERE id = $4',
      [croppedUrl, originalUrl, JSON.stringify(parseCrop(req.body.crop)), req.user.id],
    );
    res.json({ user: await loadPublicUser(req.user.id) });
  } catch (err) {
    console.error('POST /api/profile/avatar', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/profile/avatar/crop ─────────────────────────────────────────────
// «Изменить отображение»: оригинал не трогаем, перезаписываем только
// обрезанную версию (клиент сам перерисовал канвас с новым паном/зумом
// поверх уже загруженного avatar_original).

router.patch('/avatar/crop', uploadCroppedOnly, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'файл avatar обязателен' });
  if (req.file.mimetype !== 'image/jpeg') {
    return res.status(400).json({ error: 'avatar должен быть image/jpeg' });
  }

  try {
    const cur = await query('SELECT avatar_original FROM users WHERE id = $1', [req.user.id]);
    if (!cur.rows[0]?.avatar_original) {
      return res.status(400).json({ error: 'сначала загрузите фото' });
    }
    const croppedUrl = await uploadAvatarCropped(req.user.id, req.file.buffer);
    await query(
      'UPDATE users SET avatar = $1, avatar_crop = $2 WHERE id = $3',
      [croppedUrl, JSON.stringify(parseCrop(req.body.crop)), req.user.id],
    );
    res.json({ user: await loadPublicUser(req.user.id) });
  } catch (err) {
    console.error('PATCH /api/profile/avatar/crop', err);
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
