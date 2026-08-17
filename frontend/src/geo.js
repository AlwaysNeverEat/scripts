// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Гео» — угадай место по панораме. Окно игры: меню, раунд, лобби.
//
// Открывается ТОЛЬКО из меню игр (games.js), а оно — из поиска на главной:
// набрать «игры» и нажать Enter.
//
// ЧЕМ ЭТО ОКНО ОТЛИЧАЕТСЯ ОТ ОСТАЛЬНЫХ ИГР. У тетриса, тройки и пасьянса
// правила лежат в shared/ и партия считается здесь; тут не так — СЧИТАЕТ ВСЁ
// СЕРВЕР, и не из-за парной дуэли, а потому что правильный ответ (координата)
// обязан лежать там, куда браузер не дотянется. Этот файл получает id панорамы,
// показывает её, ловит клик по карте и отправляет точку. Расстояние и очки
// приезжают в ответе.
//
// ТРИ РЕЖИМА В ОДНОМ ОКНЕ (дейли, соло, дуэль) и три экрана: меню, раунд и
// лобби дуэлей. Отдельными окнами их делать нельзя — окна пасхалок снимают с
// <body> класс modal-open, когда закрываются, и два окна подрались бы за него.
//
// Гугловский скрипт грузится по клику на режим, а не при открытии окна: это
// чужие сотни килобайт, и человеку, зашедшему посмотреть таблицу, они не нужны.
// Вся работа с ним — в geoStreet.js, здесь про Google нет ни строчки.
//
// ДУЭЛЬ ЖИВЁТ ОПРОСОМ раз в полторы секунды, как и бильярд: ходят одновременно,
// но раунд длится две минуты, и задержки в секунду там не видно. Веб-сокеты
// потребовали бы отдельной настройки nginx ради того, чего никто не заметит.
// ─────────────────────────────────────────────────────────────────────────────

import { namePrefixHtml } from './namePrefix.js';

const MODAL_ID = 'geo-modal';

// Как часто спрашиваем сервер о чужом ходе в дуэли.
const POLL_MS = 1500;

// Причины конца дуэли — человеческими словами.
const END_TEXT = {
    hp: 'здоровье кончилось',
    afk: 'соперник пропал',
    resign: 'сдача',
    rounds: 'раунды кончились',
    draw: 'ничья по здоровью',
    abandoned: 'партию бросили оба',
};

let openState = null;   // одно окно за раз

export function openGeo(ctx) {
    if (openState) return openState.modal;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'modal';
    modal.innerHTML = shellHtml();
    document.body.appendChild(modal);
    document.body.classList.add('modal-open');

    const state = {
        modal, ctx,
        cfg: null,
        maps: null, pano: null, panoMode: null, gmap: null,
        screen: 'menu',
        mode: null,          // daily | solo | duel
        guess: null,         // куда ткнули в этом раунде
        shownPano: null,     // какая панорама сейчас на экране
        daily: null,
        run: null,
        duel: null,
        poll: null,
        tick: null,
        offset: 0,           // на сколько врут часы браузера относительно сервера
        busy: false,
    };
    openState = state;

    const close = () => {
        stopPolling(state);
        document.removeEventListener('keydown', onKeyDown, true);
        state.pano?.destroy();
        state.gmap?.destroy();
        modal.remove();
        document.body.classList.remove('modal-open');
        openState = null;
    };

    const onKeyDown = (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        // Из раунда Escape возвращает в меню, а не закрывает окно: дейли и соло
        // живут на сервере и никуда не денутся, а дуэль продолжает идти — выйти
        // из неё и закрыть игру совсем не одно и то же.
        if (state.screen === 'menu') close();
        else showMenu(state);
    };
    document.addEventListener('keydown', onKeyDown, true);

    modal.querySelector('.modal-backdrop').onclick = close;
    modal.querySelector('#geo-close').onclick = close;
    modal.querySelector('#geo-back').onclick = () => showMenu(state);

    modal.querySelectorAll('[data-mode]').forEach(btn => {
        btn.onclick = () => startMode(state, btn.dataset.mode);
    });
    modal.querySelector('#geo-guess').onclick = () => sendGuess(state);

    boot(state);
    return modal;
}

