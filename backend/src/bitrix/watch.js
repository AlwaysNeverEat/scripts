// ─────────────────────────────────────────────────────────────────────────────
// Наблюдатель: сайт САМ смотрит в Битрикс, не дожидаясь датчика.
//
// Почему так. Датчик (userscript/src/bitrix-call) видит карточку звонка от
// телефонии — самый точный источник, какой вообще бывает. Но он работает,
// только если у оператора открыта вкладка Битрикса и в браузере стоит
// Tampermonkey. Нет вкладки, не поставили скрипт, портал перерисовал страницу
// по-своему — и сайт не узнаёт о звонке вовсе. Держать всю затею на этом
// нельзя: звонок пропущен молча, а пропущенный звонок и есть та работа, ради
// которой панель писалась.
//
// Поэтому второй источник — свой опрос портала. «Не грузить чужой сервер» тут
// ложная бережливость: браузер оператора при открытом Битриксе делает по
// несколько запросов в секунду (портал держит pull-канал и сам постоянно
// ходит за счётчиками), и один наш запрос в несколько секунд на этом фоне —
// ровно то же, что человек, читающий список лидов. Опрашиваем только пока
// открыта вкладка сайта: спрашивает не таймер, а панель (routes/bitrix.js).
//
// Что опрос МОЖЕТ и чего НЕ может — граница жёсткая:
//
//   может  — увидеть НОВЫЙ лид. Телефония заводит его на входящий с
//            неизвестного номера, с источником «Звонок»;
//   не может — увидеть звонок ПОВТОРНОГО клиента: у него лид уже есть, нового
//            не появляется, и в списке ничего не меняется. Такой звонок видит
//            только датчик — за это он и оставлен.
//
// Оба источника сходятся в одну запись звонка: сводит их bitrix/calls.js по
// лиду, иначе оператор получал бы два уведомления об одном разговоре.
// ─────────────────────────────────────────────────────────────────────────────

import { bitrixWatchHtml, bitrixGetHtml, BitrixError } from './client.js';
import { parseLeadModel, normalizeLead, leadPagePath } from './leadModel.js';
import { isCallSource } from './leads.js';
import { noteCall, rememberLead, sweepLeads } from './calls.js';

// Как часто ходим в Битрикс. Панель спрашивает чаще — лишние вопросы гасятся
// здесь, чтобы частота опроса портала не зависела от того, сколько вкладок
// сайта открыл оператор.
export function watchEveryMs() {
    const raw = Number(process.env.BITRIX_WATCH_MS);
    return Number.isFinite(raw) && raw >= 1000 ? raw : 4000;
}

// Сколько новых лидов разбираем за один проход. Каждый разбор — отдельная
// страница карточки, и если в списке вдруг оказалась сотня новых номеров
// (сменили фильтр, перенесли лиды), вычитывать их все нельзя: за это время
// пройдёт настоящий звонок.
const MAX_NEW_PER_POLL = 3;

/**
 * Номера лидов со страницы списка — сверху вниз по убыванию номера.
 *
 * Разметку списка не разбираем: и обычный список, и канбан, и «последние
 * просмотренные» ссылаются на карточку одним и тем же адресом, а вот вёрстка
 * у них разная и меняется от настроек вида. Ссылка — самое устойчивое, что на
 * этой странице есть.
 */
export function parseLeadIds(html) {
    const ids = new Set();
    const re = /\/crm\/lead\/(?:details|show)\/(\d+)\//g;
    let m;
    while ((m = re.exec(String(html || '')))) ids.add(m[1]);
    return [...ids].sort((a, b) => Number(b) - Number(a));
}

/**
 * Что из увиденного — новое.
 *
 * Первый проход НИЧЕГО не считает новым, только запоминает верхнюю границу:
 * иначе после перезапуска бэкенда оператору вывалилась бы вся вчерашняя лента
 * разом, как «входящие прямо сейчас».
 */
export function pickNewLeadIds(ids, { baseline = null, max = MAX_NEW_PER_POLL } = {}) {
    if (baseline == null) return [];
    return ids.filter(id => Number(id) > baseline).slice(0, max);
}

/**
 * Номер оператора в портале — из разметки любой его страницы.
 *
 * Нужен он ровно для одного: не всплывать на чужие звонки, если список лидов
 * показывает всю компанию. Включается это отдельно (BITRIX_WATCH_ASSIGNEE),
 * потому что ошибиться тут дороже, чем не фильтровать: лишнее уведомление
 * видно и раздражает, а отфильтрованный по ошибке звонок пропадает молча.
 */
