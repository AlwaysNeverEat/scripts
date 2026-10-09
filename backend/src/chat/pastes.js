// ─────────────────────────────────────────────────────────────────────────────
// Пасты во вкладке «Чаты»: хранение. Правила (что такое правильная паста,
// темы, стартовый набор) — shared/chatPastes.js, таблицы — миграция
// 043_chat_pastes.sql.
//
// Пасты СВОИ У КАЖДОГО: у оператора, который пишет «Ваша запись…», и у того,
// кто пишет «Вы записаны…», разные слова, и общий список превратился бы в
// спор о формулировках. Стартовый набор каждый получает при первом открытии
// панели, дальше он его.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../db/client.js';
import { DEFAULT_PASTES, PASTES_MAX } from '../../../shared/chatPastes.js';

// id отдаётся строкой (bigserial в JS теряет точность после 2^53), поэтому
// сортировать по нему надо как `chat_pastes.id`: голое `ORDER BY id` взяло бы
// псевдоним-строку, и «10» встало бы раньше «2».
const COLS = 'id::text AS id, title, body, topics';

/**
 * Пасты человека. При самом первом обращении — со стартовым набором.
 *
 * Выдача набора — ОДИН запрос: отметка «выдано» и вставка паст в одном
 * операторе. Две вкладки, открытые разом, иначе выдали бы набор дважды, а
 * отметка без паст (упали посередине) оставила бы человека с пустой панелью
 * навсегда.
 */
export async function listPastes(userId, { db = query } = {}) {
    await db(
        `WITH s AS (
            INSERT INTO chat_paste_seeded (user_id) VALUES ($1)
            ON CONFLICT DO NOTHING
            RETURNING user_id
         )
         INSERT INTO chat_pastes (user_id, title, body, topics)
         SELECT s.user_id, d.title, d.body, d.topics
           FROM s, jsonb_to_recordset($2::jsonb) AS d(n int, title text, body text, topics text[])
          ORDER BY d.n`,
        // Номер — чтобы набор лёг в базу в том же порядке, в каком написан:
        // id растут по порядку вставки, а список отдаётся по id.
        [userId, JSON.stringify(DEFAULT_PASTES.map((p, n) => ({ n, ...p })))],
    );
    const { rows } = await db(`SELECT ${COLS} FROM chat_pastes WHERE user_id = $1 ORDER BY chat_pastes.id`, [userId]);
    return rows;
}

/** @returns {Promise<object|null>} null — упёрлись в потолок паст */
export async function createPaste(userId, { title, body, topics }, { db = query } = {}) {
    const { rows } = await db(
        `INSERT INTO chat_pastes (user_id, title, body, topics)
         SELECT $1, $2, $3, $4
          WHERE (SELECT count(*) FROM chat_pastes WHERE user_id = $1) < $5
         RETURNING ${COLS}`,
        [userId, title, body, topics, PASTES_MAX],
    );
    return rows[0] || null;
}

/** @returns {Promise<object|null>} null — нет такой пасты у этого человека */
export async function updatePaste(userId, id, { title, body, topics }, { db = query } = {}) {
    const { rows } = await db(
        `UPDATE chat_pastes SET title = $3, body = $4, topics = $5, updated_at = now()
          WHERE id = $2 AND user_id = $1
         RETURNING ${COLS}`,
        [userId, id, title, body, topics],
    );
    return rows[0] || null;
}

export async function deletePaste(userId, id, { db = query } = {}) {
    const { rowCount } = await db('DELETE FROM chat_pastes WHERE id = $2 AND user_id = $1', [userId, id]);
    return rowCount > 0;
}

// Темы, которые уже есть у человека: новая тема, набранная другим регистром,
// пишется так же, как существующая («запись» → «Запись»).
export async function topicsOf(userId, { db = query } = {}) {
    const { rows } = await db(
        'SELECT DISTINCT unnest(topics) AS t FROM chat_pastes WHERE user_id = $1',
        [userId],
    );
    return rows.map(r => r.t);
}