// ── Каркас ───────────────────────────────────────────────────────────────────

function shellHtml() {
    return `
        <div class="modal-backdrop"></div>
        <div class="modal-win geo-win">
            <div class="modal-head">
                <button class="btn btn-sec geo-back hidden" id="geo-back" title="В меню">←</button>
                <span>Гео</span>
                <button class="btn btn-sec" id="geo-close" title="Закрыть">✕</button>
            </div>

            <div class="geo-body">
                <!-- ── Меню режимов ── -->
                <div class="geo-menu" id="geo-menu">
                    <div class="geo-note hidden" id="geo-note"></div>
                    <div class="geo-modes">
                        <section class="geo-card">
                            <h4>Дейли</h4>
                            <p class="geo-hint">Одна точка в сутки, одна попытка. У каждого своя,
                               меняется в полночь. В таблице — сумма за все дни.</p>
                            <button type="button" class="btn btn-pri" data-mode="daily">Играть</button>
                            <div class="geo-top" id="geo-top-daily"></div>
                        </section>
                        <section class="geo-card">
                            <h4>Соло</h4>
                            <p class="geo-hint">Пять точек подряд. В таблицу идёт сумма очков
                               за партию — до 25000.</p>
                            <button type="button" class="btn btn-pri" data-mode="solo">Играть</button>
                            <div class="geo-top" id="geo-top-solo"></div>
                        </section>
                        <section class="geo-card">
                            <h4>Дуэль</h4>
                            <p class="geo-hint">Точки одни на двоих, по 6000 здоровья. Разница очков
                               за раунд — урон, каждые два раунда он множится.</p>
                            <button type="button" class="btn btn-pri" data-mode="duel">В лобби</button>
                            <div class="geo-top" id="geo-top-duel"></div>
                        </section>
                    </div>
                </div>

                <!-- ── Лобби дуэлей ── -->
                <div class="geo-lobby hidden" id="geo-lobby"></div>

                <!-- ── Раунд ── -->
                <div class="geo-stage hidden" id="geo-stage">
                    <div class="geo-pano" id="geo-pano"></div>
                    <div class="geo-hud" id="geo-hud"></div>
                    <div class="geo-map-wrap" id="geo-map-wrap">
                        <div class="geo-map" id="geo-map"></div>
                        <button type="button" class="btn btn-pri geo-guess-btn" id="geo-guess" disabled>
                            Ткните в карту
                        </button>
                    </div>
                    <div class="geo-result hidden" id="geo-result"></div>
                </div>
            </div>
        </div>`;
}

const $ = (state, sel) => state.modal.querySelector(sel);

async function boot(state) {
    try {
        state.cfg = await state.ctx.apiFetch('/api/geo/config');
    } catch {
        state.cfg = { ok: false };
    }
    if (!state.cfg.ok) {
        const note = $(state, '#geo-note');
        note.classList.remove('hidden');
        // Ключа нет — честно говорим об этом вместо белого прямоугольника на
        // месте панорамы. Таблицы при этом работают: посмотреть чужие
        // результаты можно и без ключа.
        note.textContent = 'Панорамы не настроены: серверу нужен ключ Google Maps '
            + '(GOOGLE_MAPS_KEY в deploy/.env). Играть пока нельзя, таблицы ниже — работают.';
        state.modal.querySelectorAll('[data-mode]').forEach(b => { b.disabled = true; });
    }
    loadTops(state);
}

// ── Экраны ───────────────────────────────────────────────────────────────────

function show(state, screen) {
    state.screen = screen;
    $(state, '#geo-menu').classList.toggle('hidden', screen !== 'menu');
    $(state, '#geo-lobby').classList.toggle('hidden', screen !== 'lobby');
    $(state, '#geo-stage').classList.toggle('hidden', screen !== 'stage');
    $(state, '#geo-back').classList.toggle('hidden', screen === 'menu');
}

function showMenu(state) {
    stopPolling(state);
    state.mode = null;
    state.duel = null;
    show(state, 'menu');
    loadTops(state);
}

