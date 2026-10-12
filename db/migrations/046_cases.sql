-- Кейсы со скинами и кошелёк гемов (правила — shared/cases.js).
--
-- skin_items — что у человека ЕСТЬ: строка на часть пака. Надеть
-- (user_skins) можно только то, что здесь лежит.
--
-- wallet_ledger — журнал операций кошелька: обмены, покупка ключей,
-- открытия кейсов. Баланс нигде не хранится числом — он сумма журнала плюс
-- факты, которые лежат в своих таблицах: записи в топе (record_credits,
-- counted) и донаты (donations). Каждая колонка — знаковое изменение своей
-- величины: трата с минусом, приход с плюсом.

CREATE TABLE IF NOT EXISTS skin_items (
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  pack       text        NOT NULL,
  part       text        NOT NULL,
  source     text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pack, part)
);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id         bigserial   PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       text        NOT NULL,
  gems       integer     NOT NULL DEFAULT 0,
  records    integer     NOT NULL DEFAULT 0,
  rubles     integer     NOT NULL DEFAULT 0,
  xp         integer     NOT NULL DEFAULT 0,
  keys       integer     NOT NULL DEFAULT 0,
  meta       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wallet_ledger_user_idx ON wallet_ledger (user_id, id);
