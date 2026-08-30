import { getShopOils, getDefaults } from '../../shared/oils.js';
import {
    roundL, getAggregates, shouldDefaultToPartial,
    filtersTotal, anyFilterEnabled, calcForAggregate,
    pickAtfOils, totalAggLabel, totalOilLabel, computeTotalSum,
    splitOilApprovals, matchOilToReglament, manualWarnText, sapsLabel,
} from '../../shared/calculator.js';
import { buildReport } from '../../shared/report.js';
import { extractViscosity } from '../../shared/crmAnalyse.js';
import { crmQuirksForAggregate, crmNoFullAt, SEVERITY_LABELS } from '../../shared/crmQuirks.js';

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

    // Закреплённое для этой машины масло (oil_overrides.pin). Список «какие
    // масла вообще предлагать» отсюда убран: держать у каждой машины галочки на
    // весь каталог магазина оказалось бесполезно — выбор и так делают допуски,
    // цена и наличие на станции, а лишний фильтр только прятал подходящее масло.
    const ov = dbRecord.oil_overrides || {};
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
    const focus = captureTypingFocus(container);
    container.innerHTML = `
        ${renderControls(calcState)}
        ${renderFiltersSection(calcState)}
        ${renderAggregates(data, calcState, carApprovals)}
        ${renderTotals(data, calcState, carApprovals)}
    `;
    bindEvents(container, car, data, calcState, carApprovals);
    restoreTypingFocus(container, focus);
}

// ── Фокус на пересборке панели ────────────────────────────────────────────────
// Панель пересобирается целиком (innerHTML), поэтому поле, в котором человек
// печатает, умирает вместе со старым DOM: после первого же символа ввод
// «схлопывался», и набрать дробный объём (4.5 / 4,5) можно было только
// вставкой из буфера. Снимаем фокус перед пересборкой и возвращаем его в новый
// узел — вместе с сырым текстом, чтобы промежуточное «4,» не превращалось в «4»
// прямо под курсором.
function captureTypingFocus(container) {
    const el = document.activeElement;
    if (!el || !container.contains(el) || !el.dataset || !el.dataset.volKey) return null;
    let selStart = null, selEnd = null;
    try { selStart = el.selectionStart; selEnd = el.selectionEnd; } catch { /* поле без выделения */ }
    return { key: el.dataset.volKey, value: el.value, selStart, selEnd };
}

function restoreTypingFocus(container, saved) {
    if (!saved) return;
    const el = container.querySelector(`[data-vol-key="${saved.key}"]`);
    if (!el) return;
    el.value = saved.value;
    el.focus({ preventScroll: true });
    if (saved.selStart != null) {
        try { el.setSelectionRange(saved.selStart, saved.selEnd); } catch { /* тип поля без каретки */ }
    }
}

