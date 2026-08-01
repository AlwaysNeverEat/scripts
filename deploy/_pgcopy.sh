#!/bin/sh
# Внутренняя часть migrate-from-supabase.sh — выполняется ВНУТРИ контейнера
# postgres:17-alpine, подключённого к сети compose. Отдельным файлом, а не
# строкой в docker run, чтобы не тонуть во вложенных кавычках.
#
# Источник — $SRC (URI Supabase). Приёмник — локальный Postgres через PG*.
# Схема берётся из db/migrations (примонтированы в /db), данные — таблица за
# таблицей через COPY. Почему так, а не pg_dump: он через пулер Supabase
# намертво виснет, не выдав ни строки даже на --schema-only, тогда как
# обычные запросы psql проходят мгновенно.

set -eu
# Данные идут конвейером «psql источника | psql приёмника». Без pipefail
# статус берётся у последнего звена, и обрыв на источнике выглядел бы успехом:
# таблица приехала бы пустой, а скрипт отрапортовал «ok».
#
# Проверяем поддержку в ПОДоболочке: `set` — специальный встроенный, и на
# оболочке без pipefail (dash) неизвестная опция роняет весь скрипт, причём
# `|| true` от этого не спасает. В подоболочке умирает только она.
if (set -o pipefail) 2>/dev/null; then set -o pipefail; fi

echo "== Проверка связи"
psql "$SRC" -tAc 'select version()' | head -1
psql -tAc 'select version()' | head -1

echo
echo "== Схема из миграций"
for f in /db/migrations/*.sql; do
    printf '   %-42s' "$(basename "$f")"
    psql -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null
    echo ok
done

echo
echo "== Данные"
# Порядок таблиц не важен: session_replication_role=replica выключает проверку
# внешних ключей на время вставки, иначе пришлось бы выстраивать зависимости.
psql "$SRC" -tAc \
    "select tablename from pg_tables where schemaname='public' order by 1" \
| while IFS= read -r t; do
    [ -n "$t" ] || continue
    # Таблицы, которых нет в новой базе (служебные от Supabase), пропускаем.
    if [ -z "$(psql -tAc "select to_regclass('public.\"$t\"')")" ]; then
        printf '   %-28s %s\n' "$t" 'пропуск — нет в новой базе'
        continue
    fi
    n=$(psql "$SRC" -tAc "select count(*) from public.\"$t\"")
    printf '   %-28s %8s строк ... ' "$t" "$n"
    psql "$SRC" -q -c "\\copy public.\"$t\" to stdout" \
      | psql -q -v ON_ERROR_STOP=1 \
             -c 'set session_replication_role = replica' \
             -c "\\copy public.\"$t\" from stdin"
    echo ok
done

echo
echo "== Счётчики последовательностей"
# COPY не двигает sequence'ы, и первая же новая запись упала бы на конфликте
# первичного ключа. Выставляем каждую на max(id)+1.
psql -q -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT s.relname AS seq, t.relname AS tbl, a.attname AS col
          FROM pg_class s
          JOIN pg_depend d  ON d.objid = s.oid
                           AND d.classid = 'pg_class'::regclass
                           AND d.refclassid = 'pg_class'::regclass
          JOIN pg_class t   ON t.oid = d.refobjid
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
         WHERE s.relkind = 'S'
    LOOP
        EXECUTE format(
            'SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM %I), 0) + 1, false)',
            r.seq, r.col, r.tbl);
    END LOOP;
END $$;
SQL
echo "   готово"

echo
echo "== Итог"
psql -c "select 'cars' as t, count(*) from cars
         union all select 'users', count(*) from users
         union all select 'record_ops', count(*) from record_ops"
