// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Бильярд» (восьмёрка) — окно игры, лобби и таблица очков.
//
// Открывается ТОЛЬКО из меню игр (games.js), а оно — из поиска на главной:
// набрать «игры» и нажать Enter. Пока это слово набирают, поиск молчит.
//
// Правила и физика целиком в shared/pool.js — здесь ни строчки про то, куда
// покатится шар. Этот файл рисует стол, слушает мышь и разговаривает с сервером.
//
// ТРИ ЭКРАНА В ОДНОМ ОКНЕ: лобби (с кем играть), стол и итог партии. Отдельными
// окнами их делать нельзя — окна пасхалок снимают с <body> класс modal-open,
// когда закрываются, и два окна поверх друг друга подрались бы за него.
//
// ПАРТИЯ С БОТОМ ЖИВЁТ ТОЛЬКО ЗДЕСЬ: сервер о ней не знает и в таблицу очков она
// не идёт. Иначе первое место занял бы не тот, кто обыгрывает людей, а тот, кто
// настрелял побед по лёгкому сопернику.
//
// ПАРТИЯ С ЧЕЛОВЕКОМ живёт на сервере, но СЧИТАЕТСЯ здесь — у обоих. По сети
// уезжает удар из четырёх чисел, и каждая сторона проигрывает его сама: физика
// детерминированная, картинка получается одна и та же. Поэтому же чужой удар
// видно целиком, а не «шары вдруг оказались в других местах», — а посмотреть на
// удар соперника в бильярде и есть половина удовольствия.
//
// ЕСЛИ КАРТИНКИ ВСЁ-ТАКИ РАЗОШЛИСЬ (правка физики на сервере раньше, чем на
// сайте, — единственный реальный способ), окно это ЗАМЕЧАЕТ: после каждого удара
// сверяется отпечаток позиции (stateHash), и при расхождении окно молча берёт
// позицию с сервера. Молча играть дальше нельзя — двое видели бы разные столы.
//
// ГРАФИКА ВЕКТОРНАЯ И ВСЯ В КАНВЕ: сукно, борта, лузы, шары. Текстуры сюда лягут
// позже — рисование собрано в одном месте (см. «Отрисовка»), а правила его не
// касаются вовсе.
// ─────────────────────────────────────────────────────────────────────────────

import {
    createGame, deserialize, shoot, stepFrame, cloneGame,
    canPlaceCue, legalTargets, remaining, ballById, aimCast, stateHash,
    TABLE_W, TABLE_H, BALL_R, POCKET_R, POCKETS, HEAD_X,
    CUE, DIR_SCALE, POS_SCALE, POWER_MIN, POWER_MAX,
    FOUL_TEXT, END_TEXT, GROUP_TEXT,
} from '../../shared/pool.js';
import { pickShot, LEVELS, NORMAL } from '../../shared/poolBot.js';

const MODAL_ID = 'pool-modal';

// Поля вокруг сукна — борта. В единицах стола (дюймах), как и всё остальное.
const RAIL = 5.2;

// Насколько далеко от битка нужно оттянуть указатель для полной силы. В долях
// длины стола, чтобы жест не зависел от размера окна.
const PULL_FULL = 0.34;
// Короче этого оттяжка считается отменой удара: случайный клик по сукну не
// должен бить.
const PULL_DEAD = 0.02;

// Как часто спрашиваем сервер. Полторы секунды в игре по очереди не заметны
// вовсе, а лобби можно опрашивать втрое реже — там меняется только список.
const POLL_GAME_MS = 1500;
const POLL_LOBBY_MS = 4500;

// Пауза перед ударом бота: без неё он бьёт в тот же кадр, и партия выглядит как
// «я ударил, и сразу мой ход опять».
const BOT_THINK_MS = 700;

// Цвета шаров — канон американки: у полосатых те же цвета, что у сплошных
// на восемь меньше. Это единственное место, где вообще есть внешний вид шара.
const BALL_COLORS = {
    1: '#f0c000', 2: '#1a52c0', 3: '#d42a1c', 4: '#6a2c9c',
    5: '#ee7a18', 6: '#1c8a3c', 7: '#8a2020', 8: '#17171b',
};
const colorOf = id => BALL_COLORS[id > 8 ? id - 8 : id] || '#ffffff';

let openState = null;   // одно окно за раз

/** Открыть игру. ctx: { apiFetch, user }. */
export function openPool(ctx) {
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
        screen: 'lobby',
        // Партия
        game: null,
        mode: 'bot',          // bot | pvp
        seat: 0,              // за кого играем в этой партии
        botLevel: NORMAL,
        // Сервер
        gameId: null,
        seq: 0,
        players: [null, null],
        // Ввод
        aim: null,            // { x, y } — куда смотрит указатель, в единицах стола
        pull: 0,              // оттяжка кия, 0..1
        dragging: false,
        place: null,          // куда ставим биток, пока он в руке
        // Показ
        raf: 0,
        animating: false,
        botTimer: 0,
        pollTimer: 0,
        lobby: null,
        note: '',
        busy: false,
        // Позиция сервера, с которой надо сверить свою, когда шары встанут.
        expect: null,
    };
    openState = state;

    const close = () => {
        stopAll(state);
        document.removeEventListener('keydown', onKeyDown, true);
        modal.remove();
        document.body.classList.remove('modal-open');
        openState = null;
    };
    const onKeyDown = e => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        // Из-за стола Escape возвращает в лобби, а не закрывает окно: партия с
        // человеком продолжает жить на сервере, и «выйти» из неё — не то же
        // самое, что закрыть игру.
        if (state.screen === 'table' && !state.animating) showLobby(state);
        else close();
    };
    document.addEventListener('keydown', onKeyDown, true);

    modal.querySelector('.modal-backdrop').onclick = close;
    modal.querySelector('#pool-close').onclick = close;

    bindLobby(state);
    bindTable(state);
    showLobby(state);
    return modal;
}

