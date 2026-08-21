// ─────────────────────────────────────────────────────────────────────────────
// Композитный кэш Битрикса: почему страницу лида нельзя просто скачать.
//
// На обычный GET /crm/lead/details/<id>/ портал отдаёт ОБЩИЙ ДЛЯ ВСЕХ кэш
// страницы — каркас без единого значения лида, без имени клиента и даже без
// sessid. Данные приезжают вторым запросом, который браузер делает сам: тот же
// адрес с ?bxrand=<время> и заголовком BX-ACTION-TYPE: get_dynamic. В ответ
// приходит JSON с «динамическими блоками» — вот в них и лежит настоящая
// страница.
//
// Это не деталь реализации, а причина, по которой чтение лида написано именно
// так: скачали каркас → достали из него параметры кэша → повторили запрос
// по-взрослому. Один запрос вместо двух вернёт пустоту, и выглядеть это будет
// как «лид не найден», а не как ошибка.
//
// Параметры (имена блоков и режим кэша) НЕ зашиты числами: они лежат в самом
// каркасе, у каждой страницы свои и меняются при обновлении портала.
// ─────────────────────────────────────────────────────────────────────────────

// Вырезаем JSON по балансу скобок, а не регуляркой до '}': внутри вложенные
// объекты, и жадная или ленивая регулярка одинаково промахнётся.
function sliceJson(text, from) {
    let depth = 0;
    for (let i = from; i < text.length; i++) {
        const ch = text[i];
        if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) return text.slice(from, i + 1);
    }
    return null;
}

/**
 * Параметры композитного кэша из каркаса страницы.
 * null — страница обычная (кэша нет), значит второй запрос не нужен.
 */
export function parseFrameCacheVars(html) {
    const text = String(html || '');
    const marker = text.match(/frameCacheVars\s*=\s*\{/);
    if (!marker) return null;
    const raw = sliceJson(text, marker.index + marker[0].length - 1);
    if (!raw) return null;
    try {
        const vars = JSON.parse(raw);
        if (!vars || typeof vars !== 'object') return null;
        return {
            cacheMode: String(vars.CACHE_MODE || 'HTMLCACHE'),
            dynamicBlocks: vars.dynamicBlocks && typeof vars.dynamicBlocks === 'object'
                ? vars.dynamicBlocks
                : {},
        };
    } catch {
        // Портал обновили и формат поехал: молча считать, что кэша нет, нельзя —
        // тогда мы будем разбирать пустой каркас и уверять, что лид пуст.
        return null;
    }
}

// Адрес второго запроса. bxrand — обход кэша браузера, значение любое.
export function dynamicUrl(path, now = Date.now()) {
    const url = new URL(String(path), 'https://portal.invalid');
    url.searchParams.set('bxrand', String(now));
    return `${url.pathname}${url.search}`;
}

// Заголовки второго запроса — ровно те, что ставит сам портал.
export function compositeHeaders(vars, { referer = '' } = {}) {
    return {
        'BX-ACTION-TYPE': 'get_dynamic',
        'X-Bitrix-Composite': 'get_dynamic',
        'BX-CACHE-MODE': vars?.cacheMode || 'HTMLCACHE',
        // Список блоков с их отпечатками: портал по нему решает, что прислать.
        // Пустая строка тоже допустима — тогда пришлёт всё.
        'BX-CACHE-BLOCKS': vars?.dynamicBlocks ? JSON.stringify(vars.dynamicBlocks) : '',
        ...(referer ? { 'BX-REF': referer } : {}),
    };
}

/**
 * Разметка страницы из ответа на второй запрос.
 *
 * Блоки склеиваем в один кусок: разбирать лид всё равно по нему целиком, а
 * какой именно блок окажется страницей («page-area» сегодня, завтра другой),
 * зависит от шаблона портала — привязываться к имени нельзя.
 */
export function dynamicHtml(answer) {
    if (typeof answer === 'string') return answer;
    const blocks = answer?.dynamicBlocks;
    if (!blocks) return '';
    const parts = Array.isArray(blocks)
        ? blocks
        : Object.values(blocks);
    return parts
        .map(part => (typeof part === 'string' ? part : String(part?.CONTENT ?? part?.content ?? '')))
        .filter(Boolean)
        .join('\n');
}
