#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Краулер фида кандидатов.
//
// Для каждой машины из seed-списка:
//   1) MANN  → три артикула фильтров + каноничное имя (марка/модель/КУЗОВ).
//   2) Motul → объёмы жидкостей по агрегатам (обогащение, best-effort).
//   3) Склеиваем черновик и, если такой машины ещё нет (проверка dedup_key
//      в базе), POST /api/candidates.
//
// Безопасность для сайтов и бэкенда:
//   • пауза с джиттером между машинами (--delay, по умолчанию 4с);
//   • --limit ограничивает число машин за прогон (партиями по ~50);
//   • резюме: прогресс пишется в .progress.json, повторный запуск продолжает;
//   • дубли не предлагаются повторно (бэкенд помнит и отклонённые).
//
// Запуск:
//   cp config.example.json config.json   # прописать base/key
//   npm install
//   node crawl.mjs --limit 50 --delay 4000
//   node crawl.mjs --seeds seeds/starter.json --headful   # первый тюнинг-прогон
// ─────────────────────────────────────────────────────────────────────────────

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { launchBrowser, sleep, jitter } from './src/browser.js';
import { lookupFilters, filtersComplete } from './src/mann.js';
import { searchVehicle } from './src/motul.js';
import { Api, dedupKey } from './src/api.js';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Аргументы ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { limit: 50, delay: 4000, seeds: 'seeds/starter.json', config: 'config.json', headful: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const [k, v] = argv[i].replace(/^--/, '').split('=');
    if (k === 'headful') a.headful = true;
    else if (k === 'dry-run' || k === 'dryRun') a.dryRun = true;
    else if (v !== undefined) a[k] = /^\d+$/.test(v) ? parseInt(v) : v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) a[k] = argv[++i];
  }
  return a;
}

const args = parseArgs(process.argv);
const configPath = resolve(__dir, args.config);
const progressPath = resolve(__dir, '.progress.json');

function log(...m) { console.log(new Date().toISOString().slice(11, 19), ...m); }

// ── Резюме ───────────────────────────────────────────────────────────────────
async function loadProgress() {
  if (!existsSync(progressPath)) return { done: [] };
  try { return JSON.parse(await readFile(progressPath, 'utf8')); } catch { return { done: [] }; }
}
async function saveProgress(p) { await writeFile(progressPath, JSON.stringify(p, null, 2)); }

