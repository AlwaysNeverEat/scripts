// Иконки пасхалок — инлайновые SVG в том же стиле, что и остальные иконки
// сайта (viewBox 24×24, currentColor, скруглённые концы линий).
//
// Не эмодзи: 💣 и 🚩 в каждой ОС свои — на Windows плоские, на маке цветные, на
// Android третьи, — и подогнать их под тему, размер клетки и цвет невозможно.
// SVG наследует currentColor, поэтому одна и та же мина сама становится
// красной на проигрыше и приглушённой на закрытой клетке.

const svg = (size, body, extra = '') =>
    `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"
          stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
          aria-hidden="true"${extra}>${body}</svg>`;

// Мина: залитый шар с короткими шипами — как в классическом сапёре. Тело
// именно залито и крупное: на клетке 20×20 контурный кружок читается как ноль,
// а длинные тонкие шипы превращаются в кляксу.
export const mineIcon = (size = 16) => svg(size, `
    <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>
    <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3
             M4.6 4.6 6.7 6.7M17.3 17.3l2.1 2.1M19.4 4.6 17.3 6.7M6.7 17.3l-2.1 2.1"
          stroke-width="2"/>`);

// Флажок: древко и полотнище. Полотнище залито — иначе на маленькой клетке
// видно только палку.
export const flagIcon = (size = 16) => svg(size, `
    <line x1="6" y1="3.5" x2="6" y2="20.5"/>
    <path d="M6 4.5h11l-2.6 3.75L17 12H6z" fill="currentColor"/>`);

// Секундомер: кнопка сверху и стрелка.
export const timerIcon = (size = 16) => svg(size, `
    <circle cx="12" cy="13.5" r="7.5"/>
    <line x1="12" y1="9.5" x2="12" y2="13.5"/>
    <line x1="12" y1="13.5" x2="14.5" y2="15"/>
    <line x1="9.5" y1="2.5" x2="14.5" y2="2.5"/>
    <line x1="12" y1="2.5" x2="12" y2="6"/>`);

// Стереть (клавиша ⌫ в вордле).
export const backspaceIcon = (size = 18) => svg(size, `
    <path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7z"/>
    <line x1="12" y1="9.5" x2="17" y2="14.5"/>
    <line x1="17" y1="9.5" x2="12" y2="14.5"/>`);

// ── Тетрис ───────────────────────────────────────────────────────────────────
// Кнопки для пальцев и легенда клавиш. Раньше здесь стояли символы «←», «⟳»,
// «⤓» прямо в разметке — и выглядели ровно так, как выглядят типографские
// стрелки вместо иконок: разной толщины, разного размера и по-своему в каждой
// системе. Те же 24×24 и currentColor, что и у остальных значков.

// Двигать влево/вправо: линия со стрелкой, а не голая «галка», — на кнопке
// 100×40 одинокий шеврон читается как «свернуть», а не «шагнуть».
export const arrowLeftIcon = (size = 18) => svg(size, `
    <line x1="19" y1="12" x2="6" y2="12"/>
    <polyline points="11,7 6,12 11,17"/>`);

export const arrowRightIcon = (size = 18) => svg(size, `
    <line x1="5" y1="12" x2="18" y2="12"/>
    <polyline points="13,7 18,12 13,17"/>`);

// Стрелка вверх — на клавише поворота.
export const arrowUpIcon = (size = 18) => svg(size, `
    <line x1="12" y1="19" x2="12" y2="6"/>
    <polyline points="7,11 12,6 17,11"/>`);

// Ускорить падение — стрелка вниз.
export const arrowDownIcon = (size = 18) => svg(size, `
    <line x1="12" y1="5" x2="12" y2="18"/>
    <polyline points="7,13 12,18 17,13"/>`);

// Повернуть: дуга почти на полный круг с наконечником — по часовой стрелке,
// в ту же сторону, в которую фигуру и крутит стрелка вверх.
export const rotateIcon = (size = 18) => svg(size, `
    <path d="M20 12a8 8 0 1 1-3.2-6.4"/>
    <polyline points="20,4 20,9.5 14.5,9.5"/>`);

// Мгновенный сброс: стрелка в пол. Черта снизу — то самое дно, до которого
// фигура долетает сразу.
export const hardDropIcon = (size = 18) => svg(size, `
    <line x1="12" y1="4" x2="12" y2="14"/>
    <polyline points="7.5,9.5 12,14 16.5,9.5"/>
    <line x1="6" y1="18.5" x2="18" y2="18.5"/>`);

