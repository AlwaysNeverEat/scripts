# Массовый импорт машин (Motul → объёмы, ROLF/UPEC → допуски)

Пайплайн из трёх шагов. Все скрипты запускаются из `backend/`,
можно прерывать и перезапускать — прогресс сохраняется после каждой машины,
скачанные страницы кэшируются в `data/import/cache/` (в .gitignore).

## 1. Объёмы жидкостей с Motul Lubricant Advisor

```bash
node scripts/import/scrape-motul.js                     # все марки из списка в скрипте
node scripts/import/scrape-motul.js --brands "skoda,kia"
node scripts/import/scrape-motul.js --limit-models 2 --limit-types 3   # быстрый прогон
```

Обходит каскад «Легковые автомобили → марка → модель → модификация» на
motul.lubricantadvisor.com (lang=rus), парсит advice-страницы тем же кодом,
что и юзерскрипт-калькулятор (см. `motul-parse.js`), и пишет машины в
`data/import/motul-cars.json`: идентичность (марка/модель/код двигателя/объём/
годы/мощность) + `fluid_capacities` по агрегатам + продукты Motul + ссылка
на advice-страницу для `source_links.motul`.

Электромобили и модификации без моторного масла пропускаются.

## 2. Допуски с ROLF (виджет UPEC)

```bash
node scripts/import/scrape-rolf.js            # дообогащает motul-cars.json
node scripts/import/scrape-rolf.js --force    # пересобрать даже уже обогащённые
```

Для каждой машины ищет модификацию в API виджета podbor.upec.pro (поиск по
коду двигателя, сверка кода/объёма/мощности/годов) и собирает объединение
`meets_requirements` рекомендованных для двигателя масел — то же самое, что
руками собирает `watchForRolfTags()` из юзерскрипта. Теги нормализуются
(«MB 229.51/52/31» → три отдельных допуска, кириллические двойники букв
склеиваются) и пишутся в `car_approvals`. Для кросс-чека в `_rolf` сохраняется
найденная модификация и заправочный объём двигателя по версии ROLF.

Партнёрский токен достаётся со страницы rolfoil.ru/podbor автоматически.

Машины без совпадения остаются с пустыми `car_approvals` и пометкой в
`_warnings` (старые/редкие машины, которых нет в каталоге ROLF).

## 3. Заливка в базу

```bash
DATABASE_URL=postgres://... node scripts/import/import-cars.js --dry-run
DATABASE_URL=postgres://... node scripts/import/import-cars.js
DATABASE_URL=postgres://... node scripts/import/import-cars.js --limit 100
DATABASE_URL=postgres://... node scripts/import/import-cars.js data/import/cars-enriched.json.gz
DATABASE_URL=postgres://... node scripts/import/import-cars.js --progress-every 25
DATABASE_URL=postgres://... node scripts/import/import-cars.js --user vasya   # начислить машины на юзера
```

`--user <login>` — машины записываются на пользователя сайта: `created_by` =
его display_name + событие `added` в `car_events`, так что топ и ачивки
считают их как добавленные им. Без флага — `created_by='import'`, без событий.

Вместо прямого Postgres можно работать через HTTPS Management API Supabase
(когда сырой TCP наружу закрыт): `SUPABASE_ACCESS_TOKEN=sbp_... `
`SUPABASE_PROJECT_REF=<ref проекта> node scripts/import/import-cars.js ...`

По образцу `scripts/seed.js`: прямая вставка в Postgres с
`ON CONFLICT DO NOTHING` по уникальному ключу машины — **рассчитанные
коллегами вручную машины никогда не перезаписываются**. Импортированные
получают:

- `created_by = 'import'`;
- `notes = '⚠ Импортировано автоматически (Motul + ROLF), не проверено'`
  (+ приписка, если допуски не нашлись) — видно на странице машины;
- пустые `filter_part_numbers` (фильтры добираются руками при проверке);
- `source_links.motul` со ссылкой на advice-страницу;
- поисковые поля через `buildNameFields` — машины сразу ищутся на сайте.

`--dry-run` показывает, сколько машин добавится/пропустится, без записи.
Импортёр умеет читать как обычные `.json`, так и сжатые `.json.gz` снапшоты,
пишет heartbeat-прогресс каждые 100 записей (или значение `--progress-every N`)
и ретраит временные сбои БД/Management API. Если отдельная машина всё равно
падает на записи, она попадает в итоговый список ошибок, а скрипт продолжает
доливать оставшиеся записи и завершится кодом `2`, чтобы конвейер/лог явно
показал проблему.

## 4. Фильтры (артикулы MANN-FILTER)

```bash
node scripts/import/scrape-filters.js                     # подбор по всем машинам
node scripts/import/scrape-filters.js --brands "skoda" --limit 20
node scripts/import/apply-filters.js --user gtrixoff --dry-run
node scripts/import/apply-filters.js --user gtrixoff      # дозапись в базу
```

