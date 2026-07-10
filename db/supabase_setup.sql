-- ═════════════════════════════════════════════════════════════════════════════
--  ПОЛНАЯ УСТАНОВКА БАЗЫ ДЛЯ SUPABASE — вставить целиком в SQL Editor → Run
--
--  ⚠ ВНИМАНИЕ: блок сброса ниже УДАЛЯЕТ таблицу cars со ВСЕМИ данными
--  (зачищает остатки прошлой попытки). Если в старой таблице есть что-то
--  ценное — сначала выгрузи, потом запускай. Таблицы users/sessions/… (008+)
--  НЕ дропаются — только CREATE IF NOT EXISTS, повторный запуск их не тронет.
--
--  Файл сгенерирован из db/migrations/001…016 (tools: cat в один файл).
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

-- ── db/migrations/008_users.sql ──────────────────────────────────────────────────────
-- Пользователи сайта: регистрация через заявку в Telegram (см. 010_registration_requests.sql),
-- роли и модерация (см. 009_role_labels.sql), фид событий по машинам (см. 011_car_events.sql).
--
-- display_name: отображаемое имя (рус/лат), редактируется на странице профиля.
-- login: логин для входа, уникален (сравнение case-insensitive — см. индекс ниже).
-- password_hash: bcryptjs, никогда не хранить/логировать пароль в открытом виде.
-- role: 'user' | 'mod' | 'admin' — расширяемо, подписи и цвета ролей вынесены
--   в role_labels, а не в код, чтобы новые роли не требовали миграции кода.
-- avatar: публичный URL из Supabase Storage (bucket 'avatars'); пусто = дефолтная
--   шаблонная аватарка на фронте.

CREATE TABLE users (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name    text          NOT NULL,
  login           text          NOT NULL,
  password_hash   text          NOT NULL,
  role            text          NOT NULL DEFAULT 'user'
                                CHECK (role IN ('user', 'mod', 'admin')),
  avatar          text,
  created_at      timestamptz   DEFAULT now()
);

CREATE UNIQUE INDEX idx_users_login ON users (lower(login));

-- ── db/migrations/009_role_labels.sql ──────────────────────────────────────────────────────
-- Метаданные отображения ролей — вынесены в таблицу, чтобы новые роли/префиксы
-- (кроме 'mod') можно было добавлять без релиза кода, только строкой в БД.
--
-- prefix_label: короткий префикс перед ником ("mod"); NULL = роль без префикса
--   (обычный 'user' ничего не показывает).
-- color: CSS-цвет префикса (см. --green и др. в frontend/src/style.css).
-- tooltip: подсказка при наведении на префикс.

CREATE TABLE role_labels (
  role          text  PRIMARY KEY,
  prefix_label  text,
  color         text,
  tooltip       text
);

-- 'admin' в enum есть (см. CHECK в 008_users.sql), но ТЗ не описывает для него
-- отдельного визуального признака — префикс задаётся здесь же, когда понадобится.
INSERT INTO role_labels (role, prefix_label, color, tooltip) VALUES
  ('user',  NULL,  NULL,      NULL),
  ('mod',   'mod', 'green',   'модератор'),
  ('admin', NULL,  NULL,      NULL)
ON CONFLICT (role) DO NOTHING;

-- ── db/migrations/010_sessions.sql ──────────────────────────────────────────────────────
-- Сессии: клиент получает сырой токен один раз при логине, хранится только его
-- SHA-256 (token_hash) — компрометация БД не отдаёт рабочие токены напрямую.
--
-- Инвалидация — не по expires_at, а по created_at < "последняя полночь МСК"
-- (см. backend/src/auth/midnightMsk.js): с наступлением новых суток по Москве
-- все сессии всех пользователей становятся недействительными одномоментно.

CREATE TABLE sessions (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash    text          NOT NULL,
  created_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_sessions_token_hash ON sessions (token_hash);
CREATE INDEX idx_sessions_user_id ON sessions (user_id);

-- ── db/migrations/011_registration_requests.sql ──────────────────────────────────────────────────────
-- Заявки на регистрацию: форма на сайте создаёт запись здесь и уходит
-- сообщением в Telegram админу (см. backend/src/bot/). Accept/Decline —
-- inline-кнопки под сообщением бота.
--
-- Жизнь заявки — 30 минут (expires_at = created_at + interval '30 minutes').
-- После истечения accept не срабатывает, статус переводится в 'expired'.
-- password_hash уже посчитан на этапе заявки (bcryptjs) — при Accept просто
-- переносится в users, пароль в открытом виде нигде не хранится и не логируется.

CREATE TABLE registration_requests (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name    text          NOT NULL,
  login           text          NOT NULL,
  password_hash   text          NOT NULL,
  status          text          NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  created_at      timestamptz   NOT NULL DEFAULT now(),
  expires_at      timestamptz   NOT NULL DEFAULT (now() + interval '30 minutes')
);

CREATE INDEX idx_registration_requests_status ON registration_requests (status);

-- Дубли логина среди живых заявок/юзеров не допускаются на уровне приложения
-- (login может уже быть занят другой pending-заявкой) — проверяется в
-- backend/src/routes/auth.js, здесь только уникальность имени колонки для поиска.
CREATE INDEX idx_registration_requests_login ON registration_requests (lower(login));

-- ── db/migrations/012_car_events.sql ──────────────────────────────────────────────────────
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

-- ── db/migrations/013_bot_admins.sql ──────────────────────────────────────────────────────
-- Кто может командовать Telegram-ботом. Список хранится в БД (не только в env),
-- чтобы можно было передать доступ к админке новому Telegram id прямо из бота
-- ("указываю Telegram user id — бот начинает слушать команды и от него").
--
-- Дефолтный админ сидируется из ADMIN_TELEGRAM_ID (env, дефолт 691442300 —
-- см. backend/src/bot/) при первом старте бота, если таблица пуста.

CREATE TABLE bot_admins (
  telegram_id   bigint        PRIMARY KEY,
  added_at      timestamptz   NOT NULL DEFAULT now()
);

-- ── db/migrations/014_avatar_crop.sql ──────────────────────────────────────────────────────
-- Редактируемая аватарка: помимо финальной картинки (users.avatar — то, что
-- видят все, круглая обрезка) храним оригинал загруженного файла и параметры
-- кропа, чтобы «Изменить отображение» могло заново открыть редактор на
-- оригинале, не спрашивая юзера повторно грузить файл.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_original text,
  ADD COLUMN IF NOT EXISTS avatar_crop     jsonb;

-- ── db/migrations/015_achievements_reassign.sql ──────────────────────────────────────────────────
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

-- ── db/migrations/016_user_ban.sql ──────────────────────────────────────────────────
-- Бан пользователей (кнопка «Забанить» на странице юзера, только mod/admin).
--
-- banned_at: NULL = активен, timestamptz = когда забанен. Отдельного boolean
-- не нужно — дата и есть флаг, заодно видно, когда забанили.
-- При бане сессии пользователя удаляются (см. POST /api/users/:id/ban), а
-- verifySessionToken дополнительно отбрасывает забаненных — даже если сессия
-- каким-то образом уцелела, работать под баном нельзя. Логин под баном — 403.

ALTER TABLE users ADD COLUMN banned_at timestamptz;
