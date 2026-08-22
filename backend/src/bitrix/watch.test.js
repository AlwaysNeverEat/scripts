import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLeadIds, pickNewLeadIds, parsePortalUserId, watchEveryMs } from './watch.js';

// Список лидов у портала бывает трёх видов (список, канбан, «последние»), и
// вёрстка у них разная. Общее у всех одно — ссылка на карточку, по ней и
// читаем: разбирать вёрстку значило бы ломаться от смены настроек вида.
test('номера лидов читаются по ссылкам на карточки', () => {
    const html = `
        <a href="/crm/lead/details/268402/">Иванов</a>
        <div><a class="x" href="/crm/lead/details/268410/?IFRAME=Y">+7 911</a></div>
        <a href="/crm/lead/show/268399/">старый адрес</a>`;
    assert.deepEqual(parseLeadIds(html), ['268410', '268402', '268399']);
});

test('повторы одного лида не считаются дважды', () => {
    const html = '<a href="/crm/lead/details/1/"></a><a href="/crm/lead/details/1/"></a>';
    assert.deepEqual(parseLeadIds(html), ['1']);
});

test('чужие сущности за лиды не принимаются', () => {
    const html = '<a href="/crm/deal/details/500/"></a><a href="/crm/contact/details/7/"></a>';
    assert.deepEqual(parseLeadIds(html), []);
});

// Самое важное правило наблюдателя: первый проход НИЧЕГО не показывает.
// Иначе после перезапуска бэкенда оператору вывалилась бы вся вчерашняя лента
// как «входящие прямо сейчас».
test('первый проход только запоминает границу', () => {
    assert.deepEqual(pickNewLeadIds(['300', '299', '298'], { baseline: null }), []);
});

test('новым считается только то, что выше границы', () => {
    assert.deepEqual(pickNewLeadIds(['302', '301', '300', '299'], { baseline: 300 }), ['302', '301']);
});

test('за один проход разбираем не больше трёх', () => {
    const ids = ['310', '309', '308', '307', '306'];
    assert.deepEqual(pickNewLeadIds(ids, { baseline: 300 }), ['310', '309', '308']);
});

// Номер оператора нужен, чтобы не всплывать на чужие звонки. Пишется он в
// разметке по-разному в зависимости от страницы, поэтому способов три.
test('номер оператора находится в разных видах разметки', () => {
    assert.equal(parsePortalUserId('var USER_ID = \'42\';'), 42);
    assert.equal(parsePortalUserId('{"USER_ID":"1057","LANGUAGE_ID":"ru"}'), 1057);
    assert.equal(parsePortalUserId('<a href="/company/personal/user/9/">я</a>'), 9);
    assert.equal(parsePortalUserId('ничего такого'), null);
});

// Частота опроса портала — не «на вкус»: слишком редко значит пропущенный
// звонок, а слишком часто панель выставить не может, потому что держит частоту
// сервер, а не она.
test('частота опроса не опускается ниже секунды', () => {
    const was = process.env.BITRIX_WATCH_MS;
    try {
        delete process.env.BITRIX_WATCH_MS;
        assert.equal(watchEveryMs(), 4000);
        process.env.BITRIX_WATCH_MS = '10';
        assert.equal(watchEveryMs(), 4000);
        process.env.BITRIX_WATCH_MS = '2500';
        assert.equal(watchEveryMs(), 2500);
    } finally {
        if (was == null) delete process.env.BITRIX_WATCH_MS;
        else process.env.BITRIX_WATCH_MS = was;
    }
});
