// Режим «Дейли»: одна точка в сутки на аккаунт, одна попытка.
//
// Точка у каждого своя и меняется в полночь МСК — той же меркой, что вордле и
// контекстно. Но, в отличие от них, она не ВЫВОДИТСЯ формулой из даты, а
// ЗАПИСЫВАЕТСЯ в момент первой выдачи: слово можно посчитать хэшем в любой
// момент и получить то же самое, а снимок живёт в чужом банке снимков, и
// завтра его ответ на тот же запрос может оказаться другим.
//
// «Переиграть нельзя» держится не на договорённости с клиентом, а на условии
// guessed_at IS NULL в единственном UPDATE: второй ответ просто не находит
// строку, сколько бы вкладок человек ни открыл.

import { query } from '../db/client.js';
import { mskDay, nextMidnightMsk } from '../daily.js';
import { scoreGuess } from '../../../shared/geo.js';
import { nextPoint, dailyRand } from './panoramas.js';
import { addDailyResult, dailyLeaderboard } from './scores.js';

// Дата из Postgres приезжает объектом Date, поставленным на ПОЛНОЧЬ В ЗОНЕ
// процесса. Через toISOString такой день уезжает на сутки назад везде, где зона
// восточнее UTC, — поэтому собираем строку из локальных полей, а не через ISO.
function dayString(day) {
    if (typeof day === 'string') return day.slice(0, 10);
    const p = (n) => String(n).padStart(2, '0');
    return `${day.getFullYear()}-${p(day.getMonth() + 1)}-${p(day.getDate())}`;
}

/** Что видит клиент. Координаты точки уезжают ТОЛЬКО после ответа. */
function present(row) {
    const done = !!row.guessed_at;
    return {
        day: dayString(row.day),
        pano: row.pano,
        done,
        next_at: nextMidnightMsk().toISOString(),
        result: done
            ? {
                score: row.score,
                distance_km: row.distance_km,
                label: row.label,
                target: { lat: row.lat, lng: row.lng },
                guess: { lat: row.guess_lat, lng: row.guess_lng },
            }
            : null,
    };
}

async function load(userId, day) {
    const res = await query('SELECT * FROM geo_daily WHERE user_id = $1 AND day = $2', [userId, day]);
    return res.rows[0] || null;
}

/**
 * Сегодняшний раунд. Если его ещё нет — выдаём.
 *
 * ON CONFLICT DO NOTHING и повторное чтение — на случай двух вкладок, открытых
 * одновременно: обе сходят в банк снимков, но в базе останется одна
 * точка, и обе увидят её.
 */
export async function today(userId) {
    const day = mskDay();
    const existing = await load(userId, day);
    if (existing) return present(existing);

    const point = await nextPoint(dailyRand(userId, day));
    if (!point) return null;

    await query(
        `INSERT INTO geo_daily (user_id, day, lat, lng, pano, label)
              VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, day) DO NOTHING`,
        [userId, day, point.lat, point.lng, point.pano, point.label],
    );
    return present(await load(userId, day));
}

/** Ответить. Второй раз за тот же день не получится — это весь смысл режима. */
export async function answer(userId, guess) {
    const day = mskDay();
    const row = await load(userId, day);
    if (!row) return { ok: false, reason: 'no_round' };
    if (row.guessed_at) return { ok: false, reason: 'already' };

    const { score, distance_km } = scoreGuess({ lat: row.lat, lng: row.lng }, guess);
    const saved = await query(
        `UPDATE geo_daily
            SET guess_lat = $3, guess_lng = $4, score = $5, distance_km = $6, guessed_at = now()
          WHERE user_id = $1 AND day = $2 AND guessed_at IS NULL
        RETURNING *`,
        [userId, day, guess.lat, guess.lng, score, distance_km],
    );
    // Строку увели из-под нас — значит, ответ уже засчитан в другой вкладке.
    if (!saved.rows.length) return { ok: false, reason: 'already' };

    await addDailyResult(userId, score);
    const board = await dailyLeaderboard(userId);
    return { ok: true, ...present(saved.rows[0]), ...board };
}
