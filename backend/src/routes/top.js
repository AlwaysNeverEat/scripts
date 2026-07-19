import { Router } from 'express';
import { query } from '../db/client.js';

const router = Router();

// gtrixoff — служебный аккаунт: машины в базу он залил массовым импортом, а не
// руками, поэтому в рейтинге он не участвует. Показываем его отдельной строкой
// внизу топа (сереньким) со ЧЕСТНОЙ статистикой, но без места и вне сортировки —
// чтобы автозалив не задвигал живых людей. Логин сравниваем без учёта регистра
// (в users уникальный индекс по lower(login)).
const AUTO_IMPORT_LOGIN = 'gtrixoff';

// SELECT-часть общая для рейтинга и для служебной строки: added — число
// добавленных машин (car_events type='added'), edited — число ОТРЕДАКТИРОВАННЫХ
// МАШИН (DISTINCT car_id по type='edited', как в профиле и ачивках; 100 правок
// одной машины = 1). score = added + edited — по нему и ранжируем.
const ADDED_EXPR = `count(*) FILTER (WHERE ce.type = 'added')`;
const EDITED_EXPR = `count(DISTINCT ce.car_id) FILTER (WHERE ce.type = 'edited')`;
// score = машины + записи. Тянем выражением, а не по алиасу: Postgres не видит
// алиасы SELECT внутри выражений ORDER BY/HAVING (только как одиночное имя).
const SCORE_EXPR = `(${ADDED_EXPR} + ${EDITED_EXPR})`;
const STATS_SELECT = `
  u.id, u.display_name, u.login, u.avatar,
  rl.prefix_label, rl.color, rl.tooltip,
  ${ADDED_EXPR}::int  AS added,
  ${EDITED_EXPR}::int AS edited`;

function presentRow(row) {
  const added = row.added || 0;
  const edited = row.edited || 0;
  return {
    id: row.id,
    display_name: row.display_name,
    avatar: row.avatar,
    role_prefix: row.prefix_label
      ? { label: row.prefix_label, color: row.color, tooltip: row.tooltip }
      : null,
    added,
    edited,
    score: added + edited,
  };
}

// ── GET /api/top ───────────────────────────────────────────────────────────────
// Топ пользователей по сумме (добавленные машины + отредактированные машины).
// Ответ: { rows: [...ранжированные...], excluded: {...gtrixoff...} | null }.

router.get('/', async (_req, res) => {
  try {
    const [ranked, excluded] = await Promise.all([
      // Рейтинг: все, кто хоть раз добавлял/редактировал, кроме автозалива.
      // JOIN (не LEFT) отсекает юзеров без единого события — им в топе делать
      // нечего. Сортировка по score = added + edited.
      query(
        `SELECT ${STATS_SELECT}
           FROM users u
           JOIN car_events ce ON ce.user_id = u.id
           LEFT JOIN role_labels rl ON rl.role = u.role
          WHERE lower(u.login) <> $1
          GROUP BY u.id, rl.prefix_label, rl.color, rl.tooltip
         HAVING ${SCORE_EXPR} > 0
          ORDER BY ${SCORE_EXPR} DESC, u.display_name
          LIMIT 50`,
        [AUTO_IMPORT_LOGIN],
      ),
      // Служебная строка: LEFT JOIN — показываем даже если событий вдруг нет.
      query(
        `SELECT ${STATS_SELECT}
           FROM users u
           LEFT JOIN car_events ce ON ce.user_id = u.id
           LEFT JOIN role_labels rl ON rl.role = u.role
          WHERE lower(u.login) = $1
          GROUP BY u.id, rl.prefix_label, rl.color, rl.tooltip
          LIMIT 1`,
        [AUTO_IMPORT_LOGIN],
      ),
    ]);

    res.json({
      rows: ranked.rows.map((row, i) => ({ rank: i + 1, ...presentRow(row) })),
      excluded: excluded.rows.length ? presentRow(excluded.rows[0]) : null,
    });
  } catch (err) {
    console.error('GET /api/top', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
