// ─────────────────────────────────────────────────────────────────────────────
// Данные ленты активности профиля: сколько записей человек сделал в каждый
// день за последний год. Рисует сетку фронт (frontend/src/activityFeed.js),
// уровни яркости считает общий модуль shared/activityHeatmap.js — здесь только
// выборка.
//
// Источник — record_credits, тот же, что у месячного топа: одна строка на одну
// успешно сделанную запись (см. db/migrations/020_record_credits.sql). Поэтому
// цифры в ленте и в топе не могут разъехаться — и по той же причине здесь тот
// же фильтр `counted`, что и в топе: запись мастера в клетке не светится, хотя
// в окне дня она видна (см. backend/src/records/credits.js).
//
// День — в МСК, как и месяц зачёта: иначе вечерняя запись падала бы в
// соседний квадрат, а у сервера в UTC «сегодня» кончалось бы в три часа ночи.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../db/client.js';
import { HEATMAP_DAYS } from '../../../shared/activityHeatmap.js';

// Границы окна считает БД, а не Node: у процесса своя таймзона (на Render —
// UTC), и «сегодня» надо брать по московскому календарю.
const ACTIVITY_QUERY = `
  WITH bounds AS (
    SELECT (now() AT TIME ZONE 'Europe/Moscow')::date AS today
  )
  SELECT to_char(b.today, 'YYYY-MM-DD')                    AS to_day,
         to_char(b.today - ($2::int - 1), 'YYYY-MM-DD')    AS from_day,
         to_char((rc.created_at AT TIME ZONE 'Europe/Moscow')::date, 'YYYY-MM-DD') AS day,
         count(rc.id)::int                                 AS count
    FROM bounds b
    -- LEFT JOIN, а не WHERE: у человека без записей всё равно должна вернуться
    -- строка с границами окна — фронту нужна пустая сетка, а не пустой ответ.
    -- ::timestamp обязателен: без него date уходит в AT TIME ZONE через
    -- timestamptz, и граница окна съезжает на смещение МСК (первые часы
    -- самого старого дня выпали бы из ленты).
    LEFT JOIN record_credits rc
           ON rc.user_id = $1
          AND rc.counted
          AND rc.created_at >= ((b.today - ($2::int - 1))::timestamp AT TIME ZONE 'Europe/Moscow')
   GROUP BY b.today, day
   ORDER BY day`;

// { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', days: [{ date, count }] }
// days — только дни, в которые записи были; остальные фронт дорисует нулями.
// db подменяется в тестах (живого Postgres в node --test нет) — как в
// roleChangeHandler (routes/users.js).
export async function loadActivity(userId, { days = HEATMAP_DAYS, db = query } = {}) {
    const r = await db(ACTIVITY_QUERY, [userId, days]);
    const first = r.rows[0] || {};
    return {
        from: first.from_day || null,
        to: first.to_day || null,
        days: r.rows
            .filter(row => row.day)
            .map(row => ({ date: row.day, count: row.count })),
    };
}
