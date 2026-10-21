-- Прощальная страница сайта: счётчик кнопки «F».
--
-- Страница открыта БЕЗ ВХОДА (сотрудники подписали отказ от сайта, и заставлять
-- их логиниться ради «спасибо» незачем), поэтому счётчик не по человеку, как у
-- news_button_clicks, а одно число на всех: человека тут нет.

CREATE TABLE IF NOT EXISTS farewell_f (
  id     smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  clicks bigint   NOT NULL DEFAULT 0
);

INSERT INTO farewell_f (id, clicks) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
