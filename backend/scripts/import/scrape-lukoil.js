#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Скрейпер подбора ЛУКОЙЛ (платформа lubribase / BrandSelector2).
//
// Запуск:  node scripts/import/scrape-lukoil.js [--brands "kia,skoda"]
//              [--manufacturer-id 165] [--limit-brands N] [--limit-models N]
//              [--out файл] [--cache] [--debug]
//
// Каскад (выяснено разведкой; всё строится из window.gon лендинга):
//   GET  /ru/lukoil                         → gon.req_tk (Bearer), gon.lubribase_url, locale, symbol
//   GET  API/category_groups/2/manufacturers                  → марки (id, name); 2 = «Легковые а/м»
//   GET  API/category_groups/2/manufacturers/{id}/equipment/  → ВСЕ модификации марки одним
//        запросом: { mid, model, engine_output_kw/hp, year_from/to, fuel_type_name_en,
//                    generations, drive_types }
//   GET  /ru/lukoil/0?mid={mid}&session={req_tk}              → HTML рекомендации (объёмы по узлам)
//
// Только легковые. Без прокси, вежливый темп по умолчанию. Прерывать можно:
// уже собранные модификации (по _type_key) пропускаются, чекпоинт
// data/import/lukoil-cars.json пишется после каждой машины.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJson, readJson, setScrapeInterval } from './http.js';
import { buildLukoilCar, equipmentTypeKey } from './lukoil-parse.js';
import { createLukoilClient } from './lukoil-api.js';
import log from './log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');

// ── Аргументы ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback;
};
const BRANDS = argValue('--brands', '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const MANUFACTURER_ID = argValue('--manufacturer-id', '');
const LIMIT_BRANDS = parseInt(argValue('--limit-brands', '0')) || Infinity;
const LIMIT_MODELS = parseInt(argValue('--limit-models', '0')) || Infinity;
const OUT_FILE = path.resolve(ROOT, argValue('--out', 'data/import/lukoil-cars.json'));
const CACHE_HTML = args.includes('--cache') || process.env.LUKOIL_CACHE === '1';
const CACHE_DIR = path.resolve(ROOT, 'data/import/cache/lukoil');
if (args.includes('--debug')) log.setDebug(true);

// Вежливый темп по умолчанию для большого прогона без прокси (перекрывается
// переменной SCRAPE_INTERVAL_MS, если задана явно).
setScrapeInterval(1500, 250);
fs.mkdirSync(CACHE_DIR, { recursive: true });

const client = createLukoilClient();

// ── Основной обход ───────────────────────────────────────────────────────────
const cars = readJson(OUT_FILE, []);
const doneKeys = new Set(cars.map(c => c._type_key).filter(Boolean));
let added = 0, skipped = 0, failed = 0, emptyRec = 0;

log.section('ЛУКОЙЛ: сбор легковых');
log.info(`уже собрано локально: ${cars.length}`);

let manufacturers = await client.listManufacturers();
writeJson(path.join(CACHE_DIR, 'manufacturers.json'), manufacturers); // офлайн-фолбэк
log.info(`марок в каталоге: ${manufacturers.length}`);

if (MANUFACTURER_ID) {
    manufacturers = manufacturers.filter(m => String(m.id) === String(MANUFACTURER_ID));
} else if (BRANDS.length) {
    manufacturers = manufacturers.filter(m => BRANDS.some(b => m.name.toLowerCase().includes(b)));
}
manufacturers = manufacturers.slice(0, LIMIT_BRANDS);
log.info(`к обходу: ${manufacturers.length} — ${manufacturers.map(m => m.name).join(', ') || '(все)'}`);

for (const man of manufacturers) {
    let equipment;
    try {
        equipment = await client.listEquipment(man.id);
    } catch (e) {
        log.error(`${man.name}: список модификаций не получен — ${e.message}`);
        failed++;
        continue;
    }
    log.step(`${log.c.brand(man.name)} — модификаций: ${log.c.count(equipment.length)}`);

    let midRefreshed = false;
    for (const item of equipment.slice(0, LIMIT_MODELS)) {
        const key = equipmentTypeKey(man.id, item);
        if (doneKeys.has(key)) { skipped++; continue; }

        try {
            let rec = await client.getRecommendationHtml(item.mid);
            // Протухший одноразовый mid → один раз перезапрашиваем список марки.
            if (!rec.ok && !midRefreshed) {
                log.debug(`рекомендация пуста (HTTP ${rec.status}) — обновляю mid марки`);
                const fresh = (await client.listEquipment(man.id)).find(x => equipmentTypeKey(man.id, x) === key);
                midRefreshed = true;
                if (fresh) rec = await client.getRecommendationHtml(fresh.mid);
            }
            if (!rec.ok) { emptyRec++; log.warn(`${item.model}: нет страницы рекомендации (HTTP ${rec.status})`); continue; }

            if (CACHE_HTML) {
                fs.writeFileSync(path.join(CACHE_DIR, `rec-${key.replace(/[^a-z0-9]+/gi, '_').slice(0, 80)}.html`), rec.html);
            }

            const car = buildLukoilCar({
                manufacturerName: man.name, manufacturerId: man.id, equipment: item,
                recommendationHtml: rec.html, sourceUrl: client.sourceUrl(man.id, item.model),
            });
            cars.push(car);
            doneKeys.add(key);
            added++;
            writeJson(OUT_FILE, cars); // чекпоинт после каждой машины

            const vol = car.fluid_capacities.engine
                ? (car.fluid_capacities.engine.volumeAbsent ? 'нет объёма' : car.fluid_capacities.engine.volume + ' л')
                : 'нет масла';
            log.ok(`${log.c.model(car.model)} ${log.c.engine(item.model)} `
                + `${log.c.power((car.kw ?? '?') + 'кВт/' + (car.bhp ?? '?') + 'лс')} `
                + `${log.c.year((car.year_from ?? '?') + '-' + (car.year_to ?? ''))} · двигатель ${log.c.vol(vol)}`
                + (car._warnings.length ? log.c.yellow(` · ${car._warnings.length} без объёма`) : ''));
        } catch (e) {
            failed++;
            log.error(`${item.model}: ${e.message}`);
        }
    }
}

log.section('ИТОГ ЛУКОЙЛ');
log.ok(`+${added} машин · пропущено ${skipped} · пустых рекомендаций ${emptyRec} · ошибок ${failed}`);
log.info(`файл: ${path.relative(ROOT, OUT_FILE)} (всего ${cars.length})`);
process.exit(failed && !added ? 2 : 0);
