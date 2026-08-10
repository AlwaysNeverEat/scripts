// ─────────────────────────────────────────────────────────────────────────────
// Поле ввода с подсказками из базы (марка, модель, поколение, двигатель).
//
// Это НЕ комбобокс из режима «Теги» (tagSearch.js): там выбирают из готового
// списка, а здесь заводят новую машину — значит, набрать можно и то, чего в
// базе ещё нет. Поэтому поле обычное текстовое, а список и предупреждение
// только показывают, что рядом уже есть похожее:
//
//   ✓ есть в базе          — набранное совпало с существующим значением;
//   ⚠ похоже на …          — «VW» при живом «Volkswagen», опечатка, кириллица;
//   + новое значение       — совпадений нет, заводим новое (это нормально).
//
// Вся логика сопоставления (синонимы, транслит, опечатки) живёт в
// shared/carSuggest.js и покрыта тестами — здесь только DOM и события.
// ─────────────────────────────────────────────────────────────────────────────

import { rankOptions, similarValues, exactMatch } from '../../shared/carSuggest.js';

// Пока input в фокусе, blur от клика по опции срабатывает раньше mousedown —
// закрытие списка откладываем (тот же приём, что в tagSearch.js).
const BLUR_CLOSE_DELAY_MS = 120;
const LIST_LIMIT = 40;

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Разметка одного поля с подсказками. attrs — то, что нужно самой форме
 * (data-edit и прочее), value — текущее значение.
 */
export function suggestFieldHtml({ label, attrs = '', value = '', placeholder = '' }) {
    return `
        <div class="edit-field sg-field">
            <span>${esc(label)}</span>
            <div class="sg-wrap">
                <input type="text" autocomplete="off" spellcheck="false" ${attrs}
                    value="${esc(value)}" placeholder="${esc(placeholder)}"/>
                <div class="sg-list hidden"></div>
            </div>
            <div class="sg-hint hidden"></div>
        </div>`;
}

const REASON_TEXT = {
    synonym: 'то же самое другими словами',
    prefix:  'начинается так же',
    part:    'входит целиком',
    similar: 'почти так же пишется',
};

/**
 * @param {HTMLInputElement} input
 * @param {{ load: () => Promise<Array>, onPick?: (value: string) => void }} deps
 *   load — откуда брать значения из базы: [{value, count}] либо [string].
 *          Зовётся лениво (первый фокус) и заново после refresh().
 */
