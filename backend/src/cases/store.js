// ─────────────────────────────────────────────────────────────────────────────
// Кошелёк гемов и инвентарь скинов — хранение. Правила — shared/cases.js,
// таблицы — миграция 046_cases.sql.
//
// Всё, что ТРАТИТ, идёт внутри `withWallet`: транзакция и замок на человека
// (pg_advisory_xact_lock). Без замка двойной клик по «Открыть» читал бы один и
// тот же баланс дважды, и 45 гемов открыли бы два кейса.
// ─────────────────────────────────────────────────────────────────────────────

import pool, { query } from '../db/client.js';
import { walletBalance } from '../../../shared/cases.js';

const BALANCE_SQL = `
    SELECT
      (SELECT count(*) FROM record_credits WHERE user_id = $1 AND counted)::int AS records_total,
      (SELECT COALESCE(sum(amount_rub), 0) FROM donations WHERE user_id = $1)::int AS rubles_total,
      COALESCE(sum(gems), 0)::int AS gems, COALESCE(sum(records), 0)::int AS records,
      COALESCE(sum(rubles), 0)::int AS rubles, COALESCE(sum(xp), 0)::int AS xp,
      COALESCE(sum(keys), 0)::int AS keys
    FROM wallet_ledger WHERE user_id = $1`;

function ops(q, userId) {
    return {
        // Сырой запрос в той же транзакции — для тех, кто кладёт в кошелёк
        // что-то своё под тем же замком (забранное задание: quests/store.js).
        query: q,
        async balance() {
            const { rows: [r] } = await q(BALANCE_SQL, [userId]);
            return walletBalance({ recordsTotal: r.records_total, rublesTotal: r.rubles_total, sums: r });
        },
        async owned() {
            const { rows } = await q(`SELECT pack, part FROM skin_items WHERE user_id = $1`, [userId]);
            return rows.map(r => ({ pack: r.pack, part: r.part }));
        },
        async ledger(row) {
            await q(
                `INSERT INTO wallet_ledger (user_id, kind, gems, records, rubles, xp, keys, meta)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
                [userId, row.kind, row.gems || 0, row.records || 0, row.rubles || 0, row.xp || 0, row.keys || 0,
                    JSON.stringify(row.meta || {})],
            );
        },
        async grant(items, source) {
            for (const it of items) {
                await q(
                    `INSERT INTO skin_items (user_id, pack, part, source) VALUES ($1, $2, $3, $4)
                     ON CONFLICT DO NOTHING`,
                    [userId, it.pack, it.part, source],
                );
            }
        },
    };
}

// Только читать — без транзакции.
export const reader = (userId) => ops(query, userId);

export async function withWallet(userId, fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`SELECT pg_advisory_xact_lock(hashtext('wallet:' || $1))`, [userId]);
        const out = await fn(ops((t, p) => client.query(t, p), userId));
        await client.query('COMMIT');
        return out;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

export default { reader, withWallet };
