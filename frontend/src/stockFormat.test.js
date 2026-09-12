import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtPrice, fmtQty, copyLine, parseList, dominantType, MAX_LIST } from './stockFormat.js';

const FILTER = 'NSIN0023136124 Масляный фильтр Mann W 712/95 (5)';
const OIL = '151527 Моторное масло Mobil 5W-30 Super 3000 FE 4l (4x4L)';

test('fmtPrice: до рубля, с разрядкой; нераспознанная цена — прочерк', () => {
    assert.equal(fmtPrice(FILTER, 1367.59), '1 368 ₽');
    assert.equal(fmtPrice(FILTER, 552.48), '552 ₽');
    assert.equal(fmtPrice(FILTER, 0), '—');
    assert.equal(fmtPrice(FILTER, undefined), '—');
});

// В CRM цена масла из бочки — за 0.1 л; показываем за литр, как панель
// наличия на странице машины (crmOilPricePerLiter).
test('fmtPrice: масло из бочки — за литр, с единицей', () => {
    assert.equal(fmtPrice(OIL, 180), '1 800 ₽/л');
    assert.equal(fmtPrice('202665 Трансмиссионное масло ZIC ATF Multi LF (200л)', 140), '1 400 ₽/л');
    assert.equal(fmtPrice(OIL, 0), '—');
});

test('fmtQty: масло — литрами с запятой, остальное — штуками', () => {
    assert.equal(fmtQty('151527 Моторное масло Mobil 5W-30 Super 3000 FE 4l (4x4L)', 200), '20 л');
    assert.equal(fmtQty('202665 Трансмиссионное масло ZIC ATF Multi LF (200л)', 1412), '141,2 л');
    assert.equal(fmtQty('NSIN0023136124 Масляный фильтр Mann W 712/95 (5)', 7), '7 шт');
    assert.equal(fmtQty('NSIN0023136124 Масляный фильтр Mann W 712/95 (5)', 0), '0 шт');
});

// Формат строки — тот же, что у юзерскрипта и у панели наличия на странице
// машины: «вф <имя> - <цена>р», его ждёт вставка в калькулятор.
test('copyLine: тип позиции по названию, иначе тип группы; код CRM и слова типа убраны', () => {
    assert.equal(
        copyLine({ name: 'NSIN0018631072 Масляный фильтр LYNX LC-1004 LYNXauto (2)', priceRaw: 552.48 }, 'вф'),
        'мф LYNX LC-1004 LYNXauto - 552р',
    );
    assert.equal(
        copyLine({ name: 'NSIN0000000001 Mann C 21 014 (3)', priceRaw: 1199.5 }, 'вф'),
        'вф Mann C 21 014 - 1200р',
    );
    assert.equal(copyLine({ name: 'NSIN0000000002 Что-то без типа', priceRaw: 10 }, null), 'Что-то без типа - 10р');
    // масло в строку уходит с ценой за литр и БЕЗ «мф»: «масл» в названии — не масляный фильтр
    assert.equal(copyLine({ name: OIL, priceRaw: 180 }, 'мф'), 'Моторное масло Mobil 5W-30 Super 3000 FE 4l (4x4L) - 1800р');
});

test('parseList: по строке на артикул, без пустых, повторов и лишних пробелов', () => {
    assert.deepEqual(parseList('C 21 014\n\n  W   712/95 \nc 21 014\nCU 26 010\r'), ['C 21 014', 'W 712/95', 'CU 26 010']);
    assert.deepEqual(parseList(''), []);
    assert.equal(parseList(Array.from({ length: MAX_LIST + 10 }, (_, i) => `A${i}`).join('\n')).length, MAX_LIST);
});

test('dominantType: тип группы — самый частый среди найденного', () => {
    assert.equal(dominantType([
        { name: 'Масляный фильтр A' }, { name: 'Масляный фильтр B' }, { name: 'Воздушный фильтр C' },
    ]), 'мф');
    assert.equal(dominantType([{ name: 'Щуп' }]), null);
    assert.equal(dominantType([{ name: OIL }]), null);
    assert.equal(dominantType([]), null);
});
