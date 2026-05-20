// ─────────────────────────────────────────────────────────────────────────────
// Frontend calculator UI.
// Reads car data from a DB record, renders the same oil-selection / mileage /
// service UI as the userscript, and produces an identical Bitrix report via
// the shared buildReport() function.
// ─────────────────────────────────────────────────────────────────────────────

import { getShopOils, getDefaults } from '../../shared/oils.js';
import {
    roundL, getAggregates, shouldDefaultToPartial,
    filtersTotal, anyFilterEnabled, calcForAggregate,
    pickAtfOils, totalAggLabel, totalOilLabel, computeTotalSum,
} from '../../shared/calculator.js';
import { buildReport } from '../../shared/report.js';

// ── Public entry point ────────────────────────────────────────────────────────

export function initCalculator(dbRecord, onBack) {
    const car = dbRecordToCar(dbRecord);
    const data = dbRecordToData(dbRecord);

    // carApprovals: for the frontend we don't have a live Rolf lookup.
    // Engine oil spec matching is disabled (ignoreApprovals defaults to false
    // but there are no stored approvals). The user can enable ignoreApprovals.
    const carApprovals = [];

    const defaultPartial = shouldDefaultToPartial(car, data);

    let calcState = {
        mileage: '<100',
        atpType: defaultPartial ? 'partial' : 'full',
        atpFilter: false,
        cvtFilterCoarse: false,
        cvtFilterFine: false,
        atpVolumeManual: null,
        volumeOverride: {},
        selected: new Set(),
        showApprovals: new Set(),
        expandedOilApp: new Set(),
        oilOverride: {},
        showOilPicker: null,
        ignoreApprovals: false,
        showWithSump: false,
        flush: 'none',
        filters: dbFiltersFromRecord(dbRecord),
        filtersRaw: '',
        totals: [],
        data,
        car,
    };

    if (data.engine) calcState.selected.add('engine');

    // Set car title
    const titleParts = [car.makeShort, car.modelShort, car.engineName || car.volume || '',
                        car.yearFrom ? String(car.yearFrom) : ''].filter(Boolean);
    document.getElementById('calc-car-title').textContent = titleParts.join(' ');

    // Render calculator controls
    const main = document.getElementById('calc-main');
    renderCalcControls(main, car, data, calcState, carApprovals);

    // Copy button
    const copyBtn = document.getElementById('btn-copy');
    copyBtn.onclick = () => {
        const text = document.getElementById('report-output').textContent;
        if (!text || text.startsWith('—')) return;
        navigator.clipboard.writeText(text).then(() => {
            const orig = copyBtn.textContent;
            copyBtn.textContent = '✓ скопировано';
            setTimeout(() => { copyBtn.textContent = orig; }, 1500);
        });
    };

    function rerender() {
        renderCalcControls(main, car, data, calcState, carApprovals);
        updateReport(calcState, data, car, carApprovals);
    }

    // Initial report
    updateReport(calcState, data, car, carApprovals);

    // Expose rerender for event handlers
    window.__zmRerender = rerender;
}

// ── Report update ─────────────────────────────────────────────────────────────

function updateReport(calcState, data, car, carApprovals) {
    const text = buildReport(car, data, calcState, carApprovals);
    const el = document.getElementById('report-output');
    if (el) el.textContent = text;
}

// ── Main render ───────────────────────────────────────────────────────────────

function renderCalcControls(container, car, data, calcState, carApprovals) {
    container.innerHTML = `
        ${renderControls(calcState)}
        ${renderFiltersSection(calcState)}
        ${renderAggregates(data, calcState, carApprovals)}
        ${renderTotals(data, calcState, carApprovals)}
    `;
    bindEvents(container, car, data, calcState, carApprovals);
}

function renderControls(calcState) {
    const chip = (val, label, extra = '') =>
        `<button class="chip${calcState.mileage === val ? ' active' : ''}" data-mileage="${val}">${label}</button>`;
    const flushChip = (val, label) =>
        `<button class="chip flush${calcState.flush === val ? ' active' : ''}" data-flush="${val}">${label}</button>`;

    return `
        <div class="ctrl-section">
            <div class="ctrl-row">
                <span class="ctrl-lbl">Пробег:</span>
                ${chip('<100',   'до 100т')}
                ${chip('>=100',  '100т+')}
                ${chip('>=200',  '200т+')}
                ${chip('0w20',   '0W-20')}
            </div>
            <div class="ctrl-row" style="margin-top:8px">
                <label class="chk-label">
                    <input type="checkbox" id="chk-ignore-approvals" ${calcState.ignoreApprovals ? 'checked' : ''}/>
                    <span style="color:#ff9800">🔓 Игнорировать допуска</span>
                </label>
                <label class="chk-label">
                    <input type="checkbox" id="chk-sump" ${calcState.showWithSump ? 'checked' : ''}/>
                    <span style="color:#81c784">🪣 С картером (+550₽)</span>
                </label>
            </div>
            <div class="ctrl-row" style="margin-top:8px">
                <span class="ctrl-lbl">🧪 Промывка ДВС:</span>
                ${flushChip('none', 'без промывки')}
                ${flushChip('5min', '5-минутка')}
                ${flushChip('full', 'полная')}
            </div>
        </div>
    `;
}

