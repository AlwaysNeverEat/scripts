import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrameCacheVars, compositeHeaders, dynamicUrl, dynamicHtml } from './composite.js';

// Кусок настоящего каркаса страницы лида: именно в таком виде портал отдаёт
// параметры кэша — одной строкой, внутри инлайнового скрипта.
const SHELL = '<script data-skip-moving="true">(function(w, d) {var v = w.frameCacheVars = '
    + '{"CACHE_MODE":"HTMLCACHE","storageBlocks":[],"dynamicBlocks":'
    + '{"title":"d41d8cd98f00","header-menu":"d41d8cd98f00","page-area":"7f55441e8e66","chat-bar":"d41d8cd98f00"},'
    + '"AUTO_UPDATE":true,"AUTO_UPDATE_TTL":0,"version":2};'
    + 'var r = new XMLHttpRequest();})(window, document);</script>';

test('параметры кэша достаются из каркаса', () => {
    const vars = parseFrameCacheVars(SHELL);
    assert.equal(vars.cacheMode, 'HTMLCACHE');
    assert.deepEqual(Object.keys(vars.dynamicBlocks), ['title', 'header-menu', 'page-area', 'chat-bar']);
});

// Внутри параметров есть вложенный объект, поэтому вырезать их регуляркой «до
// первой }» нельзя: список блоков оборвётся на середине.
test('вложенный объект не обрывает разбор', () => {
    const vars = parseFrameCacheVars(SHELL);
    assert.equal(vars.dynamicBlocks['page-area'], '7f55441e8e66');
});

test('обычная страница без кэша — это null, а не пустые параметры', () => {
    assert.equal(parseFrameCacheVars('<html><body>лид</body></html>'), null);
    assert.equal(parseFrameCacheVars(''), null);
    // Формат поехал после обновления портала: тоже null, иначе мы бы разбирали
    // пустой каркас и уверяли, что у лида нет полей.
    assert.equal(parseFrameCacheVars('var v = w.frameCacheVars = {сломано};'), null);
});

test('заголовки второго запроса — те же, что ставит портал', () => {
    const h = compositeHeaders(parseFrameCacheVars(SHELL), { referer: 'https://spotexpress.bitrix24.ru/crm/lead/list/' });
    assert.equal(h['BX-ACTION-TYPE'], 'get_dynamic');
    assert.equal(h['X-Bitrix-Composite'], 'get_dynamic');
    assert.equal(h['BX-CACHE-MODE'], 'HTMLCACHE');
    assert.equal(JSON.parse(h['BX-CACHE-BLOCKS'])['page-area'], '7f55441e8e66');
    assert.equal(h['BX-REF'], 'https://spotexpress.bitrix24.ru/crm/lead/list/');
});

test('без параметров кэша заголовки всё равно годные', () => {
    const h = compositeHeaders(null);
    assert.equal(h['BX-CACHE-MODE'], 'HTMLCACHE');
    assert.equal(h['BX-CACHE-BLOCKS'], '');
    assert.ok(!('BX-REF' in h));
});

test('адрес второго запроса сохраняет свои параметры', () => {
    assert.equal(dynamicUrl('/crm/lead/details/611134/', 123), '/crm/lead/details/611134/?bxrand=123');
    assert.equal(
        dynamicUrl('/crm/lead/details/611134/?IFRAME=Y', 123),
        '/crm/lead/details/611134/?IFRAME=Y&bxrand=123',
    );
});

test('блоки ответа склеиваются в одну разметку', () => {
    const html = dynamicHtml({ dynamicBlocks: { title: '<h1>Лид</h1>', 'page-area': '<div>поля</div>', empty: '' } });
    assert.match(html, /<h1>Лид<\/h1>/);
    assert.match(html, /<div>поля<\/div>/);
});

test('блоки бывают объектами с CONTENT', () => {
    const html = dynamicHtml({ dynamicBlocks: { 'page-area': { CONTENT: '<div>поля</div>' } } });
    assert.match(html, /<div>поля<\/div>/);
});

test('пустой ответ — пустая строка, а не падение', () => {
    assert.equal(dynamicHtml(null), '');
    assert.equal(dynamicHtml({}), '');
    assert.equal(dynamicHtml('<div>уже разметка</div>'), '<div>уже разметка</div>');
});
