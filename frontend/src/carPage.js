// ─────────────────────────────────────────────────────────────────────────────
// Страница машины: шапка с данными, плашки сервис-флагов, заметка,
// режим «Нашли ошибку?» (правка ВСЕГО, включая список предлагаемых масел),
// ниже — живой калькулятор (initCalculator).
// ─────────────────────────────────────────────────────────────────────────────

import { initCalculator } from './calculator.js';
import { activeFlags, SERVICE_FLAGS } from '../../shared/serviceFlags.js';
import { getShopOils } from '../../shared/oils.js';
import { fuelLabel, fuelSelectOptions } from '../../shared/fuel.js';
import {
    SOURCE_SITES, SOURCE_LABELS, buildSourceKeys, cleanSourceLinks,
} from '../../shared/sourceLinks.js';

let editMode = false;

export function initCarPage(record, { apiFetch, onChanged, user }) {
    editMode = false;
    renderHead(record, { apiFetch, onChanged, user });
    initCalculator(record);
    renderEvents(record.id, { apiFetch, user });
}

// ── Шапка ─────────────────────────────────────────────────────────────────────

function renderHead(record, ctx) {
    const head = document.getElementById('car-head');
    if (!head) return;
    head.innerHTML = editMode ? renderEditForm(record) : renderView(record, ctx);
    if (editMode) bindEditForm(head, record, ctx);
    else bindView(head, record, ctx);

    const title = document.getElementById('calc-car-title');
    if (title) title.textContent = [record.brand, record.model].filter(Boolean).join(' ');
}

function renderView(record, ctx) {
    const isMod = ctx?.user?.role === 'mod' || ctx?.user?.role === 'admin';
    const years = record.year_from
        ? record.year_from + (record.year_to ? `–${record.year_to}` : '+')
        : '';
    const fuel = fuelLabel(record.fuel_type);
    const chips = [
        record.engine_name && `⚙ ${esc(record.engine_name)}`,
        record.engine_code && `<span class="mono">${esc(record.engine_code)}</span>`,
        record.engine_volume && `${record.engine_volume} л`,
        (record.bhp || record.kw) && (record.bhp ? `${record.bhp} л.с.` : `${record.kw} кВт`),
        fuel,
        years && `📅 ${years}`,
    ].filter(Boolean).map(c => `<span class="head-chip">${c}</span>`).join('');

    const flags = activeFlags(record.service_flags);
    const flagsHtml = flags.length
        ? `<div class="head-flags">${flags.map(f =>
            `<span class="head-flag${f.warn ? ' head-flag-warn' : ''}">⚠ ${esc(f.label)}</span>`).join('')}</div>`
        : '';

    const notesHtml = record.notes
        ? `<div class="head-notes">📝 ${esc(record.notes)}</div>`
        : '';

    const tags = Array.isArray(record.tags) ? record.tags : [];
    const tagsHtml = tags.length
        ? `<div class="head-tags">${tags.map(t =>
            `<span class="head-tag">🏷 ${esc(t)}</span>`).join('')}</div>`
        : '';

    const links = record.source_links || {};
    const srcBtns = SOURCE_SITES.filter(s => links[s]).map(s =>
        `<a class="src-btn src-btn-${s}" href="${esc(links[s])}" target="_blank" rel="noopener">${esc(SOURCE_LABELS[s])} ↗</a>`).join('');
    const sourcesHtml = srcBtns
        ? `<div class="head-sources"><span class="head-sources-lbl">Страницы машины:</span>${srcBtns}</div>`
        : '';

    const rec = Array.isArray(record.recommended_oils) ? record.recommended_oils : [];
    const recHtml = rec.length ? `
        <details class="head-rec">
            <summary>Что рекомендовали при сохранении (${rec.length})</summary>
            <div class="head-rec-list">
                ${rec.map(o => `<span class="head-chip">${esc(o.b)} ${esc(o.n)} — ${o.price}₽/л</span>`).join('')}
            </div>
            <div class="head-rec-note">Список ниже пересчитан по актуальному каталогу и ценам — это только история.</div>
        </details>` : '';

    return `
        <div class="head-card">
            <div class="head-title-row">
                <h2 class="head-title">${esc(record.brand)} ${esc(record.model)}${record.generation ? ` <span class="head-gen">${esc(record.generation)}</span>` : ''}</h2>
                <span style="display:flex;gap:8px">
                    <button class="btn btn-sec" id="btn-edit-car">✏ Нашли ошибку?</button>
                    ${isMod ? '<button class="btn btn-sec btn-danger" id="btn-delete-car">🗑 Удалить машину</button>' : ''}
                </span>
            </div>
            <div class="head-chips">${chips}</div>
            ${sourcesHtml}
            ${flagsHtml}
            ${notesHtml}
            ${tagsHtml}
            ${recHtml}
        </div>
    `;
}

