import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStages, normalizeUsers, stageName, callCentreDepartment, normalizeSelectorUsers } from './dicts.js';

// Формы взяты с живого портала (docs/BITRIX.md), значения обезличены.
const STAGES = { result: [
    { ID: '1', STATUS_ID: 'NEW', NAME: 'Не обработан', SORT: '10', SYSTEM: 'Y', COLOR: '#ACE9FB', SEMANTICS: null, EXTRA: { SEMANTICS: 'process', COLOR: '#ACE9FB' } },
    { ID: '208', STATUS_ID: '4', NAME: 'Перевод на ТТ', SORT: '50', COLOR: '#55D0E0', SEMANTICS: null, EXTRA: { SEMANTICS: 'process' } },
    { ID: '9', STATUS_ID: 'IN_PROCESS', NAME: 'Уточнение информации', SORT: '70', COLOR: '#6E54D1', SEMANTICS: null, EXTRA: { SEMANTICS: 'process' } },
    { ID: '15', STATUS_ID: 'CONVERTED', NAME: 'Доволен обслуживанием', SORT: '160', SEMANTICS: 'S', EXTRA: { SEMANTICS: 'success' } },
    { ID: '17', STATUS_ID: 'JUNK', NAME: 'НЕ доволен обслуживанием', SORT: '170', SEMANTICS: 'F', EXTRA: { SEMANTICS: 'failure' } },
    { ID: '278', STATUS_ID: '9', NAME: 'Кадры', SORT: '180', SEMANTICS: 'F', EXTRA: { SEMANTICS: 'apology' } },
    { ID: '0', STATUS_ID: '', NAME: '', SORT: '1' },
] };

test('стадии идут в порядке воронки, а не по алфавиту', () => {
    const list = normalizeStages(STAGES);
    assert.deepEqual(list.map(s => s.id), ['NEW', '4', 'IN_PROCESS', 'CONVERTED', 'JUNK', '9']);
});

test('коды стадий бывают числовыми — их нельзя терять', () => {
    const list = normalizeStages(STAGES);
    const transfer = list.find(s => s.name === 'Перевод на ТТ');
    assert.equal(transfer.id, '4');
});

test('итог стадии читается и из SEMANTICS, и из EXTRA', () => {
    const byId = Object.fromEntries(normalizeStages(STAGES).map(s => [s.id, s.semantics]));
    assert.equal(byId.NEW, 'process');
    assert.equal(byId.CONVERTED, 'success');
    assert.equal(byId.JUNK, 'failure');
    // «Извинение» — тоже неуспех: показывать его зелёным нельзя.
    assert.equal(byId['9'], 'failure');
});

test('пустые строки справочника выбрасываются', () => {
    assert.equal(normalizeStages(STAGES).length, 6);
    assert.deepEqual(normalizeStages(null), []);
});

test('неизвестная стадия показывается кодом, а не пустотой', () => {
    const list = normalizeStages(STAGES);
    assert.equal(stageName(list, 'IN_PROCESS'), 'Уточнение информации');
    assert.equal(stageName(list, 'WHATEVER'), 'WHATEVER');
    assert.equal(stageName(list, ''), null);
});

const USERS = { result: [
    { ID: '2182', ACTIVE: true, NAME: 'Оператор Анастасия', LAST_NAME: '', WORK_POSITION: '', UF_DEPARTMENT: [18] },
    { ID: '1638', ACTIVE: true, NAME: 'Оператор', LAST_NAME: 'Александра', WORK_POSITION: 'Колл-центр', UF_DEPARTMENT: [18] },
    { ID: '2774', ACTIVE: true, NAME: 'Елена', LAST_NAME: 'Коржова', SECOND_NAME: 'Алексеевна ', WORK_POSITION: 'Руководитель call-центра', UF_DEPARTMENT: [18, 30] },
    { ID: '14074', ACTIVE: true, NAME: 'Сергей', LAST_NAME: 'Агапенков', UF_DEPARTMENT: [30] },
    { ID: '9999', ACTIVE: false, NAME: 'Уволенный', LAST_NAME: 'Сотрудник', UF_DEPARTMENT: [30] },
    { ID: '8888', ACTIVE: true, NAME: '', LAST_NAME: '', UF_DEPARTMENT: [1] },
] };

test('уволенные и безымянные в список не попадают', () => {
    const list = normalizeUsers(USERS);
    assert.deepEqual(list.map(u => u.id), [2774, 1638, 2182, 14074]);
});

test('имя показывается так же, как в самом Битриксе', () => {
    const list = normalizeUsers(USERS);
    // Портал рисует «Имя Фамилия» и без отчества — оператор должен узнать в
    // списке того же человека, которого видит в Битриксе.
    assert.equal(list.find(u => u.id === 2774).name, 'Елена Коржова');
    // У операторов всё имя лежит в одном поле — разбирать его нечего.
    assert.equal(list.find(u => u.id === 2182).name, 'Оператор Анастасия');
});

test('отдел колл-центра вычисляется, а не вписан числом', () => {
    assert.equal(callCentreDepartment(normalizeUsers(USERS)), 18);
    assert.equal(callCentreDepartment([]), null);
});

// Ручка подбора отдаёт сотрудников по-своему: элементами с id и title. Форма
// снята с живого запроса карточки лида.
const SELECTOR = { data: { dialog: { items: [
    { id: 2636, entityId: 'user', entityType: 'employee', title: 'Оператор Семен',
      customData: { name: 'Оператор Семен', email: 'kent400@mail.ru', nodeId: 6 } },
    { id: 2774, entityId: 'user', title: 'Елена Коржова', subtitle: 'Руководитель call-центра',
      customData: { name: 'Елена Коржова' } },
    { id: 7, entityId: 'structure-node', title: 'Колл-центр' },
] } } };

test('сотрудники из ручки подбора приводятся к общему виду', () => {
    const users = normalizeSelectorUsers(SELECTOR);
    assert.deepEqual(users.map(u => u.id), [2774, 2636]);
    assert.equal(users.find(u => u.id === 2774).position, 'Руководитель call-центра');
});

test('отделы в ответе подбора — не сотрудники', () => {
    assert.ok(!normalizeSelectorUsers(SELECTOR).some(u => u.id === 7));
});

test('незнакомый ответ подбора — пустой список, а не падение', () => {
    assert.deepEqual(normalizeSelectorUsers(null), []);
    assert.deepEqual(normalizeSelectorUsers({ data: {} }), []);
});
