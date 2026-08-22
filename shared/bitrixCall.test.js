import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCallOption, callStartedAt, pickCurrentCall, CALL_FRESH_MS } from './bitrixCall.js';

// Две карточки с живой страницы: звонок 13-минутной давности и свежий. У обеих
// CALL_STATE "connected" — по нему судить нельзя.
const OLD = '{"CALL_ID":"externalCall.a5d8ddce8de52c951f4761b8789511b1.1787378570","PHONE_NUMBER":"79668581045",'
    + '"LINE_NUMBER":"78126034480","CRM_ENTITY_TYPE":"LEAD","CRM_ENTITY_ID":"467416",'
    + '"CALL_DIRECTION":"incoming","CALL_STATE":"connected"}';
const NEW = '{"CALL_ID":"externalCall.f5a82f81fbe035ed91c2d22876621ff7.1787379349","PHONE_NUMBER":"79522752183",'
    + '"LINE_NUMBER":"78126034480","CRM_ENTITY_TYPE":"LEAD","CRM_ENTITY_ID":"611142",'
    + '"CALL_DIRECTION":"incoming","CALL_STATE":"connected"}';

const NEW_AT = 1787379349 * 1000;

test('карточка разбирается в звонок', () => {
    const call = parseCallOption(NEW);
    assert.equal(call.callId, 'externalCall.f5a82f81fbe035ed91c2d22876621ff7.1787379349');
    assert.equal(call.phone, '79522752183');
    assert.equal(call.leadId, '611142');
    assert.equal(call.direction, 'incoming');
    assert.equal(call.startedAt, NEW_AT);
});

test('время берётся из идентификатора', () => {
    assert.equal(callStartedAt('externalCall.abc.1787379349'), NEW_AT);
    // Непохожее на время — «не знаю», а не звонок из 1970 года.
    assert.equal(callStartedAt('externalCall.abc'), null);
    assert.equal(callStartedAt(''), null);
    assert.equal(callStartedAt(null), null);
});

test('не карточка звонка — null', () => {
    assert.equal(parseCallOption('{"PLACEMENT":"CRM_LEAD_DETAIL_TAB"}'), null);
    assert.equal(parseCallOption('не json'), null);
    assert.equal(parseCallOption(null), null);
});

// Главное свойство: карточки на странице копятся, и при перезагрузке нельзя
// вывалить на сайт всю смену.
test('из накопившихся карточек берётся только свежая', () => {
    const call = pickCurrentCall([OLD, NEW], { now: NEW_AT + 5000 });
    assert.equal(call.leadId, '611142');
});

test('старые карточки не показываются вовсе', () => {
    // Прошло полчаса — свежих нет ни одной.
    assert.equal(pickCurrentCall([OLD, NEW], { now: NEW_AT + 30 * 60 * 1000 }), null);
});

test('о чём уже сообщали, второй раз не сообщаем', () => {
    const known = new Set(['externalCall.f5a82f81fbe035ed91c2d22876621ff7.1787379349']);
    assert.equal(pickCurrentCall([OLD, NEW], { now: NEW_AT + 5000, known }), null);
});

test('звонок без времени показывается, только если появился при нас', () => {
    const odd = '{"CALL_ID":"weirdCall","PHONE_NUMBER":"79112527716","CRM_ENTITY_TYPE":"LEAD","CRM_ENTITY_ID":"1"}';
    // Первый проход после загрузки страницы: сколько ей лет — неизвестно.
    assert.equal(pickCurrentCall([odd], { firstScan: true }), null);
    // Появилась при нас — значит звонок идёт сейчас.
    assert.equal(pickCurrentCall([odd], { firstScan: false }).phone, '79112527716');
});

test('на границе свежести звонок ещё показывается', () => {
    const now = NEW_AT + CALL_FRESH_MS;
    assert.ok(pickCurrentCall([NEW], { now }));
    assert.equal(pickCurrentCall([NEW], { now: now + 1000 }), null);
});

test('пустая страница — пусто, а не падение', () => {
    assert.equal(pickCurrentCall([], {}), null);
    assert.equal(pickCurrentCall(null, {}), null);
});
