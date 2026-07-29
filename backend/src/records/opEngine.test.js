// Перенос длинной записи — сценарии, ради которых движок и написан: окно
// заняли, пока операция ждала в очереди; оригинал упал посреди хвостов; запись
// исчезла; оригинал молча не принял перенос. Ни в одном из них половина записи
// не должна остаться на новом месте.

import test from 'node:test';
import assert from 'node:assert/strict';

import { applyOp, hasAppliedWork } from './opEngine.js';
import { addMinutes, normPhoneDigits, EXTENSION_STUB_PHONE } from '../../../shared/crmRecords.js';

const TODAY = '25.07.2026';
const TOMORROW = '26.07.2026';
const SLOTS = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'];

// Мини-оригинал: записи в памяти, доска считается по ним, update/remove их
// меняют — как настоящая админка (поэтому и сверка «доехало ли» работает).
function makeZms({ boxes = { 3: 1, 4: 1 }, records = [], closed = [] } = {}) {
    const zms = {
        records: records.map(r => ({ ...r, id: String(r.id), addressId: String(r.addressId) })),
        nextId: 900,
        calls: [],
        failUpdate: null, // (fields, n) → бросить, чтобы сымитировать падение
    };
    const isClosed = (addressId, time) => closed.some(c => String(c.addressId) === String(addressId) && c.time === time);

    zms.board = (date) => {
        const cells = {};
        for (const [aid, count] of Object.entries(boxes)) {
            cells[aid] = {};
            for (const time of SLOTS) {
                if (!isClosed(aid, time)) cells[aid][time] = { records: [], free: count };
            }
        }
        for (const r of zms.records) {
            if (r.date !== date) continue;
            const cell = cells[r.addressId]?.[r.time];
            if (!cell) continue;
            // Поля — как у parseRecordBoard: по ним движок узнаёт червячки
            // (продление слотом встык к записи того же клиента).
            const phoneDigits = normPhoneDigits(r.phone);
            cell.records.push({
                id: r.id, addressId: r.addressId, name: r.name,
                timeStart: r.time, timeEnd: addMinutes(r.time, 30),
                phone: r.phone || '', phoneDigits, isStub: phoneDigits === normPhoneDigits(EXTENSION_STUB_PHONE),
                deleteUrl: `/admin/record/delete?id=${r.id}`,
            });
            cell.free = Math.max(0, cell.free - 1);
        }
        return {
            date,
            timeSlots: SLOTS,
            addresses: Object.keys(boxes).map(id => ({ id, title: `станция ${id}` })),
            cells,
        };
    };

    let updates = 0;
    zms.io = {
        board: async (date) => { zms.calls.push(`board:${date}`); return zms.board(date); },
        editForm: async (id) => {
            const r = zms.records.find(x => x.id === String(id));
            return r
                ? { addressId: r.addressId, date: r.date, time: r.time, name: r.name, phone: r.phone || '', carNumber: r.car || '', comment: r.comment || '' }
                : null;
        },
        update: async (fields) => {
            updates += 1;
            if (zms.failUpdate) zms.failUpdate(fields, updates);
            zms.calls.push(`update:${fields.id || 'new'}→${fields.date} ${fields.time}@${fields.addressId}`);
            if (!fields.id) {
                zms.records.push({
                    id: String(++zms.nextId), addressId: String(fields.addressId), date: fields.date,
                    time: fields.time, name: fields.name, phone: fields.phone,
                });
                return;
            }
            const r = zms.records.find(x => x.id === String(fields.id));
            Object.assign(r, {
                addressId: String(fields.addressId), date: fields.date, time: fields.time,
                name: fields.name, phone: fields.phone, car: fields.carNumber, comment: fields.comment,
            });
        },
        remove: async (url) => {
            zms.calls.push(`remove:${url}`);
            const id = String(url).match(/id=(\d+)/)[1];
            zms.records = zms.records.filter(x => x.id !== id);
        },
        saveProgress: async () => {},
        // Как в sync.js: откат живёт в новой записи прогресса (её движок и
        // мутирует дальше), а не в объекте фазы применения.
        beginRollback: async (progress, reason) => {
            zms.rollback = { ...progress, phase: 'rollback', reason, rollbackAttempts: 0 };
            return zms.rollback;
        },
        days: () => [TODAY, TOMORROW],
    };
    zms.at = (id) => {
        const r = zms.records.find(x => x.id === String(id));
        return r ? `${r.date} ${r.time}@${r.addressId}` : null;
    };
    return zms;
}

// Червячок 09:00–10:30 на станции 3 (три получасовых записи).
function chainOf(date = TODAY) {
    return [
        { id: 11, addressId: 3, date, time: '09:00', name: 'Иван', phone: '+79210000000' },
        { id: 12, addressId: 3, date, time: '09:30', name: 'Иван', phone: '+71111111111' },
        { id: 13, addressId: 3, date, time: '10:00', name: 'Иван', phone: '+71111111111' },
    ];
}

