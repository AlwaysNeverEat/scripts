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

export function initCarPage(record, { apiFetch, onChanged }) {
    editMode = false;
    renderHead(record, { apiFetch, onChanged });
    initCalculator(record);
}

// ── Шапка ─────────────────────────────────────────────────────────────────────

function renderHead(record, ctx) {
    const head = document.getElementById('car-head');
    if (!head) return;
    head.innerHTML = editMode ? renderEditForm(record) : renderView(record);
    if (editMode) bindEditForm(head, record, ctx);
    else bindView(head, record, ctx);

    const title = document.getElementById('calc-car-title');
    if (title) title.textContent = [record.brand, record.model].filter(Boolean).join(' ');
}

function renderView(record) {
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
                <button class="btn btn-sec" id="btn-edit-car">✏ Нашли ошибку?</button>
            </div>
            <div class="head-chips">${chips}</div>
            ${sourcesHtml}
            ${flagsHtml}
            ${notesHtml}
            ${recHtml}
        </div>
    `;
}

function bindView(head, record, ctx) {
    const btn = head.querySelector('#btn-edit-car');
    if (btn) btn.onclick = () => { editMode = true; renderHead(record, ctx); };
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

    // объёмы жидкостей
    const fc = record.fluid_capacities || {};
    const volRow = (key, label) => {
        const a = fc[key];
        if (!a) return '';
        const vol = key === 'engine'
            ? (a.volumeService || a.volumeTotal || a.volumePlain || '')
            : (a.volumeTotal || a.volumeService || a.volumePlain || '');
        return `
            <div class="edit-filter-row">
                <span class="edit-lbl">${label}</span>
                <input type="number" step="0.1" min="0" data-edit-vol="${key}" value="${vol}" style="width:90px"/>
                <span style="color:var(--sub);font-size:12px">л</span>
            </div>`;
    };
    const volRows = [
        volRow('engine', 'ДВС'), volRow('automatic', 'АКПП/вариатор'),
        volRow('manual', 'МКПП'), volRow('transfer', 'Раздатка'),
        volRow('diffFront', 'Диф. перед'), volRow('diffRear', 'Диф. зад'),
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

            ${volRows ? `<div class="edit-sec-h">Объёмы жидкостей</div>${volRows}` : ''}

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

            <div class="edit-sec-h">Заметка</div>
            <textarea id="edit-notes" rows="2">${esc(record.notes || '')}</textarea>

            <div id="edit-error" class="edit-error" style="display:none"></div>
        </div>
    `;
}

function bindEditForm(head, record, ctx) {
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
            notes: head.querySelector('#edit-notes').value.trim() || null,
        };

        errBox.style.display = 'none';
        btn.disabled = true;
        btn.textContent = '⏳ сохранение…';
        try {
            await ctx.apiFetch('/api/cars/' + record.id, { method: 'PATCH', body: patch });
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
