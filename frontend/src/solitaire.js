// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Пасьянс» (косынка) — окно игры и мини-топ по времени.
//
// Открывается ТОЛЬКО из меню игр (games.js), а оно — из поиска на главной:
// набрать «игры» и нажать Enter. Пока это слово набирают, поиск молчит.
//
// Правила целиком в shared/solitaire.js — здесь ни строчки про то, что куда
// ложится. Этот файл делает три вещи: рисует стол, слушает мышь и один раз в
// конце разложенной партии относит время на сервер (backend/routes/solitaire.js).
//
// КАРТЫ — ОДНА КАРТИНКА НА ВСЮ КОЛОДУ (assets/cards-8bit.png, сетка 13×4), и у
// карт в ней нарисован ТОЛЬКО ВЕРХНИЙ СЛОЙ: номинал и масть на прозрачном фоне.
// Подложку — белый прямоугольник со скруглением и рамкой — рисует CSS, картинка
// ложится поверх. Так лист не пришлось резать на 52 файла (это 52 запроса при
// открытии окна), а подложка тянется под любой размер карты. Рубашка — своим
// файлом (assets/card-back.png, одна клетка из листа «оборотов»): она одна на
// всю игру, и держать ради неё второй спрайт незачем.
//
// ДВА СПОСОБА ХОДИТЬ, и оба нужны. Клик отправляет карту туда, где ей место
// (сначала база, потом стол) — это 90% ходов в косынке, и делать их мышью
// утомительно. Перетаскивание нужно там, где мест несколько и выбирает человек;
// поэтому же клик никогда не кладёт карту в пустой столбец, кроме короля,
// которому больше некуда, — «уехало в пустоту» самый обидный случайный ход.
//
// СТОЛ ПЕРЕРИСОВЫВАЕТСЯ ЦЕЛИКОМ на каждый ход, и это осознанно: 52 узла и
// несколько ходов в секунду — против сотен обновлений в секунду в тетрисе и
// тройке, где точечная отрисовка и правда нужна. Зато нет ни одной строчки,
// которая переставляет карту в DOM руками.
//
// СЕКУНДОМЕР идёт, только пока играют: он не заводится, пока не сделан первый
// ход, встаёт на свёрнутой вкладке и на закрытом окне (партия при этом
// сохраняется и открывается заново с того же места). И он ОСТАНАВЛИВАЕТСЯ,
// когда нажали «Сложить»: партия, в которой не осталось закрытых карт, уже
// выиграна, а автосбор — это полминуты показа, за которые человек не играет.
// ─────────────────────────────────────────────────────────────────────────────

import {
    createGame, move, draw, taken, canDrop, autoTarget, autoStep, canAutoFinish,
    hasMove, tick, topCard, isFaceUp,
    spriteCol, spriteRow, cardLabel,
    SUITS, SUIT_LABEL, PILES, RANKS, STOCK, WASTE, TABLEAU, FOUNDATION,
} from '../../shared/solitaire.js';
import deckSheet from './assets/cards-8bit.png';
import cardBack from './assets/card-back.png';

const MODAL_ID = 'solitaire-modal';

// С какого смещения жест считается «тянут карту», а не «ткнули». Меньше десятка
// пикселей — и обычный клик пальцем превращается в перетаскивание.
const DRAG_PX = 8;

// Пауза между картами автосбора: меньше — карты слипаются в мельтешение,
// больше — победа превращается в ожидание.
const AUTO_MS = 70;

// Сколько шагов помещается в столбец, считая шагом сдвиг открытой карты.
// Столбцы длиннее ужимаются (см. renderPiles): в косынке в столбце бывает до
// девятнадцати карт, и без этого нижние уезжали бы за край стола.
const PILE_UNITS = 11;
// Закрытая карта сдвигается меньше открытой: у неё нечего показывать, кроме
// того, что она есть.
const DOWN_UNIT = 0.5;

let openState = null;   // одно окно за раз
let saved = null;       // недоигранная партия: окно закрыли, но раздача жива

