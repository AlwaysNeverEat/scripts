#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Сбор машин из подбора Liqui Moly (движок lubribase.ru) — строго по одной
// марке за раз, вежливо (через politeFetch), с чекпоинтом и резюмом.
//
// Запуск:
//   node scripts/import/scrape-liquimoly.js --brands "Audi"            # одна марка
//   node scripts/import/scrape-liquimoly.js --brands "Audi,BMW" --limit 50
//   node scripts/import/scrape-liquimoly.js                            # ВСЕ марки подряд
//
// Каскад: manufacturers → series → engineSizes → equipment → equipmentData.
// Объёмы по агрегатам + кВт + л.с. Где источник не дал объём — запись всё равно
// сохраняется с service_flags.noSourceVolume (не выбрасываем).
//
// На устойчивую блокировку сайта (403 / стойкий 429) — останавливаемся с
// сохранением прогресса. Лимит сайта уважаем, обходить не пытаемся.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './http.js';
import {
    fetchManufacturers, fetchSeries, fetchEngineSizes, fetchEquipment,
    fetchEquipmentData, BlockedError,
} from './liquimoly-api.js';
import { buildCarRecord, cleanBrand, decodeMidId } from './liquimoly-parse.js';
import { color, mark, stage, info, warn } from './log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback; };

const OUT_FILE = path.resolve(ROOT, arg('--out', 'data/import/liquimoly-cars.json'));
const CACHE_DIR = path.resolve(ROOT, 'data/import/cache/liquimoly');
const LIMIT = parseInt(arg('--limit', '0')) || Infinity;
const FORCE = args.includes('--force');
const BRANDS = arg('--brands', '').split(',').map(x => cleanBrand(x)).filter(Boolean);
fs.mkdirSync(CACHE_DIR, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Кэш ответов — чтобы повторный прогон не бомбил сайт заново и был резюмируемым.
// equipmentData кэшируем по стабильному id из mid (mid ротируется ~7 дней).
function cacheFile(key) { return path.join(CACHE_DIR, `${key}.json`); }
async function cached(key, fn) {
    const file = cacheFile(key);
    if (!FORCE && fs.existsSync(file)) {
        try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* перезапросим */ }
    }
    const data = await fn();
    fs.writeFileSync(file, JSON.stringify(data));
    return data;
}

// Уже собранные машины — для резюма пропускаем модификации, чьи _type_key есть.
const cars = readJson(OUT_FILE, []) || [];
const haveKeys = new Set(cars.map(c => c._type_key));
let sinceCheckpoint = 0;
function checkpoint(force = false) {
    if (!force && ++sinceCheckpoint < 20) return;
    sinceCheckpoint = 0;
    writeJson(OUT_FILE, cars);
}

let addedTotal = 0, noVolTotal = 0, skipped = 0, errors = 0;

async function scrapeBrand(brand) {
    stage(`МАРКА ${brand.name.toUpperCase()}`);
    const series = await cached(`series-${brand.id}`, () => fetchSeries(brand.id)) || [];
    info(`  ${mark.step} моделей: ${series.length}`);

    for (const model of series) {
        const sizes = await cached(`sizes-${brand.id}-${model.id}`, () => fetchEngineSizes(brand.id, model.id)) || [];
        for (const size of sizes) {
            const volume = size.volume;
            const equipKey = `equip-${brand.id}-${model.id}-${String(volume).replace(/[^\d.]/g, '')}`;
            let equipment;
            try {
                equipment = await cached(equipKey, () => fetchEquipment({
                    manufacturerid: brand.id, manufacturername: brand.name,
                    seriesid: model.id, seriesname: model.name, volume,
                })) || [];
            } catch (error) {
                if (error instanceof BlockedError) throw error;
                errors++; warn(`${color.model(model.name)} ${volume}л: ${error.message}`); continue;
            }

            for (const item of equipment) {
                if (addedTotal >= LIMIT) return;
                const typeKey = `lm:${decodeMidId(item.mid) ?? item.mid}`;
                if (haveKeys.has(typeKey)) { skipped++; continue; }

                const midId = decodeMidId(item.mid);
                let data;
                try {
                    data = await cached(`data-${midId ?? 'x'}-${equipKey}`, () => fetchEquipmentData(item.mid));
                } catch (error) {
                    if (error instanceof BlockedError) throw error;
                    errors++; warn(`${color.model(model.name)} ${item.model || volume}: ${error.message}`); continue;
                }
                if (!data || !Array.isArray(data.component_types)) { errors++; continue; }

                const car = buildCarRecord({ brand: brand.name, seriesName: model.name, equipmentItem: item, data });
                cars.push(car);
                haveKeys.add(typeKey);
                addedTotal++;
                if (car._warnings.length) noVolTotal++;

                const eng = car.fluid_capacities.engine;
                const engVol = eng && eng.volume != null ? color.vol(`${eng.volume}л`) : color.warn('нет объёма');
                const power = [car.kw != null ? `${car.kw}кВт` : '', car.bhp != null ? `${car.bhp}лс` : ''].filter(Boolean).join('/');
                info(`  ${mark.ok} ${color.model(car.model)} ${color.engine(car.engine_name)} `
                    + `${color.year(`${car.year_from ?? '?'}-${car.year_to ?? ''}`)} `
                    + `${color.power(power)} двиг=${engVol}`);
                checkpoint();
            }
        }
    }
}

(async () => {
    info(color.stage('Liqui Moly — подбор масла (lubribase.ru)'));
    info(color.dim(`robots.txt подбора закрыт для роботов — это осознанный ручной сбор для личного калькулятора; лимит сайта уважаем, на блок встаём.`));

    let manufacturers;
    try {
        manufacturers = await fetchManufacturers();
    } catch (error) {
        console.error(`${mark.fail} не удалось получить список марок: ${error.message}`);
        process.exit(1);
    }
    let brands = manufacturers || [];
    if (BRANDS.length) {
        brands = brands.filter(b => BRANDS.some(want => cleanBrand(b.name).includes(want) || want.includes(cleanBrand(b.name))));
    }
    info(`марок к сбору: ${color.brand(String(brands.length))}${BRANDS.length ? ` (фильтр: ${BRANDS.join(', ')})` : ' (ВСЕ)'}`);

    try {
        for (const brand of brands) {
            if (addedTotal >= LIMIT) break;
            await scrapeBrand(brand);
            checkpoint(true);
        }
    } catch (error) {
        checkpoint(true);
        if (error instanceof BlockedError) {
            console.error(`\n${mark.fail} ${color.err(error.message)}`);
            console.error(color.dim(`Прогресс сохранён в ${path.relative(ROOT, OUT_FILE)} — можно продолжить позже (резюм по _type_key).`));
            process.exit(3);
        }
        throw error;
    }

    checkpoint(true);
    stage('ИТОГО Liqui Moly');
    info(`  добавлено машин: ${color.ok(String(addedTotal))}`);
    info(`  из них без объёма двигателя/агрегата: ${color.warn(String(noVolTotal))}`);
    info(`  пропущено (уже собраны): ${skipped}`);
    if (errors) info(`  ошибок запросов: ${color.warn(String(errors))}`);
    info(`  файл: ${path.relative(ROOT, OUT_FILE)} (${cars.length} машин всего)`);
    process.exit(0);
})();
