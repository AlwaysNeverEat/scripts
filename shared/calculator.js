// ─────────────────────────────────────────────────────────────────────────────
// Shared calculator logic: oil matching, aggregate volume calculation, pricing.
// Pure functions — no DOM, no GM_ calls, no global state.
// All functions that previously read `calcState` now take it as a parameter.
// `carApprovals` (array of approval strings from Ravenol/Rolf) must be passed
// by the caller; the userscript reads it from GM_getValue, the frontend gets
// it from the DB record's fluid_capacities context or passes [].
// ─────────────────────────────────────────────────────────────────────────────

import { getShopOils, getDefaults, getReglamentForBrand } from './oils.js';

export const roundL = (x) => {
    const n = Number(x);
    return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
};

// ── Approval normalisation ────────────────────────────────────────────────────

export function normApproval(s) {
    if (!s) return '';
    return s.toString().toUpperCase()
        .replace(/APPROVAL/g, '').replace(/LICENSE.*$/, '')
        .replace(/[\s\-_\.\/,;:()]+/g, '')
        .replace(/MERCEDES|MBAPPROVAL/g, 'MB')
        .replace(/VOLKSWAGEN/g, 'VW')
        .replace(/RENAULTRN|RENAULT/g, 'RN')
        .replace(/GMOPEL|OPEL/g, 'GM')
        .replace(/BMWLL|LONGLIFE/g, 'LL')
        .replace(/JAGUARLANDROVER|JAGUAR/g, 'STJLR')
        .replace(/FORDWSS/g, 'FORDWSS')
        .replace(/АВТОВАЗ/g, 'VAZ');
}

export function tokenSet(arr) {
    const s = new Set();
    for (const a of (arr || [])) {
        const n = normApproval(a);
        if (n.length >= 3) s.add(n);
        const nums = n.match(/\d{3,6}/g);
        if (nums) for (const x of nums) s.add(x);
    }
    return s;
}

export function anyMatch(oilApprovals, carApprovals) {
    const oil = tokenSet(oilApprovals);
    const car = tokenSet(carApprovals);
    for (const t of oil) if (car.has(t)) return true;
    return false;
}

export function splitOilApprovals(oilApprovals, carApprovals) {
    const oilArr = oilApprovals || [];
    const carTok = tokenSet(carApprovals || []);
    const matched = [], others = [];
    for (const a of oilArr) {
        const tk = tokenSet([a]);
        let isHit = false;
        for (const t of tk) { if (carTok.has(t)) { isHit = true; break; } }
        if (isHit) matched.push(a); else others.push(a);
    }
    return { matched, others };
}

export function matchOilToReglament(oil, brand) {
    const reg = getReglamentForBrand(brand);
    if (!reg) return [];
    const oilTokens = tokenSet(oil.a || []);
    const matches = [];
    for (const tag of reg.tags) {
        const tagTok = tokenSet([tag]);
        for (const t of tagTok) {
            if (oilTokens.has(t)) { matches.push({ tag, desc: reg.descriptions[tag] || '' }); break; }
        }
    }
    return matches;
}

// ── ATF spec extraction ───────────────────────────────────────────────────────

