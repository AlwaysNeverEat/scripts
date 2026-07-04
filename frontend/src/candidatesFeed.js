// ─────────────────────────────────────────────────────────────────────────────
// Вкладка «Добавить машины»: бесконечный фид черновиков от краулера.
// Каждая карточка разворачивается в редактируемую форму → «Добавить в БД»
// (approve → cars) или «Удалить» (reject, машину добьют руками).
// Грузим партиями по 50, чтобы не ронять ни сайт, ни бэкенд.
// ─────────────────────────────────────────────────────────────────────────────

import { fuelLabel, fuelSelectOptions } from '../../shared/fuel.js';

const BATCH = 50;

let ctx = null;
let offset = 0;
let total = 0;
let loading = false;
let done = false;

export function initCandidatesFeed(context) {
    ctx = context;
    offset = 0; total = 0; loading = false; done = false;
    const list = document.getElementById('feed-list');
    list.innerHTML = '';
    document.getElementById('feed-count').textContent = '';
    loadMore(true);
    setupInfiniteScroll();
}

async function loadMore(first = false) {
    if (loading || done) return;
    loading = true;
    const more = document.getElementById('feed-more');
    more.textContent = '⏳ загрузка…';
    try {
        const res = await ctx.apiFetch(`/api/candidates?status=pending&limit=${BATCH}&offset=${offset}`);
        total = res.total;
        document.getElementById('feed-count').textContent = total ? `(${total} в очереди)` : '';
        if (first && !res.data.length) {
            document.getElementById('feed-list').innerHTML =
                '<div class="feed-empty">Очередь пуста. Запустите краулер — черновики появятся здесь.</div>';
            done = true; more.textContent = '';
            return;
        }
        renderCards(res.data);
        offset += res.data.length;
        if (offset >= total || !res.data.length) { done = true; more.textContent = ''; }
        else more.textContent = '';
    } catch (e) {
        more.innerHTML = `<span class="feed-err">Ошибка загрузки: ${esc(e.message)}</span>`;
    } finally {
        loading = false;
    }
}

function setupInfiniteScroll() {
    const page = document.getElementById('page-candidates');
    page.onscroll = null;
    window.onscroll = () => {
        if (document.getElementById('page-candidates').classList.contains('hidden')) return;
        if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 400) loadMore();
    };
}

// ── Карточка ────────────────────────────────────────────────────────────────

function renderCards(cards) {
    const list = document.getElementById('feed-list');
    for (const c of cards) {
        const el = document.createElement('div');
        el.className = 'feed-card';
        el.dataset.id = c.id;
        el.innerHTML = cardSummary(c);
        el.querySelector('.feed-card-head').onclick = () => toggleExpand(el, c);
        list.appendChild(el);
    }
}

function qualityBadge(c) {
    const map = {
        good:       ['✓ полная',    'q-good'],
        partial:    ['± частичная', 'q-partial'],
        no_filters: ['без фильтров', 'q-nofilt'],
        weak:       ['слабый матч', 'q-weak'],
    };
    const [label, cls] = map[c.match_quality] || map.partial;
    return `<span class="feed-q ${cls}">${label}</span>`;
}

function filtersLine(c) {
    const fpn = c.filter_part_numbers || {};
    const cell = (key, label) => {
        const e = fpn[key];
        if (e && e.absent) return `<span class="feed-f feed-f-absent">${label}: нет</span>`;
        if (e && e.part) return `<span class="feed-f feed-f-ok">${label}: ${esc(e.part)}</span>`;
        return `<span class="feed-f feed-f-miss">${label}: ?</span>`;
    };
    return `${cell('vf', 'вф')} ${cell('mf', 'мф')} ${cell('sf', 'сф')}`;
}

