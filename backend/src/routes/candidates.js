// Фид кандидатов: наполняется краулером, разбирается оператором на сайте.
// Пайплайн: crawler → POST /api/candidates → фид → approve (→ cars) | reject.

import { Router } from 'express';
import { query } from '../db/client.js';
import { upsertCar, validateCar, dedupKey } from '../cars/upsert.js';

const router = Router();

const CANDIDATE_FIELDS = [
  'brand', 'model', 'generation', 'engine_code', 'engine_volume',
  'year_from', 'year_to', 'kw', 'bhp', 'fuel_type', 'motul_name', 'engine_name',
  'fluid_capacities', 'filter_part_numbers', 'car_approvals',
];

function asJson(v, fallback) {
  return JSON.stringify(v ?? fallback);
}

// ── POST /api/candidates ──────────────────────────────────────────────────────
// Краулер кладёт черновик. Дубли гасятся дважды:
//   1) если такая машина уже есть в cars → skipped: exists_in_db
//   2) если такой кандидат уже предлагался (в т.ч. отклонён) → skipped: duplicate
router.post('/', async (req, res) => {
  const b = req.body || {};
  if (!b.brand || !b.model) return res.status(400).json({ error: 'brand and model are required' });

  const key = dedupKey(b);
  try {
    const inCars = await query(
      `SELECT 1 FROM cars
       WHERE lower(brand)=lower($1) AND lower(model)=lower($2)
         AND lower(coalesce(engine_code,''))=lower($3)
         AND coalesce(engine_volume,0)=$4 AND year_from=$5
       LIMIT 1`,
      [b.brand, b.model, b.engine_code ?? '', b.engine_volume ?? 0, b.year_from ?? 0],
    );
    if (inCars.rows.length) return res.json({ skipped: true, reason: 'exists_in_db' });

    const r = await query(
      `INSERT INTO car_candidates (
         brand, model, generation, engine_code, engine_volume,
         year_from, year_to, kw, bhp, fuel_type, motul_name, engine_name,
         fluid_capacities, filter_part_numbers, car_approvals,
         source, match_quality, dedup_key, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (dedup_key) DO NOTHING
       RETURNING id`,
      [
        b.brand, b.model, b.generation ?? null, b.engine_code ?? null, b.engine_volume ?? null,
        b.year_from ?? null, b.year_to ?? null, b.kw ?? null, b.bhp ?? null,
        b.fuel_type ?? null, b.motul_name ?? null, b.engine_name ?? null,
        asJson(b.fluid_capacities, {}), asJson(b.filter_part_numbers, {}), asJson(b.car_approvals, []),
        asJson(b.source, {}), b.match_quality ?? 'partial', key, b.created_by ?? 'crawler',
      ],
    );
    if (!r.rows.length) return res.json({ skipped: true, reason: 'duplicate' });
    res.status(201).json({ created: true, id: r.rows[0].id });
  } catch (err) {
    console.error('POST /api/candidates', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/candidates/known ────────────────────────────────────────────────
// Краулер шлёт список dedup_key → получает те, что уже известны (в cars или
// в кандидатах любого статуса). Позволяет не ходить в MANN за тем, что уже есть.
router.post('/known', async (req, res) => {
  const keys = Array.isArray(req.body?.keys) ? req.body.keys.filter(k => typeof k === 'string') : [];
  if (!keys.length) return res.json({ known: [] });
  try {
    const r = await query(
      `SELECT dedup_key FROM car_candidates WHERE dedup_key = ANY($1)`,
      [keys],
    );
    const known = new Set(r.rows.map(x => x.dedup_key));
    // Ключи машин уже в cars — собираем на лету по тем же компонентам.
    const carRows = await query(
      `SELECT lower(brand) b, lower(model) m, lower(coalesce(engine_code,'')) ec,
              coalesce(engine_volume,0) v, year_from y
       FROM cars`,
    );
    for (const c of carRows.rows) known.add([c.b, c.m, c.ec, Number(c.v), c.y].join('|'));
    res.json({ known: keys.filter(k => known.has(k)) });
  } catch (err) {
    console.error('POST /api/candidates/known', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/candidates/stats ─────────────────────────────────────────────────
router.get('/stats', async (_req, res) => {
  try {
    const r = await query(
      `SELECT status, count(*)::int AS n FROM car_candidates GROUP BY status`,
    );
    const stats = { pending: 0, approved: 0, rejected: 0 };
    for (const row of r.rows) stats[row.status] = row.n;
    res.json(stats);
  } catch (err) {
    console.error('GET /api/candidates/stats', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/candidates ───────────────────────────────────────────────────────
// Фид: ?status=pending&limit=50&offset=0. Отдаёт { data, total, limit, offset }.
router.get('/', async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '50')));
  const offset = Math.max(0, parseInt(req.query.offset || '0'));
  try {
    const [rows, total] = await Promise.all([
      query(
        `SELECT * FROM car_candidates WHERE status = $1
         ORDER BY created_at ASC LIMIT $2 OFFSET $3`,
        [status, limit, offset],
      ),
      query(`SELECT count(*)::int AS n FROM car_candidates WHERE status = $1`, [status]),
    ]);
    res.json({ data: rows.rows, total: total.rows[0].n, limit, offset });
  } catch (err) {
    console.error('GET /api/candidates', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/candidates/:id ───────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const r = await query('SELECT * FROM car_candidates WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('GET /api/candidates/:id', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/candidates/:id ─────────────────────────────────────────────────
// Оператор правит черновик перед аппрувом.
router.patch('/:id', async (req, res) => {
  const updates = Object.entries(req.body || {}).filter(([k]) => CANDIDATE_FIELDS.includes(k));
  if (!updates.length) return res.status(400).json({ error: 'no updatable fields provided' });
  try {
    const setClauses = [];
    const params = [];
    for (const [k, v] of updates) {
      params.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
      setClauses.push(`${k} = $${params.length}`);
    }
    params.push(req.params.id);
    const r = await query(
      `UPDATE car_candidates SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    if (!r.rows.length) return res.status(404).json({ error: 'not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('PATCH /api/candidates/:id', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/candidates/:id/approve ──────────────────────────────────────────
// Переносит кандидата (с правками из body, если есть) в cars через общий upsert.
router.post('/:id/approve', async (req, res) => {
  try {
    const existing = await query('SELECT * FROM car_candidates WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'not found' });

    // Правки из тела запроса имеют приоритет над сохранённым черновиком.
    const cand = existing.rows[0];
    const payload = { ...cand, ...(req.body || {}), created_by: req.body?.created_by || 'feed-approve' };

    const err = validateCar(payload, { requireFilters: true });
    if (err) return res.status(400).json({ error: err });

    const car = await upsertCar(payload);
    await query(
      `UPDATE car_candidates SET status='approved', reviewed_at=now(),
              reviewed_by=$2, approved_car_id=$3 WHERE id=$1`,
      [req.params.id, req.body?.reviewed_by ?? null, car.id],
    );
    res.status(car.created ? 201 : 200).json(car);
  } catch (err) {
    console.error('POST /api/candidates/:id/approve', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/candidates/:id/reject ───────────────────────────────────────────
// Мягкое удаление: строка остаётся (по dedup_key), чтобы краулер не предлагал
// эту машину заново. Из фида исчезает.
router.post('/:id/reject', async (req, res) => {
  try {
    const r = await query(
      `UPDATE car_candidates SET status='rejected', reviewed_at=now(), reviewed_by=$2
       WHERE id=$1 RETURNING id`,
      [req.params.id, req.body?.reviewed_by ?? null],
    );
    if (!r.rows.length) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/candidates/:id/reject', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