// ── Сборка кандидата из данных MANN + Motul ──────────────────────────────────
function buildCandidate(seed, mann, motul) {
  const brand = (mann.name && mann.name.brand) || seed.make;
  const model = (mann.name && mann.name.model) || seed.model;
  const generation = (mann.name && mann.name.generation) || seed.generation || null;

  const fluid = {};
  if (motul && motul.aggregates) {
    for (const [key, a] of Object.entries(motul.aggregates)) {
      fluid[key] = {
        volumeService: a.volumeService || undefined,
        volumeTotal: a.volumeTotal || undefined,
        volumePlain: a.volumePlain || undefined,
        filterVolume: a.filterVolume || undefined,
        isCvt: a.isCvt || undefined,
        isDct: a.isDct || undefined,
        isSemiAuto: a.isSemiAuto || undefined,
        motulProducts: a.motulProducts && a.motulProducts.length ? a.motulProducts : undefined,
        label: a.label || undefined,
      };
    }
  }

  const filters = mann.filters || { vf: { part: null, absent: false }, mf: { part: null, absent: false }, sf: { part: null, absent: false } };
  const hasVolumes = Object.keys(fluid).length > 0;
  const allFilters = filtersComplete(filters);

  let quality = 'partial';
  if (allFilters && hasVolumes) quality = 'good';
  else if (!filters.vf.part && !filters.mf.part && !filters.sf.part) quality = 'no_filters';
  else if (!mann.name || !mann.name.model) quality = 'weak';

  return {
    brand, model, generation,
    engine_code: seed.engineCode || (motul && motul.aggregates.engine && motul.aggregates.engine.engineCode) || null,
    engine_volume: seed.volume ?? null,
    year_from: seed.yearFrom ?? null,
    year_to: seed.yearTo ?? null,
    kw: seed.kw ?? null,
    bhp: seed.bhp ?? null,
    fuel_type: seed.fuelType ?? null,
    motul_name: (motul && motul.motulName) || null,
    engine_name: seed.engineName || null,
    fluid_capacities: fluid,
    filter_part_numbers: filters,
    car_approvals: [], // допуска (ROLF/Ravenol) добавляет оператор — Motul их не даёт
    source: {
      mannUrl: mann.url || null,
      motulName: (motul && motul.motulName) || null,
      mannCardCount: mann.cardCount ?? null,
      matchedAt: new Date().toISOString(),
    },
    match_quality: quality,
    created_by: 'crawler',
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(configPath)) {
    console.error(`Нет ${args.config}. Скопируйте config.example.json → config.json и впишите base/key.`);
    process.exit(1);
  }
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const seeds = JSON.parse(await readFile(resolve(__dir, args.seeds), 'utf8'));
  const api = new Api({ base: config.apiBase, key: config.apiKey });

  if (!(await api.health())) { console.error('Бэкенд недоступен:', config.apiBase); process.exit(1); }

  const progress = await loadProgress();
  const doneSet = new Set(progress.done);

  // Что ещё не обработано в этом seed-файле.
  const pending = seeds.filter((s) => !doneSet.has(s.id || s.query));
  log(`seeds: ${seeds.length}, осталось: ${pending.length}, лимит прогона: ${args.limit}`);

  // Предварительно отсекаем то, что уже в базе (по dedup_key из seed-специфики).
  const keyOf = (s) => dedupKey({ brand: s.make, model: s.model, engine_code: s.engineCode, engine_volume: s.volume, year_from: s.yearFrom });
  const knownKeys = await api.known(pending.map(keyOf)).catch(() => new Set());

  const { browser, context } = await launchBrowser({ headless: !args.headful });
  const page = await context.newPage();

  const stats = { created: 0, skipped: 0, noFilters: 0, errors: 0 };
  let processed = 0;

  try {
    for (const seed of pending) {
      if (processed >= args.limit) { log('достигнут лимит прогона'); break; }
      const id = seed.id || seed.query;
      processed++;

      if (knownKeys.has(keyOf(seed))) {
        log(`↷ пропуск (уже в базе): ${seed.make} ${seed.model}`);
        doneSet.add(id); stats.skipped++;
        continue;
      }

      try {
        // 1) MANN — фильтры + каноничное имя (приоритет пользователя).
        const mann = await lookupFilters(page, {
          make: seed.make, model: seed.model, engineCode: seed.engineCode,
          ccm: seed.ccm, kw: seed.kw, bhp: seed.bhp, yearFrom: seed.yearFrom,
        }).catch((e) => { log('  MANN err:', e.message); return { url: null, filters: null, name: null, cardCount: 0 }; });

        await sleep(jitter(args.delay));

        // 2) Motul — объёмы (обогащение, не критично).
        let motul = null;
        if (seed.query) {
          motul = await searchVehicle(page, seed.query)
            .catch((e) => { log('  Motul err:', e.message); return null; });
          await sleep(jitter(args.delay));
        }

        const candidate = buildCandidate(seed, mann, motul);

        if (candidate.match_quality === 'no_filters') stats.noFilters++;

        if (args.dryRun) {
          log(`  [dry] ${candidate.brand} ${candidate.model}${candidate.generation ? ` (${candidate.generation})` : ''} — ` +
              `вф:${candidate.filter_part_numbers.vf.part || '?'} мф:${candidate.filter_part_numbers.mf.part || '?'} ` +
              `сф:${candidate.filter_part_numbers.sf.part || '?'} | q:${candidate.match_quality}`);
        } else {
          const r = await api.postCandidate(candidate);
          if (r.created) { stats.created++; log(`  ✓ ${candidate.brand} ${candidate.model} [${candidate.match_quality}]`); }
          else { stats.skipped++; log(`  ↷ ${candidate.brand} ${candidate.model} (${r.reason})`); }
        }

        doneSet.add(id);
      } catch (e) {
        stats.errors++;
        log(`  ✗ ошибка на ${seed.make} ${seed.model}: ${e.message}`);
      }

      // Периодически сохраняем прогресс.
      if (processed % 5 === 0) { progress.done = [...doneSet]; await saveProgress(progress); }
    }
  } finally {
    progress.done = [...doneSet];
    await saveProgress(progress);
    await browser.close();
  }

  log('готово:', JSON.stringify(stats));
}

main().catch((e) => { console.error(e); process.exit(1); });
