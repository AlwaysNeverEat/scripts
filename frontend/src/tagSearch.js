// ── Режим «Теги»: каскадные автокомплиты марка → модель → объём ───────────────
// Свой комбобокс вместо нативного <select> (тот не красится под тему сайта —
// белый попап списка в Chrome/Windows) — умеет фильтроваться по вводу текста.
// Сфера на фоне сужается по мере выбора: узлы, не подходящие под текущий
// фильтр, пропадают (main.js передаёт сюда простенький sphere-адаптер).
// Когда подходящих машин остаётся меньше SPHERE_HIDE_THRESHOLD — сфера
// прячется, дальше уточнять смысла нет, снизу и так виден весь результат.

const SPHERE_HIDE_THRESHOLD = 5;
const RESULTS_LIMIT = 60;
// Маркер «объём не указан у машины» — отдельно от '' (означающего «объём ещё не выбран»)
const NULL_VOLUME = '__null__';
// Пока input в фокусе, blur от клика по опции срабатывает раньше mousedown,
// если не отложить закрытие — поэтому revert/close идут с небольшой задержкой.
const BLUR_CLOSE_DELAY_MS = 120;

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function carNode(c) {
    return { id: c.id, label: [c.brand, c.model, c.generation].filter(Boolean).join(' ') };
}

function formatYears(yearFrom, yearTo) {
    if (!yearFrom) return '';
    return ` (${yearFrom}–${yearTo || 'н.в.'})`;
}

// ── Комбобокс с фильтрацией по вводу ───────────────────────────────────────
// options: [{ value, label, search }] — search — то, по чему матчим текст
// (обычно совпадает с label без счётчика в скобках).
function createCombo(container, { onChange }) {
    const input = container.querySelector('.tag-combo-input');
    const list  = container.querySelector('.tag-combo-list');
    const clearBtn = container.querySelector('.tag-combo-clear');

    let options = [];
    let visible = [];   // текущий отфильтрованный список
    let selected = null; // { value, label }
    let activeIndex = -1;

    function renderList(text) {
        const q = text.trim().toLowerCase();
        visible = q ? options.filter(o => (o.search ?? o.label).toLowerCase().includes(q)) : options;
        activeIndex = -1;
        list.innerHTML = visible.length
            ? visible.map((o, i) => `<div class="tag-combo-opt" data-idx="${i}">${esc(o.label)}</div>`).join('')
            : '<div class="tag-combo-empty">Ничего не найдено</div>';
    }

    function highlight() {
        [...list.children].forEach((el, i) => el.classList.toggle('active', i === activeIndex));
        list.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
    }

    function openList() {
        renderList(input.value);
        list.classList.remove('hidden');
    }
    function closeList() {
        list.classList.add('hidden');
        activeIndex = -1;
    }

    function applySelected() {
        input.value = selected ? selected.label : '';
        container.classList.toggle('has-value', !!selected);
        clearBtn.classList.toggle('hidden', !selected);
    }

    function selectItem(item) {
        selected = item;
        applySelected();
        closeList();
        onChange(item.value);
    }

    input.addEventListener('focus', openList);
    input.addEventListener('input', () => {
        renderList(input.value);
        list.classList.remove('hidden');
    });
    input.addEventListener('blur', () => {
        // Задержка, чтобы mousedown по опции (см. ниже) успел сработать раньше.
        setTimeout(() => { applySelected(); closeList(); }, BLUR_CLOSE_DELAY_MS);
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { applySelected(); closeList(); input.blur(); return; }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (list.classList.contains('hidden')) openList();
            activeIndex = Math.min(activeIndex + 1, visible.length - 1);
            highlight();
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIndex = Math.max(activeIndex - 1, 0);
            highlight();
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            const item = visible[activeIndex] ?? (visible.length === 1 ? visible[0] : null);
            if (item) selectItem(item);
            return;
        }
    });
    list.addEventListener('mousedown', (e) => {
        e.preventDefault(); // не даём инпуту потерять фокус раньше выбора
        const el = e.target.closest('.tag-combo-opt');
        if (!el) return;
        const item = visible[Number(el.dataset.idx)];
        if (item) selectItem(item);
    });
    clearBtn.addEventListener('mousedown', (e) => e.preventDefault());
    clearBtn.addEventListener('click', () => {
        selected = null;
        applySelected();
        closeList();
        onChange('');
    });

    return {
        setOptions(opts) {
            options = opts;
            if (selected && !options.some(o => o.value === selected.value)) {
                selected = null;
                applySelected();
            }
        },
        reset() {
            selected = null;
            applySelected();
            closeList();
        },
        get value() { return selected ? selected.value : ''; },
    };
}

/**
 * @param {{apiFetch: Function, onPick: (id:string) => void, sphere: {
 *   setNodes: (nodes: {id:string,label:string}[]) => void,
 *   setVisible: (v: boolean) => void,
 *   resetRandom: () => Promise<void>,
 * }}} deps
 */
