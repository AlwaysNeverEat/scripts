// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Рогалик» (карточный забег) — окно игры и мини-топ.
//
// Открывается ТОЛЬКО из меню игр (games.js), а оно — из поиска на главной:
// набрать «игры» и нажать Enter. Пока это слово набирают, поиск молчит.
//
// Правила целиком в shared/roguelike.js — здесь ни одной строчки про то,
// сколько урона у «Удара», как растут враги и что даёт осколок. Этот файл
// занимается тремя вещами: рисует состояние забега, зовёт функции движка на
// клики и один раз в конце относит результат на сервер
// (backend/src/routes/roguelike.js).
//
// ПЯТЬ ЭКРАНОВ, И ЭКРАН ВЫБИРАЕТ ДВИЖОК (run.screen), а не окно: карта узлов,
// бой, награда, событие, итог. Окну нельзя решать, куда идти дальше, — иначе
// «после боя выдать награду» оказалось бы записано и в правилах, и в вёрстке, и
// разошлось бы на первой же правке.
//
// ПЕРЕРИСОВЫВАЕМСЯ ЦЕЛИКОМ на каждое действие, без всякой хитрости с точечным
// обновлением узлов. Это пошаговая игра: между двумя перерисовками проходит
// клик человека, а не кадр — экономить тут не на чем, зато состояние в DOM
// гарантированно то же, что в движке.
//
// ЗАБЕГ ПЕРЕЖИВАЕТ ЗАКРЫТИЕ ОКНА И ПЕРЕЗАГРУЗКУ СТРАНИЦЫ: run — обычный объект
// без функций (так и задумано в движке), поэтому он целиком уезжает в
// localStorage под id аккаунта. В отличие от тройки и тетриса, где партия
// живёт минуты, забег идёт десятки минут: потерять его от случайного F5 —
// потерять весь вечер. Время забега при этом копится ТОЛЬКО пока окно открыто и
// вкладка видима: иначе «полтора часа» в подписи рекорда означало бы «вкладка
// висела с ночи».
//
// НИ ОДНОГО Math.random в этом файле: всё случайное — только через движок и его
// сид, иначе забег перестанет быть воспроизводимым по сиду.
// ─────────────────────────────────────────────────────────────────────────────

import {
    startRun, nextNodes, enterNode, playCard, endTurn, chooseReward, chooseEvent,
    removeCard, useStone, useShard, giveUp, cardOf, cardView, intentView, enemyView,
    runResult, addTime, mutationList, takeLog, costOf,
    MAP_ROWS, SKIP_HEAL, HAND_SIZE,
    SCREEN_MAP, SCREEN_BATTLE, SCREEN_REWARD, SCREEN_EVENT, SCREEN_OVER,
    NODE_INFO, NODE_BOSS, NODE_ELITE, STATUS_INFO, MUTATOR_BY_ID, EVENTS,
    I_ATTACK, I_BLOCK, I_STATUS,
} from '../../shared/roguelike.js';
import { namePrefixHtml } from './namePrefix.js';

// Арт карты — ЭТО ФАЙЛ С ЕЁ ИМЕНЕМ: положили frontend/src/assets/roguelike/strike.png —
// и «Удар» стал нарисованным, ничего не правя в коде. Никакой таблицы
// «карта → картинка» нет и не будет: имя файла и есть id карты из
// shared/roguelikeContent.js. Карты без файла рисуются вёрсткой.
const CARD_ART = Object.fromEntries(
    Object.entries(import.meta.glob('./assets/roguelike/*.{png,webp,jpg}', { eager: true, import: 'default' }))
        .map(([path, url]) => [path.split('/').pop().replace(/\.\w+$/, ''), url]),
);

const MODAL_ID = 'roguelike-modal';
// Забег хранится под id аккаунта: за одним компьютером сидят по очереди, и
// чужой забег в своём окне — это худшее, что может случиться с пасхалкой.
const SAVE_KEY = 'cars_db_roguelike';

let openState = null;   // одно окно за раз

/** Открыть игру. ctx: { apiFetch, user }. */
export function openRoguelike(ctx) {
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
        run: loadRun(ctx) || startRun(),
        deck: null,      // открытая колода: { mode: 'view' | 'stone' | 'shard' | 'remove' }
        // Стол и рука во время показа хода. Правила к этому моменту уже сыграли
        // ход целиком (стол у них пуст, рука новая), а окно обязано показать
        // тот стол, который игрок выложил, — поэтому на время показа оно держит
        // свою копию. Вне показа обе null, и рисуется состояние движка.
        table: null,
        handView: null,
        foeIntent: null, // намерение, с которым ход НАЧИНАЛСЯ
        busy: false,     // идёт показ хода — ввод не принимается
        phase: null,     // 'cast' — играет стол, 'enemy' — ходит враг
        drag: null,      // карта, которую тянут из руки
        shown: null,     // числа во время показа: своя копия, её двигает журнал
        deal: false,     // новую руку рисуем с раздачей
        top: null,
        topFailed: false,
        sending: false,
        sent: false,
        note: '',        // короткая новость под шапкой («+ точильный камень»)
        tick: 0,
        last: Date.now(),
    };
    openState = state;

    const close = () => {
        countTime(state);
        stopTick(state);
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('visibilitychange', onHide);
        window.removeEventListener('resize', onResize);
        store(state);
        modal.remove();
        document.body.classList.remove('modal-open');
        openState = null;
    };

    const onKeyDown = (e) => handleKey(state, e, close);
    // Размер карточки задан в vw, поэтому от смены ширины окна разъезжается и
    // веер, и подогнанные под рамку описания. Пересчитываем, а не
    // перерисовываем: посреди показа хода перерисовка сбила бы его.
    const onResize = () => { fitTable(state); layoutHand(state); fitTexts(state); };
    // Свернули вкладку — перестаём считать время забега. Часы, натикавшие в
    // закрытой вкладке, попали бы в подпись рекорда и врали бы про игру.
    const onHide = () => { countTime(state); state.last = Date.now(); };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('resize', onResize);
    // Шрифт карточек подгружается отдельным файлом, и до его приезда описание
    // меряется метриками запасного — подгонка выходит неверной. Просим шрифт
    // ЯВНО (ready тут не годится: он резолвится до того, как браузер вообще
    // соберётся грузить ещё не встретившийся ему шрифт) и подгоняем заново.
    // Текст ОБЯЗАТЕЛЬНО русский: шрифт разрезан на подмножества по алфавитам, и
    // запрос без кириллицы притащил бы латиницу, а описания карт остались бы
    // мерены запасным шрифтом.
    const refit = () => { if (openState === state) fitTexts(state); };
    for (const w of [700, 800]) {
        document.fonts?.load(`${w} 1em RgSlab`, 'Ещё 12 урона').then(refit, refit);
    }

    modal.querySelector('.modal-backdrop').onclick = close;
    modal.querySelector('#rg-close').onclick = close;
    // Один обработчик на всё окно: экранов пять, кнопок на них десятки, и
    // навешивать их заново после каждой перерисовки — лишняя работа и лишний
    // повод забыть одну.
    modal.querySelector('.rg-body').addEventListener('click', e => onClick(state, e));

    startTick(state);
    render(state);
    loadTop(state);
    if (state.run.over) finish(state);
    return modal;
}

