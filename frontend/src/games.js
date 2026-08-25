// ─────────────────────────────────────────────────────────────────────────────
// Пасхалка «Игры» — меню, из которого открываются все остальные.
//
// Открывается ТОЛЬКО из поиска на главной: набрать «игры» и нажать Enter
// (см. main.js). Пока это слово набирают, поиск молчит.
//
// ПОЧЕМУ МЕНЮ ВООБЩЕ ПОЯВИЛОСЬ: раньше у каждой игры было своё слово-ключ, и к
// пятой игре получился список, который надо помнить наизусть. Пасхалка, ради
// которой ведут конспект, перестаёт быть пасхалкой: слово теперь одно, а игру
// выбирают глазами. Поэтому здесь только иконка и название — описания заняли бы
// место, но ничего не добавили: человек, добравшийся до этого окна, и так знает,
// что такое тетрис.
//
// Модули игр грузятся ПО КЛИКУ, а не при открытии меню: каждая игра — это свой
// чанк со своими правилами, словарём, спрайтом, колодой или физикой, и качать их
// все ради того, что откроют один, незачем. Само меню тянет только иконки.
//
// Меню закрывается, когда игра открылась. Держать его под окном игры нельзя:
// окна игр снимают с <body> класс modal-open, когда закрываются, и два окна
// поверх друг друга подрались бы за него — выйдя из игры, человек остался бы с
// меню на неприкреплённой странице. А вернуться сюда стоит ровно столько же,
// сколько войти в первый раз.
// ─────────────────────────────────────────────────────────────────────────────

import iconWordle from './assets/game-wordle.png';
import iconKontekst from './assets/game-kontekst.png';
import iconMinesweeper from './assets/game-minesweeper.png';
import iconTetris from './assets/game-tetris.png';
import iconTroika from './assets/game-troika.png';
import iconSolitaire from './assets/game-solitaire.png';
import iconPool from './assets/game-pool.png';
import iconDurak from './assets/game-durak.png';
import iconRoguelike from './assets/game-roguelike.png';
import iconBattleship from './assets/game-battleship.png';
import iconMahjong from './assets/game-mahjong.png';

const MODAL_ID = 'games-modal';

// Порядок — как игры появлялись в проекте: тот, кто их видел раньше, найдёт
// привычную на привычном месте, а новая приезжает в конец, а не в середину.
const GAMES = [
    { name: 'Вордле',     icon: iconWordle,      open: () => import('./wordle.js').then(m => m.openWordle) },
    { name: 'Контекстно', icon: iconKontekst,    open: () => import('./kontekst.js').then(m => m.openKontekst) },
    { name: 'Сапёр',      icon: iconMinesweeper, open: () => import('./minesweeper.js').then(m => m.openMinesweeper) },
    { name: 'Тетрис',     icon: iconTetris,      open: () => import('./tetris.js').then(m => m.openTetris) },
    { name: 'Тройка',     icon: iconTroika,      open: () => import('./troika.js').then(m => m.openTroika) },
    { name: 'Пасьянс',    icon: iconSolitaire,   open: () => import('./solitaire.js').then(m => m.openSolitaire) },
    { name: 'Бильярд',    icon: iconPool,        open: () => import('./pool.js').then(m => m.openPool) },
    { name: 'Дурак',      icon: iconDurak,       open: () => import('./durak.js').then(m => m.openDurak) },
    { name: 'Рогалик',    icon: iconRoguelike,   open: () => import('./roguelike.js').then(m => m.openRoguelike) },
    { name: 'Морской бой', icon: iconBattleship, open: () => import('./battleship.js').then(m => m.openBattleship) },
    { name: 'Маджонг',    icon: iconMahjong,     open: () => import('./mahjong.js').then(m => m.openMahjong) },
    // Иконка шашкам ещё рисуется, поэтому пока blank (см. ниже). Когда
    // frontend/src/assets/game-checkers.png ляжет на место, здесь меняются две
    // строки: сверху добавляется import iconCheckers, а blank превращается в
    // icon: iconCheckers.
    { name: 'Шашки',      blank: ['○', '●'],     open: () => import('./checkers.js').then(m => m.openCheckers) },
];

let openModal = null;   // одно окно за раз

/** Открыть меню игр. ctx: { apiFetch, user } — уходит в игру как есть. */
export function openGames(ctx) {
    if (openModal) return openModal;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'modal';
    modal.innerHTML = shellHtml();
    document.body.appendChild(modal);
    document.body.classList.add('modal-open');
    openModal = modal;

    const close = () => {
        document.removeEventListener('keydown', onKeyDown, true);
        modal.remove();
        document.body.classList.remove('modal-open');
        openModal = null;
    };

    // Escape ловим на всплытии вниз (capture), как и игры: иначе клавишу
    // перехватит поиск на главной, который остался под окном.
    const onKeyDown = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
    };
    document.addEventListener('keydown', onKeyDown, true);

    modal.querySelector('.modal-backdrop').onclick = close;
    modal.querySelector('#games-close').onclick = close;

    modal.querySelectorAll('.games-tile').forEach((tile, i) => {
        tile.onclick = async () => {
            // Пока чанк летит, второй клик по соседней иконке открыл бы вторую
            // игру поверх первой — окно на это время перестаёт слушать.
            if (modal.dataset.loading) return;
            modal.dataset.loading = '1';
            tile.classList.add('is-loading');
            try {
                const openGame = await GAMES[i].open();
                close();
                openGame(ctx);
            } catch {
                // Не догрузился чанк (сеть, кэш) — молча возвращаем меню в
                // рабочее состояние. Ошибка загрузки игры не та вещь, ради
                // которой стоит показывать человеку красную плашку.
                tile.classList.remove('is-loading');
                delete modal.dataset.loading;
            }
        };
    });

    // Фокус на первую иконку: в меню приходят с клавиатуры (набрали слово и
    // нажали Enter), и продолжить стрелками с табом должно быть можно сразу.
    modal.querySelector('.games-tile')?.focus();
    return modal;
}

function shellHtml() {
    // Ветка с blank — для игры, которая уже работает, а иконка ей ещё рисуется:
    // пустое место на плитке читалось бы как «меню сломалось». Этим путём прошли
    // пять игр подряд, и сейчас по нему идут шашки.
    const tiles = GAMES.map(g => `
        <button type="button" class="games-tile">
            ${g.icon
                ? `<img src="${g.icon}" alt="" width="256" height="256" draggable="false">`
                : `<span class="games-tile-blank" aria-hidden="true">${g.blank.map(s => `<i>${s}</i>`).join('')}</span>`}
            <span>${g.name}</span>
        </button>`).join('');
    return `
        <div class="modal-backdrop"></div>
        <div class="modal-win games-win">
            <div class="modal-head">
                <span>Игры</span>
                <button class="btn btn-sec" id="games-close" title="Закрыть">✕</button>
            </div>
            <div class="games-grid">${tiles}</div>
        </div>`;
}
