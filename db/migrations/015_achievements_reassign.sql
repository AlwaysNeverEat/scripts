-- Достижения + «Назначить ответственного» (модераторская переатрибуция машины).
--
-- user_achievements: только ФАКТ получения (id ачивки + когда). Названия,
--   описания и пороги живут в коде (backend/src/achievements/achievements.js) —
--   новая ачивка в линейке не требует миграции.
-- achievement_id: строковый ключ вида 'cars_added_5' — читаемо в БД и в коде.
-- notified_at: когда пользователю показали тост «вы получили достижение».
--   NULL = ещё не показывали (получил через юзерскрипт или начислил модератор,
--   пока пользователя не было на сайте) — покажем при следующем визите.
-- Ачивки ОТЗЫВАЕМЫЕ: если модератор переназначил машину и счётчик пользователя
--   упал ниже порога, строка удаляется (см. syncAchievements) — поэтому никаких
--   денормализованных счётчиков здесь нет, источник правды всегда car_events.

CREATE TABLE user_achievements (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  achievement_id  text          NOT NULL,
  unlocked_at     timestamptz   NOT NULL DEFAULT now(),
  notified_at     timestamptz,
  UNIQUE (user_id, achievement_id)
);

CREATE INDEX idx_user_achievements_user ON user_achievements (user_id);

-- car_events: новый тип 'reassigned' — «{модератор} засчитал машину
-- пользователю {ник}». user_id — модератор (кто нажал кнопку),
-- target_user_id — кому засчитали. Для 'added'/'edited' target_user_id NULL.
ALTER TABLE car_events DROP CONSTRAINT car_events_type_check;
ALTER TABLE car_events ADD CONSTRAINT car_events_type_check
  CHECK (type IN ('added', 'edited', 'reassigned'));

ALTER TABLE car_events
  ADD COLUMN target_user_id uuid REFERENCES users (id) ON DELETE SET NULL;
