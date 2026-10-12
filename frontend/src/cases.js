// ─────────────────────────────────────────────────────────────────────────────
// Кейсы, магазин гемов и примерочная — панель «Скины» в своём профиле.
// Правила и цены — shared/cases.js, ручки — /api/cases и /api/skins.
//
// Здесь НИЧЕГО не решается: сколько у человека гемов, хватает ли их и что
// выпало — говорит сервер. Окно показывает его ответ и задаёт вопросы
// («не хватает 30 гемов — обменять 30 ₽?»), а лента кейса — это показ уже
// разыгранного приза: она строится вокруг него и на нём останавливается.
//
// Картинки сундуков, ключа и обложки — по имени файла в assets/cases/
// (key, chest-small, chest-small-open, chest-big, chest-big-open, cover; режет
// их design/cases/README.md). Нет файла — на его месте значок вёрсткой, и всё
// работает: картинки догоняют механику, а не держат её.
// ─────────────────────────────────────────────────────────────────────────────

import './crmLeads.css'; // строка звонка в примерочной — настоящая .ld-call
import './cases.css';
import { SKIN_PACKS, SKIN_PARTS } from '../../shared/skins.js';
import { KEY_PRICE, SMALL_CASE_PRICE, RECORDS_PER_GEM, XP_PER_GEM, allItems, gemsWord, packOdds } from '../../shared/cases.js';
import { skinArt, packHasPart, skinState, saveMySkin, localOperator } from './skins.js';
import { gemImgHtml } from './nameBadges.js';

