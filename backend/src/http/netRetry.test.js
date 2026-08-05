import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry, isTransientNetworkError, describeNetworkError } from './netRetry.js';

// Ошибка ровно в том виде, в каком её отдаёт undici внутри node-fetch, когда
// сервер закрыл keep-alive-сокет до ответа. Именно она приходила с
// zamena-masla-spot.ru «через раз» и вылезала в интерфейс как
// «UND_ERR_SOCKET: other side closed».
function socketClosed() {
    const cause = new Error('other side closed');
    cause.code = 'UND_ERR_SOCKET';
    const err = new TypeError('fetch failed');
    err.cause = cause;
    return err;
}

function stubFetch(handler) {
    const real = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (...args) => handler(++calls, ...args);
    return { calls: () => calls, restore: () => { globalThis.fetch = real; } };
}

test('isTransientNetworkError: обрыв соединения — да, наш таймаут — нет', () => {
    assert.equal(isTransientNetworkError(socketClosed()), true);

    const reset = new TypeError('fetch failed');
    reset.cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    assert.equal(isTransientNetworkError(reset), true);

    // AbortError — это наш собственный таймаут: 20 секунд уже потрачены,
    // повторять бессмысленно.
    assert.equal(isTransientNetworkError(Object.assign(new Error('aborted'), { name: 'AbortError' })), false);
    // Разбор ответа сломался — это не сеть.
    assert.equal(isTransientNetworkError(new SyntaxError('Unexpected token')), false);
});

test('describeNetworkError: вместо кода undici — человеческий текст', () => {
    // Текст уходит прямо в интерфейс («не удалось получить расписание на …»),
    // поэтому английского кода там быть не должно.
    const text = describeNetworkError(socketClosed(), 20_000);
    assert.equal(text, 'соединение разорвано до ответа (UND_ERR_SOCKET)');

    assert.equal(
        describeNetworkError(Object.assign(new Error('aborted'), { name: 'AbortError' }), 20_000),
        'таймаут 20000 мс',
    );
});

test('describeNetworkError: просроченный сертификат читается по-русски', () => {
    // Именно это видел оператор в панели CRM: «CERT_HAS_EXPIRED: certificate
    // has expired» — из такой строки не понять даже, у кого сломалось.
    const err = new TypeError('fetch failed');
    err.cause = Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' });
    assert.equal(describeNetworkError(err, 15_000), 'сертификат сервера просрочен (CERT_HAS_EXPIRED)');
});

test('isTransientNetworkError: сертификат не транзиентен — повторять нечего', () => {
    const err = new TypeError('fetch failed');
    err.cause = Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' });
    assert.equal(isTransientNetworkError(err), false);
});

test('fetchWithRetry: fetchImpl вместо глобального fetch (послабление TLS у CRM)', async () => {
    // Глобальный fetch не понимает dispatcher из пакета undici, поэтому клиент
    // CRM передаёт сюда fetch из того же пакета — он и должен быть вызван.
    const stub = stubFetch(async () => { throw new Error('глобальный fetch звать не должны'); });
    let seen = null;
    try {
        const res = await fetchWithRetry('https://crm.test/analyse/free', { dispatcher: 'агент' }, {
            timeoutMs: 5_000,
            fetchImpl: async (_url, init) => { seen = init.dispatcher; return new Response('ok', { status: 200 }); },
        });
        assert.equal(res.status, 200);
        assert.equal(seen, 'агент');
        assert.equal(stub.calls(), 0);
    } finally {
        stub.restore();
    }
});

test('fetchWithRetry: GET переживает обрыв и доходит со второй попытки', async () => {
    const stub = stubFetch(async (n) => {
        if (n === 1) throw socketClosed();
        return new Response('доска', { status: 200 });
    });
    try {
        const res = await fetchWithRetry('https://example.test/admin/record', {}, { timeoutMs: 5_000 });
        assert.equal(await res.text(), 'доска');
        assert.equal(stub.calls(), 2);
    } finally {
        stub.restore();
    }
});

test('fetchWithRetry: попытки не бесконечны — три и наружу', async () => {
    const stub = stubFetch(async () => { throw socketClosed(); });
    try {
        await assert.rejects(
            fetchWithRetry('https://example.test/admin/record', {}, { timeoutMs: 5_000 }),
            (err) => err.cause?.code === 'UND_ERR_SOCKET',
        );
        assert.equal(stub.calls(), 3);
    } finally {
        stub.restore();
    }
});

test('fetchWithRetry: POST не повторяем — запрос мог создать запись', async () => {
    const stub = stubFetch(async () => { throw socketClosed(); });
    try {
        await assert.rejects(fetchWithRetry(
            'https://example.test/admin/record/update',
            { method: 'POST', body: 'x' },
            { timeoutMs: 5_000 },
        ));
        assert.equal(stub.calls(), 1);
    } finally {
        stub.restore();
    }
});

test('fetchWithRetry: нетранзиентную ошибку отдаём сразу', async () => {
    const stub = stubFetch(async () => {
        const err = new TypeError('fetch failed');
        err.cause = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
        throw err;
    });
    try {
        await assert.rejects(fetchWithRetry('https://nope.test/', {}, { timeoutMs: 5_000 }));
        assert.equal(stub.calls(), 1);
    } finally {
        stub.restore();
    }
});

test('fetchWithRetry: beforeAttempt (троттлинг CRM) вызывается на каждую попытку', async () => {
    let paced = 0;
    const stub = stubFetch(async (n) => {
        if (n < 3) throw socketClosed();
        return new Response('ok', { status: 200 });
    });
    try {
        await fetchWithRetry('https://example.test/analyse/free', {}, {
            timeoutMs: 5_000,
            beforeAttempt: async () => { paced++; },
        });
        assert.equal(stub.calls(), 3);
        assert.equal(paced, 3);
    } finally {
        stub.restore();
    }
});

test('fetchWithRetry: таймаут отмеряется заново на каждую попытку', async () => {
    // Первая попытка обрывается сразу, вторая ждёт дольше исходного бюджета —
    // и должна дожить: свой AbortController у каждой попытки.
    const stub = stubFetch(async (n, _url, init) => {
        if (n === 1) throw socketClosed();
        await new Promise(r => setTimeout(r, 120));
        assert.equal(init.signal.aborted, false);
        return new Response('ok', { status: 200 });
    });
    try {
        const res = await fetchWithRetry('https://example.test/', {}, { timeoutMs: 200 });
        assert.equal(res.status, 200);
    } finally {
        stub.restore();
    }
});
