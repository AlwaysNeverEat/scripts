#!/usr/bin/env bash
# Ежедневный дамп базы. Ставится в крон (см. DEPLOY-VPS.md, шаг 9).
#
# Резервное копирование самой машины у хостера выключено, и это осознанно:
# ценность здесь только в базе (машины, аккаунты, записи, привязки CRM), а её
# дамп весит десятки мегабайт против сорока гигабайт снапшота диска.
#
# Держим 14 дампов: две недели — этого хватает, чтобы заметить порчу данных,
# и не хватает, чтобы забить диск.

set -euo pipefail

DIR="${BACKUP_DIR:-/var/backups/k-spot}"
KEEP="${BACKUP_KEEP:-14}"
COMPOSE="${COMPOSE_FILE:-/opt/k-spot/deploy/docker-compose.prod.yml}"

mkdir -p "$DIR"
STAMP="$(date +%Y-%m-%d_%H%M)"
OUT="$DIR/carsdb-$STAMP.sql.gz"

# --clean --if-exists: дамп можно налить поверх существующей базы, не удаляя её
# руками. Пишем во временный файл и переименовываем только после успеха, иначе
# оборванный на середине дамп выглядел бы как готовый бэкап.
docker compose -f "$COMPOSE" exec -T postgres \
    pg_dump -U carsdb -d carsdb --clean --if-exists \
    | gzip > "$OUT.part"
mv "$OUT.part" "$OUT"

# Чистим старые, самые свежие KEEP штук оставляем.
ls -1t "$DIR"/carsdb-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --

echo "$(date '+%F %T')  бэкап готов: $OUT ($(du -h "$OUT" | cut -f1))"
