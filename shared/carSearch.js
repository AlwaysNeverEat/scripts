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

// ── Триграммы как id поверх словаря снимка ───────────────────────────────────
// Set строк на каждую машину — самая дорогая часть подготовленного снимка: на
// ~13к машин это под 30 МБ (нехватка памяти на телефоне = браузер молча
// выгружает вкладку и она «сама перезагружается»). Триграмм на весь снимок
// при этом всего ~7 тысяч, поэтому храним один словарь «триграмма → id» и по
// машине — отсортированный Uint32Array из этих id: ~100 байт вместо ~2 КБ.
// Пересечение считается слиянием двух отсортированных массивов — результат
// бит-в-бит тот же, что у Set-версии, а работает быстрее.

// Отсортированные (по возрастанию) id триграмм строки без повторов.
// add=false — режим запроса: триграммы, которых нет в словаре снимка, просто
// пропускаем (пересечение с ними всё равно нулевое), но в размер множества они
// входят — его считаем по set.size, а не по длине массива.
function trigramIds(set, dict, add) {
  const ids = new Uint32Array(set.size);
  let n = 0;
  for (const t of set) {
    let id = dict.get(t);
    if (id === undefined) {
      if (!add) continue;
      id = dict.size;
      dict.set(t, id);
    }
    ids[n++] = id;
  }
  const out = n === ids.length ? ids : ids.slice(0, n);
  out.sort();
  return out;
}

function intersectionSizeIds(a, b) {
  let i = 0, j = 0, n = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { n++; i++; j++; }
    else if (a[i] < b[j]) i++;
    else j++;
  }
  return n;
}

function intersectionSize(a, b) {
  // Итерируем по меньшему множеству — дешевле.
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let n = 0;
  for (const t of small) if (big.has(t)) n++;
  return n;
}

// similarity(a,b) = |A∩B| / |A∪B| (Жаккар, как pg_trgm similarity()).
function jaccard(inter, sizeA, sizeB) {
  if (!sizeA || !sizeB) return 0;
  return inter / (sizeA + sizeB - inter);
}

