import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    creditSkipReason, creditDetails, creditOp, findCreditRecord,
    resolveCreditRecordIds, loadBoardAuthors, loadDayRecords,
} from './credits.js';
import { EXTENSION_STUB_PHONE } from '../../../shared/crmRecords.js';

// Живого Postgres в node --test нет — подменяем db, как в activity.test.js:
// проверяем, с чем ходят в базу и во что превращают ответ.
function fakeDb(rows = []) {
    const calls = [];
    const db = async (text, params) => { calls.push({ text, params }); return { rows }; };
    return { db, calls };
}

const createOp = (over = {}) => ({
    id: 7,
    type: 'create',
    userId: 'u-1',
    payload: {
        addressId: 3, date: '05.09.2026', time: '14:00', durationMinutes: 60,
        name: 'Иван', phone: '+7 (921) 123-45-67', carNumber: 'А123БВ178',
    },
    progress: { stationTitle: 'Охтинская 9/1', continuation: false },
    ...over,
});

// ── Что зачитывается ─────────────────────────────────────────────────────────

test('creditSkipReason: настоящая запись зачитывается', () => {
    assert.equal(creditSkipReason(createOp()), null);
});

test('creditSkipReason: перенос, гость, продолжение, мастер и мусорный номер — нет', () => {
    assert.equal(creditSkipReason(createOp({ type: 'update' })), 'not_create');
    assert.equal(creditSkipReason(createOp({ userId: null })), 'guest');
    // Заглушка «Продлить» и слот встык к своей же записи — это одна запись.
    assert.equal(creditSkipReason(createOp({ payload: { ...createOp().payload, phone: EXTENSION_STUB_PHONE } })), 'continuation');
    assert.equal(creditSkipReason(createOp(), { continuation: true }), 'continuation');
    // Переключатель в окне создания: телефон у такой записи клиентский, и
    // отличить её больше нечем.
    assert.equal(creditSkipReason(createOp({ payload: { ...createOp().payload, byMaster: true } })), 'by_master');
    // Одна и та же цифра — запись ради счётчика, а не ради клиента.
    assert.equal(creditSkipReason(createOp({ payload: { ...createOp().payload, phone: '+7 999 999-99-99' } })), 'junk_phone');
    // А вот запись без телефона — обычная (клиент подошёл на станцию).
    assert.equal(creditSkipReason(createOp({ payload: { ...createOp().payload, phone: '' } })), null);
    assert.equal(creditSkipReason(createOp({ payload: { ...createOp().payload, byMaster: false } })), null);
});

test('creditDetails: подробности берутся из payload и progress, телефон — цифрами', () => {
    assert.deepEqual(creditDetails(createOp()), {
        stationId: '3',
        stationTitle: 'Охтинская 9/1',
        recordDate: '2026-09-05',
        recordTime: '14:00',
        durationMin: 60,
        clientName: 'Иван',
        phone: '79211234567',
        carNumber: 'А123БВ178',
    });
    // Без progress (старые операции в очереди) название станции просто пустое.
    assert.equal(creditDetails(createOp({ progress: {} })).stationTitle, '');
    assert.equal(creditDetails(createOp({ payload: { addressId: 3, date: '05.09.2026', time: '09:00' } })).durationMin, 30);
});

test('creditOp: пишет строку с подробностями и не пишет то, что не зачитывается', async () => {
    const { db, calls } = fakeDb();
    assert.equal(await creditOp(createOp(), {}, { db }), true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].text, /INSERT INTO record_credits/);
    assert.match(calls[0].text, /ON CONFLICT \(op_id\) DO NOTHING/);
    assert.deepEqual(calls[0].params,
        [7, 'u-1', '3', 'Охтинская 9/1', '2026-09-05', '14:00', 60, 'Иван', '79211234567', 'А123БВ178', true, '']);

    assert.equal(await creditOp(createOp({ userId: null }), {}, { db }), false);
    assert.equal(await creditOp(createOp(), { continuation: true }, { db }), false);
    assert.equal(calls.length, 1, 'гость и продолжение в базу не ходят');
});

test('creditOp: запись мастера всё равно пишется — но без очка', async () => {
    // Строка нужна ради автора: без неё запись на доске выглядела бы сделанной
    // мимо сайта, а это ровно та непрозрачность, ради которой всё затевалось.
    const { db, calls } = fakeDb();
    const op = createOp({ payload: { ...createOp().payload, byMaster: true } });
    assert.equal(await creditOp(op, {}, { db }), true);
    assert.deepEqual(calls[0].params.slice(-2), [false, 'by_master']);

    // Номер именно не заглушечный: +7 111 111-11-11 — это телефон продолжения,
    // и такая запись отсеивается раньше, как continuation.
    await creditOp(createOp({ payload: { ...createOp().payload, phone: '+7 999 999-99-99' } }), {}, { db });
    assert.deepEqual(calls[1].params.slice(-2), [false, 'junk_phone']);
});

