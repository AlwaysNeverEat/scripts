// Хэширование паролей — bcryptjs (чистый JS-порт bcrypt, без нативной сборки:
// собирается одинаково на Windows-деве и на бесплатных контейнерах Render/Railway).
// Пароли в открытом виде НЕ хранятся и НЕ логируются нигде дальше этого модуля.

import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

export function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}
