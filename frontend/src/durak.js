// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Дурак» — окно игры, лобби с комнатами и таблица очков.
//
// Открывается ТОЛЬКО из меню игр (games.js), а оно — из поиска на главной:
// набрать «игры» и нажать Enter. Пока это слово набирают, поиск молчит.
//
// Правила целиком в shared/durak.js — здесь ни строчки про то, что чем бьётся.
// Этот файл рисует стол, слушает клики и разговаривает с сервером.
//
// ОДНА КАРТИНКА НА ДВА ЭКРАНА: и партия с ботом, и партия с людьми рисуются из
// ВИДА (view) — того самого объекта, который сервер отдаёт игроку: своя рука,
// размеры чужих рук, стол, отбой, козырь. С ботом вид считается тут же
// (viewFor), с людьми приезжает по сети. Поэтому отрисовка не знает, с кем
// играют, и не может случайно показать то, чего игрок видеть не должен.
//
// ПАРТИЯ С БОТОМ ЖИВЁТ ТОЛЬКО ЗДЕСЬ: сервер о ней не знает и в таблицу очков она
// не идёт. Иначе первое место занял бы не тот, кто обыгрывает людей, а тот, кто
// настрелял побед по Новичку.
//
// ПАРТИЯ С ЛЮДЬМИ ЖИВЁТ НА СЕРВЕРЕ ЦЕЛИКОМ, и это отличие от бильярда, где
// браузеры считают партию сами, а сервер сверяет отпечаток. В карты играют
// закрытыми: браузер, знающий чужую руку, знает лишнее, — поэтому ход уезжает на
// сервер и оттуда возвращается новый вид. Считать нам нечего, и сверять тоже.
//
// КАРТЫ — ТА ЖЕ КОЛОДА, ЧТО В ПАСЬЯНСЕ (assets/cards-8bit.png, сетка 13×4):
// строка и столбец берутся функциями из правил, отдельной таблицы соответствия
// нет нигде. Своих классов у карт всё-таки два комплекта (.dur-card против
// .sol-card): у пасьянса карта лежит в стопке со сдвигом и тянется мышью, здесь
// — стоит в веере и нажимается, и общий класс пришлось бы всё время
// переопределять в обе стороны.
//
// ПОЧЕМУ ПЕРЕВОД — ЭТО КНОПКА-ПЕРЕКЛЮЧАТЕЛЬ, а не «клик по карте». Козырная
// семёрка против семёрки и бьёт, и переводит, и по одному клику не понять, чего
// человек хотел. Карту, которой можно ТОЛЬКО перевести, клик переводит сразу —
// выбора там нет.
// ─────────────────────────────────────────────────────────────────────────────

import {
    createGame, applyMove, toMove, viewFor,
    attackCards, defendCards, transferCards, canTake, canPass, defenceTarget,
    cardLabel, spriteCol, spriteRow,
    SUITS, MODES, MIN_SEATS, MAX_SEATS, PODKIDNOY, END_TEXT,
} from '../../shared/durak.js';
import { pickMove, LEVELS, NORMAL } from '../../shared/durakBot.js';
import deckSheet from './assets/cards-8bit.png';
import cardBack from './assets/card-back.png';
import { namePrefixHtml } from './namePrefix.js';

const MODAL_ID = 'durak-modal';

// Как часто спрашиваем сервер. Полторы секунды в игре по очереди не заметны
// вовсе, а лобби можно опрашивать втрое реже — там меняется только список.
const POLL_GAME_MS = 1500;
const POLL_LOBBY_MS = 4500;

// Пауза перед ходом бота: без неё он ходит в тот же кадр, и партия выглядит как
// «я положил карту, и сразу мой ход опять». Подкидывание — отдельным, более
// коротким шагом: это продолжение одного его действия, а не новое решение.
const BOT_THINK_MS = 700;
const BOT_THROW_MS = 420;

// Масти для подписи козыря — те же цвета, что у карт в колоде.
const SUIT_SIGN = { hearts: '♥', clubs: '♣', diamonds: '♦', spades: '♠' };

let openState = null;   // одно окно за раз

/** Открыть игру. ctx: { apiFetch, user }. */
export function openDurak(ctx) {
    if (openState) return openState.modal;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'modal';
    modal.innerHTML = shellHtml();
    // Пути к картинкам знает сборщик (он их хэширует), а нужны они в CSS —
    // поэтому кладём их переменными на само окно, как в пасьянсе.
    const win = modal.querySelector('.dur-win');
    win.style.setProperty('--dur-sheet', `url(${deckSheet})`);
    win.style.setProperty('--dur-back', `url(${cardBack})`);
    document.body.appendChild(modal);
    document.body.classList.add('modal-open');

    const state = {
        ctx,
        modal,
        screen: 'lobby',
        mode: 'bot',            // bot | pvp
        // Партия с ботом — только здесь; с людьми её тут нет вовсе.
        game: null,
        botLevel: NORMAL,
        seat: 0,
        // Что рисуем. Одинаково в обоих режимах (см. шапку).
        view: null,
        meta: null,             // всё, что сервер рассказал помимо вида
        players: [],
        // Сервер
        gameId: null,
        roomId: null,           // комната, в которой ждём начала
        seq: 0,
        // Настройки в лобби
        botSeats: 2,
        botMode: PODKIDNOY,
        roomSeats: 2,
        roomMode: PODKIDNOY,
        // Ввод и показ
        transferMode: false,
        showDiscard: false,
        flash: '',              // короткое сообщение об отказе, поверх подсказки
        flashTimer: 0,
        // Показ хода. hiding — карты, которые ещё летят и потому спрятаны на
        // своих местах; dealt — сколько карт уже долетело до каждого соседа
        // (веер растёт по мере раздачи); anim — идёт показ, ходить нельзя.
        hiding: null,
        dealt: null,
        anim: false,
        shoutTimer: 0,
        busy: false,
        lobby: null,
        pollTimer: 0,
        botTimer: 0,
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
        // людьми продолжает жить на сервере, и «выйти» из неё — не то же самое,
        // что закрыть игру.
        if (state.screen === 'table') showLobby(state);
        else close();
    };
    document.addEventListener('keydown', onKeyDown, true);

    modal.querySelector('.modal-backdrop').onclick = close;
    modal.querySelector('#dur-close').onclick = close;

    bindLobby(state);
    bindTable(state);
    showLobby(state);
    return modal;
}

