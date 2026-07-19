-- Персональные сессии CRM (crm.zamena-masla-spot.ru) для панели «Наличие на
-- станции»: каждый работник входит в CRM через сайт под СВОЕЙ учёткой.
--
-- Пароли CRM не храним нигде — только куки сессии, полученные после логина.
-- «Выход» на стороне CRM инвалидирует эти куки сам (CRM завершает сессию
-- везде), сайт это заметит при первом же запросе и попросит войти заново.

CREATE TABLE IF NOT EXISTS crm_sessions (
  user_id     uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  cookies     jsonb       NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
