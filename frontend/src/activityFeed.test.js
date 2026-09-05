import test from 'node:test';
import assert from 'node:assert/strict';

import { dayRecordsHtml, dayRecordHref } from './activityFeed.js';

// Окно дня — единственное место, где топ показывает, ЗА ЧТО даны очки, поэтому
// его состояния проверяются отдельно: карточки, «до обновления» целиком,
// смешанный день и незачтённая запись. DOM для этого не нужен: функции чистые.

const rec = (over = {}) => ({
    madeAt: '12:41', recordId: '102', stationId: '3', stationTitle: 'Охтинская 9/1',
    stationShort: 'Охтинская 9/1, Мурино',
    recordDate: '2026-09-05', recordTime: '14:00', durationMin: 60,
    clientName: 'Иван', phone: '79211234567', carNumber: 'А123БВ178', counted: true, skipLabel: '', ...over,
});

test('день без записей — так и сказано', () => {
    assert.match(dayRecordsHtml({ count: 0, legacy: 0, records: [] }), /записей не было/);
    assert.match(dayRecordsHtml(null), /записей не было/);
});

test('карточка показывает всё: кто, телефон, госномер, станция, время и длина', () => {
    const html = dayRecordsHtml({ count: 1, legacy: 0, records: [rec()] });
    assert.match(html, /12:41/);
    assert.match(html, /Иван/);
    assert.match(html, /\+7 \(921\) 123-45-67/);
    assert.match(html, /А123БВ178/);
    assert.match(html, /Охтинская 9\/1, Мурино/);
    assert.match(html, /5 сентября, 14:00–15:00/);
    assert.match(html, /1 ч/);
    assert.doesNotMatch(html, /до обновления/);
});

test('карточка — ссылка на саму запись: день, станция, время и номер', () => {
    // По этой ссылке раздел записей встаёт на нужный день и открывает капсулу
    // (focusRecords в records/records.js).
    const href = dayRecordHref(rec());
    assert.match(href, /^#\/records\?/);
    const p = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    assert.equal(p.get('date'), '2026-09-05');
    assert.equal(p.get('station'), '3');
    assert.equal(p.get('time'), '14:00');
    assert.equal(p.get('record'), '102');
    // Номера может ещё не быть (синк доски не дошёл) — время остаётся.
    const noId = new URLSearchParams(dayRecordHref(rec({ recordId: null })).split('?')[1]);
    assert.equal(noId.get('record'), null);
    assert.equal(noId.get('time'), '14:00');
    assert.match(dayRecordsHtml({ count: 1, legacy: 0, records: [rec()] }), /<a class="day-card" href="#\/records\?/);
});

test('пустые поля не оставляют дырок в карточке', () => {
    const html = dayRecordsHtml({ count: 1, legacy: 0, records: [rec({ phone: '', carNumber: '', durationMin: 30 })] });
    assert.match(html, /14:00–14:30/);
    assert.match(html, /30 мин/);
    assert.doesNotMatch(html, /undefined|null/);
});

test('незачтённая запись видна и подписана причиной', () => {
    // Запись мастера: очков не даёт, но в списке остаётся — иначе выходит, что
    // сайт умалчивает о собственной записи.
    const html = dayRecordsHtml({
        count: 0, skipped: 1, legacy: 0,
        records: [rec({ counted: false, skipLabel: 'запись мастера' })],
    });
    assert.match(html, /day-card-skip/);
    assert.match(html, /запись мастера/);
    assert.doesNotMatch(html, /записей не было/);
});

test('очки со старых времён — честная подпись «до обновления», а не пустота', () => {
    const one = dayRecordsHtml({ count: 1, legacy: 1, records: [] });
    assert.match(one, /эта запись была сделана/);
    assert.match(one, /до обновления/);
    const many = dayRecordsHtml({ count: 3, legacy: 3, records: [] });
    assert.match(many, /эти 3 записи были сделаны/);
});

test('смешанный день: новые карточками, про старые — сколько их', () => {
    const html = dayRecordsHtml({ count: 3, legacy: 2, records: [rec()] });
    assert.match(html, /Иван/);
    assert.match(html, /Ещё 2 записи за этот день\s+сделаны до обновления/);
});

test('пользовательский текст экранируется — и в карточке, и в ссылке', () => {
    const html = dayRecordsHtml({ count: 1, legacy: 0, records: [rec({ clientName: '<b>x</b>' })] });
    assert.doesNotMatch(html, /<b>x<\/b>/);
    assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
    // Станция и номер записи попадают в href — кавычка там рвала бы атрибут.
    const evil = dayRecordsHtml({ count: 1, legacy: 0, records: [rec({ stationId: '3"onerror="x' })] });
    assert.doesNotMatch(evil, /href="[^"]*"onerror/);
});
