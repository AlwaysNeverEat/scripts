import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    parseRecordBoard, detectChains, assignLanes, buildExtensionOps,
    contiguousFreeSlots, flattenAddressRecords, buildCopyLine,
    isRecordBoard, looksLikeLoginPage, parseEditForm,
    timeToMin, minToTime, addMinutes, normPhoneDigits,
    EXTENSION_STUB_PHONE,
} from './crmRecords.js';
import { findStationMeta } from './stationsMeta.js';

const FIXTURE = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'admin-record-page.html'),
    'utf8',
);

// ── Время ────────────────────────────────────────────────────────────────────

test('время: конвертации туда-обратно', () => {
    assert.equal(timeToMin('09:00'), 540);
    assert.equal(minToTime(540), '09:00');
    assert.equal(addMinutes('09:30', 30), '10:00');
    assert.equal(addMinutes('20:30', 30), '21:00');
});

test('normPhoneDigits: скобки, пробелы, 8 → 7', () => {
    assert.equal(normPhoneDigits('+7 (900) 659-67-61'), '79006596761');
    assert.equal(normPhoneDigits('8 (900) 659-67-61'), '79006596761');
    assert.equal(normPhoneDigits('+71111111111'), '71111111111');
});

// ── Распознавание страниц ────────────────────────────────────────────────────

test('фикстура — доска записей, не логин', () => {
    assert.equal(isRecordBoard(FIXTURE), true);
    assert.equal(looksLikeLoginPage(FIXTURE), false);
});

test('страница с формой пароля без таблицы — логин', () => {
    const login = '<form action="/admin/auth"><input name="l"><input type="password" name="p"></form>';
    assert.equal(looksLikeLoginPage(login), true);
    assert.equal(isRecordBoard(login), false);
});

// ── Разбор реальной страницы ─────────────────────────────────────────────────

const board = parseRecordBoard(FIXTURE);

test('parseRecordBoard: дата и сетка времени из самой страницы', () => {
    assert.equal(board.date, '25.07.2026');
    assert.equal(board.timeSlots[0], '09:00');
    assert.equal(board.timeSlots[board.timeSlots.length - 1], '22:30');
    assert.equal(board.timeSlots.length, (22 - 9 + 1) * 2);
});

test('parseRecordBoard: все 24 колонки-адреса по порядку', () => {
    assert.equal(board.addresses.length, 24);
    assert.equal(board.addresses[0].id, '179');
    assert.equal(board.addresses[0].title, 'Уральская 7');
    const veteranov = board.addresses.find(a => a.id === '192');
    assert.ok(veteranov, 'есть новая станция Ветеранов 167к8');
    assert.match(veteranov.title, /Ветеранов 167/);
});

test('parseRecordBoard: каждая станция из выгрузки находится в справочнике', () => {
    for (const a of board.addresses) {
        const meta = findStationMeta(a.title);
        assert.ok(meta, `нет меты для «${a.title}»`);
    }
    assert.equal(findStationMeta('СПБ, Ветеранов 167 к.8 СПОТ').short, 'Ветеранов 167к8');
    assert.equal(findStationMeta('СПб, Выборгское шоссе 2').boxNo, '##09');
    assert.equal(findStationMeta('Выборгское ш. 212к8').boxNo, '##19');
});

test('parseRecordBoard: конкретная запись 09:00 разобрана полностью', () => {
    const cell = board.cells['2']['09:00'];
    assert.equal(cell.records.length, 1);
    const rec = cell.records[0];
    assert.equal(rec.id, '489159');
    assert.equal(rec.timeStart, '09:00');
    assert.equal(rec.timeEnd, '09:30');
    assert.equal(rec.name, 'Лышко Максим Алексеевич');
    assert.equal(rec.phoneDigits, '79006596761');
    assert.equal(rec.status, 'checked');
    assert.match(rec.deleteUrl, /record\/delete\?id=489159&time=25\.07\.2026\+09%3A00&address_id=2/);
});

test('parseRecordBoard: мультибокс — две записи в одной ячейке Оптиков 2', () => {
    const cell = board.cells['3']['09:00'];
    assert.equal(cell.records.length, 2);
    const ids = cell.records.map(r => r.id).sort();
    assert.deepEqual(ids, ['488788', '488971']);
});