export function extractAtfSpecs(text) {
    const t = ' ' + (text || '').toUpperCase().replace(/[._/,;:()\-]+/g, ' ').replace(/\s+/g, ' ') + ' ';
    const out = new Set();
    if (/\b(?:DEXRON|DEX|ATF)\s*(?:VI|6)\b/.test(t)) out.add('DEXRONVI');
    if (/\bDEXRON\s*(?:III|3)[A-Z]?\b/.test(t)) out.add('DEXRONIII');
    if (/\bDEXRON\s*(?:II|2)[A-Z]?\b/.test(t) && !/\bDEXRON\s*III\b/.test(t)) out.add('DEXRONII');
    if (/\bMERCON\s*LV\b/.test(t)) out.add('MERCONLV');
    if (/\bMERCON\s*V\b/.test(t) && !/MERCON\s*LV/.test(t)) out.add('MERCONV');
    if (/\bWSS\s*M2C922\b/.test(t)) out.add('WSSM2C922');
    if (/\bSPH\s*(?:IV|4)\b/.test(t)) out.add('SPHIV');
    if (/\bSP\s*(?:IV|4)\b/.test(t)) out.add('SPIV');
    if (/\bSP\s*(?:III|3)\b/.test(t)) out.add('SPIII');
    if (/\bSP\s*(?:II|2)\b/.test(t) && !/\bSP\s*III\b/.test(t)) out.add('SPII');
    if (/\bRED\s*1K\b/.test(t)) out.add('REDIK');
    if (/\bNWS\s*9638\b/.test(t)) out.add('NWS9638');
    if (/\bTOYOTA\s*WS\b|\bATF\s*WS\b|(?:^|\s)WS\s/.test(t)) out.add('TOYOTAWS');
    if (/\bT\s*(?:IV|4)\b|\bTYPE\s*(?:IV|4)\b/.test(t)) out.add('TYPEIV');
    if (/\bT\s*(?:III|3)\b|\bTYPE\s*(?:III|3)\b/.test(t)) out.add('TYPEIII');
    if (/\bD\s*(?:II|2)\b|\bTYPE\s*(?:II|2)\b/.test(t)) out.add('TYPEII');
    if (/\bATF\s*J3\b/.test(t)) out.add('ATFJ3');
    if (/\bATF\s*J2\b/.test(t)) out.add('ATFJ2');
    if (/\bATF\s*PA\b/.test(t)) out.add('ATFPA');
    if (/\bATF\s*FZ\b|\bMAZDA\s*FZ\b/.test(t)) out.add('MAZDAFZ');
    if (/\bMAZDA\s*M\s*V\b|\bM\s*V\b/.test(t)) out.add('MAZDAMV');
    if (/\bDW\s*1\b/.test(t)) out.add('HONDADW1');
    if (/\bHONDA\s*Z\s*1\b|\bZ\s*1\b/.test(t)) out.add('HONDAZ1');
    if (/\bATF\s*\+?\s*4\b/.test(t)) out.add('ATFP4');
    if (/\bAW\s*1\b/.test(t)) out.add('AW1');
    const mbMatches = t.match(/\bMB\s*236\s*(\d+)\b/g);
    if (mbMatches) for (const m of mbMatches) out.add(m.replace(/\s+/g, ''));
    const vwMatches = t.match(/\bG\s*0\s*\d{2}\s*\d{3}\b/g);
    if (vwMatches) for (const m of vwMatches) out.add('VW' + m.replace(/\s+/g, ''));
    const bmwMatches = t.match(/\b\d{2,3}\s+\d{2,3}\s+\d{1,3}\s+\d{2,4}\s+\d{2,4}\b/g);
    if (bmwMatches) for (const m of bmwMatches) out.add('BMW' + m.replace(/\s+/g, ''));
    const jwsMatches = t.match(/\bJWS\s*33(09|17|24)\b/g);
    if (jwsMatches) for (const m of jwsMatches) out.add('JWS33' + m.match(/\d{2}$/)[0]);
    const maticMatches = t.match(/\bMATIC(?:\s+FLUID)?\s+([ADJKSW])\b/g);
    if (maticMatches) for (const m of maticMatches) out.add('MATIC' + m.match(/[ADJKSW]\b/)[0]);
    return out;
}

function carAtfSpecSet(motulProducts) {
    const set = new Set();
    for (const p of (motulProducts || [])) for (const tok of extractAtfSpecs(p)) set.add(tok);
    return set;
}

export function oilAtfMatches(oil, carSet) {
    if (!carSet || !carSet.size) return [];
    const matches = [];
    for (const a of (oil.a || [])) {
        for (const tok of extractAtfSpecs(a)) {
            if (carSet.has(tok)) { matches.push(a); break; }
        }
    }
    return matches;
}

export function pickAtfOils(motulProducts, atfDefs) {
    const { zic, rolfDexron6: rolfDex, rolfMulti } = atfDefs;
    const motulText = (motulProducts || []).join(' | ').toUpperCase();
    const wantsDexron6 = /\b(?:DEXRON|DEX|ATF)\s*(?:VI|6)\b/.test(motulText);
    const carSet = carAtfSpecSet(motulProducts);
    const zicHits       = oilAtfMatches(zic,       carSet);
    const rolfDexHits   = oilAtfMatches(rolfDex,   carSet);
    const rolfMultiHits = oilAtfMatches(rolfMulti, carSet);
    let rolf;
    if (wantsDexron6 && rolfDexHits.length) rolf = rolfDex;
    else if (rolfMultiHits.length)          rolf = rolfMulti;
    else if (rolfDexHits.length)            rolf = rolfDex;
    else                                    rolf = wantsDexron6 ? rolfDex : rolfMulti;
    const anyHit = zicHits.length + rolfDexHits.length + rolfMultiHits.length;
    const noMatch = (motulProducts || []).length > 0 && carSet.size > 0 && anyHit === 0;
    return { oil1: zic, oil2: rolf, noMatch, wantsDexron6,
             debug: { zicHits, rolfDexHits, rolfMultiHits, carSet: [...carSet] } };
}

