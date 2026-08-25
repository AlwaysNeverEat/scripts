// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Шашки» (русские) — окно игры, лобби с вызовами и таблица очков.
//
// Открывается ТОЛЬКО из меню игр (games.js), а оно — из поиска на главной:
// набрать «игры» и нажать Enter. Пока это слово набирают, поиск молчит.
//
// Правила целиком в shared/checkers.js — здесь ни строчки про то, что куда
// ходит и что через что бьётся. Этот файл рисует доску, слушает мышь и
// разговаривает с сервером.
//
// ОДНА КАРТИНКА НА ДВА РЕЖИМА: и партия с ботом, и партия с людьми рисуются из
// ПОЗИЦИИ — одного и того же объекта. С ботом он живёт здесь и меняется на
// месте, с людьми приезжает с сервера. Прятать в шашках нечего (доска на виду у
// обоих), поэтому вида на позицию, как в дураке и морском бое, тут нет вовсе —
// и отрисовке не приходится помнить, с кем играют.
//
// ПАРТИЯ С БОТОМ ЖИВЁТ ТОЛЬКО ЗДЕСЬ: сервер о ней не знает и в таблицу очков она
// не идёт. Иначе первое место занял бы не тот, кто обыгрывает людей, а тот, кто
// набил побед по Новичку.
//
// ХОД — ЭТО ОДИН ПРЫЖОК. Цепочка боя играется по шагам: кликнул, шашка
// перепрыгнула, ход остался у неё. Так же он и уезжает на сервер, и так же
// соперник видит цепочку — по одному прыжку, а не готовой доской с четырьмя
// пропавшими шашками.
//
// ДОСКА РАЗВОРАЧИВАЕТСЯ СВОИМ ЦВЕТОМ ВНИЗ. Играющий чёрными видит доску со своей
// стороны — как за настоящим столом. Разворот — единственное место, где в этом
// файле есть «чей ход» в отрисовке, и он считается ОДИН РАЗ на партию (flip),
// а не при каждом рисовании.
//
// ТЕКСТУРЫ КЛЕТОК ПОДКЛЮЧАЮТСЯ ПО ИМЕНИ ФАЙЛА, как арт карт в рогалике: положили
// frontend/src/assets/checkers/light.png и dark.png — и доска стала
// нарисованной, ничего не правя в коде. Файлов нет — клетки рисуются цветом, и
// это не поломка, а рабочее состояние (см. design/checkers-board/README.md).
//
// Картинки клеток НАТЯГИВАЮТСЯ на клетку целиком (background-size: 100% 100%), и
// это сделано нарочно: у нарисованных текстур светлая и тёмная клетки почти
// никогда не совпадают по размеру пиксель в пиксель, а доска, собранная из
// клеток разного размера, разъезжается. Растянутая на свою клетку картинка
// делает разницу в исходниках неважной.
//
// ШАШКИ — ТОЖЕ КАРТИНКИ, и это отличает их от шаров бильярда. Шару нужен НОМЕР,
// а нарисованный номер на кружке в двадцать пикселей не читается, поэтому там
// вёрстка. Шашке номер не нужен, зато нужна ТОЛЩИНА: дамка в русских шашках —
// это две шашки друг на друге, и на присланных картинках она так и нарисована.
// Такую разницу вёрсткой не подделать — кружок с короной поверх рядом не стоял.
//
// Файлов нет — рисуем кружки цветом с короной из icons.js. Это рабочее
// состояние, а не поломка: играть можно, всё видно.
// ─────────────────────────────────────────────────────────────────────────────

import {
    SIZE, CELLS, EMPTY, WHITE, BLACK, COLUMNS,
    xOf, yOf, at, isDark, cellName, colorOf, isKing, colorOfSeat,
    createGame, applyMove, legalMoves, movesFrom, mustCapture, counts,
    deserialize, serialize, resign as resignRules,
    END_TEXT, MOVE_ERROR_TEXT, COLOR_WHOM,
} from '../../shared/checkers.js';
import { pickMove, LEVELS, CLUB } from '../../shared/checkersBot.js';
import { crownIcon, drawIcon, surrenderIcon, turnIcon } from './icons.js';
import { namePrefixHtml } from './namePrefix.js';
import { profileRowAttrs, bindProfileRows } from './topProfile.js';

// Картинки доски — по имени файла, без таблицы соответствия (см. шапку).
// Шесть штук: две клетки и четыре шашки.
const SKIN = Object.fromEntries(
    Object.entries(import.meta.glob('./assets/checkers/*.{png,webp,jpg}', { eager: true, import: 'default' }))
        .map(([path, url]) => [path.split('/').pop().replace(/\.\w+$/, '').toLowerCase(), url]),
);
// Клетки и шашки включаются ПОРОЗНЬ: нарисованная доска с кружками из вёрстки
// выглядит странно, но работает, а вот половина шашек картинками, половина
// кружками — это уже сломанная игра. Поэтому у шашек проверяются все четыре.
const BOARD_SKIN = SKIN.light && SKIN.dark;
const PIECE_SKIN = SKIN['man-light'] && SKIN['man-dark'] && SKIN['king-light'] && SKIN['king-dark'];

const MODAL_ID = 'checkers-modal';