// Пауза.
export const pauseIcon = (size = 18) => svg(size, `
    <line x1="9.5" y1="5" x2="9.5" y2="19"/>
    <line x1="14.5" y1="5" x2="14.5" y2="19"/>`);

// ── Тройка (матч-3) ──────────────────────────────────────────────────────────
// Шесть видов фишек РАЗЛИЧАЮТСЯ ФОРМОЙ, а не только цветом: играть в матч-3 с
// нарушением цветовосприятия иначе нельзя вовсе, а «шесть оттенков подряд» плохо
// читаются и в обычных глазах — особенно на клетке 34×34 в тёмной теме.
//
// Фигуры залиты (fill), а не обведены: на клетке такого размера контур
// превращается в мутное пятно, а залитая форма узнаётся мгновенно — по силуэту,
// который и надо сравнивать глазами три раза в секунду.

export const ringIcon = (size = 20) => svg(size, `
    <circle cx="12" cy="12" r="7.2" stroke-width="3.6"/>`);

export const squareIcon = (size = 20) => svg(size, `
    <rect x="5.2" y="5.2" width="13.6" height="13.6" rx="3.4" fill="currentColor" stroke="none"/>`);

export const triangleIcon = (size = 20) => svg(size, `
    <path d="M12 4.4 20 18.8H4z" fill="currentColor" stroke="none" stroke-width="2.2" stroke-linejoin="round"/>`);

export const hexIcon = (size = 20) => svg(size, `
    <path d="M12 3.6 19.2 7.8v8.4L12 20.4 4.8 16.2V7.8z" fill="currentColor" stroke="none"/>`);

export const starIcon = (size = 20) => svg(size, `
    <path d="M12 3.4l2.65 5.85 6.35.62-4.75 4.3 1.35 6.28L12 17.2l-5.6 3.25 1.35-6.28-4.75-4.3 6.35-.62z"
          fill="currentColor" stroke="none"/>`);

export const dropIcon = (size = 20) => svg(size, `
    <path d="M12 3.4c3.7 4.3 5.9 7.5 5.9 10.2a5.9 5.9 0 0 1-11.8 0c0-2.7 2.2-5.9 5.9-10.2z"
          fill="currentColor" stroke="none"/>`);

// Специальные фишки. У них своя роль в разметке: рисуются КРУПНО вместо вида
// фишки, а сам вид уезжает в маленький значок в углу клетки, — так видно и что
// это за фигура, и по какому виду она соберётся в тройку.

// Ракета по строке: линия со стрелками в обе стороны — сносит всю строку.
export const rocketHIcon = (size = 20) => svg(size, `
    <line x1="3.5" y1="12" x2="20.5" y2="12" stroke-width="2.2"/>
    <polyline points="8,7 3.5,12 8,17" stroke-width="2.2"/>
    <polyline points="16,7 20.5,12 16,17" stroke-width="2.2"/>`);

export const rocketVIcon = (size = 20) => svg(size, `
    <line x1="12" y1="3.5" x2="12" y2="20.5" stroke-width="2.2"/>
    <polyline points="7,8 12,3.5 17,8" stroke-width="2.2"/>
    <polyline points="7,16 12,20.5 17,16" stroke-width="2.2"/>`);

// Призма: ромб с гранью — сносит все фишки своего вида. Не звезда (звезда уже
// занята видом фишки) и не «радуга»: цвет у призмы вполне определённый, именно
// его она и собирает.
export const prismIcon = (size = 20) => svg(size, `
    <path d="M12 3.2 20.8 12 12 20.8 3.2 12z" fill="currentColor" fill-opacity=".35" stroke-width="2"/>
    <path d="M12 3.2 12 20.8M3.2 12h17.6" stroke-width="1.3" stroke-opacity=".7"/>`);

// Часы: циферблат со стрелками. Отдельно от секундомера (timerIcon в сапёре):
// тот стоит в панели и обведён тонко, а этот живёт НА КЛЕТКЕ 34×34, где тонкие
// линии сливаются.
export const clockIcon = (size = 20) => svg(size, `
    <circle cx="12" cy="12" r="8" stroke-width="2.2"/>
    <polyline points="12,7 12,12 15.6,14.2" stroke-width="2.2"/>`);

// Поле перемешано: две стрелки, меняющиеся местами.
export const shuffleIcon = (size = 18) => svg(size, `
    <path d="M4 7h4.2l7.6 10H20"/>
    <path d="M4 17h4.2l7.6-10H20"/>
    <polyline points="17,4.5 20,7 17,9.5"/>
    <polyline points="17,14.5 20,17 17,19.5"/>`);
