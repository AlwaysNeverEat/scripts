import test from 'node:test';
import assert from 'node:assert/strict';

import { dayRecordsHtml } from './activityFeed.js';

// Окно дня — единственное место, где топ показывает, ЗА ЧТО даны очки, поэтому
// три его состояния проверяются отдельно: список, «до обновления» целиком и
// смешанный день. DOM для этого не нужен: функция чистая.

const rec = (over = {}) => ({
    madeAt: '12:41', recordId: '102', stationId: '3', stationTitle: 'Охтинская 9/1',
    recordDate: '2026-09-05', recordTime: '14:00', durationMin: 60,
    clientName: 'Иван', phone: '79211234567', carNumber: 'А123БВ178', ...over,
});

test('день без записей — так и сказано', () => {
    assert.match(dayRecordsHtml({ count: 0, legacy: 0, records: [] }), /записей не было/);
    assert.match(dayRecordsHtml(null), /записей не было/);
});

test('запись показывается целиком: кто, телефон, госномер, станция, время и длина', () => {
    const html = dayRecordsHtml({ count: 1, legacy: 0, records: [rec()] });
    assert.match(html, /12:41/);
    assert.match(html, /<b>Иван<\/b>/);
    assert.match(html, /\+7 \(921\) 123-45-67/);
    assert.match(html, /А123БВ178/);
    assert.match(html, /Охтинская 9\/1/);
    assert.match(html, /5 сентября, 14:00–15:00 \(1 ч\)/);
    assert.doesNotMatch(html, /до обновления/);
});

test('пустые поля не оставляют «·» и дырок', () => {
    const html = dayRecordsHtml({ count: 1, legacy: 0, records: [rec({ phone: '', carNumber: '', durationMin: 30 })] });
    assert.match(html, /<b>Иван<\/b><\/div>/);
    assert.match(html, /14:00–14:30 \(30 мин\)/);
});

test('очки со старых времён — честная подпись «до обновления», а не пустота', () => {
    const one = dayRecordsHtml({ count: 1, legacy: 1, records: [] });
    assert.match(one, /эта запись была сделана/);
    assert.match(one, /до обновления/);
    const many = dayRecordsHtml({ count: 3, legacy: 3, records: [] });
    assert.match(many, /эти 3 записи были сделаны/);
});

test('смешанный день: новые в списке, про старые — сколько их', () => {
    const html = dayRecordsHtml({ count: 3, legacy: 2, records: [rec()] });
    assert.match(html, /<b>Иван<\/b>/);
    assert.match(html, /Ещё 2 записи за этот день\s+сделаны до обновления/);
});

test('пользовательский текст экранируется', () => {
    const html = dayRecordsHtml({ count: 1, legacy: 0, records: [rec({ clientName: '<b>x</b>' })] });
    assert.doesNotMatch(html, /<b>x<\/b>/);
    assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
});
