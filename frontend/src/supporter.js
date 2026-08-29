// ─────────────────────────────────────────────────────────────────────────────
// Подписка «supp»: окно (витрина, настройки темы, выдача) и панель в профиле.
//
// Что это вообще. 350 ₽ в месяц за КОСМЕТИКУ: тему «Жидкое стекло» с настройкой
// цвета и фона, плашку supp у ника и свой цвет строки в топе. Ни одной рабочей
// возможности за деньги тут нет и не будет — записи, калькулятор и поиск
// клиента одинаковы у всех, а место в месячном топе считается по записям и
// только по ним.
//
// Деньги через сайт не ходят: человек переводит их владельцу, владелец выдаёт
// месяц кнопкой (вкладка «Выдача» ниже видна только ему), и через месяц
// подписка гаснет сама — сервер просто перестаёт соединять истёкшую строку
// (backend/src/supporter/badge.js). Поэтому здесь нет ни платёжной формы, ни
// «продлить автоматически»: продление — это ещё один перевод и ещё одна кнопка.
//
// ЖИВОЙ ПРЕДПРОСМОТР — главное решение этого окна. Настройки применяются ко
// ВСЕМУ САЙТУ сразу, а не к картинке в рамке: тема — это то, на что человек
// смотрит весь день, и подбирать её по миниатюре бессмысленно. У того, кто
// подписки не купил, всё то же самое крутится в макете внутри окна — витрина
// обязана показывать товар, а не рассказывать о нём.
// ─────────────────────────────────────────────────────────────────────────────

import './supporter.css';
import {
    PRESETS, DEFAULT_THEME, normalizeTheme, themeStyleText, daysLeft,
    presetIsLight, baseForLuminance,
} from '../../shared/supporterTheme.js';
import { applyGlassSettings, applyTheme, setGlassAccess, currentTheme } from './theme.js';

const MODAL_ID = 'supp-modal';

// Цвета для быстрого выбора. Не «все цвета радуги», а восемь разнесённых по
// кругу и одинаковых по светлоте: любой из них читается и на тёмном стекле, и
// на светлом, а сплошная палитра всё равно кончается тем, что человек берёт
// первый попавшийся. Свой цвет никуда не делся — рядом стоит пипетка.
const QUICK_COLORS = [
    '#d4a017', '#e0653a', '#e0407a', '#a855f7',
    '#3aa7ff', '#12b3a8', '#3fb950', '#94a3b8',
];

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function plural(n, forms) {
    const mod10 = Math.abs(n) % 10;
    const mod100 = Math.abs(n) % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
    return forms[2];
}

