// ─────────────────────────────────────────────────────────────────────────────
// Чистые помощники режима «Склад» (stockSearch.js): форматирование цены и
// остатка, строка для буфера, разбор списка артикулов. Вынесены отдельно от
// окна, чтобы их можно было гонять в node --test — само окно тянет CSS.
// ─────────────────────────────────────────────────────────────────────────────

import {
    stockQuantity, detectFilterType, cleanFilterName, isBulkOil, crmOilPricePerLiter,
    stripCrmCode,
} from '../../shared/crmAnalyse.js';

// Сколько артикулов берём из списка за раз: больше — это уже не «три
// фильтра машины», а прайс, и очередь к CRM он займёт на минуту.
export const MAX_LIST = 30;

// Цена позиции в рублях: у масла из бочки CRM держит цену за 0.1 л, и
// показывать её надо ЗА ЛИТР (×10, как crmOilPricePerLiter в панели наличия
// на странице машины) — «160 ₽» рядом с «66,7 л» читается как цена литра и
// обманывает. Остальное — как есть.
export function priceOf(name, priceRaw) {
    const raw = Number(priceRaw) || 0;
    return isBulkOil(name) ? crmOilPricePerLiter(raw) : Math.round(raw);
}

// Цена — целые рубли с разрядкой: «1 368 ₽». Копейки в остатке склада не
// решают ничего, а «1367.59» читается втрое дольше. У масла — «1 800 ₽/л»:
// единица стоит прямо у числа, чтобы не спутать с ценой канистры.
export function fmtPrice(name, priceRaw) {
    const n = priceOf(name, priceRaw);
    if (n <= 0) return '—';
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (isBulkOil(name) ? ' ₽/л' : ' ₽');
}

// Остаток: «7 шт», «20 л», «55,6 л» — литры с одной цифрой, если она есть.
export function fmtQty(name, count) {
    const { value, unit } = stockQuantity(name, count);
    const text = unit === 'л' ? String(Math.round(value * 10) / 10).replace('.', ',') : String(value);
    return `${text} ${unit}`;
}

// Тип фильтра у позиции. У масла его нет: detectFilterType ловит «масл» и
// в «Моторное масло», и такая строка уходила бы в буфер с префиксом «мф».
export function filterTypeOf(name) {
    return isBulkOil(name) ? null : detectFilterType(name);
}

// Слова типа и фасовка в названии масла: «Моторное масло … 4l (4x4L)».
// В строке буфера они лишние: тип масла виден по вязкости и линейке, а цена
// в строке — ЗА ЛИТР, и объём канистры рядом с ней только обманывает.
const OIL_WORDS_RE = /^(?:моторное|трансмиссионное)\s+масло\s*/i;
const OIL_PACK_PAREN_RE = /\s*\(\s*\d+(?:[.,]\d+)?\s*(?:[xх×]\s*\d+(?:[.,]\d+)?\s*)?[lл]\s*\)/gi;
// Лукахед вместо \b: границу слова JS считает по латинице, после «л» она не срабатывает.
const OIL_PACK_RE = /(?:^|\s)\d+(?:[.,]\d+)?\s*[lл](?=\s|$)/gi;

// Имя масла для буфера: без кода CRM, слов «Моторное/Трансмиссионное масло»
// и фасовки — остаётся «Mobil 5W-30 Super 3000 FE».
function cleanOilName(raw) {
    const s = stripCrmCode(raw)
        .replace(OIL_WORDS_RE, '')
        .replace(OIL_PACK_PAREN_RE, ' ')
        .replace(OIL_PACK_RE, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return s || stripCrmCode(raw);
}

// Строка для буфера — в формате вставки калькулятора: «вф <имя> - <цена>р».
// Тип — у самой позиции, если по названию понятен; иначе тип группы.
export function copyLine(row, groupType) {
    // Маслу префикс не положен вовсе — ни свой, ни от группы.
    if (isBulkOil(row.name)) {
        return `${cleanOilName(row.name)} - ${priceOf(row.name, row.priceRaw)}р`;
    }
    const type = filterTypeOf(row.name) || groupType || '';
    return `${type ? type + ' ' : ''}${cleanFilterName(row.name)} - ${priceOf(row.name, row.priceRaw)}р`;
}

// Список артикулов из textarea: по строке на артикул, без пустых и повторов
// (регистр не различается — CRM ищет одинаково), не больше MAX_LIST.
export function parseList(text) {
    const seen = new Set();
    const out = [];
    for (const raw of String(text || '').split('\n')) {
        const line = raw.replace(/\s+/g, ' ').trim();
        const key = line.toLowerCase();
        if (!line || seen.has(key)) continue;
        seen.add(key);
        out.push(line);
        if (out.length >= MAX_LIST) break;
    }
    return out;
}

// Тип группы — тот, что чаще всего встречается среди найденных позиций
// (как в юзерскрипте: dominantType).
export function dominantType(rows) {
    const counts = {};
    for (const r of rows || []) {
        const t = filterTypeOf(r.name);
        if (t) counts[t] = (counts[t] || 0) + 1;
    }
    let best = null, max = 0;
    for (const t in counts) if (counts[t] > max) { max = counts[t]; best = t; }
    return best;
}
