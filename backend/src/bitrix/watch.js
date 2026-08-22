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

import { bitrixWatchPage, bitrixGetHtml, BitrixError } from './client.js';
import { parseLeadModel, normalizeLead, leadPagePath, BitrixReadError } from './leadModel.js';
import { isCallSource } from './leads.js';
import { noteCall, rememberLead, sweepLeads } from './calls.js';
import { query } from '../db/client.js';

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
        w = {
            baseline: null, at: 0, inflight: null, last: null, reported: null, reportedAt: 0,
            cursor: null, misses: 0, caughtUp: false, portalUserId: null,
        };
        watchers.set(userId, w);
    }
    return w;
}

/**
 * Проход наблюдателя. Возвращает то, что увидел, — панель этим не пользуется,
 * зато по нему видно, работает ли опрос вообще (routes/bitrix.js, /watch).
 */
export async function watchCalls(userId, { now = Date.now(), force = false, wait = false } = {}) {
    const w = watcher(userId);
    // Проход уже идёт — второй не запускаем: два одновременных прочитали бы
    // один и тот же новый лид дважды.
    if (w.inflight) return wait ? w.inflight : w.last;
    if (!force && now - w.at < watchEveryMs()) return w.last;

    // Время прохода отмечаем ДО него, а не после: если Битрикс отвечает
    // медленно или не отвечает вовсе, следующая попытка должна ждать столько
    // же, а не идти сразу следом.
    w.at = now;
    w.inflight = poll(userId, w).finally(() => { w.inflight = null; });
    // Панель прохода НЕ ЖДЁТ. Звонок она всё равно берёт из своей базы, а не
    // из ответа наблюдателя, и появится он на следующем же её вопросе — через
    // три секунды. Ждать ради этих трёх секунд поход в чужой портал (а в
    // догоне это десяток карточек подряд) значит подвесить панель на ровном
    // месте.
    if (!wait) {
        w.inflight.catch(err => console.warn('наблюдатель Битрикса', err));
        return w.last;
    }
    return w.inflight;
}

// Самый большой номер лида, который сайт когда-либо видел, — по нему и
// проверяем, то ли нам показывает портал. Мера грубая, но честная: лиды в
// Битриксе нумеруются по возрастанию, и список, где верхний номер МЕНЬШЕ уже
// известного, показывает не начало ленты, а её середину.
async function knownMaxLead() {
    try {
        const r = await query('SELECT max(lead_id) AS top FROM bitrix_leads');
        return Number(r.rows[0]?.top) || null;
    } catch {
        return null; // таблиц ещё нет — сравнивать не с чем, и это не ошибка
    }
}

// Как часто перечитываем список лидов. Минута: он нужен не для ловли звонка
// (этим занят щуп), а чтобы подтянуть курсор и показать картину в логе.
const LIST_EVERY_MS = 60 * 1000;

async function readList(userId, w, result) {
    if (w.list && Date.now() - w.list.at < LIST_EVERY_MS) {
        Object.assign(result, w.list.stats);
        return w.list.ids;
    }

    const page = await bitrixWatchPage(userId);

    // Считаем ОТДЕЛЬНО по каркасу и по динамике. Каркас — общий кэш портала,
    // он может быть снят когда угодно; динамика — то, что портал собрал для
    // этой учётки сейчас. Пока считали вместе, «лидов 51» отвечало вперемешку
    // про вчерашний снимок и про сегодня.
    const shellIds = parseLeadIds(page.shell);
    const dynamicIds = parseLeadIds(page.dynamic);
    const ids = [...new Set([...dynamicIds, ...shellIds])].sort((a, b) => Number(b) - Number(a));

    const stats = {
        shellIds: shellIds.length,
        dynamicIds: dynamicIds.length,
        dynamicLen: page.dynamic.length,
        ids: ids.length,
        newest: ids[0] || null,
        top: ids.slice(0, 5),
        portalUserId: parsePortalUserId(page.html),
    };
    Object.assign(result, stats);
    if (stats.portalUserId) w.portalUserId = stats.portalUserId;
    w.list = { at: Date.now(), ids, stats };
    return ids;
}

