// ─────────────────────────────────────────────────────────────────────────────
// Правка данных машины — ОДНО окно с вкладками.
//
// Раньше правка жила прямо в шапке страницы: кнопка «Нашли ошибку?» превращала
// всю шапку в одну простыню полей — от марки до списка масел магазина. Найти в
// ней нужное поле было нельзя, а сохранение перезаписывало машину целиком.
//
// Теперь: вкладка = один смысловой кусок данных (машина / агрегаты / фильтры /
// особенности / ссылки / теги-заметка), рядом с названием вкладки видно, что в
// ней уже изменено, а в базу уходят ТОЛЬКО изменённые поля (PATCH принимает
// любое подмножество). Два человека, правящие разные вкладки, больше не
// затирают работу друг друга.
// ─────────────────────────────────────────────────────────────────────────────

import { SERVICE_FLAGS } from '../../shared/serviceFlags.js';
import { fuelSelectOptions, normalizeFuelCode } from '../../shared/fuel.js';
import {
    SOURCE_SITES, SOURCE_LABELS, buildSourceKeys, cleanSourceLinks,
} from '../../shared/sourceLinks.js';
import { changedCarFields } from '../../shared/carPatch.js';
import { checkAchievementsNow } from './achievements.js';

// Вкладки и поля, которые в них правятся. Порядок массива = порядок в окне,
// поля нужны, чтобы у вкладки с изменениями зажигалась метка «изменено».
const TABS = [
    {
        id: 'car', label: 'Машина',
        hint: 'Марка, модель, двигатель, годы выпуска — то, что в шапке страницы.',
        fields: ['brand', 'model', 'generation', 'engine_name', 'engine_code',
                 'engine_volume', 'year_from', 'year_to', 'kw', 'bhp', 'fuel_type'],
    },
    {
        id: 'aggs', label: 'Агрегаты и объёмы',
        hint: 'Названия агрегатов, объём заправки и допуска, по которым подбирается масло.',
        fields: ['fluid_capacities', 'car_approvals'],
    },
    {
        id: 'filters', label: 'Фильтры ДВС',
        hint: 'Артикулы фильтров: их показывает калькулятор и копирует кнопкой. '
            + 'Не знаете артикул — оставьте поле пустым, это не ошибка. Галочка '
            + '«отсутствует» значит другое: такого фильтра у машины нет.',
        fields: ['filter_part_numbers'],
    },
    {
        id: 'flags', label: 'Особенности обслуживания',
        hint: 'Плашки-предупреждения в шапке: что этой машине не делаем.',
        fields: ['service_flags'],
    },
    {
        id: 'links', label: 'Ссылки на источники',
        hint: 'Кнопки «страницы машины» в шапке. По ним же нотификатор находит машину у коллег.',
        fields: ['source_links'],
    },
    {
        id: 'meta', label: 'Теги и заметка',
        hint: 'Слова для поиска и свободный текст для коллег.',
        fields: ['tags', 'notes'],
    },
];

// Поле → вкладка, в которой оно правится (для меток «изменено»).
const FIELD_TAB = {};
for (const t of TABS) for (const f of t.fields) FIELD_TAB[f] = t.id;

const CUSTOM_AGG_TYPES = [
    { v: 'cvt',  l: 'Вариатор (CVT)' },
    { v: 'auto', l: 'АКПП' },
    { v: 'gear', l: 'Мост / редуктор / раздатка / МКПП' },
];

// Штатные агрегаты в порядке показа. label — как называется агрегат, если его
// не переименовали руками.
function stdAggs(fc) {
    return [
        { key: 'engine',    def: 'ДВС (двигатель)' },
        { key: 'automatic', def: fc.automatic?.isCvt ? 'Вариатор (CVT)' : 'АКПП' },
        { key: 'manual',    def: 'МКПП' },
        { key: 'transfer',  def: 'Раздаточная коробка' },
        { key: 'diffFront', def: 'Дифференциал (перед)' },
        { key: 'diffRear',  def: 'Дифференциал (зад)' },
    ];
}

