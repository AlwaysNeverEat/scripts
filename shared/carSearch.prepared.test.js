// Гарантия того, что prepareCars — чистое кэширование: rankCars по
// подготовленному снимку даёт ровно ту же выдачу, что по «сырому»
// (augmentCars-only), на всех фикстурах качества и краевых запросах.
// Запуск: node --test shared/carSearch.prepared.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNameFields } from './translit.js';
import { rankCars, augmentCars, prepareCars } from './carSearch.js';

function car(brand, model, { generation = null, engine_code = null, engine_volume = null, year_from, year_to = null } = {}) {
  const { nameNormalized } = buildNameFields(brand, model, generation, engine_code, engine_volume, year_from, year_to);
  return {
    id: `${brand}-${model}`.toLowerCase().replace(/\s+/g, '-'),
    brand, model, generation, engine_code, engine_volume, year_from, year_to,
    name_normalized: nameNormalized,
  };
}

const RAW = [
  car('FORD', 'FOCUS',    { engine_code: 'IQDB',   engine_volume: 1.6, year_from: 2011, year_to: 2019 }),
  car('FORD', 'KUGA',     { engine_code: 'JQMA',   engine_volume: 1.6, year_from: 2013 }),
  car('KIA',  'RIO',      { engine_code: 'G4FC',   engine_volume: 1.6, year_from: 2011, year_to: 2017 }),
  car('HYUNDAI', 'SOLARIS', { engine_code: 'G4FG', engine_volume: 1.6, year_from: 2017 }),
  car('MERCEDES', 'C 180', { engine_code: 'M271910', engine_volume: 1.8, year_from: 2007, year_to: 2014 }),
  car('BMW', '320i',      { engine_code: 'N46B20',  engine_volume: 2.0, year_from: 2005, year_to: 2011 }),
  car('VW', 'TIGUAN',     { engine_code: 'CAWA',    engine_volume: 2.0, year_from: 2008, year_to: 2016 }),
  car('SKODA', 'OCTAVIA', { engine_code: 'CDAB',    engine_volume: 1.8, year_from: 2009, year_to: 2013 }),
  car('TOYOTA', 'CAMRY',  { engine_code: '2AR-FE',  engine_volume: 2.5, year_from: 2011, year_to: 2018 }),
  car('NISSAN', 'QASHQAI',{ engine_code: 'MR20DE',  engine_volume: 2.0, year_from: 2007, year_to: 2013 }),
  car('RENAULT', 'DUSTER',{ engine_code: 'F4R',     engine_volume: 2.0, year_from: 2012, year_to: 2020 }),
  car('LADA', 'VESTA',    { engine_code: '21129',   engine_volume: 1.6, year_from: 2015 }),
  // Машина без модели/кода — проверяет ветки modelSet=null и пустых полей.
  { id: 'no-model', brand: 'UAZ', model: '', generation: null, engine_code: null,
    engine_volume: null, year_from: null, year_to: null, name_normalized: 'uaz' },
];

const QUERIES = [
  // те же классы запросов, что в carSearch.test.js
  'форд фокус', 'киа рио', 'мерседес с 180', 'тойота камри', 'кашкай',
  'ford focus', 'kia rio 1.6', 'фор фок', 'мерс с 18', 'октав',
  'фокс форд', 'тигуан фольц', 'дастер', 'G4FC', 'форд фокус 1.6 2015',
  // краевые: 1 символ, кириллица/латиница, числа, мусор
  'о', 'x', 'ф', '1.6', '2015', 'zzzxqwtplk', '  ', '',
];

const ids = cars => cars.map(c => c.id);

test('prepareCars: выдача идентична augmentCars на всех запросах', () => {
  const augmented = augmentCars(RAW);
  const prepared = prepareCars(RAW);
  for (const q of QUERIES) {
    assert.deepEqual(
      ids(rankCars(q, prepared)),
      ids(rankCars(q, augmented)),
      `расхождение выдачи на запросе «${q}»`,
    );
  }
});

test('prepareCars идемпотентна', () => {
  const once = prepareCars(RAW);
  const twice = prepareCars(once);
  for (const q of QUERIES) {
    assert.deepEqual(ids(rankCars(q, twice)), ids(rankCars(q, once)));
  }
});

test('prepareCars не мутирует вход', () => {
  const input = RAW.map(c => ({ ...c }));
  const before = JSON.stringify(input);
  prepareCars(input);
  assert.equal(JSON.stringify(input), before);
  assert.ok(!input.some(c => c._search || c.search_text));
});

// Ради этого prepareCars и переписывалась: Set строк на каждую машину давал
// ~46 МБ на 13к машин, и на телефоне вкладку выгружало прямо во время поиска
// (см. комментарий в carSearch.js). Тест держит компактное представление —
// общий словарь снимка + Uint32Array id — чтобы оно не уехало назад к Set-ам.
test('prepareCars: триграммы лежат в общем словаре, а не в Set на каждую машину', () => {
  const prepared = prepareCars(RAW);
  const dict = prepared[0]._search.dict;
  assert.ok(dict instanceof Map);
  for (const c of prepared) {
    assert.equal(c._search.dict, dict, 'словарь должен быть один на снимок');
    assert.ok(c._search.nameIds instanceof Uint32Array);
    assert.equal(c._search.nameIds.length, c._search.nameSize);
    assert.ok(c._search.modelIds === null || c._search.modelIds instanceof Uint32Array);
    assert.equal(typeof c._search.hay, 'string');
    assert.ok(!('nameSet' in c._search), 'Set триграмм на машину — тот самый перерасход памяти');
  }
  // id отсортированы: пересечение считается слиянием
  const ids = [...prepared[0]._search.nameIds];
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
});

test('результаты rankCars по prepared-снимку без служебных полей не теряют машин', () => {
  const rows = rankCars('форд фокус', prepareCars(RAW));
  assert.ok(rows.length > 0);
  // _search едет на объектах результата — main поток его срезает в воркере;
  // здесь фиксируем, что карточные поля на месте.
  assert.equal(rows[0].brand, 'FORD');
  assert.equal(rows[0].model, 'FOCUS');
});
