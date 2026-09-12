// ─────────────────────────────────────────────────────────────────────────────
// История поиска по складу — общая на всех, см. миграцию 042.
//
// Строка на ЗАПРОС: повтор двигает её наверх и прибавляет uses. Ключ —
// нормализованный текст, чтобы «w 712/95» и «W 712/95» не стали двумя
// подсказками; показываем при этом последнее набранное написание.
//
// Запрос обрезается по длине ДО записи: ручка открыта всем вошедшим, и без
// потолка в таблицу можно было бы положить роман. Это защита от мусора, а не
// от людей: чужой мусор в подсказках увидят все, но и уберут его те же все —
// строка уходит вниз, как только её перестают повторять.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../db/client.js';

export const MAX_QUERY_LEN = 80;
// Сколько подсказок отдаём: в выпадашке видно восемь, но фильтруются они по
// набранному прямо в браузере, и запас нужен, чтобы «W 7» находил не только
// последние восемь запросов вообще.
export const HISTORY_LIMIT = 100;

// Как запрос уходит в CRM и в таблицу: без лишних пробелов, не длиннее потолка.
export function cleanQuery(raw) {
    return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LEN);
}

export function normQuery(raw) {
    return cleanQuery(raw).toLowerCase();
}

/** Запомнить запрос (или поднять его наверх, если такой уже был). */
export async function remember(rawQuery, userId, { db = query } = {}) {
    const q = cleanQuery(rawQuery);
    if (!q) return;
    await db(
        `INSERT INTO crm_stock_searches (query_norm, query, last_user_id)
              VALUES ($1, $2, $3)
         ON CONFLICT (query_norm) DO UPDATE
                SET query = EXCLUDED.query,
                    uses = crm_stock_searches.uses + 1,
                    last_user_id = EXCLUDED.last_user_id,
                    last_at = now()`,
        [q.toLowerCase(), q, userId],
    );
}

/**
 * Последние запросы, свежие сверху.
 * @returns {Promise<Array<{ query: string, uses: number, lastAt: string }>>}
 */
export async function recent({ db = query, limit = HISTORY_LIMIT } = {}) {
    const { rows } = await db(
        `SELECT query, uses, last_at
           FROM crm_stock_searches
          ORDER BY last_at DESC
          LIMIT $1`,
        [limit],
    );
    // bigint из pg приезжает строкой — в JSON он должен уехать числом.
    return rows.map(r => ({
        query: r.query,
        uses: Number(r.uses || 0),
        lastAt: r.last_at instanceof Date ? r.last_at.toISOString() : String(r.last_at || ''),
    }));
}
