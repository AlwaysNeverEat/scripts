# Tampermonkey Scripts + Oil Calculator Cars DB

Экосистема калькулятора масел: юзерскрипты для сайтов подбора + общая база
рассчитанных машин (backend + сайт).

## Состояние репозитория

| Компонент | Путь | Статус |
|-----------|------|--------|
| **Калькулятор масел** (юзерскрипт) | `Mann + Motul Oil Calculator-2.12.user.js` | Рабочий, интегрирован с базой (кнопка «📤 Отправить отчёт») |
| **Нотификатор для коллег** | `SPOT DB Notifier-1.0.user.js` | Лёгкий скрипт: «✓ эта машина уже рассчитана» → ссылка на сайт |
| Пересчёт чека SPOT CRM | `SPOT-CRM-Пересчёт-чека-1.0.user.js` | Рабочий |
| Прочие CRM-хелперы | `*.user.js` / `*.user(N).js` в корне | Рабочие, самостоятельные |
| **Записи** (клон админки ZMS) | `frontend/records.html` + `backend/src/records/` | Рабочий: кеш + офлайн-очередь + карта |
| Backend (REST API) | `backend/` | Рабочий: Node.js + Express + PostgreSQL |
| Сайт (поиск + страница машины + профиль/топ) | `frontend/` | Рабочий: Vite + vanilla JS, за гейтом входа |
| Аккаунты и сессии | `backend/src/auth/` | Рабочий: bcryptjs, сессии, автовыход в полночь МСК |
| Telegram-админка (заявки, юзеры, машины) | `backend/src/bot/` | Рабочий: long-polling в том же процессе |
| Общая логика | `shared/` | Каталог масел, подбор, отчёт — единый источник |
| Схема БД | `db/migrations/` | PostgreSQL, миграции по порядку |

## Целевая архитектура

**`shared/` — единственный источник правды** для каталога масел (`oils.js`,
включая прайс), логики подбора (`calculator.js`) и текстового отчёта
(`report.js`).

Корневой `Mann + Motul Oil Calculator-2.12.user.js` — **собираемый артефакт**:
генерируется из `shared/` + `userscript/src/` (site-glue: парсеры сайтов,
виджет, GM_*). Руками его не редактировать.

**Как обновить прайс/каталог масел:** отредактировать `shared/oils.js`
(можно прямо в веб-интерфейсе GitHub) → после пуша в `main` GitHub Action
`build-userscripts` сам пересоберёт `.user.js` с новым номером версии, и
Tampermonkey у всех установивших подтянет обновление по `@updateURL`.

Локальная сборка и тесты:

```bash
npm install
npm test                  # паритетные тесты отчёта и HTML виджета
npm run build:userscript  # пересобрать корневой .user.js
```

> Историческая справка: логика в `shared/` была извлечена из юзерскрипта для
> сайта, но юзерскрипт продолжал жить со своей встроенной копией — из-за этого
> прайс приходилось обновлять в нескольких файлах. Сборка из `shared/`
> устраняет это.

## Дорожная карта

1. ~~Уборка репозитория~~ (этот коммит)
2. Сборка юзерскрипта из `shared/` (единый прайс + GitHub Action)
3. Фикс подбора по допускам (иерархия MB 229.x и т.п., показ всех подходящих масел)
4. Кнопка «📤 Отправить отчёт» в калькуляторе → база (+ сервис-флаги: «АКПП полную не делаем» и т.п.)
5. Страница машины на сайте: шапка, агрегаты, «игнорировать допуска», режим «Нашли ошибку?»
6. Улучшение поиска (префиксы, опечатки, русский ввод)
7. Юзерскрипт-нотификатор для коллег: «✓ эта машина уже рассчитана» → ссылка на сайт

---

## Записи — клон-обложка админки ZMS

Страница `/records.html` — полноценная обёртка над оригинальной админкой
записей `zamena-masla-spot.ru/admin/record`, переживающая её падения.

**Как работает.** Бэкенд раз в минуту (env `RECORDS_SYNC_INTERVAL_MS`,
минимум 10 с) заходит в оригинал под общими кредами, парсит HTML доски
(`shared/crmRecords.js`) на сегодня и завтра (МСК) и кладёт снапшоты в
`record_snapshots`. Страница читает кеш, показывает «обновлено N назад»; если
оригинал лежит — баннер + все изменения копятся в очереди `record_ops` и
проталкиваются автоматически после восстановления (порядок сохраняется,
конфликт «слот уже занят» помечает операцию failed с причиной).