// ── Aggregate list ────────────────────────────────────────────────────────────

export function getAggregates(data) {
    const out = [];
    if (data.engine) {
        const eng = { ...data.engine };
        eng.volume = eng.volumeService || eng.volumeTotal || eng.volumePlain || eng.volume || 0;
        eng.volumeType = eng.volumeService ? 'service' : (eng.volumeTotal ? 'total' : 'plain');
        out.push({ key:'engine', label:'ДВС (двигатель)', group:'engine', ...eng });
    }
    const pickTotal = (a) => {
        const r = { ...a };
        r.volume = r.volumeTotal || r.volumeService || r.volumePlain || r.volume || 0;
        r.volumeType = r.volumeTotal ? 'total' : (r.volumeService ? 'service' : 'plain');
        r.approvals = r.motulProducts || [];
        return r;
    };
    if (data.automatic && !data.automatic.isDct)
        out.push({ key:'automatic', label: data.automatic.isCvt ? 'Вариатор (CVT)' : 'АКПП', group:'auto', ...pickTotal(data.automatic) });
    if (data.manual)    out.push({ key:'manual',    label:'МКПП',                   group:'gear', ...pickTotal(data.manual) });
    if (data.transfer)  out.push({ key:'transfer',  label:'Раздаточная коробка',     group:'gear', ...pickTotal(data.transfer) });
    if (data.diffFront) out.push({ key:'diffFront', label:'Дифференциал (перед)',    group:'gear', ...pickTotal(data.diffFront) });
    if (data.diffRear)  out.push({ key:'diffRear',  label:'Дифференциал (зад)',      group:'gear', ...pickTotal(data.diffRear) });
    return out;
}

export function shouldDefaultToPartial(car, data) {
    const make  = (car.makeShort || '').toLowerCase();
    const model = (car.modelShort || '').toLowerCase();
    if (data.automatic) {
        if (data.automatic.isCvt) return true;
        if (data.automatic.isDct) return true;
        if (/dsg|dct|cvt|powershift|s\s*tronic|вариатор|робот|двойн[а-я]+ сцеплен/i.test(data.automatic.label || '')) return true;
    }
    const partialMakes = ['skoda','seat','audi','citroen','citroën','peugeot','renault','vw','volkswagen','volvo'];
    if (partialMakes.some(m => make.includes(m))) return true;
    if (make.includes('mazda') && /\b6\b/.test(model)) return true;
    if (make.includes('ford') && /kuga/.test(model)) return true;
    return false;
}

// ── Filter cost helpers ───────────────────────────────────────────────────────

export function filtersTotal(calcState) {
    const f = calcState.filters;
    let sum = 0;
    if (f.mf.enabled && f.mf.price) sum += f.mf.price;
    if (f.vf.enabled && f.vf.price) sum += f.vf.price + (f.vf.work || 0);
    if (f.sf.enabled && f.sf.price) sum += f.sf.price + (f.sf.work || 0);
    return sum;
}

export function anyFilterEnabled(calcState) {
    const f = calcState.filters;
    return (f.mf.enabled && f.mf.price) || (f.vf.enabled && f.vf.price) || (f.sf.enabled && f.sf.price);
}

// ── Engine oil picker ─────────────────────────────────────────────────────────
// carApprovals: string[] from Ravenol/Rolf lookup (GM_getValue in userscript,
// empty array or DB-stored value in frontend).