function stopPolling(state) {
    clearInterval(state.poll); state.poll = null;
    clearInterval(state.tick); state.tick = null;
}

async function startMode(state, mode) {
    if (state.busy) return;
    state.busy = true;
    try {
        if (mode === 'daily') await startDaily(state);
        else if (mode === 'solo') await startSolo(state);
        else await showLobby(state);
    } catch (err) {
        alert(err.message || 'не получилось начать');
    } finally {
        state.busy = false;
    }
}

// ── Панорама и карта ─────────────────────────────────────────────────────────

/**
 * Поднять просмотрщик под нужный режим передвижения.
 *
 * Панорама пересоздаётся, только когда сменился режим (у дуэли он свой):
 * между раундами ей достаточно поменять id, и это заметно дешевле.
 */
async function ensureViewer(state, mode) {
    const { loadMaps, createPanorama, createGuessMap } = await import('./geoStreet.js');
    if (!state.maps) state.maps = await loadMaps(state.cfg.key);
    if (!state.gmap) {
        state.gmap = createGuessMap(state.maps, $(state, '#geo-map'), (point) => {
            state.guess = point;
            const btn = $(state, '#geo-guess');
            btn.disabled = false;
            btn.textContent = 'Угадать';
        });
    }
    if (!state.pano || state.panoMode !== mode) {
        state.pano?.destroy();
        $(state, '#geo-pano').innerHTML = '';
        state.pano = createPanorama(state.maps, $(state, '#geo-pano'), mode);
        state.panoMode = mode;
        state.shownPano = null;
    }
}

/** Показать точку раунда и вернуть карту в исходное состояние. */
function showRound(state, pano) {
    $(state, '#geo-stage').classList.remove('is-result');
    $(state, '#geo-result').classList.add('hidden');
    $(state, '#geo-map-wrap').classList.remove('hidden');
    state.guess = null;
    const btn = $(state, '#geo-guess');
    btn.disabled = true;
    btn.textContent = 'Ткните в карту';
    state.gmap.reset();
    if (pano && pano !== state.shownPano) {
        state.pano.show(pano);
        state.shownPano = pano;
    }
}

/** Переключить экран на показ итога: карта во всю ширину, панорама уходит. */
function showResult(state, target, guesses, html) {
    $(state, '#geo-stage').classList.add('is-result');
    const box = $(state, '#geo-result');
    box.classList.remove('hidden');
    box.innerHTML = html;
    // Карта только что была маленькой в углу — после смены размера гугловской
    // карте нужно сказать, что холст другой, иначе половина её остаётся серой.
    // Порядок важен: сначала новый размер, потом подгонка по меткам, иначе она
    // считается по старому холсту и итог уезжает за край.
    state.maps.event.trigger(state.gmap.map, 'resize');
    state.gmap.showResult(target, guesses.filter(Boolean));
}

function sendGuess(state) {
    if (!state.guess || state.busy) return;
    const btn = $(state, '#geo-guess');
    btn.disabled = true;
    state.busy = true;
    const done = () => { state.busy = false; };
    if (state.mode === 'daily') answerDaily(state).finally(done);
    else if (state.mode === 'solo') answerSolo(state).finally(done);
    else answerDuel(state).finally(done);
}

// ── Дейли ────────────────────────────────────────────────────────────────────

async function startDaily(state) {
    const data = await state.ctx.apiFetch('/api/geo/daily');
    if (!data.ok) return noteRefusal(state, data.reason);
    state.mode = 'daily';
    state.daily = data.round;

    await ensureViewer(state, 'move');
    show(state, 'stage');

    if (data.round.done) {
        renderDailyResult(state, data.round.result, data);
        return;
    }
    showRound(state, data.round.pano);
    $(state, '#geo-hud').innerHTML = `<div class="geo-hud-line">Дейли · ${esc(data.round.day)}
        <span class="geo-hud-dim">одна попытка</span></div>`;
}

