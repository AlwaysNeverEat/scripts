// ─────────────────────────────────────────────────────────────────────────────
// Настоящее стекло для темы «Жидкое стекло» — на liquidGL (MIT, NaughtyDuk,
// https://github.com/naughtyduk/liquidGL), пакет liquid-gl в зависимостях.
//
// ЧТО ОН ДЕЛАЕТ И ПОЧЕМУ ЭТО НЕ backdrop-filter. Размытие фона — это матовое
// стекло: картинка за панелью становится мутной, но остаётся на месте.
// Настоящее стекло СМЕЩАЕТ то, что за ним: у толстого края прямая линия
// ломается, и именно по этому изгибу глаз узнаёт стекло. Никаким CSS этого не
// сделать, поэтому liquidGL растрирует страницу в текстуру и рисует панели
// шейдером в WebGL: под каждой панелью лежит своя «линза».
//
// Отсюда три правила, которые нельзя нарушать при правках.
//
// ПАНЕЛЬ НЕ ЛИНЗА, А ЕЁ РОДИТЕЛЬ. Линзой становится пустая пластина
// (.glass-pane), вставленная первым ребёнком: библиотека гасит на своём
// элементе pointer-events и стирает фон, и если сделать линзой саму панель,
// в окне перестанут нажиматься кнопки. Содержимое панели лежит НАД пластиной.
//
// ПАНЕЛЬ ИСКЛЮЧАЕТСЯ ИЗ СНИМКА (data-liquid-ignore). Иначе она попадает в
// текстуру вместе со своим текстом, и он проступает сквозь самого себя —
// буквы двоятся. Проверено: без этого атрибута окно выглядит поломанным.
//
// ЛИНЗЫ ЖИВУТ ТОЛЬКО ПОКА ВКЛЮЧЕНА ТЕМА. Растеризация страницы и кадровый цикл
// стоят денег, и платить их должен только тот, кто включил стекло. Модуль
// грузится динамическим import'ом — в чанк основного сайта 130 КБ библиотеки
// не попадают вовсе.
// ─────────────────────────────────────────────────────────────────────────────

// Панели, которые становятся стеклом: ряд вкладок, окна и меню тем.
//
// Список короткий по двум причинам. Первая — цена: каждая линза считается в
// каждом кадре, и сотня карточек в списке машин превратила бы сайт в
// слайд-шоу. Вторая — устройство библиотеки: ХОЛСТ У ВСЕХ ЛИНЗ ОДИН, и он
// один на всю страницу. Значит, все стеклянные панели обязаны лежать ВЫШЕ
// него, а всё, что должно быть видно СКВОЗЬ стекло, — ниже. Наши три лежат
// выше страницы (окно 500, ряд вкладок 520, меню 700) и друг друга не
// перекрывают. Поисковая строка на главной — соблазнительная цель (под ней
// крутится сфера), но она лежит В СТРАНИЦЕ, ниже холста: её стекло рисовалось
// бы поверх открытого окна, то есть посреди экрана висел бы кусок главной.
const GLASS_SELECTOR = '.app-tabs-inner, .modal-win, .theme-menu';

// Насколько крупная текстура снимка. Двойка (по умолчанию у библиотеки) — это
// снимок всей страницы в ретине: на длинном списке машин он упирается в предел
// размера текстуры GPU. Полтора хватает: сквозь стекло всё равно смотрят на
// смещённую картинку, а не читают текст.
const SNAPSHOT_RESOLUTION = 1.5;

// Слой холста. Библиотека кладёт его на «самую верхнюю линзу минус один», и на
// сайте с одной стеклянной шапкой это верно. У нас панелей три и на разных
// слоях, поэтому слой задаём сами: 499 — это ЧУТЬ НИЖЕ ОКНА (500) и ниже ряда
// вкладок (520) и меню (700). Оставь мы библиотечное число (699), стекло окна
// рисовалось бы ПОВЕРХ его собственных кнопок — окно выглядело бы так, будто в
// него затекла страница.
const CANVAS_Z = 499;

let liquidGL = null;        // сама библиотека, подгружается по требованию
let loading = null;         // промис загрузки — чтобы не тянуть её дважды
let active = false;
let observer = null;
let recaptureTimer = null;

