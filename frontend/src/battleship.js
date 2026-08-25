// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Морской бой» — окно игры, лобби с вызовами и таблица очков.
//
// Открывается ТОЛЬКО из меню игр (games.js), а оно — из поиска на главной:
// набрать «игры» и нажать Enter. Пока это слово набирают, поиск молчит.
//
// Правила целиком в shared/battleship.js — здесь ни строчки про то, что во что
// попадает и куда можно поставить корабль. Этот файл рисует два поля, слушает
// мышь и разговаривает с сервером.
//
// ОДНА КАРТИНКА НА ДВА РЕЖИМА: и партия с ботом, и партия с людьми рисуются из
// ВИДА (view) — того самого объекта, который сервер отдаёт игроку: свой флот,
// чужие выстрелы по нему, свои выстрелы по чужому полю и потопленные чужие
// корабли. С ботом вид считается тут же (viewFor), с людьми приезжает по сети.
// Поэтому отрисовка не знает, с кем играют, и НЕ МОЖЕТ случайно показать чужую
// расстановку — её просто нет в том, что она рисует.
//
// ПАРТИЯ С БОТОМ ЖИВЁТ ТОЛЬКО ЗДЕСЬ: сервер о ней не знает и в таблицу очков она
// не идёт. Иначе первое место занял бы не тот, кто обыгрывает людей, а тот, кто
// настрелял побед по Юнге.
//
// ТРИ ЭКРАНА, А НЕ ДВА: лобби → расстановка → бой. Расстановка — это не окно
// настроек перед игрой, а часть партии: она уже идёт, соперник уже сидит, из неё
// можно сдаться, и её же забирают, если человек ушёл, не расставившись.
//
// ВСЕ ЗНАЧКИ — SVG (icons.js), ни одного эмодзи. Причина ровно та же, что в
// сапёре: 💥 и 🌊 рисует операционная система, в каждой по-своему, и подогнать
// их под клетку в двадцать шесть пикселей, под тему и под подсветку последнего
// выстрела нельзя. Значок из icons.js наследует currentColor и размер — один и
// тот же взрыв сам краснеет на чужом поле и гаснет на своём.
//
// КОРАБЛИ РИСУЮТСЯ НЕ КЛЕТКАМИ, А ПОЛОСАМИ ПОВЕРХ СЕТКИ. Четырёхпалубный,
// собранный из четырёх подкрашенных клеток, читается как четыре катера в ряд —
// а именно этой разницы вся игра и касается. Отдельный слой поверх поля
// позволяет нарисовать корабль одной скруглённой полосой, а заодно бесплатно
// даёт призрак под курсором при расстановке.
// ─────────────────────────────────────────────────────────────────────────────

import {
    SIZE, CELLS, FLEET, NONE, MISS, HIT, ACROSS, DOWN, COLUMNS,
    xOf, yOf, shipAt, shipCells, canPlace, cellName,
    createGame, applyMove, viewFor, enemyLeft, randomFleet, fleetError,
    resign as resignRules, FLEET_ERROR_TEXT, SHIP_NAMES, END_TEXT,
} from '../../shared/battleship.js';
import { pickShot, pickFleet, LEVELS, NORMAL } from '../../shared/battleshipBot.js';
import {
    splashIcon, blastIcon, wreckIcon, turnIcon,
    crosshairIcon, anchorIcon, shuffleIcon,
} from './icons.js';
import { namePrefixHtml } from './namePrefix.js';
import { profileRowAttrs, bindProfileRows } from './topProfile.js';

const MODAL_ID = 'battleship-modal';

// Как часто спрашиваем сервер. Полторы секунды в игре по очереди не заметны
// вовсе, а лобби можно опрашивать втрое реже — там меняется только список.
const POLL_GAME_MS = 1500;
const POLL_LOBBY_MS = 4500;

// Пауза перед выстрелом бота. Без неё он отстреливает всю серию попаданий между
// двумя кадрами: игрок видит готовое поле и не понимает, что произошло.
// Продолжение серии — шагом покороче: это одно его действие, а не новое решение.
const BOT_THINK_MS = 750;
const BOT_AGAIN_MS = 480;

// Сколько держится крупная надпись над полем («Мимо», «Ранил», «Убил»).
const SHOUT_MS = 900;

let openState = null;   // одно окно за раз

/** Открыть игру. ctx: { apiFetch, user }. */
export function openBattleship(ctx) {
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
        screen: 'lobby',        // lobby | setup | battle
        mode: 'bot',            // bot | pvp
        // Партия с ботом — только здесь; с людьми её тут нет вовсе.
        game: null,
        botLevel: NORMAL,
        seat: 0,
        // Что рисуем. Одинаково в обоих режимах (см. шапку).
        view: null,
        meta: null,
        players: [],
        // Сервер
        gameId: null,
        seq: 0,
        // Расстановка
        draft: [],              // уже поставленные корабли
        picked: null,           // длина выбранного в доке корабля
        dir: ACROSS,
        hover: -1,              // клетка под курсором
        // Показ и ввод
        fresh: null,            // клетки, изменившиеся последним ходом
        flash: '',
        flashTimer: 0,
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
    // Строка мини-топа ведёт в профиль, а профиль — обычная страница под
    // окном: чтобы её было видно, окно надо закрыть (см. topProfile.js).
    state.close = close;
    const onKeyDown = e => {
        // Поворот корабля — только на экране расстановки и только если там
        // есть что поворачивать. «R» и «К» — одна и та же клавиша в двух
        // раскладках: переключать её ради игры никто не станет.
        if (state.screen === 'setup' && /^[rRкК]$/.test(e.key)) {
            e.preventDefault();
            turnShip(state);
            return;
        }
        if (e.key !== 'Escape') return;
        e.preventDefault();
        // С поля Escape возвращает в лобби, а не закрывает окно: партия с людьми
        // продолжает жить на сервере, и «выйти» из неё — не то же самое, что
        // закрыть игру.
        if (state.screen === 'lobby') close();
        else showLobby(state);
    };
    document.addEventListener('keydown', onKeyDown, true);

    modal.querySelector('.modal-backdrop').onclick = close;
    modal.querySelector('#bs-close').onclick = close;

    bindLobby(state);
    bindSetup(state);
    bindBattle(state);
    showLobby(state);
    return modal;
}

