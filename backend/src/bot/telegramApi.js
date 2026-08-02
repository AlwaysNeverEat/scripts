// Тонкий клиент Telegram Bot API поверх fetch — без сторонних SDK, в стиле
// остального backend (только pg/express/cors + то, что реально нужно).
// Токен только из env TELEGRAM_BOT_TOKEN, нигде не логируется и не хардкодится.

// Адрес Bot API. Вынесен в env не ради гибкости, а по нужде: с российского
// хостинга api.telegram.org недоступен — соединение просто не устанавливается
// (ConnectTimeoutError на 443), при том что остальной интернет с той же машины
// работает. Через TELEGRAM_API_BASE подставляется зеркало-прокси, которое до
// Telegram дотягивается: Cloudflare Worker, любой VPS за рубежом с nginx или
// self-hosted telegram-bot-api. Формат тот же, меняется только хост.
const API_ROOT = (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');

function token() {
  return process.env.TELEGRAM_BOT_TOKEN || '';
}

export function isBotConfigured() {
  return Boolean(token());
}

async function call(method, payload) {
  if (!isBotConfigured()) {
    console.warn(`Telegram: TELEGRAM_BOT_TOKEN не задан — пропускаю ${method}`);
    return null;
  }
  const res = await fetch(`${API_ROOT}/bot${token()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => null);
  if (!json || json.ok !== true) {
    console.error(`Telegram API ${method} failed:`, json?.description || res.status);
    return null;
  }
  return json.result;
}

export function sendMessage(chatId, text, { replyMarkup } = {}) {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: replyMarkup,
  });
}

export function editMessageReplyMarkup(chatId, messageId, replyMarkup) {
  return call('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup,
  });
}

export function editMessageText(chatId, messageId, text) {
  return call('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
  });
}

export function answerCallbackQuery(callbackQueryId, text) {
  return call('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
}

export function getUpdates(offset, timeoutSec) {
  return call('getUpdates', { offset, timeout: timeoutSec, allowed_updates: ['message', 'callback_query'] });
}
