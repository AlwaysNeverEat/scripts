import test from 'node:test';
import assert from 'node:assert/strict';

import {
    crmQuirksFor, crmQuirksForAggregate, crmNoFullAt, crmPrefersPartial, CRM_QUIRKS,
} from './crmQuirks.js';

const car = (make, model, extra = {}) => ({ makeShort: make, modelShort: model, ...extra });
const AT  = { automatic: { volumeTotal: 8 } };
const CVT = { automatic: { volumeTotal: 8, isCvt: true } };
const DCT = { automatic: { volumeTotal: 6, isDct: true } };
const MT  = { manual: { volumeTotal: 2 } };
const ids = (list) => list.map(q => q.id);

test('у каждого правила уникальный id и заполненный текст', () => {
    const seen = new Set();
    for (const q of CRM_QUIRKS) {
        assert.ok(q.id && !seen.has(q.id), `дубль id: ${q.id}`);
        seen.add(q.id);
        assert.ok(q.text && q.text.length > 10, `пустой текст у ${q.id}`);
        assert.ok(['engine', 'automatic', 'manual', 'general'].includes(q.scope), `scope у ${q.id}`);
        assert.ok(['block', 'warn', 'info'].includes(q.severity), `severity у ${q.id}`);
    }
});

test('Skoda не внедорожник — полную не делаем, внедорожнику смотрим по факту', () => {
    const octavia = crmQuirksFor(car('Skoda', 'Octavia'), AT);
    assert.ok(ids(octavia).includes('skoda-seat-at-no-full'));
    assert.ok(crmNoFullAt(car('Skoda', 'Octavia'), AT));

    const kodiaq = crmQuirksFor(car('Skoda', 'Kodiaq'), AT);
    assert.ok(ids(kodiaq).includes('skoda-seat-suv-at-by-fact'));
    assert.ok(!ids(kodiaq).includes('skoda-seat-at-no-full'));
    assert.ok(!crmNoFullAt(car('Skoda', 'Kodiaq'), AT), 'внедорожнику полная не запрещена');
});

test('«полную не делаем» всегда оговаривает, что частичную делаем', () => {
    for (const q of CRM_QUIRKS.filter(x => x.noFullAt)) {
        assert.match(q.text, /астичн/, `у ${q.id} нет слова про частичную замену`);
    }
});

test('Audi A4 — вариатор, A3 — не он', () => {
    assert.ok(ids(crmQuirksFor(car('Audi', 'A4 Allroad'), AT)).includes('audi-a456-cvt-no-full'));
    assert.ok(!ids(crmQuirksFor(car('Audi', 'A3'), AT)).includes('audi-a456-cvt-no-full'));
});

test('Ford: нейтраль на МКПП, Kuga без полной', () => {
    assert.ok(ids(crmQuirksFor(car('Ford', 'Focus'), MT)).includes('ford-manual-neutral'));
    assert.ok(ids(crmQuirksFor(car('Ford', 'Focus'), MT)).includes('ford-focus-manual-dctf'));
    assert.ok(crmNoFullAt(car('Ford', 'Kuga'), AT));
});

test('французы — полную не делаем всем моделям', () => {
    for (const brand of ['Citroen', 'Citroën', 'Peugeot', 'Renault', 'Пежо']) {
        assert.ok(crmNoFullAt(car(brand, 'Что угодно'), AT), brand);
    }
});

test('Mazda 6 ловится и как «6», и как «Mazda6»', () => {
    assert.ok(crmNoFullAt(car('Mazda', '6'), AT));
    assert.ok(crmNoFullAt(car('Mazda', 'Mazda6'), AT));
    assert.ok(!crmNoFullAt(car('Mazda', 'CX-5'), AT));
});

test('экспресс-замену ДВС не делаем только перечисленным моделям', () => {
    assert.ok(ids(crmQuirksFor(car('Toyota', 'Land Cruiser 200'), {})).includes('engine-no-express'));
    assert.ok(ids(crmQuirksFor(car('Toyota', 'Land Cruiser Prado'), {})).includes('engine-no-express'));
    assert.ok(ids(crmQuirksFor(car('Mitsubishi', 'Pajero Sport'), {})).includes('engine-no-express'));
    assert.ok(!ids(crmQuirksFor(car('Toyota', 'Land Cruiser 300'), {})).includes('engine-no-express'));
    assert.ok(!ids(crmQuirksFor(car('Mitsubishi', 'Pajero'), {})).includes('engine-no-express'));
});

