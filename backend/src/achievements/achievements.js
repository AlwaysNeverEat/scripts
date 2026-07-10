// ─────────────────────────────────────────────────────────────────────────────
// Достижения: определения (пороги/тексты) + синхронизация с фактами.
//
// Принцип: в user_achievements хранится только ФАКТ получения, а единственный
// источник правды для счётчиков — car_events. syncAchievements() каждый раз
// пересчитывает метрики пользователя и приводит его ачивки в соответствие:
// докидывает заслуженные и ЗАБИРАЕТ уже не заслуженные (модератор переназначил
// машину → счётчик упал ниже порога → ачивка снимается). Никаких инкрементов
// «+1 к счётчику» — их невозможно надёжно откатывать.
//
// metric:
//   added  — число машин, добавленных пользователем (car_events type='added';
//            у машины ровно одно такое событие, переназначение переписывает
//            его user_id, поэтому счётчик честный).
//   edited — число ОТРЕДАКТИРОВАННЫХ МАШИН, не правок: DISTINCT car_id.
//            100 правок одной машины = 1 машина.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../db/client.js';

// Линейка «за добавленные машины»; следующие ступени добавляются строкой сюда,
// без миграций. icon — ключ картинки на фронте (frontend/src/achievements.js).
export const ACHIEVEMENTS = [
  {
    id: 'cars_added_5',
    title: 'Эксперт расчетов 5',
    description: 'Добавьте в базу 5 новых машин',
    metric: 'added',
    threshold: 5,
  },
];

const byId = new Map(ACHIEVEMENTS.map(a => [a.id, a]));

export function achievementById(id) {
  return byId.get(id) || null;
}

// Чистая логика «что докинуть / что забрать» — отдельно от БД, чтобы её можно
// было тестировать без Postgres.
export function diffAchievements(metrics, unlockedIds) {
  const unlocked = new Set(unlockedIds);
  const grant = [];
  const revoke = [];
  for (const a of ACHIEVEMENTS) {
    const value = metrics[a.metric] ?? 0;
    const earned = value >= a.threshold;
    if (earned && !unlocked.has(a.id)) grant.push(a.id);
    if (!earned && unlocked.has(a.id)) revoke.push(a.id);
  }
  return { grant, revoke };
}

// Метрики пользователя по car_events. edited — по машинам (DISTINCT car_id).
export async function computeMetrics(userId) {
  const r = await query(
    `SELECT
       count(*)              FILTER (WHERE type = 'added')  ::int AS added,
       count(DISTINCT car_id) FILTER (WHERE type = 'edited') ::int AS edited
     FROM car_events
     WHERE user_id = $1`,
    [userId],
  );
  return { added: r.rows[0].added, edited: r.rows[0].edited };
}

// Привести ачивки пользователя в соответствие с его реальными счётчиками.
// Вызывается после каждого действия, меняющего car_events этого пользователя
// (добавление, правка, переназначение — для ОБОИХ участников переназначения).
export async function syncAchievements(userId) {
  if (!userId) return;
  const [metrics, unlockedR] = await Promise.all([
    computeMetrics(userId),
    query('SELECT achievement_id FROM user_achievements WHERE user_id = $1', [userId]),
  ]);
  const { grant, revoke } = diffAchievements(
    metrics,
    unlockedR.rows.map(r => r.achievement_id),
  );

  for (const id of grant) {
    // ON CONFLICT — параллельные запросы могут синкать одного юзера одновременно.
    await query(
      `INSERT INTO user_achievements (user_id, achievement_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, achievement_id) DO NOTHING`,
      [userId, id],
    );
  }
  if (revoke.length) {
    await query(
      'DELETE FROM user_achievements WHERE user_id = $1 AND achievement_id = ANY($2)',
      [userId, revoke],
    );
  }
}

// Синк, который не должен ронять основной запрос: машина уже сохранена, и
// ошибка начисления ачивки — не повод отвечать 500. Логируем и едем дальше;
// следующий же синк этого пользователя всё догонит (пересчёт полный).
export async function syncAchievementsSafe(userId) {
  try {
    await syncAchievements(userId);
  } catch (err) {
    console.error('achievements sync failed for user', userId, err);
  }
}
