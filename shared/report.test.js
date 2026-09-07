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

// ── Скидка 10% ────────────────────────────────────────────────────────────────
// Главное, что тут стережётся: скидка применяется РОВНО ОДИН РАЗ. Соблазн
// «уценить каждый агрегат и на всякий случай ещё итог» даёт не 10%, а 19%, и
// заметить это на глаз нельзя — обе цифры выглядят правдоподобно.

// Все суммы отчёта: и по агрегатам, и «Итого».
function sumsOf(report) {
    return (report.match(/= (\d+)₽/g) || []).map(x => Number(x.match(/\d+/)[0]));
}

test('скидка снимает ровно 10% с каждой суммы и с итога', () => {
    const data = {
        engine:    { volumeService: 4.3, filterVolume: 0.3 },
        automatic: { volumeService: 8, approvals: ['VW G 052 182'] },
    };
    const base = {
        selected: new Set(['engine', 'automatic']),
        totals: [{ engine: 0, automatic: 0 }],
        showWithSump: true,
    };
    const approvals = ['VW 507 00', 'ACEA C3'];
    const plain = buildReport(CAR, data, makeState(base), approvals);
    const disc  = buildReport(CAR, data, makeState({ ...base, discount: true }), approvals);

    const a = sumsOf(plain), b = sumsOf(disc);
    assert.equal(a.length, b.length, 'состав строк от скидки не меняется');
    a.forEach((sum, i) => {
        assert.equal(b[i], Math.round(sum * 0.9),
            `сумма #${i}: ${sum} → ожидалось ${Math.round(sum * 0.9)}, а вышло ${b[i]}`);
    });
});

test('итог со скидкой — сумма уценённых слагаемых, а не уценённая сумма ещё раз', () => {
    const data = {
        engine:    { volumeService: 4.3, filterVolume: 0.3 },
        automatic: { volumeService: 8, approvals: ['VW G 052 182'] },
    };
    const report = buildReport(CAR, data, makeState({
        selected: new Set(['engine', 'automatic']),
        totals: [{ engine: 0, automatic: 0 }],
        discount: true,
    }), ['VW 507 00', 'ACEA C3']);

    const totalLine = report.split('\n').find(l => /^\d+\(/.test(l));
    assert.ok(totalLine, 'в отчёте должна быть строка «Итого»');
    // Разбираем аккуратно: в названиях масел свои числа («5W-30»), поэтому
    // берём только те, что стоят В НАЧАЛЕ слагаемого, и итог сразу за «=».
    const [left, right] = totalLine.split(' = ');
    const parts = left.split(' + ').map(x => Number(x.match(/^\d+/)[0]));
    const total = Number(right.match(/^\d+/)[0]);
    assert.ok(parts.length >= 2, 'слагаемых должно быть несколько');
    assert.equal(total, parts.reduce((s, x) => s + x, 0),
        'итог обязан быть простой суммой показанных слагаемых');
});

test('без скидки суммы и подписи прежние', () => {
    const data   = { engine: { volumeService: 4.3, filterVolume: 0.3 } };
    const report = buildReport(CAR, data, makeState(), ['VW 507 00', 'ACEA C3']);
    assert.ok(!/скидк/i.test(report), 'подпись про скидку появляется только со скидкой');
});
