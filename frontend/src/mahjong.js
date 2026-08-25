// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Маджонг» (пасьянс-маджонг, «черепаха») — окно игры и мини-топ по
// времени.
//
// Открывается ТОЛЬКО из меню игр (games.js), а оно — из поиска на главной:
// набрать «игры» и нажать Enter. Пока это слово набирают, поиск молчит.
//
// Правила целиком в shared/mahjong.js — здесь ни строчки про то, какая фишка
// свободна и что с чем сходится. Этот файл делает три вещи: рисует горку,
// слушает мышь и один раз в конце разобранной партии относит время на сервер
// (backend/routes/mahjong.js).
//
// ФИШКИ — ОДНА КАРТИНКА НА ВЕСЬ НАБОР (assets/mahjong-tiles.png, сетка 7×6), и
// нарисована каждая как ЛИЦО ПЛЮС БОРТИК вправо и вниз. Отсюда единственная
// неочевидная вещь во всей вёрстке: ШАГ СЕТКИ РАВЕН ЛИЦУ, а картинка шире шага.
// Соседняя фишка встаёт вплотную и закрывает бортик собой — видно его только у
// крайней в ряду, ровно как у настоящей горки, где внутри ряда фишки прижаты
// друг к другу. Верхние этажи сдвинуты на десятую долю фишки ВВЕРХ-ВЛЕВО (--mj-
// off): свет на картинке падает слева сверху, и открытым должен оставаться тот
// бортик, который нарисован, — правый и нижний.
//
// В ПИКСЕЛЯХ ЗДЕСЬ НЕ СЧИТАЕТСЯ НИЧЕГО. Место фишки уезжает в разметку долями
// ФИШКИ (--tx/--ty), а сколько это пикселей, решает одна переменная --mj-fw в
// style.css — как ширина карты в пасьянсе и клетка в тетрисе. Поэтому стол
// целиком виден и на телефоне, и на ноутбуке с короткой рамкой, а JS ничего не
// пересчитывает при изменении размера окна.
//
// СЕКУНДОМЕР идёт, только пока играют: заводится первым ходом, встаёт на
// свёрнутой вкладке и на закрытом окне (партия при этом сохраняется и
// открывается заново с того же места). Топ здесь по времени, и «час»,
// набранный забытой вкладкой, был бы просто мусором в таблице.
//
// ПОДСКАЗКИ ПО КНОПКЕ НЕТ, и это сознательно. Соревнуются временем, а кнопка
// «покажи пару» превратила бы игру в соревнование по скорости нажатия на неё.
// Вместо неё стол сам подсвечивает пару, если игрок несколько секунд не ходит
// (как в тройке): дождаться подсказки всегда дороже, чем найти пару глазами.
// ─────────────────────────────────────────────────────────────────────────────

import {
    LAYOUT, SPRITE, LAYERS, TILES, UNIT,
    createGame, isFree, canTake, take, findMove, hasMove, reshuffle, tick,
    tileLabel, spriteCol, spriteRow,
} from '../../shared/mahjong.js';
import tileSheet from './assets/mahjong-tiles.png';
import { namePrefixHtml } from './namePrefix.js';
import { profileRowAttrs, bindProfileRows } from './topProfile.js';

const MODAL_ID = 'mahjong-modal';

// Сдвиг верхнего этажа относительно нижнего — в долях фишки. Больше — горка
// разъезжается лесенкой и накрывает соседние ряды, меньше — этажи сливаются в
// одну плоскую картинку, и понять, что фишка накрыта, нельзя.
const OFF = 0.12;

// Сколько ждать перед подсказкой. Восемь секунд — это заметно дольше, чем
// «просто ищу глазами», и заметно меньше, чем «я застрял и не понимаю».
const HINT_MS = 8000;

// Сколько живёт исчезновение снятой пары. Должно совпадать с .mj-tile.is-gone
// в style.css: раньше времени убранный узел моргает, позже — мешает кликать.
const GONE_MS = 220;

let openState = null;   // одно окно за раз
let saved = null;       // недоигранная партия: окно закрыли, но горка жива

