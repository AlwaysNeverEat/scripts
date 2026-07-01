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
