// ─────────────────────────────────────────────────────────────────────────────
// Страница машины: шапка с данными, плашки сервис-флагов, заметка,
// ниже — живой калькулятор (initCalculator).
//
// Правка данных живёт отдельным окном с вкладками (carEditor.js): раньше она
// разворачивалась прямо здесь одной простынёй полей на всю машину сразу.
// ─────────────────────────────────────────────────────────────────────────────

import { initCalculator } from './calculator.js';
import { initCrmPanel } from './crmPanel.js';
import { checkAchievementsNow } from './achievements.js';
import { openCarEditor } from './carEditor.js';
import { activeFlags } from '../../shared/serviceFlags.js';
import { crmQuirksFor, SEVERITY_LABELS } from '../../shared/crmQuirks.js';
import { fuelLabel } from '../../shared/fuel.js';
import { SOURCE_SITES, SOURCE_LABELS } from '../../shared/sourceLinks.js';
import { namePrefixHtml } from './namePrefix.js';
import { arrowRightIcon } from './icons.js';
import { describeCarChanges, changedFieldLabels } from '../../shared/carDiff.js';
import { initSegmented } from './segmented.js';

// К какому агрегату относится особенность из CRM — подпись перед текстом,
// чтобы «полную не делаем» не путали с правилом для механики.
const SCOPE_LABELS = {
    engine:    'ДВС:',
    automatic: 'АКПП / вариатор:',
    manual:    'МКПП:',
    general:   '',
};

export function initCarPage(record, { apiFetch, onChanged, user }) {
    initSegmented();   // пробег, промывка, тип АКПП — см. segmented.js
    renderHead(record, { apiFetch, onChanged, user });
    initCalculator(record);
    initCrmPanel(record, { apiFetch });
    renderEvents(record.id, { apiFetch, user });
}

// ── Шапка ─────────────────────────────────────────────────────────────────────

