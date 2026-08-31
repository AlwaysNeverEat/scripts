# Переезд на свой сервер (рег.облако, Москва-3)

Зачем: и бэкенд на Render, и база на Supabase, и аватарки в Supabase Storage
живут за границей. Канал туда из РФ режется по-разному у разных провайдеров —
отсюда «у меня не грузится минуту, а у коллеги в ту же секунду всё работает».
Переезд убирает этот класс проблем целиком, а заодно холодные старты Render.

Бонусом сайт и API оказываются на одном домене, и preflight-запросы OPTIONS
исчезают полностью — их было столько же, сколько обычных запросов.

**Сервер:** `80.78.248.146` · Ubuntu 26.04 LTS · 2 vCPU / 2 ГБ / 40 ГБ
**Домен:** `k-spot.ru`

Порядок: сервер → база → сборка → nginx → TLS → DNS.

> ## ⚠️ Прежде чем снимать дамп — погасить Render
>
> Два живых бэкенда на одной базе admin-записей несовместимы, и не по одной
> причине, а по двум:
>
> 1. **Сессия оригинальной админки одна на всех** — это одна строка
>    `zms_records_session`. Два процесса под одной учёткой будут по очереди
>    перелогиниваться, выбивая друг друга, и раздел «Записи» начнёт мигать
>    ошибками у обоих.
> 2. **Дамп копирует очередь операций.** Любая строка `record_ops` со статусом
>    `pending` после восстановления окажется в двух базах сразу, и применят её
>    оба бэкенда — то есть в реальной админке появятся дубли записей.
>
> Поэтому:
>
> ```sql
> -- на Supabase: очередь должна быть пуста
> SELECT count(*) FROM record_ops WHERE status = 'pending';
> ```
>
> Не ноль — дать очереди доработать (она разгребается сама, тик раз в минуту)
> или снять зависшие через интерфейс раздела. Как только ноль —
> **Render → Settings → Suspend Web Service**, и уже потом шаг 5.
>
> Снимать Render с паузы после переезда не нужно: он больше не участвует.

### Если работу людям остановили

Тогда переезд можно вести в лоб, не подстраиваясь под работающих:

- DNS (шаг 8) переключать **не последним, а сразу после шага 7** — так certbot
  отработает по-настоящему, и всё дальше проверяется на живом домене, а не
  через `curl --resolve`.
- Сверять содержимое базы «до и после» не нужно: пока никто не пишет, дамп
  заведомо полный.
- Тестовую запись из шага 11 не забыть удалить — она уедет в реальную админку.

---

## 0. Быстрый путь

Шаги 1–2 (пользователь, swap, файрвол, Docker, nginx, certbot) собраны в
скрипт. Под root на свежей машине:

```bash
apt-get update && apt-get install -y git
git clone -b claude/api-spot-boot-recording-issue-qqvzan \
    https://github.com/AlwaysNeverEat/scripts.git /opt/k-spot
bash /opt/k-spot/deploy/bootstrap.sh
```

Скрипт идемпотентный и намеренно НЕ отключает вход по паролю — это делается
руками после того, как вход под `deploy` по ключу проверен своими глазами.
Команду он печатает в конце.

Ветка `-b` нужна, пока изменения не влиты в main.

Дальше — сразу шаг 3. Разделы 1 и 2 ниже описывают то же самое вручную.

---

## 1. Первый вход и базовая защита

```bash
ssh root@80.78.248.146
```

> **Просит пароль вместо входа по ключу?** Значит cloud-init ключ не положил —
> на рег.облаке это случается, хотя ключ в панели выбран. Проверяется одной
> командой: `ssh -v root@80.78.248.146`. Если в логе есть `Offering public key`,
> а сразу за ним снова `Authentications that can continue`, — ключ предъявлен и
> отвергнут, то есть на сервере его нет.
>
> Лечится в два хода. Сначала задать пароль root в панели («Ещё» → смена
> пароля), затем из PowerShell закинуть ключ — руками в консоли набирать
> ничего не нужно:
>
> ```powershell
> type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@80.78.248.146 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
> ```
>
> После этого `ssh root@80.78.248.146` должен пускать молча. Заодно это лишний
> повод не пропускать отключение парольного входа ниже: раз пароль задан, он
> торчит в интернет.
>
> Ещё вариант, если образ кладёт ключ не root'у: попробовать `ubuntu@`.

Отдельный пользователь вместо работы под root:

```bash
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
echo 'deploy ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/deploy
```

Отключаем вход по паролю и под root — ключ уже залит при создании сервера:

```bash
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/;   s/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload ssh
```

> Проверь вход **новым окном** (`ssh deploy@80.78.248.146`), не закрывая текущее.
> Если что-то не так — останется сессия, из которой можно откатить.

Файрвол:

```bash
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

Swap — на 2 ГБ памяти это страховка от OOM-killer'а во время сборки образов:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf
```

## 2. Docker, nginx, certbot

