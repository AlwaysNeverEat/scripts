// Список Telegram-админов бота хранится в БД (bot_admins), а не только в env —
// это и позволяет "передать доступ к админке" прямо из чата (раздел C ТЗ).
// ADMIN_TELEGRAM_ID (env, дефолт 691442300) — только сид по умолчанию.

import { query } from '../db/client.js';

const DEFAULT_ADMIN_ID = '691442300';

export function defaultAdminId() {
  const raw = process.env.ADMIN_TELEGRAM_ID || DEFAULT_ADMIN_ID;
  const id = parseInt(raw, 10);
  return Number.isFinite(id) ? id : parseInt(DEFAULT_ADMIN_ID, 10);
}

// Сидирует дефолтного админа, если таблица пуста (первый запуск бота).
export async function ensureDefaultBotAdmin() {
  const r = await query('SELECT count(*)::int AS n FROM bot_admins');
  if (r.rows[0].n > 0) return;
  await query(
    'INSERT INTO bot_admins (telegram_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [defaultAdminId()],
  );
}

export async function listBotAdmins() {
  const r = await query('SELECT telegram_id FROM bot_admins ORDER BY added_at');
  return r.rows.map(row => Number(row.telegram_id));
}

export async function isBotAdmin(telegramId) {
  const r = await query('SELECT 1 FROM bot_admins WHERE telegram_id = $1', [telegramId]);
  return r.rows.length > 0;
}

export async function addBotAdmin(telegramId) {
  await query(
    'INSERT INTO bot_admins (telegram_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [telegramId],
  );
}
