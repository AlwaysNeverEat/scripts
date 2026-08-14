// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Вордле» — окно игры.
//
// Открывается ТОЛЬКО из меню игр (games.js), а оно — из поиска на главной:
// набрать «игры» и нажать Enter. Пока это слово набирают, поиск сознательно
// молчит — иначе подсказка выдала бы пасхалку тому, кто её не искал.
//
// Слово загадывает сервер и клиенту не отдаёт: сюда приходит только раскраска
// попытки (routes/wordle.js). Отсюда и вся структура — «сыгранные попытки»
// хранятся локально, а правда о слове живёт на бэкенде.
//
// Сыгранное помнит localStorage — по ключу с id аккаунта и датой МСК: обновил
// страницу или ушёл на другую вкладку — доска на месте, а в полночь она
// начинается заново вместе с новым словом.
// ─────────────────────────────────────────────────────────────────────────────

import { WORD_LENGTH, MAX_TRIES, normalizeWord } from '../../shared/wordle.js';
import { backspaceIcon } from './icons.js';

const KEY_ROWS = [
    'йцукенгшщзхъ',
    'фывапролджэ',
    'ячсмитьбю',
];

// Те же ряды, но по физическим клавишам: у половины людей раскладка в этот
// момент английская, и «переключите язык» — плохой ответ на попытку поиграть.
// event.code не зависит от раскладки, поэтому и русская, и английская дают одну
// и ту же букву — ровно ту, что нарисована на клавише в ЙЦУКЕН.
const CODE_LETTERS = {
    KeyQ: 'й', KeyW: 'ц', KeyE: 'у', KeyR: 'к', KeyT: 'е', KeyY: 'н',
    KeyU: 'г', KeyI: 'ш', KeyO: 'щ', KeyP: 'з', BracketLeft: 'х', BracketRight: 'ъ',
    KeyA: 'ф', KeyS: 'ы', KeyD: 'в', KeyF: 'а', KeyG: 'п', KeyH: 'р',
    KeyJ: 'о', KeyK: 'л', KeyL: 'д', Semicolon: 'ж', Quote: 'э',
    KeyZ: 'я', KeyX: 'ч', KeyC: 'с', KeyV: 'м', KeyB: 'и', KeyN: 'т',
    KeyM: 'ь', Comma: 'б', Period: 'ю', Backquote: 'е',
};

const STORAGE_PREFIX = 'wordle_progress_';
const MODAL_ID = 'wordle-modal';

// Раскраска буквы на клавиатуре — по лучшему, что о ней известно.
const MARK_RANK = { miss: 0, near: 1, hit: 2 };

let openState = null; // одно окно за раз

/**
 * Открыть игру. ctx: { apiFetch, user } — user нужен, чтобы прогресс одного
 * аккаунта не показывался другому на общем компьютере.
 */
export function openWordle(ctx) {
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
        day: null,
        resetAt: null,
        rows: [],          // [{ guess, marks }]
        current: '',
        done: null,        // 'win' | 'lose'
        answer: null,
        busy: false,
        timerId: 0,
    };
    openState = state;

    const close = () => {
        clearInterval(state.timerId);
        document.removeEventListener('keydown', onKey, true);
        modal.remove();
        document.body.classList.remove('modal-open');
        openState = null;
    };
    const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        // Ctrl+R, Cmd+W и прочие сочетания остаются сочетаниями, а не буквами.
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const key = gameKey(e);
        if (!key) return;
        // Клавиши игры не должны заодно печататься в строку поиска под окном.
        e.preventDefault();
        handleKey(state, key);
    };
    document.addEventListener('keydown', onKey, true);

    modal.querySelector('.modal-backdrop').onclick = close;
    modal.querySelector('#wordle-close').onclick = close;
    modal.querySelector('.wordle-keyboard').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-key]');
        if (btn) handleKey(state, btn.dataset.key);
    });

    startDay(state);
    return modal;
}

