-- Пасхалка «Гео» (угадай место по панораме): три режима — дейли, соло, дуэль.
--
-- ЧЕМ ОНА ОТЛИЧАЕТСЯ ОТ ОСТАЛЬНЫХ ИГР. У тетриса, тройки и пасьянса (025–027)
-- сервер хранит одну строку на игрока — его рекорд, а партию целиком считает
-- браузер. Здесь так нельзя ни в одном режиме, и причина не в парности (как у
-- бильярда, 028), а в том, что ПРАВИЛЬНЫЙ ОТВЕТ — ЭТО СЕКРЕТ. Загаданная точка
-- обязана лежать там, куда браузер не заглядывает, иначе считать расстояние до
-- неё незачем. Поэтому у каждого режима есть таблица с самой партией, а не
-- только со счётом.
--
-- Отсюда же — почему точка ЗАПИСЫВАЕТСЯ В МОМЕНТ ВЫДАЧИ, а не выводится
-- формулой из даты, как слово в вордле (backend/src/daily.js). Точку выбирает
-- не хэш, а справочник панорам Google: одна и та же координата сегодня и через
-- месяц может дать разные снимки или не дать ничего. Такое воспроизводить
-- формулой нельзя — только хранить.
--
-- Таблиц очков три, по одной на режим, и это не дублирование: режимы меряют
-- разное (сумма за все дни, рекорд за партию из пяти точек, очки за дуэли), и
-- общая таблица с колонкой режима стала бы набором полей, половина которых
-- всегда NULL. Ровно по той же причине они разведены у тетриса с тройкой.

-- ── Режим 1: дейли ───────────────────────────────────────────────────────────
-- Одна точка в сутки на аккаунт, одна попытка. Строка появляется, когда игрок
-- впервые за день открыл режим, и второй раз за тот же день не создаётся —
-- отсюда составной первичный ключ. Переиграть нельзя технически, а не по
-- договорённости: догадка пишется единственным UPDATE с условием
-- «guessed_at IS NULL».
CREATE TABLE IF NOT EXISTS geo_daily (
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Дата МСК ('YYYY-MM-DD'), той же меркой, что и остальные сутки на сайте.
  day         date        NOT NULL,
  -- Настоящая точка съёмки. Клиенту до ответа уезжает только pano.
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  pano        text        NOT NULL,
  -- Страна опорной точки — показывается в конце раунда.
  label       text        NOT NULL DEFAULT '',
  guess_lat   double precision,
  guess_lng   double precision,
  score       int,
  distance_km double precision,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  guessed_at  timestamptz,
  PRIMARY KEY (user_id, day)
);

-- Итог дейли: сумма за все дни, число дней и лучший день.
--
-- ПОЧЕМУ СУММА, А НЕ «ЛУЧШИЙ РЕЗУЛЬТАТ», как в остальных мини-топах: точка у
-- каждого своя (в этом весь смысл режима), и сравнивать один чужой день с одним
-- своим бессмысленно — кому-то достался перекрёсток с указателем, кому-то
-- просека. На длинной дистанции разная сложность усредняется, и таблица
-- начинает мерить то, что должна: кто играет и кто угадывает.
CREATE TABLE IF NOT EXISTS geo_daily_scores (
  user_id   uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  total     int         NOT NULL DEFAULT 0,
  days      int         NOT NULL DEFAULT 0,
  best      int         NOT NULL DEFAULT 0,
  played_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS geo_daily_scores_top_idx ON geo_daily_scores (total DESC, days ASC, played_at ASC);

-- ── Режим 2: соло ────────────────────────────────────────────────────────────
-- Пять точек за партию, в топ идёт сумма. Партия живёт строкой, потому что
-- точки выдаются по одной: получить все пять сразу — значит отдать браузеру
-- четыре ответа вперёд.
CREATE TABLE IF NOT EXISTS geo_runs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Раунды: [{ lat, lng, pano, label, guess, score, distance_km }]. Массивом, а
  -- не отдельной таблицей строк: партия читается и пишется всегда целиком.
  rounds     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  score      int         NOT NULL DEFAULT 0,
  status     text        NOT NULL DEFAULT 'live',   -- live | done
  created_at timestamptz NOT NULL DEFAULT now(),
  moved_at   timestamptz NOT NULL DEFAULT now()
);

-- Незаконченная партия игрока: её предлагают продолжить вместо новой.
CREATE INDEX IF NOT EXISTS geo_runs_live_idx ON geo_runs (user_id, moved_at DESC) WHERE status = 'live';

CREATE TABLE IF NOT EXISTS geo_solo_scores (
  user_id   uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  -- Рекорд суммы за партию из пяти точек (потолок 25000).
  score     int         NOT NULL DEFAULT 0,
  games     int         NOT NULL DEFAULT 0,
  played_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS geo_solo_scores_top_idx ON geo_solo_scores (score DESC, played_at ASC);

-- ── Режим 3: дуэль ───────────────────────────────────────────────────────────
-- У обоих одна и та же точка, по 6000 здоровья, разница очков за раунд —
-- урон. Устройство то же, что у бильярда: сервер арбитр, партия — одна строка,
-- клиент опрашивает её.
CREATE TABLE IF NOT EXISTS geo_duels (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  p0         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  p1         uuid        REFERENCES users (id) ON DELETE CASCADE,
  -- move | nomove | nmpz. Хранится у партии, а не у игрока: вызов бросают
  -- именно на режим, и принявший соглашается на него.
  mode       text        NOT NULL DEFAULT 'move',
  status     text        NOT NULL DEFAULT 'open',   -- open | live | done
  -- Состояние по правилам shared/geo.js: здоровье, номер раунда, текущая точка
  -- (та самая тайна), догадки, история раундов.
  state      jsonb       NOT NULL,
  -- Растёт на каждое изменение партии. Клиент присылает свой номер и по
  -- расхождению понимает, что пора перечитать партию целиком.
  seq        int         NOT NULL DEFAULT 0,
  winner     uuid        REFERENCES users (id) ON DELETE SET NULL,
  -- hp, afk, resign, rounds, draw, abandoned.
  reason     text        NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  moved_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS geo_duels_open_idx ON geo_duels (status, created_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS geo_duels_p0_idx ON geo_duels (p0, status);
CREATE INDEX IF NOT EXISTS geo_duels_p1_idx ON geo_duels (p1, status);

-- Очки дуэлей: победа +25, поражение −25, поэтому pts может уйти в минус —
-- отсюда обычный int, а не счётчик побед, как в бильярде. Победы и поражения
-- лежат рядом, чтобы в таблице было видно, из чего очки сложились.
CREATE TABLE IF NOT EXISTS geo_duel_scores (
  user_id   uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  pts       int         NOT NULL DEFAULT 0,
  wins      int         NOT NULL DEFAULT 0,
  losses    int         NOT NULL DEFAULT 0,
  played_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS geo_duel_scores_top_idx ON geo_duel_scores (pts DESC, wins DESC, played_at ASC);
