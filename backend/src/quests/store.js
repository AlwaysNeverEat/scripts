// ─────────────────────────────────────────────────────────────────────────────
// Задания — хранение (правила — shared/quests.js, таблицы — миграция
// 047_quests.sql).
//
// Здесь две половины. Первая — ЖУРНАЛ ПАРТИЙ: игры пишут в него законченные
// партии (logResult) и ходы в словах (noteWordGuess и соседи). Писать в журнал
// — побочное дело игры: упавшая запись не должна ронять ни ход, ни результат в
// мини-топе, поэтому все эти функции глотают ошибку в лог.
//
// Вторая — сами задания: замороженный набор, прогресс, забранное. Забрать —
// под тем же замком кошелька, что кейсы (cases/store.js → withWallet): опыт
// уходит строкой в wallet_ledger, и двойной клик не может дать его дважды —
// второй раз не пустит первичный ключ quest_claims.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../db/client.js';
import { withWallet } from '../cases/store.js';
import { DUEL_GAMES } from '../../../shared/quests.js';

const quiet = (where) => (err) => console.error(`quests: ${where}`, err.message);

// ── Журнал партий ────────────────────────────────────────────────────────────

export function logResult(userId, game, data) {
    if (!userId) return Promise.resolve();
    return query(
        `INSERT INTO game_results (user_id, game, data) VALUES ($1, $2, $3::jsonb)`,
        [userId, game, JSON.stringify(data || {})],
    ).catch(quiet(`logResult ${game}`));
}

// Парные игры с людьми: победителей бывает несколько (дурак на четверых).
export function logDuelWins(game, winnerIds) {
    if (!DUEL_GAMES.includes(game)) return Promise.resolve();
    return Promise.all((winnerIds || []).filter(Boolean).map(id => logResult(id, game, { won: true, vs: 'human' })));
}

/**
 * Ход в вордле/контекстно. Ходы после solved_at не считаются (день закрыт:
 * разгадал, сдался или кончились попытки). Победа пишет партию в журнал.
 * maxTries — для вордле: шестая неудачная попытка закрывает день.
 */
export async function noteWordGuess(userId, game, day, { win, maxTries = 0 }) {
    try {
        const { rows: [row] } = await query(
            `INSERT INTO word_days (user_id, game, day, guesses) VALUES ($1, $2, $3, 1)
             ON CONFLICT (user_id, game, day) DO UPDATE SET guesses = word_days.guesses + 1
              WHERE word_days.solved_at IS NULL
             RETURNING guesses, hints, started_at`,
            [userId, game, day],
        );
        if (!row) return;
        const close = win || (maxTries && row.guesses >= maxTries);
        if (!close) return;
        const { rows: [done] } = await query(
            `UPDATE word_days SET solved_at = now()
              WHERE user_id = $1 AND game = $2 AND day = $3 AND solved_at IS NULL
              RETURNING solved_at`,
            [userId, game, day],
        );
        if (!done || !win) return;
        const seconds = Math.max(0, Math.round((new Date(done.solved_at) - new Date(row.started_at)) / 1000));
        await logResult(userId, game, { won: true, guesses: row.guesses, hints: row.hints, seconds });
    } catch (err) { quiet(`noteWordGuess ${game}`)(err); }
}

export function noteWordHint(userId, game, day) {
    return query(
        `INSERT INTO word_days (user_id, game, day, hints) VALUES ($1, $2, $3, 1)
         ON CONFLICT (user_id, game, day) DO UPDATE SET hints = word_days.hints + 1
          WHERE word_days.solved_at IS NULL`,
        [userId, game, day],
    ).catch(quiet(`noteWordHint ${game}`));
}

export function noteWordGiveUp(userId, game, day) {
    return query(
        `INSERT INTO word_days (user_id, game, day, solved_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id, game, day) DO UPDATE SET solved_at = COALESCE(word_days.solved_at, now())`,
        [userId, game, day],
    ).catch(quiet(`noteWordGiveUp ${game}`));
}

// ── Задания ──────────────────────────────────────────────────────────────────

const ts = (ms) => new Date(ms).toISOString();

export const store = {
    async getSet(userId, period) {
        const { rows: [r] } = await query(`SELECT quests FROM quest_sets WHERE user_id = $1 AND period = $2`, [userId, period]);
        return r ? r.quests : null;
    },
    // Два параллельных первых захода не должны выдать два разных набора:
    // вставка без перезаписи, а вернувшийся ничем — перечитывает победивший.
    async saveSet(userId, period, quests) {
        const { rows: [r] } = await query(
            `INSERT INTO quest_sets (user_id, period, quests) VALUES ($1, $2, $3::jsonb)
             ON CONFLICT DO NOTHING RETURNING quests`,
            [userId, period, JSON.stringify(quests)],
        );
        return r ? r.quests : this.getSet(userId, period);
    },
    async bests(userId) {
        const { rows: [r] } = await query(
            `SELECT (SELECT score FROM tetris_scores WHERE user_id = $1) AS tetris,
                    (SELECT score FROM troika_scores WHERE user_id = $1) AS troika,
                    (SELECT seconds FROM solitaire_scores WHERE user_id = $1) AS solitaire,
                    (SELECT seconds FROM mahjong_scores WHERE user_id = $1) AS mahjong`,
            [userId],
        );
        return r || {};
    },
    async results(userId, from, to) {
        const { rows } = await query(
            `SELECT game, data FROM game_results
              WHERE user_id = $1 AND created_at >= $2 AND created_at < $3 ORDER BY id`,
            [userId, ts(from), ts(to)],
        );
        return rows;
    },
    async workCounts(userId, from, to) {
        const { rows: [r] } = await query(
            `SELECT (SELECT count(*) FROM record_credits
                      WHERE user_id = $1 AND counted AND created_at >= $2 AND created_at < $3)::int AS records,
                    (SELECT count(*) FROM car_events
                      WHERE user_id = $1 AND type = 'added' AND created_at >= $2 AND created_at < $3)::int AS cars`,
            [userId, ts(from), ts(to)],
        );
        return r;
    },
    async claims(userId, periods) {
        const { rows } = await query(
            `SELECT period, slot FROM quest_claims WHERE user_id = $1 AND period = ANY($2::text[])`,
            [userId, periods],
        );
        return rows;
    },
    // true — забрано сейчас, false — уже было забрано раньше.
    async claim(userId, { period, slot, questId, xp }) {
        return withWallet(userId, async (w) => {
            const { rows } = await w.query(
                `INSERT INTO quest_claims (user_id, period, slot, quest_id, xp) VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT DO NOTHING RETURNING slot`,
                [userId, period, slot, questId, xp],
            );
            if (!rows.length) return false;
            await w.ledger({ kind: 'quest', xp, meta: { period, slot, quest: questId } });
            return true;
        });
    },
    async botReportsSince(userId, from) {
        const { rows: [r] } = await query(
            `SELECT count(*)::int AS n FROM game_results
              WHERE user_id = $1 AND created_at >= $2 AND data->>'vs' = 'bot'`,
            [userId, ts(from)],
        );
        return r.n;
    },
    logResult,
};

export default store;
