import { Router } from 'express';
import pool, { query } from '../db/client.js';
import { normalize, expandQuery, buildNameFields } from '../../../shared/translit.js';
import { canonCar } from '../../../shared/carCanon.js';
import { requireRole } from '../auth/middleware.js';
import { syncAchievementsSafe } from '../achievements/achievements.js';

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

function validateSourceLinks(links) {
  if (links === undefined) return null;
  if (typeof links !== 'object' || links === null || Array.isArray(links))
    return 'source_links must be an object';
  for (const [site, url] of Object.entries(links)) {
    if (url !== null && typeof url !== 'string')
      return `source_links.${site} must be a string`;
  }
  return null;
}

function validateSourceKeys(keys) {
  if (keys === undefined) return null;
  if (!Array.isArray(keys)) return 'source_keys must be an array';
  if (keys.some(k => typeof k !== 'string')) return 'source_keys must be strings';
  return null;
}

function validateTags(tags) {
  if (tags === undefined) return null;
  if (!Array.isArray(tags)) return 'tags must be an array';
  if (tags.some(t => typeof t !== 'string')) return 'tags must be strings';
  return null;
}

// Фид событий машины (car_events, Фаза 4) — пишется здесь же, при POST
// (только на реальную вставку) и PATCH. changed_fields: { field: {from,to} },
// переваривает любое число полей без переписывания при их росте.

async function recordCarEvent({ carId, userId, type, comment, changedFields }) {
  await query(
    `INSERT INTO car_events (car_id, user_id, type, comment, changed_fields)
     VALUES ($1, $2, $3, $4, $5)`,
    [carId, userId ?? null, type, comment ?? null, JSON.stringify(changedFields ?? {})],
  );
}

// engine_volume — numeric(4,1) в БД; узел pg возвращает numeric строкой (не
// парсит во float, чтобы не терять точность), а с фронта приходит число —
// без нормализации это давало бы ложное "изменение" 1.6 → 1.6 на каждой правке.
const NUMERIC_COLUMNS = new Set(['engine_volume']);

// jsonb-колонки (source_links, filter_part_numbers, …) Postgres возвращает со
// своим порядком ключей (jsonb сортирует их по длине, затем побайтово), а с
// фронта объект приходит в порядке заполнения формы — обычный JSON.stringify
// при идентичном содержимом давал ложное "изменение" в фиде.
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const body = Object.keys(value)
    .sort()
    .map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
    .join(',');
  return `{${body}}`;
}