**Доступ.** Без аккаунтов сайта: кто-то один вводит логин/пароль оригинальной
админки (форма появляется сама), сервер хранит их в `zms_records_config`,
сам перелогинивается и страница работает у всех. Пароль сменили — любой
вводит новый по кнопке с ключом.

**Что умеет UI** (только SVG-иконки, тёмная тема сайта):
- обзор всех станций с мини-полосой занятости; поиск по имени/цифрам
  телефона/адресу;
- вид станции: дорожек столько, сколько боксов (2 у двухбоксовых, 3 у
  Оптиков 2); продлённые записи (одно имя, слоты встык, телефон-заглушка
  `+71111111111` у продолжений) рисуются одним «червячком» с насечками;
- запись сразу на 30 мин–3 ч с графическим превью занимаемых слотов
  (первый слот — настоящая запись, остальные — продолжения, как в
  оригинальном скрипте «Продлить запись»);
- «Перенести всю запись» одним действием (весь червячок, с подсветкой окон
  нужной длины на любой станции/дне), продление, умное удаление с
  чекбоксами цепочки, копирование строки записи, правка имени/телефона
  (госномер и комментарий при переносе не затираются — бэкенд дочитывает их
  из формы редактирования);
- карта станций (Leaflet из бандла + бесплатные тайлы CARTO): плашки с
  названиями, цветом линии метро и счётчиком записей; поиск по улице через
  Nominatim показывает ближайшие станции с расстоянием; мини-карта прямо в
  окне создания — клиент передумал, адрес меняется кликом, введённые данные
  сохраняются;
- очередь операций видна отдельным окном (pending можно отменить), призраки
  отложенных записей рисуются на сетке пунктиром.

**Справочник станций** — `shared/stationsMeta.js` (метро/линия/боксы/высоты
из юзерскрипта «Карта метро v8» + координаты с лендинга SPOT + уточнения
геокодером; включая новую станцию **Ветеранов 167к8**). Новые станции
оригинала подхватываются автоматически (колонка появится без меты), мету
дописать одной строкой.

**Env бэкенда:** `ZMS_ADMIN_BASE_URL` (default `https://zamena-masla-spot.ru`),
`ZMS_ADMIN_LOGIN_PATH|LOGIN_FIELD|PASSWORD_FIELD` (если форма логина не
распознаётся сама), `ZMS_ADMIN_FETCH_TIMEOUT_MS`, `RECORDS_SYNC_INTERVAL_MS`.

**Разработка без боевой админки:** `node backend/scripts/zms-mock.js` (порт
3999, логин `admin`/`spot123`) + `ZMS_ADMIN_BASE_URL=http://127.0.0.1:3999` у
бэкенда. У мока есть `POST /__mock/down {"down":true}` — эмуляция падения для
проверки очереди — и `GET /__mock/records` — дамп записей.

---

## Quick start (Docker)

```bash
docker compose up --build

# Frontend → http://localhost:5173
# Backend  → http://localhost:3001
# Postgres → localhost:5432
```

Postgres-контейнер прогоняет миграции из `db/migrations/` при первом старте.
Без `TELEGRAM_BOT_TOKEN`/`SUPABASE_*` (не заданы по умолчанию в
`docker-compose.yml`) регистрация продолжает работать — заявки просто копятся
в БД без уведомления, а загрузка аватарки вернёт понятную ошибку.

---

## Backend setup (manual)

```bash
cd backend
cp .env.example .env          # fill DATABASE_URL, API_KEY, CORS_ORIGINS
npm install
npm run dev
```

| Env var | Description |
|---------|-------------|
| `DATABASE_URL` | PostgreSQL URI |
| `API_KEY` | Shared secret — must match `x-api-key` in all clients |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `PORT` | Default `3001` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token (@BotFather). Empty = bot disabled, registration requests just pile up unactioned |
| `ADMIN_TELEGRAM_ID` | Telegram user id seeded as the first bot admin (default `691442300`) |
| `SUPABASE_URL` | Supabase project URL — needed for avatar uploads to Storage |
| `SUPABASE_SERVICE_KEY` | Supabase **service_role** key (not anon) — write access to the `avatars` bucket |

Тестовые данные и проверка поиска:

