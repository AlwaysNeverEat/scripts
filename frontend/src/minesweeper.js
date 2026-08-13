// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Сапёр» — окно игры.
//
// Открывается ТОЛЬКО из поиска на главной: набрать «сапер» и нажать Enter
// (см. main.js). Пока это слово набирают, поиск молчит.
//
// Поле здесь не генерируется и не хранится: раскладка мин живёт на сервере
// (routes/minesweeper.js), браузер шлёт «открыть клетку» и рисует то, что
// открылось. Поэтому партия и переживает F5 — состояние спрашивается у сервера,
// а не лежит во вкладке.
//
// Клиентские тут только флажки: это пометки для себя. Они лежат в localStorage
// (чтобы пережить F5) и уезжают на сервер лишь вместе с «аккордом» — кликом по
// цифре, вокруг которой уже расставлены все флажки.
// ─────────────────────────────────────────────────────────────────────────────

const FLAGS_PREFIX = 'minesweeper_flags_';
const MODAL_ID = 'minesweeper-modal';
const LONG_PRESS_MS = 400;

let openState = null; // одно окно за раз

/** Открыть игру. ctx: { apiFetch, user }. */
export function openMinesweeper(ctx) {
    if (openState) return openState.modal;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'modal';
    modal.innerHTML = shellHtml();
    document.body.appendChild(modal);
    document.body.classList.add('modal-open');

    const state = {
        ctx,
        modal,
        game: null,        // { rows, cols, mines, state, opened, seconds, minePositions? }
        opened: new Map(), // index → цифра
        flags: new Set(),
        mines: new Set(),  // известны только после конца партии
        flagMode: false,
        busy: false,
        seconds: 0,
        timerId: 0,
        pressTimer: 0,
    };
    openState = state;

    const close = () => {
        clearInterval(state.timerId);
        document.removeEventListener('keydown', onKey, true);
        modal.remove();
        document.body.classList.remove('modal-open');
        openState = null;
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    document.addEventListener('keydown', onKey, true);

    modal.querySelector('.modal-backdrop').onclick = close;
    modal.querySelector('#ms-close').onclick = close;
    modal.querySelector('#ms-new').onclick = () => startNew(state);
    modal.querySelector('#ms-flagmode').onclick = () => {
        state.flagMode = !state.flagMode;
        renderToolbar(state);
    };
    bindBoard(state);

    loadState(state);
    return modal;
}

function shellHtml() {
    return `
        <div class="modal-backdrop"></div>
        <div class="modal-win ms-win">
            <div class="modal-head">
                <span>Сапёр</span>
                <button class="btn btn-sec" id="ms-close" title="Закрыть">✕</button>
            </div>
            <div class="ms-body">
                <div class="ms-toolbar">
                    <span class="ms-counter" id="ms-mines">💣 —</span>
                    <span class="ms-counter" id="ms-timer">⏱ 0:00</span>
                    <button type="button" class="btn btn-sec ms-flagmode" id="ms-flagmode" title="Режим флажков (или правая кнопка / долгое нажатие)">🚩</button>
                    <button type="button" class="btn btn-pri" id="ms-new">Заново</button>
                </div>
                <div class="ms-msg" id="ms-msg"></div>
                <div class="ms-board" id="ms-board"></div>
                <div class="ms-hint">Правая кнопка или долгое нажатие — флажок. Клик по цифре с расставленными флажками открывает соседей.</div>
            </div>
        </div>`;
}

// ── Загрузка и ходы ──────────────────────────────────────────────────────────

async function loadState(state) {
    try {
        const res = await state.ctx.apiFetch('/api/minesweeper/state');
        applyState(state, res);
    } catch {
        message(state, 'Сервер не отвечает — игра будет позже');
    }
}

async function startNew(state) {
    if (state.busy) return;
    state.busy = true;
    try {
        const res = await state.ctx.apiFetch('/api/minesweeper/new', { method: 'POST', body: {} });
        state.flags.clear();
        saveFlags(state);
        applyState(state, res);
        message(state, '');
    } catch {
        message(state, 'Сервер не ответил — попробуйте ещё раз');
    }
    state.busy = false;
}

function applyState(state, res) {
    if (!openState) return;
    state.game = res.game;
    state.opened = new Map(res.game.opened);
    state.mines = new Set(res.game.minePositions || []);
    // Флажки живут в браузере и переживают F5 — партия-то на сервере та же.
    // Снимаем только те, что оказались на открытых клетках: партия могла уйти
    // вперёд в другой вкладке, и метка на открытой клетке — мусор.
    state.flags = loadFlags(state);
    for (const i of [...state.flags]) if (state.opened.has(i)) state.flags.delete(i);
    state.seconds = res.game.seconds || 0;
    buildBoard(state);
    startTimer(state);
    renderAll(state);
}

async function move(state, index, mode) {
    if (state.busy || !state.game) return;
    if (state.game.state === 'won' || state.game.state === 'lost') return;
    state.busy = true;
    let res;
    try {
        res = await state.ctx.apiFetch('/api/minesweeper/open', {
            method: 'POST',
            body: { index, mode, flags: mode === 'chord' ? [...state.flags] : [] },
        });
    } catch {
        state.busy = false;
        message(state, 'Сервер не ответил — ход не засчитан');
        return;
    }
    state.busy = false;
    if (!openState) return;

    state.game = res.game;
    state.opened = new Map(res.game.opened);
    state.mines = new Set(res.game.minePositions || []);
    for (const i of [...state.flags]) if (state.opened.has(i)) state.flags.delete(i);
    state.seconds = res.game.seconds || 0;
    saveFlags(state);
    startTimer(state);
    renderAll(state);

    if (state.game.state === 'won') {
        message(state, `Поле разминировано за ${timeText(state.seconds)}`, 'win');
    } else if (state.game.state === 'lost') {
        message(state, 'Мина. Нажмите «Заново» — поле соберётся новое', 'lose');
    }
}

// ── Флажки ───────────────────────────────────────────────────────────────────

function flagsKey(state) {
    return FLAGS_PREFIX + (state.ctx.user?.id || 'anon');
}

function loadFlags(state) {
    try {
        const saved = JSON.parse(localStorage.getItem(flagsKey(state)) || '[]');
        return new Set(Array.isArray(saved) ? saved.filter(Number.isInteger) : []);
    } catch {
        return new Set();
    }
}

function saveFlags(state) {
    try {
        localStorage.setItem(flagsKey(state), JSON.stringify([...state.flags]));
    } catch {
        // Приватный режим: флажки не переживут F5, играть это не мешает.
    }
}

function toggleFlag(state, index) {
    if (!state.game || state.opened.has(index)) return;
    if (state.game.state === 'won' || state.game.state === 'lost') return;
    if (state.flags.has(index)) state.flags.delete(index);
    else state.flags.add(index);
    saveFlags(state);
    drawCell(state, index);
    renderToolbar(state);
}

// ── Таймер ───────────────────────────────────────────────────────────────────

function startTimer(state) {
    clearInterval(state.timerId);
    renderTimer(state);
    if (!state.game || state.game.state !== 'play') return;
    state.timerId = setInterval(() => {
        state.seconds++;
        renderTimer(state);
    }, 1000);
}

function timeText(sec) {
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// ── Поле ─────────────────────────────────────────────────────────────────────

function buildBoard(state) {
    const board = state.modal.querySelector('#ms-board');
    const { rows, cols } = state.game;
    board.style.setProperty('--ms-cols', cols);
    board.innerHTML = Array.from({ length: rows * cols },
        (_, i) => `<button type="button" class="ms-cell" data-i="${i}"></button>`).join('');
    for (let i = 0; i < rows * cols; i++) drawCell(state, i);
}

function drawCell(state, index) {
    const cell = state.modal.querySelector(`.ms-cell[data-i="${index}"]`);
    if (!cell) return;
    const over = state.game.state === 'won' || state.game.state === 'lost';
    const isMine = state.mines.has(index);
    const opened = state.opened.has(index);
    const flagged = state.flags.has(index);

    let cls = 'ms-cell';
    let text = '';
    if (opened) {
        const n = state.opened.get(index);
        cls += ' is-open' + (n ? ` n${n}` : '');
        text = n ? String(n) : '';
    } else if (over && isMine) {
        // Конец партии: мины показываем все, а неверные флажки — перечёркнутыми,
        // иначе непонятно, где именно ошибся.
        cls += flagged ? ' is-mine is-flag-ok' : ' is-mine';
        text = '💣';
    } else if (flagged) {
        cls += over ? ' is-flag is-flag-bad' : ' is-flag';
        text = '🚩';
    }
    cell.className = cls;
    cell.textContent = text;
}

function bindBoard(state) {
    const board = state.modal.querySelector('#ms-board');

    board.addEventListener('click', (e) => {
        const cell = e.target.closest('.ms-cell');
        if (!cell) return;
        const i = Number(cell.dataset.i);
        if (state.flagMode) { toggleFlag(state, i); return; }
        // Клик по цифре — «аккорд»: сервер откроет соседей, если флажков ровно
        // столько, сколько показывает цифра.
        if (state.opened.has(i)) { if (state.opened.get(i)) move(state, i, 'chord'); return; }
        if (state.flags.has(i)) return;   // под флажком не открываем: это защита от промаха
        move(state, i, 'open');
    });

    board.addEventListener('contextmenu', (e) => {
        const cell = e.target.closest('.ms-cell');
        if (!cell) return;
        e.preventDefault();
        toggleFlag(state, Number(cell.dataset.i));
    });

    // Долгое нажатие на телефоне = флажок. Отпускание раньше времени оставляет
    // обычный клик, поэтому здесь только таймер и его отмена.
    const cancel = () => { clearTimeout(state.pressTimer); state.pressTimer = 0; };
    board.addEventListener('touchstart', (e) => {
        const cell = e.target.closest('.ms-cell');
        if (!cell) return;
        const i = Number(cell.dataset.i);
        state.pressTimer = setTimeout(() => {
            state.pressTimer = 0;
            toggleFlag(state, i);
            // Чтобы следом не прилетел click по той же клетке.
            cell.dataset.longPress = '1';
        }, LONG_PRESS_MS);
    }, { passive: true });
    board.addEventListener('touchend', (e) => {
        cancel();
        const cell = e.target.closest('.ms-cell');
        if (cell?.dataset.longPress) {
            delete cell.dataset.longPress;
            e.preventDefault();
        }
    });
    board.addEventListener('touchmove', cancel, { passive: true });
}

// ── Отрисовка ────────────────────────────────────────────────────────────────

function renderAll(state) {
    const { rows, cols } = state.game;
    for (let i = 0; i < rows * cols; i++) drawCell(state, i);
    renderToolbar(state);
}

function renderToolbar(state) {
    const left = state.game ? state.game.mines - state.flags.size : 0;
    state.modal.querySelector('#ms-mines').textContent = `💣 ${left}`;
    const btn = state.modal.querySelector('#ms-flagmode');
    btn.classList.toggle('active', state.flagMode);
    btn.setAttribute('aria-pressed', state.flagMode ? 'true' : 'false');
    renderTimer(state);
}

function renderTimer(state) {
    state.modal.querySelector('#ms-timer').textContent = `⏱ ${timeText(state.seconds)}`;
}

function message(state, text, kind = '') {
    const el = state.modal.querySelector('#ms-msg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'ms-msg' + (kind ? ' is-' + kind : '') + (text ? '' : ' hidden');
}

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
