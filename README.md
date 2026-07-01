# Tampermonkey Scripts + Oil Calculator Cars DB

Экосистема калькулятора масел: юзерскрипты для сайтов подбора + общая база
рассчитанных машин (backend + сайт).

## Состояние репозитория

| Компонент | Путь | Статус |
|-----------|------|--------|
| **Калькулятор масел** (юзерскрипт) | `Mann + Motul Oil Calculator-2.12.user.js` | Рабочий, v2.21. Пока НЕ интегрирован с базой (интеграция — в работе) |
| Пересчёт чека SPOT CRM | `SPOT-CRM-Пересчёт-чека-1.0.user.js` | Рабочий |
| Прочие CRM-хелперы | `*.user.js` / `*.user(N).js` в корне | Рабочие, самостоятельные |
| Backend (REST API) | `backend/` | Рабочий: Node.js + Express + PostgreSQL |
| Сайт (поиск + страница машины) | `frontend/` | Рабочий: Vite + vanilla JS |
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

## Quick start (Docker)

```bash
docker compose up --build

# Frontend → http://localhost:5173
# Backend  → http://localhost:3001
# Postgres → localhost:5432
```

Postgres-контейнер прогоняет миграции из `db/migrations/` при первом старте.

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

Интеграция калькулятора с базой (отправка отчёта, авто-проверка «машина уже
рассчитана») — в работе, см. дорожную карту.

---

## Deploy — Supabase + Railway + Vercel

### 1. Supabase (Postgres)
- Create project → SQL Editor → прогнать по порядку все файлы из `db/migrations/` → Run.
- Copy **Settings → Database → Connection string (URI)**.

### 2. Railway (Backend)
- New project → Deploy from GitHub → Root directory: `backend`.
- Env vars: `DATABASE_URL`, `API_KEY` (random string), `CORS_ORIGINS` (Vercel URL).
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

All endpoints require `x-api-key: <API_KEY>` header.

| Method | Path | Description |
|--------|------|-------------|
| `GET`   | `/health` | Liveness (no auth) |
| `POST`  | `/api/cars` | Create/upsert car record |
| `GET`   | `/api/cars/match?engine_code=&brand=&model=&year=&volume=` | Best match |
| `GET`   | `/api/cars/search?q=` | Free-text search (top 20) |
| `GET`   | `/api/cars/:id` | Full record |
| `GET`   | `/api/cars?page=&limit=` | Paginated list |
| `PATCH` | `/api/cars/:id` | Edit record |

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
├── Mann + Motul Oil Calculator-2.12.user.js  ← калькулятор (будет собираться из shared/)
├── SPOT-CRM-Пересчёт-чека-1.0.user.js        ← пересчёт чека (будет собираться из shared/)
├── <прочие CRM-хелперы>.user.js
├── backend/
│   ├── src/{index,db/client,routes/cars,search/translit}.js
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/{main,calculator,style.css}
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
