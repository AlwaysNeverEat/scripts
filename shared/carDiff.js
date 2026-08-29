// ─────────────────────────────────────────────────────────────────────────────
// «Что изменили»: событие правки машины → человеческий список изменений.
//
// В car_events.changed_fields лежит сырьё: { поле: { from, to } }, где значением
// бывает и число, и объект вроде {"mf":{"part":"LO-1901","absent":false}}. Окно
// показывало это как есть — JSON зачёркнутым и JSON зелёным, — и прочитать в
// нём, что поменялся ОДИН салонный фильтр, было нельзя: глазами приходилось
// сравнивать две простыни символов.
//
// Здесь сырьё разбирается до того, что человек правил руками в форме: поле
// получает русскую подпись и попадает в ту же группу, что и вкладка правки, а
// объект разворачивается в СТРОКИ ПО СОСТАВНЫМ ЧАСТЯМ — и в список попадают
// только те части, которые реально изменились. Из четырёх ключей фильтров
// остаётся один, из десятка ключей агрегата — «объём полной, л».
//
// Чистые функции без DOM (окно рисует frontend/src/carPage.js), поэтому лежат
// в shared/ и покрыты тестами: подписи фильтров тут легко перепутать местами, а
// перепутанный артикул хуже пустого поля.
// ─────────────────────────────────────────────────────────────────────────────

import { flagLabel, SERVICE_FLAGS } from './serviceFlags.js';
import { SOURCE_LABELS, SOURCE_SITES } from './sourceLinks.js';
import { FUEL_OPTIONS, normalizeFuelCode } from './fuel.js';

// Группы = вкладки окна правки (carEditor.js). Человек правил «Фильтры ДВС» —
// и в списке изменений он ищет ту же самую «Фильтры ДВС», а не поле с именем
// колонки в базе.
export const FIELD_GROUPS = [
    { id: 'car',     label: 'Машина',
      fields: ['brand', 'model', 'generation', 'engine_name', 'engine_code',
               'engine_volume', 'year_from', 'year_to', 'kw', 'bhp', 'fuel_type'] },
    { id: 'aggs',    label: 'Агрегаты и объёмы',
      fields: ['fluid_capacities', 'car_approvals'] },
    { id: 'filters', label: 'Фильтры ДВС',            fields: ['filter_part_numbers'] },
    { id: 'flags',   label: 'Особенности обслуживания', fields: ['service_flags'] },
    { id: 'links',   label: 'Ссылки на источники',    fields: ['source_links'] },
    { id: 'meta',    label: 'Теги и заметка',         fields: ['tags', 'notes'] },
];

// Поля, которых нет ни в одной вкладке (пишутся импортом или старой формой),
// не должны пропадать из списка — для них последняя группа.
const OTHER_GROUP = { id: 'other', label: 'Прочее' };

export const FIELD_LABELS = {
    brand: 'Марка',
    model: 'Модель',
    generation: 'Поколение',
    engine_name: 'Двигатель',
    engine_code: 'Код двигателя',
    engine_volume: 'Объём двигателя, л',
    year_from: 'Год начала выпуска',
    year_to: 'Год окончания выпуска',
    kw: 'Мощность, кВт',
    bhp: 'Мощность, л.с.',
    fuel_type: 'Топливо',
    fluid_capacities: 'Агрегаты и объёмы',
    car_approvals: 'Допуска машины',
    filter_part_numbers: 'Артикулы фильтров',
    service_flags: 'Особенности обслуживания',
    source_links: 'Ссылки на источники',
    tags: 'Теги',
    notes: 'Заметка',
    recommended_oils: 'Рекомендованные масла',
    oil_overrides: 'Замены масел',
};

export function fieldLabel(key) {
    return FIELD_LABELS[key] || key;
}

// Подписи сверены с CLAUDE.md и с формой правки: vf — ВОЗДУШНЫЙ (MANN C…),
// mf — МАСЛЯНЫЙ (W…, HU…), sf — салонный (CU…). Перепутать их здесь — значит
// показать оператору воздушный фильтр под видом масляного.
const FILTER_ORDER = ['mf', 'vf', 'sf'];
const FILTER_LABELS = {
    mf: 'Масляный (мф)',
    vf: 'Воздушный (вф)',
    sf: 'Салонный (сф)',
};