// Операция переноса всей цепочки на станцию 4, начиная с start.
function moveOp(start, { addressId = 4, date = TODAY, from = TODAY } = {}) {
    const times = ['09:00', '09:30', '10:00'];
    const at = (i) => SLOTS[SLOTS.indexOf(start) + i];
    return {
        id: 1,
        type: 'update',
        payload: {
            records: [11, 12, 13].map((id, i) => ({
                id: String(id), addressId: String(addressId), date, time: at(i),
                from: { addressId: '3', date: from, time: times[i] },
            })),
        },
        progress: {},
    };
}

test('перенос длинной записи: все три слота уезжают целиком', async () => {
    const zms = makeZms({ records: chainOf() });
    const op = moveOp('10:30');
    const res = await applyOp(op, zms.io);

    assert.deepEqual(res, { ok: true });
    assert.equal(zms.at(11), `${TODAY} 10:30@4`);
    assert.equal(zms.at(12), `${TODAY} 11:00@4`);
    assert.equal(zms.at(13), `${TODAY} 11:30@4`);
});

test('окно заняли, пока операция ждала в очереди — не переносим ничего', async () => {
    const zms = makeZms({
        records: [...chainOf(), { id: 77, addressId: 4, date: TODAY, time: '11:00', name: 'Чужой' }],
    });
    const op = moveOp('10:30');
    const res = await applyOp(op, zms.io);

    assert.equal(res.ok, false);
    assert.match(res.reason, /слот 11:00 .* уже занят/);
    assert.match(res.reason, /ничего не изменено/);
    assert.equal(zms.calls.filter(c => c.startsWith('update:')).length, 0);
    // цепочка осталась там же, где была
    assert.equal(zms.at(11), `${TODAY} 09:00@3`);
    assert.equal(zms.at(13), `${TODAY} 10:00@3`);
});

test('хвост упирается в закрытый слот — перенос отменяется целиком', async () => {
    const zms = makeZms({ records: chainOf(), closed: [{ addressId: 4, time: '11:30' }] });
    const res = await applyOp(moveOp('10:30'), zms.io);

    assert.equal(res.ok, false);
    assert.match(res.reason, /слот 11:30 .* закрыт/);
    assert.equal(zms.at(13), `${TODAY} 10:00@3`);
});

test('сдвиг внутри своей же станции: собственные слоты не считаются занятыми', async () => {
    const zms = makeZms({ records: chainOf() });
    // 09:00–10:30 → 09:30–11:00, два слота из трёх заняты самой же записью
    const op = moveOp('09:30', { addressId: 3 });
    const res = await applyOp(op, zms.io);

    assert.deepEqual(res, { ok: true });
    assert.equal(zms.at(11), `${TODAY} 09:30@3`);
    assert.equal(zms.at(13), `${TODAY} 10:30@3`);
    // хвостом вперёд: голова не заезжает в слот собственного продолжения
    assert.deepEqual(zms.calls.filter(c => c.startsWith('update:')), [
        `update:13→${TODAY} 10:30@3`,
        `update:12→${TODAY} 10:00@3`,
        `update:11→${TODAY} 09:30@3`,
    ]);
});

test('оригинал упал посреди хвостов: операция остаётся pending и дописывает остаток', async () => {
    const zms = makeZms({ records: chainOf() });
    const op = moveOp('10:30');
    zms.failUpdate = (_f, n) => { if (n === 2) throw new Error('админка недоступна'); };

    await assert.rejects(() => applyOp(op, zms.io), /админка недоступна/);
    // первый слот уехал, прогресс это помнит — половина работы не потеряна
    assert.deepEqual(op.progress.moved, ['11']);
    assert.ok(hasAppliedWork(op.progress));
    assert.equal(zms.at(11), `${TODAY} 10:30@4`);
    assert.equal(zms.at(12), `${TODAY} 09:30@3`);

    // оригинал ожил — следующий тик доводит перенос до конца, не трогая первый
    zms.failUpdate = null;
    zms.calls.length = 0;
    const res = await applyOp(op, zms.io);
    assert.deepEqual(res, { ok: true });
    assert.equal(zms.calls.filter(c => c.startsWith('update:11')).length, 0);
    assert.equal(zms.at(12), `${TODAY} 11:00@4`);
    assert.equal(zms.at(13), `${TODAY} 11:30@4`);
});