/** Открыть игру. ctx: { apiFetch, user }. */
export function openSolitaire(ctx) {
    if (openState) return openState.modal;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'modal';
    modal.innerHTML = shellHtml();
    // Пути к картинкам знает сборщик (он их хэширует), а нужны они в CSS —
    // поэтому кладём их переменными на само окно, а не прописываем в style.css.
    const win = modal.querySelector('.sol-win');
    win.style.setProperty('--sol-sheet', `url(${deckSheet})`);
    win.style.setProperty('--sol-back', `url(${cardBack})`);
    document.body.appendChild(modal);
    document.body.classList.add('modal-open');

    const state = {
        ctx,
        modal,
        game: saved || createGame(),
        drag: null,        // { from, cards, dx, dy, moved, ghost }
        // Секундомер заводится первым ходом: окно можно открыть и посмотреть на
        // топ, не начав партию.
        started: false,
        raf: 0,
        last: 0,
        autoTimer: 0,
        finished: false,
        shownSecs: -1,
        top: null,
        topFailed: false,
        sending: false,
    };
    openState = state;
    saved = null;

    const close = () => {
        stopLoop(state);
        clearTimeout(state.autoTimer);
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('visibilitychange', onHide);
        // Недоигранную партию запоминаем: закрыть окно — не то же самое, что
        // сдаться. Разложенную забываем, иначе «Пасьянс» из меню открывал бы
        // готовую раскладку.
        saved = state.game.won ? null : state.game;
        modal.remove();
        document.body.classList.remove('modal-open');
        openState = null;
    };

    const onKeyDown = (e) => handleKey(state, e, close);
    // Свернули вкладку — секундомер стоит. Иначе человек возвращается к партии,
    // которой «уже двадцать минут», хотя играл он пять. Вернулись — идёт
    // дальше, но только если партия начата и ещё не кончилась.
    const onHide = () => {
        if (document.hidden) stopLoop(state);
        else if (state.started && !state.game.won && !state.autoTimer) startLoop(state);
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('visibilitychange', onHide);

    modal.querySelector('.modal-backdrop').onclick = close;
    modal.querySelector('#sol-close').onclick = close;
    modal.querySelector('#sol-restart').onclick = () => restart(state);
    modal.querySelector('#sol-auto').onclick = () => startAuto(state);
    modal.querySelector('#sol-again').onclick = () => restart(state);

    bindTable(state);
    render(state);
    loadTop(state);
    return modal;
}

function shellHtml() {
    const founds = SUITS.map((suit, i) => `
        <div class="sol-slot sol-found" data-zone="${FOUNDATION}" data-pile="${i}">
            <span class="sol-slot-mark s-${suit}">${SUIT_LABEL[suit]}</span>
        </div>`).join('');
    const piles = Array.from({ length: PILES }, (_, i) =>
        `<div class="sol-pile" data-zone="${TABLEAU}" data-pile="${i}"></div>`).join('');

    return `
        <div class="modal-backdrop"></div>
        <div class="modal-win sol-win">
            <div class="modal-head">
                <span>Пасьянс</span>
                <button class="btn btn-sec" id="sol-close" title="Закрыть">✕</button>
            </div>
            <div class="sol-body">
                <div class="sol-hud">
                    <div class="sol-stat"><span>Время</span><b id="sol-time">0:00</b></div>
                    <div class="sol-stat"><span>Ходы</span><b id="sol-moves">0</b></div>
                    <div class="sol-stat"><span>Круги</span><b id="sol-redeals">0</b></div>
                    <button type="button" class="btn btn-pri sol-btn hidden" id="sol-auto">Сложить</button>
                    <button type="button" class="btn btn-sec sol-btn" id="sol-restart">Заново</button>
                </div>

                <div class="sol-table" id="sol-table">
                    <div class="sol-deal">
                        <div class="sol-slot sol-stock" data-zone="${STOCK}" data-pile="0"></div>
                        <div class="sol-slot sol-waste" data-zone="${WASTE}" data-pile="0"></div>
                    </div>
                    <div class="sol-founds">${founds}</div>
                    <div class="sol-piles">${piles}</div>
                    <div class="sol-ghost" id="sol-ghost"></div>
                    <div class="sol-overlay hidden" id="sol-overlay">
                        <div class="sol-overlay-card">
                            <div class="sol-over-title" id="sol-over-title"></div>
                            <div class="sol-over-sub" id="sol-over-sub"></div>
                            <button type="button" class="btn btn-pri" id="sol-again">Заново</button>
                        </div>
                    </div>
                </div>

                <div class="sol-note" id="sol-note"></div>
                <div class="sol-top" id="sol-top"></div>
                <div class="sol-hint">
                    <span>клик — карта уедет сама</span>
                    <span>тянуть мышью — куда нужно</span>
                    <span><kbd class="sol-key">пробел</kbd> — карта из колоды</span>
                </div>
            </div>
        </div>`;
}

// ── Секундомер ───────────────────────────────────────────────────────────────

function startLoop(state) {
    if (state.raf || state.game.won || document.hidden) return;
    state.last = performance.now();
    state.raf = requestAnimationFrame(ts => frame(state, ts));
}

function stopLoop(state) {
    if (!state.raf) return;
    cancelAnimationFrame(state.raf);
    state.raf = 0;
}

// Потолок на длину кадра: вкладку свернули, ноутбук усыпили — между кадрами
// может пройти час, и без потолка партия «идёт» всё это время.
const MAX_FRAME_MS = 200;

function frame(state, ts) {
    if (openState !== state) return;
    tick(state.game, Math.min(ts - state.last, MAX_FRAME_MS));
    state.last = ts;
    renderTime(state);
    state.raf = requestAnimationFrame(t => frame(state, t));
}

// ── Ходы ─────────────────────────────────────────────────────────────────────

// Любое действие игрока заводит секундомер: партия началась тогда, когда её
// начали, а не когда открыли окно.
function began(state) {
    if (state.game.won) return;
    state.started = true;
    startLoop(state);
}

function doMove(state, from, to) {
    began(state);
    if (!move(state.game, from, to)) return false;
    afterMove(state);
    return true;
}

function doDraw(state) {
    if (state.game.won) return;
    began(state);
    const what = draw(state.game);
    if (!what) return;
    if (what === 'redeal') note(state, 'колода перевёрнута');
    afterMove(state);
}

function afterMove(state) {
    render(state);
    if (state.game.won) { finish(state); return; }
    // Тупик проверяем после каждого хода, но говорим о нём один раз: молча
    // оставленный человек будет крутить колоду по кругу, не понимая, что
    // раздача кончилась.
    if (!hasMove(state.game)) showOver(state, 'Ходов больше нет',
        'Так бывает: не всякая раздача разбирается. Новая — за полторы минуты.');
}

/** Клик по карте: увезти туда, где ей место. */
function tapCard(state, from) {
    const to = autoTarget(state.game, from);
    if (!to) { shakeAt(state, from); return; }
    doMove(state, from, to);
}

function handleKey(state, e, close) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (state.autoTimer) return;
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); doDraw(state); }
}

