// ─────────────────────────────────────────────────────────────────────────────
// Окошко «привязать машину к лиду» на странице машины (калькулятор).
//
// Оператор открыл лид во вкладке «Лиды», ушёл в калькулятор и нашёл машину
// клиента — в этот момент в углу всплывает маленькое окошко: «Привязать к
// лиду». Привязанная машина потом открывается из карточки лида кликом (и
// считается тут же), а в новую запись сама ложится в комментарий («Kia Rio»).
// Если машина уже привязана — то же окошко предлагает отвязать.
//
// Окошко ПЛАВАЮЩЕЕ и маленькое, а не блок в странице: оно про лид, а не про
// машину, и при поиске без звонка его быть не должно вовсе. Лид берётся из
// leadPick.js — тот же «открытый лид», что заполняет окно записи, с тем же
// сроком в полчаса. Крестик прячет окошко для ЭТОЙ пары «лид + машина»:
// следующая машина или другой лид покажут его снова.
// ─────────────────────────────────────────────────────────────────────────────

import './leadCarDock.css';
import { pickedLead, carShort, touchPickedLead } from './leadPick.js';
import { cachedLeadCars, loadLeadCars, bindLeadCar, unbindLeadCar, carLine, LEAD_CARS_EVENT } from './leadCars.js';
import { phone11 } from '../../shared/crmLeads.js';
import { formatRuPhone } from '../../shared/crmRecords.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

export function mountLeadCarDock({ apiFetch }) {
    const el = document.createElement('div');
    el.className = 'lcd hidden';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Машина и лид');
    document.body.appendChild(el);

    let car = null;       // открытая машина (строка /api/cars/:id)
    let shown = false;    // страница машины на экране
    let busy = false;
    let error = '';
    const dismissed = new Set(); // «телефон:машина», закрытые крестиком
    const loading = new Set();   // телефоны, чьи машины уже спрашиваем

    // Лид без телефона привязать не к чему: клиент у нас — это номер.
    const lead = () => {
        const l = pickedLead();
        const phone = phone11(l?.phone);
        return phone ? { ...l, phone } : null;
    };

    function render() {
        const l = shown && car ? lead() : null;
        if (!l || dismissed.has(`${l.phone}:${car.id}`)) { el.classList.add('hidden'); return; }
        const cars = cachedLeadCars(l.phone);
        if (!cars && !loading.has(l.phone)) {
            loading.add(l.phone);
            loadLeadCars(apiFetch, l.phone)
                .catch(e => { error = e.message || 'не удалось узнать машины лида'; })
                .finally(() => { loading.delete(l.phone); render(); });
        }
        const bound = cars?.some(c => c.id === car.id);
        const others = (cars || []).filter(c => c.id !== car.id);
        const short = carShort(car) || 'эту машину';
        const who = [l.name, formatRuPhone(l.phone)].filter(Boolean).map(esc).join(' · ');

        let action;
        if (!cars) {
            action = error ? '' : '<div class="lcd-muted">Смотрю машины лида…</div>';
        } else if (bound) {
            action = `<div class="lcd-state lcd-on">${esc(short)} привязана к лиду</div>
                <button type="button" class="btn btn-sec lcd-btn" data-act="unbind"${busy ? ' disabled' : ''}>${busy ? 'Отвязываю…' : 'Отвязать'}</button>`;
        } else {
            action = `<div class="lcd-state">Привязать ${esc(short)} к лиду?</div>
                <button type="button" class="btn btn-pri lcd-btn" data-act="bind"${busy ? ' disabled' : ''}>${busy ? 'Привязываю…' : 'Привязать'}</button>`;
        }
        el.innerHTML = `
            <div class="lcd-head">
                <span class="lcd-who" title="Открытый лид">Лид: ${who}</span>
                <button type="button" class="lcd-x" data-act="close" title="Скрыть для этой машины" aria-label="Скрыть">×</button>
            </div>
            ${action}
            ${error ? `<div class="lcd-err">${esc(error)}</div>` : ''}
            ${others.length ? `<div class="lcd-others">Ещё у клиента: ${others.map(c =>
                `<a href="/car/${esc(c.id)}" class="lcd-link" title="${esc(carLine(c))}">${esc(carShort(c))}</a>`).join(', ')}</div>` : ''}`;
        el.classList.remove('hidden');
    }

    async function run(fn) {
        const l = lead();
        if (!l || busy) return;
        busy = true; error = ''; render();
        try {
            await fn(l.phone);
            touchPickedLead();
        } catch (e) {
            error = e.message || 'не получилось — попробуйте ещё раз';
        }
        busy = false; render();
    }

    el.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'close') {
            const l = lead();
            if (l && car) dismissed.add(`${l.phone}:${car.id}`);
            render();
        }
        if (act === 'bind') run(phone => bindLeadCar(apiFetch, phone, car.id));
        if (act === 'unbind') run(phone => unbindLeadCar(apiFetch, phone, car.id));
    });
    window.addEventListener(LEAD_CARS_EVENT, () => { if (shown) render(); });

    return {
        // Открыли страницу машины (или вернулись на неё): лид мог смениться,
        // пока человек был в «Лидах», — каждый показ читает его заново.
        show(record) {
            if (record) car = record;
            error = '';
            shown = true;
            render();
        },
        hide() { shown = false; el.classList.add('hidden'); },
    };
}