// ── Filters section ───────────────────────────────────────────────────────────

function renderFiltersSection(calcState) {
    const f = calcState.filters;
    const hasAny = (f.vf.name && f.vf.name !== '[нет]') || (f.mf.name && f.mf.name !== '[нет]') || (f.sf.name && f.sf.name !== '[нет]');
    const open = calcState.showFiltersInput || hasAny;

    if (!open) {
        return `<div class="filters-section"><button class="btn-add-filters" id="btn-add-filters">➕ Добавить фильтры ДВС</button></div>`;
    }

    const filterRow = (key, abbr, label, workOpts) => {
        const fd = f[key];
        const partNum = fd.name === '[нет]' ? '' : (fd.name || '');
        const workSel = workOpts ? `
            <select data-filter-work="${key}" style="background:var(--bg2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 6px;font-size:11px">
                ${workOpts.map(o => `<option value="${o.v}" ${fd.work === o.v ? 'selected' : ''}>${o.l}</option>`).join('')}
            </select>` : '';
        return `
            <div class="filter-row">
                <label title="${label}">${abbr}</label>
                <input type="text" data-filter-part="${key}" placeholder="артикул" value="${esc(partNum)}" style="flex:1"/>
                <input type="number" data-filter-price="${key}" placeholder="₽" value="${fd.price || ''}" min="0" style="width:70px"/>
                ${workSel}
                <label class="chk-label" style="white-space:nowrap">
                    <input type="checkbox" data-filter-on="${key}" ${fd.enabled ? 'checked' : ''}/>
                    вкл
                </label>
            </div>
        `;
    };

    return `
        <div class="filters-section ctrl-section">
            <div style="font-size:12px;font-weight:bold;margin-bottom:8px;color:#a0b0c0">🔧 Фильтры ДВС</div>
            ${filterRow('vf', 'вф', 'Масляный фильтр', [{v:350,l:'защёлки 350₽'},{v:600,l:'болты 600₽'},{v:1200,l:'разбор 1200₽'}])}
            ${filterRow('mf', 'мф', 'Воздушный фильтр', null)}
            ${filterRow('sf', 'сф', 'Салонный фильтр', [{v:550,l:'бардачок 550₽'},{v:800,l:'под педалью 800₽'}])}
        </div>
    `;
}

// ── Aggregates ────────────────────────────────────────────────────────────────

function renderAggregates(data, calcState, carApprovals) {
    const aggs = getAggregates(data);
    return aggs.map(agg => renderAggCard(agg, calcState, carApprovals)).join('');
}

function renderAggCard(agg, calcState, carApprovals) {
    const sel = calcState.selected.has(agg.key);
    const calc = calcForAggregate(agg, calcState, carApprovals);

    let body = '';
    if (sel) {
        if (calc.isHighGear) {
            body = '<div class="warn-box">⚠ HIGH GEAR — нельзя обслуживать стандартно. Передай мастеру.</div>';
        } else if (calc.needsVolume) {
            body = `
                <div class="warn-box">⚠ Motul не дал объём заправки. Введи вручную:</div>
                <div class="agg-volume" style="margin-top:8px">
                    <span class="ctrl-lbl">Объём (л):</span>
                    <input type="number" step="0.1" min="0" class="filter-row input vol-input"
                        data-vol-key="${agg.key}" value="${calcState.volumeOverride[agg.key] || ''}" placeholder="?"/>
                </div>
            `;
        } else {
            body = renderAggBody(agg, calc, calcState, carApprovals);
        }
    }

    return `
        <div class="agg-card">
            <div class="agg-header">
                <input type="checkbox" class="agg-check" data-agg-key="${agg.key}" ${sel ? 'checked' : ''}/>
                <span class="agg-title">${agg.label}</span>
                ${calc.volumeStr ? `<span style="font-size:12px;color:var(--sub);margin-left:auto">${calc.volumeStr}</span>` : ''}
            </div>
            ${sel ? `<div class="agg-body">${body}</div>` : ''}
        </div>
    `;
}

