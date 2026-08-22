-- Битрикс24 (spotexpress.bitrix24.ru) в интерфейсе сайта: карточка лида во
-- время звонка, чтобы оператор не прыгал между вкладками.
--
-- Устроено как и старая CRM (миграции 017 и 021): у каждого работника СВОЯ
-- учётка Битрикса, она привязывается к аккаунту сайта, пароль лежит
-- зашифрованным (backend/src/crm/secretBox.js, ключ CRM_LINK_SECRET), куки
-- живой сессии — отдельно. Причина та же: правки лида должны быть подписаны
-- тем, кто их сделал, а не общей учёткой «сайт».
--
-- Почему таблицы свои, а не общие с CRM: это разные системы с разными логинами
-- (в Битриксе логин — почта) и разной механикой входа (у Битрикса вход идёт
-- через Bitrix24.Network двумя ступенями). Общая таблица с колонкой «система»
-- означала бы поля, половина из которых всегда пустая.

CREATE TABLE IF NOT EXISTS bitrix_links (
  user_id        uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  bitrix_login   text        NOT NULL,
  -- 'v1.<iv>.<tag>.<ciphertext>' в base64url — см. crm/secretBox.js
  password_enc   text        NOT NULL,
  linked_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

CREATE TABLE IF NOT EXISTS bitrix_sessions (
  user_id     uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  cookies     jsonb       NOT NULL,
  -- CSRF-токен портала: живёт вместе с сессией и нужен каждому запросу,
  -- поэтому лежит рядом с куками, а не вычитывается со страницы каждый раз.
  sessid      text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Лиды, которые прошли через сайт. Это НЕ копия CRM и не попытка её заменить:
-- храним только то, что сами показали и поправили, — чтобы вкладка обращений
-- работала, когда Битрикс лежит или когда лид уже уехал из лимита записей
-- (тариф у компании дешёвый, старые лиды из CRM вычищаются).
--
-- Телефон отдельной колонкой и в нормализованном виде (только цифры): ради
-- него всё и затевалось — по нему потом привяжутся машины клиента.
CREATE TABLE IF NOT EXISTS bitrix_leads (
  lead_id          bigint      PRIMARY KEY,
  phone            text,
  title            text,
  name             text,
  status_id        text,
  source_id        text,
  assigned_by_id   integer,
  comments         text,
  -- когда последний раз читали из Битрикса и когда последний раз писали туда
  seen_at          timestamptz NOT NULL DEFAULT now(),
  saved_at         timestamptz,
  -- кто с сайта правил лид последним (для вкладки обращений)
  saved_by         uuid        REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS bitrix_leads_phone_idx ON bitrix_leads (phone, seen_at DESC);
CREATE INDEX IF NOT EXISTS bitrix_leads_seen_idx  ON bitrix_leads (seen_at DESC);


-- Активный звонок. Битрикс сам связывает входящий с лидом (данные карточки
-- звонка приложения телефонии), и сайту остаётся узнать, что звонок идёт.
--
-- Ключевое отличие от «журнала звонков»: строка живёт не до конца разговора, а
-- до тех пор, пока ОПЕРАТОР НЕ ЗАКРЫЛ ЛИД. Так это и работает за стойкой:
-- трубку положили, а имя, источник и комментарий дописываются ещё минуту, и
-- панель обязана оставаться открытой. Момент окончания разговора нам поэтому
-- не нужен вовсе — что и хорошо, потому что телефония о нём не сообщает.
CREATE TABLE IF NOT EXISTS bitrix_calls (
  id          bigserial   PRIMARY KEY,
  -- id звонка со стороны телефонии: по нему отличаем повтор от нового звонка
  call_id     text        NOT NULL,
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  lead_id     bigint,
  phone       text,
  line        text,
  direction   text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  -- проставляется, когда оператор сохранил или закрыл лид
  closed_at   timestamptz
);

-- Один и тот же звонок датчик пришлёт много раз (карточка перерисовывается),
-- и каждый раз заводить строку нельзя.
CREATE UNIQUE INDEX IF NOT EXISTS bitrix_calls_uniq ON bitrix_calls (user_id, call_id);
-- Открытый звонок у оператора ровно один — его и ищет панель.
CREATE INDEX IF NOT EXISTS bitrix_calls_open_idx ON bitrix_calls (user_id, started_at DESC)
    WHERE closed_at IS NULL;

-- Машины, закреплённые за клиентом по номеру телефона.
--
-- Того, ради чего всё затевалось, в рабочей CRM нет вообще: оператор каждый
-- раз выясняет машину заново. Здесь она подбирается один раз — в калькуляторе
-- или на странице машины — и остаётся за номером навсегда.
--
-- Клиент опознаётся ТЕЛЕФОНОМ, а не лидом: лидов у одного человека со
-- временем несколько (звонил в марте, звонит в августе), а телефон один. По
-- нему же машина подставится в запись.
CREATE TABLE IF NOT EXISTS client_cars (
  id          bigserial   PRIMARY KEY,
  -- только цифры, без +7 и скобок: телефон приезжает из разных мест
  phone       text        NOT NULL,
  car_id      uuid        NOT NULL REFERENCES cars (id) ON DELETE CASCADE,
  -- госномер и заметка оператора («серая, зимой на другой резине»)
  plate       text,
  note        text,
  added_by    uuid        REFERENCES users (id) ON DELETE SET NULL,
  added_at    timestamptz NOT NULL DEFAULT now()
);

-- Одна и та же машина за одним номером — один раз. Повторное закрепление
-- обновляет заметку, а не плодит строки.
CREATE UNIQUE INDEX IF NOT EXISTS client_cars_uniq ON client_cars (phone, car_id);
CREATE INDEX IF NOT EXISTS client_cars_phone_idx ON client_cars (phone, added_at DESC);
