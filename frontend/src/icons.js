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
