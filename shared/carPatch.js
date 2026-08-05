// ─────────────────────────────────────────────────────────────────────────────
// Что из формы правки реально изменилось и должно уйти в PATCH.
//
// Форма всегда отдаёт полный, «причёсанный» объект, а в базе рядом лежат записи
// из импорта и из старых версий формы: пустой объект вместо отсутствующего
// ключа, `{atNoFull:false}` вместо `{}`, числа строками (PostgreSQL numeric).
// Без приведения к общему виду любая правка выглядела бы как «изменено всё»:
// человек правил заметку, а перезаписывались объёмы, которые в этот момент
// правил коллега.
//
// Чистые функции, без DOM — поэтому лежат в shared/ и покрыты тестами.
// ─────────────────────────────────────────────────────────────────────────────

import { cleanSourceLinks } from './sourceLinks.js';

// Колонки, которые PostgreSQL отдаёт строкой: '1.6' и 1.6 — одно и то же.
export const NUMERIC_FIELDS = new Set(['engine_volume', 'year_from', 'year_to', 'kw', 'bhp']);

// Поля-массивы: отсутствие значения и пустой список — одно и то же.
const LIST_FIELDS = new Set(['car_approvals', 'tags']);

const FILTER_KEYS = ['vf', 'mf', 'sf'];

// Сравнение без оглядки на порядок ключей в объекте (тот же приём, что и на
// сервере в diffChangedFields).
export function stableStringify(v) {
    if (v === undefined) return 'null';
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    if (v && typeof v === 'object') {
        return '{' + Object.keys(v).sort()
            .map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
    }
    return JSON.stringify(v);
}

// Один агрегат к сравнимому виду. В базе рядом лежат записи из импорта и из
// формы: у одной `isCvt:false`, у другой поля вообще нет; объём то числом, то
// строкой; пустой список допусков вместо отсутствующего. Смысл везде один.
function normalizeAggregate(agg) {
    const out = {};
    for (const [k, v] of Object.entries(agg || {})) {
        if (v === null || v === undefined || v === '' || v === false) continue;
        if (k === 'label') {
            const s = String(v).trim();
            if (s) out.label = s;
            continue;
        }
        if (k === 'motulProducts') {
            const list = (Array.isArray(v) ? v : []).map(x => String(x).trim()).filter(Boolean);
            if (list.length) out.motulProducts = list;
            continue;
        }
        if (typeof v === 'number') { out[k] = v; continue; }
        if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
            out[k] = Number(v);
            continue;
        }
        out[k] = v;
    }
    return out;
}

function normalizeCapacities(value) {
    const src = value && typeof value === 'object' ? value : {};
    const out = {};
    for (const [key, agg] of Object.entries(src)) {
        if (key === 'custom') continue;
        out[key] = normalizeAggregate(agg);
    }
    // Пустой список своих агрегатов и отсутствие ключа — одно и то же.
    const custom = (Array.isArray(src.custom) ? src.custom : []).map(normalizeAggregate);
    if (custom.length) out.custom = custom;
    return out;
}

export function normalizeField(key, value) {
    if (key === 'service_flags') {
        // Хранится и {}, и {atNoFull:false} — смысл один: флаг не стоит.
        const out = {};
        for (const [k, v] of Object.entries(value || {})) if (v) out[k] = true;
        return out;
    }
    if (key === 'filter_part_numbers') {
        // Пустой артикул = «не знаем», в сравнении не участвует; absent:true =
        // «фильтра у машины нет» и участвует.
        const out = {};
        for (const fk of FILTER_KEYS) {
            const e = (value || {})[fk] || {};
            if (e.absent === true) out[fk] = { absent: true };
            else if (e.part != null && String(e.part).trim()) out[fk] = { part: String(e.part).trim() };
        }
        return out;
    }
    if (key === 'source_links') return cleanSourceLinks(value || {});
    if (key === 'fluid_capacities') return normalizeCapacities(value);
    if (key === 'notes') return value == null || value === '' ? null : value;
    if (LIST_FIELDS.has(key)) return Array.isArray(value) ? value : [];
    return value === undefined ? null : value;
}

export function sameValue(key, before, after) {
    if (NUMERIC_FIELDS.has(key)) {
        const a = before == null || before === '' ? null : Number(before);
        const b = after == null || after === '' ? null : Number(after);
        return a === b;
    }
    return stableStringify(normalizeField(key, before)) === stableStringify(normalizeField(key, after));
}

// record — машина как её отдал сервер, patch — полный набор полей из формы.
// Возвращает только те поля, которые реально изменились.
export function changedCarFields(record, patch) {
    const out = {};
    for (const [key, value] of Object.entries(patch || {})) {
        if (!sameValue(key, (record || {})[key], value)) out[key] = value;
    }
    return out;
}
