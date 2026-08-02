// Админка по HTTP: заявки на регистрацию, которые раньше одобрялись ТОЛЬКО
// кнопками Accept/Decline под сообщением Telegram-бота (backend/src/bot/).
//
// Почему появился этот роутер: сервер переехал в РФ, откуда api.telegram.org
// недоступен (ConnectTimeoutError на 443) — бот молчит, заявки копятся в БД, и
// единственным способом их одобрить остался ручной скрипт по SSH. Правила
// одобрения при этом не переписываются: вся логика как была в
// auth/registrationRequests.js, здесь только HTTP-обёртка над ней.
//
// Доступ — mod/admin, проверкой НА СЕРВЕРЕ: скрытая вкладка в интерфейсе
// защитой не считается.

import { Router } from 'express';
import { query as dbQuery } from '../db/client.js';
import { requireRole } from '../auth/middleware.js';
import * as requestsRepo from '../auth/registrationRequests.js';

// Обработанные заявки держим на экране столько же, сколько живёт смена: видно,
// кого и когда уже одобрили, но список не превращается в архив за всё время.
const RECENT_WINDOW = '24 hours';

// Ответы заявок собираем вручную по полям, а не рассылаем строку целиком:
// в registration_requests лежит password_hash, и он не должен утечь в API
// ни сейчас, ни когда в таблицу добавят ещё колонок.
function publicRequest(row) {
  return {
    id: row.id,
    display_name: row.display_name,
    login: row.login,
    status: row.status,
    created_at: row.created_at,
    expires_at: row.expires_at,
  };
}

// Ошибки репозитория (одни и те же коды, что разбирает бот) → HTTP.
// 409, а не 400: заявка была валидной, просто её состояние уже изменилось —
// протухла, обработана кем-то другим или логин заняли.
const REQUEST_ERROR_HTTP = {
  not_found:   [404, 'заявка не найдена'],
  expired:     [409, 'заявка просрочена — она живёт 30 минут'],
  accepted:    [409, 'заявка уже одобрена'],
  declined:    [409, 'заявка уже отклонена'],
  login_taken: [409, 'логин уже занят — заявка отклонена'],
};

function sendRequestError(res, code) {
  const [status, message] = REQUEST_ERROR_HTTP[code] || [409, `заявка недоступна: ${code}`];
  return res.status(status).json({ error: message });
}

// Фабрика, а не готовый роутер: тестам нужно подсунуть поддельные query и
// репозиторий заявок — живого Postgres в node --test нет (см. admin.test.js).
export function createAdminRouter({ query = dbQuery, requests = requestsRepo } = {}) {
  const router = Router();

  // Одна проверка на весь роутер: любой новый эндпоинт здесь автоматически
  // под тем же замком, о нём нельзя забыть.
  router.use(requireRole('mod', 'admin'));

  // ── GET /api/admin/requests ─────────────────────────────────────────────────
  // Живые заявки + недавно обработанные. Порядок: сначала pending (с ними и
  // работают), внутри — свежие сверху.

  router.get('/requests', async (_req, res) => {
    try {
      // Обязательно ДО выборки: протухание ленивое (крона нет), и без этого
      // вызова заявка старше 30 минут показалась бы живой, а кнопка «Одобрить»
      // на ней всё равно вернула бы «просрочена».
      await requests.expireStalePending();

      const r = await query(
        `SELECT id, display_name, login, status, created_at, expires_at
           FROM registration_requests
          WHERE status = 'pending' OR created_at > now() - interval '${RECENT_WINDOW}'
          ORDER BY (status = 'pending') DESC, created_at DESC
          LIMIT 100`,
      );
      res.json({ requests: r.rows.map(publicRequest) });
    } catch (err) {
      console.error('GET /api/admin/requests', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/admin/requests/:id/accept ─────────────────────────────────────
  // Ровно то же, что делала кнопка Accept в боте: перенос display_name/login и
  // уже посчитанного при подаче заявки хэша пароля в users.

  router.post('/requests/:id/accept', async (req, res) => {
    try {
      const result = await requests.acceptRegistrationRequest(req.params.id);
      if (result.error) return sendRequestError(res, result.error);
      // Из созданного юзера отдаём только то, что и так видно на сайте:
      // в result.user лежит вся строка users, вместе с password_hash.
      res.json({
        ok: true,
        user: {
          id: result.user.id,
          display_name: result.user.display_name,
          login: result.user.login,
        },
      });
    } catch (err) {
      console.error('POST /api/admin/requests/:id/accept', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/admin/requests/:id/decline ────────────────────────────────────

  router.post('/requests/:id/decline', async (req, res) => {
    try {
      const result = await requests.declineRegistrationRequest(req.params.id);
      if (result.error) return sendRequestError(res, result.error);
      res.json({ ok: true });
    } catch (err) {
      console.error('POST /api/admin/requests/:id/decline', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

export default createAdminRouter();
