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
import { KEY_PRICE, SMALL_CASE_PRICE, RECORDS_PER_GEM, XP_PER_GEM, allItems, casePacks, gemsWord } from '../../shared/cases.js';
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

const gem = (px = 18) => `<span class="cs-gem">${gemImgHtml(px)}</span>`;
const svg = (body, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const keyIcon = (px = 18) => ART.key
    ? `<img class="cs-key-img" src="${ART.key}" alt="" width="${px}" height="${px}" draggable="false">`
    : svg('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M15 8l2 2"/>', px);
const chestIcon = (px) => svg('<rect x="3" y="9" width="18" height="11" rx="2"/><path d="M3 13h18M5 9V7a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/><rect x="10.5" y="11.5" width="3" height="4" rx="1"/>', px);
const chestImg = (kind, open = false) => {
    const url = ART[`chest-${kind}${open ? '-open' : ''}`];
    return url ? `<img class="cs-chest-img" src="${url}" alt="" draggable="false">` : `<span class="cs-chest-ico">${chestIcon(kind === 'big' ? 64 : 48)}</span>`;
};

// Картинка вещи: рамка — рамкой, шапка и звонки — картинкой шапки, записи —
// котом целиком. Пак целиком (большой кейс) — шапкой пака.
function thumbHtml({ pack, part }) {
    const art = skinArt[pack] || {};
    const url = part === 'frame' ? art.frame : part === 'records' ? art.single : art.banner;
    const fit = part === 'frame' || part === 'records' ? 'contain' : 'cover';
    return url ? `<span class="cs-thumb cs-thumb-${fit}" style="background-image:url('${url}')"></span>` : '<span class="cs-thumb"></span>';
}
function itemCardHtml(item, cls = '') {
    const hue = SKIN_PACKS[item.pack]?.hue ?? 260;
    return `
        <div class="cs-card ${cls}" style="--hue:${hue}">
            ${thumbHtml(item.part ? item : { pack: item.pack, part: 'cover' })}
            <span class="cs-card-name">${esc(packLabel(item.pack))}</span>
            <span class="cs-card-part">${esc(item.part ? PART_LABEL[item.part] : 'пак целиком')}</span>
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
        draft: null,           // примерочная: { part: pack|null }
        busy: '', note: '', noteErr: false,
    };

    async function load() {
        try {
            const data = await apiFetch('/api/cases');
            state.wallet = data.balance;
            state.owned = data.owned || [];
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
        <div class="cs-wallet">
            <div class="cs-bal cs-bal-gems" title="Гемы — на них открываются кейсы">${gem(30)}<b data-morph="cs-gems">${w.gems}</b><span>${gemsWord(w.gems)}</span></div>
            <div class="cs-bal" title="Ключи от большого кейса">${keyIcon(22)}<b>${w.keys}</b><span>${plural(w.keys, 'ключ', 'ключа', 'ключей')}</span></div>
            <div class="cs-xp" title="Опыт копится от повторов из кейсов: ${XP_PER_GEM} опыта — гем">
                <span class="cs-xp-top"><span>Опыт до гема</span><b>${w.xp % XP_PER_GEM} / ${XP_PER_GEM}</b></span>
                <span class="cs-bar"><i style="width:${pct}%"></i></span>
            </div>
        </div>`;
    }

    function shopRowHtml({ id, title, have, rate, unit }) {
        const max = Math.floor(have / rate);
        return `
        <div class="cs-shop-row">
            <div class="cs-shop-text">
                <b>${title}</b>
                <span>${have} ${unit} · ${rate} = 1 гем</span>
            </div>
            <div class="cs-shop-act">
                <input class="cs-in" type="number" min="1" max="${Math.max(1, max)}" value="${Math.max(1, max)}" data-amount="${id}" ${max ? '' : 'disabled'} aria-label="Сколько гемов">
                <button class="btn btn-sec" data-act="exchange" data-from="${id}" ${max && !state.busy ? '' : 'disabled'}>${gem(16)} Обменять</button>
            </div>
        </div>`;
    }

    function shopHtml(w) {
        return `
        <div class="cs-shop">
            ${shopRowHtml({ id: 'records', title: 'Записи → гемы', have: w.records, rate: RECORDS_PER_GEM, unit: plural(w.records, 'запись', 'записи', 'записей') })}
            ${shopRowHtml({ id: 'rubles', title: 'Рубли из донатов → гемы', have: w.rubles, rate: 1, unit: '₽' })}
            <div class="cs-shop-row">
                <div class="cs-shop-text"><b>Опыт → гем</b><span>${w.xp} опыта · ${XP_PER_GEM} = 1 гем</span></div>
                <div class="cs-shop-act">
                    <button class="btn btn-sec" data-act="xp" ${w.xp >= XP_PER_GEM && !state.busy ? '' : 'disabled'}>${gem(16)} Забрать${w.xp >= 2 * XP_PER_GEM ? ` ${Math.floor(w.xp / XP_PER_GEM)}` : ''}</button>
                </div>
            </div>
            <div class="cs-shop-row">
                <div class="cs-shop-text"><b>Ключ от большого кейса</b><span>${KEY_PRICE} гемов</span></div>
                <div class="cs-shop-act">
                    <button class="btn btn-sec" data-act="key" ${w.gems >= KEY_PRICE && !state.busy ? '' : 'disabled'}>${keyIcon(16)} Купить</button>
                </div>
            </div>
            <div class="cs-note${state.noteErr ? ' cs-note-err' : ''}" aria-live="polite">${esc(state.note)}</div>
        </div>`;
    }

    function caseCardHtml(kind) {
        const big = kind === 'big';
        const packs = casePacks();
        return `
        <div class="cs-case cs-case-${kind}">
            <div class="cs-case-chest">${chestImg(kind)}</div>
            <div class="cs-case-body">
                <b class="cs-case-title">${big ? 'Большой кейс' : 'Малый кейс'}</b>
                <span class="cs-case-sub">${big ? 'Пак целиком: рамка, шапка, звонки и записи' : 'Одна вещь из любого пака'}</span>
                <span class="cs-case-in">${packs.map(p => `<span style="--hue:${SKIN_PACKS[p]?.hue ?? 260}">${esc(packLabel(p))}</span>`).join('')}</span>
                <button class="btn btn-pri cs-open" data-act="open" data-kind="${kind}" ${state.busy ? 'disabled' : ''}>
                    Открыть · ${big ? `${keyIcon(16)} 1 ключ` : `${gem(16)} ${SMALL_CASE_PRICE}`}
                </button>
            </div>
        </div>`;
    }

    // Примерочная: по строке на часть (что можно надеть) и предпросмотр — то,
    // как скин увидят другие. Надевается кнопкой: перебирать можно свободно.
    function fitHtml() {
        const draft = state.draft || mineParts();
        const mine = mineParts();
        const changed = SKIN_PARTS.some(p => (draft[p.id] || null) !== (mine[p.id] || null));
        const have = state.owned.length;
        const total = allItems().length;
        const rows = SKIN_PARTS.map(({ id, label }) => {
            const packs = wearable(id);
            const cur = draft[id] || '';
            const opts = [['', 'Стандартный'], ...packs.map(p => [p, packLabel(p)])];
            return `
            <div class="cs-fit-row">
                <span class="cs-fit-label">${esc(label)}</span>
                <div class="cs-fit-opts" data-seg="cs-fit-${id}">${opts.map(([p, name]) => `
                    <button type="button" class="chip${p === cur ? ' active' : ''}" data-fit-part="${id}" data-fit-pack="${esc(p)}"
                            aria-pressed="${p === cur}">${esc(name)}</button>`).join('')}</div>
            </div>`;
        }).join('');
        return `
        <div class="cs-fit">
            <div class="cs-fit-side">
                <div class="cs-fit-have">В коллекции ${have} из ${total}${skinState().canEdit ? ' · вам открыто всё для проверки' : ''}</div>
                ${rows}
                <div class="cs-fit-btns">
                    <button class="btn btn-pri" data-act="wear" ${changed && !state.busy ? '' : 'disabled'}>Надеть</button>
                    <button class="btn btn-sec" data-act="fit-reset" ${changed ? '' : 'disabled'}>Как сейчас</button>
                </div>
                <div class="cs-fit-hint">${localOperator(user?.id)
                    ? `Звонки в ленте лидов узнаются по коду оператора ${esc(localOperator(user?.id))}.`
                    : 'Скин звонков заработает, когда во вкладке «Лиды» будет введён «Мой код».'}</div>
            </div>
            ${previewHtml(draft)}
        </div>`;
    }

    function previewHtml(d) {
        const name = esc(user?.display_name || 'Вы');
        const ava = user?.avatar ? `<img src="${esc(user.avatar)}" alt="">` : `<i>${esc(String(user?.display_name || '?').charAt(0).toUpperCase())}</i>`;
        const pv = (part) => `data-skin-part="${part}" data-skin-pack="${esc(d[part] || '')}"`;
        return `
        <div class="cs-pv" aria-label="Так вас увидят другие">
            <div class="cs-pv-hero">
                <div class="cs-pv-cover" ${pv('cover')}></div>
                <div class="cs-pv-ident">
                    <span class="cs-pv-ava" ${pv('frame')}>${ava}</span>
                    <b>${name}</b>
                </div>
            </div>
            <div class="ld-call cs-pv-call" ${pv('leads')}>
                <span class="ld-call-main">
                    <span class="ld-call-top"><span class="ld-call-phone">+7 (921) 000-00-00</span><span class="ld-call-time">12:40</span></span>
                    <span class="ld-call-who">Новый клиент</span>
                    <span class="ld-call-bottom"><span class="ld-st">принят</span><span class="ld-call-meta">ваш звонок</span></span>
                </span>
            </div>
            <div class="cs-pv-board">
                <div class="cs-pv-cap" ${pv('records')} data-skin-slots="1"><b>Запись</b><span>10:00–10:30</span></div>
                <div class="cs-pv-cap cs-pv-cap-3" ${pv('records')} data-skin-slots="3"><b>Длинная запись</b><span>11:00–12:30</span></div>
            </div>
        </div>`;
    }

    function render() {
        if (state.status === 'loading') { host.innerHTML = '<div class="cs-loading">Загружаю кошелёк…</div>'; return; }
        if (state.status === 'error') {
            host.innerHTML = `<div class="cs-loading">Кошелёк не загрузился: ${esc(state.error)} <button class="btn btn-sec" data-act="reload">Ещё раз</button></div>`;
            return;
        }
        const w = state.wallet;
        host.innerHTML = `
            ${ART.cover ? `<div class="cs-cover" style="background-image:url('${ART.cover}')"><span>Кейсы</span></div>` : ''}
            ${walletHtml(w)}
            <div class="cs-cases">${caseCardHtml('big')}${caseCardHtml('small')}</div>
            <h4 class="cs-h">Магазин гемов</h4>
            ${shopHtml(w)}
            <h4 class="cs-h" id="cs-fit-h">Примерочная <span>так вас увидят другие</span></h4>
            ${fitHtml()}`;
    }

    // ── Действия ─────────────────────────────────────────────────────────────

    const say = (text, err = false) => { state.note = text; state.noteErr = err; };

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
            if (w.rubles < short) {
                modal.ask({
                    title: big ? 'Нужен ключ' : 'Не хватает гемов',
                    text: `${big ? `Ключ стоит ${KEY_PRICE} гемов` : `Кейс стоит ${SMALL_CASE_PRICE} гемов`}, у вас ${w.gems}. Не хватает ${short} ${gemsWord(short)}, а рублей из донатов на счёте ${w.rubles} ₽. Гемы дают записи (${RECORDS_PER_GEM} записей — гем, у вас ${w.records}) и опыт — меняются в магазине ниже.`,
                    buttons: [['close', 'Понятно', 'btn-sec']],
                });
                return;
            }
            const ok = await modal.ask({
                title: big ? 'Нужен ключ' : 'Не хватает гемов',
                text: `${big ? `Ключ стоит ${KEY_PRICE} гемов` : `Кейс стоит ${SMALL_CASE_PRICE} гемов`}, у вас ${w.gems}. Обменять ${short} ₽ из донатов на ${short} ${gemsWord(short)}${big ? ', купить ключ' : ''} и открыть?`,
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
            const result = modal.spin(kind, post('/api/cases/open', { kind }));
            const res = await result;
            if (res?.tryOn) {
                const d = { ...(state.draft || mineParts()) };
                for (const g of (res.prize.part ? [res.prize] : SKIN_PARTS.map(p => ({ pack: res.prize.pack, part: p.id })))) d[g.part] = g.pack;
                state.draft = d;
            }
        } catch (err) {
            say(err.message, true);
            modal.close();
        }
        state.busy = '';
        render();
        if (state.draft) host.querySelector('#cs-fit-h')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    render();
    load();
}

// ── Окно кейса: вопрос, сундук, лента, приз ─────────────────────────────────

function caseModal() {
    document.getElementById('cs-modal')?.remove();
    const el = document.createElement('div');
    el.id = 'cs-modal';
    el.className = 'cs-modal';
    el.innerHTML = '<div class="cs-modal-back"></div><div class="cs-modal-win" role="dialog" aria-modal="true"></div>';
    document.body.appendChild(el);
    const win = el.querySelector('.cs-modal-win');
    let locked = false;     // пока крутится — не закрывается
    let resolveAsk = null;
    const close = () => { el.remove(); resolveAsk?.('close'); };
    el.querySelector('.cs-modal-back').onclick = () => { if (!locked) close(); };
    const onKey = (e) => { if (e.key === 'Escape' && !locked) { close(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);

    return {
        close,
        ask({ title, text, buttons }) {
            win.innerHTML = `
                <div class="cs-ask">
                    <b class="cs-ask-title">${esc(title)}</b>
                    <p>${esc(text)}</p>
                    <div class="cs-ask-btns">${buttons.map(([id, label, cls]) => `<button class="btn ${cls}" data-ask="${id}">${esc(label)}</button>`).join('')}</div>
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
                <div class="cs-stage">
                    <div class="cs-stage-chest cs-shake">${chestImg(kind)}</div>
                    <div class="cs-stage-text">Открываю…</div>
                </div>`;
            let res;
            try {
                [res] = await Promise.all([request, wait(REDUCED ? 200 : 1100)]);
            } catch (err) { locked = false; throw err; }
            const chest = win.querySelector('.cs-stage-chest');
            chest.classList.remove('cs-shake');
            chest.classList.add('cs-burst');
            chest.innerHTML = chestImg(kind, true);
            await wait(REDUCED ? 100 : 550);

            // Лента: случайные вещи вокруг приза, приз — на PRIZE_AT.
            const big = kind === 'big';
            const pool = big ? casePacks().map(pack => ({ pack })) : allItems();
            const N = 46, PRIZE_AT = 38;
            const items = Array.from({ length: N }, (_, i) => (i === PRIZE_AT ? res.prize : pool[Math.floor(Math.random() * pool.length)]));
            win.innerHTML = `
                <div class="cs-roll">
                    <div class="cs-roll-win"><div class="cs-strip">${items.map((it, i) => itemCardHtml(it, i === PRIZE_AT ? 'cs-card-prize' : '')).join('')}</div>
                    <i class="cs-roll-mark"></i></div>
                </div>`;
            const strip = win.querySelector('.cs-strip');
            const card = strip.children[PRIZE_AT];
            const view = win.querySelector('.cs-roll-win').clientWidth;
            const step = card.offsetWidth + parseFloat(getComputedStyle(strip).columnGap || '0');
            // Встаёт не ровно по центру карточки: «чуть не доехало» — половина
            // удовольствия от ленты.
            const jitter = (Math.random() - 0.5) * card.offsetWidth * 0.7;
            const x = -(PRIZE_AT * step + card.offsetWidth / 2 - view / 2 + jitter);
            strip.style.transform = 'translateX(0)';
            strip.getBoundingClientRect();
            strip.style.transition = `transform ${REDUCED ? 0.6 : 6.2}s cubic-bezier(0.1, 0.62, 0.12, 1)`;
            strip.style.transform = `translateX(${x}px)`;
            await new Promise(r => strip.addEventListener('transitionend', r, { once: true }));
            card.classList.add('cs-card-won');
            await wait(REDUCED ? 100 : 700);

            locked = false;
            const p = res.prize;
            const title = p.part ? `${packLabel(p.pack)} · ${PART_LABEL[p.part]}` : `Пак «${packLabel(p.pack)}» целиком`;
            const dupText = res.dup
                ? (p.part ? `Уже было — +${res.xp} опыта` : res.grant.length
                    ? `Новое: ${res.grant.map(g => PART_LABEL[g.part].toLowerCase()).join(', ')}. Остальное уже было — +${res.xp} опыта`
                    : `Весь пак уже был — +${res.xp} опыта`)
                : 'Новая вещь в коллекции';
            win.innerHTML = `
                <div class="cs-prize">
                    <div class="cs-prize-glow"></div>
                    ${itemCardHtml(p, 'cs-card-big')}
                    <b class="cs-prize-title">${esc(title)}</b>
                    <span class="cs-prize-sub${res.dup ? ' cs-prize-dup' : ''}">${esc(dupText)}</span>
                    <div class="cs-ask-btns">
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
