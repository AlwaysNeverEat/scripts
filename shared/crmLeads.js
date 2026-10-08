// ─────────────────────────────────────────────────────────────────────────────
// Вкладка «Лиды»: лента звонков и карточка лида из НОВОЙ CRM (re/api.php).
//
// В самой CRM звонок оператору показывается всплывашкой в углу — и не больше
// ТРЁХ сразу (в её коде `render(list.slice(0,3))`): четвёртый входящий просто
// не виден, а прошедший исчезает вместе со звонком. Карточка открывается по
// клику на всплывашку и закрывается с ней же. Отсюда вкладка: лента ВСЕХ
// звонков с историей, и из любого — карточка лида, которую можно заполнить и
// через полчаса после разговора.
//
// Ручки взяты из кода самой CRM (страница, сохранённая оператором), а не из
// документации — её нет:
//
//   section=incoming_active              живые звонки (то, что CRM показывает
//                                         всплывашками);
//   section=incoming_list                журнал входящих колл-центра;
//   section=client_by_phone&phone=       клиент по номеру ({ client: { id } });
//   section=clientcard&id=               карточка: клиент, статистика, план
//                                         звонка, звонки, расчёты, заметки,
//                                         обращения, покупки, источники;
//   section=calc_services                прайс для расчёта.
//
// Что в карточке менять — тоже как в CRM: имя, источник, статус и дата
// следующего звонка, комментарий к звонку, заметки, расчёты, новая карточка
// по номеру (см. routes/crmLeads.js).
//
// Разбор терпим к отсутствию любого поля, как и crmClientsNew.js: живьём эти
// ответы не снимались (только код, который их рисует), и пустое должно
// оставаться пустым, а не превращаться в ноль.
// ─────────────────────────────────────────────────────────────────────────────

const str = (v) => (v == null ? '' : String(v).trim());

