// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «DOOM» — окно с настоящим DOOM 1993 года.
//
// Открывается ТОЛЬКО из меню игр (games.js), а оно — из поиска на главной:
// набрать «игры» и нажать Enter. Пока это слово набирают, поиск молчит.
//
// Эта пасхалка устроена НЕ КАК ВСЕ ОСТАЛЬНЫЕ, и это главное, что стоит про неё
// помнить. У остальных двенадцати правила лежат в `shared/`, а сервер либо ведёт
// партию, либо принимает результат. Здесь правил у нас нет вовсе: игра — чужая,
// собранная в wasm (prboom из webDOOM, см. `design/doom/README.md`), и внутрь
// неё мы не заглядываем. Отсюда следствие: у DOOM НЕТ МИНИ-ТОПА. Сравнивать
// нечего — единственное, что игра рассказывает наружу, это пиксели на холсте, а
// «рекорд», посчитанный по ним, был бы выдумкой. Пасхалка тут ровно в том, что
// DOOM запускается прямо на рабочем месте, и этого достаточно.
//
// Склейка emscripten (`assets/doom/doom.js`) — НЕ модуль, а текст: он лежит в
// чанке строкой (`?raw`) и запускается через `new Function('Module', …)`. Так на
// `window` не появляется глобального `Module` (склейка пишет туда всё подряд), а
// адреса `.wasm` и `.data` игре подставляет `locateFile` — их имена сборщик
// хэширует, и угадать их изнутри склейки нельзя.
//
// ЭКЗЕМПЛЯР ИГРЫ ОДИН НА ВКЛАДКУ И ЖИВЁТ ДОЛЬШЕ ОКНА. Закрыли окно — холст
// вынимается из разметки, главный цикл встаёт на паузу, а игра остаётся ровно
// такой, какой была. Иначе «закрыть окно» означало бы «начать с заставки»:
// отдать своё состояние наружу, как это делают тетрис и маджонг, DOOM не умеет —
// он весь внутри своей кучи. Второй экземпляр не создаётся и по второй причине:
// SDL вешает слушатели на window и не снимает их никогда, а куча — 256 МБ.
//
// Пропущенное на паузе время НЕ ДОИГРЫВАЕТСЯ ЧАСАМИ: prboom строит за раз не
// больше BACKUPTICS/2 тиков (`D_BuildNewTiccmds` в d_client.c), лишнее просто
// выбрасывается. После часа с закрытым окном игра догонит секунды две — это
// заметно, но это не «вернулся, а ты мёртв».
//
// КЛАВИАТУРА уходит в игру, ТОЛЬКО пока холст в фокусе (`keyboardListeningElement`).
// По умолчанию SDL слушает document и гасит preventDefault-ом всё подряд — с
// таким слушателем после закрытия окна на сайте перестали бы печататься буквы в
// поиске. Отсюда же и то, что Escape НЕ ЗАКРЫВАЕТ ОКНО, в отличие от остальных
// пасхалок: в DOOM это клавиша меню, и отдавать её вкладке нельзя. Окно
// закрывается крестиком, и до крестика надо сперва отпустить мышь тем же
// Escape — под захватом указателя все клики достаются холсту, где бы ни стоял
// курсор. Это не наша выдумка, так работает захват; поэтому про Escape и
// написано в подсказке под экраном.
//
// МЫШЬ включается захватом указателя, и включать его приходится самим. В этой
// сборке `SDL_ShowCursor(0)` просит захват только в полноэкранном режиме, а
// полноэкранного режима у пасхалки нет и не будет — поэтому ставим
// `elementPointerLock`: клик по холсту захватывает указатель, дальше SDL считает
// движения из `movementX`, то есть мышь работает как в настоящей игре, а не
// «пока курсор внутри окна». Пока указатель не захвачен, поверх холста висит
// подсказка — иначе игра выглядит сломанной: клавиши работают, мышь нет.
// ─────────────────────────────────────────────────────────────────────────────

