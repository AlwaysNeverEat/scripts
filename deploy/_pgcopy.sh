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

# Данные идут конвейером «psql источника | psql приёмника». Без pipefail
# статус берётся у последнего звена, и обрыв на источнике выглядел бы успехом:
# порция строк потерялась бы молча, а скрипт поставил бы точку «прошло».
#
# Проверяем поддержку в ПОДоболочке: `set` — специальный встроенный, и на
# оболочке без pipefail (dash) неизвестная опция роняет весь скрипт, причём
# `|| true` от этого не спасает. В подоболочке умирает только она.
if (set -o pipefail) 2>/dev/null; then set -o pipefail; fi

# ── Режим одной порции ───────────────────────────────────────────────────────
# Скрипт вызывает сам себя вот так, чтобы порцию можно было обернуть в timeout:
# обернуть shell-функцию им нельзя, а плодить второй файл ради трёх строк глупо.
if [ "${1:-}" = "--chunk" ]; then
    t="$2"; off="$3"
    psql "$SRC" -q -v ON_ERROR_STOP=1 \
         -c "\\copy (select * from public.\"$t\" order by ctid offset $off limit $CHUNK) to stdout" \
      | psql -q -v ON_ERROR_STOP=1 \
             -c 'set session_replication_role = replica' \
             -c "\\copy public.\"$t\" from stdin"
    exit $?
fi

set -eu

CHUNK="${CHUNK:-2000}"      # строк в порции
TIMEOUT="${TIMEOUT:-60}"    # сколько ждём одну порцию, секунд
RETRIES="${RETRIES:-15}"    # столько раз повторяем зависшую порцию
# Таблицы через пробел, которые пропустить. Нужно, когда одна упрямая таблица
# держит весь переезд: остальное уезжает сразу, а её догоняем отдельным
# запуском — ONLY="car_events" — хоть ночью, ждать её никто не будет.
SKIP="${SKIP:-}"
ONLY="${ONLY:-}"

echo "== Проверка связи"
psql "$SRC" -tAc 'select version()' | head -1
psql -tAc 'select version()' | head -1

# Оборванный прошлый прогон оставляет на приёмнике живой COPY ... FROM STDIN:
# он вечно ждёт данных из мёртвого сокета и держит блокировку на таблице.
# Следующий запуск повис бы на truncate, и выглядело бы это как новая поломка.
stale=$(psql -tAc "select count(*) from pg_stat_activity
                    where datname = current_database()
                      and pid <> pg_backend_pid()
                      and query ilike 'copy%'")
if [ "${stale:-0}" -gt 0 ]; then
    echo "   подвисших COPY с прошлого раза: $stale — снимаю"
    psql -q -c "select pg_terminate_backend(pid) from pg_stat_activity
                 where datname = current_database()
                   and pid <> pg_backend_pid()
                   and query ilike 'copy%'" >/dev/null
fi

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
echo "== Данные (порциями по $CHUNK строк, срок $TIMEOUT с, до $RETRIES попыток)"
echo "   . порция прошла   x зависла, повторяю"
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

    case " $SKIP " in *" $t "*) printf '   %-26s %s\n' "$t" 'пропуск — в SKIP'; continue ;; esac
    if [ -n "$ONLY" ]; then
        case " $ONLY " in *" $t "*) : ;; *) continue ;; esac
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
        # Канал до Supabase виснет СЛУЧАЙНО, а не по размеру: замеряли — 500
        # строк (111 КБ) проходят, а следом 100 строк встают намертво. Поэтому
        # каждой порции даём срок и, если не уложилась, убиваем и повторяем.
        # Повтор безопасен: COPY транзакционен, убитая порция не вставляет
        # ничего, дублей не будет.
        #
        # order by ctid — дешёвая стабильная сортировка по физическому порядку
        # строк. Источник сейчас никто не пишет (Render остановлен), так что
        # порядок между порциями не поедет.
        try=0
        until timeout "$TIMEOUT" sh "$0" --chunk "$t" "$off"; do
            try=$((try + 1))
            if [ "$try" -ge "$RETRIES" ]; then
                printf '\n   !! порция с %s не пошла за %s попыток — прервано\n' "$off" "$RETRIES"
                exit 1
            fi
            printf 'x'
            # Убитая порция могла оставить на приёмнике ждущий COPY с
            # блокировкой — снимаем, иначе следующая попытка встанет на ней.
            psql -q -c "select pg_terminate_backend(pid) from pg_stat_activity
                         where datname = current_database()
                           and pid <> pg_backend_pid()
                           and query ilike 'copy%'" >/dev/null 2>&1 || true
            sleep 2
        done
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