function shellHtml() {
    const levels = LEVELS.map(l =>
        `<button type="button" class="btn btn-sec dur-level" data-level="${l.id}">${l.name}</button>`).join('');
    const seatsBtns = group => {
        let html = '';
        for (let n = MIN_SEATS; n <= MAX_SEATS; n++) {
            html += `<button type="button" class="dur-pick" data-${group}-seats="${n}">${n}</button>`;
        }
        return html;
    };
    const modeBtns = group => MODES.map(m =>
        `<button type="button" class="dur-pick" data-${group}-mode="${m.id}">${m.name}</button>`).join('');

    return `
        <div class="modal-backdrop"></div>
        <div class="modal-win dur-win">
            <div class="modal-head">
                <span>Дурак</span>
                <button class="btn btn-sec" id="dur-close" title="Закрыть">✕</button>
            </div>

            <div class="dur-body">
                <!-- ── Лобби ── -->
                <div class="dur-lobby" id="dur-lobby">
                    <div class="dur-lobby-cols">
                        <section class="dur-card-box">
                            <h4>С ботом</h4>
                            <p class="dur-hint">Партия целиком в браузере — в таблицу очков не идёт.</p>
                            <div class="dur-opt"><span>Игроков</span><div class="dur-picks" id="dur-bot-seats">${seatsBtns('bot')}</div></div>
                            <div class="dur-opt"><span>Правила</span><div class="dur-picks" id="dur-bot-mode">${modeBtns('bot')}</div></div>
                            <div class="dur-levels">${levels}</div>
                        </section>

                        <section class="dur-card-box">
                            <h4>С людьми</h4>
                            <p class="dur-hint">Комната ждёт в лобби. Полный стол начинает партию сам.</p>
                            <div class="dur-opt"><span>Мест</span><div class="dur-picks" id="dur-room-seats">${seatsBtns('room')}</div></div>
                            <div class="dur-opt"><span>Правила</span><div class="dur-picks" id="dur-room-mode">${modeBtns('room')}</div></div>
                            <button type="button" class="btn btn-pri" id="dur-create">Собрать стол</button>
                            <div class="dur-list" id="dur-open"></div>
                        </section>
                    </div>

                    <section class="dur-card-box dur-mine-box hidden" id="dur-mine-box">
                        <h4>Ваши партии</h4>
                        <div class="dur-list" id="dur-mine"></div>
                    </section>

                    <div class="dur-top" id="dur-top"></div>
                </div>

                <!-- ── Стол ── -->
                <div class="dur-table-screen hidden" id="dur-table-screen">
                    <div class="dur-seats" id="dur-seats"></div>
                    <div class="dur-mid">
                        <div class="dur-stock" id="dur-stock"></div>
                        <div class="dur-field" id="dur-field"></div>
                        <div class="dur-out" id="dur-out"></div>
                    </div>
                    <div class="dur-note" id="dur-note"></div>
                    <div class="dur-hand" id="dur-hand"></div>
                    <div class="dur-bar">
                        <button type="button" class="btn btn-pri dur-act" id="dur-take">Беру</button>
                        <button type="button" class="btn btn-pri dur-act" id="dur-pass">Бито</button>
                        <button type="button" class="btn btn-sec dur-act" id="dur-transfer">Перевести</button>
                        <button type="button" class="btn btn-sec dur-act" id="dur-claim">Забрать партию</button>
                        <span class="dur-bar-gap"></span>
                        <button type="button" class="btn btn-sec" id="dur-resign">Сдаться</button>
                        <button type="button" class="btn btn-sec" id="dur-back">В лобби</button>
                    </div>
                    <!-- Слой, по которому летают карты, и крупная надпись
                         («Бито», «Беру»). Оба поверх стола и оба сквозные для
                         кликов: они только показывают, а не мешают играть. -->
                    <div class="dur-fly" id="dur-fly"></div>
                    <div class="dur-shout" id="dur-shout"></div>
                    <div class="dur-over hidden" id="dur-over">
                        <div class="dur-over-card">
                            <div class="dur-over-title" id="dur-over-title"></div>
                            <div class="dur-over-sub" id="dur-over-sub"></div>
                            <button type="button" class="btn btn-pri" id="dur-over-back">В лобби</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
}

// ── Лобби ────────────────────────────────────────────────────────────────────

function bindLobby(state) {
    const modal = state.modal;
    modal.querySelectorAll('.dur-level').forEach(btn => {
        btn.onclick = () => startBotGame(state, btn.dataset.level);
    });
    modal.querySelectorAll('[data-bot-seats]').forEach(btn => {
        btn.onclick = () => { state.botSeats = Number(btn.dataset.botSeats); renderPicks(state); };
    });
    modal.querySelectorAll('[data-bot-mode]').forEach(btn => {
        btn.onclick = () => { state.botMode = btn.dataset.botMode; renderPicks(state); };
    });
    modal.querySelectorAll('[data-room-seats]').forEach(btn => {
        btn.onclick = () => { state.roomSeats = Number(btn.dataset.roomSeats); renderPicks(state); };
    });
    modal.querySelectorAll('[data-room-mode]').forEach(btn => {
        btn.onclick = () => { state.roomMode = btn.dataset.roomMode; renderPicks(state); };
    });
    modal.querySelector('#dur-create').onclick = () => createRoom(state);
    modal.querySelector('#dur-over-back').onclick = () => showLobby(state);
    modal.querySelector('#dur-back').onclick = () => showLobby(state);
    renderPicks(state);
}

/** Подсветить выбранные настройки. */
function renderPicks(state) {
    const mark = (sel, value) => state.modal.querySelectorAll(sel).forEach(btn => {
        btn.classList.toggle('is-on', String(Object.values(btn.dataset)[0]) === String(value));
    });
    mark('[data-bot-seats]', state.botSeats);
    mark('[data-bot-mode]', state.botMode);
    mark('[data-room-seats]', state.roomSeats);
    mark('[data-room-mode]', state.roomMode);
}

function showLobby(state) {
    stopAll(state);
    state.screen = 'lobby';
    state.gameId = null;
    state.game = null;
    state.view = null;
    state.modal.querySelector('#dur-lobby').classList.remove('hidden');
    state.modal.querySelector('#dur-table-screen').classList.add('hidden');
    state.modal.querySelector('#dur-over').classList.add('hidden');
    loadLobby(state);
    state.pollTimer = setInterval(() => loadLobby(state), POLL_LOBBY_MS);
}

async function loadLobby(state) {
    try {
        const res = await state.ctx.apiFetch('/api/durak/lobby');
        if (openState !== state || state.screen !== 'lobby') return;
        state.lobby = res;
        // Комната, в которой мы ждали, начала партию — садимся за стол.
        const started = state.roomId && (res.mine || []).find(g => g.id === state.roomId);
        if (started) { state.roomId = null; resumeGame(state, started.id); return; }
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
    const openBox = state.modal.querySelector('#dur-open');
    const mineBox = state.modal.querySelector('#dur-mine');
    const mineCard = state.modal.querySelector('#dur-mine-box');
    const createBtn = state.modal.querySelector('#dur-create');

    if (data.offline) {
        openBox.innerHTML = '<div class="dur-empty">Сервер не ответил — с ботом сыграть можно, с людьми пока нет.</div>';
        mineCard.classList.add('hidden');
        state.modal.querySelector('#dur-top').innerHTML = '';
        return;
    }

    const open = data.open || [];
    const mineRoom = open.find(g => g.is_host);
    createBtn.textContent = mineRoom ? 'Разойтись' : 'Собрать стол';
    createBtn.onclick = () => (mineRoom ? leaveRoom(state, mineRoom.id) : createRoom(state));
    if (mineRoom) state.roomId = mineRoom.id;

    const rows = open.map(room => {
        const mine = room.is_host;
        const sitting = room.players.length;
        const names = room.players.map(p => esc(p?.name || 'Игрок')).join(', ');
        const label = `${modeName(room.mode)} · ${sitting} из ${room.seats}`;
        // За своим столом ждут, за чужой садятся, а в своём же можно начать
        // раньше, если вдвоём уже интересно.
        const action = mine
            ? (sitting >= MIN_SEATS ? `<button type="button" class="btn btn-sec dur-row-btn" data-start="${room.id}">Начать</button>` : '')
            : (room.players.some(p => p?.id === meId)
                ? `<button type="button" class="btn btn-sec dur-row-btn" data-leave="${room.id}">Выйти</button>`
                : `<button type="button" class="btn btn-sec dur-row-btn" data-join="${room.id}">Сесть</button>`);
        return `
            <div class="dur-row${mine ? ' is-mine' : ''}">
                <div class="dur-row-main">
                    <div class="dur-row-name">${names}</div>
                    <div class="dur-row-sub">${label}</div>
                </div>
                ${action}
            </div>`;
    }).join('');

    openBox.innerHTML = rows || '<div class="dur-empty">Столов нет. Соберите свой — его увидят все.</div>';
    openBox.querySelectorAll('[data-join]').forEach(b => { b.onclick = () => joinRoom(state, b.dataset.join); });
    openBox.querySelectorAll('[data-leave]').forEach(b => { b.onclick = () => leaveRoom(state, b.dataset.leave); });
    openBox.querySelectorAll('[data-start]').forEach(b => { b.onclick = () => startRoom(state, b.dataset.start); });

    const mine = data.mine || [];
    mineCard.classList.toggle('hidden', !mine.length);
    mineBox.innerHTML = mine.map(g => {
        const others = g.players.filter((p, i) => i !== g.seat).map(p => esc(p?.name || 'Игрок')).join(', ');
        const tag = g.my_turn ? 'Ваш ход' : (g.can_claim ? 'Соперник пропал' : 'Ход соперника');
        return `
            <div class="dur-row">
                <div class="dur-row-main">
                    <div class="dur-row-name">${others}</div>
                    <div class="dur-row-sub">${modeName(g.mode)} · <span class="dur-row-tag${g.my_turn ? ' is-turn' : ''}">${tag}</span></div>
                </div>
                <button type="button" class="btn btn-sec dur-row-btn" data-resume="${g.id}">Открыть</button>
            </div>`;
    }).join('');
    mineBox.querySelectorAll('[data-resume]').forEach(b => { b.onclick = () => resumeGame(state, b.dataset.resume); });

    renderTop(state, data.top);
}

const modeName = id => MODES.find(m => m.id === id)?.name || 'Подкидной';

function renderTop(state, top) {
    const box = state.modal.querySelector('#dur-top');
    if (!box) return;
    const rows = top?.rows || [];
    if (!rows.length) {
        box.innerHTML = '<div class="dur-top-head">Таблица</div>'
            + '<div class="dur-empty">Никто ещё не выигрывал — первое очко будет вашим.</div>';
        return;
    }
    const meId = state.ctx.user?.id;
    const list = rows.map(row => `
        <div class="dur-top-row${row.id === meId ? ' is-me' : ''}${row.rank === 1 ? ' is-first' : ''}">
            <span class="dur-top-rank">${row.rank}</span>
            <div class="dur-top-avatar">${row.avatar
                ? `<img src="${esc(row.avatar)}" alt=""/>`
                : '<span class="top-avatar-default"></span>'}</div>
            <div class="dur-top-name">${namePrefixHtml(row)}${esc(row.display_name)}</div>
            <span class="dur-top-score">${row.wins}<span class="dur-top-losses"> / ${row.losses}</span></span>
        </div>`).join('');

    const me = top.me;
    const inList = rows.some(r => r.id === meId);
    const mine = me && !inList
        ? `<div class="dur-top-row is-me is-mine-extra">
               <span class="dur-top-rank">${me.rank}</span>
               <div class="dur-top-name">Ваши очки</div>
               <span class="dur-top-score">${me.wins}<span class="dur-top-losses"> / ${me.losses}</span></span>
           </div>`
        : '';

    // Подпись объясняет второе число: «12 / 4» без пояснения читается как счёт
    // партии, а это победы и поражения.
    box.innerHTML = '<div class="dur-top-head">Таблица — победы / поражения</div>'
        + `<div class="dur-top-list">${list}</div>${mine}`;
}

// ── Комнаты ──────────────────────────────────────────────────────────────────

async function createRoom(state) {
    if (state.busy) return;
    state.busy = true;
    try {
        const res = await state.ctx.apiFetch('/api/durak/room', {
            method: 'POST',
            body: { seats: state.roomSeats, mode: state.roomMode },
        });
        if (res?.ok) state.roomId = res.id;
        loadLobby(state);
    } catch { /* лобби перечитается само на следующем опросе */ }
    state.busy = false;
}

async function joinRoom(state, id) {
    if (state.busy) return;
    state.busy = true;
    try {
        const res = await state.ctx.apiFetch(`/api/durak/room/${id}/join`, { method: 'POST' });
        if (res?.ok && res.started) { state.busy = false; resumeGame(state, id); return; }
        if (res?.ok) state.roomId = id;      // ждём остальных
        loadLobby(state);
    } catch { /* см. выше */ }
    state.busy = false;
}

async function startRoom(state, id) {
    if (state.busy) return;
    state.busy = true;
    try {
        const res = await state.ctx.apiFetch(`/api/durak/room/${id}/start`, { method: 'POST' });
        if (res?.ok) { state.busy = false; state.roomId = null; resumeGame(state, id); return; }
        loadLobby(state);
    } catch { /* см. выше */ }
    state.busy = false;
}

async function leaveRoom(state, id) {
    if (state.busy) return;
    state.busy = true;
    try {
        await state.ctx.apiFetch(`/api/durak/room/${id}`, { method: 'DELETE' });
        if (state.roomId === id) state.roomId = null;
        loadLobby(state);
    } catch { /* см. выше */ }
    state.busy = false;
}

// ── Начало партий ────────────────────────────────────────────────────────────

function startBotGame(state, level) {
    state.mode = 'bot';
    state.botLevel = level;
    state.seat = 0;
    state.gameId = null;
    state.seq = 0;
    state.game = createGame({ seats: state.botSeats, mode: state.botMode });
    const botName = LEVELS.find(l => l.id === level)?.name || 'Бот';
    state.players = [{ id: state.ctx.user?.id, name: state.ctx.user?.display_name || 'Вы', avatar: state.ctx.user?.avatar }];
    for (let i = 1; i < state.botSeats; i++) {
        state.players.push({ id: null, name: state.botSeats > 2 ? `${botName} ${i}` : botName, avatar: null });
    }
    state.meta = null;
    state.view = viewFor(state.game, state.seat);
    beforeDeal(state);
    showTable(state);
    dealIntro(state).then(() => { if (openState === state) scheduleBots(state); });
}

/** Сесть за партию, которая живёт на сервере. */
async function resumeGame(state, id) {
    try {
        const res = await state.ctx.apiFetch(`/api/durak/game/${id}`);
        if (openState !== state || !res?.view) return;
        state.mode = 'pvp';
        state.game = null;
        state.gameId = id;
        state.seat = res.seat;
        state.meta = res;
        state.players = res.players || state.players;
        state.seq = res.seq;
        state.view = res.view;
        // Партия только началась — показываем раздачу. Садясь за начатую,
        // раздавать нечего: карты давно на руках.
        const fresh = res.seq === 0 && res.status === 'live';
        if (fresh) beforeDeal(state);
        showTable(state);
        if (fresh) await dealIntro(state);
        if (openState !== state) return;
        if (res.status === 'done') { showOver(state); return; }
        startPolling(state);
    } catch {
        flash(state, 'Не удалось открыть партию — попробуйте ещё раз');
    }
}

function showTable(state) {
    clearInterval(state.pollTimer);
    state.pollTimer = 0;
    state.screen = 'table';
    state.transferMode = false;
    state.showDiscard = false;
    state.flash = '';
    state.modal.querySelector('#dur-lobby').classList.add('hidden');
    state.modal.querySelector('#dur-table-screen').classList.remove('hidden');
    state.modal.querySelector('#dur-over').classList.add('hidden');
    render(state);
}

function stopAll(state) {
    clearInterval(state.pollTimer);
    clearTimeout(state.botTimer);
    clearTimeout(state.flashTimer);
    clearTimeout(state.shoutTimer);
    state.pollTimer = 0;
    state.botTimer = 0;
    state.anim = false;
    state.hiding = null;
    state.dealt = null;
}

// ── Ходы ─────────────────────────────────────────────────────────────────────

function bindTable(state) {
    const modal = state.modal;
    modal.querySelector('#dur-hand').onclick = e => {
        const node = e.target.closest?.('.dur-card');
        if (node && node.dataset.card != null) onCardClick(state, Number(node.dataset.card), node);
    };
    modal.querySelector('#dur-take').onclick = () => send(state, { type: 'take' });
    modal.querySelector('#dur-pass').onclick = () => send(state, { type: 'pass' });
    modal.querySelector('#dur-transfer').onclick = () => {
        state.transferMode = !state.transferMode;
        render(state);
    };
    modal.querySelector('#dur-resign').onclick = () => resignNow(state);
    modal.querySelector('#dur-claim').onclick = () => claimNow(state);
    modal.querySelector('#dur-out').onclick = e => {
        if (!e.target.closest?.('.dur-out-btn')) return;
        state.showDiscard = !state.showDiscard;
        render(state);
    };
}

/**
 * Клик по своей карте.
 *
 * Роль в дураке в каждый момент одна, поэтому и смысл клика один: атакующий
 * кладёт карту на стол, защитник отбивается. Спорный случай ровно один — карта,
 * которой можно и отбиться, и перевести; его разводит кнопка «Перевести».
 */
function onCardClick(state, card, node) {
    const view = state.view;
    if (!view || view.phase !== 'play' || view.toMove !== view.seat || state.busy || state.anim) return;

    const canBeat = defendCards(view).includes(card);
    const canMove = transferCards(view).includes(card);
    if (state.transferMode && canMove) return send(state, { type: 'transfer', card });
    if (canBeat) return send(state, { type: 'defend', card });
    if (canMove) return send(state, { type: 'transfer', card });
    if (attackCards(view).includes(card)) return send(state, { type: 'attack', card });

    // Отказ показываем самой картой: короткое «нет» понятнее подписи под столом.
    node?.classList.remove('is-nope');
    void node?.offsetWidth;
    node?.classList.add('is-nope');
}

/**
 * Сыграть ход.
 *
 * С ботом партия живёт в браузере, и ход применяется на месте. С людьми —
 * уезжает на сервер, и оттуда возвращается НОВЫЙ ВИД: пересчитать его самим мы
 * не можем, потому что не знаем ни колоды, ни чужих рук.
 */
async function send(state, move) {
    if (state.busy || state.anim) return;
    const view = state.view;
    if (!view || view.toMove !== view.seat) return;
    state.transferMode = false;

    if (state.mode === 'bot') {
        const done = applyMove(state.game, state.seat, move);
        if (!done.ok) return;
        await applyView(state, viewFor(state.game, state.seat));
        if (openState !== state) return;
        if (state.game.phase === 'over') { showOver(state); return; }
        scheduleBots(state);
        return;
    }

    state.busy = true;
    render(state);
    try {
        const res = await state.ctx.apiFetch(`/api/durak/game/${state.gameId}/move`, {
            method: 'POST',
            body: { seq: state.seq, ...move },
        });
        state.busy = false;
        if (openState !== state) return;
        if (res?.ok) { applyServer(state, res); return; }
        // Сервер не принял ход: чаще всего это «партию уже закончили» или
        // двойная отправка. Спорить не с чем — перечитываем стол.
        flash(state, 'Сервер не принял ход — беру его стол');
        refresh(state, true);
    } catch {
        state.busy = false;
        if (openState === state) refresh(state, true);
    }
}

// ── Ход бота ─────────────────────────────────────────────────────────────────

/**
 * Дать походить всем, чей сейчас ход, — по одному ходу за раз с паузой.
 *
 * Пауза не для красоты: бот выкладывает карты по одной (подкинул, подкинул,
 * хватит), и без задержки весь розыгрыш случился бы между двумя кадрами — игрок
 * увидел бы готовый результат и не понял, что произошло.
 */
function scheduleBots(state) {
    if (state.mode !== 'bot' || !state.game) return;
    clearTimeout(state.botTimer);
    if (state.game.phase === 'over') { showOver(state); return; }

    const seat = toMove(state.game);
    if (seat < 0 || seat === state.seat) return;

    // Подкидывание тем же ботом — продолжение одного действия, поэтому короче.
    const again = state.game.table.length > 0;
    state.botTimer = setTimeout(async () => {
        if (openState !== state || state.screen !== 'table') return;
        const view = viewFor(state.game, seat);
        const move = pickMove(view, { level: state.botLevel });
        if (!move || !applyMove(state.game, seat, move).ok) {
            // Такого быть не должно (тест «бот всегда ходит законно»), но
            // вставшую партию человеку показывать нельзя.
            flash(state, 'Бот развёл руками — партия окончена');
            state.game.phase = 'over';
            state.game.loser = -1;
            state.game.reason = 'draw';
            state.view = viewFor(state.game, state.seat);
            showOver(state);
            return;
        }
        await applyView(state, viewFor(state.game, state.seat));
        if (openState !== state || state.screen !== 'table') return;
        if (state.game.phase === 'over') { showOver(state); return; }
        scheduleBots(state);
    }, again ? BOT_THROW_MS : BOT_THINK_MS);
}

// ── Разговор с сервером ──────────────────────────────────────────────────────

function startPolling(state) {
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(() => {
        if (openState !== state || state.screen !== 'table' || state.busy || state.anim) return;
        if (state.view?.phase === 'over') return;
        // Наш ход — сервер нам ничего нового не расскажет.
        if (state.view && state.view.toMove === state.view.seat) return;
        refresh(state, false);
    }, POLL_GAME_MS);
}

async function refresh(state, force) {
    const id = state.gameId;
    if (!id) return;
    try {
        const res = await state.ctx.apiFetch(`/api/durak/game/${id}?since=${force ? -1 : state.seq}`);
        if (openState !== state || state.gameId !== id) return;
        applyServer(state, res);
    } catch { /* следующий опрос попробует снова */ }
}

/** Принять то, что рассказал сервер. */
async function applyServer(state, res) {
    if (!res) return;
    state.meta = res;
    state.players = res.players || state.players;
    state.seq = res.seq;
    if (res.seat != null && res.seat >= 0) state.seat = res.seat;
    // Ответ без вида — это «ничего не изменилось» (см. GET /game/:id): показывать
    // нечего, но кнопки и подсказка могли поменяться (например, партию стало
    // можно забрать).
    if (!res.view) { render(state); return; }
    await applyView(state, res.view);
    if (openState !== state) return;
    if (res.status === 'done' || state.view?.phase === 'over') showOver(state);
}

async function resignNow(state) {
    // С ботом кнопки нет вовсе: сдаваться некому, а из партии выходят «в лобби».
    if (state.mode !== 'pvp' || !state.gameId) return;
    if (!confirm('Сдаться? Дураком запишут вас.')) return;
    try {
        const res = await state.ctx.apiFetch(`/api/durak/game/${state.gameId}/resign`, { method: 'POST' });
        if (openState !== state) return;
        if (res?.ok) applyServer(state, res);
    } catch {
        flash(state, 'Сервер не ответил — партия осталась как была');
    }
}

async function claimNow(state) {
    if (state.mode !== 'pvp' || !state.gameId) return;
    try {
        const res = await state.ctx.apiFetch(`/api/durak/game/${state.gameId}/claim`, { method: 'POST' });
        if (openState !== state) return;
        if (res?.ok) applyServer(state, res);
        else flash(state, 'Забрать пока нельзя — соперник ещё в игре');
    } catch {
        flash(state, 'Сервер не ответил — попробуйте ещё раз');
    }
}

// ── Показ хода ───────────────────────────────────────────────────────────────
// ПОЧЕМУ ЭТО ВООБЩЕ ЕСТЬ. Без анимации стол просто подменяется: карта исчезает
// из руки и в тот же кадр оказывается на столе, розыгрыш пропадает целиком, а
// после добора у всех молча становится по шесть карт. Что произошло — понять
// нельзя, особенно за столом на четверых, где ходят трое чужих.
//
// Показ считается ИЗ РАЗНИЦЫ ДВУХ ВИДОВ, а не из «что за ход мы сделали». Иначе
// пришлось бы держать два разных показа: в партии с ботом ход известен, а с
// людьми с сервера приезжает ПОЗИЦИЯ, и рассказа о ней там нет. Разница видов
// есть в обоих случаях и означает ровно одно и то же.
//
// Если разницу объяснить не получилось (вкладка спала, и сервер ушёл на
// несколько ходов вперёд), показ пропускается — стол просто перерисовывается.
// Показывать три чужих хода подряд всё равно некому: человек смотрел не сюда.

const PLAY_MS = 260;      // карта из руки на стол
const SWEEP_MS = 320;     // стол в отбой или в руки взявшему
const DEAL_MS = 240;      // карта из колоды в руку
const DEAL_GAP = 45;      // задержка между картами раздачи
const SHOUT_MS = 950;     // сколько висит крупная надпись

/** Показывать ли движение вообще (в системе может стоять «поменьше анимации»). */
const animated = () => !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

/** Карта ещё летит — на своём месте её пока не видно. */
const hidden = (state, card) => (state.hiding?.has(card) ? ' is-hidden' : '');

/**
 * Принять новый вид и показать переход к нему.
 *
 * Всё, что меняет стол, идёт через эту функцию — и ход человека, и ход бота, и
 * ответ сервера. Пока идёт показ, ходить нельзя (state.anim): иначе второй ход
 * лёг бы поверх недосмотренного первого.
 */
async function applyView(state, next) {
    const prev = state.view;
    state.view = next;
    const steps = prev && animated() ? diffViews(prev, next) : null;
    if (!steps || !steps.length) { render(state); return; }

    state.anim = true;
    try {
        await playSteps(state, prev, next, steps);
    } catch {
        // Окно закрыли посреди показа или браузер прервал анимацию — не беда,
        // ниже всё равно рисуется итоговая позиция.
    } finally {
        state.anim = false;
        state.hiding = null;
        state.dealt = null;
        if (openState === state) render(state);
    }
}

/**
 * Чем один вид отличается от другого — в шагах показа.
 *
 * null означает «объяснить не получилось»: рисуем без показа.
 */
function diffViews(prev, next) {
    if (prev.seat !== next.seat) return null;
    const onTable = table => table.flatMap(p => (p.d == null ? [p.a] : [p.a, p.d]));

    // Кто ходил: у него убыло карт. Ход всегда один, поэтому и место одно.
    const dropped = [];
    for (let seat = 0; seat < prev.seats; seat++) {
        if (next.counts[seat] < prev.counts[seat]) dropped.push(seat);
    }
    const mover = dropped.length === 1 ? dropped[0] : prev.attacker;

    // ── Розыгрыш закрылся: стол уехал в отбой или тому, кто взял
    if (prev.table.length && !next.table.length) {
        const beaten = next.discard.length > prev.discard.length;
        const gone = onTable(prev.table);
        // Карта, которой отбились последней, могла не успеть показаться: движок
        // закрывает розыгрыш тем же ходом, если подкинуть больше некому.
        // Показываем её отдельно — сначала ложится, потом всё уезжает.
        const late = beaten
            ? next.discard.slice(prev.discard.length).filter(card => !gone.includes(card))
            : [];
        const steps = [{
            kind: 'sweep',
            cards: gone,
            late,
            lateFrom: prev.defender,
            to: beaten ? 'discard' : prev.defender,
            text: beaten ? 'Бито' : null,
        }];
        const deal = dealStep(prev, next, beaten ? null : prev.defender, gone.length + late.length);
        if (deal) steps.push(deal);
        return steps;
    }

    // ── Карты легли на стол
    const played = playedCards(prev, next, mover);
    if (played === null) return null;
    if (played.length) {
        const steps = played.map(item => ({ kind: 'play', ...item }));
        // Перевод видно по тому, что атакующим стал бывший защитник.
        if (next.attacker !== prev.attacker && next.attacker === prev.defender) {
            steps.push({ kind: 'shout', text: 'Перевод' });
        }
        return steps;
    }

    // ── «Беру»: карты не двигались, но сказать об этом надо. Кто именно берёт,
    //    подставляется при показе — имена живут в окне, а не в виде.
    if (!prev.taking && next.taking) return [{ kind: 'shout', who: next.defender }];
    return [];
}

/** Какие карты легли на стол и в какие места. null — стол переставили не так. */
function playedCards(prev, next, mover) {
    if (next.table.length < prev.table.length) return null;
    const out = [];
    for (let i = 0; i < next.table.length; i++) {
        const was = prev.table[i];
        const now = next.table[i];
        if (!was) {
            out.push({ card: now.a, seat: mover, i, role: 'a' });
            if (now.d != null) out.push({ card: now.d, seat: prev.defender, i, role: 'd' });
            continue;
        }
        if (was.a !== now.a) return null;
        if (was.d == null && now.d != null) out.push({ card: now.d, seat: prev.defender, i, role: 'd' });
    }
    return out;
}

/**
 * Добор: сколько карт кому пришло из колоды.
 *
 * Считается вычитанием по размерам рук, а взявшему ещё и за вычетом стола —
 * его прибавка это стол ПЛЮС добор. Если сходится не всё (вкладка спала и ходов
 * прошло несколько), раздачу не показываем вовсе: лучше никак, чем неправду.
 */
function dealStep(prev, next, taker, takenCount) {
    const drew = prev.deckLeft - next.deckLeft;
    if (drew <= 0) return null;

    const drawn = [];
    for (let seat = 0; seat < prev.seats; seat++) {
        let n = next.counts[seat] - prev.counts[seat];
        if (seat === taker) n -= takenCount;
        if (n < 0) return null;
        drawn.push(n);
    }
    if (drawn.reduce((a, b) => a + b, 0) !== drew) return null;

    // Свои карты знаем поимённо — их и прячем до прилёта. Взятое со стола сюда
    // не относится: оно приехало не из колоды.
    const fromTable = new Set(prev.table.flatMap(p => (p.d == null ? [p.a] : [p.a, p.d])));
    const mine = next.hand.filter(card => !prev.hand.includes(card) && !fromTable.has(card));
    return {
        kind: 'deal',
        drawn,
        // Добирает первым тот, кто заходил (так же и в правилах).
        first: prev.attacker,
        mine: mine.length === drawn[next.seat] ? mine : [],
    };
}

/** Проиграть шаги показа по порядку. */
async function playSteps(state, prev, next, steps) {
    const size = cardSize(state);
    const sweep = steps.find(s => s.kind === 'sweep');
    const plays = steps.filter(s => s.kind === 'play');
    const deal = steps.find(s => s.kind === 'deal');
    const said = steps.find(s => s.kind === 'shout');
    const text = (said && (said.text || takeText(state, said.who))) || sweep?.text;

    // ── 1. Мерим по СТАРОМУ виду: он ещё на экране
    const from = new Map();
    for (const step of plays) from.set(step.card, spotIn(state, handRect(state, prev, step.seat), size));

    const spots = new Map();
    let lateSpot = null;
    if (sweep) {
        for (const card of sweep.cards) {
            const at = rectOf(state, state.modal.querySelector(`#dur-field .dur-card[data-card="${card}"]`));
            if (at) spots.set(card, { x: at.x, y: at.y });
        }
        if (sweep.late.length) {
            // Опоздавшая карта ложится туда же, куда легла бы защита последней
            // пары, — со сдвигом, как все побитые.
            const last = rectOf(state, state.modal.querySelector('#dur-field .dur-pair:last-child .dur-pair-a'));
            for (const card of sweep.late) {
                spots.set(card, last ? { x: last.x + size.w * 0.24, y: last.y + size.h * 0.18 } : null);
            }
            lateSpot = spotIn(state, handRect(state, prev, sweep.lateFrom), size);
        }
    }

    // ── 2. Рисуем новый вид, спрятав всё, что должно прилететь
    state.hiding = new Set([...plays.map(s => s.card), ...(deal?.mine || [])]);
    state.dealt = deal ? prev.counts.slice() : null;
    render(state);
    if (text) shout(state, text);

    // ── 3. Показываем
    if (plays.length) {
        await Promise.all(plays.map(step => {
            const target = rectOf(state, state.modal.querySelector(
                `#dur-field .dur-pair[data-i="${step.i}"] .dur-pair-${step.role}`));
            const el = flyingCard(state, { value: step.card, at: from.get(step.card) });
            return glide(el, target, { ms: PLAY_MS }).then(() => el.remove());
        }));
        state.hiding = null;
        renderField(state);
    }

    if (sweep) {
        const flyers = [];
        // Опоздавшая карта сначала ложится на стол — иначе она мелькнёт уже
        // улетающей, и будет непонятно, чем же отбились.
        for (const value of sweep.late) {
            if (!lateSpot || !spots.get(value)) continue;
            const el = flyingCard(state, { value, at: lateSpot });
            flyers.push(el);
            await glide(el, spots.get(value), { ms: PLAY_MS });
        }
        for (const value of sweep.cards) {
            const at = spots.get(value);
            if (at) flyers.push(flyingCard(state, { value, at }));
        }

        const to = sweep.to === 'discard'
            ? spotIn(state, rectOf(state, state.modal.querySelector('.dur-out-btn')), size)
            : spotIn(state, handRect(state, next, sweep.to), size);
        await Promise.all(flyers.map((el, i) =>
            glide(el, to, { ms: SWEEP_MS, delay: i * 25, fade: true, rot: 8 })
                .then(() => el.remove())));
        renderOut(state);
    }

    if (deal) await dealCards(state, deal, size);
}

