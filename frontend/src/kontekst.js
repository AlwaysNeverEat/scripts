// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Контекстно» — окно игры.
//
// Открывается ТОЛЬКО из меню игр (games.js), а оно — из поиска на главной:
// набрать «игры» и нажать Enter. Пока это слово набирают, поиск молчит.
//
// Смысл игры: на каждое названное слово сервер отвечает его МЕСТОМ в списке,
// отсортированном по смысловой близости к загаданному. 1 — оно и есть,
// 30 000 — «совсем не туда». Само слово сервер не отдаёт, пока не сдашься
// (routes/kontekst.js), поэтому здесь нет и не может быть никакой проверки
// догадок «на месте» — только показ того, что ответили.
//
// Сыгранное помнит localStorage под id аккаунта и датой МСК: обновил страницу
// — список догадок на месте, в полночь начинается заново.
// ─────────────────────────────────────────────────────────────────────────────

import { rankHeat, rankProgress, normalizeWord } from '../../shared/kontekst.js';

const STORAGE_PREFIX = 'kontekst_progress_';
const MODAL_ID = 'kontekst-modal';

// С какого числа догадок последнюю начинаем дублировать над списком.
const PIN_AFTER = 8;

let openState = null; // одно окно за раз

/** Открыть игру. ctx: { apiFetch, user }. */
export function openKontekst(ctx) {
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
        vocab: 30000,
        guesses: [],       // [{ word, rank }] в порядке ввода
        last: null,        // слово последней догадки — его подсвечиваем
        done: null,        // 'win' | 'giveup'
        answer: null,
        closest: [],
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
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    document.addEventListener('keydown', onKey, true);

    modal.querySelector('.modal-backdrop').onclick = close;
    modal.querySelector('#kontekst-close').onclick = close;
    modal.querySelector('#kontekst-form').onsubmit = (e) => { e.preventDefault(); submit(state); };
    modal.querySelector('#kontekst-hint').onclick = () => askHint(state);
    modal.querySelector('#kontekst-giveup').onclick = () => giveUp(state);

    startDay(state);
    return modal;
}

function shellHtml() {
    return `
        <div class="modal-backdrop"></div>
        <div class="modal-win kontekst-win">
            <div class="modal-head">
                <span>Контекстно — угадай слово по смыслу</span>
                <button class="btn btn-sec" id="kontekst-close" title="Закрыть">✕</button>
            </div>
            <div class="kontekst-body">
                <p class="kontekst-rules">
                    Называйте любые существительные. На каждое игра скажет, какое место оно
                    занимает по смысловой близости к загаданному: <b>1</b> — это оно и есть.
                </p>
                <form class="kontekst-form" id="kontekst-form">
                    <input type="text" id="kontekst-input" placeholder="слово…" autocomplete="off"
                           spellcheck="false" autocapitalize="off" maxlength="32"/>
                    <button type="submit" class="btn btn-pri" id="kontekst-go">Проверить</button>
                </form>
                <div class="kontekst-msg" id="kontekst-msg"></div>
                <div class="kontekst-last" id="kontekst-last"></div>
                <div class="kontekst-list" id="kontekst-list"></div>
                <div class="kontekst-foot">
                    <div class="kontekst-foot-row">
                        <button type="button" class="btn btn-sec" id="kontekst-hint">Подсказка</button>
                        <button type="button" class="btn btn-sec" id="kontekst-giveup">Сдаюсь</button>
                        <span class="kontekst-count" id="kontekst-count"></span>
                    </div>
                    <div class="kontekst-foot-row">
                        <span class="kontekst-timer" id="kontekst-timer">…</span>
                        <span class="kontekst-hint-note">У каждого аккаунта слово своё</span>
                    </div>
                </div>
            </div>
        </div>`;
}

// ── Сутки и прогресс ─────────────────────────────────────────────────────────

async function startDay(state) {
    let today;
    try {
        today = await state.ctx.apiFetch('/api/kontekst/today');
    } catch {
        message(state, 'Сервер не отвечает — игра будет позже');
        return;
    }
    if (!openState) return; // окно успели закрыть
    state.day = today.day;
    state.resetAt = today.resetAt;
    state.vocab = today.vocab || state.vocab;
    restoreProgress(state);
    render(state);
    startTimer(state);
    focusInput(state);
}

