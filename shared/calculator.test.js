// Тесты логики подбора: иерархия допусков (MB 229.x и др.)
// Запуск: node --test shared/

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    tokenSet, expandCoveredTokens, splitOilApprovals, pickEngineOils,
    calcForAggregate, manualOilWarn, manualWarnText,
} from './calculator.js';
import { getShopOils } from './oils.js';
import { oilProfile, ASH_MID } from './approvals.js';

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

    // Масла ЖИЖЕ требуемого помечены, а не спрятаны: A5/B5 — это HTHS 2.9–3.5,
    // мотору под A3/B4 такое лить нельзя.
    const mobilFE = agg.ranked.find(r => r.oil.n === 'Super 3000 FE 5W-30');
    assert.ok(mobilFE, 'Mobil Super 3000 FE присутствует в списке');
    assert.equal(mobilFE.classMiss, 'A3B4');

    // А вот СТРОГОЕ масло на месте нестрогого пометки не получает: у Top Tec
    // класса A3/B4 в паспорте нет, но по физике это C3 — та же густота
    // (HTHS ≥ 3.5) при меньшей золе. Ограничение одностороннее
    // (docs/DOPUSKI.md, §3), и раньше литеральная проверка резала в обе.
    const topTec = agg.ranked.find(r => r.oil.n === '5W-30 Top Tec');
    assert.ok(topTec, 'Top Tec присутствует в списке');
    assert.equal(topTec.classMiss, null, 'C3 подходит туда, где разрешено A3/B4');

    // совпавшее по классу масло — без пометки и в топе
    const leicht = agg.ranked.find(r => r.oil.n === 'Leichtlauf HC 7 5W-30');
    assert.equal(leicht.classMiss, null);
    assert.equal(agg.ranked[0].oil.n, 'Leichtlauf HC 7 5W-30', 'класс-матч + прямые допуски держат его первым');
});

// ── Цена: из одинаково подходящих предлагаем самое дешёвое ───────────────────
// Раньше основной выбор брался из СЕРЕДИНЫ ценового ряда масел с максимальным
// рейтингом, а карточки шли «брендовое, потом SPOT» независимо от цены. То
// есть первой строкой в отчёт клиенту уходил не самый дешёвый из подходящих
// вариантов, хотя разница доходила до 1000 ₽/л.

test('из масел с одинаковыми обязательствами выбирается самое дешёвое', () => {
    const state = makeState({ car: { makeShort:'SKODA', modelShort:'Octavia', fuelType:'01', yearFrom:2015 } });
    const agg = { key: 'engine', label: 'ДВС', group: 'engine' };
    const { mid } = pickEngineOils(agg, getShopOils(), state,
        ['VW 504 00','VW 507 00','ACEA C3','API SN','MB 229.51','BMW LL-04']);

    assert.equal(agg.requiredClass, 'C3');
    assert.equal(mid.n, 'Professional 5W-30 C3', 'ROLF C3 за 1700 вместо Top Tec за 2400');

    // «Достаточные» — те, у кого закрыты те же настоящие требования; между
    // ними решает цена, и список идёт по возрастанию.
    const prices = agg.topCandidates.map(o => o.price);
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b), 'по возрастанию цены');
    assert.equal(agg.topCandidates[0].price, Math.min(...prices));
    assert.ok(agg.topCandidates.some(o => o.n === '5W-30 Top Tec'),
        'Top Tec остаётся равноценным вариантом — просто дороже');
});

test('карточки масел ДВС идут от дешёвого к дорогому', () => {
    const state = makeState({
        car: { makeShort:'MERCEDES', modelShort:'C 180', fuelType:'01', yearFrom:2006 },
        volumeOverride: {}, flush: 'none',
        filters: { mf:{enabled:false}, vf:{enabled:false}, sf:{enabled:false} },
    });
    const agg = { key: 'engine', label: 'ДВС', group: 'engine', volume: 4.3 };
    const calc = calcForAggregate(agg, state, ['MB 229.3']);

    assert.equal(calc.costs.length, 2, 'брендовое + своё');
    assert.ok(calc.costs[0].total < calc.costs[1].total, 'первым — то, что дешевле');
    assert.ok(calc.costs[0].oil.isSpot, 'здесь дешевле своё масло');
});

