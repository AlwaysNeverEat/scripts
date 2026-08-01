// Тесты классификатора допусков: разбор строк, физический профиль,
// ранжирование значимости и совместимость масла с мотором.
// Запуск: node --test shared/

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    normSpec, splitCompound, findSpec, parseApprovals, makeFamilies,
    analyzeCarApprovals, specsFromProductNames, oilProfile, oilFitsProfile,
    aceaClassOfProfile, findConflicts, ASH_FULL, ASH_MID, ASH_LOW,
} from './approvals.js';
import { pickEngineOils } from './calculator.js';
import { getShopOils } from './oils.js';

// ── Нормализация ─────────────────────────────────────────────────────────────

test('normSpec приводит разные написания одного допуска к одному ключу', () => {
    assert.equal(normSpec('VW 502 00'), normSpec('VW 502.00'));
    assert.equal(normSpec('VW 502 00'), normSpec('Volkswagen 502-00'));
    assert.equal(normSpec('BMW LL-04'), normSpec('BMW Longlife-04'));
    assert.equal(normSpec('MB 229.51'), 'MB22951');
    // «Renault RN0700» не должен превращаться в RNRN0700
    assert.equal(normSpec('Renault RN0700'), 'RN0700');
    assert.equal(normSpec('Renault RN0700'), normSpec('RN 0700'));
    // Jaguar Land Rover в разных написаниях — один допуск
    assert.equal(normSpec('Jaguar Land Rover STJLR.03.5003'), normSpec('JAGUAR STJLR 03.5003'));
});

// ── Разбор составных строк ───────────────────────────────────────────────────

test('splitCompound разбирает склеенные допуска', () => {
    assert.deepEqual(splitCompound('VW 502 00/505 00'), ['VW 502 00', 'VW 505 00']);
    assert.deepEqual(splitCompound('API SN/CF'), ['API SN', 'API CF']);
    assert.deepEqual(splitCompound('ACEA C2/C3'), ['ACEA C2', 'ACEA C3']);
    assert.deepEqual(splitCompound('FIAT 9.55535-N2/M2'), ['FIAT 9.55535-N2', 'FIAT 9.55535-M2']);
    // альтернатива стоит в середине — суффикс «-025» достаётся и голове тоже
    assert.deepEqual(splitCompound('GM-LL-A/B-025'), ['GM-LL-A-025', 'GM-LL-B-025']);
    assert.deepEqual(splitCompound('Ford WSS-M2C913-A/B/C/D').length, 4);
    // недостающая в справочнике ступень достраивается длинным префиксом,
    // а не обрезается до «Fiat T2»
    assert.deepEqual(splitCompound('Fiat 9.55535-S2/GH2/T2'),
                     ['Fiat 9.55535-S2', 'Fiat 9.55535-GH2', 'Fiat 9.55535-T2']);
});

test('кириллические двойники латиницы распознаются', () => {
    // В выгрузке реально встречается «МВ 229.5» русскими буквами
    assert.equal(normSpec('МВ 229.5'), normSpec('MB 229.5'));
    assert.ok(findSpec('МВ 229.5'), 'кириллический MB опознан');
    assert.ok(findSpec('Porsche А40'), 'кириллическая А в Porsche A40 опознана');
});

test('не-моторные строки отсеиваются с понятной причиной', () => {
    const kinds = {
        'ASTM D 3306/D 4985': /охлаждающей жидкости/,
        'API GL-4':           /Трансмиссионная/,
        'ACEA E7':            /грузовой техники/,
        'Volvo VDS-3':        /грузовой техники/,
        'ПАО "КамАЗ"':        /грузовой техники/,
    };
    for (const [raw, re] of Object.entries(kinds)) {
        const r = analyzeCarApprovals([raw, 'VW 504 00'], { make: 'SKODA' });
        const it = r.items.find(i => i.raw === raw);
        assert.equal(it.rank, 'noise', `${raw} должен быть шумом`);
        assert.match(it.why, re, `${raw}: причина не та`);
    }
});