function shellHtml() {
    const levels = LEVELS.map(l =>
        `<button type="button" class="btn btn-sec pool-level" data-level="${l.id}">${l.name}</button>`).join('');

    return `
        <div class="modal-backdrop"></div>
        <div class="modal-win pool-win">
            <div class="modal-head">
                <span>Бильярд</span>
                <button class="btn btn-sec" id="pool-close" title="Закрыть">✕</button>
            </div>

            <div class="pool-body">
                <!-- ── Лобби ── -->
                <div class="pool-lobby" id="pool-lobby">
                    <div class="pool-lobby-cols">
                        <section class="pool-card">
                            <h4>С ботом</h4>
                            <p class="pool-hint">Партия целиком в браузере — в таблицу очков не идёт.</p>
                            <div class="pool-levels">${levels}</div>
                        </section>

                        <section class="pool-card">
                            <h4>С человеком</h4>
                            <p class="pool-hint">Разбой разыгрывает жребий. Ходите по очереди — можно доиграть и позже.</p>
                            <button type="button" class="btn btn-pri" id="pool-challenge">Бросить вызов</button>
                            <div class="pool-list" id="pool-open"></div>
                        </section>
                    </div>

                    <section class="pool-card pool-mine-card hidden" id="pool-mine-card">
                        <h4>Ваши партии</h4>
                        <div class="pool-list" id="pool-mine"></div>
                    </section>

                    <div class="pool-top" id="pool-top"></div>
                </div>

                <!-- ── Стол ── -->
                <div class="pool-table-screen hidden" id="pool-table-screen">
                    <div class="pool-hud" id="pool-hud"></div>
                    <div class="pool-canvas-wrap">
                        <canvas id="pool-canvas"></canvas>
                        <div class="pool-over hidden" id="pool-over">
                            <div class="pool-over-card">
                                <div class="pool-over-title" id="pool-over-title"></div>
                                <div class="pool-over-sub" id="pool-over-sub"></div>
                                <button type="button" class="btn btn-pri" id="pool-over-back">В лобби</button>
                            </div>
                        </div>
                    </div>
                    <div class="pool-bar">
                        <div class="pool-note" id="pool-note"></div>
                        <button type="button" class="btn btn-sec" id="pool-resign">Сдаться</button>
                        <button type="button" class="btn btn-sec" id="pool-back">В лобби</button>
                    </div>
                </div>
            </div>
        </div>`;
}

// ── Лобби ────────────────────────────────────────────────────────────────────

function bindLobby(state) {
    const modal = state.modal;
    modal.querySelectorAll('.pool-level').forEach(btn => {
        btn.onclick = () => startBotGame(state, btn.dataset.level);
    });
    modal.querySelector('#pool-challenge').onclick = () => challenge(state);
    modal.querySelector('#pool-over-back').onclick = () => showLobby(state);
    modal.querySelector('#pool-back').onclick = () => showLobby(state);
    modal.querySelector('#pool-resign').onclick = () => resignNow(state);
}

function showLobby(state) {
    stopAll(state);
    state.screen = 'lobby';
    state.modal.querySelector('#pool-lobby').classList.remove('hidden');
    state.modal.querySelector('#pool-table-screen').classList.add('hidden');
    state.modal.querySelector('#pool-over').classList.add('hidden');
    loadLobby(state);
    state.pollTimer = setInterval(() => loadLobby(state), POLL_LOBBY_MS);
}

async function loadLobby(state) {
    try {
        const res = await state.ctx.apiFetch('/api/pool/lobby');
        if (openState !== state || state.screen !== 'lobby') return;
        state.lobby = res;
        renderLobby(state);
    } catch {
        // Без сервера играть с ботом всё ещё можно — так и говорим, одной
        // строкой, вместо того чтобы прятать половину окна.
        if (openState !== state) return;
        state.lobby = { offline: true };
        renderLobby(state);
    }
}