test('«ничего не известно про машину» не означает «лей самое жидкое»', () => {
    // Без допусков и без выведенного класса ошибка «залил жиже» стоит износа
    // вкладышей, а «залил гуще» — расхода топлива. Дешёвое A5/B5 (HTHS 2.9–3.5)
    // в основной выбор не идёт.
    const state = makeState({ car: { makeShort:'TOYOTA', modelShort:'Corolla', fuelType:'01', yearFrom:2010 } });
    const agg = { key: 'engine', label: 'ДВС', group: 'engine' };
    const { mid } = pickEngineOils(agg, getShopOils(), state, []);

    assert.equal(agg.requiredClass, null);
    assert.notEqual(mid.n, 'Professional 5W-30 A5/B5', 'самое дешёвое, но жидкое — не предлагаем');
    assert.ok(agg.topCandidates.every(o => o.n !== 'Super 3000 FE 5W-30'),
        'A5/B5-масла в основном выборе не участвуют');
    assert.equal(mid.price, Math.min(...agg.topCandidates.map(o => o.price)),
        'внутри густых — по-прежнему самое дешёвое');
});

test('SPOT не предлагается, когда не подходит машине', () => {
    // Ford под WSS-M2C913-D рассчитан на HTHS 2.9–3.5. У SPOT 5W-30 оба масла
    // густые (A3/B4 и C3) — раньше срабатывал безусловный запасной вариант «взять
    // SPOT по тиру», и своё масло уходило в предложение вопреки допуску Ford.
    const state = makeState({ car: { makeShort:'FORD', modelShort:'Focus', fuelType:'01', yearFrom:2014 } });
    const agg = { key: 'engine', label: 'ДВС', group: 'engine' };
    const { mid, spot } = pickEngineOils(agg, getShopOils(), state,
        ['FORD WSS-M2C913-D','ACEA A5/B5','API SL']);

    assert.equal(agg.requiredClass, 'A5B5');
    assert.equal(spot, null, 'своё масло под этот допуск не подходит');
    assert.ok(agg.spotWarn, 'причина проговорена оператору');
    assert.equal(mid.n, 'Professional 5W-30 A5/B5', 'брендовое подходящее — самое дешёвое из них');
});

test('SPOT остаётся с пометкой там, где класс выведен неточно', () => {
    // У корейцев родных допусков в справочнике нет, класс собран из чужих
    // паспортов (доверие low). Убирать по такой догадке своё масло нельзя —
    // блокировки на low мягкие, решение за оператором.
    const state = makeState({ car: { makeShort:'KIA', modelShort:'Rio', fuelType:'01', yearFrom:2017 } });
    const agg = { key: 'engine', label: 'ДВС', group: 'engine' };
    const { spot } = pickEngineOils(agg, getShopOils(), state, ['API SN','ILSAC GF-5','ACEA A5/B5']);

    assert.equal(agg.approvalAnalysis.confidence, 'low');
    assert.ok(spot && spot.isSpot, 'своё масло предлагается');
    assert.ok(agg.spotWarn && /неточно/.test(agg.spotWarn), 'но с оговоркой');
});

test('DPF-дизель: полнозольное SPOT не уезжает клиенту', () => {
    const state = makeState({ car: { makeShort:'RENAULT', modelShort:'Megane', fuelType:'05', yearFrom:2012 } });
    const agg = { key: 'engine', label: 'ДВС', group: 'engine' };
    const { mid, spot } = pickEngineOils(agg, getShopOils(), state,
        ['RN 0700','RN 0710','ACEA A3/B4','API SN']);

    assert.equal(agg.requiredClass, 'C3', 'дизель Euro 5 — сажевый фильтр');
    assert.ok(spot, 'среднезольное SPOT PROFESSIONAL подходит');
    assert.equal(spot.tier, 'pro');
    // И брендовое, и своё — не полнозольные. Проверяем по физике, а не по
    // строкам: у GM 5W-30 Dexos II в паспорте рядом с dexos2 стоят и A3/B3, и
    // VW 502 00, но сертификацию оно прошло по золе ≤0.8%.
    for (const oil of [mid, spot]) {
        assert.ok(oilProfile(oil.a).ash <= ASH_MID, `${oil.n} не должно быть полнозольным`);
    }
});

