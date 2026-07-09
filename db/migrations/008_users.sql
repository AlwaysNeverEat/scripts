-- Пользователи сайта: регистрация через заявку в Telegram (см. 010_registration_requests.sql),
-- роли и модерация (см. 009_role_labels.sql), фид событий по машинам (см. 011_car_events.sql).
--
-- display_name: отображаемое имя (рус/лат), редактируется на странице профиля.
-- login: логин для входа, уникален (сравнение case-insensitive — см. индекс ниже).
-- password_hash: bcryptjs, никогда не хранить/логировать пароль в открытом виде.
-- role: 'user' | 'mod' | 'admin' — расширяемо, подписи и цвета ролей вынесены
--   в role_labels, а не в код, чтобы новые роли не требовали миграции кода.
-- avatar: публичный URL из Supabase Storage (bucket 'avatars'); пусто = дефолтная
--   шаблонная аватарка на фронте.

CREATE TABLE users (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name    text          NOT NULL,
  login           text          NOT NULL,
  password_hash   text          NOT NULL,
  role            text          NOT NULL DEFAULT 'user'
                                CHECK (role IN ('user', 'mod', 'admin')),
  avatar          text,
  created_at      timestamptz   DEFAULT now()
);

CREATE UNIQUE INDEX idx_users_login ON users (lower(login));
