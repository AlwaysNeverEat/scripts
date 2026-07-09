-- Заявки на регистрацию: форма на сайте создаёт запись здесь и уходит
-- сообщением в Telegram админу (см. backend/src/bot/). Accept/Decline —
-- inline-кнопки под сообщением бота.
--
-- Жизнь заявки — 30 минут (expires_at = created_at + interval '30 minutes').
-- После истечения accept не срабатывает, статус переводится в 'expired'.
-- password_hash уже посчитан на этапе заявки (bcryptjs) — при Accept просто
-- переносится в users, пароль в открытом виде нигде не хранится и не логируется.

CREATE TABLE registration_requests (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name    text          NOT NULL,
  login           text          NOT NULL,
  password_hash   text          NOT NULL,
  status          text          NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  created_at      timestamptz   NOT NULL DEFAULT now(),
  expires_at      timestamptz   NOT NULL DEFAULT (now() + interval '30 minutes')
);

CREATE INDEX idx_registration_requests_status ON registration_requests (status);

-- Дубли логина среди живых заявок/юзеров не допускаются на уровне приложения
-- (login может уже быть занят другой pending-заявкой) — проверяется в
-- backend/src/routes/auth.js, здесь только уникальность имени колонки для поиска.
CREATE INDEX idx_registration_requests_login ON registration_requests (lower(login));
