// ─────────────────────────────────────────────────────────────────────────────
// «Разведка фильтров»: на каких станциях сети есть ВСЕ фильтры машины разом.
//
// Панель наличия проверяет одну выбранную станцию; эта логика — фон для тихой
// подсказки рядом с выбором: если на выбранной станции чего-то нет, оператору
// важно не «где вообще бывает салонный», а куда ближе всего съездить за всеми
// тремя сразу. Поэтому станции считаются по пересечению («есть каждый фильтр»),
// а сортируются по дистанции от выбранной.
//
// Сырьё — ответы поиска по складу (parseStockTable в crmAnalyse.js): один
// запрос на артикул со ВСЕМИ станциями даёт остаток колонкой на каждую, то есть
// вся сеть проверяется тремя запросами, а не «станций × фильтров».
//
// Дистанции — по координатам справочника stationsMeta.js. Станция CRM, которой
// в справочнике нет, из кандидатов не выбрасывается: у неё просто нет цифры
// «км», и она уходит в конец списка — «есть, но неизвестно где» честнее, чем
// пропасть молча.
// ─────────────────────────────────────────────────────────────────────────────

import { detectFilterType } from './crmAnalyse.js';
import { findStationMeta, haversineKm } from './stationsMeta.js';

// Станции (id из колонок CRM), где по этому фильтру остаток больше нуля.
// Артикул в CRM может совпасть с чужим товаром, поэтому если среди найденного
// есть строки НУЖНОГО типа (по названию), чужие типы не считаются. Когда тип
// не распознался ни у одной строки — считаем все: панель наличия такие строки
// тоже показывает, и подсказка не должна быть строже её.
export function stationsWithFilter(rows, crmType) {
    const list = rows || [];
    const typed = crmType ? list.filter(r => detectFilterType(r.name) === crmType) : [];
    const use = typed.length ? typed : list;
    const out = new Set();
    for (const r of use) {
        for (const [id, n] of Object.entries(r.counts || {})) {
            if (id !== 'all' && n > 0) out.add(id);
        }
    }
    return out;
}

// results: [{ crmType, rows }] — по ответу поиска на каждый заполненный фильтр.
// → Set id станций, где есть КАЖДЫЙ из них.
export function stationsWithAll(results) {
    const sets = (results || []).map(r => stationsWithFilter(r.rows, r.crmType));
    if (!sets.length) return new Set();
    return sets.reduce((acc, s) => new Set([...acc].filter(id => s.has(id))));
}

// Кандидаты с дистанцией от станции fromName, ближние сверху. km === null —
// станция (или точка отсчёта) не нашлась в справочнике координат; такие в конце.
export function rankStations(ids, stations, fromName) {
    const from = findStationMeta(fromName);
    const out = [];
    for (const st of stations || []) {
        if (!ids.has(st.id)) continue;
        const meta = findStationMeta(st.name);
        const km = from && meta ? haversineKm(from.lat, from.lng, meta.lat, meta.lng) : null;
        out.push({ id: st.id, name: st.name, km });
    }
    out.sort((a, b) => ((a.km ?? Infinity) - (b.km ?? Infinity))
        || a.name.localeCompare(b.name, 'ru'));
    return out;
}

// «4,2 км» до десяти, дальше целыми: сотни метров между соседними станциями
// (Фучика 23 и 14) — разница настоящая, а «12,3 км» — ложная точность.
export function formatKm(km) {
    if (typeof km !== 'number' || !(km >= 0)) return '';
    const v = km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
    return String(v).replace('.', ',') + ' км';
}
