// ─────────────────────────────────────────────────────────────────────────────
// Site-glue юзерскрипта: DOM, GM_*, парсеры сайтов, виджет.
// Вся логика подбора/расчёта и каталог масел живут в shared/ — правки цен
// и допусков делаются ТОЛЬКО там, файл *.user.js собирается автоматически.
// ─────────────────────────────────────────────────────────────────────────────

import {
    roundL, normApproval, tokenSet, anyMatch, splitOilApprovals, sapsLabel,
    matchOilToReglament, extractAtfSpecs, oilAtfMatches, pickAtfOils,
    getAggregates, shouldDefaultToPartial,
    totalAggLabel, totalOilLabel, computeTotalSum,
    filtersTotal as sharedFiltersTotal,
    anyFilterEnabled as sharedAnyFilterEnabled,
    pickEngineOils as sharedPickEngineOils,
    calcForAggregate as sharedCalcForAggregate,
    manualWarnText,
} from '../../../shared/calculator.js';
import {
    getShopOils, getMotulOils, getDefaults, getReglament, getReglamentForBrand,
} from '../../../shared/oils.js';
import {
    buildReport,
    formatAggText as sharedFormatAggText,
    buildTotalsLines as sharedBuildTotalsLines,
} from '../../../shared/report.js';
import { SERVICE_FLAGS } from '../../../shared/serviceFlags.js';
import {
    crmQuirksForAggregate, crmNoFullAt, SEVERITY_LABELS,
} from '../../../shared/crmQuirks.js';
import { fuelLabel, fuelSelectOptions } from '../../../shared/fuel.js';
import {
    SOURCE_SITES, SOURCE_LABELS, buildSourceKeys, cleanSourceLinks,
} from '../../../shared/sourceLinks.js';
import { parseMannUrl } from '../parsers.js';

// ── База рассчитанных машин ───────────────────────────────────────────────────
// Адрес backend и ключ. Для продакшена: поменять значения и добавить хост
// в @connect в header.txt (см. README).
const DB_API_BASE = 'https://cars-db-backend.onrender.com';
const DB_API_KEY  = 'a56817cfece2ca6ad4bfdf7c2a7b83e1df99184d09daf574';
const DB_SITE_URL = 'https://alwaysnevereat.github.io/scripts';

// ── Адаптеры: сохраняют старые сигнатуры, замыкаясь на calcState/GM_getValue ──

function currentCarApprovals() {
    const car = calcState && calcState.car;
    if (!car) return [];
    const v = GM_getValue('rolf_approvals_' + car.cacheKey, null);
    return Array.isArray(v) ? v : [];
}

// ── Сурс-ссылки: страницы машины на сайтах подбора ────────────────────────────
// Каждая площадка (mann/lynx/ravenol/motul/rolf) при заходе на машину пишет свой
// URL в общий для всех вкладок GM-стор по cacheKey. В отчёт они попадают уже
// собранными: где встретили машину, где искали объёмы (Motul) и допуска (ROLF).

function recordSourceLink(cacheKey, site, url) {
    if (!cacheKey || !site || !url) return;
    const k = 'zm_sources_' + cacheKey;
    const cur = GM_getValue(k, null);
    const obj = (cur && typeof cur === 'object' && !Array.isArray(cur)) ? cur : {};
    if (obj[site] === url) return; // без лишних записей
    obj[site] = url;
    GM_setValue(k, obj);
}

function getSourceLinks(cacheKey) {
    if (!cacheKey) return {};
    const v = GM_getValue('zm_sources_' + cacheKey, null);
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
}

function pickEngineOils(agg, shopOils) {
    return sharedPickEngineOils(agg, shopOils, calcState, currentCarApprovals());
}

function filtersTotal()     { return sharedFiltersTotal(calcState); }
function anyFilterEnabled() { return sharedAnyFilterEnabled(calcState); }

function formatAggText(agg, calc) { return sharedFormatAggText(agg, calc, calcState); }
function buildTotalsLines() { return sharedBuildTotalsLines(calcState, calcState.data, currentCarApprovals()); }

function rerenderResult() {
    const el = document.getElementById('zm-result');
    if (!el) return;
    el.textContent = buildReport(calcState.car, calcState.data, calcState, currentCarApprovals());
}

// ══════════════════════════════════════════════════════════════════
//          ОТПРАВКА ОТЧЁТА В БАЗУ РАССЧИТАННЫХ МАШИН
// ══════════════════════════════════════════════════════════════════

// Токен сессии — привязка «Отправить отчёт» к залогиненному пользователю.
// Полночь МСК протухает сессию на бэке — токен просто перестаёт работать
// (401), и мы заново спрашиваем логин, как и должно быть по ТЗ.
function getStoredToken() { return GM_getValue('zm_session_token', null); }
function setStoredToken(t) { if (t) GM_setValue('zm_session_token', t); else GM_deleteValue('zm_session_token'); }

function dbRequest(method, path, body) {
    return new Promise((resolve, reject) => {
        const headers = {
            'Content-Type': 'application/json',
            'x-api-key': DB_API_KEY,
        };
        const token = getStoredToken();
        if (token) headers['Authorization'] = 'Bearer ' + token;

        GM_xmlhttpRequest({
            method,
            url: DB_API_BASE + path,
            headers,
            data: body ? JSON.stringify(body) : undefined,
            timeout: 15000,
            onload: (resp) => {
                let json = null;
                try { json = JSON.parse(resp.responseText); } catch {}
                if (resp.status >= 200 && resp.status < 300) resolve(json);
                else {
                    const err = new Error((json && json.error) || ('HTTP ' + resp.status));
                    err.status = resp.status;
                    reject(err);
                }
            },
            onerror:   () => reject(new Error('сеть недоступна (' + DB_API_BASE + ')')),
            ontimeout: () => reject(new Error('таймаут запроса')),
        });
    });
}

async function dbLogin(login, password) {
    const resp = await dbRequest('POST', '/api/auth/login', { login, password });
    setStoredToken(resp.token);
    return resp.user;
}

