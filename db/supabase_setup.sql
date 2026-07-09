-- ═════════════════════════════════════════════════════════════════════════════
--  ПОЛНАЯ УСТАНОВКА БАЗЫ ДЛЯ SUPABASE — вставить целиком в SQL Editor → Run
--
--  ⚠ ВНИМАНИЕ: блок сброса ниже УДАЛЯЕТ таблицу cars со ВСЕМИ данными
--  (зачищает остатки прошлой попытки). Если в старой таблице есть что-то
--  ценное — сначала выгрузи, потом запускай.
--
--  Файл сгенерирован из db/migrations/001…007 (tools: cat в один файл).
--  При изменении миграций — пересобрать, вручную не редактировать.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Сброс старой схемы ───────────────────────────────────────────────────────
DROP TABLE IF EXISTS cars CASCADE;
DROP FUNCTION IF EXISTS set_updated_at() CASCADE;

-- ── db/migrations/001_init.sql ──────────────────────────────────────────────────────
-- Enable fuzzy search extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TABLE cars (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  brand               text          NOT NULL,
  model               text          NOT NULL,
  generation          text,
  engine_code         text,
  engine_volume       numeric(4,1),
  year_from           integer       NOT NULL,
  year_to             integer,               -- NULL = still in production
  kw                  integer,
  bhp                 integer,
  fuel_type           text,
  motul_name          text,
  engine_name         text,

  -- Fluid capacities per aggregate.
  -- Shape: { engine, automatic, manual, transfer, diffFront, diffRear }
  -- Each value: { volumeTotal, volumeService, filterVolume, isCvt, isDct,
  --               motulProducts (array), label, rawText, atfWarn }
  fluid_capacities    jsonb         NOT NULL DEFAULT '{}',

  -- Filter part numbers. Shape:
  -- { vf: {part:"W7023",absent:false},
  --   mf: {part:"C2695",absent:false},
  --   sf: {part:null,  absent:true } }
  -- A record is complete only when every key is present and either
  -- absent:true OR part is a non-empty string.
  filter_part_numbers jsonb         NOT NULL DEFAULT '{}',

  -- Search fields — generated on every write by the backend
  name_normalized     text,          -- "kia rio 1.6 2017" (lowercase, no punct)
  name_cyrillic       text,          -- "киа рио 1.6 2017"
  name_translit       text,          -- Latin variant of Cyrillic + brand synonyms
  search_vector       tsvector,      -- GIN-indexed, built from all name variants

  created_at          timestamptz   DEFAULT now(),
  updated_at          timestamptz   DEFAULT now(),
  created_by          text
);

-- Primary lookup: engine code (most precise discriminator)
CREATE INDEX idx_cars_engine_code ON cars (lower(engine_code))
  WHERE engine_code IS NOT NULL;

-- Secondary lookup: brand + model for match endpoint
CREATE INDEX idx_cars_brand_model ON cars (lower(brand), lower(model));

-- Year-range queries
CREATE INDEX idx_cars_year_from ON cars (year_from);
CREATE INDEX idx_cars_year_to   ON cars (year_to)   WHERE year_to IS NOT NULL;

-- Full-text search
CREATE INDEX idx_cars_search_vector ON cars USING GIN (search_vector);

-- Trigram similarity on the combined normalized name
CREATE INDEX idx_cars_name_trgm ON cars USING GIN (name_normalized gin_trgm_ops);

-- Auto-bump updated_at on every UPDATE
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER cars_updated_at
  BEFORE UPDATE ON cars
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── db/migrations/002_add_approvals.sql ──────────────────────────────────────────────────────
-- Допуска машины из ROLF/Ravenol: ["ACEA A5/B5", "FORD WSS-M2C913-D", ...]
-- Используются для подбора моторного масла и отображения matched-тегов на фронте.
ALTER TABLE cars
  ADD COLUMN IF NOT EXISTS car_approvals    jsonb NOT NULL DEFAULT '[]';

-- Снимок рекомендованных масел на момент сохранения.
-- Формат: [{key:'engine', oil1:{b,n,price,v,a,ad}, oil2:{...}, allCandidates:[...]}]
-- Используется как справочник; цены в расчёт не идут — пользователь вводит их заново.
ALTER TABLE cars
  ADD COLUMN IF NOT EXISTS recommended_oils jsonb NOT NULL DEFAULT '[]';

-- ── db/migrations/003_unique_car.sql ──────────────────────────────────────────────────────
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

-- ── db/migrations/004_service_flags.sql ──────────────────────────────────────────────────────
-- Сервис-флаги, заметки оператора и ручные правки списка масел.
--
-- service_flags: enumerated-ключи (словарь подписей: shared/serviceFlags.js)
--   { "atNoFull": true, "noSumpFilter": true, ... }
-- notes: свободный комментарий оператора («сливная пробка под звёздочку» и т.п.)
-- oil_overrides: ручные правки предлагаемых масел со страницы машины
--   { "engine": { "exclude": ["ZIC_X8 SE 5W-30"], "include": ["Motul_..."] } }

ALTER TABLE cars
  ADD COLUMN IF NOT EXISTS service_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notes         text,
  ADD COLUMN IF NOT EXISTS oil_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;


-- ── db/migrations/005_source_links.sql ──────────────────────────────────────────────────────
-- Сурс-ссылки на страницы машины на сайтах подбора.
--
-- source_links: { "mann": "https://…", "lynx": "…", "ravenol": "…",
--                 "motul": "…", "rolf": "…" } — только присутствующие площадки.
--   На сайте это кнопки «Страницы машины», их правят через «Нашли ошибку?».
-- source_keys: массив нормализованных сигнатур этих ссылок
--   (["mann:type:273752", "lynx:toyota:corolla:1-6-1zr-fe", …]).
--   По ним нотификатор матчит текущую машину устойчиво к «мусорным»
--   параметрам URL (у Mann в ссылке куча внутренних id). Логика сборки
--   сигнатур — shared/sourceLinks.js (buildSourceKeys).

ALTER TABLE cars
  ADD COLUMN IF NOT EXISTS source_links jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS source_keys  jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Матч по сигнатуре: source_keys ? 'mann:type:273752'. GIN с jsonb_ops
-- (не jsonb_path_ops) — чтобы поддержать оператор ? для элементов массива.
CREATE INDEX IF NOT EXISTS idx_cars_source_keys ON cars USING GIN (source_keys);

-- ── db/migrations/006_drop_rolf_source_link.sql ──────────────────────────────────────────────────────
-- Убираем ROLF из сурс-ссылок: у ROLF поиск внутри виджета, ссылка всегда
-- одна и та же (rolfoil.ru/podbor) и к конкретной машине не привязана.
-- Сбор допусков с ROLF при этом остаётся — это отдельный механизм.
UPDATE cars
   SET source_links = source_links - 'rolf'
 WHERE source_links ? 'rolf';

-- ── db/migrations/007_tags.sql ──────────────────────────────────────────────────────
-- Теги машины: произвольные слова, по которым её можно найти в поиске.
--
-- tags: массив строк (["табуретка", "малолитражка", "теща возит внуков"]).
--   Свободные пользовательские метки. Их вводят на странице машины в режиме
--   «Нашли ошибку?» — по одному, как теги на ютубе (ввёл → «Добавить»).
--   Слова попадают в search_vector и name_normalized (см. upsertSearchFields
--   в backend/src/routes/cars.js), поэтому обычный поиск по строке их находит:
--   набрал «табуретка» — нашёл Матиз, которому этот тег повесили.

ALTER TABLE cars
  ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb;
