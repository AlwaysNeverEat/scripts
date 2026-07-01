// Тесты логики подбора: иерархия допусков (MB 229.x и др.)
// Запуск: node --test shared/

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    tokenSet, expandCoveredTokens, splitOilApprovals, pickEngineOils,
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

test('VW 507 00 покрывает 505 00/505 01; RN 0710 покрывает 0700; LL 04 ⊃ LL 01 ⊃ LL 98', () => {
    const vw = expandCoveredTokens(tokenSet(['VW 507 00']));
    assert.ok(vw.has('VW50500') && vw.has('VW50501'));
    const rn = expandCoveredTokens(tokenSet(['RN 0710']));
    assert.ok(rn.has('RN0700'));
    const ll = expandCoveredTokens(tokenSet(['LL 04']));
    assert.ok(ll.has('LL01'));
    assert.ok(ll.has('LL98'), 'транзитивно через LL 01');
});