// Окно логина: резолвит true при успешном входе, false при отмене.
function openLoginModal() {
    return new Promise((resolve) => {
        const old = document.getElementById('zm-login-modal');
        if (old) old.remove();

        const modal = document.createElement('div');
        modal.id = 'zm-login-modal';
        modal.innerHTML = `
            <div class="zm-db-backdrop"></div>
            <div class="zm-db-win" style="width:340px">
                <div class="zm-db-head">
                    <span>🔐 Вход для отправки отчёта</span>
                    <button class="zm-btn zm-btn-sec" id="zm-login-close">✕</button>
                </div>
                <div class="zm-db-body">
                    <label class="zm-db-field"><span>Логин</span>
                        <input type="text" id="zm-login-login" autocomplete="username"/>
                    </label>
                    <label class="zm-db-field" style="margin-top:8px"><span>Пароль</span>
                        <input type="password" id="zm-login-password" autocomplete="current-password"/>
                    </label>
                    <div id="zm-login-error" class="zm-db-error" style="display:none"></div>
                </div>
                <div class="zm-db-foot">
                    <button class="zm-btn zm-btn-sec" id="zm-login-cancel">Отмена</button>
                    <button class="zm-btn zm-btn-pri" id="zm-login-submit">Войти</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const finish = (ok) => { modal.remove(); resolve(ok); };
        modal.querySelector('.zm-db-backdrop').onclick = () => finish(false);
        document.getElementById('zm-login-close').onclick = () => finish(false);
        document.getElementById('zm-login-cancel').onclick = () => finish(false);

        const submit = async () => {
            const btn = document.getElementById('zm-login-submit');
            const errBox = document.getElementById('zm-login-error');
            const login = document.getElementById('zm-login-login').value.trim();
            const password = document.getElementById('zm-login-password').value;
            if (!login || !password) {
                errBox.textContent = 'Заполните логин и пароль';
                errBox.style.display = 'block';
                return;
            }
            errBox.style.display = 'none';
            btn.disabled = true;
            btn.textContent = 'Входим…';
            try {
                await dbLogin(login, password);
                finish(true);
            } catch (e) {
                errBox.textContent = '⚠ ' + e.message;
                errBox.style.display = 'block';
                btn.disabled = false;
                btn.textContent = 'Войти';
            }
        };
        document.getElementById('zm-login-submit').onclick = submit;
        document.getElementById('zm-login-password').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
        });
    });
}

// Гарантирует валидный токен перед отправкой: если его нет — сразу просит
// войти. Просроченный/забаненный токен (401 от сервера) разбирается уже
// в самом submit-обработчике — там же, где летит запрос.
async function ensureLoggedIn() {
    if (getStoredToken()) return true;
    return await openLoginModal();
}

// Снапшот рекомендаций для recommended_oils (справка «что советовали при сохранении»)
function snapshotRecommendedOils() {
    const engineAgg = getAggregates(calcState.data).find(a => a.group === 'engine');
    if (!engineAgg) return [];
    const picks = pickEngineOils(engineAgg, getShopOils());
    const strip = (o) => o ? { b: o.b, n: o.n, price: o.price, v: o.v } : null;
    return [
        ...(engineAgg.topCandidates || []).map(strip),
        ...(picks.spot ? [strip(picks.spot)] : []),
    ].filter(Boolean);
}

function openDbModal(car) {
    const old = document.getElementById('zm-db-modal');
    if (old) old.remove();

    const aggs = getAggregates(calcState.data);
    const approvals = currentCarApprovals();
    const f = calcState.filters || {};

    const idField = (key, label, value, hint) => `
        <label class="zm-db-field">
            <span>${label}</span>
            <input type="text" data-db-field="${key}" value="${escapeHtmlSafe(value == null ? '' : String(value))}" placeholder="${hint || ''}"/>
        </label>`;

    const aggRow = (agg) => {
        const vol = roundL(parseFloat(agg.volume || 0) + parseFloat(agg.filterVolume || 0)) ||
                    roundL((calcState.volumeOverride || {})[agg.key]) || '';
        const products = (agg.motulProducts || agg.approvals || []).slice(0, 6)
            .map(p => `<span class="zm-db-chip">${escapeHtml(p)}</span>`).join('');
        return `
            <div class="zm-db-agg-row">
                <span class="zm-db-agg-lbl">${escapeHtml(agg.label)}</span>
                <input type="number" step="0.1" min="0" data-db-vol="${agg.key}" value="${vol}" placeholder="?"/>
                <span class="zm-db-agg-l">л</span>
                <div class="zm-db-agg-products">${products}</div>
            </div>`;
    };

    const filterRow = (key, label) => {
        const fd = f[key] || {};
        const absent = fd.name === '[нет]';
        const part = absent ? '' : (fd.name || '');
        return `
            <div class="zm-db-filter-row">
                <span class="zm-db-agg-lbl">${label}</span>
                <input type="text" data-db-filter="${key}" value="${escapeHtmlSafe(part)}" placeholder="артикул" ${absent ? 'disabled' : ''}/>
                <label class="zm-db-chk"><input type="checkbox" data-db-filter-absent="${key}" ${absent ? 'checked' : ''}/> отсутствует</label>
            </div>`;
    };

    const flagRows = Object.entries(SERVICE_FLAGS).map(([key, def]) => `
        <label class="zm-db-chk zm-db-flag"><input type="checkbox" data-db-flag="${key}"/> ${escapeHtml(def.label)}</label>
    `).join('');

    const savedLinks = getSourceLinks(car.cacheKey);
    const sourceRows = SOURCE_SITES.map(site => `
        <label class="zm-db-field">
            <span>${escapeHtml(SOURCE_LABELS[site])}</span>
            <input type="url" data-db-source="${site}" value="${escapeHtmlSafe(savedLinks[site] || '')}" placeholder="ссылка на страницу машины"/>
        </label>`).join('');

    const modal = document.createElement('div');
    modal.id = 'zm-db-modal';
    modal.innerHTML = `
        <div class="zm-db-backdrop"></div>
        <div class="zm-db-win">
            <div class="zm-db-head">
                <span>📤 Отправить отчёт в базу машин</span>
                <button class="zm-btn zm-btn-sec" id="zm-db-close">✕</button>
            </div>
            <div class="zm-db-body">
                <div class="zm-db-note">Проверь данные перед отправкой — они попадут на сайт для всех.</div>

                <div class="zm-db-sec-h">Машина</div>
                <div class="zm-db-grid">
                    ${idField('brand',        'Марка *',   car.makeShort)}
                    ${idField('model',        'Модель *',  car.modelShort)}
                    ${idField('engine_name',  'Двигатель', car.engineName)}
                    ${idField('engine_code',  'Код двиг.', car.engineCode)}
                    ${idField('engine_volume','Объём, л',  car.volume)}
                    ${idField('year_from',    'Год с *',   car.yearFrom)}
                    ${idField('kw',           'кВт',       car.kw)}
                    ${idField('bhp',          'л.с.',      car.bhp)}
                    <label class="zm-db-field">
                        <span>Топливо *</span>
                        <select data-db-field="fuel_type">${fuelSelectOptions(car.fuelType)}</select>
                    </label>
                </div>

                <div class="zm-db-sec-h">Объёмы жидкостей (Motul)</div>
                ${aggs.length ? aggs.map(aggRow).join('') : '<div class="zm-db-note">нет данных — сначала найди машину на Motul</div>'}

                <div class="zm-db-sec-h">Допуски масла (ROLF) — по одному в строке</div>
                <textarea id="zm-db-approvals" rows="3" placeholder="MB 229.5&#10;VW 502 00">${escapeHtml(approvals.join('\n'))}</textarea>

                <div class="zm-db-sec-h">Фильтры ДВС</div>
                ${filterRow('vf', 'вф (масляный)')}
                ${filterRow('mf', 'мф (воздушный)')}
                ${filterRow('sf', 'сф (салонный)')}

                <div class="zm-db-sec-h">Особенности обслуживания</div>
                ${flagRows}

                <div class="zm-db-sec-h">Страницы машины (сурс-ссылки)</div>
                <div class="zm-db-note">Кнопки на странице машины + по ним нотификатор находит эту машину у коллег.</div>
                <div class="zm-db-grid">${sourceRows}</div>

                <div class="zm-db-sec-h">Заметка (необязательно)</div>
                <textarea id="zm-db-notes" rows="2" placeholder="например: сливная пробка под квадрат 8мм"></textarea>

                <div id="zm-db-error" class="zm-db-error" style="display:none"></div>
            </div>
            <div class="zm-db-foot">
                <button class="zm-btn zm-btn-sec" id="zm-db-cancel">Отмена</button>
                <button class="zm-btn zm-btn-pri" id="zm-db-submit">📤 Отправить</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('.zm-db-backdrop').onclick = close;
    document.getElementById('zm-db-close').onclick = close;
    document.getElementById('zm-db-cancel').onclick = close;

    modal.querySelectorAll('[data-db-filter-absent]').forEach(chk => {
        chk.onchange = () => {
            const inp = modal.querySelector(`[data-db-filter="${chk.dataset.dbFilterAbsent}"]`);
            inp.disabled = chk.checked;
            if (chk.checked) inp.value = '';
        };
    });

    document.getElementById('zm-db-submit').onclick = async () => {
        const btn = document.getElementById('zm-db-submit');
        const errBox = document.getElementById('zm-db-error');
        const field = (k) => modal.querySelector(`[data-db-field="${k}"]`);
        const val = (k) => (field(k) ? field(k).value.trim() : '');

        // fluid_capacities: копия данных Motul с правками объёмов из формы
        const fluid = JSON.parse(JSON.stringify(calcState.data || {}));
        delete fluid.motulName;
        for (const agg of aggs) {
            const inp = modal.querySelector(`[data-db-vol="${agg.key}"]`);
            const v = inp ? parseFloat(inp.value) : NaN;
            if (!isFinite(v) || v <= 0 || !fluid[agg.key]) continue;
            if (agg.key === 'engine') fluid.engine.volumeService = v;
            else fluid[agg.key].volumeTotal = v;
        }

        const filters = {};
        for (const key of ['vf', 'mf', 'sf']) {
            const absent = modal.querySelector(`[data-db-filter-absent="${key}"]`).checked;
            const part = modal.querySelector(`[data-db-filter="${key}"]`).value.trim();
            filters[key] = absent ? { part: null, absent: true } : { part, absent: false };
        }

        const flags = {};
        modal.querySelectorAll('[data-db-flag]').forEach(chk => {
            if (chk.checked) flags[chk.dataset.dbFlag] = true;
        });

        const sourceLinks = {};
        modal.querySelectorAll('[data-db-source]').forEach(inp => {
            const url = inp.value.trim();
            if (url) sourceLinks[inp.dataset.dbSource] = url;
        });
        const cleanedLinks = cleanSourceLinks(sourceLinks);

        // выбранное топливо — в машину, чтобы снапшот рекомендаций и подбор
        // считались как для дизеля/бензина, а не как угадал парсер
        const fuelSel = val('fuel_type');
        car.fuelType = fuelSel;
        if (calcState.car) calcState.car.fuelType = fuelSel;

        const payload = {
            brand: val('brand'), model: val('model'),
            engine_name: val('engine_name') || null,
            engine_code: val('engine_code') || null,
            engine_volume: parseFloat(val('engine_volume')) || null,
            year_from: parseInt(val('year_from')) || null,
            kw: parseInt(val('kw')) || null,
            bhp: parseInt(val('bhp')) || null,
            fuel_type: fuelSel || null,
            motul_name: (calcState.data && calcState.data.motulName) || null,
            fluid_capacities: fluid,
            filter_part_numbers: filters,
            car_approvals: document.getElementById('zm-db-approvals').value
                .split(/\r?\n/).map(s => s.trim()).filter(Boolean),
            recommended_oils: snapshotRecommendedOils(),
            service_flags: flags,
            source_links: cleanedLinks,
            source_keys: buildSourceKeys(cleanedLinks),
            notes: document.getElementById('zm-db-notes').value.trim() || null,
            // created_by сервер берёт из сессии залогиненного пользователя —
            // клиентское значение игнорируется (см. backend/src/routes/cars.js).
        };

        errBox.style.display = 'none';

        if (!(await ensureLoggedIn())) return; // юзер отменил вход — отчёт не отправляем

        btn.disabled = true;
        btn.textContent = '⏳ отправка…';
        try {
            let resp;
            try {
                resp = await dbRequest('POST', '/api/cars', payload);
            } catch (e) {
                if (e.status === 401) {
                    // Токен протух (например, наступила полночь МСК) — просим войти
                    // заново и повторяем ту же отправку один раз.
                    setStoredToken(null);
                    if (!(await openLoginModal())) throw new Error('вход отменён');
                    resp = await dbRequest('POST', '/api/cars', payload);
                } else {
                    throw e;
                }
            }
            close();
            showDbToast(resp);
        } catch (e) {
            errBox.textContent = '⚠ ' + e.message;
            errBox.style.display = 'block';
            btn.disabled = false;
            btn.textContent = '📤 Отправить';
        }
    };
}

function showDbToast(resp) {
    const old = document.getElementById('zm-db-toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.id = 'zm-db-toast';
    const carUrl = `${DB_SITE_URL}/#/car/${resp.id}`;
    t.innerHTML = `
        <div class="zm-db-toast-t">✓ ${resp.created ? 'Машина добавлена в базу' : 'Машина обновлена в базе'}</div>
        <a href="${escapeHtmlSafe(carUrl)}" target="_blank" class="zm-db-toast-link">Открыть страницу машины ↗</a>
    `;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 12000);
}

// Особенности из CRM для карточки агрегата: тот же список, что на сайте
// (shared/crmQuirks.js). Рисуем над расчётом — «полную не делаем» должно
// попасться на глаза до того, как оператор назовёт цену.
function renderCrmQuirks(agg) {
    const quirks = crmQuirksForAggregate(calcState.car, calcState.data, agg);
    if (!quirks.length) return '';
    return quirks.map(q => `
        <div class="zm-quirk zm-quirk-${q.severity}">
            <span class="zm-quirk-tag">${escapeHtml(SEVERITY_LABELS[q.severity])}</span>
            <span>${escapeHtml(q.text)}${q.note ? `<span class="zm-quirk-note">${escapeHtml(q.note)}</span>` : ''}</span>
        </div>`).join('');
}

// Математика — в shared/, здесь только HTML-обвязка виджета.
function calcForAggregate(agg) {
    const calc = sharedCalcForAggregate(agg, calcState, currentCarApprovals());
    if (calc.isHighGear) return { isHighGear: true, html: '' };

    const motulVol = calc.motulVol;
    const currentVol = calc.overrideUsed ? calc.vService : (motulVol || '');
    const volEditHtml = `
        <div class="zm-vol-edit">
            <span class="zm-ctrl-lbl">Объём:</span>
            <input type="number" step="0.1" min="0" class="zm-vol-input" data-vol-key="${agg.key}"
                value="${currentVol}" placeholder="${motulVol || '?'}"/>
            <span class="zm-ctrl-lbl">л ${motulVol ? `<span class="zm-vol-motul">(Motul: ${motulVol}л)</span>` : '<span class="zm-vol-motul zm-vol-warn">(Motul не дал)</span>'}</span>
            ${calc.overrideUsed ? `<button class="zm-vol-reset" data-vol-reset="${agg.key}" title="Сбросить к Motul">↺</button>` : ''}
        </div>
    `;

    if (calc.needsVolume) {
        return {
            html: `
                ${volEditHtml}
                <div class="zm-warn" style="padding:8px 10px;font-size:11px;background:#2a1d00;border:1px solid #E67E00;border-radius:6px;margin-top:6px;color:#ff9800">⚠ Введи объём заправки АКПП в поле выше — Motul не дал</div>
            `,
            costs: [], vCalc: 0, formula: '', volumeStr: '—', oils: [],
        };
    }

    const { costs, vCalc, formula, volumeStr } = calc;
    const isCvt = agg.group === 'auto' && agg.isCvt;
    const mileage = calcState.mileage;
    const isFixedSingle = (mileage === '>=200');

    // Плашка формулы промывки
    let flushBox = '';
    if (agg.group === 'engine' && calc.flush) {
        if (calcState.flush === '5min') {
            flushBox = `
                <div class="zm-flush-box">
                    🧪 <b>5-минутка</b>:
                    <span class="zm-flush-formula">630₽ (промыв.масло, 1 бутылка фикс) + 550₽ (услуга)</span>
                    = <b class="zm-flush-total">${calc.flush.cost}₽</b>
                </div>
            `;
        } else if (calcState.flush === 'full') {
            const litres = +(vCalc * 0.9).toFixed(1);
            const oilCost = Math.round(litres * 350);
            flushBox = `
                <div class="zm-flush-box">
                    🧪 <b>Полная промывка</b>:
                    <span class="zm-flush-formula">${vCalc}л × 0.9 = ${litres}л × 350₽/л = ${oilCost}₽ + 550₽ (услуга)</span>
                    = <b class="zm-flush-total">${calc.flush.cost}₽</b>
                </div>
            `;
        }
    }

    // Для двигателя: список присадок SPOT, чтобы не дублировать их у других масел
    const spotOilForAdds = (agg.group === 'engine')
        ? costs.find(c => c.oil && c.oil.isSpot)
        : null;
    const spotAddsLower = spotOilForAdds
        ? new Set((spotOilForAdds.oil.ad || []).map(a => normalizeAdditive(a)))
        : new Set();

    const atfWarnBox = (agg.group === 'auto' && !isCvt && agg.atfWarn) ? `
        <div class="zm-warn" style="padding:8px 10px;font-size:11px;background:#2a0000;border:1px solid #e53935;border-radius:6px;margin-top:6px;color:#ff8a80">
            ⚠ Ни ZIC, ни ROLF не покрывают спецификации этой коробки — перевести клиента на мастера
        </div>` : '';

    // МКПП: Motul требует 70W / 75W-85 / 80W-90 / LS, либо продуктов нет
    // вовсе (product not found) — предложить нечего, только варн.
    const mkppWarnBox = calc.mkppWarn ? `
        <div class="zm-warn" style="padding:8px 10px;font-size:11px;background:#2a0000;border:1px solid #e53935;border-radius:6px;margin-top:6px;color:#ff8a80">
            ⚠ ${escapeHtmlSafe(manualWarnText(calc.mkppWarn))}
        </div>` : '';

    // Своё масло не прошло проверку по допускам — предложение из одной позиции
    // вместо двух, и оператору нужно понимать, почему.
    const spotWarnBox = (agg.group === 'engine' && agg.spotWarn) ? `
        <div class="zm-warn" style="padding:8px 10px;font-size:11px;background:#2a1d00;border:1px solid #E67E00;border-radius:6px;margin-top:6px;color:#ff9800">
            ⚠ ${escapeHtmlSafe(agg.spotWarn)}
        </div>` : '';

    const html = `
        ${volEditHtml}
        <div class="zm-formula">📐 ${formula}</div>
        ${flushBox}
        ${atfWarnBox}${mkppWarnBox}${spotWarnBox}
        ${costs.map((c, i) => {
            // Кнопка выбора живёт на карточке брендового масла: карточки идут
            // по возрастанию цены, и первым обычно стоит SPOT, которого в
            // пикере нет.
            const canPick = agg.group === 'engine' && !c.oil.isSpot &&
                            !isFixedSingle &&
                            agg.allCandidates && agg.allCandidates.length > 1;
            const regMatches = (agg.group === 'engine')
                ? matchOilToReglament(c.oil, calcState.car?.makeShort)
                : [];
            const regBadge = regMatches.length
                ? `<button class="zm-reg-badge" data-reg-info="${escapeHtmlSafe(JSON.stringify(regMatches))}" title="Совпадение с регламентом — нажми">⭐ⓘ</button>`
                : '';

            const sumpSuffix = agg.group === 'engine'
                ? (calcState.showWithSump
                    ? ` + 550₽ (снятие/установка защиты картера) = <b class="zm-oil-total zm-oil-total-sump">${c.total + 550}₽</b>`
                    : ' + 550₽ (снятие/установка защиты картера)')
                : '';

            let oilDetailsHtml = '';
            if (agg.group === 'engine') {
                oilDetailsHtml = renderOilDetailsBlock(agg, c.oil, i, spotAddsLower);
            }

            return `
            <div class="zm-oil-line ${regMatches.length ? 'zm-oil-line-reg' : ''}">
                <div class="zm-oil-name">
                    ${canPick
                        ? `<button class="zm-oil-pick-btn" data-pick="${agg.key}">${c.oil.b} ${c.oil.n} ▾</button>`
                        : `${c.oil.b} ${c.oil.n}`}
                    ${regBadge}
                </div>
                <div class="zm-oil-calc">${c.breakdown} = <b class="zm-oil-total">${c.total}₽</b>${sumpSuffix}</div>
                <div class="zm-oil-price">${c.oil.price}₽/л</div>
                ${oilDetailsHtml}
            </div>`;
        }).join('')}
        ${agg.group === 'engine' && calcState.showOilPicker === agg.key && agg.allCandidates && !isFixedSingle ? `
            <div class="zm-oil-picker">
                <div class="zm-oil-picker-head">Выбери масло (${agg.allCandidates.length} подходящих):</div>
                ${agg.allCandidates.map(o => {
                    const cur = costs.find(c => !c.oil.isSpot) || costs[0];
                    const isCurrent = (cur && (cur.oil.b + '_' + cur.oil.n) === (o.b + '_' + o.n));
                    const regOpt = matchOilToReglament(o, calcState.car?.makeShort);
                    const regMark = regOpt.length ? '<span class="zm-reg-mark" title="по регламенту">⭐</span>' : '';
                    const rk = (agg.ranked || []).find(r => r.oil === o);
                    let hitsMark = '';
                    if (rk && (rk.direct.length || rk.hier.length)) {
                        const tip = [
                            ...rk.direct.map(t => 'совпал: ' + t),
                            ...rk.hier.map(h => h.via + ' покрывает ' + h.covers),
                        ].join('; ');
                        hitsMark = `<span class="zm-oil-opt-hits" title="${escapeHtmlSafe(tip)}">✓${rk.direct.length ? ' ' + rk.direct.length : ''}${rk.hier.length ? ' ⊃' + rk.hier.length : ''}</span>`;
                    }
                    if (rk && rk.classMiss) {
                        hitsMark += `<span class="zm-oil-opt-miss" title="У масла нет требуемого класса ACEA ${escapeHtmlSafe(rk.classMiss)} — предлагать с осторожностью">⚠ не ${escapeHtmlSafe(rk.classMiss)}</span>`;
                    }
                    return `<button class="zm-oil-opt ${isCurrent?'zm-oil-opt-act':''} ${regOpt.length?'zm-oil-opt-reg':''}" data-opt="${o.b}_${o.n}">
                        <span class="zm-oil-opt-name">${regMark} ${o.b} ${o.n}${hitsMark}</span>
                        <span class="zm-oil-opt-price">${o.price}₽/л</span>
                    </button>`;
                }).join('')}
            </div>
        ` : ''}
    `;

    return { html, costs, vCalc, formula, volumeStr, oils: costs.map(c => c.oil) };
}


    // Глобальное состояние калькулятора (объявлено вверху чтобы Firefox не ругался на TDZ)
    let calcState = null;


    function routeByHost() {
        const HOST = location.hostname;
        if (HOST.includes('motul.lubricantadvisor.com')) { initMotul(); return; }
        if (HOST.includes('rolfoil.ru') || HOST.includes('podbor.upec.pro')) { initRolf(); return; }
        if (HOST.includes('mann-filter.com'))            { initMann('mann');    return; }
        if (HOST.includes('lynxauto.info'))               { initMann('lynx');    return; }
        if (HOST.includes('podbor.ravenol.ru'))           { initMann('ravenol'); return; }
    }


    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({
            '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
        }[c]));
    }
    function escapeHtmlSafe(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({
            '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
        }[c]));
    }

    // ══════════════════════════════════════════════════════════════════
    //                       ПАРСЕР URL МАШИНЫ
    // ══════════════════════════════════════════════════════════════════


    // ══════════════════════════════════════════════════════════════════
    //              MANN FILTER — ВИДЖЕТ С КАЛЬКУЛЯТОРОМ
    // ══════════════════════════════════════════════════════════════════
    function initMann(source) {
        source = source || 'mann';
        injectStyles();
        const widget = createWidget();
        let expanded = false;
        let lastRenderedKey = null;

        function getCar() {
            if (source === 'ravenol') return buildRavenolCar();
            return parseMannUrl();
        }

        function render() {
            const car = getCar();
            if (!car) {
                widget.classList.remove('zm-full');
                const msg = source === 'ravenol'
                    ? 'Откройте Ravenol с выбранным авто (страница /1-cars/.../).'
                    : 'Откройте Mann Filter с выбранным авто.';
                widget.innerHTML = shellHTML(`<div class="zm-warn">${msg}</div>`);
                bindHeaderEvents(null);
                return;
            }

            // Запоминаем страницу, где встретили машину (mann/lynx/ravenol).
            recordSourceLink(car.cacheKey, source, location.href);

            let cached;
            if (source === 'ravenol') {
                cached = car._ravenolData;
                if (cached) GM_setValue('motul_car_' + car.cacheKey, cached);
            } else {
                cached = GM_getValue('motul_car_' + car.cacheKey, null);
            }

            if (expanded && !cached) expanded = false;

            if (expanded) {
                widget.classList.add('zm-full');
                widget.innerHTML = shellHTML(renderCalculator(car, cached));
                bindHeaderEvents(car);
                bindCalcEvents(car, cached);
            } else {
                widget.classList.remove('zm-full');
                widget.innerHTML = shellHTML(renderTrayBody(car, cached));
                bindHeaderEvents(car);
                bindTrayEvents(car);
            }

            lastRenderedKey = car.cacheKey + '|' + (cached ? 'Y' : 'N') + '|R' + ((GM_getValue('rolf_approvals_'+car.cacheKey, null)||[]).length) + '|' + (expanded ? 'E' : 'T');
        }

        function renderTrayBody(car, cached) {
            const rolfApp = GM_getValue('rolf_approvals_' + car.cacheKey, null);
            const motulOk = !!cached;
            const rolfOk = !!(rolfApp && rolfApp.length);

            const status = `
                <div style="font-size:11px;line-height:1.7">
                    <div>${motulOk ? '✓ <span class="zm-ok">Motul</span>' : '<span class="zm-wait">○ Motul (объёмы)</span>'}</div>
                    <div>${rolfOk  ? '✓ <span class="zm-ok">ROLF</span> (' + rolfApp.length + ' допусков)' : '<span class="zm-wait">○ ROLF (допуски)</span>'}</div>
                </div>
            `;

            return `
                <div class="zm-car">
                    <div class="zm-car-t">${car.makeShort} ${car.modelShort}${car.engineName?' '+car.engineName:(car.volume?' '+car.volume:'')}</div>
                    <div class="zm-car-sub">${car.engineCode || '?'} · ${car.kw||'?'}кВт · ${car.yearFrom||'?'}${fuelLabel(car.fuelType) ? ' · ' + fuelLabel(car.fuelType) : ''}</div>
                </div>
                <div class="zm-tray-status">${status}</div>
                <div class="zm-tray-btns" style="flex-direction:column;gap:4px">
                    ${!motulOk ? `<button class="zm-btn zm-btn-pri" id="zm-search">🔍 Найти на Motul</button>` : ''}
                    <button class="zm-btn zm-btn-sec" id="zm-rolf">📋 Допуски (ROLF)</button>
                    ${motulOk ? `<button class="zm-btn zm-btn-pri" id="zm-expand">📊 Развернуть</button>` : ''}
                    ${motulOk ? `<button class="zm-btn zm-btn-sec" id="zm-refresh" title="Переискать на Motul">↻ переискать Motul</button>` : ''}
                </div>
            `;
        }

        function shellHTML(body) {
            const headerRight = expanded
                ? `<button class="zm-btn zm-btn-sec" id="zm-rolf-exp" title="Допуски ROLF">📋 ROLF</button>
                   <button class="zm-btn zm-btn-sec" id="zm-research" title="Переискать на Motul">↻</button>
                   <button class="zm-btn zm-btn-sec" id="zm-collapse">▸ свернуть</button>`
                : `<button class="zm-btn zm-btn-sec" id="zm-hide" title="Скрыть">−</button>`;

            return `
                <div class="zm-header">
                    <span class="zm-title">🛢 OIL WIDGET</span>
                    ${headerRight}
                </div>
                ${body}
            `;
        }

        function bindHeaderEvents(car) {
            const collapseBtn = document.getElementById('zm-collapse');
            if (collapseBtn) collapseBtn.onclick = () => { expanded = false; render(); };

            const researchBtn = document.getElementById('zm-research');
            if (researchBtn && car) researchBtn.onclick = () => { openMotulSearch(car); };

            const rolfExpBtn = document.getElementById('zm-rolf-exp');
            if (rolfExpBtn && car) rolfExpBtn.onclick = () => openRolfSearch(car);

            const hideBtn = document.getElementById('zm-hide');
            if (hideBtn) hideBtn.onclick = () => widget.classList.toggle('zm-hidden');
        }

        function bindTrayEvents(car) {
            const searchBtn = document.getElementById('zm-search');
            if (searchBtn) searchBtn.onclick = () => openMotulSearch(car);

            const rolfBtn = document.getElementById('zm-rolf');
            if (rolfBtn) rolfBtn.onclick = () => openRolfSearch(car);

            const expBtn = document.getElementById('zm-expand');
            if (expBtn) expBtn.onclick = () => { expanded = true; render(); };

            const refBtn = document.getElementById('zm-refresh');
            if (refBtn) refBtn.onclick = () => {
                GM_deleteValue('motul_car_' + car.cacheKey);
                expanded = false;
                openMotulSearch(car);
                render();
            };
        }

        function openRolfSearch(car) {
            GM_setValue('zm_rolf_pending', JSON.stringify({
                key: car.cacheKey,
                ec: car.engineCode || '',
                ts: Date.now(),
            }));
            GM_deleteValue('rolf_approvals_' + car.cacheKey);
            if (car.engineCode) {
                try { navigator.clipboard.writeText(car.engineCode).catch(()=>{}); } catch {}
            }
            window.open('https://rolfoil.ru/podbor/', 'zm_rolf_search');
            showSearchHint({ ...car, searchSource: 'ROLF' });
        }

        function openMotulSearch(car) {
            const carJson = encodeURIComponent(JSON.stringify({
                make: car.make || '',
                makeShort: car.makeShort || '',
                modelShort: car.modelShort || '',
                model: car.model || '',
                engineCode: car.engineCode || '',
                engineName: car.engineName || '',
                fuelType: car.fuelType || '',
                volume: car.volume || '',
                ccm: car.ccm || '',
                kw: car.kw || '',
                bhp: car.bhp || '',
                yearFrom: car.yearFrom || '',
            }));
            const url = `https://motul.lubricantadvisor.com/default.aspx?data=1&lang=rus#prefill=${encodeURIComponent(car.query)}&key=${encodeURIComponent(car.cacheKey)}&ec=${encodeURIComponent(car.engineCode)}&carData=${carJson}&manual=1`;
            const win = window.open(url, 'zm_motul_search');
            showSearchHint(car);
            try { win && win.focus(); } catch {}
        }

        function showSearchHint(car) {
            let p = document.getElementById('__zm_hint');
            if (p) p.remove();
            p = document.createElement('div');
            p.id = '__zm_hint';
            const isRolf = car.searchSource === 'ROLF';
            const title = isRolf ? '👆 Вставь код в умный поиск на ROLF' : '👆 Выбери машину в открытой вкладке Motul';
            const body  = isRolf
                ? `Код <b style="color:#E67E00">${car.engineCode || '?'}</b> уже в буфере ✓<br>
                   <small style="color:#7986cb">Ctrl+V в поле поиска → выбери машину → скрипт сам распарсит допуска</small>`
                : `Ищи вариант с кодом <b style="color:#E67E00">${car.engineCode || '?'}</b><br>
                   <small style="color:#7986cb">Скрипт сам распарсит и вернётся сюда</small>`;

            p.innerHTML = `
                <div style="padding:10px 14px;background:#1a1d2e;border-bottom:1px solid #2a2d3e;color:#E67E00;font-weight:bold;font-size:12px;border-radius:10px 10px 0 0">${title}</div>
                <div style="padding:10px 14px;font-size:12px;line-height:1.5">${body}</div>
                <div style="padding:0 14px 10px">
                    <button id="zm-hint-close" style="background:#1e2040;border:1px solid #3a3d5e;color:#e8eaf6;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:11px">Закрыть</button>
                </div>
            `;
            p.style.cssText = `position:fixed;bottom:18px;left:350px;z-index:999999;
                width:320px;background:#0f1117;color:#e8eaf6;border:1px solid #E67E00;
                border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.55);font:13px Arial`;
            document.body.appendChild(p);
            document.getElementById('zm-hint-close').onclick = () => p.remove();
            setTimeout(() => { if (p) p.remove(); }, 30000);
        }

        let lastUrl = location.href;
        setInterval(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                expanded = false;
                render();
                return;
            }

            const ae = document.activeElement;
            if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && ae.closest('#__zm_w')) {
                return;
            }

            const car = parseMannUrl();
            if (!car) return;
            const cached = GM_getValue('motul_car_' + car.cacheKey, null);
            const rolf   = GM_getValue('rolf_approvals_' + car.cacheKey, null);
            const rolfLen = rolf ? rolf.length : 0;

            const currentKey = car.cacheKey + '|' + (cached ? 'Y' : 'N') + '|R' + rolfLen + '|' + (expanded ? 'E' : 'T');
            if (currentKey !== lastRenderedKey) render();
        }, 1500);

        render();
    }

    // ══════════════════════════════════════════════════════════════════
    //                         КАЛЬКУЛЯТОР UI
    // ══════════════════════════════════════════════════════════════════


    // ══════════════════════════════════════════════════════════════════
    //                    ФИЛЬТРЫ ДВС (парсинг + расчёт)
    // ══════════════════════════════════════════════════════════════════
    function parseFiltersInput(text) {
        const out = { vf: null, mf: null, sf: null };
        if (!text) return out;

        const TYPE_MAP = { 'вф': 'vf', 'мф': 'mf', 'сф': 'sf',
                           'ВФ': 'vf', 'МФ': 'mf', 'СФ': 'sf' };

        text.split(/\r?\n/).forEach(rawLine => {
            const line = rawLine.trim();
            if (!line) return;
            const m = line.match(/^(вф|мф|сф)\s+(.+?)\s*[-–—]\s*([\d\s]+)\s*(?:р|руб|₽)?\s*$/i);
            if (!m) return;
            const key = TYPE_MAP[m[1].toLowerCase()] || TYPE_MAP[m[1]];
            if (!key) return;
            const name = m[2].trim();
            const price = parseInt(m[3].replace(/\s+/g, ''), 10);
            if (!isFinite(price) || price <= 0) return;
            out[key] = { name, price };
        });
        return out;
    }

    function applyFiltersInput(text) {
        const parsed = parseFiltersInput(text);
        calcState.filtersRaw = text || '';

        if (!calcState.filters) calcState.filters = {};
        ['vf', 'mf', 'sf'].forEach(t => {
            if (!calcState.filters[t]) {
                const defaults = { vf: { work: 350 }, sf: { work: 550 }, mf: {} };
                calcState.filters[t] = { name: '', price: 0, enabled: false, ...defaults[t] };
            }
            const f = calcState.filters[t];
            if (parsed[t]) {
                f.name = parsed[t].name;
                f.price = parsed[t].price;
                f.enabled = true;
                if (t === 'vf' && !f.work) f.work = 350;
                if (t === 'sf' && !f.work) f.work = 550;
            } else {
                f.name = '';
                f.price = 0;
                f.enabled = false;
            }
        });
    }


    function renderCalculator(car, data) {
        const defaultPartial = shouldDefaultToPartial(car, data);

        if (calcState && calcState.car && calcState.car.cacheKey === car.cacheKey) {
            calcState.data = data;
            calcState.car = car;
        } else {
            calcState = {
                mileage: '<100',
                atpType: defaultPartial ? 'partial' : 'full',
                atpFilter: false,
                cvtFilterCoarse: false,
                cvtFilterFine: false,
                cvtAtfSp3: false,
                atpVolumeManual: null,
                volumeOverride: {},
                selected: new Set(),
                showApprovals: new Set(),    // legacy: показать допуска агрегата (внизу)
                expandedOilApp: new Set(),   // показать ВСЕ допуска у конкретного масла (per-oil)
                oilOverride: {},
                showOilPicker: null,
                ignoreApprovals: false,
                showWithSump: false,
                flush: 'none',
                filters: {
                    vf: { name: '', price: 0, enabled: false, work: 350 },
                    mf: { name: '', price: 0, enabled: false },
                    sf: { name: '', price: 0, enabled: false, work: 550 },
                },
                filtersRaw: '',
                showFiltersInput: false,
                totals: [],
                data: data,
                car: car,
            };
            if (data.engine) calcState.selected.add('engine');
        }

        return `
            <div class="zm-car">
                <div class="zm-car-t">${car.makeShort} ${car.modelShort}${car.engineName?' '+car.engineName:(car.volume?' '+car.volume:'')}</div>
                <div class="zm-car-sub">${data.motulName || '?'} · ${car.engineCode || '?'} · ${car.kw||'?'}кВт${car.bhp?' / '+car.bhp+'лс':''}${car.yearFrom?' · '+car.yearFrom:''}${fuelLabel(car.fuelType) ? ' · ' + fuelLabel(car.fuelType) : ''}</div>
            </div>
            <div class="zm-ctrls">
                <div class="zm-ctrl-row">
                    <span class="zm-ctrl-lbl">Пробег:</span>
                    <button class="zm-chip ${calcState.mileage==='<100'?'zm-chip-act':''}" data-mileage="<100">до 100т</button>
                    <button class="zm-chip ${calcState.mileage==='>=100'?'zm-chip-act':''}" data-mileage=">=100">100т+</button>
                    <button class="zm-chip ${calcState.mileage==='>=200'?'zm-chip-act':''}" data-mileage=">=200">200т+</button>
                    <button class="zm-chip ${calcState.mileage==='0w20'?'zm-chip-act':''}" data-mileage="0w20">0W-20</button>
                    <button class="zm-chip ${calcState.mileage==='0w30'?'zm-chip-act':''}" data-mileage="0w30">0W-30</button>
                </div>
                <div class="zm-ctrl-row" style="flex-wrap:wrap;gap:8px;margin-top:4px">
                    <label class="zm-chk" style="font-size:11px">
                        <input type="checkbox" id="zm-ignore-approvals" ${calcState.ignoreApprovals?'checked':''}/>
                        <span class="zm-chk-lbl" style="color:#ff9800">🔓 Игнорировать допуска</span>
                    </label>
                    <label class="zm-chk" style="font-size:11px">
                        <input type="checkbox" id="zm-show-sump" ${calcState.showWithSump?'checked':''}/>
                        <span class="zm-chk-lbl" style="color:#81c784">🪣 Снятие/установка защиты картера (+550₽)</span>
                    </label>
                </div>
                <div class="zm-ctrl-row" style="margin-top:4px">
                    <span class="zm-ctrl-lbl">🧪 Промывка ДВС:</span>
                    <button class="zm-chip ${calcState.flush==='none'?'zm-chip-act':''}" data-flush="none">без промывки</button>
                    <button class="zm-chip zm-chip-flush ${calcState.flush==='5min'?'zm-chip-act':''}" data-flush="5min">5-минутка</button>
                    <button class="zm-chip zm-chip-flush ${calcState.flush==='full'?'zm-chip-act':''}" data-flush="full">полная</button>
                </div>
            </div>
            <div id="zm-filters"></div>
            <div id="zm-aggs"></div>
            <div id="zm-totals"></div>
            <div class="zm-result-wrap">
                <div class="zm-result-head">
                    <span>📋 Итог для копирования</span>
                    <span style="display:flex;gap:6px">
                        <button class="zm-btn zm-btn-sec" id="zm-copy">⧉ копировать</button>
                        <button class="zm-btn zm-btn-pri" id="zm-db-send" title="Сохранить машину в общую базу рассчитанных">📤 Отправить отчёт</button>
                    </span>
                </div>
                <pre id="zm-result" class="zm-result"></pre>
            </div>
        `;
    }

    function bindCalcEvents(car, data) {
        document.querySelectorAll('[data-mileage]').forEach(b => {
            b.onclick = () => {
                document.querySelectorAll('[data-mileage]').forEach(x => x.classList.remove('zm-chip-act'));
                b.classList.add('zm-chip-act');
                calcState.mileage = b.dataset.mileage;
                rerenderAggs();
            };
        });

        const ignoreChk = document.getElementById('zm-ignore-approvals');
        if (ignoreChk) ignoreChk.onchange = () => {
            calcState.ignoreApprovals = ignoreChk.checked;
            rerenderAggs();
        };

        const sumpChk = document.getElementById('zm-show-sump');
        if (sumpChk) sumpChk.onchange = () => {
            calcState.showWithSump = sumpChk.checked;
            rerenderAggs();
        };

        document.querySelectorAll('[data-flush]').forEach(b => {
            b.onclick = () => {
                document.querySelectorAll('[data-flush]').forEach(x => x.classList.remove('zm-chip-act'));
                b.classList.add('zm-chip-act');
                calcState.flush = b.dataset.flush;
                rerenderAggs();
            };
        });

        document.getElementById('zm-copy').onclick = () => {
            const text = document.getElementById('zm-result').textContent;
            navigator.clipboard.writeText(text).then(() => {
                const btn = document.getElementById('zm-copy');
                const orig = btn.textContent;
                btn.textContent = '✓ скопировано';
                setTimeout(() => { btn.textContent = orig; }, 1500);
            });
        };

        const dbSendBtn = document.getElementById('zm-db-send');
        if (dbSendBtn) dbSendBtn.onclick = () => openDbModal(car);

        rerenderFilters();
        rerenderAggs();
    }


    function rerenderFilters() {
        const box = document.getElementById('zm-filters');
        if (!box) return;

        const f = calcState.filters;
        const hasAny = f.vf.name || f.mf.name || f.sf.name;

        if (!calcState.showFiltersInput && !hasAny) {
            box.innerHTML = `
                <button type="button" class="zm-btn-filters" id="zm-filters-open">➕ Добавить фильтра ДВС</button>
            `;
            document.getElementById('zm-filters-open').onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                calcState.showFiltersInput = true;
                rerenderFilters();
            };
            return;
        }

        if (calcState.showFiltersInput) {
            box.innerHTML = `
                <div class="zm-filters-panel">
                    <div class="zm-filters-head">
                        <span>🔧 Вставь список фильтров</span>
                        <button type="button" class="zm-btn zm-btn-sec" id="zm-filters-close">✕</button>
                    </div>
                    <textarea id="zm-filters-ta" class="zm-filters-ta" rows="4" placeholder="вф LYNX LA-502 LYNXauto - 1488р&#10;мф LYNX LC-331 LYNXauto - 330р&#10;сф LYNX LAC-333 auto - 1209р">${escapeHtml(calcState.filtersRaw)}</textarea>
                    <div class="zm-filters-btns">
                        <button type="button" class="zm-btn zm-btn-pri" id="zm-filters-apply">Применить</button>
                        ${hasAny ? `<button type="button" class="zm-btn zm-btn-sec" id="zm-filters-clear">Очистить</button>` : ''}
                    </div>
                    <div class="zm-filters-hint">Формат: <code>тип название - ценар</code>. Тип: <b>вф</b>/<b>мф</b>/<b>сф</b></div>
                    <div id="zm-filters-debug" style="margin-top:6px;font-size:10px;color:#5a6070"></div>
                </div>
                ${hasAny ? renderFiltersList() : ''}
            `;

            document.getElementById('zm-filters-close').onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                calcState.showFiltersInput = false;
                rerenderFilters();
            };
            document.getElementById('zm-filters-apply').onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                try {
                    const ta = document.getElementById('zm-filters-ta');
                    const txt = ta ? ta.value : '';
                    const dbg = document.getElementById('zm-filters-debug');
                    const parsed = parseFiltersInput(txt);
                    const found = ['vf','mf','sf'].filter(t => parsed[t]);
                    if (dbg) dbg.textContent = `Распознано: ${found.length} шт (${found.join(', ') || 'ни одного'})`;
                    applyFiltersInput(txt);
                    if (found.length) calcState.showFiltersInput = false;
                    rerenderFilters();
                    rerenderAggs();
                } catch (err) {
                    const dbg = document.getElementById('zm-filters-debug');
                    if (dbg) dbg.textContent = '❌ Ошибка: ' + err.message;
                }
            };
            const clearBtn = document.getElementById('zm-filters-clear');
            if (clearBtn) clearBtn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                applyFiltersInput('');
                rerenderFilters();
                rerenderAggs();
            };
        } else {
            box.innerHTML = `
                <div class="zm-filters-list-wrap">
                    <div class="zm-filters-head">
                        <span>🔧 Фильтра ДВС</span>
                        <div style="display:flex;gap:4px">
                            <button type="button" class="zm-btn zm-btn-sec" id="zm-filters-edit">✎ изменить</button>
                        </div>
                    </div>
                    ${renderFiltersList()}
                </div>
            `;
            document.getElementById('zm-filters-edit').onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                calcState.showFiltersInput = true;
                rerenderFilters();
            };
        }

        bindFilterEvents();
    }

    function renderFiltersList() {
        const f = calcState.filters;
        const rows = [];

        if (f.vf.name) {
            rows.push(`
                <div class="zm-filter-row" data-ftype="vf">
                    <label class="zm-chk">
                        <input type="checkbox" data-ftoggle="vf" ${f.vf.enabled?'checked':''}/>
                        <span class="zm-chk-lbl"><b>ВФ</b> ${escapeHtml(f.vf.name)} — ${f.vf.price}₽</span>
                    </label>
                    <div class="zm-filter-work">
                        <span class="zm-ctrl-lbl">установка:</span>
                        <button class="zm-chip ${f.vf.work===0?'zm-chip-act':''}" data-fwork="vf:0">без работы</button>
                        <button class="zm-chip ${f.vf.work===350?'zm-chip-act':''}" data-fwork="vf:350">защёлки 350₽</button>
                        <button class="zm-chip ${f.vf.work===600?'zm-chip-act':''}" data-fwork="vf:600">болты 600₽</button>
                        <button class="zm-chip ${f.vf.work===1150?'zm-chip-act':''}" data-fwork="vf:1150">разбор 1150₽</button>
                    </div>
                </div>
            `);
        }
        if (f.mf.name) {
            rows.push(`
                <div class="zm-filter-row" data-ftype="mf">
                    <label class="zm-chk">
                        <input type="checkbox" data-ftoggle="mf" ${f.mf.enabled?'checked':''}/>
                        <span class="zm-chk-lbl"><b>МФ</b> ${escapeHtml(f.mf.name)} — ${f.mf.price}₽</span>
                    </label>
                    <div class="zm-filter-work-none">меняется при замене масла</div>
                </div>
            `);
        }
        if (f.sf.name) {
            rows.push(`
                <div class="zm-filter-row" data-ftype="sf">
                    <label class="zm-chk">
                        <input type="checkbox" data-ftoggle="sf" ${f.sf.enabled?'checked':''}/>
                        <span class="zm-chk-lbl"><b>СФ</b> ${escapeHtml(f.sf.name)} — ${f.sf.price}₽</span>
                    </label>
                    <div class="zm-filter-work">
                        <span class="zm-ctrl-lbl">установка:</span>
                        <button class="zm-chip ${f.sf.work===0?'zm-chip-act':''}" data-fwork="sf:0">без работы</button>
                        <button class="zm-chip ${f.sf.work===550?'zm-chip-act':''}" data-fwork="sf:550">бардачок 550₽</button>
                        <button class="zm-chip ${f.sf.work===990?'zm-chip-act':''}" data-fwork="sf:990">под педалью 990₽</button>
                    </div>
                </div>
            `);
        }
        return rows.length ? `<div class="zm-filters-list">${rows.join('')}</div>` : '';
    }

    function bindFilterEvents() {
        document.querySelectorAll('[data-ftoggle]').forEach(ck => ck.onchange = () => {
            const t = ck.dataset.ftoggle;
            calcState.filters[t].enabled = ck.checked;
            rerenderAggs();
        });
        document.querySelectorAll('[data-fwork]').forEach(b => b.onclick = () => {
            const [t, v] = b.dataset.fwork.split(':');
            calcState.filters[t].work = parseInt(v, 10);
            rerenderFilters();
            rerenderAggs();
        });
    }

    function rerenderAggs() {
        const box = document.getElementById('zm-aggs');
        if (!box) return;

        let savedFocus = null;
        const ae = document.activeElement;
        if (ae && ae.dataset && ae.dataset.volKey) {
            savedFocus = {
                key: ae.dataset.volKey,
                value: ae.value,
                selStart: ae.selectionStart,
                selEnd: ae.selectionEnd,
            };
        }

        const aggs = getAggregates(calcState.data);

        if (!aggs.length) {
            box.innerHTML = `
                <div class="zm-warn">
                    ⚠️ Ни один агрегат не распознан из данных Motul.<br>
                    <small style="color:#7986cb">Возможно названия агрегатов нестандартные.</small>
                </div>
                <details class="zm-raw-dump">
                    <summary style="cursor:pointer;color:#E67E00;font-size:11px;padding:6px 0">Посмотреть что пришло с Motul</summary>
                    <pre style="background:#0a0c12;padding:8px;border-radius:4px;font-size:10px;color:#9aa0b0;max-height:260px;overflow:auto;white-space:pre-wrap;word-break:break-all">${escapeHtml(JSON.stringify(calcState.data, null, 2))}</pre>
                </details>
            `;
            return;
        }

        let dctNotice = '';
        if (calcState.data.automatic && calcState.data.automatic.isDct) {
            dctNotice = `
            <div class="zm-dct-notice">
                💧 <b>${calcState.data.automatic.label || 'Роботизированная коробка'}</b><br>
                <small>Коробка с мокрым сцеплением — замену масла не считаем</small>
            </div>`;
        }

        // Метка режима вязкости
        const mileage = calcState.mileage;
        let viscLabel = '';
        if (mileage === '>=200') viscLabel = '<span class="zm-visc-badge zm-visc-10w40">10W-40 (200т+)</span>';
        else if (mileage === '0w20') viscLabel = '<span class="zm-visc-badge zm-visc-0w20">0W-20</span>';
        else if (mileage === '0w30') viscLabel = '<span class="zm-visc-badge zm-visc-0w30">0W-30</span>';
        else if (mileage === '>=100') viscLabel = '<span class="zm-visc-badge">5W-40</span>';
        else viscLabel = '<span class="zm-visc-badge">5W-30</span>';

        box.innerHTML = dctNotice + (viscLabel ? `<div style="padding:4px 14px 0">${viscLabel}</div>` : '') + aggs.map(agg => {
            const calc = calcForAggregate(agg);
            const checked = calcState.selected.has(agg.key);
            const showApp = calcState.showApprovals.has(agg.key);

            return `
            <div class="zm-agg ${calc.isHighGear ? 'zm-bath' : ''}" data-key="${agg.key}">
                <div class="zm-agg-head">
                    <label class="zm-chk">
                        <input type="checkbox" data-sel="${agg.key}" ${checked?'checked':''}/>
                        <span class="zm-chk-lbl">${agg.label}</span>
                    </label>
                    <span class="zm-agg-vol">${calc.volumeStr}</span>
                </div>
                ${renderCrmQuirks(agg)}
                ${calc.isHighGear
                    ? `<div class="zm-bath-msg">🛁 послан в баню!</div>`
                    : calc.html}
                <button class="zm-app-btn" data-app="${agg.key}">
                    ${showApp ? '▾' : '▸'} ${agg.group === 'engine' ? 'допуска машины' : 'продукты Motul'} (${
                        agg.group === 'engine' && agg.approvalAnalysis
                            ? agg.approvalAnalysis.items.length
                            : (agg.approvals||[]).length})
                </button>
                ${showApp ? renderApprovalsList(agg) : ''}
            </div>`;
        }).join('');

        // АКПП/CVT контролы
        if (calcState.data.automatic && !calcState.data.automatic.isDct) {
            const atpBox = box.querySelector('[data-key="automatic"]');
            if (atpBox) {
                const atp = calcState.data.automatic;
                const isCvt = atp.isCvt;
                const typeLabel = isCvt ? 'ВАРИАТОР (CVT)' : 'АКПП';
                const fullMult = '×1.5';
                const partMult = isCvt ? '×0.8' : '×0.6';

                // Кому полную не делаем — решает список особенностей из CRM
                // (shared/crmQuirks.js), а не копия марок здесь: раньше копия
                // отставала от CRM и молчала, например, про Geely Tugella.
                const noFullWarn = crmNoFullAt(calcState.car, calcState.data)
                    ? `<div class="zm-no-full-warn">⚠ Полную (аппаратную) не делаем — считаем частичную</div>`
                    : '';

                const ctrls = `
                    <div class="zm-atp-ctrls">
                        <div class="zm-atp-type">${typeLabel}</div>
                        <div class="zm-ctrl-row">
                            <span class="zm-ctrl-lbl">Замена:</span>
                            <button class="zm-chip ${calcState.atpType==='full'?'zm-chip-act':''}" data-atp="full">Полная ${fullMult}</button>
                            <button class="zm-chip ${calcState.atpType==='partial'?'zm-chip-act':''}" data-atp="partial">Частичная ${partMult}</button>
                        </div>
                        ${noFullWarn}
                        ${isCvt ? `
                        <label class="zm-chk">
                            <input type="checkbox" id="zm-cvt-filter-coarse" ${calcState.cvtFilterCoarse?'checked':''}/>
                            <span class="zm-chk-lbl">Фильтр грубой очистки (+1700₽)</span>
                        </label>
                        <label class="zm-chk">
                            <input type="checkbox" id="zm-cvt-filter-fine" ${calcState.cvtFilterFine?'checked':''}/>
                            <span class="zm-chk-lbl">Фильтр тонкой очистки (+3350₽)</span>
                        </label>
                        <label class="zm-chk">
                            <input type="checkbox" id="zm-cvt-atf-sp3" ${calcState.cvtAtfSp3?'checked':''}/>
                            <span class="zm-chk-lbl">АТФ SP-III (старый вариатор — только ROLF Professional ATF Multi)</span>
                        </label>
                        ` : `
                        <label class="zm-chk">
                            <input type="checkbox" id="zm-atp-filter" ${calcState.atpFilter?'checked':''}/>
                            <span class="zm-chk-lbl">Фильтр АКПП (+1700₽)</span>
                        </label>
                        `}
                    </div>`;
                atpBox.querySelector('.zm-agg-head').insertAdjacentHTML('afterend', ctrls);
            }
        }

        // события
        box.querySelectorAll('[data-sel]').forEach(c => c.onchange = () => {
            if (c.checked) calcState.selected.add(c.dataset.sel);
            else calcState.selected.delete(c.dataset.sel);
            rerenderResult();
        });

        box.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
            const k = b.dataset.pick;
            calcState.showOilPicker = calcState.showOilPicker === k ? null : k;
            rerenderAggs();
        });

        box.querySelectorAll('[data-reg-info]').forEach(b => b.onclick = (e) => {
            e.stopPropagation();
            try {
                const matches = JSON.parse(b.dataset.regInfo);
                showReglamentPopup(matches);
            } catch {}
        });

        box.querySelectorAll('[data-opt]').forEach(b => b.onclick = () => {
            const key = calcState.showOilPicker;
            if (!key) return;
            calcState.oilOverride[key + '_mid'] = b.dataset.opt;
            calcState.showOilPicker = null;
            rerenderAggs();
        });

        box.querySelectorAll('[data-vol-key]').forEach(inp => {
            inp.onchange = () => {
                const k = inp.dataset.volKey;
                const v = parseFloat(inp.value);
                if (isFinite(v) && v > 0) {
                    calcState.volumeOverride[k] = v;
                } else {
                    delete calcState.volumeOverride[k];
                }
                rerenderAggs();
            };
            inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } };
        });
        box.querySelectorAll('[data-vol-reset]').forEach(b => b.onclick = () => {
            delete calcState.volumeOverride[b.dataset.volReset];
            rerenderAggs();
        });
        box.querySelectorAll('[data-app]').forEach(b => b.onclick = () => {
            const k = b.dataset.app;
            if (calcState.showApprovals.has(k)) calcState.showApprovals.delete(k);
            else calcState.showApprovals.add(k);
            rerenderAggs();
        });
        // Раскрытие "остальные допуска" у конкретного масла
        box.querySelectorAll('[data-oilapp]').forEach(b => b.onclick = (e) => {
            e.stopPropagation();
            const k = b.dataset.oilapp;
            if (calcState.expandedOilApp.has(k)) calcState.expandedOilApp.delete(k);
            else calcState.expandedOilApp.add(k);
            rerenderAggs();
        });
        box.querySelectorAll('[data-atp]').forEach(b => b.onclick = () => {
            calcState.atpType = b.dataset.atp;
            rerenderAggs();
        });
        const fltChk = document.getElementById('zm-atp-filter');
        if (fltChk) fltChk.onchange = () => {
            calcState.atpFilter = fltChk.checked;
            rerenderAggs();
        };
        const cvtC = document.getElementById('zm-cvt-filter-coarse');
        if (cvtC) cvtC.onchange = () => {
            calcState.cvtFilterCoarse = cvtC.checked;
            rerenderAggs();
        };
        const cvtF = document.getElementById('zm-cvt-filter-fine');
        if (cvtF) cvtF.onchange = () => {
            calcState.cvtFilterFine = cvtF.checked;
            rerenderAggs();
        };
        const cvtSp3 = document.getElementById('zm-cvt-atf-sp3');
        if (cvtSp3) cvtSp3.onchange = () => {
            calcState.cvtAtfSp3 = cvtSp3.checked;
            rerenderAggs();
        };

        if (savedFocus) {
            const newInp = box.querySelector(`[data-vol-key="${savedFocus.key}"]`);
            if (newInp) {
                newInp.value = savedFocus.value;
                newInp.focus();
                try { newInp.setSelectionRange(savedFocus.selStart, savedFocus.selEnd); } catch {}
            }
        }

        rerenderTotals();
        rerenderResult();
    }

    // ══════════════════════════════════════════════════════════════════
    //                    ОБЩИЕ СТОИМОСТИ (наборы)
    // ══════════════════════════════════════════════════════════════════


    function rerenderTotals() {
        const box = document.getElementById('zm-totals');
        if (!box) return;
        if (!calcState || !calcState.totals) calcState.totals = [];

        const aggs = getAggregates(calcState.data).filter(a => calcState.selected.has(a.key));
        const aggData = aggs.map(agg => {
            const calc = calcForAggregate(agg);
            return { agg, calc };
        }).filter(x => x.calc.costs && x.calc.costs.length);

        if (!aggData.length) {
            box.innerHTML = '';
            return;
        }

        const totalsHtml = calcState.totals.map((tot, idx) => {
            const rowsHtml = aggData.map(({ agg, calc }) => {
                const sel = tot[agg.key];
                const opts = calc.costs.map((c, i) => {
                    const checked = sel === i ? 'checked' : '';
                    return `<label class="zm-tot-opt">
                        <input type="radio" name="zm-tot-${idx}-${agg.key}" data-tot="${idx}" data-agg="${agg.key}" value="${i}" ${checked}/>
                        <span>${escapeHtml(totalOilLabel(c.oil))} — ${c.total}₽</span>
                    </label>`;
                }).join('');
                const skipChecked = (sel === undefined || sel === 'skip') ? 'checked' : '';
                return `
                    <div class="zm-tot-row">
                        <div class="zm-tot-row-h">${totalAggLabel(agg)}</div>
                        ${opts}
                        <label class="zm-tot-opt zm-tot-opt-skip">
                            <input type="radio" name="zm-tot-${idx}-${agg.key}" data-tot="${idx}" data-agg="${agg.key}" value="skip" ${skipChecked}/>
                            <span>не включать</span>
                        </label>
                    </div>
                `;
            }).join('');

            const totalSum = computeTotalSum(tot, aggData);
            const sumpAdd = calcState.showWithSump && totalSum.hasEngine ? 550 : 0;
            const displaySum = totalSum.sum + sumpAdd;
            const sumpSuffix = sumpAdd ? ` + 550₽ (снятие/установка защиты картера) = <b>${displaySum}₽</b>` : '';

            return `
                <div class="zm-tot-block">
                    <div class="zm-tot-block-h">
                        <span>Стоимость #${idx + 1}: <b>${totalSum.sum}₽</b>${sumpSuffix}</span>
                        <button class="zm-btn zm-btn-sec" data-tot-del="${idx}">✕</button>
                    </div>
                    ${rowsHtml}
                </div>
            `;
        }).join('');

        box.innerHTML = `
            <div class="zm-totals-wrap">
                ${totalsHtml}
                <button class="zm-btn-filters" id="zm-tot-add">+ Добавить общую стоимость</button>
            </div>
        `;

        const addBtn = document.getElementById('zm-tot-add');
        if (addBtn) addBtn.onclick = () => {
            calcState.totals.push({});
            rerenderTotals();
            rerenderResult();
        };

        box.querySelectorAll('input[type="radio"][data-tot]').forEach(r => r.onchange = () => {
            const ti = parseInt(r.dataset.tot, 10);
            const ak = r.dataset.agg;
            const v = r.value;
            if (!calcState.totals[ti]) calcState.totals[ti] = {};
            calcState.totals[ti][ak] = v === 'skip' ? 'skip' : parseInt(v, 10);
            rerenderTotals();
            rerenderResult();
        });

        box.querySelectorAll('[data-tot-del]').forEach(b => b.onclick = () => {
            const i = parseInt(b.dataset.totDel, 10);
            calcState.totals.splice(i, 1);
            rerenderTotals();
            rerenderResult();
        });
    }


    // ══════════════════════════════════════════════════════════════════
    //        ДЕТАЛИ МАСЛА (UI) — сам расчёт агрегата живёт в shared/
    // ══════════════════════════════════════════════════════════════════

    // ── Нормализация имени присадки для сравнения ──
    function normalizeAdditive(s) {
        return String(s || '').toLowerCase()
            .replace(/[ёе]/g, 'е')
            .replace(/[\s\-\/]+/g, '')
            .trim();
    }

    // ── Список допусков машины с разбором значимости ──
    // Ранг допуска (решает / фон / шум) и причина в title: у машины их бывает
    // 30+, и без пометок оператор не видит, какие 2-3 из них реально
    // определяют выбор масла. Разбор живёт в shared/approvals.js.
    const RANK_ORDER_ZM = ['critical', 'important', 'minor', 'conflict', 'info', 'noise'];
    const RANK_TITLE_ZM = {
        critical:  'решают выбор',
        important: 'важны физически',
        minor:     'перекрыты более строгими',
        conflict:  'противоречат профилю',
        info:      'уровень качества',
        noise:     'к этой машине не относятся',
    };

    function renderApprovalsList(agg) {
        const a = agg.group === 'engine' ? agg.approvalAnalysis : null;
        const plain = (agg.approvals || []).map(x => `<span class="zm-app-tag">${escapeHtml(x)}</span>`).join('');
        if (!a || !a.items.length) {
            return `<div class="zm-app-list">${plain || '<i>не определены</i>'}</div>`;
        }

        const decisive = a.items.filter(i => i.rank === 'critical' || i.rank === 'important').length;
        // Показываем то, что реально ограничивает выбор, а не самый строгий
        // допуск из списка: без фильтра зольность не ограничивает ничего.
        const need = [];
        if (a.profile.ashGate != null) need.push(`${sapsLabel(a.profile.ashGate)} (зола ≤ ${a.profile.ashGate}%)`);
        const hths = a.profile.hthsGate != null ? a.profile.hthsGate : a.profile.hthsMin;
        if (hths != null) need.push(`HTHS ≥ ${hths}`);

        const groups = RANK_ORDER_ZM.map(rank => ({
            rank, items: a.items.filter(i => i.rank === rank),
        })).filter(g => g.items.length);

        const warn = a.unionSuspect
            ? `<div class="zm-app-warn" title="${escapeHtmlSafe((a.conflicts[0] && a.conflicts[0].note) || '')}">⚠ список собран из паспортов рекомендованных масел, а не из требований мотора</div>`
            : '';

        return `<div class="zm-app-list zm-app-list-col">
            <div class="zm-app-sum"><b>решают ${decisive} из ${a.items.length}</b>${
                need.length ? ' · мотору нужно: ' + escapeHtml(need.join(', ')) : ''
            }${agg.requiredClass ? ' · класс ' + escapeHtml(agg.requiredClass) : ''}</div>
            ${warn}
            ${groups.map(g => `
                <div class="zm-app-grp">
                    <div class="zm-app-grp-h">${RANK_TITLE_ZM[g.rank]} (${g.items.length})</div>
                    <div>${g.items.map(it =>
                        `<span class="zm-app-tag zm-app-${it.rank}" title="${escapeHtmlSafe(it.label + '\n' + it.what + '\n\n' + it.why)}">${escapeHtml(it.label)}${it.fromEvidence ? ' +' : ''}</span>`
                    ).join('')}</div>
                </div>`).join('')}
        </div>`;
    }

    // ── Рендер блока "допуска масла" + "присадки" (под строкой масла) ──
    // Метчатся ВСЕГДА если есть допуска машины (ROLF). Кнопка "допуска" видна ВСЕГДА —
    // раскрывает остальные (не совпавшие) допуска масла.
    function renderOilDetailsBlock(agg, oil, idx, spotAddsLower) {
        const oilKey = agg.key + '_' + idx + '_' + oil.b + '_' + oil.n;
        const isExpanded = calcState.expandedOilApp.has(oilKey);
        const carApprovals = agg.approvals || [];

        // Разбить допуска масла на matched / hier / others (относительно машины)
        const { matched, others, hier } = splitOilApprovals(oil.a || [], carApprovals);

        // Если допусков машины ещё нет ИЛИ режим "игнор" — matched пустой, всё в others
        const hasCarApprovals = carApprovals.length > 0 && !calcState.ignoreApprovals;

        const matchedHtml = (hasCarApprovals && (matched.length || hier.length))
            ? `<div class="zm-oil-app-matched">
                ${matched.map(a => `<span class="zm-oil-app-pill zm-oil-app-match" title="Совпадает с допуском машины">${escapeHtml(a)}</span>`).join('')}
                ${hier.map(h => `<span class="zm-oil-app-pill zm-oil-app-hier" title="${escapeHtmlSafe(h.approval)} покрывает требуемый ${escapeHtmlSafe(h.covers)} (старший допуск)">${escapeHtml(h.approval)} ⊃ ${escapeHtml(h.covers)}</span>`).join('')}
               </div>`
            : '';

        // Кнопка "допуска" — ВСЕГДА видна (даже если все совпали — может быть other пустой, кнопка покажет 0)
        const btnLabel = hasCarApprovals
            ? `допуска +${others.length}`
            : `допуска (${(oil.a || []).length})`;
        const appBtn = `<button class="zm-oil-app-btn ${isExpanded?'zm-oil-app-btn-open':''}" data-oilapp="${escapeHtmlSafe(oilKey)}">${isExpanded?'▾':'▸'} ${btnLabel}</button>`;

        // Развёрнутый список — показываем все допуска (matched + others), но others — без подсветки
        let expandedHtml = '';
        if (isExpanded) {
            const listToShow = hasCarApprovals
                ? others.map(a => `<span class="zm-oil-app-pill">${escapeHtml(a)}</span>`)
                : (oil.a || []).map(a => `<span class="zm-oil-app-pill">${escapeHtml(a)}</span>`);
            expandedHtml = `<div class="zm-oil-app-others">${listToShow.join('') || '<i style="color:#5a6070;font-size:10px">нет дополнительных</i>'}</div>`;
        }

        // ── Присадки ──
        // Если это SPOT — показываем все его присадки полностью.
        // Иначе — исключаем те, что уже есть у SPOT.
        let myAds = oil.ad || [];
        if (!oil.isSpot && spotAddsLower && spotAddsLower.size) {
            myAds = myAds.filter(a => !spotAddsLower.has(normalizeAdditive(a)));
        }

        const adsHtml = myAds.length
            ? `<div class="zm-oil-ads">
                ${myAds.map(a => `<span class="zm-oil-ad-pill${oil.isSpot?' zm-oil-ad-pill-spot':''}">${escapeHtml(a)}</span>`).join('')}
               </div>`
            : '';

        return `
            <div class="zm-oil-details">
                ${matchedHtml}
                ${appBtn}
                ${expandedHtml}
                ${adsHtml}
            </div>
        `;
    }

    // ══════════════════════════════════════════════════════════════════
    //                    ПОДБОР МОТОРНОГО МАСЛА
    // ══════════════════════════════════════════════════════════════════

    function findMotulOil(db, name) {
        if (!name) return null;
        const n = name.toUpperCase().trim();
        for (const k in db) {
            if (k.toUpperCase() === n) return db[k];
        }
        for (const k in db) {
            if (k.toUpperCase().includes(n) || n.includes(k.toUpperCase())) return db[k];
        }
        return null;
    }

    // ══════════════════════════════════════════════════════════════════
    //                    ФИНАЛЬНЫЙ ТЕКСТ
    // ══════════════════════════════════════════════════════════════════


    // ══════════════════════════════════════════════════════════════════
    //                       RAVENOL — ПАРСЕР И INIT
    // ══════════════════════════════════════════════════════════════════
    function parseRavenolUrl() {
        const segs = location.pathname.split('/').filter(Boolean);
        if (segs.length < 4) return null;
        const cleanSeg = (s) => s.replace(/^\d+-/, '').replace(/-/g, ' ');
        const make = cleanSeg(segs[1] || '');
        const model = cleanSeg(segs[3] || segs[2] || '');
        return { make, model };
    }

    function parseRavenolHead() {
        const cont = document.querySelector('.rav_selection_head_info_container');
        if (!cont) return {};
        const text = (cont.querySelector('p') || {}).textContent || '';
        const yMatch = text.match(/год выпуска\s+с\s+(\d{4})/i);
        const yearFrom = yMatch ? parseInt(yMatch[1]) : null;
        const vMatch = text.match(/(\d\.\d)\b/);
        const engineVolume = vMatch ? vMatch[1] : '';
        const fuelMatch = text.match(/Топливо:\s*([^<\n]+)/i)
                       || (cont.textContent || '').match(/Топливо:\s*([^\n]+)/i);
        const fuel = fuelMatch ? fuelMatch[1].trim().replace(/[.,].*$/, '') : '';
        return { headText: text.replace(/\s*-\s*Моторное масло.*$/i, '').trim(), yearFrom, engineVolume, fuel };
    }

    function detectKppType(title) {
        const t = (title || '').toLowerCase();
        // ВАЖНО: "полуавтоматическая" содержит подстроку "автомат", поэтому
        // проверяем её ПЕРВОЙ — иначе робот (AMT) ошибочно уходит в АКПП.
        // Полуавтомат = одинарное сцепление, считается как МКПП (75W-90).
        if (/полуавтомат/.test(t)) return { isManual: true, isSemiAuto: true };
        if (/вариатор|cvt/.test(t)) return { isCvt: true };
        if (/роботизированн|dct|dsg|двойн[а-я]+\s*сцеплен/.test(t)) return { isDct: true };
        if (/автомат|планет/.test(t)) return { isAuto: true };
        if (/механическ|m[\s-]?t\b/.test(t)) return { isManual: true };
        return {};
    }

    function parseRavenolPage() {
        const out = {};
        document.querySelectorAll('.aggregate_node').forEach((node) => {
            const titleEl = node.querySelector('.aggregate_node_title');
            if (!titleEl) return;
            const titleRaw = titleEl.textContent.replace(/\s+/g, ' ').trim();

            const descEl = node.querySelector('.aggregate_node_description_text');
            const descText = descEl ? descEl.textContent.replace(/\s+/g, ' ').trim() : '';
            let volTotal = 0, volService = 0, volPlain = 0;
            const volRe = /объ[её]м[^:]*?(?:\(([^)]+)\))?\s*:\s*([\d.,]+)\s*л/gi;
            let m;
            while ((m = volRe.exec(descText)) !== null) {
                const ctx = (m[1] || '').toLowerCase();
                const v = parseFloat(m[2].replace(',', '.'));
                if (/сервисн/i.test(ctx)) volService = v;
                else if (/общ|полн|основн/i.test(ctx)) volTotal = v;
                else if (!volPlain) volPlain = v;
            }
            const volume = volTotal || volPlain || volService || 0;

            const data = {
                volume,
                volumeService: volService,
                volumeTotal: volTotal,
                volumePlain: volPlain,
                filterVolume: 0,
                motulProducts: [],
                label: titleRaw,
                rawText: titleRaw + ' ' + descText,
            };

            if (/двигатель/i.test(titleRaw)) {
                const ec = titleRaw.replace(/^двигатель\s*/i, '').trim();
                data.engineCode = ec;
                out.engine = data;
            } else if (/коробка передач/i.test(titleRaw) || /\bкпп\b/i.test(titleRaw)) {
                const t = detectKppType(titleRaw);
                if (t.isCvt) { data.isCvt = true; out.automatic = data; }
                else if (t.isDct) { data.isDct = true; out.automatic = data; }
                else if (t.isAuto) { out.automatic = data; }
                else if (t.isManual) { if (t.isSemiAuto) data.isSemiAuto = true; out.manual = data; }
                else { out.automatic = data; }
            } else if (/раздаточн/i.test(titleRaw)) {
                if (!out.transfer) out.transfer = data;
            } else if (/дифференциал/i.test(titleRaw)) {
                if (/задн/i.test(titleRaw)) {
                    if (!out.diffRear) out.diffRear = data;
                } else if (/передн/i.test(titleRaw)) {
                    if (!out.diffFront) out.diffFront = data;
                } else {
                    if (!out.diffRear) out.diffRear = data;
                }
            }
        });
        return out;
    }

    function buildRavenolCar() {
        const u = parseRavenolUrl();
        const head = parseRavenolHead();
        if (!u) return null;

        const cap = (s) => s.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        const makeShort = cap(u.make);
        const modelShort = cap(u.model);

        const data = parseRavenolPage();
        const engineCode = (data.engine && data.engine.engineCode) || '';
        const engineName = '';

        const cacheKey = [makeShort, modelShort, head.engineVolume, engineCode, head.yearFrom]
            .filter(Boolean).join('_').toLowerCase().replace(/\s+/g, '');

        return {
            make: makeShort, model: modelShort,
            makeShort, modelShort,
            engineCode, engineName,
            volume: head.engineVolume || '',
            ccm: null, kw: null, bhp: null,
            yearFrom: head.yearFrom,
            fuelType: head.fuel || '',
            query: [makeShort, modelShort, head.engineVolume].filter(Boolean).join(' ').toLowerCase(),
            cacheKey,
            _ravenolData: data,
            _ravenolHead: head.headText || '',
            isRavenol: true,
        };
    }

    function initRavenol() {
        injectStyles();
        const widget = createWidget();
        let expanded = false;
        let lastRenderedKey = null;

        function render() {
            const car = buildRavenolCar();
            if (!car) {
                widget.classList.remove('zm-full');
                widget.innerHTML = shellHTML(`<div class="zm-warn">Откройте Ravenol с выбранным авто.</div>`);
                bindHeaderEvents(null);
                return;
            }

            const data = car._ravenolData;

            if (expanded) {
                widget.classList.add('zm-full');
                widget.innerHTML = shellHTML(renderCalculator(car, data));
                bindHeaderEvents(car);
                bindCalcEvents(car, data);
            } else {
                widget.classList.remove('zm-full');
                widget.innerHTML = shellHTML(renderTrayBodyRavenol(car));
                bindHeaderEvents(car);
                bindTrayEventsRavenol(car);
            }

            const rolfApp = GM_getValue('rolf_approvals_' + car.cacheKey, null);
            lastRenderedKey = car.cacheKey + '|R' + ((rolfApp || []).length) + '|' + (expanded ? 'E' : 'T');
        }

        function renderTrayBodyRavenol(car) {
            const rolfApp = GM_getValue('rolf_approvals_' + car.cacheKey, null);
            const rolfOk = !!(rolfApp && rolfApp.length);
            const ravOk = !!(car._ravenolData && car._ravenolData.engine);

            const status = `
                <div style="font-size:11px;line-height:1.7">
                    <div>${ravOk ? '✓ <span class="zm-ok">Ravenol</span> (объёмы + масла)' : '<span class="zm-wait">○ Ravenol</span>'}</div>
                    <div>${rolfOk ? '✓ <span class="zm-ok">ROLF</span> (' + rolfApp.length + ' допусков)' : '<span class="zm-wait">○ ROLF (допуски)</span>'}</div>
                </div>
            `;

            return `
                <div class="zm-car">
                    <div class="zm-car-t">${car.makeShort} ${car.modelShort}${car.volume?' '+car.volume:''}</div>
                    <div class="zm-car-sub">${car.engineCode || '?'} · ${car.yearFrom||'?'}${fuelLabel(car.fuelType) ? ' · ' + fuelLabel(car.fuelType) : ''}</div>
                </div>
                ${status}
                <div class="zm-tray-actions">
                    <button class="zm-btn-rolf" id="zm-go-rolf">📋 ROLF — допуски</button>
                    ${ravOk && rolfOk ? '<button class="zm-btn-calc" id="zm-go-calc">💧 Подбор масла</button>' : ''}
                </div>
            `;
        }

        function bindTrayEventsRavenol(car) {
            const goRolf = document.getElementById('zm-go-rolf');
            if (goRolf) goRolf.onclick = () => goToRolf(car);
            const goCalc = document.getElementById('zm-go-calc');
            if (goCalc) goCalc.onclick = () => { expanded = true; render(); };
        }

        setInterval(() => {
            const car = buildRavenolCar();
            if (!car) return;
            const rolfApp = GM_getValue('rolf_approvals_' + car.cacheKey, null);
            const newKey = car.cacheKey + '|R' + ((rolfApp || []).length) + '|' + (expanded ? 'E' : 'T');
            if (newKey !== lastRenderedKey) render();
        }, 1500);

        render();
    }

    // ══════════════════════════════════════════════════════════════════
    //                    ROLF — ПАРСЕР ДОПУСКОВ МАШИНЫ
    // ══════════════════════════════════════════════════════════════════
    function initRolf() {
        const pendingRaw = GM_getValue('zm_rolf_pending', '');
        let key = '', ec = '';
        if (pendingRaw) {
            try {
                const p = JSON.parse(pendingRaw);
                if (p && p.key && (Date.now() - (p.ts||0) < 30 * 60 * 1000)) {
                    key = p.key;
                    ec = p.ec || '';
                }
            } catch {}
        }

        if (!key) return;

        const isIframe = window.top !== window.self;

        if (!isIframe) {
            renderRolfHint(ec);
            pollRolfResult(key);
        } else {
            watchForRolfTags(key, ec);
        }
    }

    function renderRolfHint(ec) {
        if (!document.body) { setTimeout(() => renderRolfHint(ec), 200); return; }

        let b = document.getElementById('__zm_rolf_badge');
        if (b) b.remove();
        b = document.createElement('div');
        b.id = '__zm_rolf_badge';
        b.style.cssText = `position:fixed;top:20px;right:20px;z-index:9999999;
            background:#0f1117;color:#e8eaf6;padding:14px 18px;border-radius:10px;
            font:13px Arial;box-shadow:0 8px 24px rgba(0,0,0,.5);max-width:380px;
            border:1px solid #E67E00;line-height:1.5`;
        b.innerHTML = `
            <div style="color:#E67E00;font-weight:bold;margin-bottom:8px">📋 OIL WIDGET — ROLF</div>
            <div>Вставь код двигателя <b style="color:#E67E00">${escapeHtml(ec || '?')}</b> в «умный поиск» → выбери свою машину → скрипт сам распаршу допуска</div>
            <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
                <button id="zm-rolf-copy" style="background:#E67E00;border:none;color:#fff;border-radius:6px;padding:6px 12px;cursor:pointer;font:12px Arial">⧉ Скопировать</button>
                <button id="zm-rolf-close" style="background:transparent;border:1px solid #3a3d5e;color:#e8eaf6;border-radius:6px;padding:6px 12px;cursor:pointer;font:11px Arial">Закрыть</button>
            </div>
            <div id="zm-rolf-status" style="margin-top:10px;color:#7986cb;font-size:11px">Жду результатов…</div>
        `;
        document.body.appendChild(b);

        const copyBtn = document.getElementById('zm-rolf-copy');
        if (copyBtn && ec) copyBtn.onclick = () => {
            navigator.clipboard.writeText(ec).then(() => {
                copyBtn.textContent = '✓ скопировано';
                setTimeout(() => { copyBtn.textContent = '⧉ Скопировать'; }, 2000);
            }).catch(() => {
                copyBtn.textContent = '✗ не получилось — скопируй руками';
            });
        };
        const closeBtn = document.getElementById('zm-rolf-close');
        if (closeBtn) closeBtn.onclick = () => b.remove();
    }

    function pollRolfResult(key) {
        const interval = setInterval(() => {
            const result = GM_getValue('rolf_approvals_' + key, null);
            if (result && result.length) {
                clearInterval(interval);
                const st = document.getElementById('zm-rolf-status');
                const b = document.getElementById('__zm_rolf_badge');
                if (b) {
                    b.style.borderColor = '#4caf50';
                    if (st) {
                        st.innerHTML = `<b style="color:#4caf50">✅ Сохранено ${result.length} допусков:</b><br>${result.slice(0,5).map(escapeHtml).join(', ')}${result.length>5?'…':''}`;
                    }
                    const existingCloseTabBtn = document.getElementById('zm-rolf-closetab');
                    if (!existingCloseTabBtn) {
                        const btn = document.createElement('button');
                        btn.id = 'zm-rolf-closetab';
                        btn.textContent = '✕ Закрыть эту вкладку';
                        btn.style.cssText = 'margin-top:10px;padding:8px 14px;background:#2196f3;color:#fff;border:none;border-radius:6px;cursor:pointer;font:12px Arial;width:100%';
                        btn.onclick = () => window.close();
                        b.appendChild(btn);
                    }
                }
            }
        }, 1000);
        setTimeout(() => clearInterval(interval), 10 * 60 * 1000);
    }

    function watchForRolfTags(key, ec) {
        const seen = new Set();

        const tryParse = () => {
            const tagBlocks = document.querySelectorAll('.card-oil-tags__tags-wrap');
            if (!tagBlocks.length) return false;

            const allTags = new Set();
            tagBlocks.forEach(block => {
                const tags = block.querySelectorAll('.tag span, .tag_on-black span, span');
                tags.forEach(t => {
                    const txt = (t.textContent || '').replace(/\s+/g, ' ').trim();
                    if (txt && txt.length >= 3 && txt.length <= 80 && /[A-Za-zА-Яа-я]/.test(txt)) {
                        allTags.add(txt);
                    }
                });
            });

            if (!allTags.size) return false;

            const signature = [...allTags].sort().join('|');
            if (seen.has(signature)) return false;
            seen.add(signature);

            const normalized = [];
            allTags.forEach(tag => {
                const m = tag.match(/^([A-Z]+(?:[\s\-][A-Z]+)*)\s+([\d][\d\.\-]*(?:\/[\d][\d\.\-]*)+)/i);
                if (m) {
                    const prefix = m[1].trim();
                    m[2].split('/').forEach(v => normalized.push(`${prefix} ${v.trim()}`));
                } else {
                    normalized.push(tag);
                }
            });

            GM_setValue('rolf_approvals_' + key, normalized);
            return true;
        };

        tryParse();

        const mo = new MutationObserver(() => tryParse());
        const startObserving = () => {
            if (document.body) {
                mo.observe(document.body, { childList: true, subtree: true });
            } else {
                setTimeout(startObserving, 200);
            }
        };
        startObserving();

        const interval = setInterval(() => tryParse(), 1500);
        setTimeout(() => { clearInterval(interval); mo.disconnect(); }, 10 * 60 * 1000);
    }

    // ══════════════════════════════════════════════════════════════════
    //                         MOTUL — ПАРСЕР
    // ══════════════════════════════════════════════════════════════════
    function initMotul() {
        const hash = location.hash.slice(1);
        const hashParams = new URLSearchParams(hash);
        const prefill  = hashParams.get('prefill');
        const cacheKey = hashParams.get('key');
        const wantedEc = (hashParams.get('ec') || '').trim();
        const carData  = hashParams.get('carData') || '';

        if (cacheKey) sessionStorage.setItem('zm_cache_key', cacheKey);
        if (wantedEc) sessionStorage.setItem('zm_wanted_ec', wantedEc);
        if (prefill)  sessionStorage.setItem('zm_prefill',   prefill);
        if (carData)  sessionStorage.setItem('zm_car_data',  carData);

        runManual(
            prefill || sessionStorage.getItem('zm_prefill') || '',
            cacheKey || sessionStorage.getItem('zm_cache_key') || '',
            wantedEc || sessionStorage.getItem('zm_wanted_ec') || '',
            carData || sessionStorage.getItem('zm_car_data') || ''
        );
    }

    function runManual(prefill, cacheKey, wantedEc, carDataRaw) {
        let carData = null;
        if (carDataRaw) {
            try { carData = JSON.parse(carDataRaw); } catch {}
        }
        if (location.pathname.includes('advice.aspx')) {
            setTimeout(() => {
                const data = parseMotulAdvice();
                if (!data || !data.engine) {
                    showManualBadge('⚠️ Не удалось распарсить страницу', '#ff9800');
                    return;
                }
                const key = cacheKey || sessionStorage.getItem('zm_cache_key');
                if (!key) {
                    showManualBadge('⚠️ Нет ключа кеша - открой заново с Mann Filter', '#ff9800');
                    return;
                }

                const foundEc = (data.engine.engineCode || '').trim();
                const ecMatch = wantedEc ? matchEngineCodes(wantedEc, foundEc) : null;

                GM_setValue('motul_car_' + key, data);
                recordSourceLink(key, 'motul', location.href);

                if (wantedEc && !ecMatch) {
                    showManualBadge(`⚠️ Код не совпал: ожидался ${wantedEc}, на Motul ${foundEc || '?'}. Сохранено, но проверь машину!`, '#ff9800');
                } else if (ecMatch) {
                    showManualBadge(`✅ Код совпал: ${foundEc}. Можно закрыть вкладку.`, '#4caf50');
                } else {
                    showManualBadge(`✅ Сохранено. Можно закрыть вкладку.`, '#4caf50');
                }

                const btn = document.createElement('button');
                btn.textContent = '✕ Закрыть вкладку';
                btn.style.cssText = 'position:fixed;top:70px;right:20px;z-index:999999;padding:10px 16px;border-radius:8px;background:#2196f3;color:#fff;border:none;cursor:pointer;font:13px Arial;box-shadow:0 4px 16px rgba(0,0,0,.3)';
                btn.onclick = () => window.close();
                document.body.appendChild(btn);
            }, 1500);
            return;
        }

        if (prefill) {
            setTimeout(() => {
                fillSearchField(prefill);
                showCheatsheet(carData, wantedEc, prefill);
            }, 800);
        }
    }

    function showCheatsheet(carData, wantedEc, prefill) {
        const old = document.getElementById('__zm_cheatsheet');
        if (old) old.remove();

        const fuelMap = {
            '01': 'Бензин', '02': 'Бензин + газ', '04': 'Этанол',
            '05': 'Дизель', '06': 'Дизель', '': '?',
        };
        const fuel = carData ? (fuelMap[carData.fuelType] || carData.fuelType || '?') : '?';

        if (!carData) {
            showManualBadge(`⌨ Ищу "${prefill}"…${wantedEc?' Код двигателя: '+wantedEc:''}. Выбери из выпадашки.`, '#2196f3');
            return;
        }

        const rows = [];
        const car = carData;
        if (car.makeShort)  rows.push(['Марка',     car.makeShort]);
        if (car.modelShort) rows.push(['Модель',    car.modelShort]);
        if (car.engineCode) rows.push(['Код двиг.', car.engineCode, true]);
        if (car.engineName) rows.push(['Двигатель', car.engineName]);
        if (car.volume)     rows.push(['Объём',     car.volume + ' л']);
        if (car.ccm)        rows.push(['Объём',     car.ccm + ' куб.см']);
        if (car.kw && car.bhp) rows.push(['Мощность', `${car.kw} кВт / ${car.bhp} лс`]);
        else if (car.kw)    rows.push(['Мощность', car.kw + ' кВт']);
        else if (car.bhp)   rows.push(['Мощность', car.bhp + ' лс']);
        if (car.yearFrom)   rows.push(['Год',       car.yearFrom]);
        if (fuel !== '?')   rows.push(['Топливо',   fuel]);

        const rowsHtml = rows.map(([k, v, hl]) => `
            <tr>
                <td style="padding:4px 10px 4px 0;color:#7986cb;font-size:11px;white-space:nowrap;vertical-align:top">${k}</td>
                <td style="padding:4px 0;color:${hl?'#fff':'#e8eaf6'};font-size:13px;${hl?'font-weight:bold;background:#2a1d00;padding:4px 8px;border-radius:4px':''}">${escapeHtmlSafe(String(v))}</td>
            </tr>
        `).join('');

        const box = document.createElement('div');
        box.id = '__zm_cheatsheet';
        box.style.cssText = `
            position: fixed; top: 20px; right: 20px; z-index: 9999999;
            background: #0f1117; color: #e8eaf6;
            border: 1px solid #E67E00; border-radius: 12px;
            box-shadow: 0 12px 40px rgba(0,0,0,.6);
            font: 13px Arial, sans-serif;
            width: 340px; max-width: calc(100vw - 40px);
            overflow: hidden;
        `;

        box.innerHTML = `
            <div style="padding:12px 16px;background:#1a1d2e;border-bottom:1px solid #2a2d3e;display:flex;align-items:center;gap:10px">
                <span style="color:#E67E00;font-weight:bold;font-size:13px;flex:1">🛢 OIL WIDGET — шпаргалка</span>
                <button id="__zm_cs_close" style="background:transparent;border:none;color:#7986cb;font-size:18px;cursor:pointer;padding:0 4px;line-height:1">✕</button>
            </div>
            <div style="padding:14px 16px">
                <div style="color:#E67E00;font-size:11px;font-weight:bold;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">
                    👆 Выбери машину в открытой вкладке Motul
                </div>
                <table style="width:100%;border-collapse:collapse;margin-bottom:10px">
                    ${rowsHtml}
                </table>
                <div style="background:#0a0c12;border:1px solid #2a2d3e;border-radius:6px;padding:8px 10px;font-size:11px;color:#7986cb;line-height:1.5">
                    Сравнивай <b style="color:#E67E00">все поля</b> с вариантами в Motul.<br>
                    Главное — <b style="color:#E67E00">код двигателя</b> и год.<br>
                    После выбора скрипт распарсит и вернётся.
                </div>
            </div>
        `;
        document.body.appendChild(box);

        const closeBtn = document.getElementById('__zm_cs_close');
        if (closeBtn) closeBtn.onclick = () => box.remove();
        setTimeout(() => { if (box.parentNode) box.remove(); }, 180000);
    }

    function showReglamentPopup(matches) {
        const old = document.getElementById('__zm_reg_popup');
        if (old) { old.remove(); return; }

        const box = document.createElement('div');
        box.id = '__zm_reg_popup';
        box.innerHTML = `
            <div class="zm-reg-popup-head">
                <span>📖 По регламенту</span>
                <button id="__zm_reg_close" title="Закрыть">✕</button>
            </div>
            <div class="zm-reg-popup-body">
                ${matches.map(m => `
                    <div class="zm-reg-item">
                        <div class="zm-reg-tag">⭐ ${escapeHtmlSafe(m.tag)}</div>
                        <div class="zm-reg-desc">${escapeHtmlSafe(m.desc || '—')}</div>
                    </div>
                `).join('')}
                <div class="zm-reg-foot">Совпадения с регламентом производителя — масло подойдёт.</div>
            </div>
        `;
        document.body.appendChild(box);

        document.getElementById('__zm_reg_close').onclick = () => box.remove();
        const offClick = (e) => {
            if (!box.contains(e.target)) {
                box.remove();
                document.removeEventListener('click', offClick, true);
            }
        };
        setTimeout(() => document.addEventListener('click', offClick, true), 50);
    }

    function matchEngineCodes(mannEc, motulEc) {
        if (!mannEc || !motulEc) return false;
        const a = mannEc.toUpperCase().split(/[,;\/\s]+/).map(s=>s.trim()).filter(Boolean);
        const b = motulEc.toUpperCase().split(/[,;\/\s]+/).map(s=>s.trim()).filter(Boolean);
        for (const x of a) for (const y of b) {
            if (!x || !y) continue;
            if (x === y || x.includes(y) || y.includes(x)) return true;
        }
        return false;
    }

    function fillSearchField(value) {
        const input = document.getElementById('instantsearchinput');
        if (!input) { setTimeout(() => fillSearchField(value), 200); return; }
        input.focus();
        input.value = '';
        for (let i = 0; i < value.length; i++) {
            input.value += value[i];
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keyup', { key: value[i], bubbles: true }));
        }
        if (window.jQuery) {
            try { window.jQuery(input).val(value).trigger('keyup').trigger('input'); } catch {}
        }
    }

    function showManualBadge(text, color) {
        let b = document.getElementById('__motul_badge');
        if (!b) {
            b = document.createElement('div');
            b.id = '__motul_badge';
            b.style.cssText = 'position:fixed;top:20px;right:20px;z-index:999999;color:#fff;padding:12px 18px;border-radius:10px;font:13px Arial;box-shadow:0 8px 24px rgba(0,0,0,.3);max-width:400px';
            (document.body || document.documentElement).appendChild(b);
        }
        b.style.background = color || '#4caf50';
        b.textContent = text;
    }

    function parseMotulAdvice() {
        const makeEl = document.getElementById('ctl00_ContentPlaceHolder1_lblMakeValue');
        const modelEl = document.getElementById('ctl00_ContentPlaceHolder1_lblModelValue');
        const typeEl = document.getElementById('ctl00_ContentPlaceHolder1_lblTypeValue');

        const out = {
            motulName: [makeEl?.textContent, modelEl?.textContent, typeEl?.textContent].filter(Boolean).join(' · '),
            make_model_type: (typeEl?.textContent || '').trim(),
        };

        const titleTds = document.querySelectorAll('.AdviceComponentTitleText');

        titleTds.forEach((tdTitle, idx) => {
            let titleText = '';
            for (const n of tdTitle.childNodes) {
                if (n.nodeType === 3) titleText += n.textContent;
            }
            titleText = titleText.replace(/\s+/g, ' ').trim();
            if (!titleText) titleText = tdTitle.textContent.replace(/- Not applicable/g, '').trim();

            const compBlock = document.getElementById('Comp' + idx);
            if (!compBlock) return;

            const data = parseCompBlock(compBlock);
            data.label = titleText;
            data.rawText = compBlock.textContent;

            if (/двигатель/i.test(titleText)) {
                data.engineCode = titleText.replace(/двигатель/i, '').trim();
                out.engine = data;
            } else if (/раздаточн/i.test(titleText)) {
                out.transfer = data;
            } else if (/передн.*(мост|дифференциал)|дифференциал.*передн/i.test(titleText)) {
                out.diffFront = data;
            } else if (/задн.*(мост|дифференциал)|дифференциал.*задн/i.test(titleText)) {
                out.diffRear = data;
            } else if (/механическая/i.test(titleText)) {
                out.manual = data;
            } else if (/полуавтомат/i.test(titleText)) {
                // Полуавтомат (AMT/робот с одним сцеплением) — считаем как МКПП
                // на 75W-90. Проверка ОБЯЗАТЕЛЬНО до /автомат/, т.к.
                // "полуавтоматическая" содержит "автомат".
                data.isSemiAuto = true;
                out.manual = data;
            } else if (/вариатор|CVT/i.test(titleText)) {
                out.automatic = data;
                data.isCvt = true;
            } else if (/DSG|DCT|робот|двойн[а-я]+ сцеплен/i.test(titleText)) {
                out.automatic = data;
                data.isDct = true;
            } else if (/автомат/i.test(titleText) || /коробка передач.*планет/i.test(titleText)) {
                out.automatic = data;
            }
        });

        return out;
    }

    function parseCompBlock(block) {
        const result = { volume: 0, filterVolume: 0, motulProducts: [], modes: [] };
        let volService = 0, volTotal = 0, volPlain = 0;

        const norm = (s) => s.toLowerCase()
            .replace(/o/g, 'о').replace(/c/g, 'с').replace(/e/g, 'е')
            .replace(/p/g, 'р').replace(/a/g, 'а');

        const rows = block.querySelectorAll('tr');
        let lastTitle = '';

        rows.forEach(tr => {
            const titleTd = tr.querySelector('.AdviceTitle');
            const valueTd = tr.querySelector('.AdviceValue');

            if (titleTd && valueTd) {
                const title = titleTd.textContent.replace(/\s+/g, ' ').trim();
                const value = valueTd.textContent.replace(/\s+/g, ' ').trim();
                const valueN = norm(value);
                const titleN = norm(title);

                if (/объ[её]м/.test(valueN) || /объ[её]м/.test(titleN)) {
                    const m = value.match(/([\d]+(?:[,\.]\d+)?)\s*л/i);
                    if (m) {
                        const vol = parseFloat(m[1].replace(',', '.'));
                        const isFilter  = /фильтр/.test(valueN);
                        const isService = /сервисн/.test(valueN);
                        const isTotal   = /общ|полн/.test(valueN);

                        if (isFilter) {
                            result.filterVolume = vol;
                        } else if (isService) {
                            volService = vol;
                        } else if (isTotal) {
                            volTotal = vol;
                        } else if (!volPlain) {
                            volPlain = vol;
                        }
                    }
                } else if (/режим/.test(titleN) || /режим/.test(valueN)) {
                    result.modes.push(value);
                } else if (/интервал/.test(titleN) || /интервал/.test(valueN)) {
                    result.interval = value;
                }
                lastTitle = title;
            }

            const prodValueTd = tr.querySelector('.AdviceValueProduct');
            if (prodValueTd) {
                const pname = prodValueTd.textContent.replace(/\s+/g, ' ').trim();
                if (pname && pname !== ':' && !/products not found/i.test(pname) && pname.length > 1) {
                    if (!result.motulProducts.includes(pname)) {
                        result.motulProducts.push(pname);
                    }
                }
            }
        });

        result.volumeService = volService;
        result.volumeTotal = volTotal;
        result.volumePlain = volPlain;
        result.volume = volService || volTotal || volPlain || 0;
        result.volumeType = volService ? 'service' : (volTotal ? 'total' : 'plain');

        return result;
    }

    // ══════════════════════════════════════════════════════════════════
    //                         СТИЛИ И ОБЁРТКА
    // ══════════════════════════════════════════════════════════════════
    function injectStyles() {
        if (document.getElementById('__zm_style')) return;
        const s = document.createElement('style');
        s.id = '__zm_style';
        s.textContent = `
            #__zm_w{position:fixed;bottom:18px;left:18px;z-index:999999;
                font-family:Arial,sans-serif;font-size:13px;width:320px;max-height:86vh;
                overflow-y:auto;background:#0f1117;border:1px solid #2a2d3e;
                border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.55);color:#e8eaf6;
                text-align:left}
            #__zm_w *{text-align:inherit;box-sizing:border-box}
            #__zm_w .zm-bath-msg,
            #__zm_w .zm-dct-notice{text-align:center}
            #__zm_w.zm-full{width:580px}
            #__zm_w.zm-hidden{max-height:44px;overflow:hidden}
            #__zm_w::-webkit-scrollbar{width:6px}
            #__zm_w::-webkit-scrollbar-thumb{background:#2a2d3e;border-radius:3px}
            .zm-header{background:#1a1d2e;padding:10px 14px;display:flex;gap:8px;align-items:center;
                border-bottom:1px solid #2a2d3e;position:sticky;top:0;z-index:2;border-radius:12px 12px 0 0}
            .zm-title{color:#E67E00;font-weight:bold;font-size:12px;letter-spacing:.08em;flex:1}
            .zm-btn{background:#1e2040;border:1px solid #3a3d5e;border-radius:6px;
                color:#e8eaf6;font-size:11px;padding:6px 12px;cursor:pointer;font-family:inherit}
            .zm-btn-pri{background:#E67E00;border-color:#E67E00;color:#fff;font-weight:bold}
            .zm-btn-pri:hover{background:#d67100}
            .zm-btn-sec:hover{background:#3a3d5e}
            #__zm_w:not(.zm-full) .zm-header,
            #__zm_w:not(.zm-full) .zm-car,
            #__zm_w:not(.zm-full) .zm-tray-status,
            #__zm_w:not(.zm-full) .zm-tray-btns{padding-left:14px;padding-right:14px}
            .zm-car{padding:10px 14px;border-bottom:1px solid #2a2d3e}
            .zm-car-t{font-size:14px;font-weight:bold}
            .zm-car-sub{color:#5a6070;font-size:11px;margin-top:3px}
            .zm-tray-status{padding:8px 14px;font-size:12px}
            .zm-ok{color:#4caf50}
            .zm-wait{color:#ff9800}
            .zm-tray-btns{padding:8px 14px 14px;display:flex;gap:6px}
            .zm-tray-btns .zm-btn-pri{flex:1}
            .zm-ctrls{padding:10px 14px;background:#0a0c12;border-bottom:1px solid #2a2d3e}
            .zm-ctrl-row{display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap}
            .zm-ctrl-row:last-child{margin-bottom:0}
            .zm-ctrl-lbl{color:#5a6070;font-size:11px;margin-right:4px}
            .zm-chip{background:#1e2040;border:1px solid #3a3d5e;border-radius:14px;
                color:#e8eaf6;font-size:11px;padding:4px 10px;cursor:pointer}
            .zm-chip-act{background:#E67E00;border-color:#E67E00;color:#fff}
            .zm-visc-badge{display:inline-block;background:#1e2040;border:1px solid #3a3d5e;
                color:#e8eaf6;font-size:10px;padding:2px 8px;border-radius:10px;margin-bottom:4px}
            .zm-visc-10w40{background:#3a2000;border-color:#E67E00;color:#E67E00;font-weight:bold}
            .zm-chip-flush.zm-chip-act{background:#7c4dff;border-color:#7c4dff}
            .zm-chip-flush:not(.zm-chip-act){border-color:#5e35b1;color:#b39ddb}
            .zm-flush-box{background:#1a0f3a;border:1px solid #5e35b1;border-radius:6px;
                padding:8px 10px;margin:6px 0;font-size:11px;color:#d1c4e9;line-height:1.5}
            .zm-flush-box b{color:#b39ddb}
            .zm-flush-formula{font-family:monospace;color:#9575cd;background:#0a0517;
                padding:1px 6px;border-radius:3px;margin:0 2px}
            .zm-flush-total{color:#fff !important;background:#5e35b1;padding:1px 8px;
                border-radius:3px;font-size:13px;margin-left:2px}
            .zm-visc-0w20{background:#001f3a;border-color:#2196f3;color:#64b5f6;font-weight:bold}
            .zm-visc-0w30{background:#00332a;border-color:#26a69a;color:#4db6ac;font-weight:bold}
            #zm-aggs{padding:10px 14px}
            .zm-agg{background:#131722;border:1px solid #2a2d3e;border-radius:8px;padding:10px 12px;margin-bottom:10px}
            .zm-agg.zm-bath{background:#3a1818;border-color:#5a2828}
            .zm-bath-msg{color:#ef5350;font-size:14px;font-weight:bold;text-align:center;padding:14px}
            .zm-agg-head{display:flex;align-items:center;margin-bottom:8px}
            .zm-chk{display:flex;align-items:center;gap:8px;cursor:pointer;flex:1}
            .zm-chk input{cursor:pointer}
            .zm-chk-lbl{font-weight:bold;font-size:12px}
            .zm-agg-vol{color:#E67E00;font-size:11px;font-family:monospace}
            .zm-atp-ctrls{background:#0a0c12;border-radius:6px;padding:8px 10px;margin-bottom:8px}
            .zm-atp-type{color:#E67E00;font-size:10px;font-weight:bold;letter-spacing:.05em;margin-bottom:6px;text-transform:uppercase}
            .zm-dct-notice{background:#1e1f3a;border:1px solid #3a3d5e;border-radius:8px;padding:14px 16px;margin-bottom:12px;color:#81a8e0;font-size:12px;line-height:1.4;text-align:center}
            .zm-dct-notice b{color:#9aafe0}
            .zm-dct-notice small{color:#5a6070;display:block;margin-top:6px;font-style:italic}
            .zm-btn-filters{display:block;width:calc(100% - 28px);margin:10px 14px;background:#1e2040;border:1px dashed #3a3d5e;color:#7986cb;padding:8px;border-radius:8px;cursor:pointer;font:12px Arial}
            .zm-btn-filters:hover{border-color:#E67E00;color:#E67E00}
            .zm-filters-panel{background:#131722;border:1px solid #E67E00;border-radius:8px;padding:10px 12px;margin:10px 14px}
            .zm-filters-list-wrap{background:#131722;border:1px solid #2a2d3e;border-radius:8px;padding:10px 12px;margin:10px 14px}
            .zm-filters-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;color:#E67E00;font-size:11px;font-weight:bold}
            .zm-filters-ta{width:100%;box-sizing:border-box;background:#0a0c12;border:1px solid #3a3d5e;color:#e8eaf6;border-radius:6px;padding:8px;font:11px monospace;resize:vertical}
            .zm-filters-btns{display:flex;gap:6px;margin-top:8px}
            .zm-filters-btns .zm-btn-pri{flex:1}
            .zm-filters-hint{color:#5a6070;font-size:10px;margin-top:6px}
            .zm-filters-hint code{background:#0a0c12;padding:1px 4px;border-radius:3px;color:#7986cb}
            .zm-filters-list{display:flex;flex-direction:column;gap:8px;margin-top:4px}
            .zm-filter-row{background:#0a0c12;border-radius:6px;padding:8px 10px}
            .zm-filter-row .zm-chk-lbl{font-weight:normal;font-size:11px}
            .zm-filter-row .zm-chk-lbl b{color:#E67E00;margin-right:6px}
            .zm-filter-work{display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-top:6px;margin-left:24px}
            .zm-filter-work .zm-chip{font-size:10px;padding:3px 8px}
            .zm-filter-work-none{color:#5a6070;font-size:10px;margin-top:4px;margin-left:24px;font-style:italic}
            .zm-formula{color:#5a6070;font-size:10px;font-family:monospace;margin:4px 0 8px;padding:4px 8px;background:#0a0c12;border-radius:4px}
            .zm-vol-edit{display:flex;align-items:center;gap:6px;margin:4px 0 6px;flex-wrap:wrap}
            .zm-vol-input{background:#0a0c12;border:1px solid #3a3d5e;color:#e8eaf6;border-radius:4px;padding:3px 6px;width:64px;font:11px monospace;text-align:right}
            .zm-vol-input:focus{outline:none;border-color:#E67E00;background:#1a1d2e}
            .zm-vol-motul{color:#5a6070;font-size:10px;font-style:italic}
            .zm-vol-warn{color:#ff9800}
            .zm-vol-reset{background:transparent;border:1px solid #3a3d5e;color:#7986cb;border-radius:3px;padding:1px 5px;cursor:pointer;font:10px Arial}
            .zm-vol-reset:hover{border-color:#E67E00;color:#E67E00}
            .zm-oil-line{padding:6px 8px;margin-bottom:4px;background:#0f1421;border-radius:6px}
            .zm-oil-name{font-size:12px;font-weight:bold;color:#e8eaf6}
            .zm-oil-calc{color:#81c784;font-size:11px;font-family:monospace;margin-top:2px}
            .zm-oil-total{color:#fff;font-size:15px;font-weight:900;background:#1d3a1d;padding:1px 6px;border-radius:3px;margin-left:2px}
            .zm-oil-total-sump{background:#1d3a3a;color:#80deea}
            .zm-oil-price{color:#5a6070;font-size:10px;margin-top:1px}
            .zm-oil-line b{color:#E67E00}
            .zm-oil-pick-btn{background:transparent;border:1px dashed #3a3d5e;color:#e8eaf6;padding:2px 8px;border-radius:4px;cursor:pointer;font:bold 12px Arial;text-align:left;width:100%}
            .zm-oil-pick-btn:hover{background:#1e2040;border-color:#E67E00}
            .zm-oil-picker{background:#0a0c12;border:1px solid #E67E00;border-radius:6px;padding:8px;margin-top:6px}
            .zm-oil-picker-head{color:#E67E00;font-size:10px;margin-bottom:6px;font-weight:bold}
            .zm-oil-opt{display:flex;justify-content:space-between;align-items:center;width:100%;background:#131722;border:1px solid #2a2d3e;color:#e8eaf6;padding:5px 8px;border-radius:4px;cursor:pointer;font:11px Arial;margin-bottom:3px;text-align:left}
            .zm-oil-opt:hover{border-color:#E67E00;background:#1e2040}
            .zm-oil-opt-act{border-color:#E67E00;background:#2a1d00}
            .zm-oil-opt-name{flex:1;font-weight:500}
            .zm-oil-opt-price{color:#81c784;font-weight:bold;font-size:10px;margin-left:8px}
            .zm-app-btn{background:transparent;border:none;color:#7986cb;font-size:10px;cursor:pointer;padding:4px 0;margin-top:6px}
            .zm-app-btn:hover{color:#E67E00}
            .zm-app-list{padding:6px 8px;background:#0a0c12;border-radius:4px;margin-top:4px;display:flex;flex-wrap:wrap;gap:4px}
            .zm-app-tag{background:#1e2040;color:#9aa0b0;padding:2px 6px;border-radius:3px;font-size:10px;font-family:monospace;
                margin:2px 3px 0 0;display:inline-block;cursor:help}
            .zm-app-list-col{display:block}
            .zm-app-sum{font-size:10px;color:#9aa0b0;line-height:1.5;margin-bottom:4px}
            .zm-app-sum b{color:#E67E00}
            .zm-app-warn{font-size:10px;color:#ff8a80;line-height:1.4;margin-bottom:6px;cursor:help}
            .zm-app-grp{margin-top:5px}
            .zm-app-grp-h{font-size:9px;text-transform:uppercase;letter-spacing:.04em;color:#5a6070;margin-bottom:2px}
            /* цвет = что решает выбор, а что попало в список из чужого паспорта */
            .zm-app-critical{background:#3a1420;color:#ff8a80;border:1px solid #b04a4a}
            .zm-app-important{background:#12301c;color:#7fd18a;border:1px solid #3f7a4a}
            .zm-app-minor{background:#14203a;color:#7fa8e8;border:1px solid #3a5a8a}
            .zm-app-conflict{background:#1a1a20;color:#8a8a95;border:1px dashed #b04a4a;text-decoration:line-through}
            .zm-app-info{background:#1a1c28;color:#7a8090}
            .zm-app-noise{background:transparent;color:#5a6070;border:1px solid #2a2d40}
            .zm-motul-prods{background:#0a0c12;border-radius:4px;padding:6px 8px;margin-top:6px}
            .zm-motul-t{color:#5a6070;font-size:10px;margin-bottom:3px}
            .zm-motul-p{display:inline-block;background:#1e2040;color:#7986cb;padding:1px 5px;border-radius:3px;font-size:10px;margin:1px;font-family:monospace}
            .zm-result-wrap{padding:10px 14px;border-top:1px solid #2a2d3e}
            #zm-totals:empty{display:none}
            .zm-totals-wrap{padding:0 14px 8px}
            .zm-tot-block{background:#131722;border:1px solid #2a2d3e;border-radius:8px;padding:8px 10px;margin-bottom:8px}
            .zm-tot-block-h{display:flex;justify-content:space-between;align-items:center;color:#E67E00;font-size:11px;font-weight:bold;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid #2a2d3e;flex-wrap:wrap;gap:4px}
            .zm-tot-block-h b{color:#fff;font-size:13px;background:#1d3a1d;padding:2px 8px;border-radius:4px;margin-left:4px}
            .zm-tot-row{margin-bottom:6px}
            .zm-tot-row:last-child{margin-bottom:0}
            .zm-tot-row-h{color:#7986cb;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px}
            .zm-tot-opt{display:flex;align-items:center;gap:6px;padding:3px 6px;cursor:pointer;font-size:11px;border-radius:4px}
            .zm-tot-opt:hover{background:#1e2040}
            .zm-tot-opt input{cursor:pointer;margin:0}
            .zm-tot-opt-skip{color:#7986cb;font-style:italic}
            .zm-result-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
            .zm-result-head span{color:#E67E00;font-size:11px;font-weight:bold}
            .zm-result{background:#0a0c12;border:1px solid #2a2d3e;border-radius:6px;
                padding:10px;color:#e8eaf6;font-family:monospace;font-size:11px;
                white-space:pre-wrap;margin:0;max-height:300px;overflow-y:auto}
            .zm-warn{color:#ff9800;padding:14px;font-size:12px;line-height:1.5}
            .zm-no-full-warn{background:#3a0000;border:1px solid #ff4d4d;color:#ff8585;padding:6px 10px;font-size:11px;border-radius:6px;margin:6px 0;font-weight:600}
            .zm-quirk{display:flex;gap:7px;align-items:flex-start;margin:6px 10px 0;padding:6px 9px;
                border-radius:6px;font-size:11px;line-height:1.45;background:#12141c;border:1px solid #2a2d3e;color:#c5c8d6}
            .zm-quirk-block{background:#2a0000;border-color:#e53935;color:#ff8a80}
            .zm-quirk-warn{background:#2a1d00;border-color:#E67E00;color:#ffb74d}
            .zm-quirk-tag{flex:none;font-size:9px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;opacity:.85;padding-top:1px}
            .zm-quirk-note{display:block;margin-top:2px;opacity:.8}
            .zm-oil-line-reg{border:1px solid #2e7d32;background:#0e2014}
            .zm-reg-badge{background:#1b3a1b;border:1px solid #2e7d32;color:#a5d6a7;font-size:11px;padding:1px 6px;border-radius:4px;cursor:pointer;margin-left:6px;font-weight:600;line-height:1.4}
            .zm-reg-badge:hover{background:#2e7d32;color:#fff;border-color:#4caf50}
            .zm-reg-mark{color:#81c784;margin-right:4px}
            .zm-oil-opt-reg{border-color:#2e7d32;background:#0e2014}
            .zm-oil-opt-reg:hover{border-color:#4caf50;background:#1b3a1b}
            #__zm_reg_popup{position:fixed;top:80px;right:24px;z-index:9999999;
                background:#0f1117;color:#e8eaf6;border:1px solid #2e7d32;border-radius:10px;
                box-shadow:0 12px 40px rgba(0,0,0,.6);font:13px Arial,sans-serif;
                width:380px;max-width:calc(100vw - 40px);overflow:hidden}
            .zm-reg-popup-head{padding:10px 14px;background:#1a1d2e;border-bottom:1px solid #2e7d32;
                display:flex;justify-content:space-between;align-items:center;color:#a5d6a7;font-weight:bold}
            .zm-reg-popup-head button{background:transparent;border:none;color:#7986cb;font-size:18px;cursor:pointer;padding:0 4px;line-height:1}
            .zm-reg-popup-body{padding:12px 14px;max-height:60vh;overflow-y:auto}
            .zm-reg-item{margin-bottom:10px;padding:8px 10px;background:#131722;border-left:3px solid #2e7d32;border-radius:4px}
            .zm-reg-tag{color:#a5d6a7;font-weight:bold;font-size:12px;margin-bottom:4px;font-family:monospace}
            .zm-reg-desc{color:#bdc1d1;font-size:12px;line-height:1.5}
            .zm-reg-foot{font-size:11px;color:#7986cb;font-style:italic;text-align:center;margin-top:8px}

            /* ── НОВОЕ: блок деталей масла (метчи допусков + присадки) ── */
            .zm-oil-details{margin-top:6px;padding-top:6px;border-top:1px dashed #2a2d3e}
            .zm-oil-app-matched{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px}
            .zm-oil-app-pill{display:inline-block;font-size:10px;padding:2px 8px;border-radius:10px;
                font-family:monospace;background:#1e2040;color:#9aa0b0;border:1px solid #2a2d3e;
                line-height:1.4}
            /* Подсветка совпавшего допуска — переливающийся градиент */
            .zm-oil-app-pill.zm-oil-app-match{
                background:linear-gradient(120deg,#1b5e20,#2e7d32,#43a047,#66bb6a,#43a047,#2e7d32,#1b5e20);
                background-size:300% 100%;
                color:#fff;
                border:1px solid #66bb6a;
                font-weight:700;
                box-shadow:0 0 8px rgba(102,187,106,.35);
                animation:zm-shimmer 3s linear infinite}
            @keyframes zm-shimmer{
                0%   {background-position:0% 50%}
                100% {background-position:300% 50%}
            }
            /* Допуск, покрывающий требуемый через иерархию (MB 229.5 ⊃ 229.3) */
            .zm-oil-app-pill.zm-oil-app-hier{
                background:linear-gradient(120deg,#0d47a1,#1565c0,#1e88e5,#42a5f5,#1e88e5,#1565c0,#0d47a1);
                background-size:300% 100%;
                color:#fff;
                border:1px solid #42a5f5;
                font-weight:700;
                box-shadow:0 0 8px rgba(66,165,245,.35);
                animation:zm-shimmer 3s linear infinite}
            .zm-oil-opt-hits{font-size:9px;color:#66bb6a;margin-left:4px;white-space:nowrap}
            .zm-oil-opt-miss{font-size:9px;color:#ff8a80;margin-left:4px;white-space:nowrap}

            /* ── Модалка «Отправить отчёт в базу» ── */
            #zm-db-modal{position:fixed;inset:0;z-index:2147483646;font:13px Arial}
            /* Окно логина — поверх модалки отчёта, тот же визуальный язык (.zm-db-*) */
            #zm-login-modal{position:fixed;inset:0;z-index:2147483647;font:13px Arial}
            .zm-db-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.6)}
            .zm-db-win{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
                width:560px;max-width:94vw;max-height:88vh;display:flex;flex-direction:column;
                background:#0f1117;color:#e8eaf6;border:1px solid #E67E00;border-radius:12px;
                box-shadow:0 12px 48px rgba(0,0,0,.6)}
            .zm-db-head{display:flex;justify-content:space-between;align-items:center;
                padding:12px 16px;border-bottom:1px solid #2a2d3e;color:#E67E00;font-weight:bold}
            .zm-db-body{padding:12px 16px;overflow-y:auto}
            .zm-db-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;
                border-top:1px solid #2a2d3e}
            .zm-db-note{font-size:11px;color:#7986cb;margin-bottom:8px}
            .zm-db-sec-h{font-size:11px;font-weight:bold;color:#a0b0c0;margin:12px 0 6px;
                text-transform:uppercase;letter-spacing:.5px}
            .zm-db-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px}
            .zm-db-field{display:flex;flex-direction:column;gap:2px}
            .zm-db-field span{font-size:10px;color:#7986cb}
            .zm-db-field input,.zm-db-field select,.zm-db-agg-row input,.zm-db-filter-row input[type=text],
            #zm-db-modal textarea{background:#1a1d2e;border:1px solid #2a2d3e;color:#e8eaf6;
                border-radius:6px;padding:6px 8px;font:12px Arial;width:100%;box-sizing:border-box}
            .zm-db-field input:focus,.zm-db-field select:focus,#zm-db-modal textarea:focus{outline:none;border-color:#E67E00}
            .zm-db-agg-row{display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap}
            .zm-db-agg-lbl{font-size:11px;color:#bdc1d1;min-width:130px}
            .zm-db-agg-row input{width:70px !important}
            .zm-db-agg-l{font-size:11px;color:#7986cb}
            .zm-db-agg-products{display:flex;flex-wrap:wrap;gap:3px;flex:1}
            .zm-db-chip{font-size:9px;padding:1px 6px;border-radius:8px;background:#1e2040;
                color:#9aa0b0;border:1px solid #2a2d3e;font-family:monospace}
            .zm-db-filter-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
            .zm-db-filter-row input[type=text]{flex:1;width:auto}
            .zm-db-chk{display:flex;align-items:center;gap:6px;font-size:12px;color:#bdc1d1;
                cursor:pointer;white-space:nowrap}
            .zm-db-flag{margin-bottom:4px}
            .zm-db-error{margin-top:10px;padding:8px 10px;font-size:12px;background:#2a0000;
                border:1px solid #e53935;border-radius:6px;color:#ff8a80}
            #zm-db-toast{position:fixed;bottom:18px;right:18px;z-index:2147483647;
                background:#0f1117;border:1px solid #43a047;border-radius:10px;
                padding:12px 16px;color:#e8eaf6;font:13px Arial;
                box-shadow:0 8px 32px rgba(0,0,0,.55)}
            .zm-db-toast-t{font-weight:bold;color:#66bb6a;margin-bottom:4px}
            .zm-db-toast-link{color:#E67E00;font-size:12px}
            .zm-oil-app-btn{background:transparent;border:1px dashed #3a3d5e;color:#7986cb;
                font-size:10px;cursor:pointer;padding:3px 10px;border-radius:10px;
                margin-top:2px;display:inline-block;line-height:1.4}
            .zm-oil-app-btn:hover{border-color:#E67E00;color:#E67E00}
            .zm-oil-app-btn-open{border-style:solid;border-color:#E67E00;color:#E67E00}
            .zm-oil-app-others{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;
                padding:6px 8px;background:#0a0c12;border-radius:6px}
            .zm-oil-ads{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
            .zm-oil-ad-pill{display:inline-block;font-size:10px;padding:2px 8px;border-radius:10px;
                background:#1a1d2e;color:#a8b3d9;border:1px solid #2a2d3e;line-height:1.4}
            /* Присадки SPOT — фирменный оранжевый, тоже немного переливаются */
            .zm-oil-ad-pill.zm-oil-ad-pill-spot{
                background:linear-gradient(120deg,#3a2000,#5e3a00,#8a5500,#E67E00,#8a5500,#5e3a00,#3a2000);
                background-size:300% 100%;
                color:#fff;
                border:1px solid #E67E00;
                font-weight:600;
                box-shadow:0 0 6px rgba(230,126,0,.3);
        `;
        document.head.appendChild(s);
    }

    function createWidget() {
        let w = document.getElementById('__zm_w');
        if (!w) {
            w = document.createElement('div');
            w.id = '__zm_w';
            document.body.appendChild(w);
        }
        return w;
    }


if (typeof location !== 'undefined' && typeof document !== 'undefined') {
    routeByHost();
}
