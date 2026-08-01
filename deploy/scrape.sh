#!/usr/bin/env bash
# Запуск скриптов сбора данных (backend/scripts/import/*) на своём сервере.
#
#   bash deploy/scrape.sh scrape-motul-all.js
#   bash deploy/scrape.sh scrape-rolf.js
#   bash deploy/scrape.sh scrape-filters.js
#   bash deploy/scrape.sh import-cars.js --dry-run
#
# Контейнер отвязан от терминала — закрывай ssh спокойно. Смотреть за ним:
#   docker logs -f <имя>          (имя печатается при запуске)
#
# Три вещи, которые обёртка делает за тебя:
#
# 1. Node 22, а не 20. Парсеры тянут undici 8, а тот на 20-м падает с
#    «webidl.util.markAsUncloneable is not a function».
# 2. Подключение к базе через PGHOST/PGUSER/PGPASSWORD, а НЕ через DATABASE_URL:
#    пароль из `openssl rand -base64` содержит «/», и внутри URI он ломает
#    разбор — мы на этом уже обжигались.
# 3. --user с твоим uid: иначе контейнер насыплет файлов от root, и следующий
#    же `git pull` упрётся в «permission denied». Тоже проверено на себе.

set -euo pipefail

SCRIPT="${1:-}"
if [ -z "$SCRIPT" ]; then
    echo "Использование: bash $0 <имя-скрипта.js> [аргументы]" >&2
    echo >&2
    echo "Доступные:" >&2
    ls -1 "$(dirname "$0")/../backend/scripts/import/"*.js 2>/dev/null \
        | xargs -n1 basename | sed 's/^/  /' >&2
    exit 1
fi
shift

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$HERE")"
ENV_FILE="$HERE/.env"
NETWORK="${COMPOSE_NETWORK:-deploy_default}"
NAME="${NAME:-$(basename "$SCRIPT" .js)}"

[ -f "$REPO/backend/scripts/import/$SCRIPT" ] || { echo "Нет такого скрипта: $SCRIPT" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Нет $ENV_FILE" >&2; exit 1; }

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD не задан в deploy/.env}"

docker rm -f "$NAME" >/dev/null 2>&1 || true

docker run -d --name "$NAME" \
    --network "$NETWORK" \
    --user "$(id -u):$(id -g)" \
    -e HOME=/tmp \
    -e PGHOST=postgres -e PGPORT=5432 \
    -e PGUSER=carsdb -e PGPASSWORD="$POSTGRES_PASSWORD" -e PGDATABASE=carsdb \
    -v "$REPO:/app" -w /app/backend \
    node:22-alpine \
    sh -c "npm install --no-audit --no-fund --silent && exec node scripts/import/$SCRIPT $*" \
    >/dev/null

cat <<EOF
Запущен: $NAME  ($SCRIPT $*)

  смотреть живьём : docker logs -f $NAME
  последние строки: docker logs --tail=30 $NAME
  остановить      : docker rm -f $NAME

Контейнер переживёт закрытие ssh.
EOF
