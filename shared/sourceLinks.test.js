import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    detectSite, sourceSignature, buildSourceKeys, cleanSourceLinks,
} from './sourceLinks.js';

const MANN = 'https://www.mann-filter.com/ru-ru/catalog/search-results.html?mode=application&vehicleMake=MITSUBISHI&vehicleModel=Lancer+VIII&vehicleModelId=00000000014484&vehicleTypeId=00000000273752&ccm=1998&kw=217&engineCode=4B11+T%2FC&modelTypeId=00000000273752';
const LYNX = 'https://lynxauto.info/podbor?vendor=TOYOTA&car=Corolla&modification=1.6+(1ZR-FE)&year=03%2F2007';
const RAVENOL = 'https://podbor.ravenol.ru/1-cars/58-mitsubishi/models/144-lancer/';

test('detectSite распознаёт все площадки', () => {
    assert.equal(detectSite(MANN), 'mann');
    assert.equal(detectSite(LYNX), 'lynx');
    assert.equal(detectSite(RAVENOL), 'ravenol');
    assert.equal(detectSite('https://motul.lubricantadvisor.com/advice.aspx'), 'motul');
    assert.equal(detectSite('https://rolfoil.ru/podbor/'), 'rolf');
    assert.equal(detectSite('https://example.com/'), null);
    assert.equal(detectSite('not a url'), null);
});

test('mann-сигнатура берёт стабильный vehicleTypeId, игнорируя мусор', () => {
    assert.equal(sourceSignature(MANN), 'mann:type:273752');
    // Тот же тип, но другой набор «мусорных» параметров и порядок → тот же ключ.
    const same = 'https://www.mann-filter.com/ru-ru/catalog/search-results.html?vehicleTypeId=00000000273752&foo=bar&bhp=295';
    assert.equal(sourceSignature(same), 'mann:type:273752');
});

test('mann без id падает на опознавательные поля', () => {
    const noId = 'https://www.mann-filter.com/ru-ru/catalog/search-results.html?vehicleMake=BMW&vehicleModel=X5&ccm=2993&kw=190';
    assert.equal(sourceSignature(noId), 'mann:bmw:x5:2993:190');
});

test('lynx и ravenol дают устойчивые ключи', () => {
    assert.equal(sourceSignature(LYNX), 'lynx:toyota:corolla:1-6-1zr-fe');
    assert.equal(sourceSignature(RAVENOL), 'ravenol:1-cars-58-mitsubishi-models-144-lancer');
});

test('motul/rolf не дают ключа матча', () => {
    assert.equal(sourceSignature('https://motul.lubricantadvisor.com/advice.aspx?x=1'), null);
    assert.equal(sourceSignature('https://rolfoil.ru/podbor/'), null);
});

test('buildSourceKeys собирает уникальные ключи, пропуская motul/rolf', () => {
    const keys = buildSourceKeys({ mann: MANN, motul: 'https://motul.lubricantadvisor.com/advice.aspx', rolf: 'https://rolfoil.ru/podbor/' });
    assert.deepEqual(keys, ['mann:type:273752']);
    assert.deepEqual(buildSourceKeys(null), []);
    assert.deepEqual(buildSourceKeys({}), []);
});

test('cleanSourceLinks отбрасывает пустые и чужие ключи', () => {
    const cleaned = cleanSourceLinks({ mann: '  ' + MANN + ' ', lynx: '', junk: 'x', rolf: 'https://rolfoil.ru/podbor/' });
    assert.deepEqual(cleaned, { mann: MANN, rolf: 'https://rolfoil.ru/podbor/' });
});
