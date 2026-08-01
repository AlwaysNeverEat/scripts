import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchRetry, NET_TIMINGS } from './netRetry.js';

// Гоняем настоящую логику на настоящих таймерах, просто в миллисекундах:
// MockTimers в Node 22 экспериментальный и на этих гонках ведёт себя
// непредсказуемо, а порог в 6 секунд сделал бы набор десятисекундным.
const REAL = { ...NET_TIMINGS };
const MAX_ATTEMPTS = 3;

beforeEach(() => Object.assign(NET_TIMINGS, { timeout: 200, hedgeAfter: 40, maxAttempts: MAX_ATTEMPTS }));
afterEach(() => Object.assign(NET_TIMINGS, REAL));

const after = (ms) => new Promise(r => setTimeout(r, ms));

// Заглушка fetch: handler(номерПопытки, url, init) → Response | Promise | throw.
// Возвращает счётчик попыток и сколько из них были оборваны (abort).
function stubFetch(handler) {
    const real = globalThis.fetch;
    let calls = 0;
    const aborted = [];
    globalThis.fetch = (url, init = {}) => {
        const n = ++calls;
        init.signal?.addEventListener('abort', () => aborted.push(n));
        return Promise.resolve().then(() => handler(n, url, init));
    };
    return {
        calls: () => calls,
        aborted: () => aborted,
        restore: () => { globalThis.fetch = real; },
    };
}

// Соединение, которое зависло: не отвечает никогда и умирает только по abort.
const hang = (init) => new Promise((_, rej) => {
    init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
});

const netFail = () => { throw new TypeError('NetworkError when attempting to fetch resource.'); };

test('здоровый канал: дубль не заводится', async () => {
    const stub = stubFetch(() => new Response('ok', { status: 200 }));
    try {
        const res = await fetchRetry('/api/records/status');
        assert.equal(await res.text(), 'ok');
        assert.equal(stub.calls(), 1);
    } finally {
        stub.restore();
    }
});

test('ответ сервера с ошибкой (502) — не повод дублировать: это ответ, а не обрыв', async () => {
    const stub = stubFetch(() => new Response('', { status: 502 }));
    try {
        const res = await fetchRetry('/api/records/board');
        assert.equal(res.status, 502);
        assert.equal(stub.calls(), 1);
    } finally {
        stub.restore();
    }
});

test('первое соединение зависло — дубль внахлёст приносит ответ', async () => {
    const stub = stubFetch((n, _url, init) =>
        (n === 1 ? hang(init) : new Response('доска', { status: 200 })));
    try {
        const p = fetchRetry('/api/records/board?date=02.08.2026');
        await after(60); // окно hedgeAfter прошло
        const res = await p;
        assert.equal(await res.text(), 'доска');
        assert.equal(stub.calls(), 2, 'ровно один дубль, а не веер');
        // Зависшую первую попытку обязаны прибрать за собой.
        assert.deepEqual(stub.aborted(), [1]);
    } finally {
        stub.restore();
    }
});

test('победителя не отменяем — иначе res.json() читал бы порванный поток', async () => {
    const stub = stubFetch((n, _url, init) =>
        (n === 1 ? hang(init) : new Response(JSON.stringify({ ok: true }), { status: 200 })));
    try {
        const p = fetchRetry('/api/records/status');
        await after(60);
        const res = await p;
        assert.deepEqual(await res.json(), { ok: true }); // тело живо
        assert.ok(!stub.aborted().includes(2));
    } finally {
        stub.restore();
    }
});

test('мгновенный обрыв не ждёт окна — следующая попытка сразу', async () => {
    let n = 0;
    const stub = stubFetch(() => (++n < 3 ? netFail() : new Response('ok', { status: 200 })));
    try {
        // Ни одной паузы в тесте: значит попытки шли не по окну hedgeAfter.
        const res = await fetchRetry('/api/auth/me');
        assert.equal(await res.text(), 'ok');
        assert.equal(stub.calls(), 3);
    } finally {
        stub.restore();
    }
});

test('всё упало — отдаём последнюю ошибку, попыток не больше трёх', async () => {
    const stub = stubFetch(netFail);
    try {
        await assert.rejects(fetchRetry('/api/records/status'), /NetworkError/);
        assert.equal(stub.calls(), 3);
    } finally {
        stub.restore();
    }
});

test('всё зависло — рвём по общему бюджету, а не ждём вечно', async () => {
    const stub = stubFetch((_n, _url, init) => hang(init));
    try {
        const p = fetchRetry('/api/records/board');
        p.catch(() => {}); // отказ придёт не сразу, не роняем процесс раньше
        await after(250);  // оба окна дублей и весь общий бюджет
        await assert.rejects(p);
        assert.equal(stub.calls(), MAX_ATTEMPTS);
        // Ни одного повисшего соединения за собой не оставили.
        assert.equal(stub.aborted().length, MAX_ATTEMPTS);
    } finally {
        stub.restore();
    }
});
test('POST не дублируем ни при каких условиях — вторая запись недопустима', async () => {
    const stub = stubFetch((_n, _url, init) => hang(init));
    try {
        const p = fetchRetry('/api/records/ops', { method: 'POST', body: '{}' });
        p.catch(() => {});
        await after(250);
        await assert.rejects(p);
        assert.equal(stub.calls(), 1);
    } finally {
        stub.restore();
    }
});

test('свой signal вызывающего — не вмешиваемся', async () => {
    const ctl = new AbortController();
    const stub = stubFetch((_n, _url, init) => {
        assert.equal(init.signal, ctl.signal); // именно его, не подменённый
        return new Response('ok', { status: 200 });
    });
    try {
        const res = await fetchRetry('/api/cars/index', { signal: ctl.signal });
        assert.equal(res.status, 200);
        assert.equal(stub.calls(), 1);
    } finally {
        stub.restore();
    }
});
