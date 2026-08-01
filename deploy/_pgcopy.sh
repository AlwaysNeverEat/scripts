#!/bin/sh
# Внутренняя часть migrate-from-supabase.sh — выполняется ВНУТРИ контейнера
# postgres:17-alpine, подключённого к сети compose. Отдельным файлом, а не
# строкой в docker run, чтобы не тонуть во вложенных кавычках.
#
# Источник — $SRC (URI Supabase). Приёмник — локальный Postgres через PG*.
#
# ПОЧЕМУ НЕ pg_dump: через пулер Supabase он не отдаёт ни строки даже на
# --schema-only — минута тишины, при том что обычные запросы psql по тому же
# адресу проходят мгновенно.
#
# ПОЧЕМУ КУСКАМИ: одной командой COPY большая таблица тоже встаёт. Проверено:
# таблица на 2 строки проскакивает мгновенно, а на 38 тысяч висит пять минут,
# причём приёмник всё это время ждёт данных, которых источник не шлёт. Работают
# только короткие операции, поэтому каждую таблицу тянем порциями по $CHUNK
# строк. Побочная польза: видно живой прогресс, а не немую паузу.
#
# Скрипт можно запускать повторно: миграции пропускаются, если схема уже есть,
# а каждая таблица перед заливкой очищается.

set -eu
# Данные идут конвейером «psql источника | psql приёмника». Без pipefail
# статус берётся у последнего звена, и обрыв на источнике выглядел бы успехом:
# таблица приехала бы пустой, а скрипт отрапортовал «ok».
#
# Проверяем поддержку в ПОДоболочке: `set` — специальный встроенный, и на
# оболочке без pipefail (dash) неизвестная опция роняет весь скрипт, причём
# `|| true` от этого не спасает. В подоболочке умирает только она.
if (set -o pipefail) 2>/dev/null; then set -o pipefail; fi

CHUNK="${CHUNK:-2000}"

echo "== Проверка связи"
psql "$SRC" -tAc 'select version()' | head -1
psql -tAc 'select version()' | head -1

echo
if [ -n "$(psql -tAc "select to_regclass('public.cars')")" ]; then
    echo "== Схема уже есть, миграции пропускаю"
else
    echo "== Схема из миграций"
    for f in /db/migrations/*.sql; do
        printf '   %-42s' "$(basename "$f")"
        psql -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null
        echo ok
    done
fi

echo
echo "== Данные (порциями по $CHUNK строк)"
# Порядок таблиц не важен: session_replication_role=replica выключает проверку
# внешних ключей, иначе пришлось бы выстраивать зависимости.
psql "$SRC" -tAc \
    "select tablename from pg_tables where schemaname='public' order by 1" \
| while IFS= read -r t; do
    [ -n "$t" ] || continue
    # Таблицы, которых нет в новой базе (служебные от Supabase), пропускаем.
    if [ -z "$(psql -tAc "select to_regclass('public.\"$t\"')")" ]; then
        printf '   %-26s %s\n' "$t" 'пропуск — нет в новой базе'
        continue
    fi

    n=$(psql "$SRC" -tAc "select count(*) from public.\"$t\"")
    printf '   %-26s %8s строк ' "$t" "$n"

    # Повторный запуск не должен удваивать данные.
    psql -q -v ON_ERROR_STOP=1 \
         -c 'set session_replication_role = replica' \
         -c "truncate public.\"$t\""

    if [ "$n" -eq 0 ]; then echo "— пусто"; continue; fi

    off=0
    while [ "$off" -lt "$n" ]; do
        # order by ctid — дешёвая стабильная сортировка по физическому
        # порядку строк. Источник сейчас никто не пишет (Render остановлен),
        # так что порядок между порциями не поедет.
        psql "$SRC" -q -v ON_ERROR_STOP=1 \
             -c "\\copy (select * from public.\"$t\" order by ctid offset $off limit $CHUNK) to stdout" \
          | psql -q -v ON_ERROR_STOP=1 \
                 -c 'set session_replication_role = replica' \
                 -c "\\copy public.\"$t\" from stdin"
        off=$((off + CHUNK))
        [ "$off" -gt "$n" ] && off="$n"
        printf '.'
    done
    printf ' ok\n'
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
psql -c "select 'cars' as таблица, count(*) from cars
         union all select 'users', count(*) from users
         union all select 'car_events', count(*) from car_events
         union all select 'record_ops', count(*) from record_ops"