test('запись хвоста исчезла посреди переноса: уехавшее возвращается на место', async () => {
    const zms = makeZms({ records: chainOf() });
    const op = moveOp('10:30');
    // 13-й слот удалили из оригинала, пока операция ждала своей очереди
    zms.records = zms.records.filter(r => r.id !== '13');

    const res = await applyOp(op, zms.io);

    assert.equal(res.ok, false);
    assert.match(res.reason, /запись 13 не найдена/);
    assert.match(res.reason, /вернулись на прежнее место/);
    // ни одного слота на новом месте не осталось
    assert.equal(zms.at(11), `${TODAY} 09:00@3`);
    assert.equal(zms.at(12), `${TODAY} 09:30@3`);
    assert.deepEqual(zms.rollback.moved, []);
});

test('оригинал молча не сохранил хвост — перенос откатывается целиком', async () => {
    const zms = makeZms({ records: chainOf() });
    const op = moveOp('10:30');
    // update по третьему слоту «проходит», но запись не двигается
    const realUpdate = zms.io.update;
    zms.io.update = async (fields) => {
        if (String(fields.id) === '13' && fields.time === '11:30') return; // проглочено
        return realUpdate(fields);
    };

    const res = await applyOp(op, zms.io);

    assert.equal(res.ok, false);
    assert.match(res.reason, /оригинал не принял перенос слота 11:30/);
    assert.equal(zms.at(11), `${TODAY} 09:00@3`);
    assert.equal(zms.at(12), `${TODAY} 09:30@3`);
    assert.equal(zms.at(13), `${TODAY} 10:00@3`);
});

test('откат после исчерпанных попыток: продолжается с того места, где встал', async () => {
    const zms = makeZms({ records: chainOf() });
    const op = moveOp('10:30');
    await applyOp(op, zms.io); // перенос удался…

    // …но операцию всё равно отменяют (кончились попытки/отмена вручную)
    const rollback = { ...op.progress, phase: 'rollback', reason: 'не удалось применить целиком', rollbackAttempts: 0 };
    let failed = false;
    zms.failUpdate = (_f, n) => { if (n === 5 && !failed) { failed = true; throw new Error('админка недоступна'); } };

    await assert.rejects(() => applyOp({ ...op, progress: rollback }, zms.io), /админка недоступна/);
    // один слот вернулся, остальные ещё числятся уехавшими
    assert.equal(zms.at(13), `${TODAY} 10:00@3`);
    assert.deepEqual(rollback.moved, ['11', '12']);

    const res = await applyOp({ ...op, progress: rollback }, zms.io);
    assert.equal(res.ok, false);
    assert.match(res.reason, /вернулись на прежнее место, выберите другое время/);
    assert.equal(zms.at(11), `${TODAY} 09:00@3`);
    assert.equal(zms.at(12), `${TODAY} 09:30@3`);
});

test('перенос на завтра: проверяется доска дня назначения', async () => {
    const zms = makeZms({
        records: [...chainOf(), { id: 78, addressId: 4, date: TOMORROW, time: '09:30', name: 'Чужой' }],
    });
    const res = await applyOp(moveOp('09:00', { date: TOMORROW }), zms.io);
    assert.equal(res.ok, false);
    assert.match(res.reason, new RegExp(`слот 09:30 на ${TOMORROW.replace(/\./g, '\\.')} уже занят`));

    const ok = await applyOp(moveOp('10:00', { date: TOMORROW }), makeZms({ records: chainOf() }).io);
    assert.deepEqual(ok, { ok: true });
});

test('правка имени переносом не считается — слоты не двигаются', async () => {
    const zms = makeZms({ records: chainOf() });
    const op = { id: 2, type: 'update', payload: { records: [{ id: '11', name: 'Пётр' }] }, progress: {} };
    const res = await applyOp(op, zms.io);

    assert.deepEqual(res, { ok: true });
    assert.equal(zms.at(11), `${TODAY} 09:00@3`);
    assert.equal(zms.records.find(r => r.id === '11').name, 'Пётр');
});

// ── Создание длинной записи ──────────────────────────────────────────────────

test('создание длинной записи: слот заняли на середине — созданное удаляется', async () => {
    const zms = makeZms({ records: [] });
    const op = {
        id: 3,
        type: 'create',
        payload: { addressId: '3', date: TODAY, time: '09:00', name: 'Иван', phone: '+79210000000', durationMinutes: 90 },
        progress: {},
    };
    // первые два слота создаются, на третьем оригинал отвечает ошибкой сети
    zms.failUpdate = (_f, n) => { if (n === 3) throw new Error('админка недоступна'); };
    await assert.rejects(() => applyOp(op, zms.io), /админка недоступна/);
    assert.equal(zms.records.length, 2);

    // попытки кончились — откатываем: обе созданные записи удаляются
    const rollback = { ...op.progress, phase: 'rollback', reason: 'не удалось применить целиком', rollbackAttempts: 0 };
    const res = await applyOp({ ...op, progress: rollback }, zms.io);
    assert.equal(res.ok, false);
    assert.equal(zms.records.length, 0);
});

