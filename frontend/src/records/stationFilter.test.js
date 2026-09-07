import test from 'node:test';
import assert from 'node:assert/strict';
import { toCyr, stationMatch, filterStations } from './stationFilter.js';

const S = (title, meta) => ({ addr: { id: title, title }, meta });

const BOARD = [
    S('Санкт-Петербург, Бухарестская ул., 74', { short: 'Бухарестская', metro: 'Международная', boxNo: '##11' }),
    S('Санкт-Петербург, ул. Бабушкина, 36', { short: 'Бабушкина', metro: 'Ломоносовская', boxNo: '##12' }),
    S('Санкт-Петербург, Испытателей пр., 5', { short: 'Испытателей', metro: 'Пионерская', boxNo: '##07' }),
    S('деревня Новосаратовка 267А', null), // станции без меты из справочника бывают
];

const names = (list) => list.map(x => x.meta?.short || x.addr.title);

test('пустой запрос не трогает список', () => {
    assert.deepEqual(filterStations(BOARD, ''), BOARD);
    assert.deepEqual(filterStations(BOARD, '   '), BOARD);
});

test('отсев по короткому имени, регистр не важен', () => {
    assert.deepEqual(names(filterStations(BOARD, 'бух')), ['Бухарестская']);
    assert.deepEqual(names(filterStations(BOARD, 'БУХ')), ['Бухарестская']);
    // Общее начало оставляет обе — маска не обязана сужать до одной.
    assert.deepEqual(names(filterStations(BOARD, 'б')), ['Бухарестская', 'Бабушкина']);
});

test('отсев по метро и по коду перевода звонка', () => {
    assert.deepEqual(names(filterStations(BOARD, 'ломонос')), ['Бабушкина']);
    // Код ищется и без решёток: в быстром поиске телефонов нет, путать не с чем.
    assert.deepEqual(names(filterStations(BOARD, '07')), ['Испытателей']);
    assert.deepEqual(names(filterStations(BOARD, '##11')), ['Бухарестская']);
});

test('станция без меты находится по адресу из админки', () => {
    assert.deepEqual(names(filterStations(BOARD, 'новосаратов')),
        ['деревня Новосаратовка 267А']);
});

// Ради этого адрес и не участвует в отсеве у станций со справочным именем: все
// адреса начинаются с «Санкт-Петербург», и по «пет» на экране осталось бы всё.
test('общие слова адреса не тянут за собой всю доску', () => {
    assert.deepEqual(filterStations(BOARD, 'санкт'), []);
    assert.deepEqual(names(filterStations(BOARD, 'пет')), []);
    assert.deepEqual(names(filterStations(BOARD, 'б')), ['Бухарестская', 'Бабушкина']);
});

test('чужая раскладка: набранное латиницей находит станцию', () => {
    assert.equal(toCyr(',e['), 'бух');
    assert.deepEqual(names(filterStations(BOARD, ',e[')), ['Бухарестская']);
    // Кириллица от приведения не страдает: обе стороны проверяются.
    assert.deepEqual(names(filterStations(BOARD, 'бух')), ['Бухарестская']);
});

test('ничего не подходит — пустой список, а не весь набор', () => {
    assert.deepEqual(filterStations(BOARD, 'зззз'), []);
});

test('stationMatch не падает на пустой мете и пустом адресе', () => {
    assert.equal(stationMatch({}, null, 'что-то'), false);
    assert.equal(stationMatch({}, null, ''), true);
});

// Подсказки над картой станции (stationHits) зовут его без флага — там адрес
// нужен: туда набирают улицу, а не имя станции.
test('по умолчанию адрес участвует — это режим подсказок карты', () => {
    const { addr, meta } = BOARD[0];
    assert.equal(stationMatch(addr, meta, 'бухарестская ул'), true);
    assert.equal(stationMatch(addr, meta, 'бухарестская ул', { address: false }), false);
});
