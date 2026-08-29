// Загрузка аватарок в Supabase Storage (bucket 'avatars') — сырой fetch к
// Storage REST API, без отдельного SDK (в стиле остального backend: только
// то, что реально нужно). Бакет публичный на чтение; запись — по service-role
// ключу из env (SUPABASE_URL/SUPABASE_SERVICE_KEY), в коде не хардкодится.
//
// Пути ДЕТЕРМИНИРОВАННЫЕ (фиксированы на userId, без таймстампа), запись —
// с x-upsert:true: повторная загрузка всегда перезаписывает тот же объект,
// а не плодит новый. Поэтому старый файл никогда не остаётся мусором в
// бакете — ни отдельного DELETE, ни явной очистки не нужно.
//
// Храним два объекта на юзера:
//   {userId}-original      — как есть загрузил юзер (для повторного кропа)
//   {userId}-cropped.jpg   — то, что видно everywhere (users.avatar), всегда
//                            jpeg — рендерится на фронте через canvas, так что
//                            расширение не плавает между загрузками.

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export function isAllowedAvatarMime(mime) {
  return ALLOWED_MIME.has(mime);
}

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ''), key };
}

export function isStorageConfigured() {
  return config() !== null;
}

async function uploadObject(path, buffer, mime) {
  const cfg = config();
  if (!cfg) {
    throw new Error('Supabase Storage не настроен: заполните SUPABASE_URL и SUPABASE_SERVICE_KEY');
  }
  const res = await fetch(`${cfg.url}/storage/v1/object/avatars/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      apikey: cfg.key,
      'Content-Type': mime,
      'x-upsert': 'true',
    },
    body: buffer,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase Storage upload failed: ${res.status} ${text}`);
  }
  return `${cfg.url}/storage/v1/object/public/avatars/${path}`;
}

export function uploadAvatarOriginal(userId, buffer, mime) {
  return uploadObject(`${userId}-original`, buffer, mime);
}

export function uploadAvatarCropped(userId, buffer) {
  return uploadObject(`${userId}-cropped.jpg`, buffer, 'image/jpeg');
}

// Фон темы подписчика — в тот же бакет. Расширение фиксируем в имени, потому
// что тут, в отличие от диска, старый объект с другим расширением никто не
// подчищает: путь детерминированный, и upsert перезаписывает ровно его.
export function uploadSupporterBackground(userId, buffer, mime) {
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  return uploadObject(`${userId}-supp-bg.${ext}`, buffer, mime);
}