function cardSummary(c) {
    const years = c.year_from ? c.year_from + (c.year_to ? `–${c.year_to}` : '+') : '';
    const sub = [
        c.engine_code && esc(c.engine_code),
        c.engine_volume && `${c.engine_volume} л`,
        c.bhp ? `${c.bhp} л.с.` : (c.kw ? `${c.kw} кВт` : ''),
        fuelLabel(c.fuel_type),
        years,
    ].filter(Boolean).join(' · ');
    return `
        <div class="feed-card-head">
            <div class="feed-card-main">
                <div class="feed-card-title">
                    ${esc(c.brand)} ${esc(c.model)}${c.generation ? ` <span class="feed-gen">(${esc(c.generation)})</span>` : ''}
                    ${qualityBadge(c)}
                </div>
                <div class="feed-card-sub">${sub}</div>
                <div class="feed-card-filters">${filtersLine(c)}</div>
            </div>
            <div class="feed-card-chevron">▸</div>
        </div>
        <div class="feed-card-body"></div>`;
}

function toggleExpand(el, c) {
    const body = el.querySelector('.feed-card-body');
    const open = el.classList.toggle('expanded');
    el.querySelector('.feed-card-chevron').textContent = open ? '▾' : '▸';
    if (open && !body.dataset.built) {
        body.innerHTML = editForm(c);
        bindEditForm(el, c);
        body.dataset.built = '1';
    }
}

// ── Форма правки (структура повторяет режим правки на странице машины) ─────────

function editForm(c) {
    const f = (key, label, value, type = 'text') => `
        <label class="edit-field">
            <span>${label}</span>
            <input type="${type}" ${type === 'number' ? 'step="any"' : ''} data-edit="${key}" value="${esc(value == null ? '' : String(value))}"/>
        </label>`;

    const fpn = c.filter_part_numbers || {};
    const filterRow = (key, label) => {
        const e = fpn[key] || {};
        return `
            <div class="edit-filter-row">
                <span class="edit-lbl">${label}</span>
                <input type="text" data-edit-filter="${key}" value="${esc(e.absent ? '' : (e.part || ''))}" placeholder="артикул" ${e.absent ? 'disabled' : ''}/>
                <label class="chk-label"><input type="checkbox" data-edit-filter-absent="${key}" ${e.absent ? 'checked' : ''}/> отсутствует</label>
            </div>`;
    };

    const fc = c.fluid_capacities || {};
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

    const approvals = Array.isArray(c.car_approvals) ? c.car_approvals : [];
    const srcMotul = c.source && c.source.motulUrl;
    const srcMann  = c.source && c.source.mannUrl;

    return `
        <div class="feed-edit">
            <div class="edit-sec-h">Машина</div>
            <div class="edit-grid">
                ${f('brand', 'Марка *', c.brand)}
                ${f('model', 'Модель *', c.model)}
                ${f('generation', 'Кузов/поколение', c.generation)}
                ${f('engine_name', 'Двигатель', c.engine_name)}
                ${f('engine_code', 'Код двигателя', c.engine_code)}
                ${f('engine_volume', 'Объём, л', c.engine_volume, 'number')}
                ${f('year_from', 'Год с *', c.year_from, 'number')}
                ${f('year_to', 'Год по', c.year_to, 'number')}
                ${f('kw', 'кВт', c.kw, 'number')}
                ${f('bhp', 'л.с.', c.bhp, 'number')}
                <label class="edit-field">
                    <span>Топливо</span>
                    <select data-edit="fuel_type">${fuelSelectOptions(c.fuel_type)}</select>
                </label>
            </div>

            ${volRows ? `<div class="edit-sec-h">Объёмы жидкостей (Motul)</div>${volRows}` : ''}

            <div class="edit-sec-h">Допуски масла — по одному в строке</div>
            <textarea data-edit-approvals rows="3">${esc(approvals.join('\n'))}</textarea>

            <div class="edit-sec-h">Фильтры (MANN) — нужны все три для добавления</div>
            ${filterRow('vf', 'вф (воздушный)')}
            ${filterRow('mf', 'мф (масляный)')}
            ${filterRow('sf', 'сф (салонный)')}

            <div class="feed-src">
                ${srcMotul ? `<a href="${esc(srcMotul)}" target="_blank" rel="noopener">Motul ↗</a>` : ''}
                ${srcMann ? `<a href="${esc(srcMann)}" target="_blank" rel="noopener">MANN ↗</a>` : ''}
            </div>

            <div class="feed-edit-actions">
                <button class="btn btn-danger" data-act="reject">🗑 Удалить</button>
                <button class="btn btn-pri" data-act="approve">✓ Добавить в БД</button>
            </div>
            <div class="edit-error feed-edit-err" style="display:none"></div>
        </div>`;
}