/** Раздача и добор: карты по одной уезжают из колоды по рукам. */
async function dealCards(state, deal, size) {
    const view = state.view;
    const deck = spotIn(state, rectOf(state, state.modal.querySelector('.dur-stock-back')
        || state.modal.querySelector('#dur-stock')), size);
    if (!deck) return;

    // По одной карте по кругу, начиная с того, кто добирает первым, — как
    // сдают на самом деле, а не «шесть штук одному, потом шесть другому».
    const order = [];
    const left = deal.drawn.slice();
    const mine = (deal.mine || []).slice();
    let guard = 0;
    while (left.some(n => n > 0) && guard++ < 40) {
        for (let k = 0; k < view.seats; k++) {
            const seat = (deal.first + k) % view.seats;
            if (left[seat] > 0) { left[seat]--; order.push(seat); }
        }
    }

    let mineIdx = 0;
    await Promise.all(order.map((seat, i) => {
        const value = seat === view.seat && mine[mineIdx] != null ? mine[mineIdx++] : null;
        const target = value != null
            ? rectOf(state, state.modal.querySelector(`#dur-hand .dur-card[data-card="${value}"]`))
            : spotIn(state, handRect(state, view, seat), size);
        const el = flyingCard(state, { at: deck, faceDown: true });
        return glide(el, target, { ms: DEAL_MS, delay: i * DEAL_GAP }).then(() => {
            el.remove();
            if (openState !== state) return;
            if (value != null) { state.hiding?.delete(value); renderHand(state); }
            if (state.dealt) { state.dealt[seat]++; renderSeats(state); }
        });
    }));
}

