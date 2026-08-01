#!/usr/bin/env bash
# Перенос базы с Supabase на локальный Postgres БЕЗ pg_dump.
#
#   bash /opt/k-spot/deploy/migrate-from-supabase.sh '<URI_SUPABASE>'
#
# Зачем понадобилось: pg_dump через пулер Supabase
# (aws-0-*.pooler.supabase.com) виснет намертво — минута тишины даже на
# --schema-only, при том что обычные запросы psql по тому же адресу проходят
# мгновенно. Поэтому схему берём из db/migrations, которые и так лежат в
# репозитории, а данные переливаем таблица за таблицей через COPY: каждая
# операция короткая, и канал до Ирландии её переживает.
#
# Скрипт можно запускать повторно — но только на ПУСТОЙ базе: миграции не
# идемпотентны, на второй раз они упадут на «уже существует». Если нужно
# начать заново, смотри подсказку в конце вывода при ошибке.

set -euo pipefail

SRC="${1:-}"
if [ -z "$SRC" ]; then
    echo "Использование: bash $0 '<URI_SUPABASE>'" >&2
    echo "URI берётся в Render → Environment → DATABASE_URL" >&2
    exit 1
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$HERE")"
ENV_FILE="$HERE/.env"
NETWORK="${COMPOSE_NETWORK:-deploy_default}"

[ -f "$ENV_FILE" ] || { echo "Нет $ENV_FILE" >&2; exit 1; }

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD не задан в deploy/.env}"

docker network inspect "$NETWORK" >/dev/null 2>&1 \
    || { echo "Нет сети $NETWORK — контейнеры подняты? docker compose -f $HERE/docker-compose.prod.yml ps" >&2; exit 1; }

# Пароль приёмника — через PGPASSWORD, а не внутри URI: в URI спецсимволы
# пришлось бы экранировать (на этом мы уже один раз обожглись).
exec docker run --rm \
    --network "$NETWORK" \
    -e SRC="$SRC" \
    -e CHUNK="${CHUNK:-2000}" \
    -e PGHOST=postgres -e PGPORT=5432 \
    -e PGUSER=carsdb -e PGPASSWORD="$POSTGRES_PASSWORD" -e PGDATABASE=carsdb \
    -v "$REPO/db:/db:ro" \
    -v "$HERE/_pgcopy.sh:/pgcopy.sh:ro" \
    postgres:17-alpine sh /pgcopy.sh