// ── Точка входа ───────────────────────────────────────────────────────────────

export function openCarEditor(record, ctx, { tab } = {}) {
    const old = document.getElementById('car-editor-modal');
    if (old) old.remove();

    const state = {
        tab: TABS.some(t => t.id === tab) ? tab : TABS[0].id,
        customAggs: customAggsFromRecord(record),
        tags: Array.isArray(record.tags) ? record.tags.map(String) : [],
    };

    const modal = document.createElement('div');
    modal.id = 'car-editor-modal';
    modal.className = 'modal';
    modal.innerHTML = renderShell(record, state);
    document.body.appendChild(modal);

    const win = modal.querySelector('.car-ed-win');
    const close = () => {
        document.removeEventListener('keydown', onKey);
        modal.remove();
    };
    // Клик мимо окна и Esc не должны стирать десять минут правки молча:
    // спрашиваем, только если что-то реально изменено.
    const closeGuarded = () => {
        let dirty = 0;
        // Сломанный сбор формы не должен превращаться в неубираемое окно —
        // тогда просто закрываем без вопросов.
        try {
            dirty = Object.keys(changedCarFields(record, collectPatch(win, record, state))).length;
        } catch { dirty = 0; }
        if (dirty && !confirm('Закрыть без сохранения? Изменения потеряются.')) return;
        close();
    };
    const onKey = (e) => { if (e.key === 'Escape') closeGuarded(); };
    document.addEventListener('keydown', onKey);

    modal.querySelector('.modal-backdrop').onclick = closeGuarded;
    modal.querySelector('#car-ed-close').onclick = closeGuarded;
    modal.querySelector('#car-ed-cancel').onclick = closeGuarded;

    bindTabs(win, state);
    bindCustomAggs(win, state);
    bindTags(win, state);
    bindFilterAbsent(win);

    // Метки «изменено» пересчитываются на каждый ввод: человек видит, в каких
    // вкладках он уже что-то тронул, не переключаясь по ним.
    const refresh = () => refreshDirty(win, record, state);
    win.addEventListener('input', refresh);
    win.addEventListener('change', refresh);
    refresh();

    bindSave(win, record, ctx, state, close);
    return modal;
}

// ── Каркас окна ───────────────────────────────────────────────────────────────

function renderShell(record, state) {
    const title = [record.brand, record.model].filter(Boolean).join(' ');
    const nav = TABS.map(t => `
        <button class="car-ed-tab${t.id === state.tab ? ' active' : ''}" data-ed-tab="${t.id}">
            <span class="car-ed-tab-lbl">${esc(t.label)}</span>
            <span class="car-ed-tab-mark" data-ed-mark="${t.id}"></span>
        </button>`).join('');

    const panes = TABS.map(t => `
        <section class="car-ed-pane${t.id === state.tab ? '' : ' hidden'}" data-ed-pane="${t.id}">
            <div class="car-ed-pane-h">${esc(t.label)}</div>
            <div class="edit-oils-note">${esc(t.hint)}</div>
            ${renderPane(t.id, record, state)}
        </section>`).join('');

    return `
        <div class="modal-backdrop"></div>
        <div class="modal-win car-ed-win">
            <div class="modal-head">
                <span>Правка данных${title ? ` — ${esc(title)}` : ''}</span>
                <button class="btn btn-sec" id="car-ed-close" title="закрыть без сохранения">✕</button>
            </div>
            <div class="car-ed-body">
                <nav class="car-ed-tabs">${nav}</nav>
                <div class="car-ed-panes">${panes}</div>
            </div>
            <div class="car-ed-foot">
                <div id="car-ed-error" class="edit-error hidden"></div>
                <label class="car-ed-comment">
                    <span>Что исправили — коротко (необязательно, попадёт в историю машины)</span>
                    <input type="text" id="car-ed-comment" autocomplete="off" placeholder="напр. «объём АКПП по мануалу, было 7 л»"/>
                </label>
                <div class="car-ed-foot-btns">
                    <span class="car-ed-status" id="car-ed-status"></span>
                    <button class="btn btn-sec" id="car-ed-cancel">Отмена</button>
                    <button class="btn btn-pri" id="car-ed-save">Сохранить</button>
                </div>
            </div>
        </div>
    `;
}

