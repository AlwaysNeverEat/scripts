import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLeadSaveForm, buildStageForm, textToBB, bbToText, isCallSource, BitrixLeadError } from './leads.js';

// Лид из живого запроса (docs/BITRIX.md), урезанный до существенного.
const LEAD = {
    ID: '611134',
    TITLE: '7 911 252-77-16 - Входящий звонок',
    STATUS_ID: 'IN_PROCESS',
    NAME: 'Владимир',
    ASSIGNED_BY_ID: '2182',
    SOURCE_ID: 'RECOMMENDATION',
    SOURCE_DESCRIPTION: 'Звонок поступил на номер: +78126034480.',
    OPENED: 'Y',
    CURRENCY_ID: 'RUB',
    OPPORTUNITY: '0.00',
    COMMENTS: '[p]\nкакое то крафтовское масло ищет (Сергей)\n[/p]',
    PHONE: [{ id: '698360', value: '79112527716', valueType: 'WORK', countryCode: 'RU' }],
    uf: { UF_CRM_ROISTAT: '', UF_CRM_DCT_CITY: 'СПб' },
};

const asObject = form => Object.fromEntries([...form.entries()]);

test('правка одного поля не теряет остальные', () => {
    const f = asObject(buildLeadSaveForm(LEAD, { name: 'Олег' }));
    assert.equal(f.NAME, 'Олег');
    // Всё, чего мы не касались, уезжает обратно нетронутым: редактор шлёт
    // форму целиком, и пропущенное поле означает «очистить».
    assert.equal(f.TITLE, LEAD.TITLE);
    assert.equal(f.SOURCE_DESCRIPTION, LEAD.SOURCE_DESCRIPTION);
    assert.equal(f.STATUS_ID, 'IN_PROCESS');
    assert.equal(f.UF_CRM_DCT_CITY, 'СПб');
    assert.equal(f.ACTION, 'SAVE');
    assert.equal(f.ACTION_ENTITY_ID, '611134');
});

test('телефон правится по своему id, а не добавляется вторым', () => {
    const f = asObject(buildLeadSaveForm(LEAD, { name: 'Олег' }));
    assert.equal(f['PHONE[698360][VALUE]'], '79112527716');
    assert.equal(f['PHONE[698360][VALUE_COUNTRY_CODE]'], 'RU');
    assert.ok(!('PHONE[n0][VALUE]' in f), 'номер с именем n0 завёл бы клиенту второй телефон');
});

test('у лида без телефона отправляется пустое значение, а не ничего', () => {
    const f = asObject(buildLeadSaveForm({ ...LEAD, PHONE: [] }, {}));
    assert.equal(f['PHONE[n0][VALUE]'], '');
    assert.equal(f['PHONE[n0][VALUE_TYPE]'], 'WORK');
});

test('стадия и ответственный меняются', () => {
    const f = asObject(buildLeadSaveForm(LEAD, { statusId: 'CANNOT_CONTACT', assignedById: 2636 }));
    assert.equal(f.STATUS_ID, 'CANNOT_CONTACT');
    assert.equal(f.ASSIGNED_BY_ID, '2636');
});

test('описание уезжает BB-кодом', () => {
    const f = asObject(buildLeadSaveForm(LEAD, { comments: 'ищет масло\n\nперезвонить в среду' }));
    // Абзацы разделены переводом строки — ровно так их хранит сам Битрикс.
    assert.equal(f.COMMENTS, '[p]\nищет масло\n[/p]\n[p]\nперезвонить в среду\n[/p]');
});

test('пустая стадия — отказ, а не тихий увод лида в начало воронки', () => {
    assert.throws(() => buildLeadSaveForm({ ...LEAD, STATUS_ID: '' }, {}), BitrixLeadError);
    assert.throws(() => buildLeadSaveForm({ ...LEAD }, { statusId: '' }), BitrixLeadError);
});