async function poll(userId, w) {
    const result = {
        at: Date.now(), ids: 0, newest: null, top: [], shellIds: 0, dynamicIds: 0,
        dynamicLen: 0, portalUserId: null, raised: [], skipped: [], stale: null,
        probe: null, cursor: null, error: null,
    };
    try {
        // Список читаем РЕДКО, а щупом ходим каждый проход. Раньше было
        // наоборот, и это была ошибка: список — личная выборка оператора, в
        // которую новые лиды могут не попадать вовсе, а стоит он двух запросов
        // к порталу. Он остался ради двух вещей: подтянуть курсор, если лиды
        // всё же видны, и показать в логе, что вообще происходит.
        const ids = (await readList(userId, w, result)) || [];

        const known = await knownMaxLead();
        if (known && result.newest && Number(result.newest) < known) result.stale = known;

        const fresh = pickNewLeadIds(ids, { baseline: w.baseline });
        // Границу двигаем СРАЗУ на весь список, даже если разбирать будем не
        // всё: непрочитанный лид иначе всплывёт на следующем же проходе и
        // будет всплывать вечно.
        if (ids.length) w.baseline = Math.max(w.baseline ?? 0, Number(ids[0]));

        for (const id of fresh) {
            try {
                const why = await raiseCall(userId, id, w);
                if (why === true) result.raised.push(id);
                else result.skipped.push({ id, why });
            } catch (err) {
                // Один нечитаемый лид не должен ронять весь проход: следующий
                // звонок важнее разбирательства с этим.
                result.skipped.push({ id, why: err?.code || String(err?.message || err) });
            }
        }
        // Курсор щупа — самый большой номер, который сайт вообще знает: из
        // своей ленты, из списка и из прошлых проходов. Список может отставать
        // на тысячи номеров (личный фильтр оператора), поэтому берём максимум,
        // а не последнее увиденное.
        w.cursor = Math.max(w.cursor ?? 0, known ?? 0, Number(result.newest) || 0) || null;
        await probeForward(userId, w, result);
        result.cursor = w.cursor;

        if (result.raised.length) sweepLeads().catch(err => console.warn('чистка ленты Битрикса', err));
    } catch (err) {
        result.error = err instanceof BitrixError ? err.code : String(err?.message || err);
        if (!(err instanceof BitrixError)) console.warn('наблюдатель Битрикса', err);
    }
    w.last = result;
    report(userId, w, result);
    return result;
}

// Как часто наблюдатель отмечается в логе, даже когда ничего не происходит.
// Молчание неотличимо от «он не работает», а разбираться с этим приходится по
// логам с чужой машины.
const HEARTBEAT_MS = 5 * 60 * 1000;

// Проход пишется в лог НЕ каждый: в спокойной смене это была бы строка каждые
// четыре секунды и ничего больше. Пишем то, по чему видно жизнь: первый
// проход, смену верхнего номера, ошибку, разбор лида — и раз в пять минут
// отметку «жив», чтобы замолчавший наблюдатель не выглядел работающим.
function report(userId, w, result) {
    const before = w.reported;
    const worth = !before
        || result.error !== before.error
        || result.newest !== before.newest
        || result.stale !== before.stale
        || result.raised.length
        || result.skipped.length
        || result.cursor !== before.cursor
        || result.at - (w.reportedAt || 0) > HEARTBEAT_MS;
    if (!worth) return;
    w.reported = result;
    w.reportedAt = result.at;

    const parts = [
        `наблюдатель Битрикса (аккаунт ${userId}): лидов ${result.ids}`
        + ` (динамика ${result.dynamicIds}, каркас ${result.shellIds}, блоки ${result.dynamicLen} символов)`,
    ];
    if (result.top.length) parts.push(`верхние ${result.top.join(', ')}`);
    if (result.cursor) {
        const probe = result.probe;
        parts.push(`щуп на ${result.cursor}`
            + (probe ? ` (${probe.catchUp ? 'догон, ' : ''}проб ${probe.tried}, нашёл ${probe.hits})` : ''));
    }
    if (result.portalUserId) parts.push(`наш номер в портале ${result.portalUserId}`);
    if (result.raised.length) parts.push(`звонок по лидам ${result.raised.join(', ')}`);
    for (const skip of result.skipped) parts.push(`лид ${skip.id} пропущен: ${skip.why}`);
    if (result.error) parts.push(`ошибка: ${result.error}`);
    console.log(parts.join('; '));

    if (result.stale) {
        console.log(
            `наблюдатель Битрикса: список отстаёт (верхний ${result.newest}, а лид ${result.stale}`
            + ' мы уже видели) — в самом Битриксе на списке лидов стоит личный фильтр оператора.'
            + ' Звонки при этом ловит щуп, список нужен только для картины в логе.',
        );
    }
}

// ── Щуп: чтение лида по номеру, без всякого списка ───────────────────────────
//
// Зачем он, если есть список. Список — ЛИЧНАЯ выборка оператора: фильтр,
// сортировка и число строк хранятся на сервере портала и у каждого свои.
// Живьём это выглядело так: динамика приходит, лидов 51, а номера в ней —
// 609424, 606960, 606740, 606504… с разрывами в сотни. То есть список честно
// показывал подборку по фильтру, в которую новые лиды телефонии не попадают
// вовсе, и опрашивать его можно было бесконечно.
//
// Щуп от всего этого не зависит. Номера лидов в Битриксе растут, а читать
// карточку по номеру мы умеем — это единственное, что проверено живьём и
// работает всегда. Поэтому наблюдатель просто идёт по номерам вперёд: знаем
// 611188 — пробуем 611189. Открылась карточка — есть новый лид, и заодно уже
// прочитаны источник, телефон и ответственный.
//
// Дыры в нумерации (лид удалили, номер занят чужой сущностью) щуп переступает
// сам: после нескольких промахов подряд он заглядывает не на один вперёд, а на
// два, три, до пяти — и, попав, переносит курсор туда. Без этого одна дыра
// останавливала бы наблюдение навсегда.
const PROBE_WINDOW = 5;

