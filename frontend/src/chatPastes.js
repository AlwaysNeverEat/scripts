// ─────────────────────────────────────────────────────────────────────────────
// Пасты во вкладке «Чаты» — панель справа от переписки: заготовленные ответы,
// разложенные по темам. Правила (тема, потолки, стартовый набор) —
// shared/chatPastes.js, хранение — /api/chat/pastes (backend/src/chat/pastes.js).
//
// Главное действие — «Вставить»: паста ложится в поле ответа на место каретки,
// и выделяется первый пропуск «_», чтобы его сразу перепечатать. Отправляет
// всё равно человек: паста — заготовка, а не автоответ, в ней почти всегда
// есть что дописать (адрес, цену, время).
//
// Тема над списком — фильтр: «Все» или одна тема. Помнится на устройстве по
// аккаунту, как код оператора в «Лидах»: за одним компьютером сидят по сменам.
//
// В редакторе темы выбираются из уже существующих (таблетки под полем) или
// набираются новые; набранная другим регистром пишется как существующая. Поля
// редактора при наборе НЕ перерисовываются — перерисовка съела бы каретку;
// пересобирается только список подсказок под полем темы.
// ─────────────────────────────────────────────────────────────────────────────

import {
    TOPIC_MAX, TOPICS_MAX, TITLE_MAX, BODY_MAX, canonTopic, topicsOf, filterPastes,
} from '../../shared/chatPastes.js';

const TOPIC_KEY = 'zm_paste_topic';
const FLASH_MS = 1500;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const svg = (body, size = 13) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
    insert: (s) => svg('<polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>', s),
    copy: (s) => svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>', s),
    edit: (s) => svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', s),
    trash: (s) => svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>', s),
    check: (s) => svg('<polyline points="20 6 9 17 4 12"/>', s),
    plus: (s) => svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>', s),
    x: (s) => svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', s),
    search: (s) => svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', s),
    paste: (s) => svg('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>', s),
};

// Буфер обмена: по живому клику (иначе браузер откажет), с запасным путём
// для http и старых браузеров.
async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        ta.remove();
        return ok;
    }
}

