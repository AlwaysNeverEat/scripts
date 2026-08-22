// ─────────────────────────────────────────────────────────────────────────────
// Датчик звонков: единственное, что мы просим у вкладки Битрикса.
//
// Зачем он вообще нужен. Читать и сохранять лид сайт умеет сам, своей сессией
// (docs/BITRIX.md). Чего сайт НЕ может — узнать, что прямо сейчас идёт звонок:
// у телефонии доступа нет, а опрос списка лидов ответил бы «появился новый
// лид», но не «звонят ТЕБЕ». Между тем Битрикс это уже знает: пока идёт
// разговор, на странице живёт карточка звонка от приложения телефонии, а в ней
// — и номер, и лид, который Битрикс с этим звонком связал.
//
// Поэтому датчик делает ровно одно: замечает эту карточку и пересказывает её
// сайту. Он ничего не читает из CRM, ничего не меняет и не трогает саму
// страницу. Если его выключить, сломается только всплывающее уведомление —
// панель, лента и сохранение работают без него.
//
// Оператор опознаётся логином Битрикса (кука BITRIX_SM_UIDL) — тем же, которым
// он входил в Битрикс через сайт. Сессии сайта тут нет и быть не может: она
// живёт в заголовке Authorization на другом домене.
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = 'https://k-spot.ru';
const API_KEY = 'a56817cfece2ca6ad4bfdf7c2a7b83e1df99184d09daf574';

const SCAN_EVERY_MS = 2000;

// Карточка звонка приходит и уходит много раз за один разговор (перерисовки,
// сворачивание, переход между разделами). Отправляем каждый звонок один раз.
const sent = new Set();
// Сервер сказал «учётка не привязана» — замолкаем до перезагрузки страницы,
// чтобы не долбиться каждым звонком.
let muted = false;

function bitrixLogin() {
    const m = document.cookie.match(/(?:^|;\s*)BITRIX_SM_UIDL=([^;]+)/);
    if (!m) return null;
    try {
        return decodeURIComponent(m[1]);
    } catch {
        return m[1];
    }
}

// Карточка звонка — это форма приложения телефонии в размещении CALL_CARD.
// Все данные лежат в одном скрытом поле, JSON'ом.
function readCalls() {
    const found = [];
    for (const input of document.querySelectorAll('input[name="PLACEMENT_OPTIONS"]')) {
        let data;
        try {
            data = JSON.parse(input.value || '{}');
        } catch {
            continue;
        }
        if (!data || !data.CALL_ID) continue;
        found.push({
            callId: String(data.CALL_ID),
            phone: data.PHONE_NUMBER ? String(data.PHONE_NUMBER) : null,
            line: data.LINE_NUMBER ? String(data.LINE_NUMBER) : null,
            direction: data.CALL_DIRECTION ? String(data.CALL_DIRECTION) : 'incoming',
            // Лида может ещё не быть (звонок с неизвестного номера в первую
            // секунду) — тогда шлём звонок без него, сайт покажет номер.
            leadId: data.CRM_ENTITY_TYPE === 'LEAD' && data.CRM_ENTITY_ID
                ? String(data.CRM_ENTITY_ID)
                : null,
        });
    }
    return found;
}

function report(call, login) {
    GM_xmlhttpRequest({
        method: 'POST',
        url: `${API_BASE}/api/bitrix/sensor`,
        headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
        data: JSON.stringify({ ...call, bitrixLogin: login }),
        onload(res) {
            let answer = null;
            try {
                answer = JSON.parse(res.responseText || '{}');
            } catch { /* ответ не разобрался — считаем, что не дошло */ }

            if (answer && answer.ok === false && answer.reason === 'not_linked') {
                muted = true;
                console.warn('[SPOT] учётка Битрикса не привязана к аккаунту сайта —'
                    + ' войдите в Битрикс через сайт, тогда звонки начнут всплывать');
                return;
            }
            if (!answer || !answer.ok) {
                // Звонок не дошёл — пробуем его ещё раз на следующем проходе.
                sent.delete(call.callId);
                return;
            }
            console.log(`[SPOT] звонок передан сайту: ${call.phone || 'номер неизвестен'}`
                + `${call.leadId ? `, лид ${call.leadId}` : ', лида пока нет'}`);
        },
        onerror() {
            sent.delete(call.callId);
        },
        ontimeout() {
            sent.delete(call.callId);
        },
    });
}

function scan() {
    if (muted) return;
    const login = bitrixLogin();
    if (!login) return;
    for (const call of readCalls()) {
        if (sent.has(call.callId)) continue;
        sent.add(call.callId);
        // Пишем в консоль ДО отправки, а не после ответа: так датчик можно
        // проверить на живом звонке ещё до того, как сайт научится его
        // принимать, — видно, что карточка распознана и что из неё прочитано.
        console.log('[SPOT] увидел звонок:', call);
        report(call, login);
    }
}

// Смотрим и по изменениям страницы, и по таймеру: карточку звонка вставляют
// скриптом, а MutationObserver в Битриксе легко пропустить — портал
// перерисовывает целые куски разом.
new MutationObserver(() => scan()).observe(document.documentElement, { childList: true, subtree: true });
setInterval(scan, SCAN_EVERY_MS);
scan();

console.log('[SPOT] датчик звонков Битрикса запущен');