function shellHtml() {
    const levels = LEVELS.map(l =>
        `<button type="button" class="btn btn-sec bs-level" data-level="${l.id}">${l.name}</button>`).join('');

    return `
        <div class="modal-backdrop"></div>
        <div class="modal-win bs-win">
            <div class="modal-head">
                <span>Морской бой</span>
                <button class="btn btn-sec" id="bs-close" title="Закрыть">✕</button>
            </div>

            <div class="bs-body">
                <!-- ── Лобби ── -->
                <div class="bs-lobby" id="bs-lobby">
                    <div class="bs-cols">
                        <section class="bs-box">
                            <h4>С ботом</h4>
                            <p class="bs-hint">Партия целиком в браузере — в таблицу очков не идёт.</p>
                            <div class="bs-levels">${levels}</div>
                            <p class="bs-hint">Юнга бьёт наугад, Наводчик ищет по сетке и добивает линией,
                               Адмирал считает, куда ещё влезают живые корабли.</p>
                        </section>

                        <section class="bs-box">
                            <h4>С людьми</h4>
                            <p class="bs-hint">Вызов висит в лобби, пока его не примут. Расставляетесь оба сразу.</p>
                            <button type="button" class="btn btn-pri" id="bs-call">Бросить вызов</button>
                            <div class="bs-list" id="bs-open"></div>
                        </section>
                    </div>

                    <section class="bs-box bs-mine-box hidden" id="bs-mine-box">
                        <h4>Ваши партии</h4>
                        <div class="bs-list" id="bs-mine"></div>
                    </section>

                    <div class="bs-top" id="bs-top"></div>
                </div>

                <!-- ── Расстановка ── -->
                <div class="bs-setup hidden" id="bs-setup">
                    <div class="bs-setup-cols">
                        <div class="bs-board-box">
                            <div class="bs-field-head">${anchorIcon(15)}<span>Ваше поле</span></div>
                            ${boardShellHtml('setup')}
                        </div>
                        <div class="bs-dock-box">
                            <div class="bs-dock" id="bs-dock"></div>
                            <div class="bs-setup-bar">
                                <button type="button" class="btn btn-sec" id="bs-turn">${turnIcon(15)}<span>Повернуть</span></button>
                                <button type="button" class="btn btn-sec" id="bs-random">${shuffleIcon(15)}<span>Случайно</span></button>
                                <button type="button" class="btn btn-sec" id="bs-clear">Очистить</button>
                            </div>
                            <button type="button" class="btn btn-pri bs-ready" id="bs-ready">Готов</button>
                            <div class="bs-note" id="bs-setup-note"></div>
                            <div class="bs-setup-back">
                                <button type="button" class="btn btn-sec" id="bs-setup-resign">Сдаться</button>
                                <button type="button" class="btn btn-sec" id="bs-setup-lobby">В лобби</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ── Бой ── -->
                <div class="bs-battle hidden" id="bs-battle">
                    <div class="bs-fields">
                        <div class="bs-board-box">
                            <div class="bs-field-head">${anchorIcon(15)}<span>Ваше поле</span>
                                <b class="bs-left" id="bs-my-left"></b></div>
                            ${boardShellHtml('my')}
                        </div>
                        <div class="bs-board-box">
                            <div class="bs-field-head">${crosshairIcon(15)}<span id="bs-foe-name">Соперник</span>
                                <b class="bs-left" id="bs-foe-left"></b></div>
                            ${boardShellHtml('foe')}
                        </div>
                    </div>
                    <div class="bs-note" id="bs-note"></div>
                    <div class="bs-bar">
                        <button type="button" class="btn btn-sec bs-act" id="bs-claim">Забрать партию</button>
                        <span class="bs-bar-gap"></span>
                        <button type="button" class="btn btn-sec" id="bs-resign">Сдаться</button>
                        <button type="button" class="btn btn-sec" id="bs-to-lobby">В лобби</button>
                    </div>
                    <!-- Крупная надпись поверх полей. Сквозная для кликов: она
                         только показывает, а не мешает стрелять. -->
                    <div class="bs-shout" id="bs-shout"></div>
                    <div class="bs-over hidden" id="bs-over">
                        <div class="bs-over-card">
                            <div class="bs-over-title" id="bs-over-title"></div>
                            <div class="bs-over-sub" id="bs-over-sub"></div>
                            <button type="button" class="btn btn-pri" id="bs-over-back">В лобби</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
}

/**
 * Пустая оболочка поля: буквы сверху, цифры слева, сетка и слой кораблей.
 *
 * Буквы и цифры рисуются ОДИН РАЗ и потом не трогаются — они не меняются за всю
 * партию, а перерисовывать их на каждый выстрел значило бы двести лишних узлов
 * полторы секунды.
 */
function boardShellHtml(kind) {
    const letters = COLUMNS.map(c => `<i>${c}</i>`).join('');
    let digits = '';
    for (let n = 1; n <= SIZE; n++) digits += `<i>${n}</i>`;
    return `
        <div class="bs-board" data-board="${kind}">
            <div class="bs-letters">${letters}</div>
            <div class="bs-digits">${digits}</div>
            <div class="bs-plate">
                <div class="bs-grid" id="bs-grid-${kind}"></div>
                <div class="bs-ships" id="bs-ships-${kind}"></div>
            </div>
        </div>`;
}

// ── Лобби ────────────────────────────────────────────────────────────────────

function bindLobby(state) {
    const modal = state.modal;
    modal.querySelectorAll('.bs-level').forEach(btn => {
        btn.onclick = () => startBotGame(state, btn.dataset.level);
    });
    modal.querySelector('#bs-call').onclick = () => createChallenge(state);
    // Именно #bs-to-lobby, а не #bs-lobby: последний — это САМ экран лобби, и
    // обработчик, повешенный на него, ловил бы всплывшие клики по всему, что в
    // нём лежит, — включая кнопки уровней бота.
    modal.querySelector('#bs-to-lobby').onclick = () => showLobby(state);
    modal.querySelector('#bs-setup-lobby').onclick = () => showLobby(state);
    modal.querySelector('#bs-over-back').onclick = () => showLobby(state);
}

function showLobby(state) {
    stopAll(state);
    state.screen = 'lobby';
    state.gameId = null;
    state.game = null;
    state.view = null;
    state.modal.querySelector('#bs-lobby').classList.remove('hidden');
    state.modal.querySelector('#bs-setup').classList.add('hidden');
    state.modal.querySelector('#bs-battle').classList.add('hidden');
    state.modal.querySelector('#bs-over').classList.add('hidden');
    loadLobby(state);
    state.pollTimer = setInterval(() => loadLobby(state), POLL_LOBBY_MS);
}

async function loadLobby(state) {
    try {
        const res = await state.ctx.apiFetch('/api/battleship/lobby');
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
    const openBox = state.modal.querySelector('#bs-open');
    const mineBox = state.modal.querySelector('#bs-mine');
    const mineCard = state.modal.querySelector('#bs-mine-box');
    const callBtn = state.modal.querySelector('#bs-call');

    if (data.offline) {
        openBox.innerHTML = '<div class="bs-empty">Сервер не ответил — с ботом сыграть можно, с людьми пока нет.</div>';
        mineCard.classList.add('hidden');
        state.modal.querySelector('#bs-top').innerHTML = '';
        return;
    }

    const open = data.open || [];
    const mineCall = open.find(g => g.players[0]?.id === meId);
    callBtn.textContent = mineCall ? 'Отозвать вызов' : 'Бросить вызов';
    callBtn.onclick = () => (mineCall ? cancelChallenge(state, mineCall.id) : createChallenge(state));

    openBox.innerHTML = open.map(g => {
        const mine = g.players[0]?.id === meId;
        const who = esc(g.players[0]?.name || 'Игрок');
        const action = mine
            ? '<span class="bs-row-tag">ждёт соперника</span>'
            : `<button type="button" class="btn btn-sec bs-row-btn" data-join="${g.id}">Принять</button>`;
        return `
            <div class="bs-row${mine ? ' is-mine' : ''}">
                <div class="bs-row-main">
                    <div class="bs-row-name">${who}</div>
                    <div class="bs-row-sub">вызов один на один</div>
                </div>
                ${action}
            </div>`;
    }).join('') || '<div class="bs-empty">Вызовов нет. Бросьте свой — его увидят все.</div>';
    openBox.querySelectorAll('[data-join]').forEach(b => { b.onclick = () => joinChallenge(state, b.dataset.join); });

    const mine = data.mine || [];
    mineCard.classList.toggle('hidden', !mine.length);
    mineBox.innerHTML = mine.map(g => {
        const foe = esc(g.players[1 - g.seat]?.name || 'Соперник');
        // Подпись у расстановки и у боя разная: «ваш ход» посреди расстановки
        // означал бы, что пора стрелять, а стрелять ещё некуда.
        const tag = g.phase === 'setup'
            ? (g.my_turn ? 'расставьте флот' : 'соперник расставляет флот')
            : (g.my_turn ? 'ваш ход' : (g.can_claim ? 'соперник пропал' : 'ход соперника'));
        return `
            <div class="bs-row">
                <div class="bs-row-main">
                    <div class="bs-row-name">${foe}</div>
                    <div class="bs-row-sub"><span class="bs-row-tag${g.my_turn ? ' is-turn' : ''}">${tag}</span></div>
                </div>
                <button type="button" class="btn btn-sec bs-row-btn" data-resume="${g.id}">Открыть</button>
            </div>`;
    }).join('');
    mineBox.querySelectorAll('[data-resume]').forEach(b => { b.onclick = () => resumeGame(state, b.dataset.resume); });

    renderTop(state, data.top);
}

function renderTop(state, top) {
    const box = state.modal.querySelector('#bs-top');
    if (!box) return;
    const rows = top?.rows || [];
    if (!rows.length) {
        box.innerHTML = '<div class="bs-top-head">Таблица</div>'
            + '<div class="bs-empty">Никто ещё не выигрывал — первое очко будет вашим.</div>';
        return;
    }
    const meId = state.ctx.user?.id;
    const list = rows.map(row => `
        <div class="bs-top-row${row.id === meId ? ' is-me' : ''}${row.rank === 1 ? ' is-first' : ''}"${profileRowAttrs(row)}>
            <span class="bs-top-rank">${row.rank}</span>
            <div class="bs-top-avatar">${row.avatar
                ? `<img src="${esc(row.avatar)}" alt=""/>`
                : '<span class="top-avatar-default"></span>'}</div>
            <div class="bs-top-name">${namePrefixHtml(row)}${esc(row.display_name)}</div>
            <span class="bs-top-score">${row.wins}<span class="bs-top-losses"> / ${row.losses}</span></span>
        </div>`).join('');

    const me = top.me;
    const inList = rows.some(r => r.id === meId);
    const mine = me && !inList
        ? `<div class="bs-top-row is-me is-mine-extra">
               <span class="bs-top-rank">${me.rank}</span>
               <div class="bs-top-name">Ваши очки</div>
               <span class="bs-top-score">${me.wins}<span class="bs-top-losses"> / ${me.losses}</span></span>
           </div>`
        : '';

    // Подпись объясняет второе число: «12 / 4» без пояснения читается как счёт
    // партии, а это победы и поражения.
    box.innerHTML = '<div class="bs-top-head">Таблица — победы / поражения</div>'
        + `<div class="bs-top-list">${list}</div>${mine}`;
    bindProfileRows(box, state.close);
}

// ── Вызовы ───────────────────────────────────────────────────────────────────

async function createChallenge(state) {
    if (state.busy) return;
    state.busy = true;
    try {
        await state.ctx.apiFetch('/api/battleship/challenge', { method: 'POST' });
        loadLobby(state);
    } catch { /* лобби перечитается само на следующем опросе */ }
    state.busy = false;
}

async function joinChallenge(state, id) {
    if (state.busy) return;
    state.busy = true;
    try {
        const res = await state.ctx.apiFetch(`/api/battleship/challenge/${id}/join`, { method: 'POST' });
        state.busy = false;
        if (res?.ok) { resumeGame(state, id); return; }
        loadLobby(state);
    } catch { /* см. выше */ }
    state.busy = false;
}

async function cancelChallenge(state, id) {
    if (state.busy) return;
    state.busy = true;
    try {
        await state.ctx.apiFetch(`/api/battleship/challenge/${id}`, { method: 'DELETE' });
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
    state.game = createGame({});
    // Бот расставляется сразу и молча: ждать его незачем, а показывать его
    // расстановку — тем более.
    applyMove(state.game, 1, { type: 'place', ships: pickFleet({}) });

    const botName = LEVELS.find(l => l.id === level)?.name || 'Бот';
    state.players = [
        { id: state.ctx.user?.id, name: state.ctx.user?.display_name || 'Вы' },
        { id: null, name: botName },
    ];
    state.meta = null;
    state.view = viewFor(state.game, 0);
    showSetup(state);
}

/** Сесть за партию, которая живёт на сервере. */
async function resumeGame(state, id) {
    try {
        const res = await state.ctx.apiFetch(`/api/battleship/game/${id}`);
        if (openState !== state || !res?.view) return;
        state.mode = 'pvp';
        state.game = null;
        state.gameId = id;
        state.seat = res.seat;
        state.meta = res;
        state.players = res.players || state.players;
        state.seq = res.seq;
        state.view = res.view;
        state.fresh = null;

        if (res.view.phase === 'setup') showSetup(state);
        else showBattle(state);
        if (res.status === 'done' || res.view.phase === 'over') { showOver(state); return; }
        startPolling(state);
    } catch {
        flash(state, 'Не удалось открыть партию — попробуйте ещё раз');
    }
}

function stopAll(state) {
    clearInterval(state.pollTimer);
    clearTimeout(state.botTimer);
    clearTimeout(state.flashTimer);
    clearTimeout(state.shoutTimer);
    state.pollTimer = 0;
    state.botTimer = 0;
    state.busy = false;
}

// ── Расстановка ──────────────────────────────────────────────────────────────

function bindSetup(state) {
    const modal = state.modal;
    const grid = modal.querySelector('#bs-grid-setup');

    grid.onclick = e => {
        const cell = cellOf(e.target);
        if (cell >= 0) onSetupClick(state, cell);
    };
    // Правая кнопка поворачивает: рука уже на поле, и тянуться к кнопке ради
    // самого частого действия расстановки не надо.
    grid.oncontextmenu = e => { e.preventDefault(); turnShip(state); };
    grid.onmousemove = e => {
        const cell = cellOf(e.target);
        if (cell !== state.hover) { state.hover = cell; renderGhost(state); }
    };
    grid.onmouseleave = () => { state.hover = -1; renderGhost(state); };

    modal.querySelector('#bs-dock').onclick = e => {
        const item = e.target.closest?.('.bs-dock-item');
        if (!item) return;
        state.picked = Number(item.dataset.len);
        renderSetup(state);
    };
    modal.querySelector('#bs-turn').onclick = () => turnShip(state);
    modal.querySelector('#bs-random').onclick = () => {
        state.draft = randomFleet();
        state.picked = null;
        renderSetup(state);
    };
    modal.querySelector('#bs-clear').onclick = () => {
        state.draft = [];
        state.picked = FLEET[0];
        renderSetup(state);
    };
    modal.querySelector('#bs-ready').onclick = () => sendFleet(state);
    modal.querySelector('#bs-setup-resign').onclick = () => resignNow(state);
}

function showSetup(state) {
    clearInterval(state.pollTimer);
    state.pollTimer = 0;
    state.screen = 'setup';
    state.hover = -1;
    state.flash = '';
    // Свой флот на сервере уже лежит — значит, «Готов» нажат, и трогать
    // расстановку больше нельзя: показываем её и ждём соперника.
    const placed = state.view?.ready?.[state.seat];
    state.draft = placed ? (state.view.fleet || []).slice() : [];
    state.picked = placed ? null : FLEET[0];

    state.modal.querySelector('#bs-lobby').classList.add('hidden');
    state.modal.querySelector('#bs-setup').classList.remove('hidden');
    state.modal.querySelector('#bs-battle').classList.add('hidden');
    renderSetup(state);
}

/** Уже нажали «Готов» и ждём соперника — трогать поле нельзя. */
const waitingForFoe = state => !!state.view?.ready?.[state.seat];

function turnShip(state) {
    if (waitingForFoe(state)) return;
    state.dir = state.dir === ACROSS ? DOWN : ACROSS;
    renderGhost(state);
}

/**
 * Клик по своему полю в расстановке.
 *
 * Смысла у клика два, и путаницы между ними нет: по занятой клетке — забрать
 * корабль обратно в док, по пустой — поставить выбранный. Отдельной кнопки
 * «убрать» поэтому нет: ошибиться при расстановке — обычное дело, и исправление
 * должно быть таким же коротким, как сама ошибка.
 */
function onSetupClick(state, cell) {
    if (waitingForFoe(state)) return;

    const at = state.draft.findIndex(s => shipCells(s).includes(cell));
    if (at >= 0) {
        const [taken] = state.draft.splice(at, 1);
        state.picked = taken.len;
        state.dir = taken.dir;
        renderSetup(state);
        return;
    }

    if (state.picked == null) { flash(state, 'Выберите корабль в списке справа'); return; }
    const ship = shipAt(xOf(cell), yOf(cell), state.picked, state.dir);
    if (!canPlace(state.draft, ship)) {
        // Две разные причины отказа, и человеку они не одинаковы: «не влезает»
        // лечится поворотом, «касается» — сдвигом.
        flash(state, shipCells(ship)
            ? 'Между кораблями должна быть вода'
            : 'Корабль не помещается — поверните его');
        return;
    }
    state.draft.push(ship);
    // Сам подставляем следующий корабль: расстановка — это десять кликов
    // подряд, и лезть в док после каждого значит делать двадцать.
    const left = dockLeft(state);
    state.picked = left.length ? left[0] : null;
    renderSetup(state);
}

/** Какие корабли ещё не поставлены. */
function dockLeft(state) {
    const left = FLEET.slice();
    for (const s of state.draft) {
        const i = left.indexOf(s.len);
        if (i >= 0) left.splice(i, 1);
    }
    return left;
}

function renderSetup(state) {
    if (state.screen !== 'setup') return;
    const waiting = waitingForFoe(state);
    const left = dockLeft(state);

    // Док: по строке на размер, с числом оставшихся. Строк четыре, поэтому
    // список, а не выпадашка — выбрать надо одним нажатием.
    const groups = [...new Set(FLEET)].map(len => {
        const n = left.filter(l => l === len).length;
        const cells = Array.from({ length: len }, () => '<i></i>').join('');
        return `
            <button type="button" class="bs-dock-item${state.picked === len ? ' is-on' : ''}${n ? '' : ' is-done'}"
                    data-len="${len}" ${n && !waiting ? '' : 'disabled'}>
                <span class="bs-dock-ship">${cells}</span>
                <span class="bs-dock-name">${SHIP_NAMES[len]}</span>
                <b class="bs-dock-count">${n}</b>
            </button>`;
    }).join('');
    state.modal.querySelector('#bs-dock').innerHTML = groups;

    const ready = state.modal.querySelector('#bs-ready');
    ready.disabled = waiting || !!fleetError(state.draft) || state.busy;
    ready.textContent = waiting ? 'Ждём соперника' : 'Готов';
    state.modal.querySelector('#bs-turn').disabled = waiting;
    state.modal.querySelector('#bs-random').disabled = waiting;
    state.modal.querySelector('#bs-clear').disabled = waiting;
    // Сдаться можно и из расстановки: соперник уже сидит и ждёт, и просто уйти
    // значило бы держать его партию сутки до «забрать».
    state.modal.querySelector('#bs-setup-resign').classList.toggle('hidden', state.mode !== 'pvp');

    drawGrid(state, 'setup', { marks: null });
    drawShips(state, 'setup', { ships: state.draft, dead: [] });
    renderGhost(state);
    renderSetupNote(state);
}

function renderSetupNote(state) {
    const box = state.modal.querySelector('#bs-setup-note');
    if (!box) return;
    let text = state.flash;
    if (!text) {
        if (waitingForFoe(state)) {
            text = 'Флот принят. Ждём, пока соперник расставит свой.';
        } else if (dockLeft(state).length) {
            text = 'Ставьте корабли кликом. Правая кнопка или R — повернуть, клик по кораблю — убрать.';
        } else {
            text = 'Флот расставлен — жмите «Готов».';
        }
    }
    box.textContent = text;
    box.classList.toggle('is-flash', !!state.flash);
}

/** Призрак корабля под курсором: зелёный — можно, красный — нельзя. */
function renderGhost(state) {
    const layer = state.modal.querySelector('#bs-ships-setup');
    if (!layer) return;
    layer.querySelector('.bs-ghost')?.remove();
    if (state.screen !== 'setup' || waitingForFoe(state)) return;
    if (state.hover < 0 || state.picked == null) return;

    const ship = shipAt(xOf(state.hover), yOf(state.hover), state.picked, state.dir);
    const ok = canPlace(state.draft, ship);
    const node = document.createElement('div');
    // Корабль, вылезший за край, рисуем обрезанным по полю — иначе призрак
    // уезжает за рамку и вместо «сюда нельзя» показывает пустоту.
    node.className = `bs-ship bs-ghost ${ok ? 'is-ok' : 'is-bad'}`;
    node.style.cssText = shipStyle(clampShip(ship));
    layer.appendChild(node);
}

/** Обрезать корабль по краю поля — только для показа призрака. */
function clampShip(ship) {
    const len = ship.dir === ACROSS
        ? Math.min(ship.len, SIZE - ship.x)
        : Math.min(ship.len, SIZE - ship.y);
    return shipAt(ship.x, ship.y, Math.max(1, len), ship.dir);
}

async function sendFleet(state) {
    if (state.busy) return;
    const bad = fleetError(state.draft);
    if (bad) { flash(state, FLEET_ERROR_TEXT[bad] || 'Флот расставлен неверно'); return; }

    if (state.mode === 'bot') {
        applyMove(state.game, 0, { type: 'place', ships: state.draft });
        state.view = viewFor(state.game, 0);
        showBattle(state);
        // Первый выстрел мог достаться боту — тогда он и начинает.
        scheduleBot(state);
        return;
    }

    state.busy = true;
    renderSetup(state);
    try {
        const res = await state.ctx.apiFetch(`/api/battleship/game/${state.gameId}/fleet`, {
            method: 'POST',
            body: { ships: state.draft },
        });
        state.busy = false;
        if (openState !== state) return;
        if (res?.ok) { applyServer(state, res); startPolling(state); return; }
        flash(state, FLEET_ERROR_TEXT[res?.reason] || 'Сервер не принял флот');
        renderSetup(state);
    } catch {
        state.busy = false;
        if (openState === state) { flash(state, 'Сервер не ответил — попробуйте ещё раз'); renderSetup(state); }
    }
}

// ── Бой ──────────────────────────────────────────────────────────────────────

function bindBattle(state) {
    const modal = state.modal;
    modal.querySelector('#bs-grid-foe').onclick = e => {
        const cell = cellOf(e.target);
        if (cell >= 0) shoot(state, cell);
    };
    modal.querySelector('#bs-resign').onclick = () => resignNow(state);
    modal.querySelector('#bs-claim').onclick = () => claimNow(state);
}

function showBattle(state) {
    state.screen = 'battle';
    state.flash = '';
    state.modal.querySelector('#bs-lobby').classList.add('hidden');
    state.modal.querySelector('#bs-setup').classList.add('hidden');
    state.modal.querySelector('#bs-battle').classList.remove('hidden');
    state.modal.querySelector('#bs-over').classList.add('hidden');
    render(state);
}

/**
 * Выстрелить по чужому полю.
 *
 * С ботом партия живёт в браузере, и выстрел применяется на месте. С людьми —
 * уезжает на сервер, и оттуда возвращается НОВЫЙ ВИД: пересчитать его самим мы
 * не можем, потому что не знаем чужой расстановки.
 */
async function shoot(state, cell) {
    const view = state.view;
    if (!view || view.phase !== 'play' || state.busy) return;
    if (view.turn !== view.seat) { flash(state, 'Сейчас ход соперника'); return; }
    if (view.outgoing[cell] !== NONE) { flash(state, `В ${cellName(cell)} уже стреляли`); return; }

    if (state.mode === 'bot') {
        const done = applyMove(state.game, 0, { type: 'shot', cell });
        if (!done.ok) return;
        applyView(state, viewFor(state.game, 0));
        if (state.game.phase === 'over') { showOver(state); return; }
        scheduleBot(state);
        return;
    }

    state.busy = true;
    render(state);
    try {
        const res = await state.ctx.apiFetch(`/api/battleship/game/${state.gameId}/shot`, {
            method: 'POST',
            body: { seq: state.seq, cell },
        });
        state.busy = false;
        if (openState !== state) return;
        if (res?.ok) { applyServer(state, res); return; }
        // Сервер не принял выстрел: чаще всего это «партию уже закончили» или
        // двойная отправка. Спорить не с чем — перечитываем партию.
        flash(state, 'Сервер не принял выстрел — беру его поле');
        refresh(state, true);
    } catch {
        state.busy = false;
        if (openState === state) refresh(state, true);
    }
}

/**
 * Дать боту отстреляться — по одному выстрелу за раз с паузой.
 *
 * Пауза не для красоты: попал — стреляй ещё, и удачная серия бота случилась бы
 * между двумя кадрами. Игрок увидел бы половину своего флота потопленной и не
 * понял, что произошло.
 */
function scheduleBot(state) {
    if (state.mode !== 'bot' || !state.game) return;
    clearTimeout(state.botTimer);
    if (state.game.phase !== 'play') { showOver(state); return; }
    if (state.game.turn !== 1) return;

    const again = state.game.last?.seat === 1 && state.game.last?.hit;
    state.botTimer = setTimeout(() => {
        if (openState !== state || state.screen !== 'battle') return;
        const cell = pickShot(viewFor(state.game, 1), { level: state.botLevel });
        if (cell < 0 || !applyMove(state.game, 1, { type: 'shot', cell }).ok) {
            // Такого быть не должно (тест «бот всегда стреляет законно»), но
            // вставшую партию человеку показывать нельзя: пусть бот сдастся —
            // это честнее, чем поле, по которому больше никто не ходит.
            resignRules(state.game, 1);
            state.view = viewFor(state.game, 0);
            showOver(state);
            return;
        }
        applyView(state, viewFor(state.game, 0));
        if (openState !== state) return;
        if (state.game.phase === 'over') { showOver(state); return; }
        scheduleBot(state);
    }, again ? BOT_AGAIN_MS : BOT_THINK_MS);
}

async function resignNow(state) {
    // С ботом кнопки нет вовсе: сдаваться некому, а из партии выходят «в лобби».
    if (state.mode !== 'pvp' || !state.gameId) return;
    if (!confirm('Сдаться? Партия закончится поражением.')) return;
    try {
        const res = await state.ctx.apiFetch(`/api/battleship/game/${state.gameId}/resign`, { method: 'POST' });
        if (openState !== state) return;
        // На поле боя переезжает applyServer: он и так видит, что расстановка
        // кончилась (пусть и таким образом).
        if (res?.ok) applyServer(state, res);
    } catch {
        flash(state, 'Сервер не ответил — партия осталась как была');
    }
}

async function claimNow(state) {
    if (state.mode !== 'pvp' || !state.gameId) return;
    try {
        const res = await state.ctx.apiFetch(`/api/battleship/game/${state.gameId}/claim`, { method: 'POST' });
        if (openState !== state) return;
        if (res?.ok) applyServer(state, res);
        else flash(state, 'Забрать пока нельзя — соперник ещё в игре');
    } catch {
        flash(state, 'Сервер не ответил — попробуйте ещё раз');
    }
}

// ── Разговор с сервером ──────────────────────────────────────────────────────

function startPolling(state) {
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(() => {
        if (openState !== state || state.busy) return;
        if (state.screen !== 'setup' && state.screen !== 'battle') return;
        if (state.view?.phase === 'over') return;
        // В бою наш ход — сервер нам ничего нового не расскажет. В расстановке
        // спрашиваем всегда: соперник может нажать «Готов» в любой момент,
        // и это единственное, чего мы ждём.
        if (state.view?.phase === 'play' && state.view.turn === state.view.seat) return;
        refresh(state, false);
    }, POLL_GAME_MS);
}

async function refresh(state, force) {
    const id = state.gameId;
    if (!id) return;
    try {
        const res = await state.ctx.apiFetch(`/api/battleship/game/${id}?since=${force ? -1 : state.seq}`);
        if (openState !== state || state.gameId !== id) return;
        applyServer(state, res);
    } catch { /* следующий опрос попробует снова */ }
}

/** Принять то, что рассказал сервер. */
function applyServer(state, res) {
    if (!res) return;
    state.meta = res;
    state.players = res.players || state.players;
    state.seq = res.seq;
    if (res.seat != null && res.seat >= 0) state.seat = res.seat;
    // Ответ без вида — это «ничего не изменилось» (см. GET /game/:id): показывать
    // нечего, но кнопки и подсказка могли поменяться (например, партию стало
    // можно забрать).
    if (!res.view) { render(state); return; }

    const wasSetup = state.view?.phase === 'setup';
    applyView(state, res.view);
    // Расстановка кончилась — переезжаем на поля боя.
    if (wasSetup && res.view.phase !== 'setup') showBattle(state);
    if (res.status === 'done' || res.view.phase === 'over') showOver(state);
}

/**
 * Показать новый вид.
 *
 * Что изменилось, считаем РАЗНИЦЕЙ ДВУХ ВИДОВ, а не «мы только что выстрелили
 * туда-то»: с ботом ход известен, а с людьми с сервера приезжает позиция, и
 * рассказа о ней там нет. Разница же есть в обоих случаях и означает одно и то
 * же — вот эти клетки только что вспыхнули. За один опрос их может приехать
 * несколько: серия попаданий соперника — это несколько выстрелов подряд.
 */
function applyView(state, next) {
    const prev = state.view;
    state.fresh = prev ? changedCells(prev, next) : null;
    state.view = next;
    if (state.screen === 'setup' && next.phase === 'setup') { renderSetup(state); return; }
    render(state);
    shout(state, next);
}

function changedCells(prev, next) {
    const out = { my: [], foe: [] };
    for (let c = 0; c < CELLS; c++) {
        if (prev.incoming[c] !== next.incoming[c]) out.my.push(c);
        if (prev.outgoing[c] !== next.outgoing[c]) out.foe.push(c);
    }
    return out;
}

/**
 * Крупная надпись поверх полей: «Мимо», «Ранил», «Убил».
 *
 * Нужна ровно потому, что попадание и промах на клетке в четверть сантиметра
 * различаются значком, а исход выстрела — главное, что происходит за ход.
 * Подписываем и свой выстрел, и чужой: «Убил» на своём поле — это тоже событие.
 */
function shout(state, view) {
    const last = view.last;
    if (!last || view.phase === 'over') return;
    const mine = last.seat === view.seat;
    const word = last.sunk ? 'Убил' : last.hit ? 'Ранил' : 'Мимо';
    const box = state.modal.querySelector('#bs-shout');
    if (!box) return;
    box.textContent = `${mine ? '' : 'Соперник: '}${word}`;
    box.className = `bs-shout is-show${last.hit ? ' is-hit' : ''}${mine ? '' : ' is-foe'}`;
    clearTimeout(state.shoutTimer);
    state.shoutTimer = setTimeout(() => {
        if (openState !== state) return;
        box.className = 'bs-shout';
    }, SHOUT_MS);
}

/**
 * Короткое сообщение об отказе поверх подсказки. Подсказок в окне две — своя у
 * расстановки и своя у боя, — и flash сам выбирает нужную по текущему экрану:
 * звать его приходится из мест, которым про экран знать незачем.
 */
function flash(state, text) {
    clearTimeout(state.flashTimer);
    state.flash = text || '';
    state.flashTimer = setTimeout(() => {
        if (openState !== state) return;
        state.flash = '';
        showNote(state);
    }, 4000);
    showNote(state);
}

const showNote = state => (state.screen === 'setup' ? renderSetupNote(state) : renderNote(state));

// ── Отрисовка боя ────────────────────────────────────────────────────────────

function render(state) {
    if (state.screen !== 'battle' || !state.view) return;
    const view = state.view;
    const over = view.phase === 'over';

    // Своё поле: свои корабли и чужие выстрелы по ним.
    drawGrid(state, 'my', { marks: view.incoming, ships: view.fleet, fresh: state.fresh?.my });
    drawShips(state, 'my', { ships: view.fleet, shots: view.incoming });

    // Чужое: свои выстрелы и только ПОТОПЛЕННЫЕ чужие корабли. После конца
    // партии показываем и остальные — смотреть, где стояли ненайденные,
    // половина удовольствия, а испортить уже нечего.
    const foeShips = over && view.reveal ? view.reveal : view.sunk;
    drawGrid(state, 'foe', {
        marks: view.outgoing, ships: foeShips, fresh: state.fresh?.foe,
        aim: !over && view.turn === view.seat,
    });
    drawShips(state, 'foe', { ships: foeShips, shots: view.outgoing });

    state.modal.querySelector('#bs-my-left').textContent = `${view.myLeft} из ${FLEET.length}`;
    state.modal.querySelector('#bs-foe-left').textContent = `${enemyLeft(view).length} из ${FLEET.length}`;
    state.modal.querySelector('#bs-foe-name').textContent =
        state.players[1 - state.seat]?.name || 'Соперник';

    const claim = state.modal.querySelector('#bs-claim');
    claim.classList.toggle('hidden', !state.meta?.can_claim);
    state.modal.querySelector('#bs-resign').classList.toggle('hidden', over || state.mode !== 'pvp');
    renderNote(state);
}

function renderNote(state) {
    const box = state.modal.querySelector('#bs-note');
    if (!box) return;
    box.textContent = state.flash || hintFor(state);
    box.classList.toggle('is-flash', !!state.flash);
}

function hintFor(state) {
    const view = state.view;
    if (!view) return '';
    if (view.phase === 'over') return '';
    if (state.busy) return 'Отправляем выстрел…';
    if (view.turn === view.seat) return 'Ваш ход — стреляйте по полю соперника.';
    if (state.meta?.can_claim) return 'Соперник не ходит сутки — партию можно забрать себе.';
    return 'Ход соперника.';
}

// ── Поля ─────────────────────────────────────────────────────────────────────

/**
 * Сетка 10×10. Рисуем строкой разметки целиком, а не по клетке: за партию
 * поле перерисовывается сотню раз, и сто узлов сразу дешевле сотни точечных
 * правок с перерасчётом раскладки на каждой.
 */
function drawGrid(state, kind, { marks, ships = [], fresh, aim = false }) {
    const grid = state.modal.querySelector(`#bs-grid-${kind}`);
    if (!grid) return;
    // Клетки потопленных кораблей помечаем отдельно: «ранен» и «убит» надо
    // различать одним взглядом, а значок попадания у них был бы один.
    const dead = new Set();
    for (const ship of ships) {
        const cells = shipCells(ship) || [];
        if (marks && cells.length && cells.every(c => marks[c] === HIT)) for (const c of cells) dead.add(c);
    }
    const hot = new Set(fresh || []);

    let html = '';
    for (let c = 0; c < CELLS; c++) {
        const mark = marks ? marks[c] : NONE;
        const cls = ['bs-cell'];
        let inner = '';
        if (mark === MISS) { cls.push('is-miss'); inner = splashIcon(13); }
        else if (mark === HIT) {
            cls.push(dead.has(c) ? 'is-dead' : 'is-hit');
            inner = dead.has(c) ? wreckIcon(14) : blastIcon(14);
        }
        if (hot.has(c)) cls.push('is-fresh');
        html += `<div class="${cls.join(' ')}" data-cell="${c}" title="${cellName(c)}">${inner}</div>`;
    }
    grid.innerHTML = html;
    grid.classList.toggle('is-aim', aim);
}