function shellHtml() {
    return `
        <div class="modal-backdrop"></div>
        <div class="modal-win rg-win">
            <div class="modal-head">
                <span>Рогалик</span>
                <button class="btn btn-sec" id="rg-close" title="Закрыть">✕</button>
            </div>
            <div class="rg-body">
                <div class="rg-hud" id="rg-hud"></div>
                <div class="rg-note" id="rg-note"></div>
                <div class="rg-view" id="rg-view"></div>
            </div>
        </div>`;
}

// ── Сохранение забега ────────────────────────────────────────────────────────

function saveKey(ctx) { return `${SAVE_KEY}:${ctx.user?.id || 'guest'}`; }

function store(state) {
    try {
        if (state.run.over) localStorage.removeItem(saveKey(state.ctx));
        else localStorage.setItem(saveKey(state.ctx), JSON.stringify(state.run));
    } catch {
        // Приватный режим, переполненное хранилище — забег от этого не
        // ломается, просто не переживёт перезагрузку. Ругаться не на что.
    }
}

function loadRun(ctx) {
    try {
        const raw = localStorage.getItem(saveKey(ctx));
        if (!raw) return null;
        const run = JSON.parse(raw);
        // Проверяем не всё подряд, а то, без чего окно упадёт на первом же
        // рисовании: сохранение могло остаться от прошлой версии правил.
        const ok = run && Array.isArray(run.deck) && run.deck.length && run.map
            && Array.isArray(run.map.rows) && run.map.rows.length === MAP_ROWS
            && typeof run.screen === 'string' && !run.over;
        return ok ? run : null;
    } catch {
        return null;
    }
}

// ── Время забега ─────────────────────────────────────────────────────────────

function startTick(state) {
    stopTick(state);
    state.last = Date.now();
    // Раз в пять секунд: время нужно с точностью до секунд, а не до кадра.
    state.tick = setInterval(() => countTime(state), 5000);
}

function stopTick(state) {
    if (state.tick) clearInterval(state.tick);
    state.tick = 0;
}

function countTime(state) {
    const now = Date.now();
    const dt = now - state.last;
    state.last = now;
    if (document.hidden || state.run.over) return;
    // Всплеск больше минуты — это уснувшая вкладка, а не игра.
    addTime(state.run, Math.min(dt, 60_000));
}

// ── Ввод ─────────────────────────────────────────────────────────────────────

function onClick(state, e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    // Пока показывается ход, окно не принимает ничего: правила уже посчитали
    // всё вперёд, и второй клик посреди показа сыграл бы карту в позиции,
    // которой игрок ещё не видит.
    if (state.busy) return;
    const i = Number(el.dataset.i);
    const uid = Number(el.dataset.uid);
    const run = state.run;
    state.note = '';

    switch (act) {
        // Ход — единственное действие с показом: оно асинхронное и доводит окно
        // до нужного состояния само. Карты в руке сюда не попадают: их ведёт
        // указатель (см. handInput), потому что карту ТЯНУТ на стол.
        case 'end': doEnd(state); return;
        case 'node':
            enterNode(run, i);
            state.deal = true;
            break;
        case 'reward': {
            const r = run.reward;
            const got = [];
            if (r?.stone) got.push('точильный камень');
            if (r?.shard) got.push('осколок мутации');
            chooseReward(run, i);
            if (got.length) state.note = `Получено: ${got.join(' и ')}.`;
            break;
        }
        case 'event': {
            const res = chooseEvent(run, i);
            if (res.notes?.length) state.note = res.notes.join(', ') + '.';
            break;
        }
        case 'deck': state.deck = state.deck ? null : { mode: 'view' }; break;
        case 'stone': state.deck = { mode: 'stone' }; break;
        case 'shard': state.deck = { mode: 'shard' }; break;
        case 'pick': pickCard(state, uid); break;
        case 'closedeck': state.deck = null; break;
        case 'restart': restart(state); break;
        case 'giveup': if (confirmGiveUp(state)) giveUp(run); break;
        default: return;
    }

    afterAction(state);
    state.deal = false;
}

// Общий хвост любого действия: незакрытый выбор, конец забега, сохранение и
// перерисовка. Раньше это был хвост onClick, но бой ходит теми же путями из
// своих асинхронных функций, и второй копии этих четырёх строк быть не должно.
function afterAction(state) {
    const run = state.run;
    if (run.pending?.t === 'remove') state.deck = { mode: 'remove' };
    if (run.over) finish(state);
    store(state);
    render(state);
}

function pickCard(state, uid) {
    const run = state.run;
    const mode = state.deck?.mode;
    if (mode === 'stone') {
        const res = useStone(run, uid);
        if (res.ok) state.note = `«${cardView(run, res.card).name}» теперь ${res.card.lvl} уровня.`;
        if (!run.stones) state.deck = { mode: 'view' };
    } else if (mode === 'shard') {
        const res = useShard(run, uid);
        if (res.ok) {
            const m = mutationList(res.card).find(x => x.id === res.mutation);
            state.note = `«${cardView(run, res.card).name}»: ${m.name} — ${m.text}.`;
        }
        if (!run.shards) state.deck = { mode: 'view' };
    } else if (mode === 'remove') {
        const res = removeCard(run, uid);
        if (res.ok) state.deck = null;
        else if (res.reason === 'too_small') state.note = 'В колоде и так почти ничего не осталось.';
    }
}

function handleKey(state, e, close) {
    if (e.key === 'Escape') {
        e.preventDefault();
        if (state.deck && state.run.pending?.t !== 'remove') { state.deck = null; render(state); return; }
        close();
        return;
    }
    const run = state.run;
    if (state.deck || run.screen !== SCREEN_BATTLE) return;

    // Цифры — карты в руке, пробел и Enter — передать ход. Мышью играть можно
    // и так, а вот про клавиши догадаться нельзя — они подписаны под рукой.
    if (state.busy) return;
    if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const i = Number(e.key) - 1;
        if (i < run.battle.hand.length) doPlay(state, i);
        return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        doEnd(state);
    }
}

function shake(state, el) {
    el.classList.remove('rg-shake');
    void el.offsetWidth;   // перезапуск анимации: без этого второй клик молчит
    el.classList.add('rg-shake');
}

function confirmGiveUp(state) {
    return window.confirm('Сдаться? Забег закончится, результат уйдёт в топ.');
}

function restart(state) {
    state.run = startRun();
    state.deck = null;
    state.table = null;
    state.handView = null;
    state.foeIntent = null;
    state.busy = false;
    state.phase = null;
    state.shown = null;
    state.sent = false;
    state.note = '';
    startTick(state);
}

// ── Отрисовка ────────────────────────────────────────────────────────────────

function render(state) {
    const run = state.run;
    // Незакрытый выбор «выбросить карту» — это не экран, а долг: пока он висит,
    // забег не двигается. Ставим колоду сами, в том числе когда забег подняли из
    // localStorage прямо на этом месте.
    if (run.pending?.t === 'remove' && state.deck?.mode !== 'remove') state.deck = { mode: 'remove' };
    state.modal.querySelector('#rg-hud').innerHTML = hudHtml(state);
    const note = state.modal.querySelector('#rg-note');
    note.innerHTML = state.note ? esc(state.note) : '';
    note.classList.toggle('is-show', !!state.note);

    const view = state.modal.querySelector('#rg-view');
    if (state.deck) { view.innerHTML = deckHtml(state); fitTexts(state); return; }
    // Пока идёт показ хода, окно ОСТАЁТСЯ на бою, даже если правила уже увели
    // экран к награде: цифры и полосы обязаны доиграть на том столе, где
    // начались, иначе последний удар игрок просто не увидит.
    const screen = state.busy && run.battle ? SCREEN_BATTLE : run.screen;
    switch (screen) {
        case SCREEN_BATTLE: view.innerHTML = battleHtml(state); fitTable(state); layoutHand(state); break;
        case SCREEN_REWARD: view.innerHTML = rewardHtml(state); break;
        case SCREEN_EVENT:  view.innerHTML = eventHtml(state); break;
        case SCREEN_OVER:   view.innerHTML = overHtml(state); break;
        default:            view.innerHTML = mapHtml(state); scrollMap(state); break;
    }
    fitTexts(state);
}

