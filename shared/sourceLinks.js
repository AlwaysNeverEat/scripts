// ─────────────────────────────────────────────────────────────────────────────
// Сурс-ссылки: страницы машины на сайтах подбора (Mann / LYNX / Ravenol /
// Motul). Единая точка правды для калькулятора, нотификатора и сайта.
//
// source_links — объект { mann, lynx, ravenol, motul } с URL'ами страниц,
// где калькулятор «встретил» машину и где искал объёмы. Ссылки не
// совпадают один-в-один между визитами (у Mann в URL куча внутренних id),
// поэтому для матча нотификатором рядом храним source_keys — набор
// нормализованных сигнатур, устойчивых к «мусорным» параметрам URL.
// ─────────────────────────────────────────────────────────────────────────────

// Порядок = порядок кнопок «Страницы машины» на сайте.
// ROLF не храним: у них поиск внутри виджета, ссылка всегда одна и та же
// (rolfoil.ru/podbor) — привязать её к конкретной машине нельзя.
export const SOURCE_SITES = ['mann', 'lynx', 'ravenol', 'motul', 'lukoil'];

export const SOURCE_LABELS = {
    mann:    'Mann-Filter',
    lynx:    'LYNXauto',
    ravenol: 'Ravenol',
    motul:   'Motul',
    lukoil:  'ЛУКОЙЛ',
};

// Определяет сайт по URL. null — чужой/нераспознанный.
export function detectSite(url) {
    let u;
    try { u = new URL(url); } catch { return null; }
    const h = u.hostname.toLowerCase();
    if (h.includes('mann-filter.com'))            return 'mann';
    if (h.includes('lynxauto.info'))              return 'lynx';
    if (h.includes('ravenol.ru'))                 return 'ravenol';
    if (h.includes('motul.lubricantadvisor.com')) return 'motul';
    if (h.includes('lukoil.lubribase.ru'))        return 'lukoil';
    return null;
}

// Нормализация текстового куска URL в кусок сигнатуры:
// нижний регистр, «+»→пробел, всё не буквенно-цифровое → дефис.
function normPart(s) {
    return String(s == null ? '' : s)
        .toLowerCase()
        .replace(/\+/g, ' ')
        .replace(/[^a-zа-яё0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '');
}

// Сигнатура для матча: устойчива к смене «мусорных» параметров URL.
// Возвращает строку-ключ или null (для motul — это наша страница поиска,
// надёжного per-car ключа из неё не вытащить).
export function sourceSignature(url) {
    const site = detectSite(url);
    if (!site) return null;
    let u;
    try { u = new URL(url); } catch { return null; }
    const p = u.searchParams;

    if (site === 'mann') {
        // vehicleTypeId / modelTypeId — внутренний id варианта двигателя в
        // каталоге Mann, один и тот же при любом заходе на эту машину.
        const id = p.get('vehicleTypeId') || p.get('modelTypeId');
        const digits = (id || '').replace(/\D/g, '').replace(/^0+/, '');
        if (digits) return 'mann:type:' + digits;
        // Нет id — собираем ключ из опознавательных полей.
        const parts = [p.get('vehicleMake'), p.get('vehicleModel'),
                       p.get('ccm'), p.get('kw'), p.get('engineCode')]
            .map(normPart).filter(Boolean);
        return parts.length ? 'mann:' + parts.join(':') : null;
    }

    if (site === 'lynx') {
        const parts = [p.get('vendor'), p.get('car'), p.get('modification')]
            .map(normPart).filter(Boolean);
        return parts.length ? 'lynx:' + parts.join(':') : null;
    }

    if (site === 'ravenol') {
        // Путь /1-cars/<make>/.../<model>/ стабилен для конкретной машины.
        const path = normPart(u.pathname);
        return path ? 'ravenol:' + path : null;
    }

    if (site === 'lukoil') {
        // Стабильный deep-link выбора: manufacturer_id + engine_volume.
        const parts = [p.get('manufacturer_id'), p.get('engine_volume')]
            .map(normPart).filter(Boolean);
        return parts.length ? 'lukoil:' + parts.join(':') : null;
    }

    return null; // motul — только справочная ссылка, не ключ матча
}

// Из объекта source_links собирает массив уникальных сигнатур для индекса матча.
export function buildSourceKeys(sourceLinks) {
    if (!sourceLinks || typeof sourceLinks !== 'object') return [];
    const keys = new Set();
    for (const url of Object.values(sourceLinks)) {
        const sig = sourceSignature(url);
        if (sig) keys.add(sig);
    }
    return [...keys];
}

// Отбрасывает пустые значения и оставляет только известные сайты.
export function cleanSourceLinks(sourceLinks) {
    const out = {};
    if (!sourceLinks || typeof sourceLinks !== 'object') return out;
    for (const site of SOURCE_SITES) {
        const url = sourceLinks[site];
        if (typeof url === 'string' && url.trim()) out[site] = url.trim();
    }
    return out;
}
