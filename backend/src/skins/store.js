// ─────────────────────────────────────────────────────────────────────────────
// Скины — хранение. Правила (паки, части, кто ставит) — shared/skins.js,
// таблица — миграция 045_user_skins.sql.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../db/client.js';
import { publicSkin } from '../../../shared/skins.js';

// Все надетые скины — их единицы, поэтому без страниц и без фильтров.
export async function listSkins({ db = query } = {}) {
    const { rows } = await db(
        `SELECT user_id, pack, parts, operator FROM user_skins WHERE pack IS NOT NULL`,
    );
    return rows.map(publicSkin).filter(Boolean);
}

export async function mySkin(userId, { db = query } = {}) {
    const { rows } = await db(
        `SELECT user_id, pack, parts, operator FROM user_skins WHERE user_id = $1`,
        [userId],
    );
    return rows[0] ? { pack: rows[0].pack || null, parts: rows[0].parts || {}, operator: rows[0].operator || '' } : null;
}

export async function saveSkin(userId, { pack, parts, operator }, { db = query } = {}) {
    await db(
        `INSERT INTO user_skins (user_id, pack, parts, operator, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, now())
         ON CONFLICT (user_id) DO UPDATE
            SET pack = EXCLUDED.pack, parts = EXCLUDED.parts,
                operator = EXCLUDED.operator, updated_at = now()`,
        [userId, pack, JSON.stringify(parts), operator],
    );
}

// Код оператора меняется во вкладке «Лиды», а не в окне скина — и пишется
// только тому, у кого строка уже есть: заводить строку ради одного кода незачем.
export async function saveOperator(userId, operator, { db = query } = {}) {
    await db(`UPDATE user_skins SET operator = $2, updated_at = now() WHERE user_id = $1`, [userId, operator]);
}
