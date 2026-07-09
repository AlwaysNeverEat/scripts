import test from 'node:test';
import assert from 'node:assert/strict';

import { validateDisplayName, validateLogin, validatePassword } from './validate.js';

test('validateDisplayName: пусто/пробелы — ошибка', () => {
  assert.ok(validateDisplayName(''));
  assert.ok(validateDisplayName('   '));
  assert.ok(validateDisplayName(undefined));
});

test('validateDisplayName: рус/лат имя — ок', () => {
  assert.equal(validateDisplayName('Иван Иванов'), null);
  assert.equal(validateDisplayName('John Smith'), null);
});

test('validateLogin: слишком короткий/длинный/спецсимволы — ошибка', () => {
  assert.ok(validateLogin('ab'));
  assert.ok(validateLogin('a'.repeat(41)));
  assert.ok(validateLogin('login with spaces'));
  assert.ok(validateLogin('login@site'));
});

test('validateLogin: буквы/цифры/._- — ок', () => {
  assert.equal(validateLogin('ivan_petrov-01'), null);
  assert.equal(validateLogin('логин.рус'), null);
});

test('validatePassword: короче 6 символов — ошибка', () => {
  assert.ok(validatePassword('12345'));
  assert.ok(validatePassword(''));
});

test('validatePassword: 6+ символов — ок', () => {
  assert.equal(validatePassword('123456'), null);
});