function bindEditForm(el, c) {
    const body = el.querySelector('.feed-card-body');

    body.querySelectorAll('[data-edit-filter-absent]').forEach(chk => {
        chk.onchange = () => {
            const inp = body.querySelector(`[data-edit-filter="${chk.dataset.editFilterAbsent}"]`);
            inp.disabled = chk.checked;
            if (chk.checked) inp.value = '';
        };
    });

    body.querySelector('[data-act="reject"]').onclick = () => reject(el, c);
    body.querySelector('[data-act="approve"]').onclick = () => approve(el, c);
}

function collectPayload(body, c) {
    const val = (k) => { const el = body.querySelector(`[data-edit="${k}"]`); return el ? el.value.trim() : ''; };
    const num = (k) => { const v = parseFloat(val(k)); return isFinite(v) ? v : null; };
    const int = (k) => { const v = parseInt(val(k)); return isFinite(v) ? v : null; };

    const filters = {};
    for (const key of ['vf', 'mf', 'sf']) {
        const absent = body.querySelector(`[data-edit-filter-absent="${key}"]`).checked;
        const part = body.querySelector(`[data-edit-filter="${key}"]`).value.trim();
        filters[key] = absent ? { part: null, absent: true } : { part, absent: false };
    }

    const fluid = JSON.parse(JSON.stringify(c.fluid_capacities || {}));
    body.querySelectorAll('[data-edit-vol]').forEach(inp => {
        const key = inp.dataset.editVol;
        const v = parseFloat(inp.value);
        if (!isFinite(v) || v <= 0 || !fluid[key]) return;
        if (key === 'engine') fluid.engine.volumeService = v;
        else fluid[key].volumeTotal = v;
    });

    return {
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
        car_approvals: body.querySelector('[data-edit-approvals]').value
            .split(/\r?\n/).map(s => s.trim()).filter(Boolean),
    };
}

async function approve(el, c) {
    const body = el.querySelector('.feed-card-body');
    const errBox = body.querySelector('.feed-edit-err');
    const btn = body.querySelector('[data-act="approve"]');
    const payload = collectPayload(body, c);

    errBox.style.display = 'none';
    btn.disabled = true; btn.textContent = '⏳…';
    try {
        await ctx.apiFetch(`/api/candidates/${c.id}/approve`, { method: 'POST', body: payload });
        removeCard(el, '✓ добавлено в базу');
    } catch (e) {
        errBox.textContent = '⚠ ' + e.message;
        errBox.style.display = 'block';
        btn.disabled = false; btn.textContent = '✓ Добавить в БД';
    }
}

async function reject(el, c) {
    const body = el.querySelector('.feed-card-body');
    const btn = body.querySelector('[data-act="reject"]');
    btn.disabled = true; btn.textContent = '⏳…';
    try {
        await ctx.apiFetch(`/api/candidates/${c.id}/reject`, { method: 'POST', body: {} });
        removeCard(el, '🗑 удалено');
    } catch (e) {
        btn.disabled = false; btn.textContent = '🗑 Удалить';
    }
}

function removeCard(el, msg) {
    el.classList.add('feed-card-gone');
    el.innerHTML = `<div class="feed-card-gone-msg">${msg}</div>`;
    total = Math.max(0, total - 1);
    offset = Math.max(0, offset - 1);
    document.getElementById('feed-count').textContent = total ? `(${total} в очереди)` : '';
    setTimeout(() => {
        el.remove();
        const list = document.getElementById('feed-list');
        if (!list.querySelector('.feed-card') && !total) {
            list.innerHTML = '<div class="feed-empty">Очередь разобрана 🎉</div>';
        }
    }, 900);
    // Дозагрузить, если на экране осталось мало карточек.
    if (!done && document.querySelectorAll('.feed-card:not(.feed-card-gone)').length < 10) loadMore();
}

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, ch =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}
