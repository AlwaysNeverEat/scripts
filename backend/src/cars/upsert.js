// Единый путь записи машины в таблицу `cars`.
// Используется и боевым POST /api/cars, и «добавить в БД» из фида кандидатов —
// чтобы upsert, валидация фильтров и построение поисковых полей жили в одном месте.

import { query } from '../db/client.js';
import { buildNameFields } from '../search/translit.js';

// Проверка тройки фильтров: воздушный (vf), масляный (mf), салонный (sf).
// Запись считается полной, только когда для каждого ключа либо absent:true,
// либо указан непустой номер.
export function validateFilters(fpn) {
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
  const tokens = synonymTokens
    .flatMap(s => s.split(/\s+/))
    .filter(Boolean)
    .map(t => t.replace(/'/g, "''"));
  return tokens.length
    ? `to_tsvector('simple', '${tokens.join(' ')}')`
    : `to_tsvector('simple', '')`;
}

function searchFields(carRow) {
  const { brand, model, generation, engine_code, engine_volume, year_from, year_to } = carRow;
  const { nameNormalized, nameCyrillic, nameTranslit, synonymTokens } =
    buildNameFields(brand, model, generation, engine_code, engine_volume, year_from, year_to);
  return { nameNormalized, nameCyrillic, nameTranslit, svSql: buildSearchVectorSql(synonymTokens) };
}

// Ключ дублей — та же форма, что у idx_cars_upsert_key.
// Один и тот же ключ у машины в `cars` и у кандидата в `car_candidates`.
export function dedupKey({ brand, model, engine_code, engine_volume, year_from }) {
  return [
    String(brand || '').trim().toLowerCase(),
    String(model || '').trim().toLowerCase(),
    String(engine_code || '').trim().toLowerCase(),
    engine_volume != null && engine_volume !== '' ? Number(engine_volume) : 0,
    year_from != null && year_from !== '' ? parseInt(year_from) : 0,
  ].join('|');
}

// Валидация полей машины. Возвращает строку ошибки или null.
export function validateCar(payload, { requireFilters = true } = {}) {
  const { brand, model, year_from, car_approvals, recommended_oils, service_flags, oil_overrides, notes, filter_part_numbers } = payload;
  if (!brand || !model) return 'brand and model are required';
  if (!year_from) return 'year_from is required';
  if (requireFilters) {
    const filterErr = validateFilters(filter_part_numbers);
    if (filterErr) return filterErr;
  }
  if (car_approvals !== undefined && !Array.isArray(car_approvals)) return 'car_approvals must be an array';
  if (recommended_oils !== undefined && !Array.isArray(recommended_oils)) return 'recommended_oils must be an array';
  if (service_flags !== undefined && (typeof service_flags !== 'object' || Array.isArray(service_flags) || service_flags === null))
    return 'service_flags must be an object';
  if (oil_overrides !== undefined && (typeof oil_overrides !== 'object' || Array.isArray(oil_overrides) || oil_overrides === null))
    return 'oil_overrides must be an object';
  if (notes !== undefined && notes !== null && typeof notes !== 'string') return 'notes must be a string';
  return null;
}

// Upsert по ключу (brand, model, engine_code, engine_volume, year_from).
// Возвращает { ...row, created }.
export async function upsertCar(payload) {
  const {
    brand, model, generation, engine_code, engine_volume,
    year_from, year_to, kw, bhp, fuel_type, motul_name, engine_name,
    fluid_capacities, filter_part_numbers,
    car_approvals, recommended_oils,
    service_flags, notes, oil_overrides,
    created_by,
  } = payload;

  const { nameNormalized, nameCyrillic, nameTranslit, svSql } =
    searchFields({ brand, model, generation, engine_code, engine_volume, year_from, year_to });

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
  return { ...row, created };
}
