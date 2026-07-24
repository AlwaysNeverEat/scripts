// ─────────────────────────────────────────────────────────────────────────────
// Панель «Наличие на станции»: работник входит в CRM через сайт под СВОЕЙ
// учёткой (пароль бэкенд не хранит — только куки сессии), выбирает адрес —
// сайт сам проверяет в CRM наличие фильтров машины по артикулам и моторных
// масел по вязкости. Остаток масла декодируется «÷10 в литры», предупреждаем,
// когда остатка меньше двух заправок этой машины.
//
// Кнопка «Выйти из CRM» чистит только куки ЭТОГО работника на бэкенде и не
// завершает сессию на стороне CRM — иначе под общей учёткой CRM выход одного
// разлогинивал остальных. Если сессию завершит сама CRM, первый же запрос
// отсюда получит crm_auth_required, и панель снова покажет форму входа.
// ─────────────────────────────────────────────────────────────────────────────

import './crmPanel.css';
import { getShopOils } from '../../shared/oils.js';
import { splitOilApprovals } from '../../shared/calculator.js';
import {
    decodeOilLiters, crmOilPricePerLiter, matchCrmOilRow,
    cleanFilterName, detectFilterType, FILTER_SLOTS, extractViscosity,
    sortFilterRows,
} from '../../shared/crmAnalyse.js';

