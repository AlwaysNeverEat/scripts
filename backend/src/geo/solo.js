// Режим «Соло»: пять точек за партию, в топ идёт сумма.
//
// Точки выдаются ПО ОДНОЙ и хранятся на сервере. Отдать все пять сразу было бы
// проще, но тогда правильные ответы на четыре следующих раунда лежали бы в
// браузере с самого начала — а вся игра в том, чтобы их не знать.
//
// Незаконченная партия остаётся в базе и предлагается продолжить: раунд —
// это несколько минут разглядывания, и терять их из-за случайно закрытой
// вкладки человек не должен. Новая партия начинается только когда предыдущая
// доиграна (или брошена кнопкой).

import { query } from '../db/client.js';
import { scoreGuess, SOLO_ROUNDS } from '../../../shared/geo.js';
import { nextPoint } from './panoramas.js';
import { saveSolo, soloLeaderboard } from './scores.js';

/**
 * Партия для клиента.
 *
 * Сыгранные раунды показываются целиком (там уже нечего скрывать), текущий —
 * одним id снимка: координаты его точки и есть ответ.
 */
function present(row) {
    const rounds = row.rounds || [];
    const done = row.status === 'done';
    const played = rounds.filter(r => r.guess);
    const current = done ? null : rounds[rounds.length - 1];
    return {
        id: row.id,
        status: row.status,
        round: played.length + (done ? 0 : 1),
        total: SOLO_ROUNDS,
        score: row.score,
        pano: current ? current.pano : null,
        results: played.map((r, i) => ({
            round: i + 1,
            score: r.score,
            distance_km: r.distance_km,
            label: r.label,
            target: { lat: r.lat, lng: r.lng },
            guess: r.guess,
        })),
    };
}

async function loadLive(userId) {
    const res = await query(
        `SELECT * FROM geo_runs WHERE user_id = $1 AND status = 'live'
          ORDER BY moved_at DESC LIMIT 1`,
        [userId],
    );
    return res.rows[0] || null;
}

/** Незаконченная партия, если она есть. */
export async function current(userId) {
    const row = await loadLive(userId);
    return row ? present(row) : null;
}

/** Начать партию. Если предыдущая не доиграна — возвращаем её, а не новую. */
export async function start(userId) {
    const live = await loadLive(userId);
    if (live) return present(live);

    const point = await nextPoint();
    if (!point) return null;

    const res = await query(
        `INSERT INTO geo_runs (user_id, rounds) VALUES ($1, $2) RETURNING *`,
        [userId, JSON.stringify([point])],
    );
    return present(res.rows[0]);
}

/** Бросить партию. Результат никуда не идёт: считается сумма за все пять точек. */
export async function abandon(userId, runId) {
    await query(
        `UPDATE geo_runs SET status = 'done', moved_at = now()
          WHERE id = $1 AND user_id = $2 AND status = 'live'`,
        [runId, userId],
    );
    return { ok: true };
}

/**
 * Ответить на текущий раунд.
 *
 * Пятый ответ закрывает партию и пишет сумму в топ. Точка следующего раунда
 * подбирается тут же — клиенту она приезжает тем же ответом, чтобы между
 * раундами не было лишнего похода на сервер.
 */
export async function answer(userId, runId, guess) {
    const row = await loadLive(userId);
    if (!row || row.id !== runId) return { ok: false, reason: 'no_run' };

    const rounds = row.rounds || [];
    const cur = rounds[rounds.length - 1];
    if (!cur || cur.guess) return { ok: false, reason: 'stale' };

    const { score, distance_km } = scoreGuess({ lat: cur.lat, lng: cur.lng }, guess);
    cur.guess = { lat: guess.lat, lng: guess.lng };
    cur.score = score;
    cur.distance_km = distance_km;

    const total = row.score + score;
    const played = rounds.length;
    const done = played >= SOLO_ROUNDS;
    if (!done) {
        const point = await nextPoint();
        if (!point) return { ok: false, reason: 'no_point' };
        rounds.push(point);
    }

    const saved = await query(
        `UPDATE geo_runs
            SET rounds = $3, score = $4, status = $5, moved_at = now()
          WHERE id = $1 AND user_id = $2 AND status = 'live'
        RETURNING *`,
        [runId, userId, JSON.stringify(rounds), total, done ? 'done' : 'live'],
    );
    if (!saved.rows.length) return { ok: false, reason: 'stale' };

    const out = { ok: true, ...present(saved.rows[0]) };
    if (done) {
        Object.assign(out, await saveSolo(userId, total), await soloLeaderboard(userId));
    }
    return out;
}