function renderAggBody(agg, calc, calcState, carApprovals) {
    const parts = [];

    // Volume edit
    parts.push(`
        <div class="agg-volume">
            <span class="ctrl-lbl">Объём:</span>
            <input type="number" step="0.1" min="0" class="vol-input"
                data-vol-key="${agg.key}" value="${calcState.volumeOverride[agg.key] || ''}"
                placeholder="${roundL(parseFloat(agg.volume||0) + parseFloat(agg.filterVolume||0)) || '?'}"/>
            <span class="vol-formula">${calc.formula}</span>
        </div>
    `);

    // АКПП-specific controls
    if (agg.group === 'auto') {
        const isCvt = agg.isCvt;
        parts.push(`
            <div class="atp-ctrl">
                <button class="chip${calcState.atpType === 'partial' ? ' active' : ''}" data-atp="partial">частичная</button>
                <button class="chip${calcState.atpType === 'full'    ? ' active' : ''}" data-atp="full">полная (150%)</button>
            </div>
            <div class="ctrl-row">
                ${isCvt ? `
                    <label class="chk-label"><input type="checkbox" data-atp-flag="cvtFilterCoarse" ${calcState.cvtFilterCoarse?'checked':''}/> Фильтр грубый (+1700₽)</label>
                    <label class="chk-label"><input type="checkbox" data-atp-flag="cvtFilterFine"   ${calcState.cvtFilterFine?'checked':''}/> Фильтр тонкий (+3350₽)</label>
                ` : `
                    <label class="chk-label"><input type="checkbox" data-atp-flag="atpFilter" ${calcState.atpFilter?'checked':''}/> Фильтр (+1700₽)</label>
                `}
            </div>
        `);
        if (calc.costs && agg.atfWarn) {
            parts.push('<div class="warn-box">⚠ подходящих масел в наличии нет — перевести на мастера</div>');
        }
    }

    // Oil options
    if (calc.costs && calc.costs.length) {
        const oilOverrideKey = calcState.oilOverride?.[agg.key + '_mid'];
        const mileage = calcState.mileage;
        const showAll = calcState.ignoreApprovals || mileage === '0w20';

        // For 200k+ only show the first option
        const displayedCosts = mileage === '>=200' ? calc.costs.slice(0, 1) : calc.costs;

        parts.push(displayedCosts.map((c, i) => {
            const isSelected = oilOverrideKey
                ? (c.oil.b + '_' + c.oil.n) === oilOverrideKey
                : i === 0;
            const approvalBadges = (c.oil.a || []).slice(0, 6).map(a =>
                `<span class="appr-hit">${esc(a)}</span>`).join(' ');

            return `
                <div class="oil-option${isSelected ? ' selected' : ''}" data-oil-pick="${agg.key}" data-oil-idx="${i}">
                    <div class="oil-name">${esc(c.oil.b)} ${esc(c.oil.n)}</div>
                    <div class="oil-price">${c.oil.price}₽/л · ${esc(c.oil.v)}</div>
                    <div class="oil-total">= ${c.total}₽</div>
                    ${approvalBadges ? `<div class="oil-approvals">${approvalBadges}</div>` : ''}
                </div>
            `;
        }).join(''));

        // Override picker: show all candidates if more than 2 options available
        const allCandidates = agg.allCandidates || [];
        if (allCandidates.length > 2 && agg.group === 'engine' && showAll) {
            parts.push(`
                <details style="margin-top:6px">
                    <summary style="font-size:11px;color:var(--sub);cursor:pointer">Другие варианты (${allCandidates.length})</summary>
                    <div style="margin-top:6px">
                        ${allCandidates.map((oil, i) => `
                            <div class="oil-option" data-oil-override="${agg.key}" data-oil-override-idx="${i}" style="font-size:12px">
                                ${esc(oil.b)} ${esc(oil.n)} — ${oil.price}₽/л
                            </div>
                        `).join('')}
                    </div>
                </details>
            `);
        }
    }

    return parts.join('');
}

// ── Totals section ────────────────────────────────────────────────────────────

