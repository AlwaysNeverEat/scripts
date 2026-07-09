// Telegram-воркер: логически отдельный модуль, встроенный в тот же backend-
// процесс (см. index.js) — чтобы не заводить второй платный сервис на
// бесплатных Render/Railway. Одна упавшая итерация polling'а не должна
// уронить Express, поэтому весь цикл обёрнут в try/catch.

import { isBotConfigured, getUpdates } from './telegramApi.js';
import { ensureDefaultBotAdmin } from './botAdmins.js';
import { handleUpdate } from './handlers.js';

const POLL_TIMEOUT_SEC = 25;

let running = false;

export async function startBot() {
  if (!isBotConfigured()) {
    console.log('Telegram-бот выключен: TELEGRAM_BOT_TOKEN не задан');
    return;
  }
  if (running) return;
  running = true;

  await ensureDefaultBotAdmin();
  console.log('Telegram-бот: long-polling запущен');

  let offset = undefined;
  while (running) {
    try {
      const updates = await getUpdates(offset, POLL_TIMEOUT_SEC);
      if (Array.isArray(updates)) {
        for (const update of updates) {
          offset = update.update_id + 1;
          try {
            await handleUpdate(update);
          } catch (err) {
            console.error('Telegram-бот: ошибка обработки update', err);
          }
        }
      } else {
        // getUpdates вернул null — сеть/неверный токен: не долбим Telegram
        // в busy-loop, даём паузу перед следующей попыткой.
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (err) {
      console.error('Telegram-бот: ошибка polling-цикла', err);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

export function stopBot() {
  running = false;
}