function renderPane(id, record, state) {
    if (id === 'car')     return paneCar(record);
    if (id === 'aggs')    return paneAggs(record);
    if (id === 'filters') return paneFilters(record);
    if (id === 'flags')   return paneFlags(record);
    if (id === 'links')   return paneLinks(record);
    if (id === 'meta')    return paneMeta(record);
    return '';
}

// ── Вкладка «Машина» ──────────────────────────────────────────────────────────

// 'decimal' — дробь через точку ИЛИ запятую: обычный текст + числовая
// клавиатура на телефоне. input[type=number] выкидывает запятую, и введённый
// объём молча терялся при сохранении.
function numAttrs(type) {
    if (type === 'decimal') return 'type="text" inputmode="decimal" autocomplete="off"';
    if (type === 'number') return 'type="number" step="any"';
    return `type="${type}"`;
}

function field(key, label, value, type = 'text') {
    return `
        <label class="edit-field">
            <span>${label}</span>
            <input ${numAttrs(type)} data-edit="${key}" value="${esc(value == null ? '' : String(value))}"/>
        </label>`;
}

function paneCar(record) {
    return `
        <div class="edit-grid">
            ${field('brand', 'Марка *', record.brand)}
            ${field('model', 'Модель *', record.model)}
            ${field('generation', 'Поколение', record.generation)}
            ${field('engine_name', 'Двигатель', record.engine_name)}
            ${field('engine_code', 'Код двигателя', record.engine_code)}
            ${field('engine_volume', 'Объём, л', record.engine_volume, 'decimal')}
            ${field('year_from', 'Год с *', record.year_from, 'number')}
            ${field('year_to', 'Год по', record.year_to, 'number')}
            ${field('kw', 'кВт', record.kw, 'number')}
            ${field('bhp', 'л.с.', record.bhp, 'number')}
            <label class="edit-field">
                <span>Топливо</span>
                <select data-edit="fuel_type" data-initial="${esc(currentFuelCode(record.fuel_type))}">${fuelSelectOptions(record.fuel_type)}</select>
            </label>
        </div>`;
}

// ── Вкладка «Агрегаты и объёмы» ───────────────────────────────────────────────
// У каждого агрегата одинаковый набор: название, объём, допуска. У ДВС допуска
// общие для машины (колонка car_approvals), у остальных свои
// (fluid_capacities[key].motulProducts) — но в форме это одно и то же поле,
// чтобы не искать допуска мотора в другом месте.

