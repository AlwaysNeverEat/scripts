# Tampermonkey Scripts + Oil Calculator Cars DB

## Userscripts (root)

| File | Purpose |
|------|---------|
| `Mann + Motul Oil Calculator-*.user.js` | Legacy version (kept for reference) |
| `userscript/calculator.user.js` | **Current version** (v3.0) — with Cars DB integration |
| Others | CRM helpers, price lookup scripts |

---

# Cars DB Ecosystem

Three components sharing a PostgreSQL database of car specs (capacities, filter part numbers):

| Component | Path | Purpose |
|-----------|------|---------|
| Userscript | `/userscript/` | Tampermonkey — Save to DB + auto-match banner |
| Backend | `/backend/` | Node.js + Express REST API |
| Frontend | `/frontend/` | Standalone search + full calculator site |
| Shared | `/shared/` | Pure JS modules used by frontend |
| DB | `/db/migrations/` | PostgreSQL schema + migrations |

---

## Quick start (Docker)

```bash
docker compose up --build

# Frontend → http://localhost:5173
# Backend  → http://localhost:3001
# Postgres → localhost:5432
```

The Postgres container runs `db/migrations/001_init.sql` on first boot.

---

## Backend setup (manual)

```bash
cd backend
cp .env.example .env          # fill DATABASE_URL, API_KEY, CORS_ORIGINS
npm install
npm run dev
```

| Env var | Description |
|---------|-------------|
| `DATABASE_URL` | PostgreSQL URI |
| `API_KEY` | Shared secret — must match `x-api-key` in all clients |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `PORT` | Default `3001` |

---

## Frontend setup (manual)

```bash
cd frontend
cp .env.example .env          # set VITE_API_KEY; leave VITE_API_BASE empty for local dev
npm install
npm run dev                   # http://localhost:5173
npm run build                 # → dist/
```

In dev, Vite proxies `/api/*` to `http://localhost:3001` automatically.

---

## Userscript setup

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Create a new script from `userscript/calculator.user.js`.
3. Edit the two constants at the top:
   ```js
   const API_BASE   = 'https://your-backend.railway.app';
   const DB_API_KEY = 'your-api-key';
   ```
4. Add your backend hostname to the `@connect` directives.

**Auto-match:** On any supported page, the script calls `GET /api/cars/match`. A green banner appears if the car is in the DB. Accepting skips the Motul lookup.

**Save to DB:** Click "📥 В базу данных" → fill the modal → requires all three filter part numbers (or mark absent).

**Refresh from Mann:** Click "↻ обновить из Mann" to re-run the live lookup and update the DB record.

---

## Deploy — Supabase + Railway + Vercel

### 1. Supabase (Postgres)
- Create project → SQL Editor → paste `db/migrations/001_init.sql` → Run.
- Copy **Settings → Database → Connection string (URI)**.

### 2. Railway (Backend)
- New project → Deploy from GitHub → Root directory: `backend`.
- Env vars: `DATABASE_URL`, `API_KEY` (random string), `CORS_ORIGINS` (Vercel URL).
- Note the public URL.

### 3. Vercel (Frontend)
- New project → Root directory: `frontend`.
- Env vars: `VITE_API_BASE` (Railway URL), `VITE_API_KEY`.

### 4. Update userscript constants with Railway URL + API_KEY.

---

## Self-host via Cloudflare Tunnel

```bash
# Run locally
docker compose up -d

# Install cloudflared, then:
cloudflared tunnel login
cloudflared tunnel create carsdb

# ~/.cloudflared/config.yml:
# tunnel: <id>
# credentials-file: ...
# ingress:
#   - hostname: api.yourdomain.com
#     service: http://localhost:3001
#   - hostname: cars.yourdomain.com
#     service: http://localhost:5173
#   - service: http_status:404

cloudflared tunnel run carsdb
```

---

## API reference

All endpoints require `x-api-key: <API_KEY>` header.

| Method | Path | Description |
|--------|------|-------------|
| `GET`   | `/health` | Liveness (no auth) |
| `POST`  | `/api/cars` | Create car record |
| `GET`   | `/api/cars/match?engine_code=&brand=&model=&year=&volume=` | Best match |
| `GET`   | `/api/cars/search?q=` | Free-text search (top 20) |
| `GET`   | `/api/cars/:id` | Full record |
| `GET`   | `/api/cars?page=&limit=` | Paginated list |
| `PATCH` | `/api/cars/:id` | Edit record |

### filter_part_numbers shape

```json
{
  "vf": { "part": "W7023",  "absent": false },
  "mf": { "part": "C2695",  "absent": false },
  "sf": { "part": null,      "absent": true  }
}
```

Every key must be present. `absent: true` OR non-empty `part`. Otherwise → HTTP 400.

---

## Repo structure

```
scripts/
├── userscript/calculator.user.js  ← Tampermonkey v3.0
├── backend/
│   ├── src/{index,db/client,routes/cars,search/translit}.js
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/{main,calculator,style.css}
│   ├── index.html / Dockerfile / nginx.conf
│   └── package.json
├── shared/
│   ├── oils.js        ← shop oil data + Motul approvals
│   ├── calculator.js  ← oil picking, cost calc
│   └── report.js      ← buildReport() — identical output everywhere
├── db/migrations/001_init.sql
├── docker-compose.yml
└── README.md
```