export function initChatPastes({ host, apiFetch, getUserId = () => null, onInsert = () => false, onClose = () => {} }) {
    const state = {
        pastes: [],
        status: 'idle',    // idle | loading | ready | error
        error: '',         // ошибка загрузки или действия — строкой над списком
        topic: '',
        q: '',
        editing: null,     // { id | null, title, body, topics, topicInput, error, saving }
        confirmDel: null,  // id пасты, которую спросили «удалить?»
        deleting: null,
        expanded: new Set(),
        flash: null,       // { id, act, text } — «Скопировано» на кнопке
    };
    let flashTimer = null;

    const topicStoreKey = () => `${TOPIC_KEY}:${getUserId() || 'anon'}`;
    function loadTopic() {
        try { state.topic = localStorage.getItem(topicStoreKey()) || ''; } catch { state.topic = ''; }
    }
    function saveTopic(t) {
        state.topic = t;
        try {
            if (t) localStorage.setItem(topicStoreKey(), t); else localStorage.removeItem(topicStoreKey());
        } catch { /* приватный режим — фильтр живёт до перезагрузки */ }
    }

    async function load() {
        if (state.status === 'idle') state.status = 'loading';
        loadTopic();
        render();
        try {
            const { pastes } = await apiFetch('/api/chat/pastes');
            state.pastes = pastes || [];
            state.status = 'ready';
            state.error = '';
        } catch (e) {
            if (state.status !== 'ready') state.status = 'error';
            state.error = e.message || 'пасты не загрузились';
        }
        render();
    }

    const allTopics = () => topicsOf(state.pastes);

    // ── Разметка ─────────────────────────────────────────────────────────────

    function topicChip(t, { removable = false, add = false, small = false } = {}) {
        if (removable) return `<span class="cp-tag cp-tag-sel" title="${esc(t)}"><span class="cp-tag-t">${esc(t)}</span><button type="button" class="cp-tag-x" data-untopic="${esc(t)}" aria-label="Убрать тему">${ICON.x(10)}</button></span>`;
        if (add) return `<button type="button" class="cp-tag cp-tag-add" data-addtopic="${esc(t)}" title="${esc(t)}">${ICON.plus(10)}<span class="cp-tag-t">${esc(t)}</span></button>`;
        return `<span class="cp-tag${small ? ' cp-tag-s' : ''}" title="${esc(t)}"><span class="cp-tag-t">${esc(t)}</span></span>`;
    }

    function suggestHtml() {
        const ed = state.editing;
        const q = ed.topicInput.trim().toLocaleLowerCase('ru');
        const rest = allTopics().filter(t => !ed.topics.some(s => s.toLocaleLowerCase('ru') === t.toLocaleLowerCase('ru'))
            && (!q || t.toLocaleLowerCase('ru').includes(q)));
        if (ed.topics.length >= TOPICS_MAX) return `<span class="ld-muted">У пасты уже ${TOPICS_MAX} темы — больше не влезет.</span>`;
        if (!rest.length) return q ? '<span class="ld-muted">Enter — новая тема</span>' : '';
        return `<span class="ld-muted">Есть темы:</span> ${rest.map(t => topicChip(t, { add: true })).join('')}`;
    }

    function editorHtml() {
        const ed = state.editing;
        const full = ed.topics.length >= TOPICS_MAX;
        return `
        <div class="cp-edit" data-editor>
            <div class="cp-edit-title">${ed.id ? 'Правка пасты' : 'Новая паста'}</div>
            <input class="ld-in" data-f="title" maxlength="${TITLE_MAX}" placeholder="Заголовок — необязательно" value="${esc(ed.title)}">
            <textarea class="ld-in" data-f="body" rows="7" maxlength="${BODY_MAX}" placeholder="Текст. Пропуски — подчёркиванием: «По адресу _ на Ваш _»">${esc(ed.body)}</textarea>
            <div class="cp-edit-topics">
                ${ed.topics.map(t => topicChip(t, { removable: true })).join('')}
                <input class="ld-in cp-topic-in" data-f="topic" maxlength="${TOPIC_MAX}" value="${esc(ed.topicInput)}"
                    placeholder="${full ? `не больше ${TOPICS_MAX} тем` : 'Тема — Enter добавит'}"${full ? ' disabled' : ''} autocomplete="off">
            </div>
            <div class="cp-suggest" data-suggest>${suggestHtml()}</div>
            ${ed.error ? `<div class="ld-err">${esc(ed.error)}</div>` : ''}
            <div class="cp-edit-acts">
                <button type="button" class="btn btn-pri" data-act="save"${ed.saving ? ' disabled' : ''}>${ed.saving ? 'Сохраняю…' : 'Сохранить'}</button>
                <button type="button" class="btn btn-sec" data-act="cancel"${ed.saving ? ' disabled' : ''}>Отмена</button>
            </div>
        </div>`;
    }

    function cardHtml(p) {
        if (state.editing && state.editing.id === p.id) return editorHtml();
        const flash = (act) => state.flash && state.flash.id === p.id && state.flash.act === act;
        const btn = (act, icon, label, title) => `<button type="button" class="cp-btn${flash(act) ? ' cp-btn-done' : ''}" data-act="${act}" title="${esc(title)}">${flash(act) ? ICON.check(12) : icon(12)}<span>${esc(flash(act) ? state.flash.text : label)}</span></button>`;
        const acts = state.confirmDel === p.id
            ? `<span class="cp-confirm">Удалить пасту?</span>
               <button type="button" class="cp-btn cp-btn-danger" data-act="del-yes"${state.deleting === p.id ? ' disabled' : ''}>${state.deleting === p.id ? 'Удаляю…' : 'Удалить'}</button>
               <button type="button" class="cp-btn" data-act="del-no">Отмена</button>`
            : `${btn('insert', ICON.insert, 'Вставить', 'В поле ответа, на место каретки')}
               ${btn('copy', ICON.copy, 'Копировать', 'В буфер обмена')}
               <button type="button" class="cp-btn cp-btn-ico" data-act="edit" title="Изменить" aria-label="Изменить">${ICON.edit(12)}</button>
               <button type="button" class="cp-btn cp-btn-ico" data-act="del" title="Удалить" aria-label="Удалить">${ICON.trash(12)}</button>`;
        return `
        <div class="cp-card" data-id="${esc(p.id)}">
            ${p.title ? `<div class="cp-title">${esc(p.title)}</div>` : ''}
            ${p.topics.length ? `<div class="cp-tags">${p.topics.map(t => topicChip(t, { small: true })).join('')}</div>` : ''}
            <div class="cp-body${state.expanded.has(p.id) ? ' cp-body-open' : ''}" data-act="expand" title="${state.expanded.has(p.id) ? 'Свернуть' : 'Показать целиком'}">${esc(p.body)}</div>
            <div class="cp-acts">${acts}</div>
        </div>`;
    }

    function listHtml() {
        if (state.status === 'loading') return '<div class="ld-skel-list">' + '<div class="ld-skel"><span class="sk sk-line" style="width:50%"></span><span class="sk sk-line" style="width:90%"></span></div>'.repeat(4) + '</div>';
        if (state.status === 'error') return `<div class="ld-empty ld-error">Пасты не загрузились: ${esc(state.error)} <button type="button" class="ld-chip" data-act="reload">Ещё раз</button></div>`;
        const newEditor = state.editing && !state.editing.id ? editorHtml() : '';
        const list = filterPastes(state.pastes, { topic: state.topic, q: state.q });
        let body;
        if (!state.pastes.length) body = '<div class="ld-empty">Паст пока нет — «Новая» сверху.</div>';
        else if (!list.length) body = '<div class="ld-empty">Под этот отбор паст нет.</div>';
        else body = list.map(cardHtml).join('');
        return newEditor + body;
    }

    function render() {
        const topics = allTopics();
        if (state.topic && !topics.includes(state.topic) && state.status === 'ready') saveTopic('');
        const count = (t) => filterPastes(state.pastes, { topic: t }).length;
        const chip = (t, label) => `<button type="button" class="ld-chip cp-filter${state.topic === t ? ' on' : ''}" data-topic="${esc(t)}" title="${esc(label)}"><span class="cp-tag-t">${esc(label)}</span> <b>${count(t)}</b></button>`;
        host.innerHTML = `
            <div class="cp-head">
                <b class="cp-head-t">${ICON.paste(14)} Пасты</b>
                <button type="button" class="ld-chip" data-act="new"${state.status !== 'ready' ? ' disabled' : ''}>${ICON.plus(12)} Новая</button>
                <button type="button" class="cp-close" data-act="close" aria-label="Закрыть пасты">${ICON.x(14)}</button>
            </div>
            ${topics.length ? `<div class="ld-chips cp-filters">${chip('', 'Все')}${topics.map(t => chip(t, t)).join('')}</div>` : ''}
            <label class="ld-search">${ICON.search(13)}<input data-f="q" type="search" placeholder="Поиск по пастам" value="${esc(state.q)}" autocomplete="off"></label>
            ${state.error && state.status === 'ready' ? `<div class="ld-err">${esc(state.error)}</div>` : ''}
            <div class="cp-list" data-list>${listHtml()}</div>`;
        bind();
    }

    function renderList() {
        const el = host.querySelector('[data-list]');
        if (!el) return render();
        el.innerHTML = listHtml();
        bind();
    }

    // ── Действия ─────────────────────────────────────────────────────────────

    function flash(id, act, text) {
        state.flash = { id, act, text };
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => { state.flash = null; renderList(); }, FLASH_MS);
        renderList();
    }

    async function doCopy(p) {
        const ok = await copyText(p.body);
        flash(p.id, 'copy', ok ? 'Скопировано' : 'Не скопировалось');
    }

    async function doInsert(p) {
        if (onInsert(p.body)) { flash(p.id, 'insert', 'Вставлено'); return; }
        // Диалог не открыт — вставлять некуда, но и молчать незачем.
        const ok = await copyText(p.body);
        flash(p.id, 'insert', ok ? 'Диалога нет — скопировал' : 'Диалог не открыт');
    }

    function startEdit(p) {
        state.confirmDel = null;
        state.editing = p
            ? { id: p.id, title: p.title, body: p.body, topics: [...p.topics], topicInput: '', error: '', saving: false }
            : { id: null, title: '', body: '', topics: state.topic ? [state.topic] : [], topicInput: '', error: '', saving: false };
        renderList();
        host.querySelector('[data-editor] [data-f="body"]')?.focus();
    }

    function addTopic(raw) {
        const ed = state.editing;
        if (!ed || ed.topics.length >= TOPICS_MAX) return;
        const t = canonTopic(raw, allTopics());
        if (t && !ed.topics.some(s => s.toLocaleLowerCase('ru') === t.toLocaleLowerCase('ru'))) ed.topics.push(t);
        ed.topicInput = '';
        renderList();
        host.querySelector('[data-editor] [data-f="topic"]')?.focus();
    }

    async function save() {
        const ed = state.editing;
        if (!ed || ed.saving) return;
        // Набранная, но не добавленная Enter'ом тема — тоже тема: человек её
        // видит в поле и считает выбранной.
        if (ed.topicInput.trim() && ed.topics.length < TOPICS_MAX) {
            const t = canonTopic(ed.topicInput, allTopics());
            if (!ed.topics.some(s => s.toLocaleLowerCase('ru') === t.toLocaleLowerCase('ru'))) ed.topics.push(t);
            ed.topicInput = '';
        }
        if (!ed.body.trim()) { ed.error = 'Пустую пасту сохранять незачем — напишите текст.'; renderList(); return; }
        ed.saving = true;
        ed.error = '';
        renderList();
        const body = { title: ed.title, body: ed.body, topics: ed.topics };
        try {
            if (ed.id) {
                const { paste } = await apiFetch(`/api/chat/pastes/${ed.id}`, { method: 'PUT', body });
                state.pastes = state.pastes.map(p => (p.id === paste.id ? paste : p));
            } else {
                const { paste } = await apiFetch('/api/chat/pastes', { method: 'POST', body });
                state.pastes = [...state.pastes, paste];
            }
            state.editing = null;
            render(); // темы могли поменяться — фильтр тоже
        } catch (e) {
            ed.saving = false;
            ed.error = e.message || 'не сохранилось';
            renderList();
        }
    }

    async function remove(id) {
        state.deleting = id;
        renderList();
        try {
            await apiFetch(`/api/chat/pastes/${id}`, { method: 'DELETE' });
            state.pastes = state.pastes.filter(p => p.id !== id);
            state.error = '';
        } catch (e) {
            state.error = `Не удалилось: ${e.message || 'сервер не ответил'}`;
        }
        state.deleting = null;
        state.confirmDel = null;
        render();
    }

    function bind() {
        const find = (el) => state.pastes.find(p => p.id === el.closest('[data-id]')?.dataset.id);
        host.querySelectorAll('[data-act]').forEach(el => {
            el.onclick = () => {
                const p = find(el);
                switch (el.dataset.act) {
                    case 'close': onClose(); break;
                    case 'reload': load(); break;
                    case 'new': startEdit(null); break;
                    case 'edit': startEdit(p); break;
                    case 'cancel': state.editing = null; renderList(); break;
                    case 'save': save(); break;
                    case 'insert': doInsert(p); break;
                    case 'copy': doCopy(p); break;
                    case 'del': state.confirmDel = p.id; renderList(); break;
                    case 'del-no': state.confirmDel = null; renderList(); break;
                    case 'del-yes': remove(p.id); break;
                    case 'expand':
                        if (window.getSelection()?.toString()) break; // выделяли текст, а не кликали
                        if (state.expanded.has(p.id)) state.expanded.delete(p.id); else state.expanded.add(p.id);
                        renderList();
                        break;
                }
            };
        });
        host.querySelectorAll('[data-topic]').forEach(b => {
            b.onclick = () => { saveTopic(b.dataset.topic); render(); };
        });
        host.querySelectorAll('[data-addtopic]').forEach(b => { b.onclick = () => addTopic(b.dataset.addtopic); });
        host.querySelectorAll('[data-untopic]').forEach(b => {
            b.onclick = () => {
                state.editing.topics = state.editing.topics.filter(t => t !== b.dataset.untopic);
                renderList();
                host.querySelector('[data-editor] [data-f="topic"]')?.focus();
            };
        });
        const q = host.querySelector('[data-f="q"]');
        if (q) q.oninput = () => { state.q = q.value; renderList(); };
        const ed = host.querySelector('[data-editor]');
        if (ed) {
            const f = (name) => ed.querySelector(`[data-f="${name}"]`);
            f('title').oninput = (e) => { state.editing.title = e.target.value; };
            f('body').oninput = (e) => { state.editing.body = e.target.value; };
            const ti = f('topic');
            ti.oninput = () => {
                state.editing.topicInput = ti.value;
                ed.querySelector('[data-suggest]').innerHTML = suggestHtml();
                ed.querySelectorAll('[data-addtopic]').forEach(b => { b.onclick = () => addTopic(b.dataset.addtopic); });
            };
            ti.onkeydown = (e) => {
                if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (ti.value.trim()) addTopic(ti.value); }
                // Backspace в пустом поле снимает последнюю тему — как в любом поле с метками.
                if (e.key === 'Backspace' && !ti.value && state.editing.topics.length) {
                    state.editing.topics.pop();
                    renderList();
                    host.querySelector('[data-editor] [data-f="topic"]')?.focus();
                }
            };
            ed.onkeydown = (e) => {
                if (e.key === 'Escape') { state.editing = null; renderList(); }
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
            };
        }
    }

    render();
    return { load };
}