function renderTotals(data, calcState, carApprovals) {
    if (!calcState.totals.length) {
        return `<div class="totals-section"><button class="btn-add-filters" id="btn-add-total">+ Добавить строку итого</button></div>`;
    }

    const aggs = getAggregates(data).filter(a => calcState.selected.has(a.key));
    const aggData = aggs
        .map(agg => ({ agg, calc: calcForAggregate(agg, calcState, carApprovals) }))
        .filter(x => x.calc.costs && x.calc.costs.length);

    const blocksHtml = calcState.totals.map((tot, idx) => {
        const rowsHtml = aggData.map(({ agg, calc }) => {
            const sel = tot[agg.key];
            const opts = calc.costs.map((c, i) => `
                <label class="total-opt">
                    <input type="radio" name="tot-${idx}-${agg.key}" data-tot="${idx}" data-tagg="${agg.key}" value="${i}" ${sel === i ? 'checked' : ''}/>
                    ${esc(totalOilLabel(c.oil))} — ${c.total}₽
                </label>
            `).join('');
            const skipChecked = (sel === undefined || sel === 'skip') ? 'checked' : '';
            return `
                <div style="margin-bottom:8px">
                    <div class="total-row-h">${totalAggLabel(agg).toUpperCase()}</div>
                    ${opts}
                    <label class="total-opt" style="color:var(--sub)">
                        <input type="radio" name="tot-${idx}-${agg.key}" data-tot="${idx}" data-tagg="${agg.key}" value="skip" ${skipChecked}/>
                        не включать
                    </label>
                </div>
            `;
        }).join('');

        const { sum, hasEngine } = computeTotalSum(tot, aggData);
        const sumpAdd = calcState.showWithSump && hasEngine ? 550 : 0;
        const display = sum + sumpAdd;
        const sumpSuffix = sumpAdd ? ` + 550₽ картер = <b>${display}₽</b>` : '';

        return `
            <div class="total-block">
                <div class="total-block-h">
                    <span>Стоимость #${idx + 1}: <b>${sum}₽</b>${sumpSuffix}</span>
                    <button class="btn btn-sec" data-tot-del="${idx}" style="padding:3px 8px;font-size:11px">✕</button>
                </div>
                ${rowsHtml}
            </div>
        `;
    }).join('');

    return `
        <div class="totals-section">
            ${blocksHtml}
            <button class="btn-add-filters" id="btn-add-total">+ Добавить строку итого</button>
        </div>
    `;
}

// ── Event binding ─────────────────────────────────────────────────────────────

