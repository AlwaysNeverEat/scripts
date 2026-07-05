-- Убираем ROLF из сурс-ссылок: у ROLF поиск внутри виджета, ссылка всегда
-- одна и та же (rolfoil.ru/podbor) и к конкретной машине не привязана.
-- Сбор допусков с ROLF при этом остаётся — это отдельный механизм.
--
-- Чистим уже сохранённые записи: удаляем ключ 'rolf' из source_links.
-- (В source_keys ROLF никогда не попадал — сигнатуры для него не было.)

UPDATE cars
   SET source_links = source_links - 'rolf'
 WHERE source_links ? 'rolf';