// continuation — это ответ топу: продлённая запись даёт одно очко, а не по
// очку за каждый доставленный слот (см. creditRecordOp в sync.js).

test('создание длинной записи: новый клиент — не продление', async () => {
    const zms = makeZms({ records: [] });
    const op = {
        id: 30,
        type: 'create',
        payload: { addressId: '3', date: TODAY, time: '09:00', name: 'Иван', phone: '+79210000000', durationMinutes: 90 },
        progress: {},
    };
    const res = await applyOp(op, zms.io);
    assert.deepEqual(res, { ok: true, continuation: false });
    assert.equal(zms.records.length, 3);
});

test('ручное продление: слот встык с тем же номером клиента — продление', async () => {
    // Червячок 09:00–10:30 уже стоит; оператор дописывает ещё полчаса руками,
    // с настоящим номером клиента, а не через «Продлить».
    const zms = makeZms({ records: chainOf() });
    const op = {
        id: 31,
        type: 'create',
        payload: { addressId: '3', date: TODAY, time: '10:30', name: 'Иван', phone: '+79210000000', durationMinutes: 30 },
        progress: {},
    };
    assert.deepEqual(await applyOp(op, zms.io), { ok: true, continuation: true });
});

test('ручное продление: решение принимается один раз, ретрай его не переворачивает', async () => {
    const zms = makeZms({ records: chainOf() });
    const op = {
        id: 32,
        type: 'create',
        payload: { addressId: '3', date: TODAY, time: '10:30', name: 'Иван', phone: '+79210000000', durationMinutes: 60 },
        progress: {},
    };
    zms.failUpdate = (_f, n) => { if (n === 2) throw new Error('админка недоступна'); };
    await assert.rejects(() => applyOp(op, zms.io), /админка недоступна/);

    // На второй попытке наш первый слот уже на доске — цепочка кончается на нём,
    // и «продолжает ли запись чужую» ответ был бы другим. Берём сохранённый.
    zms.failUpdate = null;
    assert.deepEqual(await applyOp(op, zms.io), { ok: true, continuation: true });
});

test('тёзка встык со своим номером — новая запись, а не продление', async () => {
    const zms = makeZms({ records: chainOf() });
    const op = {
        id: 33,
        type: 'create',
        payload: { addressId: '3', date: TODAY, time: '10:30', name: 'Иван', phone: '+79219998877', durationMinutes: 30 },
        progress: {},
    };
    assert.deepEqual(await applyOp(op, zms.io), { ok: true, continuation: false });
});

test('откат создания не трогает чужие записи в тех же слотах', async () => {
    const zms = makeZms({
        boxes: { 3: 2 }, // двухбоксовая станция: рядом стоит чужая запись
        records: [{ id: 55, addressId: 3, date: TODAY, time: '09:00', name: 'Чужой' }],
    });
    const op = {
        id: 4,
        type: 'create',
        payload: { addressId: '3', date: TODAY, time: '09:00', name: 'Иван', durationMinutes: 60 },
        progress: {},
    };
    zms.failUpdate = (_f, n) => { if (n === 2) throw new Error('админка недоступна'); };
    await assert.rejects(() => applyOp(op, zms.io), /админка недоступна/);

    const rollback = { ...op.progress, phase: 'rollback', reason: 'не удалось применить целиком', rollbackAttempts: 0 };
    await applyOp({ ...op, progress: rollback }, zms.io);
    assert.deepEqual(zms.records.map(r => r.id), ['55']);
});

// ── Удаление ─────────────────────────────────────────────────────────────────

test('удаление: ретрай не ходит по уже удалённым слотам', async () => {
    const zms = makeZms({ records: chainOf() });
    const op = {
        id: 5,
        type: 'delete',
        payload: { records: [11, 12, 13].map(id => ({ id: String(id), deleteUrl: `/admin/record/delete?id=${id}` })) },
        progress: {},
    };
    const realRemove = zms.io.remove;
    let n = 0;
    zms.io.remove = async (url) => { if (++n === 2) throw new Error('админка недоступна'); return realRemove(url); };

    await assert.rejects(() => applyOp(op, zms.io), /админка недоступна/);
    assert.deepEqual(op.progress.deleted, ['11']);

    zms.io.remove = realRemove;
    zms.calls.length = 0;
    const res = await applyOp(op, zms.io);
    assert.deepEqual(res, { ok: true });
    assert.deepEqual(zms.calls.filter(c => c.startsWith('remove:')), [
        'remove:/admin/record/delete?id=12',
        'remove:/admin/record/delete?id=13',
    ]);
    assert.equal(zms.records.length, 0);
});