function diffChangedFields(existing, updates) {
  const diff = {};
  for (const [key, next] of Object.entries(updates)) {
    let before = existing[key] ?? null;
    let after = next ?? null;
    if (NUMERIC_COLUMNS.has(key)) {
      before = before === null ? null : Number(before);
      after = after === null ? null : Number(after);
    }
    if (stableStringify(before) !== stableStringify(after)) {
      diff[key] = { from: before, to: after };
    }
  }
  return diff;
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
  const { brand, model, generation, engine_code, engine_volume, year_from, year_to, tags } = carRow;
  const { nameNormalized, nameCyrillic, nameTranslit, synonymTokens } =
    buildNameFields(brand, model, generation, engine_code, engine_volume, year_from, year_to);

  // Теги — свободные слова, по которым машину должно находить обычным поиском.
  // Кладём их и в search_vector (точный/префиксный матч по слову), и в
  // name_normalized (триграммная похожесть → терпит опечатки). Каждый тег
  // прогоняем через expandQuery, чтобы находился и в кириллице, и в транслите.
  const tagList = Array.isArray(tags) ? tags.map(t => normalize(t)).filter(Boolean) : [];
  const tagTokens = tagList.flatMap(t => expandQuery(t));

  const nameWithTags = tagList.length ? `${nameNormalized} ${tagList.join(' ')}` : nameNormalized;
  const svSql = buildSearchVectorSql([...synonymTokens, ...tagTokens]);
  return { nameNormalized: nameWithTags, nameCyrillic, nameTranslit, svSql };
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
    source_links, source_keys, tags,
  } = req.body;
  // created_by — всегда залогиненный юзер из сессии, а не то, что прислал
  // клиент (иначе кто угодно мог бы подписать машину чужим именем).
  const createdBy = req.user.display_name;

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
  const sourceLinksErr = validateSourceLinks(source_links);
  if (sourceLinksErr) return res.status(400).json({ error: sourceLinksErr });
  const sourceKeysErr = validateSourceKeys(source_keys);
  if (sourceKeysErr) return res.status(400).json({ error: sourceKeysErr });
  const tagsErr = validateTags(tags);
  if (tagsErr) return res.status(400).json({ error: tagsErr });

  // Каноническое написание марки/модели (shared/carCanon.js): «VW» →
  // «Volkswagen», «GWM HAVAL» → «Haval», Ford «Focus Mk II» → «Focus» +
  // поколение. Иначе руками заводятся дубли, которые уже склеивали
  // merge-duplicates.js.
  const ident = canonCar({ brand, model, generation });

  try {
    const { nameNormalized, nameCyrillic, nameTranslit, svSql } =
      await upsertSearchFields({ brand: ident.brand, model: ident.model, generation: ident.generation, engine_code, engine_volume, year_from, year_to, tags });

    const result = await query(
      `INSERT INTO cars (
         brand, model, generation, engine_code, engine_volume,
         year_from, year_to, kw, bhp, fuel_type, motul_name, engine_name,
         fluid_capacities, filter_part_numbers, car_approvals, recommended_oils,
         service_flags, notes, oil_overrides, source_links, source_keys, tags,
         name_normalized, name_cyrillic, name_translit, search_vector,
         created_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
         $17,$18,$19,$20,$21,$22,$23,$24,$25,${svSql},$26
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
         source_links        = EXCLUDED.source_links,
         source_keys         = EXCLUDED.source_keys,
         tags                = EXCLUDED.tags,
         name_normalized     = EXCLUDED.name_normalized,
         name_cyrillic       = EXCLUDED.name_cyrillic,
         name_translit       = EXCLUDED.name_translit,
         search_vector       = EXCLUDED.search_vector,
         updated_at          = now()
       RETURNING *, (xmax = 0) AS inserted`,
      [
        ident.brand, ident.model, ident.generation ?? null, engine_code ?? null, engine_volume ?? null,
        year_from, year_to ?? null, kw ?? null, bhp ?? null,
        fuel_type ?? null, motul_name ?? null, engine_name ?? null,
        JSON.stringify(fluid_capacities ?? {}),
        JSON.stringify(filter_part_numbers),
        JSON.stringify(car_approvals ?? []),
        JSON.stringify(recommended_oils ?? []),
        JSON.stringify(service_flags ?? {}),
        notes ?? null,
        JSON.stringify(oil_overrides ?? {}),
        JSON.stringify(source_links ?? {}),
        JSON.stringify(source_keys ?? []),
        JSON.stringify(tags ?? []),
        nameNormalized, nameCyrillic, nameTranslit,
        createdBy,
      ],
    );

    const row = result.rows[0];
    const created = row.inserted === true || row.inserted === 't';
    if (created) {
      await recordCarEvent({ carId: row.id, userId: req.user.id, type: 'added' });
      await syncAchievementsSafe(req.user.id);
    }
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
  const { engine_code, brand, model, year, volume, source_key } = req.query;

  try {
    // Priority 0: точное совпадение по сигнатуре сурс-ссылки (mann:type:…,
    // lynx:…, ravenol:…). Самый надёжный матч — это ровно та же страница
    // машины на сайте подбора, откуда её считали. См. shared/sourceLinks.js.
    if (source_key && source_key.trim()) {
      const r = await query(
        `SELECT * FROM cars WHERE source_keys ? $1 ORDER BY updated_at DESC LIMIT 1`,
        [source_key.trim()],
      );
      if (r.rows.length) return res.json(r.rows[0]);
    }

    // Priority 1: exact engine_code match.
    // Коды бывают неуникальными («Zetec» стоит у половины Ford), поэтому при
    // нескольких совпадениях ранжируем по марке, году и объёму из запроса.
    if (engine_code && engine_code.trim()) {
      const params = [engine_code.trim()];
      let brandScore = '0', yearScore = '0', volScore = '0';
      if (brand && brand.trim()) {
        params.push(normalize(brand));
        brandScore = `CASE WHEN lower(brand) = $${params.length} THEN 4
                           WHEN lower(brand) % $${params.length} THEN 2 ELSE 0 END`;
      }
      const yr = parseInt(year) || null;
      if (yr) {
        params.push(yr);
        yearScore = `CASE WHEN $${params.length} BETWEEN year_from AND COALESCE(year_to, 9999) THEN 2 ELSE 0 END`;
      }
      const vol = parseFloat(volume) || null;
      if (vol) {
        params.push(vol);
        volScore = `CASE WHEN engine_volume IS NOT NULL AND ABS(engine_volume - $${params.length}) < 0.2 THEN 1 ELSE 0 END`;
      }
      const r = await query(
        `SELECT *, (${brandScore} + ${yearScore} + ${volScore}) AS match_score
         FROM cars
         WHERE lower(engine_code) = lower($1)
         ORDER BY match_score DESC, year_from DESC LIMIT 1`,
        params,
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

// ── GET /api/cars/owners ──────────────────────────────────────────────────────
// Все машины базы с текущим «ответственным» (владельцем 'added'-события) —
// для модалки массового назначения машин на странице пользователя. Только
// mod/admin. Владелец берётся LATERAL-подзапросом: у машины не больше одного
// 'added', но машины из эпохи до фида не имеют его вовсе (owner = null).

router.get('/owners', requireRole('mod', 'admin'), async (_req, res) => {
  try {
    const r = await query(
      `SELECT c.id, c.brand, c.model, c.generation, c.engine_code,
              c.engine_volume, c.year_from, c.year_to,
              u.id AS owner_id, u.display_name AS owner_name
         FROM cars c
         LEFT JOIN LATERAL (
           SELECT user_id FROM car_events
            WHERE car_id = c.id AND type = 'added'
            ORDER BY created_at ASC LIMIT 1
         ) ae ON true
         LEFT JOIN users u ON u.id = ae.user_id
        ORDER BY c.brand, c.model, c.year_from`,
    );
    res.json(r.rows.map(row => ({
      id: row.id,
      brand: row.brand,
      model: row.model,
      generation: row.generation,
      engine_code: row.engine_code,
      engine_volume: row.engine_volume,
      year_from: row.year_from,
      year_to: row.year_to,
      owner: row.owner_id ? { id: row.owner_id, display_name: row.owner_name } : null,
    })));
  } catch (err) {
    console.error('GET /api/cars/owners', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/cars/tags/brands ─────────────────────────────────────────────────
// Каскадные выпадашки режима «Теги»: марка → модель → объём.

router.get('/tags/brands', async (_req, res) => {
  try {
    const r = await query(
      `SELECT brand, count(*)::int AS count FROM cars GROUP BY brand ORDER BY brand`,
    );
    res.json(r.rows);
  } catch (err) {
    console.error('GET /api/cars/tags/brands', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/cars/tags/models?brand= ──────────────────────────────────────────
// year_to = NULL, если хотя бы одно поколение модели ещё в производстве —
// диапазон модели тогда «открытый», а не обрезанный по самому старому поколению.

router.get('/tags/models', async (req, res) => {
  const brand = (req.query.brand || '').trim();
  if (!brand) return res.status(400).json({ error: 'brand is required' });
  try {
    const r = await query(
      `SELECT model,
              min(year_from) AS year_from,
              CASE WHEN bool_or(year_to IS NULL) THEN NULL ELSE max(year_to) END AS year_to,
              count(*)::int AS count
         FROM cars
        WHERE lower(brand) = lower($1)
        GROUP BY model
        ORDER BY model`,
      [brand],
    );
    res.json(r.rows);
  } catch (err) {
    console.error('GET /api/cars/tags/models', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/cars/tags/volumes?brand=&model= ──────────────────────────────────
// Коды двигателей идут прямо в выпадашке объёма — не отдельным шагом.

router.get('/tags/volumes', async (req, res) => {
  const brand = (req.query.brand || '').trim();
  const model = (req.query.model || '').trim();
  if (!brand || !model) return res.status(400).json({ error: 'brand and model are required' });
  try {
    const r = await query(
      `SELECT engine_volume,
              coalesce(array_agg(DISTINCT engine_code) FILTER (WHERE engine_code IS NOT NULL), '{}') AS engine_codes,
              count(*)::int AS count
         FROM cars
        WHERE lower(brand) = lower($1) AND lower(model) = lower($2)
        GROUP BY engine_volume
        ORDER BY engine_volume NULLS LAST`,
      [brand, model],
    );
    res.json(r.rows);
  } catch (err) {
    console.error('GET /api/cars/tags/volumes', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/cars/tags/results?brand=&model=&volume=&limit= ──────────────────
// Все параметры опциональны — прогрессивная фильтрация по мере выбора тегов.
// volume='__null__' — отдельный маркер для «без указанного объёма» (engine_volume IS NULL),
// т.к. пустая строка уже означает «объём не выбран».
// total — точное число совпадений (для решения «спрятать сферу» на фронте),
// cars — обрезанный до limit список для отрисовки сферы/списка.

router.get('/tags/results', async (req, res) => {
  const { brand, model, volume } = req.query;
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '60')));

  const clauses = [];
  const whereParams = [];
  if (brand) { whereParams.push(brand); clauses.push(`lower(brand) = lower($${whereParams.length})`); }
  if (model) { whereParams.push(model); clauses.push(`lower(model) = lower($${whereParams.length})`); }
  if (volume === '__null__') {
    clauses.push('engine_volume IS NULL');
  } else if (volume) {
    whereParams.push(parseFloat(volume));
    clauses.push(`engine_volume = $${whereParams.length}`);
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';

  try {
    const rowsParams = [...whereParams, limit];
    const [rows, total] = await Promise.all([
      query(`SELECT * FROM cars ${where} ORDER BY brand, model, year_from LIMIT $${rowsParams.length}`, rowsParams),
      query(`SELECT count(*)::int AS n FROM cars ${where}`, whereParams),
    ]);
    res.json({ total: total.rows[0].n, cars: rows.rows });
  } catch (err) {
    console.error('GET /api/cars/tags/results', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/cars/index ───────────────────────────────────────────────────────
// Компактный снимок всей базы для клиентского поиска и режима «Теги»: сайт
// тянет его один раз и дальше фильтрует всё в браузере — ноль запросов на
// символ/клик. Отдаём только поля, нужные для карточек, ранкера (name_normalized
// уже посчитан в БД) и каскада тегов. version = count + ':' + max(updated_at) —
// дешёвый валидатор, по которому клиент решает, устарел ли его снимок.
// Должен стоять ВЫШЕ '/:id', иначе тот перехватит 'index' как id.

router.get('/index', async (_req, res) => {
  try {
    const [rows, meta] = await Promise.all([
      query(
        `SELECT id, brand, model, generation, engine_code, engine_volume,
                kw, bhp, year_from, year_to, name_normalized
           FROM cars
          ORDER BY brand, model, year_from`,
      ),
      query('SELECT count(*)::int AS n, max(updated_at) AS max_updated FROM cars'),
    ]);
    const { n, max_updated } = meta.rows[0];
    const version = `${n}:${max_updated ? new Date(max_updated).getTime() : 0}`;
    res.json({ version, cars: rows.rows });
  } catch (err) {
    console.error('GET /api/cars/index', err);
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
    'service_flags','notes','oil_overrides','source_links','source_keys','tags',
  ];

  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k)),
  );
  // Необязательный комментарий «почему изменили» — идёт в car_events, не в cars.
  const comment = typeof req.body.comment === 'string' ? req.body.comment.trim() || null : null;

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'no updatable fields provided' });
  }

  if (updates.filter_part_numbers) {
    const err = validateFilters(updates.filter_part_numbers);
    if (err) return res.status(400).json({ error: err });
  }
  if ('source_links' in updates) {
    const err = validateSourceLinks(updates.source_links);
    if (err) return res.status(400).json({ error: err });
  }
  if ('source_keys' in updates) {
    const err = validateSourceKeys(updates.source_keys);
    if (err) return res.status(400).json({ error: err });
  }
  if ('tags' in updates) {
    const err = validateTags(updates.tags);
    if (err) return res.status(400).json({ error: err });
  }

  try {
    // Fetch current row so we can rebuild search fields with merged values
    const existing = await query('SELECT * FROM cars WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'not found' });

    // При правке идентичности приводим её к каноническому написанию
    // (shared/carCanon.js) — чтобы переименованием нельзя было снова завести
    // «VW» рядом с «Volkswagen».
    if ('brand' in updates || 'model' in updates || 'generation' in updates) {
      const ident = canonCar({ ...existing.rows[0], ...updates });
      for (const f of ['brand', 'model', 'generation']) {
        const requested = f in updates ? updates[f] : existing.rows[0][f];
        if ((ident[f] ?? null) !== (requested ?? null)) updates[f] = ident[f] ?? null;
      }
    }

    const changedFields = diffChangedFields(existing.rows[0], updates);

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
    await recordCarEvent({
      carId: req.params.id, userId: req.user.id, type: 'edited', comment, changedFields,
    });
    await syncAchievementsSafe(req.user.id);
    res.json(r.rows[0]);
  } catch (err) {
    console.error('PATCH /api/cars/:id', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/cars/:id/assign ─────────────────────────────────────────────────
// «Назначить ответственного» (только mod/admin): переатрибутировать машину
// пользователю, как будто он её добавил. Можно и самому себе.
//
// Ключевой инвариант: у машины не больше ОДНОГО события 'added', и именно его
// user_id — единственный источник правды для счётчика «добавлено машин»
// (топ, статистика профиля, ачивки). Поэтому переназначение не плодит новых
// 'added', а переписывает user_id существующего; если события нет (машина из
// эпохи до фида) — создаёт его задним числом на момент создания машины.
// В фид дополнительно пишется 'reassigned' («{мод} засчитал машину {нику}»),
// а ачивки пересчитываются у ОБОИХ: прежний владелец может потерять,
// новый — получить.

// Переатрибуция ОДНОЙ машины внутри уже открытой транзакции.
// targetUserId = null означает «снять ответственного» (машина становится
// ничьей). Лочит 'added'-событие (FOR UPDATE), чтобы два модератора не
// переназначили машину одновременно. Возвращает { changed, prevOwnerId }:
// changed=false — владелец уже такой (или снимать некого), событий не пишем.
async function applyAssignment(client, {
  carId, carCreatedAt, targetUserId, targetDisplayName, modUserId,
}) {
  const addedR = await client.query(
    `SELECT id, user_id FROM car_events
      WHERE car_id = $1 AND type = 'added'
      ORDER BY created_at ASC LIMIT 1
      FOR UPDATE`,
    [carId],
  );

  const prevOwnerId = addedR.rows[0]?.user_id ?? null;
  if (prevOwnerId === targetUserId) return { changed: false, prevOwnerId };

  if (addedR.rows.length) {
    await client.query(
      'UPDATE car_events SET user_id = $1 WHERE id = $2',
      [targetUserId, addedR.rows[0].id],
    );
  } else if (targetUserId) {
    // Машины без 'added' (созданы до появления фида) — событие задним числом,
    // датой создания машины, чтобы хронология фида не ломалась.
    await client.query(
      `INSERT INTO car_events (car_id, user_id, type, created_at)
       VALUES ($1, $2, 'added', $3)`,
      [carId, targetUserId, carCreatedAt],
    );
  } else {
    return { changed: false, prevOwnerId }; // снимать некого — 'added' нет
  }

  // created_by на cars — денормализованная подпись автора; держим в актуальном
  // состоянии, чтобы она не противоречила фиду.
  await client.query(
    'UPDATE cars SET created_by = $1 WHERE id = $2',
    [targetDisplayName, carId],
  );

  // Событие в фид: target NULL = «снял ответственного».
  await client.query(
    `INSERT INTO car_events (car_id, user_id, type, target_user_id)
     VALUES ($1, $2, 'reassigned', $3)`,
    [carId, modUserId, targetUserId],
  );
  return { changed: true, prevOwnerId };
}

router.post('/:id/assign', requireRole('mod', 'admin'), async (req, res) => {
  const targetUserId = req.body?.user_id;
  if (!targetUserId || typeof targetUserId !== 'string') {
    return res.status(400).json({ error: 'user_id is required' });
  }

  const client = await pool.connect();
  let prevOwnerId = null;
  try {
    const [carR, userR] = await Promise.all([
      client.query('SELECT id, created_at FROM cars WHERE id = $1', [req.params.id]),
      client.query('SELECT id, display_name FROM users WHERE id = $1', [targetUserId]),
    ]);
    if (!carR.rows.length) return res.status(404).json({ error: 'машина не найдена' });
    if (!userR.rows.length) return res.status(404).json({ error: 'пользователь не найден' });

    await client.query('BEGIN');
    const result = await applyAssignment(client, {
      carId: req.params.id,
      carCreatedAt: carR.rows[0].created_at,
      targetUserId,
      targetDisplayName: userR.rows[0].display_name,
      modUserId: req.user.id,
    });
    if (!result.changed) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'машина уже засчитана этому пользователю' });
    }
    prevOwnerId = result.prevOwnerId;
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('POST /api/cars/:id/assign', err);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }

  // Пересчёт ачивок вне транзакции: счётчики уже зафиксированы, а полный
  // пересинк идемпотентен — при сбое его догонит следующее действие юзера.
  await syncAchievementsSafe(prevOwnerId);
  await syncAchievementsSafe(targetUserId);
  res.json({ ok: true });
});

// ── POST /api/cars/bulk-assign ────────────────────────────────────────────────
// Массовое назначение с страницы пользователя (только mod/admin):
// body { user_id, add: [carId…], remove: [carId…] }.
//   add    — засчитать машины пользователю (как будто он их добавил);
//   remove — снять с него ответственность (машина становится ничьей).
// Каждая машина даёт своё событие 'reassigned' в фид. Всё в одной транзакции:
// либо применилось целиком, либо ничего. Уже-владельцы в add и чужие машины
// в remove тихо пропускаются (idempotent — двойной клик не страшен).

router.post('/bulk-assign', requireRole('mod', 'admin'), async (req, res) => {
  const targetUserId = req.body?.user_id;
  const add = req.body?.add ?? [];
  const remove = req.body?.remove ?? [];
  if (!targetUserId || typeof targetUserId !== 'string') {
    return res.status(400).json({ error: 'user_id is required' });
  }
  const badList = (l) => !Array.isArray(l) || l.some(id => typeof id !== 'string');
  if (badList(add) || badList(remove)) {
    return res.status(400).json({ error: 'add and remove must be arrays of car ids' });
  }
  if (!add.length && !remove.length) {
    return res.status(400).json({ error: 'nothing to do: add and remove are empty' });
  }

  const client = await pool.connect();
  const affectedUsers = new Set();
  let assigned = 0;
  let removed = 0;
  try {
    const userR = await client.query(
      'SELECT id, display_name FROM users WHERE id = $1', [targetUserId],
    );
    if (!userR.rows.length) return res.status(404).json({ error: 'пользователь не найден' });
    const target = userR.rows[0];

    await client.query('BEGIN');

    for (const carId of add) {
      const carR = await client.query('SELECT id, created_at FROM cars WHERE id = $1', [carId]);
      if (!carR.rows.length) continue; // машину успели удалить — не повод ронять всё
      const r = await applyAssignment(client, {
        carId,
        carCreatedAt: carR.rows[0].created_at,
        targetUserId,
        targetDisplayName: target.display_name,
        modUserId: req.user.id,
      });
      if (r.changed) {
        assigned++;
        if (r.prevOwnerId) affectedUsers.add(r.prevOwnerId);
      }
    }

    for (const carId of remove) {
      const carR = await client.query('SELECT id, created_at FROM cars WHERE id = $1', [carId]);
      if (!carR.rows.length) continue;
      // Снимаем только с самого targetUserId: чтобы «убрать галочку» не могло
      // случайно обнулить машину, которую параллельно переписали на другого.
      const ownerR = await client.query(
        `SELECT user_id FROM car_events
          WHERE car_id = $1 AND type = 'added'
          ORDER BY created_at ASC LIMIT 1`,
        [carId],
      );
      if (ownerR.rows[0]?.user_id !== targetUserId) continue;
      const r = await applyAssignment(client, {
        carId,
        carCreatedAt: carR.rows[0].created_at,
        targetUserId: null,
        targetDisplayName: null,
        modUserId: req.user.id,
      });
      if (r.changed) removed++;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('POST /api/cars/bulk-assign', err);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }

  affectedUsers.add(targetUserId);
  for (const uid of affectedUsers) await syncAchievementsSafe(uid);
  res.json({ ok: true, assigned, removed });
});

// ── GET /api/cars/:id/events ──────────────────────────────────────────────────
// Фид ТОЛЬКО этой машины, хронологически — используется на странице машины.

router.get('/:id/events', async (req, res) => {
  try {
    const r = await query(
      `SELECT ce.id, ce.type, ce.comment, ce.changed_fields, ce.created_at,
              u.id AS user_id, u.display_name, u.avatar, u.role,
              rl.prefix_label, rl.color, rl.tooltip,
              tu.id AS target_id, tu.display_name AS target_display_name,
              tu.avatar AS target_avatar,
              trl.prefix_label AS target_prefix_label, trl.color AS target_color,
              trl.tooltip AS target_tooltip
         FROM car_events ce
         LEFT JOIN users u ON u.id = ce.user_id
         LEFT JOIN role_labels rl ON rl.role = u.role
         LEFT JOIN users tu ON tu.id = ce.target_user_id
         LEFT JOIN role_labels trl ON trl.role = tu.role
        WHERE ce.car_id = $1
        ORDER BY ce.created_at ASC`,
      [req.params.id],
    );
    res.json(r.rows.map(row => ({
      id: row.id,
      type: row.type,
      comment: row.comment,
      changed_fields: row.changed_fields,
      created_at: row.created_at,
      user: row.user_id ? {
        id: row.user_id,
        display_name: row.display_name,
        avatar: row.avatar,
        role: row.role,
        role_prefix: row.prefix_label
          ? { label: row.prefix_label, color: row.color, tooltip: row.tooltip }
          : null,
      } : null,
      // Кому засчитали машину (только у type='reassigned').
      target_user: row.target_id ? {
        id: row.target_id,
        display_name: row.target_display_name,
        avatar: row.target_avatar,
        role_prefix: row.target_prefix_label
          ? { label: row.target_prefix_label, color: row.target_color, tooltip: row.target_tooltip }
          : null,
      } : null,
    })));
  } catch (err) {
    console.error('GET /api/cars/:id/events', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/cars/:id ───────────────────────────────────────────────────────
// Только mod/admin — проверка роли на сервере (кнопка на сайте не защита).
// Полное и безвозвратное удаление; car_events этой машины уходят каскадом.

router.delete('/:id', requireRole('mod', 'admin'), async (req, res) => {
  try {
    // Каскад унесёт car_events машины — счётчики её участников уменьшатся,
    // поэтому после удаления пересинкиваем ачивки всем, кто в них фигурировал.
    const affected = await query(
      `SELECT DISTINCT user_id FROM car_events
        WHERE car_id = $1 AND user_id IS NOT NULL AND type IN ('added', 'edited')`,
      [req.params.id],
    );
    const r = await query('DELETE FROM cars WHERE id = $1 RETURNING id', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'not found' });
    for (const row of affected.rows) await syncAchievementsSafe(row.user_id);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/cars/:id', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