// ── Поиск записи на доске ────────────────────────────────────────────────────

const rec = (id, over = {}) => ({
    id: String(id), addressId: '3', timeStart: '14:00', timeEnd: '14:30',
    name: 'Иван', phone: '+7 (921) 123-45-67', phoneDigits: '79211234567', isStub: false, ...over,
});
const boardWith = (...records) => ({ cells: { 3: { '14:00': { records, free: 0 } } } });
const credit = { stationId: '3', recordTime: '14:00', phone: '79211234567', clientName: 'Иван' };

test('findCreditRecord: по станции, времени и телефону', () => {
    const board = boardWith(rec(101, { name: 'Пётр', phoneDigits: '79000000001' }), rec(102));
    assert.equal(findCreditRecord(board, credit)?.id, '102');
});

test('findCreditRecord: без телефона — по имени, и только среди записей без номера', () => {
    const board = boardWith(rec(103, { phone: '', phoneDigits: '' }), rec(104, { name: 'Иван' }));
    assert.equal(findCreditRecord(board, { ...credit, phone: '' })?.id, '103');
});

test('findCreditRecord: две одинаковые записи в ячейке — не угадываем', () => {
    // Подписать чужую запись хуже, чем оставить свою без подписи.
    assert.equal(findCreditRecord(boardWith(rec(105), rec(106)), credit), null);
    // …но если имя различает — берём по имени.
    assert.equal(findCreditRecord(boardWith(rec(107, { name: 'Пётр' }), rec(108)), credit)?.id, '108');
});

test('findCreditRecord: закрытый слот, чужая станция и заглушки — ничего', () => {
    assert.equal(findCreditRecord(boardWith(rec(109, { isStub: true })), credit), null);
    assert.equal(findCreditRecord(boardWith(rec(110)), { ...credit, stationId: '4' }), null);
    assert.equal(findCreditRecord({ cells: {} }, credit), null);
    assert.equal(findCreditRecord(null, credit), null);
});

test('resolveCreditRecordIds: найденным дописывается record_id, остальные ждут', async () => {
    const { db, calls } = fakeDb([
        { id: 1, station_id: '3', record_time: '14:00', phone: '79211234567', client_name: 'Иван' },
        { id: 2, station_id: '3', record_time: '15:00', phone: '79211234567', client_name: 'Иван' },
    ]);
    const n = await resolveCreditRecordIds('2026-09-05', boardWith(rec(102)), { db });
    assert.equal(n, 1);
    assert.deepEqual(calls[0].params, ['2026-09-05']);
    assert.match(calls[1].text, /UPDATE record_credits SET record_id/);
    assert.deepEqual(calls[1].params, [1, '102']);
    assert.equal(calls.length, 2);
});

test('resolveCreditRecordIds: без доски или даты в базу не ходит', async () => {
    const { db, calls } = fakeDb();
    assert.equal(await resolveCreditRecordIds(null, boardWith(), { db }), 0);
    assert.equal(await resolveCreditRecordIds('2026-09-05', null, { db }), 0);
    assert.equal(calls.length, 0);
});

// ── Авторство на доске ───────────────────────────────────────────────────────

test('loadBoardAuthors: по record_id напрямую, без него — по месту на доске', async () => {
    const user = { id: 'u-1', display_name: 'Оля', avatar: null };
    const { db, calls } = fakeDb([
        { record_id: '555', station_id: '3', record_time: '09:00', phone: '', client_name: '', counted: true, skip_reason: '', ...user },
        { record_id: null, station_id: '3', record_time: '14:00', phone: '79211234567', client_name: 'Иван', counted: true, skip_reason: '', ...user },
        { record_id: null, station_id: '3', record_time: '16:00', phone: '79211234567', client_name: 'Иван', counted: true, skip_reason: '', ...user },
    ]);
    const authors = await loadBoardAuthors('05.09.2026', boardWith(rec(102)), { db });
    assert.deepEqual(calls[0].params, ['2026-09-05']);
    const shown = { ...user, counted: true, skipLabel: '' };
    assert.deepEqual(authors, { 555: shown, 102: shown });
});