// ── Мелочи показа ────────────────────────────────────────────────────────────

/** «Беру» про себя и «Вася берёт» про соседа: за столом на четверых важно, кто. */
const takeText = (state, seat) => (seat === state.view.seat
    ? 'Беру'
    : `${state.players[seat]?.name || 'Соперник'} берёт`);

/** Крупная надпись поверх стола: «Бито», «Беру», «Перевод». */
function shout(state, text) {
    const box = state.modal?.querySelector('#dur-shout');
    if (!box || !text) return;
    box.textContent = text;
    // Снять и вернуть класс — иначе вторая подряд надпись не проигрывается.
    box.classList.remove('is-on');
    void box.offsetWidth;
    box.classList.add('is-on');
    clearTimeout(state.shoutTimer);
    state.shoutTimer = setTimeout(() => box.classList.remove('is-on'), SHOUT_MS);
}

/** Летящая карта. Живёт на своём слое и кликов не ловит. */
function flyingCard(state, { value, at, faceDown = false }) {
    const layer = state.modal.querySelector('#dur-fly');
    const el = document.createElement('div');
    el.className = `dur-card dur-flying${faceDown ? ' is-down' : ''}`;
    if (!faceDown && value != null) {
        el.innerHTML = `<i style="--col:${spriteCol(value)}; --row:${spriteRow(value)}"></i>`;
    }
    el.dataset.x = at?.x ?? 0;
    el.dataset.y = at?.y ?? 0;
    el.style.transform = `translate(${el.dataset.x}px, ${el.dataset.y}px)`;
    layer?.appendChild(el);
    return el;
}

