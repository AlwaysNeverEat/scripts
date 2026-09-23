// ─────────────────────────────────────────────────────────────────────────────
// Уведомления об исходе операций раздела «Записи».
//
// Операция уходит в очередь на сервере (backend/src/records/journalQueue.js),
// окно закрывается сразу, и человек занимается следующим звонком. Узнать, что
// запись встала или НЕ встала, ему остаётся только отсюда — поэтому в
// уведомлении всё, чтобы действовать, не открывая доску: кто клиент и его
// телефон, какая станция, на какое время и кто записывал. Без телефона
// «не записалось» бесполезно: перезванивать-то надо клиенту, а окно уже
// закрыто.
//
// Чистые функции без DOM — их проверяет opNotices.test.js.
// ─────────────────────────────────────────────────────────────────────────────

// Одна правка записи — это до трёх операций с общей меткой `group` (снять
// хвост, перенести, дописать), а для человека это одно действие. Поэтому и
// уведомление одно на группу, и приходит оно, когда исполнилась вся группа.
export const unitKey = (op) => (op.group ? `g:${op.group}` : `op:${op.id}`);

function groupUnits(ops) {
    const units = new Map();
    for (const op of ops || []) {
        const k = unitKey(op);
        if (!units.has(k)) units.set(k, []);
        units.get(k).push(op);
    }
    return units;
}

const settled = (unit) => unit.every(o => o.status !== 'pending');

// Какие действия ДОРАБОТАЛИ между двумя опросами: в прошлом списке у них было
// что-то невыполненное, в новом — всё исполнено. Действие, которого в прошлом
// списке не было вовсе, уведомления не даёт: это чужая вкладка или
// перезагрузка страницы, и рассказывать о старом как о новом нельзя.
export function settledSince(prevOps, nextOps) {
    const before = groupUnits(prevOps);
    const out = [];
    for (const [k, unit] of groupUnits(nextOps)) {
        const was = before.get(k);
        if (!was || settled(was)) continue;
        if (settled(unit)) out.push(unit);
    }
    return out;
}

const TITLES = {
    create: ['Записано', 'Не записалось'],
    edit: ['Сохранено', 'Не сохранилось'],
    move: ['Перенесено', 'Не перенеслось'],
    delete: ['Удалено', 'Не удалилось'],
};

// Что писать в уведомлении. Подпись (`note`) раздел кладёт к операции в момент
// нажатия — после исполнения окна уже нет, и взять эти данные больше неоткуда.
export function noticeOf(unit) {
    const failed = unit.find(o => o.status === 'failed');
    const ok = !failed;
    const note = unit.find(o => o.note)?.note || {};
    const kind = TITLES[note.kind] ? note.kind : (unit[0]?.type === 'create' ? 'create' : unit[0]?.type === 'delete' ? 'delete' : 'edit');
    const title = TITLES[kind][ok ? 0 : 1];

    const who = [note.name, note.phone].filter(Boolean).join(' · ');
    const when = [note.date, note.time && (note.duration ? `${note.time}, ${note.duration}` : note.time)]
        .filter(Boolean).join(' ');
    // Ответственный — тот, чьей учёткой CRM ушла запись: CRM назвала его
    // сама в ответе на создание. Нет её ответа — тот, кто нажал на сайте.
    const author = unit.map(o => o.result?.author).find(Boolean) || unit[0]?.author || '';

    const lines = [who, note.station, when].filter(Boolean);
    if (author) lines.push(`ответственный: ${author}`);
    return {
        key: unitKey(unit[0]),
        ok,
        title,
        lines,
        reason: failed ? (failed.lastError || 'CRM не приняла') : '',
    };
}
