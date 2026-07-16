#!/usr/bin/env node
// Готовит filters.json к повторному запросу MANN.
// Старый importer считал source:'none' окончательным навсегда. Здесь промахи,
// BIG-only результаты и неполные MANN-результаты раз в N дней снова допускаются
// к приоритетному MANN-подбору. Отдельный state не даёт повторять запросы каждый
// цикл, но новые машины обрабатываются сразу.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const args = process.argv.slice(2);
function argValue(name, fallback) {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback;
}

const CARS_FILE = path.resolve(ROOT, argValue('--cars', 'data/import/cars-workset.json'));
const FILTERS_FILE = path.resolve(ROOT, argValue('--filters', 'data/import/filters.json'));
const STATE_FILE = path.resolve(ROOT, argValue('--state', 'data/import/.mann-retry-state.json'));
const RETRY_DAYS_RAW = Number(argValue('--retry-days', process.env.MANN_RETRY_DAYS || '30'));
const RETRY_DAYS = Number.isFinite(RETRY_DAYS_RAW) ? Math.max(0, RETRY_DAYS_RAW) : 30;
const FORCE = args.includes('--force');

const cars = readJson(CARS_FILE, null);
const filters = readJson(FILTERS_FILE, {});
const state = readJson(STATE_FILE, {});
if (!Array.isArray(cars)) {
    console.error(`Не читается ${CARS_FILE}`);
    process.exit(1);
}

function sourceSet(entry) {
    const out = new Set(Array.isArray(entry?.sources) ? entry.sources : []);
    for (const source of String(entry?.source || '').split('+')) {
        if (source && source !== 'none') out.add(source);
    }
    return out;
}

function needsMannAttempt(entry) {
    if (!entry) return true;
    const sources = sourceSet(entry);
    if (!sources.has('mann')) return true;
    // Неполный ответ MANN перепроверяем: каталог мог получить новый артикул или
    // мощность после предыдущего запуска.
    return !entry.vf || !entry.mf || !entry.sf || !entry.kw || !entry.bhp;
}

const now = Date.now();
const retryMs = RETRY_DAYS * 86400000;
let released = 0;
let deferred = 0;
let complete = 0;

for (const car of cars) {
    const key = car?._type_key;
    if (!key) continue;
    const entry = filters[key];
    if (!needsMannAttempt(entry)) {
        complete++;
        continue;
    }

    const last = Date.parse(state[key]?.attempted_at || '') || 0;
    const due = FORCE || !last || RETRY_DAYS === 0 || now - last >= retryMs;
    if (!due) {
        deferred++;
        continue;
    }

    // scrape-filters.js пропускает уже существующие source:none/kw-записи.
    // Удаление только локального результата разрешает ему выполнить новый
    // MANN lookup; BIG fallback в следующем этапе вернёт запасные данные.
    if (entry) delete filters[key];
    state[key] = { attempted_at: new Date(now).toISOString() };
    released++;
}

writeJson(FILTERS_FILE, filters);
writeJson(STATE_FILE, state);
console.log(`MANN retry: допущено к подбору ${released}, отложено до срока ${deferred}, полных MANN ${complete}`);
console.log(`Повтор промахов: раз в ${RETRY_DAYS} дн.${FORCE ? ' (force)' : ''}`);
