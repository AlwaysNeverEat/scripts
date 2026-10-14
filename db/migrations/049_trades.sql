-- Обменник и маркет скинов (правила — shared/trades.js).
--
-- trade_offers — предложение обмена от одного человека другому. Вещи
-- сторон лежат списками [{pack, part}] прямо в строке: предложение — это
-- снимок «что отдаю / что прошу» на момент отправки, а не ссылки на строки
-- skin_items, которые за время ожидания могут уехать. Гемы НЕ
-- замораживаются: всё проверяется заново в момент «Принять» под замком
-- обоих кошельков (routes/trades.js).
--
-- Статус: pending → accepted | declined | cancelled | failed (принять
-- пытались, но вещи или гемов к этому моменту уже не было).
--
-- market_listings — вещь, выставленная за гемы. Вещь остаётся в skin_items
-- хозяина, пока её не купили; ушла другим путём — лот снимается
-- (status = 'gone'). Активный лот на одну вещь у человека один.
--
-- Переезд гемов — строки wallet_ledger (kind = trade / market_buy /
-- market_sell), переезд вещи — смена user_id в skin_items с source = trade
-- или market.

CREATE TABLE IF NOT EXISTS trade_offers (
  id          bigserial   PRIMARY KEY,
  from_user   uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  to_user     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  give        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  give_gems   integer     NOT NULL DEFAULT 0 CHECK (give_gems >= 0),
  want        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  want_gems   integer     NOT NULL DEFAULT 0 CHECK (want_gems >= 0),
  note        text        NOT NULL DEFAULT '',
  status      text        NOT NULL DEFAULT 'pending',
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz
);

CREATE INDEX IF NOT EXISTS trade_offers_to_idx ON trade_offers (to_user, id DESC);
CREATE INDEX IF NOT EXISTS trade_offers_from_idx ON trade_offers (from_user, id DESC);

CREATE TABLE IF NOT EXISTS market_listings (
  id          bigserial   PRIMARY KEY,
  seller      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  pack        text        NOT NULL,
  part        text        NOT NULL,
  price       integer     NOT NULL CHECK (price > 0),
  status      text        NOT NULL DEFAULT 'active',
  buyer       uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS market_listings_active_uq
  ON market_listings (seller, pack, part) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS market_listings_status_idx ON market_listings (status, id DESC);
