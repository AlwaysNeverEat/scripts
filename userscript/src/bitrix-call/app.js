// ─────────────────────────────────────────────────────────────────────────────
// Датчик звонков: единственное, что мы просим у вкладки Битрикса.
//
// Зачем он вообще нужен. Читать и сохранять лид сайт умеет сам, своей сессией
// (docs/BITRIX.md). Чего сайт НЕ может — узнать, что прямо сейчас идёт звонок.
// Проверено дорогой ценой: список лидов у оператора отфильтрован (новых лидов
// в нём попросту нет), повторный клиент нового лида не создаёт вовсе, а номера
// лидов на этом портале лежат в разных диапазонах и «больше номер» не значит
// «позже создан». То есть с сервера звонок не виден никак — а на вкладке
// Битрикса он виден всегда.
//
// Ловим тремя способами, от самого надёжного к запасному:
//
// 1. СОБЫТИЯ ТЕЛЕФОНИИ. Портал узнаёт о звонке не опросом, а живым событием
//    (pull) — из него же он и рисует карточку. Подписываемся на то же самое:
//    в событии сразу и номер, и звонок, и связанный лид.
// 2. ФОРМА ПРИЛОЖЕНИЯ (PLACEMENT_OPTIONS). Так данные попадают в приложение
//    телефонии; форма есть не всегда — на живом звонке 22.08 её не было вовсе,
//    хотя карточка висела на экране.
// 3. КАРТОЧКА НА ЭКРАНЕ. Если первых двух не случилось, читаем то, что видит
//    человек: номер и, если есть, ссылку на лид.
//
// Оператор опознаётся логином Битрикса (кука BITRIX_SM_UIDL) — тем же, которым
// он входил в Битрикс через сайт. Сессии сайта тут нет и быть не может: она
// живёт в заголовке Authorization на другом домене.
// ─────────────────────────────────────────────────────────────────────────────

import { pickCurrentCall, parseCallOption } from '../../../shared/bitrixCall.js';

const API_BASE = 'https://k-spot.ru';
const API_KEY = 'a56817cfece2ca6ad4bfdf7c2a7b83e1df99184d09daf574';

const SCAN_EVERY_MS = 2000;
// Сколько молчим про один и тот же номер, пойманный по карточке на экране.
// Карточка висит весь разговор, а звонок у нас один.
const DOM_COOLDOWN_MS = 3 * 60 * 1000;

// Один звонок отправляем один раз: карточка приходит и уходит много раз за
// разговор (перерисовки, сворачивание, переход между разделами).
const sent = new Set();
// Сервер сказал «учётка не привязана» — замолкаем до перезагрузки страницы.
let muted = false;

// Страница и скрипт живут в разных мирах: BX портала виден только через
// unsafeWindow. Без него никаких событий телефонии мы не увидим.
function pageWindow() {
    try {
        // eslint-disable-next-line no-undef
        return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    } catch {
        return window;
    }
}

function bitrixLogin() {
    const m = document.cookie.match(/(?:^|;\s*)BITRIX_SM_UIDL=([^;]+)/);
    if (!m) return null;
    try {
        return decodeURIComponent(m[1]);
    } catch {
        return m[1];
    }
}

// ── 1. События телефонии ─────────────────────────────────────────────────────

// Событий у телефонии много, и половина из них про КОНЕЦ разговора. Поднимать
// по ним звонок нельзя: сайт считает звонок открытым, пока не сохранён лид, и
// «звонок завершён» превратилось бы в новое уведомление.
const ENDING = /end|finish|destroy|hangup|complete|cancel/i;

function watchPull() {
    const BX = pageWindow().BX;
    if (!BX || typeof BX.addCustomEvent !== 'function') return false;

    BX.addCustomEvent('onPullEvent', (moduleId, command, params) => {
        const where = `${moduleId} ${command}`;
        if (!/vox|telephon|call/i.test(where)) return;
        // Печатаем ВСЁ, что похоже на телефонию: формат этих событий нигде не
        // описан, и один живой лог экономит день гаданий.
        console.log('[SPOT] событие телефонии:', moduleId, command, params);
        if (ENDING.test(String(command))) return;

        const call = fromPullParams(params);
        if (call && !sent.has(call.callId)) {
            sent.add(call.callId);
            console.log('[SPOT] увидел звонок (событие):', call);
            report(call);
        }
    });
    return true;
}

// Поля у события те же, что в форме приложения, но лежать могут на этаж
// глубже — смотрим и в сам объект, и в привычные обёртки.
function fromPullParams(params) {
    for (const raw of [params, params?.call, params?.CALL, params?.data, params?.PARAMS]) {
        const call = raw && parseCallOption(raw);
        if (call) return call;
    }
    return null;
}

// ── 2. Форма приложения телефонии ────────────────────────────────────────────

