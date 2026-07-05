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