// Партия с ботом хранится под id аккаунта: за одним компьютером сидят по
// очереди, и чужая недоигранная партия в своём окне — худшее, что может
// случиться с пасхалкой.
const SAVE_KEY = 'cars_db_checkers';

// Как часто спрашиваем сервер. Полторы секунды в игре по очереди не заметны
// вовсе, а лобби можно опрашивать втрое реже — там меняется только список.
const POLL_GAME_MS = 1500;
const POLL_LOBBY_MS = 4500;

// Пауза перед ходом бота. Без неё он отыгрывает всю цепочку между двумя
// кадрами: игрок видит готовую доску и не понимает, что произошло. Продолжение
// цепочки — шагом покороче: это один его ход, а не новое решение.
const BOT_THINK_MS = 700;
const BOT_AGAIN_MS = 420;

// Сколько ждать, прежде чем подсветить шашки, которыми обязаны бить. Ровно как
// подсказка в тройке и маджонге: сначала человек ищет сам.
const HINT_MS = 8000;

let openState = null;   // одно окно за раз

/** Открыть игру. ctx: { apiFetch, user }. */
export function openCheckers(ctx) {
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
        screen: 'lobby',        // lobby | board
        mode: 'bot',            // bot | pvp
        game: null,             // партия с ботом — только здесь
        botLevel: CLUB,
        pos: null,              // позиция, которую рисуем
        seat: 0,
        color: WHITE,
        flip: false,
        meta: null,
        players: [],
        gameId: null,
        seq: 0,
        // Ввод
        picked: -1,             // выбранная шашка
        targets: [],            // куда ей можно
        nodes: new Map(),       // клетка → узел шашки (для показа хода)
        flash: '',
        flashTimer: 0,
        hintTimer: 0,
        hinting: false,
        busy: false,
        lobby: null,
        pollTimer: 0,
        botTimer: 0,
    };
    openState = state;

    const close = () => {
        // Партию с ботом запоминаем при закрытии: она живёт только в браузере, и
        // потерять её от случайного «✕» нельзя.
        saveBotGame(state);
        stopAll(state);
        document.removeEventListener('keydown', onKeyDown, true);
        modal.remove();
        document.body.classList.remove('modal-open');
        openState = null;
    };
    // Строка мини-топа ведёт в профиль, а профиль — обычная страница под окном:
    // чтобы её было видно, окно надо закрыть (см. topProfile.js).
    state.close = close;

    const onKeyDown = e => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        // С доски Escape возвращает в лобби, а не закрывает окно: партия с
        // людьми продолжает жить на сервере, и «выйти» из неё — не то же самое,
        // что закрыть игру.
        if (state.screen === 'lobby') close();
        else showLobby(state);
    };
    document.addEventListener('keydown', onKeyDown, true);

    modal.querySelector('.modal-backdrop').onclick = close;
    modal.querySelector('#ck-close').onclick = close;

    bindLobby(state);
    bindBoard(state);
    showLobby(state);
    return modal;
}

