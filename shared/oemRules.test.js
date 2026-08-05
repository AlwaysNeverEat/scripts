// Тесты правил «марка + годы + топливо»: что правило говорит, когда допусков
// нет, и — главное — где оно обязано замолчать, потому что допуска нашлись.
// Запуск: node --test shared/

import test from 'node:test';
import assert from 'node:assert/strict';

import { oemRuleFor, oemRules, normMake } from './oemRules.js';
import { findSpec, analyzeCarApprovals, oilFitsProfile, ASH_MID } from './approvals.js';
import { pickEngineOils } from './calculator.js';
import { getShopOils } from './oils.js';

// ── Целостность таблицы ──────────────────────────────────────────────────────

test('каждый допуск из правил есть в справочнике поимённо', () => {
    // Правило отдаёт обычные строки допусков, и разбирает их тот же код, что и
    // данные из базы. Опечатка в строке означала бы правило без физики: оно
    // молча ничего не ограничивает, а выглядит как работающее.
    for (const rule of oemRules()) {
        for (const spec of rule.specs) {
            assert.ok(findSpec(spec, true), `${rule.id}: допуск «${spec}» не найден в справочнике`);
        }
    }
});

test('у каждого правила есть id и текст «почему» для оператора', () => {
    const seen = new Set();
    for (const rule of oemRules()) {
        assert.ok(rule.id && !seen.has(rule.id), `дубль id: ${rule.id}`);
        seen.add(rule.id);
        assert.ok(rule.why && rule.why.length > 40, `${rule.id}: нет внятного объяснения`);
        assert.ok(rule.specs.length, `${rule.id}: правило без допусков`);
    }
});

test('марка сравнивается по «сжатой» форме — как она лежит в базе', () => {
    assert.equal(normMake('MERCEDES-BENZ'), 'MERCEDESBENZ');
    assert.equal(oemRuleFor({ make: 'MERCEDES-BENZ', fuelType: '05', yearFrom: 2014 }).id, 'MB-DIESEL-DPF');
    assert.equal(oemRuleFor({ make: 'LADA / AVTOVAZ', yearFrom: 2019 }).id, 'VAZ');
    assert.equal(oemRuleFor({ make: 'ЛАДА', yearFrom: 2019 }).id, 'VAZ');
});

// ── Когда правило молчит ─────────────────────────────────────────────────────

test('без года выпуска эпоху не гадаем', () => {
    // Год — единственное, что отличает дизель с сажевым фильтром от дизеля без
    // него. Нет года — нет и правила, иначе мы придумываем требование на пустом
    // месте (а пустое поле лучше сомнительного совпадения).
    assert.equal(oemRuleFor({ make: 'BMW', fuelType: '05' }), null);
    assert.equal(oemRuleFor({ make: 'FORD', fuelType: '01' }), null);
    // Правило без годов (АвтоВАЗ) работает и без него: фильтра нет ни в каком году.
    assert.equal(oemRuleFor({ make: 'LADA' }).id, 'VAZ');
});

test('марки, требование которых зависит от мотора, правил не имеют', () => {
    for (const make of ['CHERY', 'GEELY', 'HAVAL', 'JAGUAR', 'SSANGYONG', 'FIAT']) {
        assert.equal(oemRuleFor({ make, fuelType: '01', yearFrom: 2019 }), null, make);
    }
});

test('наддувная версия не подпадает под правило базового мотора', () => {
    const base = { make: 'TOYOTA', fuelType: '01', yearFrom: 2020, engineVolume: '1.6' };
    assert.equal(oemRuleFor({ ...base, bhp: 132 }).id, 'JP-PETROL', 'атмосферный — правило работает');
    assert.equal(oemRuleFor({ ...base, bhp: 261 }), null, 'GR Yaris: 163 л.с. с литра — правило не для него');
    // Мощность неизвестна (юзерскрипт её из Ravenol не берёт) — правило работает:
    // большинство моторов семейства атмосферные.
    assert.equal(oemRuleFor({ ...base }).id, 'JP-PETROL');
    // Объём в кубиках вместо литров тоже понимаем.
    assert.equal(oemRuleFor({ ...base, engineVolume: '1598', bhp: 261 }), null);
});