// ── Мышь и палец ─────────────────────────────────────────────────────────────

// Указатель ловим на самом столе с захватом (setPointerCapture): так не нужно
// вешать слушателей на window и снимать их при закрытии — они уезжают вместе с
// узлом окна.
function bindTable(state) {
    const table = state.modal.querySelector('#sol-table');
    table.addEventListener('pointerdown', e => onDown(state, table, e));
    table.addEventListener('pointermove', e => onMove(state, e));
    table.addEventListener('pointerup', e => onUp(state, table, e));
    table.addEventListener('pointercancel', () => cancelDrag(state));
    // Карты — картинки, и браузер по умолчанию предлагает их таскать своим
    // способом; это ломает наш жест на первом же движении.
    table.addEventListener('dragstart', e => e.preventDefault());
}

/** Откуда карта: разбираем адрес из data-атрибутов узла под указателем. */
function spotAt(target) {
    const slot = target.closest?.('[data-zone]');
    if (!slot) return null;
    const zone = slot.dataset.zone;
    const pile = Number(slot.dataset.pile) || 0;
    const cardNode = target.closest?.('.sol-card');
    const index = cardNode ? Number(cardNode.dataset.i) : -1;
    return { zone, pile, index, node: cardNode };
}

function onDown(state, table, e) {
    if (e.button != null && e.button !== 0) return;
    if (state.game.won || state.autoTimer) return;
    const spot = spotAt(e.target);
    if (!spot) return;

    if (spot.zone === STOCK) { state.drag = { stock: true }; return; }

    const from = { zone: spot.zone, pile: spot.pile, index: spot.index };
    const cards = taken(state.game, from);
    if (!cards.length) return;

    // Закрытая карта не берётся: taken вернул бы пусто, но проверка тут дешевле
    // разбора, почему стопка пустая.
    if (spot.zone === TABLEAU && !isFaceUp(state.game.piles[spot.pile], spot.index)) return;

    state.drag = { from, cards, x: e.clientX, y: e.clientY, moved: false };
    table.setPointerCapture?.(e.pointerId);
}

