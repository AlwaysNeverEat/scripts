// ─────────────────────────────────────────────────────────────────────────────
// Парсер подбора ЛУКОЙЛ (платформа lubribase / BrandSelector2).
//
// Данные приходят из двух мест:
//   • JSON-эндпоинт equipment  — идентификация модификации (модель, кВт, л.с.,
//     годы, топливо, поколение, привод);
//   • HTML-страница рекомендации (/ru/lukoil/0?mid=…&session=…) — объёмы жидкостей
//     по узлам, отрендеренные Rails-ом.
//
// Форму узлов держим совместимой с motul-parse.js (fluid_capacities =
// { engine, automatic, manual, transfer, diffFront, diffRear }, каждый со
// volumeService/volumeTotal/filterVolume/motulProducts/isCvt/isDct/label),
// чтобы БД, калькулятор и import-cars.js не меняли контракт. Новое: если у узла
// нет объёма — ставим volumeAbsent:true (у Лукойла так бывает у части агрегатов),
// запись всё равно импортируется с пометкой «источник не дал объём».
// ─────────────────────────────────────────────────────────────────────────────

import * as cheerio from 'cheerio';
import { cleanBrand, guessFuelType } from './motul-parse.js';

// ── Классификация агрегата по заголовку блока рекомендации ───────────────────
// Порядок важен: вариатор/робот проверяем ДО общего «автомат» (в «Автоматическая»
// есть подстрока «автомат»); передний/задний — до одиночного «дифференциал».
export function classifyAggregate(title) {
    const t = String(title || '').toLowerCase();
    if (/двигател/.test(t)) return { key: 'engine' };
    if (/раздаточн/.test(t)) return { key: 'transfer' };
    if (/передн/.test(t) && /(дифференциал|мост|главн|редуктор)/.test(t)) return { key: 'diffFront' };
    if (/задн/.test(t)   && /(дифференциал|мост|главн|редуктор)/.test(t)) return { key: 'diffRear' };
    if (/механическ|мкпп/.test(t)) return { key: 'manual' };
    if (/полуавтомат|\bамт\b/.test(t)) return { key: 'manual', isSemiAuto: true };
    if (/вариатор|\bcvt\b/.test(t)) return { key: 'automatic', isCvt: true };
    if (/робот|dsg|dct|преселектив|двойн[а-я]+ сцеплен/.test(t)) return { key: 'automatic', isDct: true };
    if (/автоматическ|акпп|автомат|планетарн/.test(t)) return { key: 'automatic' };
    if (/дифференциал|главн[а-я]* передач|редуктор/.test(t)) return { key: 'diffRear' }; // одиночный редуктор
    return null; // система охлаждения, тормозная, ГУР, ШРУС, стеклоомыватель, уход — вне схемы
}

// «Сервисный объем: 3,75 л» → { volume:3.75, type:'service' }; «Полный/Заправочный»
const VOLUME_RE = /(Сервисн|Полн|Общ|Заправочн)[а-яё]*\s*объ[ёе]м[а-яё]*[^0-9]{0,12}([0-9]+(?:[.,][0-9]+)?)\s*л/i;
const PRODUCT_RE = /ProductCard\/[^"]*"[^>]*>\s*([^<]+?)\s*<\/a>/gi;

function parseComponentBody(bodyHtml, title, flags) {
    const node = {
        volume: 0, filterVolume: 0, motulProducts: [], modes: [],
        label: title, volumeAbsent: false,
        ...(flags.isCvt ? { isCvt: true } : {}),
        ...(flags.isDct ? { isDct: true } : {}),
        ...(flags.isSemiAuto ? { isSemiAuto: true } : {}),
    };
    const text = bodyHtml
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ').trim();

    const vm = text.match(VOLUME_RE);
    if (vm) {
        const vol = parseFloat(vm[2].replace(',', '.'));
        const kind = vm[1].toLowerCase();
        if (/сервисн/.test(kind)) { node.volumeService = vol; node.volumeType = 'service'; }
        else if (/полн|общ/.test(kind)) { node.volumeTotal = vol; node.volumeType = 'total'; }
        else { node.volumePlain = vol; node.volumeType = 'plain'; } // заправочный
        node.volume = vol;
    } else {
        node.volumeAbsent = true;
    }

    let pm; const seen = new Set();
    while ((pm = PRODUCT_RE.exec(bodyHtml))) {
        const name = pm[1].replace(/\s+/g, ' ').trim();
        if (name && name.length > 1 && !seen.has(name)) { seen.add(name); node.motulProducts.push(name); }
    }
    PRODUCT_RE.lastIndex = 0;
    node.rawText = text.slice(0, 400);
    return node;
}

// Разбирает HTML-страницу рекомендации в узлы жидкостей.
export function parseLukoilRecommendation(html) {
    const headerRe = /<a\b[^>]*\bid="component_type_header_(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const heads = [];
    let m;
    while ((m = headerRe.exec(html))) {
        const inner = m[2];
        const divM = inner.match(/<div[^>]*>([\s\S]*?)<\/div>/i);
        const title = (divM ? divM[1] : inner).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        heads.push({ start: m.index, end: headerRe.lastIndex, title });
    }

    const out = {};
    const extras = {};
    for (let i = 0; i < heads.length; i++) {
        const bodyEnd = i + 1 < heads.length ? heads[i + 1].start : html.length;
        const body = html.slice(heads[i].end, bodyEnd);
        const cls = classifyAggregate(heads[i].title);
        const node = parseComponentBody(body, heads[i].title, cls || {});
        if (cls && cls.key) {
            if (!out[cls.key]) out[cls.key] = node; // первый выигрывает (основной агрегат)
        } else {
            const slug = heads[i].title.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '_').replace(/^_+|_+$/g, '');
            if (slug && !extras[slug]) extras[slug] = node;
        }
    }
    return { ...out, _extras: extras };
}

