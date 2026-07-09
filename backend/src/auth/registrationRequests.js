// Репозиторий заявок на регистрацию. Создание вызывается из routes/auth.js
// (POST /register); accept/decline вызываются из Telegram-воркера
// (backend/src/bot/, обработка inline-кнопок Accept/Decline) — Фаза 3.

import { query } from '../db/client.js';

// Ленивая инвалидация: помечает просроченные pending-заявки как expired.
// Без крона — вызывается перед любой проверкой/операцией с заявками.
export async function expireStalePending() {
  await query(
    `UPDATE registration_requests SET status = 'expired'
      WHERE status = 'pending' AND expires_at <= now()`,
  );
}

export async function findActivePendingByLogin(login) {
  await expireStalePending();
  const r = await query(
    `SELECT id FROM registration_requests WHERE status = 'pending' AND lower(login) = lower($1)`,
    [login],
  );
  return r.rows[0] || null;
}

export async function createRegistrationRequest({ display_name, login, password_hash }) {
  const r = await query(
    `INSERT INTO registration_requests (display_name, login, password_hash)
     VALUES ($1, $2, $3) RETURNING *`,
    [display_name, login, password_hash],
  );
  return r.rows[0];
}

export async function getRegistrationRequest(id) {
  const r = await query('SELECT * FROM registration_requests WHERE id = $1', [id]);
  return r.rows[0] || null;
}

// Accept: заявка жива (pending, не просрочена) и логин всё ещё свободен →
// создаёт users, помечает заявку accepted. Иначе — типизированная ошибка.
export async function acceptRegistrationRequest(id) {
  await expireStalePending();
  const reqRow = await getRegistrationRequest(id);
  if (!reqRow) return { error: 'not_found' };
  if (reqRow.status !== 'pending') return { error: reqRow.status };

  const dup = await query('SELECT 1 FROM users WHERE lower(login) = lower($1)', [reqRow.login]);
  if (dup.rows.length) {
    await query(`UPDATE registration_requests SET status = 'declined' WHERE id = $1`, [id]);
    return { error: 'login_taken' };
  }

  const userRes = await query(
    `INSERT INTO users (display_name, login, password_hash) VALUES ($1, $2, $3) RETURNING *`,
    [reqRow.display_name, reqRow.login, reqRow.password_hash],
  );
  await query(`UPDATE registration_requests SET status = 'accepted' WHERE id = $1`, [id]);
  return { user: userRes.rows[0] };
}

export async function declineRegistrationRequest(id) {
  const reqRow = await getRegistrationRequest(id);
  if (!reqRow) return { error: 'not_found' };
  if (reqRow.status !== 'pending') return { error: reqRow.status };
  await query(`UPDATE registration_requests SET status = 'declined' WHERE id = $1`, [id]);
  return { ok: true };
}