function num(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

const arr = (v) => (Array.isArray(v) ? v : []);

// Статусы клиента — ровно список из карточки CRM, в её порядке: значение
// уезжает в CRM строкой, и своё слово тут CRM не узнала бы.
export const LEAD_STATUSES = ['Активный', 'Недозвон', 'Перезвонить', 'Приедет сам', 'Отказался', 'Записан', 'Архив', 'У конкурента'];

// Быстрые кнопки даты следующего звонка — те же, что в CRM.
export const NEXT_CALL_QUICK = [['+1 день', 1], ['+1 нед', 7], ['+1 мес', 30], ['+3 мес', 90], ['+4 мес', 120]];

// Номер одиннадцатью цифрами с семёркой — так его пишет и шлёт сама CRM
// («79312047101»). Восьмёрку в начале меняем, короче десяти цифр — не номер.
export function phone11(raw) {
    let d = str(raw).replace(/\D/g, '');
    if (d.length === 10) d = `7${d}`;
    if (d.length === 11 && d[0] === '8') d = `7${d.slice(1)}`;
    return d.length === 11 ? d : '';
}

// ── Лента звонков ────────────────────────────────────────────────────────────

const LIVE = new Set(['ringing', 'answered']);
export const isLive = (call) => LIVE.has(call.status);

// Живой звонок, который «звонит» со вчерашнего вечера, — это не звонок, а
// событие, конец которого CRM не получила от телефонии (в журнале такие висят
// «ringing» сутками). Считать их живыми значит держать их над всей лентой и в
// счётчике «Сейчас». Поэтому у живого есть срок: звонит дольше пяти минут или
// «разговаривает» дольше полутора часов — «без исхода».
const RING_MAX_MS = 5 * 60 * 1000;
const TALK_MAX_MS = 90 * 60 * 1000;

// Время CRM — московское без пояса, а callTime читает его как UTC; «сейчас»
// приводим к тому же счёту. В Москве нет перехода на летнее время.
export const mskWall = (now = Date.now()) => now + 3 * 3600 * 1000;

export function settleStale(call, now = Date.now()) {
    if (!call || !isLive(call)) return call;
    const t = callTime(call);
    if (!t) return call;
    const age = mskWall(now) - t;
    if ((call.status === 'ringing' && age > RING_MAX_MS) || age > TALK_MAX_MS) call.status = 'stale';
    return call;
}

// Код оператора — внутренний номер телефонии («101», «03»). Сравниваем
// цифрами и без ведущих нулей: «03» и «3» в разных местах CRM — один человек.
export const operatorKey = (v) => String(v ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
export const isMine = (call, code) => {
    const k = operatorKey(code);
    return Boolean(k) && operatorKey(call?.operator) === k;
};

// Порядок ленты: свои (по коду оператора, который человек указал у себя) —
// первыми, внутри каждой части живые сверху, дальше свежие.
export function sortFeed(calls, { mine = '' } = {}) {
    return calls.sort((a, b) => (isMine(b, mine) - isMine(a, mine))
        || (isLive(b) - isLive(a))
        || (callTime(b) - callTime(a)));
}

// Одна строка ленты из любого из двух источников. Живые звонки и журнал CRM
// рисует РАЗНЫМ кодом, и имена полей у них разные (`client.name` против
// `name`, `operator`/`ext`/`to` против `line`) — сводим к одному виду здесь,
// чтобы лента не знала, откуда приехала строка.
export function normalizeCall(r) {
    if (!r || typeof r !== 'object') return null;
    const c = r.client && typeof r.client === 'object' ? r.client : {};
    const phone = phone11(r.phone);
    const at = str(r.created || r.started || r.at || r.time || r.date);
    const dir = str(r.direction || r.dir || 'in') === 'out' ? 'out' : 'in';
    const rec = str(r.recording || r.rec);
    return {
        id: str(r.id ?? r.call_id) || `${phone}|${at}`,
        at,
        phone,
        rawPhone: str(r.phone),
        name: str(c.name || c.fio || r.name || r.client_name),
        clientId: str(c.id || r.client_id) || '',
        line: str(r.line),
        operator: str(r.operator || r.ext || r.to),
        status: str(r.status) || 'completed',
        dir,
        robot: str(r.robot_summary),
        transferred: Boolean(r.transferred),
        // `mango:…` — запись есть, но лежит у телефонии, ссылки на неё нет.
        recording: rec && !rec.startsWith('mango:') ? rec : '',
        hasRecording: Boolean(rec),
        client: c.id || c.name || c.visits != null ? {
            car: str(c.car),
            visits: num(c.visits),
            lastVisit: str(c.last_visit),
            lastStation: str(c.last_station),
            bonus: num(c.bonus),
        } : null,
    };
}

// Время CRM — «2026-10-08 09:07:31»; сравниваем числом, а не строкой, и без
// часового пояса: всё в одной Москве.
export function callTime(call) {
    const m = str(call?.at).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : 0;
}

// Одна и та же беседа приезжает дважды — живой строкой и строкой журнала. Где
// id есть у обоих, склеиваем по нему; где нет — по номеру и минуте.
const minuteKey = (c) => `${c.phone}|${c.at.slice(0, 16)}`;

// Лента: журнал CRM + живые звонки + то, что мы видели сами раньше
// (`remembered`: живой звонок, которого журнал не отдаёт — например, если у
// учётки нет права на журнал, — не должен пропадать из ленты, едва
// закончился). Свежее состояние побеждает: живая строка поверх журнальной.
// Исходящие в ленте не нужны — лид заводят по входящему.
export function mergeFeed({ list = [], active = [], remembered = [], now = Date.now() } = {}) {
    const byId = new Map();
    const byMinute = new Map();
    const put = (call, { fresh }) => {
        if (!call || call.dir === 'out' || !call.phone) return;
        const prev = byId.get(call.id) || byMinute.get(minuteKey(call));
        if (prev && !fresh) {
            // Помнится, но уже есть — дописываем только то, чего не хватало.
            for (const k of ['name', 'clientId', 'robot', 'recording', 'line', 'operator']) if (!prev[k] && call[k]) prev[k] = call[k];
            return;
        }
        const merged = prev ? { ...prev, ...Object.fromEntries(Object.entries(call).filter(([, v]) => v !== '' && v != null)) } : { ...call };
        if (prev) { byId.delete(prev.id); byMinute.delete(minuteKey(prev)); }
        byId.set(merged.id, merged);
        byMinute.set(minuteKey(merged), merged);
    };
    for (const c of remembered) put(c, { fresh: false });
    for (const c of list) put(normalizeCall(c), { fresh: true });
    for (const c of active) put(normalizeCall(c), { fresh: true });
    const calls = [...byId.values()];
    // Сколько раз звонил этот номер — по всей ленте: «третий звонок за утро»
    // оператору важнее, чем имя.
    const perPhone = new Map();
    for (const c of calls) perPhone.set(c.phone, (perPhone.get(c.phone) || 0) + 1);
    for (const c of calls) { c.callsFromPhone = perPhone.get(c.phone); settleStale(c, now); }
    return sortFeed(calls);
}

// Живой звонок, которого больше нет среди живых, закончился. Журнал скажет,
// чем именно; пока не сказал — «завершён», а не вечное «звонит».
export function settleGone(remembered, activeIds) {
    for (const c of remembered) if (isLive(c) && !activeIds.has(c.id)) c.status = 'completed';
    return remembered;
}

// ── Карточка лида ────────────────────────────────────────────────────────────

export function parseLeadCard(D) {
    const c = D?.client || {};
    const st = D?.stats || {};
    const mx = D?.metrics || {};
    const cp = D?.callplan || {};
    return {
        client: {
            id: str(c.id),
            fio: str(c.fio || c.name),
            phone: str(c.phone),
            bonus: num(c.bonus),
            oilChanges: num(c.oil_changes),
            car: str(c.car),
            sourceId: str(c.knew_from),
        },
        stats: {
            visits: num(st.visits) ?? 0,
            ltv: num(st.ltv),
            avg: num(st.avg),
            daysSince: num(mx.days_since),
            freqDays: num(mx.freq_days),
        },
        plan: { status: str(cp.status), nextCall: str(cp.next_call).slice(0, 10) },
        lastCall: str(D?.last_call),
        calls: arr(D?.calls).map(x => ({
            id: str(x.id),
            at: str(x.at),
            dir: x.dir === 'in' ? 'in' : 'out',
            status: str(x.status),
            dur: num(x.dur),
            summary: str(x.summary),
            rec: str(x.rec),
            comment: str(x.comment),
        })),
        calcs: arr(D?.calcs).map(x => ({
            id: str(x.id),
            at: str(x.at),
            author: str(x.author),
            total: num(x.total),
            car: str(x.car),
            items: arr(x.items).map(it => ({ name: str(it.name), price: num(it.price) ?? 0, qty: num(it.qty) || 1 })),
        })),
        notes: arr(D?.notes).map(n => ({ id: str(n.id), at: str(n.at), author: str(n.author), text: str(n.text) })),
        history: arr(D?.history).map(x => ({
            id: str(x.id),
            date: str(x.date),
            station: str(x.station),
            vehicle: str(x.vehicle),
            mileage: num(x.mileage),
            items: num(x.items) ?? 0,
            sum: num(x.sum),
        })),
        sources: arr(D?.sources).map(s => ({ id: str(s.id), name: str(s.name) })).filter(s => s.id && s.name),
        omni: arr(D?.omni).map(o => ({
            id: str(o.id),
            channel: str(o.channel),
            peer: str(o.peer),
            closed: o.status === 'closed',
            lastText: str(o.last_text),
            thread: arr(o.thread).map(m => ({ out: m.dir === 'out', body: str(m.body), at: str(m.at) })),
        })),
    };
}

// Прайс для расчёта: «Замена масла и фильтра — 1 900 ₽».
export function parseServices(json) {
    return arr(json?.rows)
        .map(x => ({ name: str(x.name), price: num(x.price) ?? 0 }))
        .filter(x => x.name);
}

// ── Что уезжает в CRM ────────────────────────────────────────────────────────

// Строки расчёта: CRM принимает их JSON-строкой как есть, поэтому чистим
// здесь — имя ограничено, цена неотрицательна, количество целое. Пустые
// строки (ни имени, ни цены) выбрасываются, как и в CRM.
export function cleanCalcItems(items) {
    return arr(items).slice(0, 30).map(it => ({
        name: str(it?.name).slice(0, 160),
        price: Math.max(0, Math.round((num(it?.price) || 0) * 100) / 100),
        qty: Math.min(99, Math.max(1, Math.trunc(num(it?.qty) || 1))),
    })).filter(it => it.name || it.price);
}

export const calcTotal = (items) => cleanCalcItems(items).reduce((t, it) => t + it.price * it.qty, 0);

// Ответ CRM на действие: { ok: true, … } — принято. Всё остальное — отказ с
// её словами, а без слов — общим «не приняла».
export function actionRefusal(json) {
    if (json && json.ok) return null;
    const why = str(json?.message) || str(json?.error);
    return why === 'empty' ? 'пустое значение' : (why || 'CRM не приняла');
}
