-- Сессии: клиент получает сырой токен один раз при логине, хранится только его
-- SHA-256 (token_hash) — компрометация БД не отдаёт рабочие токены напрямую.
--
-- Инвалидация — не по expires_at, а по created_at < "последняя полночь МСК"
-- (см. backend/src/auth/midnightMsk.js): с наступлением новых суток по Москве
-- все сессии всех пользователей становятся недействительными одномоментно.

CREATE TABLE sessions (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash    text          NOT NULL,
  created_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_sessions_token_hash ON sessions (token_hash);
CREATE INDEX idx_sessions_user_id ON sessions (user_id);
