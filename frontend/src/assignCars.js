// ─────────────────────────────────────────────────────────────────────────────
// Модалка «Назначить машины» (только mod/admin): список ВСЕХ машин базы с
// галочками. Галочка стоит = машина засчитана этому пользователю; поставить —
// засчитать (как будто он её добавил), снять — убрать ответственного (машина
// становится ничьей). Машины, занятые другими, помечены ником владельца.
//
// self-режим (модератор в своём профиле): можно брать себе только «незанятые»
// машины — чужие показываются, но галочка заблокирована (для явного отъёма
// есть страница самого пользователя или кнопка на странице машины).
//
// По подтверждению — один POST /api/cars/bulk-assign; каждая изменённая машина
// получает событие «{мод} засчитал машину…»/«снял ответственного» в свой фид,
// ачивки пересчитываются у всех затронутых.
// ─────────────────────────────────────────────────────────────────────────────

import { checkAchievementsNow } from './achievements.js';

export function openAssignCarsModal({ apiFetch, targetUser, self = false, onDone }) {
    const old = document.getElementById('assign-cars-modal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'assign-cars-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-backdrop"></div>
        <div class="modal-win">
            <div class="modal-head">
                <span>Назначить машины — ${esc(targetUser.display_name)}</span>
                <button class="btn btn-sec" id="assign-cars-close">✕</button>
            </div>
            <div class="modal-body">
                <p class="edit-oils-note">${self
                    ? 'Галочка — записать незанятую машину на себя, снять галочку — убрать себя из ответственных. Машины, занятые другими, брать себе нельзя.'
                    : 'Галочка — засчитать машину пользователю (как будто он её добавил), снять галочку — убрать с него ответственность. Занятые машины помечены ником владельца — их тоже можно переназначить.'}</p>
                <input type="text" id="assign-cars-search" placeholder="Фильтр по марке/модели…" autocomplete="off"/>
                <div id="assign-cars-list" class="assign-cars-list"><div class="search-empty">Загрузка…</div></div>
                <div id="assign-cars-error" class="edit-error hidden"></div>
                <div class="modal-actions">
                    <span id="assign-cars-summary" class="assign-cars-summary"></span>
                    <button class="btn btn-sec" id="assign-cars-cancel">Отмена</button>
                    <button class="btn btn-pri" id="assign-cars-save" disabled>Применить</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('.modal-backdrop').onclick = close;
    modal.querySelector('#assign-cars-close').onclick = close;
    modal.querySelector('#assign-cars-cancel').onclick = close;

    const listBox = modal.querySelector('#assign-cars-list');
    const errBox = modal.querySelector('#assign-cars-error');
    const saveBtn = modal.querySelector('#assign-cars-save');
    const summaryEl = modal.querySelector('#assign-cars-summary');
    const searchInput = modal.querySelector('#assign-cars-search');

    let cars = [];
    // car.id → true/false. Исходное состояние: true у машин targetUser.
    const initial = new Map();
    const checked = new Map();

    (async () => {
        try {
            cars = await apiFetch('/api/cars/owners');
        } catch (e) {
            listBox.innerHTML = `<div class="search-empty">Ошибка: ${esc(e.message)}</div>`;
            return;
        }
        for (const c of cars) {
            const own = !!c.owner && c.owner.id === targetUser.id;
            initial.set(c.id, own);
            checked.set(c.id, own);
        }
        draw();
    })();

    function carLabel(c) {
        const years = c.year_from ? ` · ${c.year_from}${c.year_to ? '–' + c.year_to : '+'}` : '';
        const extra = [c.generation, c.engine_code, c.engine_volume && `${c.engine_volume} л`]
            .filter(Boolean).join(' · ');
        return `${c.brand} ${c.model}${extra ? ' · ' + extra : ''}${years}`;
    }

    function diff() {
        const add = [];
        const remove = [];
        for (const c of cars) {
            const was = initial.get(c.id);
            const now = checked.get(c.id);
            if (!was && now) add.push(c.id);
            if (was && !now) remove.push(c.id);
        }
        return { add, remove };
    }

    function updateSummary() {
        const { add, remove } = diff();
        summaryEl.textContent = (add.length || remove.length)
            ? `+${add.length} / −${remove.length}`
            : '';
        saveBtn.disabled = !add.length && !remove.length;
    }

    function draw() {
        const q = searchInput.value.trim().toLowerCase();
        const shown = q
            ? cars.filter(c => carLabel(c).toLowerCase().includes(q))
            : cars;
        if (!shown.length) {
            listBox.innerHTML = '<div class="search-empty">Ничего не нашлось</div>';
            return;
        }
        listBox.innerHTML = shown.map(c => {
            const foreign = !!c.owner && c.owner.id !== targetUser.id;
            const disabled = self && foreign; // себе — только незанятые
            const ownerBadge = foreign
                ? `<span class="assign-car-owner" title="Сейчас засчитана этому пользователю">занята: ${esc(c.owner.display_name)}</span>`
                : '';
            return `
                <label class="assign-car-row${disabled ? ' assign-car-row-disabled' : ''}">
                    <input type="checkbox" data-car-id="${esc(c.id)}"
                           ${checked.get(c.id) ? 'checked' : ''} ${disabled ? 'disabled' : ''}/>
                    <span class="assign-car-name">${esc(carLabel(c))}</span>
                    ${ownerBadge}
                </label>`;
        }).join('');
        listBox.querySelectorAll('[data-car-id]').forEach(chk => {
            chk.onchange = () => {
                checked.set(chk.dataset.carId, chk.checked);
                updateSummary();
            };
        });
        updateSummary();
    }

    let searchTimer = null;
    searchInput.oninput = () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(draw, 150);
    };

    saveBtn.onclick = async () => {
        const { add, remove } = diff();
        if (!add.length && !remove.length) return;
        const parts = [];
        if (add.length) parts.push(`засчитать ${add.length}`);
        if (remove.length) parts.push(`снять ${remove.length}`);
        if (!confirm(`${parts.join(' и ')} машин(ы) — пользователь ${targetUser.display_name}. Применить?`)) return;

        errBox.classList.add('hidden');
        saveBtn.disabled = true;
        saveBtn.textContent = 'применяем…';
        try {
            await apiFetch('/api/cars/bulk-assign', {
                method: 'POST',
                body: { user_id: targetUser.id, add, remove },
            });
            close();
            checkAchievementsNow(); // мод мог записать машины на себя
            if (onDone) onDone();
        } catch (e) {
            errBox.textContent = e.message;
            errBox.classList.remove('hidden');
            saveBtn.disabled = false;
            saveBtn.textContent = 'Применить';
        }
    };
}

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
