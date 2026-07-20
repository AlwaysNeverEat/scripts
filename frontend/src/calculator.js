import { getShopOils, getDefaults } from '../../shared/oils.js';
import {
    roundL, getAggregates, shouldDefaultToPartial,
    filtersTotal, anyFilterEnabled, calcForAggregate,
    pickAtfOils, totalAggLabel, totalOilLabel, computeTotalSum,
    splitOilApprovals, matchOilToReglament, manualWarnText,
} from '../../shared/calculator.js';
import { buildReport } from '../../shared/report.js';
import { extractViscosity } from '../../shared/crmAnalyse.js';

// ── Копирование в буфер ────────────────────────────────────────────────────────
// navigator.clipboard доступен только в secure context (HTTPS) и при фокусе на
// странице, а без .catch() промис молча падал — поэтому кнопка «Копировать» иногда
// «не работала». Пробуем современный API, при отказе — откат на скрытую textarea.
function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
    }
    return legacyCopy(text);
}

function legacyCopy(text) {
    return new Promise((resolve, reject) => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error('copy failed'));
    });
}

// ── Public entry point ────────────────────────────────────────────────────────

export function initCalculator(dbRecord) {
    const car = dbRecordToCar(dbRecord);
    const data = dbRecordToData(dbRecord);
    const carApprovals = Array.isArray(dbRecord.car_approvals) ? dbRecord.car_approvals : [];

    // Ручные правки списка масел, сохранённые для этой машины («Нашли ошибку?»)
    const ov = dbRecord.oil_overrides || {};
    const excludeOils = new Set(Array.isArray(ov.exclude) ? ov.exclude : []);
    const pinnedOverride = (ov.pin && typeof ov.pin === 'object') ? { ...ov.pin } : {};

    const defaultPartial = shouldDefaultToPartial(car, data);

    let calcState = {
        mileage: '<100',
        atpType: defaultPartial ? 'partial' : 'full',
        atpFilter: false,
        cvtFilterCoarse: false,
        cvtFilterFine: false,
        cvtAtfSp3: false,
        atpVolumeManual: null,
        volumeOverride: {},
        selected: new Set(),
        showApprovals: new Set(),
        expandedOilApp: new Set(),
        oilOverride: pinnedOverride,
        excludeOils,
        showOilPicker: null,
        ignoreApprovals: false,
        showWithSump: false,
        flush: 'none',
        filters: dbFiltersFromRecord(dbRecord),
        articles: dbArticlesFromRecord(dbRecord),
        carId: dbRecord.id,
        showFiltersInput: false,
        totals: [],
        crmStock: null,          // { visc, stock: {'b_n': литры} } — наличие с панели CRM
        data,
        car,
    };

    // Стоимости фильтров, вставленные ранее — живут в localStorage, не в БД
    const savedFilters = loadSavedFilters(dbRecord.id);
    if (savedFilters) {
        for (const k of ['vf', 'mf', 'sf']) {
            if (savedFilters[k]) calcState.filters[k] = { ...calcState.filters[k], ...savedFilters[k] };
        }
    }
    // Пока стоимости не вставлены — поле вставки открыто сразу
    calcState.showFiltersInput = !anyFilterPriced(calcState.filters);

    if (data.engine) calcState.selected.add('engine');

    const titleParts = [car.makeShort, car.modelShort, car.engineName || car.volume || '',
                        car.yearFrom ? String(car.yearFrom) : ''].filter(Boolean);
    document.getElementById('calc-car-title').textContent = titleParts.join(' ');

    const main = document.getElementById('calc-main');
    renderCalcControls(main, car, data, calcState, carApprovals);

    const copyBtn = document.getElementById('btn-copy');
    copyBtn.onclick = () => {
        const text = document.getElementById('report-output').textContent;
        if (!text || text.startsWith('—')) return;
        const orig = copyBtn.textContent;
        copyText(text)
            .then(() => { copyBtn.textContent = 'скопировано'; })
            .catch(() => { copyBtn.textContent = 'не удалось'; })
            .finally(() => setTimeout(() => { copyBtn.textContent = orig; }, 1500));
    };

    function rerender() {
        renderCalcControls(main, car, data, calcState, carApprovals);
        updateReport(calcState, data, car, carApprovals);
    }

    updateReport(calcState, data, car, carApprovals);
    window.__zmRerender = rerender;
    // Автоприменение результатов панели «Наличие на станции»: панель зовёт это
    // после каждой проверки — фильтры вставляются в расчёт сразу (тот же путь,
    // что и ручная вставка текста), масло ДВС переключается на лучшее из
    // имеющихся, остатки в литрах показываются на карточках масел.
    window.__zmApplyAvailability = ({ visc, stock, filtersText }) => {
        if (filtersText) {
            applyFiltersInput(calcState, filtersText);
            calcState.showFiltersInput = false;
            saveFilters(calcState);
        }
        calcState.crmStock = { visc, stock: stock || {} };
        autoPickAvailableOil(data, calcState, carApprovals);
        rerender();
    };
    // Наличие устарело (сменилась/сбросилась станция, ошибка CRM, выход) —
    // убираем остатки с карточек, чтобы не показывать данные чужой станции
    window.__zmClearAvailability = () => {
        if (!calcState.crmStock) return;
        calcState.crmStock = null;
        rerender();
    };
    // Текущая вязкость ДВС — панель CRM стартует с неё и держит синхрон
    window.__zmCalcVisc = () => viscForMileage(calcState.mileage);
    // Панель сменила вязкость — переключаем режим пробега на соответствующий
    window.__zmSetMileageForVisc = (v) => {
        const m = Object.keys(MILEAGE_VISC).find(k => MILEAGE_VISC[k] === v);
        if (m && calcState.mileage !== m) { calcState.mileage = m; rerender(); }
    };
}