test('parseRecordBoard: статусы too-late считываются', () => {
    const all = board.addresses.flatMap(a => flattenAddressRecords(board.cells, a.id));
    assert.ok(all.length > 100, `записей в дне должно быть много, а не ${all.length}`);
    assert.ok(all.some(r => r.status === 'late'), 'есть хотя бы один «не приехал»');
    assert.ok(all.some(r => r.status === 'checked'), 'есть хотя бы один «приехал»');
});

test('parseRecordBoard: свободные слоты «Добавить» посчитаны по боксам', () => {
    const cell = board.cells['179']['16:30'];
    assert.ok(cell && cell.free >= 2, 'у Уральской 7 в 16:30 два свободных бокса');
});

test('parseRecordBoard: закрытый слот отсутствует в cells', () => {
    // адрес 179 (Уральская 7) в 09:00 — пустая ячейка в фикстуре
    assert.equal(board.cells['179']?.['09:00'], undefined);
});

// ── Цепочки («червячки») ─────────────────────────────────────────────────────

function rec(id, timeStart, name, phone, addressId = '1') {
    const phoneDigits = normPhoneDigits(phone);
    return {
        id, addressId, timeStart, timeEnd: addMinutes(timeStart, 30),
        name, phone, phoneDigits, isStub: phoneDigits === normPhoneDigits(EXTENSION_STUB_PHONE),
        status: '', customer: `${name} / ${phone}`, deleteUrl: `/admin/record/delete?id=${id}`,
    };
}

test('detectChains: продление со слотами-заглушками собирается в один червячок', () => {
    const chains = detectChains([
        rec('1', '10:00', 'Иван', '+7 (921) 111-22-33'),
        rec('2', '10:30', 'Иван', EXTENSION_STUB_PHONE),
        rec('3', '11:00', 'Иван', EXTENSION_STUB_PHONE),
        rec('4', '12:00', 'Пётр', '+7 (921) 999-88-77'),
    ]);
    assert.equal(chains.length, 2);
    assert.equal(chains[0].parts.length, 3);
    assert.equal(chains[0].timeStart, '10:00');
    assert.equal(chains[0].timeEnd, '11:30');
    assert.equal(chains[1].parts.length, 1);
});

test('detectChains: разрыв во времени рвёт цепочку', () => {
    const chains = detectChains([
        rec('1', '10:00', 'Иван', '+7 (921) 111-22-33'),
        rec('2', '11:00', 'Иван', EXTENSION_STUB_PHONE),
    ]);
    assert.equal(chains.length, 2);
});

test('detectChains: чужое имя встык — не цепочка', () => {
    const chains = detectChains([
        rec('1', '10:00', 'Иван', '+7 (921) 111-22-33'),
        rec('2', '10:30', 'Пётр', EXTENSION_STUB_PHONE),
    ]);
    assert.equal(chains.length, 2);
});

test('detectChains: одинаковое имя и тот же реальный номер встык — цепочка', () => {
    const chains = detectChains([
        rec('1', '10:00', 'Иван', '+7 (921) 111-22-33'),
        rec('2', '10:30', 'Иван', '+7 (921) 111-22-33'),
    ]);
    assert.equal(chains.length, 1);
    assert.equal(chains[0].parts.length, 2);
});

test('detectChains: одинаковое имя, но другой реальный номер — два клиента', () => {
    const chains = detectChains([
        rec('1', '10:00', 'Иван', '+7 (921) 111-22-33'),
        rec('2', '10:30', 'Иван', '+7 (921) 444-55-66'),
    ]);
    assert.equal(chains.length, 2);
});

// ── Дорожки ──────────────────────────────────────────────────────────────────

test('assignLanes: пересекающиеся цепочки — на разных дорожках', () => {
    const a = { head: rec('1', '10:00', 'A', '+79210000001'), parts: [], timeStart: '10:00', timeEnd: '11:00' };
    const b = { head: rec('2', '10:30', 'B', '+79210000002'), parts: [], timeStart: '10:30', timeEnd: '11:30' };
    const { lanes, byHeadId } = assignLanes([a, b], 2);
    assert.equal(lanes, 2);
    assert.notEqual(byHeadId['1'], byHeadId['2']);
});

