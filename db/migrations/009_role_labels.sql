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
