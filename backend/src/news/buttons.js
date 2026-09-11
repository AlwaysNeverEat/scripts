// ─────────────────────────────────────────────────────────────────────────────
// Кнопки внутри новостных постов: счётчик нажатий.
//
// Пока такая кнопка одна — «Скопировать» в посте про слияние кнопок записи.
// Сама она ничего не делает и делать не должна: это памятник исчезнувшей
// кнопке, оставленный в посте, чтобы по ней было где поскучать. Считается
// только факт нажатия.
//
// СЧЁТ ИДЁТ ПО ЧЕЛОВЕКУ, а в посте показывается сумма. Общего числа хватило бы
// посту, но не ачивке: достижения тут выдаются ОТ ФАКТОВ и пересчитываются
// (см. achievements/achievements.js), то есть им нужен не «счётчик», а
// сохранённая метрика по каждому. Она и лежит в news_button_clicks.
//
// Id кнопки проверяется по списку: ручка открыта всем вошедшим, и без списка
// первый же любопытный человек с консолью насыпал бы в таблицу своих строк.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../db/client.js';

// Известные кнопки: id → пост, в котором она живёт (для порядка в голове).
export const BUTTONS = {
    'bitrix-copy': 'records-one-button-2026-09',
};

export function knownButton(id) {
    return Object.prototype.hasOwnProperty.call(BUTTONS, String(id));
}

// Нажатия приезжают ПАЧКОЙ: по кнопке щёлкают очередями, и запрос на каждый
// щелчок — это десятки запросов в секунду ради пасхалки. Окно копит их у себя
// и присылает разницу, поэтому число надо и обрезать сверху.
//
// Потолок в 50 — не защита от накрутки (её тут ловить нечем и незачем), а
// защита от мусора: «нажали миллион раз» в одном запросе означает опечатку или
// баловство с консолью, а не человека с мышкой.
export const MAX_DELTA = 50;

export function clampDelta(raw) {
    const n = Math.trunc(Number(raw));
    if (!Number.isFinite(n) || n < 1) return 0;
    return Math.min(n, MAX_DELTA);
}

/**
 * Счётчики кнопки: общий по всем и свой.
 * @returns {Promise<{ total: number, mine: number }>}
 */
export async function counts(buttonId, userId, { db = query } = {}) {
    const { rows } = await db(
        `SELECT coalesce(sum(clicks), 0)::bigint                          AS total,
                coalesce(sum(clicks) FILTER (WHERE user_id = $2), 0)::bigint AS mine
           FROM news_button_clicks
          WHERE button_id = $1`,
        [buttonId, userId],
    );
    // bigint из pg приезжает строкой — в JSON он должен уехать числом, иначе
    // окно получит «"17"» и склеит его со своим приростом текстом.
    return { total: Number(rows[0]?.total || 0), mine: Number(rows[0]?.mine || 0) };
}

/**
 * Прибавить нажатия и вернуть обновлённые счётчики.
 *
 * Прибавление идёт ОДНИМ upsert'ом, а не «прочитать — сложить — записать»:
 * по одной кнопке щёлкают с нескольких вкладок сразу, и вторая пара глаз тут
 * ничего не стоит, зато гонка за чтением стоила бы потерянных нажатий.
 */
export async function bump(buttonId, userId, delta, { db = query } = {}) {
    if (delta > 0) {
        await db(
            `INSERT INTO news_button_clicks (button_id, user_id, clicks)
                  VALUES ($1, $2, $3)
             ON CONFLICT (button_id, user_id) DO UPDATE
                    SET clicks = news_button_clicks.clicks + EXCLUDED.clicks,
                        last_at = now()`,
            [buttonId, userId, delta],
        );
    }
    return counts(buttonId, userId, { db });
}