async function answerDaily(state) {
    const data = await state.ctx.apiFetch('/api/geo/daily/guess', { method: 'POST', body: state.guess });
    if (!data.ok) {
        // Единственный внятный отказ здесь — «уже отвечали»: значит, ответ
        // ушёл из другой вкладки. Показываем итог оттуда, а не ошибку.
        if (data.reason === 'already') return startDaily(state);
        return noteRefusal(state, data.reason);
    }
    renderDailyResult(state, data.result, data);
}

function renderDailyResult(state, result, data) {
    const next = data.round?.next_at || data.next_at || state.daily?.next_at;
    showResult(state, result.target, [{ ...result.guess, color: '#e74c3c' }], `
        <div class="geo-result-head">Дейли</div>
        <div class="geo-score">${result.score}<span> / ${state.cfg.max_score}</span></div>
        <div class="geo-dist">${distText(result.distance_km)} · ${esc(result.label)}</div>
        <div class="geo-next">Новая точка ${nextText(next)}</div>
        ${topHtml(data, 'total', 'Сумма за все дни')}`);
}

// ── Соло ─────────────────────────────────────────────────────────────────────

async function startSolo(state) {
    const cur = await state.ctx.apiFetch('/api/geo/solo');
    let run = cur.run;
    if (!run) {
        const started = await state.ctx.apiFetch('/api/geo/solo/start', { method: 'POST' });
        if (!started.ok) return noteRefusal(state, started.reason);
        run = started.run;
    }
    state.mode = 'solo';
    state.run = run;

    await ensureViewer(state, 'move');
    show(state, 'stage');
    showRound(state, run.pano);
    renderSoloHud(state);
}

function renderSoloHud(state) {
    const run = state.run;
    $(state, '#geo-hud').innerHTML = `<div class="geo-hud-line">Соло · точка ${run.round} из ${run.total}
        <span class="geo-hud-dim">набрано ${run.score}</span></div>`;
}

async function answerSolo(state) {
    const data = await state.ctx.apiFetch('/api/geo/solo/guess', {
        method: 'POST',
        body: { id: state.run.id, ...state.guess },
    });
    if (!data.ok) return noteRefusal(state, data.reason);

    const last = data.results[data.results.length - 1];
    state.run = data;

    if (data.status === 'done') {
        const lines = data.results.map(r =>
            `<div class="geo-run-row"><span>${r.round}</span><b>${r.score}</b>
             <span class="geo-hud-dim">${distText(r.distance_km)} · ${esc(r.label)}</span></div>`).join('');
        showResult(state, last.target, [{ ...last.guess, color: '#e74c3c' }], `
            <div class="geo-result-head">Партия закончена</div>
            <div class="geo-score">${data.score}<span> / ${state.cfg.solo_rounds * state.cfg.max_score}</span></div>
            ${data.improved ? '<div class="geo-best">Это ваш рекорд</div>'
                : `<div class="geo-dist">Ваш рекорд — ${data.best}</div>`}
            <div class="geo-run">${lines}</div>
            ${topHtml(data, 'score', 'Лучшая партия')}
            <button type="button" class="btn btn-pri geo-next-btn" id="geo-again">Ещё партию</button>`);
        $(state, '#geo-again').onclick = () => startMode(state, 'solo');
        return;
    }

    showResult(state, last.target, [{ ...last.guess, color: '#e74c3c' }], `
        <div class="geo-result-head">Точка ${last.round} из ${state.cfg.solo_rounds}</div>
        <div class="geo-score">${last.score}<span> / ${state.cfg.max_score}</span></div>
        <div class="geo-dist">${distText(last.distance_km)} · ${esc(last.label)}</div>
        <div class="geo-dist">Всего ${data.score}</div>
        <button type="button" class="btn btn-pri geo-next-btn" id="geo-next">Дальше</button>`);
    $(state, '#geo-next').onclick = () => {
        showRound(state, data.pano);
        renderSoloHud(state);
    };
}

// ── Дуэль: лобби ─────────────────────────────────────────────────────────────

async function showLobby(state) {
    state.mode = 'duel';
    show(state, 'lobby');
    await renderLobby(state);
}

