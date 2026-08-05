// ─────────────────────────────────────────────────────────────────────────────
// Shared calculator logic: oil matching, aggregate volume calculation, pricing.
// Pure functions — no DOM, no GM_ calls, no global state.
// All functions that previously read `calcState` now take it as a parameter.
// `carApprovals` (array of approval strings from Ravenol/Rolf) must be passed
// by the caller; the userscript reads it from GM_getValue, the frontend gets
// it from the DB record's fluid_capacities context or passes [].
// ─────────────────────────────────────────────────────────────────────────────

import { getShopOils, getDefaults, getReglamentForBrand } from './oils.js';
import { isDieselFuel } from './fuel.js';
import { crmPrefersPartial } from './crmQuirks.js';
import {
    analyzeCarApprovals, specsFromProductNames, oilFitsProfile, aceaClassOfProfile,
    oilProfile, RANKS, ASH_MID, ASH_LOW,
} from './approvals.js';

export { analyzeCarApprovals, specsFromProductNames, oilFitsProfile, aceaClassOfProfile, sapsLabel, RANKS } from './approvals.js';

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

// ── Иерархия допусков ────────────────────────────────────────────────────────
// Старший допуск покрывает требования младшего: масло с MB 229.5 можно лить
// туда, где требуется MB 229.3. Иерархия ОДНОнаправленная: масло только с
// MB 229.3 НЕ подходит машине, требующей MB 229.5.
// Таблица консервативная и явная — расширять по одному правилу.

const APPROVAL_SUPERSEDES_RULES = [
    // Mercedes-Benz
    ['MB 229.52', ['MB 229.51', 'MB 229.31']],
    ['MB 229.51', ['MB 229.31']],
    ['MB 229.31', ['MB 229.3']],
    ['MB 229.5',  ['MB 229.3', 'MB 229.1']],
    ['MB 229.3',  ['MB 229.1']],
    // VW
    ['VW 504 00', ['VW 502 00']],
    ['VW 507 00', ['VW 505 01', 'VW 505 00']],
    // BMW Longlife
    ['LL 04', ['LL 01']],
    ['LL 01', ['LL 98']],
    // Renault
    ['RN 0710', ['RN 0700']],
];

// token → Map(покрытый token → исходная пара допусков для подписи в UI)
let _supersedesMap = null;
function supersedesMap() {
    if (_supersedesMap) return _supersedesMap;
    const m = new Map();
    const add = (sup, sub, label) => {
        if (!m.has(sup)) m.set(sup, new Map());
        if (!m.get(sup).has(sub)) m.get(sup).set(sub, label);
    };
    for (const [sup, subs] of APPROVAL_SUPERSEDES_RULES) {
        for (const sub of subs) {
            for (const supTok of tokenSet([sup])) {
                for (const subTok of tokenSet([sub])) {
                    add(supTok, subTok, { via: sup, covers: sub });
                }
            }
        }
    }
    // транзитивное замыкание: 229.52 ⊃ 229.51 ⊃ 229.31 ⊃ 229.3
    let changed = true;
    while (changed) {
        changed = false;
        for (const [sup, subs] of m) {
            for (const [sub, label] of subs) {
                const deeper = m.get(sub);
                if (!deeper) continue;
                for (const [sub2, label2] of deeper) {
                    if (sup === sub2 || subs.has(sub2)) continue;
                    add(sup, sub2, { via: label.via, covers: label2.covers });
                    changed = true;
                }
            }
        }
    }
    _supersedesMap = m;
    return m;
}

// Все токены, которые покрывают токены масла через иерархию.
// Возвращает Map(покрытый token → { via, covers }) — только НОВЫЕ токены,
// которых нет в самих oilTokens.
export function expandCoveredTokens(oilTokens) {
    const m = supersedesMap();
    const out = new Map();
    for (const t of oilTokens) {
        const covered = m.get(t);
        if (!covered) continue;
        for (const [sub, label] of covered) {
            if (!oilTokens.has(sub) && !out.has(sub)) out.set(sub, label);
        }
    }
    return out;
}

