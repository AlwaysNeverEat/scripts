// Сутки пасхалки считаем по МСК — так же, как живёт сессия (полночь МСК её
// гасит, см. auth/midnightMsk.js) и месячный топ. Одна мерка на весь проект:
// «новый день» на сайте наступает в одно и то же время везде.
//
// Смещение фиксированное (+3, без переходов на летнее время), поэтому
// следующая полночь — это ровно предыдущая плюс сутки.

import { lastMidnightMsk } from '../auth/midnightMsk.js';

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Календарная дата МСК в виде 'YYYY-MM-DD' — ключ, по которому выбирается слово.
export function mskDay(now = new Date()) {
    const shifted = new Date(lastMidnightMsk(now).getTime() + MSK_OFFSET_MS);
    return shifted.toISOString().slice(0, 10);
}

// Момент, когда слово сменится (00:00 МСК). Клиент крутит из него таймер, а не
// из своих часов: часы на телефоне могут врать, серверные сутки — нет.
export function nextMidnightMsk(now = new Date()) {
    return new Date(lastMidnightMsk(now).getTime() + DAY_MS);
}
