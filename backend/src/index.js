import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import carsRouter from './routes/cars.js';
import candidatesRouter from './routes/candidates.js';

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
app.use('/api/cars', carsRouter);
app.use('/api/candidates', candidatesRouter);

app.get('/health', (_req, res) => res.json({ ok: true }));

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3001');
app.listen(PORT, '0.0.0.0', () => console.log(`cars-db backend listening on :${PORT}`));
