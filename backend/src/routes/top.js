// ─────────────────────────────────────────────────────────────────────────────
// Топ по СДЕЛАННЫМ ЗАПИСЯМ за календарный месяц (МСК).
//
// Считаем строки record_credits — по одной на каждую успешно созданную запись
// (кладёт backend/src/records/sync.js). Одна запись = один зачёт независимо от
// длины; продолжения продлённой записи не считаются вовсе — ни те, что ставит
// «Продлить» (телефон-заглушка), ни созданные руками встык слоты того же
// клиента: для человека это одна запись, а не три.
//
// `rc.counted` — фильтр, а не украшение: с миграции 040 в той же таблице лежат
// и записи, сделанные через сайт, но очка не дающие (запись мастера, номер из
// одной цифры). Они нужны доске и окну дня — там у записи есть автор, — но в
// рейтинг не идут. См. backend/src/records/credits.js.
//
// Месяц закрывается сам собой: рейтинг — это выборка по текущему 'YYYY-MM',
// поэтому 1-го числа он начинается с нуля, а прошлый месяц никуда не девается
// и отдаётся отдельным полем previous: кто был первым к концу месяца, тот там
// и остался.
//
// Любой закрытый месяц открывается ЦЕЛИКОМ (`?month=YYYY-MM`): та же выборка
// по другому 'YYYY-MM'. Архива как отдельной сущности нет и заводить его
// незачем — строки record_credits не удаляются никогда, так что таблица
// прошлого месяца считается из тех же строк, что считали её в последний день.
// Ручка только читает: ни «закрытия месяца», ни снимка, который можно
// перезаписать или потерять, тут нет.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { query } from '../db/client.js';
import { FACULTY_JOIN, FACULTY_COLUMNS, facultyBadge } from '../faculty/store.js';

const router = Router();

// Месяц зачёта пишется в МСК (см. DEFAULT у record_credits.month) — текущий и
// прошлый считаем той же меркой, иначе на границе месяца рейтинг «прыгнет».
const MSK_NOW = `(now() AT TIME ZONE 'Europe/Moscow')`;

const STATS_SELECT = `
  u.id, u.display_name, u.avatar,
  rl.prefix_label, rl.color, rl.tooltip, ${FACULTY_COLUMNS},
  count(*)::int AS records`;

// Ранжируем по числу записей; при равенстве — по имени, чтобы порядок был
// стабильным между запросами (а не «как база отдала»).
const RANKED_QUERY = `
  SELECT ${STATS_SELECT}
    FROM record_credits rc
    JOIN users u ON u.id = rc.user_id
    LEFT JOIN role_labels rl ON rl.role = u.role
    ${FACULTY_JOIN}
   WHERE rc.month = $1 AND rc.counted
   GROUP BY u.id, rl.prefix_label, rl.color, rl.tooltip, fr.faculty
   ORDER BY count(*) DESC, u.display_name
   LIMIT $2`;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Какой месяц показать: без параметра — текущий. Мусор — null (роут ответит
// 400), а не молча текущий месяц: человек, открывший «август», не должен
// увидеть сентябрь под подписью августа.
export function pickMonth(param, current) {
  if (param === undefined || param === null || param === '') return current;
  // ?month=…&month=… Express отдаёт массивом, а String(['2026-09']) —
  // это '2026-09': проверка формата пропустила бы его как обычный.
  return typeof param === 'string' && MONTH_RE.test(param) ? param : null;
}

// Месяцы для листания, свежие первыми. Текущий есть всегда, даже пустой:
// 1-го числа в нём ещё ни одной записи, а открываться вкладка должна именно
// на нём. Будущих месяцев в списке быть не может — их нет в record_credits.
export function monthList(stored, current) {
  const set = new Set(stored.filter(m => MONTH_RE.test(m) && m <= current));
  set.add(current);
  return [...set].sort().reverse();
}

function presentRow(row) {
  return {
    id: row.id,
    display_name: row.display_name,
    avatar: row.avatar,
    role_prefix: row.prefix_label
      ? { label: row.prefix_label, color: row.color, tooltip: row.tooltip }
      : null,
    faculty: facultyBadge(row.faculty),
    records: row.records || 0,
  };
}

// ── GET /api/top[?month=YYYY-MM] ─────────────────────────────────────────────
// { month: 'YYYY-MM' (показанный), current: 'YYYY-MM', months: ['YYYY-MM', …],
//   rows: [{ rank, …, records }],
//   previous: { month: 'YYYY-MM', winners: [ … ] } }
// winners — все, кто разделил первое место в прошлом месяце (обычно один).
// previous всегда про месяц перед ТЕКУЩИМ, а не перед показанным: это
// карточка «кто победил в прошлый раз», а не часть листания.

router.get('/', async (req, res) => {
  try {
    const now = await query(
      `SELECT to_char(${MSK_NOW}, 'YYYY-MM') AS current,
              to_char(${MSK_NOW} - interval '1 month', 'YYYY-MM') AS previous`,
    );
    const { current, previous } = now.rows[0];

    const month = pickMonth(req.query.month, current);
    if (!month) return res.status(400).json({ error: 'month: ожидается YYYY-MM' });

    const [ranked, prevTop, stored] = await Promise.all([
      query(RANKED_QUERY, [month, 50]),
      // Первое место прошлого месяца. Берём несколько строк, а не одну: при
      // равном числе записей первыми были все они, и обделять кого-то из-за
      // сортировки по алфавиту нечестно.
      query(RANKED_QUERY, [previous, 10]),
      query(`SELECT DISTINCT month FROM record_credits WHERE counted`),
    ]);

    const prevRows = prevTop.rows.map(presentRow);
    const best = prevRows.length ? prevRows[0].records : 0;

    res.json({
      month,
      current,
      months: monthList(stored.rows.map(r => r.month), current),
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
