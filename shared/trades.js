// ─────────────────────────────────────────────────────────────────────────────
// Обменник и маркет скинов — правила, общие для сервера и профиля.
//
// Вещь — это часть пака ({ pack, part }), ровно та строка `skin_items`, что
// выпала из кейса. Копия у человека одна (ключ таблицы — человек + пак +
// часть), поэтому главное правило обоих мест: ПОЛУЧИТЬ можно только то,
// чего у тебя ещё нет. Иначе вещь при переезде просто исчезла бы — второй
// строки под неё нет, а «опыт за дубликат» в обмене выглядел бы как способ
// печатать опыт из воздуха.
//
// ОБМЕН — предложение от одного человека другому: что отдаю (вещи или гемы),
// что прошу взамен (вещи или гемы). Согласий два: отправить — первое,
// «Принять» у получателя — второе, и только тогда всё переезжает. Гемы и
// вещи при отправке НЕ замораживаются: проверка повторяется в момент
// принятия под замком обоих кошельков, и если за это время вещь ушла или
// гемы потрачены — обмен не проходит, а не проходит наполовину.
//
// Гемы с обеих сторон сразу — запрещены: «200 гемов за 300 гемов» — это
// перевод 100 гемов, только запутанный. Пустая сторона — тоже: подарки и
// выпрашивание — не обмен.
//
// МАРКЕТ — вещь выставлена за цену в гемах, купить может любой, у кого её
// нет. Выставленная вещь остаётся у хозяина (носить её можно), а ушла она
// другим путём (обмен, продажа) — лот снимается сам.
// ─────────────────────────────────────────────────────────────────────────────

import { SKIN_PACKS, SKIN_PARTS } from './skins.js';
import { gemsWord } from './cases.js';

export const TRADE_ITEMS_MAX = 16;      // вещей на одну сторону обмена
export const TRADE_GEMS_MAX = 100_000;  // гемов в одном обмене и цена лота
export const OPEN_OFFERS_MAX = 20;      // висящих исходящих предложений у человека
export const LISTINGS_MAX = 30;         // активных лотов у человека
export const NOTE_MAX = 200;            // записка к предложению

const PART_IDS = new Set(SKIN_PARTS.map(p => p.id));
const key = ({ pack, part }) => `${pack}:${part}`;
export const isItem = (it) => Boolean(it) && Object.hasOwn(SKIN_PACKS, it.pack) && PART_IDS.has(it.part);

function cleanItems(list) {
    if (list == null) return { items: [] };
    if (!Array.isArray(list)) return { error: 'вещи — списком' };
    const seen = new Set();
    const items = [];
    for (const raw of list) {
        const it = { pack: String(raw?.pack || ''), part: String(raw?.part || '') };
        if (!isItem(it)) return { error: 'такой вещи нет' };
        if (seen.has(key(it))) continue;
        seen.add(key(it));
        items.push(it);
    }
    if (items.length > TRADE_ITEMS_MAX) return { error: `не больше ${TRADE_ITEMS_MAX} вещей с одной стороны` };
    return { items };
}

function cleanGems(v) {
    if (v == null || v === '') return 0;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > TRADE_GEMS_MAX) return NaN;
    return n;
}

/**
 * Предложение обмена из тела запроса → { offer } или { error }.
 * offer: { to, give: [item], giveGems, want: [item], wantGems, note }
 */
export function cleanOffer(body, fromId) {
    const to = String(body?.to || '');
    if (!to) return { error: 'кому предлагаем — не выбрано' };
    if (to === String(fromId)) return { error: 'обмен с самим собой — не обмен' };
    const give = cleanItems(body?.give);
    if (give.error) return give;
    const want = cleanItems(body?.want);
    if (want.error) return want;
    const giveGems = cleanGems(body?.giveGems);
    const wantGems = cleanGems(body?.wantGems);
    if (Number.isNaN(giveGems) || Number.isNaN(wantGems)) return { error: `гемы — целое число от 0 до ${TRADE_GEMS_MAX}` };
    if (giveGems && wantGems) return { error: 'гемы — только с одной стороны' };
    if (!give.items.length && !giveGems) return { error: 'выберите, что отдаёте' };
    if (!want.items.length && !wantGems) return { error: 'выберите, что просите взамен' };
    const note = String(body?.note || '').trim().slice(0, NOTE_MAX);
    return { offer: { to, give: give.items, giveGems, want: want.items, wantGems, note } };
}

const has = (owned, it) => owned.has(key(it));

/**
 * Может ли обмен пройти СЕЙЧАС. `owned` — Set ключей `pack:part`.
 * Зовётся дважды: при отправке (чтобы не слать заведомо мёртвое) и при
 * принятии под замком (настоящая проверка).
 * @returns {string|null} причина отказа или null
 */
export function tradeBlocker(offer, { fromOwned, toOwned, fromGems, toGems }) {
    if (offer.give.some(it => !has(fromOwned, it))) return 'у отправителя уже нет части вещей';
    if (offer.want.some(it => !has(toOwned, it))) return 'у получателя уже нет части вещей';
    if (offer.give.some(it => has(toOwned, it))) return 'у получателя уже есть часть предложенных вещей';
    if (offer.want.some(it => has(fromOwned, it))) return 'у отправителя уже есть часть запрошенных вещей';
    if (fromGems < offer.giveGems) return `у отправителя не хватает гемов: нужно ${offer.giveGems} ${gemsWord(offer.giveGems)}`;
    if (toGems < offer.wantGems) return `у получателя не хватает гемов: нужно ${offer.wantGems} ${gemsWord(offer.wantGems)}`;
    return null;
}

/** Лот маркета из тела запроса → { listing: { pack, part, price } } или { error }. */
export function cleanListing(body) {
    const it = { pack: String(body?.pack || ''), part: String(body?.part || '') };
    if (!isItem(it)) return { error: 'такой вещи нет' };
    const price = Number(body?.price);
    if (!Number.isInteger(price) || price < 1 || price > TRADE_GEMS_MAX) return { error: `цена — целое число гемов от 1 до ${TRADE_GEMS_MAX}` };
    return { listing: { ...it, price } };
}

/**
 * Может ли покупатель купить лот СЕЙЧАС.
 * @returns {string|null}
 */
export function buyBlocker(listing, { buyerId, sellerOwned, buyerOwned, buyerGems }) {
    if (listing.status !== 'active') return 'лот уже снят или продан';
    if (String(listing.seller) === String(buyerId)) return 'это ваш лот';
    if (!has(sellerOwned, listing)) return 'у продавца этой вещи уже нет';
    if (has(buyerOwned, listing)) return 'эта вещь у вас уже есть';
    if (buyerGems < listing.price) return `не хватает ${listing.price - buyerGems} ${gemsWord(listing.price - buyerGems)}`;
    return null;
}
