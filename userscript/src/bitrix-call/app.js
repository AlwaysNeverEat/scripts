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
//
// Отбор свежего звонка — в shared/bitrixCall.js, там же его тесты: карточки на
// странице КОПЯТСЯ и не обновляются, так что «какой звонок сейчас» — вопрос
// нетривиальный и проверять его надо не на живых клиентах.
// ─────────────────────────────────────────────────────────────────────────────

import { pickCurrentCall } from '../../../shared/bitrixCall.js';

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

// Карточка звонка — форма приложения телефонии в размещении CALL_CARD. Все
// данные в одном скрытом поле, JSON'ом.
function readOptions() {
    return [...document.querySelectorAll('input[name="PLACEMENT_OPTIONS"]')].map(input => input.value);
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

let firstScan = true;

function scan() {
    if (muted) return;
    const login = bitrixLogin();
    if (!login) return;

    const call = pickCurrentCall(readOptions(), { known: sent, firstScan });
    firstScan = false;
    if (!call) return;

    sent.add(call.callId);
    // Пишем в консоль ДО отправки, а не после ответа: так датчик можно
    // проверить на живом звонке ещё до того, как сайт научится его принимать, —
    // видно, что карточка распознана и что именно из неё прочитано.
    console.log('[SPOT] увидел звонок:', call);
    report(call, login);
}

// Смотрим и по изменениям страницы, и по таймеру: карточку звонка вставляют
// скриптом, а MutationObserver в Битриксе легко пропустить — портал
// перерисовывает целые куски разом.
new MutationObserver(() => scan()).observe(document.documentElement, { childList: true, subtree: true });
setInterval(scan, SCAN_EVERY_MS);
scan();

console.log('[SPOT] датчик звонков Битрикса запущен');
