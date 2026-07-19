// Клиентский ранкер машин — тот же поиск, что раньше делал бэкенд в SQL
// (GET /api/cars/search), только целиком в браузере поверх снимка базы.
// Чистые функции, без DOM и сети — поэтому шарится и тестируется под node --test.
//
// Повторяет намерение серверного скоринга на pg_trgm:
//   score = similarity*0.3 + word_similarity*0.3 + modelSim*0.25
//         + ts_rank(префиксный матч)*0.25 + бонусы за год/объём.
// Важная деталь верности серверу: similarity/word_similarity считаются по
// name_normalized (только латиница), а префиксный tsquery — по «расширенному»
// стогу (search_text = name_normalized + синонимы/транслит имени машины, как в
// серверном search_vector). Поэтому частичный кириллический ввод «октав»
// находит OCTAVIA через её синоним «октавия», а не через триграммы.

import { normalize, expandQuery, buildNameFields } from './translit.js';

// ── Триграммы в стиле pg_trgm ────────────────────────────────────────────────
// Слово → «  w » (2 пробела спереди, 1 сзади) → триграммы; множество по всей
// строке — объединение по словам. Неалфацифровые — разделители слов.
function trigramSet(str) {
  const set = new Set();
  const words = String(str || '').toLowerCase().split(/[^a-zа-яё0-9]+/i).filter(Boolean);
  for (const w of words) {
    const padded = `  ${w} `;
    for (let i = 0; i + 3 <= padded.length; i++) set.add(padded.slice(i, i + 3));
  }
  return set;
}

function intersectionSize(a, b) {
  // Итерируем по меньшему множеству — дешевле.
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let n = 0;
  for (const t of small) if (big.has(t)) n++;
  return n;
}

// similarity(a,b) = |A∩B| / |A∪B| (Жаккар, как pg_trgm similarity()).
function similarityFromSets(A, B) {
  if (!A.size || !B.size) return 0;
  const inter = intersectionSize(A, B);
  return inter / (A.size + B.size - inter);
}

// word_similarity(a,b) ≈ |A∩B| / |A| — какая доля триграмм запроса a есть в b.
// Верхняя оценка «оконного» word_similarity из pg_trgm, но для коротких
// запросов ранжирует в ту же сторону.
function wordSimilarityFromSets(A, B) {
  if (!A.size) return 0;
  return intersectionSize(A, B) / A.size;
}

function similarity(a, b) {
  return similarityFromSets(trigramSet(a), trigramSet(b));
}

// ── Разбор года/объёма из «сырого» запроса (как в SQL) ───────────────────────
function parseNums(rawQuery) {
  const nums = String(rawQuery || '').match(/\b(\d{4}|\d\.\d)\b/g) || [];
  const yearNum = nums.find(n => n.length === 4 && parseInt(n, 10) > 1960) || null;
  const volNum  = nums.find(n => n.includes('.')) || null;
  return {
    year: yearNum ? parseInt(yearNum, 10) : null,
    vol:  volNum ? parseFloat(volNum) : null,
  };
}

const sanitizeWord = (w) => w.replace(/[^a-zа-яё0-9.]/gi, '');

// Токены варианта длиннее 1 символа — по ним строится «tsquery :*» (все должны
// найтись префиксом в имени машины).
function variantTokens(variant) {
  return variant.split(/\s+/).map(sanitizeWord).filter(w => w.length > 1);
}

// Доля токенов варианта, каждый из которых является префиксом какого-то слова
// стога. 1 → сработал бы префиксный tsquery (используется и как фильтр, и как
// прокси ts_rank).
function prefixCoverage(tokens, hayTokens) {
  if (!tokens.length) return 0;
  let hit = 0;
  for (const t of tokens) {
    if (hayTokens.some(ht => ht.startsWith(t))) hit++;
  }
  return hit / tokens.length;
}

// Расширенный стог для одной машины = name_normalized + синонимы/транслит
// имени (то же содержимое, что уходит в серверный search_vector). Считается
// один раз на снимок (см. augmentCars), не на каждый ввод.
export function buildCarSearchText(car) {
  const { synonymTokens } = buildNameFields(
    car.brand, car.model, car.generation, car.engine_code,
    car.engine_volume, car.year_from, car.year_to,
  );
  const base = car.name_normalized
    || normalize([car.brand, car.model, car.generation, car.engine_code].filter(Boolean).join(' '));
  return `${base} ${synonymTokens.join(' ')}`.trim();
}

/**
 * Досчитать поле search_text каждой машине снимка (один раз после загрузки).
 * rankCars умеет работать и без него, но тогда стог считается на каждый ввод.
 */
export function augmentCars(cars) {
  return cars.map(c => (c.search_text ? c : { ...c, search_text: buildCarSearchText(c) }));
}

/**
 * augmentCars + предвычисленные структуры скоринга в поле _search: триграммы
 * имени/модели и токены стога. Считается один раз на снимок, чтобы scoreCar не
 * пересобирал их на каждую машину при каждом вводе. Идемпотентна, вход не
 * мутирует; rankCars даёт бит-в-бит ту же выдачу с _search и без него.
 */