function onMove(state, e) {
    const drag = state.drag;
    if (!drag || drag.stock) return;
    if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_PX) return;
        beginGhost(state, drag);
    }
    moveGhost(state, drag, e.clientX, e.clientY);
}

function onUp(state, table, e) {
    const drag = state.drag;
    state.drag = null;
    table.releasePointerCapture?.(e.pointerId);
    if (!drag) return;

    if (drag.stock) {
        // По колоде именно кликают: перетаскивать из неё нечего — карта
        // приходит в отбой, а не в руку.
        const spot = spotAt(e.target);
        if (spot && spot.zone === STOCK) doDraw(state);
        return;
    }

    if (!drag.moved) { tapCard(state, drag.from); return; }

    endGhost(state, drag);
    // Кого накрыли — спрашиваем у документа: у самих карт на время жеста
    // отключён указатель, так что под курсором окажется стопка или слот.
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const spot = under && spotAt(under);
    if (!spot || !canDrop(state.game, drag.cards, { zone: spot.zone, pile: spot.pile })) {
        render(state);
        return;
    }
    doMove(state, drag.from, { zone: spot.zone, pile: spot.pile });
}

function cancelDrag(state) {
    const drag = state.drag;
    state.drag = null;
    if (drag && drag.moved) { endGhost(state, drag); render(state); }
}

// Стопка «в руке» — отдельный слой поверх стола: тащить сами карты нельзя, они
// живут внутри столбцов с обрезкой, и уехавшая карта пропала бы под краем.
function beginGhost(state, drag) {
    drag.moved = true;
    const ghost = state.modal.querySelector('#sol-ghost');
    ghost.innerHTML = drag.cards.map((card, i) => cardHtml(card, i, i)).join('');
    ghost.classList.add('is-on');
    // Карты, которые уехали в руку, гасим на месте — но место оставляем: без
    // него столбец подпрыгнул бы в момент, когда карту только приподняли.
    state.modal.querySelectorAll('.sol-card.is-taken').forEach(n => n.classList.remove('is-taken'));
    const pile = state.modal.querySelector(`[data-zone="${drag.from.zone}"][data-pile="${drag.from.pile || 0}"]`);
    pile?.querySelectorAll('.sol-card').forEach(node => {
        if (drag.from.zone !== TABLEAU || Number(node.dataset.i) >= drag.from.index) node.classList.add('is-taken');
    });
    // Хватаем карту за то место, за которое взяли: иначе она прыгает под курсор
    // углом, и попасть ею в столбец становится гаданием.
    const rect = (drag.from.zone === TABLEAU
        ? pile?.querySelector(`.sol-card[data-i="${drag.from.index}"]`)
        : pile?.querySelector('.sol-card:last-child'))?.getBoundingClientRect();
    drag.dx = rect ? drag.x - rect.left : 0;
    drag.dy = rect ? drag.y - rect.top : 0;
    const box = state.modal.querySelector('#sol-table').getBoundingClientRect();
    drag.ox = box.left;
    drag.oy = box.top;
}

