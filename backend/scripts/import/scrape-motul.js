#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Скрейпер Motul Lubricant Advisor: обходит каскад «категория → марка →
// модель → модификация», скачивает advice-страницы и складывает машины с
// объёмами жидкостей в data/import/motul-cars.json.
//
// Запуск:  node scripts/import/scrape-motul.js [--brands "skoda,kia"]
//              [--limit-models N] [--limit-types N] [--out файл]
//
// Скрипт можно прерывать: уже собранные модификации (по _type_key)
// пропускаются при повторном запуске, advice-страницы кэшируются в
// data/import/cache/motul/.
//
// Механика сайта (ASP.NET WebForms, выяснено разведкой):
//   GET  default.aspx?data=1&lang=rus                    → viewstate
//   POST кнопка категории «Легковые автомобили» (cat1)   → список марок lstMake
//   POST __EVENTTARGET=lstMake, lstMake=<id>             → список моделей lstModel
//   POST __EVENTTARGET=lstModel, lstModel=<id>           → список модификаций lstType
//   POST __EVENTTARGET=LinkButtonAdvice + lstType=<id>   → 302 advice.aspx?type=<hex>
//   GET  advice.aspx?type=<hex>                          → страница рекомендаций
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { politeFetch, CookieJar, writeJson, readJson } from './http.js';
import { parseMotulAdvice, parseTypeLabel, guessFuelType, cleanBrand, parseModelLabel } from './motul-parse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');

const BASE = 'https://motul.lubricantadvisor.com';
const PAGE = `${BASE}/default.aspx?data=1&lang=rus`;

// Популярный российский парк. Сопоставляется с названиями марок Motul без
// учёта регистра и скобок: «lada» найдёт «Lada (VAZ / Zhiguli)»,
// «volkswagen» — «Volkswagen (EU)» и «Volkswagen (RUS)».
const DEFAULT_BRANDS = [
    'lada', 'kia', 'hyundai', 'toyota', 'volkswagen', 'skoda', 'renault',
    'nissan', 'ford', 'chevrolet', 'mitsubishi', 'mazda', 'bmw', 'mercedes',
    'audi', 'opel', 'peugeot', 'citroen', 'honda', 'suzuki', 'subaru',
    'lexus', 'daewoo', 'geely', 'chery', 'haval', 'ssangyong', 'uaz', 'gaz',
];

