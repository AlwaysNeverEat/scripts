// Хранение кастомизации профиля (см. db/migrations/043_profile_fx.sql).
//
// Джойн один на все запросы, где пользователь отдаётся с оформлением, — по
// образцу FACULTY_JOIN (backend/src/faculty/store.js) и по той же причине:
// разъехавшиеся запросы дали бы человеку рамку в профиле и голый круг в топе.

import { query } from '../db/client.js';
import { normalizeFx } from '../../../shared/profileFx.js';

export const FX_JOIN = 'LEFT JOIN user_profile_fx ufx ON ufx.user_id = u.id';
export const FX_COLUMNS = 'ufx.avatar_fx, ufx.profile_fx';

/** Пара эффектов из строки запроса — валидированная, для выдачи клиенту. */
export function fxOf(row) {
    return normalizeFx({ avatar: row?.avatar_fx, profile: row?.profile_fx });
}

/**
 * Сохранить выбор. null в поле — снять эффект; незнакомый id отбрасывается
 * ЗДЕСЬ (normalizeFx), а не «как-нибудь на чтении»: мусор из тела запроса не
 * должен доезжать до базы. Возвращает то, что реально записано.
 */
export async function saveFx(userId, fx) {
    const clean = normalizeFx(fx);
    await query(
        `INSERT INTO user_profile_fx (user_id, avatar_fx, profile_fx)
              VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE
                SET avatar_fx = excluded.avatar_fx,
                    profile_fx = excluded.profile_fx,
                    updated_at = now()`,
        [userId, clean.avatar, clean.profile],
    );
    return clean;
}
