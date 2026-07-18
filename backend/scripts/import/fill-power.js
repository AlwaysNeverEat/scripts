#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Финальный свип мощности по всей БД: если у машины известно одно из kw/bhp, а
// второе пусто — вычисляем его (1 л.с. = 0.73549875 кВт). Гарантирует, что у
// каждой машины, где есть хоть какая-то мощность, заполнены ОБА поля,
// независимо от источника. Не трогает заполненные значения.
//
// Запуск:  node scripts/import/fill-power.js [--dry-run]
// ─────────────────────────────────────────────────────────────────────────────

import { makeQuery } from './db.js';
import { KW_PER_PS } from './power.js';
import { color, mark } from './log.js';

const DRY = process.argv.includes('--dry-run');
const query = await makeQuery();

const before = (await query(`
    SELECT count(*) FILTER (WHERE bhp IS NULL AND kw IS NOT NULL) AS need_bhp,
           count(*) FILTER (WHERE kw IS NULL AND bhp IS NOT NULL) AS need_kw,
           count(*) FILTER (WHERE kw IS NULL AND bhp IS NULL)     AS no_power,
           count(*) AS total
    FROM cars`)).rows[0];

console.log(`Свип мощности: всего ${before.total}; добить bhp=${color.power(String(before.need_bhp))}, `
    + `kw=${color.power(String(before.need_kw))}; совсем без мощности ${color.warn(String(before.no_power))}`);

if (DRY) { console.log('[dry-run] изменения не вносятся'); process.exit(0); }

const r1 = await query(
    `UPDATE cars SET bhp = round(kw / ${KW_PER_PS})::int, updated_at = now()
     WHERE bhp IS NULL AND kw IS NOT NULL RETURNING 1`);
const r2 = await query(
    `UPDATE cars SET kw = round(bhp * ${KW_PER_PS})::int, updated_at = now()
     WHERE kw IS NULL AND bhp IS NOT NULL RETURNING 1`);

console.log(`  ${mark.ok} добито л.с. из кВт: ${color.ok(String(r1.rows.length))}; кВт из л.с.: ${color.ok(String(r2.rows.length))}`);
if (Number(before.no_power) > 0) {
    console.log(`  ${mark.warn} ${before.no_power} машин без мощности вообще — ни один источник не дал кВт/л.с. (нечего пересчитывать)`);
}
process.exit(0);