function bindView(head, record, ctx) {
    const btn = head.querySelector('#btn-edit-car');
    if (btn) btn.onclick = () => { editMode = true; renderHead(record, ctx); };

    const delBtn = head.querySelector('#btn-delete-car');
    if (delBtn) delBtn.onclick = () => confirmDeleteCar(record, ctx);
}

// ── Удаление машины (модератор) ────────────────────────────────────────────────

function confirmDeleteCar(record, ctx) {
    const old = document.getElementById('confirm-delete-modal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'confirm-delete-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-backdrop"></div>
        <div class="modal-win modal-win-sm">
            <div class="modal-head">
                <span>⚠ Удалить машину</span>
                <button class="btn btn-sec" id="confirm-delete-close">✕</button>
            </div>
            <div class="modal-body">
                <p>Машина «${esc(record.brand)} ${esc(record.model)}» будет удалена
                   <b>полностью и безвозвратно</b>, вместе со всей историей изменений.</p>
                <div id="confirm-delete-error" class="edit-error hidden"></div>
                <div class="modal-actions">
                    <button class="btn btn-sec" id="confirm-delete-cancel">Отмена</button>
                    <button class="btn btn-danger" id="confirm-delete-yes">Удалить безвозвратно</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('.modal-backdrop').onclick = close;
    modal.querySelector('#confirm-delete-close').onclick = close;
    modal.querySelector('#confirm-delete-cancel').onclick = close;

    modal.querySelector('#confirm-delete-yes').onclick = async () => {
        const btn = modal.querySelector('#confirm-delete-yes');
        const errBox = modal.querySelector('#confirm-delete-error');
        btn.disabled = true;
        btn.textContent = 'Удаление…';
        try {
            await ctx.apiFetch('/api/cars/' + record.id, { method: 'DELETE' });
            close();
            location.hash = '#/';
        } catch (e) {
            errBox.textContent = '⚠ ' + e.message;
            errBox.classList.remove('hidden');
            btn.disabled = false;
            btn.textContent = 'Удалить безвозвратно';
        }
    };
}

// ── Режим правки ──────────────────────────────────────────────────────────────

function renderEditForm(record) {
    const f = (key, label, value, type = 'text') => `
        <label class="edit-field">
            <span>${label}</span>
            <input type="${type}" ${type === 'number' ? 'step="any"' : ''} data-edit="${key}" value="${esc(value == null ? '' : String(value))}"/>
        </label>`;

    const fpn = record.filter_part_numbers || {};
    const filterRow = (key, label) => {
        const e = fpn[key] || {};
        return `
            <div class="edit-filter-row">
                <span class="edit-lbl">${label}</span>
                <input type="text" data-edit-filter="${key}" value="${esc(e.absent ? '' : (e.part || ''))}" placeholder="артикул" ${e.absent ? 'disabled' : ''}/>
                <label class="chk-label"><input type="checkbox" data-edit-filter-absent="${key}" ${e.absent ? 'checked' : ''}/> отсутствует</label>
            </div>`;
    };

    const flags = record.service_flags || {};
    const flagRows = Object.entries(SERVICE_FLAGS).map(([key, def]) => `
        <label class="chk-label edit-flag"><input type="checkbox" data-edit-flag="${key}" ${flags[key] ? 'checked' : ''}/> ${esc(def.label)}</label>
    `).join('');

    // объёмы жидкостей + переименование штатных агрегатов
    const fc = record.fluid_capacities || {};
    const volRow = (key, defName) => {
        const a = fc[key];
        if (!a) return '';
        const vol = key === 'engine'
            ? (a.volumeService || a.volumeTotal || a.volumePlain || '')
            : (a.volumeTotal || a.volumeService || a.volumePlain || '');
        return `
            <div class="edit-agg-row">
                <input type="text" class="edit-agg-name" data-edit-agg-label="${key}" value="${esc(a.label || '')}" placeholder="${esc(defName)}" title="название агрегата — можно переименовать"/>
                <input type="number" step="0.1" min="0" data-edit-vol="${key}" value="${vol}" style="width:90px" title="объём, л"/>
                <span style="color:var(--sub);font-size:12px">л</span>
            </div>`;
    };
    const volRows = [
        volRow('engine', 'ДВС (двигатель)'),
        volRow('automatic', fc.automatic?.isCvt ? 'Вариатор (CVT)' : 'АКПП'),
        volRow('manual', 'МКПП'), volRow('transfer', 'Раздаточная коробка'),
        volRow('diffFront', 'Дифференциал (перед)'), volRow('diffRear', 'Дифференциал (зад)'),
    ].filter(Boolean).join('');

    // список масел: чем предлагать (не-SPOT; SPOT идёт по регламенту всегда)
    const ov = record.oil_overrides || {};
    const excluded = new Set(Array.isArray(ov.exclude) ? ov.exclude : []);
    const byVisc = {};
    for (const o of getShopOils()) {
        if (o.isSpot) continue;
        (byVisc[o.v] = byVisc[o.v] || []).push(o);
    }
    const oilRows = Object.entries(byVisc).map(([v, oils]) => `
        <div class="edit-oils-visc">
            <div class="edit-oils-visc-h">${esc(v)}</div>
            ${oils.map(o => {
                const key = o.b + '_' + o.n;
                return `<label class="chk-label edit-oil"><input type="checkbox" data-edit-oil="${esc(key)}" ${excluded.has(key) ? '' : 'checked'}/> ${esc(o.b)} ${esc(o.n)} <span style="color:var(--sub)">${o.price}₽/л</span></label>`;
            }).join('')}
        </div>`).join('');

    const approvals = Array.isArray(record.car_approvals) ? record.car_approvals : [];

    const links = record.source_links || {};
    const sourceRows = SOURCE_SITES.map(site => `
        <label class="edit-field">
            <span>${esc(SOURCE_LABELS[site])}</span>
            <input type="url" data-edit-source="${site}" value="${esc(links[site] || '')}" placeholder="ссылка на страницу машины"/>
        </label>`).join('');

    return `
        <div class="head-card head-card-edit">
            <div class="head-title-row">
                <h2 class="head-title">✏ Редактирование машины</h2>
                <span style="display:flex;gap:8px">
                    <button class="btn btn-sec" id="btn-edit-cancel">Отмена</button>
                    <button class="btn btn-pri" id="btn-edit-save">💾 Сохранить</button>
                </span>
            </div>

            <div class="edit-sec-h">Машина</div>
            <div class="edit-grid">
                ${f('brand', 'Марка *', record.brand)}
                ${f('model', 'Модель *', record.model)}
                ${f('generation', 'Поколение', record.generation)}
                ${f('engine_name', 'Двигатель', record.engine_name)}
                ${f('engine_code', 'Код двигателя', record.engine_code)}
                ${f('engine_volume', 'Объём, л', record.engine_volume, 'number')}
                ${f('year_from', 'Год с *', record.year_from, 'number')}
                ${f('year_to', 'Год по', record.year_to, 'number')}
                ${f('kw', 'кВт', record.kw, 'number')}
                ${f('bhp', 'л.с.', record.bhp, 'number')}
                <label class="edit-field">
                    <span>Топливо</span>
                    <select data-edit="fuel_type">${fuelSelectOptions(record.fuel_type)}</select>
                </label>
            </div>

            ${volRows ? `<div class="edit-sec-h">Агрегаты: название и объём</div><div class="edit-oils-note">Левое поле — название (можно переименовать, пусто = стандартное), правое — объём заправки, л.</div>${volRows}` : ''}

            <div class="edit-sec-h">Дополнительные агрегаты</div>
            <div class="edit-oils-note">Свои агрегаты сверх основных: хоть 5 вариаторов, мостов, редукторов или раздаток. У каждого — название, объём и свои допуска (по одному в строке).</div>
            <div id="edit-custom-aggs"></div>
            <button class="btn btn-sec btn-mini" id="btn-add-custom-agg" style="margin-top:6px">➕ Добавить агрегат</button>

            <div class="edit-sec-h">Допуски масла — по одному в строке</div>
            <textarea id="edit-approvals" rows="4">${esc(approvals.join('\n'))}</textarea>

            <div class="edit-sec-h">Фильтры ДВС</div>
            ${filterRow('vf', 'вф (масляный)')}
            ${filterRow('mf', 'мф (воздушный)')}
            ${filterRow('sf', 'сф (салонный)')}

            <div class="edit-sec-h">Особенности обслуживания</div>
            ${flagRows}

            <div class="edit-sec-h">Какие масла предлагать этой машине</div>
            <div class="edit-oils-note">Снятая галочка убирает масло из предложений на этой странице. Масла SPOT идут по регламенту всегда.</div>
            ${oilRows}

            <div class="edit-sec-h">Страницы машины (сурс-ссылки)</div>
            <div class="edit-oils-note">Кнопки на странице машины. По ним же нотификатор находит эту машину у коллег на сайтах подбора.</div>
            <div class="edit-grid">${sourceRows}</div>

            <div class="edit-sec-h">Теги</div>
            <div class="edit-oils-note">Слова, по которым эту машину можно найти в поиске (напр. «табуретка», «малолитражка»). Введите тег и нажмите «Добавить» — потом можно удалить крестиком.</div>
            <div class="edit-tags-input">
                <input type="text" id="edit-tag-input" placeholder="новый тег" autocomplete="off"/>
                <button class="btn btn-sec btn-mini" id="btn-add-tag" type="button">➕ Добавить</button>
            </div>
            <div id="edit-tags-list" class="edit-tags-list"></div>

            <div class="edit-sec-h">Заметка</div>
            <textarea id="edit-notes" rows="2">${esc(record.notes || '')}</textarea>

            <div id="edit-error" class="edit-error" style="display:none"></div>
        </div>
    `;
}

// Рабочее состояние формы для секций с добавлением/удалением строк, которые
// нельзя восстановить из DOM при пересборке (пользовательские агрегаты).
const CUSTOM_AGG_TYPES = [
    { v: 'cvt',  l: 'Вариатор (CVT)' },
    { v: 'auto', l: 'АКПП' },
    { v: 'gear', l: 'Мост / редуктор / раздатка / МКПП' },
];

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

function renderCustomAggRow(c, i) {
    const typeOpts = CUSTOM_AGG_TYPES.map(t =>
        `<option value="${t.v}" ${c.type === t.v ? 'selected' : ''}>${t.l}</option>`).join('');
    return `
        <div class="edit-custom-agg" data-cagg-idx="${i}">
            <div class="edit-custom-agg-head">
                <input type="text" data-cagg="label" value="${esc(c.label)}" placeholder="Название (напр. «Вариатор 2», «Задний мост»)"/>
                <button class="btn-reset-vol" data-cagg-del="${i}" title="удалить агрегат">✕</button>
            </div>
            <div class="edit-custom-agg-row">
                <select data-cagg="type">${typeOpts}</select>
                <input type="number" step="0.1" min="0" data-cagg="volume" value="${esc(c.volume)}" placeholder="объём, л" style="width:110px"/>
                <span style="color:var(--sub);font-size:12px">л</span>
            </div>
            <textarea data-cagg="approvals" rows="2" placeholder="допуска — по одному в строке (напр. NS-3, Motul CVTF)">${esc(c.approvals)}</textarea>
        </div>`;
}

function renderCustomAggs(head, customAggs) {
    const box = head.querySelector('#edit-custom-aggs');
    if (!box) return;
    box.innerHTML = customAggs.length
        ? customAggs.map((c, i) => renderCustomAggRow(c, i)).join('')
        : '<div class="edit-oils-note" style="opacity:.7">Пока нет — нажми «Добавить агрегат».</div>';

    box.querySelectorAll('[data-cagg]').forEach(el => {
        const idx = parseInt(el.closest('[data-cagg-idx]').dataset.caggIdx, 10);
        const field = el.dataset.cagg;
        const handler = () => { customAggs[idx][field] = el.value; };
        el.oninput = handler;
        el.onchange = handler;
    });
    box.querySelectorAll('[data-cagg-del]').forEach(btn => {
        btn.onclick = () => {
            customAggs.splice(parseInt(btn.dataset.caggDel, 10), 1);
            renderCustomAggs(head, customAggs);
        };
    });
}

// Теги: рабочий массив (как customAggs) + перерисовка списка-чипсов.
// Ютуб-стиль — ввёл слово, «Добавить» → чип в списке, крестик → удалить.
function renderTags(head, tags) {
    const box = head.querySelector('#edit-tags-list');
    if (!box) return;
    box.innerHTML = tags.length
        ? tags.map((t, i) =>
            `<span class="edit-tag" data-tag-idx="${i}">${esc(t)}<button class="edit-tag-del" data-tag-del="${i}" type="button" title="удалить тег">✕</button></span>`).join('')
        : '<div class="edit-oils-note" style="opacity:.7">Пока нет тегов.</div>';

    box.querySelectorAll('[data-tag-del]').forEach(btn => {
        btn.onclick = () => {
            tags.splice(parseInt(btn.dataset.tagDel, 10), 1);
            renderTags(head, tags);
        };
    });
}

function bindEditForm(head, record, ctx) {
    const customAggs = customAggsFromRecord(record);
    renderCustomAggs(head, customAggs);

    // Теги
    const tags = Array.isArray(record.tags) ? record.tags.map(String) : [];
    renderTags(head, tags);
    const tagInput = head.querySelector('#edit-tag-input');
    const addTag = () => {
        const v = tagInput.value.trim();
        if (v && !tags.some(t => t.toLowerCase() === v.toLowerCase())) tags.push(v);
        tagInput.value = '';
        tagInput.focus();
        renderTags(head, tags);
    };
    head.querySelector('#btn-add-tag').onclick = addTag;
    tagInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addTag(); }
    });
    head.querySelector('#btn-add-custom-agg').onclick = () => {
        customAggs.push({ key: newAggKey(), label: '', type: 'gear', volume: '', approvals: '' });
        renderCustomAggs(head, customAggs);
    };

    head.querySelector('#btn-edit-cancel').onclick = () => {
        editMode = false;
        renderHead(record, ctx);
    };

    head.querySelectorAll('[data-edit-filter-absent]').forEach(chk => {
        chk.onchange = () => {
            const inp = head.querySelector(`[data-edit-filter="${chk.dataset.editFilterAbsent}"]`);
            inp.disabled = chk.checked;
            if (chk.checked) inp.value = '';
        };
    });

    head.querySelector('#btn-edit-save').onclick = async () => {
        const btn = head.querySelector('#btn-edit-save');
        const errBox = head.querySelector('#edit-error');
        const val = (k) => {
            const el = head.querySelector(`[data-edit="${k}"]`);
            return el ? el.value.trim() : '';
        };
        const num = (k) => { const v = parseFloat(val(k)); return isFinite(v) ? v : null; };
        const int = (k) => { const v = parseInt(val(k)); return isFinite(v) ? v : null; };

        const filters = {};
        for (const key of ['vf', 'mf', 'sf']) {
            const absent = head.querySelector(`[data-edit-filter-absent="${key}"]`).checked;
            const part = head.querySelector(`[data-edit-filter="${key}"]`).value.trim();
            filters[key] = absent ? { part: null, absent: true } : { part, absent: false };
        }

        const flags = {};
        head.querySelectorAll('[data-edit-flag]').forEach(chk => {
            if (chk.checked) flags[chk.dataset.editFlag] = true;
        });

        const exclude = [];
        head.querySelectorAll('[data-edit-oil]').forEach(chk => {
            if (!chk.checked) exclude.push(chk.dataset.editOil);
        });
        const prevOv = record.oil_overrides || {};

        // объёмы поверх текущих fluid_capacities
        const fluid = JSON.parse(JSON.stringify(record.fluid_capacities || {}));
        head.querySelectorAll('[data-edit-vol]').forEach(inp => {
            const key = inp.dataset.editVol;
            const v = parseFloat(inp.value);
            if (!isFinite(v) || v <= 0 || !fluid[key]) return;
            if (key === 'engine') fluid.engine.volumeService = v;
            else fluid[key].volumeTotal = v;
        });

        // Переименование штатных агрегатов → fluid_capacities[key].label
        head.querySelectorAll('[data-edit-agg-label]').forEach(inp => {
            const key = inp.dataset.editAggLabel;
            if (!fluid[key]) return;
            const name = inp.value.trim();
            if (name) fluid[key].label = name;
            else delete fluid[key].label;
        });

        // Пользовательские агрегаты → fluid_capacities.custom
        fluid.custom = customAggs.map(c => {
            const group = c.type === 'gear' ? 'gear' : 'auto';
            const vol = parseFloat(c.volume);
            const approvals = String(c.approvals || '')
                .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            return {
                key: c.key || newAggKey(),
                label: String(c.label || '').trim(),
                group,
                isCvt: c.type === 'cvt',
                volumeTotal: isFinite(vol) && vol > 0 ? vol : null,
                motulProducts: approvals,
            };
        }).filter(c => c.label || c.volumeTotal || c.motulProducts.length);

        const sourceLinks = {};
        head.querySelectorAll('[data-edit-source]').forEach(inp => {
            const url = inp.value.trim();
            if (url) sourceLinks[inp.dataset.editSource] = url;
        });
        const cleanedLinks = cleanSourceLinks(sourceLinks);

        const patch = {
            brand: val('brand'), model: val('model'),
            generation: val('generation') || null,
            engine_name: val('engine_name') || null,
            engine_code: val('engine_code') || null,
            engine_volume: num('engine_volume'),
            year_from: int('year_from'), year_to: int('year_to'),
            kw: int('kw'), bhp: int('bhp'),
            fuel_type: val('fuel_type') || null,
            fluid_capacities: fluid,
            filter_part_numbers: filters,
            car_approvals: head.querySelector('#edit-approvals').value
                .split(/\r?\n/).map(s => s.trim()).filter(Boolean),
            service_flags: flags,
            oil_overrides: { ...prevOv, exclude },
            source_links: cleanedLinks,
            source_keys: buildSourceKeys(cleanedLinks),
            tags: tags.map(t => t.trim()).filter(Boolean),
            notes: head.querySelector('#edit-notes').value.trim() || null,
        };

        errBox.style.display = 'none';
        const commentResult = await promptEditComment();
        if (!commentResult.confirmed) return;

        btn.disabled = true;
        btn.textContent = '⏳ сохранение…';
        try {
            await ctx.apiFetch('/api/cars/' + record.id, {
                method: 'PATCH',
                body: { ...patch, comment: commentResult.comment },
            });
            editMode = false;
            ctx.onChanged(); // перезагрузит страницу машины со свежими данными
        } catch (e) {
            errBox.textContent = '⚠ ' + e.message;
            errBox.style.display = 'block';
            btn.disabled = false;
            btn.textContent = '💾 Сохранить';
        }
    };
}

