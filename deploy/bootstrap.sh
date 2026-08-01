#!/usr/bin/env bash
# Шаги 1–2 из DEPLOY-VPS.md одной командой: пользователь deploy, swap, файрвол,
# Docker, nginx, certbot. Запускать под root на свежей машине:
#
#   apt-get update && apt-get install -y git
#   git clone -b claude/api-spot-boot-recording-issue-qqvzan \
#       https://github.com/AlwaysNeverEat/scripts.git /opt/k-spot
#   bash /opt/k-spot/deploy/bootstrap.sh
#
# Скрипт идемпотентный — повторный запуск ничего не ломает.
#
# ЧЕГО ОН НАМЕРЕННО НЕ ДЕЛАЕТ: не отключает вход по паролю. Это последнее
# действие, и делать его вслепую нельзя — сначала надо своими глазами убедиться,
# что вход под deploy по ключу работает, иначе можно запереть себя снаружи.
# Команда для этого печатается в конце.

set -euo pipefail

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m!! %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Запускать под root: sudo bash $0"

# ── Ключи должны быть на месте ДО всего остального ───────────────────────────
# Без них deploy окажется пользователем, под которого невозможно зайти, и
# отключение парольного входа станет ловушкой.
ROOT_KEYS=/root/.ssh/authorized_keys
if [ ! -s "$ROOT_KEYS" ] && [ ! -s /home/deploy/.ssh/authorized_keys ]; then
    die "Нет ни одного SSH-ключа (пусто в $ROOT_KEYS).
   Сначала положи ключ — из PowerShell на своей машине:
   type \$env:USERPROFILE\\.ssh\\id_ed25519.pub | ssh root@$(hostname -I | awk '{print $1}') \\
       \"mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys\"
   и запусти скрипт заново."
fi

# ── Пользователь deploy ──────────────────────────────────────────────────────
log "Пользователь deploy"
id -u deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
if [ -s "$ROOT_KEYS" ]; then
    # Дописываем, а не перезаписываем: у deploy уже могут быть свои ключи
    # (например, домашней машины), терять их нельзя. sort -u убирает дубли.
    touch /home/deploy/.ssh/authorized_keys
    cat "$ROOT_KEYS" /home/deploy/.ssh/authorized_keys \
        | sed 's/\r$//' | grep -v '^\s*$' | sort -u > /home/deploy/.ssh/authorized_keys.new
    mv /home/deploy/.ssh/authorized_keys.new /home/deploy/.ssh/authorized_keys
fi
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
echo 'deploy ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/deploy
chmod 440 /etc/sudoers.d/deploy
echo "ключей у deploy: $(wc -l < /home/deploy/.ssh/authorized_keys)"

# ── Swap ─────────────────────────────────────────────────────────────────────
# На 2 ГБ памяти это страховка от OOM-killer'а во время сборки образов.
log "Swap 2 ГБ"
if swapon --show=NAME --noheadings | grep -qx /swapfile; then
    echo "уже есть"
else
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf
sysctl -q -w vm.swappiness=10

# ── Файрвол ──────────────────────────────────────────────────────────────────
log "Файрвол"
ufw allow 22/tcp    >/dev/null
ufw allow 80/tcp    >/dev/null
ufw allow 443/tcp   >/dev/null
ufw --force enable  >/dev/null
ufw status numbered | head -20

# ── Пакеты ───────────────────────────────────────────────────────────────────
log "nginx, certbot, git"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git nginx certbot python3-certbot-nginx

log "Docker"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
CODENAME="${VERSION_CODENAME:-noble}"
# У Docker репозиторий под свежий LTS появляется не в день релиза. Пакеты
# совместимы, поэтому молча откатываемся на noble, а не падаем.
if ! curl -fsI "https://download.docker.com/linux/ubuntu/dists/${CODENAME}/Release" >/dev/null 2>&1; then
    echo "репозитория Docker для ${CODENAME} нет — беру noble"
    CODENAME=noble
fi
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
usermod -aG docker deploy
docker --version && docker compose version

# ── Репозиторий ──────────────────────────────────────────────────────────────
if [ -d /opt/k-spot/.git ]; then
    log "Репозиторий"
    chown -R deploy:deploy /opt/k-spot
    echo "/opt/k-spot готов"
fi

IP="$(hostname -I | awk '{print $1}')"
cat <<EOF

╭──────────────────────────────────────────────────────────────────────╮
│  Шаги 1–2 выполнены.                                                 │
╰──────────────────────────────────────────────────────────────────────╯

ДАЛЬШЕ — В НОВОМ ОКНЕ, не закрывая это:

    ssh deploy@${IP}

Зашло без пароля — только ТОГДА закрывай парольный вход (здесь, под root):

    sed -i 's/^#\\?PermitRootLogin.*/PermitRootLogin no/; s/^#\\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
    systemctl reload ssh

Не зашло — ничего не отключай, разбирайся с ключом: ssh -v deploy@${IP}

Потом продолжай с шага 3 в DEPLOY-VPS.md (deploy/.env и запуск).
EOF
