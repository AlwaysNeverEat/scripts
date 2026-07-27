// Централизованная проверка сессии поверх x-api-key (см. index.js).
// Без валидной сессии — 401 на любой /api/cars* и /api/profile* эндпоинт,
// это и есть серверная половина гейта "без логина не видно ничего".

import { verifySessionToken, parseBearerToken } from './sessions.js';

export async function requireSession(req, res, next) {
  try {
    const token = parseBearerToken(req.headers['authorization']);
    const result = await verifySessionToken(token);
    if (!result) return res.status(401).json({ error: 'invalid or expired session' });
    req.user = result.user;
    req.sessionToken = token;
    next();
  } catch (err) {
    next(err);
  }
}

// Мягкий вариант для эндпоинтов с общим доступом (записи): если токен есть и
// он валидный — знаем, кто это (нужно для авторства операций и месячного топа);
// нет токена или он протух — просто гость, запрос идёт дальше без 401.
export async function optionalSession(req, _res, next) {
  try {
    const token = parseBearerToken(req.headers['authorization']);
    const result = token ? await verifySessionToken(token) : null;
    if (result) {
      req.user = result.user;
      req.sessionToken = token;
    }
  } catch {
    // Личность — не обязательное условие доступа сюда: сбой проверки токена
    // не должен ломать страницу записей.
  }
  next();
}

// Роль проверяется на сервере, а не только скрытием кнопки в UI.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}
