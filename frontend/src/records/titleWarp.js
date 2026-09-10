// ── Название открытой станции ведёт шейдер ───────────────────────────────────
//
// Обвязка вокруг `warpText.js` (порт эффекта с reactbits.dev) для одного
// единственного места на сайте — заголовка открытой карточки станции. Сам
// эффект о станциях ничего не знает, а здесь решается всё остальное:
//
// - НАДПИСЬ В РАЗМЕТКЕ ОСТАЁТСЯ ГЛАВНОЙ. Канвас кладётся поверх неё, и прячем
//   мы её (класс `is-warped`) только после того, как WebGL действительно
//   поднялся. Нет WebGL, не приехал чанк, заблокирован скрипт — на экране
//   обычный заголовок, то есть худшее, что бывает, это «как было раньше».
//   По той же причине эффект грузится ОТДЕЛЬНЫМ ЧАНКОМ (ogl весит как
//   половина остального раздела), как игры-пасхалки и трубы на главной;
// - КОД ПЕРЕВОДА ЗВОНКА (`##07`) в эффект НЕ ПОПАДАЕТ: он лежит отдельным
//   узлом рядом. Его читают, чтобы набрать, а плывущие цифры набирать нельзя;
// - ЦВЕТ БЕРЁТСЯ С САМОГО ЗАГОЛОВКА, а не из токена темы: канвасу нужны
//   числа, а `color` у заголовка — это уже итог всех правил CSS, в какой бы
//   теме он ни считался. На смену темы цвет пересчитывается (`themechange`),
//   иначе на светлой теме название осталось бы белым по белому.
//
// Раздел «Записи» перерисовывает доску целиком раз в 45 секунд (см. render()),
// то есть узел заголовка каждый раз новый, и эффект приходится поднимать
// заново — ровно как карту станции (destroyStationMapCtl/initStationMap).
// Чтобы это не читалось как рывок, отсчёт времени у эффекта общий на модуль,
// см. шапку `warpText.js`.

import { cssToRgb } from '../cssColor.js';

let ctl = null;    // живой эффект
let stage = null;  // узел-сцена, в котором он поднят
let token = 0;     // отсекает ответ импорта, устаревший, пока чанк ехал

// Цвет заголовка числами. oklch ни fillStyle, ни getComputedStyle обратно не
// разбирают — за этим и заведён cssColor.js (им же красятся сфера и трубы).
function colorOf(el) {
    const { r, g, b } = cssToRgb(getComputedStyle(el).color, { r: 242, g: 243, b: 245 });
    return `rgb(${r}, ${g}, ${b})`;
}

function onThemeChange() {
    if (ctl && stage) ctl.update({ color: colorOf(stage) });
}

export function destroyTitleWarp() {
    token++;
    document.removeEventListener('themechange', onThemeChange);
    if (ctl) { try { ctl.destroy(); } catch { /* контекст уже потерян */ } ctl = null; }
    stage?.remove();
    stage = null;
}

/** Поднимает эффект на названии станции внутри уже отрисованной шапки. */
export function initTitleWarp() {
    destroyTitleWarp();
    const name = document.querySelector('.rc-station-title .rc-station-name');
    const src = name?.querySelector('.rc-warp-src');
    const text = src?.textContent?.trim();
    if (!name || !src || !text) return;

    const mine = ++token;
    const el = document.createElement('span');
    el.className = 'rc-warp-stage';
    name.appendChild(el);

    import('../warpText.js').then(({ createWarpText }) => {
        // Пока чанк ехал, доска успела перерисоваться — сцены уже нет.
        if (mine !== token || !el.isConnected) { el.remove(); return; }
        const warp = createWarpText(el, {
            text,
            color: colorOf(el),
            // Шрифт, кегль, насыщенность и разрядку эффект берёт с самого
            // заголовка: размер названия задан в CSS (clamp по ширине экрана),
            // и дублировать его числом здесь значило бы завести второй, тихо
            // расходящийся с первым.
            fontFamily: 'inherit',
            fontSize: 'inherit',
            fontWeight: 'inherit',
            letterSpacing: 'inherit',
            lineHeight: 'inherit',
        });
        if (!warp) { el.remove(); return; } // нет WebGL — надпись остаётся обычной
        ctl = warp;
        stage = el;
        name.classList.add('is-warped');
        document.addEventListener('themechange', onThemeChange);
    }).catch(() => { el.remove(); }); // чанк не приехал — то же самое
}
