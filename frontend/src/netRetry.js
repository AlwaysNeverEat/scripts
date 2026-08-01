// ── fetch, переживающий висящее соединение ───────────────────────────────────
// Канал из РФ до бэкенда рвётся на ровном месте: соединение отваливается или
// виснет до того, как ответ пойдёт обратно, и fetch падает TypeError'ом. Зависит
// это от провайдера, VPN, антивируса с разбором TLS и расширений браузера,
// поэтому в одну и ту же минуту у одного человека всё летает, а у соседа
// раздел не грузится минуту-две. Сервер тут ни при чём — он один на всех.
//
// Отдельно про «ушёл со вкладки и вернулся»: пока страница открыта и опрос
// идёт, соединение живёт по keep-alive и всё работает. За время простоя оно
// закрывается, и на возвращении нужно поднимать TLS заново — вот там и виснет.
//
// ПОСЛЕДОВАТЕЛЬНЫЕ ПОВТОРЫ ЭТО НЕ ЛЕЧАТ. Зависшее соединение не отвечает вообще
// никогда, поэтому вся цена попытки — её таймаут: три попытки по 25 секунд дают
// минуту с лишним пустого ожидания (ровно то, что видно в сетевой панели как
// череда NS_BINDING_ABORTED). Зато СВЕЖЕЕ соединение, поднятое рядом, обычно
// проходит сразу.
//
// Поэтому попытки идут внахлёст: не ответила за HEDGE_AFTER — запускаем дубль,
// не отменяя первую, и берём того, кто ответит первым. Приём взят из
// bootScreen.js, где он уже отработан на пинге /health. На здоровом канале
// ничего не меняется: ответ приходит за доли секунды, до дубля дело не доходит.
//
// Дублируем ТОЛЬКО GET: POST/PATCH/DELETE могли дойти до сервера и выполниться,
// а обрыв случиться уже на ответе — второй такой запрос создал бы вторую запись.
//
// HTTP-ответы (500, 502 и прочие) не повторяем: это ответ сервера, с ним
// разбирается вызывающий код, а не транспорт.

// Пороги — объектом, а не константами: тесты гоняют ту же логику на
// миллисекундах, иначе одна проверка «дубль внахлёст» стоила бы шесть секунд.
export const NET_TIMINGS = {
    timeout: 25_000,     // общий бюджет запроса, сколько бы попыток ни шло
    hedgeAfter: 6_000,   // молчит столько — пускаем дубль внахлёст
    maxAttempts: 3,      // больше трёх живых соединений не заводим
};

export function fetchRetry(url, opts = {}) {
    // Вызывающий принёс свой signal — отменой рулит он, не лезем.
    if (opts.signal) return fetch(url, opts);
    const method = (opts.method || 'GET').toUpperCase();
    return method === 'GET' ? hedged(url, opts) : once(url, opts);
}

// Одна попытка со своим таймаутом — для запросов, которые нельзя повторять.
function once(url, opts) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), NET_TIMINGS.timeout);
    return fetch(url, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(timer));
}

function hedged(url, opts) {
    return new Promise((resolve, reject) => {
        const live = new Set(); // контроллеры ещё не завершившихся попыток
        let launched = 0;
        let settled = false;
        let lastErr = null;
        let hedgeTimer = null;

        // Победителя не трогаем: его тело ещё не прочитано, abort порвал бы
        // поток прямо под res.json() у вызывающего.
        const finish = (done, value, winner = null) => {
            if (settled) return;
            settled = true;
            clearTimeout(hedgeTimer);
            clearTimeout(budget);
            for (const c of live) if (c !== winner) c.abort();
            live.clear();
            done(value);
        };

        const budget = setTimeout(
            () => finish(reject, lastErr
                || new Error(`сервер не ответил за ${Math.round(NET_TIMINGS.timeout / 1000)} с`)),
            NET_TIMINGS.timeout,
        );

        const launch = () => {
            if (settled || launched >= NET_TIMINGS.maxAttempts) return;
            launched++;
            const ctl = new AbortController();
            live.add(ctl);
            // Следующий дубль — если и этот замолчит.
            clearTimeout(hedgeTimer);
            hedgeTimer = setTimeout(launch, NET_TIMINGS.hedgeAfter);

            fetch(url, { ...opts, signal: ctl.signal }).then(
                (res) => finish(resolve, res, ctl),
                (err) => {
                    live.delete(ctl);
                    if (settled) return;
                    lastErr = err;
                    // Попытка упала сама, а не зависла — ждать окно незачем,
                    // поднимаем следующую сразу.
                    if (launched < NET_TIMINGS.maxAttempts) launch();
                    // Больше пробовать нечем и никто не остался в воздухе.
                    else if (!live.size) finish(reject, lastErr);
                },
            );
        };

        launch();
    });
}