function renderLobby(state) {
    const data = state.lobby || {};
    const meId = state.ctx.user?.id;
    const openBox = state.modal.querySelector('#pool-open');
    const mineBox = state.modal.querySelector('#pool-mine');
    const mineCard = state.modal.querySelector('#pool-mine-card');
    const challengeBtn = state.modal.querySelector('#pool-challenge');

    if (data.offline) {
        openBox.innerHTML = '<div class="pool-empty">Сервер не ответил — с ботом сыграть можно, с человеком пока нет.</div>';
        mineCard.classList.add('hidden');
        state.modal.querySelector('#pool-top').innerHTML = '';
        return;
    }

    const open = data.open || [];
    const mineOpen = open.find(g => g.players[0].id === meId);
    // Свой вызов — это не «партия, в которую можно войти», а «жду соперника»:
    // кнопка на нём одна и другая.
    challengeBtn.textContent = mineOpen ? 'Отменить вызов' : 'Бросить вызов';
    challengeBtn.onclick = () => (mineOpen ? cancelChallenge(state, mineOpen.id) : challenge(state));

    const others = open.filter(g => g.players[0].id !== meId);
    openBox.innerHTML = mineOpen
        ? '<div class="pool-empty">Ваш вызов висит в лобби — ждём, кто примет.</div>'
        : (others.length
            ? others.map(g => rowHtml(g.players[0], 'Играть', `data-join="${g.id}"`)).join('')
            : '<div class="pool-empty">Открытых вызовов нет. Бросьте свой — его увидят все.</div>');
    openBox.querySelectorAll('[data-join]').forEach(btn => {
        btn.onclick = () => joinChallenge(state, btn.dataset.join);
    });

    const mine = data.mine || [];
    mineCard.classList.toggle('hidden', !mine.length);
    mineBox.innerHTML = mine.map(g => {
        const opp = g.players[g.seat === 0 ? 1 : 0];
        const label = g.my_turn ? 'Ваш ход' : (g.can_claim ? 'Соперник пропал' : 'Ход соперника');
        const cls = g.my_turn ? ' is-turn' : '';
        return rowHtml(opp, 'Открыть', `data-resume="${g.id}"`, `<span class="pool-row-tag${cls}">${label}</span>`);
    }).join('');
    mineBox.querySelectorAll('[data-resume]').forEach(btn => {
        btn.onclick = () => resumeGame(state, btn.dataset.resume);
    });

    renderTop(state, data.top);
}

function rowHtml(player, action, attrs, extra = '') {
    return `
        <div class="pool-row">
            <div class="pool-row-avatar">${player?.avatar
                ? `<img src="${esc(player.avatar)}" alt=""/>`
                : '<span class="top-avatar-default"></span>'}</div>
            <div class="pool-row-name">${esc(player?.name || 'Игрок')}</div>
            ${extra}
            <button type="button" class="btn btn-sec pool-row-btn" ${attrs}>${action}</button>
        </div>`;
}

function renderTop(state, top) {
    const box = state.modal.querySelector('#pool-top');
    if (!box) return;
    const rows = top?.rows || [];
    if (!rows.length) {
        box.innerHTML = '<div class="pool-top-head">Таблица</div>'
            + '<div class="pool-empty">Никто ещё не выигрывал — первое очко будет вашим.</div>';
        return;
    }
    const meId = state.ctx.user?.id;
    const list = rows.map(row => `
        <div class="pool-top-row${row.id === meId ? ' is-me' : ''}${row.rank === 1 ? ' is-first' : ''}">
            <span class="pool-top-rank">${row.rank}</span>
            <div class="pool-row-avatar">${row.avatar
                ? `<img src="${esc(row.avatar)}" alt=""/>`
                : '<span class="top-avatar-default"></span>'}</div>
            <div class="pool-top-name">${rolePrefixHtml(row.role_prefix)}${esc(row.display_name)}</div>
            <span class="pool-top-score">${row.wins}<span class="pool-top-losses"> / ${row.losses}</span></span>
        </div>`).join('');

    const me = top.me;
    const inList = rows.some(r => r.id === meId);
    const mine = me && !inList
        ? `<div class="pool-top-row is-me is-mine-extra">
               <span class="pool-top-rank">${me.rank}</span>
               <div class="pool-top-name">Ваши очки</div>
               <span class="pool-top-score">${me.wins}<span class="pool-top-losses"> / ${me.losses}</span></span>
           </div>`
        : '';

    // Подпись объясняет второе число: «12 / 4» без пояснения читается как счёт
    // партии, а это победы и поражения.
    box.innerHTML = '<div class="pool-top-head">Таблица — победы / поражения</div>'
        + `<div class="pool-top-list">${list}</div>${mine}`;
}

// ── Начало партий ────────────────────────────────────────────────────────────

function startBotGame(state, level) {
    state.mode = 'bot';
    state.botLevel = level;
    state.seat = 0;
    // С ботом разбивает человек: ждать чужого первого удара, только сев за стол,
    // скучно, а преимущество разбоя против бота роли не играет.
    state.game = createGame({ seed: (Math.random() * 0xffffffff) >>> 0, breaker: 0 });
    state.gameId = null;
    state.seq = 0;
    const botName = LEVELS.find(l => l.id === level)?.name || 'Бот';
    state.players = [
        { id: state.ctx.user?.id, name: state.ctx.user?.display_name || 'Вы', avatar: state.ctx.user?.avatar },
        { id: null, name: botName, avatar: null },
    ];
    showTable(state);
    note(state, 'Разбой: поставьте биток в доме и оттяните кий');
}

async function challenge(state) {
    if (state.busy) return;
    state.busy = true;
    try {
        const res = await state.ctx.apiFetch('/api/pool/challenge', { method: 'POST' });
        if (res?.ok) loadLobby(state);
        else if (res?.reason === 'already_waiting') loadLobby(state);
    } catch { /* лобби перечитается само на следующем опросе */ }
    state.busy = false;
}

async function cancelChallenge(state, id) {
    if (state.busy) return;
    state.busy = true;
    try {
        await state.ctx.apiFetch(`/api/pool/challenge/${id}`, { method: 'DELETE' });
        loadLobby(state);
    } catch { /* см. выше */ }
    state.busy = false;
}

