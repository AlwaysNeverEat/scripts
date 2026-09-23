// ─────────────────────────────────────────────────────────────────────────────
// Очередь операций раздела «Записи» глазами оператора.
//
// Операция уходит в очередь на сервере (backend/src/records/journalQueue.js),
// окно закрывается сразу, и человек берёт следующий звонок. Узнать, встала ли
// запись, ему остаётся из самой вкладки: из списка «Очередь» и из красной
// плашки в шапке раздела, если что-то НЕ встало. Всплывающих уведомлений тут
// нет сознательно: уведомление гаснет и уезжает, а непрошедшую запись надо
// найти и через час — кто записывал, кого, куда и на какое время.
//
// Поэтому у каждой строки очереди всё, чтобы действовать, не открывая доску:
// клиент и его телефон (перезванивать-то ему), адрес станции, дата и время,
// ответственный и исход с причиной.
//
// Чистые функции без DOM — их проверяет opQueue.test.js.
// ─────────────────────────────────────────────────────────────────────────────

// Одна правка записи — это до трёх операций с общей меткой `group` (снять
// хвост, перенести, дописать), а для человека это одно действие. Поэтому и
// строка в очереди одна на группу.
export const unitKey = (op) => (op.group ? `g:${op.group}` : `op:${op.id}`);

// Действия (группы операций) свежими вперёд — в том порядке, в каком их
// отдаёт сервер.
export function unitsOf(ops) {
    const units = new Map();
    for (const op of ops || []) {
        const k = unitKey(op);
        if (!units.has(k)) units.set(k, []);
        units.get(k).push(op);
    }
    return [...units.values()];
}

const settled = (unit) => unit.every(o => o.status !== 'pending');
export const unitStatus = (unit) => unit.some(o => o.status === 'failed') ? 'failed'
    : settled(unit) ? 'done' : 'pending';
const unitMaxId = (unit) => Math.max(...unit.map(o => Number(o.id) || 0));

// Какие действия ДОРАБОТАЛИ между двумя опросами: в прошлом списке у них было
// что-то невыполненное, в новом — всё исполнено. По ним раздел перечитывает
// доску (встало) или зажигает плашку (не встало).
export function settledSince(prevOps, nextOps) {
    const before = new Map(unitsOf(prevOps).map(u => [unitKey(u[0]), u]));
    return unitsOf(nextOps).filter(unit => {
        const was = before.get(unitKey(unit[0]));
        return was && !settled(was) && settled(unit);
    });
}

// Свои НЕ прошедшие действия, которых человек ещё не видел (не открывал
// очередь и не нажал «Понятно»): они висят плашкой в шапке раздела.
// Отменённое руками — не отказ: его отменили, глядя на него.
export function unseenFailures(ops, seenId) {
    return unitsOf(ops).filter(u => u[0].mine !== false
        && unitStatus(u) === 'failed'
        && unitMaxId(u) > seenId
        && !u.some(o => o.lastError === 'отменена вручную'));
}

const KIND = {
    create: { verb: 'Запись', ok: 'записано', bad: 'не записалось' },
    edit: { verb: 'Правка', ok: 'сохранено', bad: 'не сохранилось' },
    move: { verb: 'Перенос', ok: 'перенесено', bad: 'не перенеслось' },
    delete: { verb: 'Удаление', ok: 'удалено', bad: 'не удалилось' },
};

function kindOf(unit, note) {
    if (KIND[note.kind]) return note.kind;
    if (unit.length === 1 && unit[0].type === 'create') return 'create';
    if (unit.length === 1 && unit[0].type === 'delete') return 'delete';
    return 'edit';
}

const hhmm = (iso) => {
    const d = new Date(iso || '');
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
};

// Что писать в строке очереди и в плашке. Подпись (`note`) раздел кладёт к
// операции в момент нажатия. У операции без подписи (поставлена до этой
// версии) выручает то, что есть в самой операции создания.
export function describeUnit(unit, { stationTitle = () => '' } = {}) {
    const status = unitStatus(unit);
    const failed = unit.find(o => o.status === 'failed');
    const create = unit.find(o => o.type === 'create')?.payload || {};
    const note = unit.find(o => o.note)?.note
        || { name: create.name, phone: create.phone, station: stationTitle(create.addressId), date: create.date, time: create.time };
    const kind = kindOf(unit, note);
    const k = KIND[kind];

    const client = [note.name, note.phone].filter(Boolean).join(' · ');
    const when = [note.date, note.time && (note.duration ? `${note.time}, ${note.duration}` : note.time)]
        .filter(Boolean).join(' ');
    // Ответственный — тот, чьей учёткой CRM ушла запись: CRM назвала его
    // сама в ответе на создание. Нет её ответа — тот, кто нажал на сайте.
    const author = unit.map(o => o.result?.author).find(Boolean) || unit[0]?.author || '';
    const last = unit.map(o => o.appliedAt).filter(Boolean).sort().pop();

    return {
        key: unitKey(unit[0]),
        kind,
        status,
        mine: unit[0]?.mine !== false,
        title: `${k.verb}: ${client || 'без имени'}`,
        client,
        station: note.station || '',
        when,
        author,
        queuedAt: hhmm(unit[0]?.createdAt),
        doneAt: hhmm(last),
        outcome: status === 'pending' ? 'выполняется…' : status === 'done' ? k.ok : k.bad,
        reason: failed ? (failed.lastError || 'CRM не приняла') : '',
    };
}