> Шаги 1 и 2 целиком делает `deploy/bootstrap.sh` — см. врезку в начале файла.
> Ниже то же самое руками, если хочется контролировать каждый шаг.

```bash
apt update && apt install -y ca-certificates curl git nginx
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list
apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
usermod -aG docker deploy
apt install -y certbot python3-certbot-nginx
```

> Если для Ubuntu 26.04 (`$VERSION_CODENAME`) репозитория Docker ещё нет,
> подставь предыдущий LTS-codename вручную — пакеты совместимы.

Дальше всё делается **под `deploy`**, не под root.

## 3. Код и переменные

```bash
sudo mkdir -p /opt/k-spot && sudo chown deploy:deploy /opt/k-spot
git clone https://github.com/AlwaysNeverEat/scripts.git /opt/k-spot
cd /opt/k-spot
cp deploy/env.example deploy/.env
nano deploy/.env
```

Что заполнить — подробно расписано в самом файле. Главное:

- `API_KEY` и `CRM_LINK_SECRET` — **скопировать с Render как есть.** Со сменой
  `API_KEY` перестанут работать уже установленные юзерскрипты, со сменой
  `CRM_LINK_SECRET` у всех слетят привязки учёток CRM.
- `POSTGRES_PASSWORD` — новый, `openssl rand -hex 24`.

## 4. Поднять базу и бэкенд

```bash
docker compose -f deploy/docker-compose.prod.yml up -d --build
docker compose -f deploy/docker-compose.prod.yml ps
curl -s localhost:3001/health     # ждём {"ok":true}
```

## 5. Перенести базу с Supabase

> Сначала — предупреждение в начале файла: очередь `record_ops` пуста, Render
> остановлен. Иначе рискуешь дублями записей в оригинальной админке.

Дамп снимается с **Session pooler** URI (тот же, что стоит в `DATABASE_URL` на
Render). Делать это можно с ноутбука, если на сервере нет доступа к Supabase.

```bash
pg_dump "<SUPABASE_URI>" --no-owner --no-privileges --no-acl -Fc -f carsdb.dump
```

Залить на сервер и восстановить:

```bash
scp carsdb.dump deploy@80.78.248.146:/tmp/
ssh deploy@80.78.248.146
docker compose -f /opt/k-spot/deploy/docker-compose.prod.yml exec -T postgres \
    pg_restore -U carsdb -d carsdb --no-owner --clean --if-exists < /tmp/carsdb.dump
```

Проверка, что данные на месте:

```bash
docker compose -f deploy/docker-compose.prod.yml exec postgres \
    psql -U carsdb -d carsdb -c "SELECT count(*) FROM cars; SELECT count(*) FROM users;"
```

> **Аватарки.** Ссылки на них лежат в `users.avatar` готовыми URL и продолжат
> указывать на Supabase — старые фото не пропадут. Новые загрузки уже лягут на
> локальный диск. Отдельно перетаскивать файлы не нужно; если хочется отвязаться
> от Supabase полностью, попроси всех перезалить фото — это одна кнопка в профиле.

## 6. Собрать сайт

`VITE_API_BASE` **должен быть пустым** — тогда фронт ходит по относительным
путям, то есть на тот же домен. Ради этого всё и затевалось.

Собирать лучше на своей машине (на сервере с 2 ГБ сборка Vite прожорлива):

```bash
cd frontend
VITE_API_BASE='' VITE_API_KEY='<тот же API_KEY>' npm run build
rsync -av --delete dist/ deploy@80.78.248.146:/tmp/site/
```

На сервере:

```bash
sudo mkdir -p /var/www/k-spot
sudo rsync -av --delete /tmp/site/ /var/www/k-spot/
sudo chown -R www-data:www-data /var/www/k-spot
```

## 7. nginx

