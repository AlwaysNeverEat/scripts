// ─────────────────────────────────────────────────────────────────────────────
// Применение одной операции очереди к оригинальной админке — всё или ничего.
//
// Длинная («продлённая») запись в оригинале — это N отдельных получасовых
// записей, а транзакций у него нет: перенос червячка = N POST'ов подряд.
// Если посреди этого оригинал ляжет, упадёт наш процесс или слот успеет занять
// кто-то другой, половина записи осталась бы на новом месте, половина на
// старом. Поэтому ход операции пишется в record_ops.progress:
//
//   { phase: 'apply' | 'rollback', reason, rollbackAttempts,
//     origins: { [recordId]: { addressId, date, time } },  — откуда уехала
//     moved:   [recordId, …],                              — что уже уехало
//     created: [{ addressId, date, time, name, before }],  — что уже создано
//     deleted: [recordId, …] }
//
// Логическая невозможность (окно заняли, запись исчезла, оригинал не принял
// перенос) — это OpConflict: уже применённая часть возвращается на место, а
// операция становится failed с причиной, по которой в очереди предлагается
// выбрать другое время. Сетевые ошибки к откату не ведут: операция остаётся
// pending и продолжится с того же места (повторный POST с теми же адресом,
// датой и временем идемпотентен), иначе «оригинал полежал 10 минут» отменял бы
// нормальные переносы. Откат включается, только когда кончились попытки —
// этим управляет вызывающая сторона (sync.js).
//
// Весь ввод-вывод — через io, чтобы логику можно было гонять тестами без сети
// и базы:
//   io.board(date)        → parseRecordBoard дня (бросает при сетевой ошибке)
//   io.editForm(id)       → parseEditForm записи | null, если её больше нет
//   io.update(fields)     → POST /admin/record/update (id: '' — создание)
//   io.remove(deleteUrl)  → удаление записи по ссылке с доски
//   io.saveProgress(p)    → сохранить прогресс операции
//   io.beginRollback(p, reason) → перевести операцию в откат, вернуть прогресс
//   io.days()             → ['DD.MM.YYYY', …] дни, где искать записи без from
// ─────────────────────────────────────────────────────────────────────────────

import { buildExtensionOps, findSlotConflict, findBoardRecord, timeToMin } from '../../../shared/crmRecords.js';

export class OpConflict extends Error {}

export function hasAppliedWork(progress = {}) {
    return Boolean(progress.moved?.length || progress.created?.length || progress.deleted?.length);
}

// → { ok: true } — применено целиком;
//   { ok: false, reason } — не вышло, и за операцией ничего не осталось.
// Бросает ошибку io (сеть/оригинал лежит) — операция остаётся pending.
export async function applyOp(op, io) {
    const progress = op.progress || {};
    if (progress.phase === 'rollback') return rollbackOp(progress, io);
    try {
        if (op.type === 'create') return await applyCreate(op.payload, progress, io);
        if (op.type === 'update') return await applyUpdate(op.payload, progress, io);
        if (op.type === 'delete') return await applyDelete(op.payload, progress, io);
        return { ok: false, reason: `неизвестный тип операции: ${op.type}` };
    } catch (err) {
        if (!(err instanceof OpConflict)) throw err;
        // Ничего не успели применить — просто не получилось.
        if (!hasAppliedWork(progress)) return { ok: false, reason: `${err.message} — ничего не изменено` };
        // Часть слотов уже уехала — возвращаем всё назад.
        return rollbackOp(await io.beginRollback(progress, err.message), io);
    }
}

// Создание записи (в т.ч. длинной: первый слот — клиент, остальные —
// продолжения с телефоном-заглушкой).
async function applyCreate(payload, progress, io) {
    const slots = buildExtensionOps(payload, Number(payload.durationMinutes) || 30);
    const created = progress.created || (progress.created = []);
    const done = new Set(created.map(c => c.time));

    // Перед созданием сверяемся со СВЕЖЕЙ доской: пока операция лежала в
    // очереди, слот могли занять.
    const board = await io.board(payload.date);
    const cellAt = (time) => board.cells?.[String(payload.addressId)]?.[time];
    for (const slot of slots) {
        if (done.has(slot.time)) continue;
        const cell = cellAt(slot.time);
        if (!cell || cell.free < 1) throw new OpConflict(`слот ${slot.time} уже занят или закрыт`);
    }
    for (const slot of slots) {
        if (done.has(slot.time)) continue;
        // Кто стоял в слоте ДО нас — чтобы при откате удалить только своё.
        const before = (cellAt(slot.time)?.records || []).map(r => String(r.id));
        await io.update({ id: '', ...slot });
        created.push({ addressId: String(slot.addressId), date: slot.date, time: slot.time, name: slot.name, before });
        await io.saveProgress(progress);
    }
    return { ok: true };
}

