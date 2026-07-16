// Запуск:  node --test backend/scripts/import/lukoil-parse.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    parseLukoilRecommendation, parseEquipmentModel, classifyAggregate,
    mapFuelType, buildLukoilCar,
} from './lukoil-parse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, '__fixtures__', 'lukoil');
const niva = fs.readFileSync(path.join(FIX, 'recommend-lada-niva-21214.html'), 'utf8');
const rio = fs.readFileSync(path.join(FIX, 'recommend-kia-rio.html'), 'utf8');

test('Нива: узлы и объёмы (двигатель, дифференциалы, раздатка)', () => {
    const f = parseLukoilRecommendation(niva);
    assert.ok(f.engine, 'есть двигатель');
    assert.equal(f.engine.volumeService, 3.75);
    assert.equal(f.engine.volume, 3.75);
    assert.equal(f.engine.volumeAbsent, false);
    assert.ok(f.diffFront && f.diffFront.volume === 1.15, 'передний дифференциал 1.15');
    assert.ok(f.diffRear && f.diffRear.volume === 1.3, 'задний дифференциал 1.3');
    assert.ok(f.transfer && f.transfer.volume === 0.75, 'раздатка 0.75');
    // МКПП у Нивы без объёма → volumeAbsent
    assert.ok(f.manual, 'есть МКПП');
    assert.equal(f.manual.volumeAbsent, true, 'у МКПП объём отсутствует');
    // рекомендованный продукт двигателя подхватился
    assert.ok(f.engine.motulProducts.some(p => /GENESIS/i.test(p)), 'есть продукт LUKOIL');
});

test('Kia Rio: есть двигатель и хотя бы одна КПП', () => {
    const f = parseLukoilRecommendation(rio);
    assert.ok(f.engine && f.engine.volume > 0, 'двигатель с объёмом');
    assert.ok(f.manual || f.automatic, 'есть механика или автомат');
});

test('parseEquipmentModel: модель / объём / двигатель / код', () => {
    assert.deepEqual(parseEquipmentModel('RIO Hatchback II 1.5 CRDi'),
        { modelName: 'RIO Hatchback II', engineVolume: 1.5, engineName: 'CRDi', engineCode: 'CRDi' });
    assert.deepEqual(parseEquipmentModel('2121 1.7 (21214)'),
        { modelName: '2121', engineVolume: 1.7, engineName: null, engineCode: '21214' });
    // «16V» не должно ловиться как объём (нет точки) — объём 1.5
    const v16 = parseEquipmentModel('RIO I 1.5 16V');
    assert.equal(v16.engineVolume, 1.5);
    assert.equal(v16.modelName, 'RIO I');
    // без объёма
    const noVol = parseEquipmentModel('AMANTI V6');
    assert.equal(noVol.engineVolume, null);
});

test('classifyAggregate: ярлыки Лукойла', () => {
    assert.equal(classifyAggregate('Двигатель').key, 'engine');
    assert.equal(classifyAggregate('Механическая КПП').key, 'manual');
    assert.equal(classifyAggregate('Автоматическая КПП').key, 'automatic');
    assert.equal(classifyAggregate('Передний дифференциал').key, 'diffFront');
    assert.equal(classifyAggregate('Задний дифференциал').key, 'diffRear');
    assert.equal(classifyAggregate('Раздаточная коробка').key, 'transfer');
    const cvt = classifyAggregate('Вариатор (CVT)');
    assert.equal(cvt.key, 'automatic'); assert.equal(cvt.isCvt, true);
    assert.equal(classifyAggregate('Система охлаждения'), null);
    assert.equal(classifyAggregate('Тормозная система'), null);
});

test('mapFuelType', () => {
    assert.equal(mapFuelType('Petrol'), '01');
    assert.equal(mapFuelType('Diesel'), '05');
    assert.equal(mapFuelType('Electric'), null);
    assert.equal(mapFuelType('', 'X-TREK 2.0 CRDi'), '05'); // эвристика по CRDi
});

test('buildLukoilCar: полная запись из Нивы', () => {
    const equipment = {
        mid: '<mid>', model: '2121 1.7 (21214)', engine_output_kw: 59, engine_output_hp: 83,
        year_from: 1996, year_to: 2006, fuel_type_name: 'Бензин', fuel_type_name_en: 'Petrol',
        generations: '2121, 2131', drive_types: ['Part-time 4WD'],
    };
    const car = buildLukoilCar({
        manufacturerName: 'LADA (VAZ)', manufacturerId: 168, equipment,
        recommendationHtml: niva,
        sourceUrl: 'https://lukoil.lubribase.ru/ru/lukoil?category_group_id=2&manufacturer_id=168&engine_volume=1.7',
    });
    assert.equal(car.brand, 'LADA');
    assert.equal(car.model, '2121');
    assert.equal(car.generation, '2121, 2131');
    assert.equal(car.engine_code, '21214');
    assert.equal(car.engine_volume, 1.7);
    assert.equal(car.kw, 59);
    assert.equal(car.bhp, 83);
    assert.equal(car.fuel_type, '01');
    assert.equal(car.year_from, 1996);
    assert.equal(car.fluid_capacities.engine.volume, 3.75);
    assert.ok(car.fluid_capacities.diffFront && car.fluid_capacities.diffRear, 'оба дифференциала');
    assert.ok(car.source_links.lukoil, 'ссылка на источник');
    assert.ok(car._type_key.startsWith('lukoil|168|'), '_type_key стабилен');
    // предупреждение про объём МКПП
    assert.ok(car._warnings.some(w => /объём/.test(w)), 'есть предупреждение о недостающем объёме');
});