function moveGhost(state, drag, x, y) {
    const ghost = state.modal.querySelector('#sol-ghost');
    ghost.style.transform = `translate(${x - drag.dx - drag.ox}px, ${y - drag.dy - drag.oy}px)`;
}

function endGhost(state, drag) {
    const ghost = state.modal.querySelector('#sol-ghost');
    ghost.classList.remove('is-on');
    ghost.innerHTML = '';
    drag.moved = false;
}

// Ход не по правилам: короткий отказ картой понятнее любой надписи.
function shakeAt(state, from) {
    const sel = `[data-zone="${from.zone}"][data-pile="${from.pile || 0}"]`;
    const pile = state.modal.querySelector(sel);
    const node = from.zone === TABLEAU
        ? pile?.querySelector(`.sol-card[data-i="${from.index}"]`)
        : pile?.querySelector('.sol-card:last-child');
    if (!node) return;
    node.classList.remove('is-nope');
    void node.offsetWidth;      // перезапуск анимации
    node.classList.add('is-nope');
}

// ── Автосбор ─────────────────────────────────────────────────────────────────

// Закрытых карт не осталось — партия уже выиграна, и полсотни кликов до победы
// человек делать не обязан. Секундомер на это время встаёт: он мерил игру, а
// сейчас идёт показ.
function startAuto(state) {
    if (state.autoTimer || state.game.won) return;
    stopLoop(state);
    state.modal.querySelector('#sol-auto').classList.add('hidden');
    const step = () => {
        state.autoTimer = 0;
        if (openState !== state) return;
        if (!autoStep(state.game)) { render(state); return; }
        render(state);
        if (state.game.won) { finish(state); return; }
        state.autoTimer = setTimeout(step, AUTO_MS);
    };
    step();
}

// ── Конец партии ─────────────────────────────────────────────────────────────

function finish(state) {
    if (state.finished) return;
    state.finished = true;
    stopLoop(state);
    clearTimeout(state.autoTimer);
    state.autoTimer = 0;
    const secs = Math.round(state.game.elapsedMs / 1000);
    showOver(state, 'Разложено!',
        `${timeWords(secs)}, ходов: ${state.game.moves}, кругов: ${state.game.redeals}`);
    sendScore(state);
}

function showOver(state, title, sub) {
    // Партия кончилась в любом случае — победой или тупиком, — и секундомер
    // дальше не идёт: тикающее время под надписью «ходов больше нет» было бы
    // издевательством.
    stopLoop(state);
    state.modal.querySelector('#sol-over-title').textContent = title;
    state.modal.querySelector('#sol-over-sub').textContent = sub;
    state.modal.querySelector('#sol-overlay').classList.remove('hidden');
}

function restart(state) {
    stopLoop(state);
    clearTimeout(state.autoTimer);
    state.autoTimer = 0;
    state.game = createGame();
    saved = null;
    state.drag = null;
    state.started = false;
    state.finished = false;
    state.shownSecs = -1;
    state.modal.querySelector('#sol-overlay').classList.add('hidden');
    note(state, '');
    render(state);
}

async function sendScore(state) {
    if (state.sending) return;
    const { moves, redeals, elapsedMs } = state.game;
    state.sending = true;
    try {
        const res = await state.ctx.apiFetch('/api/solitaire/score', {
            method: 'POST',
            body: { seconds: Math.round(elapsedMs / 1000), moves, redeals },
        });
        if (openState !== state) return;
        if (res && res.ok) {
            state.top = { rows: res.rows, me: res.me };
            renderTop(state);
            if (res.improved) {
                const sub = state.modal.querySelector('#sol-over-sub');
                if (sub) sub.innerHTML += ' <b class="sol-record">Личный рекорд!</b>';
            }
        }
    } catch {
        // Сеть отвалилась — партию это не портит, время просто не попало в топ.
        // Ругаться на человека за это нечем.
    }
    state.sending = false;
}

