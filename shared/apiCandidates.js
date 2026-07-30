// ── Адреса бэкенда в порядке предпочтения ────────────────────────────────────
// Бэкенд один, а имён у него может быть несколько: собственное имя Render
// (cars-db-backend.onrender.com) и свой домен (api.k-spot.ru), который ведёт на
// тот же сервер и те же IP.
//
// Зачем несколько: фильтрация трафика в РФ смотрит на имя хоста в TLS-хендшейке
// (SNI) — оно идёт открытым текстом. Режут по конкретному имени, поэтому один
// и тот же сервер под своим доменом может отвечать, когда под onrender.com не
// отвечает. Клиент пробует все имена сразу и работает через то, что ответило.
//
// Имя api.<домен> выводится из адреса сайта само: сайт на k-spot.ru — значит
// пробуем https://api.k-spot.ru. Это нарочно: чтобы включить свой домен, хватит
// DNS-записи, без пересборки и правки переменных.

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

const clean = url => String(url || '').trim().replace(/\/+$/, '');

// hostname — location.hostname страницы; buildBase — то, что зашили в сборку
// (VITE_API_BASE); extras — необязательный ручной список (VITE_API_FALLBACKS).
// Возвращает список без дублей; пустой список означает «ходить относительными
// путями» — так работает дев-сервер с прокси Vite.
export function buildApiCandidates({ hostname = '', buildBase = '', extras = [] } = {}) {
    const list = [];
    const host = String(hostname).trim().toLowerCase();

    // Свой домен есть только у настоящего сайта: ни на localhost, ни на
    // github.io имени api.<домен> не существует, и дёргать его незачем.
    const isLocal = !host || host === 'localhost' || host.endsWith('.local') || IPV4.test(host);
    const isPages = host.endsWith('github.io');
    if (!isLocal && !isPages) {
        const apex = host.replace(/^www\./, '');
        if (DOMAIN.test(apex)) list.push(`https://api.${apex}`);
    }

    for (const extra of extras) {
        const url = clean(extra);
        if (url) list.push(url);
    }

    // Адрес из сборки — последним: он рабочий, но именно его имя и режут.
    const base = clean(buildBase);
    if (base) list.push(base);

    return [...new Set(list)];
}