test('splitCompound НЕ разбивает класс ACEA A3/B4 — это одна строка', () => {
    assert.deepEqual(splitCompound('ACEA A3/B4'), ['ACEA A3/B4']);
    assert.deepEqual(splitCompound('ACEA A5/B5'), ['ACEA A5/B5']);
    assert.ok(findSpec('ACEA A3/B4'), 'A3/B4 опознан как класс');
});

test('все составные части находятся в справочнике', () => {
    const parsed = parseApprovals(['VW 502 00/505 00', 'PSA B71 2296/B71 2293']);
    assert.equal(parsed[0].specs.length, 2);
    assert.equal(parsed[1].specs.length, 2);
});

// ── Физика допусков ──────────────────────────────────────────────────────────

test('справочник знает зольность и HTHS ключевых допусков', () => {
    assert.equal(findSpec('VW 504 00').ash, ASH_MID, '504 00 — среднезольное');
    assert.equal(findSpec('VW 502 00').ash, ASH_FULL, '502 00 — полнозольное');
    assert.equal(findSpec('MB 229.51').ash, ASH_MID);
    assert.equal(findSpec('MB 229.5').ash, ASH_FULL);
    assert.equal(findSpec('ACEA C4').ash, ASH_LOW);
    assert.deepEqual(findSpec('ACEA A5/B5').hths, [2.9, 3.5]);
    assert.equal(findSpec('ACEA C3').hths[0], 3.5);
});

test('марка машины определяет, какие семейства допусков ей родные', () => {
    assert.ok(makeFamilies('SKODA').includes('VW'));
    assert.ok(makeFamilies('AUDI').includes('VW'));
    assert.ok(!makeFamilies('SKODA').includes('MB'));
    assert.ok(makeFamilies('MERCEDES-BENZ').includes('MB'));
    assert.ok(makeFamilies('MINI').includes('BMW'));
    assert.ok(makeFamilies('DACIA').includes('RN'));
});

// ── Конфликты ────────────────────────────────────────────────────────────────

test('противоречие по зольности видно в наборе', () => {
    const conflicts = findConflicts(parseApprovals(['VW 502 00', 'VW 504 00']));
    const saps = conflicts.find(c => c.axis === 'saps');
    assert.ok(saps, 'конфликт по зольности найден');
    assert.ok(saps.a.includes('VW 502 00'));
    assert.ok(saps.b.includes('VW 504 00'));
});

test('согласованный набор конфликтов не даёт', () => {
    assert.equal(findConflicts(parseApprovals(['VW 504 00', 'VW 507 00', 'ACEA C3'])).length, 0);
});

// ── Ранжирование ─────────────────────────────────────────────────────────────

test('чужой ОЕМ-допуск получает нулевой вес, родной — полный', () => {
    // Реальный список Skoda Citigo: 29 строк, из них родных VAG — три
    const approvals = ['VW 502 00', 'MB 229.3', 'BMW LL-01', 'Renault RN0700', 'API SN'];
    const r = analyzeCarApprovals(approvals, { make: 'SKODA' });

    const byLabel = (l) => r.items.find(i => i.raw === l);
    assert.equal(byLabel('VW 502 00').rank, 'critical', 'родной допуск VAG решает');
    assert.equal(byLabel('MB 229.3').rank, 'noise', 'Mercedes на Skoda — шум');
    assert.equal(byLabel('BMW LL-01').rank, 'noise');
    assert.equal(byLabel('Renault RN0700').rank, 'noise');
    assert.equal(byLabel('API SN').rank, 'info', 'уровень качества — справочно');

    assert.equal(byLabel('MB 229.3').weight, 0);
    assert.ok(byLabel('VW 502 00').weight > byLabel('API SN').weight);
});

