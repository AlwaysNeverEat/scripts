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

const OFFER_SKIP = 20000; // после этого — кнопки Retry / Continue
const LONG_WAIT = 45000;  // после этого — строка «дольше обычного»

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Ждёт связи с бэкендом, показывая boot-лог. Как именно её добиваться, экран
// не знает — это дело connect({ onAttempt, cancelled }) из apiBase.js, который
// гоняет все известные имена сервера и выбирает ответившее. Сюда приходит
// только результат: true — связь есть, false — юзер нажал Continue.
//
// После связи, но ДО скрытия оверлея, прогоняется prepare(log): там грузятся
// сессия и снимок базы, а их прогресс идёт строками в тот же лог. Так вся
// «доподгрузка» происходит под лоадером, а не мелькает уже в приложении.
// Резолвится тем, что вернул prepare (или undefined, если юзер нажал Continue
// до пробуждения сервера).
export function bootScreen(connect, { prepare } = {}) {
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

            const woke = await connect({
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