// Карта нарисована снизу вверх и в окно целиком не влезает, поэтому её
// прокручивают К СЕБЕ: игрок должен видеть, где стоит и куда может пойти, а не
// босса в конце цикла, до которого ещё десять узлов.
function scrollMap(state) {
    const box = state.modal.querySelector('#rg-map');
    if (!box) return;
    const here = box.querySelector('.rg-node.is-open') || box.querySelector('.rg-node.is-here');
    if (!here) { box.scrollTop = box.scrollHeight; return; }
    // Считаем по прямоугольникам, а не по offsetTop: у строк карты своя
    // позиция (они position: relative ради значков), и offsetTop у узла
    // отсчитывается от СТРОКИ, то есть всегда ноль.
    const top = here.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    box.scrollTop = Math.max(0, top - box.clientHeight + here.offsetHeight + 24);
}

function hudHtml(state) {
    const run = state.run;
    const low = run.hp * 3 < run.maxHp ? ' is-low' : '';
    // В бою здоровье показывает СТОЛ, и показывает честно — по ходу боя. В шапке
    // же лежит здоровье забега, которое правила обновляют только по окончании
    // боя: два числа рядом, одно из них устаревшее, — это хуже, чем одно.
    const inBattle = run.screen === SCREEN_BATTLE || (state.busy && run.battle);
    return `
        ${inBattle ? '' : `<div class="rg-vitals${low}">${vitalsHtml(run.hp, run.maxHp, 0)}</div>`}
        <div class="rg-chip" title="Пройдено циклов: карта генерируется заново, враги сильнее">
            Цикл <b>${run.loop}</b>
        </div>
        <div class="rg-chip" title="Узел на карте цикла">Узел <b>${Math.max(0, run.at.row + 1)}</b>/${MAP_ROWS}</div>
        <button type="button" class="rg-chip is-btn" data-act="deck">Колода <b>${run.deck.length}</b></button>
        ${run.stones ? `<button type="button" class="rg-chip is-btn is-stone" data-act="stone" title="Точильный камень: +1 уровень карте">◆ <b>${run.stones}</b></button>` : ''}
        ${run.shards ? `<button type="button" class="rg-chip is-btn is-shard" data-act="shard" title="Осколок мутации: случайная мутация на карту">✦ <b>${run.shards}</b></button>` : ''}`;
}

// ── Карта узлов ──────────────────────────────────────────────────────────────
// Рисуется СНИЗУ ВВЕРХ: старт внизу, босс наверху — так карту читают в этом
// жанре, и так же видно, сколько ещё идти. Дороги — настоящие линии поверх
// сетки: без них «выбор пути» превращается в ряды непонятно как связанных
// значков.

function mapHtml(state) {
    const run = state.run;
    const { rows, links } = run.map;
    const open = nextNodes(run);
    const reachable = new Set(open.map(o => `${o.row}:${o.i}`));

    const y = r => ((rows.length - 1 - r) + 0.5) / rows.length * 100;
    const x = (i, len) => (i + 0.5) / len * 100;

    const lines = [];
    for (let r = 0; r < rows.length - 1; r++) {
        for (let i = 0; i < rows[r].length; i++) {
            for (const j of links[r][i]) {
                const hot = reachable.has(`${r + 1}:${j}`) && run.at.row === r && run.at.i === i;
                lines.push(`<line x1="${x(i, rows[r].length)}%" y1="${y(r)}%"
                                  x2="${x(j, rows[r + 1].length)}%" y2="${y(r + 1)}%"
                                  class="rg-link${hot ? ' is-hot' : ''}"/>`);
            }
        }
    }

    const rowsHtml = rows.map((row, r) => `
        <div class="rg-map-row">
            ${row.map((node, i) => {
                const info = NODE_INFO[node.t];
                const here = run.at.row === r && run.at.i === i;
                const can = reachable.has(`${r}:${i}`);
                const cls = ['rg-node', `n-${node.t}`];
                if (here) cls.push('is-here');
                if (can) cls.push('is-open');
                if (r < run.at.row) cls.push('is-past');
                return `<button type="button" class="${cls.join(' ')}"
                                ${can ? `data-act="node" data-i="${i}"` : 'disabled'}
                                title="${esc(info.name)}">
                            <span class="rg-node-sign">${info.sign}</span>
                            <span class="rg-node-name">${esc(info.name)}</span>
                        </button>`;
            }).join('')}
        </div>`).reverse().join('');

    // Дороги лежат ВНУТРИ обёртки, а не в прокручиваемом контейнере: проценты
    // SVG считаются от высоты своего родителя, и в самом контейнере линии
    // растянулись бы по видимой части, а не по всей карте.
    return `
        <div class="rg-map" id="rg-map">
            <div class="rg-map-inner">
                <svg class="rg-map-links" aria-hidden="true">${lines.join('')}</svg>
                ${rowsHtml}
            </div>
        </div>
        <div class="rg-map-foot">
            ${open.length
                ? '<span class="rg-hint">Выберите, куда идти дальше.</span>'
                : '<span class="rg-hint">Цикл пройден.</span>'}
            <button type="button" class="btn btn-sec rg-giveup" data-act="giveup">Сдаться</button>
        </div>
        ${topHtml(state)}`;
}

// ── Бой: стол ────────────────────────────────────────────────────────────────
// Стол устроен как в карточных играх, из которых эта пасхалка и растёт: враг
// сверху со своим намерением, посередине — то, что уже выложено в этот ход,
// внизу рука ВЕЕРОМ. Карты в веере наезжают друг на друга тем сильнее, чем их
// больше: рука из девяти карт, разложенная в ряд, либо не влезает в окно, либо
// делает карточки нечитаемыми.
//
// ПОЧЕМУ КАРТА СРАБАТЫВАЕТ СРАЗУ, А НЕ ПРИ ПЕРЕДАЧЕ ХОДА. Соблазн «выложить
// несколько карт, нажать ход и посмотреть, как они applyются по очереди» есть, но
// он ломает половину колоды: «Сосредоточение» тянет карты, которые нужны в ЭТОМ
// ходу, «Адреналин» даёт энергию на следующую карту, «Ответ» смотрит, есть ли у
// тебя блок ПРЯМО СЕЙЧАС. Отложенный розыгрыш превращает их в мусор, а ход — в
// ставку вслепую. Поэтому карта применяется сразу, а «по очереди и с показом»
// сделан сам показ: карта улетает из руки на стол, над врагом отлетают цифры,
// полоса здоровья едет вниз — и только потом можно кликать дальше.
//
// Как это устроено: правила считают ход целиком и мгновенно, но пишут КАЖДЫЙ
// шаг в журнал (takeLog из shared/roguelike.js). Окно проигрывает журнал по
// событию, а полосы рисует не из состояния движка, а из state.shown — своей
// копии, которую журнал и двигает. Иначе полоса прыгала бы в конечное значение
// раньше, чем игрок увидит, из-за чего оно такое.

