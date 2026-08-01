import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    findStationMeta, baseStationMeta, setStationOverrides, nearestStations, stationsMeta,
} from './stationsMeta.js';

// Правки модераторов (таблица station_overrides) накатываются поверх
// справочника при чтении. Здесь проверяется именно это: что перекрывается,
// что остаётся от кода и что видит форма правки.

test.afterEach(() => setStationOverrides({}));

test('без правок справочник отдаётся как есть', () => {
    const meta = findStationMeta('Санкт-Петербург, ул. Оптиков 2');
    assert.equal(meta.short, 'Оптиков 2');
    assert.equal(meta.height, '2.3 м');
    assert.equal(meta.hydro, true);
});

test('патч перекрывает только свои поля', () => {
    setStationOverrides({ 'Оптиков 2': { height: '2.9 м', hydro: false } });
    const meta = findStationMeta('Санкт-Петербург, ул. Оптиков 2');
    assert.equal(meta.height, '2.9 м');
    assert.equal(meta.hydro, false);
    // Остальное — из кода, включая то, чего в патче нет вовсе.
    assert.equal(meta.boxNo, '##04');
    assert.equal(meta.layout, '3 бокса / 1 подъёмник / 2 ямы');
    assert.equal(meta.lat, 59.995075);
});

test('патч не портит запись справочника', () => {
    setStationOverrides({ 'Оптиков 2': { height: '2.9 м' } });
    findStationMeta('Оптиков 2');
    setStationOverrides({});
    assert.equal(findStationMeta('Оптиков 2').height, '2.3 м');
});

test('алиасы станции делят одну правку', () => {
    setStationOverrides({ 'Охтинская 9/1, Мурино': { ac: false } });
    // «Мурино» и «Охтинская» — две строки справочника с общим short.
    assert.equal(findStationMeta('Мурино, Охтинская аллея 9/1').ac, false);
    assert.equal(findStationMeta('Санкт-Петербург, Охтинская 9/1').ac, false);
});

test('baseStationMeta показывает справочник без правок — по нему рисуются подсказки формы', () => {
    setStationOverrides({ 'Оптиков 2': { height: '2.9 м' } });
    assert.equal(baseStationMeta('Санкт-Петербург, ул. Оптиков 2').height, '2.3 м');
    assert.equal(findStationMeta('Санкт-Петербург, ул. Оптиков 2').height, '2.9 м');
});

test('правки видны и в списке станций, и в подсказке «ближайшие»', () => {
    setStationOverrides({ 'Оптиков 2': { boxNo: '##44' } });
    assert.equal(stationsMeta().find(s => s.short === 'Оптиков 2').boxNo, '##44');
    const near = nearestStations(59.995075, 30.254630, 3);
    assert.equal(near[0].short, 'Оптиков 2');
    assert.equal(near[0].boxNo, '##44');
});

test('незнакомый заголовок колонки не матчится ни с чем', () => {
    assert.equal(findStationMeta('Санкт-Петербург, Новая станция 1'), null);
    assert.equal(baseStationMeta(''), null);
});