// Что из нажатого вообще относится к игре: Enter, стирание и буква (своя или
// добытая из физической клавиши при английской раскладке).
function gameKey(e) {
    if (e.key === 'Enter' || e.key === 'Backspace') return e.key;
    if (/^[а-яё]$/i.test(e.key)) return normalizeWord(e.key);
    if (/^[a-z]$/i.test(e.key) || /^[,.;'\[\]`]$/.test(e.key)) return CODE_LETTERS[e.code] || '';
    return '';
}

function shellHtml() {
    return `
        <div class="modal-backdrop"></div>
        <div class="modal-win wordle-win">
            <div class="modal-head">
                <span>Вордле — слово из пяти букв</span>
                <button class="btn btn-sec" id="wordle-close" title="Закрыть">✕</button>
            </div>
            <div class="wordle-body">
                <div class="wordle-msg" id="wordle-msg"></div>
                <div class="wordle-board" id="wordle-board"></div>
                <div class="wordle-keyboard" id="wordle-keyboard"></div>
                <div class="wordle-foot">
                    <span class="wordle-timer" id="wordle-timer">…</span>
                    <span class="wordle-hint">У каждого аккаунта слово своё</span>
                </div>
            </div>
        </div>`;
}

// ── Сутки и прогресс ─────────────────────────────────────────────────────────

async function startDay(state) {
    // Пустая доска рисуется до ответа сервера — иначе окно секунду висит дырой.
    buildBoard(state);
    renderKeyboard(state);
    let today;
    try {
        today = await state.ctx.apiFetch('/api/wordle/today');
    } catch {
        message(state, 'Сервер не отвечает — игра будет позже');
        return;
    }
    if (!openState) return; // окно успели закрыть
    state.day = today.day;
    state.resetAt = today.resetAt;
    restoreProgress(state);
    buildBoard(state);
    renderKeyboard(state);
    renderStatus(state);
    startTimer(state);
}

function storageKey(state) {
    return STORAGE_PREFIX + (state.ctx.user?.id || 'anon');
}

function restoreProgress(state) {
    state.rows = [];
    state.current = '';
    state.done = null;
    state.answer = null;
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey(state)) || 'null');
        // Прогресс за прошлые сутки не восстанавливаем: слово уже другое.
        if (!saved || saved.day !== state.day) return;
        state.rows = Array.isArray(saved.rows) ? saved.rows.slice(0, MAX_TRIES) : [];
        state.done = saved.done || null;
        state.answer = saved.answer || null;
    } catch {
        // Битый JSON в localStorage — не повод не дать поиграть.
    }
}

function saveProgress(state) {
    try {
        localStorage.setItem(storageKey(state), JSON.stringify({
            day: state.day,
            rows: state.rows,
            done: state.done,
            answer: state.answer,
        }));
    } catch {
        // Приватный режим или переполненное хранилище: доска не переживёт F5,
        // но играть это не мешает.
    }
}

// Таймер до 00:00 МСК считаем от серверного resetAt, а не от часов браузера.
function startTimer(state) {
    clearInterval(state.timerId);
    const tick = () => {
        const left = new Date(state.resetAt).getTime() - Date.now();
        const el = state.modal.querySelector('#wordle-timer');
        if (!el) return;
        if (left <= 0) {
            el.textContent = 'Новое слово уже загадано';
            clearInterval(state.timerId);
            startDay(state); // сутки сменились — перечитываем день и чистим доску
            return;
        }
        el.textContent = `Новое слово через ${hms(left)}`;
    };
    tick();
    state.timerId = setInterval(tick, 1000);
}