export function splitOilApprovals(oilApprovals, carApprovals) {
    const oilArr = oilApprovals || [];
    const carArr = carApprovals || [];
    const carTok = tokenSet(carArr);
    // токен машины → исходная строка допуска (для подписи «покрывает …»)
    const carTokToStr = new Map();
    for (const a of carArr) {
        for (const t of tokenSet([a])) if (!carTokToStr.has(t)) carTokToStr.set(t, a);
    }
    const matched = [], others = [], hier = [];
    for (const a of oilArr) {
        const tk = tokenSet([a]);
        let isHit = false;
        for (const t of tk) { if (carTok.has(t)) { isHit = true; break; } }
        if (isHit) { matched.push(a); continue; }
        // не прямое совпадение — вдруг покрывает требуемый допуск по иерархии
        const covered = expandCoveredTokens(tk);
        let hierHit = null;
        for (const [sub] of covered) {
            if (carTok.has(sub)) { hierHit = carTokToStr.get(sub) || sub; break; }
        }
        if (hierHit) hier.push({ approval: a, covers: hierHit });
        else others.push(a);
    }
    return { matched, others, hier };
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
    // Название агрегата можно переопределить вручную («Исправить данные»): если в
    // данных лежит непустой label — берём его, иначе штатное имя по типу.
    const lbl = (a, def) => (a && typeof a.label === 'string' && a.label.trim()) ? a.label.trim() : def;
    const renamed = (a) => !!(a && typeof a.label === 'string' && a.label.trim());
    if (data.engine) {
        const eng = { ...data.engine };
        eng.volume = eng.volumeService || eng.volumeTotal || eng.volumePlain || eng.volume || 0;
        eng.volumeType = eng.volumeService ? 'service' : (eng.volumeTotal ? 'total' : 'plain');
        out.push({ key:'engine', group:'engine', ...eng, label: lbl(data.engine, 'ДВС (двигатель)'), labelOverride: renamed(data.engine) });
    }
    const pickTotal = (a) => {
        const r = { ...a };
        r.volume = r.volumeTotal || r.volumeService || r.volumePlain || r.volume || 0;
        r.volumeType = r.volumeTotal ? 'total' : (r.volumeService ? 'service' : 'plain');
        r.approvals = r.motulProducts || [];
        return r;
    };
    if (data.automatic && !data.automatic.isDct)
        out.push({ key:'automatic', group:'auto', ...pickTotal(data.automatic), label: lbl(data.automatic, data.automatic.isCvt ? 'Вариатор (CVT)' : 'АКПП'), labelOverride: renamed(data.automatic) });
    if (data.manual)    out.push({ key:'manual',    group:'gear', ...pickTotal(data.manual),    label: lbl(data.manual, data.manual.isSemiAuto ? 'Робот/АМТ (расчёт как МКПП)' : 'МКПП'), labelOverride: renamed(data.manual) });
    if (data.transfer)  out.push({ key:'transfer',  group:'gear', ...pickTotal(data.transfer),  label: lbl(data.transfer, 'Раздаточная коробка'),  labelOverride: renamed(data.transfer) });
    if (data.diffFront) out.push({ key:'diffFront', group:'gear', ...pickTotal(data.diffFront), label: lbl(data.diffFront, 'Дифференциал (перед)'), labelOverride: renamed(data.diffFront) });
    if (data.diffRear)  out.push({ key:'diffRear',  group:'gear', ...pickTotal(data.diffRear),  label: lbl(data.diffRear, 'Дифференциал (зад)'),   labelOverride: renamed(data.diffRear) });

    // Пользовательские агрегаты — их добавляют/редактируют вручную на странице
    // машины («Исправить данные»): свои названия, объём и допуска. Хранятся в
    // fluid_capacities.custom как массив, поэтому база (JSONB) не требует миграции.
    const custom = Array.isArray(data.custom) ? data.custom : [];
    for (const c of custom) {
        if (!c || typeof c !== 'object' || !c.key) continue;
        const group = c.group === 'auto' ? 'auto' : 'gear';
        out.push({
            key: c.key,
            label: c.label || (group === 'auto' ? (c.isCvt ? 'Вариатор' : 'АКПП') : 'Агрегат'),
            group,
            isCvt: group === 'auto' ? !!c.isCvt : false,
            isCustom: true,
            ...pickTotal(c),
        });
    }
    return out;
}

