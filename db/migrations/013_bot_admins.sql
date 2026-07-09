-- Кто может командовать Telegram-ботом. Список хранится в БД (не только в env),
-- чтобы можно было передать доступ к админке новому Telegram id прямо из бота
-- ("указываю Telegram user id — бот начинает слушать команды и от него").
--
-- Дефолтный админ сидируется из ADMIN_TELEGRAM_ID (env, дефолт 691442300 —
-- см. backend/src/bot/) при первом старте бота, если таблица пуста.

CREATE TABLE bot_admins (
  telegram_id   bigint        PRIMARY KEY,
  added_at      timestamptz   NOT NULL DEFAULT now()
);
