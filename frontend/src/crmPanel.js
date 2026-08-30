// ─────────────────────────────────────────────────────────────────────────────
// Панель «Наличие на станции»: работник входит в CRM через сайт под СВОЕЙ
// учёткой, выбирает адрес — сайт сам проверяет в CRM наличие фильтров машины
// по артикулам и моторных масел по вязкости. Остаток масла декодируется
// «÷10 в литры», предупреждаем, когда остатка меньше двух заправок машины.
//
// Учётка CRM привязана к аккаунту сайта: логин вводят ОДИН раз, дальше сайт
// входит в CRM теми же данными сам (бэкенд держит логин и зашифрованный пароль,
// см. backend/src/crm/client.js). Поэтому здесь есть состояние «вхожу по
// сохранённым данным…», а форма появляется только когда привязки нет или CRM
// перестала принимать сохранённый пароль.
//
// Кнопка «Выйти» — полный выход: бэкенд закрывает сессию в самой CRM, ждёт
// подтверждения и снимает привязку. Не подтвердилось — показываем ошибку и
// НЕ делаем вид, что вышли.
// ─────────────────────────────────────────────────────────────────────────────

import './crmPanel.css';
import { getShopOils } from '../../shared/oils.js';
import { splitOilApprovals } from '../../shared/calculator.js';
import {
    decodeOilLiters, crmOilPricePerLiter, matchCrmOilRow,
    cleanFilterName, detectFilterType, FILTER_SLOTS, extractViscosity,
    sortFilterRows,
} from '../../shared/crmAnalyse.js';
import { initSelects } from './select.js';

