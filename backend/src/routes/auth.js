import { Router } from 'express';
import { query } from '../db/client.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { validateDisplayName, validateLogin, validatePassword } from '../auth/validate.js';
import {
  createSession, destroyAllUserSessions, destroySession, loadPublicUser,
  parseBearerToken, verifySessionToken,
} from '../auth/sessions.js';
import { resumeCrmAutoLogin } from '../crm/autoLoginPause.js';
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

    // Уведомление шлём ВДОГОНКУ, не дожидаясь: заявка уже создана, и ответ
    // человеку от Telegram не зависит.
    //
    // Ждать здесь нельзя. С российского хостинга api.telegram.org недоступен,
    // соединение не устанавливается вовсе, и попытка виснет на таймауте — а
    // адресов у него несколько, undici перебирает их по очереди. Набегает
    // больше, чем фронт готов ждать (netRetry рвёт запрос на 25 секундах), и
    // человек видит «network error» при том, что заявка успешно создана и
    // лежит в базе. Ровно на это и напоролись.
    notifyNewRegistrationRequest(reqRow).catch((err) => {
      console.error('notifyNewRegistrationRequest', err.message);
    });

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
    // Вошли заново — снимаем паузу автовхода в CRM, поставленную выходом:
    // с этого момента сессия CRM снова поднимается сама (crm/client.js).
    resumeCrmAutoLogin(user.id);
    const publicUser = await loadPublicUser(user.id);
    res.json({ token, user: publicUser });
  } catch (err) {
    console.error('POST /api/auth/login', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
// Выход ВЕЗДЕ, а не только в этом браузере: удаляем все сессии пользователя.
// Так задумано из-за привязки учётки CRM — второй открытый браузер того же
// человека иначе продолжил бы работать и поднял бы сессию CRM заново сразу
// после того, как из CRM вышли (см. backend/src/crm/client.js).
//
// Идемпотентно: токен протух или неизвестен — просто убираем его сессию.

router.post('/logout', async (req, res) => {
  try {
    const token = parseBearerToken(req.headers['authorization']);
    const session = await verifySessionToken(token);
    if (session) {
      const closed = await destroyAllUserSessions(session.user.id);
      return res.json({ ok: true, everywhere: true, closedSessions: closed });
    }
    await destroySession(token);
    res.json({ ok: true, everywhere: false, closedSessions: 0 });
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
