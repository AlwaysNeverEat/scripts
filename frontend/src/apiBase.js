// ── Выбор рабочего адреса бэкенда ────────────────────────────────────────────
// Список имён строит shared/apiCandidates.js (там же объяснено, зачем их
// несколько). Здесь — гонка: пингуем ВСЕ имена одновременно и работаем через
// то, что ответило первым.
//
// Именно одновременно, а не по очереди: имена ведут на один и тот же сервер, и
// смысл проверки не в том, какое из них живо, а в том, какое сейчас пропускают.
// Пробовать их последовательно — значит ждать таймаут заведомо задушенного
// имени, прежде чем взяться за рабочее.
//
// Попытки к тому же идут внахлёст: новая пачка каждые ATTEMPT_SPACING, не
// дожидаясь таймаута предыдущей. Душат ведь хендшейк, а он либо проскочил, либо
// висит до таймаута — так что больше одновременных попыток прямо повышает шанс.

import { buildApiCandidates } from '../../shared/apiCandidates.js';

const ATTEMPT_SPACING = 2500;
const PING_TIMEOUT = 8000;
const STORE_KEY = 'cars_db_api_base';

const BUILD_BASE = (typeof __API_BASE__ !== 'undefined' && __API_BASE__) ? __API_BASE__ : '';
const EXTRAS = (typeof __API_FALLBACKS__ !== 'undefined' && __API_FALLBACKS__)
    ? String(__API_FALLBACKS__).split(',')
    : [];

const candidates = buildApiCandidates({
    hostname: typeof location !== 'undefined' ? location.hostname : '',
    buildBase: BUILD_BASE,
    extras: EXTRAS,
});

// Пустой список — дев-сервер: ходим относительными путями, их проксирует Vite.
const probeList = candidates.length ? candidates : [''];

let current = null;

// Адрес, через который работает приложение. До того, как гонка закончилась,
// отдаём первый по предпочтению — чтобы запрос, случившийся раньше времени,
// всё же ушёл, а не упал.
export function getApiBase() {
    if (current !== null) return current;
    try {
        const saved = sessionStorage.getItem(STORE_KEY);
        if (saved !== null && probeList.includes(saved)) {
            current = saved;
            return current;
        }
    } catch { /* приватный режим — просто выберем заново */ }
    return probeList[0];
}

function setApiBase(base) {
    current = base;
    // На вкладку, а не навсегда: сегодня душат одно имя, завтра другое, и
    // застревать в прошлогоднем выборе не нужно.
    try { sessionStorage.setItem(STORE_KEY, base); } catch { /* не критично */ }
}

// Одна проба одного имени. Любой ответ, кроме 5xx, считаем связью: 502/503
// Render отдаёт, пока просыпается, — это ещё не готовность.
async function ping(base) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), PING_TIMEOUT);
    try {
        const res = await fetch(`${base}/health?_=${Date.now()}`, {
            signal: ctl.signal,
            cache: 'no-store',
        });
        return (res.ok || (res.status >= 400 && res.status < 500)) ? base : null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

// Гонка до первого ответившего имени. onAttempt(n, base) зовётся на каждый
// провал — для строк в boot-логе. cancelled() позволяет бросить всё, когда юзер
// нажал Continue. Резолвится true при успехе, false — если отменили.
export function connectApi({ onAttempt = () => {}, cancelled = () => false } = {}) {
    return new Promise(resolve => {
        let done = false;
        let failed = 0;

        const stop = ok => {
            if (done) return;
            done = true;
            clearInterval(timer);
            resolve(ok);
        };

        function fire() {
            if (done) return;
            if (cancelled()) { stop(false); return; }
            for (const base of probeList) {
                ping(base).then(okBase => {
                    if (okBase !== null) {
                        setApiBase(okBase);
                        stop(true);
                    } else if (!done) {
                        onAttempt(++failed, base);
                    }
                });
            }
        }

        const timer = setInterval(fire, ATTEMPT_SPACING);
        fire();
    });
}

// Для лога и диагностики: какие имена вообще перебираем.
export function apiCandidates() {
    return [...probeList];
}