// ── Правило уступает допускам машины ─────────────────────────────────────────

test('родной допуск машины важнее правила по годам', () => {
    // BMW 2008 бензин: правило сказало бы LL-01, но у машины в базе есть
    // собственный допуск. Требование берём из него, правило в профиль не лезет.
    const r = analyzeCarApprovals(['BMW LL-04', 'ACEA C3', 'MB 229.51'],
        { make: 'BMW', fuelType: '01', yearFrom: 2008 });
    assert.equal(r.confidence, 'medium', 'профиль стоит на родном допуске, а не на правиле');
    assert.equal(r.rule.id, 'BMW-PETROL', 'правило нашлось');
    assert.equal(r.rule.applied, false, 'но как требование не применялось');
    assert.ok(!r.items.some(i => i.fromRule), 'лишних плашек в списке не появилось');
    assert.equal(r.profile.ash, ASH_MID, 'профиль — от LL-04 машины');
});

test('правило заполняет пустоту, а не спорит: допусков нет — требование есть', () => {
    const r = analyzeCarApprovals([], { make: 'MERCEDES-BENZ', fuelType: '05', yearFrom: 2014 });
    assert.equal(r.confidence, 'assumed');
    assert.equal(r.rule.applied, true);

    const item = r.items.find(i => i.fromRule);
    assert.equal(item.label, 'MB 229.51');
    assert.equal(item.rank, 'assumed');
    assert.match(item.why, /допусков в базе нет/);
    assert.match(item.why, /сажевый фильтр/);
    assert.match(item.why, /впиши его в карточку/, 'оператору сказано, что правило перебивается вручную');
});

test('правило лучше классов ACEA из чужих паспортов', () => {
    // Раньше у машины без родных допусков профиль собирался из ACEA-строк
    // чужих масел (доверие low) — ровно из того шума, ради которого затевался
    // весь разбор. Правило по марке и году точнее.
    const r = analyzeCarApprovals(['ACEA A3/B4', 'API SN', 'MB 229.5'],
        { make: 'KIA', fuelType: '05', yearFrom: 2013 });
    assert.equal(r.confidence, 'assumed');
    assert.equal(r.profile.ash, ASH_MID, 'дизель CRDi с фильтром — среднезольное');
});

test('список не про масло + правило: подбор идёт по правилу, строки остаются шумом', () => {
    const coolant = ['VW G12/G12+ (TL 774-D/F)', 'ASTM D 3306/D 4985', 'SAE J1034',
                     'NATO S759', 'BS 6580 (1992)', 'JIS K 2234', 'MAN 324 SNF'];
    const r = analyzeCarApprovals(coolant, { make: 'AUDI', fuelType: '05', yearFrom: 2012 });
    assert.ok(r.notOil);
    assert.equal(r.confidence, 'assumed', 'вместо «ничего не знаем» — знание по марке и году');
    assert.ok(r.items.filter(i => !i.fromRule).every(i => i.weight === 0),
        'строки антифриза по-прежнему ничего не весят');
    assert.ok(r.items.some(i => i.fromRule && i.label === 'VW 507 00'));
});

// ── Сажевый фильтр: то единственное, что правило говорит всегда ──────────────