function dateRu(value) {
    return new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** «Активна до 28 сентября · осталось 24 дня» — одной строкой на всех экранах. */
export function supporterStatusText(state) {
    if (!state) return '';
    if (state.forever) return 'Бессрочная подписка';
    if (!state.active) {
        return state.expires_at
            ? `Подписка закончилась ${dateRu(state.expires_at)}`
            : 'Подписки нет';
    }
    const left = daysLeft(state.expires_at);
    return `Активна до ${dateRu(state.expires_at)} · ${left} ${plural(left, ['день', 'дня', 'дней'])}`;
}

// ── Макет для витрины ────────────────────────────────────────────────────────
// Маленький «сайт в окне»: фон, стеклянная карточка, кнопка акцентом, строка
// топа с плашкой. Ровно те четыре места, по которым тему и оценивают.
// Переменные --supp-* кладутся В САМ МАКЕТ, поэтому он показывает выбранное
// даже тому, у кого тема выключена.

function previewHtml(theme) {
    return `
        <div class="supp-preview" id="supp-preview" style="${themeStyleText(theme)}"
             data-preview-base="${theme.base}">
            <div class="supp-preview-bg"></div>
            <div class="supp-preview-ui">
                <div class="supp-preview-tabs">
                    <span class="supp-preview-tab is-active">Профиль</span>
                    <span class="supp-preview-tab">Записи</span>
                    <span class="supp-preview-tab">Топ</span>
                </div>
                <div class="supp-preview-card">
                    <div class="supp-preview-row">
                        <span class="supp-preview-ava"></span>
                        <span class="supp-preview-name">
                            <span class="supp-prefix" style="--supp-badge: var(--supp-accent)">supp</span>
                            Твой ник
                        </span>
                    </div>
                    <div class="supp-preview-btns">
                        <span class="supp-preview-btn is-pri">Кнопка</span>
                        <span class="supp-preview-btn">Ещё одна</span>
                    </div>
                </div>
                <div class="supp-preview-top">
                    <div class="supp-preview-gold">
                        <span>1</span><span class="supp-preview-goldname">Первое место</span><span>128</span>
                    </div>
                    <div class="supp-preview-toprow">
                        <span>2</span><span class="supp-preview-toprowname">Ты</span><span>96</span>
                    </div>
                </div>
            </div>
        </div>`;
}

// ── Настройки ────────────────────────────────────────────────────────────────

function controlsHtml(theme, bg) {
    const mb = Math.round((bg?.maxBytes || 6 * 1024 * 1024) / (1024 * 1024));
    return `
        <div class="supp-controls">
            <div class="supp-ctl">
                <div class="supp-ctl-head">Основа</div>
                <div class="supp-seg" id="supp-base">
                    <button type="button" class="supp-seg-btn${theme.base === 'dark' ? ' is-on' : ''}" data-base="dark">Тёмное стекло</button>
                    <button type="button" class="supp-seg-btn${theme.base === 'light' ? ' is-on' : ''}" data-base="light">Светлое стекло</button>
                </div>
            </div>

            <div class="supp-ctl">
                <div class="supp-ctl-head">Цвет</div>
                <div class="supp-colors" id="supp-colors">
                    ${QUICK_COLORS.map(c => `
                        <button type="button" class="supp-color${c === theme.accent ? ' is-on' : ''}"
                                style="--c: ${c}" data-color="${c}" title="${c}"></button>`).join('')}
                    <label class="supp-color supp-color-pick" title="Свой цвет">
                        <input type="color" id="supp-color-input" value="${esc(theme.accent)}"/>
                    </label>
                </div>
            </div>

            <div class="supp-ctl">
                <div class="supp-ctl-head">Фон</div>
                <div class="supp-presets" id="supp-presets">
                    ${PRESETS.map(p => `
                        <button type="button" class="supp-preset${!theme.background && p.id === theme.preset ? ' is-on' : ''}"
                                data-preset="${p.id}" style="background: ${p.css}">
                            <span>${esc(p.name)}</span>
                        </button>`).join('')}
                </div>
                <div class="supp-bg-file">
                    <label class="btn btn-sec supp-upload">
                        <input type="file" id="supp-bg-input" accept="image/jpeg,image/png,image/webp" hidden/>
                        ${theme.background ? 'Заменить картинку' : 'Своя картинка'}
                    </label>
                    ${theme.background
                        ? '<button type="button" class="btn btn-sec" id="supp-bg-clear">Убрать картинку</button>'
                        : ''}
                    <div class="supp-hint">
                        Лучше всего — <b>${bg?.width || 2560}×${bg?.height || 1440}</b>
                        (подойдёт любая от ${bg?.minWidth || 1920} px по ширине), jpeg/png/webp, до ${mb} МБ.
                        Картинка растягивается на весь экран и размывается, поэтому мелкие детали на ней
                        всё равно не видно — берите крупное и контрастное.
                    </div>
                    <div class="supp-bg-note hidden" id="supp-bg-note"></div>
                </div>
            </div>

            <div class="supp-ctl supp-ctl-sliders">
                <label class="supp-slider">
                    <span>Затемнение <b id="supp-dim-val">${theme.dim}%</b></span>
                    <input type="range" id="supp-dim" min="0" max="85" step="1" value="${theme.dim}"/>
                </label>
                <label class="supp-slider">
                    <span>Размытие <b id="supp-blur-val">${theme.blur} px</b></span>
                    <input type="range" id="supp-blur" min="0" max="40" step="1" value="${theme.blur}"/>
                </label>
            </div>

            <label class="supp-check">
                <input type="checkbox" id="supp-glow" ${theme.glow ? 'checked' : ''}/>
                <span>
                    Красить мою строку в топе этим цветом
                    <small>Работает и на первом месте: золото остаётся золотом, цвет ложится кромкой вокруг.</small>
                </span>
            </label>
        </div>`;
}

// ── Витрина ──────────────────────────────────────────────────────────────────

function pitchHtml(state) {
    const price = state.price || 350;
    const days = state.days || 30;
    return `
        <div class="supp-pitch">
            <div class="supp-price">
                <span class="supp-price-num">${price} ₽</span>
                <span class="supp-price-per">за ${days} дней</span>
            </div>
            <ul class="supp-list">
                <li><b>Тема «Жидкое стекло»</b> — третья тема сайта, которой нет ни у кого,
                    кроме подписчиков.</li>
                <li><b>Свой цвет</b> — акцент всего сайта: кнопки, ссылки, подсветки.</li>
                <li><b>Своя картинка на фоне</b> — размытая под стеклом, с настройкой
                    затемнения и размытия.</li>
                <li><b>Плашка <span class="supp-mark">supp</span> у ника</b> — везде, где видно имя:
                    в топе, в профиле, в лентах и в мини-топах игр.</li>
                <li><b>Своя строка в топе</b> — выбранным цветом, и на первом месте тоже.</li>
            </ul>
        </div>`;
}

// Условия идут ОТДЕЛЬНЫМ блоком во всю ширину, а не третьей колонкой: рядом с
// предпросмотром они читались бы как подпись к картинке, а это единственное
// место, где написано, за что человек отдаёт деньги и что будет через месяц.
function termsHtml(state) {
    const price = state.price || 350;
    const days = state.days || 30;
    return `
            <div class="supp-terms">
                <div class="supp-terms-head">Как это работает</div>
                <ol>
                    <li>Переводишь ${price} ₽ владельцу сайта и пишешь ему.</li>
                    <li>Он выдаёт подписку кнопкой — тема включается сразу, перезаходить не надо.</li>
                    <li>Через ${days} дней подписка гаснет сама. Автосписания нет: продление —
                        это ещё один перевод.</li>
                    <li>Настройки темы <b>сохраняются</b>. Кончилась подписка, продлил через полгода —
                        вернётся тот же цвет и тот же фон.</li>
                </ol>
                <p class="supp-fineprint">
                    Подписка не даёт ничего рабочего: ни в записях, ни в калькуляторе, ни в поиске
                    клиента. Место в топе считается по сделанным записям — купить его нельзя,
                    и это принципиально. Деньги идут на сервер, на котором всё это живёт.
                </p>
            </div>`;
}

// ── Выдача (только владельцу) ────────────────────────────────────────────────

function grantHtml() {
    return `
        <div class="supp-grant">
            <div class="supp-grant-find">
                <input type="text" id="supp-grant-q" class="supp-input" placeholder="Кому выдать: имя или логин"/>
                <input type="text" id="supp-grant-note" class="supp-input supp-input-note" placeholder="Пометка (чем оплачено) — необязательно"/>
            </div>
            <div class="supp-grant-results" id="supp-grant-results"></div>
            <div class="supp-grant-error hidden" id="supp-grant-error"></div>
            <div class="supp-grant-head">Подписки</div>
            <div class="supp-grant-list" id="supp-grant-list">Загрузка…</div>
        </div>`;
}

function grantRowHtml(row) {
    const left = row.forever ? '' : `${daysLeft(row.expires_at)} ${plural(daysLeft(row.expires_at), ['день', 'дня', 'дней'])}`;
    return `
        <div class="supp-grant-row${row.active ? '' : ' is-over'}">
            <span class="supp-grant-dot" style="background: ${esc(row.color)}"></span>
            <span class="supp-grant-name">${esc(row.display_name)}<small>${esc(row.login)}</small></span>
            <span class="supp-grant-when">${row.forever
                ? 'бессрочно'
                : row.active
                    ? `до ${dateRu(row.expires_at)} · ${left}`
                    : `кончилась ${dateRu(row.expires_at)}`}</span>
            <span class="supp-grant-acts">
                <button type="button" class="btn btn-sec supp-mini" data-grant="${esc(row.id)}">+ месяц</button>
                ${row.active && !row.forever
                    ? `<button type="button" class="btn btn-sec supp-mini supp-mini-off" data-revoke="${esc(row.id)}">Снять</button>`
                    : ''}
            </span>
        </div>`;
}

// ── Окно ─────────────────────────────────────────────────────────────────────

/**
 * Открыть окно подписки.
 * tab — с какой вкладки начать ('theme' | 'about' | 'grant'); по умолчанию
 * подписчику показываем настройки (он пришёл крутить тему), остальным —
 * витрину (они пришли узнать, что это).
 */
export async function openSupporter({ apiFetch, tab = null, onChanged = () => {} } = {}) {
    document.getElementById(MODAL_ID)?.remove();

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'modal supp-modal';
    modal.innerHTML = `
        <div class="modal-backdrop"></div>
        <div class="modal-win supp-win">
            <div class="modal-head supp-head">
                <span class="supp-mark">supp</span>
                <span class="supp-head-title">Подписка</span>
                <button class="btn btn-sec supp-close" id="supp-close" title="Закрыть" aria-label="Закрыть">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
                         stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
                        <path d="M6 6l12 12M18 6L6 18"/>
                    </svg>
                </button>
            </div>
            <div class="supp-tabs hidden" id="supp-tabs"></div>
            <div class="modal-body supp-body" id="supp-body">
                <div class="search-empty">Загрузка…</div>
            </div>
        </div>`;
    document.body.appendChild(modal);

    const body = modal.querySelector('#supp-body');
    const tabsBox = modal.querySelector('#supp-tabs');
    const close = () => {
        // Не сохранили — возвращаем сайту сохранённые настройки. Тему при этом
        // НЕ переключаем обратно: человек включил стекло сознательно, и гасить
        // его за него было бы сюрпризом.
        if (state?.active && dirty) applyGlassSettings(saved);
        modal.remove();
    };
    modal.querySelector('#supp-close').onclick = close;
    modal.querySelector('.modal-backdrop').onclick = close;
    document.addEventListener('keydown', function onEsc(e) {
        if (e.key !== 'Escape') return;
        if (!document.getElementById(MODAL_ID)) { document.removeEventListener('keydown', onEsc); return; }
        close();
        document.removeEventListener('keydown', onEsc);
    });

    let state = null;
    let draft = { ...DEFAULT_THEME };
    let saved = { ...DEFAULT_THEME };
    let dirty = false;
    let current = tab;

    try {
        state = await apiFetch('/api/supporter/me');
    } catch (err) {
        body.innerHTML = `<div class="search-empty">Не удалось загрузить подписку: ${esc(err.message)}</div>`;
        return;
    }

    saved = normalizeTheme(state.theme);
    draft = { ...saved };
    if (!current) current = state.active ? 'theme' : 'about';

    // Пришёл настраивать — значит, показываем результат на всём сайте, а не в
    // рамке: за этим и покупали.
    if (state.active && current === 'theme' && currentTheme() !== 'glass') applyTheme('glass');

    renderTabs();
    render();

    function renderTabs() {
        const tabs = [
            state.active ? { id: 'theme', label: 'Тема' } : null,
            { id: 'about', label: state.active ? 'О подписке' : 'Что входит' },
            state.canGrant ? { id: 'grant', label: 'Выдача' } : null,
        ].filter(Boolean);
        if (tabs.length < 2) { tabsBox.classList.add('hidden'); return; }
        tabsBox.classList.remove('hidden');
        tabsBox.innerHTML = tabs.map(t => `
            <button type="button" class="supp-tab${t.id === current ? ' is-on' : ''}" data-tab="${t.id}">${t.label}</button>`).join('');
        tabsBox.querySelectorAll('[data-tab]').forEach(btn => {
            btn.onclick = () => {
                current = btn.dataset.tab;
                if (state.active && current === 'theme' && currentTheme() !== 'glass') applyTheme('glass');
                renderTabs();
                render();
            };
        });
    }

    function render() {
        if (current === 'grant') { renderGrant(); return; }
        if (current === 'theme' && state.active) { renderTheme(); return; }
        renderAbout();
    }

    // ── Витрина ──────────────────────────────────────────────────────────────
    function renderAbout() {
        body.innerHTML = `
            <div class="supp-about">
                ${previewHtml(draft)}
                ${pitchHtml(state)}
            </div>
            ${termsHtml(state)}
            ${state.active ? '' : `
            <div class="supp-try">
                <div class="supp-try-head">Покрутить прямо сейчас</div>
                ${controlsHtml(draft, state.bg)}
                <div class="supp-hint supp-try-hint">
                    Пока это только предпросмотр — настройки применятся к сайту, когда появится подписка.
                    Всё, что выберешь тут, не пропадёт: сохранить их можно будет сразу после выдачи.
                </div>
            </div>`}
            <div class="supp-status">${esc(supporterStatusText(state))}</div>`;
        if (!state.active) bindControls({ live: false });
    }

    // ── Настройки ────────────────────────────────────────────────────────────
    function renderTheme() {
        body.innerHTML = `
            <div class="supp-theme">
                <div class="supp-status supp-status-top">${esc(supporterStatusText(state))}</div>
                <div class="supp-hint supp-live-hint">
                    Всё меняется сразу и на всём сайте — окно можно закрыть и посмотреть.
                    Не нажмёшь «Сохранить» — вернутся прежние настройки.
                </div>
                ${controlsHtml(draft, state.bg)}
                <div class="supp-actions">
                    <button type="button" class="btn btn-pri" id="supp-save">Сохранить</button>
                    <button type="button" class="btn btn-sec" id="supp-reset">Вернуть сохранённое</button>
                    <span class="supp-saved hidden" id="supp-saved">Сохранено</span>
                </div>
                <div class="supp-error hidden" id="supp-error"></div>
            </div>`;
        bindControls({ live: true });

        body.querySelector('#supp-save').onclick = async () => {
            const btn = body.querySelector('#supp-save');
            btn.disabled = true;
            try {
                const res = await apiFetch('/api/supporter/theme', { method: 'PUT', body: { theme: draft } });
                saved = normalizeTheme(res.theme);
                draft = { ...saved };
                dirty = false;
                applyGlassSettings(saved);
                const ok = body.querySelector('#supp-saved');
                ok.classList.remove('hidden');
                setTimeout(() => ok.classList.add('hidden'), 1800);
                onChanged(saved);
            } catch (err) {
                showError(err.message);
            }
            btn.disabled = false;
        };

        body.querySelector('#supp-reset').onclick = () => {
            draft = { ...saved };
            dirty = false;
            applyGlassSettings(draft);
            render();
        };
    }

    function showError(msg) {
        const box = body.querySelector('#supp-error');
        if (!box) return;
        box.textContent = msg;
        box.classList.remove('hidden');
    }

    // Одна проводка на оба экрана: у витрины та же панель, только применяется
    // она к макету, а не к сайту (live: false).
    function bindControls({ live }) {
        const apply = () => {
            draft = normalizeTheme(draft);
            dirty = true;
            if (live) applyGlassSettings(draft);
            const preview = body.querySelector('#supp-preview');
            if (preview) {
                preview.setAttribute('style', themeStyleText(draft));
                preview.dataset.previewBase = draft.base;
            }
        };
        // Перерисовываем панель целиком: контролов десяток, а состояние у них
        // одно — так «выбранный» кружок не разъедется с настройкой.
        const applyAndRedraw = () => { apply(); render(); };

        body.querySelectorAll('#supp-base [data-base]').forEach(btn => {
            btn.onclick = () => { draft.base = btn.dataset.base; applyAndRedraw(); };
        });
        body.querySelectorAll('#supp-colors [data-color]').forEach(btn => {
            btn.onclick = () => { draft.accent = btn.dataset.color; applyAndRedraw(); };
        });
        const colorInput = body.querySelector('#supp-color-input');
        if (colorInput) colorInput.oninput = () => { draft.accent = colorInput.value; apply(); };
        body.querySelectorAll('#supp-presets [data-preset]').forEach(btn => {
            btn.onclick = () => {
                draft.preset = btn.dataset.preset;
                // Выбрали готовый фон — своя картинка уходит с экрана, но с
                // сервера НЕ удаляется: вернуться к ней можно тем же выбором.
                draft.background = null;
                // Фон решает, какой быть основе, а значит и цвету текста:
                // тёмные буквы на ночном фоне не читаются, светлые на дневном —
                // тоже. Человек может переключить основу обратно кнопками
                // выше, но по умолчанию она идёт за фоном.
                draft.base = presetIsLight(draft.preset) ? 'light' : 'dark';
                applyAndRedraw();
            };
        });

        const dim = body.querySelector('#supp-dim');
        if (dim) dim.oninput = () => {
            draft.dim = Number(dim.value);
            body.querySelector('#supp-dim-val').textContent = `${draft.dim}%`;
            apply();
        };
        const blur = body.querySelector('#supp-blur');
        if (blur) blur.oninput = () => {
            draft.blur = Number(blur.value);
            body.querySelector('#supp-blur-val').textContent = `${draft.blur} px`;
            apply();
        };
        const glow = body.querySelector('#supp-glow');
        if (glow) glow.onchange = () => { draft.glow = glow.checked; apply(); };

        const file = body.querySelector('#supp-bg-input');
        if (file) file.onchange = () => {
            const chosen = file.files[0];
            file.value = '';
            if (chosen) uploadBackground(chosen, { live });
        };
        const clear = body.querySelector('#supp-bg-clear');
        if (clear) clear.onclick = () => clearBackground({ live });
    }

    // Картинку меряем ДО отправки, и меряем две вещи.
    //
    // Размер: 800×600, растянутая на весь экран, выглядит как поломка сайта, а
    // не как фон, и сказать об этом надо до загрузки. Но не запрещаем — это
    // вкус, а не ошибка.
    //
    // Яркость: по ней сама выбирается основа темы, то есть цвет текста. Считаем
    // по уменьшенной до 32×32 копии — этого хватает для средней яркости, а
    // читать миллионы пикселей ради одного числа незачем.
    function measure(fileObj) {
        return new Promise(resolve => {
            const url = URL.createObjectURL(fileObj);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve({ w: img.naturalWidth, h: img.naturalHeight, luma: averageLuma(img) });
            };
            img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
            img.src = url;
        });
    }

    function averageLuma(img) {
        try {
            const c = document.createElement('canvas');
            c.width = 32; c.height = 32;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, 32, 32);
            const { data } = ctx.getImageData(0, 0, 32, 32);
            let sum = 0;
            for (let i = 0; i < data.length; i += 4) {
                sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
            }
            return sum / (data.length / 4);
        } catch {
            // Картинка с чужого домена без CORS — холст «пачкается» и читать
            // его нельзя. Не беда: основу человек переключит сам.
            return null;
        }
    }

    async function uploadBackground(fileObj, { live }) {
        const note = body.querySelector('#supp-bg-note');
        const size = await measure(fileObj);
        if (note && size && size.w < (state.bg?.minWidth || 1920)) {
            note.textContent = `Картинка ${size.w}×${size.h} — на большом мониторе будет мылить.`
                + ` Советуем от ${state.bg?.minWidth || 1920} px по ширине.`;
            note.classList.remove('hidden');
        }
        // Тёмная картинка требует светлых букв, светлая — тёмных. Решаем это
        // за человека: он и так увидит результат, а гадать, почему текст
        // пропал, не должен.
        const base = size && size.luma !== null ? baseForLuminance(size.luma) : draft.base;

        if (!live) {
            // Без подписки грузить некуда: показываем картинку в макете прямо
            // из браузера, чтобы человек увидел свой фон под стеклом.
            const localUrl = URL.createObjectURL(fileObj);
            draft.base = base;
            const preview = body.querySelector('#supp-preview');
            if (preview) {
                preview.style.setProperty('--supp-bg', `url("${localUrl}")`);
                preview.style.setProperty('--supp-bg-size', 'cover');
                preview.dataset.previewBase = base;
            }
            return;
        }
        const fd = new FormData();
        fd.append('background', fileObj);
        try {
            const res = await apiFetch('/api/supporter/background', { method: 'POST', body: fd, isMultipart: true });
            // Сервер сохранил ссылку на файл; основу дописываем вторым
            // запросом — он знает про картинку, но не про её яркость.
            const withBase = await apiFetch('/api/supporter/theme', {
                method: 'PUT',
                body: { theme: { ...normalizeTheme(res.theme), base } },
            });
            saved = normalizeTheme(withBase.theme);
            draft = { ...saved };
            dirty = false;
            applyGlassSettings(saved);
            render();
        } catch (err) {
            showError(err.message);
        }
    }

    async function clearBackground({ live }) {
        if (!live) { draft.background = null; render(); return; }
        try {
            const res = await apiFetch('/api/supporter/background', { method: 'DELETE' });
            saved = normalizeTheme(res.theme);
            draft = { ...saved };
            dirty = false;
            applyGlassSettings(saved);
            render();
        } catch (err) {
            showError(err.message);
        }
    }

    // ── Выдача ───────────────────────────────────────────────────────────────
    function renderGrant() {
        body.innerHTML = grantHtml();
        const q = body.querySelector('#supp-grant-q');
        const noteInput = body.querySelector('#supp-grant-note');
        const results = body.querySelector('#supp-grant-results');
        const errBox = body.querySelector('#supp-grant-error');

        const showGrantError = (msg) => {
            errBox.textContent = msg;
            errBox.classList.remove('hidden');
        };

        let timer = null;
        q.oninput = () => {
            clearTimeout(timer);
            const value = q.value.trim();
            if (value.length < 2) { results.innerHTML = ''; return; }
            // Ищем не по каждой букве: список у нас на полсотни человек, и
            // дёргать сервер на каждом нажатии незачем.
            timer = setTimeout(async () => {
                try {
                    const res = await apiFetch(`/api/supporter/users?q=${encodeURIComponent(value)}`);
                    results.innerHTML = (res.users || []).map(u => `
                        <button type="button" class="supp-find-row" data-give="${esc(u.id)}">
                            <span class="supp-find-name">${esc(u.display_name)}<small>${esc(u.login)}</small></span>
                            <span class="supp-find-act">Выдать месяц</span>
                        </button>`).join('') || '<div class="supp-hint">Никого не нашлось</div>';
                    results.querySelectorAll('[data-give]').forEach(btn => {
                        btn.onclick = () => give(btn.dataset.give, btn);
                    });
                } catch (err) {
                    showGrantError(err.message);
                }
            }, 250);
        };

        async function give(userId, btn) {
            if (btn) btn.disabled = true;
            errBox.classList.add('hidden');
            try {
                await apiFetch('/api/supporter/grant', {
                    method: 'POST',
                    body: { user_id: userId, note: noteInput.value.trim() || null },
                });
                q.value = '';
                results.innerHTML = '';
                noteInput.value = '';
                await loadList();
                // Выдали САМОМУ СЕБЕ (или себе же продлили) — окно должно
                // сразу перестать быть витриной.
                await refreshSelf();
            } catch (err) {
                showGrantError(err.message);
                if (btn) btn.disabled = false;
            }
        }

        async function loadList() {
            const box = body.querySelector('#supp-grant-list');
            try {
                const res = await apiFetch('/api/supporter/list');
                box.innerHTML = (res.supporters || []).map(grantRowHtml).join('')
                    || '<div class="supp-hint">Пока никого. Выдай первому — и он увидит стекло сразу.</div>';
                box.querySelectorAll('[data-grant]').forEach(btn => {
                    btn.onclick = () => give(btn.dataset.grant, btn);
                });
                box.querySelectorAll('[data-revoke]').forEach(btn => {
                    btn.onclick = async () => {
                        btn.disabled = true;
                        try {
                            await apiFetch('/api/supporter/revoke', { method: 'POST', body: { user_id: btn.dataset.revoke } });
                            await loadList();
                            await refreshSelf();
                        } catch (err) {
                            showGrantError(err.message);
                            btn.disabled = false;
                        }
                    };
                });
            } catch (err) {
                box.innerHTML = `<div class="supp-hint">Не удалось загрузить: ${esc(err.message)}</div>`;
            }
        }

        loadList();
    }

    // Своё состояние перечитываем после любой выдачи: подписку могли выдать
    // себе, и тогда меняются и вкладки, и доступ к теме.
    async function refreshSelf() {
        try {
            const fresh = await apiFetch('/api/supporter/me');
            const wasActive = state.active;
            state = fresh;
            saved = normalizeTheme(state.theme);
            if (!dirty) draft = { ...saved };
            setGlassAccess(state.active);
            if (state.active && !wasActive) applyGlassSettings(saved);
            renderTabs();
            onChanged(saved);
        } catch { /* список уже обновился, состояние подтянется при следующем заходе */ }
    }
}

