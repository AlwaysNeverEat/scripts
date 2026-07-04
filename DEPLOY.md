# Деплой по бесплатному пути: Supabase + Render + GitHub Pages

Три части системы и где они живут:

| Часть | Хостинг | Бесплатно |
|-------|---------|-----------|
| PostgreSQL | Supabase | да (free tier) |
| Backend (Express API) | Render.com | да (засыпает после 15 мин простоя, первый запрос ждёт ~30–60 сек) |
| Сайт (статика) | GitHub Pages | да |

Порядок важен: база → backend → сайт → юзерскрипты.

---

## 1. Supabase (база) — ~5 минут

1. В проекте (`cars-db`) открой **SQL Editor**.
2. Прогони по очереди содержимое файлов, каждый — отдельным запуском Run:
   - `db/migrations/001_init.sql`
   - `db/migrations/002_add_approvals.sql`
   - `db/migrations/003_unique_car.sql`
   - `db/migrations/004_service_flags.sql`
3. Кнопка **Connect** (вверху) → вкладка **Session pooler** → скопируй URI вида
   `postgresql://postgres.xxxx:[PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
   и подставь свой пароль от базы.

> Именно **Session pooler**, не Direct connection — прямое подключение у
> Supabase доступно только по IPv6, а Render ходит по IPv4.

## 2. Render (backend) — ~10 минут

1. [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint** →
   подключи GitHub-репозиторий `scripts` — Render сам найдёт `render.yaml`.
2. В настройках сервиса `cars-db-backend` → **Environment** заполни:
   - `DATABASE_URL` — URI из шага 1.3
   - `API_KEY` — придумай длинную случайную строку (это общий пароль API)
   - `CORS_ORIGINS` — `https://<твой-логин>.github.io`
3. Дождись деплоя, открой `https://<имя-сервиса>.onrender.com/health` —
   должно ответить `{"ok":true}`. Запомни этот URL.

## 3. GitHub Pages (сайт) — ~5 минут

1. Репозиторий → **Settings → Pages → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions**:
   - вкладка **Variables** → `VITE_API_BASE` = URL backend'а с Render
     (например `https://cars-db-backend.onrender.com`, без слэша в конце)
   - вкладка **Secrets** → `VITE_API_KEY` = тот же `API_KEY`
3. Запусти workflow **Deploy site to GitHub Pages** (вкладка Actions → Run
   workflow) или просто запушь что-нибудь в `frontend/` в main.
4. Сайт появится на `https://<твой-логин>.github.io/scripts/`.

## 4. Юзерскрипты — переключить на прод

1. В `userscript/src/oil-calculator/app.js` и `userscript/src/notifier/app.js`
   поменяй константы:
   ```js
   const DB_API_BASE = 'https://cars-db-backend.onrender.com';
   const DB_API_KEY  = '<твой API_KEY>';
   const DB_SITE_URL = 'https://<твой-логин>.github.io/scripts';
   ```
   (в нотификаторе они называются `API_BASE` / `API_KEY` / `SITE_URL`)
2. В обоих `header.txt` замени `@connect localhost` на
   `@connect cars-db-backend.onrender.com` (свой хост Render).
3. Закоммить в main — Action пересоберёт `.user.js`, Tampermonkey у всех
   подтянет обновление сам.

## Проверка всего пути

1. Открой машину на mann-filter.com, посчитай как обычно → «📤 Отправить отчёт».
2. Клик по ссылке в зелёном тосте → страница машины на
   `github.io/scripts/#/car/...`.
3. На сайте набери в поиске «форд фокус» (или свою машину по-русски).
4. У коллеги с нотификатором на той же машине на Mann появится баннер
   «✓ эта машина уже рассчитана».

## Известные ограничения бесплатного плана

- Render засыпает: первый запрос после простоя ждёт ~30–60 сек (юзерскрипт
  покажет таймаут — просто повтори). Supabase free может ставить базу на
  паузу после недели без обращений — заходи в дашборд, жми Restore.
- API-ключ вшит в сборку сайта: любой, у кого есть ссылка на сайт, technically
  может писать в базу. Для внутреннего инструмента ок; захочешь строже —
  разделим ключи на чтение/запись отдельной задачей.
