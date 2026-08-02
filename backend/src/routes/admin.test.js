// Эндпоинты админки гоняем ЧЕРЕЗ настоящий роутер (createAdminRouter), а не
// вызовом хендлеров напрямую: половина проверок здесь — про requireRole, а он
// живёт в router.use, и вызов хендлера мимо роутера этот замок бы не заметил.
// Живого Postgres в node --test нет, поэтому query и репозиторий заявок
// подставляются фабрикой.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createAdminRouter } from './admin.js';

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; res.done = true; return res; };
  return res;
}

// Роутер отвечает асинхронно (хендлеры async) — ждём, пока позовут res.json.
// next() тут означает «ни один маршрут не подошёл»: для наших проверок это
// такая же поломка, как исключение, поэтому валим тест явно.
async function dispatch(router, { method, url, user, body }) {
  const res = mockRes();
  const req = { method, url, headers: {}, user, body };
  await new Promise((resolve, reject) => {
    router(req, res, (err) => reject(err || new Error(`маршрут ${method} ${url} не найден`)));
    const deadline = Date.now() + 1000;
    const tick = () => {
      if (res.done) return resolve();
      if (Date.now() > deadline) return reject(new Error(`нет ответа на ${method} ${url}`));
      setTimeout(tick, 1);
    };
    tick();
  });
  return res;
}

function routerWith({ rows = [], requests = {} } = {}) {
  const calls = [];
  const query = async (text, params) => { calls.push({ text, params }); return { rows }; };
  const router = createAdminRouter({
    query,
    requests: {
      expireStalePending: async () => { calls.push({ text: 'expireStalePending' }); },
      acceptRegistrationRequest: async () => ({ error: 'not_found' }),
      declineRegistrationRequest: async () => ({ error: 'not_found' }),
      ...requests,
    },
  });
  return { router, calls };
}

test('GET /requests: чужая роль — 403, до БД дело не доходит', async () => {
  const { router, calls } = routerWith();
  const res = await dispatch(router, { method: 'GET', url: '/requests', user: { id: 'u1', role: 'user' } });
  assert.equal(res.statusCode, 403);
  assert.equal(calls.length, 0);
});

test('GET /requests: без сессии (нет req.user) — 403', async () => {
  const { router } = routerWith();
  const res = await dispatch(router, { method: 'GET', url: '/requests', user: undefined });
  assert.equal(res.statusCode, 403);
});

test('GET /requests: протухшие заявки гасятся ДО выборки', async () => {
  const { router, calls } = routerWith({ rows: [] });
  const res = await dispatch(router, { method: 'GET', url: '/requests', user: { id: 'u1', role: 'mod' } });
  assert.equal(res.statusCode, 200);
  assert.equal(calls[0].text, 'expireStalePending');
  assert.ok(calls[1].text.includes('registration_requests'));
});

test('GET /requests: хэш пароля не уходит в ответ', async () => {
  const { router } = routerWith({
    rows: [{
      id: 'r1', display_name: 'Иван', login: 'ivan', status: 'pending',
      created_at: '2026-08-02T10:00:00Z', expires_at: '2026-08-02T10:30:00Z',
      password_hash: '$2b$10$секрет',
    }],
  });
  const res = await dispatch(router, { method: 'GET', url: '/requests', user: { id: 'u1', role: 'admin' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.requests.length, 1);
  assert.equal(res.body.requests[0].login, 'ivan');
  assert.ok(!('password_hash' in res.body.requests[0]));
});

test('POST /requests/:id/accept: чужая роль — 403, заявка не трогается', async () => {
  let accepted = false;
  const { router } = routerWith({
    requests: { acceptRegistrationRequest: async () => { accepted = true; return { user: {} }; } },
  });
  const res = await dispatch(router, { method: 'POST', url: '/requests/r1/accept', user: { id: 'u1', role: 'user' } });
  assert.equal(res.statusCode, 403);
  assert.equal(accepted, false);
});

test('POST /requests/:id/accept: успех отдаёт юзера без хэша пароля', async () => {
  const { router } = routerWith({
    requests: {
      acceptRegistrationRequest: async (id) => {
        assert.equal(id, 'r1');
        return { user: { id: 'u9', display_name: 'Иван', login: 'ivan', password_hash: '$2b$10$секрет' } };
      },
    },
  });
  const res = await dispatch(router, { method: 'POST', url: '/requests/r1/accept', user: { id: 'u1', role: 'mod' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, user: { id: 'u9', display_name: 'Иван', login: 'ivan' } });
});

test('POST /requests/:id/accept: просроченная заявка — 409 с внятным текстом', async () => {
  const { router } = routerWith({
    requests: { acceptRegistrationRequest: async () => ({ error: 'expired' }) },
  });
  const res = await dispatch(router, { method: 'POST', url: '/requests/r1/accept', user: { id: 'u1', role: 'mod' } });
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /30 минут/);
});

test('POST /requests/:id/accept: занятый логин — 409', async () => {
  const { router } = routerWith({
    requests: { acceptRegistrationRequest: async () => ({ error: 'login_taken' }) },
  });
  const res = await dispatch(router, { method: 'POST', url: '/requests/r1/accept', user: { id: 'u1', role: 'mod' } });
  assert.equal(res.statusCode, 409);
});

test('POST /requests/:id/accept: несуществующая заявка — 404', async () => {
  const { router } = routerWith();
  const res = await dispatch(router, { method: 'POST', url: '/requests/нет/accept', user: { id: 'u1', role: 'admin' } });
  assert.equal(res.statusCode, 404);
});

test('POST /requests/:id/decline: успех', async () => {
  const { router } = routerWith({
    requests: { declineRegistrationRequest: async () => ({ ok: true }) },
  });
  const res = await dispatch(router, { method: 'POST', url: '/requests/r1/decline', user: { id: 'u1', role: 'mod' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('POST /requests/:id/decline: чужая роль — 403', async () => {
  let declined = false;
  const { router } = routerWith({
    requests: { declineRegistrationRequest: async () => { declined = true; return { ok: true }; } },
  });
  const res = await dispatch(router, { method: 'POST', url: '/requests/r1/decline', user: { id: 'u1', role: 'user' } });
  assert.equal(res.statusCode, 403);
  assert.equal(declined, false);
});

test('POST /requests/:id/decline: уже обработанная — 409', async () => {
  const { router } = routerWith({
    requests: { declineRegistrationRequest: async () => ({ error: 'accepted' }) },
  });
  const res = await dispatch(router, { method: 'POST', url: '/requests/r1/decline', user: { id: 'u1', role: 'mod' } });
  assert.equal(res.statusCode, 409);
});
