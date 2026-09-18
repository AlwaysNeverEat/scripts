// ─────────────────────────────────────────────────────────────────────────────
// Роутер БЕЗ РЕШЁТКИ: адрес — обычный путь (/records?date=…, /gtrixoff,
// /car/<id>), а не #/…. nginx на любой путь отдаёт index.html (deploy/
// nginx.conf), поэтому прямая ссылка и F5 работают без хэша; сам роутинг —
// History API (pushState + popstate).
//
// СТАРЫЕ АДРЕСА С РЕШЁТКОЙ ЖИВЫ: закладки, ссылки в чатах и вшитые в
// юзерскрипты `/#/car/<id>` переписываются на путь молча — при загрузке и по
// hashchange (юзерскрипт может подставить hash уже открытой вкладке). Именно
// поэтому совместимость живёт здесь, а не одноразовой строчкой в main.js.
//
// Клики по внутренним <a href="/…"> тоже перехватываются здесь: настоящие
// ссылки (их можно открыть в новой вкладке) не должны перезагружать SPA при
// обычном клике. Файлы (/assets/…, /avatars/…, всё с расширением) и /api
// роутеру не принадлежат — их отдаёт nginx.
// ─────────────────────────────────────────────────────────────────────────────

const listeners = new Set();

function emit() { listeners.forEach(fn => fn()); }

/** Текущий роут: путь + строка запроса ('/', '/records?date=…'). */
export function currentPath() {
    return (location.pathname || '/') + location.search;
}

/**
 * Перейти на роут. Тот же путь — ничего не делает (как раньше повторное
 * присваивание того же hash не рождало hashchange).
 */
export function navigate(path, { replace = false } = {}) {
    if (currentPath() === path) return;
    history[replace ? 'replaceState' : 'pushState'](null, '', path);
    emit();
}

/** Подписка на смену роута (navigate, Назад/Вперёд, старый hash-адрес). */
export function onRoute(fn) { listeners.add(fn); }

// Старый hash-адрес → путь. replace, а не push: «Назад» не должен возвращать
// на адрес, который тут же уезжает снова.
function migrateHash() {
    if (!location.hash.startsWith('#/')) return false;
    history.replaceState(null, '', location.hash.slice(1) || '/');
    return true;
}

function isRouteLink(a) {
    if (a.target && a.target !== '_self') return false;
    if (a.hasAttribute('download')) return false;
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#/')) return true; // старая форма в разметке или постах
    if (!href.startsWith('/') || href.startsWith('//')) return false;
    const path = href.split(/[?#]/)[0];
    if (/\.\w+$/.test(path)) return false; // файл (records.html и подобные)
    if (path.startsWith('/api/') || path.startsWith('/avatars/') || path.startsWith('/assets/')) return false;
    return true;
}

/** Включить роутер. Зовётся один раз из main.js, до первого renderRoute. */
export function initRouter() {
    window.addEventListener('popstate', emit);
    window.addEventListener('hashchange', () => { if (migrateHash()) emit(); });
    migrateHash(); // адрес с решёткой при загрузке — до первой отрисовки

    document.addEventListener('click', (e) => {
        if (e.defaultPrevented || e.button !== 0) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // «в новой вкладке» — браузеру
        const a = e.target.closest('a[href]');
        if (!a || !isRouteLink(a)) return;
        e.preventDefault();
        const href = a.getAttribute('href');
        navigate(href.startsWith('#/') ? href.slice(1) : href);
    });
}
