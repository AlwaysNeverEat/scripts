// ─────────────────────────────────────────────────────────────────────────────
// Обрывы соединения при походах на сторонние сайты (оригинальная админка
// записей и CRM) — общее для crm/client.js и records/adminClient.js.
//
// Зачем: обе стороны держат keep-alive недолго (секунды), а undici внутри
// node-fetch переиспользует сокеты из пула. Если сервер закрыл соединение ровно
// в тот момент, когда мы отправили в него следующий запрос, fetch падает
// TypeError'ом с cause UND_ERR_SOCKET «other side closed»: ответа не было
// вовсе, запрос до сервера не дошёл. Мы ходим редко (тик синка — раз в минуту,
// живая доска — по клику), то есть попадаем в это окно постоянно, и снаружи это
// выглядит как «через раз не работает у части людей».
//
// Такой обрыв безопасно повторить — сервер запрос не видел. Повтор всё равно
// разрешаем только для чтения: POST /admin/record/update мог доехать и создать
// запись, а связь оборваться уже на ответе.
// ─────────────────────────────────────────────────────────────────────────────

// Коды, означающие «соединение не состоялось / умерло до ответа».
// ETIMEDOUT здесь — таймаут TCP-уровня, а не наш AbortController.
const TRANSIENT = new Set([
    'UND_ERR_SOCKET',           // other side closed — самый частый гость
    'UND_ERR_CONNECT_TIMEOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'EPIPE',
    'ETIMEDOUT',
    'EAI_AGAIN',                // DNS моргнул
]);

// Человеческие подписи вместо кодов undici: текст ошибки уходит прямо в
// интерфейс («не удалось получить расписание на …: <текст>»), и «UND_ERR_SOCKET:
// other side closed» там читать некому.
const HINTS = {
    UND_ERR_SOCKET: 'соединение разорвано до ответа',
    UND_ERR_CONNECT_TIMEOUT: 'не удалось подключиться (таймаут)',
    ECONNRESET: 'соединение сброшено',
    ECONNREFUSED: 'соединение отклонено',
    EPIPE: 'соединение закрылось на середине запроса',
    ETIMEDOUT: 'соединение не установилось (таймаут)',
    EAI_AGAIN: 'адрес не разрешается (DNS)',
    ENOTFOUND: 'адрес не найден (DNS)',
    // Сертификат чужого сервера. Раньше это вылезало в панель как
    // «CERT_HAS_EXPIRED: certificate has expired» — по такой строке человек за
    // стойкой не понимает ни что сломалось, ни что сломалось не у него.
    CERT_HAS_EXPIRED: 'сертификат сервера просрочен',
    CERT_NOT_YET_VALID: 'сертификат сервера ещё не действует',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'сертификат сервера самоподписанный',
    SELF_SIGNED_CERT_IN_CHAIN: 'самоподписанный сертификат в цепочке',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'сертификат сервера не проверяется (неполная цепочка)',
    UNABLE_TO_GET_ISSUER_CERT: 'не найден сертификат удостоверяющего центра',
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'не найден сертификат удостоверяющего центра',
    ERR_TLS_CERT_ALTNAME_INVALID: 'сертификат выписан на другой домен',
    CRM_TLS_FINGERPRINT_MISMATCH: 'сертификат не совпал с CRM_TLS_FINGERPRINT',
};

const NET_RETRIES = 2;                          // всего до трёх попыток
const netRetryDelay = (attempt) => 300 * (attempt + 1);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function errorCode(err) {
    return err?.cause?.code || err?.code || err?.name;
}

// Наш собственный таймаут (AbortController) транзиентным не считаем: 20 секунд
// уже потрачены, повтор только удвоит ожидание.
export function isTransientNetworkError(err) {
    if (err?.name === 'AbortError') return false;
    return TRANSIENT.has(errorCode(err));
}

// Текст для пользователя. timeoutMs — наш таймаут запроса, чтобы в сообщении
// было видно, сколько именно ждали.
export function describeNetworkError(err, timeoutMs) {
    if (err?.name === 'AbortError') return `таймаут ${timeoutMs} мс`;
    const code = errorCode(err);
    if (HINTS[code]) return `${HINTS[code]} (${code})`;
    const message = err?.cause?.message || err?.message || 'неизвестная ошибка сети';
    return code && !String(message).includes(code) ? `${code}: ${message}` : String(message);
}

// Запрос можно повторить, не рискуя выполнить его дважды?
function isReplayableMethod(method) {
    return ['GET', 'HEAD'].includes(String(method || 'GET').toUpperCase());
}

// fetch с таймаутом и повтором транзиентных обрывов. Повторяем только чтение;
// у POST'а обрыв мог случиться и на ответе — тогда сервер запрос уже выполнил.
//
// timeoutMs — на КАЖДУЮ попытку (свой AbortController), иначе второй попытке
// доставался бы уже истёкший бюджет. beforeAttempt — крючок для троттлинга:
// у CRM пауза считается по запросам, а повтор тоже запрос. fetchImpl — чем
// стучаться: по умолчанию глобальным fetch (его же подменяют тесты), но клиент
// CRM с послаблением TLS передаёт сюда fetch из undici — только он понимает
// dispatcher, собранный тем же пакетом (см. http/tlsTrust.js).
//
// Наружу летит исходная ошибка fetch: во что её завернуть (ZmsError или
// CrmError) и как описать — дело вызывающего клиента.
export async function fetchWithRetry(target, init = {}, { timeoutMs, beforeAttempt, fetchImpl } = {}) {
    const retries = isReplayableMethod(init.method) ? NET_RETRIES : 0;
    for (let attempt = 0; ; attempt++) {
        if (beforeAttempt) await beforeAttempt();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            // Глобальный fetch берём на каждой попытке, а не один раз при
            // импорте: тесты подменяют globalThis.fetch.
            const call = fetchImpl || fetch;
            return await call(target, { ...init, signal: controller.signal });
        } catch (err) {
            if (attempt < retries && isTransientNetworkError(err)) {
                await sleep(netRetryDelay(attempt));
                continue;
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }
}
