import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import carsRouter from './routes/cars.js';
import authRouter from './routes/auth.js';
import profileRouter from './routes/profile.js';
import topRouter from './routes/top.js';
import usersRouter from './routes/users.js';
import crmRouter from './routes/crm.js';
import recordsRouter from './routes/records.js';
import { requireSession, optionalSession } from './auth/middleware.js';
import { startBot } from './bot/index.js';
import { startRecordsSync } from './records/sync.js';

const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (e.g. curl, Tampermonkey GM_xmlhttpRequest)
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      cb(null, true);
    } else {
      cb(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
}));

app.use(express.json({ limit: '1mb' }));

// ── Auth ──────────────────────────────────────────────────────────────────────
const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  console.warn('WARNING: API_KEY env var is not set — all requests will be rejected');
}

app.use('/api', (req, res, next) => {
  const key = req.headers['x-api-key'];
  if (!API_KEY || key !== API_KEY) {
    return res.status(401).json({ error: 'invalid or missing x-api-key' });
  }
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
// Auth — публичные эндпоинты (login/register без сессии; logout/me сами
// проверяют токен где нужно). Всё остальное под /api — только с валидной
// сессией: x-api-key выше — грубый гейт, requireSession — личность пользователя.
app.use('/api/auth', authRouter);
app.use('/api/cars', requireSession, carsRouter);
app.use('/api/profile', requireSession, profileRouter);
app.use('/api/top', requireSession, topRouter);
app.use('/api/users', requireSession, usersRouter);
app.use('/api/crm', requireSession, crmRouter);
// Записи (клон админки ZMS) — сознательно БЕЗ requireSession: доступ общий,
// гейт — сами логин/пароль оригинальной админки (см. routes/records.js).
// optionalSession не гейт, а «кто это»: залогиненному операции подписываются
// его аккаунтом и идут в месячный топ, гость работает как раньше.
app.use('/api/records', optionalSession, recordsRouter);

app.get('/health', (_req, res) => res.json({ ok: true }));

// multer (загрузка аватарки) кидает ошибку ДО наших обработчиков —
// превращаем в аккуратный 400, а не голый 500.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `avatar: ${err.message}` });
  }
  next(err);
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3001');
app.listen(PORT, '0.0.0.0', () => console.log(`cars-db backend listening on :${PORT}`));

// Telegram-воркер — логически отдельный модуль (backend/src/bot/), но
// запускается в этом же процессе, чтобы не заводить второй сервис на
// бесплатных Render/Railway. Не блокирует HTTP: если TELEGRAM_BOT_TOKEN
// не задан — просто ничего не делает.
startBot().catch(err => console.error('Telegram-бот: не удалось запустить', err));

// Синхронизация записей с оригинальной админкой ZMS — тоже в этом процессе:
// раз в минуту тянет доску на сегодня/завтра и проталкивает очередь операций.
try { startRecordsSync(); } catch (err) { console.error('records sync: не удалось запустить', err); }