async function joinChallenge(state, id) {
    if (state.busy) return;
    state.busy = true;
    try {
        const res = await state.ctx.apiFetch(`/api/pool/challenge/${id}/join`, { method: 'POST' });
        if (res?.ok) await resumeGame(state, id);
        else loadLobby(state);      // вызов увели из-под носа
    } catch { /* остаёмся в лобби */ }
    state.busy = false;
}

/** Сесть за партию, которая живёт на сервере. */
async function resumeGame(state, id) {
    try {
        const res = await state.ctx.apiFetch(`/api/pool/game/${id}`);
        if (openState !== state || !res?.state) return;
        state.mode = 'pvp';
        state.gameId = id;
        state.seat = res.seat;
        state.seq = res.seq;
        state.players = res.players;
        state.game = deserialize(res.state);
        state.place = null;
        showTable(state);
        afterSync(state, res);
    } catch {
        note(state, 'Не удалось открыть партию — попробуйте ещё раз');
    }
}

// ── Экран стола ──────────────────────────────────────────────────────────────

function showTable(state) {
    stopAll(state);
    state.screen = 'table';
    state.modal.querySelector('#pool-lobby').classList.add('hidden');
    state.modal.querySelector('#pool-table-screen').classList.remove('hidden');
    state.modal.querySelector('#pool-over').classList.add('hidden');
    state.modal.querySelector('#pool-resign').classList.toggle('hidden', state.mode !== 'pvp');
    state.aim = null;
    state.pull = 0;
    state.dragging = false;
    state.place = null;
    resize(state);
    render(state);
    if (state.mode === 'pvp') startPolling(state);
    maybeBotTurn(state);
}

function stopAll(state) {
    clearInterval(state.pollTimer);
    clearTimeout(state.botTimer);
    if (state.raf) cancelAnimationFrame(state.raf);
    state.pollTimer = 0;
    state.botTimer = 0;
    state.raf = 0;
    state.animating = false;
}

/** Мой ли сейчас ход (у бота «мой» — это ход человека). */
function myTurn(state) {
    return !!state.game && state.game.phase === 'aim' && state.game.turn === state.seat;
}

// ── Ввод ─────────────────────────────────────────────────────────────────────

function bindTable(state) {
    const canvas = state.modal.querySelector('#pool-canvas');
    canvas.addEventListener('pointermove', e => onPointerMove(state, canvas, e));
    canvas.addEventListener('pointerdown', e => onPointerDown(state, canvas, e));
    canvas.addEventListener('pointerup', e => onPointerUp(state, canvas, e));
    canvas.addEventListener('pointercancel', () => { state.dragging = false; state.pull = 0; render(state); });
    canvas.addEventListener('pointerleave', () => { if (!state.dragging) { state.aim = null; render(state); } });
    window.addEventListener('resize', () => { if (openState === state && state.screen === 'table') { resize(state); render(state); } });
}

/** Точка на сукне из события указателя. */
function pointAt(state, canvas, e) {
    const rect = canvas.getBoundingClientRect();
    const view = state.view;
    if (!view || !rect.width) return null;
    // rect.width — размер на экране, view.scale считался от него же (см. resize).
    return {
        x: (e.clientX - rect.left - view.padX) / view.scale,
        y: (e.clientY - rect.top - view.padY) / view.scale,
    };
}

function onPointerMove(state, canvas, e) {
    if (!myTurn(state) || state.animating) return;
    const p = pointAt(state, canvas, e);
    if (!p) return;

    // Биток в руке и ещё не поставлен — он едет за указателем.
    if (state.game.ballInHand && !state.place) {
        state.aim = p;
        render(state);
        return;
    }

    if (state.dragging) {
        // Оттяжка кия: насколько указатель отъехал назад ОТ ТОЧКИ НАЖАТИЯ вдоль
        // линии прицела. Именно от неё, а не от битка: прицеливаются, наведя
        // курсор на цель, и отсчёт от битка заставлял бы для замаха протаскивать
        // мышь через весь стол за шар. Направление при этом заморожено — иначе
        // замах уводил бы удар в сторону.
        const dx = p.x - state.pullFrom.x;
        const dy = p.y - state.pullFrom.y;
        const back = -(dx * state.dir.x + dy * state.dir.y);
        state.pull = Math.max(0, Math.min(1, back / (TABLE_W * PULL_FULL)));
    } else {
        state.aim = p;
    }
    render(state);
}

function onPointerDown(state, canvas, e) {
    if (!myTurn(state) || state.animating) return;
    if (e.button != null && e.button !== 0) return;
    const p = pointAt(state, canvas, e);
    if (!p) return;

    // Ставим биток: первый клик — постановка, дальше обычное прицеливание.
    if (state.game.ballInHand && !state.place) {
        if (!canPlaceCue(state.game, p.x, p.y)) {
            note(state, state.game.broke ? 'Сюда биток не встанет' : 'До разбоя биток ставят в доме — левая четверть стола');
            return;
        }
        state.place = { x: p.x, y: p.y };
        state.aim = null;
        note(state, '');
        render(state);
        return;
    }

    const dir = aimDir(state, p);
    if (!dir) return;
    state.dir = dir;
    state.dragging = true;
    state.pullFrom = p;
    state.pull = 0;
    canvas.setPointerCapture?.(e.pointerId);
    render(state);
}