// ── Отрисовка ────────────────────────────────────────────────────────────────

/**
 * Карта: подложка (сама .sol-card) плюс слой с картинкой из листа колоды.
 * `i` — номер карты в стопке (нужен обработчику клика), `y` — на сколько шагов
 * она сдвинута вниз от начала столбца.
 */
function cardHtml(card, i, y) {
    return `<div class="sol-card" data-i="${i}" style="--y:${y}" title="${cardLabel(card)}"
                 ><i style="--col:${spriteCol(card)}; --row:${spriteRow(card)}"></i></div>`;
}

function downHtml(i, y) {
    return `<div class="sol-card is-down" data-i="${i}" style="--y:${y}"></div>`;
}

function render(state) {
    const { game } = state;
    renderDeal(state);
    renderFounds(state);
    renderPiles(state);
    renderTime(state);
    state.modal.querySelector('#sol-moves').textContent = game.moves;
    state.modal.querySelector('#sol-redeals').textContent = game.redeals;
    // Кнопка автосбора появляется ровно тогда, когда он становится возможен, —
    // и это же единственный внятный сигнал «всё, дальше только сложить».
    state.modal.querySelector('#sol-auto').classList.toggle('hidden', !canAutoFinish(game));
}

function renderDeal(state) {
    const { game } = state;
    const stock = state.modal.querySelector('.sol-stock');
    // В колоде рисуем ОДНУ рубашку, а не стопку из двадцати четырёх: сколько там
    // карт, видно по числу под ней, а два десятка узлов на каждый ход — нет.
    stock.innerHTML = game.stock.length
        ? `${downHtml(0, 0)}<span class="sol-count">${game.stock.length}</span>`
        : (game.waste.length ? '<span class="sol-slot-mark">↻</span>' : '');
    stock.classList.toggle('is-empty', !game.stock.length);

    // Отбой — тоже одна карта: по одной и тянем, и веер из трёх карт врал бы.
    const waste = state.modal.querySelector('.sol-waste');
    const card = topCard(game, WASTE);
    waste.innerHTML = card < 0 ? '' : cardHtml(card, game.waste.length - 1, 0);
}

function renderFounds(state) {
    state.game.found.forEach((pile, i) => {
        const slot = state.modal.querySelector(`.sol-found[data-pile="${i}"]`);
        const card = pile.length ? pile[pile.length - 1] : -1;
        // Пустая база помечена своей мастью: иначе непонятно, куда какой туз, а
        // угадывать это перетаскиванием — лишние секунды в партии на время.
        slot.querySelector('.sol-slot-mark').classList.toggle('hidden', card >= 0);
        slot.querySelectorAll('.sol-card').forEach(n => n.remove());
        if (card >= 0) slot.insertAdjacentHTML('beforeend', cardHtml(card, pile.length - 1, 0));
        slot.classList.toggle('is-full', pile.length === RANKS);
    });
}

function renderPiles(state) {
    state.game.piles.forEach((pile, p) => {
        const box = state.modal.querySelector(`.sol-pile[data-pile="${p}"]`);
        // Сдвиг карт считаем в «шагах»: закрытая занимает полшага, открытая шаг.
        // Если столбец не влезает — ужимаем ВЕСЬ столбец одним множителем, а не
        // по-разному сверху и снизу: так расстояния остаются равномерными.
        const units = pile.down * DOWN_UNIT + Math.max(0, pile.cards.length - pile.down - 1);
        const squeeze = units > PILE_UNITS ? PILE_UNITS / units : 1;
        let y = 0;
        box.innerHTML = pile.cards.map((card, i) => {
            const html = isFaceUp(pile, i) ? cardHtml(card, i, y) : downHtml(i, y);
            y += (isFaceUp(pile, i) ? 1 : DOWN_UNIT) * squeeze;
            return html;
        }).join('');
        box.classList.toggle('is-empty', !pile.cards.length);
    });
}

