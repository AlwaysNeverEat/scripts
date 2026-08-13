// Сутки и «своё на каждый день» — общее для пасхалок (вордле, контекстно).
//
// День считаем по МСК — той же меркой, что гасит сессию (auth/midnightMsk.js)
// и закрывает месяц в топе: «новый день» на сайте наступает везде в одно время.
// Смещение фиксированное (+3, без перевода часов), поэтому следующая полночь —
// это предыдущая плюс сутки.
//
// Слово выбирается хэшем от (id аккаунта, дата): у каждого своё, весь день
// одно и то же, и в базе для этого ничего хранить не нужно.

import { createHash } from 'node:crypto';
import { lastMidnightMsk } from './auth/midnightMsk.js';

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Календарная дата МСК в виде 'YYYY-MM-DD'.
export function mskDay(now = new Date()) {
    const shifted = new Date(lastMidnightMsk(now).getTime() + MSK_OFFSET_MS);
    return shifted.toISOString().slice(0, 10);
}

// Момент смены (00:00 МСК). Клиент крутит из него таймер, а не из своих часов:
// часы на телефоне могут врать, серверные сутки — нет.
export function nextMidnightMsk(now = new Date()) {
    return new Date(lastMidnightMsk(now).getTime() + DAY_MS);
}

/**
 * Детерминированный выбор элемента на пару (аккаунт, день).
 * salt разводит игры между собой: иначе у человека, севшего за обе пасхалки,
 * они каждый день выпадали бы на одинаковых номерах списков.
 */
export function pickForUser(list, userId, day, salt) {
    const digest = createHash('sha256').update(`${salt}:${userId}:${day}`).digest();
    // 32 бита из хэша хватает: перекос от остатка на сотни вариантов ничтожен.
    return list[digest.readUInt32BE(0) % list.length];
}