function onPointerUp(state, canvas, e) {
    canvas.releasePointerCapture?.(e.pointerId);
    if (!state.dragging) return;
    state.dragging = false;
    const pull = state.pull;
    state.pull = 0;
    // Короткий клик — не удар: по сукну кликают и просто так.
    if (pull < PULL_DEAD) { render(state); return; }
    fire(state, state.dir, pull);
}

/** Направление удара: от битка к указателю. */
function aimDir(state, p) {
    const cue = cuePos(state);
    const dx = p.x - cue.x;
    const dy = p.y - cue.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.5) return null;     // указатель на самом битке — направления нет
    return { x: dx / len, y: dy / len };
}

/** Где сейчас биток: поставленный рукой или тот, что на столе. */
function cuePos(state) {
    if (state.place) return state.place;
    const cue = ballById(state.game, CUE);
    return { x: cue.x, y: cue.y };
}

// ── Удар ─────────────────────────────────────────────────────────────────────

function fire(state, dir, pull) {
    const power = Math.round(POWER_MIN + (POWER_MAX - POWER_MIN) * pull);
    const shot = {
        dx: Math.round(dir.x * DIR_SCALE),
        dy: Math.round(dir.y * DIR_SCALE),
        power,
    };
    if (state.place) {
        shot.cx = Math.round(state.place.x * POS_SCALE);
        shot.cy = Math.round(state.place.y * POS_SCALE);
    }

    const started = shoot(state.game, shot);
    if (!started.ok) {
        note(state, 'Так ударить нельзя');
        return;
    }
    state.place = null;
    state.aim = null;
    note(state, '');

    // Партия с человеком: удар уезжает на сервер СРАЗУ, не дожидаясь, пока шары
    // остановятся. Соперник начнёт смотреть его на пару секунд раньше, а
    // результат у обоих всё равно один — физика детерминированная.
    if (state.mode === 'pvp') sendShot(state, shot);
    animate(state);
}

async function sendShot(state, shot) {
    const id = state.gameId;
    const seq = state.seq;
    try {
        const res = await state.ctx.apiFetch(`/api/pool/game/${id}/shot`, {
            method: 'POST',
            body: { ...shot, seq },
        });
        if (openState !== state || state.gameId !== id) return;
        if (!res?.ok) {
            // Сервер не принял удар: чаще всего это «партию уже закончили»
            // (соперник забрал её по времени) или двойная отправка. Спорить не с
            // чем — берём позицию сервера как есть.
            note(state, 'Сервер не принял удар — беру его позицию');
            refresh(state, true);
            return;
        }
        state.seq = res.seq;
        // Сверка отпечатка ждёт остановки шаров: пока они катятся, наша позиция
        // заведомо не совпадёт с досчитанной сервером. Но ответ может прийти и
        // ПОСЛЕ того, как всё встало (сеть задумалась), — тогда откладывать
        // нечего и нельзя: отложенная сверка досталась бы следующему удару и
        // объявила бы расхождение на ровном месте.
        if (state.animating) state.expect = { hash: res.hash, state: res.state };
        else verify(state, { hash: res.hash, state: res.state });
    } catch {
        // Сеть моргнула: удар у нас сыгран, а на сервере нет. Перечитываем
        // партию — сервер главный, и его позиция победит.
        if (openState === state && state.gameId === id) refresh(state, true);
    }
}

/** Прокрутить удар по кадрам, показывая движение. */
function animate(state) {
    state.animating = true;
    const step = () => {
        state.raf = 0;
        if (openState !== state || state.screen !== 'table') return;
        const res = stepFrame(state.game);
        render(state);
        if (!res.settled) { state.raf = requestAnimationFrame(step); return; }
        state.animating = false;
        afterShot(state, res.outcome);
    };
    state.raf = requestAnimationFrame(step);
}

function afterShot(state, outcome) {
    if (!outcome) return;

    // Шары встали — вот теперь можно сверить позицию с сервером.
    const expect = state.expect;
    state.expect = null;
    if (verify(state, expect)) return;

    if (state.game.phase === 'over') { showOver(state); return; }

    if (outcome.rerack) note(state, 'Восьмёрка на разбое — пирамида собрана заново');
    else if (outcome.foul) note(state, `Фол: ${FOUL_TEXT[outcome.reason] || outcome.reason}. Сопернику шар в руке`);
    else if (outcome.assigned) note(state, `Вам ${GROUP_TEXT[outcome.assigned]}`);
    else if (outcome.potted.length) note(state, 'Есть!');
    else note(state, '');

    render(state);
    maybeBotTurn(state);
}

/**
 * Сверить свою позицию с серверной. Возвращает true, если пришлось выравнивать
 * (значит, вызвавший уже ничего доделывать не должен).
 *
 * Расхождение означает, что мы с соперником видим разные столы, и играть дальше
 * по своей картинке нельзя: правым считается сервер (см. шапку файла).
 */
function verify(state, expect) {
    if (!expect || expect.hash === stateHash(state.game)) return false;
    state.game = deserialize(expect.state);
    state.place = null;
    note(state, 'Позиция разошлась с сервером — выровнял', true);
    if (state.game.phase === 'over') { showOver(state); return true; }
    render(state);
    maybeBotTurn(state);
    return true;
}