export function prepareCars(cars) {
  return augmentCars(cars).map(c => {
    if (c._search) return c;
    const name = c.name_normalized
      || normalize([c.brand, c.model, c.generation, c.engine_code].filter(Boolean).join(' '));
    const modelLower = String(c.model || '').toLowerCase();
    return {
      ...c,
      _search: {
        nameSet: trigramSet(name),
        nameLower: name.toLowerCase(),
        hayTokens: c.search_text.toLowerCase().split(/\s+/).filter(Boolean),
        modelSet: modelLower ? trigramSet(modelLower) : null,
      },
    };
  });
}

// Порог триграммного оператора % в pg_trgm по умолчанию.
const SIMILARITY_THRESHOLD = 0.3;
// word_similarity-ветка WHERE в серверном запросе.
const WSIM_THRESHOLD = 0.35;

function scoreCar(car, ctx) {
  const { variantData, queryWordSets, nums, base } = ctx;

  // Пер-машинные структуры: из _search (prepareCars, один раз на снимок) или
  // на лету — старое поведение для «сырых» машин.
  let nameSet, nameLower, hayTokens, modelSet;
  if (car._search) {
    ({ nameSet, nameLower, hayTokens, modelSet } = car._search);
  } else {
    const name = car.name_normalized
      || normalize([car.brand, car.model, car.generation, car.engine_code].filter(Boolean).join(' '));
    nameSet = trigramSet(name);
    nameLower = name.toLowerCase();
    const hay = car.search_text || buildCarSearchText(car);
    hayTokens = hay.toLowerCase().split(/\s+/).filter(Boolean);
    const modelLower = String(car.model || '').toLowerCase();
    modelSet = modelLower ? trigramSet(modelLower) : null;
  }

  let maxSim = 0;
  let maxWsim = 0;
  let maxPrefix = 0;
  let tsMatch = false;
  let trigramMatch = false;

  for (const { set: vSet, tokens } of variantData) {
    const sim = similarityFromSets(nameSet, vSet);   // по name_normalized (латиница)
    const wsim = wordSimilarityFromSets(vSet, nameSet);
    if (sim > maxSim) maxSim = sim;
    if (wsim > maxWsim) maxWsim = wsim;
    if (sim >= SIMILARITY_THRESHOLD) trigramMatch = true;

    const cov = prefixCoverage(tokens, hayTokens); // по расширенному стогу
    if (cov > maxPrefix) maxPrefix = cov;
    if (cov >= 1) tsMatch = true;
  }

  // Модельный бонус: каждое слово запроса против модели отдельно.
  let modelSim = 0;
  if (modelSet) {
    for (const qwSet of queryWordSets) {
      const s = similarityFromSets(modelSet, qwSet);
      if (s > modelSim) modelSim = s;
    }
  }

  // Год / объём.
  let yearBoost = 0;
  if (nums.year != null) {
    const to = car.year_to == null ? 9999 : Number(car.year_to);
    if (car.year_from != null && nums.year >= Number(car.year_from) && nums.year <= to) yearBoost = 0.3;
  }
  let volBoost = 0;
  if (nums.vol != null && car.engine_volume != null) {
    if (Math.abs(Number(car.engine_volume) - nums.vol) < 0.15) volBoost = 0.2;
  }

  const substringMatch = base.length > 0 && nameLower.includes(base);
  const match = tsMatch || trigramMatch || maxWsim >= WSIM_THRESHOLD || substringMatch;

  const score = maxSim * 0.3
    + maxWsim * 0.3
    + modelSim * 0.25
    + maxPrefix * 0.25
    + yearBoost + volBoost;

  return { score, match };
}

/**
 * Ранжировать машины по запросу. Повторяет серверный /api/cars/search:
 * возвращает до `limit` машин, прошедших фильтр, по убыванию score.
 * @param {string} rawQuery — сырой ввод пользователя
 * @param {Array} cars — снимок машин (поля name_normalized, model,
 *        engine_volume, year_from, year_to, [search_text] + поля для карточки)
 * @param {{limit?:number}} [opts]
 */
export function rankCars(rawQuery, cars, { limit = 20 } = {}) {
  const base = normalize(rawQuery);
  if (!base) return [];

  const variants = expandQuery(rawQuery);
  const queryWords = [...new Set(variants.flatMap(v => v.split(/\s+/)))]
    .filter(w => w.length >= 3 && !/^\d/.test(w))
    .slice(0, 12);
  const nums = parseNums(rawQuery);
  // Пер-запросные структуры считаются один раз, а не в scoreCar на каждую машину.
  const variantData = variants.map(v => ({ set: trigramSet(v), tokens: variantTokens(v) }));
  const queryWordSets = queryWords.map(w => trigramSet(w));
  const ctx = { variantData, queryWordSets, nums, base };

  const scored = [];
  for (const car of cars) {
    const { score, match } = scoreCar(car, ctx);
    if (match) scored.push({ car, score });
  }
  scored.sort((a, b) => b.score - a.score
    || String(a.car.brand ?? '').localeCompare(String(b.car.brand ?? '')));
  return scored.slice(0, limit).map(s => s.car);
}

// Экспорт внутренностей для тестов/отладки.
export const _internals = { trigramSet, similarity, wordSimilarityFromSets, prefixCoverage, parseNums };