function similarityFromSets(A, B) {
  return jaccard(intersectionSize(A, B), A.size, B.size);
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
//
// hay — стог одной строкой, приведённый к нижнему регистру и с ведущим
// пробелом (см. padHay). Массив слов тут был бы вторым по весу куском снимка
// (~14 МБ на 13к машин), а «какое-то слово начинается с t» — это ровно
// вхождение подстроки « t». Токены приходят уже с ведущим пробелом (padTokens):
// склеивать их здесь значило бы аллоцировать строку на каждую машину снимка.
function prefixCoverage(paddedTokens, hay) {
  if (!paddedTokens.length) return 0;
  let hit = 0;
  for (const t of paddedTokens) {
    if (hay.includes(t)) hit++;
  }
  return hit / paddedTokens.length;
}

const padTokens = (tokens) => tokens.map(t => ' ' + t);

// Стог в виде, который ждёт prefixCoverage: нижний регистр + ведущий пробел,
// чтобы первое слово искалось тем же « t», что и остальные.
function padHay(searchText) {
  return ' ' + String(searchText || '').toLowerCase().replace(/\s+/g, ' ').trim();
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

function carName(car) {
  return car.name_normalized
    || normalize([car.brand, car.model, car.generation, car.engine_code].filter(Boolean).join(' '));
}

/**
 * Досчитать поле search_text каждой машине снимка (один раз после загрузки).
 * rankCars умеет работать и без него, но тогда стог считается на каждый ввод.
 */
export function augmentCars(cars) {
  return cars.map(c => (c.search_text ? c : { ...c, search_text: buildCarSearchText(c) }));
}

/**
 * Предвычисленные структуры скоринга в поле _search: id-триграммы имени и
 * модели поверх общего словаря снимка + стог одной строкой. Считается один раз
 * на снимок, чтобы scoreCar не пересобирал их на каждую машину при каждом
 * вводе. Идемпотентна, вход не мутирует; rankCars даёт бит-в-бит ту же выдачу
 * с _search и без него.
 *
 * Словарь триграмм общий на снимок и лежит в самом _search — по нему rankCars
 * понимает, что машины подготовлены им же, и переводит запрос в те же id.
 */
export function prepareCars(cars) {
  let dict = null;
  return cars.map(c => {
    // Уже подготовленная машина едет как есть, а её словарь подхватываем —
    // повторный prepareCars по своему же снимку ничего не пересобирает.
    if (c._search) { dict = dict || c._search.dict; return c; }
    if (!dict) dict = new Map();
    const name = carName(c);
    const modelLower = String(c.model || '').toLowerCase();
    const nameSet = trigramSet(name);
    const modelSet = modelLower ? trigramSet(modelLower) : null;
    // search_text на объекте не держим: он нужен только чтобы собрать hay, а
    // это ещё ~6 МБ на снимок, которые незачем возить в память телефона.
    const { search_text: _drop, ...rest } = c;
    return {
      ...rest,
      _search: {
        dict,
        nameIds: trigramIds(nameSet, dict, true),
        nameSize: nameSet.size,
        nameLower: name.toLowerCase(),
        hay: padHay(c.search_text || buildCarSearchText(c)),
        modelIds: modelSet ? trigramIds(modelSet, dict, true) : null,
        modelSize: modelSet ? modelSet.size : 0,
      },
    };
  });
}

// Порог триграммного оператора % в pg_trgm по умолчанию.
const SIMILARITY_THRESHOLD = 0.3;
// word_similarity-ветка WHERE в серверном запросе.
const WSIM_THRESHOLD = 0.35;

// Пер-машинные структуры для «сырой» машины (без prepareCars): тот же набор
// полей, но триграммы — обычными Set-ами, без словаря.
function looseSearch(car) {
  const name = carName(car);
  const modelLower = String(car.model || '').toLowerCase();
  return {
    dict: null,
    nameSet: trigramSet(name),
    nameLower: name.toLowerCase(),
    hay: padHay(car.search_text || buildCarSearchText(car)),
    modelSet: modelLower ? trigramSet(modelLower) : null,
  };
}

function scoreCar(car, ctx) {
  const { variantData, queryWordSets, nums, base, dict } = ctx;

  // Из _search (prepareCars, один раз на снимок) — или на лету, старое
  // поведение для «сырых» машин и для снимков, подготовленных другим словарём.
  const prepared = dict && car._search && car._search.dict === dict;
  const s = prepared ? car._search : looseSearch(car);
  const nameSize = prepared ? s.nameSize : s.nameSet.size;
  const modelSize = prepared ? s.modelSize : (s.modelSet ? s.modelSet.size : 0);

  let maxSim = 0;
  let maxWsim = 0;
  let maxPrefix = 0;
  let tsMatch = false;
  let trigramMatch = false;

  for (const v of variantData) {
    // по name_normalized (латиница)
    const inter = prepared
      ? intersectionSizeIds(s.nameIds, v.ids)
      : intersectionSize(s.nameSet, v.set);
    const sim = jaccard(inter, nameSize, v.size);
    const wsim = v.size ? inter / v.size : 0;
    if (sim > maxSim) maxSim = sim;
    if (wsim > maxWsim) maxWsim = wsim;
    if (sim >= SIMILARITY_THRESHOLD) trigramMatch = true;

    const cov = prefixCoverage(v.tokens, s.hay); // по расширенному стогу
    if (cov > maxPrefix) maxPrefix = cov;
    if (cov >= 1) tsMatch = true;
  }

  // Модельный бонус: каждое слово запроса против модели отдельно.
  let modelSim = 0;
  if (modelSize) {
    for (const qw of queryWordSets) {
      const inter = prepared
        ? intersectionSizeIds(s.modelIds, qw.ids)
        : intersectionSize(s.modelSet, qw.set);
      const sm = jaccard(inter, modelSize, qw.size);
      if (sm > modelSim) modelSim = sm;
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

  const substringMatch = base.length > 0 && s.nameLower.includes(base);
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
  // Словарь снимка (если он подготовлен) — по нему переводим запрос в те же id.
  const dict = cars.length && cars[0]._search ? cars[0]._search.dict : null;
  // Пер-запросные структуры считаются один раз, а не в scoreCar на каждую машину.
  const variantData = variants.map(v => {
    const set = trigramSet(v);
    return {
      set,
      size: set.size,
      ids: dict ? trigramIds(set, dict, false) : null,
      tokens: padTokens(variantTokens(v)),
    };
  });
  const queryWordSets = queryWords.map(w => {
    const set = trigramSet(w);
    return { set, size: set.size, ids: dict ? trigramIds(set, dict, false) : null };
  });
  const ctx = { variantData, queryWordSets, nums, base, dict };

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
export const _internals = { trigramSet, similarity, wordSimilarityFromSets, prefixCoverage, padHay, parseNums };