test('loadBoardAuthors: у записи мастера автор тот же, но помечен «не в счёт»', async () => {
    const user = { id: 'u-1', display_name: 'Оля', avatar: null };
    const { db } = fakeDb([
        { record_id: '555', station_id: '3', record_time: '09:00', phone: '', client_name: '',
          counted: false, skip_reason: 'by_master', ...user },
    ]);
    const authors = await loadBoardAuthors('05.09.2026', boardWith(), { db });
    assert.deepEqual(authors[555], { ...user, counted: false, skipLabel: 'запись мастера' });
});

test('loadBoardAuthors: кривая дата — пусто и без запроса', async () => {
    const { db, calls } = fakeDb();
    assert.deepEqual(await loadBoardAuthors('2026-09-05', boardWith(), { db }), {});
    assert.equal(calls.length, 0);
});

// ── Записи за день ───────────────────────────────────────────────────────────

test('loadDayRecords: подробные строки — в список, старые — в legacy', async () => {
    const { db, calls } = fakeDb([
        { id: 1, made_at: '10:05', record_id: null, station_id: null, station_title: null, record_date: null,
          record_time: null, duration_min: null, client_name: null, phone: null, car_number: null,
          counted: true, skip_reason: '' },
        { id: 2, made_at: '12:41', record_id: '102', station_id: '3', station_title: 'Охтинская 9/1',
          record_date: '2026-09-05', record_time: '14:00', duration_min: 60, client_name: 'Иван',
          phone: '79211234567', car_number: 'А123БВ178', counted: true, skip_reason: '' },
    ]);
    const day = await loadDayRecords('u-1', '2026-09-05', { db });
    assert.deepEqual(calls[0].params, ['u-1', '2026-09-05']);
    assert.deepEqual(day, {
        date: '2026-09-05',
        count: 2,
        skipped: 0,
        legacy: 1,
        records: [{
            madeAt: '12:41', recordId: '102', stationId: '3', stationTitle: 'Охтинская 9/1',
            // Справочник знает станцию под своим именем — «Охтинская 9/1, Мурино».
            stationShort: 'Охтинская 9/1, Мурино', recordDate: '2026-09-05', recordTime: '14:00', durationMin: 60,
            clientName: 'Иван', phone: '79211234567', carNumber: 'А123БВ178',
            counted: true, skipLabel: '',
        }],
    });
});

test('loadDayRecords: запись мастера видна в списке, но в очки дня не идёт', async () => {
    // Число очков обязано совпадать с подсказкой над квадратом ленты, иначе
    // окно спорит с сеткой, по которой в него зашли.
    const { db } = fakeDb([
        { id: 1, made_at: '12:41', record_id: '102', station_id: '3', station_title: 'Охтинская 9/1',
          record_date: '2026-09-05', record_time: '14:00', duration_min: 60, client_name: 'Иван',
          phone: '79211234567', car_number: '', counted: true, skip_reason: '' },
        { id: 2, made_at: '13:10', record_id: '103', station_id: '3', station_title: 'Охтинская 9/1',
          record_date: '2026-09-05', record_time: '15:00', duration_min: 30, client_name: 'Пётр',
          phone: '79219998877', car_number: '', counted: false, skip_reason: 'by_master' },
    ]);
    const day = await loadDayRecords('u-1', '2026-09-05', { db });
    assert.equal(day.count, 1);
    assert.equal(day.skipped, 1);
    assert.equal(day.records.length, 2);
    assert.deepEqual(day.records.map(r => [r.counted, r.skipLabel]),
        [[true, ''], [false, 'запись мастера']]);
});

test('loadDayRecords: длинный адрес станции сокращается по справочнику', async () => {
    // В базе лежит адрес из оригинала, а в окне нужно название, по которому
    // станцию узнают: «деревня Новосаратовка … 267А» карточку не подписывает.
    const { db } = fakeDb([
        { id: 1, made_at: '12:41', record_id: '102', station_id: '3',
          station_title: 'Выборгское ш. 212 к8', record_date: '2026-09-05', record_time: '14:00',
          duration_min: 30, client_name: 'Иван', phone: '', car_number: '', counted: true, skip_reason: '' },
    ]);
    const day = await loadDayRecords('u-1', '2026-09-05', { db });
    assert.equal(day.records[0].stationShort, 'Выб. шоссе 212к8');
    assert.equal(day.records[0].stationTitle, 'Выборгское ш. 212 к8');
});

test('loadDayRecords: день без записей — нули, а не ошибка', async () => {
    const { db } = fakeDb([]);
    assert.deepEqual(await loadDayRecords('u-1', '2026-09-05', { db }),
        { date: '2026-09-05', count: 0, skipped: 0, legacy: 0, records: [] });
});
