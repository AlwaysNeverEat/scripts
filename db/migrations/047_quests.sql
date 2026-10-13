-- Задания: три дневных по играм и одно недельное по работе (правила —
-- shared/quests.js).
--
-- game_results — журнал ЗАКОНЧЕННЫХ партий, из которого считаются дневные.
-- Мини-топы хранят по строке рекорда на человека, а заданию нужна сегодняшняя
-- партия, а не лучшая за всё время, — поэтому журнал отдельный. data — то, по
-- чему задания считаются (очки, время, попытки, уровень бота), не больше.
--
-- word_days — ходы в вордле и контекстно за день. Слово в базе по-прежнему не
-- хранится (оно функция от аккаунта и даты), но «разгадал за 4 попытки и за
-- 7 минут» сервер иначе не узнает: состояние партии живёт в браузере.
-- solved_at ставится и победой, и сдачей/проигрышем — после него ходы дня не
-- считаются, иначе слово, подсмотренное в проигрыше, засчитывалось бы победой.
--
-- quest_sets — набор заданий, замороженный при первом показе: пороги часть
-- шаблонов берут от личного рекорда, и побитый днём рекорд не должен
-- утяжелять уже выданное. period — 'd:2026-10-13' или 'w:2026-10-12'
-- (понедельник недели).
--
-- quest_claims — что забрано. Ключ (человек, период, слот) — второй раз то же
-- задание не забрать; опыт уходит строкой в wallet_ledger (kind = 'quest').

CREATE TABLE IF NOT EXISTS game_results (
  id         bigserial   PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  game       text        NOT NULL,
  data       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_results_user_idx ON game_results (user_id, created_at);

CREATE TABLE IF NOT EXISTS word_days (
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  game       text        NOT NULL,
  day        date        NOT NULL,
  guesses    integer     NOT NULL DEFAULT 0,
  hints      integer     NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  solved_at  timestamptz,
  PRIMARY KEY (user_id, game, day)
);

CREATE TABLE IF NOT EXISTS quest_sets (
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  period     text        NOT NULL,
  quests     jsonb       NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period)
);

CREATE TABLE IF NOT EXISTS quest_claims (
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  period     text        NOT NULL,
  slot       integer     NOT NULL,
  quest_id   text        NOT NULL,
  xp         integer     NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period, slot)
);