// ── Наличие на станции (CRM) ──────────────────────────────────────────────────

const MILEAGE_VISC = { '<100': '5W-30', '>=100': '5W-40', '>=200': '10W-40', '0w20': '0W-20', '0w30': '0W-30' };

function viscForMileage(m) {
    return MILEAGE_VISC[m] || '5W-30';
}

// Остаток масла на станции: null — данных нет (проверка была на другую
// вязкость либо ещё не выполнялась), число — литры (0 = нет в наличии).
function stockLiters(calcState, oil) {
    const st = calcState.crmStock;
    if (!st || extractViscosity(oil.v) !== st.visc) return null;
    return st.stock[oil.b + '_' + oil.n] || 0;
}

// Автовыбор масла ДВС по наличию: первое из рейтинга калькулятора (допуски →
// цена), которое реально есть на станции. Масла без требуемого класса ACEA
// не автоподставляем (защита от DPF и т.п.). Если по этой вязкости ничего
// нет — выбор не трогаем, панель и карточки покажут «нет на станции».
function autoPickAvailableOil(data, calcState, carApprovals) {
    const st = calcState.crmStock;
    if (!st) return;
    const agg = getAggregates(data).find(a => a.key === 'engine');
    if (!agg) return;
    calcForAggregate(agg, calcState, carApprovals); // заполняет allCandidates/ranked
    const cands = agg.allCandidates || [];
    if (!cands.length || extractViscosity(cands[0].v) !== st.visc) return;
    const ordered = agg.ranked ? agg.ranked.filter(r => !r.classMiss).map(r => r.oil) : cands;
    const best = ordered.find(o => (st.stock[o.b + '_' + o.n] || 0) > 0);
    if (best) calcState.oilOverride[agg.key + '_mid'] = best.b + '_' + best.n;
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
    const chip = (val, label) =>
        `<button class="chip${calcState.mileage === val ? ' active' : ''}" data-mileage="${val}">${label}</button>`;
    const flushChip = (val, label) =>
        `<button class="chip flush${calcState.flush === val ? ' active' : ''}" data-flush="${val}">${label}</button>`;

    return `
        <div class="ctrl-section">
            <div class="sec-title">Настройки расчёта</div>
            <div class="ctrl-lbl" style="margin-bottom:6px">Пробег</div>
            <div class="seg">
                ${chip('<100',   'до 100т')}
                ${chip('>=100',  '100т+')}
                ${chip('>=200',  '200т+')}
                ${chip('0w20',   '0W-20')}
                ${chip('0w30',   '0W-30')}
            </div>
            <div class="ctrl-row" style="margin:14px 0">
                <label class="chk-label">
                    <input type="checkbox" id="chk-ignore-approvals" ${calcState.ignoreApprovals ? 'checked' : ''}/>
                    <span>Игнорировать допуска</span>
                </label>
                <label class="chk-label">
                    <input type="checkbox" id="chk-sump" ${calcState.showWithSump ? 'checked' : ''}/>
                    <span>С картером (+550₽)</span>
                </label>
            </div>
            <div class="ctrl-lbl" style="margin-bottom:6px">Промывка ДВС</div>
            <div class="seg">
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
    const arts = calcState.articles || {};
    const hasArticles = !!(arts.vf || arts.mf || arts.sf);
    const hasPrices = anyFilterPriced(f);

    if (!hasArticles && !hasPrices && !calcState.showFiltersInput) {
        return `<div class="filters-section"><button class="btn-add-filters" id="btn-add-filters">Добавить фильтры ДВС</button></div>`;
    }

    // Артикулы из БД — по клику копируются, для поиска в каталоге
    const artBadge = (key, abbr) => arts[key] ? `
        <span class="filter-badge-row">
            <span class="filter-badge-lbl">${abbr}</span>
            <span class="filter-badge" data-copy="${esc(arts[key])}" title="нажми чтобы скопировать">${esc(arts[key])}</span>
        </span>` : '';
    const artHtml = hasArticles
        ? `<div class="filters-articles">${artBadge('vf','вф')}${artBadge('mf','мф')}${artBadge('sf','сф')}</div>`
        : '';

    // Поле вставки стоимостей — формат как в юзерскрипте: «вф LYNX LA-502 - 1488р»
    const pasteHtml = calcState.showFiltersInput ? `
        <div class="filters-paste">
            <textarea id="filters-ta" rows="4" placeholder="вф LYNX LA-502 LYNXauto - 1488р&#10;мф LYNX LC-331 LYNXauto - 330р&#10;сф LYNX LAC-333 auto - 1209р">${esc(filtersToRaw(f))}</textarea>
            <div class="filters-paste-btns">
                <button class="btn btn-pri" id="btn-filters-apply">Применить</button>
                ${hasPrices ? `<button class="btn btn-sec" id="btn-filters-clear">Очистить</button>` : ''}
            </div>
            <div class="filters-paste-hint">Формат: <code>тип название - ценар</code>. Тип: <b>вф</b>/<b>мф</b>/<b>сф</b> — можно 1, 2 или все 3 строки</div>
            <div id="filters-debug" class="filters-debug"></div>
        </div>` : '';

    // Строки со стоимостями: галочка «в расчёт» + работа по клику, без прятанья
    const workChip = (key, opt, cur) =>
        `<button class="chip chip-sm${cur === opt.v ? ' active' : ''}" data-fwork="${key}:${opt.v}">${opt.l}</button>`;
    const pricedRow = (key, abbr, workOpts, noWorkNote) => {
        const fd = f[key];
        if (!fd.price || !fd.name || fd.name === '[нет]') return '';
        const work = workOpts
            ? `<div class="filter-work-row"><span class="ctrl-lbl">установка:</span>${workOpts.map(o => workChip(key, o, fd.work)).join('')}</div>`
            : `<div class="filter-work-none">${noWorkNote}</div>`;
        return `
            <div class="filter-priced-row${fd.enabled ? '' : ' filter-priced-off'}">
                <label class="chk-label">
                    <input type="checkbox" data-ftoggle="${key}" ${fd.enabled ? 'checked' : ''}/>
                    <span><b>${abbr.toUpperCase()}</b> ${esc(fd.name)} — <b>${fd.price}₽</b></span>
                </label>
                ${work}
            </div>`;
    };
    const pricedHtml = hasPrices ? `
        <div class="filters-priced">
            ${pricedRow('vf', 'вф', [{v:0,l:'без работы'},{v:350,l:'защёлки 350₽'},{v:600,l:'болты 600₽'},{v:1150,l:'разбор 1150₽'}])}
            ${pricedRow('mf', 'мф', null, 'меняется при замене масла')}
            ${pricedRow('sf', 'сф', [{v:0,l:'без работы'},{v:550,l:'бардачок 550₽'},{v:990,l:'под педалью 990₽'}])}
        </div>` : '';

    const copyAllBtn = hasArticles
        ? `<button class="btn btn-sec btn-mini" id="btn-copy-all-filters">⧉ скопировать все</button>`
        : '';
    const toggleLbl = calcState.showFiltersInput
        ? 'закрыть'
        : (hasPrices ? 'обновить стоимость' : 'вставить стоимость');
    const toggleBtn = `<button class="btn btn-sec btn-mini" id="btn-filters-toggle">${toggleLbl}</button>`;

    return `
        <div class="filters-section ctrl-section">
            <div class="sec-title">
                <span>Фильтры ДВС</span>
                <span style="display:flex;gap:6px">${copyAllBtn}${toggleBtn}</span>
            </div>
            ${artHtml}
            ${pasteHtml}
            ${pricedHtml}
        </div>
    `;
}

// ── Filters: parse / persist ──────────────────────────────────────────────────

const FILTERS_LS_PREFIX = 'spotdb_filters_';

function loadSavedFilters(carId) {
    try {
        const raw = localStorage.getItem(FILTERS_LS_PREFIX + carId);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function saveFilters(calcState) {
    try {
        const f = calcState.filters;
        localStorage.setItem(FILTERS_LS_PREFIX + calcState.carId, JSON.stringify({
            vf: f.vf, mf: f.mf, sf: f.sf,
        }));
    } catch { /* приватный режим и т.п. — просто не сохраняем */ }
}

function clearSavedFilters(calcState) {
    try { localStorage.removeItem(FILTERS_LS_PREFIX + calcState.carId); } catch {}
}

function anyFilterPriced(f) {
    return ['vf', 'mf', 'sf'].some(k => f[k].price > 0 && f[k].name && f[k].name !== '[нет]');
}

// Тот же формат, что в юзерскрипте: «вф LYNX LA-502 LYNXauto - 1488р»
function parseFiltersInput(text) {
    const out = { vf: null, mf: null, sf: null };
    if (!text) return out;
    const TYPE_MAP = { 'вф': 'vf', 'мф': 'mf', 'сф': 'sf' };
    text.split(/\r?\n/).forEach(rawLine => {
        const line = rawLine.trim();
        if (!line) return;
        const m = line.match(/^(вф|мф|сф)\s+(.+?)\s*[-–—]\s*([\d\s]+)\s*(?:р|руб|₽)?\s*$/i);
        if (!m) return;
        const key = TYPE_MAP[m[1].toLowerCase()];
        if (!key) return;
        const name = m[2].trim();
        const price = parseInt(m[3].replace(/\s+/g, ''), 10);
        if (!isFinite(price) || price <= 0) return;
        out[key] = { name, price };
    });
    return out;
}

// Обновляет только те типы, что есть во вставке — остальные не трогает
function applyFiltersInput(calcState, text) {
    const parsed = parseFiltersInput(text);
    for (const t of ['vf', 'mf', 'sf']) {
        if (!parsed[t]) continue;
        const fd = calcState.filters[t];
        fd.name = parsed[t].name;
        fd.price = parsed[t].price;
        fd.enabled = true;
        if (t === 'vf' && !fd.work) fd.work = 350;
        if (t === 'sf' && !fd.work) fd.work = 550;
    }
    return parsed;
}

// Префилл textarea из текущего состояния — повторная вставка идемпотентна
function filtersToRaw(f) {
    const lines = [];
    for (const [key, abbr] of [['vf', 'вф'], ['mf', 'мф'], ['sf', 'сф']]) {
        const fd = f[key];
        if (fd.price > 0 && fd.name && fd.name !== '[нет]') lines.push(`${abbr} ${fd.name} - ${fd.price}р`);
    }
    return lines.join('\n');
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
            body = '<div class="warn-box">HIGH GEAR — нельзя обслуживать стандартно. Передай мастеру.</div>';
        } else if (calc.needsVolume) {
            body = `
                <div class="warn-box">Motul не дал объём заправки. Введи вручную:</div>
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

    const showApp = calcState.showApprovals.has(agg.key);
    const appCount = agg.group === 'engine' ? carApprovals.length : (agg.approvals || []).length;
    const appLabel = agg.group === 'engine' ? 'Допуска машины' : (agg.isCustom ? 'Допуска' : 'Продукты Motul');
    const appBlock = sel && !calc.isHighGear && !calc.needsVolume && appCount > 0 ? `
        <button class="app-btn" data-app-toggle="${agg.key}">
            ${showApp ? '▾' : '▸'} ${appLabel} (${appCount})
        </button>
        ${showApp ? renderApprovalsBlock(agg, carApprovals) : ''}
    ` : '';

    return `
        <div class="agg-card">
            <div class="agg-header">
                <input type="checkbox" class="agg-check" data-agg-key="${agg.key}" ${sel ? 'checked' : ''}/>
                <span class="agg-title">${agg.label}</span>
                ${calc.volumeStr ? `<span style="font-size:12px;color:var(--sub);margin-left:auto">${calc.volumeStr}</span>` : ''}
            </div>
            ${sel ? `<div class="agg-body">${body}</div>${appBlock}` : ''}
        </div>
    `;
}

