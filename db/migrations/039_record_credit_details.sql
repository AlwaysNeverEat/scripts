-- Топ по записям стал прозрачным: рядом с очком хранится, ЗА ЧТО оно дано.
--
-- До этого record_credits (020) помнил только «кто и когда» — одну строку на
-- зачтённую запись. Этого хватало посчитать, но не хватало ответить на «а что
-- он там назаписывал?»: ни станции, ни клиента, ни времени. Теперь на каждую
-- новую строку кладутся и подробности самой записи — те же поля, что оператор
-- заполнил в окне создания. По ним профиль показывает список записей за день
-- (клик по клетке ленты активности), а доска — кто именно записал клиента.
--
-- Старые строки НЕ дозаполняются: у операции, которая дала очко, история
-- жила сутки (019) и давно вычищена. Пустые подробности при этом остаются
-- честной строкой «до обновления»: очки за них никуда не деваются (топ не
-- обнуляем), а профиль на таком дне пишет, что подробностей нет.
--
-- record_id — номер записи в оригинальной админке. При создании он неизвестен
-- (оригинал ничего не возвращает), поэтому колонка заполняется ПОТОМ: следующий
-- синк доски находит только что созданную запись по станции, времени и телефону
-- (resolveCreditRecordIds в backend/src/records/sync.js). Дальше авторство
-- держится на id и переживает перенос записи на другое время или станцию.
--
-- Телефон хранится цифрами (normPhoneDigits) — так же, как сравнивается с
-- доской. Записи с «мусорным» номером (одна и та же цифра, +7 111 111-11-11)
-- сюда не попадают вовсе — см. isJunkPhone в shared/crmRecords.js.

ALTER TABLE record_credits
  ADD COLUMN IF NOT EXISTS record_id     text,
  ADD COLUMN IF NOT EXISTS station_id    text,
  ADD COLUMN IF NOT EXISTS station_title text,
  ADD COLUMN IF NOT EXISTS record_date   date,
  ADD COLUMN IF NOT EXISTS record_time   text,
  ADD COLUMN IF NOT EXISTS duration_min  int,
  ADD COLUMN IF NOT EXISTS client_name   text,
  ADD COLUMN IF NOT EXISTS phone         text,
  ADD COLUMN IF NOT EXISTS car_number    text;

-- Доска дня спрашивает «кто записал» по всем записям этого дня разом.
CREATE INDEX IF NOT EXISTS record_credits_record_date_idx
  ON record_credits (record_date) WHERE record_date IS NOT NULL;
