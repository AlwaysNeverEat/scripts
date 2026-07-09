import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCommand, parseCallbackData, nextRoleForToggle,
  userActionsKeyboard, carDeleteConfirmKeyboard,
  formatUserLine, formatCarLine,
} from './commands.js';

test('parseCommand: разбирает команду с аргументами', () => {
  assert.deepEqual(parseCommand('/users иван'), { command: 'users', args: 'иван' });
  assert.deepEqual(parseCommand('/addadmin 12345'), { command: 'addadmin', args: '12345' });
});

test('parseCommand: команда без аргументов', () => {
  assert.deepEqual(parseCommand('/help'), { command: 'help', args: '' });
});

test('parseCommand: не команда — null', () => {
  assert.equal(parseCommand('просто текст'), null);
  assert.equal(parseCommand(''), null);
  assert.equal(parseCommand(undefined), null);
});

test('parseCommand: игнорирует @botname', () => {
  assert.deepEqual(parseCommand('/help@my_bot'), { command: 'help', args: '' });
});

test('parseCallbackData: разбирает ns:action:id', () => {
  assert.deepEqual(parseCallbackData('u:ban:abc-123'), { ns: 'u', action: 'ban', id: 'abc-123' });
  assert.deepEqual(parseCallbackData('reg:accept:uuid-1'), { ns: 'reg', action: 'accept', id: 'uuid-1' });
});

test('parseCallbackData: некорректные данные — null', () => {
  assert.equal(parseCallbackData(''), null);
  assert.equal(parseCallbackData(undefined), null);
});

test('nextRoleForToggle: mod⇄user, admin не трогаем', () => {
  assert.equal(nextRoleForToggle('mod'), 'user');
  assert.equal(nextRoleForToggle('user'), 'mod');
  assert.equal(nextRoleForToggle('admin'), null);
});

test('userActionsKeyboard: для admin нет кнопки мода (защищённая роль)', () => {
  const kb = userActionsKeyboard({ id: '1', role: 'admin' });
  const flat = kb.inline_keyboard.flat().map(b => b.callback_data);
  assert.ok(!flat.some(cd => cd.startsWith('u:mod:')));
});

test('userActionsKeyboard: для mod кнопка "Снять модератора"', () => {
  const kb = userActionsKeyboard({ id: '1', role: 'mod' });
  const btn = kb.inline_keyboard.flat().find(b => b.callback_data === 'u:mod:1');
  assert.ok(btn.text.includes('Снять'));
});

test('carDeleteConfirmKeyboard: две кнопки с одним id', () => {
  const kb = carDeleteConfirmKeyboard({ id: 'car-1' });
  const cds = kb.inline_keyboard.flat().map(b => b.callback_data);
  assert.deepEqual(cds, ['c:delyes:car-1', 'c:delno:car-1']);
});

// Сообщения уходят в Telegram с parse_mode:'HTML' — ник/логин/марка вводятся
// пользователем и не запрещают спецсимволы. Без экранирования «<» в нике
// ломает отправку сообщения ("can't parse entities").
test('formatUserLine: экранирует HTML в display_name/login', () => {
  const line = formatUserLine({ display_name: '<b>Vasya</b>', login: 'a&b', role: 'user' });
  assert.ok(!line.includes('<b>'));
  assert.ok(line.includes('&lt;b&gt;'));
  assert.ok(line.includes('a&amp;b'));
});

test('formatCarLine: экранирует HTML в марке/модели', () => {
  const line = formatCarLine({ brand: 'Ford<script>', model: 'Focus', year_from: 2015 });
  assert.ok(!line.includes('<script>'));
  assert.ok(line.includes('&lt;script&gt;'));
});
