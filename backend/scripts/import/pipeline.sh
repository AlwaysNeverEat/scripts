#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Конвейер импорта целиком: Motul (объёмы) → ROLF (допуски) → заливка машин
# → Mann (фильтры+кВт/ЛС+ссылки) → дозапись. Крутится циклами, сам
# перезапускает упавший скрейпер Motul, останавливается когда всё собрано
# и долито.
#
# Запуск (из backend/):
#   ./scripts/import/pipeline.sh                # доступ к БД из backend/.env
#   IMPORT_USER=vasya ./scripts/import/pipeline.sh
#
# Доступ к БД — любой из двух:
#   DATABASE_URL=postgres://...      (обычное pg-подключение; в backend/.env)
#   SUPABASE_ACCESS_TOKEN=sbp_... SUPABASE_PROJECT_REF=<ref>   (через HTTPS,
#       когда прямой Postgres недоступен — например, нет IPv6 до db.*.supabase.co)
#
# Логи: data/import/logs/pipeline.log и scrape-motul.log.
# Прогресс сохраняется чекпоинтами — конвейер можно убивать и перезапускать.
# ─────────────────────────────────────────────────────────────────────────────
set -u
cd "$(dirname "$0")/../.."                      # → backend/
ROOT=$(cd .. && pwd)
LOGDIR="$ROOT/data/import/logs"; mkdir -p "$LOGDIR"
LOG="$LOGDIR/pipeline.log"
MOTUL_LOG="$LOGDIR/scrape-motul.log"
IMPORT_USER="${IMPORT_USER:-gtrixoff}"
SLEEP="${PIPELINE_SLEEP:-600}"

# DATABASE_URL и прочее из backend/.env, если не задано в окружении
if [ -f .env ]; then set -a; . ./.env; set +a; fi

say() { echo "── $(date '+%d.%m %H:%M') $*" >> "$LOG"; }

motul_alive() { pgrep -f "node scripts/import/scrape-motul.js" > /dev/null; }
# Счёт машин через node (без python — паритет с pipeline.ps1, одна зависимость).
car_count() {
    node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync('$ROOT/data/import/motul-cars.json','utf8'));console.log(Array.isArray(d)?d.length:Object.keys(d).length)" 2>/dev/null || echo 0
}

say "конвейер запущен (юзер: $IMPORT_USER, pid $$)"
PREV_COUNT=-1
MOTUL_DONE=0

while true; do
    COUNT=$(car_count)
    if [ "$MOTUL_DONE" = "0" ] && ! motul_alive; then
        if [ "$COUNT" != "$PREV_COUNT" ]; then
            # умер на середине — с чекпоинта продолжит
            say "скрейпер Motul не работает — (пере)запускаю (машин: $COUNT)"
            nohup node scripts/import/scrape-motul.js >> "$MOTUL_LOG" 2>&1 &
        else
            # мёртв и прогресса за цикл не было — значит, добрал все марки
            say "скрейпер Motul закончил (машин: $COUNT)"
            MOTUL_DONE=1
        fi
    fi
    PREV_COUNT=$COUNT

    say "этап: допуски ROLF"
    node scripts/import/scrape-rolf.js \
        --in data/import/motul-cars.json \
        --out data/import/cars-enriched.json >> "$LOG" 2>&1

    say "этап: заливка машин в БД"
    node scripts/import/import-cars.js data/import/cars-enriched.json \
        --user "$IMPORT_USER" --state data/import/.imported-keys.json >> "$LOG" 2>&1

    say "этап: подбор фильтров Mann"
    SCRAPE_INTERVAL_MS="${SCRAPE_INTERVAL_MS:-500}" \
        node scripts/import/scrape-filters.js >> "$LOG" 2>&1

    say "этап: дозапись фильтров/мощности/ссылок"
    node scripts/import/apply-filters.js --user "$IMPORT_USER" >> "$LOG" 2>&1

    # SNAPSHOT_PUSH=1 — коммитить свежие данные на ветку после цикла.
    # Жмём gzip'ом: несжатые JSON перевалили за лимиты GitHub (50+ МБ).
    if [ "${SNAPSHOT_PUSH:-0}" = "1" ]; then
        ( cd "$ROOT" \
          && for f in motul-cars cars-enriched filters; do
                 gzip -c "data/import/$f.json" > "data/import/$f.json.gz" 2>/dev/null || true
             done \
          && git add data/import/*.json.gz \
          && { git diff --cached --quiet || { git commit -q -m "Импорт: снапшот данных (объёмы+допуски+фильтры)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ABQiyHBxUB5kYjmGsgc1s" && git push -q; }; } ) >> "$LOG" 2>&1
    fi

    IN=$(car_count)
    OUT=$(node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync('$ROOT/data/import/cars-enriched.json','utf8'));console.log(Array.isArray(d)?d.length:Object.keys(d).length)" 2>/dev/null || echo -1)
    say "итог цикла: собрано=$IN обогащено=$OUT motul_done=$MOTUL_DONE"

    if [ "$MOTUL_DONE" = "1" ] && [ "$IN" = "$OUT" ]; then
        say "ГОТОВО: всё собрано и долито, конвейер останавливается"
        break
    fi
    sleep "$SLEEP"
done