const ART = {};
for (const [path, url] of Object.entries(import.meta.glob('./assets/cases/*.{webp,png}', { eager: true, query: '?url', import: 'default' }))) {
    ART[path.match(/([^/]+)\.\w+$/)[1]] = url;
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PART_LABEL = Object.fromEntries(SKIN_PARTS.map(p => [p.id, p.label]));
const packLabel = (p) => SKIN_PACKS[p]?.label || p;
const plural = (n, a, b, c) => {
    const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c;
};
const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise(r => setTimeout(r, ms));
// Темп открытия. Нарочно небыстрый: тряска сундука, долгий разгон ленты и
// тягучее «доедет — не доедет» на последних карточках — ради этого кейс и
// открывают; за полторы секунды насладиться не успеваешь.
const SHAKE_MS = 2300;   // сундук трясётся (не меньше — даже если сервер ответил сразу)
const BURST_MS = 900;    // вспышка открытия
const ROLL_S = 8;        // лента
const WON_MS = 1300;     // карточка приза мигает, прежде чем окно перейдёт к призу
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const dayLabel = (iso) => { const [, m, d] = String(iso).split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };

const gem = (px = 18) => `<span class="kc-gem">${gemImgHtml(px)}</span>`;
const svg = (body, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const keyIcon = (px = 18) => ART.key
    ? `<img class="kc-key-img" src="${ART.key}" alt="" width="${px}" height="${px}" draggable="false">`
    : svg('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M15 8l2 2"/>', px);
const lockIcon = (px = 18) => svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', px);
const chestIcon = (px) => svg('<rect x="3" y="9" width="18" height="11" rx="2"/><path d="M3 13h18M5 9V7a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/><rect x="10.5" y="11.5" width="3" height="4" rx="1"/>', px);
const chestImg = (kind, open = false) => {
    const url = ART[`chest-${kind}${open ? '-open' : ''}`];
    return url ? `<img class="kc-chest-img" src="${url}" alt="" draggable="false">` : `<span class="kc-chest-ico">${chestIcon(kind === 'big' ? 64 : 48)}</span>`;
};

// Картинка вещи: рамка — рамкой, шапка и звонки — картинкой шапки, записи —
// котом целиком. Пак целиком (большой кейс) — шапкой пака.
function thumbHtml({ pack, part }) {
    const art = skinArt[pack] || {};
    const url = part === 'frame' ? art.frame : part === 'records' ? art.single : art.banner;
    const fit = part === 'frame' || part === 'records' ? 'contain' : 'cover';
    return url ? `<span class="kc-thumb kc-thumb-${fit}" style="background-image:url('${url}')"></span>` : '<span class="kc-thumb"></span>';
}
// Редкий пак подсвечен и в ленте, и на призе: выпадает он редко, и мимо
// него глазом лента проехать не должна.
const isRare = (pack) => Boolean(SKIN_PACKS[pack]?.rare);
function itemCardHtml(item, cls = '') {
    const hue = SKIN_PACKS[item.pack]?.hue ?? 260;
    return `
        <div class="kc-card ${cls}${isRare(item.pack) ? ' kc-card-rare' : ''}" style="--hue:${hue}">
            ${thumbHtml(item.part ? item : { pack: item.pack, part: 'cover' })}
            <span class="kc-card-name">${esc(packLabel(item.pack))}${isRare(item.pack) ? '<em>редкий</em>' : ''}</span>
            <span class="kc-card-part">${esc(item.part ? PART_LABEL[item.part] : 'пак целиком')}</span>
        </div>`;
}

export function mountCases(host, { apiFetch, user }) {
    if (!host) return;
    // Повторный монтаж в тот же узел снимает прежние обработчики — иначе
    // каждый клик обменивал бы гемы дважды.
    host._casesOff?.abort();
    const off = new AbortController();
    host._casesOff = off;
    const state = {
        wallet: null, owned: [], status: 'loading', error: '',
        season: null, next: null, packs: [],   // сезон считает сервер
        fitPart: 'frame',      // какая часть открыта в примерочной
        draft: null,           // примерочная: { part: pack|null }
        busy: '',
    };

    async function load() {
        try {
            const data = await apiFetch('/api/cases');
            state.wallet = data.balance;
            state.owned = data.owned || [];
            state.season = data.season || null;
            state.next = data.next || null;
            state.packs = data.packs || [];
            state.status = 'ready';
        } catch (e) {
            state.status = 'error';
            state.error = e.message || 'сервер не ответил';
        }
        render();
    }

    const ownedSet = () => new Set(state.owned.map(o => `${o.pack}:${o.part}`));
    const mineParts = () => ({ ...Object.fromEntries(SKIN_PARTS.map(p => [p.id, null])), ...(skinState().mine?.parts || {}) });
    // Что можно надеть на часть: своё, а редактору (gtrixoff) — всё нарисованное.
    const wearable = (part) => {
        const have = ownedSet();
        return Object.keys(SKIN_PACKS).filter(p => packHasPart(p, part) && (skinState().canEdit || have.has(`${p}:${part}`)));
    };

    // ── Разметка ─────────────────────────────────────────────────────────────

    function walletHtml(w) {
        const pct = Math.min(100, Math.round((w.xp % XP_PER_GEM) / XP_PER_GEM * 100));
        return `
        <div class="kc-wallet">
            <div class="kc-bal kc-bal-gems" title="Гемы — на них открываются кейсы">${gem(30)}<b>${w.gems}</b><span>${gemsWord(w.gems)}</span></div>
            <div class="kc-bal" title="Ключи от большого кейса">${keyIcon(22)}<b>${w.keys}</b><span>${plural(w.keys, 'ключ', 'ключа', 'ключей')}</span></div>
            <div class="kc-xp" title="Опыт копится от повторов из кейсов: ${XP_PER_GEM} опыта — гем">
                <span class="kc-xp-top"><span>Опыт до гема</span><b>${w.xp % XP_PER_GEM} / ${XP_PER_GEM}</b></span>
                <span class="kc-bar"><i style="width:${pct}%"></i></span>
            </div>
        </div>`;
    }

    function shopRowHtml({ id, title, have, rate, unit }) {
        const max = Math.floor(have / rate);
        return `
        <div class="kc-shop-row">
            <div class="kc-shop-text">
                <b>${title}</b>
                <span>${have} ${unit} · ${rate} = 1 гем</span>
            </div>
            <div class="kc-shop-act">
                <input class="kc-in" type="number" min="1" max="${Math.max(1, max)}" value="${Math.max(1, max)}" data-amount="${id}" ${max ? '' : 'disabled'} aria-label="Сколько гемов">
                <button class="btn btn-sec" data-act="exchange" data-from="${id}" ${max && !state.busy ? '' : 'disabled'}>${gem(16)} Обменять</button>
            </div>
        </div>`;
    }

    function shopHtml(w) {
        return `
        <div class="kc-shop">
            ${shopRowHtml({ id: 'records', title: 'Записи → гемы', have: w.records, rate: RECORDS_PER_GEM, unit: plural(w.records, 'запись', 'записи', 'записей') })}
            ${shopRowHtml({ id: 'rubles', title: 'Рубли из донатов → гемы', have: w.rubles, rate: 1, unit: '₽' })}
            <div class="kc-shop-row">
                <div class="kc-shop-text"><b>Опыт → гем</b><span>${w.xp} опыта · ${XP_PER_GEM} = 1 гем</span></div>
                <div class="kc-shop-act">
                    <button class="btn btn-sec" data-act="xp" ${w.xp >= XP_PER_GEM && !state.busy ? '' : 'disabled'}>${gem(16)} Забрать${w.xp >= 2 * XP_PER_GEM ? ` ${Math.floor(w.xp / XP_PER_GEM)}` : ''}</button>
                </div>
            </div>
            <div class="kc-shop-row">
                <div class="kc-shop-text"><b>Ключ от большого кейса</b><span>${KEY_PRICE} гемов</span></div>
                <div class="kc-shop-act">
                    <button class="btn btn-sec" data-act="key" ${w.gems >= KEY_PRICE && !state.busy ? '' : 'disabled'}>${keyIcon(16)} Купить</button>
                </div>
            </div>
        </div>`;
    }

    function caseCardHtml(kind) {
        const big = kind === 'big';
        const packs = state.packs;
        const shut = !state.season;
        return `
        <div class="kc-case kc-case-${kind}">
            <div class="kc-case-chest">${chestImg(kind)}</div>
            <div class="kc-case-body">
                <b class="kc-case-title">${big ? 'Большой кейс' : 'Малый кейс'}</b>
                <span class="kc-case-sub">${big ? 'Пак целиком: рамка, шапка, звонки и записи' : 'Одна вещь из любого пака'}</span>
                <span class="kc-case-in" title="Шанс пака — и в большом кейсе, и в малом">${packOdds(packs).map(({ pack, pct }) =>
                    `<span class="${isRare(pack) ? 'kc-in-rare' : ''}" style="--hue:${SKIN_PACKS[pack]?.hue ?? 260}">${esc(packLabel(pack))} · ${String(pct).replace('.', ',')}%</span>`).join('')}</span>
                <button class="btn btn-pri kc-open" data-act="open" data-kind="${kind}" ${state.busy || shut ? 'disabled' : ''}>
                    ${shut ? 'Сезон закрыт' : `Открыть · ${big ? `${keyIcon(16)} 1 ключ` : `${gem(16)} ${SMALL_CASE_PRICE}`}`}
                </button>
            </div>
        </div>`;
    }

    // Примерочная: слева превью «как вас увидят другие», где каждая часть
    // нажимается, справа — картинки скинов для выбранной части. Своё
    // выбирается, чужое под замком: скинов будут десятки, и строка чипов на
    // часть превратилась бы в полосу через весь экран. Надевается кнопкой —
    // перебирать можно свободно.
    function fitHtml() {
        const draft = state.draft || mineParts();
        const mine = mineParts();
        const changed = SKIN_PARTS.some(p => (draft[p.id] || null) !== (mine[p.id] || null));
        const part = state.fitPart;
        const have = state.owned.length;
        const total = allItems().length;
        const op = localOperator(user?.id);
        return `
        <div class="kc-fit">
            ${previewHtml(draft, part)}
            <div class="kc-fit-side">
                <div class="kc-fit-head">
                    <b>${esc(PART_LABEL[part])}</b>
                    <span>в коллекции ${have} из ${total}</span>
                </div>
                ${tilesHtml(part, draft[part] || '', mine[part] || '')}
                <div class="kc-fit-btns">
                    <button class="btn btn-pri" data-act="wear" ${changed && !state.busy ? '' : 'disabled'}>Надеть</button>
                    <button class="btn btn-sec" data-act="fit-reset" ${changed ? '' : 'disabled'}>Как сейчас</button>
                </div>
                <div class="kc-fit-hint">${skinState().canEdit ? 'Вам открыто всё — для проверки паков. ' : ''}${part !== 'leads' ? ''
                    : op ? `Ваши звонки в ленте узнаются по коду оператора ${esc(op)}.`
                        : 'Скин звонков заработает, когда во вкладке «Лиды» будет введён «Мой код».'}</div>
            </div>
        </div>`;
    }

    // Плитки части: «Стандартный» и все нарисованные паки. Не выпавшее — под
    // замком и не нажимается: видно, что ещё есть и за чем крутить кейсы.
    function tilesHtml(part, cur, worn) {
        const can = new Set(wearable(part));
        const packs = Object.keys(SKIN_PACKS).filter(p => packHasPart(p, part));
        const tile = (pack, inner, name) => {
            const locked = Boolean(pack) && !can.has(pack);
            const cls = ['kc-tile', pack === cur ? 'kc-tile-on' : '', locked ? 'kc-tile-lock' : '', pack && isRare(pack) ? 'kc-tile-rare' : ''].join(' ');
            return `
            <button type="button" class="${cls}" ${locked ? 'data-locked="1" aria-disabled="true"' : `data-fit-part="${part}" data-fit-pack="${esc(pack)}"`}
                    style="--hue:${SKIN_PACKS[pack]?.hue ?? 260}" aria-pressed="${pack === cur}"
                    title="${locked ? 'Ещё не выпало — выпадает из кейсов' : esc(name)}">
                ${inner}
                ${locked ? `<span class="kc-tile-lock-ico">${lockIcon()}</span>` : ''}
                ${pack === worn ? '<span class="kc-tile-worn">надето</span>' : ''}
                <span class="kc-tile-name">${esc(name)}</span>
            </button>`;
        };
        return `<div class="kc-tiles">
            ${tile('', '<span class="kc-thumb kc-thumb-none"></span>', 'Стандартный')}
            ${packs.map(p => tile(p, thumbHtml({ pack: p, part }), packLabel(p))).join('')}
        </div>`;
    }

    function previewHtml(d, active) {
        const name = esc(user?.display_name || 'Вы');
        const ava = user?.avatar ? `<img src="${esc(user.avatar)}" alt="">` : `<i>${esc(String(user?.display_name || '?').charAt(0).toUpperCase())}</i>`;
        const pv = (part) => `data-skin-part="${part}" data-skin-pack="${esc(d[part] || '')}"`;
        // Часть превью — кнопка: нажал на рамку — справа рамки.
        const zone = (part, inner, cls = '') => `
            <div class="kc-zone ${cls}${part === active ? ' kc-zone-on' : ''}" data-zone="${part}" role="button" tabindex="0"
                 data-zone-label="${esc(PART_LABEL[part])}" aria-label="Выбрать: ${esc(PART_LABEL[part])}">${inner}</div>`;
        return `
        <div class="kc-pv" aria-label="Так вас увидят другие">
            <div class="kc-pv-tip">Нажмите на часть, чтобы выбрать скин</div>
            <div class="kc-pv-hero">
                ${zone('cover', `<div class="kc-pv-cover" ${pv('cover')}></div>`, 'kc-zone-cover')}
                <div class="kc-pv-ident">
                    ${zone('frame', `<span class="kc-pv-ava" ${pv('frame')}>${ava}</span>`, 'kc-zone-ava')}
                    <b>${name}</b>
                </div>
            </div>
            ${zone('leads', `
            <div class="ld-call kc-pv-call" ${pv('leads')}>
                <span class="ld-call-main">
                    <span class="ld-call-top"><span class="ld-call-phone">+7 (921) 000-00-00</span><span class="ld-call-time">12:40</span></span>
                    <span class="ld-call-who">Новый клиент</span>
                    <span class="ld-call-bottom"><span class="ld-st">принят</span><span class="ld-call-meta">ваш звонок</span></span>
                </span>
            </div>`)}
            ${zone('records', `
            <div class="kc-pv-board">
                <div class="kc-pv-cap" ${pv('records')} data-skin-slots="1"><b>Запись</b><span>10:00–10:30</span></div>
                <div class="kc-pv-cap kc-pv-cap-3" ${pv('records')} data-skin-slots="3"><b>Длинная запись</b><span>11:00–12:30</span></div>
            </div>`)}
        </div>`;
    }

    // Обложка сезона и срок: «до 30 ноября» в сезон, «вернётся 1 марта» вне
    // его. Выпавшее носится круглый год — закрывается только открытие.
    function seasonHtml() {
        const s = state.season, n = state.next;
        const title = s?.title || n?.title || '';
        const when = s ? `кейсы открыты до ${dayLabel(s.ends)}` : n ? `сезон вернётся ${dayLabel(n.starts)} — выпавшее остаётся с вами` : 'кейсы закрыты';
        return `
            ${ART.cover && title ? `<div class="kc-cover${s ? '' : ' kc-cover-off'}" style="background-image:url('${ART.cover}')"><span>${esc(title)}</span></div>` : ''}
            <div class="kc-season${s ? '' : ' kc-season-off'}">${esc(when)}</div>`;
    }

    function render() {
        if (state.status === 'loading') { host.innerHTML = '<div class="kc-loading">Загружаю кошелёк…</div>'; return; }
        if (state.status === 'error') {
            host.innerHTML = `<div class="kc-loading">Кошелёк не загрузился: ${esc(state.error)} <button class="btn btn-sec" data-act="reload">Ещё раз</button></div>`;
            return;
        }
        const w = state.wallet;
        host.innerHTML = `
            ${seasonHtml()}
            ${walletHtml(w)}
            <div class="kc-cases">${caseCardHtml('big')}${caseCardHtml('small')}</div>
            <h4 class="kc-h">Магазин гемов</h4>
            ${shopHtml(w)}
            <h4 class="kc-h" id="kc-fit-h">Примерочная <span>так вас увидят другие</span></h4>
            ${fitHtml()}`;
    }

    // ── Действия ─────────────────────────────────────────────────────────────

    // Итог действия — всплывашкой у низа экрана, а не строкой в магазине:
    // строка «Надето» висела бы там до следующего действия и занимала место.
    // Тут это уместно, в отличие от «Записей» и «Чатов»: итог виден в тот же
    // миг, когда человек смотрит на кнопку, и терять в нём нечего.
    const say = (text, err = false) => toast(text, err);

    async function post(path, body) {
        const data = await apiFetch(path, { method: 'POST', body });
        if (data.balance) state.wallet = data.balance;
        if (data.owned) state.owned = data.owned;
        return data;
    }

    async function exchange(from, gems) {
        state.busy = 'exchange';
        render();
        try {
            await post('/api/cases/exchange', { from, gems });
            say(`+${gems} ${gemsWord(gems)}`);
        } catch (e) { say(e.message, true); }
        state.busy = '';
        render();
    }

    host.addEventListener('click', async (e) => {
        const zone = e.target.closest('[data-zone]');
        if (zone && !e.target.closest('[data-act], [data-fit-part]')) {
            state.fitPart = zone.dataset.zone;
            render();
            return;
        }
        if (e.target.closest('[data-locked]')) { say('Этого скина у вас ещё нет — он выпадает из кейсов'); return; }
        const btn = e.target.closest('[data-act], [data-fit-part]');
        if (!btn || btn.disabled) return;
        if (btn.dataset.fitPart) {
            state.draft = { ...(state.draft || mineParts()), [btn.dataset.fitPart]: btn.dataset.fitPack || null };
            render();
            return;
        }
        const act = btn.dataset.act;
        if (act === 'reload') { state.status = 'loading'; render(); load(); }
        if (act === 'exchange') {
            const input = host.querySelector(`[data-amount="${btn.dataset.from}"]`);
            exchange(btn.dataset.from, Math.floor(Number(input?.value) || 0));
        }
        if (act === 'xp') exchange('xp', Math.floor(state.wallet.xp / XP_PER_GEM));
        if (act === 'key') {
            state.busy = 'key';
            render();
            try { await post('/api/cases/key', {}); say('Ключ куплен'); } catch (err) { say(err.message, true); }
            state.busy = '';
            render();
        }
        if (act === 'open') openFlow(btn.dataset.kind);
        if (act === 'fit-reset') { state.draft = null; render(); }
        if (act === 'wear') {
            state.busy = 'wear';
            render();
            try {
                await saveMySkin({ parts: state.draft, operator: localOperator(user?.id) });
                state.draft = null;
                say('Надето — так вас теперь видят все');
            } catch (err) { say(err.message, true); }
            state.busy = '';
            render();
        }
    }, { signal: off.signal });
    // Части превью — кнопки и с клавиатуры.
    host.addEventListener('keydown', (e) => {
        const zone = e.target.closest?.('[data-zone]');
        if (!zone || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        state.fitPart = zone.dataset.zone;
        render();
        host.querySelector(`[data-zone="${state.fitPart}"]`)?.focus();
    }, { signal: off.signal });

    // Открытие: сначала — чего не хватает и чем доплатить, потом сундук, лента
    // и приз. Все траты — отдельными запросами: обмен прошёл, а кейс нет —
    // гемы остаются у человека, ничего не пропадает.
    async function openFlow(kind) {
        const w = state.wallet;
        const big = kind === 'big';
        const modal = caseModal();
        const needGems = big ? (w.keys > 0 ? 0 : KEY_PRICE) : SMALL_CASE_PRICE;
        const short = Math.max(0, needGems - w.gems);
        const steps = [];
        if (short > 0) {
            // Неразрывные пробелы после чисел и коротких слов: «10» в конце
            // строки и «записей» в начале следующей читаются как два разных
            // числа, а висящее «у» — как опечатка.
            const nb = (t) => t.replace(/(^|[\s(])(\d+|[а-яё]{1,2}) /gi, '$1$2\u00a0');
            const facts = [
                [big ? 'стоит ключ' : 'стоит кейс', String(needGems)],
                ['у вас', String(w.gems)],
                ['не хватает', String(short), true],
            ];
            if (w.rubles < short) {
                modal.ask({
                    title: big ? 'Нужен ключ' : 'Не хватает гемов',
                    facts,
                    text: [
                        nb(w.rubles > 0 ? `Рублей из донатов на счёте ${w.rubles} ₽ — на доплату не хватит.` : 'Рублей из донатов на счёте нет — доплатить нечем.'),
                        nb(`Записи и опыт меняются на гемы в магазине ниже: ${`${RECORDS_PER_GEM} записей = 1 гем`.replaceAll(' ', '\u00a0')}, у вас ${w.records}.`),
                    ],
                    buttons: [['close', 'Понятно', 'btn-sec']],
                });
                return;
            }
            const ok = await modal.ask({
                title: big ? 'Нужен ключ' : 'Не хватает гемов',
                facts,
                text: nb(`Обменять ${short} ₽ из донатов на ${short} ${gemsWord(short)}${big ? ', купить ключ' : ''} и открыть?`),
                buttons: [['ok', `Обменять ${short} ₽ и открыть`, 'btn-pri'], ['close', 'Отмена', 'btn-sec']],
            });
            if (ok !== 'ok') return;
            steps.push(() => post('/api/cases/exchange', { from: 'rubles', gems: short }));
        } else if (big && w.keys < 1) {
            const ok = await modal.ask({
                title: 'Нужен ключ',
                text: `Большой кейс открывается ключом. Купить ключ за ${KEY_PRICE} гемов и открыть? Останется ${w.gems - KEY_PRICE} ${gemsWord(w.gems - KEY_PRICE)}.`,
                buttons: [['ok', `Купить ключ и открыть`, 'btn-pri'], ['close', 'Отмена', 'btn-sec']],
            });
            if (ok !== 'ok') return;
        }
        if (big && w.keys < 1) steps.push(() => post('/api/cases/key', {}));

        state.busy = 'open';
        render();
        try {
            for (const step of steps) await step();
            const result = modal.spin(kind, post('/api/cases/open', { kind }).then(r => ({ ...r, packs: state.packs })));
            const res = await result;
            if (res?.tryOn) {
                const d = { ...(state.draft || mineParts()) };
                for (const g of (res.prize.part ? [res.prize] : SKIN_PARTS.map(p => ({ pack: res.prize.pack, part: p.id })))) d[g.part] = g.pack;
                state.draft = d;
                state.fitPart = res.prize.part || 'cover';
            }
        } catch (err) {
            say(err.message, true);
            modal.close();
        }
        state.busy = '';
        render();
        if (state.draft) host.querySelector('#kc-fit-h')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    render();
    load();
}

// ── Всплывашка итога ────────────────────────────────────────────────────────

let toastTimer = 0;
function toast(text, err = false) {
    let el = document.getElementById('kc-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'kc-toast';
        el.className = 'kc-toast';
        el.setAttribute('role', 'status');
        document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.toggle('kc-toast-err', err);
    el.classList.add('kc-toast-on');
    clearTimeout(toastTimer);
    // Отказ висит дольше: его причину надо успеть прочитать.
    toastTimer = setTimeout(() => el.classList.remove('kc-toast-on'), err ? 5000 : 2400);
}

// ── Окно кейса: вопрос, сундук, лента, приз ─────────────────────────────────

function caseModal() {
    document.getElementById('kc-modal')?.remove();
    const el = document.createElement('div');
    el.id = 'kc-modal';
    el.className = 'kc-modal';
    el.innerHTML = '<div class="kc-modal-back"></div><div class="kc-modal-win" role="dialog" aria-modal="true"></div>';
    document.body.appendChild(el);
    const win = el.querySelector('.kc-modal-win');
    let locked = false;     // пока крутится — не закрывается
    let resolveAsk = null;
    const close = () => { el.remove(); resolveAsk?.('close'); };
    el.querySelector('.kc-modal-back').onclick = () => { if (!locked) close(); };
    const onKey = (e) => { if (e.key === 'Escape' && !locked) { close(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);

    return {
        close,
        // facts — цифры в гемах отдельной строкой ячеек («стоит / у вас / не хватает»):
        // одним абзацем они рвались переносами посреди «10 записей», и считать
        // приходилось, перечитывая предложение. text — строка или абзацы.
        ask({ title, text, facts, buttons }) {
            const paras = [].concat(text || []);
            win.innerHTML = `
                <div class="kc-ask">
                    <b class="kc-ask-title">${esc(title)}</b>
                    ${facts ? `<div class="kc-ask-facts">${facts.map(([label, value, bad]) => `
                        <div class="kc-ask-fact${bad ? ' kc-ask-fact-bad' : ''}"><b>${gem(20)}${esc(value)}</b><span>${esc(label)}</span></div>`).join('')}</div>` : ''}
                    ${paras.map(t => `<p>${esc(t)}</p>`).join('')}
                    <div class="kc-ask-btns">${buttons.map(([id, label, cls]) => `<button class="btn ${cls}" data-ask="${id}">${esc(label)}</button>`).join('')}</div>
                </div>`;
            return new Promise((resolve) => {
                resolveAsk = (v) => { resolveAsk = null; resolve(v); };
                win.querySelectorAll('[data-ask]').forEach(b => {
                    b.onclick = () => { const v = b.dataset.ask; if (v === 'close') close(); else resolveAsk?.(v); };
                });
            });
        },
        // Сундук трясётся, пока сервер разыгрывает приз (но не меньше секунды —
        // иначе тряски не видно), потом открывается, лента едет и встаёт на
        // призе. Возвращает выбор на экране приза.
        async spin(kind, request) {
            locked = true;
            win.innerHTML = `
                <div class="kc-stage">
                    <div class="kc-stage-chest kc-shake">${chestImg(kind)}</div>
                    <div class="kc-stage-text">Открываю…</div>
                </div>`;
            let res;
            try {
                [res] = await Promise.all([request, wait(REDUCED ? 200 : SHAKE_MS)]);
            } catch (err) { locked = false; throw err; }
            const chest = win.querySelector('.kc-stage-chest');
            chest.classList.remove('kc-shake');
            chest.classList.add('kc-burst');
            chest.innerHTML = chestImg(kind, true);
            await wait(REDUCED ? 100 : BURST_MS);

            // Лента: случайные вещи вокруг приза, приз — на PRIZE_AT.
            const big = kind === 'big';
            // Карточки вокруг приза тянутся с ТЕМИ ЖЕ весами, что и розыгрыш:
            // редкий мелькает в ленте редко, как ему и положено.
            const odds = packOdds(res.packs);
            const fill = () => {
                let r = Math.random() * 100;
                const pack = (odds.find(o => (r -= o.pct) < 0) || odds[0]).pack;
                return big ? { pack } : { pack, part: SKIN_PARTS[Math.floor(Math.random() * SKIN_PARTS.length)].id };
            };
            const N = 64, PRIZE_AT = 56;
            const items = Array.from({ length: N }, (_, i) => (i === PRIZE_AT ? res.prize : fill()));
            win.innerHTML = `
                <div class="kc-roll">
                    <div class="kc-roll-win"><div class="kc-strip">${items.map((it, i) => itemCardHtml(it, i === PRIZE_AT ? 'kc-card-prize' : '')).join('')}</div>
                    <i class="kc-roll-mark"></i></div>
                </div>`;
            const strip = win.querySelector('.kc-strip');
            const card = strip.children[PRIZE_AT];
            const view = win.querySelector('.kc-roll-win').clientWidth;
            const step = card.offsetWidth + parseFloat(getComputedStyle(strip).columnGap || '0');
            // Встаёт не ровно по центру карточки: «чуть не доехало» — половина
            // удовольствия от ленты.
            const jitter = (Math.random() - 0.5) * card.offsetWidth * 0.7;
            const x = -(PRIZE_AT * step + card.offsetWidth / 2 - view / 2 + jitter);
            strip.style.transform = 'translateX(0)';
            strip.getBoundingClientRect();
            strip.style.transition = `transform ${REDUCED ? 0.6 : ROLL_S}s cubic-bezier(0.06, 0.55, 0.06, 1)`;
            strip.style.transform = `translateX(${x}px)`;
            await new Promise(r => strip.addEventListener('transitionend', r, { once: true }));
            card.classList.add('kc-card-won');
            await wait(REDUCED ? 100 : WON_MS);

            locked = false;
            const p = res.prize;
            const title = p.part ? `${packLabel(p.pack)} · ${PART_LABEL[p.part]}` : `Пак «${packLabel(p.pack)}» целиком`;
            const dupText = res.dup
                ? (p.part ? `Уже было — +${res.xp} опыта` : res.grant.length
                    ? `Новое: ${res.grant.map(g => PART_LABEL[g.part].toLowerCase()).join(', ')}. Остальное уже было — +${res.xp} опыта`
                    : `Весь пак уже был — +${res.xp} опыта`)
                : 'Новая вещь в коллекции';
            win.innerHTML = `
                <div class="kc-prize${isRare(p.pack) ? ' kc-prize-rare' : ''}">
                    <div class="kc-prize-glow"></div>
                    ${itemCardHtml(p, 'kc-card-big')}
                    ${isRare(p.pack) ? '<span class="kc-prize-rare-tag">Редкий!</span>' : ''}
                    <b class="kc-prize-title">${esc(title)}</b>
                    <span class="kc-prize-sub${res.dup ? ' kc-prize-dup' : ''}">${esc(dupText)}</span>
                    <div class="kc-ask-btns">
                        <button class="btn btn-sec" data-prize="go">Продолжить</button>
                        <button class="btn btn-pri" data-prize="try">Примерить</button>
                    </div>
                </div>`;
            return new Promise((resolve) => {
                win.querySelectorAll('[data-prize]').forEach(b => {
                    b.onclick = () => { el.remove(); document.removeEventListener('keydown', onKey); resolve({ ...res, tryOn: b.dataset.prize === 'try' }); };
                });
                resolveAsk = () => resolve(res);
            });
        },
    };
}
