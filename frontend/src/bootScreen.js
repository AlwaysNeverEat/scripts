// ── Экран загрузки: терминальный boot-лог (порт макета из Figma Make) ────────
// Бэкенд на Render (free) засыпает без трафика и просыпается 30–60 секунд.
// Всё это время ни поиск, ни база не работают, поэтому при старте показываем
// оверлей: строки лога и 100% прогресса привязаны к реальному ответу /health,
// а не к таймеру. Разметка — в index.html (#boot-screen).

const RETRY_DELAY = 2000;   // пауза между попытками достучаться
const PING_TIMEOUT = 10000; // таймаут одной попытки
const LONG_WAIT = 45000;    // после этого — строка «дольше обычного»
const GIVE_UP = 90000;      // после этого — кнопки Retry / Continue

async function ping(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), PING_TIMEOUT);
    try {
        const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
        return res.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Ждёт, пока сервер ответит на pingUrl, показывая boot-лог.
// Резолвится когда оверлей скрыт (сервер готов или юзер нажал Continue).
export function bootScreen(pingUrl) {
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

        function dismiss() {
            if (settled) return;
            settled = true;
            clearInterval(creep);
            overlay.classList.add('boot-done');
            overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
            resolve();
        }

        async function finish() {
            clearInterval(creep);
            addLine('Connection established.');
            barFill.style.width = '100%';
            await sleep(250);
            addLine('Car database online.');
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

            let attempt = 0;
            let retryLine = null;
            let longWarned = false;

            while (!(await ping(pingUrl))) {
                if (settled) return; // юзер нажал Continue — тихо выходим
                attempt++;
                pingLine.textContent = 'Contacting server... no response';
                if (!retryLine) {
                    retryLine = addLine('Server is asleep — waking it up...');
                    hint.classList.remove('hidden');
                } else {
                    retryLine.textContent = `Waking the server... attempt ${attempt}`;
                }
                const elapsed = Date.now() - t0;
                if (elapsed > LONG_WAIT && !longWarned) {
                    longWarned = true;
                    addLine('Taking longer than usual, still trying...');
                }
                if (elapsed > GIVE_UP) actions.classList.remove('hidden');
                await sleep(RETRY_DELAY);
            }

            if (settled) return;
            pingLine.textContent = 'Contacting server... OK';
            if (retryLine) retryLine.textContent = `Server is awake (took ${Math.round((Date.now() - t0) / 1000)}s)`;
            actions.classList.add('hidden');
            await finish();
        })();
    });
}