test('у каждого допуска есть текст «почему» для подсказки', () => {
    const r = analyzeCarApprovals(['VW 504 00', 'MB 229.3', 'API SP'], { make: 'SKODA' });
    for (const it of r.items) {
        assert.ok(it.why && it.why.length > 30, `нет объяснения для ${it.raw}`);
        assert.ok(it.what && it.what.length > 10, `нет описания для ${it.raw}`);
    }
    // объяснение шума прямо называет причину появления строки в списке
    const mb = r.items.find(i => i.raw === 'MB 229.3');
    assert.match(mb.why, /отношения не имеет/);
});

test('менее строгая ветка становится фоном только там, где есть сажевый фильтр', () => {
    // Дизель 2012 года — Euro 5, фильтр есть: полнозольный 502 00 уходит в фон.
    const diesel = analyzeCarApprovals(['VW 502 00', 'VW 507 00'], {
        make: 'SKODA', fuelType: '05', yearFrom: 2012,
    });
    assert.equal(diesel.profile.ashGate, ASH_MID, 'дизель Euro 5 → предел по золе');
    assert.equal(diesel.items.find(i => i.raw === 'VW 507 00').rank, 'critical');
    const s502d = diesel.items.find(i => i.raw === 'VW 502 00');
    assert.equal(s502d.rank, 'minor', '502 00 перекрыт более строгим 507 00');
    assert.match(s502d.why, /Закрыть на него глаза можно/);

    // Тот же набор на бензиновом 2012 года: фильтра нет, и «менее строгой
    // ветки» не существует — оба допуска настоящие.
    const petrol = analyzeCarApprovals(['VW 502 00', 'VW 507 00'], {
        make: 'SKODA', fuelType: '01', yearFrom: 2012,
    });
    assert.equal(petrol.profile.ashGate, null, 'бензин до Euro 6d → предела нет');
    assert.equal(petrol.items.find(i => i.raw === 'VW 502 00').rank, 'critical');
});

// ── Второй источник ──────────────────────────────────────────────────────────

test('допуска вытаскиваются из названий продуктов Motul', () => {
    assert.deepEqual(specsFromProductNames(['SPECIFIC 504 00 507 00 5W-30']).sort(),
                     ['VW 504 00', 'VW 507 00']);
    assert.deepEqual(specsFromProductNames(['SPECIFIC 229.52 5W-30']), ['MB 229.52']);
    assert.deepEqual(specsFromProductNames(['SPECIFIC LL-04 5W-40']), ['BMW LL-04']);
    assert.deepEqual(specsFromProductNames(['SPECIFIC dexos2 5W-30']), ['GM dexos2']);
    assert.deepEqual(specsFromProductNames(['8100 X-CLEAN+ 5W-30']), [],
        'обычное название продукта допусков не содержит');
});

test('допуск, подтверждённый Motul, но потерянный источником, дописывается', () => {
    // Ровно случай Skoda Citigo: в car_approvals нет ни 504 00, ни 507 00,
    // хотя Motul на эту модификацию предлагает SPECIFIC 504 00 507 00.
    const r = analyzeCarApprovals(['VW 502 00', 'MB 229.3'], {
        make: 'SKODA', evidence: specsFromProductNames(['SPECIFIC 504 00 507 00 5W-30']),
    });
    assert.equal(r.confidence, 'high');
    const added = r.items.filter(i => i.fromEvidence).map(i => i.label).sort();
    assert.deepEqual(added, ['VW 504 00', 'VW 507 00']);
    assert.ok(r.decisive.some(d => d.label === 'VW 504 00'));
    assert.equal(r.profile.ash, ASH_MID, 'профиль ужесточился до среднезольного');
});

// ── Список не про масло ──────────────────────────────────────────────────────

