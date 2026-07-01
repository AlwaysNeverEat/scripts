#!/usr/bin/env node
// Проверка качества поиска: «запрос → ожидаемый top-1».
// Требует запущенный backend и засеянную базу (scripts/seed.js).
// Запуск: API_BASE=http://localhost:3001 API_KEY=... node scripts/search-check.mjs

const API_BASE = process.env.API_BASE || 'http://localhost:3001';
const API_KEY  = process.env.API_KEY  || 'local-dev-key';

// [запрос, ожидаемые brand+model лидера]
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
    // опечатки
    ['фокс форд',         'FORD FOCUS'],
    ['тигуан фольц',      'VW TIGUAN'],
    ['дастер',            'RENAULT DUSTER'],
    // по коду двигателя
    ['G4FC',              'KIA RIO'],
    // с годом и объёмом
    ['форд фокус 1.6 2015', 'FORD FOCUS'],
];

let pass = 0, fail = 0;
for (const [q, expected] of FIXTURES) {
    const res = await fetch(`${API_BASE}/api/cars/search?q=${encodeURIComponent(q)}`,
        { headers: { 'x-api-key': API_KEY } });
    const rows = await res.json();
    const top = rows[0] ? `${rows[0].brand} ${rows[0].model}` : '(пусто)';
    if (top === expected) {
        pass++;
        console.log(`✓ «${q}» → ${top}`);
    } else {
        fail++;
        console.log(`✗ «${q}» → ${top}, ожидали ${expected}`);
        console.log('   выдача:', rows.slice(0, 3).map(r => `${r.brand} ${r.model} (${Number(r.score).toFixed(2)})`).join(' | '));
    }
}

console.log(`\n${pass}/${FIXTURES.length} запросов дали ожидаемый top-1`);
process.exit(fail ? 1 : 0);
