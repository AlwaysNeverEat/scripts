// Загрузка аватарок в Supabase Storage (bucket 'avatars') — сырой fetch к
// Storage REST API, без отдельного SDK (в стиле остального backend: только
// то, что реально нужно). Бакет публичный на чтение; запись — по service-role
// ключу из env (SUPABASE_URL/SUPABASE_SERVICE_KEY), в коде не хардкодится.

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

export async function uploadAvatar(userId, buffer, mime) {
  const cfg = config();
  if (!cfg) {
    throw new Error('Supabase Storage не настроен: заполните SUPABASE_URL и SUPABASE_SERVICE_KEY');
  }
  const ext = mime.split('/')[1] || 'jpg';
  const path = `${userId}-${Date.now()}.${ext}`;

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