export function parsePortalUserId(html) {
    const text = String(html || '');
    const m = text.match(/['"]USER_ID['"]\s*:\s*['"]?(\d+)/)
        || text.match(/\bUSER_ID\s*=\s*['"]?(\d+)/)
        || text.match(/\/company\/personal\/user\/(\d+)\//);
    return m ? Number(m[1]) : null;
}

// Состояние наблюдения — в памяти процесса, не в базе. Перезапуск бэкенда
// просто начинает наблюдение заново (см. pickNewLeadIds), а держать ради
// одного числа таблицу и миграцию незачем.
const watchers = new Map(); // userId → { baseline, at, inflight, last }

function watcher(userId) {
    let w = watchers.get(userId);
    if (!w) {
        w = { baseline: null, at: 0, inflight: null, last: null, reported: null };
        watchers.set(userId, w);
    }
    return w;
}

/**
 * Проход наблюдателя. Возвращает то, что увидел, — панель этим не пользуется,
 * зато по нему видно, работает ли опрос вообще (routes/bitrix.js, /watch).
 */
export async function watchCalls(userId, { now = Date.now(), force = false } = {}) {
    const w = watcher(userId);
    // Проход уже идёт — ждём его, а не запускаем второй: два одновременных
    // прохода прочитали бы один и тот же новый лид дважды.
    if (w.inflight) return w.inflight;
    if (!force && now - w.at < watchEveryMs()) return w.last;

    // Время прохода отмечаем ДО него, а не после: если Битрикс отвечает
    // медленно или не отвечает вовсе, следующая попытка должна ждать столько
    // же, а не идти сразу следом.
    w.at = now;
    w.inflight = poll(userId, w).finally(() => { w.inflight = null; });
    return w.inflight;
}

async function poll(userId, w) {
    const result = { at: Date.now(), ids: 0, newest: null, portalUserId: null, raised: [], skipped: [], error: null };
    try {
        const html = await bitrixWatchHtml(userId);
        const ids = parseLeadIds(html);
        result.ids = ids.length;
        result.newest = ids[0] || null;
        result.portalUserId = parsePortalUserId(html);

        const fresh = pickNewLeadIds(ids, { baseline: w.baseline });
        // Границу двигаем СРАЗУ на весь список, даже если разбирать будем не
        // всё: непрочитанный лид иначе всплывёт на следующем же проходе и
        // будет всплывать вечно.
        if (ids.length) w.baseline = Math.max(w.baseline ?? 0, Number(ids[0]));

        for (const id of fresh) {
            try {
                const why = await raiseCall(userId, id);
                if (why === true) result.raised.push(id);
                else result.skipped.push({ id, why });
            } catch (err) {
                // Один нечитаемый лид не должен ронять весь проход: следующий
                // звонок важнее разбирательства с этим.
                result.skipped.push({ id, why: err?.code || String(err?.message || err) });
            }
        }
        if (result.raised.length) sweepLeads().catch(err => console.warn('чистка ленты Битрикса', err));
    } catch (err) {
        result.error = err instanceof BitrixError ? err.code : String(err?.message || err);
        if (!(err instanceof BitrixError)) console.warn('наблюдатель Битрикса', err);
    }
    w.last = result;
    report(userId, w, result);
    return result;
}

// Проход пишется в лог НЕ каждый: в спокойной смене это была бы строка каждые
// четыре секунды и ничего больше. Пишем первый проход (по нему видно, что
// наблюдение вообще началось и что список читается), появление и снятие
// ошибки, и всё, что наблюдатель посчитал или не посчитал звонком. Иначе
// «уведомление не всплыло» разбирать не по чему: панели диагностика не
// показывается, а ручка /api/bitrix/watch требует ключа и сессии.
function report(userId, w, result) {
    const worth = !w.reported
        || result.error !== w.reported.error
        || result.raised.length
        || result.skipped.length;
    w.reported = result;
    if (!worth) return;

    const parts = [`наблюдатель Битрикса (аккаунт ${userId}): лидов на странице ${result.ids}`];
    if (result.newest) parts.push(`верхний ${result.newest}`);
    if (result.raised.length) parts.push(`звонок по лидам ${result.raised.join(', ')}`);
    for (const skip of result.skipped) parts.push(`лид ${skip.id} пропущен: ${skip.why}`);
    if (result.error) parts.push(`ошибка: ${result.error}`);
    console.log(parts.join('; '));
}

// Новый лид → звонок. Возвращает true или причину, по которой не считаем.
async function raiseCall(userId, leadId) {
    const html = await bitrixGetHtml(userId, leadPagePath(leadId));
    const lead = normalizeLead(parseLeadModel(html));
    const view = lead.view;

    // Источник «Звонок» ставит телефония — по нему новый лид и опознаётся как
    // входящий. Пустой источник тоже берём: правило компании требует его
    // сменить, значит пустым он бывает только у нетронутого лида. Всё
    // остальное (сайт, повторная продажа, руками заведённый) звонком не
    // является, и всплывать на него — врать оператору.
    if (view.sourceId && !isCallSource(view.sourceId)) return `источник ${view.sourceId}`;

    const only = Number(process.env.BITRIX_WATCH_ASSIGNEE) || null;
    if (only && view.assignedById && view.assignedById !== only) return `ответственный ${view.assignedById}`;

    // В ленту лид кладём с настоящими полями, а не заготовкой: мы его уже
    // прочитали, и оператор увидит в ленте имя и стадию сразу.
    await rememberLead(lead, { userId });
    await noteCall(userId, {
        callId: `lead:${leadId}`,
        leadId,
        phone: view.phones?.[0] || null,
        direction: 'incoming',
    });
    return true;
}

/** Что наблюдатель увидел в прошлый раз — для диагностики. */
export function lastWatch(userId) {
    return watchers.get(userId)?.last || null;
}

// Для тестов: забыть всё наблюдение.
export function resetWatchers() {
    watchers.clear();
}