function paneAggs(record) {
    const fc = record.fluid_capacities || {};
    const approvals = Array.isArray(record.car_approvals) ? record.car_approvals : [];

    const rows = stdAggs(fc).map(({ key, def }) => {
        const a = fc[key];
        const isEngine = key === 'engine';
        // Агрегата нет в данных — рисуем только ДВС (без него негде править
        // допуска мотора), остальные не выдумываем.
        if (!a && !isEngine) return '';
        const vol = isEngine
            ? (a?.volumeService || a?.volumeTotal || a?.volumePlain || '')
            : (a.volumeTotal || a.volumeService || a.volumePlain || '');
        const appr = isEngine
            ? approvals
            : (Array.isArray(a.motulProducts) ? a.motulProducts : []);
        const apprAttr = isEngine
            ? 'data-edit-approvals="engine"'
            : `data-edit-agg-appr="${key}"`;
        const apprHint = isEngine
            ? 'допуска мотора — по одному в строке (напр. VW 504 00, MB 229.51, ACEA C3)'
            : 'допуска — по одному в строке (напр. NS-3, DEXRON VI, Motul MOTYLGEAR 75W-90)';
        return `
            <div class="edit-std-agg">
                <div class="edit-agg-row">
                    <input type="text" class="edit-agg-name" data-edit-agg-label="${key}"
                        value="${esc(a?.label || '')}" placeholder="${esc(def)}"
                        title="название агрегата — пусто значит стандартное"/>
                    <input type="text" inputmode="decimal" autocomplete="off" data-edit-vol="${key}"
                        value="${esc(vol)}" data-initial="${esc(vol)}" style="width:90px" title="объём заправки, л"/>
                    <span class="edit-agg-unit">л</span>
                </div>
                <textarea ${apprAttr} rows="2" placeholder="${esc(apprHint)}">${esc(appr.join('\n'))}</textarea>
            </div>`;
    }).join('');

    return `
        <div class="edit-sec-h">Штатные агрегаты</div>
        <div class="edit-oils-note">Пустое название = стандартное. Объём — сколько заливаем, л.
            У ДВС допуска общие для машины: именно по ним калькулятор подбирает моторное масло.</div>
        ${rows}

        <div class="edit-sec-h">Дополнительные агрегаты</div>
        <div class="edit-oils-note">Свои агрегаты сверх основных: хоть 5 вариаторов, мостов,
            редукторов или раздаток. У каждого — название, объём и свои допуска.</div>
        <div id="edit-custom-aggs"></div>
        <button class="btn btn-sec btn-mini" id="btn-add-custom-agg" type="button" style="margin-top:6px">Добавить агрегат</button>`;
}

// ── Вкладка «Фильтры ДВС» ─────────────────────────────────────────────────────
// Подписи сверены с CLAUDE.md: vf — ВОЗДУШНЫЙ (MANN C…), mf — МАСЛЯНЫЙ (W…,
// HU…), sf — салонный (CU…). В старой форме они стояли наоборот, и оператор
// получал воздушный фильтр под видом масляного.

const FILTER_ROWS = [
    { key: 'vf', label: 'вф — воздушный', hint: 'MANN C…' },
    { key: 'mf', label: 'мф — масляный',  hint: 'MANN W…, HU…' },
    { key: 'sf', label: 'сф — салонный',  hint: 'MANN CU…, CUK…, FP…' },
];

function paneFilters(record) {
    const fpn = record.filter_part_numbers || {};
    return FILTER_ROWS.map(({ key, label, hint }) => {
        const e = fpn[key] || {};
        return `
            <div class="edit-filter-row">
                <span class="edit-lbl">${esc(label)}</span>
                <input type="text" data-edit-filter="${key}"
                    value="${esc(e.absent ? '' : (e.part || ''))}"
                    placeholder="артикул (${esc(hint)})" ${e.absent ? 'disabled' : ''}/>
                <label class="chk-label"><input type="checkbox" data-edit-filter-absent="${key}" ${e.absent ? 'checked' : ''}/> отсутствует</label>
            </div>`;
    }).join('');
}

// ── Вкладка «Особенности обслуживания» ────────────────────────────────────────

function paneFlags(record) {
    const flags = record.service_flags || {};
    return Object.entries(SERVICE_FLAGS).map(([key, def]) => `
        <label class="chk-label edit-flag"><input type="checkbox" data-edit-flag="${key}" ${flags[key] ? 'checked' : ''}/> ${esc(def.label)}</label>
    `).join('');
}

// ── Вкладка «Ссылки на источники» ─────────────────────────────────────────────

function paneLinks(record) {
    const links = record.source_links || {};
    return `<div class="edit-grid">${SOURCE_SITES.map(site => `
        <label class="edit-field">
            <span>${esc(SOURCE_LABELS[site])}</span>
            <input type="url" data-edit-source="${site}" value="${esc(links[site] || '')}" placeholder="ссылка на страницу машины"/>
        </label>`).join('')}</div>`;
}