// Штатные агрегаты в порядке показа формы. custom обрабатывается отдельно.
const AGG_ORDER = ['engine', 'automatic', 'manual', 'transfer', 'diffFront', 'diffRear'];
const AGG_LABELS = {
    engine:    'ДВС',
    automatic: 'АКПП / вариатор',
    manual:    'МКПП',
    transfer:  'Раздаточная коробка',
    diffFront: 'Дифференциал (перед)',
    diffRear:  'Дифференциал (зад)',
};

// Что внутри агрегата и как это называется в форме.
const AGG_ATTRS = [
    ['label',         'название'],
    ['volumeService', 'объём частичной, л'],
    ['volumeTotal',   'объём полной, л'],
    ['volumePlain',   'объём, л'],
    ['motulProducts', 'масла и допуска'],
    ['isCvt',         'вариатор'],
    ['isDct',         'робот (DCT)'],
];
const AGG_ATTR_LABELS = Object.fromEntries(AGG_ATTRS);

// ── Публичный вход ───────────────────────────────────────────────────────────

/**
 * changed_fields события → сгруппированный список для показа.
 *
 * @returns {{ total: number, same: number, groups: Array<{id, label, rows: Row[]}> }}
 *
 * same — сколько полей записано в событие, но по значению не изменилось: в
 * changed_fields попадает и '2019' → 2019 (число из формы против строки из
 * Postgres). Показывать такое строкой «было 2019 → стало 2019» нельзя — человек
 * начнёт искать разницу, которой нет, — но и молчать о них не годится, поэтому
 * окно пишет их числом внизу.
 *
 * Row = {
 *   key, label,
 *   op: 'added' | 'removed' | 'changed',
 *   kind: 'value' | 'items' | 'list',
 *   from, to,        // kind 'value': текст или null («не заполнено»)
 *   raw,             // kind 'value': значение показывать моноширинным (JSON)
 *   items,           // kind 'items': [{ label, op, from, to, text, href }]
 *   added, removed,  // kind 'list': добавленные и убранные строки
 * }
 */
export function describeCarChanges(changedFields) {
    const src = changedFields && typeof changedFields === 'object' ? changedFields : {};
    const rows = new Map();
    let same = 0;
    for (const [key, diff] of Object.entries(src)) {
        const row = buildRow(key, diff);
        if (row) rows.set(key, row);
        else same++;
    }

    const groups = [];
    const placed = new Set();
    for (const g of FIELD_GROUPS) {
        const list = g.fields.filter(f => rows.has(f)).map(f => (placed.add(f), rows.get(f)));
        if (list.length) groups.push({ id: g.id, label: g.label, rows: list });
    }
    const rest = [...rows.keys()].filter(k => !placed.has(k)).map(k => rows.get(k));
    if (rest.length) groups.push({ ...OTHER_GROUP, rows: rest });

    return { total: rows.size, same, groups };
}

// Короткий список подписей для карточки события в ленте: что открывать, видно
// не открывая («Мощность, кВт · Артикулы фильтров»). Считается тем же разбором,
// что и окно, — иначе в карточке значилось бы поле, которого в окне нет.
export function changedFieldLabels(changedFields) {
    return describeCarChanges(changedFields).groups.flatMap(g => g.rows.map(r => r.label));
}

// Хвост длинного URL оператору не нужен: у Mann в ссылке десяток внутренних id,
// и строка «было → стало» из них состоять не должна.
export function shortUrl(url) {
    const s = String(url == null ? '' : url).trim();
    if (!s) return '';
    let u;
    try { u = new URL(s); } catch { return s.length > 40 ? s.slice(0, 39) + '…' : s; }
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    const tail = path && path !== '/' ? path : '';
    const cut = tail.length > 24;
    const short = host + (cut ? tail.slice(0, 23) + '…' : tail);
    // Многоточие уже стоит — второе, за параметры, только зашумит строку.
    return !cut && u.search ? short + '?…' : short;
}