// Окно «Опишите, почему изменили?» перед сохранением правки. Комментарий
// можно оставить пустым — тогда в ленте будет просто «Отредактировано
// пользователем {ник}». Отмена — возврат к форме без сохранения.
function promptEditComment() {
    return new Promise((resolve) => {
        const old = document.getElementById('edit-comment-modal');
        if (old) old.remove();

        const modal = document.createElement('div');
        modal.id = 'edit-comment-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-backdrop"></div>
            <div class="modal-win modal-win-sm">
                <div class="modal-head">
                    <span>💬 Опишите, почему изменили?</span>
                    <button class="btn btn-sec" id="edit-comment-close">✕</button>
                </div>
                <div class="modal-body">
                    <textarea id="edit-comment-text" rows="3" placeholder="Можно оставить пустым"></textarea>
                    <div class="modal-actions">
                        <button class="btn btn-sec" id="edit-comment-cancel">Отмена</button>
                        <button class="btn btn-pri" id="edit-comment-save">💾 Сохранить</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const finish = (result) => { modal.remove(); resolve(result); };
        modal.querySelector('.modal-backdrop').onclick = () => finish({ confirmed: false });
        modal.querySelector('#edit-comment-close').onclick = () => finish({ confirmed: false });
        modal.querySelector('#edit-comment-cancel').onclick = () => finish({ confirmed: false });
        modal.querySelector('#edit-comment-save').onclick = () => {
            const comment = modal.querySelector('#edit-comment-text').value.trim();
            finish({ confirmed: true, comment: comment || null });
        };
        modal.querySelector('#edit-comment-text').focus();
    });
}

