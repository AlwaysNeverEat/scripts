// ─────────────────────────────────────────────────────────────────────────────
// Куда складывать аватарки. Драйвер выбирается по окружению, а не флагом:
//
//   AVATAR_DIR задан            → локальный диск (свой сервер, DEPLOY-VPS.md)
//   иначе SUPABASE_* заданы     → Supabase Storage (как было на Render)
//   иначе                       → не настроено, загрузка отвечает понятной ошибкой
//
// Локальный диск выигрывает намеренно: если на своём сервере случайно остались
// старые SUPABASE_*, картинки всё равно должны лечь рядом с приложением, а не
// уехать обратно за границу.
//
// Уже загруженные аватарки переезд НЕ ломает: в users.avatar лежит готовый URL,
// и старые строки продолжают указывать на Supabase, пока человек не загрузит
// фото заново. Переносить файлы отдельно не обязательно — см. DEPLOY-VPS.md.
// ─────────────────────────────────────────────────────────────────────────────

import {
    isStorageConfigured as isSupabaseConfigured,
    uploadAvatarOriginal as uploadOriginalToSupabase,
    uploadAvatarCropped as uploadCroppedToSupabase,
} from './supabaseStorage.js';
import {
    isDiskStorageConfigured, uploadAvatarOriginalToDisk, uploadAvatarCroppedToDisk,
} from './diskStorage.js';

export { avatarDir, avatarPublicBase } from './diskStorage.js';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export function isAllowedAvatarMime(mime) {
    return ALLOWED_MIME.has(mime);
}

export function isStorageConfigured() {
    return isDiskStorageConfigured() || isSupabaseConfigured();
}

function notConfigured() {
    throw new Error(
        'Хранилище аватарок не настроено: задайте AVATAR_DIR (свой сервер) '
        + 'или SUPABASE_URL и SUPABASE_SERVICE_KEY',
    );
}

export function uploadAvatarOriginal(userId, buffer, mime) {
    if (isDiskStorageConfigured()) return uploadAvatarOriginalToDisk(userId, buffer, mime);
    if (isSupabaseConfigured()) return uploadOriginalToSupabase(userId, buffer, mime);
    return notConfigured();
}

export function uploadAvatarCropped(userId, buffer) {
    if (isDiskStorageConfigured()) return uploadAvatarCroppedToDisk(userId, buffer);
    if (isSupabaseConfigured()) return uploadCroppedToSupabase(userId, buffer);
    return notConfigured();
}
