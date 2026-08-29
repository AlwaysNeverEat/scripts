// ─────────────────────────────────────────────────────────────────────────────
// Подписка «supp»: всё, что ХОДИТ В БАЗУ по подписчикам (см. миграцию
// db/migrations/039_supporter.sql). Правило «кто владелец», строка JOIN и вид
// плашки лежат рядом, в badge.js, — их проверяют без базы.
//
// Три вещи, которые стоит помнить при правках.
//
// СРОК ПРОВЕРЯЕТСЯ ЗАПРОСОМ, А НЕ ФОНОВОЙ ЗАДАЧЕЙ. Условие «ещё действует»
// стоит в самом SUPPORTER_JOIN (badge.js), поэтому истёкшая подписка пропадает
// из выдачи ровно в ту секунду, когда истекла, — во всех списках сразу и без
// крона, которого в проекте нет. «Сама уберётся через месяц» — это и есть
// строка, переставшая соединяться, а не работа по расписанию, которая однажды
// не запустится.
//
// ВЛАДЕЛЕЦ — ПОДПИСЧИК ПО ОПРЕДЕЛЕНИЮ. Бессрочная подписка у него следует из
// логина (OWNER_LOGIN), а не из чьей-то щедрости: строка в базе только
// отпечаток этого правила, и если её потерять (пересоздали базу, накатили
// старый дамп), она восстановится сама при первом же его заходе. Обратное
// неверно — вписать себе expires_at = NULL руками никто из кода не может, такую
// строку создаёт только ensureOwnerSubscription.
//
// НАСТРОЙКИ ТЕМЫ ПЕРЕЖИВАЮТ ПОДПИСКУ. Строка supporters не удаляется никогда:
// кончился месяц — тема выключилась, продлили — вернулся тот же вид. Поэтому
// здесь нет ни одного DELETE, а «снять» — это expires_at = now().
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../db/client.js';
import { normalizeTheme, nextExpiry, DEFAULT_THEME } from '../../../shared/supporterTheme.js';
import { isOwner } from './badge.js';

// Правило «кто владелец», строка JOIN и вид плашки живут в badge.js — там их
// можно проверить без живого Postgres. Отсюда они реэкспортируются, чтобы
// остальному бэкенду было всё равно, из какого файла приезжает подписка.
export {
    OWNER_LOGIN, isOwnerLogin, isOwner,
    SUPPORTER_JOIN, SUPPORTER_COLUMNS, SUPPORTER_GROUP_BY, supporterBadge,
} from './badge.js';

// ── Чтение ───────────────────────────────────────────────────────────────────

/**
 * Строка подписки целиком, включая ИСТЁКШУЮ (active говорит, действует ли она
 * сейчас). Истёкшая нужна: в ней лежат настройки темы, которые вернутся при
 * продлении, и по ней профиль пишет «подписка закончилась», а не молчит.
 */
export async function loadSupporter(userId) {
    const r = await query(
        `SELECT user_id, expires_at, theme, created_at,
                (expires_at IS NULL OR expires_at > now()) AS active
           FROM supporters WHERE user_id = $1`,
        [userId],
    );
    if (!r.rows.length) return null;
    const row = r.rows[0];
    return {
        user_id: row.user_id,
        expires_at: row.expires_at,
        forever: !row.expires_at,
        active: !!row.active,
        theme: normalizeTheme(row.theme),
        created_at: row.created_at,
    };
}

/**
 * Карточка подписки для профиля и для окна настроек.
 *
 * Тему отдаём ВСЕГДА, даже когда подписки нет и никогда не было: окно рисует
 * по ней предпросмотр, и «посмотреть, как будет» не должно требовать оплаты —
 * это витрина, а не товар.
 */
export async function supporterState(user) {
    const owner = isOwner(user);
    if (owner) await ensureOwnerSubscription(user.id);
    const row = await loadSupporter(user.id);
    return {
        active: row ? row.active : false,
        forever: row ? row.forever : false,
        expires_at: row?.expires_at || null,
        theme: row?.theme || { ...DEFAULT_THEME },
        // Право выдавать подписки другим. Проверка живёт на сервере, а кнопка
        // в интерфейсе — только следствие этого поля.
        canGrant: owner,
    };
}

// ── Запись ───────────────────────────────────────────────────────────────────

/**
 * Бессрочная подписка владельцу. Идемпотентно и безопасно: если строка уже
 * есть, у неё только снимается срок, а настройки темы остаются.
 */
export async function ensureOwnerSubscription(userId) {
    await query(
        `INSERT INTO supporters (user_id, expires_at)
              VALUES ($1, NULL)
         ON CONFLICT (user_id) DO UPDATE
                SET expires_at = NULL,
                    updated_at = now()
              WHERE supporters.expires_at IS NOT NULL`,
        [userId],
    );
}

