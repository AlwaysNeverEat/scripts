#!/usr/bin/env bash
# Сборка фронта и раскладка его в /var/www/k-spot.
#
#   bash deploy/build-site.sh
#
# Запускать после каждого обновления кода фронта. Бэкенд перезапускать не
# нужно — это статика, nginx подхватит новые файлы сам.
#
# VITE_API_BASE намеренно ПУСТОЙ. Тогда фронт ходит по относительным путям, то
# есть на тот же домен, откуда его отдали. Ради этого весь переезд и затевался:
# запросы перестают быть межоригинными, и браузер больше не шлёт preflight
# OPTIONS перед каждым обращением к API.
#
# VITE_API_KEY берётся из deploy/.env — тот же ключ, что у бэкенда, иначе он
# будет отвечать 401 на всё.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$HERE")"
ENV_FILE="$HERE/.env"
WWW="${WWW_DIR:-/var/www/k-spot}"

[ -f "$ENV_FILE" ] || { echo "Нет $ENV_FILE" >&2; exit 1; }
# .env читается построчно, а не выполняется оболочкой (почему — в _env.sh).
# shellcheck disable=SC1091
. "$HERE/_env.sh"
load_env "$ENV_FILE"
: "${API_KEY:?API_KEY не задан в deploy/.env}"

echo "==> Сборка (памяти на машине немного, может занять пару минут)"
# --user, чтобы dist не оказался во владении root: следующий git pull иначе
# упрётся в permission denied.
docker run --rm \
    --user "$(id -u):$(id -g)" \
    -e HOME=/tmp \
    -e VITE_API_BASE='' \
    -e VITE_API_KEY="$API_KEY" \
    -v "$REPO:/app" -w /app/frontend \
    node:22-alpine \
    sh -c 'npm install --no-audit --no-fund --silent && npm run build'

[ -f "$REPO/frontend/dist/index.html" ] || { echo "Сборка не дала dist/index.html" >&2; exit 1; }

echo "==> Раскладка в $WWW"
sudo mkdir -p "$WWW"
sudo rsync -a --delete "$REPO/frontend/dist/" "$WWW/"
sudo chown -R www-data:www-data "$WWW"

if sudo nginx -t >/dev/null 2>&1; then
    sudo systemctl reload nginx
    echo "==> nginx перечитал конфигурацию"
else
    echo "==> nginx ещё не настроен — это нормально при первом запуске"
fi

echo
echo "Готово. Файлов: $(sudo find "$WWW" -type f | wc -l), размер: $(sudo du -sh "$WWW" | cut -f1)"
