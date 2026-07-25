-- Клон-обложка админки записей ZMS (zamena-masla-spot.ru/admin/record).
--
-- Модель доступа сознательно ОБЩАЯ, а не персональная (в отличие от
-- crm_sessions): у оригинальной админки один логин/пароль на всех, поэтому
-- креды вводятся один раз кем угодно, хранятся в единственной строке
-- zms_records_config и переиспользуются воркером для автологина. Пароль
-- хранится открытым текстом осознанно: без него невозможно автоматически
-- перелогиниваться, когда оригинал рвёт сессию.

CREATE TABLE IF NOT EXISTS zms_records_config (
  id          smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  login       text        NOT NULL,
  password    text        NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Cookie-jar единственной общей сессии админки записей.
CREATE TABLE IF NOT EXISTS zms_records_session (
  id          smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cookies     jsonb       NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Снапшоты доски записей: по требованию храним только сегодня и завтра
-- (старые дни воркер удаляет). data — результат parseRecordBoard
-- (shared/crmRecords.js), ok=false + error — последняя попытка не удалась,
-- data при этом остаётся от последнего успешного синка («обновлено N назад»).
CREATE TABLE IF NOT EXISTS record_snapshots (
  day         date        PRIMARY KEY,
  data        jsonb,
  fetched_at  timestamptz,            -- время последнего УСПЕШНОГО синка
  ok          boolean     NOT NULL DEFAULT false,
  error       text        NOT NULL DEFAULT ''
);

-- Очередь операций к оригинальной админке. Пока оригинал жив — операции
-- уходят сразу же; когда лежит — копятся и проталкиваются автоматически
-- после восстановления (в порядке создания).
CREATE TABLE IF NOT EXISTS record_ops (
  id          bigserial   PRIMARY KEY,
  type        text        NOT NULL CHECK (type IN ('create', 'update', 'delete')),
  payload     jsonb       NOT NULL,
  status      text        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'done', 'failed')),
  attempts    int         NOT NULL DEFAULT 0,
  last_error  text        NOT NULL DEFAULT '',
  author      text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  applied_at  timestamptz
);

CREATE INDEX IF NOT EXISTS record_ops_pending_idx
  ON record_ops (created_at) WHERE status = 'pending';
