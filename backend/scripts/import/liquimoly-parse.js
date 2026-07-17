// ─────────────────────────────────────────────────────────────────────────────
// Разбор ответов подбора Liqui Moly (движок lubribase.ru) в ту же форму записи
// машины, что отдаёт scrape-motul.js: brand / model / engine_volume / год /
// kw / bhp / fuel_type / fluid_capacities{engine,automatic,manual,transfer,
// diffFront,diffRear}.
//
// Особенности источника:
//  • объёмы приходят массивом строк ("volumes":["3"]); у части агрегатов
//    (МКПП, дифференциалы) объём пустой — это НЕ ошибка, помечаем noSourceVolume;
//  • кВт И л.с. есть оба (engine_output_kw / engine_output_hp);
//  • дифференциалы называются иначе, чем у Motul — маппинг ниже;
//  • engine_code источник не даёт (в модели только имя вроде "100 Avant C3 1.8").
// ─────────────────────────────────────────────────────────────────────────────

import { guessFuelType } from './motul-parse.js';

// component_type_name у LM (в нижнем регистре, без хвостовых пробелов) → ключ
// агрегата в схеме fluid_capacities. Всё, чего нет в карте (гидроусилитель,
// охлаждение, тормоза, топливо, стеклоомыватель, ШРУС, уход) — пропускаем:
// в калькуляторе таких слотов нет.
const COMPONENT_MAP = {
    'двигатель': 'engine',
    'автоматическая кпп': 'automatic',
    'механическая кпп': 'manual',
    'раздаточная коробка': 'transfer',
    'передний дифференциал': 'diffFront',
    'задний дифференциал': 'diffRear',
};

export function mapComponentType(name) {
    return COMPONENT_MAP[String(name || '').toLowerCase().replace(/\s+/g, ' ').trim()] || null;
}

// Первое разумное число из массива строк объёмов ("3", "3.5", "4,2").
function parseVolume(volumes) {
    if (!Array.isArray(volumes)) return null;
    for (const raw of volumes) {
        const m = String(raw).replace(',', '.').match(/\d+(?:\.\d+)?/);
        if (m) {
            const n = Number(m[0]);
            if (Number.isFinite(n) && n > 0) return n;
        }
    }
    return null;
}

// Один агрегат LM → объект-компонент в форме Motul (те же поля, что читает
// калькулятор и валидатор import-cars). volume=null означает «источник не дал
// объём» — агрегат существует, но цифры нет.
function buildComponent(lmComponent) {
    const volume = parseVolume(lmComponent.volumes);
    const products = (lmComponent.products || [])
        .map(p => (p && p.name ? String(p.name).trim() : ''))
        .filter(Boolean);
    return {
        volumeService: null,
        volumeTotal: null,
        volumePlain: volume,
        volume: volume,                          // 0/null трактуется как «нет объёма»
        volumeType: volume ? 'plain' : null,
        filterVolume: null,
        noVolume: volume == null,
        products,                                // рекомендованные масла LM
        rawVolumes: Array.isArray(lmComponent.volumes) ? lmComponent.volumes : [],
    };
}

// equipmentData.component_types[] → { engine, automatic, ... }.
// Если один агрегат встречается дважды (у LM бывает два «Передний
// дифференциал»), берём тот, где объём заполнен; продукты объединяем.
export function buildFluidCapacities(data) {
    const caps = {};
    for (const ct of data.component_types || []) {
        const key = mapComponentType(ct.component_type_name);
        if (!key) continue;
        for (const comp of ct.components || []) {
            const built = buildComponent(comp);
            const prev = caps[key];
            if (!prev) { caps[key] = built; continue; }
            if (prev.volume == null && built.volume != null) {
                built.products = [...new Set([...prev.products, ...built.products])];
                caps[key] = built;
            } else {
                prev.products = [...new Set([...prev.products, ...built.products])];
            }
        }
    }
    return caps;
}

const clean = (v) => (v == null || v === 'null' || v === '') ? null : v;
const num = (v) => { const n = Number(clean(v)); return Number.isFinite(n) ? n : null; };

// Стабильный внутренний id модификации из подписанного mid (JWT):
// payload = base64url([{ "id": 14583 }, { "exp": ... }]). Сам mid ротируется
// (~7 дней), а id стабилен — по нему ведём чекпоинт и дедупликацию.
export function decodeMidId(mid) {
    try {
        const payload = String(mid).split('.')[1];
        const json = Buffer.from(payload + '='.repeat((4 - payload.length % 4) % 4), 'base64').toString('utf8');
        const arr = JSON.parse(json);
        for (const part of arr) if (part && part.id != null) return Number(part.id);
    } catch { /* повреждённый токен — вернём null */ }
    return null;
}

// Собираем итоговую запись машины из элемента equipment (список модификаций)
// и подробностей equipmentData. brand/seriesName берём из контекста каскада.
export function buildCarRecord({ brand, seriesName, equipmentItem, data }) {
    const fluid = buildFluidCapacities(data);
    const kw = num(equipmentItem.engine_output_kw) ?? num(data.engine_output_kw);
    const bhp = num(equipmentItem.engine_output_hp) ?? num(data.engine_output_hp);
    const volume = num(data.engine_volume) ?? num(equipmentItem.engine_volume);
    const yearFrom = num(equipmentItem.year_from) ?? num(data.year_from);
    const yearTo = num(equipmentItem.year_to) ?? num(data.year_to);
    const midId = decodeMidId(equipmentItem.mid);
    const fuelName = clean(equipmentItem.fuel_type_name) || clean(data.fuel_type_name);

    // engine_name — читаемая подпись модификации (LM даёт «100 Avant C3 1.8»).
    const engineName = clean(equipmentItem.model) || clean(data.model) || '';

    const noVolumeAggs = Object.entries(fluid)
        .filter(([, c]) => c.noVolume).map(([k]) => k);

    return {
        brand: cleanBrand(brand),
        model: cleanModel(seriesName),
        generation: clean(equipmentItem.generations) || null,
        engine_code: null,                       // LM не отдаёт код двигателя
        engine_name: engineName,
        engine_volume: volume,
        year_from: yearFrom,
        year_to: yearTo,
        kw,
        bhp,
        fuel_type: fuelName ? guessFuelType(fuelName + ' ' + engineName) : guessFuelType(engineName),
        liqui_name: engineName,
        fluid_capacities: fluid,
        car_approvals: [],
        source_links: { liquimoly: 'https://liquimoly.ru/podbor-masla/' },
        service_flags: noVolumeAggs.length ? { noSourceVolume: noVolumeAggs } : {},
        _type_key: `lm:${midId ?? equipmentItem.mid}`,
        _lm_id: midId,
        _warnings: noVolumeAggs.length ? [`нет объёма: ${noVolumeAggs.join(', ')}`] : [],
    };
}

// Марка в верхнем регистре без рыночных суффиксов — как cleanBrand у Motul.
export function cleanBrand(brand) {
    return String(brand || '').replace(/\s*\((?:eu|rus|us)\)\s*$/i, '').trim().toUpperCase();
}

// Модель — из series_name («100», «A4»); подчищаем лишние пробелы.
export function cleanModel(name) {
    return String(name || '').replace(/\s+/g, ' ').trim();
}
