import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setPickedLead, pickedLead, leadFill, LEAD_FILL_TTL_MS } from './leadPick.js';

test('выбранный лид заполняет имя с «двс» и телефон в маске', () => {
    setPickedLead({ name: '  Ершов  Андрей ', phone: '79312047101' }, 1000);
    const fill = leadFill(pickedLead(2000));
    assert.equal(fill.name, 'Ершов Андрей двс');
    assert.equal(fill.phone, '+7 (931) 204-71-01');
});

test('без имени — одна заглушка, без телефона — пустое поле', () => {
    setPickedLead({ name: '', phone: '79312047101' }, 0);
    assert.equal(leadFill(pickedLead(1)).name, 'двс');
    setPickedLead({ name: 'Дамир' }, 0);
    assert.equal(leadFill(pickedLead(1)).phone, '');
});

test('выбор стареет: через полчаса лид уже не подставляется', () => {
    setPickedLead({ name: 'Олег', phone: '79310000000' }, 0);
    assert.ok(pickedLead(LEAD_FILL_TTL_MS));
    assert.equal(pickedLead(LEAD_FILL_TTL_MS + 1), null);
});

test('закрытая карточка — подставлять нечего', () => {
    setPickedLead({ name: 'Олег', phone: '79310000000' }, 0);
    setPickedLead(null, 1);
    assert.equal(pickedLead(2), null);
    assert.equal(leadFill(null), null);
});

test('комментарий записи из машин лида — марка и модель, без повторов', async () => {
    const { leadComment, carShort } = await import('./leadPick.js');
    assert.equal(carShort({ brand: 'Kia', model: 'Rio', generation: 'III' }), 'Kia Rio');
    assert.equal(leadComment([
        { brand: 'Kia', model: 'Rio', generation: 'IV' },
        { brand: 'Hyundai', model: 'Solaris' },
        { brand: 'Kia', model: 'Rio', generation: 'III' },
    ]), 'Kia Rio, Hyundai Solaris');
    assert.equal(leadComment([]), '');
    assert.equal(leadComment(null), '');
});
