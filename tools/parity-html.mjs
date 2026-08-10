#!/usr/bin/env node
// Проверка HTML-паритета: calcForAggregate из оригинального юзерскрипта (git)
// против нового glue-варианта из userscript/src/oil-calculator/app.js.
// Сравниваем поле .html на тех же фикстурах, что и текстовый паритет.
//
// ВАЖНО: тест проверяет корректность ПЕРЕНОСА, а не новые фичи UI.
// Фикстуры сознательно не открывают пикер масел (после рефакторинга он
// получил ✓-метки) и не задевают иерархию допусков — это покрыто
// shared/calculator.test.js.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

import * as C from '../shared/calculator.js';
import * as O from '../shared/oils.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_COMMIT = '44f7180';
const US_PATH = 'Mann + Motul Oil Calculator-2.12.user.js';

const origSrc = execFileSync('git', ['show', `${BASELINE_COMMIT}:${US_PATH}`],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const appSrc = fs.readFileSync(path.join(ROOT, 'userscript/src/oil-calculator/app.js'), 'utf8');

function extractFunction(src, name) {
    const marker = `function ${name}(`;
    const start = src.indexOf(marker);
    if (start === -1) throw new Error(`function ${name} not found`);
    let i = src.indexOf('{', start);
    let depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    return src.slice(start, i + 1);
}

// ── Оригинальная песочница (всё из монолита) ─────────────────────────────────
// getShopOils/getDefaults берутся из shared, а не из замороженной базы: это
// каталог с ценами, и держать его копию 2024 года значит ронять паритет (а с
// ним и сборку юзерскрипта) на каждом обновлении прайса.
const ORIG_FNS = [
    'getMotulOils','getReglament','getReglamentForBrand','matchOilToReglament',
    'normApproval','tokenSet','anyMatch','splitOilApprovals',
    'extractAtfSpecs','carAtfSpecSet','oilAtfMatches','pickAtfOils',
    'escapeHtml','escapeHtmlSafe','filtersTotal','normalizeAdditive','renderOilDetailsBlock',
    'pickEngineOils','calcForAggregate',
];
const origFactory = new Function('GM_getValue', 'DATA', `
    'use strict';
    let calcState = null;
    const getShopOils = DATA.getShopOils;
    const getDefaults = DATA.getDefaults;
    const roundL = (x) => { const n = Number(x); return Number.isFinite(n) ? Math.round(n*1000)/1000 : 0; };
    ${ORIG_FNS.map(n => extractFunction(origSrc, n)).join('\n')}
    return { setState(s){calcState=s;}, calc(agg){return calcForAggregate(agg);} };
`);

// ── Новая песочница (glue из app.js + shared-импорты) ────────────────────────
const NEW_FNS = ['currentCarApprovals','escapeHtml','escapeHtmlSafe','normalizeAdditive','renderOilDetailsBlock','calcForAggregate'];
const newFactory = new Function('GM_getValue', 'S', `
    'use strict';
    let calcState = null;
    const { roundL, normApproval, tokenSet, anyMatch, splitOilApprovals,
            matchOilToReglament, getShopOils, getDefaults, getReglamentForBrand,
            sharedCalcForAggregate, manualWarnText } = S;
    ${NEW_FNS.map(n => extractFunction(appSrc, n)).join('\n')}
    return { setState(s){calcState=s;}, calc(agg){return calcForAggregate(agg);} };
`);

const sharedBag = {
    roundL: C.roundL, normApproval: C.normApproval, tokenSet: C.tokenSet,
    anyMatch: C.anyMatch, splitOilApprovals: C.splitOilApprovals,
    matchOilToReglament: C.matchOilToReglament,
    getShopOils: O.getShopOils, getDefaults: O.getDefaults,
    getReglamentForBrand: O.getReglamentForBrand,
    sharedCalcForAggregate: C.calcForAggregate,
    manualWarnText: C.manualWarnText,
};

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
        data: null, car: null, ...over,
    };
}