function storageKey(state) {
    return STORAGE_PREFIX + (state.ctx.user?.id || 'anon');
}

function restoreProgress(state) {
    state.guesses = [];
    state.last = null;
    state.done = null;
    state.answer = null;
    state.closest = [];
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey(state)) || 'null');
        // Догадки за прошлые сутки не восстанавливаем: слово уже другое.
        if (!saved || saved.day !== state.day) return;
        state.guesses = Array.isArray(saved.guesses) ? saved.guesses : [];
        state.done = saved.done || null;
        state.answer = saved.answer || null;
        state.closest = Array.isArray(saved.closest) ? saved.closest : [];
    } catch {
        // Битый JSON в localStorage — не повод не дать поиграть.
    }
}

function saveProgress(state) {
    try {
        localStorage.setItem(storageKey(state), JSON.stringify({
            day: state.day,
            guesses: state.guesses,
            done: state.done,
            answer: state.answer,
            closest: state.closest,
        }));
    } catch {
        // Приватный режим или переполненное хранилище: список не переживёт F5.
    }
}

// Таймер до 00:00 МСК считаем от серверного resetAt, а не от часов браузера.
function startTimer(state) {
    clearInterval(state.timerId);
    const tick = () => {
        const el = state.modal.querySelector('#kontekst-timer');
        if (!el) return;
        const left = new Date(state.resetAt).getTime() - Date.now();
        if (left <= 0) {
            el.textContent = 'Новое слово уже загадано';
            clearInterval(state.timerId);
            startDay(state); // сутки сменились — перечитываем день и чистим список
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

// ── Ход игры ─────────────────────────────────────────────────────────────────

function bestRank(state) {
    return state.guesses.reduce((best, g) => Math.min(best, g.rank), Infinity);
}

async function submit(state) {
    if (state.busy || state.done) return;
    const input = state.modal.querySelector('#kontekst-input');
    const word = normalizeWord(input.value);
    if (!word) return;

    // Уже называли — не гоняем сервер, просто подсвечиваем, где это слово.
    const seen = state.guesses.find(g => g.word === word);
    if (seen) {
        state.last = seen.word;
        input.value = '';
        message(state, 'Это слово уже было');
        render(state);
        return;
    }

    state.busy = true;
    let res;
    try {
        res = await state.ctx.apiFetch('/api/kontekst/guess', { method: 'POST', body: { word } });
    } catch {
        state.busy = false;
        message(state, 'Сервер не ответил — попробуйте ещё раз');
        return;
    }
    state.busy = false;
    if (!openState) return;

    if (!res.ok) {
        message(state, res.reason === 'unknown_word'
            ? `Слова «${word}» нет в словаре игры`
            : 'Только русские слова, от двух букв');
        return;
    }
    // Полночь наступила посреди партии — слово уже другое, начинаем заново.
    if (res.day !== state.day) { message(state, 'Наступила полночь — слово сменилось'); startDay(state); return; }

    input.value = '';
    // Сервер вернул приведённую форму («машиной» → «машина»), и в списке
    // должна оказаться именно она. Заодно это ловит повтор другой формой: без
    // сообщения выглядело бы, будто ввод просто не сработал.
    const already = state.guesses.some(g => g.word === res.word);
    if (!already) state.guesses.push({ word: res.word, rank: res.rank });
    state.last = res.word;
    if (res.win) state.done = 'win';
    message(state, already ? 'Это слово уже было' : '');
    saveProgress(state);
    render(state, { animate: !already });
}

async function askHint(state) {
    if (state.busy || state.done) return;
    state.busy = true;
    let res;
    try {
        res = await state.ctx.apiFetch('/api/kontekst/hint', { method: 'POST', body: { best: bestRank(state) } });
    } catch {
        state.busy = false;
        message(state, 'Сервер не ответил — попробуйте ещё раз');
        return;
    }
    state.busy = false;
    if (!openState) return;
    if (!res.ok) {
        message(state, res.reason === 'no_closer'
            ? 'Ближе подсказать нечего — осталось само слово'
            : 'Подсказки закончились');
        return;
    }

    // Подсказка ложится в список обычной догадкой, но помечается: иначе через
    // час не вспомнить, что из этого нашёл сам.
    if (!state.guesses.some(g => g.word === res.word)) {
        state.guesses.push({ word: res.word, rank: res.rank, hint: true });
    }
    state.last = res.word;
    saveProgress(state);
    render(state, { animate: true });
}

async function giveUp(state) {
    if (state.busy || state.done) return;
    if (!confirm('Показать загаданное слово? Партия на сегодня закончится.')) return;
    state.busy = true;
    let res;
    try {
        res = await state.ctx.apiFetch('/api/kontekst/giveup', { method: 'POST', body: {} });
    } catch {
        state.busy = false;
        message(state, 'Сервер не ответил — попробуйте ещё раз');
        return;
    }
    state.busy = false;
    if (!openState) return;
    state.done = 'giveup';
    state.answer = res.answer;
    state.closest = res.closest || [];
    saveProgress(state);
    render(state);
}

// ── Отрисовка ────────────────────────────────────────────────────────────────

// animate — строка появилась прямо сейчас: она въезжает, и её полоска
// вырастает от нуля. При обычной перерисовке (восстановление после F5, смена
// суток) этого делать нельзя: список дёргался бы весь и целиком.
function render(state, { animate = false } = {}) {
    const { modal } = state;
    const sorted = state.guesses.slice().sort((a, b) => a.rank - b.rank);
    const fresh = animate ? state.last : null;

    // Последнюю догадку держим сверху, только когда список успел стать длинным
    // и она могла уехать из виду: на коротком списке она и так подсвечена, а
    // повтор строки в двух местах читается как ошибка.
    const pinned = !state.done && state.last && state.guesses.length > PIN_AFTER
        ? state.guesses.find(g => g.word === state.last)
        : null;
    modal.querySelector('#kontekst-last').innerHTML = pinned
        ? `<div class="kontekst-pin-label">последняя догадка</div>${rowHtml(state, pinned, true, fresh)}`
        : '';
    modal.querySelector('#kontekst-list').innerHTML =
        sorted.map(g => rowHtml(state, g, g.word === state.last, fresh)).join('');

    const n = state.guesses.length;
    modal.querySelector('#kontekst-count').textContent = n ? `Попыток: ${n}` : '';

    const over = !!state.done;
    modal.querySelector('#kontekst-form').classList.toggle('hidden', over);
    modal.querySelector('#kontekst-hint').classList.toggle('hidden', over);
    modal.querySelector('#kontekst-giveup').classList.toggle('hidden', over);

    if (state.done === 'win') {
        message(state, `Слово найдено за ${n} ${plural(n, 'попытку', 'попытки', 'попыток')}`, 'win');
    } else if (state.done === 'giveup') {
        message(state, `Загадано было «${state.answer}». Ближайшие: ${state.closest.slice(1, 9).map(c => c.word).join(', ')}`, 'lose');
    }
}

function rowHtml(state, guess, isLast = false, fresh = null) {
    if (!guess) return '';
    const pct = Math.round(rankProgress(guess.rank, state.vocab) * 100);
    const heat = rankHeat(guess.rank);
    const isNew = fresh && guess.word === fresh;
    // Ширину полоски отдаём переменной, а не свойством: из неё же CSS
    // анимирует рост от нуля у только что названного слова.
    return `
        <div class="kontekst-row is-${heat}${isLast ? ' is-last' : ''}${guess.hint ? ' is-hint' : ''}${isNew ? ' is-new' : ''}">
            <span class="kontekst-word">${esc(guess.word)}${guess.hint ? ' <span class="kontekst-tag">подсказка</span>' : ''}</span>
            <span class="kontekst-bar"><span style="--w:${pct}%"></span></span>
            <span class="kontekst-rank">${guess.rank}</span>
        </div>`;
}

function plural(n, one, few, many) {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
}

function message(state, text, kind = '') {
    const el = state.modal.querySelector('#kontekst-msg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'kontekst-msg' + (kind ? ' is-' + kind : '') + (text ? '' : ' hidden');
}

function focusInput(state) {
    const input = state.modal.querySelector('#kontekst-input');
    // На телефоне фокус поднимает клавиатуру поверх половины экрана — там
    // пусть человек ткнёт в поле сам.
    if (input && !matchMedia('(hover: none) and (pointer: coarse)').matches) input.focus();
}

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
