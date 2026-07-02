#!/usr/bin/env node
// Заполнение базы тестовыми машинами (для разработки и проверки поиска).
// Запуск: DATABASE_URL=postgres://... node scripts/seed.js
// Идёт через POST /api/cars? Нет — напрямую в БД, чтобы не зависеть от API-ключа.

import { query } from '../src/db/client.js';
import { buildNameFields } from '../src/search/translit.js';

const CARS = [
    { brand: 'FORD', model: 'FOCUS', engine_code: 'IQDB', engine_volume: 1.6, year_from: 2011, year_to: 2019, bhp: 105, fuel_type: '01',
      fluid_capacities: { engine: { volumeService: 4.1 } }, car_approvals: ['FORD WSS-M2C913-C'] },
    { brand: 'FORD', model: 'KUGA', engine_code: 'JQMA', engine_volume: 1.6, year_from: 2013, bhp: 150, fuel_type: '01',
      fluid_capacities: { engine: { volumeService: 4.1 } }, car_approvals: ['FORD WSS-M2C913-C'] },
    { brand: 'FORD', model: 'MONDEO', engine_code: 'QXBA', engine_volume: 2.0, year_from: 2007, year_to: 2014, bhp: 140, fuel_type: '05',
      fluid_capacities: { engine: { volumeService: 5.5 } }, car_approvals: ['FORD WSS-M2C913-B'] },
    { brand: 'KIA', model: 'RIO', engine_code: 'G4FC', engine_volume: 1.6, year_from: 2011, year_to: 2017, bhp: 123, fuel_type: '01',
      fluid_capacities: { engine: { volumeService: 3.3 } }, car_approvals: ['API SM'] },
    { brand: 'KIA', model: 'SPORTAGE', engine_code: 'G4NA', engine_volume: 2.0, year_from: 2016, bhp: 150, fuel_type: '01',
      fluid_capacities: { engine: { volumeService: 4.0 } }, car_approvals: ['API SN'] },
    { brand: 'HYUNDAI', model: 'SOLARIS', engine_code: 'G4FG', engine_volume: 1.6, year_from: 2017, bhp: 123, fuel_type: '01',
      fluid_capacities: { engine: { volumeService: 3.3 } }, car_approvals: ['API SN'] },
    { brand: 'MERCEDES', model: 'C 180', engine_code: 'M271910', engine_volume: 1.8, year_from: 2007, year_to: 2014, bhp: 156, fuel_type: '01',
      fluid_capacities: { engine: { volumeService: 5.5 } }, car_approvals: ['MB 229.3', 'MB 229.5'] },
    { brand: 'MERCEDES', model: 'E 200', engine_code: 'M274920', engine_volume: 2.0, year_from: 2013, bhp: 184, fuel_type: '01',
      fluid_capacities: { engine: { volumeService: 5.9 } }, car_approvals: ['MB 229.5'] },
    { brand: 'BMW', model: '320i', engine_code: 'N46B20', engine_volume: 2.0, year_from: 2005, year_to: 2011, kw: 110, fuel_type: '01',
      fluid_capacities: { engine: { volumeService: 4.25 } }, car_approvals: ['LL 01'] },
    { brand: 'VW', model: 'TIGUAN', engine_code: 'CAWA', engine_volume: 2.0, year_from: 2008, year_to: 2016, bhp: 170, fuel_type: '01',
      fluid_capacities: { engine: { volumeService: 4.6 } }, car_approvals: ['VW 502 00'] },
    { brand: 'VW', model: 'POLO', engine_code: 'CFNA', engine_volume: 1.6, year_from: 2010, year_to: 2020, bhp: 105, fuel_type: '01',
      fluid_capacities: { engine: { volumeService: 3.6 } }, car_approvals: ['VW 502 00'] },
    { brand: 'SKODA', model: 'OCTAVIA', engine_code: 'CDAB', engine_volume: 1.8, year_from: 2009, year_to: 2013, bhp: 152, fuel_type: '01',
      fluid_capacities: { engine: { volumeService: 4.6 } }, car_approvals: ['VW 502 00'] },
    { brand: 'TOYOTA', model: 'CAMRY', engine_code: '2AR-FE', engine_volume: 2.5, year_from: 2011, year_to: 2018, bhp: 181, fuel_type: '01',
      fluid_capacities: { engine: { volumeService: 4.4 } }, car_approvals: ['API SN'] },
    { brand: 'TOYOTA', model: 'RAV4', engine_code: '3ZR-FE', engine_volume: 2.0, year_from: 2013, year_to: 2019, bhp: 146, fuel_type: '01',
      fluid_capacities: { engine: { volumeService: 4.2 } }, car_approvals: ['API SN'] },
    { brand: 'NISSAN', model: 'QASHQAI', engine_code: 'MR20DE', engine_volume: 2.0, year_from: 2007, year_to: 2013, bhp: 141, fuel_type: '01',
      fluid_capacities: { engine: { volumeService: 3.8 }, automatic: { volumeTotal: 8.3, isCvt: true } }, car_approvals: ['RN 0700'] },
    { brand: 'RENAULT', model: 'DUSTER', engine_code: 'F4R', engine_volume: 2.0, year_from: 2012, year_to: 2020, bhp: 135, fuel_type: '01',
      fluid_capacities: { engine: { volumeService: 5.4 } }, car_approvals: ['RN 0700', 'RN 0710'] },
    { brand: 'LADA', model: 'VESTA', engine_code: '21129', engine_volume: 1.6, year_from: 2015, bhp: 106, fuel_type: '01',
      fluid_capacities: { engine: { volumeService: 4.4 } }, car_approvals: ['АВТОВАЗ'] },
];

const defaultFilters = { vf: { part: 'W 914/2', absent: false }, mf: { part: 'C 22 117', absent: false }, sf: { part: null, absent: true } };

let created = 0;
for (const car of CARS) {
    const { nameNormalized, nameCyrillic, nameTranslit, synonymTokens } = buildNameFields(
        car.brand, car.model, null, car.engine_code, car.engine_volume, car.year_from, car.year_to);
    const svTokens = synonymTokens.flatMap(s => s.split(/\s+/)).filter(Boolean)
        .map(t => t.replace(/'/g, "''")).join(' ');

    const r = await query(
        `INSERT INTO cars (brand, model, engine_code, engine_volume, year_from, year_to, kw, bhp, fuel_type,
                           fluid_capacities, filter_part_numbers, car_approvals,
                           name_normalized, name_cyrillic, name_translit, search_vector, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,to_tsvector('simple', $16),'seed')
         ON CONFLICT (lower(brand), lower(model), lower(coalesce(engine_code,'')), coalesce(engine_volume,0), year_from)
         DO NOTHING
         RETURNING id`,
        [car.brand, car.model, car.engine_code, car.engine_volume, car.year_from, car.year_to ?? null,
         car.kw ?? null, car.bhp ?? null, car.fuel_type,
         JSON.stringify(car.fluid_capacities), JSON.stringify(defaultFilters), JSON.stringify(car.car_approvals),
         nameNormalized, nameCyrillic, nameTranslit, svTokens],
    );
    if (r.rows.length) created++;
}

console.log(`seed: добавлено ${created} машин (из ${CARS.length}; существующие пропущены)`);
process.exit(0);
