-- Пасты во вкладке «Чаты»: заготовленные ответы клиентам, свои у каждого.
--
-- СТРОКА НА ПАСТУ, а не один JSON на человека: пасты правят из двух вкладок
-- разом (одна с «Чатами», другая открыта утром и забыта), и документ целиком
-- означал бы «кто сохранил последним, тот и прав» — вторая вкладка молча
-- стирала бы пасту, написанную в первой. Строка на пасту портит в худшем
-- случае одну пасту, и только ту, которую правят оба.
--
-- Темы — массивом в самой строке, а не отдельной таблицей: тема — короткая
-- метка (shared/chatPastes.js), своей жизни у неё нет, а «переименовать тему у
-- всех паст» — это один UPDATE по массиву.

CREATE TABLE IF NOT EXISTS chat_pastes (
  id         bigserial   PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title      text        NOT NULL DEFAULT '',
  body       text        NOT NULL,
  topics     text[]      NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_pastes_user_idx ON chat_pastes (user_id, id);

-- Кто уже получил стартовый набор. Отдельной отметкой, а не «паст нет —
-- выдать»: человек, удаливший все стартовые пасты, хотел именно этого, и
-- набор не должен возвращаться к нему на следующем открытии вкладки.
CREATE TABLE IF NOT EXISTS chat_paste_seeded (
  user_id   uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  seeded_at timestamptz NOT NULL DEFAULT now()
);
