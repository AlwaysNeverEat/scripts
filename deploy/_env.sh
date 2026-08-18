# Чтение deploy/.env для скриптов деплоя.
#
#   . "$HERE/_env.sh"; load_env "$ENV_FILE"
#
# ПОЧЕМУ НЕ `. .env`. Точка — это ВЫПОЛНИТЬ файл оболочкой, а значения в .env
# литеральные: их так же, посимвольно, читает docker compose (env_file). Стоит
# в значении оказаться спецсимволу — и оболочка понимает строку по-своему.
# Токен Mapillary выглядит как MLY|1234|abcd, и вертикальные черты в нём
# оболочка приняла за конвейер: «38486174824302897: command not found», код
# возврата 127, а с `set -e` это молча роняло весь деплой ещё до сборки.
# Экранировать значения руками — не выход: тот же файл читает docker, и кавычки
# ему пришлось бы снимать обратно.
#
# Поэтому читаем ПОСТРОЧНО и ничего не выполняем. Кавычки вокруг значения, если
# их всё же поставили, снимаем — ровно как docker compose.
load_env() {
    local file="$1" line key value
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"          # файл могли править в Windows
        line="${line#"${line%%[![:space:]]*}"}"
        case "$line" in ''|'#'*) continue ;; esac
        case "$line" in *=*) ;; *) continue ;; esac

        key="${line%%=*}"
        value="${line#*=}"
        key="${key#export }"
        key="${key%"${key##*[![:space:]]}"}"
        # Мусорную строку молча пропускаем: имя переменной — только буквы,
        # цифры и подчёркивание.
        case "$key" in ''|*[!A-Za-z0-9_]*) continue ;; esac

        case "$value" in
            \"*\") value="${value#\"}"; value="${value%\"}" ;;
            \'*\') value="${value#\'}"; value="${value%\'}" ;;
        esac

        export "$key=$value"
    done < "$file"
}
