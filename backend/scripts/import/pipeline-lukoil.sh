#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Конвейер импорта на базе ЛУКОЙЛ: объёмы жидкостей (двигатель, КПП, раздатка,
# дифференциалы) из lukoil.lubribase.ru + фильтры (MANN → BIG) по каждой марке.
# Оркестратор scrape-lukoil-all.js уже собирает марку целиком, льёт её в БД
# частями (темп 25/30с, перезапись включена) и ищет фильтры — здесь мы лишь
# крутим его циклами и логируем.
#
# Запуск (из backend/):
#   ./scripts/import/pipeline-lukoil.sh
#   IMPORT_USER=vasya ./scripts/import/pipeline-lukoil.sh
#
# Без прокси, вежливый темп по умолчанию (SCRAPE_INTERVAL_MS≈1500).
# Доступ к БД — как в pipeline.sh: DATABASE_URL или SUPABASE_ACCESS_TOKEN+REF.
# Прогресс — чекпоинтами (data/import/lukoil-cars.json), можно убивать/рестартить.
#
# Полезные переменные окружения:
#   IMPORT_USER=<login>         на кого начислять машины (по умолчанию gtrixoff)
#   PIPELINE_SLEEP=600          пауза между циклами при незавершённом сборе
#   LUKOIL_BRANDS="kia,skoda"   ограничить марки (иначе все легковые)
#   LUKOIL_LIMIT_BRANDS=N       ограничить число марок
#   LUKOIL_WITH_FILTERS=0       выключить поиск фильтров по марке
#   LUKOIL_PACE_SIZE=25 LUKOIL_PACE_PAUSE_MS=30000    темп заливки в БД
#   SNAPSHOT_PUSH=1             коммитить снапшот данных на ветку после цикла
# ─────────────────────────────────────────────────────────────────────────────
set -u
cd "$(dirname "$0")/../.."                      # → backend/
ROOT=$(cd .. && pwd)
LOGDIR="$ROOT/data/import/logs"; mkdir -p "$LOGDIR"
LOG="$LOGDIR/pipeline-lukoil.log"
IMPORT_USER="${IMPORT_USER:-gtrixoff}"
SLEEP="${PIPELINE_SLEEP:-600}"

# DATABASE_URL и прочее из backend/.env, если не задано в окружении
if [ -f .env ]; then set -a; . ./.env; set +a; fi

say() { echo "── $(date '+%d.%m %H:%M') $*" >> "$LOG"; }
car_count() {
    node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync('$ROOT/data/import/lukoil-cars.json','utf8'));console.log(Array.isArray(d)?d.length:0)" 2>/dev/null || echo 0
}

say "конвейер ЛУКОЙЛ запущен (юзер: $IMPORT_USER, pid $$)"

while true; do
    ARGS=(scripts/import/scrape-lukoil-all.js --import-new --user "$IMPORT_USER"
          --pace-size "${LUKOIL_PACE_SIZE:-25}" --pace-pause-ms "${LUKOIL_PACE_PAUSE_MS:-30000}")
    [ "${LUKOIL_WITH_FILTERS:-1}" = "1" ] && ARGS+=(--with-filters)
    [ -n "${LUKOIL_BRANDS:-}" ] && ARGS+=(--brands "$LUKOIL_BRANDS")
    [ -n "${LUKOIL_LIMIT_BRANDS:-}" ] && ARGS+=(--limit-brands "$LUKOIL_LIMIT_BRANDS")

    say "этап: полный сбор ЛУКОЙЛ + заливка в БД + фильтры"
    node "${ARGS[@]}" 2>&1 | tee -a "$LOG"
    STATUS=${PIPESTATUS[0]}

    node scripts/import/show-import-status.js 2>&1 | tee -a "$LOG" || true

    if [ "${SNAPSHOT_PUSH:-0}" = "1" ]; then
        ( cd "$ROOT" \
          && gzip -c data/import/lukoil-cars.json > data/import/lukoil-cars.json.gz 2>/dev/null || true
          git add data/import/lukoil-cars.json.gz 2>/dev/null \
          && { git diff --cached --quiet || git commit -q -m "Импорт ЛУКОЙЛ: снапшот данных"; } ) >> "$LOG" 2>&1 || true
    fi

    if [ "$STATUS" = "0" ]; then
        say "ГОТОВО: все легковые ЛУКОЙЛ собраны и залиты (машин: $(car_count))"
        break
    fi
    say "цикл не завершён (код $STATUS). Повтор через $SLEEP секунд; прогресс с чекпоинта."
    sleep "$SLEEP"
done
