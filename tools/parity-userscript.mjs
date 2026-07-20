#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Паритетный тест: отчёт из ОРИГИНАЛЬНОГО юзерскрипта (до перевода на shared/)
// должен байт-в-байт совпадать с отчётом shared/report.js::buildReport().
//
// Оригинал берётся из git-объекта (коммит до рефакторинга), поэтому тест
// остаётся валидным и после замены файла собранным артефактом.
//
// ВАЖНО: тест проверяет корректность ПЕРЕНОСА (формат отчёта, формулы цен),
// а не политику подбора масла. Наборы допусков в фикстурах сознательно
// не задевают иерархию допусков (MB 229.5 ⊃ 229.3, LL 04 ⊃ LL 01 и т.п.),
// добавленную ПОЗЖЕ рефакторинга, — иначе выбор масла законно разойдётся
// с оригиналом. Иерархию покрывает shared/calculator.test.js.
//
// Запуск: node tools/parity-userscript.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { buildReport } from '../shared/report.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Последний коммит, где юзерскрипт ещё содержал собственную копию логики.
const BASELINE_COMMIT = '44f7180';
const USERSCRIPT_PATH = 'Mann + Motul Oil Calculator-2.12.user.js';

const source = execFileSync(
    'git', ['show', `${BASELINE_COMMIT}:${USERSCRIPT_PATH}`],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
);

// ── Извлечение функций по имени (баланс фигурных скобок) ─────────────────────

function extractFunction(src, name) {
    const marker = `function ${name}(`;
    const start = src.indexOf(marker);
    if (start === -1) throw new Error(`function ${name} not found in baseline userscript`);
    let i = src.indexOf('{', start);
    let depth = 0;
    for (; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) break; }
    }
    return src.slice(start, i + 1);
}

const FN_NAMES = [
    'getShopOils', 'getMotulOils', 'getReglament', 'getReglamentForBrand',
    'matchOilToReglament', 'getDefaults',
    'normApproval', 'tokenSet', 'anyMatch', 'splitOilApprovals',
    'extractAtfSpecs', 'carAtfSpecSet', 'oilAtfMatches', 'pickAtfOils',
    'escapeHtml', 'escapeHtmlSafe',
    'getAggregates', 'filtersTotal', 'anyFilterEnabled',
    'totalAggLabel', 'totalOilLabel', 'computeTotalSum', 'buildTotalsLines',
    'normalizeAdditive', 'renderOilDetailsBlock',
    'pickEngineOils', 'calcForAggregate', 'formatAggText',
];

const fnSource = FN_NAMES.map(n => extractFunction(source, n)).join('\n\n');

// ── Песочница с оригинальными функциями ──────────────────────────────────────
// GM_getValue и calcState — свободные переменные оригинала; подставляем стабы.

const sandboxFactory = new Function('GM_getValue', `
    'use strict';
    let calcState = null;
    const roundL = (x) => {
        const n = Number(x);
        return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
    };
    ${fnSource}
    return {
        setState(s) { calcState = s; },
        buildReportOriginal(car, data) {
            const aggs = getAggregates(data);
            const parts = [];
            // Интенциональное расхождение с базой: шапка отчёта переработана —
            // engineName больше не берём (дублировал модель), объём печатаем с «л»,
            // мощность всегда в л.с. (кВт → л.с. по 1.35962). Зеркалим новую логику
            // shared/report.js, чтобы паритет продолжал стеречь остальной отчёт.
            const carParts = [];
            if (car.makeShort) carParts.push(car.makeShort);
            if (car.modelShort) carParts.push(car.modelShort);
            if (car.volume) carParts.push(car.volume + 'л');
            if (car.yearFrom) carParts.push(String(car.yearFrom));
            const hp = car.bhp || (car.kw ? Math.round(parseFloat(car.kw) * 1.35962) : '');
            if (hp) carParts.push(hp + 'лс');
            const carLine = carParts.join(' ');
            if (carLine) parts.push(carLine);
            for (const agg of aggs) {
                if (!calcState.selected.has(agg.key)) continue;
                const calc = calcForAggregate(agg);
                if (calc.isHighGear) { parts.push(agg.label + ' - послан в баню!'); continue; }
                parts.push(formatAggText(agg, calc));
            }
            const totalsLines = buildTotalsLines();
            if (totalsLines.length) parts.push(totalsLines.join('\\n'));
            return parts.join('\\n\\n') || '— выберите агрегаты для подсчёта —';
        },
    };
`);