export function initTagSearch({ apiFetch, onPick, sphere }) {
    const brandBox  = document.getElementById('tag-combo-brand');
    const modelBox  = document.getElementById('tag-combo-model');
    const volumeBox = document.getElementById('tag-combo-volume');
    const resultsEl = document.getElementById('tag-results');

    let state = { brand: '', model: '', volume: '' };
    let brandsLoaded = false;
    // Растущий счётчик — чтобы устаревший ответ (юзер быстро переключил выбор)
    // не перезаписал уже более новое состояние.
    let requestSeq = 0;

    const brandCombo = createCombo(brandBox, { onChange: onBrandChange });
    const modelCombo = createCombo(modelBox, { onChange: onModelChange });
    const volumeCombo = createCombo(volumeBox, { onChange: onVolumeChange });

    async function loadBrands() {
        try {
            const brands = await apiFetch('/api/cars/tags/brands');
            brandCombo.setOptions(brands.map(b => ({
                value: b.brand, label: `${b.brand} (${b.count})`, search: b.brand,
            })));
            brandsLoaded = true;
        } catch { /* пусто — список останется прежним/пустым */ }
    }

    async function loadModels(brand) {
        try {
            const models = await apiFetch('/api/cars/tags/models?brand=' + encodeURIComponent(brand));
            modelCombo.setOptions(models.map(m => ({
                value: m.model,
                label: `${m.model}${formatYears(m.year_from, m.year_to)} · ${m.count}`,
                search: m.model,
            })));
        } catch { /* … */ }
    }

    async function loadVolumes(brand, model) {
        try {
            const volumes = await apiFetch(
                '/api/cars/tags/volumes?brand=' + encodeURIComponent(brand) +
                '&model=' + encodeURIComponent(model),
            );
            volumeCombo.setOptions(volumes.map(v => {
                const codes = v.engine_codes && v.engine_codes.length ? ' · ' + v.engine_codes.join(', ') : '';
                return v.engine_volume == null
                    ? { value: NULL_VOLUME, label: `без объёма${codes} · ${v.count}`, search: 'без объёма ' + (v.engine_codes || []).join(' ') }
                    : { value: String(v.engine_volume), label: `${v.engine_volume} л${codes} · ${v.count}`, search: v.engine_volume + ' ' + (v.engine_codes || []).join(' ') };
            }));
        } catch { /* … */ }
    }

    function renderResults(cars, total) {
        if (!cars.length) {
            resultsEl.innerHTML = '<div class="search-empty">Ничего не найдено по этим тегам</div>';
            return;
        }
        const more = total > cars.length
            ? `<div class="search-empty">…и ещё ${total - cars.length} — уточните теги</div>`
            : '';
        resultsEl.innerHTML = cars.map(car => `
            <div class="car-card" data-id="${car.id}">
                <div class="car-card-title">
                    ${esc(car.brand)} ${esc(car.model)}
                    ${car.generation ? ' · ' + esc(car.generation) : ''}
                    ${car.engine_code ? ' · ' + esc(car.engine_code) : ''}
                </div>
                <div class="car-card-sub">
                    ${car.engine_volume ? car.engine_volume + 'л' : ''}
                    ${car.kw ? ' · ' + car.kw + 'кВт' : ''}
                    ${car.bhp ? ' / ' + car.bhp + 'л.с.' : ''}
                    ${car.year_from ? ' · ' + car.year_from + (car.year_to ? '–' + car.year_to : '+') : ''}
                </div>
            </div>
        `).join('') + more;

        resultsEl.querySelectorAll('.car-card').forEach(card => {
            card.onclick = () => onPick(card.dataset.id);
        });
    }

    async function refreshResults() {
        const seq = ++requestSeq;

        if (!state.brand) {
            resultsEl.innerHTML = '';
            await sphere.resetRandom();
            return;
        }

        const params = new URLSearchParams();
        params.set('brand', state.brand);
        if (state.model) params.set('model', state.model);
        if (state.volume) params.set('volume', state.volume);
        params.set('limit', String(RESULTS_LIMIT));

        try {
            const { total, cars } = await apiFetch('/api/cars/tags/results?' + params.toString());
            if (seq !== requestSeq) return; // устарело — юзер уже выбрал дальше

            renderResults(cars, total);
            if (total > 0 && total < SPHERE_HIDE_THRESHOLD) {
                sphere.setVisible(false);
            } else if (cars.length) {
                sphere.setNodes(cars.map(carNode));
                sphere.setVisible(true);
            } else {
                sphere.setVisible(false);
            }
        } catch {
            if (seq !== requestSeq) return;
            resultsEl.innerHTML = '<div class="search-empty">Ошибка подключения к серверу</div>';
        }
    }

    function onBrandChange(value) {
        state = { brand: value, model: '', volume: '' };
        modelCombo.reset();
        modelCombo.setOptions([]);
        volumeCombo.reset();
        volumeCombo.setOptions([]);
        modelBox.classList.toggle('hidden', !value);
        volumeBox.classList.add('hidden');
        if (value) loadModels(value);
        refreshResults();
    }

    function onModelChange(value) {
        state.model = value;
        state.volume = '';
        volumeCombo.reset();
        volumeCombo.setOptions([]);
        volumeBox.classList.toggle('hidden', !value);
        if (value) loadVolumes(state.brand, value);
        refreshResults();
    }

    function onVolumeChange(value) {
        state.volume = value;
        refreshResults();
    }

    return {
        activate() {
            if (!brandsLoaded) loadBrands();
        },
        deactivate() {
            state = { brand: '', model: '', volume: '' };
            brandCombo.reset();
            modelCombo.reset();
            modelCombo.setOptions([]);
            volumeCombo.reset();
            volumeCombo.setOptions([]);
            modelBox.classList.add('hidden');
            volumeBox.classList.add('hidden');
            resultsEl.innerHTML = '';
            brandsLoaded = false;
            sphere.setVisible(true);
            sphere.resetRandom();
        },
    };
}