function shellHtml() {
    const levels = LEVELS.map(l =>
        `<button type="button" class="btn btn-sec ck-level" data-level="${l.id}">${l.name}</button>`).join('');

    return `
        <div class="modal-backdrop"></div>
        <div class="modal-win ck-win">
            <div class="modal-head">
                <span>Шашки</span>
                <button class="btn btn-sec" id="ck-close" title="Закрыть">✕</button>
            </div>

            <div class="ck-body">
                <!-- ── Лобби ── -->
                <div class="ck-lobby" id="ck-lobby">
                    <div class="ck-cols">
                        <section class="ck-box">
                            <h4>С ботом</h4>
                            <p class="ck-hint">Партия целиком в браузере — в таблицу очков не идёт.</p>
                            <div class="ck-levels">${levels}</div>
                            <p class="ck-hint">Новичок хватает всё, до чего дотянется, Любитель считает
                               размен до конца, Мастер — на пять ходов вперёд.</p>
                            <div class="ck-saved hidden" id="ck-saved"></div>
                        </section>

                        <section class="ck-box">
                            <h4>С людьми</h4>
                            <p class="ck-hint">Вызов висит в лобби, пока его не примут. Белые достаются жребию.</p>
                            <button type="button" class="btn btn-pri" id="ck-call">Бросить вызов</button>
                            <div class="ck-list" id="ck-open"></div>
                        </section>
                    </div>

                    <section class="ck-box ck-mine-box hidden" id="ck-mine-box">
                        <h4>Ваши партии</h4>
                        <div class="ck-list" id="ck-mine"></div>
                    </section>

                    <div class="ck-top" id="ck-top"></div>
                </div>

                <!-- ── Доска ── -->
                <div class="ck-play hidden" id="ck-play">
                    <div class="ck-hud">
                        <div class="ck-side" id="ck-foe"></div>
                        <div class="ck-side is-me" id="ck-me"></div>
                    </div>
                    <div class="ck-board" id="ck-board">
                        <div class="ck-files" id="ck-files"></div>
                        <div class="ck-ranks" id="ck-ranks"></div>
                        <div class="ck-plate">
                            <div class="ck-grid" id="ck-grid"></div>
                            <div class="ck-pieces" id="ck-pieces"></div>
                        </div>
                    </div>
                    <div class="ck-note" id="ck-note"></div>
                    <div class="ck-bar">
                        <button type="button" class="btn btn-sec" id="ck-claim">Забрать партию</button>
                        <span class="ck-bar-gap"></span>
                        <button type="button" class="btn btn-sec" id="ck-draw">${drawIcon(15)}<span>Ничья</span></button>
                        <button type="button" class="btn btn-sec" id="ck-resign">${surrenderIcon(15)}<span>Сдаться</span></button>
                        <button type="button" class="btn btn-sec" id="ck-to-lobby">В лобби</button>
                    </div>
                    <div class="ck-over hidden" id="ck-over">
                        <div class="ck-over-card">
                            <div class="ck-over-title" id="ck-over-title"></div>
                            <div class="ck-over-sub" id="ck-over-sub"></div>
                            <div class="ck-over-bar">
                                <button type="button" class="btn btn-sec" id="ck-again">${turnIcon(15)}<span>Ещё партию</span></button>
                                <button type="button" class="btn btn-pri" id="ck-over-back">В лобби</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
}

// ── Лобби ────────────────────────────────────────────────────────────────────

function bindLobby(state) {
    const modal = state.modal;
    modal.querySelectorAll('.ck-level').forEach(btn => {
        btn.onclick = () => startBotGame(state, btn.dataset.level);
    });
    modal.querySelector('#ck-call').onclick = () => createChallenge(state);
    // Именно #ck-to-lobby, а не #ck-lobby: последний — это САМ экран лобби, и
    // обработчик, повешенный на него, ловил бы всплывшие клики по всему, что в
    // нём лежит, включая кнопки уровней бота.
    modal.querySelector('#ck-to-lobby').onclick = () => showLobby(state);
    modal.querySelector('#ck-over-back').onclick = () => showLobby(state);
    modal.querySelector('#ck-again').onclick = () => startBotGame(state, state.botLevel);
}

function showLobby(state) {
    stopAll(state);
    saveBotGame(state);
    state.screen = 'lobby';
    state.gameId = null;
    state.game = null;
    state.pos = null;
    state.picked = -1;
    state.nodes.clear();
    state.modal.querySelector('#ck-lobby').classList.remove('hidden');
    state.modal.querySelector('#ck-play').classList.add('hidden');
    state.modal.querySelector('#ck-over').classList.add('hidden');
    renderSaved(state);
    loadLobby(state);
    state.pollTimer = setInterval(() => loadLobby(state), POLL_LOBBY_MS);
}

async function loadLobby(state) {
    try {
        const res = await state.ctx.apiFetch('/api/checkers/lobby');
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
    const openBox = state.modal.querySelector('#ck-open');
    const mineBox = state.modal.querySelector('#ck-mine');
    const mineCard = state.modal.querySelector('#ck-mine-box');
    const callBtn = state.modal.querySelector('#ck-call');

    if (data.offline) {
        openBox.innerHTML = '<div class="ck-empty">Сервер не ответил — с ботом сыграть можно, с людьми пока нет.</div>';
        mineCard.classList.add('hidden');
        state.modal.querySelector('#ck-top').innerHTML = '';
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
            ? '<span class="ck-row-tag">ждёт соперника</span>'
            : `<button type="button" class="btn btn-sec ck-row-btn" data-join="${g.id}">Принять</button>`;
        return `
            <div class="ck-row${mine ? ' is-mine' : ''}">
                <div class="ck-row-main">
                    <div class="ck-row-name">${who}</div>
                    <div class="ck-row-sub">вызов один на один</div>
                </div>
                ${action}
            </div>`;
    }).join('') || '<div class="ck-empty">Вызовов нет. Бросьте свой — его увидят все.</div>';
    openBox.querySelectorAll('[data-join]').forEach(b => { b.onclick = () => joinChallenge(state, b.dataset.join); });

    const mine = data.mine || [];
    mineCard.classList.toggle('hidden', !mine.length);
    mineBox.innerHTML = mine.map(g => {
        const foe = esc(g.players[1 - g.seat]?.name || 'Соперник');
        const tag = g.my_turn ? 'ваш ход' : (g.can_claim ? 'соперник пропал' : 'ход соперника');
        // Цвет и счёт на доске в строке — не украшение: вернувшись к отложенной
        // партии, первым делом вспоминают, за кого играют и как там дела.
        const side = g.color == null ? '' : ` · играете ${COLOR_WHOM[g.color]}`;
        const left = g.left && g.color != null
            ? ` · ${g.left[g.color]} : ${g.left[1 - g.color]}`
            : '';
        return `
            <div class="ck-row">
                <div class="ck-row-main">
                    <div class="ck-row-name">${foe}</div>
                    <div class="ck-row-sub"><span class="ck-row-tag${g.my_turn ? ' is-turn' : ''}">${tag}</span>${side}${left}</div>
                </div>
                <button type="button" class="btn btn-sec ck-row-btn" data-resume="${g.id}">Открыть</button>
            </div>`;
    }).join('');
    mineBox.querySelectorAll('[data-resume]').forEach(b => { b.onclick = () => resumeGame(state, b.dataset.resume); });

    renderTop(state, data.top);
}

function renderTop(state, top) {
    const box = state.modal.querySelector('#ck-top');
    if (!box) return;
    const rows = top?.rows || [];
    if (!rows.length) {
        box.innerHTML = '<div class="ck-top-head">Таблица</div>'
            + '<div class="ck-empty">Никто ещё не выигрывал — первое очко будет вашим.</div>';
        return;
    }
    const meId = state.ctx.user?.id;
    const list = rows.map(row => `
        <div class="ck-top-row${row.id === meId ? ' is-me' : ''}${row.rank === 1 ? ' is-first' : ''}"${profileRowAttrs(row)}>
            <span class="ck-top-rank">${row.rank}</span>
            <div class="ck-top-avatar">${row.avatar
                ? `<img src="${esc(row.avatar)}" alt=""/>`
                : '<span class="top-avatar-default"></span>'}</div>
            <div class="ck-top-name">${namePrefixHtml(row)}${esc(row.display_name)}</div>
            <span class="ck-top-score">${row.wins}<span class="ck-top-rest"> / ${row.draws} / ${row.losses}</span></span>
        </div>`).join('');

    const me = top.me;
    const inList = rows.some(r => r.id === meId);
    const mine = me && !inList
        ? `<div class="ck-top-row is-me is-mine-extra">
               <span class="ck-top-rank">${me.rank}</span>
               <div class="ck-top-name">Ваши очки</div>
               <span class="ck-top-score">${me.wins}<span class="ck-top-rest"> / ${me.draws} / ${me.losses}</span></span>
           </div>`
        : '';

    // Подпись объясняет второе и третье число: «12 / 3 / 4» без пояснения
    // читается как счёт партии, а это победы, ничьи и поражения. Ничьи место в
    // таблице не двигают — иначе выгодно было бы разменивать до голых дамок.
    box.innerHTML = '<div class="ck-top-head">Таблица — победы / ничьи / поражения</div>'
        + `<div class="ck-top-list">${list}</div>${mine}`;
    bindProfileRows(box, state.close);
}

// ── Вызовы ───────────────────────────────────────────────────────────────────

async function createChallenge(state) {
    if (state.busy) return;
    state.busy = true;
    try {
        await state.ctx.apiFetch('/api/checkers/challenge', { method: 'POST' });
        loadLobby(state);
    } catch { /* лобби перечитается само на следующем опросе */ }
    state.busy = false;
}

async function joinChallenge(state, id) {
    if (state.busy) return;
    state.busy = true;
    try {
        const res = await state.ctx.apiFetch(`/api/checkers/challenge/${id}/join`, { method: 'POST' });
        state.busy = false;
        // Садимся за партию по тому id, который назвал СЕРВЕР. Сейчас он тот же,
        // что у вызова (принять — это дописать себя в ту же строку), но верить в
        // это на клиенте нельзя: id партии знает сервер, а не мы.
        if (res?.ok) { resumeGame(state, res.id || id); return; }
        loadLobby(state);
    } catch { /* см. выше */ }
    state.busy = false;
}

async function cancelChallenge(state, id) {
    if (state.busy) return;
    state.busy = true;
    try {
        await state.ctx.apiFetch(`/api/checkers/challenge/${id}`, { method: 'DELETE' });
        loadLobby(state);
    } catch { /* см. выше */ }
    state.busy = false;
}

// ── Начало партий ────────────────────────────────────────────────────────────

function startBotGame(state, level, saved = null) {
    stopAll(state);
    state.mode = 'bot';
    state.botLevel = level || CLUB;
    state.gameId = null;
    state.seq = 0;
    state.meta = null;
    state.game = saved ? deserialize(saved) : createGame({});
    state.pos = state.game;
    // Место 0 всегда наше: за доской с ботом мест не выбирают, а цвет достаётся
    // жребием — тем же, что и в партии с людьми.
    state.seat = 0;
    state.color = colorOfSeat(state.pos, 0);

    const botName = LEVELS.find(l => l.id === state.botLevel)?.name || 'Бот';
    state.players = [
        { id: state.ctx.user?.id, name: state.ctx.user?.display_name || 'Вы' },
        { id: null, name: botName },
    ];
    showBoard(state);
    saveBotGame(state);
    scheduleBot(state);
}

/** Сесть за партию, которая живёт на сервере. */
async function resumeGame(state, id) {
    try {
        const res = await state.ctx.apiFetch(`/api/checkers/game/${id}`);
        if (openState !== state || !res?.state) return;
        stopAll(state);
        state.mode = 'pvp';
        state.game = null;
        state.gameId = id;
        state.seat = res.seat;
        state.meta = res;
        state.players = res.players || state.players;
        state.seq = res.seq;
        state.pos = deserialize(res.state);
        state.color = colorOfSeat(state.pos, res.seat);

        showBoard(state);
        if (res.status === 'done' || state.pos.phase === 'over') { showOver(state); return; }
        startPolling(state);
    } catch {
        flash(state, 'Не удалось открыть партию — попробуйте ещё раз');
    }
}

function stopAll(state) {
    clearInterval(state.pollTimer);
    clearTimeout(state.botTimer);
    clearTimeout(state.flashTimer);
    clearTimeout(state.hintTimer);
    state.pollTimer = 0;
    state.botTimer = 0;
    state.hintTimer = 0;
    state.hinting = false;
    state.busy = false;
}

// ── Отложенная партия с ботом ────────────────────────────────────────────────
// Партия с людьми живёт на сервере и никуда не девается, а с ботом — только в
// этом браузере. Забег в рогалике сохраняют по той же причине: играют его
// дольше, чем длится «сейчас закрою и вернусь».

const saveKeyOf = state => `${SAVE_KEY}:${state.ctx.user?.id || 'guest'}`;

function saveBotGame(state) {
    // Партии с ботом сейчас нет вовсе (открыли окно, играем с людьми) — значит,
    // и сказать про неё нечего. Трогать хранилище тут нельзя: раньше эта же
    // строчка стирала отложенную партию каждый раз, когда окно открывали.
    if (state.mode !== 'bot' || !state.game) return;
    try {
        const key = saveKeyOf(state);
        // Доигранную не храним: «продолжить» в ней нечего.
        if (state.game.phase !== 'play') localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify({ level: state.botLevel, pos: serialize(state.game) }));
    } catch { /* приватный режим и переполненное хранилище — не повод ломать игру */ }
}

function readBotGame(state) {
    try {
        const raw = localStorage.getItem(saveKeyOf(state));
        if (!raw) return null;
        const data = JSON.parse(raw);
        return data?.pos ? data : null;
    } catch { return null; }
}

function renderSaved(state) {
    const box = state.modal.querySelector('#ck-saved');
    if (!box) return;
    const saved = readBotGame(state);
    box.classList.toggle('hidden', !saved);
    if (!saved) return;
    const level = LEVELS.find(l => l.id === saved.level)?.whom || 'ботом';
    const left = counts(deserialize(saved.pos)).map(s => s.men + s.kings);
    box.innerHTML = `
        <button type="button" class="btn btn-sec" id="ck-resume-bot">Продолжить с ${esc(level)}</button>
        <span class="ck-hint">на доске ${left[WHITE]} : ${left[BLACK]}</span>`;
    box.querySelector('#ck-resume-bot').onclick = () => startBotGame(state, saved.level, saved.pos);
}

// ── Доска ────────────────────────────────────────────────────────────────────

function bindBoard(state) {
    const modal = state.modal;
    modal.querySelector('#ck-grid').onclick = e => {
        const cell = cellOf(e.target);
        if (cell >= 0) onCellClick(state, cell);
    };
    modal.querySelector('#ck-resign').onclick = () => resignNow(state);
    modal.querySelector('#ck-draw').onclick = () => drawNow(state);
    modal.querySelector('#ck-claim').onclick = () => claimNow(state);
}

function showBoard(state) {
    state.screen = 'board';
    state.flash = '';
    state.picked = -1;
    state.targets = [];
    // Слой шашек чистим вместе с картой узлов: карта — это только «кто где», а
    // сами узлы остаются в разметке, и от прошлой партии на доске оставались
    // лишние шашки.
    state.nodes.clear();
    state.modal.querySelector('#ck-pieces').innerHTML = '';
    // Доска разворачивается своим цветом вниз — как за настоящим столом.
    // Считается один раз на партию: цвет за партию не меняется.
    state.flip = state.color === BLACK;
    state.modal.querySelector('#ck-lobby').classList.add('hidden');
    state.modal.querySelector('#ck-play').classList.remove('hidden');
    state.modal.querySelector('#ck-over').classList.add('hidden');
    drawGrid(state);
    render(state);
}

/** Место клетки на экране: с разворотом или без. */
const viewX = (state, cell) => (state.flip ? SIZE - 1 - xOf(cell) : xOf(cell));
const viewY = (state, cell) => (state.flip ? SIZE - 1 - yOf(cell) : yOf(cell));

/**
 * Сетка и подписи. Рисуются ОДИН РАЗ на партию и потом не трогаются: за партию
 * доска перерисовывается сотню раз, а клетки и буквы не меняются — меняются
 * только классы на них и слой шашек.
 */
function drawGrid(state) {
    const grid = state.modal.querySelector('#ck-grid');
    let html = '';
    for (let vy = 0; vy < SIZE; vy++) {
        for (let vx = 0; vx < SIZE; vx++) {
            const cell = state.flip ? at(SIZE - 1 - vx, SIZE - 1 - vy) : at(vx, vy);
            const dark = isDark(cell);
            html += `<div class="ck-sq ${dark ? 'is-dark' : 'is-light'}"`
                + (dark ? ` data-cell="${cell}" title="${cellName(cell)}"` : '')
                + '></div>';
        }
    }
    grid.innerHTML = html;

    const files = [...COLUMNS];
    const ranks = Array.from({ length: SIZE }, (_, i) => SIZE - i);
    if (state.flip) { files.reverse(); ranks.reverse(); }
    state.modal.querySelector('#ck-files').innerHTML = files.map(c => `<i>${c}</i>`).join('');
    state.modal.querySelector('#ck-ranks').innerHTML = ranks.map(n => `<i>${n}</i>`).join('');

    // Картинки вешаем на саму доску переменными: файлов нет — переменные не
    // заводятся, и CSS рисует клетки цветом, а шашки кружками (см. шапку).
    const board = state.modal.querySelector('#ck-board');
    for (const [name, url] of Object.entries(SKIN)) {
        board.style.setProperty(`--ck-skin-${name}`, `url(${url})`);
    }
    board.classList.toggle('has-board', !!BOARD_SKIN);
    board.classList.toggle('has-pieces', !!PIECE_SKIN);
}

/**
 * Показать позицию.
 *
 * Шашки — ПЕРЕЖИВАЮЩИЕ ПЕРЕРИСОВКУ УЗЛЫ, а не строка разметки: узел, который
 * остался тем же и только сменил место, CSS довозит до него плавно, и ход видно.
 * Поэтому здесь не innerHTML, а разбор «кто куда переехал»: шашку с last.from
 * переносим на last.to тем же узлом, съеденных гасим и убираем.
 */
function render(state) {
    if (state.screen !== 'board' || !state.pos) return;
    const pos = state.pos;
    const layer = state.modal.querySelector('#ck-pieces');
    const last = pos.last;

    // Ход соперника: тот же узел переезжает на новое место — иначе шашка
    // мигнёт и окажется на другом конце доски без движения.
    if (last && state.nodes.has(last.from) && !state.nodes.has(last.to)) {
        const node = state.nodes.get(last.from);
        state.nodes.delete(last.from);
        state.nodes.set(last.to, node);
    }

    const doomed = new Set(pos.captured);
    for (let cell = 0; cell < CELLS; cell++) {
        const piece = pos.board[cell];
        let node = state.nodes.get(cell);
        if (piece === EMPTY) {
            if (node) { fadeOut(state, cell, node); }
            continue;
        }
        if (!node) {
            node = document.createElement('div');
            layer.appendChild(node);
            state.nodes.set(cell, node);
        }
        const color = colorOf(piece);
        node.className = 'ck-piece'
            + (color === WHITE ? ' is-white' : ' is-black')
            + (isKing(piece) ? ' is-king' : ' is-man')
            + (doomed.has(cell) ? ' is-doomed' : '')
            + (cell === state.picked ? ' is-picked' : '');
        // Корона нужна ТОЛЬКО кружкам из вёрстки: у нарисованной дамки сверху
        // вторая шашка, и корона поверх неё была бы вторым знаком одного и того
        // же. Рисуем один раз: перекладывать SVG на каждую перерисовку незачем.
        const crown = !PIECE_SKIN && isKing(piece);
        if (crown !== (node.dataset.king === '1')) {
            node.innerHTML = crown ? crownIcon(15) : '';
            node.dataset.king = crown ? '1' : '0';
        }
        node.style.left = `calc(var(--ck-cell) * ${viewX(state, cell)})`;
        node.style.top = `calc(var(--ck-cell) * ${viewY(state, cell)})`;
    }

    markSquares(state);
    renderHud(state);
    renderNote(state);
    renderBar(state);
}

/**
 * Убрать съеденную шашку.
 *
 * Не сразу: узел ещё кадр живёт с классом is-gone и гаснет. Пропавшая без следа
 * шашка на доске из шестидесяти четырёх клеток просто не замечается — а это
 * главное, что случилось за ход.
 */
function fadeOut(state, cell, node) {
    state.nodes.delete(cell);
    node.classList.add('is-gone');
    setTimeout(() => node.remove(), 260);
}

/**
 * Пометки на клетках: выбор, куда можно пойти, откуда и куда сходили, подсказка.
 *
 * ВСЕ они живут на КЛЕТКЕ, а не на шашке, и это не мелочь: шашка — картинка с
 * прозрачными углами, и рамка вокруг неё обвела бы квадрат, а не кружок. У клетки
 * же форма как раз квадратная, и подсветка ложится ровно.
 */
function markSquares(state) {
    const grid = state.modal.querySelector('#ck-grid');
    const last = state.pos?.last;
    const hints = state.hinting ? (state.hintCells || []) : [];
    grid.querySelectorAll('.ck-sq.is-dark').forEach(node => {
        const cell = Number(node.dataset.cell);
        node.classList.toggle('is-target', state.targets.includes(cell));
        node.classList.toggle('is-sel', state.picked === cell);
        node.classList.toggle('is-hint', hints.includes(cell));
        node.classList.toggle('is-from', !!last && last.from === cell);
        node.classList.toggle('is-to', !!last && last.to === cell);
    });
}

function renderHud(state) {
    const pos = state.pos;
    const left = counts(pos);
    const mine = state.color;
    const foe = 1 - mine;
    const side = (seat, color, box) => {
        const name = state.players[seat]?.name || (seat === state.seat ? 'Вы' : 'Соперник');
        const turn = pos.phase === 'play' && pos.turn === color;
        box.className = `ck-side${seat === state.seat ? ' is-me' : ''}${turn ? ' is-turn' : ''}`;
        box.innerHTML = `
            <span class="ck-chip ${color === WHITE ? 'is-white' : 'is-black'}"></span>
            <span class="ck-side-name">${esc(name)}</span>
            <b class="ck-side-left">${left[color].men + left[color].kings}</b>
            ${left[color].kings ? `<span class="ck-side-kings">${crownIcon(12)}${left[color].kings}</span>` : ''}`;
    };
    side(1 - state.seat, foe, state.modal.querySelector('#ck-foe'));
    side(state.seat, mine, state.modal.querySelector('#ck-me'));
}

function renderNote(state) {
    const box = state.modal.querySelector('#ck-note');
    if (!box) return;
    box.textContent = state.flash || hintFor(state);
    box.classList.toggle('is-flash', !!state.flash);
}

function hintFor(state) {
    const pos = state.pos;
    if (!pos || pos.phase === 'over') return '';
    if (state.busy) return 'Отправляем ход…';
    const offer = state.meta?.draw_offer;
    if (offer != null && offer !== state.seat) return 'Соперник предлагает ничью — «Ничья», чтобы согласиться.';
    if (offer === state.seat) return 'Вы предложили ничью. Ход это предложение снимет.';
    if (pos.turn !== state.color) return 'Ход соперника.';
    if (pos.chain >= 0) return 'Бой продолжается — этой же шашкой.';
    if (mustCapture(pos)) return 'Бить обязательно.';
    if (state.meta?.can_claim) return 'Соперник не ходит сутки — партию можно забрать себе.';
    return 'Ваш ход.';
}

function renderBar(state) {
    const pos = state.pos;
    const over = !pos || pos.phase === 'over';
    const pvp = state.mode === 'pvp';
    state.modal.querySelector('#ck-claim').classList.toggle('hidden', !state.meta?.can_claim);
    // С ботом сдаваться и предлагать ничью некому: из партии выходят «в лобби».
    state.modal.querySelector('#ck-resign').classList.toggle('hidden', over || !pvp);
    const draw = state.modal.querySelector('#ck-draw');
    draw.classList.toggle('hidden', over || !pvp);
    const offer = state.meta?.draw_offer;
    draw.querySelector('span').textContent = offer == null
        ? 'Ничья'
        : (offer === state.seat ? 'Отозвать ничью' : 'Принять ничью');
    state.modal.querySelector('#ck-again').classList.toggle('hidden', pvp);
}

// ── Ввод ─────────────────────────────────────────────────────────────────────

/**
 * Клик по клетке.
 *
 * Смыслов у него два, и путаницы между ними нет: по своей шашке — выбрать её,
 * по подсвеченной клетке — сходить. Кликом по другой своей шашке выбор
 * переносится: передумать посреди хода — обычное дело, и стоить это должно
 * одного клика.
 */
function onCellClick(state, cell) {
    const pos = state.pos;
    if (!pos || pos.phase !== 'play' || state.busy) return;
    if (pos.turn !== state.color) { flash(state, 'Сейчас ход соперника'); return; }

    if (state.targets.includes(cell)) { play(state, state.picked, cell); return; }

    const piece = pos.board[cell];
    if (piece === EMPTY || colorOf(piece) !== state.color) {
        // Клик по пустому месту снимает выбор — это тише, чем ругаться.
        if (state.picked >= 0) { select(state, -1); return; }
        return;
    }

    const moves = movesFrom(pos, cell);
    if (!moves.length) {
        // Самая частая обида новичка: «почему эта шашка не ходит». Отвечаем
        // причиной, а не отказом.
        flash(state, pos.chain >= 0
            ? 'Бой не окончен — ходить можно только той шашкой, что бьёт'
            : (mustCapture(pos) ? 'Бить обязательно — ходить можно только той шашкой, что бьёт' : 'Этой шашке некуда идти'));
        return;
    }
    select(state, cell);
}

function select(state, cell) {
    state.picked = cell;
    state.targets = cell < 0 ? [] : movesFrom(state.pos, cell).map(m => m.to);
    render(state);
}

/** Сыграть один прыжок: с ботом — на месте, с людьми — через сервер. */
async function play(state, from, to) {
    if (state.mode === 'bot') {
        const done = applyMove(state.game, state.color, { from, to });
        if (!done.ok) { flash(state, MOVE_ERROR_TEXT[done.reason] || 'Так пойти нельзя'); return; }
        afterMove(state, done.again ? state.game.chain : -1);
        saveBotGame(state);
        if (state.game.phase === 'over') { showOver(state); return; }
        scheduleBot(state);
        return;
    }

    state.busy = true;
    select(state, -1);
    try {
        const res = await state.ctx.apiFetch(`/api/checkers/game/${state.gameId}/move`, {
            method: 'POST',
            body: { seq: state.seq, from, to },
        });
        state.busy = false;
        if (openState !== state) return;
        if (res?.ok) { applyServer(state, res); return; }
        // Сервер не принял ход: чаще всего это «партию уже закончили» или
        // двойная отправка. Спорить не с чем — перечитываем партию.
        flash(state, MOVE_ERROR_TEXT[res?.reason] || 'Сервер не принял ход — беру его доску');
        refresh(state, true);
    } catch {
        state.busy = false;
        if (openState === state) refresh(state, true);
    }
}

/**
 * После своего хода: если цепочка продолжается, шашка остаётся выбранной сама.
 * Искать её глазами и кликать заново, когда ходить всё равно можно только ею, —
 * лишняя работа.
 */
function afterMove(state, chain) {
    // Жалоба «так ходить нельзя» после сделанного хода уже неправда — гасим её,
    // не дожидаясь, пока она сама истечёт.
    clearTimeout(state.flashTimer);
    state.flash = '';
    if (chain >= 0) select(state, chain);
    else select(state, -1);
    armHint(state);
}

function scheduleBot(state) {
    if (state.mode !== 'bot' || !state.game) return;
    clearTimeout(state.botTimer);
    if (state.game.phase !== 'play') { showOver(state); return; }
    if (state.game.turn === state.color) { armHint(state); return; }

    const again = state.game.chain >= 0;
    state.botTimer = setTimeout(() => {
        if (openState !== state || state.screen !== 'board') return;
        const hop = pickMove(state.game, { level: state.botLevel });
        if (!hop || !applyMove(state.game, state.game.turn, hop).ok) {
            // Такого быть не должно (тест «бот ходит только законным»), но
            // вставшую партию человеку показывать нельзя: пусть бот сдастся —
            // это честнее, чем доска, по которой больше никто не ходит.
            resignRules(state.game, state.game.turn);
            render(state);
            showOver(state);
            return;
        }
        render(state);
        saveBotGame(state);
        if (state.game.phase === 'over') { showOver(state); return; }
        scheduleBot(state);
    }, again ? BOT_AGAIN_MS : BOT_THINK_MS);
}

/**
 * Подсказка через восемь секунд простоя — ровно как в тройке и маджонге: сначала
 * человек ищет сам. Подсвечиваем только тогда, когда бой ОБЯЗАТЕЛЕН: это
 * единственное место в шашках, где новичок честно не понимает, почему шашка не
 * ходит. «Куда пойти» не подсказываем никогда — это и есть игра.
 */
function armHint(state) {
    clearTimeout(state.hintTimer);
    state.hinting = false;
    state.hintCells = [];
    const pos = state.pos;
    if (!pos || pos.phase !== 'play' || pos.turn !== state.color || !mustCapture(pos)) return;
    state.hintTimer = setTimeout(() => {
        if (openState !== state || state.screen !== 'board') return;
        state.hinting = true;
        state.hintCells = [...new Set(legalMoves(state.pos).map(m => m.from))];
        render(state);
    }, HINT_MS);
}

// ── Кнопки партии ────────────────────────────────────────────────────────────

async function resignNow(state) {
    if (state.mode !== 'pvp' || !state.gameId) return;
    if (!confirm('Сдаться? Партия закончится поражением.')) return;
    try {
        const res = await state.ctx.apiFetch(`/api/checkers/game/${state.gameId}/resign`, { method: 'POST' });
        if (openState !== state) return;
        if (res?.ok) applyServer(state, res);
    } catch {
        flash(state, 'Сервер не ответил — партия осталась как была');
    }
}

async function drawNow(state) {
    if (state.mode !== 'pvp' || !state.gameId) return;
    const mine = state.meta?.draw_offer === state.seat;
    try {
        const res = await state.ctx.apiFetch(`/api/checkers/game/${state.gameId}/draw`, {
            method: mine ? 'DELETE' : 'POST',
        });
        if (openState !== state) return;
        if (res?.ok) applyServer(state, res);
        else flash(state, 'Не вышло — партия уже кончилась');
    } catch {
        flash(state, 'Сервер не ответил — попробуйте ещё раз');
    }
}

async function claimNow(state) {
    if (state.mode !== 'pvp' || !state.gameId) return;
    try {
        const res = await state.ctx.apiFetch(`/api/checkers/game/${state.gameId}/claim`, { method: 'POST' });
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
        if (state.screen !== 'board') return;
        if (state.pos?.phase === 'over') return;
        // Наш ход — сервер нам ничего нового не расскажет. Кроме одного:
        // соперник мог предложить ничью, и это стоит увидеть, не дожидаясь
        // своего хода. Поэтому опрашиваем всегда, просто коротким запросом.
        refresh(state, false);
    }, POLL_GAME_MS);
}

async function refresh(state, force) {
    const id = state.gameId;
    if (!id) return;
    try {
        const res = await state.ctx.apiFetch(`/api/checkers/game/${id}?since=${force ? -1 : state.seq}`);
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

    // Ответ без позиции — это «ничего не изменилось» (см. GET /game/:id):
    // показывать нечего, но кнопки и подсказка могли поменяться (предложена
    // ничья, партию стало можно забрать).
    if (!res.state) { renderNote(state); renderBar(state); return; }

    state.pos = deserialize(res.state);
    state.color = colorOfSeat(state.pos, state.seat);
    // Ход мог остаться нашим (цепочка) — тогда шашка выбирается сама.
    const chain = state.pos.turn === state.color && state.pos.chain >= 0 ? state.pos.chain : -1;
    afterMove(state, chain);
    render(state);
    if (res.status === 'done' || state.pos.phase === 'over') showOver(state);
}

/** Короткое сообщение об отказе поверх подсказки. */
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

// ── Итог ─────────────────────────────────────────────────────────────────────

function showOver(state) {
    stopAll(state);
    saveBotGame(state);
    render(state);
    const pos = state.pos;
    const draw = pos?.winner == null;
    const won = !draw && pos.winner === state.color;
    state.modal.querySelector('#ck-over-title').textContent = draw ? 'Ничья' : (won ? 'Победа' : 'Поражение');
    // Причина словами: «сдался» и «не дождались хода» — совсем не то же самое,
    // что честно съеденные шашки, и в итоге это должно быть видно.
    state.modal.querySelector('#ck-over-sub').textContent = END_TEXT[pos?.reason] || 'партия окончена';
    state.modal.querySelector('#ck-over').classList.remove('hidden');
    renderBar(state);
}

const cellOf = (node) => {
    const cell = node?.closest?.('.ck-sq');
    return cell?.dataset.cell == null ? -1 : Number(cell.dataset.cell);
};

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