/**
 * Выдать месяц. Продление НЕ обнуляет остаток: месяц прибавляется к концу
 * текущего срока (см. nextExpiry) — человек, заплативший вперёд, не должен
 * терять оплаченные дни из-за того, что деньги дошли раньше.
 */
export async function grantMonth(userId, { by = null, note = null } = {}) {
    const current = await loadSupporter(userId);
    // У бессрочной подписки продлевать нечего — срока нет вовсе.
    if (current?.forever) return current;

    const expires = nextExpiry(current?.expires_at || null);
    await query(
        `INSERT INTO supporters (user_id, expires_at)
              VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE
                SET expires_at = EXCLUDED.expires_at,
                    updated_at = now()`,
        [userId, expires],
    );
    await logGrant(userId, { by, action: 'grant', expires, note });
    return loadSupporter(userId);
}

/**
 * Снять подписку досрочно. Не удаляем строку, а обрываем срок: настройки темы
 * остаются человеку, а в журнале видно, что подписку сняли, а не «её не было».
 */
export async function revoke(userId, { by = null, note = null } = {}) {
    const r = await query(
        `UPDATE supporters
            SET expires_at = now(), updated_at = now()
          WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > now())
      RETURNING user_id`,
        [userId],
    );
    if (!r.rows.length) return null;         // подписки и так не было
    await logGrant(userId, { by, action: 'revoke', expires: null, note });
    return loadSupporter(userId);
}

/**
 * Сохранить настройки темы. Проверяет их shared/supporterTheme.js.
 *
 * Строки ещё может не быть: тему настраивают и тогда, когда подписка кончилась
 * (её вернут при продлении). Такая строка создаётся сразу ИСТЁКШЕЙ
 * (expires_at = now()) — она хранит настройки, но подписчиком не делает.
 */
export async function saveTheme(userId, raw) {
    const theme = normalizeTheme(raw);
    await query(
        `INSERT INTO supporters (user_id, expires_at, theme)
              VALUES ($1, now(), $2::jsonb)
         ON CONFLICT (user_id) DO UPDATE
                SET theme = EXCLUDED.theme,
                    updated_at = now()`,
        [userId, JSON.stringify(theme)],
    );
    return theme;
}

function logGrant(userId, { by, action, expires, note }) {
    return query(
        `INSERT INTO supporter_grants (user_id, granted_by, action, expires_at, note)
              VALUES ($1, $2, $3, $4, $5)`,
        [userId, by, action, expires, note ? String(note).slice(0, 300) : null],
    );
}

/**
 * Предупредить в лог, если миграция 039 ещё не накатана.
 *
 * Нужно ровно потому, что однажды было: код уехал на сервер раньше миграции,
 * а плашка подписки в тот момент ещё лежала в проверке сессии — и вместо
 * неработающей подписки перестал работать вход, всех выкинуло. Проверку из
 * входа убрали (auth/sessions.js), но остались страницы, которые без таблицы
 * ответят ошибкой, и молча гадать, почему топ пустой, никто не должен.
 */
export async function warnAboutMissingSupporters() {
    try {
        const r = await query(`SELECT to_regclass('public.supporters') AS t`);
        if (r.rows[0]?.t) return;
        console.warn(
            '\n!!! Таблицы supporters нет — подписка supp и всё, что её показывает, работать не будет.\n'
            + '    Накатите миграцию:\n'
            + '    docker compose -f deploy/docker-compose.prod.yml exec -T postgres \\\n'
            + '        psql -U carsdb -d carsdb -v ON_ERROR_STOP=1 < db/migrations/039_supporter.sql\n',
        );
    } catch (err) {
        // База может быть ещё не поднята — это не повод падать при старте.
        console.warn('Проверка таблицы supporters не удалась:', err.message);
    }
}

// ── Список для владельца ─────────────────────────────────────────────────────

/**
 * Кому выдано. Показываем и недавно истёкших: владельцу важно видеть, у кого
 * подписка кончилась на этой неделе, — это и есть список тех, кому пора
 * напомнить о продлении.
 */
export async function listSupporters() {
    const r = await query(
        `SELECT u.id, u.display_name, u.login, u.avatar,
                s.expires_at, s.theme,
                (s.expires_at IS NULL OR s.expires_at > now()) AS active,
                (SELECT count(*) FROM supporter_grants g
                  WHERE g.user_id = s.user_id AND g.action = 'grant')::int AS grants
           FROM supporters s
           JOIN users u ON u.id = s.user_id
          WHERE s.expires_at IS NULL
             OR s.expires_at > now() - interval '30 days'
          ORDER BY (s.expires_at IS NULL) DESC, s.expires_at`,
    );
    return r.rows.map(row => ({
        id: row.id,
        display_name: row.display_name,
        login: row.login,
        avatar: row.avatar,
        expires_at: row.expires_at,
        forever: !row.expires_at,
        active: !!row.active,
        color: normalizeTheme(row.theme).accent,
        grants: row.grants,
    }));
}
