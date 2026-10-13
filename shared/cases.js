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

// ── Сезоны ────────────────────────────────────────────────────────────────────
// Кейсы СЕЗОННЫЕ: у сезона свои паки и своё название на обложке, и открыть
// его кейсы можно только в его окна. Окна — месяцы по Москве, включительно;
// у сезона их может быть несколько. Каждое время года — свой сезон со своим
// паком: «Осенний кавай» открыт только осенью и возвращается следующей
// осенью, весна и зима получат свои паки.
// Вне окна кейсы закрыты, а выпавшее остаётся и носится круглый год, гемы
// тоже не сгорают — сезон ограничивает открытие, а не владение.
//
// Новый сезон — строка здесь (паки в SKIN_PACKS, картинки — по имени файла).
// Окна сезонов не должны пересекаться: в один день открыт один сезон.
export const SEASONS = [
    { id: 'autumn-kawaii', title: 'Осенний кавай', packs: ['cat', 'fox', 'halloween'], windows: [[9, 11]] },
];

const MSK = 3 * 3600_000;
const pad = (n) => String(n).padStart(2, '0');
// Последний день месяца m (1–12) года y.
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * Какой сезон открыт сейчас (по Москве) и до какого дня включительно.
 * @returns {{ id, title, packs, ends: 'YYYY-MM-DD' } | null}
 */
export function activeSeason(now = Date.now()) {
    const d = new Date(now + MSK);
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
    for (const s of SEASONS) {
        for (const [from, to] of s.windows) {
            if (m >= from && m <= to) {
                return { id: s.id, title: s.title, packs: s.packs, ends: `${y}-${pad(to)}-${pad(lastDay(y, to))}` };
            }
        }
    }
    return null;
}

/** Ближайшее открытие сезона после `now`: { title, starts: 'YYYY-MM-DD' } или null. */
export function nextSeason(now = Date.now()) {
    const d = new Date(now + MSK);
    let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
    for (let i = 0; i < 12; i++) {
        m += 1;
        if (m > 12) { m = 1; y += 1; }
        const s = SEASONS.find(x => x.windows.some(([from]) => from === m));
        if (s) return { id: s.id, title: s.title, starts: `${y}-${pad(m)}-01` };
    }
    return null;
}

export const CASES = {
    small: { label: 'Малый кейс', price: SMALL_CASE_PRICE },
    big: { label: 'Большой кейс', price: KEY_PRICE },
};

const PART_IDS = SKIN_PARTS.map(p => p.id);
// В кейсах — паки ОТКРЫТОГО сезона. Пак попадает в сезон, только когда у
// него нарисованы ВСЕ части: из кейса не должно выпадать то, чего нельзя надеть.
export const casePacks = (season) => (season?.packs || []).filter(p => SKIN_PACKS[p] && SKIN_PACKS[p].ready !== false);

// Пак по весам (SKIN_PACKS[pack].weight): `rand(n)` — целое [0, n), на сервере
// crypto.randomInt, поэтому веса целые.
function pickPack(packs, rand) {
    const total = packs.reduce((s, p) => s + (SKIN_PACKS[p].weight || 1), 0);
    let r = rand(total);
    for (const p of packs) {
        r -= SKIN_PACKS[p].weight || 1;
        if (r < 0) return p;
    }
    return packs[packs.length - 1];
}

// Шансы паков сезона в процентах — для карточки кейса. Малый кейс тянет пак
// с теми же весами, а часть в нём — поровну, поэтому шанс ПАКА один на оба.
export function packOdds(packs) {
    const total = packs.reduce((s, p) => s + (SKIN_PACKS[p].weight || 1), 0);
    return packs.map(p => ({ pack: p, pct: Math.round((SKIN_PACKS[p].weight || 1) / total * 1000) / 10 }));
}
/**
 * Шансы по РЕДКОСТИ — то, что показывает окно «Шансы выпадения»: обычный
 * дроп и редкий, а внутри — паки. Доля редкости считается из весов, а не
 * суммой округлённых процентов паков: 45,5 + 45,5 даёт 91, а честно — 90,9.
 * part — шанс ОДНОЙ конкретной части в малом кейсе (часть в паке — поровну).
 * @returns {Array<{ rare: boolean, pct: number, packs: Array<{ pack, pct, part }> }>}
 */
export function rarityOdds(packs) {
    const w = (p) => SKIN_PACKS[p].weight || 1;
    const total = packs.reduce((s, p) => s + w(p), 0);
    const pct = (x) => Math.round(x / total * 1000) / 10;
    return [false, true].map(rare => {
        const group = packs.filter(p => Boolean(SKIN_PACKS[p].rare) === rare);
        return {
            rare,
            pct: pct(group.reduce((s, p) => s + w(p), 0)),
            packs: group.map(p => ({ pack: p, pct: pct(w(p)), part: Math.round(w(p) / total / PART_IDS.length * 1000) / 10 })),
        };
    }).filter(g => g.packs.length);
}
const readyPacks = () => Object.keys(SKIN_PACKS).filter(p => SKIN_PACKS[p].ready !== false);
export const allItems = (packs = readyPacks()) => packs.flatMap(pack => PART_IDS.map(part => ({ pack, part })));
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
export function openCase(kind, { balance, owned, rand, season }) {
    if (!CASES[kind]) return { error: 'такого кейса нет' };
    const packs = casePacks(season);
    if (!packs.length) return { error: 'сезон кейсов закрыт — выпавшее остаётся с вами, а кейсы откроются в следующий сезон', closed: true };
    if (kind === 'small' && balance.gems < SMALL_CASE_PRICE) {
        return { error: `малый кейс стоит ${SMALL_CASE_PRICE} гемов`, short: SMALL_CASE_PRICE - balance.gems };
    }
    if (kind === 'big' && balance.keys < 1) return { error: 'большой кейс открывается ключом', needKey: true };

    if (kind === 'small') {
        const item = { pack: pickPack(packs, rand), part: PART_IDS[rand(PART_IDS.length)] };
        const dup = owned.has(itemKey(item));
        return {
            prize: { kind, pack: item.pack, part: item.part },
            grant: dup ? [] : [item],
            dup,
            row: { kind: 'open_small', gems: -SMALL_CASE_PRICE, xp: dup ? DUP_XP_SMALL : 0, meta: { ...item, dup } },
        };
    }
    const pack = pickPack(packs, rand);
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
