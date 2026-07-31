// ── Словесная сфера на странице поиска ───────────────────────────────────────
// Порт канвас-анимации из фигма-макета (fibonacci sphere): узлы — машины из
// БД (марка + модель + поколение). Обычный поиск — случайные до 50 штук;
// режим «Теги» подменяет узлы через setNodes() по мере сужения фильтра
// (main.js/tagSearch.js). Чисто декоративная — карточки только подсвечиваются
// под курсором, кликом никуда не ведут (было криво: тесная зона попадания,
// путаница с крестом-курсором вместо обычного).

// Fibonacci sphere — равномерное распределение точек по единичной сфере
function fibonacciSphere(n) {
    const phi = Math.PI * (3 - Math.sqrt(5));
    return Array.from({ length: Math.max(n, 2) }, (_, i) => {
        const y = 1 - (i / (Math.max(n, 2) - 1)) * 2;
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = phi * i;
        return { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r };
    });
}

// Длина подписи узла: на узком экране плашки шире экрана бессмысленны.
const LABEL_MAX = typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches ? 20 : 0;
const clipLabel = (s) => {
    const text = String(s || '');
    return text.length > LABEL_MAX ? text.slice(0, LABEL_MAX - 1).trimEnd() + '…' : text;
};

// Кратчайшие рёбра между узлами (паутина)
function buildEdges(positions, maxEdges) {
    const n = positions.length;
    const dists = [];
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const dx = positions[i].x - positions[j].x;
            const dy = positions[i].y - positions[j].y;
            const dz = positions[i].z - positions[j].z;
            dists.push({ a: i, b: j, d: dx * dx + dy * dy + dz * dz });
        }
    }
    dists.sort((a, b) => a.d - b.d);
    return dists.slice(0, maxEdges).map(e => [e.a, e.b]);
}

// Палитра узлов: цвет плывёт от «дальнего» (GRAY) к «ближнему» (GOLD),
// HIGHLIGHT добавляется под курсором. Канвас не знает про CSS-переменные,
// поэтому у каждой темы свой набор.
//
// В светлой теме логика зеркальная: дальние узлы уходят в светло-серый (почти
// сливаются с белым фоном), ближние — в тёмную бронзу, а подложка карточки
// становится белой с тёмным текстом. Тот же золотой, что на чёрном, на белом
// был бы нечитаемым пятном.
const PALETTES = {
    dark: {
        gold: { r: 212, g: 160, b: 23 },
        gray: { r: 107, g: 114, b: 128 },
        highlight: { r: 253, g: 224, b: 132 },
        // Подложка карточки — затемнённый вариант её же цвета
        card: (r, g, b) => `rgba(${Math.round(r * 0.15)},${Math.round(g * 0.18)},${Math.round(b * 0.12)},0.92)`,
    },
    light: {
        gold: { r: 148, g: 100, b: 12 },
        gray: { r: 158, g: 165, b: 176 },
        highlight: { r: 120, g: 62, b: 0 },
        card: () => 'rgba(255,255,255,0.92)',
    },
};

const themeName = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
let pal = PALETTES[themeName()];
document.addEventListener('themechange', () => { pal = PALETTES[themeName()]; });

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

// Пересчитать позиции узлов и рёбра под новый набор машин (режим «Теги»:
// сфера сужается по мере выбора марки/модели/объёма).
function buildLayout(rawNodes) {
    // Подписи вроде «MERCEDES-BENZ Класс GLC/купе X254 / C254» шире всего
    // телефона: плашки налезали друг на друга и на строку поиска. Диаметр
    // сферы на 400px экрана всё равно меньше такой строки — обрезаем.
    const nodes = LABEL_MAX ? rawNodes.map(n => ({ ...n, label: clipLabel(n.label) })) : rawNodes;
    const basePos = fibonacciSphere(nodes.length);
    // ~3 ребра на узел, чтобы паутина оставалась плотной
    const edgeCount = Math.min(Math.max(nodes.length * 3, 20), 200);
    const edges = buildEdges(basePos, edgeCount);
    // Спроецированные узлы переиспользуем между кадрами: на телефоне создавать
    // полсотни объектов 60 раз в секунду — заметная работа для сборщика мусора.
    const proj = nodes.map(() => ({
        sx: 0, sy: 0, rz2: 0, ps: 1, depthT: 0,
        colorR: 0, colorG: 0, colorB: 0, alpha: 1, hoverT: 0, node: null,
    }));
    return { nodes, basePos, edges, proj, order: nodes.map((_, i) => i), baseW: new Float64Array(nodes.length) };
}

