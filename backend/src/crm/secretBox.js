// ─────────────────────────────────────────────────────────────────────────────
// Шифрование пароля CRM для привязки учётки (таблица crm_links).
//
// Пароль нужен в обратимом виде: сайт входит им в CRM за работника, а CRM
// принимает только сам пароль — хэша ей мало. Поэтому AES-256-GCM с ключом из
// env CRM_LINK_SECRET: в базе лежит шифртекст, ключ живёт только в окружении
// бэкенда. GCM (а не CBC) — чтобы порча строки в базе ломала расшифровку
// явно, а не давала мусорный «пароль».
//
// Ключ намеренно НЕ выводится из API_KEY: тот уезжает в сборку фронта
// (VITE_API_KEY) и публичен по своей природе. Нет CRM_LINK_SECRET — пароли
// просто не запоминаются, привязки нет, панель CRM работает как раньше
// (каждый вход руками).
// ─────────────────────────────────────────────────────────────────────────────

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_LEN = 12;   // рекомендованный размер nonce для GCM
const TAG_LEN = 16;

let warned = false;

// Ключ считаем на каждый вызов (операций единицы в сутки), зато смена env
// подхватывается перезапуском без кэшей-призраков.
function key() {
    const secret = process.env.CRM_LINK_SECRET || '';
    if (secret.length < 16) {
        if (secret && !warned) {
            warned = true;
            console.warn('CRM_LINK_SECRET короче 16 символов — привязка учётки CRM отключена');
        }
        return null;
    }
    return createHash('sha256').update(secret, 'utf8').digest();
}

// Есть ли чем шифровать: роуты по этому флагу решают, обещать ли автовход.
export function linkSecretConfigured() {
    return key() !== null;
}

// plain → 'v1.<iv>.<tag>.<ciphertext>' (base64url, чтобы строка была без '='
// и безопасно смотрелась в любых логах и выгрузках).
export function sealSecret(plain) {
    const k = key();
    if (!k) return null;
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', k, iv);
    const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const parts = [iv, cipher.getAuthTag(), ct].map(b => b.toString('base64url'));
    return [VERSION, ...parts].join('.');
}

// Обратно. null — если ключа нет, формат чужой или строку испортили: вызов
// трактует это как «привязки больше нет» и просит войти руками.
export function openSecret(sealed) {
    const k = key();
    if (!k || typeof sealed !== 'string') return null;
    const [version, ivB64, tagB64, ctB64] = sealed.split('.');
    if (version !== VERSION || !ivB64 || !tagB64 || !ctB64) return null;
    try {
        const iv = Buffer.from(ivB64, 'base64url');
        const tag = Buffer.from(tagB64, 'base64url');
        if (iv.length !== IV_LEN || tag.length !== TAG_LEN) return null;
        const decipher = createDecipheriv('aes-256-gcm', k, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([
            decipher.update(Buffer.from(ctB64, 'base64url')),
            decipher.final(),
        ]).toString('utf8');
    } catch {
        return null; // не тот ключ или битая строка
    }
}
