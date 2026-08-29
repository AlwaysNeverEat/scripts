// ─────────────────────────────────────────────────────────────────────────────
// Аватарки на локальном диске — драйвер для своего сервера (см. DEPLOY-VPS.md).
//
// Зачем помимо Supabase Storage: тот живёт за границей, и картинки тянет НЕ
// бэкенд, а браузер каждого работника — то есть на аватарки ложится ровно тот
// же рвущийся канал, из-за которого затевался переезд. На своём сервере они
// лежат рядом с приложением и отдаются с того же домена.
//
// Пути, как и у Supabase-драйвера, ДЕТЕРМИНИРОВАННЫЕ (фиксированы на userId):
// повторная загрузка перезаписывает тот же файл, мусор не копится. Разница
// одна — оригиналу нужно расширение, иначе nginx не угадает Content-Type;
// поэтому при смене формата (был png, стал jpeg) старые расширения удаляем.
//
// Env: AVATAR_DIR — куда писать (включает этот драйвер);
//      AVATAR_PUBLIC_BASE — префикс URL, если картинки отдаются не с того же
//      домена, что API. По умолчанию '/avatars' — относительный путь, который
//      верен, когда сайт и API живут на одном origin.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const MIME_EXT = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
};

export function avatarDir() {
    return process.env.AVATAR_DIR || '';
}

export function isDiskStorageConfigured() {
    return Boolean(avatarDir());
}

export function avatarPublicBase() {
    return (process.env.AVATAR_PUBLIC_BASE || '/avatars').replace(/\/$/, '');
}

// Убираем тёзок с другими расширениями: у файла ровно одна актуальная версия,
// иначе после png→jpeg на диске остался бы висеть прошлый формат.
async function dropOtherExtensions(dir, base, keep) {
    let names;
    try {
        names = await readdir(dir);
    } catch {
        return; // каталога ещё нет — удалять нечего
    }
    await Promise.all(names
        .filter(name => name !== keep && (name === base || name.startsWith(`${base}.`)))
        .map(name => rm(join(dir, name), { force: true })));
}

async function writeAvatar(name, ext, buffer) {
    const dir = avatarDir();
    if (!dir) throw new Error('Локальное хранилище аватарок не настроено: задайте AVATAR_DIR');
    const file = `${name}.${ext}`;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, file), buffer);
    await dropOtherExtensions(dir, name, file);
    return `${avatarPublicBase()}/${file}`;
}

// Фон темы подписчика лежит в том же каталоге и отдаётся тем же /avatars, что
// и аватарки: это такая же пользовательская картинка на том же диске, и
// заводить ради неё второй том, второй express.static и второй путь в nginx
// значило бы удваивать всю проводку ради одного имени файла.
export function uploadSupporterBackgroundToDisk(userId, buffer, mime) {
    const ext = MIME_EXT[mime];
    if (!ext) throw new Error(`неподдерживаемый тип изображения: ${mime}`);
    return writeAvatar(`${userId}-supp-bg`, ext, buffer);
}

// Убрать фон совсем. Удаляем ФАЙЛ, а не только ссылку в настройках: картинку
// на весь экран человек мог и передумать показывать, и оставлять её лежать на
// диске «на всякий случай» — не наше дело.
export async function removeSupporterBackgroundFromDisk(userId) {
    const dir = avatarDir();
    if (!dir) return;
    await dropOtherExtensions(dir, `${userId}-supp-bg`, null);
}

export function uploadAvatarOriginalToDisk(userId, buffer, mime) {
    const ext = MIME_EXT[mime];
    if (!ext) throw new Error(`неподдерживаемый тип изображения: ${mime}`);
    return writeAvatar(`${userId}-original`, ext, buffer);
}

// Обрезанная версия всегда jpeg — её рисует канвас на фронте.
export function uploadAvatarCroppedToDisk(userId, buffer) {
    return writeAvatar(`${userId}-cropped`, 'jpg', buffer);
}
