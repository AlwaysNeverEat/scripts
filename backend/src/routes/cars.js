import { Router } from 'express';
import { query } from '../db/client.js';
import { normalize, expandQuery, buildNameFields } from '../search/translit.js';

const router = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function validateFilters(fpn) {
  if (!fpn || typeof fpn !== 'object') return 'filter_part_numbers must be an object';
  for (const key of ['vf', 'mf', 'sf']) {
    const entry = fpn[key];
    if (!entry || typeof entry !== 'object') return `filter_part_numbers.${key} is missing`;
    if (entry.absent !== true && (!entry.part || typeof entry.part !== 'string' || !entry.part.trim())) {
      return `filter_part_numbers.${key}: provide a part number or set absent:true`;
    }
  }
  return null;
}

function buildSearchVectorSql(synonymTokens) {
  // Build a tsvector from all synonym variants using Russian+simple dictionaries
  const tokens = synonymTokens
    .flatMap(s => s.split(/\s+/))
    .filter(Boolean)
    .map(t => t.replace(/'/g, "''"));
  return tokens.length
    ? `to_tsvector('simple', '${tokens.join(' ')}')`
    : `to_tsvector('simple', '')`;
}

async function upsertSearchFields(carRow) {
  const { brand, model, generation, engine_code, engine_volume, year_from, year_to } = carRow;
  const { nameNormalized, nameCyrillic, nameTranslit, synonymTokens } =
    buildNameFields(brand, model, generation, engine_code, engine_volume, year_from, year_to);
  const svSql = buildSearchVectorSql(synonymTokens);
  return { nameNormalized, nameCyrillic, nameTranslit, svSql };
}

// ── POST /api/cars ────────────────────────────────────────────────────────────
// Upsert: conflict on (brand, model, engine_code, engine_volume, year_from).
// Returns { ...car, created: true } on insert, { ...car, created: false } on update.

router.post('/', async (req, res) => {
  const {
    brand, model, generation, engine_code, engine_volume,
    year_from, year_to, kw, bhp, fuel_type, motul_name, engine_name,
    fluid_capacities, filter_part_numbers,
    car_approvals, recommended_oils,
    service_flags, notes, oil_overrides,
    created_by,
  } = req.body;

  if (!brand || !model) return res.status(400).json({ error: 'brand and model are required' });
  if (!year_from) return res.status(400).json({ error: 'year_from is required' });

  const filterErr = validateFilters(filter_part_numbers);
  if (filterErr) return res.status(400).json({ error: filterErr });

  if (car_approvals !== undefined && !Array.isArray(car_approvals))
    return res.status(400).json({ error: 'car_approvals must be an array' });
  if (recommended_oils !== undefined && !Array.isArray(recommended_oils))
    return res.status(400).json({ error: 'recommended_oils must be an array' });
  if (service_flags !== undefined && (typeof service_flags !== 'object' || Array.isArray(service_flags) || service_flags === null))
    return res.status(400).json({ error: 'service_flags must be an object' });
  if (oil_overrides !== undefined && (typeof oil_overrides !== 'object' || Array.isArray(oil_overrides) || oil_overrides === null))
    return res.status(400).json({ error: 'oil_overrides must be an object' });
  if (notes !== undefined && notes !== null && typeof notes !== 'string')
    return res.status(400).json({ error: 'notes must be a string' });

  try {
    const { nameNormalized, nameCyrillic, nameTranslit, svSql } =
      await upsertSearchFields({ brand, model, generation, engine_code, engine_volume, year_from, year_to });

    const result = await query(
      `INSERT INTO cars (
         brand, model, generation, engine_code, engine_volume,
         year_from, year_to, kw, bhp, fuel_type, motul_name, engine_name,
         fluid_capacities, filter_part_numbers, car_approvals, recommended_oils,
         service_flags, notes, oil_overrides,
         name_normalized, name_cyrillic, name_translit, search_vector,
         created_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
         $17,$18,$19,$20,$21,$22,${svSql},$23
       )
       ON CONFLICT (lower(brand), lower(model), lower(coalesce(engine_code,'')), coalesce(engine_volume,0), year_from)
       DO UPDATE SET
         generation          = EXCLUDED.generation,
         year_to             = EXCLUDED.year_to,
         kw                  = EXCLUDED.kw,
         bhp                 = EXCLUDED.bhp,
         fuel_type           = EXCLUDED.fuel_type,
         motul_name          = EXCLUDED.motul_name,
         engine_name         = EXCLUDED.engine_name,
         fluid_capacities    = EXCLUDED.fluid_capacities,
         filter_part_numbers = EXCLUDED.filter_part_numbers,
         car_approvals       = EXCLUDED.car_approvals,
         recommended_oils    = EXCLUDED.recommended_oils,
         service_flags       = EXCLUDED.service_flags,
         notes               = EXCLUDED.notes,
         oil_overrides       = EXCLUDED.oil_overrides,
         name_normalized     = EXCLUDED.name_normalized,
         name_cyrillic       = EXCLUDED.name_cyrillic,
         name_translit       = EXCLUDED.name_translit,
         search_vector       = EXCLUDED.search_vector,
         updated_at          = now()
       RETURNING *, (xmax = 0) AS inserted`,
      [
        brand, model, generation ?? null, engine_code ?? null, engine_volume ?? null,
        year_from, year_to ?? null, kw ?? null, bhp ?? null,
        fuel_type ?? null, motul_name ?? null, engine_name ?? null,
        JSON.stringify(fluid_capacities ?? {}),
        JSON.stringify(filter_part_numbers),
        JSON.stringify(car_approvals ?? []),
        JSON.stringify(recommended_oils ?? []),
        JSON.stringify(service_flags ?? {}),
        notes ?? null,
        JSON.stringify(oil_overrides ?? {}),
        nameNormalized, nameCyrillic, nameTranslit,
        created_by ?? null,
      ],
    );

    const row = result.rows[0];
    const created = row.inserted === true || row.inserted === 't';
    res.status(created ? 201 : 200).json({ ...row, created });
  } catch (err) {
    console.error('POST /api/cars', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/cars/match ───────────────────────────────────────────────────────
// Query params: engine_code, brand, model, year, volume
// Returns the single best-matching car or 404.

router.get('/match', async (req, res) => {
  const { engine_code, brand, model, year, volume } = req.query;

  try {
    // Priority 1: exact engine_code match
    if (engine_code && engine_code.trim()) {
      const r = await query(
        `SELECT * FROM cars
         WHERE lower(engine_code) = lower($1)
         ORDER BY year_from DESC LIMIT 1`,
        [engine_code.trim()],
      );
      if (r.rows.length) return res.json(r.rows[0]);
    }

    // Priority 2: brand + model + year in range (+ optional volume)
    if (brand && model) {
      const yr = parseInt(year) || null;
      const vol = parseFloat(volume) || null;
      const params = [normalize(brand), normalize(model)];
      let sql = `
        SELECT *, (
          CASE WHEN lower(brand) = $1 THEN 2 ELSE 0 END +
          CASE WHEN lower(model) = $2 THEN 2 ELSE 0 END
        ) AS match_score
        FROM cars
        WHERE lower(brand) % $1 AND lower(model) % $2
      `;
      if (yr) {
        params.push(yr);
        sql += ` AND $${params.length} BETWEEN year_from AND COALESCE(year_to, 9999)`;
      }
      if (vol) {
        params.push(vol);
        sql += ` AND (engine_volume IS NULL OR ABS(engine_volume - $${params.length}) < 0.2)`;
      }
      sql += ' ORDER BY match_score DESC, year_from DESC LIMIT 1';
      const r = await query(sql, params);
      if (r.rows.length) return res.json(r.rows[0]);
    }

    res.status(404).json({ error: 'not found' });
  } catch (err) {
    console.error('GET /api/cars/match', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/cars/search?q= ───────────────────────────────────────────────────

router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);

  try {
    const variants = expandQuery(q);

    // Extract numeric tokens (year, volume) from the query
    const nums = q.match(/\b(\d{4}|\d\.\d)\b/g) || [];
    const yearNum = nums.find(n => n.length === 4 && parseInt(n) > 1960) || null;
    const volNum  = nums.find(n => n.includes('.')) || null;

    // Combined trigram similarity over all variants:
    //  - similarity() по всей строке — «полные» запросы
    //  - word_similarity() — короткие/неполные запросы и опечатки
    //    («фокус» против «ford focus 1.6 2017» даёт высокий word_similarity)
    const simExprs  = variants.map((_, i) => `similarity(name_normalized, $${i + 1})`);
    const wsimExprs = variants.map((_, i) => `word_similarity($${i + 1}, name_normalized)`);
    const maxSim  = `GREATEST(${simExprs.join(', ')})`;
    const maxWsim = `GREATEST(${wsimExprs.join(', ')})`;
    const params = [...variants];

    // Префиксный tsquery: внутри варианта слова через & (все должны найтись),
    // варианты через | . «фор фок» → (фор:* & фок:*) | (for:* & fok:*) …
    const sanitizeWord = (w) => w.replace(/[^a-zа-яё0-9.]/gi, '');
    const tsQuery = [...new Set(variants.map(v =>
      v.split(/\s+/).map(sanitizeWord).filter(w => w.length > 1)
        .map(w => `${w}:*`).join(' & '),
    ).filter(Boolean))].join(' | ');
    params.push(tsQuery || 'zzz_none:*');
    const tsIdx = params.length;

    // Модельный бонус: каждое слово запроса сравнивается с моделью отдельно.
    // Различает «фокс» → FOCUS от других машин того же бренда (бренд «ford»
    // есть у всех и глушит триграммный сигнал по полной строке).
    const queryWords = [...new Set(variants.flatMap(v => v.split(/\s+/)))]
      .filter(w => w.length >= 3 && !/^\d/.test(w))
      .slice(0, 12);
    let modelSim = '0';
    if (queryWords.length) {
      const exprs = queryWords.map(w => {
        params.push(w);
        return `similarity(lower(model), $${params.length})`;
      });
      modelSim = `GREATEST(${exprs.join(', ')})`;
    }

    // Year / volume boost
    let yearBoost = '0';
    if (yearNum) {
      params.push(parseInt(yearNum));
      yearBoost = `CASE WHEN $${params.length} BETWEEN year_from AND COALESCE(year_to, 9999) THEN 0.3 ELSE 0 END`;
    }
    let volBoost = '0';
    if (volNum) {
      params.push(parseFloat(volNum));
      volBoost = `CASE WHEN ABS(engine_volume - $${params.length}) < 0.15 THEN 0.2 ELSE 0 END`;
    }

    const sql = `
      SELECT *,
        (${maxSim} * 0.3
         + ${maxWsim} * 0.3
         + ${modelSim} * 0.25
         + COALESCE(ts_rank(search_vector, to_tsquery('simple', $${tsIdx})), 0) * 0.25
         + ${yearBoost} + ${volBoost}
        ) AS score
      FROM cars
      WHERE
        search_vector @@ to_tsquery('simple', $${tsIdx})
        OR ${simExprs.map((_, i) => `name_normalized % $${i + 1}`).join(' OR ')}
        OR ${maxWsim} >= 0.35
        OR name_normalized ILIKE '%' || $1 || '%'
      ORDER BY score DESC
      LIMIT 20
    `;

    const r = await query(sql, params);
    res.json(r.rows);
  } catch (err) {
    console.error('GET /api/cars/search', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/cars/random?limit=50 ─────────────────────────────────────────────
// Случайные машины для словесной сферы на странице поиска.

router.get('/random', async (req, res) => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '50')));
  try {
    const r = await query(
      'SELECT id, brand, model, generation FROM cars ORDER BY random() LIMIT $1',
      [limit],
    );
    res.json(r.rows);
  } catch (err) {
    console.error('GET /api/cars/random', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/cars/:id ─────────────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const r = await query('SELECT * FROM cars WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('GET /api/cars/:id', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/cars ─────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page  || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50')));
  const offset = (page - 1) * limit;

  try {
    const [rows, total] = await Promise.all([
      query('SELECT * FROM cars ORDER BY brand, model, year_from LIMIT $1 OFFSET $2', [limit, offset]),
      query('SELECT count(*)::int AS n FROM cars'),
    ]);
    res.json({ data: rows.rows, total: total.rows[0].n, page, limit });
  } catch (err) {
    console.error('GET /api/cars', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/cars/:id ───────────────────────────────────────────────────────

router.patch('/:id', async (req, res) => {
  const allowed = [
    'brand','model','generation','engine_code','engine_volume',
    'year_from','year_to','kw','bhp','fuel_type','motul_name','engine_name',
    'fluid_capacities','filter_part_numbers','car_approvals','recommended_oils',
    'service_flags','notes','oil_overrides',
  ];

  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k)),
  );

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'no updatable fields provided' });
  }

  if (updates.filter_part_numbers) {
    const err = validateFilters(updates.filter_part_numbers);
    if (err) return res.status(400).json({ error: err });
  }

  try {
    // Fetch current row so we can rebuild search fields with merged values
    const existing = await query('SELECT * FROM cars WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'not found' });

    const merged = { ...existing.rows[0], ...updates };
    const { nameNormalized, nameCyrillic, nameTranslit, svSql } = await upsertSearchFields(merged);

    const setClauses = [];
    const params = [];

    for (const [k, v] of Object.entries(updates)) {
      params.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
      setClauses.push(`${k} = $${params.length}`);
    }

    params.push(nameNormalized, nameCyrillic, nameTranslit);
    setClauses.push(
      `name_normalized = $${params.length - 2}`,
      `name_cyrillic = $${params.length - 1}`,
      `name_translit = $${params.length}`,
      `search_vector = ${svSql}`,
    );

    params.push(req.params.id);
    const sql = `UPDATE cars SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`;

    const r = await query(sql, params);
    res.json(r.rows[0]);
  } catch (err) {
    console.error('PATCH /api/cars/:id', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