function battleHtml(state) {
    const run = state.run;
    const b = run.battle;
    const e = enemyView(run);
    const s = shownOf(state);
    const hero = b.hero;

    // Стол — заявка игрока на этот ход. Во время показа он берётся из копии
    // окна: правила к этому моменту уже сыграли его целиком.
    const board = (state.table ?? b.board)
        .map(uid => cardOf(run, uid))
        .filter(Boolean)
        .map(card => cardHtml(cardView(run, card), { small: true }))
        .join('');

    const hand = (state.handView ?? b.hand).map((uid, i) => {
        const view = cardView(run, cardOf(run, uid));
        return cardHtml(view, { i, dim: view.cost > hero.energy, key: i + 1, deal: state.deal });
    }).join('');

    const heroLow = s.heroHp * 3 < hero.maxHp ? ' is-low' : '';
    return `
        <div class="rg-table${state.phase === 'enemy' ? ' is-enemy-turn' : ''}">
            <div class="rg-foe" id="rg-foe">
                <div class="rg-foe-head">
                    <span class="rg-foe-name">${esc(e.name)}</span>
                    ${e.kind === NODE_BOSS ? '<span class="rg-tag is-boss">босс</span>'
                      : e.kind === NODE_ELITE ? '<span class="rg-tag is-elite">элита</span>' : ''}
                    <span class="rg-mods">${e.mods.map(m =>
                        `<i class="rg-mod" title="${esc(m.name)}: ${esc(m.hint)}">${esc(m.name)}</i>`).join('')}</span>
                </div>
                <div class="rg-foe-figure">
                    <div class="rg-art rg-foe-art e-${e.id}" id="rg-foe-art" aria-hidden="true">
                        <span>${esc(e.name[0])}</span>
                    </div>
                    <div class="rg-pops" id="rg-foe-pops"></div>
                </div>
                <div class="rg-vitals" id="rg-foe-vitals">${vitalsHtml(s.enemyHp, e.maxHp, s.enemyBlock)}</div>
                <div class="rg-badges" id="rg-foe-badges">${statusesHtml(e.st)}</div>
                <div class="rg-intent" id="rg-intent">${intentBoxHtml(state)}</div>
            </div>

            <div class="rg-board" id="rg-board">
                ${board || '<span class="rg-board-hint">Тяните карту сюда — сработает по «Ходу»</span>'}
            </div>

            <div class="rg-me" id="rg-me">
                <div class="rg-me-side">
                    <div class="rg-vitals${heroLow}" id="rg-me-vitals">${vitalsHtml(s.heroHp, hero.maxHp, s.heroBlock)}</div>
                    <div class="rg-badges" id="rg-me-badges">
                        ${statusesHtml(hero.st)}
                        ${b.wardEach ? `<i class="rg-status s-str" title="«Запас»: в начале каждого хода броня растёт">запас ${b.wardEach}</i>` : ''}
                    </div>
                </div>
                <div class="rg-energy" title="Энергия: на столько ещё можно выложить карт в этот ход">
                    <b>${s.energy}</b><span>/${hero.maxEnergy}</span>
                </div>
                <button type="button" class="btn btn-pri rg-end" data-act="end"
                        title="Стол сработает слева направо, потом сходит враг"
                        ${state.busy ? 'disabled' : ''}>Ход ▸</button>
                <div class="rg-pops" id="rg-me-pops"></div>
            </div>

            <div class="rg-hand" id="rg-hand">${hand}</div>

            <div class="rg-battle-foot">
                <span class="rg-piles">Колода <b>${b.draw.length}</b> · Сброс <b>${b.discard.length}</b>${b.exhaust.length ? ` · Изгнано <b>${b.exhaust.length}</b>` : ''}</span>
                <span class="rg-hint">Клавиши <kbd>1</kbd>…<kbd>${HAND_SIZE}</kbd> — карта на стол, <kbd>пробел</kbd> — ход</span>
            </div>
        </div>`;
}

/**
 * Здоровье и броня — ЧИСЛАМИ, а не полосами.
 *
 * Полоса отвечает на вопрос «много или мало», а в этой игре весь расчёт хода
 * идёт в целых числах: «бьёт 12, у меня 7 брони и 9 здоровья» — тут нужно
 * ТОЧНОЕ значение, и глазами по полоске его не снять. Ровно поэтому в карточных
 * играх над героем стоит цифра, а не индикатор.
 *
 * Броня показывается отдельным числом и только когда она есть: ноль брони —
 * это не состояние, о котором нужно сообщать.
 */
function vitalsHtml(hp, maxHp, armor) {
    return `<span class="rg-vital is-hp" title="Здоровье">
                <i>♥</i><b>${hp}</b><u>/${maxHp}</u>
            </span>`
        + (armor > 0
            ? `<span class="rg-vital is-armor" title="Броня: снимается раньше здоровья и НЕ сгорает в конце хода — остаток переходит на следующий ход">
                   <i>◈</i><b>${armor}</b>
               </span>`
            : '');
}

/**
 * Панель намерения. Во время показа хода она рисуется НЕ из правил: правила уже
 * прокрутили ход вперёд и загадали врагу СЛЕДУЮЩЕЕ намерение, а игрок в этот
 * момент смотрит на предыдущее — то, под которое он и выкладывал карты.
 */
function intentBoxHtml(state) {
    if (state.phase === 'enemy') return '<span class="rg-intent-act is-now">Ходит…</span>';
    return intentHtml(state.foeIntent ?? intentView(state.run));
}

function intentHtml(intent) {
    if (!intent) return '';
    const acts = intent.acts.map(a => {
        // Намерение подписано СЛОВАМИ, а не значками: «меч» половина шрифтов
        // рисует цветной картинкой, а число рядом с ним читается как что угодно.
        // «Бьёт 12» не читается никак иначе.
        if (a.t === I_ATTACK) {
            return `<span class="rg-intent-act is-atk" title="Столько урона прилетит в ваш ход">
                        Бьёт <b>${a.v}</b>${a.times > 1 ? `<i>×${a.times}</i>` : ''}</span>`;
        }
        if (a.t === I_BLOCK) {
            return `<span class="rg-intent-act is-blk" title="Закроется блоком">Закроется на <b>${a.v}</b></span>`;
        }
        const info = STATUS_INFO[a.s];
        return `<span class="rg-intent-act is-st" title="${esc(info.name)}: ${esc(info.hint)}">
                    ${esc(info.name)} <b>${a.v}</b>${a.to === 'self' ? ' себе' : ''}</span>`;
    }).join('');
    return `<span class="rg-intent-label">Намерение:</span>${acts}` +
        (intent.twice ? '<span class="rg-intent-act is-twice" title="Ускоренный: в этот ход он сходит дважды">дважды</span>' : '');
}

function statusesHtml(st) {
    return Object.entries(st || {}).filter(([, v]) => v > 0).map(([s, v]) => {
        const info = STATUS_INFO[s];
        return `<i class="rg-status s-${s}" title="${esc(info.name)}: ${esc(info.hint)}">${info.sign} ${v}</i>`;
    }).join('');
}

// ── Показ хода ───────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Системная настройка «меньше движения» выключает полёты карт и укорачивает
// паузы. Именно укорачивает, а не убирает: показ здесь — не украшение, а
// единственный способ понять, что произошло за ход врага.
function calm() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// Сколько держать событие на экране. Удар — самое важное, ему больше всех;
// «ход врага» — пауза перед его действиями.
const EVENT_MS = {
    cast: 300, sweep: 300, hit: 340, poison: 360, heal: 300,
    block: 240, status: 240, turn: 420, over: 420,
};