// Сколько карточек читаем за проход. В обычной работе одной хватает с запасом:
// проход идёт раз в несколько секунд, а номера прирастают куда медленнее. В
// догоне (см. ниже) читаем пачкой — иначе отставание в сотню номеров
// разбиралось бы полчаса.
const PROBE_PER_POLL = 1;
const CATCHUP_PER_POLL = 8;

/**
 * Догон: пока не нашли ХВОСТ нумерации, звонки не поднимаем.
 *
 * Запустившись, наблюдатель не знает, где кончаются существующие лиды: между
 * последним, что он видел, и сегодняшним днём могут лежать сотни чужих. Если
 * поднимать звонок на каждый, оператор получит сотню уведомлений о разговорах,
 * которых не было.
 *
 * Поэтому сначала щуп молча идёт вперёд, пока пять попыток подряд не упрутся в
 * пустоту — это и есть конец нумерации. Всё, что появится ПОСЛЕ, — уже
 * настоящий новый лид. Времени создания при этом не спрашиваем вовсе: часовой
 * пояс портала нам неизвестен, а «есть номер или нет» — вопрос без часовых
 * поясов.
 */
async function probeForward(userId, w, result) {
    if (w.cursor == null) return;
    const budget = w.caughtUp ? PROBE_PER_POLL : CATCHUP_PER_POLL;
    result.probe = { from: w.cursor, tried: 0, hits: 0, catchUp: !w.caughtUp };

    for (let i = 0; i < budget; i++) {
        // Шаг растёт с числом промахов подряд: пока номера идут сплошняком,
        // щуп ходит на один вперёд, а упёршись в дыру (лид удалили) —
        // начинает её перешагивать.
        const step = 1 + (w.misses % PROBE_WINDOW);
        const candidate = w.cursor + step;
        result.probe.tried++;

        let why;
        try {
            why = await raiseCall(userId, candidate, w);
        } catch (err) {
            // Карточки нет — такого лида ещё не существует. Это обычный ход
            // дела, а не поломка.
            if (err instanceof BitrixReadError) {
                w.misses++;
                if (!w.caughtUp && w.misses >= PROBE_WINDOW) {
                    w.caughtUp = true;
                    console.log(`наблюдатель Битрикса (аккаунт ${userId}): догнал нумерацию на ${w.cursor}`);
                }
                return; // дальше в этот проход не лезем: конца всё равно нет
            }
            throw err;
        }

        // Лид есть: курсор переносим ВСЕГДА, даже если звонком его не сочли, —
        // иначе щуп будет вечно спотыкаться об один и тот же чужой лид.
        w.cursor = candidate;
        w.misses = 0;
        result.probe.hits++;
        if (!w.caughtUp) continue;      // в догоне ничего не поднимаем
        if (why === true) result.raised.push(String(candidate));
        else result.skipped.push({ id: String(candidate), why });
    }
}

// Кого считаем своим. По умолчанию — учётку, под которой сайт вошёл в портал:
// щуп видит ВСЕ новые лиды компании, и без этого оператору всплывали бы чужие
// звонки. BITRIX_WATCH_ASSIGNEE=off снимает проверку, число — задаёт другого.
function watchAssignee(portalUserId) {
    const raw = String(process.env.BITRIX_WATCH_ASSIGNEE || '').trim();
    if (/^(off|no|0)$/i.test(raw)) return null;
    const forced = Number(raw);
    if (Number.isFinite(forced) && forced > 0) return forced;
    return portalUserId || null;
}

// Новый лид → звонок. Возвращает true или причину, по которой не считаем.
async function raiseCall(userId, leadId, w = null) {
    const html = await bitrixGetHtml(userId, leadPagePath(leadId));
    const lead = normalizeLead(parseLeadModel(html));
    const view = lead.view;

    // Источник «Звонок» ставит телефония — по нему новый лид и опознаётся как
    // входящий. Пустой источник тоже берём: правило компании требует его
    // сменить, значит пустым он бывает только у нетронутого лида. Всё
    // остальное (сайт, повторная продажа, руками заведённый) звонком не
    // является, и всплывать на него — врать оператору.
    if (view.sourceId && !isCallSource(view.sourceId)) return `источник ${view.sourceId}`;

    const only = watchAssignee(w?.portalUserId);
    if (only && view.assignedById && view.assignedById !== only) {
        return `ответственный ${view.assignedById}, а наш ${only}`;
    }

    // В догоне только смотрим, есть ли номер: ни в ленту, ни в звонки старые
    // лиды не идут.
    if (w && !w.caughtUp) return 'догон';

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
