// ─────────────────────────────────────────────────────────────────────────────
// Кейсы со скинами и кошелёк — правила, общие для сервера и профиля.
//
// Валюта одна — ГЕМЫ. Всё остальное в них меняется, и меняет человек САМ,
// кнопкой в магазине профиля, а не сайт за него:
//   • записи — 10 записей в топе (засчитанных, `counted`) = 1 гем. Считаются
//     все записи с первой: очко в топе не отзывается никогда, а значит и
//     обменять его можно в любой момент;
//   • рубли — то, что человек задонатил (строки `donations`): 1 ₽ = 1 гем.
//     Сайт денег не принимает, рубли на счёт приносит только донат;
//   • опыт — копится от ДУБЛИКАТОВ из кейсов, 100 опыта = 1 гем.
//
// Тратятся гемы на два кейса:
//   • МАЛЫЙ — 45 гемов, выпадает одна часть одного пака;
//   • БОЛЬШОЙ — открывается КЛЮЧОМ (175 гемов), выпадает пак целиком.
//
// Баланс НИГДЕ НЕ ХРАНИТСЯ ЧИСЛОМ: он считается из фактов — записей в топе,
// донатов и журнала операций (`wallet_ledger`), где каждая трата и каждый
// обмен — строка. Число, которое только копится, однажды разошлось бы с
// реальностью, и проверить его было бы нечем (тот же довод, что у донатов).
//
// Розыгрыш — ТОЛЬКО на сервере: в ленте крутятся гемы, и браузеру, который
// сам решает, что выпало, верить нельзя. Браузер получает готовый приз и лишь
// показывает ленту, которая на нём останавливается.
// ─────────────────────────────────────────────────────────────────────────────

import { SKIN_PACKS, SKIN_PARTS } from './skins.js';

export const RECORDS_PER_GEM = 10;
export const RUBLES_PER_GEM = 1;
export const XP_PER_GEM = 100;
export const KEY_PRICE = 175;
export const SMALL_CASE_PRICE = 45;
export const DUP_XP_SMALL = 25;
export const DUP_XP_BIG = 75;
// Потолок одного обмена и одной покупки ключей — защита от лишнего нуля в
// запросе, а не от богатства.
export const EXCHANGE_MAX = 10_000;
export const KEYS_MAX = 20;

// Сезон кейсов — название на обложке. Паки и обложка сезонные, и с новым
// сезоном меняется эта строка вместе с картинкой обложки.
export const SEASON = { title: 'Осенний кавай' };

export const CASES = {
    small: { label: 'Малый кейс', price: SMALL_CASE_PRICE },
    big: { label: 'Большой кейс', price: KEY_PRICE },
};

const PART_IDS = SKIN_PARTS.map(p => p.id);
// В кейсах — все паки из SKIN_PACKS. Пак попадает туда, только когда у него
// нарисованы ВСЕ части: из кейса не должно выпадать то, чего нельзя надеть.
export const casePacks = () => Object.keys(SKIN_PACKS);
export const allItems = () => casePacks().flatMap(pack => PART_IDS.map(part => ({ pack, part })));
export const itemKey = ({ pack, part }) => `${pack}:${part}`;

/**
 * Баланс из фактов. `sums` — суммы по журналу (знаковые: трата с минусом).
 * @returns {{ gems, records, rubles, xp, keys }}
 */
export function walletBalance({ recordsTotal = 0, rublesTotal = 0, sums = {} } = {}) {
    const n = (v) => Number(v) || 0;
    return {
        gems: n(sums.gems),
        records: n(recordsTotal) + n(sums.records),
        rubles: n(rublesTotal) + n(sums.rubles),
        xp: n(sums.xp),
        keys: n(sums.keys),
    };
}

// Сколько чего стоит один гем при обмене.
const RATE = { records: RECORDS_PER_GEM, rubles: RUBLES_PER_GEM, xp: XP_PER_GEM };

/**
 * Обмен «из чего» на `gems` гемов → строка журнала или причина отказа.
 */
export function planExchange(balance, from, gems) {
    const rate = RATE[from];
    if (!rate) return { error: 'обменять можно записи, рубли или опыт' };
    const g = Number(gems);
    if (!Number.isInteger(g) || g < 1 || g > EXCHANGE_MAX) return { error: 'сколько гемов — целое число от 1' };
    const cost = g * rate;
    if ((balance[from] || 0) < cost) {
        const have = Math.floor((balance[from] || 0) / rate);
        return { error: have ? `хватает только на ${have} ${gemsWord(have)}` : `не хватает ${WHAT[from]}` };
    }
    return { row: { kind: `exchange_${from}`, gems: g, [from]: -cost } };
}
const WHAT = { records: 'записей', rubles: 'рублей', xp: 'опыта' };

export function planKeys(balance, count = 1) {
    const c = Number(count);
    if (!Number.isInteger(c) || c < 1 || c > KEYS_MAX) return { error: 'сколько ключей — целое число от 1' };
    if (balance.gems < c * KEY_PRICE) return { error: `ключ стоит ${KEY_PRICE} гемов, не хватает ${c * KEY_PRICE - balance.gems}`, short: c * KEY_PRICE - balance.gems };
    return { row: { kind: 'buy_key', gems: -c * KEY_PRICE, keys: c } };
}

/**
 * Открыть кейс: что выпало, что выдать и что записать в журнал.
 * `owned` — Set ключей `pack:part`, что уже есть у человека.
 * `rand(n)` — случайное целое [0, n): на сервере это crypto.randomInt.
 *
 * Дубликат малого кейса — +25 опыта. Большой кейс выдаёт пак ЦЕЛИКОМ: части,
 * которых нет, приходят, а если хоть одна уже была — +75 опыта ОДИН РАЗ, а не
 * за каждую повторившуюся часть: человек открыл один кейс и получил один
 * дубликат-пак, а не три дубликата.
 */
export function openCase(kind, { balance, owned, rand }) {
    if (!CASES[kind]) return { error: 'такого кейса нет' };
    if (kind === 'small' && balance.gems < SMALL_CASE_PRICE) {
        return { error: `малый кейс стоит ${SMALL_CASE_PRICE} гемов`, short: SMALL_CASE_PRICE - balance.gems };
    }
    if (kind === 'big' && balance.keys < 1) return { error: 'большой кейс открывается ключом', needKey: true };

    if (kind === 'small') {
        const items = allItems();
        const item = items[rand(items.length)];
        const dup = owned.has(itemKey(item));
        return {
            prize: { kind, pack: item.pack, part: item.part },
            grant: dup ? [] : [item],
            dup,
            row: { kind: 'open_small', gems: -SMALL_CASE_PRICE, xp: dup ? DUP_XP_SMALL : 0, meta: { ...item, dup } },
        };
    }
    const packs = casePacks();
    const pack = packs[rand(packs.length)];
    const grant = PART_IDS.filter(part => !owned.has(itemKey({ pack, part }))).map(part => ({ pack, part }));
    const dup = grant.length < PART_IDS.length;
    return {
        prize: { kind, pack },
        grant,
        dup,
        row: { kind: 'open_big', keys: -1, xp: dup ? DUP_XP_BIG : 0, meta: { pack, got: grant.map(g => g.part), dup } },
    };
}

export function gemsWord(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'гем';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'гема';
    return 'гемов';
}