const VISCOSITIES = ['0W-20', '0W-30', '5W-30', '5W-40', '10W-40'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function initCrmPanel(record, { apiFetch }) {
    initSelects();   // свои выпадающие списки вместо нативных, см. select.js
    const root = document.getElementById('crm-panel');
    if (!root) return;

    const state = {
        crmAuth: null,           // null = выясняем, true = в CRM, false = нужен вход
        authNote: '',            // пояснение над формой входа («сессия завершена…»)
        loggingIn: false,
        loggingOut: false,       // ждём, пока CRM подтвердит закрытие сессии
        linkedLogin: null,       // логин CRM, привязанный к аккаунту (или null)
        autoLogin: false,        // сессию поднял сам сайт по привязке
        canLink: true,           // бэкенду есть чем шифровать пароль (CRM_LINK_SECRET)
        stations: null,          // [{id, name}] | null пока грузится
        // Каждая машина открывается с «выбери станцию…»: станция не запоминается
        // между машинами специально. Раньше сохранённый адрес подхватывался и
        // панель сразу лезла в CRM за фильтрами и маслом — вхолостую, если
        // человек открыл карточку просто посмотреть или работает не с той
        // станции, что в прошлый раз. Запрос идёт только после выбора руками.
        stationId: '',
        // Стартуем с вязкости калькулятора (он инициализируется раньше) —
        // тогда первая же проверка сможет подставить масло в расчёт
        visc: currentCalcViscosity() || defaultViscosity(record),
        loading: false,
        error: null,             // { code, message }
        results: null,           // ответ /availability
        showOils: false,         // развёрнут ли полный список масел (по умолчанию свёрнут —
                                 // он дублирует карточки ДВС в калькуляторе ниже)
        showOther: false,        // развёрнут ли блок «ещё в наличии»
        filterPick: {},          // slot.key → id строки CRM, выбранной вручную (выпадашкой)
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

    // Статус заодно поднимает сессию CRM по привязке (см. routes/crm.js), так
    // что первый заход на страницу машины обычно сразу оказывается «в CRM».
    async function checkStatus() {
        try {
            const st = await apiFetch('/api/crm/status');
            state.crmAuth = st.loggedIn;
            state.linkedLogin = st.crmLogin || null;
            state.autoLogin = Boolean(st.autoLogin);
            state.canLink = st.canLink !== false;
            if (st.linkRejected) {
                state.authNote = 'Сохранённые данные CRM больше не подходят (сменился пароль?) — войди заново.';
            } else if (st.unavailable && !st.loggedIn) {
                state.authNote = `CRM не ответила на автоматический вход: ${st.unavailable}`;
            } else {
                state.authNote = '';
            }
            if (st.loggedIn) return loadStations();
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
            const resp = await apiFetch('/api/crm/login', { method: 'POST', body: { login, password } });
            state.crmAuth = true;
            state.authNote = '';
            state.loggingIn = false;
            state.linkedLogin = resp.linked ? login : null;
            state.autoLogin = false;
            await loadStations();
        } catch (e) {
            state.loggingIn = false;
            state.error = { code: e.code || 'network', message: e.message };
            render();
        }
    }

    // Полный выход: сначала CRM должна подтвердить, что сессия закрыта, и
    // только тогда панель возвращается к форме. Привязку снимаем — человек
    // именно этого и просил кнопкой «Выйти».
    async function doLogout() {
        state.loggingOut = true;
        state.error = null;
        render();
        try {
            await apiFetch('/api/crm/logout', { method: 'POST', body: { unlink: true } });
        } catch (e) {
            state.loggingOut = false;
            state.error = { code: e.code || 'network', message: e.message };
            render();
            return;
        }
        state.loggingOut = false;
        state.crmAuth = false;
        state.linkedLogin = null;
        state.autoLogin = false;
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
            // Список загружен — и всё, дальше ждём выбора станции. Сами в CRM за
            // наличием не идём: до выбора адреса проверять нечего.
            render();
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
                    ${state.crmAuth === true ? `<button class="crm-logout" id="crm-logout" ${state.loggingOut ? 'disabled' : ''} title="Закрыть сессию в CRM и забыть привязанную учётку">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                        <span>${state.loggingOut ? 'выхожу…' : 'Выйти'}</span></button>` : ''}
                </div>
                ${state.crmAuth === null ? '<div class="crm-loading">Вхожу в CRM по сохранённым данным…</div>' : ''}
                ${state.crmAuth === true && state.linkedLogin ? renderLinkNote() : ''}
                ${state.crmAuth === false ? renderLoginForm() : ''}
                ${state.crmAuth === true ? renderStationRow() : ''}
                ${state.error ? renderError() : ''}
                ${state.loading ? '<div class="crm-loading">Проверяю наличие в CRM…</div>' : ''}
                ${state.crmAuth === true && !state.loading && state.results ? renderResults() : ''}
            </div>
        `;
        bind();
    }

    // Привязка видна в панели: понятно, под какой учёткой сайт вошёл в CRM и
    // что вход был автоматическим (данные никто заново не вводил).
    function renderLinkNote() {
        return `
            <div class="crm-link-note">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L10.6 5.24"/><path d="M14 11a5 5 0 0 0-7.07 0L4.8 13.12a5 5 0 0 0 7.07 7.07L13.4 18.76"/></svg>
                <span>CRM: ${esc(state.linkedLogin)}${state.autoLogin ? ' — вошли автоматически' : ''}</span>
            </div>`;
    }

    function renderLoginForm() {
        const hint = state.canLink
            ? 'Войди своей учёткой CRM — сайт запомнит её и в следующий раз войдёт сам.'
            : 'Войди своей учёткой CRM — на этом сервере запоминание пароля выключено.';
        return `
            ${state.authNote ? `<div class="warn-box">${esc(state.authNote)}</div>` : ''}
            <div class="crm-dim" style="margin-bottom:6px">${hint}</div>
            <form id="crm-login-form" class="crm-login-form" autocomplete="off">
                <input type="text" id="crm-login" class="crm-input" placeholder="логин CRM" autocomplete="username" value="${esc(state.linkedLogin || '')}" ${state.loggingIn ? 'disabled' : ''}/>
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
                <button class="crm-refresh" id="crm-refresh" title="Проверить наличие заново" aria-label="Проверить заново" ${state.stationId ? '' : 'disabled'}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>
            </div>
        `;
    }

    function renderError() {
        const texts = {
            crm_auth_failed: 'CRM не приняла логин или пароль.',
            crm_unavailable: state.error.message || 'CRM недоступна. Попробуйте ещё раз.',
            crm_logout_failed: 'CRM не подтвердила, что сессия закрыта — вы всё ещё в CRM. Попробуйте выйти ещё раз.',
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

    // Каждый тип фильтра — карточка единого размера: сверху тип, крупно то,
    // что подставлено в расчёт (если позиций несколько — выпадашкой выбора),
    // ниже цена и остаток, внизу — артикул машины, по которому искали.
    function renderFilters(byKey) {
        const cards = FILTER_SLOTS.map(slot => filterCard(slot, byKey)).join('');
        return `<div class="crm-sub-title">Фильтры</div><div class="crm-filter-cards">${cards}</div>`;
    }

    function filterCard(slot, byKey) {
        const cap = `<div class="crm-fcard-cap">${slot.label}</div>`;
        const fp = record.filter_part_numbers?.[slot.key];
        if (!fp || fp.absent || !fp.part) {
            const msg = !fp || fp.absent ? 'нет у машины' : 'артикул не заполнен';
            return `<div class="crm-fcard crm-fcard-off">${cap}<div class="crm-fcard-state crm-dim">${msg}</div></div>`;
        }
        const rows = slotRows(byKey, slot.key);
        if (!rows.length) {
            return `<div class="crm-fcard crm-fcard-off">${cap}<div class="crm-fcard-state crm-none">нет в CRM</div><div class="crm-fcard-art">${esc(fp.part)}</div></div>`;
        }
        // все найденные позиции — другого типа? артикул мог совпасть с чужим товаром
        const types = rows.map(r => detectFilterType(r.name)).filter(Boolean);
        const typeWarn = types.length && types.every(t => t !== slot.crmType)
            ? ' <span class="crm-type-warn" title="По названию найденное не похоже на этот тип фильтра">тип?</span>' : '';
        const chosen = pickedRow(byKey, slot.key);
        // Несколько позиций — выпадашка выбора; одна — просто название.
        const nameEl = rows.length > 1
            ? `<select class="crm-fcard-select" data-crm-pick="${esc(slot.key)}" aria-label="Выбрать ${esc(slot.label)} фильтр">
                ${rows.map(r => `<option value="${esc(rowKey(r))}"${rowKey(r) === rowKey(chosen) ? ' selected' : ''}>${esc(cleanFilterName(r.name))} · ${Math.round(r.priceRaw)} ₽</option>`).join('')}
               </select>`
            : `<div class="crm-fcard-name">${esc(cleanFilterName(chosen.name))}</div>`;
        return `
            <div class="crm-fcard">
                ${cap}
                ${nameEl}
                <div class="crm-fcard-meta"><span class="crm-fcard-price">${Math.round(chosen.priceRaw)} ₽</span><span class="crm-fcard-count">${chosen.count} шт</span></div>
                <div class="crm-fcard-art">${esc(fp.part)}${typeWarn}</div>
            </div>`;
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
                <svg class="crm-chev" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                <span class="crm-oils-name">Масло ${esc(state.visc)}</span>
                ${summary}
            </button>`;

        // Низкий остаток подставленного масла важен — показываем и в свёрнутом виде
        const warn = (!open && repLow)
            ? `<div class="crm-low-warn crm-low-flat">${esc(rep.oil.b)} ${esc(rep.oil.n)}: осталось ${rep.liters} л (нужно ~${need} л)</div>`
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
                <button class="crm-other-toggle${state.showOther ? ' is-open' : ''}" id="crm-other-toggle"><svg class="crm-chev" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg> Ещё в наличии (${unmatched.length})</button>
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
            ? `<span class="crm-price-warn" title="Пересчёт ×10 расходится с ценой каталога (${catalogPrice}₽/л) — в CRM указано ${esc(String(e.priceRaw))}">${esc(String(e.priceRaw))} в CRM</span>`
            : `<span class="crm-row-price">≈${pricePerL}₽/л</span>`;
        const low = need && e.liters < need * 2;
        const lowHtml = e.liters <= 0
            ? '<div class="crm-low-warn">нет в наличии</div>'
            : low ? `<div class="crm-low-warn">масла осталось очень мало: ${e.liters} л (машине нужно ~${need} л)</div>` : '';
        const fitsBadge = carApprovals.length
            ? (e.fits ? '<span class="crm-fit" title="Подходит машине по допускам">допуски</span>'
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
            if (state.stationId) runCheck(); else render();
        };
        const refresh = root.querySelector('#crm-refresh');
        if (refresh) refresh.onclick = () => runCheck();
        const retry = root.querySelector('#crm-retry');
        if (retry) retry.onclick = () => {
            if (state.error?.code === 'crm_logout_failed') return doLogout();
            return (state.stations === null || !state.stations.length) ? loadStations() : runCheck();
        };
        // Свернуть/развернуть полный список масел (по умолчанию свёрнут)
        const oilsToggle = root.querySelector('#crm-oils-toggle');
        if (oilsToggle) oilsToggle.onclick = () => { state.showOils = !state.showOils; render(); };
        const toggle = root.querySelector('#crm-other-toggle');
        if (toggle) toggle.onclick = () => { state.showOther = !state.showOther; render(); };
        // Выбор фильтра из карточки: выпадашка подставляет позицию в расчёт
        root.querySelectorAll('select[data-crm-pick]').forEach(sel => {
            sel.onchange = () => {
                state.filterPick[sel.dataset.crmPick] = sel.value;
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