export function pickEngineOils(agg, shopOils, calcState, carApprovals) {
    const mileage = calcState.mileage;

    if (mileage === '>=200') {
        const oils10w40 = shopOils.filter(o => o.v === '10W-40' && !o.isSpot);
        const oil = oils10w40[0] || { b:'Mobil', n:'Ultra 10W-40', price:1350, v:'10W-40', a:['API SN'], ad:[] };
        agg.approvals = []; agg.allCandidates = oils10w40; agg.topCandidates = [oil];
        return { mid: oil, spot: null };
    }

    if (mileage === '0w20') {
        const oils0w20 = shopOils.filter(o => o.v === '0W-20' && !o.isSpot);
        const carApp0w = Array.isArray(carApprovals) ? carApprovals : [];
        const carTok0w = calcState.ignoreApprovals ? new Set() : tokenSet(carApp0w);
        const rated0w = oils0w20.map(oil => {
            const oilTok = tokenSet(oil.a); let score = 0;
            if (!calcState.ignoreApprovals) for (const t of carTok0w) if (oilTok.has(t)) score += 10;
            return { oil, score };
        });
        rated0w.sort((a, b) => b.score !== a.score ? b.score - a.score : a.oil.price - b.oil.price);
        const mid0w = rated0w[0] ? rated0w[0].oil : { b:'ZIC', n:'X9 FE 0W-20', price:1550, v:'0W-20', a:['API SP'], ad:[] };
        let second0w = null;
        if (calcState.ignoreApprovals && rated0w.length > 1) second0w = rated0w[1].oil;
        agg.approvals = carApp0w;
        agg.allCandidates = rated0w.map(r => r.oil);
        agg.topCandidates = rated0w.filter(r => r.score === (rated0w[0]?.score || 0)).map(r => r.oil);
        return { mid: mid0w, spot: second0w };
    }

    const targetVisc = mileage === '>=100' ? '5W-40' : '5W-30';
    const car = calcState.car;
    const fuelType = String(car.fuelType || '');
    const ec = (car.engineCode || '').toUpperCase();
    const isDieselVehicle = fuelType === '05' || fuelType === '06' ||
        /дизел|diesel/i.test(fuelType) || /D(CI|TI|I)?\b|TDI|HDI|CRDI|BLUEHDI|JTDM|MULTIJET/i.test(ec);

    const approvals = Array.isArray(carApprovals) ? carApprovals : [];
    const carTokens = tokenSet(approvals);
    const effectiveCarTokens = calcState.ignoreApprovals ? new Set() : carTokens;

    const needA5B5 = [...effectiveCarTokens].some(t => /A5B5|ACEAA5B5|ACEAA5|ACEAB5/.test(t));
    const needC3   = [...effectiveCarTokens].some(t => /ACEAC3|^C3$/.test(t));
    const needC2   = [...effectiveCarTokens].some(t => /ACEAC2|^C2$/.test(t));
    const needC1   = [...effectiveCarTokens].some(t => /ACEAC1|^C1$/.test(t));
    const needA3B4 = [...effectiveCarTokens].some(t => /A3B4|ACEAA3B4|ACEAA3|ACEAB4/.test(t));

    const hasAceaClass = (oil, cls) => {
        const t = tokenSet(oil.a);
        if (cls === 'A5B5') return [...t].some(x => /A5B5|ACEAA5B5/.test(x));
        if (cls === 'C3')   return [...t].some(x => /ACEAC3|^C3$/.test(x));
        if (cls === 'C2')   return [...t].some(x => /ACEAC2|^C2$/.test(x));
        if (cls === 'C1')   return [...t].some(x => /ACEAC1|^C1$/.test(x));
        if (cls === 'A3B4') return [...t].some(x => /A3B4|ACEAA3B4/.test(x));
        return true;
    };

    let requiredClass = null;
    if (!calcState.ignoreApprovals) {
        if (needA5B5) requiredClass = 'A5B5';
        else if (needC3) requiredClass = 'C3';
        else if (needC2) requiredClass = 'C2';
        else if (needC1) requiredClass = 'C1';
        else if (needA3B4) requiredClass = 'A3B4';
    }

    let candidates = shopOils.filter(o => o.v === targetVisc && !o.isSpot);
    if (requiredClass) {
        const filtered = candidates.filter(o => hasAceaClass(o, requiredClass));
        if (filtered.length) candidates = filtered;
    }

    const carMake  = (car.makeShort || '').toUpperCase();
    const hasFord  = carMake === 'FORD' || [...effectiveCarTokens].some(t => /FORDWSS|WSSM2C/.test(t));
    const hasMB    = [...effectiveCarTokens].some(t => /^MB\d/.test(t));
    const hasVW    = [...effectiveCarTokens].some(t => /^VW\d|^VW50/.test(t));
    const hasBMW   = [...effectiveCarTokens].some(t => /^LL\d|LL01|LL04|LL98/.test(t));
    const hasRN    = [...effectiveCarTokens].some(t => /^RN\d|RN0700|RN0710/.test(t));
    const hasGM    = [...effectiveCarTokens].some(t => /^GM\d|DEXOS/.test(t));

    const rated = candidates.map(oil => {
        const oilTokens = tokenSet(oil.a); let score = 0;
        if (!calcState.ignoreApprovals) {
            for (const carTok of effectiveCarTokens) if (oilTokens.has(carTok)) score += 10;
            if (hasFord && [...oilTokens].some(t => /FORDWSS|WSSM2C/.test(t))) score += 5;
            if (hasMB   && [...oilTokens].some(t => /^MB\d/.test(t))) score += 3;
            if (hasVW   && [...oilTokens].some(t => /^VW\d|^VW50/.test(t))) score += 3;
            if (hasBMW  && [...oilTokens].some(t => /^LL\d|LL01|LL04/.test(t))) score += 3;
            if (hasRN   && [...oilTokens].some(t => /^RN\d/.test(t))) score += 3;
            if (hasGM   && [...oilTokens].some(t => /^GM\d|DEXOS/.test(t))) score += 3;
        }
        return { oil, score };
    });

    rated.sort((a, b) => b.score !== a.score ? b.score - a.score : a.oil.price - b.oil.price);
    const maxScore   = rated[0] ? rated[0].score : 0;
    const topMatches = rated.filter(r => r.score === maxScore);
    topMatches.sort((a, b) => a.oil.price - b.oil.price);
    const midIdx = topMatches.length <= 2 ? 0 : Math.floor(topMatches.length / 2);
    const mid = topMatches[midIdx].oil;

    const needPro = needA5B5 || needC1 || needC2 || needC3 || isDieselVehicle;
    const spotCandidates = shopOils.filter(o => o.isSpot && o.v === targetVisc);
    let spot;
    if (requiredClass) {
        const spotWithClass = spotCandidates.filter(o => hasAceaClass(o, requiredClass));
        if (spotWithClass.length) {
            spot = spotWithClass.find(o => o.tier === (needPro ? 'pro' : 'optimal')) || spotWithClass[0];
        }
    }
    if (!spot) {
        spot = spotCandidates.find(o => o.tier === (needPro ? 'pro' : 'optimal')) || spotCandidates[0];
    }

    agg.approvals = approvals;
    agg.isDiesel = isDieselVehicle;
    agg.requiredClass = requiredClass;
    agg.allCandidates = rated.map(r => r.oil);
    agg.topCandidates = topMatches.map(r => r.oil);
    return { mid, spot };
}