import glueSource from './assets/doom/doom.js?raw';
import wasmUrl from './assets/doom/doom.wasm?url';
import dataUrl from './assets/doom/doom.data?url';

const MODAL_ID = 'doom-modal';

// Склейка просит соседние файлы по коротким именам — отдаём ей хэшированные
// адреса от сборщика.
const FILES = { 'doom.wasm': wasmUrl, 'doom.data': dataUrl };

// prboom.cfg кладётся в файловую систему игры до её старта. Здесь только то,
// что мы МЕНЯЕМ; остальное (WASD, пробел «открыть», Shift «бег» — всё это уже
// вкомпилировано в сборку webDOOM) берётся из умолчаний.
//
//  * mouse_sensitivity_vert 0 — в DOOM вертикаль мыши это ХОД ВПЕРЁД-НАЗАД, а не
//    взгляд. С мышью, которой целятся, это означает «шагнул в лаву, потому что
//    прицелился ниже»;
//  * mouseb_forward -1 — правая кнопка по умолчанию тоже «вперёд». Под захватом
//    указателя правая кнопка нажимается случайно, и человек едет в стену;
//  * use_fullscreen 0 и явное разрешение — иначе prboom подбирает режим под
//    экран (`I_ClosestResolution`), и холст оказывается размером с монитор.
//    Полноэкранного режима у пасхалки нет, значит и подбирать нечего.
const CONFIG = [
    'use_mouse 1',
    'mouse_sensitivity_vert 0',
    'mouseb_forward -1',
    'use_fullscreen 0',
    'screen_width 640',
    'screen_height 480',
    '',
].join('\n');

// -nomusic: музыку (91 МБ mp3) мы из пакета выкинули, и без флага игра ходила бы
// за ней в файловую систему на каждом уровне. Звуки при этом на месте.
const ARGS = ['-nomusic', '-config', '/prboom.cfg'];

let vm = null;          // единственный экземпляр игры на вкладку
let openState = null;   // одно окно за раз

/** Открыть игру. ctx не нужен: у DOOM нет ни топа, ни запросов к серверу. */
export function openDoom() {
    if (openState) return openState.modal;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'modal';
    modal.innerHTML = shellHtml();
    document.body.appendChild(modal);
    document.body.classList.add('modal-open');

    const game = boot();
    const state = { modal, game };
    openState = state;

    modal.querySelector('#doom-screen').appendChild(game.canvas);
    game.onchange = () => render(state);
    resume(game);

    const close = () => {
        game.onchange = null;
        document.removeEventListener('pointerlockchange', onLock);
        document.removeEventListener('keydown', onKeyDown);
        // Указатель отпускаем сами: без этого он остаётся захваченным холстом,
        // которого на странице уже нет, и мышь не возвращается человеку.
        if (document.pointerLockElement === game.canvas) document.exitPointerLock();
        pause(game);
        // Холст ПЕРЕЕЗЖАЕТ обратно к экземпляру, а не удаляется вместе с окном:
        // в нём живёт контекст WebGL и вся картинка игры.
        game.canvas.remove();
        modal.remove();
        document.body.classList.remove('modal-open');
        openState = null;
    };
    state.close = close;

    const onLock = () => render(state);
    document.addEventListener('pointerlockchange', onLock);

    // Escape достаётся игре (это её меню) — и на нём же отпускаем указатель.
    // Делаем это сами, а не надеемся на браузер: пока указатель захвачен, ЛЮБОЙ
    // клик уходит холсту, где бы ни стоял курсор, то есть крестик закрытия
    // недостижим. Событие при этом не трогаем — DOOM должен получить его как
    // обычно.
    const onKeyDown = (e) => {
        if (e.key === 'Escape' && document.pointerLockElement === game.canvas) document.exitPointerLock();
    };
    document.addEventListener('keydown', onKeyDown);

    modal.querySelector('.modal-backdrop').onclick = close;
    modal.querySelector('#doom-close').onclick = close;

    render(state);
    // Фокус холсту: в меню игр приходят с клавиатуры, и «нажал W, ничего не
    // поехало» — худшее первое впечатление, какое может быть у DOOM.
    game.canvas.focus();
    return modal;
}

