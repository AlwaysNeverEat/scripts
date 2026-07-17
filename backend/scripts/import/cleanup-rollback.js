#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Откат к Motul: удаляет из БД авто-записи Лукойла и Liqui Moly (по метке в
// notes) и подстраховочно — авто-записи с нереальным объёмом двигателя (>20 л,
// мусор вроде «290.7 л»). Ручные записи коллег и записи Motul НЕ трогаются.
// car_events удалятся каскадом (ON DELETE CASCADE).
//
// Запуск:  node scripts/import/cleanup-rollback.js [--dry-run]
// ─────────────────────────────────────────────────────────────────────────────

import { makeQuery } from './db.js';
import { color, mark } from './log.js';

const DRY = process.argv.includes('--dry-run');
const query = await makeQuery();

const LUKOIL = `notes LIKE '⚠ Импортировано автоматически (ЛУКОЙЛ)%'`;
const LM = `notes LIKE '⚠ Импортировано автоматически (Liqui Moly)%'`;
const BADVOL = `(notes LIKE '⚠ Импортировано%' AND engine_volume > 20)`;
const WHERE = `${LUKOIL} OR ${LM} OR ${BADVOL}`;

const s = (await query(`
    SELECT count(*) FILTER (WHERE ${LUKOIL}) AS lukoil,
           count(*) FILTER (WHERE ${LM})     AS lm,
           count(*) FILTER (WHERE ${BADVOL}) AS badvol,
           count(*) FILTER (WHERE ${WHERE})  AS total
    FROM cars`)).rows[0];

console.log(`Откат к Motul — к удалению: ${color.brand('Лукойл')}=${s.lukoil}, `
    + `${color.brand('Liqui Moly')}=${s.lm}, битый объём>20л=${color.warn(String(s.badvol))}; `
    + `уникальных строк=${color.err(String(s.total))}`);

if (DRY) { console.log('[dry-run] ничего не удаляю'); process.exit(0); }
if (Number(s.total) === 0) { console.log(`${mark.ok} нечего удалять — БД уже чистая`); process.exit(0); }

const del = await query(`DELETE FROM cars WHERE ${WHERE} RETURNING 1`);
console.log(`  ${mark.ok} удалено строк: ${color.ok(String(del.rows.length))} (Motul зальёт машины заново)`);
process.exit(0);
