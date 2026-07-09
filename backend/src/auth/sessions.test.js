import test from 'node:test';
import assert from 'node:assert/strict';

import { parseBearerToken } from './sessions.js';

test('parseBearerToken: достаёт токен из "Bearer <token>"', () => {
  assert.equal(parseBearerToken('Bearer abc123'), 'abc123');
  assert.equal(parseBearerToken('bearer abc123'), 'abc123');
});

test('parseBearerToken: нет заголовка/неверный формат — null', () => {
  assert.equal(parseBearerToken(undefined), null);
  assert.equal(parseBearerToken(''), null);
  assert.equal(parseBearerToken('Basic abc123'), null);
  assert.equal(parseBearerToken('abc123'), null);
});