// Объём вводят руками, и на русской раскладке дробная часть чаще идёт через
// запятую — принимаем оба разделителя (в input[type=number] запятая вообще не
// доезжает до value, поэтому поля объёма — текстовые с inputmode="decimal").
function parseVolume(str) {
    return parseFloat(String(str == null ? '' : str).replace(',', '.'));
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
            <div class="seg" data-seg="mileage">
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
                    <span>Снятие/установка защиты картера (+550₽)</span>
                </label>
            </div>
            <div class="ctrl-lbl" style="margin-bottom:6px">Промывка ДВС</div>
            <div class="seg" data-seg="flush">
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

// Особенности из CRM для одной карточки агрегата. Показываем прямо над
// расчётом: «полную не делаем» нужно увидеть до того, как назван ценник, а не
// после звонка клиенту.
export function renderQuirks(quirks) {
    if (!quirks.length) return '';
    return `<div class="crm-quirks">${quirks.map(q => `
        <div class="crm-quirk crm-quirk-${q.severity}">
            <span class="crm-quirk-tag">${esc(SEVERITY_LABELS[q.severity])}</span>
            <span class="crm-quirk-text">${esc(q.text)}${q.note ? ` <span class="crm-quirk-note">${esc(q.note)}</span>` : ''}</span>
        </div>`).join('')}</div>`;
}

function renderAggCard(agg, calcState, carApprovals) {
    const sel = calcState.selected.has(agg.key);
    const calc = calcForAggregate(agg, calcState, carApprovals);
    const quirks = renderQuirks(crmQuirksForAggregate(calcState.car, calcState.data, agg));

    let body = '';
    if (sel) {
        if (calc.isHighGear) {
            body = '<div class="warn-box">HIGH GEAR — нельзя обслуживать стандартно. Передай мастеру.</div>';
        } else if (calc.needsVolume) {
            body = `
                <div class="warn-box">Motul не дал объём заправки. Введи вручную:</div>
                <div class="agg-volume" style="margin-top:8px">
                    <span class="ctrl-lbl">Объём (л):</span>
                    <input type="text" inputmode="decimal" autocomplete="off" class="filter-row input vol-input"
                        data-vol-key="${agg.key}" value="${calcState.volumeOverride[agg.key] || ''}" placeholder="?"/>
                </div>
            `;
        } else {
            body = renderAggBody(agg, calc, calcState, carApprovals);
        }
    }

    const showApp = calcState.showApprovals.has(agg.key);
    // У ДВС считаем по разбору, а не по сырому списку: в разбор дописываются
    // допуска, подтверждённые Motul, но потерянные источником, — иначе на
    // кнопке «29», а внутри «из 31».
    const appCount = agg.group === 'engine'
        ? (agg.approvalAnalysis ? agg.approvalAnalysis.items.length : carApprovals.length)
        : (agg.approvals || []).length;
    // Допуска агрегатов теперь правятся вручную («Исправить данные»), поэтому у
    // всех неспецифичных агрегатов подпись одна — «Допуска» (раньше у штатных
    // стояло «Продукты Motul», хотя это тот же список).
    const appLabel = agg.group === 'engine' ? 'Допуска машины' : 'Допуска';
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
            ${sel ? `<div class="agg-body">${quirks}${body}</div>${appBlock}` : ''}
        </div>
    `;
}

// Порядок рангов сверху вниз: сначала то, что решает, потом фон.
const RANK_ORDER = ['critical', 'important', 'assumed', 'minor', 'conflict', 'info', 'noise'];
const RANK_TITLE = {
    critical:  'решают выбор',
    important: 'важны физически',
    assumed:   'выведено по марке, году и топливу',
    minor:     'перекрыты более строгими',
    conflict:  'противоречат профилю',
    info:      'уровень качества',
    noise:     'к этой машине не относятся',
};

// Итог разбора одной строкой: что мотору реально нужно и на чём это основано.
function approvalsSummary(a) {
    if (!a) return '';
    if (a.notOil && a.confidence !== 'assumed') {
        return 'В допусках этой машины лежит паспорт охлаждающей жидкости, а не масла. ' +
               'Подбор идёт как для машины без допусков — проверь вручную.';
    }
    // Пишем то, что реально ограничивает выбор, а не самый строгий допуск из
    // списка: иначе выходило «нужно среднезольное» рядом с классом A3/B4.
    const bits = [];
    if (a.profile.ashGate != null) bits.push(`${sapsLabel(a.profile.ashGate)} (зола ≤ ${a.profile.ashGate}%)`);
    const hths = a.profile.hthsGate != null ? a.profile.hthsGate : a.profile.hthsMin;
    if (hths != null) bits.push(`HTHS ≥ ${hths}`);
    if (a.profile.ashGate == null && bits.length) bits.push('по золе ограничений нет — сажевого фильтра у мотора нет');
    const need = bits.length ? bits.join(', ')
        : a.rule && a.rule.applied ? 'ограничений по зольности и густоте завод не задаёт'
        : 'определить не удалось';
    const src = { high: 'подтверждено рекомендацией Motul по этой машине',
                  medium: 'выведено по родным допускам марки',
                  assumed: 'допусков у машины нет — выведено по марке, году и топливу',
                  low: 'выведено только по классам ACEA — родных допусков в списке нет' }[a.confidence] || '';
    const ruleTail = a.rule && a.rule.applied ? ` ${a.rule.why}` : '';
    return `Мотору нужно: ${need}. ${src ? '(' + src + ')' : ''}${ruleTail}`;
}

function renderApprovalsBlock(agg, carApprovals) {
    const list = agg.group === 'engine' ? carApprovals : (agg.approvals || []);
    const a = agg.group === 'engine' ? agg.approvalAnalysis : null;

    // Не ДВС либо режим «игнорировать допуска» — разбора нет, показываем как было.
    if (!a) {
        if (!list.length) return '';
        return `<div class="approvals-block">
            ${list.map(x => `<span class="appr-tag">${esc(x)}</span>`).join(' ')}
        </div>`;
    }
    if (!a.items.length) return '';

    const decisive = a.items.filter(i => ['critical', 'important', 'assumed'].includes(i.rank)).length;
    const groups = RANK_ORDER
        .map(rank => ({ rank, items: a.items.filter(i => i.rank === rank) }))
        .filter(g => g.items.length);

    const chip = (it) => {
        // title — нативная подсказка (работает всегда и на любом устройстве),
        // data-why — текст для панели под списком.
        // «+» — допуск дописан по рекомендации Motul, «≈» — выведен правилом по
        // марке и годам: у машины его нет, и оператор должен это видеть.
        const mark = it.fromEvidence ? ' <b>+</b>' : it.fromRule ? ' <b>≈</b>' : '';
        const tip = `${it.label}\n${it.what}\n\n${it.why}`;
        return `<span class="appr-chip appr-${it.rank}${it.fromEvidence ? ' appr-added' : ''}"
            data-appr-why="${esc(it.why)}" data-appr-what="${esc(it.label + ' — ' + it.what)}"
            tabindex="0" title="${esc(tip)}">${esc(it.label)}${mark}</span>`;
    };

    const conflictNote = a.unionSuspect ? `
        <div class="appr-warn" title="${esc(
            (a.conflicts[0] && a.conflicts[0].note) ||
            'В списке допуска сразу нескольких чужих марок.')}">
            ⚠ Список собран из паспортов рекомендованных масел, а не из требований мотора —
            поэтому строк так много и часть из них противоречит друг другу.
        </div>` : '';

    return `
        <div class="approvals-block">
            <div class="appr-summary">
                <b>Решают ${decisive} из ${a.items.length}.</b> ${esc(approvalsSummary(a))}
                ${agg.requiredClass ? `<span class="appr-class">класс ${esc(agg.requiredClass)}</span>` : ''}
            </div>
            ${conflictNote}
            ${groups.map(g => `
                <div class="appr-group">
                    <div class="appr-group-h">${RANK_TITLE[g.rank]} (${g.items.length})</div>
                    <div class="appr-group-list">${g.items.map(chip).join(' ')}</div>
                </div>
            `).join('')}
            <div class="appr-why" data-appr-panel>
                Наведи курсор на допуск — здесь появится, почему он важен или почему на него можно закрыть глаза.
            </div>
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
            <input type="text" inputmode="decimal" autocomplete="off" class="vol-input"
                data-vol-key="${agg.key}" value="${calcState.volumeOverride[agg.key] || ''}"
                placeholder="${defaultVol || '?'}"/>
            ${calcState.volumeOverride[agg.key] ? `<button class="btn-reset-vol" data-vol-reset="${agg.key}" title="сбросить">↺</button>` : ''}
            <span class="vol-formula">${calc.formula}</span>
        </div>
    `);

    // АКПП-specific controls
    if (agg.group === 'auto') {
        const isCvt = agg.isCvt;
        // Кнопку «полная» не прячем: бывает, что аппарат всё-таки подключается
        // (разные комплектации). Но помечаем, что по CRM этой машине её не делают.
        const noFull = crmNoFullAt(calcState.car, calcState.data);
        parts.push(`
            <div class="atp-ctrl" data-seg="atp">
                <button class="chip${calcState.atpType === 'partial' ? ' active' : ''}" data-atp="partial">частичная</button>
                <button class="chip${calcState.atpType === 'full'    ? ' active' : ''}${noFull ? ' chip-nofull' : ''}" data-atp="full"
                    ${noFull ? 'title="по CRM этой машине полную не делаем"' : ''}>полная (150%)</button>
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
            // Выбор замены открывает карточка брендового масла — привязываться
            // к индексу нельзя: карточки идут по возрастанию цены, и первым
            // теперь обычно стоит SPOT, который в пикере не участвует.
            const canPick = agg.group === 'engine' && !c.oil.isSpot &&
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
                    ? ` + 550₽ (снятие/установка защиты картера) = <b>${c.total + 550}₽</b>`
                    : ' + 550₽ (снятие/установка защиты картера)')
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

        // Своё масло не прошло проверку по допускам — в предложении одна
        // позиция вместо двух, и оператору нужно понимать, почему.
        if (agg.group === 'engine' && agg.spotWarn) {
            parts.push(`<div class="warn-box">${esc(agg.spotWarn)}</div>`);
        }

        // Oil picker for engine oils — открывается кликом по карточке масла
        if (agg.group === 'engine' && allCandidates.length > 1) {
            if (isPickerOpen) {
                parts.push(`
                    <div class="oil-picker">
                        <div class="oil-picker-head">Выбери масло (${allCandidates.length} подходящих):</div>
                        ${allCandidates.map((oil, i) => {
                            const cur = calc.costs.find(c => !c.oil.isSpot) || calc.costs[0];
                            const isCur = cur && (cur.oil.b + '_' + cur.oil.n) === (oil.b + '_' + oil.n);
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
                            // Физически опасно для этого мотора (зола/HTHS) — из
                            // основного выбора исключено, но показываем с причиной:
                            // решение всё равно за оператором.
                            if (rk && rk.blocked) {
                                hits += ` <span class="oil-pick-block" title="${esc('Не подходит: ' + (rk.fitNotes || []).join('; '))}">⚠ не по допускам</span>`;
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
        const sumpSuffix = sumpAdd ? ` + 550₽ (снятие/установка защиты картера) = <b>${display}₽</b>` : '';

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

    // Подсказка по допуску: наведение мышью или фокус с клавиатуры пишет
    // причину в панель под списком. Нативный title тоже стоит — на тач-экранах
    // hover не существует, а long-press показывает именно его.
    container.querySelectorAll('.approvals-block').forEach(block => {
        const panel = block.querySelector('[data-appr-panel]');
        if (!panel) return;
        const idle = panel.textContent;
        const show = (el) => {
            panel.innerHTML = `<b>${esc(el.dataset.apprWhat || '')}</b><br>${esc(el.dataset.apprWhy || '')}`;
        };
        block.querySelectorAll('[data-appr-why]').forEach(chip => {
            chip.addEventListener('mouseenter', () => show(chip));
            chip.addEventListener('focus', () => show(chip));
        });
        block.addEventListener('mouseleave', () => { panel.textContent = idle; });
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
            const v = parseVolume(inp.value);
            if (isFinite(v) && v > 0) calcState.volumeOverride[inp.dataset.volKey] = v;
            else delete calcState.volumeOverride[inp.dataset.volKey];
            rerender();
        };
        // Enter — «готово»: снять фокус, чтобы поле показало нормализованное
        // значение, а не «4,» из-под пальцев.
        inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } };
        inp.onblur = () => {
            const v = parseVolume(inp.value);
            const norm = isFinite(v) && v > 0 ? String(v) : '';
            if (inp.value !== norm) inp.value = norm;
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