export function shouldDefaultToPartial(car, data) {
    if (data.automatic) {
        if (data.automatic.isCvt) return true;
        if (data.automatic.isDct) return true;
        if (/dsg|dct|cvt|powershift|s\s*tronic|вариатор|робот|двойн[а-я]+ сцеплен/i.test(data.automatic.label || '')) return true;
    }
    // Список марок и моделей, которым полную не делаем (или делают только по
    // факту подключения), живёт одним куском в shared/crmQuirks.js — здесь
    // только следствие: расчёт сразу частичный.
    return crmPrefersPartial(car, data);
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
//
// ВАЖНО про скоринг. Раньше каждый совпавший допуск давал +10 независимо от
// того, что это за допуск. Но список допусков машины — это объединение
// паспортов рекомендованных масел (см. shared/approvals.js): у 97.6% машин там
// допуска сразу трёх и более чужих марок. При равном весе побеждало масло с
// самым длинным паспортом, а не подходящее мотору. Теперь вес допуска — это
// цена ошибки по нему: родной допуск марки 100, физический класс ACEA 40,
// перекрытая ветка 12, уровень API 2, чужая марка 0.

// Одно обязательство — один балл. VW 504 00 и VW 507 00 в списке машины это
// бензиновая и дизельная версии ОДНОГО требования, а «ACEA C2» и «ACEA C3»
// рядом — вообще след того, что список собран из паспортов разных масел.
// Складывая их, мы снова считали бы длину паспорта: у Skoda Citigo побеждало
// Top Tec за 2400₽ только потому, что у него в списке лишняя строка C2, хотя
// ROLF Professional C3 за 1700₽ закрывает ровно те же требования.
// Поэтому баллы группируются по источнику обязательства (марка или «ACEA»),
// и внутри группы берётся лучшее совпадение, а не сумма.
function requirementGroup(item) {
    if (item.role === 'acea') return 'ACEA';
    if (item.role === 'api') return 'API';
    return item.family || item.role || item.label;
}

// Ниже какого веса совпадение перестаёт быть настоящим требованием. Второй
// множитель — скидка за покрытие по иерархии (0.7): «важный» допуск, закрытый
// старшим (40 × 0.7 = 28), всё ещё требование, а вот «второстепенная» ветка
// (12) и уровень API (2) — уже нет.
const CORE_MIN = Math.round(RANKS.important.weight * 0.7);

// Строит функцию оценки масла по разобранным допускам машины.
// Возвращает { oil, score, core, direct, hier, blocked, fitNotes }.
//
// score — полный рейтинг, по нему строится порядок в пикере.
// core  — только настоящие обязательства (родной допуск марки, класс ACEA по
//         физике). Два масла с одинаковым core закрывают ровно одни и те же
//         требования мотора, и разница в score между ними — это лишние строки
//         в паспорте, за которые клиенту платить не за что.
function buildOilRater(analysis) {
    const scoredItems = analysis ? analysis.items.filter(i => i.weight > 0) : [];
    return (oil) => {
        const oilTokens = tokenSet(oil.a);
        const covered = expandCoveredTokens(oilTokens);
        const best = new Map();
        const direct = [], hier = [];
        for (const item of scoredItems) {
            // Иерархию проверяем в старой нормализации (normApproval/tokenSet):
            // таблица APPROVAL_SUPERSEDES_RULES построена в ней же.
            const tk = tokenSet(item.parts);
            let hit = false;
            for (const t of tk) if (oilTokens.has(t)) { hit = true; break; }
            let gained = 0;
            if (hit) {
                gained = item.weight;
                direct.push(item.label);
            } else {
                let via = null;
                for (const t of tk) { const lab = covered.get(t); if (lab) { via = lab.via; break; } }
                // Старший допуск покрывает младший, но это не прямое
                // одобрение — засчитываем 70% веса.
                if (via) { gained = Math.round(item.weight * 0.7); hier.push({ covers: item.label, via }); }
            }
            if (!gained) continue;
            const key = requirementGroup(item);
            if (gained > (best.get(key) || 0)) best.set(key, gained);
        }
        let score = 0, core = 0;
        for (const v of best.values()) { score += v; if (v >= CORE_MIN) core += v; }
        const fit = analysis
            ? oilFitsProfile(oil.a, analysis)
            : { blocked: false, penalty: 0, notes: [] };
        // Мягкое отклонение по физике (масло гуще, чем рассчитан мотор; зола
        // выше желаемой) вычитается и из core: иначе «одинаково закрывают
        // требования» получалось у масла, которое мотору не совсем подходит, и
        // выбор по цене отдавал предпочтение именно ему.
        return { oil, score: score - fit.penalty, core: core - fit.penalty, direct, hier,
                 blocked: fit.blocked, fitNotes: fit.notes };
    };
}

// ── Есть ли у масла требуемый класс ACEA ─────────────────────────────────────
// Литеральной строки «ACEA C3» в паспорте мало. Во-первых, у части масел класса
// в паспорте нет вовсе: SPOT PROFESSIONAL 5W-40 несёт MB 229.51 + BMW LL-04 +
// dexos2 — это ровно C3, но слова «ACEA» в списке нет, и масло помечалось «не
// C3», хотя дешевле подходящих аналогов на 400–700 ₽. Во-вторых, ограничение
// одностороннее (docs/DOPUSKI.md, §3): строгое масло подходит туда, где
// разрешено нестрогое, а литеральная проверка резала в обе стороны — машине с
// ACEA A3/B4 переставали предлагать C3-масла, хотя C3 строже по золе при том
// же HTHS.
//
// Поэтому: сначала прямое совпадение строки, потом физика, выведенная из ВСЕХ
// допусков масла (oilProfile берёт самый строгий по золе и самый высокий пол
// по HTHS — то, что масло реально прошло на замерах).
function oilMeetsClass(oil, cls) {
    if (hasLiteralAceaClass(oil, cls)) return true;
    const p = oilProfile(oil.a || []);
    if (p.ash == null || p.hthsMin == null) return false;
    const thick = p.hthsMin >= 3.5;
    switch (cls) {
        // Полнозольные классы золу не ограничивают — важен только HTHS.
        case 'A3B4': return thick;
        case 'A5B5': return !thick;
        case 'C3':   return thick && p.ash <= ASH_MID;
        case 'C2':   return !thick && p.ash <= ASH_MID;
        case 'C1':   return p.ash <= ASH_LOW;
        default:     return false;
    }
}

// Масла, закрывающие максимум настоящих требований (максимальный core),
// от самого дешёвого к дорогому. При равной цене впереди тот, у кого
// совпадений больше.
function cheapestFirst(rated) {
    if (!rated.length) return [];
    const bestCore = rated.reduce((m, r) => Math.max(m, r.core), -Infinity);
    return rated.filter(r => r.core === bestCore)
        .sort((a, b) => a.oil.price !== b.oil.price
            ? a.oil.price - b.oil.price
            : b.score - a.score);
}

function hasLiteralAceaClass(oil, cls) {
    const t = tokenSet(oil.a);
    if (cls === 'A5B5') return [...t].some(x => /A5B5|ACEAA5B5/.test(x));
    if (cls === 'C3')   return [...t].some(x => /ACEAC3|^C3$/.test(x));
    if (cls === 'C2')   return [...t].some(x => /ACEAC2|^C2$/.test(x));
    if (cls === 'C1')   return [...t].some(x => /ACEAC1|^C1$/.test(x));
    if (cls === 'A3B4') return [...t].some(x => /A3B4|ACEAA3B4/.test(x));
    return true;
}

export function pickEngineOils(agg, shopOils, calcState, carApprovals) {
    const mileage = calcState.mileage;

    if (mileage === '>=200') {
        const oils10w40 = shopOils.filter(o => o.v === '10W-40' && !o.isSpot);
        const oil = oils10w40[0] || { b:'Mobil', n:'Ultra 10W-40', price:1350, v:'10W-40', a:['API SN'], ad:[] };
        agg.approvals = []; agg.allCandidates = oils10w40; agg.topCandidates = [oil];
        return { mid: oil, spot: null };
    }

    if (mileage === '0w20' || mileage === '0w30') {
        const visc0w = mileage === '0w20' ? '0W-20' : '0W-30';
        const oils0w = shopOils.filter(o => o.v === visc0w && !o.isSpot);
        const carApp0w = Array.isArray(carApprovals) ? carApprovals : [];
        const analysis0w = calcState.ignoreApprovals ? null : analyzeApprovalsFor(agg, calcState, carApp0w);
        const rate0w = buildOilRater(analysis0w);
        const rated0w = oils0w.map(rate0w);
        agg.approvalAnalysis = analysis0w;
        rated0w.sort((a, b) => b.score !== a.score ? b.score - a.score : a.oil.price - b.oil.price);
        const fallback0w = mileage === '0w20'
            ? { b:'ZIC', n:'X9 FE 0W-20', price:1550, v:'0W-20', a:['API SP'], ad:[] }
            : { b:'ZIC', n:'ZERO 0W-30', price:2150, v:'0W-30', a:['ACEA C3'], ad:[] };
        // Как и в основной ветке: среди масел, закрывающих одни и те же
        // требования, берём самое дешёвое, а не первое по длине паспорта.
        let eligible0w = rated0w.filter(r => !r.blocked);
        if (!eligible0w.length) eligible0w = rated0w;
        const sufficient0w = cheapestFirst(eligible0w);
        const mid0w = sufficient0w.length ? sufficient0w[0].oil : fallback0w;
        let second0w = null;
        if (calcState.ignoreApprovals && rated0w.length > 1) second0w = rated0w[1].oil;
        agg.approvals = carApp0w;
        agg.allCandidates = rated0w.map(r => r.oil);
        agg.topCandidates = sufficient0w.map(r => r.oil);
        agg.ranked = rated0w.map(r => ({
            oil: r.oil, score: r.score, core: r.core, direct: r.direct, hier: r.hier,
            classMiss: null, blocked: r.blocked || false, fitNotes: r.fitNotes || [],
            sufficient: sufficient0w.some(s => s.oil === r.oil),
        }));
        return { mid: mid0w, spot: second0w };
    }

    const targetVisc = mileage === '>=100' ? '5W-40' : '5W-30';
    const car = calcState.car;
    const fuelType = String(car.fuelType || '');
    const ec = (car.engineCode || '').toUpperCase();
    const isDieselVehicle = isDieselFuel(fuelType) ||
        /D(CI|TI|I)?\b|TDI|HDI|CRDI|BLUEHDI|JTD|MULTIJET/i.test(ec);

    const approvals = Array.isArray(carApprovals) ? carApprovals : [];
    const carTokens = tokenSet(approvals);
    const effectiveCarTokens = calcState.ignoreApprovals ? new Set() : carTokens;
    const analysis = calcState.ignoreApprovals ? null : analyzeApprovalsFor(agg, calcState, approvals);

    const needA5B5 = [...effectiveCarTokens].some(t => /A5B5|ACEAA5B5|ACEAA5|ACEAB5/.test(t));
    const needC3   = [...effectiveCarTokens].some(t => /ACEAC3|^C3$/.test(t));
    const needC2   = [...effectiveCarTokens].some(t => /ACEAC2|^C2$/.test(t));
    const needC1   = [...effectiveCarTokens].some(t => /ACEAC1|^C1$/.test(t));
    const needA3B4 = [...effectiveCarTokens].some(t => /A3B4|ACEAA3B4|ACEAA3|ACEAB4/.test(t));

    // Требуемый класс берём из выведенного профиля — он учитывает и родство
    // марки, и второй источник. Старое сканирование сырых строк оставлено
    // запасным путём: там, где физику вывести не удалось, оно всё ещё лучше,
    // чем ничего. Порядок в нём — от более жидкого к более густому, потому что
    // ошибка «залили гуще» дешевле, чем «залили жиже».
    let requiredClass = null;
    if (!calcState.ignoreApprovals) {
        // Класс выводим из профиля только там, где у машины есть РОДНЫЕ допуска
        // марки. У японцев и корейцев их нет вовсе, и профиль тогда собирается
        // из классов ACEA чужих паспортов — то есть ровно из того шума, ради
        // которого всё и затевалось. Для таких машин работает прежний разбор
        // сырых строк: он хотя бы не выдаёт густое A3/B4 мотору под ILSAC.
        if (analysis && analysis.confidence !== 'low' && analysis.confidence !== 'none') {
            requiredClass = aceaClassOfProfile(analysis.profile);
        }
        if (!requiredClass) {
            if (needA5B5) requiredClass = 'A5B5';
            else if (needC3) requiredClass = 'C3';
            else if (needC2) requiredClass = 'C2';
            else if (needC1) requiredClass = 'C1';
            else if (needA3B4) requiredClass = 'A3B4';
        }
    }

    const poolAll = shopOils.filter(o => o.v === targetVisc && !o.isSpot);

    // Отдельные бонусы «та же марка, что у машины» больше не нужны: родство
    // марки теперь учтено в самом весе допуска (родной допуск = 100, чужой = 0).
    const rateOil = buildOilRater(analysis);

    // Оцениваем ВСЮ вязкость сразу: пикеру нужен полный список, а основной
    // выбор берём из безопасного подмножества.
    const ratedAll = poolAll.map(rateOil);
    for (const r of ratedAll) {
        r.classOk = !requiredClass || oilMeetsClass(r.oil, requiredClass);
        if (!requiredClass) continue;
        if (r.classOk) r.score += 30;
        else r.classMiss = requiredClass;
    }
    ratedAll.sort((a, b) => b.score !== a.score ? b.score - a.score : a.oil.price - b.oil.price);

    // Основной выбор (идёт в отчёт) исключает физически опасные масла и те, у
    // которых нет требуемого класса. Ограничение одностороннее и уже учтено в
    // oilMeetsClass: мотору, которому хватает полнозольного (BMW LL-01), масло
    // C3 подходит — оно строже, а строже всегда безопасно. Обратное
    // (полнозольное в мотор с сажевым фильтром) ловит blocked.
    // Пустой список для оператора хуже компромисса, поэтому условия
    // ослабляются по одному шагу, а не отбрасываются разом.
    let eligible = ratedAll.filter(r => !r.blocked && r.classOk);
    if (!eligible.length) eligible = ratedAll.filter(r => !r.blocked);
    if (!eligible.length) eligible = ratedAll;

    // Про машину не известно ничего: ни допусков, ни выведенного класса (или
    // оператор снял галочку «учитывать допуска»). Тогда «дешевле» не должно
    // означать «жиже»: масло A5/B5 или ILSAC в мотор, рассчитанный на A3/B4, —
    // это тонкая плёнка и износ вкладышей, а обратная ошибка стоит только
    // расхода топлива. Оставляем в выборе густые — то же правило, по которому
    // запасной разбор сырых строк идёт от жидкого к густому.
    if (!requiredClass) {
        const thick = eligible.filter(r => oilMeetsClass(r.oil, 'A3B4'));
        if (thick.length) eligible = thick;
    }

    // Дальше решает ЦЕНА, а не длина паспорта. Масла с одинаковым core
    // закрывают одни и те же обязательства мотора; всё, чем они ещё
    // отличаются, — второстепенные ветки, уровни API и чужие ОЕМ-строки, за
    // которые клиент платить не должен. Раньше здесь бралось масло из СЕРЕДИНЫ
    // ценового ряда (midIdx), то есть калькулятор сознательно предлагал не
    // самое дешёвое из подходящих.
    const sufficient = cheapestFirst(eligible);
    const mid = sufficient.length ? sufficient[0].oil : (eligible[0] || ratedAll[0] || {}).oil || null;

    // Своё масло (SPOT) проходит те же проверки, что и остальные. Раньше оно
    // выбиралось по одному лишь тиру: если ни у одного SPOT не находилось
    // требуемого класса, срабатывал безусловный запасной вариант — и мотору с
    // сажевым фильтром могло уехать полнозольное OPTIMAL. Теперь не подходит —
    // не предлагаем вовсе и объясняем причину.
    const needPro = needA5B5 || needC1 || needC2 || needC3 || isDieselVehicle;
    agg.spotWarn = null;
    const spotRated = shopOils.filter(o => o.isSpot && o.v === targetVisc).map(rateOil);
    for (const r of spotRated) r.classOk = !requiredClass || oilMeetsClass(r.oil, requiredClass);
    const spotFit = spotRated.filter(r => !r.blocked && r.classOk);
    let spot = null;
    if (spotFit.length) {
        const byTier = spotFit.find(r => r.oil.tier === (needPro ? 'pro' : 'optimal'));
        spot = (byTier || spotFit.sort((a, b) => a.oil.price - b.oil.price)[0]).oil;
    } else if (spotRated.length) {
        const worst = spotRated.find(r => r.blocked) || spotRated[0];
        agg.spotWarn = worst.blocked
            ? `SPOT ${targetVisc} не подходит: ${(worst.fitNotes || []).join('; ')}`
            : `у SPOT ${targetVisc} нет требуемого класса ${requiredClass}`;
    }

    agg.approvals = approvals;
    agg.isDiesel = isDieselVehicle;
    agg.requiredClass = requiredClass;
    // Разбор допусков — для подсказок в UI («почему этот допуск важен»)
    agg.approvalAnalysis = analysis;
    agg.allCandidates = ratedAll.map(r => r.oil);
    agg.topCandidates = sufficient.map(r => r.oil);
    // Полный рейтинг с деталями совпадений — для пикера масел в UI. Масла с
    // промахом по классу и заблокированные по физике не прячем: показываем с
    // пометкой, решение за оператором.
    agg.ranked = ratedAll.map(r => ({
        oil: r.oil, score: r.score, core: r.core, direct: r.direct, hier: r.hier,
        classMiss: r.classMiss || null,
        blocked: r.blocked || false,
        fitNotes: r.fitNotes || [],
        // Закрывает все требования, которые вообще закрываются этой вязкостью,
        // и безопасно по физике — такое можно предлагать не глядя.
        sufficient: sufficient.some(s => s.oil === r.oil),
    }));
    return { mid, spot };
}

// Разбор допусков машины с подмешиванием второго источника — продуктов Motul
// по этому же двигателю. Отдельная функция, потому что нужна и обычной ветке
// подбора, и режимам 0W-20/0W-30.
function analyzeApprovalsFor(agg, calcState, approvals) {
    const car = calcState.car || {};
    return analyzeCarApprovals(approvals, {
        make: car.makeShort || car.make || '',
        fuelType: car.fuelType,
        yearFrom: car.yearFrom,
        evidence: specsFromProductNames(agg.motulProducts || []),
    });
}

// ── МКПП: спецификации, под которые у нас нет масла ──────────────────────────
// Для МКПП в наличии только 75W-90 (ZIC GFT / ROLF Professional). Если Motul
// требует 70W, 75W-85, 80W-90 или LS-масло (limited slip — «LS» может стоять
// и до, и после вязкости, важен сам факт), предложить нечего. Пустой список
// продуктов = Motul ответил «products not found» (парсер такие строки
// отбрасывает) — тоже предложить нечего.

const MANUAL_UNSUPPORTED_SPECS = [
    { re: /\b70W\b/i,      label: '70W' },
    { re: /75W[\s-]?85/i,  label: '75W-85' },
    { re: /80W[\s-]?90/i,  label: '80W-90' },
    { re: /\bLS\b/i,       label: 'LS (limited slip)' },
];

export function manualOilWarn(agg) {
    if (agg.key !== 'manual') return null;
    const products = agg.motulProducts || agg.approvals || [];
    if (!products.length) return { reason: 'notFound' };
    for (const p of products) {
        for (const spec of MANUAL_UNSUPPORTED_SPECS) {
            if (spec.re.test(String(p))) {
                return { reason: 'spec', spec: spec.label, product: String(p) };
            }
        }
    }
    return null;
}

export function manualWarnText(warn) {
    if (!warn) return '';
    if (warn.reason === 'notFound') {
        return 'Motul не дал продуктов для МКПП (product not found) — предложить нечего, перевести на мастера';
    }
    return `Motul требует ${warn.spec} («${warn.product}») — такого масла в наличии нет, предложить нечего, перевести на мастера`;
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
    const motulVol = roundL(v0 + vFilter);
    let vService = motulVol;
    let overrideUsed = false;

    const override = roundL(parseFloat((calcState.volumeOverride || {})[agg.key]));
    if (isFinite(override) && override > 0) {
        vService = override;
        overrideUsed = true;
    } else if (agg.group === 'auto' && vService === 0 && calcState.atpVolumeManual) {
        vService = roundL(calcState.atpVolumeManual);
        overrideUsed = true;
    }

    if (agg.group === 'auto' && vService === 0) {
        return { needsVolume: true, costs: [], vCalc: 0, formula: '', volumeStr: '—',
                 vService, motulVol, overrideUsed };
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
            if (calcState.cvtAtfSp3) {
                // Старый вариатор на ATF SP-III: подходит только ROLF
                // Professional ATF Multi (в допусках Mitsubishi/Hyundai SP-III)
                oil1 = defaults.atf.rolfMulti; oil2 = null;
            } else {
                oil1 = defaults.cvt[0]; oil2 = defaults.cvt[1];
            }
        } else {
            const picked = pickAtfOils(agg.approvals || [], defaults.atf);
            oil1 = picked.oil1; oil2 = picked.oil2;
            agg.atfWarn = picked.noMatch;
        }
    } else {
        const mkppWarn = manualOilWarn(agg);
        if (mkppWarn) {
            agg.mkppWarn = mkppWarn;
            return { mkppWarn, costs: [], vCalc, formula, volumeStr,
                     vService, motulVol, overrideUsed };
        }
        agg.mkppWarn = null;
        const isCvtGear = agg.rawText && /CVT/i.test(agg.rawText);
        const defs = isCvtGear ? defaults.cvt : defaults.gear75W90;
        oil1 = defs[0]; oil2 = defs[1];
    }

    // Cost calculation
    const calcFlushCost = (vol) => {
        if (calcState.flush === '5min') {
            return { cost: 1180, breakdown: '630 (промыв.масло) + 550 (услуга)', label: '5-минутка' };
        }
        if (calcState.flush === 'full') {
            const litres  = +(vol * 0.9).toFixed(1);
            const oilCost = Math.round(litres * 350);
            return { cost: oilCost + 550, breakdown: `${litres}л × 350 + 550 (услуга)`, label: 'полная промывка' };
        }
        return null;
    };
    const flush = calcFlushCost(vCalc);

    const costs = [oil1, oil2].filter(Boolean).map(oil => {
        const price = oil.price;
        let total, breakdown;
        if (agg.group === 'engine') {
            const fTotal    = filtersTotal(calcState);
            const flushAdd  = flush ? flush.cost : 0;
            total = price * vCalc + fTotal + flushAdd;
            const parts = [`${price} × ${vCalc}`];
            if (fTotal > 0) parts.push(`${fTotal} (фильтра)`);
            if (flush) parts.push(`${flush.cost} (${flush.label})`);
            breakdown = parts.join(' + ');
        } else if (agg.group === 'auto') {
            const isPartial = calcState.atpType === 'partial';
            const baseLabor = 550 + (isPartial ? 1210 : 0);
            const laborParts = ['550'];
            if (isPartial) laborParts.push('1210');
            if (isCvt) {
                const fltC = calcState.cvtFilterCoarse ? 1700 : 0;
                const fltF = calcState.cvtFilterFine   ? 3350 : 0;
                total = price * vCalc + baseLabor + fltC + fltF;
                const fltParts = [];
                if (fltC) fltParts.push('1700 грубый');
                if (fltF) fltParts.push('3350 тонкий');
                breakdown = `${price} × ${vCalc} + ${laborParts.join(' + ')}${fltParts.length ? ' + ' + fltParts.join(' + ') : ''}`;
            } else {
                const flt = calcState.atpFilter ? 1700 : 0;
                total = price * vCalc + baseLabor + flt;
                breakdown = `${price} × ${vCalc} + ${laborParts.join(' + ')}${flt ? ' + 1700 (фильтр)' : ''}`;
            }
        } else {
            const labor = 1900 + 550;
            total = price * vCalc + labor;
            breakdown = `${price} × ${vCalc} + 1900 + 550`;
        }
        return { oil, total: Math.round(total), breakdown };
    });

    // Клиенту первым называем то, что дешевле, а дорогое остаётся вариантом на
    // выбор. Порядок «сначала брендовое, потом SPOT» был историческим: слот
    // определял происхождение масла, а не цену, и в отчёт первой строкой уходил
    // вариант на 500–1000 ₽ дороже подходящего.
    if (agg.group === 'engine') costs.sort((a, b) => a.total - b.total);

    return { costs, vCalc, formula, volumeStr, vService, motulVol, overrideUsed, flush };
}

// ── Totals ────────────────────────────────────────────────────────────────────

export function totalAggLabel(agg) {
    if (agg.labelOverride && agg.label) return agg.label.toLowerCase();
    if (agg.key === 'engine')    return 'двс';
    if (agg.key === 'automatic') return agg.isCvt ? 'вариатор' : 'акпп';
    if (agg.key === 'manual')    return 'мкпп';
    if (agg.key === 'transfer')  return 'раздатка';
    if (agg.key === 'diffFront') return 'диф.перед';
    if (agg.key === 'diffRear')  return 'диф.зад';
    return (agg.label || agg.key).toLowerCase();
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