function readOptions() {
    return [...document.querySelectorAll('input[name="PLACEMENT_OPTIONS"]')].map(input => input.value);
}

// ── 3. Карточка на экране ────────────────────────────────────────────────────

const CARD_SELECTOR = [
    '[class*="call-card"]', '[class*="callcard"]', '[class*="call_card"]',
    '[class*="callCard"]', '.bx-call-view', '.crm-call-card',
].join(', ');

const domSeen = new Map(); // номер → когда сообщили
let cardAt = 0;

function readCard() {
    // MutationObserver на портале срабатывает десятки раз в секунду, а обход
    // страницы по широкому селектору дешёвым не бывает: смотрим не чаще, чем
    // раз в опрос.
    if (Date.now() - cardAt < SCAN_EVERY_MS) return null;
    cardAt = Date.now();

    for (const card of document.querySelectorAll(CARD_SELECTOR)) {
        const text = card.innerText || '';
        // Карточка исходящего и карточка завершённого звонка нам не нужны:
        // сайт показывает входящий разговор, который сейчас идёт.
        if (!/входящ/i.test(text)) continue;

        const phone = (text.match(/\+?\d[\d\s\-()]{9,}\d/) || [])[0];
        if (!phone) continue;
        const digits = phone.replace(/\D+/g, '');

        const at = domSeen.get(digits) || 0;
        if (Date.now() - at < DOM_COOLDOWN_MS) continue;
        domSeen.set(digits, Date.now());

        const link = card.querySelector('a[href*="/crm/lead/details/"]')
            || document.querySelector('a[href*="/crm/lead/details/"]');
        const leadId = (link?.getAttribute('href')?.match(/\/crm\/lead\/details\/(\d+)\//) || [])[1] || null;

        return {
            callId: `dom:${digits}:${Math.floor(Date.now() / 1000)}`,
            startedAt: Date.now(),
            phone: digits,
            line: null,
            direction: 'incoming',
            leadId,
        };
    }
    return null;
}

// ── Отправка ─────────────────────────────────────────────────────────────────

function report(call) {
    const login = bitrixLogin();
    if (!login) {
        console.warn('[SPOT] не вижу логин Битрикса в куках — звонок не отправлен');
        return;
    }
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
                sent.delete(call.callId);
                return;
            }
            console.log(`[SPOT] звонок передан сайту: ${call.phone || 'номер неизвестен'}`
                + `${call.leadId ? `, лид ${call.leadId}` : ', лида пока нет'}`);
        },
        onerror() { sent.delete(call.callId); },
        ontimeout() { sent.delete(call.callId); },
    });
}

// ── Опрос страницы ───────────────────────────────────────────────────────────

let firstScan = true;
let pullReady = false;

function scan() {
    if (muted) return;
    if (!pullReady) pullReady = watchPull();
    if (!bitrixLogin()) return;

    const call = pickCurrentCall(readOptions(), { known: sent, firstScan }) || readCard();
    firstScan = false;
    if (!call || sent.has(call.callId)) return;

    sent.add(call.callId);
    // Пишем в консоль ДО отправки: так датчик виден на живом звонке ещё до
    // того, как сайт научится его принимать.
    console.log('[SPOT] увидел звонок:', call);
    report(call);
}

// Смотрим и по изменениям страницы, и по таймеру: карточку вставляют скриптом,
// а MutationObserver в Битриксе легко пропустить — портал перерисовывает
// целые куски разом.
new MutationObserver(() => scan()).observe(document.documentElement, { childList: true, subtree: true });
setInterval(scan, SCAN_EVERY_MS);
scan();

// Ручной осмотр: во время звонка набрать в консоли SPOT.dump() — датчик
// расскажет, что он видит на странице. Это дешевле, чем пересказывать своими
// словами, и по такому ответу разбор пишется за один заход.
try {
    pageWindow().SPOT = {
        dump() {
            const cards = [...document.querySelectorAll(CARD_SELECTOR)];
            const out = {
                логин: bitrixLogin(),
                формы: readOptions(),
                событияТелефонии: pullReady ? 'слушаю' : 'BX.addCustomEvent не найден',
                карточек: cards.length,
                классы: cards.map(c => c.className).slice(0, 10),
                тексты: cards.map(c => (c.innerText || '').slice(0, 200)).slice(0, 5),
                ссылкиНаЛиды: [...document.querySelectorAll('a[href*="/crm/lead/details/"]')]
                    .map(a => a.getAttribute('href')).slice(0, 10),
                отправлено: [...sent],
            };
            console.log('[SPOT] осмотр:', out);
            return out;
        },
    };
} catch { /* песочница не пускает к странице — не беда, датчик работает и так */ }

console.log('[SPOT] датчик звонков Битрикса запущен (события телефонии + форма + карточка)');