// Линзы по пластинам: нужны, чтобы снять линзу, когда окно закрылось.
const lenses = new Map();

// Настройки темы, из которых считается матовость. Держим копию: ползунок
// можно двигать и до того, как библиотека догрузилась.
let settings = { blur: 18 };

/** Есть ли WebGL. Без него библиотеку не грузим вовсе — останется CSS-фолбэк. */
function hasWebGL() {
    try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch { return false; }
}

// Матовость стекла считается из того же ползунка «Размытие», что и размытие
// обоев: для человека это одна настройка — «насколько мутное стекло», — и
// разводить её на две ручки значит требовать понимать, что чем нарисовано.
function lensOptions() {
    // Матовость держим высокой даже на нуле ползунка: сквозь линзу видно
    // СТРАНИЦУ, и её текст, читаемый внутри окна, выглядит не стеклом, а
    // наложением двух экранов. Ползунок двигает матовость от «видно, что там
    // что-то есть» до «видно только пятна».
    const frost = Math.min(0.95, 0.55 + Math.max(0, settings.blur / 40) * 0.4);
    return {
        snapshot: 'body',
        resolution: SNAPSHOT_RESOLUTION,
        // Преломление подобрано на глаз по кромке: при 0.03 линии за панелью
        // ломаются заметно, но текст под краем ещё узнаётся. Выше — красиво на
        // скриншоте и мешает в работе.
        refraction: 0.03,
        aberration: 0,
        bevelDepth: 0.09,
        bevelWidth: 0.14,
        frost,
        shadow: false,      // тень у панелей своя, из style.css
        specular: true,
        reveal: 'fade',
        tilt: false,
        magnify: 1,
    };
}

/** Обновить настройки уже созданных линз (ползунок двигают — видно сразу). */
export function updateGlassSettings(theme) {
    settings = { blur: theme?.blur ?? 18 };
    const opts = lensOptions();
    lenses.forEach(lens => {
        lens.options.frost = opts.frost;
        lens.options.refraction = opts.refraction;
    });
}

// Затемнение под окном. В обычной теме его рисует .modal-backdrop внутри
// самого окна, но окно лежит НАД холстом (500 против 499), а значит и
// затемнение вместе с ним — стекло окна оказалось бы под ним и пропало.
// Поэтому под стеклом затемнение отдельным слоем на body, ниже холста: сквозь
// стекло видно затемнённую страницу, как и должно быть.
function syncModalDim() {
    const needed = [...lenses.keys()].some(pane => pane.parentElement?.classList.contains('modal-win'));
    const existing = document.querySelector('.glass-modal-dim');
    if (needed && !existing) {
        const dim = document.createElement('div');
        dim.className = 'glass-modal-dim';
        dim.setAttribute('aria-hidden', 'true');
        document.body.appendChild(dim);
    } else if (!needed && existing) {
        existing.remove();
    }
}

function paneFor(panel) {
    let pane = panel.querySelector(':scope > .glass-pane');
    if (pane) return pane;
    pane = document.createElement('div');
    pane.className = 'glass-pane';
    pane.setAttribute('aria-hidden', 'true');
    // Радиус линзы библиотека читает с самой пластины, поэтому он должен
    // совпадать с радиусом панели — берём его вычисленным, а не «на глаз».
    pane.style.borderRadius = getComputedStyle(panel).borderRadius;
    panel.prepend(pane);
    panel.setAttribute('data-liquid-ignore', '');
    return pane;
}

/** Навесить линзы на все подходящие панели, которых ещё нет в списке. */
function attachAll() {
    if (!liquidGL) return;
    document.querySelectorAll(GLASS_SELECTOR).forEach(paneFor);

    const fresh = document.querySelectorAll('.glass-pane:not([data-lensed])');
    if (!fresh.length) return;
    fresh.forEach(p => { p.dataset.lensed = '1'; });

    // target — селектор, а не узел: другого способа библиотека не даёт.
    // Помеченные выше пластины из выборки уже вышли, поэтому дважды линзу на
    // одну и ту же панель повесить нельзя.
    const created = liquidGL({ ...lensOptions(), target: '.glass-pane[data-lensed]:not([data-lens-ready])' });
    const list = Array.isArray(created) ? created : created ? [created] : [];
    list.forEach(lens => {
        lens.el.setAttribute('data-lens-ready', '');
        lenses.set(lens.el, lens);
    });
    const renderer = window.__liquidGLRenderer__;
    if (renderer?.canvas) renderer.canvas.style.zIndex = String(CANVAS_Z);
    syncModalDim();
}

