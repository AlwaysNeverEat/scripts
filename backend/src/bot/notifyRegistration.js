// Уведомление админов о новой заявке на регистрацию — вызывается из
// POST /api/auth/register. Сама обработка нажатий Accept/Decline (callback_query)
// живёт в backend/src/bot/index.js (Фаза 3, long-polling).

import { sendMessage } from './telegramApi.js';
import { ensureDefaultBotAdmin, listBotAdmins } from './botAdmins.js';

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

export async function notifyNewRegistrationRequest(reqRow) {
  await ensureDefaultBotAdmin();
  const admins = await listBotAdmins();
  if (!admins.length) return;

  const text =
    `🆕 <b>Заявка на регистрацию</b>\n` +
    `Имя: ${escapeHtml(reqRow.display_name)}\n` +
    `Логин: <code>${escapeHtml(reqRow.login)}</code>\n` +
    `Пришла: ${new Date(reqRow.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК\n` +
    `Истекает: ${new Date(reqRow.expires_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК`;

  const replyMarkup = {
    inline_keyboard: [[
      { text: '✅ Accept', callback_data: `reg:accept:${reqRow.id}` },
      { text: '❌ Decline', callback_data: `reg:decline:${reqRow.id}` },
    ]],
  };

  await Promise.all(admins.map(chatId => sendMessage(chatId, text, { replyMarkup })));
}
