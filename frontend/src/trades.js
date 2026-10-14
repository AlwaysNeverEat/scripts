// ─────────────────────────────────────────────────────────────────────────────
// Обменник и маркет скинов — вкладки «Обмен» и «Маркет» панели «Скины»
// профиля. Правила — shared/trades.js, ручки — /api/trades.
//
// Здесь, как и в кейсах, НИЧЕГО не решается: можно ли обменяться, хватает ли
// гемов и чья теперь вещь — говорит сервер под замком обоих кошельков. Окно
// только не даёт собрать заведомо мёртвое (свою вещь, которая у него уже
// есть, нельзя положить в обмен) и показывает ответ.
//
// После обмена и покупки кошелёк и вещи у человека другие — кейсы и
// примерочная перечитываются по событию `wallet:changed`, скины всего сайта —
// через loadSkins (отданная вещь снимается с хозяина).
// ─────────────────────────────────────────────────────────────────────────────

import './trades.css';
import { SKIN_PACKS, SKIN_PARTS, tierOf } from '../../shared/skins.js';
import { gemsWord } from '../../shared/cases.js';
import { TRADE_GEMS_MAX, NOTE_MAX } from '../../shared/trades.js';
import { gem, thumbHtml, toast } from './cases.js';
import { loadSkins } from './skins.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PART_LABEL = Object.fromEntries(SKIN_PARTS.map(p => [p.id, p.label]));
const PART_ORDER = Object.fromEntries(SKIN_PARTS.map((p, i) => [p.id, i]));
const PACK_ORDER = Object.fromEntries(Object.keys(SKIN_PACKS).map((p, i) => [p, i]));
const packLabel = (p) => SKIN_PACKS[p]?.label || p;
const key = (it) => `${it.pack}:${it.part}`;
const byItem = (a, b) => (PACK_ORDER[a.pack] ?? 99) - (PACK_ORDER[b.pack] ?? 99) || (PART_ORDER[a.part] ?? 9) - (PART_ORDER[b.part] ?? 9);
const TIER_TAG = { rare: 'редкий', legendary: 'легендарный' };

function itemHtml(it, { attrs = '', on = false, off = '', extra = '' } = {}) {
    const tier = tierOf(it.pack);
    return `
        <button type="button" class="tr-item${on ? ' tr-item-on' : ''}${off ? ' tr-item-off' : ''}${tier !== 'common' ? ` tr-item-${tier}` : ''}"
                style="--hue:${SKIN_PACKS[it.pack]?.hue ?? 260}" ${attrs} ${off ? `aria-disabled="true" title="${esc(off)}"` : ''} aria-pressed="${on}">
            ${thumbHtml(it)}
            ${TIER_TAG[tier] ? `<em class="tr-item-tag">${TIER_TAG[tier]}</em>` : ''}
            <b>${esc(packLabel(it.pack))}</b>
            <span>${esc(PART_LABEL[it.part] || it.part)}</span>
            ${extra}
        </button>`;
}
// Вещи в карточке предложения — маленькие и не нажимаются.
const chipsHtml = (list, gems) => `
    <div class="tr-side-items">
        ${list.slice().sort(byItem).map(it => `
            <span class="tr-mini" style="--hue:${SKIN_PACKS[it.pack]?.hue ?? 260}" title="${esc(`${packLabel(it.pack)} · ${PART_LABEL[it.part] || it.part}`)}">
                ${thumbHtml(it)}<span>${esc(packLabel(it.pack))}<br><i>${esc(PART_LABEL[it.part] || it.part)}</i></span>
            </span>`).join('')}
        ${gems ? `<span class="tr-mini tr-mini-gems">${gem(22)}<b>${gems}</b><span>${gemsWord(gems)}</span></span>` : ''}
    </div>`;
