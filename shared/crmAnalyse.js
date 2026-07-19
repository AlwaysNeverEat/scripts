// ─────────────────────────────────────────────────────────────────────────────
// Разбор HTML страницы CRM /analyse/free (наличие товара по станциям) и
// сопоставление строк CRM с каталогом масел сайта (shared/oils.js).
// Чистые regex/string-функции — без DOM, работают и в Node-тестах, и на фронте,
// и на бэкенде (прокси). Разметка снята с реальных страниц CRM.
//
// Особенности данных CRM:
//  - остаток масла закодирован «в десятых литра»: 556 → 55.6 л, 5 → 0.5 л;
//  - цена масла указана за 0.1 л: 240.00 → 2400 ₽/л;
//  - остаток фильтров — обычные штуки, цена — за штуку.
// ─────────────────────────────────────────────────────────────────────────────

const ENTITIES = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&#039;': "'", '&#39;': "'", '&nbsp;': ' ',
};

function decodeEntities(s) {
    return s.replace(/&(?:amp|lt|gt|quot|#0?39|nbsp);/g, m => ENTITIES[m] || m);
}

// Текст ячейки/опции: убрать теги, схлопнуть пробелы.
function stripTags(html) {
    return decodeEntities(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// «210.<small>00</small>» / «1 234,50» → число. Цена в ячейке без пробелов
// между целой и дробной частью после вычистки тегов.
export function parseRawPrice(text) {
    const cleaned = String(text || '').replace(/\s/g, '').replace(',', '.');
    const m = cleaned.match(/(\d+)\.(\d+)/);
    if (m) return parseFloat(m[1] + '.' + m[2]);
    const digits = cleaned.replace(/\D/g, '');
    return digits ? parseInt(digits, 10) : 0;
}

// ── Станции ──────────────────────────────────────────────────────────────────

// <select id="field__stations"> … <option value="45" selected>Ветеранов 167к8</option>
export function parseStations(html) {
    const sel = String(html || '').match(/<select[^>]*id="field__stations"[\s\S]*?<\/select>/);
    if (!sel) return [];
    const out = [];
    const re = /<option\s+[^>]*value="(\d+)"[^>]*>([\s\S]*?)<\/option>/g;
    let m;
    while ((m = re.exec(sel[0]))) {
        const name = stripTags(m[2]);
        if (name) out.push({ id: m[1], name });
    }
    return out;
}

// ── Таблица наличия ──────────────────────────────────────────────────────────

// → { loginPage, rows: [{ id, name, count, priceRaw }] }
// count берётся из ячейки data-name="count<stationId>"; если stationId не задан —
// из первой count-ячейки строки.
export function parseAnalyseFree(html, stationId) {
    const src = String(html || '');
    const hasStations = /id="field__stations"/.test(src);
    const hasPassword = /type=["']?password/i.test(src);
    const rows = [];

    const rowRe = /<tr class="table__row[\s\S]*?<\/tr>/g;
    let rowMatch;
    while ((rowMatch = rowRe.exec(src))) {
        const rowHtml = rowMatch[0];
        const cells = {};
        const cellRe = /<td[^>]*data-name="([^"]+)"[^>]*>([\s\S]*?)<\/td>/g;
        let c;
        while ((c = cellRe.exec(rowHtml))) cells[c[1]] = c[2];

        const name = stripTags(cells.name);
        if (!name) continue;

        let countCell = stationId != null ? cells['count' + stationId] : undefined;
        if (countCell === undefined) {
            const key = Object.keys(cells).find(k => /^count\d+$/.test(k));
            if (key) countCell = cells[key];
        }
        const countText = stripTags(countCell).replace(/\s/g, '');
        rows.push({
            id: stripTags(cells.id),
            name,
            count: countText ? (parseInt(countText, 10) || 0) : 0,
            priceRaw: parseRawPrice(stripTags(cells.price)),
        });
    }

    // Страница логина: есть поле пароля, либо это вообще не /analyse/free
    // (нет ни фильтра станций, ни таблицы). Пустая выдача — не логин: селект на месте.
    const loginPage = hasPassword || (!hasStations && rows.length === 0);
    return { loginPage, rows };
}

// ── Количество и цена масла ──────────────────────────────────────────────────

// Остаток масла в CRM хранится в десятых долях литра: 556 → 55.6 л, 5 → 0.5 л.
export function decodeOilLiters(count) {
    return Math.round((Number(count) || 0)) / 10;
}

// Цена масла в CRM — за 0.1 л: 240.00 → 2400 ₽/л.
export function crmOilPricePerLiter(priceRaw) {
    return Math.round((Number(priceRaw) || 0) * 10);
}

// ── Сопоставление строк CRM с каталогом масел ────────────────────────────────

const VISC_RE = /(\d{1,2})\s*W\s*[-–]?\s*(\d{2})\b/i;

// «5W-30», «5w30», «0W 20» → каноническое «5W-30»; null если вязкости нет.
export function extractViscosity(name) {
    const m = String(name || '').match(VISC_RE);
    return m ? `${parseInt(m[1], 10)}W-${m[2]}` : null;
}

// Название строки CRM → нормализованная форма для матчинга:
// без ведущего артикула, «Моторное масло», фасовок (60l, (1х60L), (200л), (4л)).
export function normCrmName(name) {
    let s = ' ' + stripTags(name) + ' ';
    // ведущий артикул: первый токен с цифрой, если это не вязкость (5W-30 и т.п.)
    const first = s.trim().split(/\s+/)[0] || '';
    if (/\d/.test(first) && !VISC_RE.test(first)) {
        s = s.replace(first, ' ');
    }
    s = s.replace(/моторное\s+масло/gi, ' ');
    // фасовки: (1х60L)/(4x4L) — «х» бывает кириллицей; (200л); 60l; 4л
    s = s.replace(/\(\s*\d+\s*[xх]\s*\d+(?:[.,]\d+)?\s*[lл]\s*\)/gi, ' ');
    s = s.replace(/\(\s*\d+(?:[.,]\d+)?\s*[lл]\s*\)/gi, ' ');
    s = s.replace(/(^|\s)\d+(?:[.,]\d+)?\s*[lл](?=\s|$)/gi, ' ');
    return s.replace(/\s+/g, ' ').trim().toUpperCase();
}

// Бренды каталога → как они пишутся в CRM.
const BRAND_ALIASES = [
    ['Liqui Moly', /LIQUI\s*MOLY/],
    ['Motul',      /MOTUL/],
    ['Mobil',      /MOBIL/],
    ['ROLF',       /ROLF/],
    ['ZIC',        /\bZIC\b/],
    ['Shell',      /SHELL/],
    ['Castrol',    /CASTROL/],
    ['GM',         /\bGM\b/],
    ['Idemitsu',   /IDEMITSU|ZEPRO/],
    ['SPOT',       /\bSPOT\b/],
];

function detectBrand(normName) {
    for (const [brand, re] of BRAND_ALIASES) {
        if (re.test(normName)) return brand;
    }
    return null;
}

const GENERIC_TOKENS = new Set(['SAE', 'API', 'ACEA', 'ДЛЯ', 'АВТОМОБИЛЕЙ', 'ЛЕГКОВЫХ']);

function nameTokens(s) {
    return String(s || '').toUpperCase().split(/[^A-ZА-ЯЁ0-9+]+/).filter(t =>
        t && t.length > 1 && !GENERIC_TOKENS.has(t) &&
        !/^\d{1,2}W$/.test(t) && !/^W\d{2}$/.test(t) && !/^\d{2}$/.test(t));
}

// Строка CRM → масло каталога. null, если строка не сопоставилась
// (нет вязкости, чужой бренд или неоднозначно). weak:true — совпал только
// бренд+вязкость, токены имени не подтвердились.
export function matchCrmOilRow(rowName, shopOils) {
    const norm = normCrmName(rowName);
    const visc = extractViscosity(norm);
    if (!visc) return null;
    const brand = detectBrand(norm);
    if (!brand) return null;

    const candidates = (shopOils || []).filter(o =>
        o.b === brand && extractViscosity(o.v) === visc);
    if (!candidates.length) return null;

    const rowTokens = new Set(nameTokens(norm));
    let best = null, bestHits = -1, tie = false;
    for (const oil of candidates) {
        const hits = nameTokens(oil.n).filter(t => rowTokens.has(t)).length;
        if (hits > bestHits) { best = oil; bestHits = hits; tie = false; }
        else if (hits === bestHits) tie = true;
    }
    if (bestHits > 0 && !tie) return { oil: best, weak: false };
    if (candidates.length === 1) return { oil: candidates[0], weak: bestHits <= 0 };
    return null;
}

// ── Фильтры ──────────────────────────────────────────────────────────────────

// Тип фильтра по названию строки CRM (портировано из SPOT-скрипта поиска цен).
// Порядок проверок важен: «воздушный фильтр салона» — салонный, не воздушный.
export function detectFilterType(name) {
    const s = String(name || '').toLowerCase();
    if (/салон|кондиционер/.test(s)) return 'сф';
    if (/масл/.test(s)) return 'мф';
    if (/топлив/.test(s)) return 'тф';
    if (/воздушн/.test(s)) return 'вф';
    return null;
}

// Название фильтра для отображения: без ведущего артикула и слов типа фильтра.
export function cleanFilterName(raw) {
    let s = stripTags(raw).replace(/^[A-ZА-Я0-9/-]+\s+/i, '').trim();
    const filterTypes = [
        'Воздушный фильтр салона', 'Фильтр салона', 'Салонный фильтр',
        'Воздушный фильтр', 'Масляный фильтр', 'Топливный фильтр',
    ];
    for (const ft of filterTypes) {
        if (s.toLowerCase().startsWith(ft.toLowerCase())) {
            s = s.slice(ft.length).trim();
            break;
        }
    }
    s = s.replace(/\s*\(\d+\)\s*$/, '').trim();
    return s || stripTags(raw);
}

// Слоты фильтров на сайте (filter_part_numbers) ↔ тип по названию в CRM.
// Внимание: на сайте vf = масляный, mf = воздушный (не как в CRM-скриптах).
export const FILTER_SLOTS = [
    { key: 'vf', label: 'масляный',  crmType: 'мф' },
    { key: 'mf', label: 'воздушный', crmType: 'вф' },
    { key: 'sf', label: 'салонный',  crmType: 'сф' },
];
