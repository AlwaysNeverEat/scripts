// Сессии поверх x-api-key: сырой токен клиент получает один раз при логине,
// в БД хранится только его SHA-256 (token_hash) — компрометация БД не отдаёт
// рабочие токены напрямую. Токен — криптостойкий рандом (crypto.randomBytes).

import crypto from 'node:crypto';
import { query } from '../db/client.js';
import { isSessionAlive } from './midnightMsk.js';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
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
            u.avatar_original, u.avatar_crop,
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
  const r = await query(
    'SELECT id, user_id, created_at FROM sessions WHERE token_hash = $1',
    [tokenHash],
  );
  if (!r.rows.length) return null;
  const session = r.rows[0];
  if (!isSessionAlive(session.created_at)) return null;

  const user = await loadPublicUser(session.user_id);
  if (!user) return null;
  return { sessionId: session.id, user };
}

// Логаут удаляет сессию по токену независимо от того, протухла она или нет —
// это идемпотентная очистка, а не проверка доступа.
export async function destroySession(token) {
  if (!token) return;
  await query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export function parseBearerToken(header) {
  if (typeof header !== 'string') return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