function renderApprovalsBlock(agg, carApprovals) {
    const list = agg.group === 'engine' ? carApprovals : (agg.approvals || []);
    if (!list.length) return '';
    return `
        <div class="approvals-block">
            ${list.map(a => `<span class="appr-tag">${esc(a)}</span>`).join(' ')}
        </div>
    `;
}

function renderAggBody(agg, calc, calcState, carApprovals) {
    const parts = [];

    // Volume + reset
    const defaultVol = roundL(parseFloat(agg.volume || 0) + parseFloat(agg.filterVolume || 0));
    parts.push(`
        <div class="agg-volume">
            <span class="ctrl-lbl">Объём:</span>
            <input type="number" step="0.1" min="0" class="vol-input"
                data-vol-key="${agg.key}" value="${calcState.volumeOverride[agg.key] || ''}"
                placeholder="${defaultVol || '?'}"/>
            ${calcState.volumeOverride[agg.key] ? `<button class="btn-reset-vol" data-vol-reset="${agg.key}" title="сбросить">↺</button>` : ''}
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
            <div class="atp-flags">
                ${isCvt ? `
                    <label class="chk-label"><input type="checkbox" data-atp-flag="cvtFilterCoarse" ${calcState.cvtFilterCoarse?'checked':''}/> <span>Фильтр грубый <b>+1700₽</b></span></label>
                    <label class="chk-label"><input type="checkbox" data-atp-flag="cvtFilterFine"   ${calcState.cvtFilterFine?'checked':''}/> <span>Фильтр тонкий <b>+3350₽</b></span></label>
                    <label class="chk-label"><input type="checkbox" data-atp-flag="cvtAtfSp3"       ${calcState.cvtAtfSp3?'checked':''}/> <span>АТФ SP-III <span class="atp-flag-note">старый вариатор — только ROLF Professional ATF Multi</span></span></label>
                ` : `
                    <label class="chk-label"><input type="checkbox" data-atp-flag="atpFilter" ${calcState.atpFilter?'checked':''}/> <span>Фильтр <b>+1700₽</b></span></label>
                `}
            </div>
        `);
        if (calc.costs && agg.atfWarn) {
            parts.push('<div class="warn-box">подходящих масел в наличии нет — перевести на мастера</div>');
        }
    }

    // МКПП: Motul требует 70W / 75W-85 / 80W-90 / LS, либо продуктов нет вовсе
    // (product not found) — предложить нечего, вместо масел только варн.
    if (calc.mkppWarn) {
        parts.push(`<div class="warn-box">${esc(manualWarnText(calc.mkppWarn))}</div>`);
    }

    // Engine: flush formula box
    if (agg.group === 'engine' && calcState.flush !== 'none') {
        const vCalc = calc.vCalc || 0;
        let flushLine = '';
        if (calcState.flush === '5min') {
            flushLine = `5-минутная промывка: +1180₽`;
        } else if (calcState.flush === 'full') {
            const litres = +(vCalc * 0.9).toFixed(1);
            const cost = Math.round(litres * 350) + 550;
            flushLine = `Полная промывка: ${litres}л × 350₽ + 550₽ = ${cost}₽`;
        }
        if (flushLine) parts.push(`<div class="flush-formula">${flushLine}</div>`);
    }

    // Oil options
    if (calc.costs && calc.costs.length) {
        const mileage = calcState.mileage;
        const displayedCosts = mileage === '>=200' ? calc.costs.slice(0, 1) : calc.costs;
        const allCandidates = agg.allCandidates || [];
        const isPickerOpen = calcState.showOilPicker === agg.key;

        // Свойства SPOT-масла не дублируем на соседних карточках — как в
        // userscript-калькуляторе: у остальных масел показываем только то,
        // чего нет у SPOT
        const spotCost = calc.costs.find(x => x.oil.isSpot);
        const spotAddsLower = spotCost
            ? new Set((spotCost.oil.ad || []).map(normalizeAdditive))
            : new Set();

        parts.push(displayedCosts.map((c, i) => {
            // Первое (не-SPOT) масло двс — сама карточка открывает выбор замены
            const canPick = agg.group === 'engine' && i === 0 && !c.oil.isSpot &&
                            allCandidates.length > 1;
            const { matched, others, hier } = splitOilApprovals(c.oil.a || [], carApprovals);
            const regMatches = agg.group === 'engine' ? matchOilToReglament(c.oil, calcState.car?.makeShort) : [];
            const regMark = regMatches.length ? `<span class="reg-mark" title="${esc(regMatches.map(m => m.tag + (m.desc ? ': ' + m.desc : '')).join(', '))}"></span>` : '';
            const matchedBadges = matched.map(a => `<span class="appr-hit">${esc(a)}</span>`).join(' ');
            const hierBadges = (hier || []).map(h =>
                `<span class="appr-hier" title="${esc(h.approval)} покрывает требуемый ${esc(h.covers)} (старший допуск)">${esc(h.approval)} ⊃ ${esc(h.covers)}</span>`).join(' ');
            const headBadges = [matchedBadges, hierBadges].filter(Boolean).join(' ');
            const otherBadges = others.map(a => `<span class="appr-other">${esc(a)}</span>`).join(' ');
            const showOilAppr = calcState.expandedOilApp.has(agg.key + '_' + i);
            const oilApprHtml = (matched.length || (hier || []).length || others.length) ? `
                <div style="margin-top:3px">
                    ${headBadges}${headBadges && otherBadges ? ' ' : ''}${showOilAppr ? otherBadges : (others.length ? `<span class="appr-more" data-oil-appr="${agg.key}_${i}">+${others.length} ещё</span>` : '')}
                </div>
            ` : '';
            const oilAdsHtml = renderOilAds(c.oil, spotAddsLower);

            const stockL = agg.group === 'engine' ? stockLiters(calcState, c.oil) : null;
            const stockHtml = stockL === null ? '' : (stockL > 0
                ? `<div class="oil-stock">на станции: <b>${stockL} л</b></div>`
                : '<div class="oil-stock oil-stock-none">нет на станции</div>');

            const sumpSuffix = agg.group === 'engine'
                ? (calcState.showWithSump
                    ? ` + 550₽ (картер) = <b>${c.total + 550}₽</b>`
                    : ' + 550₽ (картер)')
                : '';

            const pickHint = canPick
                ? `<div class="oil-pick-hint">${isPickerOpen ? '▴ скрыть список' : `▾ выбрать другое масло (${allCandidates.length})`}</div>`
                : '';

            return `
                <div class="oil-option${i === 0 ? ' selected' : ''}${canPick ? ' oil-option-pick' : ''}"${canPick ? ` data-picker-toggle="${agg.key}"` : ''}>
                    <div class="oil-name">${regMark}${c.oil.isSpot ? '<span class="spot-pill">SPOT</span>' : ''}${esc(c.oil.b)} ${esc(c.oil.n)} <span class="visc-pill">${esc(c.oil.v)}</span></div>
                    <div class="oil-price">${esc(c.breakdown || c.oil.price + '₽/л')} = <b>${c.total}₽</b>${sumpSuffix}</div>
                    ${oilApprHtml}
                    ${oilAdsHtml}
                    ${stockHtml}
                    ${pickHint}
                </div>
            `;
        }).join(''));

        // Oil picker for engine oils — открывается кликом по первой карточке
        if (agg.group === 'engine' && allCandidates.length > 1) {
            if (isPickerOpen) {
                parts.push(`
                    <div class="oil-picker">
                        <div class="oil-picker-head">Выбери масло (${allCandidates.length} подходящих):</div>
                        ${allCandidates.map((oil, i) => {
                            const isCur = calc.costs[0] && (calc.costs[0].oil.b + '_' + calc.costs[0].oil.n) === (oil.b + '_' + oil.n);
                            const regOpt = matchOilToReglament(oil, calcState.car?.makeShort);
                            const rMark = '';
                            const rk = (agg.ranked || []).find(r => r.oil === oil);
                            let hits = '';
                            if (rk && (rk.direct.length || rk.hier.length)) {
                                const tip = [...rk.direct.map(t => 'совпал: ' + t),
                                             ...rk.hier.map(h => h.via + ' покрывает ' + h.covers)].join('; ');
                                hits = ` <span class="oil-pick-hits" title="${esc(tip)}">✓${rk.direct.length ? ' ' + rk.direct.length : ''}${rk.hier.length ? ' ⊃' + rk.hier.length : ''}</span>`;
                            }
                            if (rk && rk.classMiss) {
                                hits += ` <span class="oil-pick-miss" title="У масла нет требуемого класса ACEA ${esc(rk.classMiss)} — предлагать с осторожностью">не ${esc(rk.classMiss)}</span>`;
                            }
                            const adsTip = (oil.ad || []).length ? ` title="${esc(oil.ad.join(', '))}"` : '';
                            const sL = stockLiters(calcState, oil);
                            const sHtml = sL === null ? '' : (sL > 0
                                ? ` <span class="oil-pick-stock">${sL} л</span>`
                                : ' <span class="oil-pick-stock none">нет</span>');
                            return `<button class="oil-pick-opt${isCur ? ' cur' : ''}" data-picker-pick="${agg.key}" data-picker-idx="${i}"${adsTip}>${rMark}${esc(oil.b)} ${esc(oil.n)}${hits} — ${oil.price}₽/л${sHtml}</button>`;
                        }).join('')}
                        <button class="btn btn-sec" data-picker-close="${agg.key}" style="margin-top:4px;font-size:11px">✕ закрыть</button>
                    </div>
                `);
            }
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
            <div class="sec-title"><span>Итого</span></div>
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

    // Mileage chips — вязкость изменилась, панель CRM перепроверит наличие сама
    container.querySelectorAll('[data-mileage]').forEach(b => {
        b.onclick = () => {
            calcState.mileage = b.dataset.mileage;
            rerender();
            if (typeof window.__zmCrmSetVisc === 'function') {
                window.__zmCrmSetVisc(viscForMileage(calcState.mileage));
            }
        };
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

    // Filters: open/close paste panel
    const addFiltBtn = container.querySelector('#btn-add-filters');
    if (addFiltBtn) addFiltBtn.onclick = () => { calcState.showFiltersInput = true; rerender(); };
    const toggleFiltBtn = container.querySelector('#btn-filters-toggle');
    if (toggleFiltBtn) toggleFiltBtn.onclick = () => {
        calcState.showFiltersInput = !calcState.showFiltersInput;
        rerender();
    };

    // Copy all filter articles at once
    const copyAllBtn = container.querySelector('#btn-copy-all-filters');
    if (copyAllBtn) copyAllBtn.onclick = () => {
        const arts = calcState.articles || {};
        const text = ['vf', 'mf', 'sf'].map(k => arts[k]).filter(Boolean).join('\n');
        if (!text) return;
        copyText(text)
            .then(() => { copyAllBtn.textContent = 'скопировано'; })
            .catch(() => { copyAllBtn.textContent = 'не удалось'; })
            .finally(() => setTimeout(() => { copyAllBtn.textContent = '⧉ скопировать все'; }, 1200));
    };

    // Paste prices: apply / clear
    const applyFiltBtn = container.querySelector('#btn-filters-apply');
    if (applyFiltBtn) applyFiltBtn.onclick = () => {
        const ta = container.querySelector('#filters-ta');
        const txt = ta ? ta.value : '';
        const parsed = parseFiltersInput(txt);
        const found = ['vf', 'mf', 'sf'].filter(t => parsed[t]);
        if (!found.length) {
            const dbg = container.querySelector('#filters-debug');
            if (dbg) dbg.textContent = 'Не распознано ни одной строки — формат: «вф LYNX LA-502 - 1488р»';
            return;
        }
        applyFiltersInput(calcState, txt);
        calcState.showFiltersInput = false;
        saveFilters(calcState);
        rerender();
    };
    const clearFiltBtn = container.querySelector('#btn-filters-clear');
    if (clearFiltBtn) clearFiltBtn.onclick = () => {
        calcState.filters = {
            vf: { name: '', price: 0, enabled: false, work: 350 },
            mf: { name: '', price: 0, enabled: false },
            sf: { name: '', price: 0, enabled: false, work: 550 },
        };
        clearSavedFilters(calcState);
        rerender();
    };

    // Include-in-calc toggles + work chips (защёлки/болты/бардачок…)
    container.querySelectorAll('[data-ftoggle]').forEach(chk => {
        chk.onchange = () => {
            calcState.filters[chk.dataset.ftoggle].enabled = chk.checked;
            saveFilters(calcState);
            rerender();
        };
    });
    container.querySelectorAll('[data-fwork]').forEach(b => {
        b.onclick = () => {
            const [t, v] = b.dataset.fwork.split(':');
            calcState.filters[t].work = parseInt(v, 10);
            saveFilters(calcState);
            rerender();
        };
    });

    // Filter badge copy-on-click
    container.querySelectorAll('[data-copy]').forEach(badge => {
        badge.onclick = () => {
            const orig = badge.textContent;
            copyText(badge.dataset.copy)
                .then(() => { badge.textContent = '✓'; })
                .catch(() => { badge.textContent = '✗'; })
                .finally(() => setTimeout(() => { badge.textContent = orig; }, 900));
        };
    });

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
    container.querySelectorAll('[data-vol-reset]').forEach(btn => {
        btn.onclick = () => { delete calcState.volumeOverride[btn.dataset.volReset]; rerender(); };
    });

    // Approvals toggle (per-agg)
    container.querySelectorAll('[data-app-toggle]').forEach(btn => {
        btn.onclick = () => {
            const key = btn.dataset.appToggle;
            if (calcState.showApprovals.has(key)) calcState.showApprovals.delete(key);
            else calcState.showApprovals.add(key);
            rerender();
        };
    });

    // Oil approval expand ("+ N ещё") — клик не должен открывать пикер карточки
    container.querySelectorAll('[data-oil-appr]').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const k = btn.dataset.oilAppr;
            if (calcState.expandedOilApp.has(k)) calcState.expandedOilApp.delete(k);
            else calcState.expandedOilApp.add(k);
            rerender();
        };
    });

    // АКПП type
    container.querySelectorAll('[data-atp]').forEach(b => {
        b.onclick = () => { calcState.atpType = b.dataset.atp; rerender(); };
    });
    container.querySelectorAll('[data-atp-flag]').forEach(chk => {
        chk.onchange = () => { calcState[chk.dataset.atpFlag] = chk.checked; rerender(); };
    });

    // Oil picker open/close/pick — открывается кликом по первой карточке масла
    container.querySelectorAll('[data-picker-toggle]').forEach(el => {
        el.onclick = () => {
            const key = el.dataset.pickerToggle;
            calcState.showOilPicker = calcState.showOilPicker === key ? null : key;
            rerender();
        };
    });
    container.querySelectorAll('[data-picker-close]').forEach(btn => {
        btn.onclick = () => { calcState.showOilPicker = null; rerender(); };
    });
    container.querySelectorAll('[data-picker-pick]').forEach(btn => {
        btn.onclick = () => {
            const key = btn.dataset.pickerPick;
            const idx = parseInt(btn.dataset.pickerIdx);
            const agg = getAggregates(data).find(a => a.key === key);
            if (!agg) return;
            calcForAggregate(agg, calcState, carApprovals); // populates allCandidates
            const oil = (agg.allCandidates || [])[idx];
            if (oil) calcState.oilOverride[key + '_mid'] = oil.b + '_' + oil.n;
            calcState.showOilPicker = null;
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
    if (Array.isArray(fc.custom)) out.custom = fc.custom.map(c => ({ ...c }));
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

// Артикулы из БД — показываются как копируемые бейджи, в расчёте не участвуют
function dbArticlesFromRecord(rec) {
    const fpn = rec.filter_part_numbers || {};
    const out = { vf: '', mf: '', sf: '' };
    for (const key of ['vf', 'mf', 'sf']) {
        const entry = fpn[key];
        if (entry && !entry.absent && entry.part) out[key] = entry.part;
    }
    return out;
}

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ── Свойства масел (ad-плашки) ────────────────────────────────────────────────
// «износ» и «масло-угар»/«маслоугар» должны считаться одним и тем же свойством
function normalizeAdditive(s) {
    return String(s || '').toLowerCase().replace(/[ёе]/g, 'е').replace(/[\s\-/]+/g, '').trim();
}

// Плашки свойств масла под карточкой; у не-SPOT масел скрываем то,
// что уже есть у SPOT (spotAddsLower — нормализованные свойства SPOT-масла)
function renderOilAds(oil, spotAddsLower) {
    let ads = oil.ad || [];
    if (!oil.isSpot && spotAddsLower && spotAddsLower.size) {
        ads = ads.filter(a => !spotAddsLower.has(normalizeAdditive(a)));
    }
    if (!ads.length) return '';
    return `<div class="oil-ads">${ads.map(a =>
        `<span class="oil-ad-pill${oil.isSpot ? ' oil-ad-pill-spot' : ''}">${esc(a)}</span>`).join('')}</div>`;
}