function maybeBotTurn(state) {
    if (state.mode !== 'bot' || !state.game) return;
    if (state.game.phase !== 'aim' || state.game.turn === state.seat) return;
    clearTimeout(state.botTimer);
    state.botTimer = setTimeout(() => {
        if (openState !== state || state.screen !== 'table') return;
        const shot = pickShot(state.game, { level: state.botLevel });
        if (!shoot(state.game, shot).ok) {
            // Такого быть не должно (тест «бот всегда придумывает удар, который
            // принимает движок»), но партию из-за этого ронять нельзя.
            note(state, 'Бот развёл руками — ход ваш');
            state.game.turn = state.seat;
            render(state);
            return;
        }
        animate(state);
    }, BOT_THINK_MS);
}

// ── Ход соперника ────────────────────────────────────────────────────────────

function startPolling(state) {
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(() => {
        if (openState !== state || state.screen !== 'table') return;
        // Пока катятся шары или ход наш — спрашивать нечего.
        if (state.animating || myTurn(state)) return;
        if (state.game?.phase === 'over') return;
        refresh(state, false);
    }, POLL_GAME_MS);
}

async function refresh(state, force) {
    const id = state.gameId;
    if (!id) return;
    try {
        const res = await state.ctx.apiFetch(`/api/pool/game/${id}?since=${force ? -1 : state.seq}`);
        if (openState !== state || state.gameId !== id) return;
        afterSync(state, res);
    } catch { /* следующий опрос попробует снова */ }
}

/**
 * Принять то, что рассказал сервер.
 *
 * Ровно ОДИН новый удар мы доигрываем сами — ради того и живём: соперник видит,
 * как разъехались шары. Если ударов случилось больше (вкладка спала, сеть
 * молчала) или отпечаток не сошёлся — берём готовую позицию: показать три удара
 * подряд всё равно некому.
 */
function afterSync(state, res) {
    if (!res) return;
    state.players = res.players || state.players;

    // Ничего нового: сервер отвечает коротко, без позиции (см. GET /game/:id).
    if (!res.state) { renderHud(state); return; }

    // Ровно один новый удар и мы стоим на прицеле — доигрываем его сами, чтобы
    // соперник увидел, КАК разъехались шары. Позицию сервера при этом не
    // выбрасываем: она станет эталоном для сверки, когда шары встанут.
    if (res.seq === state.seq + 1 && res.last_shot && state.game.phase === 'aim' && !state.animating) {
        const before = cloneGame(state.game);
        if (shoot(state.game, res.last_shot).ok) {
            state.seq = res.seq;
            state.place = null;
            state.expect = { hash: res.hash, state: res.state };
            animate(state);
            return;
        }
        // Удар не лёг на нашу позицию — значит, мы уже разошлись с сервером, и
        // показывать нечего: ниже возьмём готовую расстановку.
        state.game = before;
    }

    // Ударов случилось несколько (вкладка спала, сеть молчала) или мы разошлись
    // — берём позицию как есть. Показывать три чужих удара подряд всё равно
    // некому: человек в это время смотрел не сюда.
    state.game = deserialize(res.state);
    state.seq = res.seq;
    state.place = null;
    state.expect = null;
    if (state.game.phase === 'over') { showOver(state); return; }
    render(state);
}

// ── Конец партии ─────────────────────────────────────────────────────────────

function showOver(state) {
    stopAll(state);
    const game = state.game;
    const won = game.winner === state.seat;
    const opp = state.players[state.seat === 0 ? 1 : 0];
    state.modal.querySelector('#pool-over-title').textContent = won ? 'Победа!' : 'Поражение';
    state.modal.querySelector('#pool-over-sub').textContent =
        `${END_TEXT[game.reason] || game.reason}${state.mode === 'bot' ? ` · ${opp?.name || 'бот'}` : ''}`
        + (state.mode === 'bot' ? ' · партии с ботом в таблицу не идут' : '');
    state.modal.querySelector('#pool-over').classList.remove('hidden');
    render(state);
}

async function resignNow(state) {
    if (state.mode !== 'pvp' || !state.gameId) return;
    if (!confirm('Сдаться? Партия уйдёт сопернику, а вам запишется поражение.')) return;
    try {
        const res = await state.ctx.apiFetch(`/api/pool/game/${state.gameId}/resign`, { method: 'POST' });
        if (openState !== state) return;
        if (res?.ok && res.state) { state.game = deserialize(res.state); showOver(state); }
    } catch {
        note(state, 'Сервер не ответил — партия осталась как была');
    }
}

// ── Отрисовка ────────────────────────────────────────────────────────────────
// Всё, что касается внешнего вида, живёт ниже этой черты. Правила выше про
// пиксели не знают ничего, поэтому картинки (сукно, шары) можно будет заменить,
// не трогая ни строчки игры.

function resize(state) {
    const canvas = state.modal.querySelector('#pool-canvas');
    if (!canvas) return;
    const wrap = canvas.parentElement;
    const availW = wrap.clientWidth || 640;
    const full = { w: TABLE_W + RAIL * 2, h: TABLE_H + RAIL * 2 };
    // Стол вписываем по ширине, высота получается сама: пропорция у него жёсткая.
    const scale = availW / full.w;
    const cssW = availW;
    const cssH = full.h * scale;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    state.view = { scale, padX: RAIL * scale, padY: RAIL * scale, dpr, cssW, cssH };
}

