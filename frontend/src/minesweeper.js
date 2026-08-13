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
//
// Открытие показывается ВОЛНОЙ от клетки, по которой кликнули: клеткам ставится
// --d (расстояние в ходах короля), из него CSS делает задержку анимации. Разом
// открывшиеся полсотни клеток без этого выглядят одним рывком — «подвисло и
// перерисовалось», хотя ответ пришёл за десяток миллисекунд.
// ─────────────────────────────────────────────────────────────────────────────

import { mineIcon, flagIcon, timerIcon } from './icons.js';

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
        fresh: new Set(),  // что открылось последним ходом — для волны
        rippleFrom: null,  // клетка, из которой волна идёт
        cells: [],         // узлы клеток по индексу (см. buildBoard)
        drawn: [],         // что в клетке нарисовано сейчас — чтобы не трогать её зря
        flagMode: false,
        busy: false,
        pending: null,     // клетка, по которой кликнули, пока ответ в пути
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
                    <span class="ms-counter" id="ms-mines">${mineIcon(15)}<b>—</b></span>
                    <span class="ms-counter" id="ms-timer">${timerIcon(15)}<b>0:00</b></span>
                    <button type="button" class="btn btn-sec ms-flagmode" id="ms-flagmode"
                            aria-pressed="false" title="Режим флажков (или правая кнопка / долгое нажатие)">${flagIcon(16)}</button>
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
    // Восстановленную партию не «проявляем»: человек её уже видел.
    state.fresh = new Set();
    state.rippleFrom = null;
    buildBoard(state);
    startTimer(state);
    renderAll(state);
}

async function move(state, index, mode) {
    if (state.busy || !state.game) return;
    if (state.game.state === 'won' || state.game.state === 'lost') return;
    state.busy = true;
    // Ход уходит на сервер, и ответ идёт хоть и быстро, но не мгновенно.
    // Клетка под курсором сразу подмигивает: без этого клик выглядит
    // пропущенным, и человек жмёт второй раз.
    state.pending = index;
    drawCell(state, index);
    let res;
    try {
        res = await state.ctx.apiFetch('/api/minesweeper/open', {
            method: 'POST',
            body: { index, mode, flags: mode === 'chord' ? [...state.flags] : [] },
        });
    } catch {
        state.busy = false;
        state.pending = null;
        drawCell(state, index);
        message(state, 'Сервер не ответил — ход не засчитан');
        return;
    }
    state.busy = false;
    state.pending = null;
    if (!openState) return;

    state.game = res.game;
    state.opened = new Map(res.game.opened);
    state.mines = new Set(res.game.minePositions || []);
    for (const i of [...state.flags]) if (state.opened.has(i)) state.flags.delete(i);
    state.seconds = res.game.seconds || 0;
    // Волна пойдёт от клетки, по которой кликнули; на проигрыше — от той, где
    // рвануло: мины всплывают кругами от неё.
    state.fresh = new Set(res.revealed || []);
    state.rippleFrom = index;
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
    // Узлы клеток запоминаем один раз. Искать их по data-i на каждую перерисовку
    // значило бы 324 обхода поддерева на КАЖДЫЙ ход — это и была основная часть
    // тормозов: сам поиск дороже той работы, ради которой он затевался.
    state.cells = [...board.children];
    state.drawn = [];
    for (let i = 0; i < rows * cols; i++) drawCell(state, i);
}

// Расстояние в ходах короля до клетки, из которой идёт волна. Шагов больше
// десяти не бывает: дальше задержка перестаёт читаться и только тормозит показ.
const RIPPLE_STEPS = 10;

function rippleDistance(state, index) {
    if (state.rippleFrom == null) return 0;
    const { cols } = state.game;
    const dr = Math.abs(Math.floor(index / cols) - Math.floor(state.rippleFrom / cols));
    const dc = Math.abs((index % cols) - (state.rippleFrom % cols));
    return Math.min(Math.max(dr, dc), RIPPLE_STEPS);
}