/** Двинуть летящую карту. Обещание разрешается, когда она долетела. */
function glide(el, to, { ms, delay = 0, fade = false, rot = 0 } = {}) {
    const from = { x: Number(el.dataset.x), y: Number(el.dataset.y) };
    if (!to) { el.remove(); return Promise.resolve(); }
    el.dataset.x = to.x;
    el.dataset.y = to.y;
    const anim = el.animate([
        { transform: `translate(${from.x}px, ${from.y}px) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${to.x}px, ${to.y}px) rotate(${rot}deg)`, opacity: fade ? 0 : 1 },
    ], { duration: ms, delay, easing: 'cubic-bezier(.22,.7,.28,1)', fill: 'forwards' });
    return anim.finished.catch(() => {});
}

/** Размер карты — берём с любой нарисованной, чтобы не считать его дважды. */
function cardSize(state) {
    const any = state.modal.querySelector('.dur-card');
    const w = any?.offsetWidth || 60;
    return { w, h: any?.offsetHeight || Math.round(w * 1.338) };
}

/** Положение узла в координатах стола (на нём же лежит слой показа). */
function rectOf(state, el) {
    const host = state.modal?.querySelector('#dur-table-screen');
    if (!el || !host) return null;
    const a = el.getBoundingClientRect();
    const b = host.getBoundingClientRect();
    if (!a.width && !a.height) return null;
    return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
}

