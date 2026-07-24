// Канонические написания марок и моделей — правила склейки дублей.
//
// Проблема: одна и та же марка попадает в базу в разных написаниях («GWM
// HAVAL» с Motul, «Haval»/«HAVAL» руками, «VW» вместо «Volkswagen»), а модели
// Ford с Motul приходят как «Focus Mk II», когда руками их заводят как
// «Focus» + поколение. Уникальный ключ машины (lower(brand), lower(model), …)
// такие варианты не склеивает — получаются дубли и кривой список тегов.
//
// Этот модуль — единая точка правды о канонической форме:
//   • импорт-скрипты (backend/scripts/import/*) прогоняют каждую машину через
//     canonCar() ПЕРЕД записью/поиском в БД — дубли не появляются заново;
//   • backend/src/routes/cars.js нормализует brand/model при POST/PATCH —
//     руками «VW» тоже больше не заведёшь;
//   • backend/scripts/import/merge-duplicates.js по этим же правилам чистит
//     уже накопленные дубли (склейка записей, перенос car_events).
//
// Новый двойник? Добавь alias в BRAND_CANON — merge-duplicates.js подхватит.
import { normalize } from './translit.js';

// Марки с известными двойниками. Ключ сравнения — normalize(): нижний регистр,
// без пунктуации («LADA / AVTOVAZ» → «lada avtovaz»). canonical — как пишем в БД.
const BRAND_CANON = [
  { canonical: 'Haval',      aliases: ['haval', 'gwm haval', 'great wall haval'] },
  { canonical: 'Volkswagen', aliases: ['vw', 'volkswagen', 'volkswagen eu', 'volkswagen rus'] },
  { canonical: 'Lada',       aliases: ['lada', 'lada avtovaz', 'lada vaz zhiguli', 'vaz', 'avtovaz'] },
];

const BRAND_LOOKUP = new Map();
for (const group of BRAND_CANON) {
  for (const alias of group.aliases) BRAND_LOOKUP.set(alias, group.canonical);
}

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

/** Ключ марки для сравнения написаний: normalize() + алиасы BRAND_CANON. */
export function brandKey(brand) {
  const key = normalize(brand);
  const canonical = BRAND_LOOKUP.get(key);
  return canonical ? normalize(canonical) : key;
}

/** Каноническое написание марки; null — правила нет, оставить как есть. */
export function canonicalBrand(brand) {
  return BRAND_LOOKUP.get(normalize(brand)) ?? null;
}

// Модели Ford у Motul называются «Focus Mk II» / «Fiesta Mk VI» и т.п., а
// руками их заводят как «Focus» + поколение. Снимаем «Mk N» с модели и
// переносим номер поколения в generation (существующий кузовной код вроде
// «C307» сохраняем рядом: «2 (C307)»). «Focus C-Max» и Geely «MK» не трогаем —
// правило требует хвост «Mk <номер>» и действует только для Ford.
const FORD_MK_RE = /^(.+?)\s+mk\s*(x|ix|viii|vii|vi|v|iv|iii|ii|i|\d+)$/i;

function canonicalFordModel(model, generation) {
  const m = String(model).trim().match(FORD_MK_RE);
  if (!m) return null;
  const base = m[1].trim();
  const n = ROMAN[m[2].toLowerCase()] ?? parseInt(m[2], 10);
  if (!base || !Number.isFinite(n)) return null;
  const gen = (generation || '').trim();
  let nextGen;
  if (!gen) nextGen = String(n);
  else if (normalize(gen) === String(n)) nextGen = gen;
  else nextGen = `${n} (${gen})`;
  return { model: base, generation: nextGen };
}

/**
 * Каноническая идентичность машины: возвращает копию объекта с приведёнными
 * brand/model/generation (остальные поля не трогаются). Ничего не меняет,
 * если правил для этой машины нет.
 */
export function canonCar(car) {
  const out = { ...car };
  const brand = canonicalBrand(car.brand);
  if (brand) out.brand = brand;
  if (brandKey(out.brand) === 'ford') {
    const ford = canonicalFordModel(car.model, car.generation);
    if (ford) {
      out.model = ford.model;
      out.generation = ford.generation;
    }
  }
  return out;
}