async function renderLobby(state) {
    const [lobby, top] = await Promise.all([
        state.ctx.apiFetch('/api/geo/duel/lobby'),
        state.ctx.apiFetch('/api/geo/duel/top'),
    ]);
    const modes = (state.cfg.duel?.modes || []).map(m =>
        `<button type="button" class="btn btn-sec geo-mode-btn" data-challenge="${m.id}">${esc(m.name)}</button>`).join('');

    const open = (lobby.open || []).map(g => {
        const me = g.seat === 0;
        const opp = g.players[0];
        return rowHtml(opp, esc(modeName(state, g.mode)),
            me ? `<button type="button" class="btn btn-sec" data-cancel="${g.id}">Отменить</button>`
               : `<button type="button" class="btn btn-pri" data-join="${g.id}">Принять</button>`);
    }).join('') || '<div class="geo-empty">Вызовов пока нет — бросьте свой.</div>';

    const mine = (lobby.mine || []).map(g => rowHtml(
        g.players[g.seat === 0 ? 1 : 0],
        esc(modeName(state, g.mode)),
        `<button type="button" class="btn btn-pri" data-resume="${g.id}">Вернуться</button>`)).join('');

    $(state, '#geo-lobby').innerHTML = `
        <section class="geo-card">
            <h4>Бросить вызов</h4>
            <p class="geo-hint">У обоих одни и те же точки. По ${state.cfg.duel?.hp || 6000} здоровья,
               ${state.cfg.duel?.round_seconds || 120} секунд на раунд. Победа +${state.cfg.duel?.win_pts || 25},
               поражение −${state.cfg.duel?.win_pts || 25}.</p>
            <div class="geo-mode-row">${modes}</div>
            <p class="geo-hint geo-hint-dim">«Без ходьбы» — стоять на месте, крутиться можно.
               NMPZ — ни шага, ни поворота, ни зума.</p>
        </section>
        <section class="geo-card">
            <h4>Вызовы</h4>
            <div class="geo-list">${open}</div>
        </section>
        ${mine ? `<section class="geo-card"><h4>Ваши дуэли</h4><div class="geo-list">${mine}</div></section>` : ''}
        <div class="geo-top">${topHtml({ ...top }, 'pts', 'Очки за дуэли')}</div>`;

    const box = $(state, '#geo-lobby');
    box.querySelectorAll('[data-challenge]').forEach(b => {
        b.onclick = () => challenge(state, b.dataset.challenge);
    });
    box.querySelectorAll('[data-join]').forEach(b => {
        b.onclick = () => joinDuel(state, b.dataset.join);
    });
    box.querySelectorAll('[data-resume]').forEach(b => {
        b.onclick = () => enterDuel(state, b.dataset.resume);
    });
    box.querySelectorAll('[data-cancel]').forEach(b => {
        b.onclick = async () => {
            await state.ctx.apiFetch(`/api/geo/duel/${b.dataset.cancel}`, { method: 'DELETE' });
            renderLobby(state);
        };
    });
}

const modeName = (state, id) =>
    (state.cfg.duel?.modes || []).find(m => m.id === id)?.name || id;

async function challenge(state, mode) {
    const res = await state.ctx.apiFetch('/api/geo/duel/challenge', { method: 'POST', body: { mode } });
    if (!res.ok) return noteRefusal(state, res.reason);
    renderLobby(state);
}

async function joinDuel(state, id) {
    const res = await state.ctx.apiFetch(`/api/geo/duel/${id}/join`, { method: 'POST' });
    if (!res.ok) {
        if (res.reason === 'gone') return renderLobby(state);
        return noteRefusal(state, res.reason);
    }
    enterDuel(state, id);
}

// ── Дуэль: партия ────────────────────────────────────────────────────────────

async function enterDuel(state, id) {
    const duel = await state.ctx.apiFetch(`/api/geo/duel/${id}`);
    state.mode = 'duel';
    state.duel = duel;
    state.offset = Date.now() - duel.now;

    await ensureViewer(state, duel.mode);
    show(state, 'stage');
    renderDuel(state, duel);

    stopPolling(state);
    state.poll = setInterval(() => pollDuel(state), POLL_MS);
    // Часы раунда крутятся чаще опроса: секунды должны идти ровно, а не
    // прыгать через полторы.
    state.tick = setInterval(() => renderDuelHud(state), 250);
}