// ── Aggregate cost calculation ────────────────────────────────────────────────
// Returns { costs, vCalc, formula, volumeStr, oils } — NO HTML.
// For 200k+ mileage the userscript/frontend shows only costs[0].

export function calcForAggregate(agg, calcState, carApprovals) {
    if (agg.key === 'manual' && agg.rawText && /HIGH\s*GEAR|HIGHGEAR|HI[\s\-]?GEAR/i.test(agg.rawText)) {
        return { isHighGear: true, costs: [], vCalc: 0, formula: '', volumeStr: '—' };
    }

    const shopOils = getShopOils();
    const defaults = getDefaults();
    const isCvt    = agg.group === 'auto' && agg.isCvt;

    const v0 = roundL(parseFloat(agg.volume || 0));
    const vFilter = roundL(parseFloat(agg.filterVolume || 0));
    let vService = roundL(v0 + vFilter);

    const override = roundL(parseFloat((calcState.volumeOverride || {})[agg.key]));
    if (isFinite(override) && override > 0) {
        vService = override;
    } else if (agg.group === 'auto' && vService === 0 && calcState.atpVolumeManual) {
        vService = roundL(calcState.atpVolumeManual);
    }

    if (agg.group === 'auto' && vService === 0) {
        return { needsVolume: true, costs: [], vCalc: 0, formula: '', volumeStr: '—' };
    }

    let vCalc, formula, volumeStr;
    if (agg.group === 'auto') {
        if (calcState.atpType === 'full') {
            const mult = 1.5;
            const vRaw = roundL(vService * mult);
            vCalc = Math.max(12, Math.ceil(vRaw));
            formula = `${vService}×${mult}=${vRaw.toFixed(2)}л → ${vCalc}л (мин 12)`;
            volumeStr = `полн: ${vCalc}л`;
        } else {
            const mult = isCvt ? 0.8 : 0.6;
            const vRaw = roundL(vService * mult);
            vCalc = Math.max(4, Math.round(vRaw * 10) / 10);
            formula = `${vService}×${mult}=${vRaw.toFixed(2)}л → ${vCalc}л (мин 4)`;
            volumeStr = `част: ${vCalc}л`;
        }
    } else {
        vCalc = vService;
        formula = vFilter ? `${v0} + ${vFilter} (фильтр) = ${vService}л` : `${vService}л`;
        volumeStr = `${vService}л`;
    }

    // Oil selection
    let oil1, oil2;
    if (agg.group === 'engine') {
        const picks = pickEngineOils(agg, shopOils, calcState, carApprovals);
        oil1 = picks.mid;
        oil2 = picks.spot;
        const overrideKey = (calcState.oilOverride || {})[agg.key + '_mid'];
        if (overrideKey) {
            const found = (agg.allCandidates || []).find(o => (o.b + '_' + o.n) === overrideKey);
            if (found) oil1 = found;
        }
    } else if (agg.group === 'auto') {
        if (isCvt) {
            oil1 = defaults.cvt[0]; oil2 = defaults.cvt[1];
        } else {
            const picked = pickAtfOils(agg.approvals || [], defaults.atf);
            oil1 = picked.oil1; oil2 = picked.oil2;
            agg.atfWarn = picked.noMatch;
        }
    } else {
        const isCvtGear = agg.rawText && /CVT/i.test(agg.rawText);
        const defs = isCvtGear ? defaults.cvt : defaults.gear75W90;
        oil1 = defs[0]; oil2 = defs[1];
    }

    // Cost calculation
    const calcFlushCost = (vol) => {
        if (calcState.flush === '5min') return { cost: 1180, label: '5-минутка' };
        if (calcState.flush === 'full') {
            const litres = +(vol * 0.9).toFixed(1);
            return { cost: Math.round(litres * 300) + 550, label: 'полная промывка' };
        }
        return null;
    };

    const costs = [oil1, oil2].filter(Boolean).map(oil => {
        const price = oil.price;
        let total;
        if (agg.group === 'engine') {
            const fTotal    = filtersTotal(calcState);
            const flush     = calcFlushCost(vCalc);
            const flushAdd  = flush ? flush.cost : 0;
            total = price * vCalc + fTotal + flushAdd;
        } else if (agg.group === 'auto') {
            const isPartial = calcState.atpType === 'partial';
            const baseLabor = 550 + (isPartial ? 1210 : 0);
            if (isCvt) {
                const fltC = calcState.cvtFilterCoarse ? 1700 : 0;
                const fltF = calcState.cvtFilterFine   ? 3350 : 0;
                total = price * vCalc + baseLabor + fltC + fltF;
            } else {
                const flt = calcState.atpFilter ? 1700 : 0;
                total = price * vCalc + baseLabor + flt;
            }
        } else {
            const labor = 1900 + 550;
            total = price * vCalc + labor;
        }
        return { oil, total: Math.round(total) };
    });

    return { costs, vCalc, formula, volumeStr };
}

// ── Totals ────────────────────────────────────────────────────────────────────

export function totalAggLabel(agg) {
    if (agg.key === 'engine')    return 'двс';
    if (agg.key === 'automatic') return agg.isCvt ? 'вариатор' : 'акпп';
    if (agg.key === 'manual')    return 'мкпп';
    if (agg.key === 'transfer')  return 'раздатка';
    if (agg.key === 'diffFront') return 'диф.перед';
    if (agg.key === 'diffRear')  return 'диф.зад';
    return agg.key;
}

export const totalOilLabel = (oil) => `${oil.b} ${oil.n}`;

export function computeTotalSum(tot, aggData) {
    let sum = 0, hasEngine = false;
    for (const { agg, calc } of aggData) {
        const sel = tot[agg.key];
        if (sel === undefined || sel === 'skip') continue;
        const c = calc.costs[sel];
        if (!c) continue;
        sum += c.total;
        if (agg.key === 'engine') hasEngine = true;
    }
    return { sum, hasEngine };
}