```bash
DATABASE_URL=... node scripts/seed.js          # 17 тестовых машин
API_BASE=http://localhost:3001 API_KEY=... node scripts/search-check.mjs
# 17 фикстур «запрос → ожидаемый top-1»: русский ввод, префиксы, опечатки
```

---

## Frontend setup (manual)

```bash
cd frontend
cp .env.example .env          # set VITE_API_KEY; leave VITE_API_BASE empty for local dev
npm install
npm run dev                   # http://localhost:5173
npm run build                 # → dist/
```

In dev, Vite proxies `/api/*` to `http://localhost:3001` automatically.

---

## Userscript setup

1. Установить [Tampermonkey](https://www.tampermonkey.net/).
2. Установить `Mann + Motul Oil Calculator-2.12.user.js` (raw-ссылка из этого
   репозитория — автообновление работает через `@updateURL`).

**Отправка отчёта в базу машин** (кнопка «📤 Отправить отчёт» в калькуляторе):

1. В `userscript/src/oil-calculator/app.js` заполнить константы:
   ```js
   const DB_API_BASE = 'https://your-backend.example.com';
   const DB_API_KEY  = 'your-api-key';
   const DB_SITE_URL = 'https://cars.example.com';
   ```
2. В `userscript/src/oil-calculator/header.txt` добавить хост backend'а
   в `@connect` (сейчас там `localhost` для локальной разработки).
3. Пересобрать: `npm run build:userscript` (или запушить — Action соберёт сам).

Кнопка открывает окно со всеми данными машины (объёмы, допуски, фильтры),
галочками особенностей («АКПП полную не делаем», «фильтра в поддоне нет»,
«этому роботу расчёт не делаем») и заметкой — всё можно поправить перед
отправкой. Повторная отправка той же машины обновляет запись, а не плодит дубли.

При нажатии «Отправить» юзерскрипт проверяет сохранённый токен сессии
(`GM_setValue`); если его нет или сервер ответил 401 (протух — например,
наступила полночь по МСК) — всплывает окно логина тем же аккаунтом, что и на
сайте. `created_by` в базе всегда берётся из этой сессии, а не из юзерскрипта.

**Нотификатор для коллег** (`SPOT DB Notifier-1.0.user.js`) — для тех, кто
работает по старинке и калькулятором не пользуется:

1. Установить Tampermonkey и скрипт по raw-ссылке.
2. Константы `API_BASE` / `API_KEY` / `SITE_URL` — в
   `userscript/src/notifier/app.js`, хост в `@connect` — в его `header.txt`.

Скрипт молча сидит на Mann Filter / LYNXauto; если найденная машина уже есть
в базе — показывает баннер «✓ эта машина уже рассчитана», клик открывает
страницу машины на сайте со всеми объёмами, допусками и ценами.
Если машины в базе нет — не показывает ничего.
Ставить вместе с основным калькулятором не нужно.

---

## Deploy — Supabase + Railway + Vercel

### 1. Supabase (Postgres)
- Create project → SQL Editor → прогнать по порядку все файлы из `db/migrations/` → Run.
- Copy **Settings → Database → Connection string (URI)**.

### 2. Railway (Backend)
- New project → Deploy from GitHub → Root directory: `backend`.
- Env vars: `DATABASE_URL`, `API_KEY` (random string), `CORS_ORIGINS` (Vercel URL),
  `TELEGRAM_BOT_TOKEN`, `ADMIN_TELEGRAM_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
  (see table above — same variables regardless of host).
- Note the public URL.

### 3. Vercel (Frontend)
- New project → Root directory: `frontend`.
- Env vars: `VITE_API_BASE` (Railway URL), `VITE_API_KEY`.

---

## Self-host via Cloudflare Tunnel

```bash
# Run locally
docker compose up -d

# Install cloudflared, then:
cloudflared tunnel login
cloudflared tunnel create carsdb

# ~/.cloudflared/config.yml:
# tunnel: <id>
# credentials-file: ...
# ingress:
#   - hostname: api.yourdomain.com
#     service: http://localhost:3001
#   - hostname: cars.yourdomain.com
#     service: http://localhost:5173
#   - service: http_status:404

cloudflared tunnel run carsdb
```

---

## API reference

All endpoints require `x-api-key: <API_KEY>` header. Everything except
`/api/auth/login` and `/api/auth/register` additionally requires
`Authorization: Bearer <session token>` (see [Аутентификация](#аутентификация)
below) — sessions expire for everyone at midnight Moscow time.

| Method   | Path | Description |
|----------|------|-------------|
| `GET`    | `/health` | Liveness (no auth at all) |
| `POST`   | `/api/auth/register` | Registration request → pending, notified in Telegram |
| `POST`   | `/api/auth/login` | `{login, password}` → `{token, user}` |
| `POST`   | `/api/auth/logout` | Destroys the session behind the given token |
| `GET`    | `/api/auth/me` | Current session's user |
| `POST`   | `/api/cars` | Create/upsert car record (`created_by` = session user) |
| `GET`    | `/api/cars/match?engine_code=&brand=&model=&year=&volume=` | Best match |
| `GET`    | `/api/cars/search?q=` | Free-text search (top 20) |
| `GET`    | `/api/cars/:id` | Full record |
| `GET`    | `/api/cars?page=&limit=` | Paginated list |
| `PATCH`  | `/api/cars/:id` | Edit record (`comment` field → car_events) |
| `DELETE` | `/api/cars/:id` | **mod/admin only** — permanent delete |
| `GET`    | `/api/cars/:id/events` | This car's event feed (added/edited placards) |
| `PATCH`  | `/api/profile` | Change own display name |
| `POST`   | `/api/profile/avatar` | Upload avatar (multipart, `avatar` field) → Supabase Storage |
| `GET`    | `/api/profile/stats` | `{added, edited}` counts for the current user |
| `GET`    | `/api/profile/achievements` | Empty extensible placeholder feed |
| `GET`    | `/api/top` | Top users ranked by (cars added + cars edited); `{rows, excluded}` |

### Аутентификация

Two layers, stacked: `x-api-key` is a blunt "are you one of our clients"
gate (same as before); a session token on top identifies *which* user is
acting, drives `created_by`/`car_events`, and gates role-restricted actions
(`DELETE /api/cars/:id`). Registration is request-based: the form creates a
`registration_requests` row and pings admins in Telegram with Accept/Decline
buttons (request dies after 30 minutes). All sessions — for every user —
become invalid at the first minute of a new day in Moscow time
(`backend/src/auth/midnightMsk.js`), forcing a fresh login daily on both the
site and the userscript.

### Telegram-админка

Бот отвечает только тем Telegram-аккаунтам, что есть в таблице `bot_admins`
(сидируется `ADMIN_TELEGRAM_ID` при первом старте). Команды в чате с ботом:

| Команда | Действие |
|---------|----------|
| `/users <текст>` | Поиск по имени/логину, у каждого — «Забанить», «Поменять ник», «Сделать модератором / Снять» |
| `/cars <текст>` | Поиск машин, у каждой — «Удалить машину» (с подтверждением) |
| `/addadmin <telegram_id>` | Передать доступ к этой админке ещё одному Telegram-аккаунту |

Заявки на регистрацию приходят отдельными сообщениями с кнопками
**✅ Accept / ❌ Decline** сразу при отправке формы на сайте — их не нужно
искать командой.

### filter_part_numbers shape

```json
{
  "vf": { "part": "W7023",  "absent": false },
  "mf": { "part": "C2695",  "absent": false },
  "sf": { "part": null,      "absent": true  }
}
```

Every key must be present. `absent: true` OR non-empty `part`. Otherwise → HTTP 400.

---

## Repo structure

```
scripts/
├── Mann + Motul Oil Calculator-2.12.user.js  ← калькулятор (собирается из shared/)
├── SPOT-CRM-Пересчёт-чека-1.0.user.js        ← пересчёт чека (собирается из shared/)
├── <прочие CRM-хелперы>.user.js
├── backend/
│   ├── src/
│   │   ├── index.js                 ← Express + запуск Telegram-воркера
│   │   ├── db/client.js
│   │   ├── auth/                    ← пароли, сессии, полночь МСК, валидация
│   │   ├── bot/                     ← Telegram long-polling + команды админки
│   │   ├── storage/                 ← загрузка аватарок в Supabase Storage
│   │   └── routes/{cars,auth,profile,top}.js
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/{main,authGate,profile,top,carPage,calculator,style.css}
│   ├── index.html / Dockerfile / nginx.conf
│   └── package.json
├── shared/
│   ├── oils.js        ← каталог масел + прайс (ЕДИНСТВЕННОЕ место правки цен)
│   ├── calculator.js  ← подбор масел, расчёт стоимости
│   └── report.js      ← buildReport() — одинаковый отчёт везде
├── db/migrations/*.sql
├── docker-compose.yml
└── README.md
```
