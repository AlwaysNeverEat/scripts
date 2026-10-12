// ─────────────────────────────────────────────────────────────────────────────
// Скины: рамка аватара в профиле, баннер карточки лида и картинка на капсулах
// записей (правила — shared/skins.js, картинки — assets/skins/<пак>/).
//
// Места, где скин может быть, ничего про скины не знают — они только
// ПОМЕЧАЮТ элемент: чей он и какая это часть.
//   data-skin-part="frame|cover|leads|records"
//   data-skin-user="<id человека>"       — рамка, шапка профиля, записи
//   data-skin-op="<код оператора>"       — звонок в ленте лидов
//   data-skin-slots="<N>"                — записи: сколько получасов в капсуле
// Красит их этот модуль — сразу при появлении в документе (наблюдатель за
// разметкой, как у переключателей и перетекающего текста) и заново, когда
// приедет список. Так профиль, доска и лиды не ждут скинов и не
// перерисовываются ради них: их разметка рождается через innerHTML каждые
// несколько секунд, и помнить «что покрасили» в ней негде.
//
// Картинки подключаются ПО ИМЕНИ ФАЙЛА, как арт рогалика и доска шашек:
// положили в assets/skins/<пак>/ — пак их видит. Режет их из одного листа
// design/skins/cut-skin.py, он же пишет meta.json с размерами.
// ─────────────────────────────────────────────────────────────────────────────

import { skinForOperator, skinOperatorKey } from '../../shared/skins.js';
import './skins.css';

const FILES = import.meta.glob('./assets/skins/*/*.{webp,png}', { eager: true, query: '?url', import: 'default' });
const METAS = import.meta.glob('./assets/skins/*/meta.json', { eager: true, import: 'default' });