/** Открыть игру. ctx: { apiFetch, user }. */
export function openMahjong(ctx) {
    if (openState) return openState.modal;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'modal';
    modal.innerHTML = shellHtml();
    // Путь к спрайту знает сборщик (он его хэширует), а нужен он в CSS —
    // поэтому кладём его переменной на само окно, а не прописываем в style.css.
    modal.querySelector('.mj-win').style.setProperty('--mj-sheet', `url(${tileSheet})`);
    document.body.appendChild(modal);
    document.body.classList.add('modal-open');

    const state = {
        ctx,
        modal,
        game: saved || createGame(),
        sel: -1,           // выбранная фишка (место в раскладке) или −1
        // Секундомер заводится первым ходом: окно можно открыть и посмотреть на
        // топ, не начав партию.
        started: false,
        raf: 0,
        last: 0,
        idle: 0,
        hint: null,
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
        clearTimeout(state.idle);
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('visibilitychange', onHide);
        // Недоигранную партию запоминаем: закрыть окно — не то же самое, что
        // сдаться. Разобранную забываем, иначе «Маджонг» из меню открывал бы
        // пустой стол.
        saved = state.game.won ? null : state.game;
        modal.remove();
        document.body.classList.remove('modal-open');
        openState = null;
    };
    state.close = close;

    const onKeyDown = (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        close();
    };
    // Свернули вкладку — секундомер стоит. Иначе человек возвращается к партии,
    // которой «уже сорок минут», хотя играл он десять.
    const onHide = () => {
        if (document.hidden) stopLoop(state);
        else if (state.started && !state.game.won) startLoop(state);
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('visibilitychange', onHide);

    modal.querySelector('.modal-backdrop').onclick = close;
    modal.querySelector('#mj-close').onclick = close;
    modal.querySelector('#mj-restart').onclick = () => restart(state);
    modal.querySelector('#mj-again').onclick = () => restart(state);
    modal.querySelector('#mj-shuffle').onclick = () => doShuffle(state);
    modal.querySelector('#mj-board').addEventListener('pointerdown', e => onTap(state, e));

    renderBoard(state);
    render(state);
    armHint(state);
    // Подсказку показываем только новой партии: поднятую из отложенной человек
    // уже играл, и объяснять ему правила второй раз незачем.
    if (!state.game.pairs) note(state, HINT, true);
    loadTop(state);
    return modal;
}

function shellHtml() {
    return `
        <div class="modal-backdrop"></div>
        <div class="modal-win mj-win">
            <div class="modal-head">
                <span>Маджонг</span>
                <button class="btn btn-sec" id="mj-close" title="Закрыть">✕</button>
            </div>
            <div class="mj-body">
                <div class="mj-hud">
                    <div class="mj-stat"><span>Время</span><b id="mj-time">0:00</b></div>
                    <div class="mj-stat"><span>Осталось</span><b id="mj-left">${TILES}</b></div>
                    <div class="mj-stat"><span>Перемешано</span><b id="mj-shuffles">0</b></div>
                    <button type="button" class="btn btn-sec mj-btn" id="mj-shuffle" disabled>Перемешать</button>
                    <button type="button" class="btn btn-sec mj-btn" id="mj-restart">Заново</button>
                </div>

                <div class="mj-table">
                    <div class="mj-board" id="mj-board"></div>
                    <div class="mj-overlay hidden" id="mj-overlay">
                        <div class="mj-overlay-card">
                            <div class="mj-over-title" id="mj-over-title"></div>
                            <div class="mj-over-sub" id="mj-over-sub"></div>
                            <button type="button" class="btn btn-pri" id="mj-again">Заново</button>
                        </div>
                    </div>
                </div>

                <div class="mj-note" id="mj-note"></div>
                <div class="mj-top" id="mj-top"></div>
            </div>
        </div>`;
}

// Как играть — в той же строке, где потом появляются новости партии. Отдельная
// строка подсказки стоила бы двадцать пикселей высоты, а высота здесь — это
// РАЗМЕР ФИШКИ (см. --mj-fw в style.css).
const HINT = 'снимайте одинаковые фишки парами · брать можно только те,'
    + ' что не накрыты и открыты слева или справа';

// ── Отрисовка ────────────────────────────────────────────────────────────────

// Место фишки в долях ЛИЦА: шаг сетки — само лицо, а верхние этажи сдвинуты
// вверх-влево. Слагаемые в конце — поля стола: сдвиг самого верхнего этажа
// (чтобы горка не уехала за левый край) и пустой пиксель клетки спрайта.
const txOf = p => p.x / UNIT - p.z * OFF + (LAYERS - 1) * OFF - SPRITE.pad / SPRITE.faceW;
const tyOf = p => p.y / UNIT - p.z * OFF + (LAYERS - 1) * OFF - SPRITE.pad / SPRITE.faceH;

// Порядок наложения. Считается из места, а не из порядка узлов в разметке:
// правый сосед обязан лечь ПОВЕРХ бортика левого, нижний — поверх верхнего, а
// верхний этаж — поверх всех. Один узел сдвинулся — и горка рассыпается.
const zOf = p => p.z * 1000 + p.y * 31 + p.x;

// Размер стола в тех же долях: считается из раскладки, руками нигде не задан.
const BOARD_TX = Math.max(...LAYOUT.map(txOf)) + SPRITE.cellW / SPRITE.faceW;
const BOARD_TY = Math.max(...LAYOUT.map(tyOf)) + SPRITE.cellH / SPRITE.faceH;

function renderBoard(state) {
    const box = state.modal.querySelector('#mj-board');
    box.style.setProperty('--mj-bw', BOARD_TX);
    box.style.setProperty('--mj-bh', BOARD_TY);
    box.innerHTML = LAYOUT.map((p, i) => {
        const kind = state.game.tiles[i];
        if (kind < 0) return '';
        // is-up — фишка не на столе, а на другой фишке: тень у неё длиннее.
        // Без разницы теней пять этажей кремовых фишек читаются как плоская
        // мозаика, и понять, что накрыто, а что нет, нельзя.
        return `<button type="button" class="mj-tile${p.z ? ' is-up' : ''}" data-i="${i}" title="${tileLabel(kind)}"
                    style="--tx:${txOf(p).toFixed(4)}; --ty:${tyOf(p).toFixed(4)};
                           --col:${spriteCol(kind)}; --row:${spriteRow(kind)}; --zi:${zOf(p)}"></button>`;
    }).join('');
}

function tileNode(state, i) {
    return state.modal.querySelector(`.mj-tile[data-i="${i}"]`);
}

function render(state) {
    const { game } = state;
    state.modal.querySelector('#mj-left').textContent = game.left;
    state.modal.querySelector('#mj-shuffles').textContent = game.shuffles;
    renderTime(state);

    // Свободные фишки помечаем классом: по нему CSS даёт им курсор и подъём под
    // мышью. Показывать, какие фишки свободны, СПИСКОМ нельзя — искать их и есть
    // игра, — но под курсором честно сказать «эту взять нельзя» стоит.
    state.modal.querySelectorAll('.mj-tile').forEach(node => {
        const i = Number(node.dataset.i);
        node.classList.toggle('is-free', isFree(game, i));
        node.classList.toggle('is-sel', i === state.sel);
        node.classList.toggle('is-hint', !!state.hint && state.hint.includes(i));
    });

    // Перемешивание — только в тупике: это не «ещё одна попытка», а
    // единственный выход из положения, в которое игрок себя загнал сам.
    const stuck = !game.won && !hasMove(game);
    const btn = state.modal.querySelector('#mj-shuffle');
    btn.disabled = !stuck;
    btn.classList.toggle('btn-pri', stuck);
    btn.classList.toggle('btn-sec', !stuck);
}

function renderTime(state) {
    const secs = Math.floor(state.game.elapsedMs / 1000);
    if (secs === state.shownSecs) return;
    state.shownSecs = secs;
    state.modal.querySelector('#mj-time').textContent = mmss(secs);
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

function onTap(state, e) {
    if (e.button != null && e.button !== 0) return;
    const node = e.target.closest?.('.mj-tile');
    if (!node || state.game.won) return;
    e.preventDefault();
    const i = Number(node.dataset.i);

    // Любой клик снимает подсказку и заводит её отсчёт заново: пока человек
    // щёлкает, он ищет сам.
    armHint(state);
    began(state);

    if (i === state.sel) { state.sel = -1; render(state); return; }
    if (!isFree(state.game, i)) {
        nope(state, node, 'эта фишка закрыта');
        return;
    }
    if (state.sel < 0) { state.sel = i; render(state); return; }

    if (!canTake(state.game, state.sel, i)) {
        // Не сошлись — выбранной становится новая фишка: в маджонге это чаще
        // «передумал», чем «ошибся», и заставлять снимать выделение отдельным
        // кликом значит удваивать половину кликов партии.
        nope(state, node, 'фишки не сходятся');
        state.sel = i;
        render(state);
        return;
    }

    const a = state.sel;
    take(state.game, a, i);
    state.sel = -1;
    fadeOut(state, a);
    fadeOut(state, i);
    afterMove(state);
}

// Любое действие игрока заводит секундомер: партия началась тогда, когда её
// начали, а не когда открыли окно.
function began(state) {
    if (state.game.won) return;
    // Первый ход убирает подсказку: она объясняла правила, а ход уже сделан.
    if (!state.started) note(state, '');
    state.started = true;
    startLoop(state);
}

function afterMove(state) {
    render(state);
    if (state.game.won) { finish(state); return; }
    // Тупик проверяем после каждого хода и говорим о нём вслух: молча
    // оставленный человек будет щёлкать по фишкам, не понимая, почему ничего
    // не выходит.
    if (!hasMove(state.game)) {
        clearTimeout(state.idle);
        note(state, 'ходов больше нет — перемешайте стол', true);
        return;
    }
    armHint(state);
}

function doShuffle(state) {
    if (!reshuffle(state.game)) return;
    state.sel = -1;
    state.hint = null;
    began(state);
    renderBoard(state);
    render(state);
    note(state, 'стол перемешан — фишки те же, места те же');
    armHint(state);
}

/** Снятая фишка уезжает не мгновенно: пара должна быть видна как пара. */
function fadeOut(state, i) {
    const node = tileNode(state, i);
    if (!node) return;
    node.classList.add('is-gone');
    setTimeout(() => node.remove(), GONE_MS);
}

function nope(state, node, why) {
    node.classList.remove('is-nope');
    // Перезапуск анимации: без пересчёта стилей второй промах подряд по той же
    // фишке ничего бы не показал.
    void node.offsetWidth;
    node.classList.add('is-nope');
    setTimeout(() => node.classList.remove('is-nope'), 320);
    note(state, why);
}

function restart(state) {
    stopLoop(state);
    state.game = createGame();
    saved = null;
    state.sel = -1;
    state.hint = null;
    state.started = false;
    state.finished = false;
    state.shownSecs = -1;
    state.modal.querySelector('#mj-overlay').classList.add('hidden');
    note(state, '');
    renderBoard(state);
    render(state);
    armHint(state);
}

// ── Подсказка ────────────────────────────────────────────────────────────────

/**
 * Завести отсчёт до подсказки заново — и снять ту, что висит сейчас.
 *
 * Зовётся на КАЖДОЕ действие игрока, а не только после хода: щёлкать по
 * закрытым фишкам и передумывать — это тоже «я ищу сам», и подсказке в такой
 * момент выскакивать незачем.
 */
function armHint(state) {
    clearTimeout(state.idle);
    if (state.hint) { state.hint = null; render(state); }
    state.idle = setTimeout(() => {
        if (openState !== state || state.game.won) return;
        state.hint = findMove(state.game);
        render(state);
    }, HINT_MS);
}

// ── Конец партии ─────────────────────────────────────────────────────────────

function finish(state) {
    if (state.finished) return;
    state.finished = true;
    stopLoop(state);
    saved = null;

    const secs = Math.floor(state.game.elapsedMs / 1000);
    const shuffles = state.game.shuffles;
    state.modal.querySelector('#mj-over-title').textContent = 'Стол разобран';
    state.modal.querySelector('#mj-over-sub').textContent = shuffles
        ? `${timeWords(secs)}, перемешиваний: ${shuffles}`
        : `${timeWords(secs)}, ни разу не перемешивая`;
    state.modal.querySelector('#mj-overlay').classList.remove('hidden');
    sendScore(state);
}

async function sendScore(state) {
    if (state.sending) return;
    const { elapsedMs, shuffles } = state.game;
    state.sending = true;
    try {
        const res = await state.ctx.apiFetch('/api/mahjong/score', {
            method: 'POST',
            body: { seconds: Math.round(elapsedMs / 1000), shuffles },
        });
        if (openState !== state) return;
        if (res && res.ok) {
            state.top = { rows: res.rows, me: res.me };
            renderTop(state);
            if (res.improved) {
                const sub = state.modal.querySelector('#mj-over-sub');
                if (sub) sub.innerHTML += ' <b class="mj-record">Личный рекорд!</b>';
            }
        }
    } catch {
        // Сеть отвалилась — партию это не портит, время просто не попало в топ.
        // Ругаться на человека за это нечем.
    }
    state.sending = false;
}

// ── Строка новостей ──────────────────────────────────────────────────────────

let noteTimer = 0;
function note(state, html, sticky = false) {
    const box = state.modal.querySelector('#mj-note');
    if (!box) return;
    box.innerHTML = html;
    box.classList.toggle('is-show', !!html);
    clearTimeout(noteTimer);
    if (html && !sticky) noteTimer = setTimeout(() => { if (openState === state) note(state, ''); }, 2200);
}

// ── Мини-топ ─────────────────────────────────────────────────────────────────

async function loadTop(state) {
    try {
        const res = await state.ctx.apiFetch('/api/mahjong/top');
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
    const box = state.modal.querySelector('#mj-top');
    if (!box) return;
    const data = state.top;
    if (!data) {
        box.innerHTML = state.topFailed
            ? '<div class="mj-top-head">Мини-топ</div><div class="mj-top-empty">Сервер не ответил — топ будет позже.</div>'
            : '<div class="mj-top-empty">Мини-топ загружается…</div>';
        return;
    }

    const rows = data.rows || [];
    const meId = state.ctx.user?.id;
    if (!rows.length) {
        box.innerHTML = '<div class="mj-top-head">Мини-топ</div>'
            + '<div class="mj-top-empty">Никто ещё не разобрал — первое время будет вашим.</div>';
        return;
    }

    const list = rows.map(row => `
        <div class="mj-top-row${row.id === meId ? ' is-me' : ''}${row.rank === 1 ? ' is-first' : ''}"${profileRowAttrs(row)}>
            <span class="mj-top-rank">${row.rank}</span>
            <div class="mj-top-avatar">${row.avatar
                ? `<img src="${esc(row.avatar)}" alt=""/>`
                : '<span class="top-avatar-default"></span>'}</div>
            <div class="mj-top-name">${namePrefixHtml(row)}${esc(row.display_name)}</div>
            <span class="mj-top-score">${mmss(Number(row.seconds))}</span>
        </div>`).join('');

    // Своя строка отдельно — только если в показанную десятку не попал: иначе
    // это был бы дубль той же строки, подсвеченной выше.
    const me = data.me;
    const inList = rows.some(r => r.id === meId);
    const mine = me && !inList
        ? `<div class="mj-top-row is-me is-mine-extra">
               <span class="mj-top-rank">${me.rank}</span>
               <div class="mj-top-name">Ваше время</div>
               <span class="mj-top-score">${mmss(Number(me.seconds))}</span>
           </div>`
        : '';

    box.innerHTML = '<div class="mj-top-head">Мини-топ — за сколько разобран стол</div>'
        + `<div class="mj-top-list">${list}</div>${mine}`;
    bindProfileRows(box, state.close);
}

// ── Мелочи ───────────────────────────────────────────────────────────────────

function mmss(secs) {
    const m = Math.floor(secs / 60);
    return `${m}:${String(secs - m * 60).padStart(2, '0')}`;
}

// «за 6 минут 12 секунд» в итоге партии: 6:12 в строке с перемешиваниями
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

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