// ── Аргументы ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function argValue(name, fallback) {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback;
}
const BRANDS = argValue('--brands', '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const LIMIT_MODELS = parseInt(argValue('--limit-models', '0')) || Infinity;
const LIMIT_TYPES  = parseInt(argValue('--limit-types', '0')) || Infinity;
const OUT_FILE  = path.resolve(ROOT, argValue('--out', 'data/import/motul-cars.json'));
const CACHE_DIR = path.resolve(ROOT, 'data/import/cache/motul');

const wantedBrands = BRANDS.length ? BRANDS : DEFAULT_BRANDS;

// ── ASP.NET-хелперы ──────────────────────────────────────────────────────────
const jar = new CookieJar();

function extractForm(html) {
    const $ = cheerio.load(html);
    const fields = {};
    for (const name of ['__EVENTTARGET', '__EVENTARGUMENT', '__LASTFOCUS',
                        '__VIEWSTATE', '__VIEWSTATEGENERATOR', '__EVENTVALIDATION']) {
        const v = $(`input[name="${name}"]`).attr('value');
        if (v != null) fields[name] = v;
    }
    return fields;
}

function selectOptions($, name) {
    return $(`select[name="${name}"] option`).map((_, o) => ({
        id: $(o).attr('value'),
        label: $(o).text().trim(),
    })).get().filter(o => o.id);
}

async function getPage(url) {
    const res = await politeFetch(url, { headers: { Cookie: jar.header(), Referer: PAGE } });
    jar.absorb(res);
    return res.text();
}

// POST формы; возвращает { html } или { redirect } для 302.
async function postForm(prevHtml, overrides) {
    const fields = { ...extractForm(prevHtml), search: '', hidItemId: '', hidIsModel: '', ...overrides };
    const body = new URLSearchParams(fields).toString();
    const res = await politeFetch(PAGE, {
        method: 'POST',
        headers: {
            Cookie: jar.header(),
            Referer: PAGE,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
    });
    jar.absorb(res);
    if (res.status >= 300 && res.status < 400) {
        return { redirect: new URL(res.headers.get('location'), BASE).href };
    }
    return { html: await res.text() };
}

// ── Основной обход ───────────────────────────────────────────────────────────
const cars = readJson(OUT_FILE, []);
const doneKeys = new Set(cars.map(c => c._type_key).filter(Boolean));
fs.mkdirSync(CACHE_DIR, { recursive: true });

let added = 0, skipped = 0, failed = 0;

console.log(`Motul: старт. Уже собрано: ${cars.length}. Марки: ${wantedBrands.join(', ')}`);

const startHtml = await getPage(PAGE);

// Кнопка «Легковые автомобили» — image button cat1 (alt="1").
const catResult = await postForm(startHtml, {
    'ctl00$ContentPlaceHolder1$rptCategoryBtn$ctl01$btnImage.x': '10',
    'ctl00$ContentPlaceHolder1$rptCategoryBtn$ctl01$btnImage.y': '10',
});
if (!catResult.html) throw new Error('не удалось открыть категорию «Легковые автомобили»');
const catHtml = catResult.html;

const makes = selectOptions(cheerio.load(catHtml), 'ctl00$ContentPlaceHolder1$lstMake');
console.log(`Марок в каталоге: ${makes.length}`);

// Рынки USA/CAN, TUR и Iran Khodro не про наш парк — пропускаем.
const EXCLUDE_MARKETS = /\((USA|TUR)|IRAN KHODRO/i;

const matchedMakes = makes.filter(m =>
    wantedBrands.some(b => m.label.toLowerCase().includes(b))
    && !EXCLUDE_MARKETS.test(m.label));
// (RUS)-варианты первыми: при конфликте по upsert-ключу их данные приоритетнее.
matchedMakes.sort((a, b) => Number(b.label.includes('(RUS)')) - Number(a.label.includes('(RUS)')));
console.log(`Совпало марок: ${matchedMakes.length} — ${matchedMakes.map(m => m.label).join(', ')}`);

for (const make of matchedMakes) {
    const makeResult = await postForm(catHtml, {
        '__EVENTTARGET': 'ctl00$ContentPlaceHolder1$lstMake',
        'ctl00$ContentPlaceHolder1$lstMake': make.id,
    });
    if (!makeResult.html) { console.warn(`⚠ ${make.label}: постбэк марки не вернул страницу`); failed++; continue; }

    const models = selectOptions(cheerio.load(makeResult.html), 'ctl00$ContentPlaceHolder1$lstModel');
    console.log(`\n${make.label}: ${models.length} моделей`);

    for (const model of models.slice(0, LIMIT_MODELS)) {
        const modelResult = await postForm(makeResult.html, {
            '__EVENTTARGET': 'ctl00$ContentPlaceHolder1$lstModel',
            'ctl00$ContentPlaceHolder1$lstMake': make.id,
            'ctl00$ContentPlaceHolder1$lstModel': model.id,
        });
        if (!modelResult.html) { console.warn(`⚠ ${model.label}: постбэк модели не вернул страницу`); failed++; continue; }

        const types = selectOptions(cheerio.load(modelResult.html), 'ctl00$ContentPlaceHolder1$lstType');
        console.log(`  ${model.label}: ${types.length} модификаций`);

        for (const type of types.slice(0, LIMIT_TYPES)) {
            const typeKey = `${make.id}:${model.id}:${type.id}`;
            if (doneKeys.has(typeKey)) { skipped++; continue; }

            try {
                const car = await scrapeType(make, model, type, modelResult.html, typeKey);
                if (car) {
                    cars.push(car);
                    doneKeys.add(typeKey);
                    added++;
                    writeJson(OUT_FILE, cars); // чекпоинт после каждой машины
                }
            } catch (e) {
                failed++;
                console.warn(`  ⚠ ${type.label}: ${e.message}`);
            }
        }
    }
}

console.log(`\nГотово: +${added} машин (пропущено уже собранных: ${skipped}, ошибок: ${failed}).`);
console.log(`Файл: ${OUT_FILE} (всего ${cars.length})`);

// ── Одна модификация: постбэк «Рекомендации» → advice-страница → запись ─────
async function scrapeType(make, model, type, modelHtml, typeKey) {
    const cacheFile = path.join(CACHE_DIR, `advice-${type.id}.html`);
    let adviceHtml, adviceUrl;

    const cached = fs.existsSync(cacheFile) ? fs.readFileSync(cacheFile, 'utf8') : '';
    const cachedUrl = cached.match(/^<!-- source: (\S+) -->/);
    if (cached && cachedUrl) {
        adviceHtml = cached.replace(/^<!-- source: \S+ -->\n/, '');
        adviceUrl = cachedUrl[1];
    } else {
        // Как в живом UI: сначала постбэк выбора модификации (сервер
        // запоминает её в сессии), затем клик по «Рекомендации».
        const sel = await postForm(modelHtml, {
            '__EVENTTARGET': 'ctl00$ContentPlaceHolder1$lstType',
            'ctl00$ContentPlaceHolder1$lstMake': make.id,
            'ctl00$ContentPlaceHolder1$lstModel': model.id,
            'ctl00$ContentPlaceHolder1$lstType': type.id,
        });
        if (!sel.html) throw new Error('постбэк выбора модификации не вернул страницу');
        const adv = await postForm(sel.html, {
            '__EVENTTARGET': 'ctl00$ContentPlaceHolder1$LinkButtonAdvice',
            'ctl00$ContentPlaceHolder1$lstMake': make.id,
            'ctl00$ContentPlaceHolder1$lstModel': model.id,
            'ctl00$ContentPlaceHolder1$lstType': type.id,
        });
        if (!adv.redirect || /error\.aspx/i.test(adv.redirect)) {
            throw new Error('нет редиректа на advice.aspx');
        }
        adviceUrl = adv.redirect;
        const res = await politeFetch(adviceUrl, { headers: { Cookie: jar.header(), Referer: PAGE } });
        if (res.status !== 200) throw new Error(`advice HTTP ${res.status}`);
        adviceHtml = await res.text();
        // Ошибочные и пустые страницы не кэшируем.
        if (adviceHtml.includes('AdviceComponentTitleText')) {
            fs.writeFileSync(cacheFile, `<!-- source: ${adviceUrl} -->\n` + adviceHtml);
        }
    }

    const data = parseMotulAdvice(adviceHtml);
    if (!data.engine) {
        // Электромобили и экзотика без моторного масла — пропускаем молча.
        return null;
    }

    const t = parseTypeLabel(type.label);
    const m = parseModelLabel(model.label);
    if (!t.yearFrom) throw new Error(`не разобран год из «${type.label}»`);

    const { engineCode, ...engineData } = data.engine;
    const fluid = { engine: engineData };
    for (const key of ['automatic', 'manual', 'transfer', 'diffFront', 'diffRear']) {
        if (data[key]) fluid[key] = data[key];
    }

    return {
        brand: cleanBrand(make.label),
        model: m.model,
        generation: m.generation,
        engine_code: engineCode || null,
        engine_name: t.engineName || null,
        engine_volume: t.volume,
        year_from: t.yearFrom,
        year_to: t.yearTo,
        kw: t.kw,
        bhp: t.bhp,
        fuel_type: guessFuelType(type.label + ' ' + (engineCode || '')),
        motul_name: data.motulName,
        fluid_capacities: fluid,
        car_approvals: [],
        source_links: { motul: adviceUrl },
        _make_label: make.label,
        _model_label: model.label,
        _type_label: type.label,
        _type_key: typeKey,
        _warnings: [],
    };
}