test('вариаторный фильтр тонкой очистки — только вариаторам Nissan и Outlander', () => {
    assert.ok(ids(crmQuirksFor(car('Nissan', 'Qashqai'), CVT)).includes('nissan-cvt-fine-filter'));
    assert.ok(!ids(crmQuirksFor(car('Nissan', 'Qashqai'), AT)).includes('nissan-cvt-fine-filter'));
    assert.ok(ids(crmQuirksFor(car('Mitsubishi', 'Outlander III'), CVT)).includes('nissan-cvt-fine-filter'));
});

test('фильтр АКПП: подсказка про шестиступки не лезет к BMW, Mercedes, вариаторам и роботам', () => {
    assert.ok(ids(crmQuirksFor(car('Kia', 'Sportage'), AT)).includes('at-filter-6ab'));
    assert.ok(!ids(crmQuirksFor(car('BMW', 'X5'), AT)).includes('at-filter-6ab'));
    assert.ok(!ids(crmQuirksFor(car('Mercedes-Benz', 'E200'), AT)).includes('at-filter-6ab'));
    assert.ok(!ids(crmQuirksFor(car('Nissan', 'Qashqai'), CVT)).includes('at-filter-6ab'));
});

test('DSG и PowerShift не обслуживаем, прочие роботы — как есть', () => {
    assert.ok(ids(crmQuirksFor(car('Volkswagen', 'Golf'), DCT)).includes('dsg-powershift-no-service'));
    assert.ok(ids(crmQuirksFor(car('Ford', 'Fiesta'), DCT)).includes('dsg-powershift-no-service'));
    assert.ok(ids(crmQuirksFor(car('Chery', 'Tiggo 8'), DCT)).includes('robot-other-as-is'));
    assert.ok(ids(crmQuirksFor(car('Chery', 'Tiggo 8'), DCT)).includes('chery-tiggo8-getrag'));
});

test('Touareg 3.6 — предупреждение про теплообменник, 3.0 — нет', () => {
    const v36 = car('Volkswagen', 'Touareg', { volume: '3.6' });
    const v30 = car('Volkswagen', 'Touareg', { volume: '3.0' });
    assert.ok(ids(crmQuirksFor(v36, {})).includes('touareg-cayenne-oil-filter'));
    assert.ok(!ids(crmQuirksFor(v30, {})).includes('touareg-cayenne-oil-filter'));
});

test('AQ 300-8F ловится по коду мотора DJKA', () => {
    const taos = car('Volkswagen', 'Taos');
    assert.ok(ids(crmQuirksFor(taos, AT)).includes('vag-aq300-atf'));
    const octaviaA8 = car('Skoda', 'Octavia', { engineCode: 'DJKA', volume: '1.4' });
    assert.ok(ids(crmQuirksFor(octaviaA8, AT)).includes('vag-aq300-atf'));
    const octaviaOld = car('Skoda', 'Octavia', { volume: '1.8', yearFrom: 2010 });
    assert.ok(!ids(crmQuirksFor(octaviaOld, AT)).includes('vag-aq300-atf'));
});

test('запись базы (brand/model/engine_volume) читается так же, как car калькулятора', () => {
    const rec = { brand: 'Volvo', model: 'XC60', engine_volume: 2.0, year_from: 2015 };
    assert.ok(crmNoFullAt(rec, AT));
    assert.equal(crmQuirksFor(rec, AT)[0].scope, 'automatic');
});

test('особенности раскладываются по карточкам агрегатов', () => {
    const kia = car('Kia', 'Rio');
    const data = { engine: {}, ...AT, ...MT };
    const eng = crmQuirksForAggregate(kia, data, { key: 'engine', group: 'engine' });
    assert.deepEqual(ids(eng), ['hyundai-kia-oil-filter-check']);
    const at = crmQuirksForAggregate(kia, data, { key: 'automatic', group: 'auto' });
    assert.deepEqual(ids(at), ['at-filter-6ab']);
    const gear = crmQuirksForAggregate(kia, data, { key: 'diffRear', group: 'gear' });
    assert.deepEqual(gear, [], 'дифференциалу правил из CRM нет');
});

test('без марки и модели правил нет', () => {
    assert.deepEqual(crmQuirksFor({}, {}), []);
});

test('внедорожникам Skoda/Seat полная не запрещена, но расчёт по умолчанию частичный', () => {
    const kodiaq = car('Skoda', 'Kodiaq');
    assert.ok(!crmNoFullAt(kodiaq, AT));
    assert.ok(crmPrefersPartial(kodiaq, AT));
    // где полную не делаем вовсе — частичная по умолчанию тем более
    assert.ok(crmPrefersPartial(car('Volvo', 'XC60'), AT));
    assert.ok(!crmPrefersPartial(car('Toyota', 'Camry'), AT));
});