// { cat: { frame: url, banner: url, …, meta } }
const PACK_ART = {};
for (const [path, url] of Object.entries(FILES)) {
    const [, pack, name] = path.match(/skins\/([^/]+)\/([^/.]+)\./) || [];
    if (pack) (PACK_ART[pack] ||= {})[name] = url;
}
for (const [path, meta] of Object.entries(METAS)) {
    const [, pack] = path.match(/skins\/([^/]+)\//) || [];
    if (pack) (PACK_ART[pack] ||= {}).meta = meta;
}

// Высота получаса на доске записей — ROW_H в records.js. Голова и лапы
// длинного кота должны уложиться в один слот, отсюда ширина полосы.
const SLOT_H = 44;
const STRIP_MAX = 52;

const state = { skins: [], mine: null, canEdit: false, apiFetch: null, loaded: false };
const listeners = new Set();

// Есть ли у пака картинки ЭТОЙ части. Паки рисуются по частям, и пак с одной
// рамкой — нормальное состояние: на баннер его просто нельзя выбрать.
const PART_FILES = { frame: ['frame'], cover: ['banner'], leads: ['banner'], records: ['head', 'body', 'feet', 'single'] };
export const packHasPart = (pack, part) => Boolean(PACK_ART[pack]) && PART_FILES[part].every(f => PACK_ART[pack][f]);
export const skinState = () => state;
export function onSkinsChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function loadSkins(apiFetch) {
    state.apiFetch = apiFetch;
    try {
        const data = await apiFetch('/api/skins');
        state.skins = Array.isArray(data.skins) ? data.skins : [];
        state.canEdit = Boolean(data.canEdit);
        state.mine = data.mine || null;
        state.loaded = true;
    } catch { /* без скинов сайт тот же — просто без украшений */ }
    paintAll();
    listeners.forEach(fn => fn());
}

/** Надеть/снять свой скин. Отказ сервера уходит наверх — окно его покажет. */
export async function saveMySkin({ parts, operator }) {
    const data = await state.apiFetch('/api/skins/me', { method: 'PUT', body: { parts, operator } });
    state.mine = data.mine;
    await loadSkins(state.apiFetch);
}

// Код оператора лежит у «Лидов» на устройстве (crmLeads.js, тот же ключ):
// примерочная шлёт его вместе со скином.
export const localOperator = (userId) => {
    try { return skinOperatorKey(localStorage.getItem(`zm_leads_operator:${userId || 'anon'}`) || ''); } catch { return ''; }
};

// Код оператора живёт во вкладке «Лиды» (на устройстве); серверу он нужен,
// чтобы ДРУГИЕ узнали звонки хозяина скина. Шлём, только если скин надет и
// код правда поменялся — вкладка зовёт это на каждое сохранение кода.
export function noteOperatorCode(code) {
    const k = skinOperatorKey(code);
    if (!state.mine || state.mine.operator === k || !state.apiFetch) return;
    state.mine = { ...state.mine, operator: k };
    state.apiFetch('/api/skins/me/operator', { method: 'PUT', body: { operator: k } })
        .then(() => loadSkins(state.apiFetch))
        .catch(() => { /* не дошло — уйдёт со следующей сменой кода или скина */ });
}

// Пометка аватарки: рамка скина — у ЛЮБОЙ аватарки человека, а не только в
// профиле. Места рисования вставляют это в тег кружка с аватаркой.
export const avatarSkinAttrs = (userId) => (userId
    ? ` data-skin-part="frame" data-skin-user="${String(userId).replace(/[^\w-]/g, '')}"` : '');

// ── Покраска ─────────────────────────────────────────────────────────────────

const VARS = ['--sk-frame', '--sk-hole', '--sk-banner', '--sk-banner-ratio',
    '--sk-head', '--sk-body', '--sk-feet', '--sk-single', '--sk-w', '--sk-single-w', '--sk-head-h', '--sk-feet-h'];

// Пак ЭТОЙ части у хозяина элемента — у каждой части свой (shared/skins.js).
// `data-skin-pack` задаёт пак прямо на элементе — так примерочная показывает
// ещё не надетое (пустая строка — стандартный вид).
function packOf(el) {
    if (el.dataset.skinPack !== undefined) return el.dataset.skinPack || null;
    const part = el.dataset.skinPart;
    const skin = part === 'leads'
        ? skinForOperator(state.skins, el.dataset.skinOp)
        : state.skins.find(x => x.userId === el.dataset.skinUser);
    return skin?.parts?.[part] || null;
}

const url = (u) => `url("${u}")`;

function paint(el) {
    const part = el.dataset.skinPart;
    const pack = packOf(el);
    const art = pack && packHasPart(pack, part) ? PACK_ART[pack] : null;
    el.classList.remove(...[...el.classList].filter(c => c === 'skinned' || /^skin-(frame|cover|leads|records|one|pack-)/.test(c)));
    for (const v of VARS) el.style.removeProperty(v);
    if (!art) return;
    const m = art.meta || {};
    if (part === 'frame') {
        el.style.setProperty('--sk-frame', url(art.frame));
        el.style.setProperty('--sk-hole', m.frame?.hole || 0.65);
    } else if (part === 'cover' || part === 'leads') {
        el.style.setProperty('--sk-banner', url(art.banner));
        el.style.setProperty('--sk-banner-ratio', m.banner?.ratio || 4);
    } else if (part === 'records') {
        const slots = Number(el.dataset.skinSlots) || 1;
        const unit = Math.max(m.strip?.head || 1, m.strip?.feet || 1);
        // Капсула на один слот ниже слота на 5px (зазор между записями).
        const capH = SLOT_H - 5;
        el.style.setProperty('--sk-head', url(art.head));
        el.style.setProperty('--sk-body', url(art.body));
        el.style.setProperty('--sk-feet', url(art.feet));
        el.style.setProperty('--sk-single', url(art.single));
        const w = Math.round(Math.min(STRIP_MAX, (SLOT_H - 2) / unit));
        el.style.setProperty('--sk-w', `${w}px`);
        el.style.setProperty('--sk-head-h', `${(w * (m.strip?.head || 1)).toFixed(1)}px`);
        el.style.setProperty('--sk-feet-h', `${(w * (m.strip?.feet || 1)).toFixed(1)}px`);
        el.style.setProperty('--sk-single-w', `${Math.round((capH - 2) * (m.single?.ratio || 1))}px`);
        if (slots === 1) el.classList.add('skin-one');
    } else return;
    // Не «sk»: этот класс на сайте уже занят скелетонами загрузки (style.css).
    el.classList.add('skinned', `skin-${part}`, `skin-pack-${pack}`);
}

export function paintAll(root = document) {
    if (root.matches?.('[data-skin-part]')) paint(root);
    root.querySelectorAll?.('[data-skin-part]').forEach(paint);
}

let observing = false;
export function initSkins() {
    if (observing || typeof MutationObserver !== 'function') return;
    observing = true;
    // Микрозадача после вставки — то есть ДО отрисовки кадра: капсула не
    // мелькает без кота. Пока список не приехал, красить нечем.
    new MutationObserver((records) => {
        for (const r of records) for (const n of r.addedNodes) {
            if (n.nodeType !== 1) continue;
            // Без списка красить нечего — кроме примерочной, у неё пак на элементе.
            if (state.skins.length || n.matches('[data-skin-pack]') || n.querySelector('[data-skin-pack]')) paintAll(n);
        }
    }).observe(document.body, { childList: true, subtree: true });
}

export { PACK_ART as skinArt };