function render(state) {
    if (state.screen !== 'table' || !state.game) return;
    const canvas = state.modal.querySelector('#pool-canvas');
    if (!canvas || !state.view) return;
    const g = canvas.getContext('2d');
    const { scale, padX, padY, dpr } = state.view;

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);

    drawTable(g, state, scale, padX, padY);

    g.save();
    g.translate(padX, padY);
    g.scale(scale, scale);
    drawPockets(g);
    drawAim(g, state);
    drawBalls(g, state);
    drawCue(g, state);
    g.restore();

    renderHud(state);
}

function drawTable(g, state, scale, padX, padY) {
    const w = TABLE_W * scale;
    const h = TABLE_H * scale;
    // Борт.
    g.fillStyle = '#5a3a22';
    roundRect(g, 0, 0, w + padX * 2, h + padY * 2, RAIL * scale * 0.6);
    g.fill();
    // Сукно.
    g.fillStyle = '#126b3f';
    g.fillRect(padX, padY, w, h);
    // Лёгкая подсветка от центра: ровная заливка выглядит как лист бумаги.
    const grad = g.createRadialGradient(padX + w / 2, padY + h / 2, h * 0.1, padX + w / 2, padY + h / 2, w * 0.7);
    grad.addColorStop(0, 'rgba(255,255,255,0.09)');
    grad.addColorStop(1, 'rgba(0,0,0,0.16)');
    g.fillStyle = grad;
    g.fillRect(padX, padY, w, h);

    // Линия дома — только пока из-за неё бьют: в остальное время это просто
    // черта поперёк стола, которая ничего не значит.
    if (!state.game.broke) {
        g.strokeStyle = 'rgba(255,255,255,0.22)';
        g.lineWidth = Math.max(1, scale * 0.15);
        g.beginPath();
        g.moveTo(padX + HEAD_X * scale, padY);
        g.lineTo(padX + HEAD_X * scale, padY + h);
        g.stroke();
    }
}

function drawPockets(g) {
    g.fillStyle = '#0b0b0d';
    for (const p of POCKETS) {
        g.beginPath();
        g.arc(p.x, p.y, POCKET_R, 0, Math.PI * 2);
        g.fill();
    }
}

function drawBalls(g, state) {
    for (const b of state.game.balls) {
        if (b.in) continue;
        // Биток в руке рисуем там, где его держит указатель.
        if (b.id === CUE && state.game.ballInHand && myTurn(state)) continue;
        drawBall(g, b.x, b.y, b.id, 1);
    }
    if (state.game.ballInHand && myTurn(state)) {
        const spot = state.place || state.aim;
        if (spot) {
            const ok = canPlaceCue(state.game, spot.x, spot.y);
            drawBall(g, spot.x, spot.y, CUE, ok ? 1 : 0.35);
            if (!ok) {
                g.strokeStyle = '#e05252';
                g.lineWidth = 0.35;
                g.beginPath();
                g.arc(spot.x, spot.y, BALL_R * 1.35, 0, Math.PI * 2);
                g.stroke();
            }
        }
    }
}

