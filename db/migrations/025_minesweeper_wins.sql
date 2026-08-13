-- Мини-топ пасхалки «Сапёр»: одна строка на КАЖДУЮ пройденную партию.
--
-- Считать могли бы и счётчиком в users, но тогда пропала бы история: топ
-- месячный, и 1-го числа он должен начаться с нуля, не стирая прошлое. Формат
-- ровно как у record_credits (см. 020): month — 'YYYY-MM' в МСК, проставляется
-- в момент вставки, так что смена таймзоны сервера его не сдвинет.
--
-- Пишется только победа. Проигранные и брошенные партии в базу не попадают
-- вовсе: они живут в памяти процесса (backend/src/minesweeper/games.js) и
-- исчезают вместе с ней.
--
-- seconds — время партии от первого хода: нужно, чтобы при равном числе побед
-- порядок в топе был осмысленным, а не «как база отдала».

CREATE TABLE IF NOT EXISTS minesweeper_wins (
  id          bigserial   PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  seconds     integer     NOT NULL,
  month       text        NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Europe/Moscow', 'YYYY-MM'),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS minesweeper_wins_month_idx ON minesweeper_wins (month, user_id);