// Перенос записи. Правка полей (имя, телефон) переносом не является — слоты не
// двигаются, откатывать нечего.
async function applyUpdate(payload, progress, io) {
    const records = payload.records || [];
    const groups = groupTargets(records);
    if (!groups.length) return applyFieldEdits(records, io);

    await ensureOrigins(records, progress, io);

    // Целевые слоты проверяем по СВЕЖЕЙ доске: пока операция ждала своей
    // очереди, окно мог занять кто угодно — в том числе оригинальная админка.
    // Свои же слоты (запись двигают внутри того же дня) занятыми не считаем.
    const ownIds = records.map(r => String(r.id));
    for (const g of groups) {
        const conflict = findSlotConflict(await io.board(g.date), g.addressId, g.times, ownIds);
        if (conflict) {
            throw new OpConflict(conflict.reason === 'closed'
                ? `слот ${conflict.time} на ${g.date} закрыт`
                : `слот ${conflict.time} на ${g.date} уже занят`);
        }
    }

    const moved = progress.moved || (progress.moved = []);
    for (const r of applyOrder(records)) {
        if (moved.some(id => String(id) === String(r.id))) continue; // уехала на прошлой попытке
        // Читаем текущую форму, чтобы перенос не затёр невидимые на доске поля
        // (госномер, комментарий).
        const current = await io.editForm(r.id);
        if (!current) throw new OpConflict(`запись ${r.id} не найдена в оригинале (уже удалена?)`);
        await io.update({
            id: r.id,
            addressId: r.addressId ?? current.addressId,
            date: r.date ?? current.date,
            time: r.time ?? current.time,
            name: r.name ?? current.name ?? '',
            phone: r.phone ?? current.phone ?? '',
            carNumber: r.carNumber ?? current.carNumber ?? '',
            comment: r.comment ?? current.comment ?? '',
        });
        moved.push(String(r.id));
        await io.saveProgress(progress);
    }

    // Оригинал умеет молча не сохранить запись (отдав 200 и свою страницу) —
    // сверяемся с доской: не доехал хвост, значит переносим всё назад.
    for (const g of groups) {
        const board = await io.board(g.date);
        for (const r of g.records) {
            const at = findBoardRecord(board, r.id);
            if (!at || at.time !== r.time || at.addressId !== g.addressId) {
                throw new OpConflict(`оригинал не принял перенос слота ${r.time}`);
            }
        }
    }
    return { ok: true };
}

// Правка полей без переноса — слоты остаются на месте.
async function applyFieldEdits(records, io) {
    for (const r of records) {
        const current = await io.editForm(r.id);
        if (!current) return { ok: false, reason: `запись ${r.id} не найдена в оригинале (уже удалена?)` };
        await io.update({
            id: r.id,
            addressId: current.addressId,
            date: current.date,
            time: current.time,
            name: r.name ?? current.name ?? '',
            phone: r.phone ?? current.phone ?? '',
            carNumber: r.carNumber ?? current.carNumber ?? '',
            comment: r.comment ?? current.comment ?? '',
        });
    }
    return { ok: true };
}

// Удаление — единственная операция без отката (воскресить запись нельзя),
// поэтому прогресс нужен лишь чтобы ретрай не ходил по уже удалённым.
async function applyDelete(payload, progress, io) {
    const deleted = progress.deleted || (progress.deleted = []);
    for (const r of payload.records) {
        if (deleted.some(id => String(id) === String(r.id))) continue;
        await io.remove(r.deleteUrl);
        deleted.push(String(r.id));
        await io.saveProgress(progress);
    }
    return { ok: true };
}