function shellHtml() {
    return `
        <div class="modal-backdrop"></div>
        <div class="modal-win doom-win">
            <div class="modal-head">
                <span>DOOM</span>
                <button class="btn btn-sec" id="doom-close" title="Закрыть">✕</button>
            </div>
            <div class="doom-body">
                <div class="doom-screen" id="doom-screen">
                    <div class="doom-over" id="doom-over"><span></span></div>
                </div>
                <div class="doom-hint">
                    <b>WASD</b> — идти, <b>мышь</b> — целиться, <b>левая кнопка</b> — огонь,
                    <b>пробел</b> — открыть, <b>Shift</b> — бег, <b>Tab</b> — карта,
                    <b>1</b>…<b>7</b> — оружие, <b>Esc</b> — меню игры и отпустить мышь.
                    Окно закрывается крестиком — до него надо сперва отпустить мышь.
                </div>
            </div>
        </div>`;
}

// Поверх холста висит ровно одна надпись за раз, и порядок тут важнее вида:
// пока игра качается — проценты, дальше — приглашение захватить мышь, а с
// захваченным указателем не пишем ничего.
function render(state) {
    const { game } = state;
    const over = state.modal.querySelector('#doom-over');
    const locked = document.pointerLockElement === game.canvas;
    let text = '';
    if (game.status === 'error') text = 'DOOM не запустился — обнови страницу';
    else if (game.status === 'loading') text = `DOOM грузится… ${game.percent}%`;
    else if (!locked) text = 'Клик по экрану — включить мышь';
    over.firstElementChild.textContent = text;
    over.classList.toggle('hidden', !text);
    over.classList.toggle('is-error', game.status === 'error');
}

// ── Экземпляр игры ───────────────────────────────────────────────────────────

function boot() {
    if (vm) return vm;

    const canvas = document.createElement('canvas');
    canvas.className = 'doom-canvas';
    canvas.width = 640;
    canvas.height = 480;
    // Холст должен быть фокусируемым: на нём висит слушатель клавиатуры игры.
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'DOOM');
    // Правая кнопка в игре — это кнопка, а не контекстное меню.
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('webglcontextlost', e => {
        e.preventDefault();
        vm.status = 'error';
        vm.onchange?.();
    });

    const module = {
        canvas,
        arguments: ARGS,
        elementPointerLock: true,
        keyboardListeningElement: canvas,
        locateFile: path => FILES[path] || path,
        preRun: [() => {
            module.FS_createDataFile('/', 'prboom.cfg', CONFIG, true, true, false);
        }],
        postRun: [() => {
            vm.started = true;
            vm.status = 'ready';
            vm.onchange?.();
        }],
        // Заставка prboom пишет в консоль полсотни строк про вады и звук —
        // на сайте это шум. Ошибки оставляем: если игра не поднялась, знать
        // почему надо.
        print: () => {},
        setStatus: text => {
            const m = /\((\d+(?:\.\d+)?)\/(\d+)\)/.exec(text || '');
            if (m) vm.percent = Math.min(99, Math.floor(m[1] / m[2] * 100));
            vm.onchange?.();
        },
    };

    vm = { canvas, module, status: 'loading', percent: 0, started: false, onchange: null };

    try {
        // Склейка не модуль и не должна становиться глобальной: свой Module она
        // получает параметром, всё остальное остаётся внутри этой функции.
        new Function('Module', glueSource)(module);
    } catch {
        vm.status = 'error';
    }
    return vm;
}

// Паузу и продолжение спрашиваем у главного цикла emscripten, но только после
// старта: до него внутри просто нет функции, которую он гоняет по кадрам.
function pause(game) {
    if (game.started) game.module.pauseMainLoop?.();
}

function resume(game) {
    if (game.started) game.module.resumeMainLoop?.();
}