function drawBall(g, x, y, id, alpha) {
    g.save();
    g.globalAlpha = alpha;

    // Тень — иначе шары выглядят наклейками на сукне.
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.beginPath();
    g.arc(x + BALL_R * 0.18, y + BALL_R * 0.22, BALL_R, 0, Math.PI * 2);
    g.fill();

    g.beginPath();
    g.arc(x, y, BALL_R, 0, Math.PI * 2);
    g.clip();

    if (id === CUE) {
        g.fillStyle = '#f4f1e8';
        g.fillRect(x - BALL_R, y - BALL_R, BALL_R * 2, BALL_R * 2);
    } else if (id > 8) {
        // Полосатый: белый шар с цветным поясом.
        g.fillStyle = '#f4f1e8';
        g.fillRect(x - BALL_R, y - BALL_R, BALL_R * 2, BALL_R * 2);
        g.fillStyle = colorOf(id);
        g.fillRect(x - BALL_R, y - BALL_R * 0.56, BALL_R * 2, BALL_R * 1.12);
    } else {
        g.fillStyle = colorOf(id);
        g.fillRect(x - BALL_R, y - BALL_R, BALL_R * 2, BALL_R * 2);
    }

    // Блик.
    const shine = g.createRadialGradient(x - BALL_R * 0.35, y - BALL_R * 0.4, 0, x, y, BALL_R * 1.2);
    shine.addColorStop(0, 'rgba(255,255,255,0.55)');
    shine.addColorStop(0.45, 'rgba(255,255,255,0.05)');
    shine.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = shine;
    g.fillRect(x - BALL_R, y - BALL_R, BALL_R * 2, BALL_R * 2);
    g.restore();

    // Номер в белом кружке — как на настоящем шаре. Биток без номера.
    if (id !== CUE) {
        g.save();
        g.fillStyle = '#f6f4ee';
        g.beginPath();
        g.arc(x, y, BALL_R * 0.52, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#1a1a1e';
        g.font = `bold ${BALL_R * 0.8}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(id), x, y + BALL_R * 0.04);
        g.restore();
    }
}

/**
 * Линия прицела: куда пойдёт биток, где он коснётся шара и куда после этого
 * поедет сам шар.
 *
 * Без неё в бильярд на экране играть невозможно — на настоящем столе человек
 * наклоняется и смотрит вдоль кия, а здесь взгляд сверху и такой возможности нет.
 */
function drawAim(g, state) {
    if (!myTurn(state) || state.animating) return;
    if (state.game.ballInHand && !state.place) return;
    const dir = state.dragging ? state.dir : (state.aim && aimDir(state, state.aim));
    if (!dir) return;

    const cue = cuePos(state);
    const hit = aimCast(state.game, cue.x, cue.y, dir.x, dir.y);
    if (!hit) return;

    g.save();
    g.setLineDash([1.6, 1.2]);
    g.lineWidth = 0.28;
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.beginPath();
    g.moveTo(cue.x, cue.y);
    g.lineTo(hit.x, hit.y);
    g.stroke();

    if (hit.id != null) {
        const ball = ballById(state.game, hit.id);
        // Шар-призрак: где встанет биток в момент касания.
        g.setLineDash([]);
        g.lineWidth = 0.2;
        g.strokeStyle = 'rgba(255,255,255,0.55)';
        g.beginPath();
        g.arc(hit.x, hit.y, BALL_R, 0, Math.PI * 2);
        g.stroke();

        // Куда поедет прицельный шар — по линии центров.
        let ox = ball.x - hit.x;
        let oy = ball.y - hit.y;
        const len = Math.sqrt(ox * ox + oy * oy) || 1;
        ox /= len;
        oy /= len;
        // Свой шар подсвечиваем зелёным, чужой и восьмёрку — красным: это самая
        // частая ошибка новичка, и одна цветная линия объясняет её без слов.
        const targets = legalTargets(state.game, state.seat);
        g.strokeStyle = targets.includes(hit.id) ? 'rgba(150,255,170,0.85)' : 'rgba(255,140,120,0.85)';
        g.lineWidth = 0.3;
        g.beginPath();
        g.moveTo(ball.x, ball.y);
        g.lineTo(ball.x + ox * 12, ball.y + oy * 12);
        g.stroke();
    }
    g.restore();
}

/** Кий: рисуется только пока целятся, и отъезжает назад по мере оттяжки. */
function drawCue(g, state) {
    if (!myTurn(state) || state.animating) return;
    if (state.game.ballInHand && !state.place) return;
    const dir = state.dragging ? state.dir : (state.aim && aimDir(state, state.aim));
    if (!dir) return;

    const cue = cuePos(state);
    const back = BALL_R * 1.4 + state.pull * TABLE_W * 0.16;
    const x0 = cue.x - dir.x * back;
    const y0 = cue.y - dir.y * back;
    const x1 = x0 - dir.x * 46;
    const y1 = y0 - dir.y * 46;

    g.save();
    g.lineCap = 'round';
    g.strokeStyle = '#c8a06a';
    g.lineWidth = 0.85;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    // Наклейка на конце — заодно видно, куда кий смотрит.
    g.strokeStyle = '#3f6ea8';
    g.lineWidth = 0.85;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x0 - dir.x * 1.6, y0 - dir.y * 1.6);
    g.stroke();

    // Полоска силы вдоль кия — точнее, чем догадываться по длине замаха.
    if (state.pull > 0) {
        g.strokeStyle = state.pull > 0.8 ? '#e0603c' : '#e8c15a';
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(x0 - dir.x * 3, y0 - dir.y * 3);
        g.lineTo(x0 - dir.x * (3 + 30 * state.pull), y0 - dir.y * (3 + 30 * state.pull));
        g.stroke();
    }
    g.restore();
}

function renderHud(state) {
    const box = state.modal.querySelector('#pool-hud');
    if (!box || !state.game) return;
    const game = state.game;

    const card = seat => {
        const p = state.players[seat] || {};
        const group = game.groups[seat];
        const left = group ? remaining(game, group) : null;
        const turn = game.phase !== 'over' && game.turn === seat;
        const label = group
            ? `${GROUP_TEXT[group]}${left != null ? ` · осталось ${left}` : ''}`
            : 'стол открыт';
        return `
            <div class="pool-player${turn ? ' is-turn' : ''}${seat === state.seat ? ' is-me' : ''}">
                <div class="pool-row-avatar">${p.avatar
                    ? `<img src="${esc(p.avatar)}" alt=""/>`
                    : '<span class="top-avatar-default"></span>'}</div>
                <div class="pool-player-text">
                    <div class="pool-player-name">${esc(p.name || (seat === state.seat ? 'Вы' : 'Соперник'))}</div>
                    <div class="pool-player-group">${label}</div>
                </div>
            </div>`;
    };

    box.innerHTML = card(0) + '<div class="pool-vs">—</div>' + card(1);
}

let noteTimer = 0;
function note(state, text, sticky = false) {
    const box = state.modal.querySelector('#pool-note');
    if (!box) return;
    state.note = text;
    box.textContent = text;
    box.classList.toggle('is-show', !!text);
    clearTimeout(noteTimer);
    if (text && !sticky) noteTimer = setTimeout(() => { if (openState === state) note(state, ''); }, 3200);
}

function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
}

function rolePrefixHtml(rolePrefix) {
    if (!rolePrefix) return '';
    return `<span class="role-prefix role-prefix-${esc(rolePrefix.color)}" title="${esc(rolePrefix.tooltip || '')}">${esc(rolePrefix.label)}</span> `;
}

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
