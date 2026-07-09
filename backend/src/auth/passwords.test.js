import test from 'node:test';
import assert from 'node:assert/strict';

import { hashPassword, verifyPassword } from './passwords.js';

test('hashPassword/verifyPassword: раунд-трип верного пароля', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.notEqual(hash, 'correct horse battery staple'); // не хранит открытым текстом
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
});

test('verifyPassword: неверный пароль не проходит', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.equal(await verifyPassword('wrong password', hash), false);
});

test('hashPassword: два хэша одного пароля разные (соль)', async () => {
  const h1 = await hashPassword('same-password');
  const h2 = await hashPassword('same-password');
  assert.notEqual(h1, h2);
});
