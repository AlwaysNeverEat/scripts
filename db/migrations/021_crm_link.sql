-- Привязка учётки CRM к аккаунту сайта.
--
-- Раньше вход в CRM жил ровно столько, сколько жили куки (таблица
-- crm_sessions): вышел из аккаунта сайта — в следующий раз панель «Наличие на
-- станции» снова спрашивала логин и пароль CRM. Теперь пара «логин + пароль»
-- запоминается за пользователем, и сайт сам входит в CRM теми же данными,
-- которыми работник входил в прошлый раз.
--
-- Пароль лежит НЕ в открытом виде: он зашифрован AES-256-GCM ключом из env
-- CRM_LINK_SECRET (backend/src/crm/secretBox.js). Без этого ключа строки
-- бесполезны, а сам бэкенд просто не запоминает пароли и работает как раньше.
--
-- Таблица отдельная от crm_sessions намеренно: куки удаляются при каждом
-- закрытии сессии CRM, а привязка должна это переживать — иначе автовход
-- случился бы ровно один раз.

CREATE TABLE IF NOT EXISTS crm_links (
  user_id        uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  crm_login      text        NOT NULL,
  -- 'v1.<iv>.<tag>.<ciphertext>' в base64url — см. secretBox.js
  password_enc   text        NOT NULL,
  linked_at      timestamptz NOT NULL DEFAULT now(),
  -- когда этими данными последний раз реально входили в CRM
  last_login_at  timestamptz
);