const STATION_KEY = 'zm_crm_station';
const VISCOSITIES = ['0W-20', '0W-30', '5W-30', '5W-40', '10W-40'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function initCrmPanel(record, { apiFetch }) {
    const root = document.getElementById('crm-panel');
    if (!root) return;

    const state = {
        crmAuth: null,           // null = выясняем, true = в CRM, false = нужен вход
        authNote: '',            // пояснение над формой входа («сессия завершена…»)
        loggingIn: false,
        stations: null,          // [{id, name}] | null пока грузится
        stationId: localStorage.getItem(STATION_KEY) || '',
        // Стартуем с вязкости калькулятора (он инициализируется раньше) —
        // тогда первая же автопроверка сможет подставить масло в расчёт
        visc: currentCalcViscosity() || defaultViscosity(record),
        loading: false,
        error: null,             // { code, message }
        results: null,           // ответ /availability
        showOils: false,         // развёрнут ли полный список масел (по умолчанию свёрнут —
                                 // он дублирует карточки ДВС в калькуляторе ниже)
        showOther: false,        // развёрнут ли блок «ещё в наличии»
        filterOpen: {},          // slot.key → показаны ли альтернативы фильтра
        filterPick: {},          // slot.key → id строки CRM, выбранной вручную
    };

    render();
    checkStatus();

    // Калькулятор сменил вязкость (чипы пробега) — перепроверяем наличие сами
    window.__zmCrmSetVisc = (v) => {
        if (!VISCOSITIES.includes(v) || v === state.visc) return;
        state.visc = v;
        if (state.stationId && state.crmAuth === true) runCheck(); else render();
    };

    // ── Данные ────────────────────────────────────────────────────────────────

    // Результаты больше не актуальны — чистим и остатки в калькуляторе.
    // Ручной выбор фильтров тоже сбрасываем: на другой станции цены другие.
    function dropResults() {
        state.results = null;
        state.filterPick = {};
        if (typeof window.__zmClearAvailability === 'function') window.__zmClearAvailability();
    }

    // Ошибки CRM-авторизации переводят панель в состояние «нужен вход»
    function handleCrmError(e, note) {
        if (e.code === 'crm_auth_required') {
            state.crmAuth = false;
            state.authNote = note || 'Сессия CRM завершена — войди заново.';
            dropResults();
            state.error = null;
            return true;
        }
        return false;
    }

    async function checkStatus() {
        try {
            const { loggedIn } = await apiFetch('/api/crm/status');
            state.crmAuth = loggedIn;
            if (loggedIn) return loadStations();
        } catch (e) {
            state.crmAuth = false;
            state.authNote = '';
        }
        render();
    }

    async function doLogin(login, password) {
        state.loggingIn = true;
        state.error = null;
        render();
        try {
            await apiFetch('/api/crm/login', { method: 'POST', body: { login, password } });
            state.crmAuth = true;
            state.authNote = '';
            state.loggingIn = false;
            await loadStations();
        } catch (e) {
            state.loggingIn = false;
            state.error = { code: e.code || 'network', message: e.message };
            render();
        }
    }

    async function doLogout() {
        try { await apiFetch('/api/crm/logout', { method: 'POST', body: {} }); } catch { /* куки чистятся и так */ }
        state.crmAuth = false;
        state.authNote = '';
        dropResults();
        state.error = null;
        render();
    }

    async function loadStations() {
        try {
            const { stations } = await apiFetch('/api/crm/stations');
            state.stations = stations;
            state.error = null;
            // сохранённая станция ещё существует → проверяем сразу, как и просили:
            // «выбрал адрес — дальше он сам»
            if (state.stationId && stations.some(s => s.id === state.stationId)) {
                runCheck();
            } else {
                state.stationId = '';
                render();
            }
        } catch (e) {
            if (!handleCrmError(e)) {
                state.stations = [];
                state.error = { code: e.code || 'network', message: e.message };
            }
            render();
        }
    }

    async function runCheck() {
        if (!state.stationId) return;
        const items = filterItems(record);
        items.push({ key: 'oil', query: state.visc.toLowerCase() });
        state.loading = true;
        state.error = null;
        render();
        try {
            state.results = await apiFetch('/api/crm/availability', {
                method: 'POST',
                body: { stationId: state.stationId, items },
            });
            pushToCalculator();
        } catch (e) {
            dropResults();
            if (!handleCrmError(e)) {
                state.error = { code: e.code || 'network', message: e.message };
            }
        }
        state.loading = false;
        render();
    }

    // Автоприменение: сразу после проверки фильтры и наличие масел уходят в
    // калькулятор — оператор ничего не нажимает. Калькулятор сам вставит цены
    // фильтров, переключит масло на имеющееся и покажет остатки на карточках.
    function pushToCalculator() {
        if (typeof window.__zmApplyAvailability !== 'function' || !state.results) return;
        const byKey = {};
        for (const r of state.results.results || []) byKey[r.key] = r;
        const { matched } = matchOilRows(byKey.oil?.rows);
        const stock = {};
        for (const [k, e] of matched) stock[k] = +e.liters.toFixed(1);
        window.__zmApplyAvailability({
            visc: state.visc,
            stock,
            filtersText: buildFiltersText(byKey),
        });
    }

    // ── Рендер ────────────────────────────────────────────────────────────────

    function render() {
        root.innerHTML = `
            <div class="ctrl-section crm-panel">
                <div class="crm-head">
                    <div class="sec-title">Наличие на станции</div>
                    ${state.crmAuth === true ? `<button class="crm-logout" id="crm-logout" title="Забыть сессию CRM на этом сайте">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                        <span>Выйти</span></button>` : ''}
                </div>
                ${state.crmAuth === null ? '<div class="crm-loading">Проверяю сессию CRM…</div>' : ''}
                ${state.crmAuth === false ? renderLoginForm() : ''}
                ${state.crmAuth === true ? renderStationRow() : ''}
                ${state.error ? renderError() : ''}
                ${state.loading ? '<div class="crm-loading">Проверяю наличие в CRM…</div>' : ''}
                ${state.crmAuth === true && !state.loading && state.results ? renderResults() : ''}
            </div>
        `;
        bind();
    }

    function renderLoginForm() {
        return `
            ${state.authNote ? `<div class="warn-box">${esc(state.authNote)}</div>` : ''}
            <div class="crm-dim" style="margin-bottom:6px">Войди своей учёткой CRM — пароль на сайте не хранится.</div>
            <form id="crm-login-form" class="crm-login-form" autocomplete="off">
                <input type="text" id="crm-login" class="crm-input" placeholder="логин CRM" autocomplete="username" ${state.loggingIn ? 'disabled' : ''}/>
                <input type="password" id="crm-password" class="crm-input" placeholder="пароль CRM" autocomplete="current-password" ${state.loggingIn ? 'disabled' : ''}/>
                <button class="btn" type="submit" ${state.loggingIn ? 'disabled' : ''}>${state.loggingIn ? 'вхожу…' : 'Войти в CRM'}</button>
            </form>
        `;
    }

    // Вязкость больше не выбирается здесь — её задаёт калькулятор (чипы пробега
    // в блоке ДВС), а панель следует за ним через window.__zmCrmSetVisc.
    function renderStationRow() {
        if (state.stations === null) return '<div class="crm-loading">Загружаю список станций…</div>';
        if (!state.stations.length && state.error) return '';
        const opts = ['<option value="">выбери станцию…</option>']
            .concat(state.stations.map(s =>
                `<option value="${esc(s.id)}"${s.id === state.stationId ? ' selected' : ''}>${esc(s.name)}</option>`));
        return `
            <div class="crm-station-row">
                <select id="crm-station" class="crm-station-select">${opts.join('')}</select>
                <button class="crm-refresh" id="crm-refresh" title="Проверить наличие заново" aria-label="Проверить заново" ${state.stationId ? '' : 'disabled'}>↻</button>
            </div>
        `;
    }

    function renderError() {
        const texts = {
            crm_auth_failed: 'CRM не приняла логин или пароль.',
            crm_unavailable: state.error.message || 'CRM недоступна. Попробуйте ещё раз.',
            parse_failed: 'CRM ответила в неожиданном формате — возможно, изменилась разметка.',
        };
        return `<div class="warn-box">${esc(texts[state.error.code] || state.error.message || 'Ошибка')}
            ${state.crmAuth === true ? '<button class="btn btn-sec crm-retry" id="crm-retry">повторить</button>' : ''}</div>`;
    }

    function renderResults() {
        const byKey = {};
        for (const r of state.results.results || []) byKey[r.key] = r;
        return renderFilters(byKey) + renderOils(byKey.oil);
    }

    // ── Фильтры ───────────────────────────────────────────────────────────────

    // Ключ строки CRM для запоминания ручного выбора (id почти всегда есть)
    function rowKey(r) {
        return r.id || `${r.name}|${r.priceRaw}`;
    }

    // Показываем в порядке «лучшая цена сверху»: в наличии и дешевле — выше
    function slotRows(byKey, slotKey) {
        return sortFilterRows(byKey[slotKey]?.rows).slice(0, 5);
    }

    // Строка, которая уходит в расчёт: выбранная кликом, иначе самая дешёвая
    function pickedRow(byKey, slotKey) {
        const rows = slotRows(byKey, slotKey);
        const pick = state.filterPick[slotKey];
        return rows.find(r => rowKey(r) === pick) || rows[0] || null;
    }

    function renderFilters(byKey) {
        const parts = ['<div class="crm-sub-title">Фильтры</div>'];
        const applicable = [];
        for (const slot of FILTER_SLOTS) {
            const fp = record.filter_part_numbers?.[slot.key];
            const label = `<span class="crm-slot-label">${slot.label}</span>`;
            if (!fp || fp.absent || !fp.part) {
                parts.push(`<div class="crm-slot crm-slot-flat">${label} <span class="crm-dim">${!fp || fp.absent ? 'нет у машины' : 'артикул не заполнен'}</span></div>`);
                continue;
            }
            const rows = slotRows(byKey, slot.key);
            if (!rows.length) {
                parts.push(`<div class="crm-slot crm-slot-flat">${label} <b>${esc(fp.part)}</b> — <span class="crm-none">нет в CRM</span></div>`);
                continue;
            }
            // все найденные позиции — другого типа? артикул мог совпасть с чужим товаром
            const types = rows.map(r => detectFilterType(r.name)).filter(Boolean);
            const typeWarn = types.length && types.every(t => t !== slot.crmType)
                ? ' <span class="crm-type-warn" title="По названию найденное не похоже на этот тип фильтра">тип?</span>' : '';
            const chosen = pickedRow(byKey, slot.key);
            // Выбранный фильтр всегда виден сверху; альтернативы прячем под «ещё N»,
            // чтобы блок не растягивался. Клик по строке подставляет её в расчёт.
            const rest = rows.filter(r => rowKey(r) !== rowKey(chosen));
            const open = state.filterOpen[slot.key];
            const visible = (open ? [chosen, ...rest] : [chosen]).filter(Boolean);
            const rowsHtml = visible.map(r => {
                const isChosen = chosen && rowKey(r) === rowKey(chosen);
                return `
                <div class="crm-row crm-row-pick${isChosen ? ' crm-best' : ''}"
                     data-crm-pick="${esc(slot.key)}" data-crm-row="${esc(rowKey(r))}"
                     title="${isChosen ? 'этот фильтр в расчёте' : 'нажми, чтобы подставить этот фильтр в расчёт'}">
                    ${isChosen ? '<span class="crm-best-star" title="в расчёте">★</span>' : ''}
                    <span class="crm-row-name">${esc(cleanFilterName(r.name))}</span>
                    <span class="crm-row-count">${r.count} шт</span>
                    <span class="crm-row-price">${Math.round(r.priceRaw)}₽</span>
                </div>`;
            }).join('');
            const moreBtn = rest.length
                ? `<button class="crm-slot-more" data-crm-more="${esc(slot.key)}">${open ? 'скрыть' : `ещё ${rest.length}`}</button>`
                : '';
            applicable.push(slot.key);
            parts.push(`<div class="crm-slot">
                <div class="crm-slot-head">${label} <b>${esc(fp.part)}</b>${typeWarn}${moreBtn}</div>
                ${rowsHtml}
            </div>`);
        }
        if (applicable.length) {
            parts.push('<div class="crm-auto-note">✓ подставлено дешёвое — клик по строке выберет другой фильтр</div>');
        }
        return `<div class="crm-filters">${parts.join('')}</div>`;
    }

    function buildFiltersText(byKey) {
        // строки в формате вставки калькулятора: «вф <имя> - <цена>р»
        // (аббревиатуры сайта: vf=вф воздушный, mf=мф масляный, sf=сф салонный)
        const abbr = { vf: 'вф', mf: 'мф', sf: 'сф' };
        const lines = [];
        for (const slot of FILTER_SLOTS) {
            const best = pickedRow(byKey, slot.key);
            if (best) lines.push(`${abbr[slot.key]} ${cleanFilterName(best.name)} - ${Math.round(best.priceRaw)}р`);
        }
        return lines.join('\n');
    }

    // ── Масла ─────────────────────────────────────────────────────────────────

    // строки CRM → масла каталога; фасовки одного масла суммируем
    function matchOilRows(rows) {
        const shopOils = getShopOils();
        const matched = new Map(); // 'b_n' → { oil, liters, priceRaw, rows }
        const unmatched = [];
        for (const r of rows || []) {
            const m = matchCrmOilRow(r.name, shopOils);
            if (!m) { unmatched.push(r); continue; }
            const k = m.oil.b + '_' + m.oil.n;
            const cur = matched.get(k) || { oil: m.oil, liters: 0, priceRaw: null, rows: [] };
            cur.liters += decodeOilLiters(r.count);
            if (cur.priceRaw === null || r.priceRaw < cur.priceRaw) cur.priceRaw = r.priceRaw;
            cur.rows.push(r);
            matched.set(k, cur);
        }
        return { matched, unmatched };
    }

    // Полный список масел по умолчанию свёрнут: он дублирует карточки ДВС в
    // калькуляторе ниже (масло уже подставлено, остатки видно на карточке).
    // Здесь оставляем только короткую строку-итог и предупреждение о низком
    // остатке; развернуть можно кликом по шапке.
    function renderOils(oilRes) {
        const rows = oilRes?.rows || [];
        const shopOils = getShopOils();
        const carApprovals = Array.isArray(record.car_approvals) ? record.car_approvals : [];
        const need = engineNeedLiters(record);
        const { matched, unmatched } = matchOilRows(rows);

        const fits = (oil) => {
            if (!carApprovals.length) return true;
            const { matched: hit, hier } = splitOilApprovals(oil.a || [], carApprovals);
            return hit.length > 0 || (hier || []).length > 0;
        };

        const entries = [...matched.values()].map(e => ({ ...e, fits: fits(e.oil), liters: +e.liters.toFixed(1) }));
        // подходящие по допускам сверху, внутри группы — дешевле сначала
        entries.sort((a, b) => (b.fits - a.fits) || ((a.priceRaw ?? 1e9) - (b.priceRaw ?? 1e9)));

        // рекомендованные калькулятором масла этой вязкости, которых нет на станции
        const missing = shopOils.filter(o =>
            extractViscosity(o.v) === state.visc && fits(o) && !o.isSpot &&
            !matched.has(o.b + '_' + o.n));

        const nothing = !entries.length && !rows.length;
        const inStock = entries.filter(e => e.liters > 0);
        // «Представитель» — то, что скорее всего подставится в расчёт ДВС:
        // подходит по допускам и есть в наличии, дешевле сначала.
        const rep = entries.find(e => e.fits && e.liters > 0) || inStock[0] || null;
        const repLow = rep && need && rep.liters < need * 2;
        const open = state.showOils;

        // ── Свёрнутая шапка: сколько масел в наличии + переключатель ──
        const summary = nothing
            ? '<span class="crm-none">по этой вязкости пусто</span>'
            : inStock.length
                ? `<span class="crm-oils-count">${inStock.length} в наличии</span>`
                : '<span class="crm-none">нет в наличии</span>';
        const head = `
            <button class="crm-oils-head" id="crm-oils-toggle" aria-expanded="${open}">
                <span class="crm-caret">${open ? '▾' : '▸'}</span>
                <span class="crm-oils-name">Масло ${esc(state.visc)}</span>
                ${summary}
            </button>`;

        // Низкий остаток подставленного масла важен — показываем и в свёрнутом виде
        const warn = (!open && repLow)
            ? `<div class="crm-low-warn crm-low-flat">⚠ ${esc(rep.oil.b)} ${esc(rep.oil.n)}: осталось ${rep.liters} л (нужно ~${need} л)</div>`
            : '';

        if (!open) {
            return `<div class="crm-oils">${head}${warn}</div>`;
        }

        // ── Развёрнутый полный список ──
        const parts = [head];
        if (nothing) {
            parts.push('<div class="crm-none">Ничего не найдено в CRM по этой вязкости.</div>');
        }
        for (const e of entries) {
            parts.push(renderOilRow(e, need, carApprovals));
        }
        for (const o of missing) {
            parts.push(`
                <div class="crm-row crm-oil-missing">
                    <span class="crm-row-name">${esc(o.b)} ${esc(o.n)}</span>
                    <span class="crm-none">нет в наличии</span>
                </div>`);
        }
        if (unmatched.length) {
            const items = unmatched.map(r => `
                <div class="crm-row">
                    <span class="crm-row-name">${esc(r.name)}</span>
                    <span class="crm-row-count">${decodeOilLiters(r.count)} л</span>
                    <span class="crm-row-price">≈${crmOilPricePerLiter(r.priceRaw)}₽/л</span>
                </div>`).join('');
            parts.push(`
                <button class="crm-other-toggle" id="crm-other-toggle">${state.showOther ? '▾' : '▸'} Ещё в наличии (${unmatched.length})</button>
                ${state.showOther ? `<div class="crm-other">${items}</div>` : ''}`);
        }
        if (need) {
            parts.push(`<div class="crm-dim crm-need-note">Заправка ≈ ${need} л; предупреждаем, если остаток меньше ${+(need * 2).toFixed(1)} л (две заправки).</div>`);
        }
        return `<div class="crm-oils crm-oils-open">${parts.join('')}</div>`;
    }

    function renderOilRow(e, need, carApprovals) {
        const pricePerL = crmOilPricePerLiter(e.priceRaw);
        // цена в CRM за 0.1 л; если после ×10 она дико расходится с каталожной —
        // не доверяем пересчёту молча, показываем сырое значение
        const catalogPrice = e.oil.price || 0;
        const priceOff = catalogPrice && Math.abs(pricePerL - catalogPrice) / catalogPrice > 0.3;
        const priceHtml = priceOff
            ? `<span class="crm-price-warn" title="Пересчёт ×10 расходится с ценой каталога (${catalogPrice}₽/л) — в CRM указано ${esc(String(e.priceRaw))}">⚠ ${esc(String(e.priceRaw))} в CRM</span>`
            : `<span class="crm-row-price">≈${pricePerL}₽/л</span>`;
        const low = need && e.liters < need * 2;
        const lowHtml = e.liters <= 0
            ? '<div class="crm-low-warn">нет в наличии</div>'
            : low ? `<div class="crm-low-warn">⚠ масла осталось очень мало: ${e.liters} л (машине нужно ~${need} л)</div>` : '';
        const fitsBadge = carApprovals.length
            ? (e.fits ? '<span class="crm-fit" title="Подходит машине по допускам">✓ допуски</span>'
                      : '<span class="crm-nofit" title="Допуски машины не подтверждены у этого масла">не по допускам</span>')
            : '';
        return `
            <div class="crm-row crm-oil-row${low ? ' crm-oil-low' : ''}">
                <span class="crm-row-name">${e.oil.isSpot ? '<span class="spot-pill">SPOT</span>' : ''}${esc(e.oil.b)} ${esc(e.oil.n)} ${fitsBadge}</span>
                <span class="crm-row-count"><b>${e.liters} л</b></span>
                ${priceHtml}
                ${lowHtml}
            </div>`;
    }

    // ── События ───────────────────────────────────────────────────────────────

    function bind() {
        const form = root.querySelector('#crm-login-form');
        if (form) form.onsubmit = (ev) => {
            ev.preventDefault();
            const login = root.querySelector('#crm-login')?.value.trim();
            const password = root.querySelector('#crm-password')?.value;
            if (login && password) doLogin(login, password);
        };
        const logout = root.querySelector('#crm-logout');
        if (logout) logout.onclick = () => doLogout();
        const sel = root.querySelector('#crm-station');
        if (sel) sel.onchange = () => {
            state.stationId = sel.value;
            dropResults();
            if (state.stationId) localStorage.setItem(STATION_KEY, state.stationId);
            else localStorage.removeItem(STATION_KEY);
            if (state.stationId) runCheck(); else render();
        };
        const refresh = root.querySelector('#crm-refresh');
        if (refresh) refresh.onclick = () => runCheck();
        const retry = root.querySelector('#crm-retry');
        if (retry) retry.onclick = () => (state.stations === null || !state.stations.length) ? loadStations() : runCheck();
        // Свернуть/развернуть полный список масел (по умолчанию свёрнут)
        const oilsToggle = root.querySelector('#crm-oils-toggle');
        if (oilsToggle) oilsToggle.onclick = () => { state.showOils = !state.showOils; render(); };
        // Показать/скрыть альтернативные фильтры внутри слота
        root.querySelectorAll('[data-crm-more]').forEach(b => {
            b.onclick = () => {
                const k = b.dataset.crmMore;
                state.filterOpen[k] = !state.filterOpen[k];
                render();
            };
        });
        const toggle = root.querySelector('#crm-other-toggle');
        if (toggle) toggle.onclick = () => { state.showOther = !state.showOther; render(); };
        // Ручной выбор фильтра: клик по строке подставляет её в расчёт
        root.querySelectorAll('[data-crm-pick]').forEach(row => {
            row.onclick = () => {
                state.filterPick[row.dataset.crmPick] = row.dataset.crmRow;
                pushToCalculator();
                render();
            };
        });
    }
}

// ── Хелперы ──────────────────────────────────────────────────────────────────

// Вязкость, выбранная сейчас в калькуляторе (он инициализируется раньше панели)
function currentCalcViscosity() {
    const v = typeof window.__zmCalcVisc === 'function' ? window.__zmCalcVisc() : null;
    return v && VISCOSITIES.includes(v) ? v : null;
}

function filterItems(record) {
    const items = [];
    for (const slot of FILTER_SLOTS) {
        const fp = record.filter_part_numbers?.[slot.key];
        if (fp && !fp.absent && fp.part) items.push({ key: slot.key, query: fp.part });
    }
    return items;
}

// Стартовая вязкость: из снапшота рекомендаций машины, иначе 5W-30
function defaultViscosity(record) {
    const rec = Array.isArray(record.recommended_oils)
        ? record.recommended_oils.find(r => r.key === 'engine') : null;
    const v = rec?.oil1?.v && extractViscosity(rec.oil1.v);
    return v && VISCOSITIES.includes(v) ? v : '5W-30';
}

// Объём заправки двигателя в литрах (для порога «меньше двух заправок»)
function engineNeedLiters(record) {
    const eng = record.fluid_capacities?.engine;
    const v = parseFloat(eng?.volumeService) || parseFloat(eng?.volumeTotal) || 0;
    return v > 0 ? v : null;
}