const CASES = [
    { name: 'двс MB229.3 + фильтры + полная промывка + картер',
      car: { makeShort:'MERCEDES', modelShort:'C 180', cacheKey:'k1', fuelType:'01', engineCode:'M271' },
      agg: () => ({ key:'engine', label:'ДВС (двигатель)', group:'engine', volume:5.5, filterVolume:0.3 }),
      approvals: ['MB 229.3','MB 229.5'],
      state: makeState({ flush:'full', showWithSump:true,
          filters:{ vf:{name:'W712',price:750,enabled:true,work:350}, mf:{name:'C27',price:1100,enabled:true}, sf:{name:'CUK',price:1400,enabled:true,work:550} } }) },
    { name: 'двс 5-минутка + переопределение объёма',
      car: { makeShort:'VW', modelShort:'TIGUAN', cacheKey:'k2', fuelType:'05', engineCode:'CFFB' },
      agg: () => ({ key:'engine', label:'ДВС (двигатель)', group:'engine', volume:4.3, filterVolume:0.3 }),
      approvals: ['VW 507 00','ACEA C3'],
      state: makeState({ flush:'5min', volumeOverride:{engine:5.0}, oilOverride:{engine_mid:'Motul_5W-30 8100 X-Clean+'} }) },
    { name: 'акпп частичная + фильтр',
      car: { makeShort:'BMW', modelShort:'320i', cacheKey:'k3', fuelType:'01', engineCode:'N46' },
      agg: () => ({ key:'automatic', label:'АКПП', group:'auto', volume:7.0, approvals:['GM DEXRON VI'], motulProducts:['GM DEXRON VI'] }),
      approvals: ['LL 01'],
      state: makeState({ atpType:'partial', atpFilter:true, selected:new Set(['automatic']) }) },
    { name: 'акпп без объёма (needsVolume)',
      car: { makeShort:'KIA', modelShort:'RIO', cacheKey:'k4', fuelType:'01', engineCode:'G4FC' },
      agg: () => ({ key:'automatic', label:'АКПП', group:'auto', volume:0, approvals:['HYUNDAI ATF SP-IV'], motulProducts:['HYUNDAI ATF SP-IV'] }),
      approvals: [],
      state: makeState({ selected:new Set(['automatic']) }) },
    { name: 'вариатор с фильтрами',
      car: { makeShort:'NISSAN', modelShort:'QASHQAI', cacheKey:'k5', fuelType:'01', engineCode:'MR20' },
      agg: () => ({ key:'automatic', label:'Вариатор (CVT)', group:'auto', isCvt:true, volume:8.3, approvals:['MOTUL CVTF'], motulProducts:['MOTUL CVTF'] }),
      approvals: [],
      state: makeState({ atpType:'partial', cvtFilterCoarse:true, cvtFilterFine:true, selected:new Set(['automatic']) }) },
    { name: 'мкпп (gear) обычная',
      car: { makeShort:'LADA', modelShort:'VESTA', cacheKey:'k6', fuelType:'01', engineCode:'21129' },
      // 75W-90 в продуктах — сознательно НЕ триггерит пост-рефакторный варн
      // МКПП (70W/75W-85/80W-90/LS/пусто), см. shared/calculator.test.js
      agg: () => ({ key:'manual', label:'МКПП', group:'gear', volume:2.2, motulProducts:['Motul MOTYLGEAR 75W-90'] }),
      approvals: [],
      state: makeState({ selected:new Set(['manual']) }) },
    { name: 'мкпп HIGH GEAR',
      car: { makeShort:'LADA', modelShort:'VESTA', cacheKey:'k7', fuelType:'01', engineCode:'21129' },
      agg: () => ({ key:'manual', label:'МКПП', group:'gear', volume:2.2, rawText:'HIGH GEAR 75W-90' }),
      approvals: [],
      state: makeState({ selected:new Set(['manual']) }) },
    { name: 'двс 200т+ (isFixedSingle)',
      car: { makeShort:'FORD', modelShort:'FOCUS', cacheKey:'k8', fuelType:'01', engineCode:'AODA' },
      agg: () => ({ key:'engine', label:'ДВС (двигатель)', group:'engine', volume:4.5 }),
      approvals: [],
      state: makeState({ mileage:'>=200' }) },
    { name: 'двс 0W-20',
      car: { makeShort:'TOYOTA', modelShort:'CAMRY', cacheKey:'k9', fuelType:'01', engineCode:'A25A' },
      agg: () => ({ key:'engine', label:'ДВС (двигатель)', group:'engine', volume:4.5 }),
      approvals: [],
      state: makeState({ mileage:'0w20' }) },
];

