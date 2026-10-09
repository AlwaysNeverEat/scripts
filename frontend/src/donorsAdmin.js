// ─────────────────────────────────────────────────────────────────────────────
// Окно «Пополнения» — внести донат поддержавшего: кто, когда, сколько.
// Открывается из настроек профиля и только у того, кто платит за сервер
// (isDonationAdmin в shared/donations.js); сервер проверяет то же самое сам —
// спрятанная кнопка не запрет.
//
// Каждое пополнение — отдельная строка навсегда; «за месяц» и «всего» в панели
// справа считаются из них. Удалить можно только ошибочно внесённое (не тот
// человек, лишний ноль) — для этого у строки крестик с подтверждением.
// После любого изменения панель справа обновляется сама (событие
// `donors-changed`).
// ─────────────────────────────────────────────────────────────────────────────

import { mskToday, parseAmount, rub } from '../../shared/donations.js';

const MODAL_ID = 'donors-admin-modal';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function humanDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || '');
}

export function openDonorsAdmin({ apiFetch }) {
    document.getElementById(MODAL_ID)?.remove();
    const state = {
        q: '', users: [], picked: null, date: mskToday(), amount: '',
        entries: [], loading: true, saving: false, error: '', confirmDel: null, flash: '',
    };
    let qTimer = null;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-backdrop"></div>
        <div class="modal-win dna-win">
            <div class="modal-head">
                <span>Пополнения от поддержавших</span>
                <button class="btn btn-sec" data-act="close">✕</button>
            </div>
            <div class="modal-body dna-body">
                <div class="dna-form">
                    <label class="dna-field dna-who"><span>Кто</span>
                        <input class="ld-in" data-f="q" placeholder="Имя или логин" autocomplete="off">
                        <div class="dna-pick" data-pick></div>
                    </label>
                    <label class="dna-field"><span>Дата пополнения</span>
                        <input class="ld-in" data-f="date" type="date" max="${esc(state.date)}" value="${esc(state.date)}"></label>
                    <label class="dna-field"><span>Сумма, ₽</span>
                        <input class="ld-in" data-f="amount" inputmode="numeric" placeholder="1 000" autocomplete="off"></label>
                    <button type="button" class="btn btn-pri dna-add" data-act="add">Добавить</button>
                </div>
                <div data-msg></div>
                <div class="dna-list" data-list></div>
            </div>
        </div>`;
    document.body.appendChild(modal);

    const $ = (s) => modal.querySelector(s);
    const close = () => { clearTimeout(qTimer); modal.remove(); };
    modal.querySelector('.modal-backdrop').onclick = close;
    $('[data-act="close"]').onclick = close;
    const changed = () => window.dispatchEvent(new Event('donors-changed'));

    function renderPick() {
        const box = $('[data-pick]');
        if (state.picked) {
            box.innerHTML = `<span class="dna-chosen">${esc(state.picked.name)} <span class="dna-muted">@${esc(state.picked.login)}</span>
                <button type="button" class="dna-x" data-act="unpick" aria-label="Выбрать другого">✕</button></span>`;
        } else if (state.users.length) {
            box.innerHTML = state.users.map(u => `<button type="button" class="ld-chip" data-user="${esc(u.id)}">${esc(u.name)} <span class="dna-muted">@${esc(u.login)}</span></button>`).join('');
        } else {
            box.innerHTML = state.q ? '<span class="dna-muted">Никого не нашлось</span>' : '';
        }
        $('[data-f="q"]').classList.toggle('hidden', !!state.picked);
        box.querySelectorAll('[data-user]').forEach(b => {
            b.onclick = () => {
                state.picked = state.users.find(u => u.id === b.dataset.user) || null;
                renderPick();
                $('[data-f="amount"]').focus();
            };
        });
        const un = box.querySelector('[data-act="unpick"]');
        if (un) un.onclick = () => { state.picked = null; renderPick(); $('[data-f="q"]').focus(); };
    }

    function renderMsg() {
        $('[data-msg]').innerHTML = state.error
            ? `<div class="ld-err">${esc(state.error)}</div>`
            : state.flash ? `<div class="ld-ok">${esc(state.flash)}</div>` : '';
    }

    function renderList() {
        const box = $('[data-list]');
        if (state.loading) { box.innerHTML = '<div class="dna-muted">Загружаю…</div>'; return; }
        if (!state.entries.length) { box.innerHTML = '<div class="dna-muted">Пополнений ещё не вносили.</div>'; return; }
        box.innerHTML = `<div class="dna-list-head">Внесённые — свежие сверху</div>` + state.entries.map(e => `
            <div class="dna-entry">
                <span class="dna-date">${esc(humanDate(e.date))}</span>
                <span class="dna-name">${esc(e.name)}</span>
                <b class="dna-sum">${rub(e.amount)}</b>
                ${state.confirmDel === e.id
                    ? `<span class="dna-confirm">Удалить? <button type="button" class="btn btn-sec dna-mini" data-del-yes="${esc(e.id)}">Да</button><button type="button" class="btn btn-sec dna-mini" data-del-no>Нет</button></span>`
                    : `<button type="button" class="dna-x" data-del="${esc(e.id)}" title="Удалить ошибочно внесённое" aria-label="Удалить">✕</button>`}
            </div>`).join('');
        box.querySelectorAll('[data-del]').forEach(b => { b.onclick = () => { state.confirmDel = b.dataset.del; renderList(); }; });
        box.querySelectorAll('[data-del-no]').forEach(b => { b.onclick = () => { state.confirmDel = null; renderList(); }; });
        box.querySelectorAll('[data-del-yes]').forEach(b => { b.onclick = () => remove(b.dataset.delYes); });
    }

    async function loadEntries() {
        try {
            state.entries = (await apiFetch('/api/donors/entries')).entries || [];
        } catch (e) {
            state.error = `Список не загрузился: ${e.message || 'сервер не ответил'}`;
            renderMsg();
        }
        state.loading = false;
        renderList();
    }

    async function search() {
        try {
            state.users = (await apiFetch(`/api/donors/users?q=${encodeURIComponent(state.q)}`)).users || [];
        } catch { state.users = []; }
        renderPick();
    }

    async function add() {
        if (state.saving) return;
        state.error = ''; state.flash = '';
        const amount = parseAmount($('[data-f="amount"]').value);
        const date = $('[data-f="date"]').value;
        if (!state.picked) state.error = 'Выберите, кто поддержал.';
        else if (!amount) state.error = 'Сумма — целое число рублей.';
        if (state.error) return renderMsg();
        state.saving = true;
        const btn = $('[data-act="add"]');
        btn.disabled = true; btn.textContent = 'Добавляю…';
        try {
            await apiFetch('/api/donors/entries', { method: 'POST', body: { userId: state.picked.id, date, amount } });
            state.flash = `Добавлено: ${state.picked.name} — ${rub(amount)} от ${humanDate(date)}`;
            state.picked = null; state.q = ''; state.users = [];
            $('[data-f="q"]').value = ''; $('[data-f="amount"]').value = '';
            renderPick();
            changed();
            await loadEntries();
        } catch (e) {
            state.error = e.message || 'не сохранилось';
        }
        state.saving = false;
        btn.disabled = false; btn.textContent = 'Добавить';
        renderMsg();
    }

    async function remove(id) {
        try {
            await apiFetch(`/api/donors/entries/${id}`, { method: 'DELETE' });
            state.entries = state.entries.filter(e => e.id !== id);
            state.flash = 'Удалено.'; state.error = '';
            changed();
        } catch (e) {
            state.error = `Не удалилось: ${e.message || 'сервер не ответил'}`;
        }
        state.confirmDel = null;
        renderMsg();
        renderList();
    }

    $('[data-f="q"]').oninput = (e) => {
        state.q = e.target.value.trim();
        clearTimeout(qTimer);
        qTimer = setTimeout(search, 250);
    };
    $('[data-f="amount"]').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
    $('[data-act="add"]').onclick = add;

    renderPick();
    renderList();
    loadEntries();
    search();
    $('[data-f="q"]').focus();
}