// ── Вкладка «Теги и заметка» ──────────────────────────────────────────────────

function paneMeta(record) {
    return `
        <div class="edit-sec-h">Теги для поиска</div>
        <div class="edit-oils-note">Слова, по которым эту машину можно найти (напр. «табуретка»,
            «малолитражка»). Введите тег и нажмите «Добавить» — потом можно удалить крестиком.</div>
        <div class="edit-tags-input">
            <input type="text" id="edit-tag-input" placeholder="новый тег" autocomplete="off"/>
            <button class="btn btn-sec btn-mini" id="btn-add-tag" type="button">Добавить</button>
        </div>
        <div id="edit-tags-list" class="edit-tags-list"></div>

        <div class="edit-sec-h">Заметка</div>
        <div class="edit-oils-note">Показывается в шапке машины отдельной секцией.</div>
        <textarea id="edit-notes" rows="3">${esc(record.notes || '')}</textarea>`;
}

// ── Вкладки: переключение ─────────────────────────────────────────────────────

function bindTabs(win, state) {
    win.querySelectorAll('[data-ed-tab]').forEach(btn => {
        btn.onclick = () => {
            state.tab = btn.dataset.edTab;
            win.querySelectorAll('[data-ed-tab]').forEach(b =>
                b.classList.toggle('active', b.dataset.edTab === state.tab));
            win.querySelectorAll('[data-ed-pane]').forEach(p =>
                p.classList.toggle('hidden', p.dataset.edPane !== state.tab));
            const pane = win.querySelector(`[data-ed-pane="${state.tab}"]`);
            if (pane) pane.scrollTop = 0;
        };
    });
}

// ── Дополнительные агрегаты ───────────────────────────────────────────────────

function customAggsFromRecord(record) {
    const list = Array.isArray(record.fluid_capacities?.custom) ? record.fluid_capacities.custom : [];
    return list.map(c => ({
        key: c.key || newAggKey(),
        label: c.label || '',
        type: c.group === 'auto' ? (c.isCvt ? 'cvt' : 'auto') : 'gear',
        volume: c.volumeTotal || c.volumeService || c.volumePlain || '',
        approvals: Array.isArray(c.motulProducts) ? c.motulProducts.join('\n') : '',
    }));
}

function newAggKey() {
    return 'custom_' + Math.random().toString(36).slice(2, 9);
}

function renderCustomAggs(win, customAggs) {
    const box = win.querySelector('#edit-custom-aggs');
    if (!box) return;
    box.innerHTML = customAggs.length
        ? customAggs.map((c, i) => {
            const typeOpts = CUSTOM_AGG_TYPES.map(t =>
                `<option value="${t.v}" ${c.type === t.v ? 'selected' : ''}>${t.l}</option>`).join('');
            return `
                <div class="edit-custom-agg" data-cagg-idx="${i}">
                    <div class="edit-custom-agg-head">
                        <input type="text" data-cagg="label" value="${esc(c.label)}" placeholder="Название (напр. «Вариатор 2», «Задний мост»)"/>
                        <button class="btn-reset-vol" data-cagg-del="${i}" type="button" title="удалить агрегат">✕</button>
                    </div>
                    <div class="edit-custom-agg-row">
                        <select data-cagg="type">${typeOpts}</select>
                        <input type="text" inputmode="decimal" autocomplete="off" data-cagg="volume" value="${esc(c.volume)}" placeholder="объём, л" style="width:110px"/>
                        <span class="edit-agg-unit">л</span>
                    </div>
                    <textarea data-cagg="approvals" rows="2" placeholder="допуска — по одному в строке (напр. NS-3, Motul CVTF)">${esc(c.approvals)}</textarea>
                </div>`;
        }).join('')
        : '<div class="edit-oils-note" style="opacity:.7">Пока нет — нажми «Добавить агрегат».</div>';

    box.querySelectorAll('[data-cagg]').forEach(el => {
        const idx = parseInt(el.closest('[data-cagg-idx]').dataset.caggIdx, 10);
        const fieldName = el.dataset.cagg;
        const handler = () => { customAggs[idx][fieldName] = el.value; };
        el.oninput = handler;
        el.onchange = handler;
    });
    box.querySelectorAll('[data-cagg-del]').forEach(btn => {
        btn.onclick = () => {
            customAggs.splice(parseInt(btn.dataset.caggDel, 10), 1);
            renderCustomAggs(win, customAggs);
            win.dispatchEvent(new Event('change', { bubbles: true }));
        };
    });
}

