-- Допуска машины из ROLF/Ravenol: ["ACEA A5/B5", "FORD WSS-M2C913-D", ...]
-- Используются для подбора моторного масла и отображения matched-тегов на фронте.
ALTER TABLE cars
  ADD COLUMN IF NOT EXISTS car_approvals    jsonb NOT NULL DEFAULT '[]';

-- Снимок рекомендованных масел на момент сохранения.
-- Формат: [{key:'engine', oil1:{b,n,price,v,a,ad}, oil2:{...}, allCandidates:[...]}]
-- Используется как справочник; цены в расчёт не идут — пользователь вводит их заново.
ALTER TABLE cars
  ADD COLUMN IF NOT EXISTS recommended_oils jsonb NOT NULL DEFAULT '[]';
