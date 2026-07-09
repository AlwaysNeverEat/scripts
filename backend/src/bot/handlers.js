// Обработчики Telegram-команд/callback'ов — обращаются к БД напрямую
// (как backend/scripts/seed.js: это доверенная админка, а не публичный API,
// x-api-key/сессии тут ни при чём). Не покрыто юнит-тестами — как и остальной
// DB-слой в этом проекте (см. backend/src/routes/cars.js), проверяется вручную.

import { query } from '../db/client.js';
import { sendMessage, editMessageText, answerCallbackQuery } from './telegramApi.js';
import { isBotAdmin, addBotAdmin } from './botAdmins.js';
import { acceptRegistrationRequest, declineRegistrationRequest } from '../auth/registrationRequests.js';
import {
  parseCommand, parseCallbackData, nextRoleForToggle,
  formatUserLine, userActionsKeyboard, formatCarLine, carActionsKeyboard, carDeleteConfirmKeyboard,
} from './commands.js';

// Ожидание следующего текстового сообщения как нового ника
// (chatId -> userId). Один процесс, память ок для внутренней админки.
const pendingRename = new Map();

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ── Заявки на регистрацию ─────────────────────────────────────────────────────

async function handleRegistrationCallback(cb, action, requestId) {
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;

  if (action === 'accept') {
    const result = await acceptRegistrationRequest(requestId);
    if (result.error === 'expired') {
      await answerCallbackQuery(cb.id, 'Заявка просрочена (жила 30 минут)');
      await editMessageText(chatId, messageId, cb.message.text + '\n\n⏱ Просрочена, accept не сработал.');
    } else if (result.error === 'login_taken') {
      await answerCallbackQuery(cb.id, 'Логин уже занят — заявка отклонена');
      await editMessageText(chatId, messageId, cb.message.text + '\n\n❌ Логин уже занят, заявка отклонена.');
    } else if (result.error) {
      await answerCallbackQuery(cb.id, 'Уже обработана');
    } else {
      await answerCallbackQuery(cb.id, 'Принято ✅');
      await editMessageText(chatId, messageId, cb.message.text + `\n\n✅ Принято: ${escapeHtml(result.user.display_name)}`);
    }
    return;
  }

  if (action === 'decline') {
    const result = await declineRegistrationRequest(requestId);
    if (result.error) {
      await answerCallbackQuery(cb.id, 'Уже обработана');
    } else {
      await answerCallbackQuery(cb.id, 'Отклонено ❌');
      await editMessageText(chatId, messageId, cb.message.text + '\n\n❌ Отклонено.');
    }
  }
}

// ── Пользователи ──────────────────────────────────────────────────────────────

export async function searchUsers(chatId, q) {
  const term = q.trim();
  const r = term
    ? await query(
        `SELECT * FROM users WHERE display_name ILIKE '%'||$1||'%' OR login ILIKE '%'||$1||'%' ORDER BY display_name LIMIT 10`,
        [term],
      )
    : await query('SELECT * FROM users ORDER BY created_at DESC LIMIT 10', []);

  if (!r.rows.length) {
    await sendMessage(chatId, 'Никого не нашлось.');
    return;
  }
  for (const user of r.rows) {
    await sendMessage(chatId, formatUserLine(user), { replyMarkup: userActionsKeyboard(user) });
  }
}

async function handleUserCallback(cb, action, userId) {
  const chatId = cb.message.chat.id;

  if (action === 'ban') {
    const r = await query('DELETE FROM users WHERE id = $1 RETURNING display_name', [userId]);
    await answerCallbackQuery(cb.id, r.rows.length ? 'Забанен' : 'Уже нет такого юзера');
    if (r.rows.length) {
      await editMessageText(chatId, cb.message.message_id, `🔨 ${escapeHtml(r.rows[0].display_name)} — забанен и удалён.`);
    }
    return;
  }

  if (action === 'mod') {
    const cur = await query('SELECT role, display_name FROM users WHERE id = $1', [userId]);
    if (!cur.rows.length) return answerCallbackQuery(cb.id, 'Юзер не найден');
    const next = nextRoleForToggle(cur.rows[0].role);
    if (!next) return answerCallbackQuery(cb.id, 'Роль admin через бота не меняется');
    await query('UPDATE users SET role = $1 WHERE id = $2', [next, userId]);
    await answerCallbackQuery(cb.id, next === 'mod' ? 'Стал модератором' : 'Модератор снят');
    await editMessageText(
      chatId, cb.message.message_id,
      `${next === 'mod' ? '🛡' : '👤'} ${escapeHtml(cur.rows[0].display_name)} — теперь ${next}.`,
    );
    return;
  }

  if (action === 'rename') {
    const cur = await query('SELECT display_name FROM users WHERE id = $1', [userId]);
    if (!cur.rows.length) return answerCallbackQuery(cb.id, 'Юзер не найден');
    pendingRename.set(chatId, userId);
    await answerCallbackQuery(cb.id);
    await sendMessage(chatId, `Введите новый ник для «${escapeHtml(cur.rows[0].display_name)}» следующим сообщением:`);
  }
}