function drawCell(state, index) {
    const cell = state.cells[index];
    if (!cell) return;
    const over = state.game.state === 'won' || state.game.state === 'lost';
    const isMine = state.mines.has(index);
    const opened = state.opened.has(index);
    const flagged = state.flags.has(index);

    let cls = 'ms-cell';
    let html = '';
    if (opened) {
        const n = state.opened.get(index);
        cls += ' is-open' + (n ? ` n${n}` : '');
        if (state.fresh.has(index)) cls += ' is-fresh';
        html = n ? String(n) : '';
    } else if (state.game.state === 'won' && !opened) {
        // Победа: всё, что осталось закрытым, — мины. Расставляем флажки сами,
        // как в классическом сапёре: поле должно выглядеть законченным.
        cls += ' is-found';
        html = flagIcon();
    } else if (over && isMine) {
        // Проигрыш: показываем все мины, а та, на которой подорвались, — с
        // вспышкой. Остальные всплывают волной от неё.
        cls += ' is-mine';
        if (index === state.rippleFrom) cls += ' is-boom';
        else cls += ' is-fresh';
        html = mineIcon();
    } else if (flagged) {
        cls += over ? ' is-flag is-flag-bad' : ' is-flag';
        html = flagIcon();
    }
    if (state.pending === index) cls += ' is-pending';
    // Задержка волны живёт в CSS-переменной: пересчитывать её на каждый кадр
    // в JS незачем, браузер сам разведёт анимации по времени.
    const d = cls.includes('is-fresh') ? rippleDistance(state, index) : null;

    // Клетку, в которой ничего не изменилось, не трогаем вовсе. Ход меняет
    // единицы клеток из 324, а раньше перерисовывались все: каждой заново
    // присваивались className и innerHTML, то есть браузер получал 324 грязных
    // элемента и пересчитывал стили и раскладку всего поля. Заодно уходит
    // мельтешение: innerHTML на клетке с флажком перезапускал анимацию значка,
    // и флажки подпрыгивали на каждый чужой ход.
    const was = state.drawn[index];
    if (was && was.cls === cls && was.d === d && was.html === html) return;
    state.drawn[index] = { cls, d, html };

    if (d === null) cell.style.removeProperty('--d');
    else cell.style.setProperty('--d', d);
    cell.className = cls;
    if (!was || was.html !== html) cell.innerHTML = html;
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

    // Меню браузера гасим на ВСЁМ поле, а не только на клетках: у клеток
    // скруглённые углы, и на стыках четырёх соседей остаются точки, которые
    // принадлежат уже контейнеру. Попасть в них правой кнопкой — значит вместо
    // флажка получить системное меню, и целиться в такие мелочи игрок не должен.
    board.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const cell = e.target.closest('.ms-cell');
        if (cell) toggleFlag(state, Number(cell.dataset.i));
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
    const board = state.modal.querySelector('#ms-board');
    board.classList.toggle('is-won', state.game.state === 'won');
    board.classList.toggle('is-lost', state.game.state === 'lost');
    renderToolbar(state);
}

function renderToolbar(state) {
    const left = state.game ? state.game.mines - state.flags.size : 0;
    setCounter(state, '#ms-mines', String(left));
    const btn = state.modal.querySelector('#ms-flagmode');
    btn.classList.toggle('active', state.flagMode);
    btn.setAttribute('aria-pressed', state.flagMode ? 'true' : 'false');
    renderTimer(state);
}

function renderTimer(state) {
    setCounter(state, '#ms-timer', timeText(state.seconds));
}

// Меняем только цифру внутри счётчика (иконка остаётся на месте) и коротко
// подмигиваем, когда значение изменилось: иначе счётчик мин выглядит мёртвым.
function setCounter(state, sel, text) {
    const box = state.modal.querySelector(sel);
    const value = box?.querySelector('b');
    if (!value || value.textContent === text) return;
    value.textContent = text;
    box.classList.remove('is-bump');
    void box.offsetWidth; // перезапуск анимации
    box.classList.add('is-bump');
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
