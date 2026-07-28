// ── Экран загрузки: терминальный boot-лог (порт макета из Figma Make) ────────
// Бэкенд на Render (free) засыпает без трафика и просыпается 30–60 секунд.
// Всё это время ни поиск, ни база не работают, поэтому при старте показываем
// оверлей: строки лога и 100% прогресса привязаны к реальному ответу /health,
// а не к таймеру. Разметка — в index.html (#boot-screen).
//
// Второй случай, ради которого экран должен быть живучим: канал до Render из РФ
// без VPN режется, соединения виснут и рвутся. Оверлей перекрывает всё
// приложение, поэтому «сервер не ответил» тут не должно означать «сайт не
// открылся» — отсюда попытки внахлёст и ранняя кнопка Continue.

const ATTEMPT_SPACING = 2500; // как часто запускать очередную попытку
const PING_TIMEOUT = 8000;    // таймаут одной попытки
const OFFER_SKIP = 20000;     // после этого — кнопки Retry / Continue
const LONG_WAIT = 45000;      // после этого — строка «дольше обычного»

// Одна попытка достучаться. Любой ответ сервера, кроме 5xx, считаем связью:
// /health может отдать 404 или 401 при смене роутов, но сеть при этом жива,
// а вот 502/503 Render отдаёт как раз пока просыпается — это ещё не готовность.
async function ping(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), PING_TIMEOUT);
    try {
        // Кэш-бастер: между нами и Render бывают прокси, отдающие свой ответ на
        // повторный одинаковый запрос.
        const sep = url.includes('?') ? '&' : '?';
        const res = await fetch(url + sep + '_=' + Date.now(), { signal: ctl.signal, cache: 'no-store' });
        return res.ok || (res.status >= 400 && res.status < 500);
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

// Попытки идут внахлёст: новая стартует каждые ATTEMPT_SPACING, не дожидаясь
// таймаута предыдущей. Это ключевое отличие от последовательного цикла — при
// шейпинге канала (РФ без VPN) соединение часто просто виснет и умирает по
// таймауту, так что последовательные попытки дают одну проверку в 8+ секунд,
// а внахлёст — четыре живых соединения одновременно, и хватает, чтобы прошло
// хоть одно. Резолвится true при первом успехе, false — если отменили.
function waitForServer(url, { onAttempt, cancelled }) {
    return new Promise(resolve => {
        let done = false;
        // Считаем именно провалы, а не номер попытки: внахлёст они завершаются
        // не по порядку и номер в логе прыгал бы назад.
        let failed = 0;

        const stop = ok => {
            if (done) return;
            done = true;
            clearInterval(timer);
            resolve(ok);
        };

        function fire() {
            if (done) return;
            if (cancelled()) { stop(false); return; }
            ping(url).then(ok => {
                if (ok) stop(true);
                else if (!done) onAttempt(++failed);
            });
        }

        const timer = setInterval(fire, ATTEMPT_SPACING);
        fire();
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Ждёт, пока сервер ответит на pingUrl, показывая boot-лог. После пробуждения
// сервера — но ДО скрытия оверлея — прогоняет prepare(log): там грузятся
// сессия и снимок базы, а их прогресс идёт строками в тот же лог. Так вся
// «доподгрузка» происходит под лоадером, а не мелькает уже в приложении.
// Резолвится тем, что вернул prepare (или undefined, если юзер нажал Continue
// до пробуждения сервера).
export function bootScreen(pingUrl, { prepare } = {}) {
    const overlay = document.getElementById('boot-screen');
    const log     = document.getElementById('boot-log');
    const barFill = document.getElementById('boot-bar-fill');
    const status  = document.getElementById('boot-status');
    const timeEl  = document.getElementById('boot-time');
    const hint    = document.getElementById('boot-hint');
    const actions = document.getElementById('boot-actions');
    if (!overlay) return Promise.resolve();

    timeEl.textContent = new Date().toISOString().slice(0, 19).replace('T', ' ');

    // ── Лог: нумерованные строки, курсор всегда на последней ──
    const cursor = document.createElement('span');
    cursor.className = 'boot-cursor';
    let lineNo = 0;

    function addLine(text, { final = false } = {}) {
        lineNo++;
        const row = document.createElement('div');
        row.className = 'boot-line' + (final ? ' boot-line-final' : '');
        const num = document.createElement('span');
        num.className = 'boot-line-num';
        num.textContent = String(lineNo).padStart(2, '0');
        const txt = document.createElement('span');
        txt.className = 'boot-line-text';
        txt.textContent = text;
        row.append(num, txt);
        log.appendChild(row);
        if (final) cursor.remove(); else txt.appendChild(cursor);
        return txt; // чтобы можно было обновлять текст строки на месте
    }

    // Минимальный лог-API для prepare: добавить строку и обновить её текст.
    const logApi = {
        line: text => addLine(text),
        set: (node, text) => { if (node) node.textContent = text; },
    };

    // ── Прогресс: асимптотически ползёт к 88%, 100% — только по факту ──
    const t0 = Date.now();
    let progress = 0;
    const creep = setInterval(() => {
        const target = 88 * (1 - Math.exp(-(Date.now() - t0) / 15000));
        if (target > progress) {
            progress = target;
            barFill.style.width = progress + '%';
            status.textContent = `LOADING — ${Math.round(progress)}%`;
        }
    }, 150);

    return new Promise(resolve => {
        let settled = false;
        let prepareResult; // то, что вернул prepare — прокидываем в resolve

        function dismiss() {
            if (settled) return;
            settled = true;
            clearInterval(creep);
            overlay.classList.add('boot-done');
            overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
            resolve(prepareResult);
        }

        async function finish() {
            clearInterval(creep);
            barFill.style.width = '100%';
            await sleep(250);
            addLine('System ready.', { final: true });
            status.textContent = 'COMPLETE';
            await sleep(500);
            dismiss();
        }

        document.getElementById('boot-retry').onclick = () => location.reload();
        document.getElementById('boot-skip').onclick = dismiss;

        (async () => {
            addLine('BOOT v1.0 — interface initialized');
            await sleep(250);
            const pingLine = addLine('Contacting server...');

            let retryLine = null;
            let longWarned = false;

            // Кнопки Retry / Continue показываем рано и по времени, а не по числу
            // попыток: сидеть перед намертво висящим оверлеем полторы минуты —
            // худшее, что можно предложить, когда до сервера просто не достучаться.
            const ticker = setInterval(() => {
                const elapsed = Date.now() - t0;
                if (elapsed > OFFER_SKIP) actions.classList.remove('hidden');
                if (elapsed > LONG_WAIT && !longWarned) {
                    longWarned = true;
                    addLine('Taking longer than usual, still trying...');
                    hint.textContent = 'Сервер не отвечает: он либо просыпается, либо до него не дошла сеть. Жми Continue — сайт откроется, а связь подхватится сама.';
                }
            }, 500);

            const woke = await waitForServer(pingUrl, {
                cancelled: () => settled,
                onAttempt: attempt => {
                    pingLine.textContent = 'Contacting server... no response';
                    if (!retryLine) {
                        retryLine = addLine('Server is asleep — waking it up...');
                        hint.classList.remove('hidden');
                    } else {
                        retryLine.textContent = `Waking the server... attempt ${attempt}`;
                    }
                },
            });
            clearInterval(ticker);

            if (settled || !woke) return; // юзер нажал Continue — тихо выходим
            pingLine.textContent = 'Contacting server... OK';
            if (retryLine) retryLine.textContent = `Server is awake (took ${Math.round((Date.now() - t0) / 1000)}s)`;
            actions.classList.add('hidden');
            addLine('Connection established.');

            // Реальная подготовка (сессия + снимок базы) — пока оверлей ещё виден.
            if (prepare) {
                try { prepareResult = await prepare(logApi); }
                catch { /* приложение разберётся дальше по resolve(undefined) */ }
                if (settled) return; // юзер мог нажать Continue во время подготовки
            }

            await finish();
        })();
    });
}