let failures = 0;
for (const c of CASES) {
    const gm = (key, def) => key === 'rolf_approvals_' + c.car.cacheKey ? c.approvals : def;
    const orig = origFactory(gm, { getShopOils: O.getShopOils, getDefaults: O.getDefaults });
    const neu  = newFactory(gm, sharedBag);

    const s1 = { ...c.state, car: c.car, data: {}, selected: new Set(c.state.selected) };
    const s2 = { ...c.state, car: c.car, data: {}, selected: new Set(c.state.selected) };
    orig.setState(s1); neu.setState(s2);

    const r1 = orig.calc(c.agg());
    const r2 = neu.calc(c.agg());

    // Два интенциональных расхождения с базой:
    //  1) работа переименована — снимаем не картер, а его защиту; база печатает
    //     старое «(картер)», приводим обе стороны к нынешнему тексту;
    //  2) при ВЫКЛ галочке под ценой масла двс теперь печатается приписка
    //     «+ 550₽ (…)», которой в базе нет, — срезаем её с обеих сторон.
    // Остальная вёрстка карточки паритетом по-прежнему стережётся.
    const SUMP_WORK = 'снятие/установка защиты картера';
    const normSump = h => h
        .replace(/\+ 550₽ \(картер\)/g, `+ 550₽ (${SUMP_WORK})`)
        .replace(new RegExp(`</b> \\+ 550₽ \\(${SUMP_WORK}\\)</div>`, 'g'), '</b></div>');
    // Третье расхождение: ПОРЯДОК карточек масла ДВС. Раньше первой шла
    // брендовая позиция, теперь — самая дешёвая из подходящих
    // (docs/DOPUSKI.md, §8). Сравниваем карточки как множество: содержимое
    // каждой по-прежнему сверяется целиком, а порядок больше не считается
    // расхождением. Кнопка выбора масла тоже переехала с «первой карточки» на
    // «брендовую» — после сортировки обе стороны дают одинаковый набор.
    // Ключ раскрытия списка допусков — позиционный (`engine_0_…`), и от
    // перестановки карточек он меняется, оставаясь при этом уникальным (в нём
    // есть и марка масла). Для сравнения номер позиции убираем.
    const CARD = '<div class="zm-oil-line';
    const normCards = (h) => {
        const noIdx = h.replace(/data-oilapp="([a-z]+)_\d+_/g, 'data-oilapp="$1_#_');
        const at = noIdx.indexOf(CARD);
        if (at === -1) return noIdx;
        // Режем по началу карточки (lookahead — маркер остаётся в куске) и
        // склеиваем через один пробел: иначе отсортированный порядок сам по
        // себе менял бы пробел между карточками.
        const cards = noIdx.slice(at).split(/\s*(?=<div class="zm-oil-line)/)
            .map(s => s.trim()).filter(Boolean).sort();
        return noIdx.slice(0, at).trimEnd() + ' ' + cards.join(' ');
    };
    const byTotal = (costs) => [...(costs || [])].sort((a, b) => a.total - b.total);
    const h1 = normCards(normSump((r1.html || '').replace(/\s+/g, ' ').trim()));
    const h2 = normCards(normSump((r2.html || '').replace(/\s+/g, ' ').trim()));
    const t1 = JSON.stringify(byTotal(r1.costs).map(x => ({ o: x.oil.b + ' ' + x.oil.n, t: x.total, br: x.breakdown })));
    const t2 = JSON.stringify(byTotal(r2.costs).map(x => ({ o: x.oil.b + ' ' + x.oil.n, t: x.total, br: x.breakdown })));

    if (h1 === h2 && t1 === t2) {
        console.log(`✓ ${c.name}`);
    } else {
        failures++;
        console.log(`✗ ${c.name}`);
        if (h1 !== h2) {
            for (let i = 0; i < Math.max(h1.length, h2.length); i++) {
                if (h1[i] !== h2[i]) {
                    console.log('  html diff @', i);
                    console.log('  orig:', h1.slice(Math.max(0, i - 60), i + 60));
                    console.log('  new :', h2.slice(Math.max(0, i - 60), i + 60));
                    break;
                }
            }
        }
        if (t1 !== t2) { console.log('  costs orig:', t1); console.log('  costs new :', t2); }
    }
}
if (failures) { console.error(`\n${failures} кейсов разошлись`); process.exit(1); }
console.log(`\nHTML/costs паритет: все ${CASES.length} кейсов совпали ✓`);
