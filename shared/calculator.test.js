// Тесты логики подбора: иерархия допусков (MB 229.x и др.)
// Запуск: node --test shared/

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    tokenSet, expandCoveredTokens, splitOilApprovals, pickEngineOils,
    calcForAggregate,
} from './calculator.js';
import { getShopOils } from './oils.js';

const oilByName = (n) => getShopOils().find(o => o.n === n);

function makeState(over = {}) {
    return {
        mileage: '<100', ignoreApprovals: false,
        car: { makeShort: 'MERCEDES', modelShort: 'C 180', fuelType: '01', engineCode: 'M271' },
        ...over,
    };
}

test('MB 229.5 покрывает MB 229.3, но не наоборот', () => {
    const covered595 = expandCoveredTokens(tokenSet(['MB 229.5']));
    assert.ok(covered595.has('MB2293'), '229.5 должен покрывать 229.3');
    assert.ok(covered595.has('2293'));

    const covered293 = expandCoveredTokens(tokenSet(['MB 229.3']));
    assert.ok(!covered293.has('MB2295'), '229.3 НЕ должен покрывать 229.5');
    assert.ok(covered293.has('MB2291'), '229.3 покрывает 229.1');
});

test('иерархия транзитивна: 229.52 ⊃ 229.51 ⊃ 229.31 ⊃ 229.3', () => {
    const covered = expandCoveredTokens(tokenSet(['MB 229.52']));
    assert.ok(covered.has('MB22951'));
    assert.ok(covered.has('MB22931'));
    assert.ok(covered.has('MB2293'), 'транзитивное покрытие 229.3');
});

test('splitOilApprovals: прямое совпадение остаётся в matched', () => {
    const zic540 = oilByName('X8 SE 5W-40'); // имеет и MB 229.5, и MB 229.3
    const { matched, hier } = splitOilApprovals(zic540.a, ['MB 229.3']);
    assert.ok(matched.includes('MB 229.3'));
    // сам допуск MB 229.3 в hier не дублируется; а вот MB 229.5 туда попадает
    // законно — это отдельная строка допуска, покрывающая требование машины
    assert.ok(!hier.some(h => h.approval === 'MB 229.3'));
    assert.ok(hier.some(h => h.approval === 'MB 229.5' && h.covers === 'MB 229.3'));
});

test('splitOilApprovals: покрытие по иерархии уходит в hier с подписью', () => {
    const topTec = oilByName('5W-30 Top Tec'); // MB 229.31/229.51/229.52, без 229.3
    const { matched, others, hier } = splitOilApprovals(topTec.a, ['MB 229.3']);
    assert.equal(matched.length, 0);
    assert.ok(hier.length >= 1, 'должно быть покрытие через 229.31/229.51');
    assert.equal(hier[0].covers, 'MB 229.3');
    assert.ok(!others.includes(hier[0].approval));
});

test('машина с MB 229.3: подходят не только Leichtlauf', () => {
    const state = makeState();
    const agg = { key: 'engine', label: 'ДВС', group: 'engine' };
    const { mid } = pickEngineOils(agg, getShopOils(), state, ['MB 229.3']);

    // прямое совпадение по-прежнему выигрывает
    assert.equal(mid.n, 'Leichtlauf HC 7 5W-30');

    // но теперь есть и другие масла с ненулевым покрытием допуска
    const covering = agg.ranked.filter(r => r.direct.length + r.hier.length > 0)
                               .map(r => r.oil.n);
    assert.ok(covering.includes('Leichtlauf HC 7 5W-30'));
    assert.ok(covering.includes('5W-30 Top Tec'),  'Top Tec покрывает через 229.31/229.51');
    assert.ok(covering.includes('ESP 5W-30'),      'Mobil ESP покрывает через 229.31/229.51');
    assert.ok(covering.includes('5W-30 EDGE LL'),  'Castrol EDGE покрывает через 229.31/229.51');
    assert.ok(covering.length >= 4, `ожидали ≥4 подходящих, получили: ${covering.join(', ')}`);
});

test('регрессия: машина с MB 229.51 не матчит масла только с 229.3', () => {
    const state = makeState();
    const agg = { key: 'engine', label: 'ДВС', group: 'engine' };
    pickEngineOils(agg, getShopOils(), state, ['MB 229.51']);

    const leicht = agg.ranked.find(r => r.oil.n === 'Leichtlauf HC 7 5W-30');
    assert.ok(leicht, 'Leichtlauf в списке кандидатов');
    assert.equal(leicht.direct.length, 0);
    assert.equal(leicht.hier.length, 0, '229.3 не должен покрывать 229.51');

    const withDirect = agg.ranked.filter(r => r.direct.length > 0).map(r => r.oil.n);
    assert.ok(withDirect.includes('5W-30 Top Tec'));
    assert.ok(withDirect.includes('Professional 5W-30 C3'));
});

