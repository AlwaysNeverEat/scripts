-- Пополнения от поддержавших проект: деньги на сервер, на котором живёт сайт.
--
-- СТРОКА НА ПОПОЛНЕНИЕ, а не счётчик на человека: «за месяц» и «всего» в
-- панели считаются из этих строк (shared/donations.js), и любую цифру там
-- можно разложить обратно на даты и суммы. Счётчик, который только растёт,
-- однажды разошёлся бы с реальностью, и проверить его было бы нечем.
--
-- Вносит строки руками один аккаунт (DONATION_ADMIN_LOGIN) — тот, кто платит
-- за сервер; сам сайт денег не принимает. Строки хранятся навсегда; удалить
-- можно только ошибочно внесённую.

CREATE TABLE IF NOT EXISTS donations (
  id          bigserial   PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  amount_rub  integer     NOT NULL CHECK (amount_rub > 0),
  -- День пополнения по календарю (МСК) — его называет человек, а не время,
  -- когда строку внесли на сайт: внести могут и через неделю.
  donated_on  date        NOT NULL,
  created_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS donations_user_idx ON donations (user_id);
CREATE INDEX IF NOT EXISTS donations_day_idx ON donations (donated_on DESC, id DESC);