test('паспорт антифриза в допусках распознаётся и ничего не ограничивает', () => {
    const coolant = ['VW G12/G12+ (TL 774-D/F)', 'ASTM D 3306/D 4985', 'SAE J1034',
                     'NATO S759', 'BS 6580 (1992)', 'JIS K 2234', 'MAN 324 SNF'];
    const r = analyzeCarApprovals(coolant, { make: 'FORD' });
    assert.ok(r.notOil, 'список опознан как не-масляный');
    assert.equal(r.confidence, 'none');
    assert.equal(r.profile.ash, null, 'из антифриза профиль масла не выводится');
    assert.ok(r.items.every(i => i.weight === 0), 'ни одна строка не влияет на подбор');
    assert.match(r.items[0].why, /охлаждающей жидкости/);
});

// ── Профиль масла и совместимость ────────────────────────────────────────────

test('масло с допуском C3 считается среднезольным, несмотря на строку A3/B4', () => {
    // Motul 8100 X-CESS 5W-30 заявляет и ACEA A3/B4, и ACEA C3 одновременно.
    const prof = oilProfile(['ACEA A3/B4', 'ACEA C3', 'MB 229.51']);
    assert.equal(prof.ash, ASH_MID, 'раз прошло C3 — зола ≤0.8%');
    assert.equal(prof.hthsMin, 3.5, 'гарантированный пол по HTHS — самый высокий заявленный');
});

test('масло с C2 и C3 не блокируется по HTHS', () => {
    // Регрессия: минимум из заявленных нижних границ давал 2.9 и резал
    // все нормальные C3-масла (Liqui Moly Top Tec, Mobil ESP).
    const topTec = getShopOils().find(o => o.n === '5W-30 Top Tec');
    assert.ok(topTec.a.includes('ACEA C2') && topTec.a.includes('ACEA C3'));
    const analysis = analyzeCarApprovals(['VW 504 00', 'VW 507 00'], { make: 'SKODA' });
    const fit = oilFitsProfile(topTec.a, analysis);
    assert.equal(fit.blocked, false, 'C3-масло не должно блокироваться на профиле C3');
});

test('полнозольное масло блокируется на моторе с сажевым фильтром', () => {
    const analysis = analyzeCarApprovals(['VW 504 00', 'VW 507 00'], { make: 'SKODA' });
    assert.equal(analysis.profile.ash, ASH_MID);
    const leicht = getShopOils().find(o => o.n === 'Leichtlauf HC 7 5W-30'); // A3/B4, 502/505
    const fit = oilFitsProfile(leicht.a, analysis);
    assert.equal(fit.blocked, true);
    assert.match(fit.notes[0], /полнозольное/);
});

test('малозольный допуск-одиночка не обнуляет ассортимент', () => {
    // BMW LL-12 FE (зола ≤0.5%) попадает в свалку допусков бензинового N43.
    // Мотор бензиновый и дофильтровой эпохи, LL-01 в списке есть — значит
    // полнозольное BMW для него разрешает, и резать по золе нечего.
    const analysis = analyzeCarApprovals(['BMW LL-01', 'BMW LL-04', 'BMW LL-12 FE'],
        { make: 'BMW', fuelType: '01', yearFrom: 2008 });
    assert.equal(analysis.profile.ash, ASH_LOW, 'профиль честно показывает самое строгое');
    assert.equal(analysis.profile.ashGate, null, 'но предела нет: сажевого фильтра у мотора нет');

    for (const name of ['Professional 5W-30 C3', 'Leichtlauf HC 7 5W-30']) {
        const fit = oilFitsProfile(getShopOils().find(o => o.n === name).a, analysis);
        assert.equal(fit.blocked, false, `${name} не должно блокироваться`);
    }
});

