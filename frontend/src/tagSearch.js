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

// Кириллические буквы-двойники латиницы. При ручном вводе «C5 (T19C)» легко
// набрать половину букв в русской раскладке — визуально не отличить, а модель
// в базе получается «другая», и в выпадашке плодятся мнимые дубли.
const CYR_LOOKALIKE = {
    'а': 'a', 'в': 'b', 'е': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o',
    'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x',
};

// Ключ для схлопывания визуально одинаковых имён моделей: убираем регистр,
// лишние пробелы и кириллические двойники — «C5 (T19C)» и «С5 (Т19С)» дают
// один и тот же ключ и мержатся в одну строку списка.
function normModel(s) {
    return String(s ?? '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase()
        .replace(/[авекмнорстух]/g, ch => CYR_LOOKALIKE[ch] || ch);
}

// Из вариантов написания под одним ключом — самое частое, при равенстве по алфавиту.
function pickCanonical(variants) {
    return [...variants.entries()]
        .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0][0];
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
 * @param {{getCars: () => (Array|Promise<Array>), onPick: (id:string) => void, sphere: {
 *   setNodes: (nodes: {id:string,label:string}[]) => void,
 *   setVisible: (v: boolean) => void,
 *   resetRandom: () => void,
 * }}} deps
 *
 * Каскад марка → модель → объём считается целиком из снимка базы (getCars),
 * без единого запроса к серверу — переключение тегов мгновенно.
 */
export function initTagSearch({ getCars, onPick, sphere }) {
    const brandBox  = document.getElementById('tag-combo-brand');
    const modelBox  = document.getElementById('tag-combo-model');
    const volumeBox = document.getElementById('tag-combo-volume');
    const resultsEl = document.getElementById('tag-results');

    let state = { brand: '', model: '', volume: '' };
    let allCars = [];   // снимок базы (заполняется в activate)

    const brandCombo = createCombo(brandBox, { onChange: onBrandChange });
    const modelCombo = createCombo(modelBox, { onChange: onModelChange });
    const volumeCombo = createCombo(volumeBox, { onChange: onVolumeChange });

    // ── Производные списки из снимка (всё синхронно, повторяет SQL /tags/*) ──
    function carsOfBrand(brand) {
        const bl = brand.toLowerCase();
        return allCars.filter(c => String(c.brand).toLowerCase() === bl);
    }

    function computeBrands() {
        const counts = new Map();
        for (const c of allCars) counts.set(c.brand, (counts.get(c.brand) || 0) + 1);
        return [...counts.entries()]
            .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
            .map(([brand, count]) => ({ brand, count }));
    }

    // year_to = null, если хоть одно поколение модели ещё в производстве
    // (bool_or(year_to IS NULL) в SQL) — иначе max(year_to).
    function computeModels(brand) {
        const map = new Map();  // ключ: normModel(model) — см. normModel
        for (const c of carsOfBrand(brand)) {
            const key = normModel(c.model);
            const m = map.get(key) || { yearFrom: Infinity, open: false, yearTo: -Infinity, count: 0, variants: new Map() };
            m.count++;
            m.variants.set(c.model, (m.variants.get(c.model) || 0) + 1);
            if (c.year_from != null) m.yearFrom = Math.min(m.yearFrom, Number(c.year_from));
            if (c.year_to == null) m.open = true; else m.yearTo = Math.max(m.yearTo, Number(c.year_to));
            map.set(key, m);
        }
        return [...map.entries()]
            .map(([key, m]) => ({
                key,
                model: pickCanonical(m.variants),
                year_from: Number.isFinite(m.yearFrom) ? m.yearFrom : null,
                year_to: m.open ? null : (Number.isFinite(m.yearTo) ? m.yearTo : null),
                count: m.count,
            }))
            .sort((a, b) => String(a.model).localeCompare(String(b.model)));
    }

    function computeVolumes(brand, modelKey) {
        const map = new Map();  // ключ: число объёма или '__null__'
        for (const c of carsOfBrand(brand)) {
            if (normModel(c.model) !== modelKey) continue;
            const vol = c.engine_volume == null ? null : Number(c.engine_volume);
            const key = vol == null ? NULL_VOLUME : String(vol);
            const e = map.get(key) || { engine_volume: vol, codes: new Set(), count: 0 };
            e.count++;
            if (c.engine_code) e.codes.add(c.engine_code);
            map.set(key, e);
        }
        return [...map.values()]
            .sort((a, b) => {          // engine_volume ASC, NULLS LAST
                if (a.engine_volume == null) return 1;
                if (b.engine_volume == null) return -1;
                return a.engine_volume - b.engine_volume;
            })
            .map(e => ({ engine_volume: e.engine_volume, engine_codes: [...e.codes], count: e.count }));
    }

    // Отфильтрованный по текущим тегам список машин (порядок как в SQL).
    function computeResults() {
        const bl = state.brand.toLowerCase();
        const vol = state.volume && state.volume !== NULL_VOLUME ? parseFloat(state.volume) : null;
        return allCars.filter(c => {
            if (String(c.brand).toLowerCase() !== bl) return false;
            if (state.model && normModel(c.model) !== state.model) return false;
            if (state.volume === NULL_VOLUME) return c.engine_volume == null;
            if (vol != null) return c.engine_volume != null && Number(c.engine_volume) === vol;
            return true;
        }).sort((a, b) =>
            String(a.brand).localeCompare(String(b.brand)) ||
            String(a.model).localeCompare(String(b.model)) ||
            (Number(a.year_from || 0) - Number(b.year_from || 0)));
    }

    function populateBrands() {
        brandCombo.setOptions(computeBrands().map(b => ({
            value: b.brand, label: `${b.brand} (${b.count})`, search: b.brand,
        })));
    }

    function populateModels(brand) {
        modelCombo.setOptions(computeModels(brand).map(m => ({
            value: m.key,
            label: `${m.model}${formatYears(m.year_from, m.year_to)} · ${m.count}`,
            search: m.model,
        })));
    }

    function populateVolumes(brand, modelKey) {
        volumeCombo.setOptions(computeVolumes(brand, modelKey).map(v => {
            const codes = v.engine_codes && v.engine_codes.length ? ' · ' + v.engine_codes.join(', ') : '';
            return v.engine_volume == null
                ? { value: NULL_VOLUME, label: `без объёма${codes} · ${v.count}`, search: 'без объёма ' + (v.engine_codes || []).join(' ') }
                : { value: String(v.engine_volume), label: `${v.engine_volume} л${codes} · ${v.count}`, search: v.engine_volume + ' ' + (v.engine_codes || []).join(' ') };
        }));
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

    // Всё синхронно — фильтруем снимок в памяти, никакой сети и гонок.
    function refreshResults() {
        if (!state.brand) {
            resultsEl.innerHTML = '';
            sphere.resetRandom();
            return;
        }

        const all = computeResults();
        const total = all.length;
        const cars = all.slice(0, RESULTS_LIMIT);

        renderResults(cars, total);
        if (total > 0 && total < SPHERE_HIDE_THRESHOLD) {
            sphere.setVisible(false);
        } else if (cars.length) {
            sphere.setNodes(cars.map(carNode));
            sphere.setVisible(true);
        } else {
            sphere.setVisible(false);
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
        if (value) populateModels(value);
        refreshResults();
    }

    function onModelChange(value) {
        state.model = value;
        state.volume = '';
        volumeCombo.reset();
        volumeCombo.setOptions([]);
        volumeBox.classList.toggle('hidden', !value);
        if (value) populateVolumes(state.brand, value);
        refreshResults();
    }

    function onVolumeChange(value) {
        state.volume = value;
        refreshResults();
    }

    return {
        activate() {
            // Снимок мог ещё грузиться (пользователь сразу нажал «Теги») —
            // ждём его один раз, дальше всё мгновенно из памяти.
            Promise.resolve(getCars()).then(cars => {
                allCars = Array.isArray(cars) ? cars : [];
                populateBrands();
            }).catch(() => { /* пусто — список останется пустым */ });
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
            sphere.setVisible(true);
            sphere.resetRandom();
        },
    };
}