// ── Лента событий машины (только этой машины, хронологически) ─────────────────
// Плашки «добавлена»/«отредактирована» с крупной аватаркой автора. Машины без
// created_by не показывают плашку добавления — просто нет такого события.

async function renderEvents(carId, ctx) {
    const box = document.getElementById('car-events');
    if (!box) return;
    box.innerHTML = '';

    let events;
    try {
        events = await ctx.apiFetch('/api/cars/' + carId + '/events');
    } catch {
        return; // лента — не критично, страница машины работает и без неё
    }
    if (!events.length) return;

    box.innerHTML = `
        <div class="sec-title">История машины</div>
        <div class="events-feed">
            ${events.map((ev, i) => renderEventCard(ev, i)).join('')}
        </div>
    `;

    box.querySelectorAll('[data-event-idx]').forEach(card => {
        const ev = events[parseInt(card.dataset.eventIdx, 10)];
        if (ev.type === 'edited') card.onclick = () => openEventDetails(ev);
    });
}

function rolePrefixHtml(rolePrefix) {
    if (!rolePrefix) return '';
    return `<span class="role-prefix role-prefix-${esc(rolePrefix.color)}" title="${esc(rolePrefix.tooltip || '')}">${esc(rolePrefix.label)}</span> `;
}

function renderEventCard(ev, i) {
    const isAdded = ev.type === 'added';
    const author = ev.user ? esc(ev.user.display_name) : 'неизвестный пользователь';
    const avatarHtml = ev.user && ev.user.avatar
        ? `<img src="${esc(ev.user.avatar)}" alt=""/>`
        : `<span class="event-avatar-default">👤</span>`;
    const when = new Date(ev.created_at).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });

    return `
        <div class="event-card ${isAdded ? 'event-card-added' : 'event-card-edited'}"
             data-event-idx="${i}" ${!isAdded ? 'role="button" tabindex="0"' : ''}>
            <div class="event-avatar">${avatarHtml}</div>
            <div class="event-body">
                <div class="event-text">
                    ${isAdded ? 'Машина добавлена' : 'Отредактировано'} пользователем
                    ${rolePrefixHtml(ev.user?.role_prefix)}<b>${author}</b>
                </div>
                <div class="event-date">${when}</div>
            </div>
        </div>
    `;
}

function openEventDetails(ev) {
    const old = document.getElementById('event-details-modal');
    if (old) old.remove();

    const fields = Object.entries(ev.changed_fields || {});
    const fieldsHtml = fields.length
        ? fields.map(([key, diff]) => `
            <div class="event-diff-row">
                <span class="event-diff-field">${esc(key)}</span>
                <span class="event-diff-from">${esc(formatDiffValue(diff.from))}</span>
                <span class="event-diff-arrow">→</span>
                <span class="event-diff-to">${esc(formatDiffValue(diff.to))}</span>
            </div>`).join('')
        : '<div class="search-empty">Изменённые поля не записаны</div>';

    const modal = document.createElement('div');
    modal.id = 'event-details-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-backdrop"></div>
        <div class="modal-win">
            <div class="modal-head">
                <span>✏ Что изменили</span>
                <button class="btn btn-sec" id="event-details-close">✕</button>
            </div>
            <div class="modal-body">
                ${ev.comment ? `<div class="head-notes">📝 ${esc(ev.comment)}</div>` : ''}
                <div class="event-diff-list">${fieldsHtml}</div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('.modal-backdrop').onclick = close;
    modal.querySelector('#event-details-close').onclick = close;
}

function formatDiffValue(v) {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
