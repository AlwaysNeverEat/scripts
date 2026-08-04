import { Router } from 'express';
import multer from 'multer';
import { query } from '../db/client.js';
import { validateDisplayName } from '../auth/validate.js';
import { loadPublicUser } from '../auth/sessions.js';
import {
  uploadAvatarOriginal, uploadAvatarCropped, isAllowedAvatarMime, AVATAR_MAX_BYTES,
} from '../storage/avatarStorage.js';
import {
  computeMetrics, listUserAchievements, presentAchievement, syncAchievementsSafe,
} from '../achievements/achievements.js';
import { loadActivity } from '../records/activity.js';

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
// Оба кладутся в хранилище по ДЕТЕРМИНИРОВАННОМУ пути (см. avatarStorage.js) —
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
// это тот же источник правды, что и фид на странице машины и ачивки.
// edited — по МАШИНАМ (DISTINCT car_id), не по числу правок: 100 правок
// одной машины = 1 отредактированная машина.

router.get('/stats', async (req, res) => {
  try {
    res.json(await computeMetrics(req.user.id));
  } catch (err) {
    console.error('GET /api/profile/stats', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/profile/activity ──────────────────────────────────────────────────
// Лента активности («квадратики»): сколько записей сделано в каждый день за
// последний год. Считается по record_credits — тот же источник, что у топа,
// поэтому цифры в ленте и в рейтинге всегда сходятся.
// Чужую ленту отдаёт GET /api/users/:id/activity — она такая же, публичная.

router.get('/activity', async (req, res) => {
  try {
    res.json(await loadActivity(req.user.id));
  } catch (err) {
    console.error('GET /api/profile/activity', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/profile/achievements ──────────────────────────────────────────────
// Полученные достижения для карточек в профиле. Тексты берутся из определений
// в коде (не из БД) — если формулировку поправили, поменяется и у уже выданных.
// Те же карточки показываются и в чужом профиле — см. GET /api/users/:id/public.

router.get('/achievements', async (req, res) => {
  try {
    res.json(await listUserAchievements(req.user.id));
  } catch (err) {
    console.error('GET /api/profile/achievements', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/profile/achievements/pending ─────────────────────────────────────
// Достижения, о которых пользователю ещё не показывали тост (notified_at NULL).
// Фронт опрашивает этот эндпоинт (при входе + после действий), показывает
// стим-тосты и подтверждает показ через POST /achievements/seen — так
// уведомление не теряется, даже если ачивку начислил модератор, пока
// пользователя не было на сайте.

router.get('/achievements/pending', async (req, res) => {
  try {
    // Самолечащийся синк перед выдачей тостов: докидывает ачивки, которые не
    // выдавались событием (например, «Зеленый свет.» за регистрацию у
    // существующих пользователей или новые ступени, задеплоенные позже).
    // Эндпоинт дёргается при каждом входе на сайт — любой юзер довыдаст себе
    // всё положенное первым же визитом.
    await syncAchievementsSafe(req.user.id);
    const r = await query(
      `SELECT achievement_id, unlocked_at FROM user_achievements
        WHERE user_id = $1 AND notified_at IS NULL ORDER BY unlocked_at ASC`,
      [req.user.id],
    );
    res.json(r.rows.map(presentAchievement));
  } catch (err) {
    console.error('GET /api/profile/achievements/pending', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/profile/achievements/seen ────────────────────────────────────────
// Подтверждение «тост показан»: body { ids: ['cars_added_5', …] }.

router.post('/achievements/seen', async (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string')) {
    return res.status(400).json({ error: 'ids must be a non-empty array of strings' });
  }
  try {
    await query(
      `UPDATE user_achievements SET notified_at = now()
        WHERE user_id = $1 AND achievement_id = ANY($2) AND notified_at IS NULL`,
      [req.user.id, ids],
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/profile/achievements/seen', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