/**
 * Слой кораблей: по одной скруглённой полосе на корабль (см. шапку — почему не
 * подкрашенными клетками).
 */
function drawShips(state, kind, { ships = [], shots = null }) {
    const layer = state.modal.querySelector(`#bs-ships-${kind}`);
    if (!layer) return;
    layer.innerHTML = ships.map(ship => {
        const cells = shipCells(ship) || [];
        const dead = shots && cells.length && cells.every(c => shots[c] === HIT);
        return `<div class="bs-ship${dead ? ' is-dead' : ''}" style="${shipStyle(ship)}"></div>`;
    }).join('');
}

/**
 * Где на поле стоит корабль. Считается в клетках и зазорах между ними, потому
 * что сетка нарисована зазором (gap), а не рамками: без учёта зазора корабль
 * уезжает от своих клеток тем сильнее, чем он длиннее.
 */
function shipStyle(ship) {
    const across = ship.dir === ACROSS;
    const span = n => `calc(${n} * var(--bs-cell) + ${n - 1} * var(--bs-gap))`;
    const at = n => `calc(${n} * (var(--bs-cell) + var(--bs-gap)))`;
    return `left:${at(ship.x)}; top:${at(ship.y)};`
        + `width:${span(across ? ship.len : 1)}; height:${span(across ? 1 : ship.len)};`;
}

const cellOf = (node) => {
    const cell = node?.closest?.('.bs-cell');
    return cell ? Number(cell.dataset.cell) : -1;
};

// ── Итог ─────────────────────────────────────────────────────────────────────

function showOver(state) {
    stopAll(state);
    if (state.screen !== 'battle') showBattle(state);
    render(state);
    const view = state.view;
    const won = view?.winner === view?.seat;
    const box = state.modal.querySelector('#bs-over');
    state.modal.querySelector('#bs-over-title').textContent = won ? 'Победа' : 'Поражение';
    // Причина словами: «сдался» и «не дождались хода» — это совсем не то же
    // самое, что честно потопленный флот, и в итоге это должно быть видно.
    state.modal.querySelector('#bs-over-sub').textContent =
        END_TEXT[view?.reason] || 'партия окончена';
    box.classList.remove('hidden');
}

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
