// ─────────────────────────────────────────────────────────────────────────────
// Топ по СДЕЛАННЫМ ЗАПИСЯМ за календарный месяц (МСК).
//
// Считаем строки record_credits — по одной на каждую успешно созданную запись
// (кладёт backend/src/records/sync.js). Одна запись = один зачёт независимо от
// длины; продолжения продлённой записи не считаются вовсе — ни те, что ставит
// «Продлить» (телефон-заглушка), ни созданные руками встык слоты того же
// клиента: для человека это одна запись, а не три.
//
// Месяц закрывается сам собой: рейтинг — это выборка по текущему 'YYYY-MM',
// поэтому 1-го числа он начинается с нуля, а прошлый месяц никуда не девается
// и отдаётся отдельным полем previous: кто был первым к концу месяца, тот там
// и остался.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { query } from '../db/client.js';
import { FACULTY_JOIN, FACULTY_COLUMNS, facultyBadge } from '../faculty/store.js';
import { SUPPORTER_JOIN, SUPPORTER_COLUMNS, SUPPORTER_GROUP_BY, supporterBadge } from '../supporter/badge.js';

const router = Router();

// Месяц зачёта пишется в МСК (см. DEFAULT у record_credits.month) — текущий и
// прошлый считаем той же меркой, иначе на границе месяца рейтинг «прыгнет».
const MSK_NOW = `(now() AT TIME ZONE 'Europe/Moscow')`;

const STATS_SELECT = `
  u.id, u.display_name, u.avatar,
  rl.prefix_label, rl.color, rl.tooltip, ${FACULTY_COLUMNS}, ${SUPPORTER_COLUMNS},
  count(*)::int AS records`;

// Ранжируем по числу записей; при равенстве — по имени, чтобы порядок был
// стабильным между запросами (а не «как база отдала»).
const RANKED_QUERY = `
  SELECT ${STATS_SELECT}
    FROM record_credits rc
    JOIN users u ON u.id = rc.user_id
    LEFT JOIN role_labels rl ON rl.role = u.role
    ${FACULTY_JOIN}${SUPPORTER_JOIN}
   WHERE rc.month = $1
   GROUP BY u.id, rl.prefix_label, rl.color, rl.tooltip, fr.faculty, ${SUPPORTER_GROUP_BY}
   ORDER BY count(*) DESC, u.display_name
   LIMIT $2`;

function presentRow(row) {
  return {
    id: row.id,
    display_name: row.display_name,
    avatar: row.avatar,
    role_prefix: row.prefix_label
      ? { label: row.prefix_label, color: row.color, tooltip: row.tooltip }
      : null,
    faculty: facultyBadge(row.faculty),
    supporter: supporterBadge(row),
    records: row.records || 0,
  };
}

// ── GET /api/top ─────────────────────────────────────────────────────────────
// { month: 'YYYY-MM', rows: [{ rank, …, records }],
//   previous: { month: 'YYYY-MM', winners: [ … ] } }
// winners — все, кто разделил первое место в прошлом месяце (обычно один).

router.get('/', async (_req, res) => {
  try {
    const months = await query(
      `SELECT to_char(${MSK_NOW}, 'YYYY-MM') AS current,
              to_char(${MSK_NOW} - interval '1 month', 'YYYY-MM') AS previous`,
    );
    const { current, previous } = months.rows[0];

    const [ranked, prevTop] = await Promise.all([
      query(RANKED_QUERY, [current, 50]),
      // Первое место прошлого месяца. Берём несколько строк, а не одну: при
      // равном числе записей первыми были все они, и обделять кого-то из-за
      // сортировки по алфавиту нечестно.
      query(RANKED_QUERY, [previous, 10]),
    ]);

    const prevRows = prevTop.rows.map(presentRow);
    const best = prevRows.length ? prevRows[0].records : 0;

    res.json({
      month: current,
      rows: ranked.rows.map((row, i) => ({ rank: i + 1, ...presentRow(row) })),
      previous: {
        month: previous,
        winners: prevRows.filter(r => r.records === best),
      },
    });
  } catch (err) {
    console.error('GET /api/top', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