test('режим 0W-20: масло гуще требуемого проигрывает подходящему, даже если дешевле', () => {
    // VW 508 00 — это HTHS 2.6–2.9. ZIC X9 FE (ILSAC GF-6A, HTHS от 2.9) на
    // 400 ₽ дешевле, но для этого мотора он густой — берём ROLF с ACEA C5.
    const state = makeState({ mileage: '0w20',
        car: { makeShort:'VOLKSWAGEN', modelShort:'Golf', fuelType:'01', yearFrom:2020 } });
    const agg = { key: 'engine', label: 'ДВС', group: 'engine' };
    const { mid } = pickEngineOils(agg, getShopOils(), state, ['VW 508 00','ACEA C5']);

    assert.equal(mid.n, 'Professional 0W-20');
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

test('режим 0W-30: подбор только из масел 0W-30 (не 0W-20)', () => {
    const state = makeState({ mileage: '0w30' });
    const agg = { key: 'engine', label: 'ДВС', group: 'engine' };
    // машина с допуском VW 507 00 — под него подходит ZIC ZERO 0W-30
    const { mid } = pickEngineOils(agg, getShopOils(), state, ['VW 507 00']);

    assert.equal(mid.v, '0W-30', 'выбрано масло вязкости 0W-30');
    assert.ok(agg.allCandidates.every(o => o.v === '0W-30'),
        'в пуле только 0W-30, без примеси 0W-20');
    assert.ok(agg.allCandidates.some(o => o.n === 'ZERO 0W-30'),
        'ZIC ZERO 0W-30 присутствует в кандидатах');
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

// ── МКПП: варн «предложить нечего» ────────────────────────────────────────────
// В наличии только 75W-90. Если Motul требует 70W / 75W-85 / 80W-90 / LS
// (LS может стоять и до, и после вязкости), либо продуктов нет вовсе
// («products not found» парсер отбрасывает → пустой список) — не предлагаем
// ничего, только варн.

test('манж МКПП: варн на 70W, 75W-85, 80W-90 и LS в любом месте названия', () => {
    const cases = [
        ['Motul Gear 300 70W',          '70W'],
        ['Motul HD 80W-90',             '80W-90'],
        ['Motul Motylgear 75W-85',      '75W-85'],
        ['Motul Gear Competition 75W-90 LS', 'LS (limited slip)'],
        ['Motul LS 75W-90',             'LS (limited slip)'],
    ];
    for (const [product, expected] of cases) {
        const warn = manualOilWarn({ key: 'manual', motulProducts: [product] });
        assert.ok(warn, `«${product}» должен давать варн`);
        assert.equal(warn.spec, expected, `«${product}» → ${expected}`);
        assert.ok(manualWarnText(warn).includes(expected));
    }
});

test('манж МКПП: пустой список продуктов (product not found) — тоже варн', () => {
    const warn = manualOilWarn({ key: 'manual', motulProducts: [] });
    assert.ok(warn);
    assert.equal(warn.reason, 'notFound');
    assert.ok(manualWarnText(warn).includes('не дал продуктов'));
});

test('манж МКПП: обычный 75W-90 без LS варн не даёт', () => {
    assert.equal(manualOilWarn({ key: 'manual', motulProducts: ['Motul MOTYLGEAR 75W-90'] }), null);
    assert.equal(manualOilWarn({ key: 'manual', motulProducts: ['75W-80 GL-4'] }), null,
        '75W-80 не в списке запрещённых — без варна');
});

test('манж МКПП: варн только для МКПП, раздатка/дифы не задеты', () => {
    assert.equal(manualOilWarn({ key: 'transfer',  motulProducts: ['75W-90 LS'] }), null);
    assert.equal(manualOilWarn({ key: 'diffRear',  motulProducts: [] }), null);
});

test('calcForAggregate МКПП с варном: масел нет, mkppWarn проставлен', () => {
    const state = { volumeOverride: {}, atpVolumeManual: null, flush: 'none', mileage: '<100' };
    const agg = { key: 'manual', label: 'МКПП', group: 'gear', volume: 2.2,
                  motulProducts: ['Motul Motylgear 75W-85'], approvals: ['Motul Motylgear 75W-85'] };
    const calc = calcForAggregate(agg, state, []);
    assert.equal(calc.costs.length, 0, 'масла не предлагаются');
    assert.ok(calc.mkppWarn, 'варн в результате расчёта');
    assert.equal(calc.mkppWarn.spec, '75W-85');
    assert.equal(calc.volumeStr, '2.2л', 'объём при этом посчитан');

    // без запрещённых спецификаций — обычная пара 75W-90
    const agg2 = { key: 'manual', label: 'МКПП', group: 'gear', volume: 2.2,
                   motulProducts: ['Motul MOTYLGEAR 75W-90'], approvals: ['Motul MOTYLGEAR 75W-90'] };
    const calc2 = calcForAggregate(agg2, state, []);
    assert.equal(calc2.costs.length, 2);
    assert.ok(!calc2.mkppWarn);
    assert.ok(calc2.costs.every(c => c.oil.v === '75W-90'));
});

test('HIGH GEAR приоритетнее варна МКПП', () => {
    const state = { volumeOverride: {}, atpVolumeManual: null, flush: 'none', mileage: '<100' };
    const agg = { key: 'manual', label: 'МКПП', group: 'gear', volume: 2.2,
                  rawText: 'HIGH GEAR 75W-90', motulProducts: [] };
    const calc = calcForAggregate(agg, state, []);
    assert.ok(calc.isHighGear);
    assert.ok(!calc.mkppWarn);
});