export function attachSuggest(input, { load, onPick } = {}) {
    const wrap = input.closest('.sg-wrap');
    const field = input.closest('.sg-field');
    if (!wrap || !field) return { refresh() {}, destroy() {} };
    const list = wrap.querySelector('.sg-list');
    const hint = field.querySelector('.sg-hint');

    let options = [];
    let visible = [];
    let active = -1;
    let loading = null;
    let loaded = false;
    let closeTimer = 0;
    let picking = false;   // идёт подстановка значения — см. pick()

    function ensure() {
        if (loaded || loading) return loading || Promise.resolve();
        loading = Promise.resolve()
            .then(() => (load ? load() : []))
            .then(opts => { options = Array.isArray(opts) ? opts : []; loaded = true; })
            // Сеть отвалилась — поле остаётся обычным текстовым, а не ломается.
            .catch(() => { options = []; loaded = true; })
            .finally(() => { loading = null; updateHint(); if (!list.classList.contains('hidden')) renderList(); });
        return loading;
    }

    function renderList() {
        visible = rankOptions(input.value, options, { limit: LIST_LIMIT });
        active = -1;
        list.innerHTML = visible.length
            ? visible.map((o, i) => `
                <div class="sg-opt" data-idx="${i}">
                    <span class="sg-opt-val">${esc(o.value)}</span>
                    ${o.count ? `<span class="sg-opt-count">${o.count}</span>` : ''}
                </div>`).join('')
            : `<div class="sg-empty">${loaded ? 'В базе такого ещё нет — будет новое значение' : 'Загрузка…'}</div>`;
    }

    function open() {
        ensure();
        renderList();
        list.classList.remove('hidden');
    }

    function close() {
        list.classList.add('hidden');
        active = -1;
    }

    function highlight() {
        [...list.children].forEach((el, i) => el.classList.toggle('active', i === active));
        list.children[active]?.scrollIntoView({ block: 'nearest' });
    }

    // Значение из базы подставляем ЦЕЛИКОМ (вместе с регистром): цель поля —
    // не «похожая» строка, а ровно та же, что уже лежит в других машинах.
    // input/change обязаны улететь — на них висят и метки «изменено» в форме, и
    // перезагрузка зависимых списков (модели у марки). Но свой же обработчик
    // ввода на них срабатывать не должен: выбор только что закрыл список,
    // а он бы открыл его заново.
    function pick(value) {
        picking = true;
        input.value = value;
        close();
        try {
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        } finally {
            picking = false;
        }
        updateHint();
        if (onPick) onPick(value);
    }

    function updateHint() {
        const v = input.value.trim();
        // Пока открыт список, подсказку прячем: она стоит ровно под полем, и
        // выпадашка её перекрывает — по чипу «Volkswagen» было бы не попасть.
        // Пока список открыт, он и так показывает те же совпадения.
        const listOpen = !list.classList.contains('hidden');
        if (!v || !loaded || listOpen) { hint.classList.add('hidden'); hint.innerHTML = ''; return; }

        const hit = exactMatch(v, options);
        if (hit) {
            // Совпало по смыслу, но написано иначе («vw» при «Volkswagen» в
            // базе) — предлагаем ровно то написание, что уже есть.
            const differs = hit.value !== v;
            hint.className = 'sg-hint sg-hint-ok';
            hint.innerHTML = differs
                ? `В базе записано как <button type="button" class="sg-chip" data-sg-pick="${esc(hit.value)}">${esc(hit.value)}</button> — подставить`
                : `✓ такое значение в базе уже есть${hit.count ? ` (${hit.count})` : ''}`;
            return;
        }

        const near = similarValues(v, options);
        if (near.length) {
            hint.className = 'sg-hint sg-hint-warn';
            hint.innerHTML = '⚠ Похоже на то, что уже есть: '
                + near.map(n => `<button type="button" class="sg-chip" data-sg-pick="${esc(n.value)}"
                        title="${esc(REASON_TEXT[n.reason] || '')}">${esc(n.value)}${n.count ? ` · ${n.count}` : ''}</button>`).join(' ')
                + ' <span class="sg-hint-tail">— если это оно, выбери из базы, чтобы не плодить дубли</span>';
            return;
        }

        hint.className = 'sg-hint sg-hint-new';
        hint.innerHTML = '+ такого в базе нет — будет заведено новое значение';
    }

    input.addEventListener('focus', open);
    input.addEventListener('input', () => {
        if (picking) return;
        clearTimeout(closeTimer);
        ensure();
        renderList();
        // Список открываем только под курсором/фокусом: значение могли
        // подставить и программно, а висящая под чужим полем выпадашка —
        // это мусор на экране.
        if (document.activeElement === input) list.classList.remove('hidden');
        updateHint();
    });
    input.addEventListener('blur', () => {
        closeTimer = setTimeout(() => { close(); updateHint(); }, BLUR_CLOSE_DELAY_MS);
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { close(); return; }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (list.classList.contains('hidden')) open();
            active = Math.min(active + 1, visible.length - 1);
            highlight();
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            active = Math.max(active - 1, 0);
            highlight();
            return;
        }
        // Enter выбирает подсвеченное; без подсветки — не мешаем набирать своё.
        if (e.key === 'Enter' && active >= 0 && visible[active]) {
            e.preventDefault();
            pick(visible[active].value);
        }
    });
    list.addEventListener('mousedown', (e) => {
        e.preventDefault(); // не даём полю потерять фокус раньше выбора
        const el = e.target.closest('.sg-opt');
        if (!el) return;
        const item = visible[Number(el.dataset.idx)];
        if (item) pick(item.value);
    });
    hint.addEventListener('mousedown', (e) => e.preventDefault());
    hint.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-sg-pick]');
        if (btn) pick(btn.dataset.sgPick);
    });

    return {
        // Список зависит от соседнего поля (модели — от марки, двигатели — от
        // марки и модели): при его смене прежние значения уже не подходят.
        refresh() {
            loaded = false;
            loading = null;
            options = [];
            if (document.activeElement === input) open();
            else { hint.classList.add('hidden'); ensure(); }
        },
    };
}
