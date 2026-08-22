import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLeadModel, normalizeLead, leadPagePath, BitrixReadError } from './leadModel.js';
import { buildLeadSaveForm } from './leads.js';

// Обрезанная карточка настоящей формы: тот же вызов фабрики, те же ключи.
// Значения обезличены, но нарочно оставлены неудобными — с кавычками и
// фигурными скобками внутри строк, как в живых комментариях операторов.
const MODEL = {
    ID: '268402',
    TITLE: '79932190150 - Входящий звонок',
    HONORIFIC: '',
    NAME: 'Давид',
    SECOND_NAME: '',
    LAST_NAME: '',
    FULL_NAME: 'Давид',
    STATUS_ID: 'RESTORED',
    SOURCE_ID: 'PARTNER',
    SOURCE_DESCRIPTION: 'Звонок поступил на номер: +78126034480.',
    COMMENTS: '[p]\nмасло 5W-40 "Evolution 900" {спросить про фильтр}\n[/p]\n[p][/p]\n[p]\nперезвонить\n[/p]',
    CURRENCY_ID: 'RUB',
    OPPORTUNITY: '0.00',
    IS_MANUAL_OPPORTUNITY: 'N',
    OPENED: 'Y',
    ASSIGNED_BY_ID: '2182',
    ASSIGNED_BY_NAME: 'Оператор Анастасия',
    ASSIGNED_BY_LAST_NAME: '',
    DATE_CREATE: '14.04.2022 17:53:19',
    PHONE: [{
        ID: '325942',
        VALUE: '79932190150',
        VALUE_TYPE: 'WORK',
        VALUE_EXTRA: { COUNTRY_CODE: '' },
        VIEW_DATA: { value: '<a title="7 993 219-01-50" onclick="top.BXIM.phoneTo(\'79932190150\', {&quot;ENTITY_ID&quot;:268402})">звонок</a>' },
    }],
    UF_CRM_ROISTAT: { SIGNATURE: '0093f167938de7ac220b3e16d02857f6', IS_EMPTY: true },
    UF_CRM_DCT_CITY: { SIGNATURE: 'fb39204a508dc0739eb008da9956933f', VALUE: 'СПб' },
};

const page = model => '<script>var model = BX.Crm.EntityEditorModelFactory.create(\n1,\n"",\n'
    + `{ entityTypeId: 1, data: ${JSON.stringify(model)} }\n);</script>`;

test('модель лида достаётся из разметки карточки', () => {
    const parsed = parseLeadModel(page(MODEL));
    assert.equal(parsed.ID, '268402');
    assert.equal(parsed.STATUS_ID, 'RESTORED');
});

// Внутри комментария оператора живут и кавычки, и фигурные скобки, и ссылки на
// каталоги. Вырезать JSON «до первой }» тут нельзя — данные оборвутся.
test('скобки и кавычки внутри значений не обрывают разбор', () => {
    const parsed = parseLeadModel(page(MODEL));
    assert.match(parsed.COMMENTS, /\{спросить про фильтр\}/);
    assert.equal(parsed.PHONE.length, 1);
});

// Самое важное свойство разбора: он либо возвращает лид, либо падает. Пустая
// модель означала бы пустую форму, а сохранение пустой формы стирает лид.
test('без данных лида — ошибка, а не пустой лид', () => {
    assert.throws(() => parseLeadModel('<html>страница входа</html>'), BitrixReadError);
    assert.throws(() => parseLeadModel(''), BitrixReadError);
    assert.throws(
        () => parseLeadModel('<script>BX.Crm.EntityEditorModelFactory.create(1, "", { data: {"ID":"268402"'),
        BitrixReadError,
    );
    assert.throws(() => normalizeLead({ TITLE: 'без номера' }), BitrixReadError);
});

test('телефон сохраняет свой id, а разметка для показа отбрасывается', () => {
    const lead = normalizeLead(parseLeadModel(page(MODEL)));
    assert.deepEqual(lead.PHONE, [{ id: '325942', value: '79932190150', valueType: 'WORK', countryCode: null }]);
});

test('пользовательские поля разворачиваются в значения', () => {
    const lead = normalizeLead(parseLeadModel(page(MODEL)));
    assert.equal(lead.uf.UF_CRM_ROISTAT, '');
    assert.equal(lead.uf.UF_CRM_DCT_CITY, 'СПб');
});

test('панели уезжает описание текстом, а не BB-кодом', () => {
    const { view } = normalizeLead(parseLeadModel(page(MODEL)));
    assert.equal(view.comments, 'масло 5W-40 "Evolution 900" {спросить про фильтр}\n\nперезвонить');
    assert.equal(view.assignedByName, 'Оператор Анастасия');
    assert.deepEqual(view.phones, ['79932190150']);
});

// Производные поля (FULL_NAME и прочие 120 штук) Битрикс считает сам — слать их
// обратно не нужно и вредно.
test('производные поля обратно не уезжают', () => {
    const lead = normalizeLead(parseLeadModel(page(MODEL)));
    assert.ok(!('FULL_NAME' in lead));
    assert.ok(!('ASSIGNED_BY_NAME' in lead));
});

// Полный оборот: прочитали карточку → поправили стадию → собрали форму.
test('прочитанный лид годится для сохранения как есть', () => {
    const lead = normalizeLead(parseLeadModel(page(MODEL)));
    const form = Object.fromEntries([...buildLeadSaveForm(lead, { statusId: 'IN_PROCESS' }).entries()]);
    assert.equal(form.ACTION, 'SAVE');
    assert.equal(form.ACTION_ENTITY_ID, '268402');
    assert.equal(form.STATUS_ID, 'IN_PROCESS');
    assert.equal(form.TITLE, MODEL.TITLE);
    assert.equal(form.SOURCE_ID, 'PARTNER');
    assert.equal(form['PHONE[325942][VALUE]'], '79932190150');
    assert.ok(!('PHONE[n0][VALUE]' in form));
    assert.equal(form.UF_CRM_DCT_CITY, 'СПб');
    // Комментарий не трогали — он должен уехать ровно тем же BB-кодом.
    assert.equal(form.COMMENTS, MODEL.COMMENTS);
});

test('адрес карточки — тот, что открывает слайдер', () => {
    assert.equal(leadPagePath(268402), '/crm/lead/details/268402/?IFRAME=Y&IFRAME_TYPE=SIDE_SLIDER');
    assert.throws(() => leadPagePath('нет'), BitrixReadError);
});
