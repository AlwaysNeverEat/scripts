// ── Режим «Теги»: каскадные выпадашки марка → модель → объём ──────────────────
// Сфера на фоне сужается по мере выбора: узлы, не подходящие под текущий
// фильтр, пропадают (main.js передаёт сюда простенький sphere-адаптер).
// Когда подходящих машин остаётся меньше SPHERE_HIDE_THRESHOLD — сфера
// прячется, дальше уточнять смысла нет, снизу и так виден весь результат.

const SPHERE_HIDE_THRESHOLD = 5;
const RESULTS_LIMIT = 60;
// Маркер «объём не указан у машины» — отдельно от '' (означающего «объём ещё не выбран»)
const NULL_VOLUME = '__null__';

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

/**
 * @param {{apiFetch: Function, onPick: (id:string) => void, sphere: {
 *   setNodes: (nodes: {id:string,label:string}[]) => void,
 *   setVisible: (v: boolean) => void,
 *   resetRandom: () => Promise<void>,
 * }}} deps
 */
export function initTagSearch({ apiFetch, onPick, sphere }) {
    const brandSelect  = document.getElementById('tag-brand');
    const modelSelect  = document.getElementById('tag-model');
    const volumeSelect = document.getElementById('tag-volume');
    const resultsEl    = document.getElementById('tag-results');

    let state = { brand: '', model: '', volume: '' };
    let brandsLoaded = false;
    // Растущий счётчик — чтобы устаревший ответ (юзер быстро переключил выбор)
    // не перезаписал уже более новое состояние.
    let requestSeq = 0;

    function resetSelect(select, placeholder) {
        select.innerHTML = `<option value="">${placeholder}</option>`;
    }

    async function loadBrands() {
        resetSelect(brandSelect, 'Марка…');
        try {
            const brands = await apiFetch('/api/cars/tags/brands');
            for (const b of brands) {
                const opt = document.createElement('option');
                opt.value = b.brand;
                opt.textContent = `${b.brand} (${b.count})`;
                brandSelect.appendChild(opt);
            }
            brandsLoaded = true;
        } catch { /* пусто — дропдаун останется с одним плейсхолдером */ }
    }

    async function loadModels(brand) {
        resetSelect(modelSelect, 'Модель…');
        try {
            const models = await apiFetch('/api/cars/tags/models?brand=' + encodeURIComponent(brand));
            for (const m of models) {
                const opt = document.createElement('option');
                opt.value = m.model;
                opt.textContent = `${m.model}${formatYears(m.year_from, m.year_to)} · ${m.count}`;
                modelSelect.appendChild(opt);
            }
        } catch { /* … */ }
    }

    async function loadVolumes(brand, model) {
        resetSelect(volumeSelect, 'Объём…');
        try {
            const volumes = await apiFetch(
                '/api/cars/tags/volumes?brand=' + encodeURIComponent(brand) +
                '&model=' + encodeURIComponent(model),
            );
            for (const v of volumes) {
                const opt = document.createElement('option');
                const codes = v.engine_codes && v.engine_codes.length ? ' · ' + v.engine_codes.join(', ') : '';
                if (v.engine_volume == null) {
                    opt.value = NULL_VOLUME;
                    opt.textContent = `без объёма${codes} · ${v.count}`;
                } else {
                    opt.value = v.engine_volume;
                    opt.textContent = `${v.engine_volume} л${codes} · ${v.count}`;
                }
                volumeSelect.appendChild(opt);
            }
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

    brandSelect.addEventListener('change', () => {
        state = { brand: brandSelect.value, model: '', volume: '' };
        resetSelect(modelSelect, 'Модель…');
        resetSelect(volumeSelect, 'Объём…');
        modelSelect.classList.toggle('hidden', !state.brand);
        volumeSelect.classList.add('hidden');
        if (state.brand) loadModels(state.brand);
        refreshResults();
    });

    modelSelect.addEventListener('change', () => {
        state.model = modelSelect.value;
        state.volume = '';
        resetSelect(volumeSelect, 'Объём…');
        volumeSelect.classList.toggle('hidden', !state.model);
        if (state.model) loadVolumes(state.brand, state.model);
        refreshResults();
    });

    volumeSelect.addEventListener('change', () => {
        state.volume = volumeSelect.value;
        refreshResults();
    });

    return {
        activate() {
            if (!brandsLoaded) loadBrands();
        },
        deactivate() {
            state = { brand: '', model: '', volume: '' };
            resetSelect(brandSelect, 'Марка…');
            resetSelect(modelSelect, 'Модель…');
            resetSelect(volumeSelect, 'Объём…');
            modelSelect.classList.add('hidden');
            volumeSelect.classList.add('hidden');
            resultsEl.innerHTML = '';
            brandsLoaded = false;
            sphere.setVisible(true);
            sphere.resetRandom();
        },
    };
}