test('правило про фильтр действует и при найденных допусках', () => {
    // Peugeot 308 HDi 2008. Возрастная эвристика («дизель с 2009») фильтра не
    // видит, а FAP на HDi стоит с 2000 года. Допуска у машины есть и профиль
    // строят они — но предел по золе ставит правило, иначе мотору с фильтром
    // уедет полнозольное масло.
    const r = analyzeCarApprovals(['PSA B71 2296', 'ACEA A3/B4'],
        { make: 'PEUGEOT', fuelType: '05', yearFrom: 2008 });
    assert.equal(r.confidence, 'medium', 'профиль — от допусков машины');
    assert.equal(r.rule.applied, false);
    assert.equal(r.profile.ashGate, ASH_MID, 'но фильтр правило всё равно объявило');

    const leicht = getShopOils().find(o => o.n === 'Leichtlauf HC 7 5W-30'); // полнозольное
    assert.equal(oilFitsProfile(leicht.a, r).blocked, true, 'полнозольное не уедет в мотор с FAP');
});

test('у Лады сажевого фильтра нет ни в каком году', () => {
    // Возрастная эвристика «бензин с 2018 → GPF» для Лады просто неверна:
    // она снимала с подбора все полнозольные масла, включая одобренное ВАЗом.
    const r = analyzeCarApprovals([], { make: 'LADA', fuelType: '01', yearFrom: 2020 });
    assert.equal(r.profile.ashGate, null);
    const spot = getShopOils().find(o => o.n === 'OPTIMAL 5W-40');
    assert.equal(oilFitsProfile(spot.a, r).blocked, false, 'масло с допуском АвтоВАЗа не блокируется');
});

// ── Влияние на подбор ────────────────────────────────────────────────────────

function engineState(car) {
    return { mileage: '<100', ignoreApprovals: false,
             filters: { mf:{}, vf:{}, sf:{} }, car };
}

test('Mercedes с сажевым фильтром и без допусков больше не получает полнозольное', () => {
    const agg = { key: 'engine', group: 'engine' };
    const state = engineState({ makeShort: 'MERCEDES-BENZ', modelShort: 'E 220 CDI',
                                fuelType: '05', yearFrom: 2014 });
    const { mid } = pickEngineOils(agg, getShopOils(), state, []);

    assert.equal(agg.requiredClass, 'C3');
    const blocked = agg.ranked.filter(r => r.blocked).map(r => r.oil.n);
    assert.ok(blocked.includes('Leichtlauf HC 7 5W-30'), 'полнозольное отсечено');
    assert.ok(mid.a.some(x => /229\.51/.test(x)), `${mid.n} — без допуска Mercedes`);
});

test('японский бензиновый мотор получает топливосберегающее, а не густое', () => {
    const agg = { key: 'engine', group: 'engine' };
    const state = engineState({ makeShort: 'TOYOTA', modelShort: 'Corolla',
                                fuelType: '01', yearFrom: 2010, bhp: 132, volume: '1.6' });
    const { mid } = pickEngineOils(agg, getShopOils(), state, []);

    assert.equal(agg.requiredClass, 'A5B5');
    assert.equal(mid.n, 'Professional 5W-30 A5/B5', 'самое дешёвое из подходящих');
    // Масла с одним лишь ILSAC в паспорте (без строки ACEA) из выбора не выпадают:
    // именно они и рассчитаны на такие моторы.
    assert.ok(agg.ranked.find(r => r.oil.n === '5W-30 Molygen').classMiss == null);
});

test('выведенное правилом требование не тянет клиента на дорогое масло', () => {
    // BMW 320i 2008 без допусков. Правило говорит LL-01; масло со старшим LL-04
    // закрывает его полностью, и переплачивать за прямое совпадение не за что —
    // сама ступень тут выведена по эпохе, а не прочитана у машины.
    const agg = { key: 'engine', group: 'engine' };
    const state = engineState({ makeShort: 'BMW', modelShort: '320i', fuelType: '01', yearFrom: 2008 });
    const { mid } = pickEngineOils(agg, getShopOils(), state, []);

    const cheapest = Math.min(...agg.topCandidates.map(o => o.price));
    assert.equal(mid.price, cheapest);
    assert.ok(agg.topCandidates.length > 1, 'равноценных вариантов несколько');
});
