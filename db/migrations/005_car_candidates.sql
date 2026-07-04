-- Фид кандидатов на добавление в базу.
--
-- Краулер (tools/crawl-motul-mann.mjs) наполняет эту таблицу «черновиками»:
-- объёмы/допуска берёт с Motul, номера трёх фильтров и каноничное имя
-- марки/модели (включая кузов в скобках) — с MANN. Оператор на сайте во
-- вкладке «Добавить машины» пролистывает фид, правит карточку и жмёт
-- «Добавить в БД» (→ upsert в cars) или «Удалить» (плохой матч, добьют руками).
--
-- Кандидат — это НЕ боевая запись: тройка фильтров может быть неполной,
-- поэтому валидация фильтров здесь не жёсткая (проверяется только при аппруве).

CREATE TABLE IF NOT EXISTS car_candidates (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Те же поля, что у cars (кроме поисковых — они строятся при аппруве).
  brand               text          NOT NULL,
  model               text          NOT NULL,
  generation          text,                       -- кузов из скобок MANN: "E90", "W204" …
  engine_code         text,
  engine_volume       numeric(4,1),
  year_from           integer,
  year_to             integer,
  kw                  integer,
  bhp                 integer,
  fuel_type           text,
  motul_name          text,
  engine_name         text,
  fluid_capacities    jsonb         NOT NULL DEFAULT '{}',
  filter_part_numbers jsonb         NOT NULL DEFAULT '{}',
  car_approvals       jsonb         NOT NULL DEFAULT '[]',

  -- Происхождение и самооценка матча краулером.
  -- source: { motulUrl, mannUrl, mannQuery, mannHitTitle, matchedAt }
  source              jsonb         NOT NULL DEFAULT '{}',
  -- match_quality: 'good' (все 3 фильтра + объёмы) | 'partial' (что-то есть)
  --                | 'no_filters' (MANN не дал фильтров) | 'weak' (слабый матч имени)
  match_quality       text          NOT NULL DEFAULT 'partial',

  -- pending — в фиде; approved — добавлен в cars; rejected — оператор удалил.
  -- rejected НЕ удаляется физически, чтобы краулер не предлагал машину по кругу.
  status              text          NOT NULL DEFAULT 'pending',

  -- Ключ дублей: lower(brand)|lower(model)|lower(engine_code)|volume|year_from
  -- (та же форма, что idx_cars_upsert_key). Уникален по всем статусам —
  -- ON CONFLICT DO NOTHING гасит повторное предложение той же машины.
  dedup_key           text          NOT NULL,

  created_at          timestamptz   DEFAULT now(),
  reviewed_at         timestamptz,
  reviewed_by         text,
  approved_car_id     uuid,
  created_by          text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_dedup  ON car_candidates (dedup_key);
CREATE INDEX        IF NOT EXISTS idx_candidates_status ON car_candidates (status, created_at);
