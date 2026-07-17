// ─────────────────────────────────────────────────────────────────────────────
// Тонкий клиент к публичному эндпоинту подбора Liqui Moly:
//   POST https://liquimoly.ru/podbor-masla/ajax/luboilapiajax.php
//   тело — JSON { operation, ... }, ответ — { data: ... }.
//
// Каскад операций:
//   categories                                         → [{id,name}]
//   manufacturers  {id:categoryId}                     → [{id,name}]        (марки)
//   series         {categoryid,id:manufacturerId}      → [{id,name}]        (модели)
//   engineSizes    {categoryid,manufacturerid,id:ser}  → [{volume}]         (объёмы)
//   equipment      {…,id:volume}                       → [{mid,model,engine_output_kw,
//                                                          engine_output_hp,year_from,year_to,…}]
//   equipmentData  {mid}                               → { component_types:[…], … }
//
// Все запросы идут через общий politeFetch (пауза ≥ SCRAPE_INTERVAL_MS,
// экспоненциальный backoff на 429/5xx). На УСТОЙЧИВЫЙ отказ доступа (403, либо
// 429 после всех ретраев) бросаем BlockedError — вызывающий обязан остановиться,
// а не пытаться обойти лимит: это наш договорённый предел.
// ─────────────────────────────────────────────────────────────────────────────

import { politeFetch } from './http.js';

const ENDPOINT = 'https://liquimoly.ru/podbor-masla/ajax/luboilapiajax.php';
const ORIGIN = 'https://liquimoly.ru';
const CATEGORY_CARS = '2';   // «Легковые а/м»

export class BlockedError extends Error {
    constructor(message) { super(message); this.name = 'BlockedError'; }
}

async function apiCall(reqData) {
    const res = await politeFetch(ENDPOINT, {
        method: 'POST',
        body: JSON.stringify(reqData),
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': 'https://liquimoly.ru/podbor-masla/',
            'Origin': ORIGIN,
        },
    });
    // 403/429 = сайт нас притормаживает. politeFetch уже отжидал backoff на 429;
    // если дошло сюда — значит блок устойчивый. Останавливаемся честно.
    if (res.status === 403 || res.status === 429) {
        throw new BlockedError(`Liqui Moly ответил ${res.status} на operation=${reqData.operation} — сайт блокирует, останавливаемся (обходить не будем)`);
    }
    if (res.status !== 200) {
        throw new Error(`Liqui Moly HTTP ${res.status} на operation=${reqData.operation}`);
    }
    const json = await res.json();
    return json && json.data;
}

export function fetchManufacturers(categoryid = CATEGORY_CARS) {
    return apiCall({ operation: 'manufacturers', id: String(categoryid), text: '', origin: ORIGIN });
}

export function fetchSeries(manufacturerid, categoryid = CATEGORY_CARS) {
    return apiCall({ operation: 'series', categoryid: String(categoryid), id: String(manufacturerid), text: '', origin: ORIGIN });
}

export function fetchEngineSizes(manufacturerid, seriesid, categoryid = CATEGORY_CARS) {
    return apiCall({
        operation: 'engineSizes', categoryid: String(categoryid),
        manufacturerid: String(manufacturerid), id: String(seriesid), text: '', origin: ORIGIN,
    });
}

export function fetchEquipment({ manufacturerid, manufacturername, seriesid, seriesname, volume, categoryid = CATEGORY_CARS }) {
    return apiCall({
        operation: 'equipment', categoryid: String(categoryid), categoryname: 'Легковые а/м',
        manufacturerid: String(manufacturerid), manufacturername: manufacturername || '',
        seriesid: String(seriesid), seriesname: seriesname || '',
        id: String(volume), selected_engine_name: String(volume), text: '', origin: ORIGIN,
    });
}

export function fetchEquipmentData(mid) {
    return apiCall({ operation: 'equipmentData', mid: String(mid), text: '', origin: ORIGIN });
}

export { CATEGORY_CARS, ENDPOINT };
