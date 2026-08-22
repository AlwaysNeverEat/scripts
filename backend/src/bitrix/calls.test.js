import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, isLeadUnfilled, leadRetentionDays } from './calls.js';

// Телефон — ключ, по которому сходятся лиды клиента и его машины. Приезжает он
// из четырёх мест в четырёх видах, и любой разнобой рвёт связку молча.
test('телефон приводится к одному виду', () => {
    assert.equal(normalizePhone('+7 (911) 252-77-16'), '79112527716');
    assert.equal(normalizePhone('79112527716'), '79112527716');
    assert.equal(normalizePhone('89112527716'), '79112527716');
    assert.equal(normalizePhone('9112527716'), '79112527716');
});

test('телефон, которого нет, — это null, а не пустая строка', () => {
    assert.equal(normalizePhone(''), null);
    assert.equal(normalizePhone(null), null);
    assert.equal(normalizePhone('—'), null);
});

// Короткие номера и внутренние добавочные не ломаем: чем городить проверку
// «бывает ли такой номер», лучше сохранить как есть — связка всё равно
// держится на совпадении, а не на правильности.
test('нестандартные номера остаются собой', () => {
    assert.equal(normalizePhone('112'), '112');
    assert.equal(normalizePhone('+380 44 123 45 67'), '380441234567');
});

// «Не заполнено» — это не про аккуратность оператора, а про факт: с лидом
// никто не работал. Сорванный звонок выглядит ровно так.
test('лид со звонковым источником — незаполненный', () => {
    assert.ok(isLeadUnfilled({ source_id: 'CALL', name: null, saved_at: null }));
    assert.ok(isLeadUnfilled({ source_id: 'CALL', name: 'Владимир', saved_at: null }));
});

test('лид без имени — тоже незаполненный', () => {
    assert.ok(isLeadUnfilled({ source_id: 'RECOMMENDATION', name: '', saved_at: null }));
    assert.ok(isLeadUnfilled({ source_id: null, name: '   ', saved_at: null }));
});

test('заполненный лид не помечается', () => {
    assert.ok(!isLeadUnfilled({ source_id: 'RECOMMENDATION', name: 'Владимир', saved_at: null }));
});

// Сохранённый через сайт лид не должен снова становиться незаполненным
// оттого, что его открыли посмотреть.
test('сохранение через сайт снимает пометку навсегда', () => {
    assert.ok(!isLeadUnfilled({ source_id: 'CALL', name: '', saved_at: new Date() }));
});

test('срок хранения ленты — четыре дня по умолчанию', () => {
    const was = process.env.BITRIX_LEAD_TTL_DAYS;
    delete process.env.BITRIX_LEAD_TTL_DAYS;
    assert.equal(leadRetentionDays(), 4);
    process.env.BITRIX_LEAD_TTL_DAYS = '7';
    assert.equal(leadRetentionDays(), 7);
    // Мусор в настройке не должен приводить к чистке «за ноль дней».
    process.env.BITRIX_LEAD_TTL_DAYS = 'скоро';
    assert.equal(leadRetentionDays(), 4);
    process.env.BITRIX_LEAD_TTL_DAYS = '0';
    assert.equal(leadRetentionDays(), 4);
    if (was === undefined) delete process.env.BITRIX_LEAD_TTL_DAYS;
    else process.env.BITRIX_LEAD_TTL_DAYS = was;
});
