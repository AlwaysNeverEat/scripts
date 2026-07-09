-- Фид событий по машине: живёт ТОЛЬКО на странице машины (frontend/src/carPage.js),
-- показывает историю ровно одной машины (car_id), хронологически.
--
-- type: 'added' — пишется в POST /api/cars при вставке новой записи.
--       'edited' — пишется в PATCH /api/cars/:id при любой правке.
-- changed_fields: { field: { from, to } } — на вырост: полей у машины станет
--   больше, формат key→{from,to} переваривает любое их число без миграции.
-- comment: свободный текст «почему изменили» (можно пусто).
-- user_id нужен как есть, а не только имя — ник и аватар могут поменяться,
-- фид всегда должен показывать актуального автора (join на users).

CREATE TABLE car_events (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id          uuid          NOT NULL REFERENCES cars (id) ON DELETE CASCADE,
  user_id         uuid          REFERENCES users (id) ON DELETE SET NULL,
  type            text          NOT NULL CHECK (type IN ('added', 'edited')),
  comment         text,
  changed_fields  jsonb         NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_car_events_car_id ON car_events (car_id, created_at);
