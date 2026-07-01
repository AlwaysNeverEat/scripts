// ─────────────────────────────────────────────────────────────────────────────
// Сервис-флаги машины: единый словарь «ключ → русская подпись».
// Используется модалкой «Отправить отчёт» в юзерскрипте и страницей машины
// на сайте — подписи везде одинаковые.
// Ключи хранятся в cars.service_flags (jsonb, миграция 004).
// ─────────────────────────────────────────────────────────────────────────────

export const SERVICE_FLAGS = {
    atNoFull:     { label: 'АКПП полную не делаем',          warn: true },
    noSumpFilter: { label: 'Фильтра в поддоне нет',          warn: false },
    dctNoService: { label: 'Этому роботу расчёт не делаем',   warn: true },
    cvtNoService: { label: 'Этому вариатору расчёт не делаем', warn: true },
};

export function flagLabel(key) {
    return SERVICE_FLAGS[key] ? SERVICE_FLAGS[key].label : key;
}

// Активные флаги записи БД → [{ key, label, warn }]
export function activeFlags(serviceFlags) {
    const out = [];
    for (const [key, val] of Object.entries(serviceFlags || {})) {
        if (!val) continue;
        const def = SERVICE_FLAGS[key];
        out.push({ key, label: def ? def.label : key, warn: def ? def.warn : true });
    }
    return out;
}
