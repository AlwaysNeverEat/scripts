#!/usr/bin/env node
// Короткий и понятный снимок наполненности базы для Windows-конвейера.

import { makeQuery } from './db.js';

const query = await makeQuery();
const resolved = key => `(
    coalesce(filter_part_numbers->'${key}'->>'part', '') <> ''
    OR coalesce(filter_part_numbers->'${key}'->>'absent', 'false') = 'true'
)`;
const result = await query(`
    SELECT
        count(*)::bigint AS total,
        count(*) FILTER (WHERE notes LIKE '⚠ Импортировано%')::bigint AS auto_imported,
        count(*) FILTER (WHERE source_links ? 'motul')::bigint AS with_motul,
        count(*) FILTER (WHERE kw IS NULL)::bigint AS missing_kw,
        count(*) FILTER (WHERE bhp IS NULL)::bigint AS missing_bhp,
        count(*) FILTER (WHERE ${resolved('vf')} AND ${resolved('mf')} AND ${resolved('sf')})::bigint AS filters_complete,
        count(*) FILTER (WHERE NOT (${resolved('vf')} AND ${resolved('mf')} AND ${resolved('sf')}))::bigint AS filters_incomplete,
        count(*) FILTER (WHERE jsonb_array_length(coalesce(car_approvals, '[]'::jsonb)) > 0)::bigint AS with_approvals,
        max(updated_at) AS last_update
    FROM cars
`);
const row = result.rows[0] || {};
const n = value => Number(value || 0).toLocaleString('ru-RU');
console.log('──────────────────── СОСТОЯНИЕ БАЗЫ ────────────────────');
console.log(`Всего машин:                 ${n(row.total)}`);
console.log(`Автоматически импортировано: ${n(row.auto_imported)}`);
console.log(`Есть ссылка Motul:           ${n(row.with_motul)}`);
console.log(`Без кВт:                     ${n(row.missing_kw)}`);
console.log(`Без л.с.:                    ${n(row.missing_bhp)}`);
console.log(`Фильтры заполнены полностью: ${n(row.filters_complete)}`);
console.log(`Фильтры требуют дозаполнения: ${n(row.filters_incomplete)}`);
console.log(`Есть допуски масла:          ${n(row.with_approvals)}`);
console.log(`Последнее изменение:         ${row.last_update || '—'}`);
console.log('─────────────────────────────────────────────────────────');
