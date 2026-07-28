// ── fetch с повтором по сетевым сбоям ────────────────────────────────────────
// Канал из РФ до Render рвётся на ровном месте: соединение отваливается или
// виснет до того, как ответ пойдёт обратно, и fetch падает TypeError'ом. Один
// такой обрыв не должен превращаться в ошибку на экране — повторяем.
//
// Повторяем ТОЛЬКО GET: POST/PATCH/DELETE могли дойти до сервера и выполниться,
// а обрыв случиться уже на ответе — повтор создал бы вторую запись.
//
// HTTP-ответы (500, 502 и прочие) не повторяем: это ответ сервера, с ним
// разбирается вызывающий код, а не транспорт.

const RETRIES = 2;
const BACKOFF = 700;    // пауза перед повтором, множится на номер попытки
const TIMEOUT = 25000;  // висящее соединение рвём сами, иначе ждать можно вечно

export async function fetchRetry(url, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const retries = method === 'GET' ? RETRIES : 0;

    for (let i = 0; ; i++) {
        // Свой таймаут ставим только если вызывающий не принёс собственный signal.
        const ctl = opts.signal ? null : new AbortController();
        const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT) : null;
        try {
            return await fetch(url, ctl ? { ...opts, signal: ctl.signal } : opts);
        } catch (err) {
            if (i >= retries) throw err;
            await new Promise(r => setTimeout(r, BACKOFF * (i + 1)));
        } finally {
            if (timer) clearTimeout(timer);
        }
    }
}