test('требуемый класс ACEA выводится из того, что мотору разрешено', () => {
    assert.equal(aceaClassOfProfile({ ashGate: ASH_MID,  hthsMin: 3.5 }), 'C3');
    assert.equal(aceaClassOfProfile({ ashGate: ASH_MID,  hthsMin: 2.9 }), 'C2');
    assert.equal(aceaClassOfProfile({ ashAllowed: ASH_FULL, hthsMin: 3.5 }), 'A3B4');
    assert.equal(aceaClassOfProfile({ ashAllowed: ASH_FULL, hthsMin: 2.9 }), 'A5B5');
    assert.equal(aceaClassOfProfile({ ash: null }), null);
    // Предел важнее разрешённого: дизель с фильтром получает C3, даже если
    // в списке рядом лежит полнозольный допуск.
    assert.equal(aceaClassOfProfile({ ashGate: ASH_MID, ashAllowed: ASH_FULL, hthsMin: 3.5 }), 'C3');
});

// ── Влияние на подбор ────────────────────────────────────────────────────────

function engineState(make, over = {}) {
    return {
        mileage: '<100', ignoreApprovals: false,
        car: { makeShort: make, modelShort: 'X', fuelType: '01', engineCode: '' },
        ...over,
    };
}

test('чужие допуска больше не тянут рейтинг: Skoda не выбирает масло по строкам Mercedes', () => {
    // 29 строк как в базе, из них родных VAG — три, остальное чужие паспорта.
    const approvals = [
        'API SL/CF', 'ACEA A3/B4', 'BMW LL-01', 'MB 229.3', 'MB 229.5', 'VW 502 00/505 00',
        'Renault RN0700', 'Renault RN0710', 'ACEA C3', 'API SN', 'BMW LL-04', 'MB 229.52',
        'MB 229.51', 'MB 229.31', 'VW 502 00/505 01', 'API SP', 'MB 226.5', 'Porsche A40',
        'PSA B71 2296', 'FIAT 9.55535-Z2',
    ];
    const agg = { key: 'engine', group: 'engine', motulProducts: ['SPECIFIC 504 00 507 00 5W-30'] };
    pickEngineOils(agg, getShopOils(), engineState('SKODA'), approvals);

    const a = agg.approvalAnalysis;
    assert.equal(a.confidence, 'high');
    // Мотор бензиновый и без фильтра — VAG разрешает ему полнозольное,
    // поэтому класс отражает разрешённое, а не самый строгий допуск в свалке.
    assert.equal(agg.requiredClass, 'A3B4');

    // решающих осталось единицы вместо двадцати
    assert.ok(a.decisive.length <= 6, `решающих ${a.decisive.length}, ожидали единицы`);
    assert.ok(a.decisive.every(d => d.family === 'VW' || d.role === 'acea'),
        'решают только родные VAG и классы ACEA');
    // и ни один допуск Mercedes/BMW не попал в решающие
    assert.ok(!a.decisive.some(d => d.family === 'MB' || d.family === 'BMW'));

    // Citigo — бензиновый 2011 года, сажевого фильтра нет: резать полнозольные
    // масла не за что, чужие допуска просто перестали приносить очки.
    assert.equal(a.profile.ashGate, null);
    const blocked = agg.ranked.filter(r => r.blocked);
    assert.ok(!blocked.some(r => r.oil.n === 'Leichtlauf HC 7 5W-30'),
        'полнозольное масло с допуском VAG блокировать не за что');
    // Отсекается только то, чего VAG для этого мотора не одобрял ни в одном
    // допуске: все его спецификации требуют HTHS не ниже 3.5.
    assert.ok(blocked.every(r => r.fitNotes.some(n => /HTHS/.test(n))),
        'единственная причина отсева здесь — густота, не зольность');
});

test('полнозольное масло отсекается на дизеле с сажевым фильтром', () => {
    const agg = { key: 'engine', group: 'engine', motulProducts: ['SPECIFIC 504 00 507 00 5W-30'] };
    const state = engineState('SKODA');
    state.car = { makeShort: 'SKODA', modelShort: 'Octavia', fuelType: '05', yearFrom: 2012, engineCode: 'CFHC' };
    pickEngineOils(agg, getShopOils(), state, ['VW 502 00/505 00', 'ACEA C3', 'MB 229.51']);

    assert.equal(agg.approvalAnalysis.profile.ashGate, 0.8, 'дизель Euro 5 → предел по золе');
    const blocked = agg.ranked.filter(r => r.blocked).map(r => r.oil.n);
    assert.ok(blocked.includes('Leichtlauf HC 7 5W-30'), 'полнозольное отсечено');
    assert.ok(!blocked.includes('Professional 5W-30 C3'), 'среднезольное остаётся');
});