// ── Разбор строки модификации из equipment.model ────────────────────────────
// Примеры: «RIO Hatchback II 1.5 CRDi», «RIO I 1.3», «2121 1.7 (21214)»,
//          «AMANTI 3.5 V6». Объём — первое число с точкой (не путать с «16V»).
export function parseEquipmentModel(modelStr) {
    const out = { modelName: '', engineVolume: null, engineName: null, engineCode: null };
    const raw = String(modelStr || '').replace(/\s+/g, ' ').trim();
    if (!raw) return out;

    const paren = raw.match(/\(([^)]+)\)/);
    if (paren) out.engineCode = paren[1].trim() || null;

    const volM = raw.match(/(?<![\d.])(\d+\.\d+)(?![\d.])/); // 1.5, 0.65, 3.5
    if (volM) {
        out.engineVolume = parseFloat(volM[1]);
        out.modelName = raw.slice(0, volM.index).trim();
        let after = raw.slice(volM.index + volM[1].length).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
        out.engineName = after || null;
    } else {
        out.modelName = raw.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    }
    // Если код двигателя не в скобках — используем текстовое имя двигателя как код
    // (CRDi/CVVT/16V слабее числового, но матчер фильтров это допускает).
    if (!out.engineCode && out.engineName && /[a-zа-я]/i.test(out.engineName)) {
        out.engineCode = out.engineName;
    }
    return out;
}

// Топливо: сперва по английскому имени из equipment, иначе — эвристикой Motul.
export function mapFuelType(fuelEn, fallbackText) {
    const e = String(fuelEn || '').toLowerCase();
    if (/electric|электро/.test(e)) return null;
    if (/diesel|дизел/.test(e)) return '05';
    if (/petrol|gasol|бензин/.test(e)) return '01';
    return guessFuelType(fallbackText);
}

// Стабильный ключ модификации: НЕ зависит от mid (он одноразовый), поэтому
// пригоден и для пропуска уже собранного до запроса страницы рекомендации.
export function equipmentTypeKey(manufacturerId, equipment) {
    const parsed = parseEquipmentModel(equipment.model);
    const kw = equipment.engine_output_kw != null ? Math.round(Number(equipment.engine_output_kw)) : '';
    const bhp = equipment.engine_output_hp != null ? Math.round(Number(equipment.engine_output_hp)) : '';
    return ['lukoil', manufacturerId, parsed.modelName || equipment.model,
        parsed.engineName || '', kw, bhp, equipment.year_from ?? '', equipment.year_to ?? '']
        .map(v => String(v).toLowerCase().trim()).join('|');
}

// ── Сборка записи машины для import-cars.js ─────────────────────────────────
// sourceUrl — ЧИСТЫЙ стабильный deep-link выбора (без одноразовых mid/session),
// его и храним в source_links. recommendationUrl (с токеном) не сохраняем.
export function buildLukoilCar({ manufacturerName, manufacturerId, equipment, recommendationHtml, sourceUrl }) {
    const fluids = parseLukoilRecommendation(recommendationHtml);
    const parsed = parseEquipmentModel(equipment.model);
    const brand = cleanBrand(manufacturerName);
    const kw = equipment.engine_output_kw != null ? Math.round(Number(equipment.engine_output_kw)) : null;
    const bhp = equipment.engine_output_hp != null ? Math.round(Number(equipment.engine_output_hp)) : null;

    const fluid_capacities = {};
    for (const key of ['engine', 'automatic', 'manual', 'transfer', 'diffFront', 'diffRear']) {
        if (fluids[key]) fluid_capacities[key] = fluids[key];
    }

    const warnings = [];
    if (!fluid_capacities.engine) warnings.push('источник не дал масло двигателя');
    else if (fluid_capacities.engine.volumeAbsent) warnings.push('источник не дал объём двигателя');
    for (const key of ['automatic', 'manual', 'transfer', 'diffFront', 'diffRear']) {
        if (fluid_capacities[key] && fluid_capacities[key].volumeAbsent) {
            warnings.push(`источник не дал объём: ${fluid_capacities[key].label}`);
        }
    }

    const typeKey = equipmentTypeKey(manufacturerId, equipment);

    return {
        brand,
        model: parsed.modelName || equipment.model,
        generation: equipment.generations || null,
        engine_code: parsed.engineCode,
        engine_name: parsed.engineName,
        engine_volume: parsed.engineVolume,
        year_from: equipment.year_from ?? null,
        year_to: equipment.year_to ?? null,
        kw,
        bhp,
        fuel_type: mapFuelType(equipment.fuel_type_name_en, `${equipment.model} ${parsed.engineName || ''}`),
        motul_name: [brand, equipment.model].filter(Boolean).join(' · '),
        fluid_capacities,
        car_approvals: [],
        source_links: sourceUrl ? { lukoil: sourceUrl } : {},
        _drive_types: equipment.drive_types || null,
        _type_key: typeKey,
        _warnings: warnings,
        _extras: fluids._extras,
    };
}