const avaHtml = (p) => `<span class="tr-ava">${p?.avatar ? `<img src="${esc(p.avatar)}" alt="">` : esc(String(p?.name || '?').charAt(0).toUpperCase())}</span>`;
const STATUS = {
    pending: 'ждёт ответа', accepted: 'обмен прошёл', declined: 'отклонено',
    cancelled: 'отменено', failed: 'не прошло',
};
const when = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(+d) ? '' : d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
function changed(apiFetch) {
    window.dispatchEvent(new Event('wallet:changed'));
    loadSkins(apiFetch);
}

// ── Обмен ────────────────────────────────────────────────────────────────────

/**
 * Вкладка «Обмен». onIncoming(n) — сколько входящих ждут ответа (бейдж на
 * вкладке).
 */
export function mountTrades(host, { apiFetch, user, onIncoming = () => {} }) {
    if (!host) return null;
    host._tradesOff?.abort();
    const off = new AbortController();
    host._tradesOff = off;
    const me = user?.id;
    const state = {
        status: 'loading', error: '', gems: 0, owned: [], offers: [],
        busy: false,
        // Сборка нового предложения: null — не собираем.
        draft: null,   // { person, give: Set, want: Set, giveGems, wantGems, note }
        q: '', people: null, peopleBusy: false,
        showHistory: false,
    };

    function take(data) {
        if ('gems' in data) state.gems = data.gems;
        if (data.owned) state.owned = data.owned;
        if (data.offers) state.offers = data.offers;
        onIncoming(state.offers.filter(o => o.status === 'pending' && o.to === me).length);
    }
    async function load() {
        try {
            take(await apiFetch('/api/trades'));
            state.status = 'ready';
        } catch (e) {
            state.status = 'error';
            state.error = e.message || 'сервер не ответил';
        }
        render();
    }

    function offerHtml(o) {
        const mine = o.from === me;
        const other = mine ? o.toUser : o.fromUser;
        const pending = o.status === 'pending';
        // Сторона читается от лица смотрящего: «вы отдаёте / вы получаете».
        const giveSide = mine ? [o.give, o.giveGems] : [o.want, o.wantGems];
        const getSide = mine ? [o.want, o.wantGems] : [o.give, o.giveGems];
        return `
        <div class="tr-offer tr-offer-${o.status}${!mine && pending ? ' tr-offer-in' : ''}">
            <div class="tr-offer-head">
                ${avaHtml(other)}
                <span class="tr-offer-who">${mine ? 'Вы → ' : ''}<b>${esc(other?.name)}</b>${mine ? '' : ' → вам'}</span>
                <span class="tr-offer-st">${esc(STATUS[o.status] || o.status)}${o.reason ? ` — ${esc(o.reason)}` : ''} · ${esc(when(o.closedAt || o.createdAt))}</span>
            </div>
            ${o.note ? `<div class="tr-offer-note">«${esc(o.note)}»</div>` : ''}
            <div class="tr-offer-sides">
                <div class="tr-side"><span class="tr-side-h">Вы отдаёте</span>${chipsHtml(...giveSide)}</div>
                <span class="tr-offer-arrow" aria-hidden="true">⇄</span>
                <div class="tr-side"><span class="tr-side-h">Вы получаете</span>${chipsHtml(...getSide)}</div>
            </div>
            ${pending ? `<div class="tr-offer-btns">${mine
                ? `<button class="btn btn-sec" data-act="cancel" data-id="${o.id}" ${state.busy ? 'disabled' : ''}>Отменить</button>`
                : `<button class="btn btn-pri" data-act="accept" data-id="${o.id}" ${state.busy ? 'disabled' : ''}>Принять обмен</button>
                   <button class="btn btn-sec" data-act="decline" data-id="${o.id}" ${state.busy ? 'disabled' : ''}>Отклонить</button>`}</div>` : ''}
        </div>`;
    }

    function listHtml() {
        const pending = state.offers.filter(o => o.status === 'pending');
        const incoming = pending.filter(o => o.to === me);
        const outgoing = pending.filter(o => o.from === me);
        const history = state.offers.filter(o => o.status !== 'pending');
        return `
            <div class="tr-bar">
                <div class="tr-bar-gems">${gem(22)}<b>${state.gems}</b><span>${gemsWord(state.gems)} · вещей ${state.owned.length}</span></div>
                <button class="btn btn-pri" data-act="new">Новый обмен</button>
            </div>
            ${incoming.length ? `<h4 class="kc-h">Вам предлагают <span>${incoming.length}</span></h4>${incoming.map(offerHtml).join('')}` : ''}
            ${outgoing.length ? `<h4 class="kc-h">Ваши предложения <span>ждут ответа</span></h4>${outgoing.map(offerHtml).join('')}` : ''}
            ${!incoming.length && !outgoing.length ? `<div class="tr-empty">Открытых обменов нет. Нажмите «Новый обмен», выберите человека и вещи — у него появится предложение, и обмен пройдёт, когда он его примет.</div>` : ''}
            ${history.length ? `
                <button class="tr-more" data-act="history">${state.showHistory ? 'Скрыть историю' : `История за месяц · ${history.length}`}</button>
                ${state.showHistory ? history.map(offerHtml).join('') : ''}` : ''}`;
    }

    // Сборка предложения: сперва человек, потом две колонки вещей.
    function draftHtml() {
        const d = state.draft;
        if (!d.person) {
            return `
                <div class="tr-bar"><b class="tr-title">Новый обмен — с кем?</b><button class="btn btn-sec" data-act="close-draft">Назад</button></div>
                <input class="kc-in tr-search" type="search" placeholder="Имя или логин" value="${esc(state.q)}" data-role="q" autocomplete="off">
                <div class="tr-people">${state.people == null ? '<div class="tr-empty">Ищу…</div>'
                    : state.people.length ? state.people.map(p => `
                        <button type="button" class="tr-person" data-act="pick" data-id="${esc(p.id)}">
                            ${avaHtml(p)}<b>${esc(p.name)}</b><span>вещей: ${p.items}</span>
                        </button>`).join('')
                    : '<div class="tr-empty">Никого не нашлось. В списке только те, у кого уже есть вещи.</div>'}</div>`;
        }
        const p = d.person;
        const mineKeys = new Set(state.owned.map(key));
        const theirKeys = new Set(p.items.map(key));
        const giveGrid = state.owned.slice().sort(byItem).map(it => itemHtml(it, {
            attrs: `data-give="${esc(key(it))}"`, on: d.give.has(key(it)),
            off: theirKeys.has(key(it)) ? 'это у собеседника уже есть' : '',
        })).join('');
        const wantGrid = p.items.slice().sort(byItem).map(it => itemHtml(it, {
            attrs: `data-want="${esc(key(it))}"`, on: d.want.has(key(it)),
            off: mineKeys.has(key(it)) ? 'у вас это уже есть' : '',
        })).join('');
        const giveOk = d.give.size || d.giveGems > 0;
        const wantOk = d.want.size || d.wantGems > 0;
        const short = d.giveGems > state.gems;
        return `
            <div class="tr-bar">
                <b class="tr-title">${avaHtml(p)} Обмен · ${esc(p.name)}</b>
                <button class="btn btn-sec" data-act="repick">Другой человек</button>
                <button class="btn btn-sec" data-act="close-draft">Отмена</button>
            </div>
            <div class="tr-build">
                <div class="tr-col">
                    <h4 class="kc-h">Вы отдаёте <span>${d.give.size ? `вещей ${d.give.size}` : ''}</span></h4>
                    <div class="tr-grid">${giveGrid || '<div class="tr-empty">Своих вещей нет — можно предложить гемы.</div>'}</div>
                    <label class="tr-gems${short ? ' tr-gems-bad' : ''}">${gem(18)}
                        <input class="kc-in" type="number" min="0" max="${TRADE_GEMS_MAX}" value="${d.giveGems || ''}" placeholder="0" data-role="giveGems">
                        <span>гемов отдаёте${short ? ` — у вас ${state.gems}` : ''}</span>
                    </label>
                </div>
                <div class="tr-col">
                    <h4 class="kc-h">Вы просите <span>${d.want.size ? `вещей ${d.want.size}` : ''}</span></h4>
                    <div class="tr-grid">${wantGrid || '<div class="tr-empty">У собеседника вещей нет — можно попросить гемы.</div>'}</div>
                    <label class="tr-gems">${gem(18)}
                        <input class="kc-in" type="number" min="0" max="${TRADE_GEMS_MAX}" value="${d.wantGems || ''}" placeholder="0" data-role="wantGems">
                        <span>гемов просите</span>
                    </label>
                </div>
            </div>
            <input class="kc-in tr-note" type="text" maxlength="${NOTE_MAX}" placeholder="Записка (необязательно)" value="${esc(d.note)}" data-role="note">
            <div class="tr-send">
                <span class="tr-send-hint">${!giveOk ? 'Выберите, что отдаёте.' : !wantOk ? 'Выберите, что просите взамен.'
                    : short ? 'Гемов не хватает.' : 'Обмен пройдёт, когда его примут. До этого вещи и гемы остаются у вас.'}</span>
                <button class="btn btn-pri" data-act="send" ${giveOk && wantOk && !short && !state.busy ? '' : 'disabled'}>Предложить обмен</button>
            </div>`;
    }

    function render() {
        if (state.status === 'loading') { host.innerHTML = '<div class="kc-loading">Загружаю обмены…</div>'; return; }
        if (state.status === 'error') {
            host.innerHTML = `<div class="kc-loading">Обмены не загрузились: ${esc(state.error)} <button class="btn btn-sec" data-act="reload">Ещё раз</button></div>`;
            return;
        }
        host.innerHTML = state.draft ? draftHtml() : listHtml();
    }

    let searchTimer = 0;
    async function searchPeople() {
        const q = state.q;
        try {
            const { people } = await apiFetch(`/api/trades/people?q=${encodeURIComponent(q)}`);
            if (q !== state.q || !state.draft || state.draft.person) return;
            state.people = people;
        } catch (e) { state.people = []; toast(e.message, true); }
        // Поле поиска не пересобираем — в нём печатают.
        const box = host.querySelector('.tr-people');
        if (box) {
            const tmp = document.createElement('div');
            tmp.innerHTML = draftHtml();
            box.replaceWith(tmp.querySelector('.tr-people'));
        }
    }

    async function act(path) {
        state.busy = true;
        render();
        try {
            const data = await apiFetch(path, { method: 'POST', body: {} });
            take(data);
            return data;
        } catch (e) {
            // Не прошедший обмен сервер уже закрыл — состояние приезжает в
            // том же отказе, но apiFetch его не отдаёт: перечитываем.
            toast(e.message, true);
            await load();
            return null;
        } finally {
            state.busy = false;
            render();
        }
    }

    host.addEventListener('click', async (e) => {
        const it = e.target.closest('[data-give], [data-want]');
        if (it && state.draft) {
            if (it.getAttribute('aria-disabled') === 'true') { toast(it.title); return; }
            const set = it.dataset.give ? state.draft.give : state.draft.want;
            const k = it.dataset.give || it.dataset.want;
            if (set.has(k)) set.delete(k); else set.add(k);
            render();
            return;
        }
        const btn = e.target.closest('[data-act]');
        if (!btn || btn.disabled) return;
        const a = btn.dataset.act;
        if (a === 'reload') { state.status = 'loading'; render(); load(); }
        if (a === 'history') { state.showHistory = !state.showHistory; render(); }
        if (a === 'new' || a === 'repick') {
            state.draft = { person: null, give: new Set(), want: new Set(), giveGems: 0, wantGems: 0, note: state.draft?.note || '' };
            state.people = null;
            render();
            host.querySelector('[data-role="q"]')?.focus();
            searchPeople();
        }
        if (a === 'close-draft') { state.draft = null; render(); }
        if (a === 'pick') {
            btn.disabled = true;
            try {
                const { person } = await apiFetch(`/api/trades/people/${encodeURIComponent(btn.dataset.id)}`);
                state.draft.person = person;
                render();
            } catch (err) { toast(err.message, true); btn.disabled = false; }
        }
        if (a === 'send') {
            const d = state.draft;
            const split = (s) => [...s].map(k => { const [pack, part] = k.split(':'); return { pack, part }; });
            state.busy = true;
            render();
            try {
                take(await apiFetch('/api/trades/offers', {
                    method: 'POST',
                    body: { to: d.person.id, give: split(d.give), giveGems: d.giveGems, want: split(d.want), wantGems: d.wantGems, note: d.note },
                }));
                state.draft = null;
                toast(`Предложение ушло — ${d.person.name} увидит его у себя`);
            } catch (err) { toast(err.message, true); }
            state.busy = false;
            render();
        }
        if (a === 'accept') {
            const data = await act(`/api/trades/offers/${btn.dataset.id}/accept`);
            if (data) { toast('Обмен прошёл — вещи уже у вас'); changed(apiFetch); }
        }
        if (a === 'decline') { if (await act(`/api/trades/offers/${btn.dataset.id}/decline`)) toast('Отклонено'); }
        if (a === 'cancel') { if (await act(`/api/trades/offers/${btn.dataset.id}/cancel`)) toast('Предложение отменено'); }
    }, { signal: off.signal });

    host.addEventListener('input', (e) => {
        const role = e.target.dataset?.role;
        if (role === 'q') {
            state.q = e.target.value;
            clearTimeout(searchTimer);
            searchTimer = setTimeout(searchPeople, 250);
            return;
        }
        if (!state.draft) return;
        if (role === 'note') { state.draft.note = e.target.value; return; }
        if (role === 'giveGems' || role === 'wantGems') {
            const n = Math.max(0, Math.min(TRADE_GEMS_MAX, Math.floor(Number(e.target.value) || 0)));
            state.draft[role] = n;
            // Гемы — только с одной стороны: ввели с одной — другая обнуляется.
            const other = role === 'giveGems' ? 'wantGems' : 'giveGems';
            if (n && state.draft[other]) {
                state.draft[other] = 0;
                const el = host.querySelector(`[data-role="${other}"]`);
                if (el) el.value = '';
            }
            // Перерисовываем только низ и подсказку — поле в фокусе не трогаем.
            const tmp = document.createElement('div');
            tmp.innerHTML = draftHtml();
            host.querySelector('.tr-send')?.replaceWith(tmp.querySelector('.tr-send'));
            const lbl = host.querySelector('[data-role="giveGems"]')?.closest('.tr-gems');
            const fresh = tmp.querySelector('[data-role="giveGems"]')?.closest('.tr-gems');
            if (lbl && fresh) {
                lbl.className = fresh.className;
                lbl.querySelector('span').textContent = fresh.querySelector('span').textContent;
            }
        }
    }, { signal: off.signal });

    render();
    load();
    return { reload: load };
}