async function pollDuel(state) {
    if (!state.duel || state.busy) return;
    try {
        const fresh = await state.ctx.apiFetch(`/api/geo/duel/${state.duel.id}?since=${state.duel.seq}`);
        if (fresh.seq === state.duel.seq && fresh.state === undefined) return;
        renderDuel(state, fresh);
    } catch {
        // Моргнула сеть — следующий опрос через полторы секунды разберётся.
        // Ронять партию на экране из-за одного неудачного запроса нельзя.
    }
}

function renderDuel(state, duel) {
    state.duel = duel;
    state.offset = Date.now() - duel.now;
    const st = duel.state;
    if (!st) return;

    if (duel.status === 'done' || st.phase === 'over') return renderDuelOver(state, duel);

    if (st.phase === 'play') {
        // Новый раунд: панорама меняется, карта чистится. Если мы уже ответили,
        // экран остаётся тем же, но кнопка гаснет — ждём соперника.
        if (st.pano && st.pano !== state.shownPano) showRound(state, st.pano);
        const btn = $(state, '#geo-guess');
        if (st.my_answer) {
            btn.disabled = true;
            btn.textContent = 'Ждём соперника…';
        } else {
            btn.disabled = !state.guess;
            btn.textContent = state.guess ? 'Угадать' : 'Ткните в карту';
        }
        renderDuelHud(state);
        return;
    }

    if (st.phase === 'reveal') renderDuelReveal(state, duel);
}

function renderDuelHud(state) {
    const duel = state.duel;
    const st = duel?.state;
    if (!st || state.screen !== 'stage' || state.mode !== 'duel') return;
    const seat = duel.seat;
    const me = st.hp[seat];
    const opp = st.hp[1 - seat];
    const oppName = duel.players[1 - seat]?.name || 'Соперник';
    const left = st.phase === 'play'
        ? Math.max(0, Math.round((st.deadline - (Date.now() - state.offset)) / 1000))
        : null;

    $(state, '#geo-hud').innerHTML = `
        <div class="geo-hud-line">
            Раунд ${st.round}
            <span class="geo-mult">×${st.mult}</span>
            ${left !== null ? `<span class="geo-clock${left <= 15 ? ' is-low' : ''}">${left} с</span>` : ''}
            <span class="geo-hud-dim">${esc(modeName(state, st.mode))}</span>
        </div>
        <div class="geo-hp">
            ${hpHtml('Вы', me, st.max_hp, 'is-me')}
            ${hpHtml(oppName, opp, st.max_hp, '')}
        </div>
        ${st.waiting_for_opponent ? '<div class="geo-hud-dim">Ответ принят, ждём соперника</div>' : ''}`;
}

function hpHtml(name, hp, max, cls) {
    const pct = Math.max(0, Math.round((hp / max) * 100));
    return `<div class="geo-hp-row ${cls}">
        <span class="geo-hp-name">${esc(name)}</span>
        <span class="geo-hp-bar"><i style="width:${pct}%"></i></span>
        <span class="geo-hp-num">${hp}</span>
    </div>`;
}

async function answerDuel(state) {
    const data = await state.ctx.apiFetch(`/api/geo/duel/${state.duel.id}/guess`, {
        method: 'POST', body: state.guess,
    });
    if (!data.ok) return noteRefusal(state, data.reason);
    renderDuel(state, data);
}