/** Куда положить карту, чтобы её середина совпала с серединой области. */
function spotIn(state, rect, size) {
    return rect ? { x: rect.x + (rect.w - size.w) / 2, y: rect.y + (rect.h - size.h) / 2 } : null;
}

/** Откуда и куда летят карты игрока: своя рука внизу, чужие — веером сверху. */
function handRect(state, view, seat) {
    if (seat === view.seat) return rectOf(state, state.modal.querySelector('#dur-hand'));
    return rectOf(state, state.modal.querySelector(`.dur-seat[data-seat="${seat}"] .dur-seat-fan`));
}

/** Спрятать руки перед раздачей: карты появятся, когда долетят. */
function beforeDeal(state) {
    if (!animated() || !state.view) return;
    state.hiding = new Set(state.view.hand);
    state.dealt = state.view.counts.map(() => 0);
}

/** Показать раздачу в начале партии. */
async function dealIntro(state) {
    if (!state.hiding || !state.view) { render(state); return; }
    state.anim = true;
    try {
        await dealCards(state, {
            drawn: state.view.counts.slice(),
            mine: state.view.hand.slice(),
            first: state.view.attacker,
        }, cardSize(state));
    } catch { /* см. applyView */ } finally {
        state.anim = false;
        state.hiding = null;
        state.dealt = null;
        if (openState === state) render(state);
    }
}

