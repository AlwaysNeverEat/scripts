#!/usr/bin/env bash
# Одобрение заявок на регистрацию руками — пока не работает Telegram-бот.
#
#   bash deploy/approve.sh              — показать заявки
#   bash deploy/approve.sh ivan         — одобрить, роль user
#   bash deploy/approve.sh ivan mod     — одобрить и сразу дать модератора
#   bash deploy/approve.sh --users      — кто уже заведён и с какой ролью
#
# Зачем это вообще: с российского хостинга api.telegram.org недоступен, бот
# молчит, и кнопки Accept под сообщением просто не приходят. Заявки при этом
# исправно копятся в базе — их и одобряем.
#
# Делаем ровно то же, что кнопка Accept в боте (см. auth/registrationRequests.js):
# переносим display_name, login и УЖЕ ПОСЧИТАННЫЙ хэш пароля в users, заявку
# помечаем accepted. Пароль в открытом виде здесь не появляется — его нет и в
# самой заявке.
#
# Срок жизни заявки (30 минут) сознательно игнорируется: человек уже рядом и
# просит, гонять его регистрироваться заново из-за таймера незачем.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
COMPOSE="$HERE/docker-compose.prod.yml"

psql_do() {
    docker compose -f "$COMPOSE" exec -T postgres psql -U carsdb -d carsdb "$@"
}

case "${1:-}" in
    --users)
        psql_do -c "select login, display_name, role, created_at::date as создан
                      from users order by created_at"
        exit 0
        ;;
esac

LOGIN="${1:-}"
ROLE="${2:-user}"

if [ -z "$LOGIN" ]; then
    echo "Заявки на регистрацию:"
    psql_do -c "select login, display_name, status,
                       to_char(created_at, 'DD.MM HH24:MI') as подана
                  from registration_requests
                 order by created_at desc limit 20"
    echo "Одобрить:  bash $0 <логин> [user|mod]"
    exit 0
fi

# Логин уходит в SQL, поэтому пропускаем только заведомо безобидные символы.
case "$LOGIN" in
    *[!A-Za-z0-9_.-]*|'') echo "Недопустимый логин: $LOGIN" >&2; exit 1 ;;
esac
case "$ROLE" in
    user|mod|admin) ;;
    *) echo "Роль должна быть user, mod или admin (было: $ROLE)" >&2; exit 1 ;;
esac

psql_do -v ON_ERROR_STOP=1 -c "
    with r as (
        update registration_requests
           set status = 'accepted'
         where status = 'pending' and lower(login) = lower('$LOGIN')
        returning display_name, login, password_hash
    )
    insert into users (display_name, login, password_hash, role)
    select display_name, login, password_hash, '$ROLE' from r
    returning login, display_name, role"

echo
echo "Если строк выше нет — заявки с таким логином в статусе pending не нашлось."
echo "Посмотреть все:  bash $0"
