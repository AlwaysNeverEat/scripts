// ─────────────────────────────────────────────────────────────────────────────
// Капсула с ЕДУЩЕЙ ПИЛЮЛЕЙ — один переключатель на весь сайт.
//
// Раньше группа взаимоисключающих чипов выглядела как ряд отдельных кнопок, у
// которых активная просто перекрашивалась. Перекраска не показывает ПЕРЕХОДА:
// выбор скачком оказывается в другом месте, и глазу нечего проследить. Пилюля,
// которая едет из старого положения в новое, показывает именно его — это тот
// самый эффект дока в iOS, и он же будет местом, где у стеклянной темы
// заработает слияние фигур (две близкие формы, слитые smin в шейдере).
//
// ПОЧЕМУ ЭТО JS, А НЕ CSS. Чисто на CSS пилюля возможна только у групп с
// РАВНОЙ шириной пунктов (translateX кратно 100%), а у нас их меньшинства:
// «Сегодня / Завтра / Дата» и «Поиск / Теги / Клиент» — разной длины слова.
// Считать ширину и смещение всё равно приходится из разметки.
//
// ПОЧЕМУ НАБЛЮДАТЕЛЬ, А НЕ ВЫЗОВ ПОСЛЕ ОТРИСОВКИ. Записи и калькулятор
// перерисовывают свои куски целиком через innerHTML — контейнер вместе с
// пилюлей выбрасывается и создаётся заново, причём в десятке мест. Ставить
// initSegmented() после каждой отрисовки значит помнить о нём вечно и однажды
// забыть; наблюдатель за документом ловит новые группы сам, а класс .active
// внутри уже существующей — вторым наблюдателем на самой группе. Обработчики
// кликов при этом не трогаются вообще: они как переключали .active, так и
// переключают, а пилюля едет следом.
// ─────────────────────────────────────────────────────────────────────────────

const READY = 'data-seg-ready';

// Где пилюля каждой группы стояла в прошлый раз — переживает перерисовку.
//
// ЭТО НЕ КЭШ, А ЕДИНСТВЕННЫЙ СПОСОБ ПОКАЗАТЬ ПОЕЗДКУ. Записи и калькулятор на
// смену выбора перерисовывают свой кусок через innerHTML: контейнер вместе с
// пилюлей выбрасывается, и новая рождается уже на новом месте — ехать неоткуда.
// Поэтому геометрию помним ПО ИМЕНИ группы (data-seg="flush"), а не по узлу:
// узел каждый раз другой, имя одно. Дальше обычный FLIP, как у карты в дураке:
// поставить туда, где было, и в следующем кадре отпустить к тому, где надо.
const lastPlace = new Map();

// Имя нужно только для памяти между перерисовками. Не проставили — группа
// работает, просто её выбор будет переставляться скачком, как раньше.
const nameOf = (group) => group.getAttribute('data-seg') || '';

// Пилюля лежит ПОД пунктами (z-index) и не ловит мышь: клик должен доставаться
// кнопке, над которой она в этот момент проезжает.
function makePill() {
    const pill = document.createElement('i');
    pill.className = 'seg-pill';
    pill.setAttribute('aria-hidden', 'true');
    return pill;
}

// Первая укладка — БЕЗ анимации. Иначе при каждой перерисовке (а их много)
// пилюля приезжала бы из левого угла, и список записей мигал бы ею на каждый
// чих. Анимируем только настоящую смену выбора.
function place(group, animate) {
    const pill = group.querySelector(':scope > .seg-pill');
    if (!pill) return;
    const active = group.querySelector(':scope > .chip.active');
    if (!active) { pill.style.opacity = '0'; return; }

    // Считаем от контейнера, а не от страницы: getBoundingClientRect обеих
    // сторон переживает и прокрутку, и группу внутри прокручиваемого блока.
    const g = group.getBoundingClientRect();
    const a = active.getBoundingClientRect();
    if (!a.width) { pill.style.opacity = '0'; return; }   // группа ещё скрыта

    const box = { w: a.width, h: a.height, x: a.left - g.left, y: a.top - g.top };
    put(pill, box, animate);
    const name = nameOf(group);
    if (name) lastPlace.set(name, box);
}

function put(pill, box, animate) {
    pill.style.transition = animate ? '' : 'none';
    pill.style.opacity = '1';
    pill.style.width = `${box.w}px`;
    pill.style.height = `${box.h}px`;
    pill.style.transform = `translate(${box.x}px, ${box.y}px)`;
    if (!animate) {
        // Сбрасываем запрет на анимацию только после того, как браузер
        // применил новое положение, иначе следующий переход стартует из старого.
        void pill.offsetWidth;
        pill.style.transition = '';
    }
}

function attach(group) {
    if (group.hasAttribute(READY)) return;
    group.setAttribute(READY, '');
    group.insertBefore(makePill(), group.firstChild);

    // Смена выбора: обработчики кликов в записях и калькуляторе просто
    // переставляют .active, и это единственный сигнал, на который надо ехать.
    new MutationObserver(() => place(group, true))
        .observe(group, { subtree: true, attributes: true, attributeFilter: ['class'] });

    // Ширина пункта меняется не только от выбора: «Дата» превращается в
    // «14.03.2026», окно меняет размер, подгружается шрифт. Тогда пилюля
    // должна встать по-новому, но БЕЗ поездки — выбор-то прежний.
    // ПЕРВЫЙ вызов ResizeObserver пропускается, и это не перестраховка.
    // Наблюдатель присылает уведомление СРАЗУ при observe() — ничего ещё не
    // менялось, это просто «вот твой начальный размер». Приходит оно раньше
    // кадра, в котором мы собирались тронуть пилюлю с места, и ставит её на
    // конечную позицию без анимации — переезд гаснет, не начавшись.
    let firstResize = true;
    new ResizeObserver(() => {
        if (firstResize) { firstResize = false; return; }
        place(group, false);
    }).observe(group);

    // FLIP через перерисовку: если эту группу мы уже видели, ставим пилюлю
    // ТУДА, ГДЕ ОНА БЫЛА, и в следующем кадре отпускаем к новому месту. Без
    // этого перерисованный переключатель просто появляется в новом состоянии.
    const was = lastPlace.get(nameOf(group));
    const pill = group.querySelector(':scope > .seg-pill');
    if (was && pill) {
        put(pill, was, false);
        requestAnimationFrame(() => place(group, true));
    } else {
        place(group, false);
    }
}

function scan(root = document) {
    for (const g of root.querySelectorAll(`[data-seg]:not([${READY}])`)) attach(g);
}

let started = false;

/**
 * Включает капсулы на всей странице и продолжает следить за новыми.
 * Вызывается один раз при старте приложения; повторные вызовы безвредны.
 */
export function initSegmented() {
    if (started) return;
    started = true;
    scan();

    // Скан отложен до кадра: перерисовка вставляет разметку кусками, и без
    // склейки мы бы бегали по документу на каждый узел.
    let queued = false;
    new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; scan(); });
    }).observe(document.body, { childList: true, subtree: true });

    // Шрифт приезжает после первой отрисовки и меняет ширину слов.
    if (document.fonts?.ready) {
        document.fonts.ready.then(() => {
            for (const g of document.querySelectorAll(`[data-seg][${READY}]`)) place(g, false);
        });
    }
}