// ── Фикстуры ─────────────────────────────────────────────────────────────────

const defaultFilters = () => ({
    vf: { name: '', price: 0, enabled: false, work: 350 },
    mf: { name: '', price: 0, enabled: false },
    sf: { name: '', price: 0, enabled: false, work: 550 },
});

function makeState(over = {}) {
    return {
        mileage: '<100', atpType: 'full', atpFilter: false,
        cvtFilterCoarse: false, cvtFilterFine: false, atpVolumeManual: null,
        volumeOverride: {}, selected: new Set(['engine']),
        showApprovals: new Set(), expandedOilApp: new Set(),
        oilOverride: {}, showOilPicker: null,
        ignoreApprovals: false, showWithSump: false, flush: 'none',
        filters: defaultFilters(), showFiltersInput: false, totals: [],
        data: null, car: null,
        ...over,
    };
}

const CASES = [
    {
        name: 'MB 229.3, двс, фильтры, полная промывка, итог',
        car: { makeShort: 'MERCEDES', modelShort: 'C 180', engineName: 'M 271.910', yearFrom: 2007, bhp: 156, cacheKey: 'k1', fuelType: '01', engineCode: 'M271910' },
        data: { engine: { volumeService: 5.5, filterVolume: 0.3 } },
        approvals: ['MB 229.3', 'MB 229.5'],
        state: makeState({
            flush: 'full', showWithSump: true,
            filters: { vf: { name: 'W 712/95', price: 750, enabled: true, work: 350 },
                       mf: { name: 'C 27 006', price: 1100, enabled: true },
                       sf: { name: 'CUK 2545', price: 1400, enabled: true, work: 550 } },
            totals: [{ engine: 0 }],
        }),
    },
    {
        name: 'АКПП частичная с фильтром + двс',
        car: { makeShort: 'BMW', modelShort: '320i', engineName: 'N46 B20', yearFrom: 2005, kw: 110, cacheKey: 'k2', fuelType: '01', engineCode: 'N46B20' },
        data: {
            engine: { volumeService: 4.25 },
            automatic: { volumeTotal: 7.0, motulProducts: ['MOTUL MULTI ATF', 'GM DEXRON VI'] },
        },
        approvals: ['LL 01'],
        state: makeState({
            selected: new Set(['engine', 'automatic']),
            atpType: 'partial', atpFilter: true,
            totals: [{ engine: 0, automatic: 1 }, { engine: 1 }],
        }),
    },
    {
        name: 'Вариатор + 5-минутка, 100т+',
        car: { makeShort: 'NISSAN', modelShort: 'QASHQAI', volume: '2.0', yearFrom: 2010, bhp: 141, cacheKey: 'k3', fuelType: '01', engineCode: 'MR20DE' },
        data: {
            engine: { volumePlain: 3.8 },
            automatic: { volumeTotal: 8.3, isCvt: true, motulProducts: ['MOTUL CVTF'] },
        },
        approvals: ['RN 0700'],
        state: makeState({
            mileage: '>=100', selected: new Set(['engine', 'automatic']),
            atpType: 'partial', cvtFilterCoarse: true, cvtFilterFine: true, flush: '5min',
            // Пин масла двс: RN 0700 даёт большую группу 5W-40 с равным счётом,
            // и медианный выбор чувствителен к росту каталога. Фикстура проверяет
            // формат/формулы отчёта, а не политику подбора, — фиксируем масло,
            // чтобы добавление новых позиций в shared/oils.js не ломало паритет.
            oilOverride: { engine_mid: 'Motul_5W-40 6100 SYN-CLEAN' },
            totals: [{ engine: 0, automatic: 0 }],
        }),
    },
    {
        name: 'Робот/АМТ как МКПП + раздатка + диф, 200т+, картер',
        car: { makeShort: 'FORD', modelShort: 'KUGA', engineName: 'Duratec 2.5', yearFrom: 2012, bhp: 150, cacheKey: 'k4', fuelType: '01', engineCode: 'HYDB' },
        data: {
            engine: { volumeService: 5.3, filterVolume: 0.2 },
            // 75W-90 в продуктах — сознательно НЕ триггерит пост-рефакторный
            // варн МКПП (70W/75W-85/80W-90/LS/пусто), см. calculator.test.js
            manual: { volumeTotal: 2.2, isSemiAuto: true, motulProducts: ['Motul MOTYLGEAR 75W-90'] },
            transfer: { volumeTotal: 0.5 },
            diffRear: { volumeTotal: 0.8 },
        },
        approvals: [],
        state: makeState({
            mileage: '>=200', showWithSump: true,
            selected: new Set(['engine', 'manual', 'transfer', 'diffRear']),
            totals: [{ engine: 0, manual: 0, transfer: 0, diffRear: 0 }],
        }),
    },
    {
        name: '0W-20 + игнор допусков',
        car: { makeShort: 'TOYOTA', modelShort: 'CAMRY', volume: '2.5', yearFrom: 2018, bhp: 181, cacheKey: 'k5', fuelType: '01', engineCode: 'A25AFKS' },
        data: { engine: { volumeService: 4.5 } },
        approvals: [],
        state: makeState({ mileage: '0w20', ignoreApprovals: true }),
    },
    {
        name: 'МКПП HIGH GEAR — в баню',
        car: { makeShort: 'LADA', modelShort: 'VESTA', volume: '1.6', yearFrom: 2017, bhp: 106, cacheKey: 'k6', fuelType: '01', engineCode: '21129' },
        data: {
            engine: { volumeService: 4.4 },
            manual: { volumeTotal: 2.2, rawText: 'HIGH GEAR 75W-90', motulProducts: [] },
        },
        approvals: [],
        state: makeState({ selected: new Set(['engine', 'manual']) }),
    },
    {
        name: 'АКПП без объёма от Motul + ручной ввод',
        car: { makeShort: 'KIA', modelShort: 'RIO', volume: '1.6', yearFrom: 2016, bhp: 123, cacheKey: 'k7', fuelType: '01', engineCode: 'G4FC' },
        data: {
            engine: { volumeService: 3.3 },
            automatic: { motulProducts: ['HYUNDAI ATF SP-IV'] },
        },
        approvals: [],
        state: makeState({
            selected: new Set(['engine', 'automatic']),
            atpVolumeManual: 6.8, atpType: 'partial',
        }),
    },
    {
        name: 'Переопределение объёма и масла, дизель C3',
        car: { makeShort: 'VW', modelShort: 'TIGUAN', engineName: '2.0 TDI', yearFrom: 2014, bhp: 140, cacheKey: 'k8', fuelType: '05', engineCode: 'CFFB' },
        data: { engine: { volumeService: 4.3, filterVolume: 0.3 } },
        approvals: ['VW 507 00', 'ACEA C3'],
        state: makeState({
            volumeOverride: { engine: 5.0 },
            oilOverride: { engine_mid: 'Motul_5W-30 8100 X-Clean+' },
            totals: [{ engine: 0 }, { engine: 1 }],
        }),
    },
];