`scrape-filters.js` ходит в открытый GraphQL-каталог mann-filter.com
(бренд → серии моделей → модификации → фильтры), матчит по модели и
двигателю (код двигателя главный, объём/мощность запасные, год мягкий),
группирует одинаковые машины — один лукап на группу. Перед новыми запросами
он также безопасно копирует уже найденные Mann-фильтры на очевидные совпадения
(та же марка/модель/код двигателя/объём/кВт/л.с.), но только если среди уже
найденных записей нет конфликтующих вариантов. Результат — отдельный
`data/import/filters.json` (vf=воздушный, mf=масляный, sf=салонный (по первым буквам; подписи в скобках на странице машины перепутаны); салонник
с приоритетом CU > CUK > FP, как в юзерскрипте «Скопировать 3 артикула»).

`apply-filters.js` дозаписывает фильтры ТОЛЬКО машинам с пустыми
`filter_part_numbers` (заполненное руками неприкосновенно) и пишет событие
`edited` в car_events на юзера из `--user` — на сайте это обычная правка,
метрика edited её считает.

Машины, не найденные на Mann, помечаются в filters.json `source:'none'` —
задел под fallback-скрейперы LYNX/GoodWill/BIG (в основном нужны китайцам:
Geely/Haval у Mann почти не покрыты).

## Конвейер целиком — Windows (для не-технического запуска)

1. **Поставь Node.js** (один раз). В любом окне PowerShell/командной строке:
   `winget install OpenJS.NodeJS.LTS` — либо скачай с https://nodejs.org (кнопка
   LTS, дальше «Далее-Далее»). Перезагрузка не нужна, но окно закрой и открой.
2. **Возьми свежий код**: `git pull` в папке проекта.
3. **Двойной клик** по `backend\scripts\import\run-import.bat`.
   - Первый раз спросит токен Supabase — возьми на
     https://supabase.com/dashboard/account/tokens (Generate new token), вставь,
     Enter. Сохранится в `C:\Users\<ты>\.cars-import.json`, больше не спросит.
   - Дальше сам распакует данные, поставит зависимости и пойдёт циклами.

Окно можно свернуть — пусть работает. Закрыть окно = остановить конвейер
(перезапуск безопасен, продолжит с места). Логи — в `data\import\logs\`.
Сбросить токен — удалить `C:\Users\<ты>\.cars-import.json`.

## Конвейер целиком — Linux/Mac (pipeline.sh)

```bash
cd backend
chmod +x scripts/import/pipeline.sh
nohup ./scripts/import/pipeline.sh > /dev/null 2>&1 &     # запуск в фоне
```

Оба скрипта (`.sh` и `.ps1`) крутят все этапы циклами (пауза 10 мин), сами
перезапускают упавший скрейпер Motul, останавливаются когда всё собрано и
долито. Доступ к БД: `DATABASE_URL` из `backend/.env`, либо
`SUPABASE_ACCESS_TOKEN=sbp_...` + `SUPABASE_PROJECT_REF=<ref>` (через HTTPS —
нужно, если прямой Postgres недоступен: хост db.*.supabase.co только IPv6).
Переменные: `IMPORT_USER` (логин на сайте, по умолчанию gtrixoff),
`PIPELINE_SLEEP` (пауза цикла, сек), `IMPORT_COLOR=0` (отключить
ANSI-цвета в логах дозаписи фильтров), `SUPABASE_QUERY_INTERVAL_MS` (пауза между
SQL-запросами через Supabase Management API, по умолчанию 350 мс, помогает не
упираться в HTTP 429), `SUPABASE_QUERY_ATTEMPTS` (число ретраев 429/5xx, по
умолчанию 30), `SNAPSHOT_PUSH=1` (коммитить данные после цикла, только для .sh).

### Дебаг

```bash
tail -f ../data/import/logs/pipeline.log          # что делает конвейер
tail -f ../data/import/logs/scrape-motul.log      # прогресс скрейпера Motul
pgrep -af "scripts/import"                        # какие процессы живы
pkill -f "scripts/import"                         # остановить всё
node -e "const f=p=>{const d=JSON.parse(require('fs').readFileSync(p));return Array.isArray(d)?d.length:Object.keys(d).length};console.log('собрано:',f('../data/import/motul-cars.json'),'| обогащено:',f('../data/import/cars-enriched.json'))"
```

На Windows логи смотреть так (PowerShell):
`Get-Content data\import\logs\pipeline.log -Tail 20 -Wait`

Сколько уже в базе (SQL в Supabase → SQL Editor):

```sql
SELECT count(*) AS всего,
       count(*) FILTER (WHERE jsonb_array_length(car_approvals) > 0) AS с_допусками,
       count(*) FILTER (WHERE coalesce(filter_part_numbers->'vf'->>'part','') <> '') AS с_фильтрами,
       count(*) FILTER (WHERE kw IS NOT NULL) AS с_квт
FROM cars;
```

## Технические детали

- Частота запросов — 1/сек (`SCRAPE_INTERVAL_MS` меняет), ретраи с бэкоффом.
- `certs/globalsign-alphassl-2025.pem` — промежуточный сертификат для
  podbor.upec.pro (их сервер не отдаёт цепочку целиком); подхватывается
  автоматически, как и `NODE_EXTRA_CA_CERTS`/`HTTPS_PROXY`.
- Полный обход всех марок из списка — десятки тысяч запросов, несколько
  часов; удобно гонять марками: `--brands "kia" `, потом следующую.