// ── Отрисовка ────────────────────────────────────────────────────────────────
// Всё, что касается внешнего вида, живёт ниже этой черты. Рисуем ВИД (view) — и
// в партии с ботом, и в партии с людьми он устроен одинаково, поэтому отсюда не
// видно, с кем играют.

/**
 * Строка под столом.
 *
 * Обычно там ПОДСКАЗКА, посчитанная из вида, а не запомненное «что случилось».
 * Разница принципиальная: подсказку нельзя проспать и нельзя рассинхронизировать
 * с партией — она всегда описывает то, что на столе прямо сейчас. Запомненные
 * сообщения («соперник взял») в партии с людьми и вовсе не из чего складывать:
 * с сервера приезжает позиция, а не рассказ о ней.
 *
 * Поверх подсказки ненадолго показывается ОТКАЗ («сервер не принял ход») — это
 * единственное, чего по столу не видно.
 */
function flash(state, text) {
    clearTimeout(state.flashTimer);
    state.flash = text || '';
    state.flashTimer = setTimeout(() => {
        if (openState !== state) return;
        state.flash = '';
        renderNote(state);
    }, 4000);
    renderNote(state);
}

function renderNote(state) {
    const box = state.modal?.querySelector('#dur-note');
    if (!box) return;
    const text = state.flash || hintFor(state);
    box.textContent = text;
    box.classList.toggle('is-show', !!text);
    box.classList.toggle('is-flash', !!state.flash);
}

/** Что сейчас происходит и чего от игрока ждут. */
function hintFor(state) {
    const view = state.view;
    if (!view) return '';
    if (view.phase === 'over') return END_TEXT[view.reason] || '';

    const who = seat => esc(state.players[seat]?.name || 'соперник');
    const mine = view.toMove === view.seat;

    if (view.taking) {
        return view.seat === view.defender
            ? 'Вы берёте — ждём, чем ещё догрузят'
            : (mine ? `${who(view.defender)} берёт — можно подкинуть` : `${who(view.defender)} берёт`);
    }
    if (!mine) {
        return view.toMove === view.defender
            ? `${who(view.toMove)} отбивается`
            : `Ходит ${who(view.toMove)}`;
    }
    if (view.seat === view.defender) return 'Отбивайтесь или берите';
    if (!view.table.length) return 'Ваш заход';
    return 'Можно подкинуть — или «бито»';
}

function render(state) {
    if (state.screen !== 'table' || !state.view) return;
    renderSeats(state);
    renderStock(state);
    renderField(state);
    renderOut(state);
    renderHand(state);
    renderBar(state);
    renderNote(state);
}