// ── Прогон ───────────────────────────────────────────────────────────────────

let failures = 0;
for (const c of CASES) {
    const approvalsByKey = { ['rolf_approvals_' + c.car.cacheKey]: c.approvals };
    const GM_getValue = (key, def) => (key in approvalsByKey ? approvalsByKey[key] : def);
    const sandbox = sandboxFactory(GM_getValue);

    const stateOrig = { ...c.state, car: c.car, data: c.data,
                        selected: new Set(c.state.selected), totals: c.state.totals.map(t => ({ ...t })) };
    sandbox.setState(stateOrig);
    const original = sandbox.buildReportOriginal(c.car, c.data);

    const stateNew = { ...c.state, car: c.car, data: c.data,
                       selected: new Set(c.state.selected), totals: c.state.totals.map(t => ({ ...t })) };
    const modern = buildReport(c.car, c.data, stateNew, c.approvals);

    // Интенциональное расхождение с базой: при ВЫКЛ галочке «с картером» сноска
    // в отчёте переименована с «+ 550р (с\у\з\к)» на «(картер)» — это синонимы.
    // База (44f7180) всё ещё печатает старый вариант; нормализуем его к новому,
    // чтобы паритет продолжал стеречь остальной формат отчёта.
    const originalNorm = original.replace(/ \+ 550р \(с\\у\\з\\к\)/g, ' (картер)');

    if (originalNorm === modern) {
        console.log(`✓ ${c.name}`);
    } else {
        failures++;
        console.log(`✗ ${c.name}`);
        console.log('--- оригинал (нормализован) ---');
        console.log(originalNorm);
        console.log('--- shared ---');
        console.log(modern);
    }
}

if (failures) {
    console.error(`\n${failures} из ${CASES.length} кейсов разошлись`);
    process.exit(1);
}
console.log(`\nВсе ${CASES.length} кейсов совпали байт-в-байт ✓`);