test('assignLanes: непересекающиеся — на одной, но дорожек не меньше boxes', () => {
    const a = { head: rec('1', '10:00', 'A', '+79210000001'), parts: [], timeStart: '10:00', timeEnd: '10:30' };
    const b = { head: rec('2', '10:30', 'B', '+79210000002'), parts: [], timeStart: '10:30', timeEnd: '11:00' };
    const { lanes, byHeadId } = assignLanes([a, b], 2);
    assert.equal(lanes, 2);
    assert.equal(byHeadId['1'], byHeadId['2']);
});

test('assignLanes: переполнение боксов добавляет дорожку, а не роняет раскладку', () => {
    const mk = (id, s, e) => ({ head: rec(id, s, 'X' + id, '+7921000000' + id), parts: [], timeStart: s, timeEnd: e });
    const { lanes } = assignLanes([mk('1', '10:00', '11:00'), mk('2', '10:00', '11:00'), mk('3', '10:00', '11:00')], 2);
    assert.equal(lanes, 3);
});

// ── Продление / длинные записи ───────────────────────────────────────────────

test('buildExtensionOps: запись на 1.5 часа = 1 настоящая + 2 заглушки', () => {
    const ops = buildExtensionOps(
        { addressId: '3', date: '25.07.2026', time: '10:00', name: 'Иван', phone: '+79211112233', carNumber: 'А123БВ', comment: 'ДВС' },
        90,
    );
    assert.equal(ops.length, 3);
    assert.deepEqual(ops.map(o => o.time), ['10:00', '10:30', '11:00']);
    assert.equal(ops[0].phone, '+79211112233');
    assert.equal(ops[0].comment, 'ДВС');
    assert.equal(ops[1].phone, EXTENSION_STUB_PHONE);
    assert.equal(ops[1].comment, '');
    assert.equal(ops[2].phone, EXTENSION_STUB_PHONE);
});

test('contiguousFreeSlots: обрывается на занятом и на конце дня', () => {
    const slots = ['09:00', '09:30', '10:00', '10:30'];
    const free = new Set(['09:30', '10:00']);
    assert.deepEqual(contiguousFreeSlots('09:30', slots, t => free.has(t)), ['09:30', '10:00']);
    assert.deepEqual(contiguousFreeSlots('09:00', slots, t => free.has(t)), []);
});

// ── Форма редактирования ─────────────────────────────────────────────────────

test('parseEditForm: значения инпутов, селектов и textarea', () => {
    const html = `
      <form class="edit-record-form" action="/admin/record/update" method="post">
        <input type="hidden" name="id" value="488788">
        <select name="address_id">
          <option value="2">Фучика 14к4</option>
          <option value="3" selected>СПб, Оптиков 2</option>
        </select>
        <select name="date"><option selected value="25.07.2026">25.07.2026</option></select>
        <select name="time"></select>
        <input type="text" name="name" value="Сергей двс">
        <input type="text" name="phone" value="+7(921) 756-18-03">
        <input type="text" name="car_number" value="А123БВ178">
        <textarea name="comment">замена масла &amp; фильтра</textarea>
        <input type="hidden" name="back" value="/admin/record">
        <button type="submit">Сохранить</button>
      </form>`;
    const form = parseEditForm(html);
    assert.equal(form.id, '488788');
    assert.equal(form.addressId, '3');
    assert.equal(form.date, '25.07.2026');
    assert.equal(form.time, ''); // селект time грузится AJAX'ом — пустой это норма
    assert.equal(form.name, 'Сергей двс');
    assert.equal(form.carNumber, 'А123БВ178');
    assert.equal(form.comment, 'замена масла & фильтра');
    assert.equal(parseEditForm('<html>нет формы</html>'), null);
});

test('buildCopyLine: формат оригинального скрипта', () => {
    assert.equal(
        buildCopyLine('25.07.2026', '14:30', 'СПб, Оптиков 2'),
        '25.07.2026 14:30 СПб, Оптиков 2 (Сергей)',
    );
});