```bash
sudo cp /opt/k-spot/deploy/nginx.conf /etc/nginx/sites-available/k-spot
sudo ln -sf /etc/nginx/sites-available/k-spot /etc/nginx/sites-enabled/k-spot
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Проверка до переключения DNS — подменяем адрес прямо в запросе:

```bash
curl -s --resolve k-spot.ru:80:80.78.248.146 http://k-spot.ru/health
```

## 8. DNS и TLS

Сначала DNS, потом сертификат: certbot проверяет домен по реальному адресу.

В панели DNS для `k-spot.ru`:

- `A  @    80.78.248.146`
- `A  www  80.78.248.146`
- Записи для `api.k-spot.ru` больше не нужны — API теперь на основном домене.

> **Обязательно: выключить проксирование Cloudflare.** Сейчас домен ходит через
> него (видно по куке `__cf_bm`). Если оставить оранжевое облачко, трафик
> продолжит идти через зарубежный edge и половина смысла переезда пропадёт —
> переключи записи в режим **DNS only** (серое облачко).

Когда `dig +short k-spot.ru` начнёт отдавать `80.78.248.146`:

```bash
sudo certbot --nginx -d k-spot.ru -d www.k-spot.ru
```

Certbot сам допишет TLS-секции и редирект с 80 на 443, автопродление ставится
системным таймером. Проверить: `sudo certbot renew --dry-run`.

## 9. Бэкапы базы

```bash
sudo install -m 0755 /opt/k-spot/deploy/backup-db.sh /usr/local/bin/backup-db.sh
sudo mkdir -p /var/backups/k-spot && sudo chown deploy:deploy /var/backups/k-spot
crontab -e
```

Строкой в крон — каждую ночь в 4:00:

```
0 4 * * * /usr/local/bin/backup-db.sh >> /var/log/k-spot-backup.log 2>&1
```

Проверить сразу: `/usr/local/bin/backup-db.sh`.

## 10. Юзерскрипты

В `userscript/src/oil-calculator/app.js` и `userscript/src/notifier/app.js`:

```js
const DB_API_BASE = 'https://k-spot.ru';
const DB_SITE_URL = 'https://k-spot.ru';
```

И в обоих `header.txt` — `@connect k-spot.ru`. Закоммитить в main, Action
пересоберёт `.user.js`, Tampermonkey подтянет обновление сам.

## 11. Что проверить в конце

1. `https://k-spot.ru` открывается, экран загрузки пролетает мгновенно.
2. В сетевой панели браузера **нет запросов OPTIONS** — их больше не должно
   быть вообще. Это самый наглядный признак, что переезд удался.
3. Вход в аккаунт, раздел «Записи», открытие станции, создание тестовой записи.
4. Загрузка аватарки в профиле → картинка отдаётся с `k-spot.ru/avatars/...`.
5. Заявка на регистрацию доходит в Telegram (проверь, что с этого сервера
   виден `api.telegram.org`: `curl -sI https://api.telegram.org | head -1`).
6. Уйти со вкладки на полчаса и вернуться — доска должна обновиться за секунды.

## Обновление кода потом

```bash
cd /opt/k-spot && git pull
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

Фронт — пересобрать (шаг 6) и перелить в `/var/www/k-spot`.

## Если что-то пошло не так

| Симптом | Куда смотреть |
|---|---|
| Сайт не открывается | `sudo nginx -t`, `sudo systemctl status nginx` |
| 502 от nginx | `docker compose -f deploy/docker-compose.prod.yml logs backend` |
| Бэкенд не стартует | там же; чаще всего незаполненный `.env` |
| Пустая база машин | не прошёл шаг 5, проверь `SELECT count(*) FROM cars` |
| Кончилась память | `free -h`, `docker stats` — swap из шага 1 должен быть включён |
| Не выпускается сертификат | DNS ещё не разъехался или не снято проксирование Cloudflare |
| «CRM недоступна … сертификат самой CRM» | сертификат CRM просрочен или самоподписан — см. ниже |

### Панель CRM пишет про сертификат

Сертификат `crm.zamena-masla-spot.ru` — не наш, и когда он просрочен или
самоподписан, бэкенд рвёт соединение (браузер работника в этом месте
показывает «всё равно перейти», а сервер так не умеет). Панель «Наличие на
станции» при этом пишет `CRM недоступна (crm.zamena-masla-spot.ru): сертификат
сервера просрочен` — сайт и его собственный TLS тут ни при чём, чинится это на
стороне CRM.

Посмотреть, что там сейчас, **с самого сервера** (Node на хосте не стоит,
поэтому через тот же образ, что и сборка сайта):

```bash
cd /opt/k-spot
docker run --rm --network host -v "$PWD:/app" -w /app node:22-alpine \
    node backend/scripts/crm-tls-info.js
```

Скрипт печатает срок действия, кем выдан и готовую строку
`CRM_TLS_FINGERPRINT=…`. Пока сертификат чинят на стороне CRM, эту строку можно
положить в `deploy/.env` и перезапустить бэкенд — панель заработает:

```bash
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

С отпечатком цепочка не проверяется, но сам сертификат сверяется, так что
чужой сервер вместо CRM пароли работников не получит. Отпечаток живёт до
перевыпуска сертификата: как только на CRM поставят нормальный, строку надо
убрать — строгая проверка лучше пина. Забыть её там не страшно: сертификат,
проходящий обычную проверку, пропускается и мимо устаревшего отпечатка, а в
логе бэкенда появляется «CRM_TLS_FINGERPRINT в deploy/.env устарел».

Если панель пишет про **`CRM_TLS_FINGERPRINT_MISMATCH`** — значит отпечаток в
`deploy/.env` задан, сертификат CRM сменился и новый обычную проверку тоже не
проходит (например, поставили другой самоподписанный). Запусти тот же
`crm-tls-info.js` и посмотри строку `проверка:`: «проходит» — строку из `.env`
убрать совсем, «не проходит» — заменить отпечаток на новый. Есть ещё `CRM_TLS_CA_FILE` (свой
удостоверяющий центр) и `CRM_TLS_INSECURE=1` (не проверять вовсе, последнее
средство) — все три описаны в `deploy/env.example`.
