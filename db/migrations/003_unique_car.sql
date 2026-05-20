-- Уникальный индекс для upsert по ключу (brand, model, engine_code, engine_volume, year_from).
-- NULL engine_code трактуется как '' (пустая строка),
-- NULL engine_volume трактуется как 0 — чтобы ON CONFLICT корректно работал с NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cars_upsert_key
  ON cars (
    lower(brand),
    lower(model),
    lower(coalesce(engine_code, '')),
    coalesce(engine_volume, 0),
    year_from
  );