// ── Маркет ───────────────────────────────────────────────────────────────────

export function mountMarket(host, { apiFetch, user }) {
    if (!host) return null;
    host._marketOff?.abort();
    const off = new AbortController();
    host._marketOff = off;
    const me = user?.id;
    const state = {
        status: 'loading', error: '', listings: [], sales: [], gems: 0, owned: [],
        busy: false, selling: null,   // { pick: key|null, price }
        sort: 'new', filter: '',
    };
    function take(d) {
        if (d.listings) state.listings = d.listings;
        if (d.sales) state.sales = d.sales;
        if ('gems' in d) state.gems = d.gems;
        if (d.owned) state.owned = d.owned;
    }
    async function load() {
        try { take(await apiFetch('/api/trades/market')); state.status = 'ready'; }
        catch (e) { state.status = 'error'; state.error = e.message || 'сервер не ответил'; }
        render();
    }

    function lotHtml(l) {
        const mine = l.seller === me;
        const have = state.owned.some(o => o.pack === l.pack && o.part === l.part);
        const short = l.price > state.gems;
        const btn = mine
            ? `<button class="btn btn-sec" data-act="unlist" data-id="${l.id}" ${state.busy ? 'disabled' : ''}>Снять</button>`
            : have ? '<span class="tr-lot-why">уже есть у вас</span>'
                : `<button class="btn btn-pri" data-act="buy" data-id="${l.id}" ${state.busy || short ? 'disabled' : ''} ${short ? `title="не хватает ${l.price - state.gems} ${gemsWord(l.price - state.gems)}"` : ''}>Купить</button>`;
        return `
        <div class="tr-lot${mine ? ' tr-lot-mine' : ''}">
            ${itemHtml(l, { extra: '' })}
            <div class="tr-lot-price">${gem(18)}<b>${l.price}</b></div>
            <div class="tr-lot-seller">${mine ? 'ваш лот' : esc(l.sellerUser?.name || '')}</div>
            ${btn}
        </div>`;
    }

    function sellHtml() {
        const s = state.selling;
        const listed = new Set(state.listings.filter(l => l.seller === me).map(key));
        const grid = state.owned.slice().sort(byItem).map(it => itemHtml(it, {
            attrs: `data-sell="${esc(key(it))}"`, on: s.pick === key(it),
            extra: listed.has(key(it)) ? '<em class="tr-item-flag">выставлено</em>' : '',
        })).join('');
        return `
        <div class="tr-sell">
            <div class="tr-bar"><b class="tr-title">Что выставить?</b><button class="btn btn-sec" data-act="sell-close">Отмена</button></div>
            <div class="tr-grid">${grid || '<div class="tr-empty">Вещей пока нет — они выпадают из кейсов.</div>'}</div>
            <div class="tr-send">
                <label class="tr-gems">${gem(18)}
                    <input class="kc-in" type="number" min="1" max="${TRADE_GEMS_MAX}" value="${s.price || ''}" placeholder="цена" data-role="price">
                    <span>гемов</span>
                </label>
                <span class="tr-send-hint">${s.pick && listed.has(s.pick) ? 'Уже выставлено — новая цена заменит старую.' : 'Вещь остаётся у вас, пока её не купят: носить можно.'}</span>
                <button class="btn btn-pri" data-act="sell" ${s.pick && s.price > 0 && !state.busy ? '' : 'disabled'}>Выставить</button>
            </div>
        </div>`;
    }

    function render() {
        if (state.status === 'loading') { host.innerHTML = '<div class="kc-loading">Загружаю маркет…</div>'; return; }
        if (state.status === 'error') {
            host.innerHTML = `<div class="kc-loading">Маркет не загрузился: ${esc(state.error)} <button class="btn btn-sec" data-act="reload">Ещё раз</button></div>`;
            return;
        }
        let lots = state.listings.filter(l => !state.filter || l.pack === state.filter);
        if (state.sort === 'cheap') lots = lots.slice().sort((a, b) => a.price - b.price || b.id - a.id);
        const packs = [...new Set(state.listings.map(l => l.pack))].sort((a, b) => (PACK_ORDER[a] ?? 99) - (PACK_ORDER[b] ?? 99));
        host.innerHTML = `
            <div class="tr-bar">
                <div class="tr-bar-gems">${gem(22)}<b>${state.gems}</b><span>${gemsWord(state.gems)}</span></div>
                ${state.selling ? '' : '<button class="btn btn-pri" data-act="sell-open">Выставить вещь</button>'}
            </div>
            ${state.selling ? sellHtml() : ''}
            <div class="tr-filters">
                <button class="chip${state.filter ? '' : ' active'}" data-filter="">Все</button>
                ${packs.map(p => `<button class="chip${state.filter === p ? ' active' : ''}" data-filter="${esc(p)}">${esc(packLabel(p))}</button>`).join('')}
                <span class="tr-filters-gap"></span>
                <button class="chip${state.sort === 'new' ? ' active' : ''}" data-sort="new">Свежие</button>
                <button class="chip${state.sort === 'cheap' ? ' active' : ''}" data-sort="cheap">Дешевле</button>
            </div>
            <div class="tr-lots">${lots.length ? lots.map(lotHtml).join('') : '<div class="tr-empty">На маркете пусто. Выставьте свою вещь — её увидят все.</div>'}</div>
            ${state.sales.length ? `<h4 class="kc-h">Сделки за месяц</h4>
                <div class="tr-sales">${state.sales.map(s => `
                    <div class="tr-sale">${s.seller === me ? 'Продано' : 'Куплено'}: <b>${esc(packLabel(s.pack))} · ${esc(PART_LABEL[s.part] || s.part)}</b>
                        за ${s.price} ${gemsWord(s.price)}${s.seller === me && s.buyerName ? ` — ${esc(s.buyerName)}` : ''} <span>${esc(when(s.closedAt))}</span></div>`).join('')}</div>` : ''}`;
    }

    host.addEventListener('click', async (e) => {
        const f = e.target.closest('[data-filter]');
        if (f) { state.filter = f.dataset.filter; render(); return; }
        const s = e.target.closest('[data-sort]');
        if (s) { state.sort = s.dataset.sort; render(); return; }
        const pick = e.target.closest('[data-sell]');
        if (pick && state.selling) {
            state.selling.pick = pick.dataset.sell;
            const lot = state.listings.find(l => l.seller === me && key(l) === pick.dataset.sell);
            if (lot && !state.selling.price) state.selling.price = lot.price;
            render();
            host.querySelector('[data-role="price"]')?.focus();
            return;
        }
        const btn = e.target.closest('[data-act]');
        if (!btn || btn.disabled) return;
        const a = btn.dataset.act;
        if (a === 'reload') { state.status = 'loading'; render(); load(); }
        if (a === 'sell-open') { state.selling = { pick: null, price: 0 }; render(); }
        if (a === 'sell-close') { state.selling = null; render(); }
        const run = async (path, body, okText, after) => {
            state.busy = true;
            render();
            try {
                take(await apiFetch(path, { method: 'POST', body }));
                toast(okText);
                after?.();
            } catch (err) { toast(err.message, true); await load(); }
            state.busy = false;
            render();
        };
        if (a === 'sell') {
            const [pack, part] = state.selling.pick.split(':');
            await run('/api/trades/market', { pack, part, price: state.selling.price }, 'Выставлено на маркет', () => { state.selling = null; });
        }
        if (a === 'buy') await run(`/api/trades/market/${btn.dataset.id}/buy`, {}, 'Куплено — вещь уже у вас', () => changed(apiFetch));
        if (a === 'unlist') await run(`/api/trades/market/${btn.dataset.id}/cancel`, {}, 'Лот снят');
    }, { signal: off.signal });

    host.addEventListener('input', (e) => {
        if (e.target.dataset?.role !== 'price' || !state.selling) return;
        state.selling.price = Math.max(0, Math.min(TRADE_GEMS_MAX, Math.floor(Number(e.target.value) || 0)));
        const btn = host.querySelector('[data-act="sell"]');
        if (btn) btn.disabled = !(state.selling.pick && state.selling.price > 0 && !state.busy);
    }, { signal: off.signal });

    render();
    load();
    return { reload: load };
}