// ── Панель в профиле ─────────────────────────────────────────────────────────
// Профиль — то место, где человек разглядывает себя: медали, факультет,
// активность. Подписке место ровно там же, и подана она как благодарность, а
// не как ценник: тому, кто платит, «купи подписку» показывать незачем.

export function supporterSectionHtml(state) {
    if (!state) return '<div class="search-empty">Не удалось загрузить подписку</div>';

    if (state.active) {
        return `
            <div class="supp-panel is-on">
                <div class="supp-panel-head">
                    <span class="supp-mark" style="--supp-badge: ${esc(state.theme?.accent || '')}">supp</span>
                    <span class="supp-panel-title">Спасибо за поддержку</span>
                </div>
                <p class="supp-panel-text">
                    Этот сервер живёт на деньги подписчиков — и твоих в том числе.
                    Пока подписка активна, тебе доступны тема «Жидкое стекло» с твоим цветом и фоном,
                    плашка <span class="supp-mark-inline">supp</span> у ника везде, где видно имя,
                    и своя строка в топе — на первом месте тоже.
                </p>
                <div class="supp-panel-status">${esc(supporterStatusText(state))}</div>
                <div class="supp-panel-acts">
                    <button type="button" class="btn btn-pri" id="btn-supp-theme">Настроить тему</button>
                    ${state.canGrant ? '<button type="button" class="btn btn-sec" id="btn-supp-grant">Выдача подписок</button>' : ''}
                </div>
            </div>`;
    }

    return `
        <div class="supp-panel">
            <div class="supp-panel-head">
                <span class="supp-mark">supp</span>
                <span class="supp-panel-title">Подписка на ${state.price || 350} ₽</span>
            </div>
            <p class="supp-panel-text">
                Косметика и ничего больше: тема «Жидкое стекло» со своим цветом и фоном,
                плашка у ника и своя строка в топе. Рабочего в подписке нет ничего —
                записи, калькулятор и место в топе одинаковы у всех.
            </p>
            ${state.expires_at ? `<div class="supp-panel-status">${esc(supporterStatusText(state))} — настройки темы сохранены, продление их вернёт</div>` : ''}
            <div class="supp-panel-acts">
                <button type="button" class="btn btn-pri" id="btn-supp-open">Посмотреть, что входит</button>
            </div>
        </div>`;
}

/** Проводка кнопок панели. Вызывается после каждой отрисовки профиля. */
export function bindSupporterSection({ apiFetch, onChanged = () => {} } = {}) {
    const open = (tab) => openSupporter({ apiFetch, tab, onChanged });
    const themeBtn = document.getElementById('btn-supp-theme');
    if (themeBtn) themeBtn.onclick = () => open('theme');
    const grantBtn = document.getElementById('btn-supp-grant');
    if (grantBtn) grantBtn.onclick = () => open('grant');
    const aboutBtn = document.getElementById('btn-supp-open');
    if (aboutBtn) aboutBtn.onclick = () => open('about');
}
