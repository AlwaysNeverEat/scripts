import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import carsRouter from './routes/cars.js';
import authRouter from './routes/auth.js';
import profileRouter from './routes/profile.js';
import topRouter from './routes/top.js';
import usersRouter from './routes/users.js';
import adminRouter from './routes/admin.js';
import crmRouter from './routes/crm.js';
import recordsRouter from './routes/records.js';
import wordleRouter from './routes/wordle.js';
import kontekstRouter from './routes/kontekst.js';
import minesweeperRouter from './routes/minesweeper.js';
import tetrisRouter from './routes/tetris.js';
import troikaRouter from './routes/troika.js';
import solitaireRouter from './routes/solitaire.js';
import poolRouter from './routes/pool.js';
import durakRouter from './routes/durak.js';
import facultyRouter from './routes/faculty.js';
import { requireSession, optionalSession } from './auth/middleware.js';
import { avatarDir } from './storage/avatarStorage.js';
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
  // Каждый запрос к /api несёт x-api-key (а залогиненный ещё и Authorization),
  // а любой нестандартный заголовок заставляет браузер сначала отдельно
  // спросить разрешение — preflight'ом OPTIONS. Без Access-Control-Max-Age
  // браузер помнит этот ответ всего ~5 секунд, то есть при опросе раздела
  // «Записи» (тики на 10/15/30/45 с) preflight повторяется перед КАЖДЫМ
  // запросом: две ходки через Cloudflare до Render вместо одной, и вдвое
  // больше шансов словить обрыв. Сутки — потолок Firefox, Chrome сам обрежет
  // до своих двух часов.
  maxAge: 86_400,
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
// Админка (заявки на регистрацию) — requireSession здесь, requireRole внутри
// роутера: без личности проверять роль нечем.
app.use('/api/admin', requireSession, adminRouter);
app.use('/api/crm', requireSession, crmRouter);
// Распределяющая шляпа: тест на факультет. Строго именной — и прогресс, и
// результат привязаны к аккаунту, а пройти его можно один раз (routes/faculty.js).
app.use('/api/faculty', requireSession, facultyRouter);
// Пасхалки «Вордле» и «Контекстно» — слово дня считается от id аккаунта, без
// сессии его и загадать не для кого (см. routes/wordle.js, routes/kontekst.js).
app.use('/api/wordle', requireSession, wordleRouter);
app.use('/api/kontekst', requireSession, kontekstRouter);
// Сапёр — партия и мини-топ привязаны к аккаунту (см. routes/minesweeper.js).
app.use('/api/minesweeper', requireSession, minesweeperRouter);
// Тетрис — партия целиком в браузере, серверу остаётся мини-топ, и он именной:
// без сессии рекорд не к кому привязать (см. routes/tetris.js).
app.use('/api/tetris', requireSession, tetrisRouter);
// Тройка (матч-3 на время) — там же и по той же причине, что тетрис: партия в
// браузере, серверу остаётся именной мини-топ (см. routes/troika.js).
app.use('/api/troika', requireSession, troikaRouter);
// Пасьянс — там же и по той же причине, только топ у него по времени
// разложенной партии (см. routes/solitaire.js).
app.use('/api/solitaire', requireSession, solitaireRouter);
// Бильярд — единственная пасхалка, где сервер ВЕДЁТ партию, а не принимает
// результат: игра парная, и очко, приписанное себе, отнято у живого человека
// (см. routes/pool.js). Сессия тут нужна вдвойне — партия именная с обеих сторон.
app.use('/api/pool', requireSession, poolRouter);
// Дурак — как бильярд, партию ведёт сервер, но по другой причине: в карты играют
// ЗАКРЫТЫМИ, и клиенту уезжает не позиция, а его вид на неё (см. routes/durak.js).
app.use('/api/durak', requireSession, durakRouter);
// Записи (клон админки ZMS) — сознательно БЕЗ requireSession: доступ общий,
// гейт — сами логин/пароль оригинальной админки (см. routes/records.js).
// optionalSession не гейт, а «кто это»: залогиненному операции подписываются
// его аккаунтом и идут в месячный топ, гость работает как раньше.
app.use('/api/records', optionalSession, recordsRouter);

// Аватарки с локального диска (свой сервер, см. DEPLOY-VPS.md). Вне /api —
// картинку тянет тег <img> обычного браузера, без x-api-key и без сессии, ровно
// как раньше тянул публичный бакет Supabase.
//
// Отдаёт их Node, а не nginx: файлы мелкие, людей десятки, зато не нужно
// расшаривать том между контейнерами. Кэш-заголовки оставляем как есть —
// express.static шлёт ETag и Last-Modified, браузер получает 304. Это важно
// именно здесь: путь детерминированный ({userId}-cropped.jpg), и при смене
// фото URL не меняется, так что «закэшировать навсегда» нельзя.
const avatarsDir = avatarDir();
if (avatarsDir) app.use('/avatars', express.static(avatarsDir));

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