test('регрессия «Renault Duster»: рекомендация Motul не подменяет допуска машины', () => {
    // Реальный баг. Duster I F4R 2012 — атмосферный бензиновый, фильтра нет.
    // Motul предлагает масло под RN 17 (допуск для моторов Euro 6), и профиль
    // строился по нему одному: настоящие RN0700/RN0710 падали в фон, класс
    // выходил C2, а все полнозольные масла — включая одобренные Renault —
    // блокировались «не по допускам». В выборе оставались два масла из шестнадцати.
    const approvals = ['API SP', 'ACEA A3/B4', 'Renault RN0700/0710', 'MB 229.3', 'MB 229.5',
                       'MB 226.5', 'GM-LL-A/B-025', 'Porsche A40', 'VW 502 00/505 00',
                       'PSA B71 2296', 'BMW LL-01', 'API SN/CF'];
    const agg = { key: 'engine', group: 'engine', motulProducts: ['SPECIFIC 17 5W-30', '8100 X-CESS 5W-40'] };
    const state = engineState('RENAULT');
    state.car = { makeShort: 'RENAULT', modelShort: 'Duster', fuelType: '01', yearFrom: 2012, engineCode: 'F4R' };
    const { mid } = pickEngineOils(agg, getShopOils(), state, approvals);
    const a = agg.approvalAnalysis;

    assert.equal(a.profile.ashGate, null, 'бензиновый атмосферник — предела по золе нет');
    assert.equal(agg.requiredClass, 'A3B4', 'Renault требует A3/B4, а не C2');
    assert.equal(agg.ranked.filter(r => r.blocked).length, 0, 'ни одно масло не отсечено');

    // Родные допуска машины остались решающими, а не ушли в фон
    const rn = a.items.find(i => i.raw === 'Renault RN0700/0710');
    assert.equal(rn.rank, 'critical', 'RN0700/0710 — настоящий допуск этой машины');

    // Выбрано масло с допуском Renault, а не самое дорогое из C3
    assert.ok((mid.a || []).some(x => /RN\s*07/.test(x)),
        `выбрано ${mid.n} без допуска Renault`);
});

test('эквивалентные по допускам масла получают равный балл (без двойного счёта)', () => {
    // ROLF Professional 5W-30 C3 и ZIC TOP LS закрывают одни и те же
    // требования VAG 504/507 + C3 — балл обязан совпасть, чтобы дальше
    // решала цена, а не длина паспорта.
    const agg = { key: 'engine', group: 'engine', motulProducts: ['SPECIFIC 504 00 507 00 5W-30'] };
    pickEngineOils(agg, getShopOils(), engineState('SKODA'), ['VW 504 00/507 00', 'ACEA C2/C3']);
    const byName = (n) => agg.ranked.find(r => r.oil.n === n);
    assert.equal(byName('Professional 5W-30 C3').score, byName('TOP LS 5W-30').score);
});

test('машина без допусков и с игнором допусков работают как раньше', () => {
    const agg1 = { key: 'engine', group: 'engine' };
    const p1 = pickEngineOils(agg1, getShopOils(), engineState('KIA'), []);
    assert.ok(p1.mid, 'масло выбрано и без допусков');

    const agg2 = { key: 'engine', group: 'engine' };
    pickEngineOils(agg2, getShopOils(), engineState('SKODA', { ignoreApprovals: true }), ['VW 504 00']);
    assert.equal(agg2.approvalAnalysis, null, 'при игноре допусков разбор не строится');
    assert.ok(agg2.ranked.every(r => r.score === 0));
});
