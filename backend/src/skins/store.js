// ─────────────────────────────────────────────────────────────────────────────
// Скины — хранение. Правила (паки, части, кто ставит) — shared/skins.js,
// таблица — миграция 045_user_skins.sql.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../db/client.js';
import { publicSkin } from '../../../shared/skins.js';

// Все надетые скины — их единицы, поэтому без страниц. Снятые (все части
// стандартные) отсеивает publicSkin.
export async function listSkins({ db = query } = {}) {
    const { rows } = await db(
        `SELECT user_id, parts, operator FROM user_skins`,
    );
    return rows.map(publicSkin).filter(Boolean);
}

export async function mySkin(userId, { db = query } = {}) {
    const { rows } = await db(
        `SELECT parts, operator FROM user_skins WHERE user_id = $1`,
        [userId],
    );
    return rows[0] ? { parts: rows[0].parts || {}, operator: rows[0].operator || '' } : null;
}

export async function saveSkin(userId, { parts, operator }, { db = query } = {}) {
    await db(
        `INSERT INTO user_skins (user_id, parts, operator, updated_at)
         VALUES ($1, $2::jsonb, $3, now())
         ON CONFLICT (user_id) DO UPDATE
            SET parts = EXCLUDED.parts, operator = EXCLUDED.operator, updated_at = now()`,
        [userId, JSON.stringify(parts), operator],
    );
}

// ── Кто сидит под кодом оператора (миграция 048_operator_claims.sql) ─────────
// Код — место за телефоном, а не человек: на одном коде работают сменами.
// Поэтому код ЗАНИМАЮТ, и строка пишется только при смене хозяина.

// Последняя строка каждого кода — «кто на нём сейчас».
const LATEST = `SELECT DISTINCT ON (code) code, user_id FROM operator_claims ORDER BY code, at DESC, id DESC`;

/**
 * Человек сел под код: освобождает коды, на которых сидел раньше, и
 * занимает этот (пустой код — только освободить). Повтор ничего не пишет.
 * @returns {Promise<boolean>} поменялось ли что-нибудь
 */
export async function claimOperator(userId, code, { db = query } = {}) {
    const freed = await db(
        `INSERT INTO operator_claims (code, user_id)
         SELECT l.code, NULL::uuid FROM (${LATEST}) l WHERE l.user_id = $1 AND l.code <> $2`,
        [userId, code],
    );
    if (!code) return freed.rowCount > 0;
    const took = await db(
        `INSERT INTO operator_claims (code, user_id)
         SELECT $2::text, $1::uuid WHERE NOT EXISTS (
             SELECT 1 FROM (SELECT user_id FROM operator_claims WHERE code = $2 ORDER BY at DESC, id DESC LIMIT 1) l
             WHERE l.user_id = $1)`,
        [userId, code],
    );
    return freed.rowCount + took.rowCount > 0;
}

// Вышел из аккаунта — встал из-за телефона: звонки под его кодом до прихода
// сменщика ничьи, а не его.
export const releaseOperator = (userId, opts) => claimOperator(userId, '', opts);

// Строки за неделю и последняя до неё у каждого кода — этого хватает, чтобы
// приписать любой звонок ленты (она живёт часами, журнал CRM — днями).
export async function listClaims({ db = query } = {}) {
    const { rows } = await db(
        `SELECT code, user_id, at FROM operator_claims c
         WHERE at >= now() - interval '7 days'
            OR id = (SELECT id FROM operator_claims p
                     WHERE p.code = c.code AND p.at < now() - interval '7 days'
                     ORDER BY at DESC, id DESC LIMIT 1)`,
    );
    return rows.map(r => ({ code: r.code, userId: r.user_id || null, at: new Date(r.at).getTime() }));
}
