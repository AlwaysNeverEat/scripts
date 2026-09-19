import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtPrice, fmtQty, copyLine, parseList, dominantType, simpleName, MAX_LIST } from './stockFormat.js';

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
    assert.equal(copyLine({ name: OIL, priceRaw: 180 }, 'мф'), 'Mobil 5W-30 Super 3000 FE - 1800р');
});

// Цена масла в строке — за литр, поэтому слова «Моторное масло» и фасовка
// («4l (4x4L)», «(200л)») из имени убираются: объём канистры рядом с ценой
// литра обманывает, а тип виден по вязкости.
test('copyLine: у масла убираются слова типа и фасовка', () => {
    assert.equal(
        copyLine({ name: '202665 Трансмиссионное масло ZIC ATF Multi LF (200л)', priceRaw: 140 }, null),
        'ZIC ATF Multi LF - 1400р',
    );
    // без кода CRM и с литровой канистрой без скобок
    assert.equal(
        copyLine({ name: 'Моторное масло Motul 8100 X-clean 5W40 1L', priceRaw: 95 }, null),
        'Motul 8100 X-clean 5W40 - 950р',
    );
});

// Код CRM бывает с дефисом («104787-200 Моторное масло ROLF…»): такая позиция
// обязана распознаваться как масло из бочки — литры и цена за литр, а не
// «556 шт» по 175 ₽.
test('масло с дефисным кодом CRM: литры, цена за литр, чистая строка', () => {
    const ROLF = '104787-200 Моторное масло ROLF Professional SAE 5W-30 API SN, ACEA C3 (200л)';
    assert.equal(fmtQty(ROLF, 556), '55,6 л');
    assert.equal(fmtPrice(ROLF, 175), '1 750 ₽/л');
    assert.equal(copyLine({ name: ROLF, priceRaw: 175 }, null), 'ROLF Professional SAE 5W-30 API SN, ACEA C3 - 1750р');
    // короткий код («9044») stripCrmCode не трогает, но из имени масла он
    // всё равно уходит — в буфере он торчал перед «Моторное масло»
    assert.equal(
        copyLine({ name: '9044 Моторное масло Liqui Moly 5W-30 Molygen New Generation 4l (4x4L)', priceRaw: 245 }, null),
        'Liqui Moly 5W-30 Molygen New Generation - 2450р',
    );
});

// Упрощённый вид таблицы: масло — как в строке буфера, фильтры — без кода и
// слов типа (тип возмещает бейдж), а имена, которые начинаются НЕ с кода
// («Услуги…», «Антифриз…»), не теряют первое слово.
test('simpleName: без кодов, слов типа и фасовки; не-коды не трогаются', () => {
    assert.equal(simpleName(OIL), 'Mobil 5W-30 Super 3000 FE');
    assert.equal(
        simpleName('9044 Моторное масло Liqui Moly 5W-30 Molygen New Generation 4l (4x4L)'),
        'Liqui Moly 5W-30 Molygen New Generation',
    );
    assert.equal(simpleName(FILTER), 'Mann W 712/95');
    assert.equal(simpleName('Услуги SPOT Замена ATF в ГУР'), 'Услуги SPOT Замена ATF в ГУР');
    assert.equal(simpleName('990561 Антифриз SINTEC MULTIFREEZE 1 кг (12x1L)'), 'Антифриз SINTEC MULTIFREEZE 1 кг (12x1L)');
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
