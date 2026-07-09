// Чистые хелперы разбора команд/callback-данных и сборки клавиатур —
// без обращений к БД/Telegram API, поэтому легко юнит-тестируются
// (см. commands.test.js). Вся работа с БД — в backend/src/bot/handlers.js.

export function parseCommand(text) {
  if (typeof text !== 'string') return null;
  const m = text.trim().match(/^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  return { command: m[1].toLowerCase(), args: (m[2] || '').trim() };
}

// callback_data вида "ns:action:id" (id — uuid, без двоеточий).
export function parseCallbackData(data) {
  if (typeof data !== 'string') return null;
  const [ns, action, ...rest] = data.split(':');
  if (!ns || !action) return null;
  return { ns, action, id: rest.join(':') || null };
}

// mod ⇄ user. Роль admin через бота не переключается (защищённая роль).
export function nextRoleForToggle(role) {
  if (role === 'mod') return 'user';
  if (role === 'user') return 'mod';
  return null;
}

// Сообщения уходят в Telegram с parse_mode:'HTML' — display_name/login
// вводятся пользователем при регистрации и не ограничены по символам
// (только длина), поэтому экранируем перед подстановкой: иначе случайный
// «<» в нике ломает отправку сообщения (Telegram отклонит "can't parse entities").
function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

export function formatUserLine(user) {
  const prefix = user.role === 'mod' ? '🟢mod ' : '';
  return `${prefix}${escapeHtml(user.display_name)} (@${escapeHtml(user.login)}) — ${escapeHtml(user.role)}`;
}

export function userActionsKeyboard(user) {
  const modLabel = user.role === 'mod' ? '🛡 Снять модератора' : '🛡 Сделать модератором';
  const rows = [
    [{ text: '🔨 Забанить', callback_data: `u:ban:${user.id}` }],
    [{ text: '✏️ Поменять ник', callback_data: `u:rename:${user.id}` }],
  ];
  if (user.role !== 'admin') {
    rows.push([{ text: modLabel, callback_data: `u:mod:${user.id}` }]);
  }
  return { inline_keyboard: rows };
}

export function carActionsKeyboard(car) {
  return { inline_keyboard: [[{ text: '🗑 Удалить машину', callback_data: `c:del:${car.id}` }]] };
}

export function carDeleteConfirmKeyboard(car) {
  return {
    inline_keyboard: [[
      { text: '✅ Да, удалить безвозвратно', callback_data: `c:delyes:${car.id}` },
      { text: '↩️ Отмена', callback_data: `c:delno:${car.id}` },
    ]],
  };
}

export function formatCarLine(car) {
  const years = car.year_from ? `${car.year_from}${car.year_to ? '–' + car.year_to : '+'}` : '';
  const line = `${car.brand} ${car.model}${car.generation ? ' ' + car.generation : ''} ${years}`.trim();
  return escapeHtml(line);
}
