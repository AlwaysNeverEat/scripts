// Планка качества клиентского поиска: те же фикстуры, что у серверного
// backend/scripts/search-check.mjs — «запрос → ожидаемый top-1». Машины
// строятся через buildNameFields ровно как в БД (name_normalized), плюс
// augmentCars досчитывает search_text (синонимы/транслит), как search_vector.
// Запуск: node --test shared/carSearch.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNameFields } from './translit.js';
import { rankCars, augmentCars } from './carSearch.js';

// Помощник: собрать машину со всеми полями, что нужны ранкеру, и посчитать
// name_normalized так же, как это делает upsertSearchFields на сервере.
function car(brand, model, { generation = null, engine_code = null, engine_volume = null, year_from, year_to = null } = {}) {
  const { nameNormalized } = buildNameFields(brand, model, generation, engine_code, engine_volume, year_from, year_to);
  return {
    id: `${brand}-${model}`.toLowerCase().replace(/\s+/g, '-'),
    brand, model, generation, engine_code, engine_volume, year_from, year_to,
    name_normalized: nameNormalized,
  };
}

// Снимок из сид-данных (backend/scripts/seed.js) + несколько «однобрендовых»
// соседей, чтобы top-1 действительно проверял ранжирование, а не наличие.
const SNAPSHOT = augmentCars([
  car('FORD', 'FOCUS',    { engine_code: 'IQDB',   engine_volume: 1.6, year_from: 2011, year_to: 2019 }),
  car('FORD', 'KUGA',     { engine_code: 'JQMA',   engine_volume: 1.6, year_from: 2013 }),
  car('FORD', 'MONDEO',   { engine_code: 'QXBA',   engine_volume: 2.0, year_from: 2007, year_to: 2014 }),
  car('KIA',  'RIO',      { engine_code: 'G4FC',   engine_volume: 1.6, year_from: 2011, year_to: 2017 }),
  car('KIA',  'SPORTAGE', { engine_code: 'G4NA',   engine_volume: 2.0, year_from: 2016 }),
  car('HYUNDAI', 'SOLARIS', { engine_code: 'G4FG', engine_volume: 1.6, year_from: 2017 }),
  car('HYUNDAI', 'CRETA',   { engine_code: 'G4FG', engine_volume: 1.6, year_from: 2016 }),
  car('MERCEDES', 'C 180', { engine_code: 'M271910', engine_volume: 1.8, year_from: 2007, year_to: 2014 }),
  car('MERCEDES', 'E 200', { engine_code: 'M274920', engine_volume: 2.0, year_from: 2013 }),
  car('BMW', '320i',      { engine_code: 'N46B20',  engine_volume: 2.0, year_from: 2005, year_to: 2011 }),
  car('VW', 'TIGUAN',     { engine_code: 'CAWA',    engine_volume: 2.0, year_from: 2008, year_to: 2016 }),
  car('VW', 'POLO',       { engine_code: 'CFNA',    engine_volume: 1.6, year_from: 2010, year_to: 2020 }),
  car('SKODA', 'OCTAVIA', { engine_code: 'CDAB',    engine_volume: 1.8, year_from: 2009, year_to: 2013 }),
  car('TOYOTA', 'CAMRY',  { engine_code: '2AR-FE',  engine_volume: 2.5, year_from: 2011, year_to: 2018 }),
  car('TOYOTA', 'RAV4',   { engine_code: '3ZR-FE',  engine_volume: 2.0, year_from: 2013, year_to: 2019 }),
  car('NISSAN', 'QASHQAI',{ engine_code: 'MR20DE',  engine_volume: 2.0, year_from: 2007, year_to: 2013 }),
  car('RENAULT', 'DUSTER',{ engine_code: 'F4R',     engine_volume: 2.0, year_from: 2012, year_to: 2020 }),
  car('LADA', 'VESTA',    { engine_code: '21129',   engine_volume: 1.6, year_from: 2015 }),
  car('LADA', 'GRANTA',   { engine_code: '11186',   engine_volume: 1.6, year_from: 2011 }),
]);

// [запрос, ожидаемый «brand model» лидера] — из search-check.mjs.
const FIXTURES = [
  // кириллица
  ['форд фокус',        'FORD FOCUS'],
  ['киа рио',           'KIA RIO'],
  ['мерседес с 180',    'MERCEDES C 180'],
  ['тойота камри',      'TOYOTA CAMRY'],
  ['кашкай',            'NISSAN QASHQAI'],
  ['лада веста',        'LADA VESTA'],
  // латиница
  ['ford focus',        'FORD FOCUS'],
  ['kia rio 1.6',       'KIA RIO'],
  // частичный ввод (префиксы)
  ['фор фок',           'FORD FOCUS'],
  ['мерс с 18',         'MERCEDES C 180'],
  ['солярис',           'HYUNDAI SOLARIS'],
  ['октав',             'SKODA OCTAVIA'],
  // опечатки / порядок слов
  ['фокс форд',         'FORD FOCUS'],
  ['тигуан фольц',      'VW TIGUAN'],
  ['дастер',            'RENAULT DUSTER'],
  // по коду двигателя
  ['G4FC',              'KIA RIO'],
  // с годом и объёмом
  ['форд фокус 1.6 2015', 'FORD FOCUS'],
];

for (const [q, expected] of FIXTURES) {
  test(`«${q}» → ${expected}`, () => {
    const rows = rankCars(q, SNAPSHOT);
    const top = rows[0] ? `${rows[0].brand} ${rows[0].model}` : '(пусто)';
    assert.equal(top, expected,
      `выдача: ${rows.slice(0, 3).map(r => `${r.brand} ${r.model}`).join(' | ') || '(пусто)'}`);
  });
}

test('пустой запрос → пусто', () => {
  assert.deepEqual(rankCars('', SNAPSHOT), []);
  assert.deepEqual(rankCars('   ', SNAPSHOT), []);
});

test('мусорный запрос без совпадений → пусто', () => {
  assert.deepEqual(rankCars('zzzxqwtplk', SNAPSHOT), []);
});
