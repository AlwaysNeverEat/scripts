// Сессии поверх x-api-key: сырой токен клиент получает один раз при логине,
// в БД хранится только его SHA-256 (token_hash) — компрометация БД не отдаёт
// рабочие токены напрямую. Токен — криптостойкий рандом (crypto.randomBytes).

import crypto from 'node:crypto';
import { query } from '../db/client.js';
import { isSessionAlive } from './midnightMsk.js';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Короткий кэш результата проверки сессии. verifySessionToken делает 2 запроса
// к БД (sessions + loadPublicUser) на КАЖДЫЙ /api/* — это заметный налог на
// загрузку снимка базы, страницу машины и юзерскрипт. Держим результат ~30 с;
// logout инвалидирует запись сразу (destroySession), а бан/полночь МСК
// применяются не позже TTL — приемлемая задержка для этих редких событий.
const SESSION_CACHE_TTL_MS = 30_000;
const sessionCache = new Map(); // tokenHash → { result, expires }

function cacheGet(tokenHash) {
  const hit = sessionCache.get(tokenHash);
  if (!hit) return undefined;
  if (Date.now() > hit.expires) { sessionCache.delete(tokenHash); return undefined; }
  return hit.result;
}

function cacheSet(tokenHash, result) {
  sessionCache.set(tokenHash, { result, expires: Date.now() + SESSION_CACHE_TTL_MS });
}

// Полный сброс кэша — для действий, что инвалидируют сессии не по токену, а по
// пользователю (бан удаляет все сессии юзера через DELETE ... WHERE user_id).
// Кэш маленький, а бан редок — проще сбросить весь, чем вести обратный индекс.
export function clearSessionCache() {
  sessionCache.clear();
}

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const result = await query(
    'INSERT INTO sessions (user_id, token_hash) VALUES ($1, $2) RETURNING *',
    [userId, tokenHash],
  );
  return { token, session: result.rows[0] };
}

// Публичная форма юзера (то, что можно отдавать клиенту) + расширяемый
// префикс роли из role_labels (см. db/migrations/009_role_labels.sql) —
// новые роли/префиксы не требуют правок кода, только строку в БД.
export async function loadPublicUser(userId) {
  const r = await query(
    `SELECT u.id, u.display_name, u.login, u.role, u.avatar,
            u.avatar_original, u.avatar_crop, u.banned_at,
            rl.prefix_label, rl.color, rl.tooltip
       FROM users u
       LEFT JOIN role_labels rl ON rl.role = u.role
      WHERE u.id = $1`,
    [userId],
  );
  if (!r.rows.length) return null;
  const row = r.rows[0];
  return {
    id: row.id,
    display_name: row.display_name,
    login: row.login,
    role: row.role,
    banned: !!row.banned_at,
    avatar: row.avatar,
    // Нужны только самому юзеру, чтобы «Изменить отображение» открыло
    // редактор на оригинале без повторной загрузки файла — в публичном
    // профиле (GET /api/users/:id/public) этих полей нет.
    avatar_original: row.avatar_original,
    avatar_crop: row.avatar_crop,
    role_prefix: row.prefix_label
      ? { label: row.prefix_label, color: row.color, tooltip: row.tooltip }
      : null,
  };
}

// Возвращает { user, sessionId } если токен валиден и сессия не протухла
// (не раньше последней полночи МСК), иначе null.
export async function verifySessionToken(token) {
  if (!token) return null;
  const tokenHash = hashToken(token);

  const cached = cacheGet(tokenHash);
  if (cached !== undefined) return cached;

  const result = await verifySessionTokenUncached(tokenHash);
  cacheSet(tokenHash, result);
  return result;
}

async function verifySessionTokenUncached(tokenHash) {
  const r = await query(
    'SELECT id, user_id, created_at FROM sessions WHERE token_hash = $1',
    [tokenHash],
  );
  if (!r.rows.length) return null;
  const session = r.rows[0];
  if (!isSessionAlive(session.created_at)) return null;

  const user = await loadPublicUser(session.user_id);
  if (!user) return null;
  // Сессии забаненного удаляются при бане, но если какая-то уцелела —
  // работать под баном всё равно нельзя.
  if (user.banned) return null;
  return { sessionId: session.id, user };
}

// Логаут удаляет сессию по токену независимо от того, протухла она или нет —
// это идемпотентная очистка, а не проверка доступа.
export async function destroySession(token) {
  if (!token) return;
  const tokenHash = hashToken(token);
  sessionCache.delete(tokenHash); // logout действует сразу, не ждёт TTL
  await query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
}

// Выход ВЕЗДЕ: сносим все сессии пользователя, а не только ту, из которой
// нажали кнопку. Иначе второй браузер того же человека остаётся залогиненным —
// и, так как учётка CRM привязана к аккаунту, первым же запросом поднимает
// сессию CRM заново, хотя из CRM только что вышли (см. crm/client.js).
// Возвращаем число удалённых сессий: роут показывает, что закрыл не одну.
export async function destroyAllUserSessions(userId) {
  if (!userId) return 0;
  const r = await query('DELETE FROM sessions WHERE user_id = $1 RETURNING id', [userId]);
  // Кэш проверки токенов ключуется хэшем токена, обратного индекса по юзеру
  // нет — сбрасываем весь (он маленький, а выход редок), иначе чужой браузер
  // проживёт с валидным ответом из кэша ещё до 30 секунд.
  clearSessionCache();
  return r.rows.length;
}

export function parseBearerToken(header) {
  if (typeof header !== 'string') return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