/** Соседи по столу: имя, сколько карт и что они сейчас делают. */
function renderSeats(state) {
    const view = state.view;
    const box = state.modal.querySelector('#dur-seats');
    const html = [];
    // По кругу от себя: сосед слева (он же первый защитник) идёт первым.
    for (let k = 1; k < view.seats; k++) {
        const seat = (view.seat + k) % view.seats;
        const player = state.players[seat];
        const count = view.counts[seat];
        const role = seat === view.defender ? 'отбивается'
            : seat === view.attacker ? 'заходит'
            : count ? 'подкидывает' : 'вышел';
        const acts = view.toMove === seat;
        // Пока идёт раздача, веер показывает столько карт, сколько уже долетело:
        // иначе карты летят к рукам, которые и без них уже полные.
        const shown = state.dealt ? Math.min(count, state.dealt[seat]) : count;
        const fan = Array.from({ length: Math.min(shown, 6) },
            (_, i) => `<div class="dur-card is-down" style="--i:${i}"></div>`).join('');
        html.push(`
            <div class="dur-seat${acts ? ' is-acting' : ''}${count ? '' : ' is-out'}" data-seat="${seat}">
                <div class="dur-seat-fan">${fan}<span class="dur-seat-count">${shown}</span></div>
                <div class="dur-seat-name">${esc(player?.name || 'Игрок')}</div>
                <div class="dur-seat-role">${role}</div>
            </div>`);
    }
    box.innerHTML = html.join('');
}

/** Колода с козырем на дне. */
function renderStock(state) {
    const view = state.view;
    const box = state.modal.querySelector('#dur-stock');
    const suit = SUITS[view.trump];
    const sign = `<span class="dur-trump-sign s-${suit}">${SUIT_SIGN[suit]}</span>`;
    if (!view.deckLeft) {
        box.innerHTML = `<div class="dur-stock-empty">${sign}<span>колода кончилась</span></div>`;
        return;
    }
    // Козырь лежит под колодой и торчит из-под неё — как на столе.
    box.innerHTML = `
        <div class="dur-stock-pile">
            ${cardHtml(view.down, 'dur-stock-down')}
            <div class="dur-card is-down dur-stock-back"></div>
            <span class="dur-stock-count">${view.deckLeft}</span>
        </div>
        <div class="dur-stock-label">козырь ${sign}</div>`;
}

/** Стол: пары «атака — защита». */
function renderField(state) {
    const view = state.view;
    const box = state.modal.querySelector('#dur-field');
    if (!view.table.length) {
        const waiting = view.toMove === view.seat ? 'Ваш заход' : 'Ждём захода';
        box.innerHTML = `<div class="dur-field-empty">${waiting}</div>`;
        return;
    }
    const target = defenceTarget(view);
    box.innerHTML = view.table.map((pair, i) => `
        <div class="dur-pair${i === target && view.seat === view.defender && !view.taking ? ' is-target' : ''}" data-i="${i}">
            ${cardHtml(pair.a, `dur-pair-a${hidden(state, pair.a)}`)}
            ${pair.d != null ? cardHtml(pair.d, `dur-pair-d${hidden(state, pair.d)}`) : ''}
        </div>`).join('');
}

/**
 * Отбой — «вышло».
 *
 * Панель нужна не для красоты: сильный бот считает вышедшие карты (это его
 * сложность), и прятать от человека то, что видит бот, было бы нечестно. За
 * настоящим столом отбой лежит рубашкой вверх, но обе карты каждой пары все
 * видели, когда они ложились, — так что это память, а не подглядывание.
 */
function renderOut(state) {
    const view = state.view;
    const box = state.modal.querySelector('#dur-out');
    const list = state.showDiscard && view.discard.length
        ? `<div class="dur-out-list">${view.discard.map(c => cardHtml(c, 'is-mini')).join('')}</div>`
        : '';
    box.innerHTML = `
        <button type="button" class="dur-out-btn${state.showDiscard ? ' is-on' : ''}">Вышло: ${view.discard.length}</button>
        ${list}`;
}

function renderHand(state) {
    const view = state.view;
    const box = state.modal.querySelector('#dur-hand');
    const mine = view.toMove === view.seat && !state.busy && !state.anim;
    const attacks = mine ? attackCards(view) : [];
    const covers = mine ? defendCards(view) : [];
    const moves = mine ? transferCards(view) : [];

    box.innerHTML = view.hand.map((card, i) => {
        const playable = attacks.includes(card) || covers.includes(card) || moves.includes(card);
        const cls = [
            'dur-hand-card',
            playable ? 'is-playable' : '',
            state.transferMode && moves.includes(card) ? 'is-transfer' : '',
            hidden(state, card).trim(),
        ].join(' ');
        return cardHtml(card, cls, `style="--i:${i}"`);
    }).join('');
    box.classList.toggle('is-idle', !mine);
}

function renderBar(state) {
    const view = state.view;
    const show = (id, on, text) => {
        const btn = state.modal.querySelector(id);
        btn.classList.toggle('hidden', !on);
        if (text) btn.textContent = text;
    };
    const mine = view.toMove === view.seat && view.phase === 'play' && !state.busy && !state.anim;
    show('#dur-take', mine && canTake(view));
    // «Бито» и «Хватит» — одна кнопка: смысл у неё один (закончить розыгрыш), а
    // слово разное, потому что в одном случае карты уедут в отбой, а в другом
    // достанутся тому, кто взял.
    show('#dur-pass', mine && canPass(view), view.taking ? 'Хватит' : 'Бито');
    const canSwap = mine && transferCards(view).length > 0;
    show('#dur-transfer', canSwap, state.transferMode ? 'Не переводить' : 'Перевести');
    state.modal.querySelector('#dur-transfer').classList.toggle('is-on', state.transferMode);
    show('#dur-claim', state.mode === 'pvp' && !!state.meta?.can_claim);
    show('#dur-resign', state.mode === 'pvp', 'Сдаться');
}

function showOver(state) {
    stopAll(state);
    const view = state.view;
    const loser = view?.loser;
    const title = loser === -1 || loser == null ? 'Ничья'
        : loser === state.seat ? 'Вы дурак'
        : `Дурак — ${state.players[loser]?.name || 'соперник'}`;
    state.modal.querySelector('#dur-over-title').textContent = title;
    state.modal.querySelector('#dur-over-sub').textContent =
        (END_TEXT[view?.reason] || '')
        + (state.mode === 'bot' ? ' · партии с ботом в таблицу не идут' : '');
    state.modal.querySelector('#dur-over').classList.remove('hidden');
    render(state);
}

/**
 * Карта: подложка (сама .dur-card) плюс слой с картинкой из листа колоды.
 * Строка и столбец считаются прямо из правил — таблицы соответствия «карта →
 * картинка» нет нигде (см. shared/solitaire.js, откуда взята колода).
 */
function cardHtml(card, cls = '', attrs = '') {
    return `<div class="dur-card ${cls}" data-card="${card}" title="${cardLabel(card)}" ${attrs}
                 ><i style="--col:${spriteCol(card)}; --row:${spriteRow(card)}"></i></div>`;
}

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
