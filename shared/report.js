// ─────────────────────────────────────────────────────────────────────────────
// Shared report builder — pure text output, no DOM.
// buildReport(car, data, calcState, carApprovals) → string
// The produced string is byte-for-byte identical whether the call comes from
// the userscript or the frontend, because both import this same module.
// ─────────────────────────────────────────────────────────────────────────────

import { roundL, calcForAggregate, getAggregates, filtersTotal,
         totalAggLabel, totalOilLabel, computeTotalSum } from './calculator.js';

// ── Per-aggregate text block ──────────────────────────────────────────────────

export function formatAggText(agg, calc, calcState) {
    const lines = [];
    const mileage = calcState.mileage;
    const isFixedSingle = mileage === '>=200';
    const is0w20        = mileage === '0w20';

    if (agg.group === 'engine') {
        const v0       = roundL(parseFloat(agg.volume || 0));
        const vFilter  = roundL(parseFloat(agg.filterVolume || 0));
        const vService = roundL(v0 + vFilter);
        lines.push(`двс (${vService || calc.vCalc}л)`);

        const f = calcState.filters;
        if (f.vf.enabled && f.vf.name && f.vf.price) {
            const workLbl = f.vf.work === 350 ? 'защёлки' : f.vf.work === 600 ? 'болты' : 'разбор';
            lines.push(`вф ${f.vf.name} - ${f.vf.price}₽ (${workLbl} ${f.vf.work}₽)`);
        }
        if (f.mf.enabled && f.mf.name && f.mf.price) {
            lines.push(`мф ${f.mf.name} - ${f.mf.price}₽`);
        }
        if (f.sf.enabled && f.sf.name && f.sf.price) {
            const workLbl = f.sf.work === 550 ? 'бардачок' : 'под педалью';
            lines.push(`сф ${f.sf.name} - ${f.sf.price}₽ (${workLbl} ${f.sf.work}₽)`);
        }

        if (calcState.flush === '5min') {
            lines.push(`промывка двс (5-минутка) - 1180₽ (630 + 550 услуга)`);
        } else if (calcState.flush === 'full') {
            const litres  = +(calc.vCalc * 0.9).toFixed(1);
            const oilCost = Math.round(litres * 300);
            lines.push(`промывка двс (полная) - ${oilCost + 550}₽ (${litres}л × 300₽ + 550 услуга)`);
        }

        if (lines.length > 1) lines.push('');

        if (isFixedSingle) {
            calc.costs.slice(0, 1).forEach(c => {
                const sumpLine = calcState.showWithSump ? ` + 550₽ (картер) = ${c.total + 550}₽` : '';
                lines.push(`${c.oil.b} ${c.oil.n} ${c.oil.price}₽/л = ${c.total}₽${sumpLine}`);
            });
        } else if (is0w20) {
            calc.costs.forEach(c => {
                const sumpLine = calcState.showWithSump ? ` + 550₽ (картер) = ${c.total + 550}₽` : '';
                lines.push(`${c.oil.b} ${c.oil.n} ${c.oil.price}₽/л = ${c.total}₽${sumpLine}`);
            });
        } else {
            calc.costs.forEach(c => {
                const base     = `${c.oil.b} ${c.oil.n} ${c.oil.price}₽/л = ${c.total}₽`;
                const sumpLine = calcState.showWithSump
                    ? ` + 550₽ (картер) = ${c.total + 550}₽`
                    : ' + 550р (с\\у\\з\\к)';
                lines.push(base + sumpLine);
            });
        }
    } else if (agg.group === 'auto') {
        const isCvt    = agg.isCvt;
        const isPartial = calcState.atpType === 'partial';
        const typeTxt  = isPartial ? 'част' : 'полн';
        const pct      = !isPartial ? '150%' : (isCvt ? '80%' : '60%');
        const vService = roundL(parseFloat(agg.volume || 0) + parseFloat(agg.filterVolume || 0))
            || roundL((calcState.volumeOverride || {})[agg.key])
            || roundL(calcState.atpVolumeManual)
            || 0;
        const label = isCvt ? 'вариатор' : 'акпп';
        lines.push(`${label} (серв ${vService}л)`);
        const extras = [];
        if (isPartial) extras.push('работа 1210₽');
        if (isCvt) {
            if (calcState.cvtFilterCoarse) extras.push('фильтр грубый 1700₽');
            if (calcState.cvtFilterFine)   extras.push('фильтр тонкий 3350₽');
        } else {
            if (calcState.atpFilter) extras.push('фильтр 1700₽');
        }
        const extraTxt = extras.length ? ' + ' + extras.join(' + ') : '';
        lines.push(`${typeTxt} (${calc.vCalc}л / ${pct})${extraTxt}`);
        if (!isCvt && agg.atfWarn) lines.push('⚠ подходящих масел в наличии нет — перевести на мастера');
        calc.costs.forEach(c => lines.push(`${c.oil.b} ${c.oil.n} ${c.oil.price}₽/л = ${c.total}₽`));
    } else {
        const vService = (parseFloat(agg.volume || 0) + parseFloat(agg.filterVolume || 0)).toFixed(1);
        lines.push(`${agg.label.toLowerCase()} (${vService}л)`);
        calc.costs.forEach(c => lines.push(`${c.oil.b} ${c.oil.n} ${c.oil.price}₽/л = ${c.total}₽`));
    }
    return lines.join('\n');
}