/**
 * Снять линзу с исчезнувшей панели.
 *
 * Публичной ручки для этого у библиотеки нет — она рассчитана на страницу, где
 * стеклянная шапка живёт вечно. У нас же окна открываются и закрываются
 * десятками за смену, поэтому линзу вынимаем из списка рендерера руками. Не
 * вынешь — каждое закрытое окно оставит после себя линзу, которая считается
 * в каждом кадре до перезагрузки страницы.
 */
function detach(pane) {
    const lens = lenses.get(pane);
    if (!lens) return;
    lenses.delete(pane);
    const renderer = window.__liquidGLRenderer__;
    if (renderer) {
        const i = renderer.lenses.indexOf(lens);
        if (i >= 0) renderer.lenses.splice(i, 1);
    }
    lens._sizeObs?.disconnect?.();
    lens._shadowEl?.remove?.();
    lens._destroyMirrorCanvas?.();
    syncModalDim();
}

function sweepDetached() {
    for (const pane of [...lenses.keys()]) {
        if (!document.contains(pane)) detach(pane);
    }
}

/**
 * Пересобрать снимок страницы.
 *
 * Библиотека сама пересобирает его на resize и следит за зарегистрированными
 * «живыми» узлами, но наш сайт — одностраничный: вкладки переключаются
 * показом и скрытием, и с точки зрения библиотеки страница просто не меняется.
 * Поэтому снимок пересобираем сами — после смены вкладки и после того, как
 * что-то появилось или исчезло в конце body.
 */
export function refreshGlass(delay = 250) {
    if (!active) return;
    clearTimeout(recaptureTimer);
    recaptureTimer = setTimeout(() => {
        sweepDetached();
        attachAll();
        window.__liquidGLRenderer__?.captureSnapshot?.();
    }, delay);
}

/** Включить стекло. Ленивая загрузка: до первого включения библиотека не едет. */
export async function enableGlass(theme) {
    settings = { blur: theme?.blur ?? 18 };
    if (!hasWebGL()) return false;      // фолбэк на CSS — см. glass.css
    active = true;

    if (!liquidGL) {
        loading = loading || import('liquid-gl').then(m => m.default);
        liquidGL = await loading;
        if (!active) return false;      // тему успели выключить, пока грузилось
    }

    document.documentElement.dataset.glassLive = '';
    const renderer = window.__liquidGLRenderer__;
    if (renderer?.canvas) renderer.canvas.style.display = '';
    attachAll();
    window.__liquidGLRenderer__?.captureSnapshot?.();

    // Окна и меню приезжают в конец body — по этому и узнаём, что появилась
    // новая панель. Следим только за прямыми детьми body: подписка на всё
    // дерево срабатывала бы на каждую перерисовку списка машин.
    if (!observer) {
        observer = new MutationObserver(() => refreshGlass(120));
        observer.observe(document.body, { childList: true });
    }
    window.addEventListener('hashchange', onRoute);
    return true;
}

function onRoute() { refreshGlass(320); }

/** Выключить стекло: снять линзы, погасить холст и остановить кадровый цикл. */
export function disableGlass() {
    active = false;
    clearTimeout(recaptureTimer);
    observer?.disconnect();
    observer = null;
    window.removeEventListener('hashchange', onRoute);
    delete document.documentElement.dataset.glassLive;

    for (const pane of [...lenses.keys()]) detach(pane);
    document.querySelectorAll('.glass-pane').forEach(p => p.remove());
    document.querySelector('.glass-modal-dim')?.remove();
    document.querySelectorAll('[data-liquid-ignore]').forEach(el => el.removeAttribute('data-liquid-ignore'));

    const renderer = window.__liquidGLRenderer__;
    if (!renderer) return;
    if (renderer._rafId) {
        cancelAnimationFrame(renderer._rafId);
        renderer._rafId = null;
    }
    if (renderer.canvas) renderer.canvas.style.display = 'none';
}

export function isGlassLive() {
    return active && !!liquidGL;
}
