import { Router } from 'express';
import { query } from '../db/client.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { validateDisplayName, validateLogin, validatePassword } from '../auth/validate.js';
import { createSession, destroySession, loadPublicUser, parseBearerToken } from '../auth/sessions.js';
import { requireSession } from '../auth/middleware.js';
import {
  findActivePendingByLogin, createRegistrationRequest,
} from '../auth/registrationRequests.js';
import { notifyNewRegistrationRequest } from '../bot/notifyRegistration.js';

const router = Router();

// Хэш-пустышка для выравнивания времени ответа: bcrypt.compare — самая
// медленная часть логина, и если пропускать её для несуществующего логина,
// быстрый ответ сам по себе палит, что такого юзера нет (timing-атака).
const DUMMY_HASH_PROMISE = hashPassword('not-a-real-password-used-only-for-timing');

// ── POST /api/auth/register ───────────────────────────────────────────────────
// Создаёт заявку (pending) и шлёт её в Telegram админам. Ничего не логинит —
// пользователь появится только после Accept в боте.

router.post('/register', async (req, res) => {
  const { display_name, login, password } = req.body || {};

  const nameErr = validateDisplayName(display_name);
  if (nameErr) return res.status(400).json({ error: nameErr });
  const loginErr = validateLogin(login);
  if (loginErr) return res.status(400).json({ error: loginErr });
  const passErr = validatePassword(password);
  if (passErr) return res.status(400).json({ error: passErr });

  try {
    const existingUser = await query('SELECT 1 FROM users WHERE lower(login) = lower($1)', [login.trim()]);
    if (existingUser.rows.length) {
      return res.status(400).json({ error: 'этот логин уже занят' });
    }
    const dupRequest = await findActivePendingByLogin(login.trim());
    if (dupRequest) {
      return res.status(400).json({ error: 'заявка с этим логином уже на рассмотрении' });
    }

    const passwordHash = await hashPassword(password);
    const reqRow = await createRegistrationRequest({
      display_name: display_name.trim(),
      login: login.trim(),
      password_hash: passwordHash,
    });

    try {
      await notifyNewRegistrationRequest(reqRow);
    } catch (err) {
      // Заявка создана и без уведомления — админ может обработать её позже.
      console.error('notifyNewRegistrationRequest', err);
    }

    res.status(201).json({
      id: reqRow.id,
      status: reqRow.status,
      expires_at: reqRow.expires_at,
    });
  } catch (err) {
    console.error('POST /api/auth/register', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) {
    return res.status(400).json({ error: 'login и password обязательны' });
  }

  try {
    const r = await query('SELECT * FROM users WHERE lower(login) = lower($1)', [String(login).trim()]);
    const user = r.rows[0];
    // Один и тот же ответ (и одно и то же время ответа — см. DUMMY_HASH_PROMISE
    // выше) на "нет юзера" и "неверный пароль", чтобы не палить существование логина.
    const invalid = () => res.status(401).json({ error: 'неверный логин или пароль' });
    const ok = await verifyPassword(password, user ? user.password_hash : await DUMMY_HASH_PROMISE);
    if (!user || !ok) return invalid();
    if (user.banned_at) return res.status(403).json({ error: 'аккаунт заблокирован' });

    const { token } = await createSession(user.id);
    const publicUser = await loadPublicUser(user.id);
    res.json({ token, user: publicUser });
  } catch (err) {
    console.error('POST /api/auth/login', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
// Идемпотентно: удаляет сессию по токену независимо от того, протухла она или нет.

router.post('/logout', async (req, res) => {
  try {
    const token = parseBearerToken(req.headers['authorization']);
    await destroySession(token);
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/auth/logout', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/auth/me ───────────────────────────────────────────────────────────

router.get('/me', requireSession, (req, res) => {
  res.json({ user: req.user });
});

export default router;