function renderDuelReveal(state, duel) {
    const st = duel.state;
    const last = st.last;
    if (!last) return;
    const seat = duel.seat;
    const mine = last.guesses[seat];
    const theirs = last.guesses[1 - seat];
    const myScore = last.scores[seat];
    const theirScore = last.scores[1 - seat];
    const oppName = duel.players[1 - seat]?.name || 'Соперник';

    const verdict = last.hit === -1
        ? 'Ничья в раунде — урона нет'
        : (last.hit === seat
            ? `Вы получили ${last.damage}`
            : `${esc(oppName)} получает ${last.damage}`);

    showResult(state, last.point,
        [mine && { ...mine, color: '#e74c3c', label: 'Вы' },
         theirs && { ...theirs, color: '#3498db', label: oppName }], `
        <div class="geo-result-head">Раунд ${last.round} · ×${last.mult}</div>
        <div class="geo-versus">
            <div class="geo-versus-side"><span>Вы</span><b>${myScore}</b>
                <span class="geo-hud-dim">${distText(last.distances[seat])}</span></div>
            <div class="geo-versus-side"><span>${esc(oppName)}</span><b>${theirScore}</b>
                <span class="geo-hud-dim">${distText(last.distances[1 - seat])}</span></div>
        </div>
        <div class="geo-damage">${verdict}</div>
        <div class="geo-dist">${esc(last.point.label || '')}</div>
        <div class="geo-hp">
            ${hpHtml('Вы', st.hp[seat], st.max_hp, 'is-me')}
            ${hpHtml(oppName, st.hp[1 - seat], st.max_hp, '')}
        </div>
        <button type="button" class="btn btn-pri geo-next-btn" id="geo-ready"
                ${st.seen[seat] ? 'disabled' : ''}>
            ${st.seen[seat] ? 'Ждём соперника…' : 'Готов'}
        </button>
        <button type="button" class="btn btn-sec geo-resign" id="geo-resign">Сдаться</button>`);

    $(state, '#geo-ready').onclick = async () => {
        const res = await state.ctx.apiFetch(`/api/geo/duel/${duel.id}/ready`, { method: 'POST' });
        if (res.ok) renderDuel(state, res);
    };
    $(state, '#geo-resign').onclick = async () => {
        if (!confirm('Сдаться? Это поражение и −' + (state.cfg.duel?.win_pts || 25) + ' очков.')) return;
        const res = await state.ctx.apiFetch(`/api/geo/duel/${duel.id}/resign`, { method: 'POST' });
        if (res.ok) renderDuel(state, res);
    };
}

async function renderDuelOver(state, duel) {
    stopPolling(state);
    const st = duel.state;
    const seat = duel.seat;
    const win = duel.winner === seat;
    const draw = duel.winner === null || duel.winner === undefined;
    const pts = state.cfg.duel?.win_pts || 25;
    const head = draw ? 'Ничья' : (win ? 'Победа' : 'Поражение');
    const delta = draw ? 'Очки не меняются' : (win ? `+${pts} очков` : `−${pts} очков`);
    const last = st?.last;

    const top = await state.ctx.apiFetch('/api/geo/duel/top').catch(() => null);
    showResult(state,
        last?.point || { lat: 0, lng: 0 },
        last ? [last.guesses[seat] && { ...last.guesses[seat], color: '#e74c3c', label: 'Вы' },
                last.guesses[1 - seat] && { ...last.guesses[1 - seat], color: '#3498db' }] : [], `
        <div class="geo-result-head">${head}</div>
        <div class="geo-dist">${esc(END_TEXT[duel.reason] || duel.reason)} · ${delta}</div>
        ${st ? `<div class="geo-hp">
            ${hpHtml('Вы', st.hp[seat], st.max_hp, 'is-me')}
            ${hpHtml(duel.players[1 - seat]?.name || 'Соперник', st.hp[1 - seat], st.max_hp, '')}
        </div>` : ''}
        ${top ? topHtml(top, 'pts', 'Очки за дуэли') : ''}
        <button type="button" class="btn btn-pri geo-next-btn" id="geo-lobby-back">В лобби</button>`);
    $(state, '#geo-lobby-back').onclick = () => showLobby(state);
}

// ── Таблицы ──────────────────────────────────────────────────────────────────

async function loadTops(state) {
    const boxes = {
        daily: ['#geo-top-daily', 'total', 'Сумма за все дни'],
        solo: ['#geo-top-solo', 'score', 'Лучшая партия'],
        duel: ['#geo-top-duel', 'pts', 'Очки за дуэли'],
    };
    for (const [mode, [sel, field, head]] of Object.entries(boxes)) {
        state.ctx.apiFetch(`/api/geo/${mode}/top`).then(top => {
            const box = $(state, sel);
            if (box) box.innerHTML = topHtml(top, field, head);
        }).catch(() => {});
    }
}