function renderHead(record, ctx) {
    const head = document.getElementById('car-head');
    if (!head) return;
    head.innerHTML = renderView(record, ctx);
    bindView(head, record, ctx);

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
        record.engine_name && esc(record.engine_name),
        record.engine_code && `<span class="mono">${esc(record.engine_code)}</span>`,
        record.engine_volume && `${record.engine_volume} л`,
        (record.bhp || record.kw) && (record.bhp ? `${record.bhp} л.с.` : `${record.kw} кВт`),
        fuel,
        years,
    ].filter(Boolean).map(c => `<span class="head-chip">${c}</span>`).join('');

    // Каждому типу данных — своя подписанная секция, чтобы ничего не «висело»
    // в шапке безымянным (теги, флаги и ссылки не путались между собой).
    const section = (label, bodyHtml) => bodyHtml ? `
        <div class="head-sec">
            <div class="head-sec-lbl">${label}</div>
            <div class="head-sec-body">${bodyHtml}</div>
        </div>` : '';

    const flags = activeFlags(record.service_flags);
    const flagsHtml = flags.length
        ? `<div class="head-flags">${flags.map(f =>
            `<span class="head-flag${f.warn ? ' head-flag-warn' : ''}">${esc(f.label)}</span>`).join('')}</div>`
        : '';

    const notesHtml = record.notes
        ? `<div class="head-notes">${esc(record.notes)}</div>`
        : '';

    // Особенности из CRM подставляются сами по марке и модели — их не правят
    // на этой странице, поэтому отдельной секцией, а не рядом с флагами,
    // которые проставляет человек.
    const quirks = crmQuirksFor(record, record.fluid_capacities || {});
    const quirksHtml = quirks.length
        ? `<div class="head-quirks">${quirks.map(q => `
            <div class="head-quirk head-quirk-${q.severity}">
                <span class="head-quirk-tag">${esc(SEVERITY_LABELS[q.severity])}</span>
                <span class="head-quirk-body">
                    <span class="head-quirk-scope">${esc(SCOPE_LABELS[q.scope] || '')}</span>
                    ${esc(q.text)}
                    ${q.note ? `<span class="head-quirk-note">${esc(q.note)}</span>` : ''}
                </span>
            </div>`).join('')}</div>`
        : '';

    const tags = Array.isArray(record.tags) ? record.tags : [];
    const tagsHtml = tags.length
        ? `<div class="head-tags">${tags.map(t =>
            `<span class="head-tag">${esc(t)}</span>`).join('')}</div>`
        : '';

    const links = record.source_links || {};
    const srcBtns = SOURCE_SITES.filter(s => links[s]).map(s =>
        `<a class="src-btn src-btn-${s}" href="${esc(links[s])}" target="_blank" rel="noopener">${esc(SOURCE_LABELS[s])} ↗</a>`).join('');
    const sourcesHtml = srcBtns ? `<div class="head-sources">${srcBtns}</div>` : '';

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
                <span class="head-actions">
                    <button class="btn btn-sec" id="btn-edit-car" title="исправить данные машины">Исправить данные</button>
                    ${isMod ? '<button class="btn btn-sec" id="btn-assign-car">Назначить ответственного</button>' : ''}
                    ${isMod ? '<button class="btn btn-sec btn-danger" id="btn-delete-car">Удалить машину</button>' : ''}
                </span>
            </div>
            <div class="head-chips">${chips}</div>
            <div class="head-secs">
                ${section('Страницы машины', sourcesHtml)}
                ${section('Особенности обслуживания', flagsHtml)}
                ${section('Особенности из CRM', quirksHtml)}
                ${section('Заметка', notesHtml)}
                ${section('Теги для поиска', tagsHtml)}
                ${section('История', recHtml)}
            </div>
        </div>
    `;
}

function bindView(head, record, ctx) {
    const btn = head.querySelector('#btn-edit-car');
    if (btn) btn.onclick = () => openCarEditor(record, ctx);

    const delBtn = head.querySelector('#btn-delete-car');
    if (delBtn) delBtn.onclick = () => confirmDeleteCar(record, ctx);

    const assignBtn = head.querySelector('#btn-assign-car');
    if (assignBtn) assignBtn.onclick = () => openAssignModal(record, ctx);
}

// ── Назначить ответственного (модератор) ──────────────────────────────────────
// Переатрибутировать машину пользователю, как будто он её добавил (можно и
// себе). Сервер перепишет 'added'-событие, добавит 'reassigned' в фид и
// пересчитает ачивки обоих участников — здесь только выбор пользователя.

function openAssignModal(record, ctx) {
    const old = document.getElementById('assign-car-modal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'assign-car-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-backdrop"></div>
        <div class="modal-win modal-win-sm">
            <div class="modal-head">
                <span>Назначить ответственного</span>
                <button class="btn btn-sec" id="assign-close">✕</button>
            </div>
            <div class="modal-body">
                <p class="edit-oils-note">Машина «${esc(record.brand)} ${esc(record.model)}» будет засчитана
                   выбранному пользователю, как будто он её добавил. Счётчики и достижения
                   пересчитаются у обоих: у прежнего автора и у нового.</p>
                <input type="text" id="assign-search" placeholder="Поиск по нику или логину…" autocomplete="off"/>
                <div id="assign-list" class="assign-list"><div class="search-empty">Загрузка…</div></div>
                <div id="assign-error" class="edit-error hidden"></div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('.modal-backdrop').onclick = close;
    modal.querySelector('#assign-close').onclick = close;

    const listBox = modal.querySelector('#assign-list');
    const errBox = modal.querySelector('#assign-error');
    const searchInput = modal.querySelector('#assign-search');

    async function loadUsers(q) {
        try {
            const users = await ctx.apiFetch('/api/users' + (q ? '?q=' + encodeURIComponent(q) : ''));
            drawUsers(users);
        } catch (e) {
            listBox.innerHTML = `<div class="search-empty">Ошибка: ${esc(e.message)}</div>`;
        }
    }

    function drawUsers(users) {
        if (!users.length) {
            listBox.innerHTML = '<div class="search-empty">Никого не нашлось</div>';
            return;
        }
        listBox.innerHTML = users.map(u => `
            <button class="assign-user" data-assign-id="${esc(u.id)}" data-assign-name="${esc(u.display_name)}">
                <span class="assign-user-avatar">${u.avatar ? `<img src="${esc(u.avatar)}" alt=""/>` : ''}</span>
                <span class="assign-user-name">${namePrefixHtml(u)}${esc(u.display_name)}</span>
            </button>
        `).join('');
        listBox.querySelectorAll('[data-assign-id]').forEach(btn => {
            btn.onclick = () => assign(btn.dataset.assignId, btn.dataset.assignName, btn);
        });
    }

    async function assign(userId, name, btn) {
        if (!confirm(`Засчитать машину «${record.brand} ${record.model}» пользователю ${name}?`)) return;
        errBox.classList.add('hidden');
        btn.disabled = true;
        try {
            await ctx.apiFetch('/api/cars/' + record.id + '/assign', {
                method: 'POST',
                body: { user_id: userId },
            });
            close();
            checkAchievementsNow(); // модератор мог назначить машину самому себе
            ctx.onChanged(); // перерисует страницу — в фиде появится «засчитал машину»
        } catch (e) {
            errBox.textContent = e.message;
            errBox.classList.remove('hidden');
            btn.disabled = false;
        }
    }

    let searchTimer = null;
    searchInput.oninput = () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => loadUsers(searchInput.value.trim()), 250);
    };
    searchInput.focus();
    loadUsers('');
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
                <span>Удалить машину</span>
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
            errBox.textContent = e.message;
            errBox.classList.remove('hidden');
            btn.disabled = false;
            btn.textContent = 'Удалить безвозвратно';
        }
    };
}

// ── Лента событий машины (только этой машины, хронологически) ─────────────────
// Плашки «добавлена»/«отредактирована» с крупной аватаркой автора. Машины без
// created_by не показывают плашку добавления — просто нет такого события.

// По умолчанию лента свёрнута до 3 последних изменений (новые сверху), чтобы не
// растягивать страницу. Кнопка разворачивает всю историю в компактном скролле.
const EVENTS_COLLAPSED = 3;

// Экспортируется ради песочницы frontend/dev-diff.html: ленту и окно разбора
// нужно уметь смотреть без бэкенда.
export async function renderEvents(carId, ctx) {
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

    // С сервера события идут по возрастанию (старые → новые). Разворачиваем,
    // чтобы «Последние изменения» были сверху.
    const ordered = events.slice().reverse();
    const hasMore = ordered.length > EVENTS_COLLAPSED;
    let expanded = false;

    const draw = () => {
        const shown = expanded ? ordered : ordered.slice(0, EVENTS_COLLAPSED);
        const toggle = hasMore
            ? `<button class="btn btn-sec btn-mini events-toggle" id="events-toggle">${
                expanded ? '▲ Скрыть историю' : `▼ Показать всю историю (${ordered.length})`
              }</button>`
            : '';
        box.innerHTML = `
            <div class="events-wrap">
                <div class="sec-title">Последние изменения</div>
                <div class="events-feed${expanded ? ' events-feed-scroll' : ''}">
                    ${shown.map((ev, i) => renderEventCard(ev, i)).join('')}
                </div>
                ${toggle}
            </div>
        `;
        bind();
    };

    const bind = () => {
        box.querySelectorAll('[data-event-idx]').forEach(card => {
            const ev = ordered[parseInt(card.dataset.eventIdx, 10)];
            if (ev && ev.type === 'edited') card.onclick = () => openEventDetails(ev);
        });
        box.querySelectorAll('[data-user-link]').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation(); // не даём сработать открытию диффа у edited-карточки
                location.hash = '#/user/' + el.dataset.userLink;
            };
        });
        const toggleBtn = box.querySelector('#events-toggle');
        if (toggleBtn) toggleBtn.onclick = () => { expanded = !expanded; draw(); };
    };

    draw();
}

function userChipHtml(u) {
    if (!u) return '<b>неизвестный пользователь</b>';
    return `<span class="event-user" data-user-link="${esc(u.id)}" role="button" tabindex="0" title="Открыть профиль коллеги">${namePrefixHtml(u)}<b>${esc(u.display_name)}</b></span>`;
}

function renderEventCard(ev, i) {
    const isAdded = ev.type === 'added';
    const isReassigned = ev.type === 'reassigned';
    const avatarHtml = ev.user && ev.user.avatar
        ? `<img src="${esc(ev.user.avatar)}" alt=""/>`
        : `<span class="event-avatar-default"></span>`;
    const when = new Date(ev.created_at).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });

    const avatarLinkAttr = ev.user ? `data-user-link="${esc(ev.user.id)}" title="Открыть профиль"` : '';
    const userChip = userChipHtml(ev.user);

    // «{модератор} засчитал машину пользователю {ник}» — оба ника кликабельны.
    // target_user нет — модератор снял ответственного (машина стала ничьей).
    const text = isReassigned
        ? (ev.target_user
            ? `${userChip} засчитал машину пользователю ${userChipHtml(ev.target_user)}`
            : `${userChip} снял ответственного с машины`)
        : `${isAdded ? 'Машина добавлена' : 'Отредактировано'} пользователем ${userChip}`;

    const cardClass = isAdded ? 'event-card-added'
        : isReassigned ? 'event-card-reassigned' : 'event-card-edited';
    const clickable = ev.type === 'edited';

    // Что именно правили, видно НЕ ОТКРЫВАЯ карточку: у машины правят по одному
    // полю, и ради «мощность» открывать окно незачем. Больше трёх подписей в
    // строку не влезает — остальные считаются числом.
    const fieldNames = clickable ? changedFieldLabels(ev.changed_fields) : [];
    const shownNames = fieldNames.slice(0, 3);
    const restCount = fieldNames.length - shownNames.length;
    const fieldsHtml = shownNames.length ? `
        <div class="event-fields">
            ${shownNames.map(n => `<span class="event-field">${esc(n)}</span>`).join('')}
            ${restCount > 0 ? `<span class="event-field event-field-more">ещё ${restCount}</span>` : ''}
        </div>` : '';

    return `
        <div class="event-card ${cardClass}"
             data-event-idx="${i}" ${clickable ? 'role="button" tabindex="0"' : ''}
             ${clickable ? 'title="Открыть: что именно изменили"' : ''}>
            <div class="event-avatar" ${avatarLinkAttr}>${avatarHtml}</div>
            <div class="event-body">
                <div class="event-text">${text}</div>
                ${fieldsHtml}
                <div class="event-date">${when}</div>
            </div>
        </div>
    `;
}

// ── Окно «Что изменили» ───────────────────────────────────────────────────────
// Разбор события в человеческий список живёт в shared/carDiff.js, здесь только
// вёрстка. Раньше окно показывало сырьё changed_fields как есть — два JSON'а,
// зачёркнутый и зелёный, — и увидеть в них, что поменялся ОДИН салонный фильтр,
// было нельзя: приходилось сравнивать глазами две простыни символов.
//
// Теперь у каждого изменения три вещи, которые и отвечают на «что случилось»:
// бейдж «добавили / изменили / убрали», русская подпись поля и пара «было →
// стало» с подписанными сторонами. Составные поля (фильтры, ссылки, агрегаты)
// разворачиваются в строки по частям, и в списке остаются ТОЛЬКО изменившиеся:
// неизменившийся масляный фильтр из окна пропадает совсем.

const OP_LABELS = { added: 'добавили', removed: 'убрали', changed: 'изменили' };

function openEventDetails(ev) {
    const old = document.getElementById('event-details-modal');
    if (old) old.remove();

    const { total, same, groups } = describeCarChanges(ev.changed_fields);
    const when = new Date(ev.created_at).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' });
    const who = ev.user ? ev.user.display_name : 'неизвестный пользователь';
    const count = total ? ` · ${total} ${plural(total, 'поле', 'поля', 'полей')}` : '';

    // Поля, у которых значение совпало (число из формы против строки из базы),
    // в список не идут — но и пропадать молча не должны: иначе «правка есть, а
    // изменений нет» выглядит как потерянные данные.
    const sameNote = same
        ? `<div class="diff-same">Ещё ${same} ${plural(same, 'поле записано', 'поля записаны', 'полей записаны')} в правку, но значение осталось прежним.</div>`
        : '';
    const bodyHtml = total
        ? groups.map(diffGroupHtml).join('') + sameNote
        : (same
            ? `<div class="search-empty">Правка ничего не изменила: все ${same} ${plural(same, 'записанное поле совпало', 'записанных поля совпали', 'записанных полей совпали')} с прежним значением.</div>`
            : '<div class="search-empty">Изменённые поля не записаны</div>');

    const modal = document.createElement('div');
    modal.id = 'event-details-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-backdrop"></div>
        <div class="modal-win diff-win">
            <div class="modal-head diff-head">
                <div class="diff-head-txt">
                    <span>Что изменили</span>
                    <span class="diff-head-sub">${esc(who)} · ${esc(when)}${count}</span>
                </div>
                <button class="btn btn-sec" id="event-details-close" title="Закрыть">✕</button>
            </div>
            <div class="modal-body diff-body">
                ${ev.comment ? `<div class="diff-comment"><span class="diff-comment-lbl">Комментарий к правке</span>${esc(ev.comment)}</div>` : ''}
                ${bodyHtml}
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const close = () => {
        document.removeEventListener('keydown', onKey);
        modal.remove();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    modal.querySelector('.modal-backdrop').onclick = close;
    modal.querySelector('#event-details-close').onclick = close;
}

// Группа = вкладка окна правки: человек правил «Фильтры ДВС» и ищет здесь ту же
// самую «Фильтры ДВС».
function diffGroupHtml(group) {
    return `
        <div class="diff-group">
            <div class="diff-group-head">
                <span class="diff-group-name">${esc(group.label)}</span>
                <span class="diff-group-count">${group.rows.length}</span>
            </div>
            ${group.rows.map(diffRowHtml).join('')}
        </div>`;
}

function diffRowHtml(row) {
    let body;
    if (row.kind === 'items') body = `<div class="diff-items">${row.items.map(diffItemHtml).join('')}</div>`;
    else if (row.kind === 'list') body = diffChipsHtml(row);
    else body = diffPairHtml(row.from, row.to, { raw: row.raw });

    return `
        <div class="diff-row diff-row-${row.op}">
            <div class="diff-row-head">
                <span class="diff-badge diff-badge-${row.op}">${OP_LABELS[row.op]}</span>
                <span class="diff-row-name">${esc(row.label)}</span>
            </div>
            ${body}
        </div>`;
}

// Строка составного поля: слева — что именно внутри поля («Салонный (сф)»,
// «ДВС · объём частичной, л»), справа — что с ним стало.
function diffItemHtml(item) {
    const value = item.text
        ? `<span class="diff-note diff-note-${item.op}">${esc(item.text)}</span>`
        : diffPairHtml(item.from, item.to, { href: item.href, titleTo: item.fullTo, titleFrom: item.fullFrom });
    return `
        <div class="diff-item">
            <span class="diff-item-name">${esc(item.label)}</span>
            ${value}
        </div>`;
}

// Пара «было → стало». Стороны подписаны всегда: без подписей одинокое зелёное
// значение у добавленного поля читается как «а что было-то?».
function diffPairHtml(from, to, { raw = false, href = null, titleFrom = null, titleTo = null } = {}) {
    const side = (cap, text, cls, link, title) => {
        const empty = text == null || text === '';
        const inner = empty
            ? '<span class="diff-val diff-val-empty">не заполнено</span>'
            : (link && /^https?:\/\//i.test(link)
                ? `<a class="diff-val ${cls}" href="${esc(link)}" target="_blank" rel="noopener"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</a>`
                : `<span class="diff-val ${cls}${raw ? ' diff-val-raw' : ''}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`);
        return `<div class="diff-side"><span class="diff-cap">${cap}</span>${inner}</div>`;
    };
    return `
        <div class="diff-pair">
            ${side('было', from, 'diff-val-old', null, titleFrom)}
            <span class="diff-arrow">${arrowRightIcon(14)}</span>
            ${side('стало', to, 'diff-val-new', href, titleTo)}
        </div>`;
}

// Теги и допуска — список: «было → стало» на нём врало бы, там меняются
// отдельные строки, а не значение целиком.
function diffChipsHtml(row) {
    const chips = [
        ...row.removed.map(t => `<span class="diff-chip diff-chip-del">−&nbsp;${esc(t)}</span>`),
        ...row.added.map(t => `<span class="diff-chip diff-chip-add">+&nbsp;${esc(t)}</span>`),
    ].join('');
    return `<div class="diff-chips">${chips}</div>`;
}

function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