// Порядок применения переноса. Сдвиг червячка внутри той же станции и дня
// («на полчаса позже») нужно начинать с хвоста: иначе на полпути голова заедет
// в слот собственного продолжения, и оригинал может такой POST не принять.
// Сдвиг назад и переезд на другую станцию/день такой проблемы не имеют.
function applyOrder(records) {
    const first = records[0];
    const from = first?.from;
    const inPlace = from && first.date === from.date && String(first.addressId) === String(from.addressId);
    return inPlace && timeToMin(first.time) > timeToMin(from.time) ? [...records].reverse() : records;
}

// Целевые слоты переноса, сгруппированные по (станция, день). Записи без
// полного адреса назначения — это правка полей, а не перенос.
export function groupTargets(records) {
    const groups = new Map();
    for (const r of records) {
        if (r.addressId == null || !r.date || !r.time) continue;
        const key = `${r.addressId}|${r.date}`;
        if (!groups.has(key)) groups.set(key, { addressId: String(r.addressId), date: r.date, times: [], records: [] });
        const g = groups.get(key);
        g.times.push(r.time);
        g.records.push(r);
    }
    return [...groups.values()];
}

// Откуда записи уехали: без этого возврат невозможен. Фронт присылает from (он
// видит доску), для операций без него ищем записи на досках ближайших дней.
async function ensureOrigins(records, progress, io) {
    if (progress.origins) return;
    const origins = {};
    const unknown = [];
    for (const r of records) {
        const from = r.from;
        if (from?.addressId != null && from.date && from.time) {
            origins[String(r.id)] = { addressId: String(from.addressId), date: from.date, time: from.time };
        } else {
            unknown.push(String(r.id));
        }
    }
    for (const date of io.days()) {
        if (!unknown.length) break;
        const board = await io.board(date);
        for (const id of [...unknown]) {
            const at = findBoardRecord(board, id);
            if (!at) continue;
            origins[id] = { addressId: at.addressId, date, time: at.time };
            unknown.splice(unknown.indexOf(id), 1);
        }
    }
    progress.origins = origins;
    await io.saveProgress(progress);
}

// Возврат уже применённой части операции. Бросает ошибку io — тогда операция
// остаётся pending и откат продолжится со следующего тика (что успели вернуть,
// уже вычеркнуто из progress).
async function rollbackOp(progress, io) {
    const lost = [];

    // Перенесённые записи — назад, на прежние места.
    for (const id of [...(progress.moved || [])].reverse()) {
        const origin = progress.origins?.[String(id)];
        if (!origin) {
            lost.push(`запись ${id}`);
        } else {
            const current = await io.editForm(id);
            // Запись исчезла из оригинала, пока мы возились — возвращать нечего.
            if (current) {
                await io.update({
                    id,
                    addressId: origin.addressId,
                    date: origin.date,
                    time: origin.time,
                    name: current.name ?? '',
                    phone: current.phone ?? '',
                    carNumber: current.carNumber ?? '',
                    comment: current.comment ?? '',
                });
            }
        }
        progress.moved = progress.moved.filter(x => String(x) !== String(id));
        await io.saveProgress(progress);
    }

    // Созданные слоты — удаляем. Только своё: на слоте могли стоять записи и до
    // нас (у станции несколько боксов), их id записаны в before.
    if (progress.created?.length) {
        const board = await io.board(progress.created[0].date);
        for (const slot of [...progress.created].reverse()) {
            const before = new Set((slot.before || []).map(String));
            const mine = (board.cells?.[String(slot.addressId)]?.[slot.time]?.records || [])
                .find(r => !before.has(String(r.id)) && r.name === slot.name && r.deleteUrl);
            if (mine) await io.remove(mine.deleteUrl);
            else lost.push(`слот ${slot.time}`);
            progress.created = progress.created.filter(c => c.time !== slot.time);
            await io.saveProgress(progress);
        }
    }

    const tail = lost.length
        ? ` (не удалось вернуть: ${lost.join(', ')} — проверьте оригинал)`
        : ' — записи вернулись на прежнее место, выберите другое время';
    return { ok: false, reason: `${progress.reason}${tail}` };
}