/** Полосы и числа берутся отсюда: во время показа они отстают от правил. */
function shownOf(state) {
    const b = state.run.battle;
    return state.shown || {
        heroHp: b.hero.hp, heroBlock: b.hero.block, energy: b.hero.energy,
        enemyHp: b.enemy.hp, enemyBlock: b.enemy.block,
    };
}

function snapshot(state) {
    const b = state.run.battle;
    state.shown = {
        heroHp: b.hero.hp, heroBlock: b.hero.block, energy: b.hero.energy,
        enemyHp: b.enemy.hp, enemyBlock: b.enemy.block,
    };
}

async function playLog(state) {
    const events = takeLog(state.run);
    for (const ev of events) {
        if (openState !== state) return;      // окно закрыли посреди показа
        applyEvent(state, ev);
        await sleep(calm() ? 60 : (EVENT_MS[ev.t] ?? 180));
    }
}

function applyEvent(state, ev) {
    const s = state.shown;
    if (!s) return;
    const who = ev.who;
    switch (ev.t) {
        case 'hit':
            if (who === 'enemy') { s.enemyHp = ev.hp; s.enemyBlock = ev.block; }
            else { s.heroHp = ev.hp; s.heroBlock = ev.block; }
            if (ev.src === 'enemy') lunge(state);
            // Полностью съеденный блоком удар — это не «−0», а событие: игрок
            // ради него и ставил блок.
            pop(state, who, ev.real ? `−${ev.real}` : 'блок', ev.real ? 'is-dmg' : 'is-blocked');
            if (ev.real) hurt(state, who);
            break;
        case 'poison':
            if (who === 'enemy') s.enemyHp = ev.hp; else s.heroHp = ev.hp;
            pop(state, who, `−${ev.v} яд`, 'is-poison');
            break;
        case 'heal':
            if (who === 'enemy') s.enemyHp = ev.hp; else s.heroHp = ev.hp;
            pop(state, who, `+${ev.v}`, 'is-heal');
            break;
        case 'block':
            if (who === 'enemy') s.enemyBlock = ev.block; else s.heroBlock = ev.block;
            pop(state, who, `◈ +${ev.v}`, 'is-block');
            break;
        case 'status':
            pop(state, who, `${STATUS_INFO[ev.s].name} ${ev.v}`, 'is-status');
            break;
        case 'cast':
            // Карта со стола пошла в дело. Ровно по этой отметке стол и
            // подсвечивается слева направо: правила посчитали ход целиком, а
            // окно идёт по журналу и показывает, чья это была цифра.
            castCard(state, ev.uid);
            break;
        case 'sweep':
            // Невыложенная рука ушла в сброс. Показать это надо: карта, которую
            // не положили на стол, потеряна, и игрок должен видеть цену.
            sweepHand(state);
            break;
        case 'turn':
            // Отметка «дальше ходит враг»: без неё его удары выглядят
            // продолжением хода игрока.
            state.phase = 'enemy';
            paintIntent(state);
            flag(state, 'Ход врага');
            break;
        case 'over':
            flag(state, ev.result === 'win' ? 'Победа' : 'Поражение');
            break;
    }
    paintBattle(state);
}

/** Полосы и плашки — точечно: перерисовывать окно на каждое событие незачем. */
function paintBattle(state) {
    const b = state.run.battle;
    if (!b) return;
    const s = shownOf(state);
    const set = (sel, fn) => { const el = state.modal.querySelector(sel); if (el) fn(el); };
    set('#rg-foe-vitals', el => { el.innerHTML = vitalsHtml(s.enemyHp, b.enemy.maxHp, s.enemyBlock); });
    set('#rg-me-vitals', el => {
        el.innerHTML = vitalsHtml(s.heroHp, b.hero.maxHp, s.heroBlock);
        el.classList.toggle('is-low', s.heroHp * 3 < b.hero.maxHp);
    });
    set('#rg-foe-badges', el => { el.innerHTML = statusesHtml(b.enemy.st); });
    set('#rg-me-badges', el => { el.innerHTML = statusesHtml(b.hero.st); });
}

function paintIntent(state) {
    const el = state.modal.querySelector('#rg-intent');
    if (el) el.innerHTML = intentBoxHtml(state);
}

/** Подсветить карту, которая срабатывает сейчас; предыдущую — погасить. */
function castCard(state, uid) {
    const board = state.modal.querySelector('#rg-board');
    if (!board) return;
    board.querySelectorAll('.rg-card.is-cast').forEach(el => {
        el.classList.remove('is-cast');
        el.classList.add('is-done');
    });
    board.querySelector(`.rg-card[data-uid="${uid}"]`)?.classList.add('is-cast');
}

/** Смахнуть невыложенную руку в сброс. */
function sweepHand(state) {
    state.handView = [];
    const cards = state.modal.querySelectorAll('#rg-hand .rg-card');
    cards.forEach((el, i) => {
        if (calm()) { el.style.opacity = '0'; return; }
        el.style.transition = `transform .3s ease-in ${i * 26}ms, opacity .3s ease-in ${i * 26}ms`;
        el.style.transform = 'translate(30vw, 24vh) scale(.5) rotate(14deg)';
        el.style.opacity = '0';
    });
}

/** Улетающее число над бойцом. */
function pop(state, who, text, cls) {
    const box = state.modal.querySelector(who === 'enemy' ? '#rg-foe-pops' : '#rg-me-pops');
    if (!box) return;
    const el = document.createElement('span');
    el.className = `rg-pop ${cls}`;
    el.textContent = text;
    // Разброс по горизонтали, чтобы два удара подряд не легли друг на друга.
    el.style.setProperty('--dx', `${(box.children.length % 3 - 1) * 26}px`);
    box.appendChild(el);
    setTimeout(() => el.remove(), 900);
}

function hurt(state, who) {
    const el = state.modal.querySelector(who === 'enemy' ? '#rg-foe-art' : '#rg-me');
    if (!el || calm()) return;
    el.classList.remove('is-hurt');
    void el.offsetWidth;
    el.classList.add('is-hurt');
}

function lunge(state) {
    const el = state.modal.querySelector('#rg-foe-art');
    if (!el || calm()) return;
    el.classList.remove('is-lunge');
    void el.offsetWidth;
    el.classList.add('is-lunge');
}

function flag(state, text) {
    const el = state.modal.querySelector('#rg-view');
    if (!el) return;
    const flagEl = document.createElement('div');
    flagEl.className = 'rg-flag';
    flagEl.textContent = text;
    el.appendChild(flagEl);
    setTimeout(() => flagEl.remove(), 900);
}

// ── Действия в бою ───────────────────────────────────────────────────────────
// Ход игрока — ЗАЯВКА: он выкладывает карты на стол (энергия тратится сразу,
// но ничего не происходит), а по «Ходу» стол срабатывает слева направо, и
// только тогда видно, что вышло. Правила считают всё мгновенно, окно
// проигрывает журнал.

/** Выложить карту на стол. Она долетает из руки на своё место (FLIP). */
function doPlay(state, i) {
    const run = state.run;
    const b = run.battle;
    if (state.busy || !b || b.over) return;
    const uid = b.hand[i];
    if (uid === undefined) return;
    const card = cardOf(run, uid);

    const el = state.modal.querySelector(`#rg-hand .rg-card[data-i="${i}"]`);
    if (costOf(run, card) > b.hero.energy) { if (el) shake(state, el); return; }

    const from = el?.getBoundingClientRect();
    state.note = '';
    playCard(run, i);
    afterAction(state);
    flyIn(state, uid, from);
}