function bindCustomAggs(win, state) {
    renderCustomAggs(win, state.customAggs);
    const addBtn = win.querySelector('#btn-add-custom-agg');
    if (addBtn) addBtn.onclick = () => {
        state.customAggs.push({ key: newAggKey(), label: '', type: 'gear', volume: '', approvals: '' });
        renderCustomAggs(win, state.customAggs);
    };
}

// ── Теги ──────────────────────────────────────────────────────────────────────

function renderTags(win, tags) {
    const box = win.querySelector('#edit-tags-list');
    if (!box) return;
    box.innerHTML = tags.length
        ? tags.map((t, i) =>
            `<span class="edit-tag" data-tag-idx="${i}">${esc(t)}<button class="edit-tag-del" data-tag-del="${i}" type="button" title="удалить тег">✕</button></span>`).join('')
        : '<div class="edit-oils-note" style="opacity:.7">Пока нет тегов.</div>';

    box.querySelectorAll('[data-tag-del]').forEach(btn => {
        btn.onclick = () => {
            tags.splice(parseInt(btn.dataset.tagDel, 10), 1);
            renderTags(win, tags);
            win.dispatchEvent(new Event('change', { bubbles: true }));
        };
    });
}

function bindTags(win, state) {
    renderTags(win, state.tags);
    const input = win.querySelector('#edit-tag-input');
    const addBtn = win.querySelector('#btn-add-tag');
    if (!input || !addBtn) return;
    const add = () => {
        const v = input.value.trim();
        if (v && !state.tags.some(t => t.toLowerCase() === v.toLowerCase())) state.tags.push(v);
        input.value = '';
        input.focus();
        renderTags(win, state.tags);
        win.dispatchEvent(new Event('change', { bubbles: true }));
    };
    addBtn.onclick = add;
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); add(); }
    });
}

// ── Фильтры: «отсутствует» гасит поле артикула ────────────────────────────────

function bindFilterAbsent(win) {
    win.querySelectorAll('[data-edit-filter-absent]').forEach(chk => {
        chk.onchange = () => {
            const inp = win.querySelector(`[data-edit-filter="${chk.dataset.editFilterAbsent}"]`);
            inp.disabled = chk.checked;
            if (chk.checked) inp.value = '';
        };
    });
}

// ── Сбор значений формы ───────────────────────────────────────────────────────

// Поле не трогали: текущее значение совпадает с тем, что нарисовали.
function unchanged(el) {
    const initial = el.dataset.initial;
    if (initial === undefined) return false;
    const a = parseDecimal(initial), b = parseDecimal(el.value);
    if (isFinite(a) && isFinite(b)) return a === b;
    return String(initial).trim() === String(el.value).trim();
}

function fuelTouched(win) {
    const sel = win.querySelector('[data-edit="fuel_type"]');
    return !!sel && sel.value !== sel.dataset.initial;
}

// Какой пункт списка топлива соответствует значению из базы (может не быть
// ни одного — тогда пусто, «не указано»).
function currentFuelCode(fuelType) {
    return normalizeFuelCode(fuelType);
}

// «4,5» → 4.5: на русской раскладке дробную часть чаще отбивают запятой.
function parseDecimal(str) {
    return parseFloat(String(str == null ? '' : str).replace(',', '.'));
}