// ── Машины ─────────────────────────────────────────────────────────────────────

export async function searchCars(chatId, q) {
  const term = q.trim();
  const r = term
    ? await query(
        `SELECT * FROM cars WHERE brand ILIKE '%'||$1||'%' OR model ILIKE '%'||$1||'%' ORDER BY brand, model LIMIT 10`,
        [term],
      )
    : await query('SELECT * FROM cars ORDER BY created_at DESC LIMIT 10', []);

  if (!r.rows.length) {
    await sendMessage(chatId, 'Машин не нашлось.');
    return;
  }
  for (const car of r.rows) {
    await sendMessage(chatId, formatCarLine(car), { replyMarkup: carActionsKeyboard(car) });
  }
}

async function handleCarCallback(cb, action, carId) {
  const chatId = cb.message.chat.id;

  if (action === 'del') {
    const cur = await query('SELECT * FROM cars WHERE id = $1', [carId]);
    if (!cur.rows.length) return answerCallbackQuery(cb.id, 'Машина не найдена');
    await answerCallbackQuery(cb.id);
    await sendMessage(
      chatId,
      `⚠️ Удалить «${formatCarLine(cur.rows[0])}» ПОЛНОСТЬЮ И БЕЗВОЗВРАТНО?`,
      { replyMarkup: carDeleteConfirmKeyboard(cur.rows[0]) },
    );
    return;
  }

  if (action === 'delyes') {
    const r = await query('DELETE FROM cars WHERE id = $1 RETURNING brand, model', [carId]);
    await answerCallbackQuery(cb.id, r.rows.length ? 'Удалено' : 'Уже нет такой машины');
    await editMessageText(
      chatId, cb.message.message_id,
      r.rows.length ? `🗑 Удалено: ${escapeHtml(r.rows[0].brand)} ${escapeHtml(r.rows[0].model)}` : 'Уже удалено.',
    );
    return;
  }

  if (action === 'delno') {
    await answerCallbackQuery(cb.id, 'Отменено');
    await editMessageText(chatId, cb.message.message_id, '↩️ Удаление отменено.');
  }
}

// ── Диспетчер ──────────────────────────────────────────────────────────────────

export async function handleUpdate(update) {
  if (update.callback_query) return handleCallbackQuery(update.callback_query);
  if (update.message) return handleMessage(update.message);
}

async function handleCallbackQuery(cb) {
  const fromId = cb.from?.id;
  if (!(await isBotAdmin(fromId))) {
    return answerCallbackQuery(cb.id, 'Нет доступа');
  }
  const parsed = parseCallbackData(cb.data);
  if (!parsed) return answerCallbackQuery(cb.id);

  try {
    if (parsed.ns === 'reg') await handleRegistrationCallback(cb, parsed.action, parsed.id);
    else if (parsed.ns === 'u') await handleUserCallback(cb, parsed.action, parsed.id);
    else if (parsed.ns === 'c') await handleCarCallback(cb, parsed.action, parsed.id);
    else await answerCallbackQuery(cb.id);
  } catch (err) {
    console.error('bot callback_query', err);
    await answerCallbackQuery(cb.id, 'Ошибка на сервере');
  }
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const fromId = message.from?.id;
  if (!(await isBotAdmin(fromId))) return; // тихо игнорируем чужих

  // Ожидается новый ник после нажатия "✏️ Поменять ник"
  if (pendingRename.has(chatId) && typeof message.text === 'string' && !message.text.startsWith('/')) {
    const userId = pendingRename.get(chatId);
    pendingRename.delete(chatId);
    const name = message.text.trim().slice(0, 60);
    const r = await query('UPDATE users SET display_name = $1 WHERE id = $2 RETURNING display_name', [name, userId]);
    await sendMessage(chatId, r.rows.length ? `✏️ Ник обновлён: ${escapeHtml(r.rows[0].display_name)}` : 'Юзер не найден.');
    return;
  }

  const parsed = parseCommand(message.text);
  if (!parsed) return;

  try {
    if (parsed.command === 'help' || parsed.command === 'start') {
      await sendMessage(chatId,
        '/users &lt;текст&gt; — поиск пользователей\n' +
        '/cars &lt;текст&gt; — поиск машин\n' +
        '/addadmin &lt;telegram_id&gt; — выдать доступ к этой админке');
    } else if (parsed.command === 'users') {
      await searchUsers(chatId, parsed.args);
    } else if (parsed.command === 'cars') {
      await searchCars(chatId, parsed.args);
    } else if (parsed.command === 'addadmin') {
      const id = parseInt(parsed.args, 10);
      if (!Number.isFinite(id)) {
        await sendMessage(chatId, 'Использование: /addadmin 123456789');
      } else {
        await addBotAdmin(id);
        await sendMessage(chatId, `✅ ${id} теперь может управлять этим ботом.`);
      }
    }
  } catch (err) {
    console.error('bot message', err);
    await sendMessage(chatId, '⚠ Ошибка на сервере, попробуйте ещё раз.');
  }
}