function renderTime(state) {
    const secs = Math.floor(state.game.elapsedMs / 1000);
    if (secs === state.shownSecs) return;
    state.shownSecs = secs;
    state.modal.querySelector('#sol-time').textContent = mmss(secs);
}

function mmss(secs) {
    const m = Math.floor(secs / 60);
    return `${m}:${String(secs - m * 60).padStart(2, '0')}`;
}

// «за 6 минут 12 секунд» в итоге партии: 6:12 в строке с ходами и кругами
// читается как ещё одно число, а не как результат.
function timeWords(secs) {
    const m = Math.floor(secs / 60);
    const s = secs - m * 60;
    const minutes = m ? `${m} ${plural(m, 'минута', 'минуты', 'минут')}` : '';
    const seconds = s || !m ? `${s} ${plural(s, 'секунда', 'секунды', 'секунд')}` : '';
    return [minutes, seconds].filter(Boolean).join(' ');
}

function plural(n, one, few, many) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
}

let noteTimer = 0;
function note(state, text) {
    const box = state.modal.querySelector('#sol-note');
    if (!box) return;
    box.textContent = text;
    box.classList.toggle('is-show', !!text);
    clearTimeout(noteTimer);
    if (text) noteTimer = setTimeout(() => { if (openState === state) note(state, ''); }, 2200);
}

// ── Мини-топ ─────────────────────────────────────────────────────────────────

async function loadTop(state) {
    try {
        const res = await state.ctx.apiFetch('/api/solitaire/top');
        if (openState !== state) return;
        state.top = res;
        renderTop(state);
    } catch {
        // Без топа игра играется — говорим об этом одной строкой и всё.
        if (openState !== state) return;
        state.topFailed = true;
        renderTop(state);
    }
}

function renderTop(state) {
    const box = state.modal.querySelector('#sol-top');
    if (!box) return;
    const data = state.top;
    if (!data) {
        box.innerHTML = state.topFailed
            ? '<div class="sol-top-head">Мини-топ</div><div class="sol-top-empty">Сервер не ответил — топ будет позже.</div>'
            : '<div class="sol-top-empty">Мини-топ загружается…</div>';
        return;
    }

    const rows = data.rows || [];
    const meId = state.ctx.user?.id;
    if (!rows.length) {
        box.innerHTML = '<div class="sol-top-head">Мини-топ</div>'
            + '<div class="sol-top-empty">Никто ещё не разложил — первое время будет вашим.</div>';
        return;
    }

    const list = rows.map(row => `
        <div class="sol-top-row${row.id === meId ? ' is-me' : ''}${row.rank === 1 ? ' is-first' : ''}">
            <span class="sol-top-rank">${row.rank}</span>
            <div class="sol-top-avatar">${row.avatar
                ? `<img src="${esc(row.avatar)}" alt=""/>`
                : '<span class="top-avatar-default"></span>'}</div>
            <div class="sol-top-name">${rolePrefixHtml(row.role_prefix)}${esc(row.display_name)}</div>
            <span class="sol-top-score">${mmss(Number(row.seconds))}</span>
        </div>`).join('');

    // Своя строка отдельно — только если в показанную десятку не попал: иначе
    // это был бы дубль той же строки, подсвеченной выше.
    const me = data.me;
    const inList = rows.some(r => r.id === meId);
    const mine = me && !inList
        ? `<div class="sol-top-row is-me is-mine-extra">
               <span class="sol-top-rank">${me.rank}</span>
               <div class="sol-top-name">Ваше время</div>
               <span class="sol-top-score">${mmss(Number(me.seconds))}</span>
           </div>`
        : '';

    box.innerHTML = `<div class="sol-top-head">Мини-топ — за сколько разложено</div>`
        + `<div class="sol-top-list">${list}</div>${mine}`;
}

function rolePrefixHtml(rolePrefix) {
    if (!rolePrefix) return '';
    return `<span class="role-prefix role-prefix-${esc(rolePrefix.color)}" title="${esc(rolePrefix.tooltip || '')}">${esc(rolePrefix.label)}</span> `;
}

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