/**
 * Долёт карты из руки на стол.
 *
 * Считается FLIP-ом: карта уже нарисована на СВОЁМ месте на столе, и мы лишь
 * сдвигаем её обратно в руку и отпускаем. Так она приезжает точно туда, где
 * лежит, — в отличие от полёта «примерно к середине стола», после которого
 * карта в конце дёргалась на своё настоящее место.
 */
function flyIn(state, uid, from) {
    if (!from || calm()) return;
    const el = state.modal.querySelector(`#rg-board .rg-card[data-uid="${uid}"]`);
    if (!el) return;
    const to = el.getBoundingClientRect();
    const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
    const dy = (from.top + from.height / 2) - (to.top + to.height / 2);
    const k = to.width ? from.width / to.width : 1;
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${k})`;
    requestAnimationFrame(() => {
        el.style.transition = 'transform .26s cubic-bezier(.2, .8, .3, 1)';
        el.style.transform = '';
    });
}

/** Передать ход: стол играет слева направо, потом ходит враг, потом раздача. */
async function doEnd(state) {
    const run = state.run;
    const b = run.battle;
    if (state.busy || !b || b.over) return;

    state.busy = true;
    state.note = '';
    snapshot(state);
    // Копии стола, руки и намерения на время показа: правила сейчас сыграют ход
    // целиком и оставят пустой стол, новую руку и уже другое намерение врага.
    state.table = b.board.slice();
    state.handView = b.hand.slice();
    state.foeIntent = intentView(run);
    state.phase = 'cast';

    endTurn(run);
    render(state);
    await playLog(state);

    state.table = null;
    state.handView = null;
    state.foeIntent = null;
    state.phase = null;
    state.shown = null;
    state.busy = false;
    state.deal = true;          // новая рука приезжает с раздачей
    afterAction(state);
    state.deal = false;
}

// ── Рука: веер, наведение и перетаскивание ───────────────────────────────────
// Раскладку считает JS, а не CSS: шаг между картами зависит и от их числа, и от
// ширины окна, а такого calc в CSS не написать.
//
// ПОДНЯТАЯ КАРТА ВЫБИРАЕТСЯ ПО КУРСОРУ, а не по :hover, и это не блажь. Карты
// лежат внахлёст; поднимаясь, карта уезжает из-под курсора, курсор попадает на
// соседку — она поднимается, первая опускается, и веер начинает дрожать.
// Поэтому за наведение отвечает ОДИН обработчик на всю руку: он берёт ближайшую
// по горизонтали карту и поднимает её, что бы там ни думал браузер про :hover.
//
// Карта не «нажимается», а ВЫТЯГИВАЕТСЯ на стол — тем же указателем, что и на
// телефоне. Короткий клик тоже играет: тянуть мышью каждую карту утомительно.

const DRAG_SLOP = 6;        // на столько можно дрогнуть рукой, это ещё клик

/**
 * Подогнать стол под окно.
 *
 * Ширина карточки задана в vw, а высота окна ограничена высотой экрана — на
 * ноутбуке рука уезжала под нижний край, и выложить карту становилось нельзя,
 * не доскроллив. Считаем свободную высоту и берём такую карточку, чтобы стол и
 * рука в неё поместились: враг, счётчики и подпись снизу от размера карточки не
 * зависят, поэтому одного прохода хватает.
 */
const HAND_RATIO = 1.46;    // высота руки в ширинах карточки (см. .rg-hand)
const BOARD_RATIO = 0.92;   // и высота стола (см. .rg-board)

function fitTable(state) {
    const win = state.modal.querySelector('.rg-win');
    const table = state.modal.querySelector('.rg-table');
    const view = state.modal.querySelector('#rg-view');
    if (!win || !table || !view) return;
    // Второй проход нужен из-за портрета врага: он тоже меряется в карточках, и
    // после первой подгонки шапка стола становится ниже — значит, карточке
    // достаётся больше места, чем мы насчитали.
    for (let pass = 0; pass < 2; pass++) {
        const free = view.clientHeight
            - height(state, '.rg-foe') - height(state, '.rg-me') - height(state, '.rg-battle-foot')
            - (table.offsetHeight - table.clientHeight)              // рамка стола
            - 40;                                                    // отступы, зазоры и запас
        const w = Math.max(72, Math.min(132, free / (HAND_RATIO + BOARD_RATIO)));
        win.style.setProperty('--rg-card-w', `${Math.round(w)}px`);
    }
}

function height(state, sel) {
    return state.modal.querySelector(sel)?.offsetHeight || 0;
}

function layoutHand(state) {
    const box = state.modal.querySelector('#rg-hand');
    if (!box) return;
    const cards = [...box.querySelectorAll('.rg-card')];
    const n = cards.length;
    if (!n) return;
    // Рука нарисована заново, и поднятой карты в ней нет — иначе следующее
    // наведение на то же место посчитает, что карта уже поднята, и промолчит.
    state.raised = -1;
    // Раскладку веера ставим БЕЗ анимации: карточки только что созданы, и
    // сглаживание превратило бы каждую перерисовку в разъезжание руки из
    // стопки. Плавным остаётся то, ради чего сглаживание и нужно, — подъём
    // карты под курсором и её возврат.
    box.classList.add('is-still');
    const cardW = cards[0].offsetWidth || 120;
    const room = box.clientWidth - cardW - 8;
    // Чем больше карт, тем сильнее нахлёст: шаг ужимается до того, что влезает.
    const step = n > 1 ? Math.min(cardW * 0.86, Math.max(cardW * 0.24, room / (n - 1))) : 0;
    // Общий разворот веера растёт с числом карт, но не бесконечно: за 26° карта
    // с краю встаёт слишком косо, и текст на ней уже не читается.
    const spread = Math.min(5.5 * (n - 1), 26);
    cards.forEach((el, i) => {
        const t = n === 1 ? 0 : i / (n - 1) - 0.5;       // −0.5 … 0.5
        el.style.setProperty('--i', String(i));
        el.style.setProperty('--x', `${(i - (n - 1) / 2) * step}px`);
        el.style.setProperty('--y', `${n > 2 ? t * t * 26 : 0}px`);
        el.style.setProperty('--a', `${spread * t}deg`);
        el.style.zIndex = String(10 + i);
    });
    void box.offsetWidth;                       // применяем раскладку этим же кадром
    requestAnimationFrame(() => box.classList.remove('is-still'));
    handInput(state, box, cards);
}

function handInput(state, box, cards) {
    // Обработчики вешаются на свежую руку после каждой перерисовки — старые
    // уезжают вместе со старым DOM, снимать их не нужно.
    box.addEventListener('pointermove', e => {
        if (state.drag) { dragMove(state, e); return; }
        raise(state, cards, nearest(cards, e.clientX));
    });
    box.addEventListener('pointerleave', () => { if (!state.drag) raise(state, cards, -1); });
    box.addEventListener('pointerdown', e => dragStart(state, cards, e));
    box.addEventListener('pointerup', e => dragEnd(state, e));
    box.addEventListener('pointercancel', () => dropDrag(state));
}

/** Ближайшая по горизонтали карта: у веера промежутков между картами нет. */
function nearest(cards, x) {
    let best = -1, dist = Infinity;
    cards.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        const d = Math.abs(x - (r.left + r.width / 2));
        if (d < dist) { dist = d; best = i; }
    });
    return best;
}

function raise(state, cards, i) {
    if (state.raised === i) return;
    state.raised = i;
    cards.forEach((el, k) => {
        el.classList.toggle('is-up', k === i);
        // Соседи расступаются — иначе поднятая карта закрывает их собой.
        el.style.setProperty('--push', i < 0 || k === i ? '0px' : `${k < i ? -12 : 12}px`);
    });
}

function dragStart(state, cards, e) {
    if (state.busy || e.button > 0) return;
    const el = e.target.closest('.rg-card');
    if (!el) return;
    e.preventDefault();
    state.drag = { el, i: Number(el.dataset.i), x0: e.clientX, y0: e.clientY, moved: false, id: e.pointerId };
    raise(state, cards, Number(el.dataset.i));
    el.setPointerCapture?.(e.pointerId);
    el.classList.add('is-drag');
}

function dragMove(state, e) {
    const d = state.drag;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > DRAG_SLOP) d.moved = true;
    d.el.style.setProperty('--dx', `${dx}px`);
    d.el.style.setProperty('--dy', `${dy}px`);
    const board = state.modal.querySelector('#rg-board');
    if (board) board.classList.toggle('is-target', overBoard(state, e.clientY));
}

/** Карту засчитываем сыгранной, если её вытянули из руки вверх. */
function overBoard(state, y) {
    const hand = state.modal.querySelector('#rg-hand');
    return !!hand && y < hand.getBoundingClientRect().top;
}

function dragEnd(state, e) {
    const d = state.drag;
    if (!d) return;
    const play = !d.moved || overBoard(state, e.clientY);
    dropDrag(state);
    if (play) doPlay(state, d.i);
}

function dropDrag(state) {
    const d = state.drag;
    state.drag = null;
    if (!d) return;
    d.el.classList.remove('is-drag');
    d.el.style.removeProperty('--dx');
    d.el.style.removeProperty('--dy');
    state.modal.querySelector('#rg-board')?.classList.remove('is-target');
}

// ── Карточка ─────────────────────────────────────────────────────────────────
// Одна вёрстка на всю игру: и рука в бою, и стол, и лут, и колода.
//
// Карточка бывает ДВУХ ВИДОВ, и это главное, что тут надо знать. Если для карты
// положена текстура (frontend/src/assets/roguelike/<id>.png), рисуется она, а
// поверх ложатся числа и описание. Если нет — карточка рисуется вёрсткой, как
// раньше. Колода дорисовывается не за один вечер, и игра не должна ждать
// последней картинки: смешанная рука выглядит переходным состоянием, а не
// поломкой.
//
// ЧИСЛА И ОПИСАНИЕ НА ТЕКСТУРЕ НЕ РИСУЮТСЯ НИКОГДА. Они меняются от уровня
// карты и от мутаций («Удар» 4 уровня с ×4 — это не «наносит 7 урона»), и
// напечатанные на картинке соврали бы в первый же апгрейд. Что где лежит —
// design/roguelike-cards/README.md.

function cardHtml(view, { i, act, dim = false, key = 0, small = false, deal = false } = {}) {
    const art = CARD_ART[view.id];
    const cls = [
        'rg-card', `k-${view.kind}`, `r-${view.rarity}`,
        art ? 'is-art' : '',
        dim ? 'is-dim' : '',
        small ? 'is-small' : '',
        deal ? 'is-deal' : '',
    ].filter(Boolean).join(' ');
    const attrs = `${act ? `data-act="${act}"` : ''} data-i="${i ?? ''}" data-uid="${view.uid}"`;
    const free = view.cost !== view.baseCost ? ' is-free' : '';
    const freeTitle = free ? ' title="Мутация «Разгон»: сейчас бесплатно"' : '';
    const lvl = view.lvl > 1
        ? `<span class="rg-card-lvl" title="Уровень: числа карты выросли">ур. ${view.lvl}</span>` : '';
    const muts = view.muts.map(m =>
        `<i title="${esc(m.name)}: ${esc(m.text)}">${m.mult ? '×' : '+'}${m.power} ${esc(m.name)}</i>`).join('');
    const mutsHtml = muts ? `<span class="rg-card-muts">${muts}</span>` : '';
    const keyHtml = key ? `<span class="rg-card-key">${key}</span>` : '';

    if (art) {
        // Числа кладутся в те самые пустые поля рамки: самоцвет стоимости слева
        // сверху, шар с уроном слева снизу, свиток описания посередине.
        // Координаты — в CSS процентами от карточки, а не тут.
        //
        // ШАР БЫВАЕТ ТОЛЬКО У АТАКИ — так решает движок (mainNumber), и здесь
        // ничего не выбирается: у умения рамка заклинания, шара на ней нет, а
        // блок, положенный на его место, читался бы как урон.
        //
        // Описание берётся artText: то, что уже стоит в шаре, второй раз
        // текстом не пишется — свиток маленький, и каждая лишняя строка
        // выдавливает нужную.
        return `
            <button type="button" class="${cls}" ${attrs} style="background-image:url(${art})">
                <span class="rg-card-cost${free}"${freeTitle}>${view.cost}</span>
                ${view.power ? `<span class="rg-card-power is-${view.power.t}">${view.power.v}</span>` : ''}
                ${view.artText ? `<span class="rg-card-desc">${esc(view.artText)}</span>` : ''}
                ${lvl}${mutsHtml}${keyHtml}
            </button>`;
    }

    return `
        <button type="button" class="${cls}" ${attrs}>
            <span class="rg-card-cost${free}"${freeTitle}>${view.cost}</span>
            ${lvl}
            <span class="rg-card-name">${esc(view.name)}</span>
            <span class="rg-art rg-card-art c-${view.id}" aria-hidden="true"><span>${esc(view.name[0])}</span></span>
            <span class="rg-card-text">${esc(view.text)}</span>
            ${mutsHtml}${keyHtml}
        </button>`;
}

/**
 * Подогнать описание под свиток рамки.
 *
 * Длина текста у карты не фиксирована и знать её заранее нельзя: описание
 * собирает движок из эффектов, и оно растёт от мутаций и уровня («Ещё 9 урона,
 * если рука пуста» плюс две мутации). Обрезать текст рамкой нельзя — карта
 * перестаёт объяснять, что делает, — поэтому шрифт УМЕНЬШАЕТСЯ, как на
 * настоящих карточках.
 *
 * Меряем, а не считаем по числу букв: одна и та же длина в разных словах
 * переносится по-разному, а после подгрузки шрифта метрики ещё и меняются
 * (отсюда повторный проход по document.fonts.ready).
 */
const DESC_STEPS = [1, 0.92, 0.85, 0.78, 0.72, 0.66];

function fitTexts(state) {
    fitPass(state);
    // Второй проход следующим кадром. Первый иногда меряет ещё запасным
    // шрифтом: браузер берётся грузить наш ровно в тот момент, когда впервые
    // встречает его в разметке, — то есть прямо на этой отрисовке, и разница в
    // метриках даёт лишнюю строку.
    requestAnimationFrame(() => { if (openState === state) fitPass(state); });
}

function fitPass(state) {
    const nodes = state.modal.querySelectorAll('.rg-card.is-art .rg-card-desc');
    for (const el of nodes) {
        for (const k of DESC_STEPS) {
            el.style.setProperty('--fit', String(k));
            if (el.scrollHeight <= el.clientHeight + 1) break;
        }
    }
}

// ── Награда ──────────────────────────────────────────────────────────────────

function rewardHtml(state) {
    const run = state.run;
    const r = run.reward;
    const cards = r.cards.map((id, i) => {
        const view = cardView(run, { uid: -1 - i, id, lvl: 1, mut: {} });
        return cardHtml(view, { i, act: 'reward' });
    }).join('');
    const loot = [];
    if (r.stone) loot.push('<span class="rg-loot is-stone">◆ точильный камень</span>');
    if (r.shard) loot.push('<span class="rg-loot is-shard">✦ осколок мутации</span>');

    return `
        <div class="rg-reward">
            <div class="rg-screen-head">
                ${run.battle ? 'Победа' : 'Сундук'}
                ${loot.length ? `<span class="rg-loots">${loot.join('')}</span>` : ''}
            </div>
            <div class="rg-cards">${cards}</div>
            <div class="rg-reward-foot">
                <button type="button" class="btn btn-sec" data-act="reward" data-i="-1">
                    Пропустить и вылечиться на ${SKIP_HEAL}
                </button>
                <span class="rg-hint">Тонкая колода чаще тянет нужное — отказ тоже ход.</span>
            </div>
        </div>`;
}

// ── Событие ──────────────────────────────────────────────────────────────────

function eventHtml(state) {
    const def = EVENTS.find(e => e.id === state.run.event.id);
    const options = def.options.map((o, i) => `
        <button type="button" class="rg-option" data-act="event" data-i="${i}">
            <b>${esc(o.label)}</b><span>${esc(o.hint)}</span>
        </button>`).join('');
    return `
        <div class="rg-event">
            <div class="rg-screen-head">${esc(def.name)}</div>
            <p class="rg-event-text">${esc(def.text)}</p>
            <div class="rg-options">${options}</div>
        </div>`;
}

// ── Колода ───────────────────────────────────────────────────────────────────

function deckHtml(state) {
    const run = state.run;
    const mode = state.deck.mode;
    const head = {
        view: 'Колода',
        stone: `Точильный камень: какую карту улучшить? (осталось ${run.stones})`,
        shard: `Осколок мутации: на какую карту? (осталось ${run.shards})`,
        remove: 'Какую карту выбросить?',
    }[mode];
    const act = mode === 'view' ? '' : 'pick';

    // Колода показывается в том порядке, в каком она есть, а не отсортированной
    // по стоимости: игрок помнит свои карты по тому, когда их взял.
    const cards = run.deck.map((card, i) => cardHtml(cardView(run, card), { i, act })).join('');
    return `
        <div class="rg-deck">
            <div class="rg-screen-head">
                ${esc(head)}
                ${mode !== 'remove' ? '<button type="button" class="btn btn-sec" data-act="closedeck">Закрыть</button>' : ''}
            </div>
            ${mode === 'shard'
                ? '<p class="rg-hint">Мутацию выбирает случай, карту — вы. Та же мутация на ту же карту удваивает силу.</p>'
                : ''}
            <div class="rg-cards is-deck">${cards}</div>
        </div>`;
}

// ── Итог ─────────────────────────────────────────────────────────────────────

function overHtml(state) {
    const res = runResult(state.run);
    const line = (label, v) => `<div class="rg-res"><span>${label}</span><b>${v}</b></div>`;
    return `
        <div class="rg-over">
            <div class="rg-screen-head">Забег окончен</div>
            <div class="rg-results">
                ${line('Циклов пройдено', res.loops)}
                ${line('Узлов', res.floor)}
                ${line('Врагов побеждено', res.kills)}
                ${line('Элит и боссов', `${res.elites} / ${res.bosses}`)}
                ${line('Карт в колоде', res.cards)}
                ${line('Лучший уровень карты', res.level)}
                ${line('Мутаций', res.mutations)}
                ${line('Время', fmtTime(res.seconds))}
            </div>
            <div class="rg-over-actions">
                <button type="button" class="btn btn-pri" data-act="restart">Новый забег</button>
                <span class="rg-hint" id="rg-record"></span>
            </div>
            ${topHtml(state)}
        </div>`;
}

function fmtTime(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин ${s} с`;
}