function hms(ms) {
    const total = Math.floor(ms / 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(Math.floor(total / 3600))}:${p(Math.floor(total / 60) % 60)}:${p(total % 60)}`;
}

// ── Ввод ─────────────────────────────────────────────────────────────────────

function handleKey(state, key) {
    if (!state.day || state.done || state.busy) return;
    if (key === 'Enter') { submit(state); return; }
    if (key === 'Backspace') {
        state.current = state.current.slice(0, -1);
        drawCurrentRow(state);
        return;
    }
    if (!/^[а-яё]$/i.test(key)) return;
    if (state.current.length >= WORD_LENGTH) return;
    state.current += normalizeWord(key);
    drawCurrentRow(state);
}

async function submit(state) {
    const guess = state.current;
    if (guess.length < WORD_LENGTH) { shake(state, 'Нужно пять букв'); return; }

    state.busy = true;
    let res;
    try {
        res = await state.ctx.apiFetch('/api/wordle/guess', {
            method: 'POST',
            body: { guess, attempt: state.rows.length + 1 },
        });
    } catch {
        state.busy = false;
        shake(state, 'Сервер не ответил — попробуйте ещё раз');
        return;
    }
    state.busy = false;
    if (!openState) return;

    if (!res.ok) {
        shake(state, res.reason === 'unknown_word' ? 'Такого слова нет в словаре' : 'Нужно пять русских букв');
        return;
    }
    // Полночь наступила прямо посреди партии — слово уже другое, доску начинаем
    // заново, а не дорисовываем чужую раскраску.
    if (res.day !== state.day) { message(state, 'Наступила полночь — слово сменилось'); startDay(state); return; }

    const row = state.rows.length;
    state.rows.push({ guess, marks: res.marks });
    state.current = '';
    if (res.win) state.done = 'win';
    else if (state.rows.length >= MAX_TRIES) state.done = 'lose';
    if (res.answer) state.answer = res.answer;
    saveProgress(state);
    drawRow(state, row, { animate: true });
    renderKeyboard(state);
    renderStatus(state);
}

// ── Отрисовка ────────────────────────────────────────────────────────────────
//
// Доска собирается ОДИН раз, дальше меняются только те клетки, которые реально
// изменились. Перерисовывать всё на каждую букву нельзя: новые узлы заново
// запускают анимацию переворота, и вся доска «прокручивалась» на каждое
// нажатие. Анимация — только у строки, которую сейчас отправили (is-reveal).

function buildBoard(state) {
    const board = state.modal.querySelector('#wordle-board');
    const rows = [];
    for (let r = 0; r < MAX_TRIES; r++) {
        // Номер клетки в строке — из него CSS считает задержку и переворота,
        // и подскока: держать в inline-стиле готовую задержку нельзя, она
        // накрыла бы обе анимации разом.
        const cells = Array.from({ length: WORD_LENGTH }, (_, i) =>
            `<div class="wordle-cell" style="--i:${i}"></div>`).join('');
        rows.push(`<div class="wordle-row" data-row="${r}">${cells}</div>`);
    }
    board.innerHTML = rows.join('');
    // Сыгранное (после F5 или в новых сутках) показываем сразу раскрашенным:
    // переворачивать строки, которые человек уже видел, незачем.
    for (let r = 0; r < state.rows.length; r++) drawRow(state, r, { animate: false });
    drawCurrentRow(state);
}

function rowCells(state, r) {
    return state.modal.querySelectorAll(`.wordle-row[data-row="${r}"] .wordle-cell`);
}

// Сыгранная строка: буквы и раскраска. animate — только для только что
// отправленной попытки.
function drawRow(state, r, { animate }) {
    const played = state.rows[r];
    const row = state.modal.querySelector(`.wordle-row[data-row="${r}"]`);
    if (!played || !row) return;
    row.classList.add('is-played');
    row.classList.toggle('is-reveal', !!animate);
    // Угаданная строка подпрыгивает — но только когда её открыли сейчас, а не
    // при восстановлении доски после F5.
    row.classList.toggle('is-win', !!animate && played.marks.every(m => m === 'hit'));
    rowCells(state, r).forEach((cell, i) => {
        cell.textContent = played.guess[i].toUpperCase();
        cell.className = 'wordle-cell is-' + played.marks[i];
    });
}

// Набираемая строка: меняем только те клетки, где буква стала другой, —
// иначе браузер считает узел новым и снова играет анимацию.
function drawCurrentRow(state) {
    const r = state.rows.length;
    if (r >= MAX_TRIES) return;
    rowCells(state, r).forEach((cell, i) => {
        const letter = (state.current[i] || '').toUpperCase();
        if (cell.textContent !== letter) cell.textContent = letter;
        cell.classList.toggle('is-typed', !!letter);
    });
}

function renderKeyboard(state) {
    const best = new Map();
    for (const row of state.rows) {
        row.guess.split('').forEach((ch, i) => {
            const mark = row.marks[i];
            if (MARK_RANK[mark] > (MARK_RANK[best.get(ch)] ?? -1)) best.set(ch, mark);
        });
    }
    const keyBtn = (ch) => {
        const mark = best.get(ch);
        return `<button type="button" class="wordle-key${mark ? ' is-' + mark : ''}" data-key="${ch}">${ch.toUpperCase()}</button>`;
    };
    const rows = KEY_ROWS.map((line, idx) => {
        const keys = line.split('').map(keyBtn).join('');
        if (idx < KEY_ROWS.length - 1) return `<div class="wordle-krow">${keys}</div>`;
        return `<div class="wordle-krow">
                    <button type="button" class="wordle-key wordle-key-wide" data-key="Enter">Ввод</button>
                    ${keys}
                    <button type="button" class="wordle-key wordle-key-wide" data-key="Backspace" aria-label="Стереть">${backspaceIcon(17)}</button>
                </div>`;
    });
    state.modal.querySelector('#wordle-keyboard').innerHTML = rows.join('');
}

function renderStatus(state) {
    if (state.done === 'win') {
        const n = state.rows.length;
        message(state, n === 1 ? 'С первой попытки. Так не бывает.' : `Отгадано с ${n}-й попытки`, 'win');
    } else if (state.done === 'lose') {
        message(state, `Попытки кончились. Слово было «${(state.answer || '').toUpperCase()}»`, 'lose');
    } else {
        // Игра снова идёт (новые сутки) — итог прошлой партии убираем.
        message(state, '');
    }
}

function message(state, text, kind = '') {
    const el = state.modal.querySelector('#wordle-msg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'wordle-msg' + (kind ? ' is-' + kind : '') + (text ? '' : ' hidden');
}

// Отказ (нет такого слова, мало букв) показываем на самой строке: сообщение под
// доской на телефоне остаётся за кадром.
function shake(state, text) {
    message(state, text);
    const row = state.modal.querySelector(`.wordle-row[data-row="${state.rows.length}"]`);
    if (row) {
        row.classList.remove('is-bad');
        void row.offsetWidth; // перезапуск анимации
        row.classList.add('is-bad');
    }
    clearTimeout(state.msgTimer);
    state.msgTimer = setTimeout(() => { if (openState === state && !state.done) message(state, ''); }, 2000);
}