// ── Totals block ──────────────────────────────────────────────────────────────

export function buildTotalsLines(calcState, data, carApprovals) {
    if (!calcState || !calcState.totals || !calcState.totals.length) return [];

    const aggs = getAggregates(data).filter(a => calcState.selected.has(a.key));
    const aggData = aggs
        .map(agg => ({ agg, calc: calcForAggregate(agg, calcState, carApprovals) }))
        .filter(x => x.calc.costs && x.calc.costs.length);

    const lines = [];
    for (const tot of calcState.totals) {
        const parts = []; let sum = 0; let hasEngine = false;
        for (const { agg, calc } of aggData) {
            const sel = tot[agg.key];
            if (sel === undefined || sel === 'skip') continue;
            const c = calc.costs[sel];
            if (!c) continue;
            parts.push(`${c.total}(${totalAggLabel(agg)} ${totalOilLabel(c.oil)})`);
            sum += c.total;
            if (agg.key === 'engine') hasEngine = true;
        }
        if (!parts.length) continue;
        if (calcState.showWithSump && hasEngine) {
            lines.push(`${parts.join(' + ')} + 550(картер) = ${sum + 550}₽`);
        } else {
            lines.push(`${parts.join(' + ')} = ${sum}₽`);
        }
    }
    return lines;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Build the full plain-text report for the Bitrix lead field.
 * @param {object} car        - car object with makeShort, modelShort, etc.
 * @param {object} data       - fluid/aggregate data object
 * @param {object} calcState  - full calculator state
 * @param {string[]} carApprovals - engine oil approvals from Ravenol/Rolf lookup
 * @returns {string}
 */
export function buildReport(car, data, calcState, carApprovals) {
    const aggs  = getAggregates(data);
    const parts = [];

    // Car header line
    const carParts = [];
    if (car.makeShort)  carParts.push(car.makeShort);
    if (car.modelShort) carParts.push(car.modelShort);
    if (car.engineName) carParts.push(car.engineName);
    else if (car.volume) carParts.push(car.volume);
    if (car.yearFrom) carParts.push(String(car.yearFrom));
    if (car.bhp)  carParts.push(car.bhp + 'лс');
    else if (car.kw) carParts.push(car.kw + 'кВт');
    const carLine = carParts.join(' ');
    if (carLine) parts.push(carLine);

    // Aggregate blocks
    for (const agg of aggs) {
        if (!calcState.selected.has(agg.key)) continue;
        const calc = calcForAggregate(agg, calcState, carApprovals);
        if (calc.isHighGear) { parts.push(`${agg.label} - послан в баню!`); continue; }
        parts.push(formatAggText(agg, calc, calcState));
    }

    // Totals
    const totalsLines = buildTotalsLines(calcState, data, carApprovals);
    if (totalsLines.length) parts.push(totalsLines.join('\n'));

    return parts.join('\n\n') || '— выберите агрегаты для подсчёта —';
}
