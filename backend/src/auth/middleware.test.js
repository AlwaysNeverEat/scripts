// requireRole — чистая проверка req.user.role, без БД (requireSession нужен
// живой Postgres и покрыт смоук-тестом curl'ом, см. Фазу 2 отчёта).

import test from 'node:test';
import assert from 'node:assert/strict';

import { requireRole } from './middleware.js';

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test('requireRole: пропускает разрешённую роль', () => {
  const req = { user: { role: 'mod' } };
  const res = mockRes();
  let nextCalled = false;
  requireRole('mod', 'admin')(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('requireRole: 403 для неразрешённой роли', () => {
  const req = { user: { role: 'user' } };
  const res = mockRes();
  let nextCalled = false;
  requireRole('mod', 'admin')(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test('requireRole: 403 без req.user (UI-кнопка — не защита, сервер обязан проверять сам)', () => {
  const req = {};
  const res = mockRes();
  let nextCalled = false;
  requireRole('mod')(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});
