// Тесты текста для Битрикса (shared/report.js).
// Главное, что тут стережётся: объём в шапке блока агрегата обязан совпадать с
// тем, по которому посчитана цена. Раньше цена бралась из расчёта, а объём — из
// данных Motul, и правка объёма в калькуляторе меняла сумму, но не текст: в лид
// уезжало «двс (4.6л)» рядом с ценой за 5л.
//
// Запуск: node --test shared/report.test.js

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReport } from './report.js';

const CAR = { makeShort: 'VW', modelShort: 'TIGUAN', yearFrom: 2014, bhp: 140, fuelType: '05' };

const defaultFilters = () => ({
    vf: { name: '', price: 0, enabled: false, work: 350 },
    mf: { name: '', price: 0, enabled: false },
    sf: { name: '', price: 0, enabled: false, work: 550 },
});

function makeState(over = {}) {
    return {
        mileage: '<100', atpType: 'full', atpFilter: false,
        cvtFilterCoarse: false, cvtFilterFine: false, cvtAtfSp3: false,
        atpVolumeManual: null, volumeOverride: {}, oilOverride: {},
        selected: new Set(['engine']), showApprovals: new Set(),
        ignoreApprovals: false, showWithSump: false, flush: 'none',
        filters: defaultFilters(), totals: [],
        car: CAR, data: null,
        ...over,
    };
}

// Объём, по которому считалась цена: сумма минус работа, делённая на цену литра.
function volumeFromPrice(report, labor = 0) {
    const m = report.match(/(\d+)₽\/л = (\d+)₽/);
    assert.ok(m, 'в отчёте должна быть строка масла с ценой');
    return +((Number(m[2]) - labor) / Number(m[1])).toFixed(3);
}

test('правка объёма ДВС меняет и цену, и подпись блока', () => {
    const data  = { engine: { volumeService: 4.3, filterVolume: 0.3 } };
    const state = makeState({ volumeOverride: { engine: 5.2 } });
    const report = buildReport(CAR, data, state, ['VW 507 00', 'ACEA C3']);

    assert.match(report, /^двс \(5\.2л\)$/m, 'подпись обязана показать правленый объём');
    assert.ok(!/двс \(4\.6л\)/.test(report), 'объём из данных Motul в текст не попадает');
    assert.equal(volumeFromPrice(report), 5.2, 'цена считается по тому же объёму');
});

test('без правки объём в подписи — motul: заправочный + фильтр', () => {
    const data  = { engine: { volumeService: 4.3, filterVolume: 0.3 } };
    const report = buildReport(CAR, data, makeState(), ['VW 507 00', 'ACEA C3']);

    assert.match(report, /^двс \(4\.6л\)$/m);
    assert.equal(volumeFromPrice(report), 4.6);
});

test('правка объёма АКПП: сервисный объём в подписи, расчётный — в формуле', () => {
    const data = {
        engine:    { volumeService: 4.3 },
        automatic: { volumeTotal: 7.0, motulProducts: ['MOTUL MULTI ATF'] },
    };
    const state = makeState({
        selected: new Set(['automatic']),
        atpType: 'partial',
        volumeOverride: { automatic: 9 },
    });
    const report = buildReport(CAR, data, state, []);

    assert.match(report, /^акпп \(серв 9л\)$/m, 'подпись — правленый сервисный объём');
    assert.match(report, /^част \(5\.4л \/ 60%\)/m, '9 × 0.6 — по нему и цена');
    assert.equal(volumeFromPrice(report, 1210 + 550), 5.4, 'цена — за те же 5.4л плюс работа');
});

test('правка объёма МКПП тоже уезжает в текст', () => {
    const data  = { manual: { volumeTotal: 2.2, motulProducts: ['Motul MOTYLGEAR 75W-90'] } };
    const state = makeState({ selected: new Set(['manual']), volumeOverride: { manual: 3 } });
    const report = buildReport(CAR, data, state, []);

    assert.match(report, /\(3\.0л\)/, 'подпись — правленый объём');
    assert.equal(volumeFromPrice(report, 1900 + 550), 3);
});
