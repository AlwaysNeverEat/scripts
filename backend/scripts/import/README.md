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

## Технические детали

- Частота запросов — 1/сек (`SCRAPE_INTERVAL_MS` меняет), ретраи с бэкоффом.
- `certs/globalsign-alphassl-2025.pem` — промежуточный сертификат для
  podbor.upec.pro (их сервер не отдаёт цепочку целиком); подхватывается
  автоматически, как и `NODE_EXTRA_CA_CERTS`/`HTTPS_PROXY`.
- Полный обход всех марок из списка — десятки тысяч запросов, несколько
  часов; удобно гонять марками: `--brands "kia" `, потом следующую.