// ── Разбор одного поля ───────────────────────────────────────────────────────

function buildRow(key, diff) {
    const from = diff && typeof diff === 'object' ? diff.from ?? null : null;
    const to   = diff && typeof diff === 'object' ? diff.to   ?? null : null;
    const label = fieldLabel(key);

    if (key === 'filter_part_numbers') return itemsRow(key, label, filterItems(from, to), from, to);
    if (key === 'service_flags')       return itemsRow(key, label, flagItems(from, to), from, to);
    if (key === 'source_links')        return itemsRow(key, label, linkItems(from, to), from, to);
    if (key === 'fluid_capacities')    return itemsRow(key, label, aggItems(from, to), from, to);
    if (key === 'tags' || key === 'car_approvals') return listRow(key, label, from, to);

    return valueRow(key, label, valueText(key, from), valueText(key, to));
}

// null — «изменения нет»: значение в событии записано, но после приведения к
// показу обе стороны одинаковы (1.60 из базы и 1.6 из формы).
function valueRow(key, label, from, to, raw = false) {
    if (from === to) return null;
    return { key, label, kind: 'value', op: opOf(from, to), from, to, raw };
}

// Объектное поле, у которого после разбора не нашлось ни одной изменившейся
// части (например, правка только в ключе, которого мы не знаем), показываем
// сырьём: молча пропасть из списка изменение не должно.
function itemsRow(key, label, items, from, to) {
    if (!items.length) return valueRow(key, label, jsonText(from), jsonText(to), true);
    const ops = new Set(items.map(i => i.op));
    const op = ops.size === 1 ? [...ops][0] : 'changed';
    return { key, label, kind: 'items', op, items };
}

function listRow(key, label, from, to) {
    const a = asList(from), b = asList(to);
    const removed = a.filter(x => !b.includes(x));
    const added   = b.filter(x => !a.includes(x));
    if (!removed.length && !added.length) return valueRow(key, label, jsonText(from), jsonText(to), true);
    const op = added.length && removed.length ? 'changed' : added.length ? 'added' : 'removed';
    return { key, label, kind: 'list', op, added, removed };
}

// ── Составные поля ───────────────────────────────────────────────────────────

// «Артикула нет» и «фильтра у машины нет» — РАЗНЫЕ вещи, и в списке изменений
// это должно быть видно словами, а не флагом absent:true.
function filterText(entry) {
    if (!entry || typeof entry !== 'object') return null;
    if (entry.absent === true) return 'фильтра у машины нет';
    const part = entry.part == null ? '' : String(entry.part).trim();
    return part || null;
}

function filterItems(from, to) {
    const a = obj(from), b = obj(to);
    const items = [];
    for (const k of dedupe([...FILTER_ORDER, ...Object.keys(a), ...Object.keys(b)])) {
        const f = filterText(a[k]), t = filterText(b[k]);
        if (f === t) continue;
        items.push({ label: FILTER_LABELS[k] || k, op: opOf(f, t), from: f, to: t });
    }
    return items;
}

// Флаг либо стоит, либо нет — «было пусто → стало true» тут читается хуже, чем
// «поставили».
function flagItems(from, to) {
    const a = obj(from), b = obj(to);
    const items = [];
    for (const k of dedupe([...Object.keys(SERVICE_FLAGS), ...Object.keys(a), ...Object.keys(b)])) {
        const f = !!a[k], t = !!b[k];
        if (f === t) continue;
        items.push({ label: flagLabel(k), op: t ? 'added' : 'removed', text: t ? 'поставили' : 'сняли' });
    }
    return items;
}

function linkItems(from, to) {
    const a = obj(from), b = obj(to);
    const items = [];
    for (const site of dedupe([...SOURCE_SITES, ...Object.keys(a), ...Object.keys(b)])) {
        const f = urlOrNull(a[site]), t = urlOrNull(b[site]);
        if (f === t) continue;
        items.push({
            label: SOURCE_LABELS[site] || site,
            op: opOf(f, t),
            from: f && shortUrl(f), to: t && shortUrl(t),
            href: t || null,
            fullFrom: f, fullTo: t,
        });
    }
    return items;
}