/**
 * Таблица режима. Своя строка показывается всегда — даже если человек
 * двадцать пятый: место считает сервер одним COUNT.
 */
function topHtml(top, field, head) {
    const rows = top?.rows || [];
    if (!rows.length) {
        return `<div class="geo-top-head">${esc(head)}</div>`
            + '<div class="geo-empty">Здесь пока пусто — первый результат будет вашим.</div>';
    }
    const meRank = top.me?.rank;
    const list = rows.map(row => `
        <div class="geo-top-row${row.rank === 1 ? ' is-first' : ''}${row.rank === meRank ? ' is-me' : ''}">
            <span class="geo-top-rank">${row.rank}</span>
            <div class="geo-row-avatar">${row.avatar
                ? `<img src="${esc(row.avatar)}" alt=""/>`
                : '<span class="top-avatar-default"></span>'}</div>
            <div class="geo-top-name">${namePrefixHtml(row)}${esc(row.display_name)}</div>
            <span class="geo-top-score">${row[field]}${extraText(row, field)}</span>
        </div>`).join('');

    const me = top.me;
    const inList = me && rows.some(r => r.rank === meRank);
    const mine = me && !inList
        ? `<div class="geo-top-row is-mine-extra">
               <span class="geo-top-rank">${me.rank}</span>
               <div class="geo-top-name">Вы</div>
               <span class="geo-top-score">${me[field]}${extraText(me, field)}</span>
           </div>`
        : '';
    return `<div class="geo-top-head">${esc(head)}</div>`
        + `<div class="geo-top-list">${list}</div>${mine}`;
}

// Второе число в строке. Без него «450» в дейли читается как результат одного
// дня, а «25» в дуэли — как счёт партии.
function extraText(row, field) {
    if (field === 'total') return `<span class="geo-top-dim"> за ${row.days} дн.</span>`;
    if (field === 'pts') return `<span class="geo-top-dim"> ${row.wins} / ${row.losses}</span>`;
    return '';
}

function rowHtml(player, tag, action) {
    return `
        <div class="geo-row">
            <div class="geo-row-avatar">${player?.avatar
                ? `<img src="${esc(player.avatar)}" alt=""/>`
                : '<span class="top-avatar-default"></span>'}</div>
            <div class="geo-row-name">${esc(player?.name || 'Игрок')}</div>
            <span class="geo-row-tag">${tag}</span>
            ${action}
        </div>`;
}

// ── Мелочи ───────────────────────────────────────────────────────────────────

const REFUSALS = {
    no_key: 'Панорамы не настроены — серверу нужен ключ Google Maps.',
    no_point: 'Не удалось подобрать точку с панорамой. Попробуйте ещё раз.',
    no_round: 'Раунд не выдан — откройте режим заново.',
    already: 'Сегодня вы уже отвечали.',
    already_waiting: 'Ваш вызов уже висит в лобби.',
    bad_guess: 'Точка не распозналась — ткните в карту ещё раз.',
    bad_mode: 'Неизвестный режим.',
    gone: 'Вызов уже приняли.',
    own: 'Это ваш собственный вызов.',
    not_live: 'Партия уже закончена.',
    too_late: 'Время раунда вышло.',
    stale: 'Партия ушла вперёд — обновляем.',
};

function noteRefusal(state, reason) {
    alert(REFUSALS[reason] || 'Не получилось: ' + (reason || 'неизвестная причина'));
}

function distText(km) {
    if (km === null || km === undefined) return 'мимо (нет ответа)';
    if (km < 1) return `${Math.round(km * 1000)} м`;
    if (km < 100) return `${km.toFixed(1)} км`;
    return `${Math.round(km)} км`;
}

function nextText(iso) {
    if (!iso) return 'завтра';
    const left = new Date(iso).getTime() - Date.now();
    if (left <= 0) return 'уже готова — откройте режим заново';
    const h = Math.floor(left / 3600000);
    const m = Math.floor((left % 3600000) / 60000);
    return h > 0 ? `через ${h} ч ${m} мин` : `через ${m} мин`;
}

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