function bindEvents(container, car, data, calcState, carApprovals) {
    function rerender() {
        renderCalcControls(container, car, data, calcState, carApprovals);
        const text = buildReport(car, data, calcState, carApprovals);
        const el = document.getElementById('report-output');
        if (el) el.textContent = text;
    }

    // Mileage chips
    container.querySelectorAll('[data-mileage]').forEach(b => {
        b.onclick = () => { calcState.mileage = b.dataset.mileage; rerender(); };
    });

    // Flush chips
    container.querySelectorAll('[data-flush]').forEach(b => {
        b.onclick = () => { calcState.flush = b.dataset.flush; rerender(); };
    });

    // Ignore approvals
    const ignChk = container.querySelector('#chk-ignore-approvals');
    if (ignChk) ignChk.onchange = () => { calcState.ignoreApprovals = ignChk.checked; rerender(); };

    // Sump
    const sumpChk = container.querySelector('#chk-sump');
    if (sumpChk) sumpChk.onchange = () => { calcState.showWithSump = sumpChk.checked; rerender(); };

    // Aggregate checkboxes
    container.querySelectorAll('[data-agg-key]').forEach(chk => {
        chk.onchange = () => {
            if (chk.checked) calcState.selected.add(chk.dataset.aggKey);
            else calcState.selected.delete(chk.dataset.aggKey);
            rerender();
        };
    });

    // Volume overrides
    container.querySelectorAll('[data-vol-key]').forEach(inp => {
        inp.oninput = () => {
            const v = parseFloat(inp.value);
            if (isFinite(v) && v > 0) calcState.volumeOverride[inp.dataset.volKey] = v;
            else delete calcState.volumeOverride[inp.dataset.volKey];
            rerender();
        };
    });

    // Filter part / price / work / toggle
    container.querySelectorAll('[data-filter-part]').forEach(inp => {
        inp.oninput = () => {
            calcState.filters[inp.dataset.filterPart].name = inp.value.trim();
            rerender();
        };
    });
    container.querySelectorAll('[data-filter-price]').forEach(inp => {
        inp.oninput = () => {
            calcState.filters[inp.dataset.filterPrice].price = parseInt(inp.value) || 0;
            rerender();
        };
    });
    container.querySelectorAll('[data-filter-work]').forEach(sel => {
        sel.onchange = () => {
            calcState.filters[sel.dataset.filterWork].work = parseInt(sel.value);
            rerender();
        };
    });
    container.querySelectorAll('[data-filter-on]').forEach(chk => {
        chk.onchange = () => {
            calcState.filters[chk.dataset.filterOn].enabled = chk.checked;
            rerender();
        };
    });

    // Add filters button
    const addFiltBtn = container.querySelector('#btn-add-filters');
    if (addFiltBtn) addFiltBtn.onclick = () => { calcState.showFiltersInput = true; rerender(); };

    // АКПП type
    container.querySelectorAll('[data-atp]').forEach(b => {
        b.onclick = () => { calcState.atpType = b.dataset.atp; rerender(); };
    });
    container.querySelectorAll('[data-atp-flag]').forEach(chk => {
        chk.onchange = () => { calcState[chk.dataset.atpFlag] = chk.checked; rerender(); };
    });

    // Oil selection
    container.querySelectorAll('[data-oil-pick]').forEach(el => {
        el.onclick = () => {
            const key = el.dataset.oilPick;
            const idx = parseInt(el.dataset.oilIdx);
            const agg = getAggregates(data).find(a => a.key === key);
            if (!agg) return;
            const calc = calcForAggregate(agg, calcState, carApprovals);
            const oil = calc.costs[idx]?.oil;
            if (oil) calcState.oilOverride[key + '_mid'] = oil.b + '_' + oil.n;
            rerender();
        };
    });
    container.querySelectorAll('[data-oil-override]').forEach(el => {
        el.onclick = () => {
            const key = el.dataset.oilOverride;
            const idx = parseInt(el.dataset.oilOverrideIdx);
            const agg = getAggregates(data).find(a => a.key === key);
            if (!agg) return;
            const oil = (agg.allCandidates || [])[idx];
            if (oil) calcState.oilOverride[key + '_mid'] = oil.b + '_' + oil.n;
            rerender();
        };
    });

    // Totals
    const addTotBtn = container.querySelector('#btn-add-total');
    if (addTotBtn) addTotBtn.onclick = () => { calcState.totals.push({}); rerender(); };

    container.querySelectorAll('[data-tot-del]').forEach(b => {
        b.onclick = () => { calcState.totals.splice(parseInt(b.dataset.totDel), 1); rerender(); };
    });
    container.querySelectorAll('input[data-tot]').forEach(r => {
        r.onchange = () => {
            const ti  = parseInt(r.dataset.tot);
            const ak  = r.dataset.tagg;
            const val = r.value === 'skip' ? 'skip' : parseInt(r.value);
            if (!calcState.totals[ti]) calcState.totals[ti] = {};
            calcState.totals[ti][ak] = val;
            rerender();
        };
    });
}

// ── Data conversion ───────────────────────────────────────────────────────────

function dbRecordToCar(rec) {
    return {
        makeShort:   rec.brand,
        modelShort:  rec.model,
        make:        rec.brand,
        model:       rec.model,
        engineCode:  rec.engine_code   || '',
        engineName:  rec.engine_name   || '',
        fuelType:    rec.fuel_type     || '',
        volume:      rec.engine_volume ? String(rec.engine_volume) : '',
        ccm:         '',
        kw:          rec.kw            || '',
        bhp:         rec.bhp           || '',
        yearFrom:    rec.year_from     || '',
        cacheKey:    rec.id,
        query:       [rec.brand, rec.model, rec.engine_name].filter(Boolean).join(' '),
    };
}

function dbRecordToData(rec) {
    const fc = rec.fluid_capacities || {};
    const out = {};
    if (fc.engine)    out.engine    = { ...fc.engine };
    if (fc.automatic) out.automatic = { ...fc.automatic };
    if (fc.manual)    out.manual    = { ...fc.manual };
    if (fc.transfer)  out.transfer  = { ...fc.transfer };
    if (fc.diffFront) out.diffFront = { ...fc.diffFront };
    if (fc.diffRear)  out.diffRear  = { ...fc.diffRear };
    if (rec.motul_name) out.motulName = rec.motul_name;
    return out;
}

function dbFiltersFromRecord(rec) {
    const fpn = rec.filter_part_numbers || {};
    const defaults = {
        vf: { name: '', price: 0, enabled: false, work: 350 },
        mf: { name: '', price: 0, enabled: false },
        sf: { name: '', price: 0, enabled: false, work: 550 },
    };
    for (const key of ['vf', 'mf', 'sf']) {
        const entry = fpn[key];
        if (!entry) continue;
        if (entry.absent) {
            defaults[key].name = '[нет]';
        } else if (entry.part) {
            defaults[key].name    = entry.part;
            defaults[key].enabled = true;
        }
    }
    return defaults;
}

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