function aggItems(from, to) {
    const a = obj(from), b = obj(to);
    const items = [];
    const keys = dedupe([...AGG_ORDER, ...Object.keys(a), ...Object.keys(b)])
        .filter(k => k !== 'custom');
    for (const k of keys) items.push(...aggAttrItems(AGG_LABELS[k] || k, a[k], b[k]));

    // Свои агрегаты — список, а не ключи: сравниваем по названию (переименование
    // читается как «убрали один, добавили другой», и это честнее, чем считать
    // одинаковыми агрегаты, стоящие на одном месте в массиве).
    const ca = customByLabel(a.custom), cb = customByLabel(b.custom);
    for (const name of dedupe([...ca.keys(), ...cb.keys()])) {
        const before = ca.get(name), after = cb.get(name);
        const title = name ? `Свой агрегат «${name}»` : 'Свой агрегат';
        if (before && !after) { items.push({ label: title, op: 'removed', text: 'убран' }); continue; }
        items.push(...aggAttrItems(title, before, after));
    }
    return items;
}

function customByLabel(list) {
    const out = new Map();
    (Array.isArray(list) ? list : []).forEach((agg, i) => {
        const name = String((agg && agg.label) || '').trim() || `№${i + 1}`;
        out.set(name, agg || {});
    });
    return out;
}

function aggAttrItems(prefix, before, after) {
    const a = obj(before), b = obj(after);
    const known = AGG_ATTRS.map(([k]) => k);
    const extra = dedupe([...Object.keys(a), ...Object.keys(b)]).filter(k => !known.includes(k)).sort();
    const out = [];
    for (const k of [...known, ...extra]) {
        const f = aggValueText(a[k]), t = aggValueText(b[k]);
        if (f === t) continue;
        out.push({
            label: `${prefix} · ${AGG_ATTR_LABELS[k] || k}`,
            op: opOf(f, t), from: f, to: t,
        });
    }
    return out;
}

// ── Значения ─────────────────────────────────────────────────────────────────

function valueText(key, v) {
    if (v === null || v === undefined) return null;
    if (key === 'fuel_type') return fuelText(v);
    if (typeof v === 'boolean') return v ? 'да' : 'нет';
    if (typeof v === 'object') return jsonText(v);
    const s = String(v).trim();
    if (!s) return null;
    return numeric(s) ?? s;
}

// fuelLabel из shared/fuel.js экранирует результат под innerHTML, а здесь текст
// экранирует уже окно — иначе нераспознанное топливо приехало бы с &amp;.
function fuelText(v) {
    const raw = String(v).trim();
    if (!raw) return null;
    const code = normalizeFuelCode(raw);
    if (code) return (FUEL_OPTIONS.find(o => o.code === code) || {}).label || raw;
    return `${raw} (не распознано)`;
}

function aggValueText(v) {
    if (v === null || v === undefined || v === false || v === '') return null;
    if (v === true) return 'да';
    if (Array.isArray(v)) {
        const list = v.map(x => String(x).trim()).filter(Boolean);
        return list.length ? list.join(', ') : null;
    }
    if (typeof v === 'object') return jsonText(v);
    const s = String(v).trim();
    if (!s) return null;
    return numeric(s) ?? s;
}

// '4.50' из базы и 4.5 из формы — одно и то же число; без приведения строка
// «было → стало» показывала бы изменение там, где его нет.
function numeric(s) {
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? String(n) : null;
}

function jsonText(v) {
    if (v === null || v === undefined) return null;
    try { return JSON.stringify(v); } catch { return String(v); }
}

function urlOrNull(v) {
    const s = v == null ? '' : String(v).trim();
    return s || null;
}

function opOf(from, to) {
    if (from == null && to != null) return 'added';
    if (from != null && to == null) return 'removed';
    return 'changed';
}

function obj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

function asList(v) {
    return Array.isArray(v) ? v.map(x => String(x)) : [];
}

function dedupe(list) {
    return [...new Set(list)];
}
