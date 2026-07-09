// Валидация регистрации — чистые функции, без БД (уникальность логина
// проверяется отдельно в routes/auth.js, там нужен запрос к БД).

export function validateDisplayName(name) {
  if (typeof name !== 'string' || !name.trim()) return 'display_name обязателен';
  if (name.trim().length > 60) return 'display_name слишком длинный (макс. 60 символов)';
  return null;
}

// Логин — рус/лат буквы, цифры, точка/дефис/подчёркивание, 3–40 символов.
const LOGIN_RE = /^[a-zA-Zа-яА-ЯёЁ0-9._-]{3,40}$/;

export function validateLogin(login) {
  if (typeof login !== 'string' || !login.trim()) return 'login обязателен';
  if (!LOGIN_RE.test(login.trim())) {
    return 'login: 3–40 символов, только буквы/цифры/._-';
  }
  return null;
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 6) {
    return 'password: минимум 6 символов';
  }
  if (password.length > 200) return 'password слишком длинный';
  return null;
}
