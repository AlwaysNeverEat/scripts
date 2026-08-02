// PATCH /api/users/:id/role. Отказы важнее успеха: эндпоинт раздаёт права,
// и дыра здесь стоит дороже, чем неработающая кнопка.
//
// Проверку «чужая роль» гоняем через НАСТОЯЩИЙ роутер (default export, с
// боевым requireRole в стеке) — так тест ломается, если замок однажды снимут
// с маршрута. До БД такой запрос не доходит, живой Postgres не нужен.
// Остальное — через roleChangeHandler с поддельным db.

import test from 'node:test';
import assert from 'node:assert/strict';

import usersRouter, { roleChangeHandler } from './users.js';

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; res.done = true; return res; };
  return res;
}

// Поддельный Postgres: SELECT отдаёт заданного пользователя, UPDATE копится в
// writes — по нему и видно, изменилась роль на самом деле или нет.
function fakeDb(target) {
  const writes = [];
  const db = async (text, params) => {
    if (text.startsWith('UPDATE')) { writes.push(params); return { rows: [] }; }
    return { rows: target ? [target] : [] };
  };
  return { db, writes };
}

async function patchRole({ actor, targetId, role, target }) {
  const { db, writes } = fakeDb(target);
  const res = mockRes();
  await roleChangeHandler({ db })({ params: { id: targetId }, user: actor, body: { role } }, res);
  return { res, writes };
}

const MOD = { id: 'actor-1', role: 'mod' };
const ADMIN = { id: 'actor-1', role: 'admin' };

test('роль меняет только mod/admin: обычному юзеру — 403 от самого роутера', async () => {
  const res = mockRes();
  await new Promise((resolve, reject) => {
    usersRouter(
      { method: 'PATCH', url: '/some-user/role', headers: {}, user: { id: 'u1', role: 'user' }, body: { role: 'mod' } },
      res,
      (err) => reject(err || new Error('маршрут PATCH /:id/role не найден')),
    );
    const tick = () => (res.done ? resolve() : setTimeout(tick, 1));
    tick();
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'forbidden');
});

test('admin через API не выдаётся — 403, как и в боте (nextRoleForToggle)', async () => {
  const { res, writes } = await patchRole({
    actor: ADMIN, targetId: 'u2', role: 'admin', target: { id: 'u2', role: 'user' },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(writes.length, 0);
});

test('роль администратора через API не снимается — 403', async () => {
  const { res, writes } = await patchRole({
    actor: ADMIN, targetId: 'u2', role: 'user', target: { id: 'u2', role: 'admin' },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(writes.length, 0);
});

test('себе роль менять нельзя — 400 (иначе единственный мод снимет себе права)', async () => {
  const { res, writes } = await patchRole({
    actor: MOD, targetId: MOD.id, role: 'user', target: { id: MOD.id, role: 'mod' },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /самому себе/);
  assert.equal(writes.length, 0);
});

test('мусор вместо роли не проходит — 403, а не тихое обнуление', async () => {
  for (const role of [undefined, '', 'root', 'ADMIN', 123, null]) {
    const { res, writes } = await patchRole({
      actor: ADMIN, targetId: 'u2', role, target: { id: 'u2', role: 'user' },
    });
    assert.equal(res.statusCode, 403, `role=${String(role)}`);
    assert.equal(writes.length, 0);
  }
});

test('несуществующий пользователь — 404', async () => {
  const { res, writes } = await patchRole({
    actor: ADMIN, targetId: 'нет-такого', role: 'mod', target: null,
  });
  assert.equal(res.statusCode, 404);
  assert.equal(writes.length, 0);
});

test('user → mod: роль записывается', async () => {
  const { res, writes } = await patchRole({
    actor: MOD, targetId: 'u2', role: 'mod', target: { id: 'u2', role: 'user' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, role: 'mod' });
  assert.deepEqual(writes, [['mod', 'u2']]);
});

test('mod → user: роль записывается', async () => {
  const { res, writes } = await patchRole({
    actor: ADMIN, targetId: 'u2', role: 'user', target: { id: 'u2', role: 'mod' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(writes, [['user', 'u2']]);
});

test('роль уже такая — 200 без записи в БД', async () => {
  const { res, writes } = await patchRole({
    actor: ADMIN, targetId: 'u2', role: 'mod', target: { id: 'u2', role: 'mod' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(writes.length, 0);
});
