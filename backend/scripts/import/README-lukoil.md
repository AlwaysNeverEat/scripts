# Импорт из ЛУКОЙЛ (lubribase / BrandSelector2)

Основной источник объёмов жидкостей — подбор **ЛУКОЙЛ** (`lukoil.lubribase.ru`),
приходит на смену Motul. У Лукойла объёмы аккуратно разложены по узлам (двигатель,
КПП, раздаточная коробка, передний/задний дифференциалы), а идентификация машины
(модель, кВт, л.с., годы, топливо, поколение, привод) отдаётся структурированным JSON.

Только легковые (`category_group=2`). Без прокси — вежливый темп по умолчанию.

## Запуск

```bash
cd backend
# весь конвейер циклами: сбор всех марок → заливка в БД частями → фильтры по марке
./scripts/import/pipeline-lukoil.sh
IMPORT_USER=vasya ./scripts/import/pipeline-lukoil.sh

# Windows PowerShell
powershell -ExecutionPolicy Bypass -File .\scripts\import\pipeline-lukoil.ps1
$env:IMPORT_USER='vasya'; powershell -ExecutionPolicy Bypass -File .\scripts\import\pipeline-lukoil.ps1

# оркестратор напрямую (все легковые марки)
node scripts/import/scrape-lukoil-all.js --import-new --with-filters --user gtrixoff

# одна марка (или несколько), для проверки
node scripts/import/scrape-lukoil.js --brands "kia,skoda" --limit-models 3 --debug
```

Доступ к БД — как в `pipeline.sh`: `DATABASE_URL=postgres://…` **или**
`SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` (через HTTPS Management API).

## Каскад API (для сопровождения)

Всё строится из `window.gon` лендинга (`gon.req_tk` — одноразовый Bearer-токен,
`gon.lubribase_url` — база API). Инкапсулировано в `lukoil-api.js`.

```
GET  /ru/lukoil                                             → gon.req_tk, gon.lubribase_url, locale, symbol
GET  API/category_groups                                    → id 2 = «Легковые а/м»
GET  API/category_groups/2/manufacturers                    → марки [{id,name}]  (≈323)
GET  API/category_groups/2/manufacturers/{id}/equipment/    → ВСЕ модификации марки одним запросом:
     { mid, model, engine_output_kw/hp, year_from/to, fuel_type_name_en, generations, drive_types }
GET  /ru/lukoil/0?mid={mid}&session={req_tk}                → HTML рекомендации (объёмы по узлам)
```

`mid` — одноразовый (протухает); при пустой рекомендации список марки
перезапрашивается для свежего `mid`. Токен обновляется раз в ~5 минут / на 401-403.

## Файлы

| Файл | Назначение |
|---|---|
| `lukoil-api.js` | клиент API: сессия/токен, GET JSON, HTML рекомендации, список марок/модификаций |
| `lukoil-parse.js` | парсер: HTML рекомендации → узлы `fluid_capacities`, разбор `equipment.model`, сборка записи |
| `lukoil-parse.test.js` | юнит-тесты на фикстурах `__fixtures__/lukoil/` |
| `scrape-lukoil.js` | сбор одной/нескольких марок → `data/import/lukoil-cars.json` (чекпоинт после каждой машины) |
| `scrape-lukoil-all.js` | оркестратор: марка целиком → заливка в БД частями → фильтры по марке |
| `pipeline-lukoil.sh` | Linux/macOS-конвейер циклами + лог + опц. снапшот |
| `pipeline-lukoil.ps1` | Windows PowerShell-конвейер с теми же переменными окружения и логом |
| `log.js` | общий цветной логгер (уровни, `--debug`, `NO_COLOR`/`IMPORT_COLOR=0`) |

Форма узлов совместима с Motul (`fluid_capacities = {engine, automatic, manual,
transfer, diffFront, diffRear}`), поэтому БД, калькулятор и `import-cars.js` не меняются.
Новое: у узла без объёма — `volumeAbsent:true` (Лукойл иногда не даёт объём; запись
всё равно импортируется с пометкой «источник не дал объём»).

## Перезапись БД (`import-cars.js --overwrite`)

Выбрано «перезаписывать всё». Ключевые флаги импортёра:

- `--overwrite` — перезаписывает oil/тех-поля (`fluid_capacities`, `kw`, `bhp`,
  `engine_name`, `fuel_type`, `motul_name`, имя источника, `notes`, поисковые поля) на
  **всех** совпавших строках, включая ручные. **Сохраняются**: `car_approvals` (допуски),
  `filter_part_numbers` (фильтры), `created_by`/`created_at` (авторство) — их источник не
  поставляет; `source_links`/`source_keys` **сливаются** (mann/motul остаются, добавляется lukoil).
- `--allow-no-volume` — не отбраковывать запись без объёма масла двигателя.
- `--source lukoil` — маркер `notes` = «⚠ Импортировано автоматически (ЛУКОЙЛ)…».
- `--pace-size 25 --pace-pause-ms 30000` — темп «25 машин раз в 30 секунд».

## Вежливость (без прокси)

- Глобальный троттл `politeFetch` с дефолтом ~1.5 с/запрос + джиттер (`setScrapeInterval`).
- Бэкофф на 429/5xx (до 30 с); на 401/403 — обновление токена. Если банит — снижаем темп, не «долбим».
- Идём строго по одной марке; чекпоинт `lukoil-cars.json` — прогон можно прерывать и продолжать.
- Переменные: `SCRAPE_INTERVAL_MS` (перекрывает дефолт), `LUKOIL_BRANDS`, `LUKOIL_LIMIT_BRANDS`,
  `LUKOIL_WITH_FILTERS=0`, `LUKOIL_PACE_SIZE`, `LUKOIL_PACE_PAUSE_MS`.

## Проверка

```bash
node --test backend/scripts/import/lukoil-parse.test.js   # парсер на реальных фикстурах
node scripts/import/scrape-lukoil.js --brands lada --limit-models 2 --debug   # живой end-to-end
node scripts/import/import-cars.js <файл> --dry-run --overwrite --allow-no-volume --source lukoil
```