// Правило компании: источник «Звонок» ставит телефония, и обработанный лид с
// ним оставлять нельзя. Проверка стоит в сборке формы, а не в панели: панель
// может быть любая, а правило одно.
test('источник «Звонок» не даёт сохранить', () => {
    assert.throws(() => buildLeadSaveForm({ ...LEAD, SOURCE_ID: 'CALL' }, { name: 'Олег' }), BitrixLeadError);
    // Регистр значения роли не играет.
    assert.throws(() => buildLeadSaveForm({ ...LEAD, SOURCE_ID: 'call' }, {}), BitrixLeadError);
    assert.ok(isCallSource('CALL'));
    assert.ok(!isCallSource('RECOMMENDATION'));
});

test('выбранный источник снимает запрет', () => {
    const f = asObject(buildLeadSaveForm({ ...LEAD, SOURCE_ID: 'CALL' }, { sourceId: 'RECOMMENDATION' }));
    assert.equal(f.SOURCE_ID, 'RECOMMENDATION');
});

test('пустой источник тоже не проходит', () => {
    assert.throws(() => buildLeadSaveForm({ ...LEAD, SOURCE_ID: '' }, {}), BitrixLeadError);
});

test('без числового id сохранять нечего', () => {
    assert.throws(() => buildLeadSaveForm({ ...LEAD, ID: '' }, {}), BitrixLeadError);
    assert.throws(() => buildLeadSaveForm({ ...LEAD, ID: 'нет' }, {}), BitrixLeadError);
});

// Пустые пользовательские поля Битрикс отдаёт ложью, а не пустой строкой:
// через String() в лид уехало бы слово 'false'.
test('пустое поле не превращается в строку false', () => {
    const lead = { ...LEAD, HONORIFIC: null, POST: false, uf: { UF_CRM_ROISTAT: false, UF_CRM_DCT_CITY: 'СПб' } };
    const f = asObject(buildLeadSaveForm(lead, {}));
    assert.equal(f.POST, '');
    assert.equal(f.HONORIFIC, '');
    assert.equal(f.UF_CRM_ROISTAT, '');
    assert.equal(f.UF_CRM_DCT_CITY, 'СПб');
});

// Лид, прочитанный из Битрикса как есть: телефон приезжает с ключами в верхнем
// регистре, и потерять на этом id значения нельзя — уедет второй номер.
test('телефон читается и из формата самого Битрикса', () => {
    const lead = { ...LEAD, PHONE: [{ ID: '698360', VALUE: '79112527716', VALUE_TYPE: 'WORK', TYPE_ID: 'PHONE' }] };
    const f = asObject(buildLeadSaveForm(lead, {}));
    assert.equal(f['PHONE[698360][VALUE]'], '79112527716');
    assert.ok(!('PHONE[n0][VALUE]' in f));
});

test('BB-код разбирается обратно в текст', () => {
    assert.equal(bbToText(LEAD.COMMENTS), 'какое то крафтовское масло ищет (Сергей)');
    // Два абзаца из живого лида: между ними [/p]\n[p]
    assert.equal(
        bbToText('[p]\nраз\n[/p]\n[p]\nдва\n[/p]'),
        'раз\n\nдва',
    );
    assert.equal(bbToText('[p]раз[/p][p]два[/p]'), 'раз\n\nдва');
    assert.equal(bbToText('строка[br]вторая'), 'строка\nвторая');
    assert.equal(bbToText(''), '');
});

test('пустое описание не превращается в пустой абзац', () => {
    assert.equal(textToBB('   '), '');
    assert.equal(textToBB(null), '');
});

test('форма смены стадии', () => {
    const body = buildStageForm('611134', 'CANNOT_CONTACT');
    assert.equal(body.ACTION, 'SAVE_PROGRESS');
    assert.equal(body.VALUE, 'CANNOT_CONTACT');
    assert.equal(body.TYPE, 'LEAD');
    assert.ok(body.EVENT_ID.length > 8);
    assert.throws(() => buildStageForm('611134', ''), BitrixLeadError);
});