// Ширину подписи меряем один раз на узел (в базовом кегле) и дальше просто
// масштабируем: measureText на каждый узел в каждом кадре был самой дорогой
// строкой всей анимации. Ширина глифов линейна по кеглю, поэтому картинка та же.
const BASE_FONT_PX = 10;
const fontOf = (px) => `500 ${px}px 'Unbounded', sans-serif`;

// Мобильный режим: тач-экран без мыши. Подсветки под курсором там всё равно
// нет, зато есть слабый GPU, экран 3× и батарея — поэтому и кадров вдвое
// меньше, и буфер не крупнее 2×.
const isTouchOnly = typeof matchMedia === 'function'
    && matchMedia('(hover: none) and (pointer: coarse)').matches;
const prefersReducedMotion = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
const MAX_DPR = isTouchOnly ? 2 : 3;
const MIN_FRAME_MS = isTouchOnly ? 1000 / 30 : 0;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{id:string, label:string}[]} initialNodes — машины для узлов сферы
 * @returns {{ setNodes: (nodes: {id:string,label:string}[]) => void, setVisible: (v: boolean) => void }}
 */
export function startSphere(canvas, initialNodes) {
    const ctx = canvas.getContext('2d');
    let layout = buildLayout(initialNodes);
    let visible = true;
    const mouse = { x: -9999, y: -9999 };
    const smooth = { x: -9999, y: -9999 };

    // Буфер канваса синхронизируем с его размером на странице каждый кадр, а не
    // по window.resize. Иначе сфера пропадала «до ресайза окна»: буфер
    // рассинхронизировался с вёрсткой (ресайз, пока страница поиска скрыта →
    // offsetWidth 0 → буфер 0×0; смена монитора/зума без события resize;
    // скрытие адресной строки на мобильных), и вернуть его мог только ручной
    // ресайз. Чтения offsetWidth/offsetHeight в draw() и так были — лишней
    // работы это не добавляет.
    // Возвращает false, если рисовать некуда (страница скрыта, размер 0).
    const syncSize = () => {
        const w = canvas.offsetWidth;
        const h = canvas.offsetHeight;
        if (!w || !h) return false;
        // DPR режем: у телефонов он 3, и буфер 3× — это девятикратная площадь
        // заливки на каждый кадр ради разницы, которой на этих подписях не
        // видно. Всё, что тяжелее 2×, мобильная сфера просто не окупает.
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        const bw = Math.round(w * dpr);
        const bh = Math.round(h * dpr);
        if (canvas.width !== bw || canvas.height !== bh) {
            canvas.width = bw;
            canvas.height = bh;
        }
        // setTransform, а не scale: scale домножает текущую матрицу, а браузер
        // сбрасывает её только когда реально пересоздаёт буфер. Повторный вызов
        // с тем же размером накапливал бы масштаб, и сфера уезжала за край.
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return true;
    };
    syncSize();

    // Браузер может отобрать 2D-контекст у долго живущей вкладки (нехватка
    // памяти, сброс GPU-драйвера). Без preventDefault он не станет его
    // восстанавливать, и канвас останется пустым навсегда.
    let contextLost = false;
    canvas.addEventListener('contextlost', (e) => {
        e.preventDefault();
        contextLost = true;
    });
    canvas.addEventListener('contextrestored', () => {
        contextLost = false;
        // Буфер после восстановления пустой — заставляем syncSize() выставить
        // размеры и трансформацию заново
        canvas.width = 0;
        prevTime = 0;
    });

    const FOV = 2.8;
    const MOUSE_RADIUS = 160;
    // Доля пути к курсору за один кадр при 60 fps (ниже нормируется по dt)
    const SMOOTH = 0.04;
    const FRAME_MS = 1000 / 60;
    // Курсора нет: точка сглаживания уезжает за пределы канваса
    const OFF = -9999;
    const hasMouse = () => mouse.x > -999;

    let prevTime = 0;
    let rafId = 0;
    let lastFrame = 0;
    let running = false;

    const draw = (time) => {
        const W = canvas.offsetWidth;
        const H = canvas.offsetHeight;
        // Страница поиска скрыта, сфера спрятана (мало вариантов в режиме тегов),
        // узлов ноль, вкладка в фоне или контекст отобран браузером — не рисуем.
        // И цикл на это время останавливаем совсем: раньше кадры продолжали
        // запрашиваться на любой другой вкладке сайта, впустую будя телефон
        // шестьдесят раз в секунду. Обратно его заводит kick() — по возврату
        // вкладки, по setVisible/setNodes и по ResizeObserver (страница поиска
        // снова получила размер).
        if (W === 0 || !visible || layout.nodes.length === 0 || contextLost || document.hidden) {
            if (W !== 0 && !contextLost) ctx.clearRect(0, 0, W, H);
            prevTime = 0;
            running = false;
            return;
        }
        rafId = requestAnimationFrame(draw);
        // На тач-экранах держим ~30 кадров: подсветки под курсором там нет, а
        // разницу между 30 и 60 на медленном вращении видно только по нагреву.
        if (MIN_FRAME_MS && time - lastFrame < MIN_FRAME_MS) return;
        lastFrame = time;
        if (!syncSize()) {
            prevTime = 0;
            return;
        }
        const { nodes, basePos, edges, proj, order, baseW } = layout;

        ctx.clearRect(0, 0, W, H);

        // dt вместо «одного кадра»: на 144 Гц подсветка не догоняет курсор
        // втрое быстрее, а после простоя вкладки не прыгает рывком
        const dt = prevTime ? Math.min(time - prevTime, 100) : FRAME_MS;
        prevTime = time;

        if (hasMouse()) {
            const k = 1 - Math.pow(1 - SMOOTH, dt / FRAME_MS);
            smooth.x += (mouse.x - smooth.x) * k;
            smooth.y += (mouse.y - smooth.y) * k;
        } else {
            smooth.x = OFF;
            smooth.y = OFF;
        }

        const t = time * 0.00022;
        const rotY = t;
        const rotX = Math.sin(t * 0.37) * 0.18;
        const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
        const cosX = Math.cos(rotX), sinX = Math.sin(rotX);

        const R = Math.min(W, H) * 0.30;
        const cx = W / 2;
        const cy = H / 2;

        const { gold: GOLD, gray: GRAY, highlight: HIGHLIGHT } = pal;
        for (let i = 0; i < basePos.length; i++) {
            const p = basePos[i];
            const rx = p.x * cosY - p.z * sinY;
            const rz = p.x * sinY + p.z * cosY;
            const ry2 = p.y * cosX - rz * sinX;
            const rz2 = p.y * sinX + rz * cosX;

            const ps = FOV / (FOV - rz2 * 0.8);
            const sx = cx + rx * R * ps;
            const sy = cy + ry2 * R * ps;

            const mdx = sx - smooth.x;
            const mdy = sy - smooth.y;
            const md = Math.sqrt(mdx * mdx + mdy * mdy);
            let hoverT = 0;
            if (md < MOUSE_RADIUS && md > 0.01) {
                hoverT = Math.pow(1 - md / MOUSE_RADIUS, 2);
            }

            const depthT = (rz2 + 1) / 2;
            const pulseT = Math.min(1, hoverT * 0.7);
            const colorT = Math.min(1, depthT + pulseT * 0.35);
            const o = proj[i];
            o.sx = sx; o.sy = sy; o.rz2 = rz2; o.ps = ps; o.depthT = depthT; o.hoverT = hoverT;
            o.colorR = Math.round(GRAY.r + (GOLD.r - GRAY.r) * colorT + (HIGHLIGHT.r - GOLD.r) * pulseT * 0.5);
            o.colorG = Math.round(GRAY.g + (GOLD.g - GRAY.g) * colorT + (HIGHLIGHT.g - GOLD.g) * pulseT * 0.5);
            o.colorB = Math.round(GRAY.b + (GOLD.b - GRAY.b) * colorT + (HIGHLIGHT.b - GOLD.b) * pulseT * 0.5);
            o.alpha = 0.35 + depthT * 0.65;
            o.node = nodes[i];
        }

        // Рёбра
        for (const [a, b] of edges) {
            const pa = proj[a];
            const pb = proj[b];
            const avgDepth = (pa.depthT + pb.depthT) / 2;
            const lAlpha = (0.10 + avgDepth * 0.22) * Math.min(pa.alpha, pb.alpha);
            const lr = Math.round(GRAY.r + (GOLD.r - GRAY.r) * avgDepth);
            const lg = Math.round(GRAY.g + (GOLD.g - GRAY.g) * avgDepth);
            const lb = Math.round(GRAY.b + (GOLD.b - GRAY.b) * avgDepth);
            ctx.beginPath();
            ctx.moveTo(pa.sx, pa.sy);
            ctx.lineTo(pb.sx, pb.sy);
            ctx.strokeStyle = `rgba(${lr},${lg},${lb},${lAlpha})`;
            ctx.lineWidth = 0.4 + avgDepth * 0.6;
            ctx.stroke();
        }

        // Узлы, сзади → вперёд
        order.sort((a, b) => proj[a].rz2 - proj[b].rz2);
        for (const i of order) {
            const p = proj[i];
            const fontSize = Math.max(6.5, 8.5 * p.ps * 0.82);
            ctx.font = fontOf(fontSize);
            if (!baseW[i]) {
                ctx.font = fontOf(BASE_FONT_PX);
                baseW[i] = ctx.measureText(p.node.label).width || 1;
                ctx.font = fontOf(fontSize);
            }
            const textW = baseW[i] * (fontSize / BASE_FONT_PX);
            const cardW = textW + 16 * p.ps * 0.82;
            const cardH = 19 * p.ps * 0.82;
            const rr = 4 * p.ps * 0.82;
            const x = p.sx - cardW / 2;
            const y = p.sy - cardH / 2;

            if (p.hoverT > 0) {
                ctx.save();
                ctx.globalAlpha = p.hoverT * 0.22;
                ctx.shadowColor = `rgb(${p.colorR},${p.colorG},${p.colorB})`;
                ctx.shadowBlur = 18 * p.hoverT;
                ctx.fillStyle = `rgb(${p.colorR},${p.colorG},${p.colorB})`;
                roundRect(ctx, x - 4, y - 4, cardW + 8, cardH + 8, rr + 3);
                ctx.fill();
                ctx.restore();
            }

            ctx.globalAlpha = p.alpha * 0.82;
            ctx.fillStyle = pal.card(p.colorR, p.colorG, p.colorB);
            roundRect(ctx, x, y, cardW, cardH, rr);
            ctx.fill();

            ctx.globalAlpha = p.alpha * (0.4 + p.hoverT * 0.4);
            ctx.strokeStyle = `rgb(${p.colorR},${p.colorG},${p.colorB})`;
            ctx.lineWidth = 0.5 + p.hoverT * 0.8;
            roundRect(ctx, x, y, cardW, cardH, rr);
            ctx.stroke();

            ctx.globalAlpha = p.alpha * (0.75 + p.hoverT * 0.25);
            ctx.fillStyle = `rgb(${p.colorR},${p.colorG},${p.colorB})`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(p.node.label, p.sx, p.sy);

            ctx.globalAlpha = 1;
        }

        // «Меньше движения» в системе — рисуем один кадр и замираем: сфера
        // остаётся на месте, но вкладка перестаёт быть вечной анимацией.
        if (prefersReducedMotion) {
            cancelAnimationFrame(rafId);
            running = false;
        }
    };
    // Единственная точка входа в цикл: cancelAnimationFrame перед новым
    // запросом гарантирует, что параллельных циклов не появится
    const kick = () => {
        cancelAnimationFrame(rafId);
        prevTime = 0;
        lastFrame = 0;
        running = true;
        rafId = requestAnimationFrame(draw);
    };
    kick();
    // Замороженная вкладка (Chrome «discard», bfcache в Safari) может не
    // возобновить rAF сама — перезапускаем цикл, когда страница снова видна
    document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
    window.addEventListener('pageshow', kick);
    // Цикл останавливается, когда канвас нулевого размера (ушли с поиска на
    // другую вкладку сайта) — ResizeObserver будит его, когда страница поиска
    // снова получает размер.
    if (typeof ResizeObserver === 'function') {
        new ResizeObserver(() => {
            if (!running && canvas.offsetWidth) kick();
        }).observe(canvas);
    }
    // Фирменный шрифт приезжает с задержкой (и может не приехать вовсе):
    // измеренные до него ширины подписей надо забыть, иначе плашки останутся
    // по размеру системного шрифта.
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            layout.baseW.fill(0);
            if (!running) kick();
        }).catch(() => { /* без фирменного шрифта тоже жить можно */ });
    }

    // Указатель слушаем на контейнере страницы, а не на канвасе. Строка поиска
    // с переключателем и результатами лежит поверх канваса и, в отличие от
    // самого оверлея, ловит pointer-события (.search-ui > * { pointer-events:
    // auto }) — pointermove до канваса просто не доходил, а вдобавок прилетал
    // pointerleave, и подсветка гасла целиком, стоило навести на инпут. С
    // контейнера события всплывают и от инпута, и от кнопок, поэтому узлы
    // продолжают подсвечиваться, пока курсор идёт по строке поиска.
    const pointerHost = canvas.parentElement || canvas;
    pointerHost.addEventListener('pointermove', (e) => {
        const rect = canvas.getBoundingClientRect();
        // Курсор вернулся в окно: ставим точку сглаживания сразу под него,
        // иначе она ползёт к курсору от -9999 по 4% за кадр — это ~2 секунды,
        // всё это время узлы под курсором не подсвечиваются, а подсветка едет
        // из угла.
        const jump = !hasMouse();
        mouse.x = e.clientX - rect.left;
        mouse.y = e.clientY - rect.top;
        if (jump) {
            smooth.x = mouse.x;
            smooth.y = mouse.y;
        }
    });
    const forgetMouse = () => {
        mouse.x = OFF;
        mouse.y = OFF;
    };
    // Тоже с контейнера: уход с канваса на строку поиска — не уход мыши
    pointerHost.addEventListener('pointerleave', forgetMouse);
    // pointerleave не приходит, если курсор ушёл вместе с потерей фокуса окна
    // (Alt+Tab, переключение вкладки) — иначе останется «залипшая» подсветка
    window.addEventListener('blur', forgetMouse);

    return {
        // Подменить набор узлов без пересоздания canvas/анимации (режим «Теги»)
        setNodes(nodes) {
            layout = buildLayout(nodes);
            if (!running) kick();
        },
        // Спрятать/показать сферу (режим «Теги»: < 5 вариантов — сфера не нужна)
        setVisible(v) {
            visible = v;
            if (!v) forgetMouse();
            else if (!running) kick();
        },
    };
}