test('иерархия не ломает выбор при ignoreApprovals', () => {
    const state = makeState({ ignoreApprovals: true });
    const agg = { key: 'engine', label: 'ДВС', group: 'engine' };
    const { mid } = pickEngineOils(agg, getShopOils(), state, ['MB 229.3']);
    assert.ok(mid, 'масло выбрано');
    const scored = agg.ranked.filter(r => r.score > 0);
    assert.equal(scored.length, 0, 'при игноре допусков скоринг нулевой');
});

test('требуемый ACEA-класс не режет пикер до одного масла (LADA, A3/B4)', () => {
    // Реальный кейс: у Лады в допусках ROLF есть ACEA A3/B4, и раньше пул
    // кандидатов жёстко фильтровался до единственного Leichtlauf —
    // кнопка «выбрать масло» исчезала, альтернатив не было вообще.
    const state = makeState({ car: { makeShort: 'LADA', modelShort: 'X-RAY', fuelType: '01', engineCode: '21179' } });
    const agg = { key: 'engine', label: 'ДВС', group: 'engine' };
    const approvals = ['API SL','API SN','ACEA A3/B4','АВТОВАЗ','MB 229.3','GM LL-A-025','GM LL-B-025','RN 0700','RN 0710'];
    const { mid } = pickEngineOils(agg, getShopOils(), state, approvals);

    // основной выбор (идёт в отчёт) не изменился — класс по-прежнему обязателен
    assert.equal(mid.n, 'Leichtlauf HC 7 5W-30');
    assert.equal(agg.requiredClass, 'A3B4');

    // но пикер теперь видит всю вязкость, а не одно масло
    assert.ok(agg.allCandidates.length >= 10,
        `в пикере вся вязкость, получили ${agg.allCandidates.length}`);
    const scored = agg.ranked.filter(r => r.score > 0);
    assert.ok(scored.length >= 5, `подходящих с ненулевым рейтингом ≥5, получили ${scored.length}`);

    // масла без требуемого класса помечены, а не спрятаны
    const topTec = agg.ranked.find(r => r.oil.n === '5W-30 Top Tec');
    assert.ok(topTec, 'Top Tec присутствует в списке');
    assert.equal(topTec.classMiss, 'A3B4');
    // совпавшее по классу масло — без пометки и в топе
    const leicht = agg.ranked.find(r => r.oil.n === 'Leichtlauf HC 7 5W-30');
    assert.equal(leicht.classMiss, null);
    assert.equal(agg.ranked[0].oil.n, 'Leichtlauf HC 7 5W-30', 'класс-матч + прямые допуски держат его первым');
});

test('VW 507 00 покрывает 505 00/505 01; RN 0710 покрывает 0700; LL 04 ⊃ LL 01 ⊃ LL 98', () => {
    const vw = expandCoveredTokens(tokenSet(['VW 507 00']));
    assert.ok(vw.has('VW50500') && vw.has('VW50501'));
    const rn = expandCoveredTokens(tokenSet(['RN 0710']));
    assert.ok(rn.has('RN0700'));
    const ll = expandCoveredTokens(tokenSet(['LL 04']));
    assert.ok(ll.has('LL01'));
    assert.ok(ll.has('LL98'), 'транзитивно через LL 01');
});

test('вариатор с галочкой «АТФ SP-III»: только ROLF Professional ATF Multi', () => {
    const makeAgg = () => ({ key: 'automatic', group: 'auto', isCvt: true, volume: 7, approvals: [] });
    const state = {
        atpType: 'partial', volumeOverride: {}, atpVolumeManual: null, flush: 'none',
        cvtFilterCoarse: false, cvtFilterFine: false, cvtAtfSp3: true,
    };

    const calc = calcForAggregate(makeAgg(), state, []);
    assert.equal(calc.costs.length, 1, 'предлагается ровно одно масло');
    assert.equal(calc.costs[0].oil.b, 'ROLF');
    assert.equal(calc.costs[0].oil.n, 'Professional ATF Multi');

    // без галочки — обычная пара CVT-масел
    const calc2 = calcForAggregate(makeAgg(), { ...state, cvtAtfSp3: false }, []);
    assert.equal(calc2.costs.length, 2);
    assert.ok(calc2.costs.every(c => c.oil.v === 'CVT'));
});