// ── Мини-топ ─────────────────────────────────────────────────────────────────

async function loadTop(state) {
    try {
        const res = await state.ctx.apiFetch('/api/roguelike/top');
        if (openState !== state) return;
        state.top = res;
        render(state);
    } catch {
        // Без топа игра играется — говорим об этом одной строкой и всё.
        if (openState !== state) return;
        state.topFailed = true;
        render(state);
    }
}

function topHtml(state) {
    const data = state.top;
    if (!data) {
        return `<div class="rg-top">${state.topFailed
            ? '<div class="rg-top-head">Мини-топ</div><div class="rg-top-empty">Сервер не ответил — топ будет позже.</div>'
            : '<div class="rg-top-empty">Мини-топ загружается…</div>'}</div>`;
    }
    const rows = data.rows || [];
    const meId = state.ctx.user?.id;
    if (!rows.length) {
        return '<div class="rg-top"><div class="rg-top-head">Мини-топ по циклам</div>'
            + '<div class="rg-top-empty">Никто ещё не доходил — первый цикл будет вашим.</div></div>';
    }

    const list = rows.map(row => `
        <div class="rg-top-row${row.id === meId ? ' is-me' : ''}${row.rank === 1 ? ' is-first' : ''}">
            <span class="rg-top-rank">${row.rank}</span>
            <div class="rg-top-avatar">${row.avatar
                ? `<img src="${esc(row.avatar)}" alt=""/>`
                : '<span class="top-avatar-default"></span>'}</div>
            <div class="rg-top-name">${namePrefixHtml(row)}${esc(row.display_name)}</div>
            <span class="rg-top-score" title="Узлов пройдено: ${row.floor}">${row.loops} <i>${plural(row.loops, 'цикл', 'цикла', 'циклов')}</i></span>
        </div>`).join('');

    // Своя строка отдельно — только если в показанную десятку не попал: иначе
    // это был бы дубль той же строки, подсвеченной выше.
    const me = data.me;
    const inList = rows.some(r => r.id === meId);
    const mine = me && !inList
        ? `<div class="rg-top-row is-me is-mine-extra">
               <span class="rg-top-rank">${me.rank}</span>
               <div class="rg-top-name">Ваш рекорд</div>
               <span class="rg-top-score">${me.loops} <i>${plural(me.loops, 'цикл', 'цикла', 'циклов')}</i></span>
           </div>`
        : '';
    return `<div class="rg-top"><div class="rg-top-head">Мини-топ по циклам</div>
                <div class="rg-top-list">${list}</div>${mine}</div>`;
}

// ── Конец забега ─────────────────────────────────────────────────────────────

function finish(state) {
    stopTick(state);
    countTime(state);
    store(state);
    sendRun(state);
}

async function sendRun(state) {
    if (state.sending || state.sent) return;
    const res = runResult(state.run);
    // Забег, оборвавшийся на первом узле, в топ не несём: он никому не
    // интересен, а строку в базе завёл бы.
    if (res.floor < 2) { state.sent = true; return; }
    state.sending = true;
    try {
        const answer = await state.ctx.apiFetch('/api/roguelike/run', { method: 'POST', body: res });
        state.sent = true;
        if (openState !== state) return;
        if (answer && answer.ok) {
            state.top = { rows: answer.rows, me: answer.me };
            render(state);
            if (answer.improved) {
                const mark = state.modal.querySelector('#rg-record');
                if (mark) mark.innerHTML = '<b class="rg-record">Личный рекорд!</b>';
            }
        }
    } catch {
        // Сеть отвалилась — забег это не портит, результат просто не попал в
        // топ. Ругаться на человека за это нечем.
    }
    state.sending = false;
}

// ── Мелочи ───────────────────────────────────────────────────────────────────

function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
}

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