function linesOf(el) {
    return String(el ? el.value : '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

// Полный набор редактируемых полей в том виде, в каком их принимает API.
// Что из него реально уйдёт в PATCH — решает changedCarFields() (shared/carPatch.js).
function collectPatch(win, record, state) {
    const val = (k) => {
        const el = win.querySelector(`[data-edit="${k}"]`);
        return el ? el.value.trim() : '';
    };
    const num = (k) => { const v = parseDecimal(val(k)); return isFinite(v) ? v : null; };
    const int = (k) => { const v = parseInt(val(k)); return isFinite(v) ? v : null; };

    const filters = {};
    for (const { key } of FILTER_ROWS) {
        const absent = win.querySelector(`[data-edit-filter-absent="${key}"]`).checked;
        const part = win.querySelector(`[data-edit-filter="${key}"]`).value.trim();
        filters[key] = absent ? { part: null, absent: true } : { part, absent: false };
    }

    const flags = {};
    win.querySelectorAll('[data-edit-flag]').forEach(chk => {
        if (chk.checked) flags[chk.dataset.editFlag] = true;
    });

    // Объёмы и названия — поверх текущих fluid_capacities, чтобы не потерять
    // поля, которых нет в форме (isCvt, isDct, volumePlain и прочее из импорта).
    const fluid = JSON.parse(JSON.stringify(record.fluid_capacities || {}));
    win.querySelectorAll('[data-edit-vol]').forEach(inp => {
        const key = inp.dataset.editVol;
        const v = parseDecimal(inp.value);
        if (!isFinite(v) || v <= 0) return;
        // Объём не трогали — не переписываем. Иначе у агрегата, где импорт дал
        // только volumeService, рядом появлялся ещё и volumeTotal с тем же
        // числом, и машина «менялась» от одного открытия окна.
        if (unchanged(inp)) return;
        // Мотор мог прийти из импорта без объёма вообще — тогда заводим запись,
        // иначе введённый объём молча пропадал.
        if (!fluid[key]) {
            if (key !== 'engine') return;
            fluid.engine = {};
        }
        if (key === 'engine') fluid.engine.volumeService = v;
        else fluid[key].volumeTotal = v;
    });

    win.querySelectorAll('[data-edit-agg-label]').forEach(inp => {
        const key = inp.dataset.editAggLabel;
        if (!fluid[key]) return;
        const name = inp.value.trim();
        if (name) fluid[key].label = name;
        else delete fluid[key].label;
    });

    // Допуска штатных агрегатов (кроме ДВС — у него car_approvals).
    // Пусто = допуска неизвестны.
    win.querySelectorAll('[data-edit-agg-appr]').forEach(ta => {
        const key = ta.dataset.editAggAppr;
        if (!fluid[key]) return;
        const list = linesOf(ta);
        if (list.length) fluid[key].motulProducts = list;
        else delete fluid[key].motulProducts;
    });

    const custom = state.customAggs.map(c => {
        const vol = parseDecimal(c.volume);
        return {
            key: c.key || newAggKey(),
            label: String(c.label || '').trim(),
            group: c.type === 'gear' ? 'gear' : 'auto',
            isCvt: c.type === 'cvt',
            volumeTotal: isFinite(vol) && vol > 0 ? vol : null,
            motulProducts: String(c.approvals || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean),
        };
    }).filter(c => c.label || c.volumeTotal || c.motulProducts.length);
    // Пустой список своих агрегатов не заводим отдельным ключом: иначе машина
    // «меняется» при каждом открытии окна, и метка «изменено» врёт.
    if (custom.length) fluid.custom = custom;
    else delete fluid.custom;

    const sourceLinks = {};
    win.querySelectorAll('[data-edit-source]').forEach(inp => {
        const url = inp.value.trim();
        if (url) sourceLinks[inp.dataset.editSource] = url;
    });
    const cleanedLinks = cleanSourceLinks(sourceLinks);

    return {
        brand: val('brand'), model: val('model'),
        generation: val('generation') || null,
        engine_name: val('engine_name') || null,
        engine_code: val('engine_code') || null,
        engine_volume: num('engine_volume'),
        year_from: int('year_from'), year_to: int('year_to'),
        kw: int('kw'), bhp: int('bhp'),
        // Топливо: если в базе лежит код, которого нет в списке (старые записи),
        // список показывает «не указано» — молча стереть чужое значение нельзя.
        fuel_type: fuelTouched(win) ? (val('fuel_type') || null) : (record.fuel_type ?? null),
        fluid_capacities: fluid,
        filter_part_numbers: filters,
        car_approvals: linesOf(win.querySelector('[data-edit-approvals="engine"]')),
        service_flags: flags,
        source_links: cleanedLinks,
        tags: state.tags.map(t => t.trim()).filter(Boolean),
        notes: win.querySelector('#edit-notes').value.trim() || null,
    };
}

// ── Что именно изменилось ─────────────────────────────────────────────────────

// Метки «изменено» у вкладок + сводка внизу окна.
function refreshDirty(win, record, state) {
    let changed;
    try {
        changed = changedCarFields(record, collectPatch(win, record, state));
    } catch {
        return; // форма ещё дорисовывается — пересчитаем на следующем вводе
    }
    const dirtyTabs = new Set();
    for (const key of Object.keys(changed)) {
        const tab = FIELD_TAB[key];
        if (tab) dirtyTabs.add(tab);
    }
    win.querySelectorAll('[data-ed-mark]').forEach(mark => {
        const on = dirtyTabs.has(mark.dataset.edMark);
        mark.textContent = on ? 'изменено' : '';
        mark.classList.toggle('on', on);
    });
    const status = win.querySelector('#car-ed-status');
    if (status) {
        status.textContent = dirtyTabs.size
            ? `изменений: ${Object.keys(changed).length}`
            : 'изменений нет';
    }
    return changed;
}

// ── Сохранение ────────────────────────────────────────────────────────────────

function bindSave(win, record, ctx, state, close) {
    const btn = win.querySelector('#car-ed-save');
    const errBox = win.querySelector('#car-ed-error');

    const fail = (msg, tab) => {
        errBox.textContent = msg;
        errBox.classList.remove('hidden');
        if (tab) {
            const tabBtn = win.querySelector(`[data-ed-tab="${tab}"]`);
            if (tabBtn) tabBtn.click();
        }
    };

    btn.onclick = async () => {
        errBox.classList.add('hidden');
        const patch = collectPatch(win, record, state);

        if (!patch.brand || !patch.model) {
            return fail('Марка и модель — обязательные поля.', 'car');
        }
        if (!patch.year_from) {
            return fail('Год начала выпуска — обязательное поле.', 'car');
        }

        // Уходит только то, что реально изменили: правка заметки не
        // перезаписывает объёмы, которые в это же время правит коллега.
        const changed = changedCarFields(record, patch);
        if (!Object.keys(changed).length) {
            return fail('Ничего не изменилось — сохранять нечего.');
        }
        // source_keys не правятся руками — это производное от ссылок. Считаем
        // их только когда ссылки изменились, иначе нотификатор искал бы машину
        // по устаревшим ключам. В сравнении «изменено» они не участвуют: импорт
        // копит их объединением, и порядок в базе не совпадает с пересчётом.
        if (changed.source_links) changed.source_keys = buildSourceKeys(patch.source_links);

        const comment = win.querySelector('#car-ed-comment').value.trim() || null;

        btn.disabled = true;
        btn.textContent = 'сохранение…';
        try {
            await ctx.apiFetch('/api/cars/' + record.id, {
                method: 'PATCH',
                body: { ...changed, comment },
            });
            close();
            checkAchievementsNow(); // правка могла добить счётчик до ачивки
            ctx.onChanged();        // перезагрузит страницу машины со свежими данными
        } catch (e) {
            btn.disabled = false;
            btn.textContent = 'Сохранить';
            fail(e.message);
        }
    };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
