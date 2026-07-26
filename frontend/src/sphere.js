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

// Золото → серый (глубина), подсветка при наведении
const GOLD = { r: 212, g: 160, b: 23 };
const GRAY = { r: 107, g: 114, b: 128 };
const HIGHLIGHT = { r: 253, g: 224, b: 132 };

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
function buildLayout(nodes) {
    const basePos = fibonacciSphere(nodes.length);
    // ~3 ребра на узел, чтобы паутина оставалась плотной
    const edgeCount = Math.min(Math.max(nodes.length * 3, 20), 200);
    const edges = buildEdges(basePos, edgeCount);
    return { nodes, basePos, edges };
}

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

    const resize = () => {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = canvas.offsetWidth * dpr;
        canvas.height = canvas.offsetHeight * dpr;
        ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    const FOV = 2.8;
    const MOUSE_RADIUS = 160;
    // Доля пути к курсору за один кадр при 60 fps (ниже нормируется по dt)
    const SMOOTH = 0.04;
    const FRAME_MS = 1000 / 60;
    // Курсора нет: точка сглаживания уезжает за пределы канваса
    const OFF = -9999;
    const hasMouse = () => mouse.x > -999;

    let proj = [];
    let prevTime = 0;

    const draw = (time) => {
        requestAnimationFrame(draw);
        const W = canvas.offsetWidth;
        const H = canvas.offsetHeight;
        // Страница поиска скрыта, сфера спрятана (мало вариантов в режиме тегов),
        // или узлов ноль — не рисуем
        if (W === 0 || !visible || layout.nodes.length === 0) {
            if (W !== 0) ctx.clearRect(0, 0, W, H);
            prevTime = 0;
            return;
        }
        const { nodes, basePos, edges } = layout;

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

        proj = basePos.map((p, i) => {
            let rx = p.x * cosY - p.z * sinY;
            let rz = p.x * sinY + p.z * cosY;
            let ry2 = p.y * cosX - rz * sinX;
            let rz2 = p.y * sinX + rz * cosX;

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
            const fr = Math.round(GRAY.r + (GOLD.r - GRAY.r) * colorT + (HIGHLIGHT.r - GOLD.r) * pulseT * 0.5);
            const fg = Math.round(GRAY.g + (GOLD.g - GRAY.g) * colorT + (HIGHLIGHT.g - GOLD.g) * pulseT * 0.5);
            const fb = Math.round(GRAY.b + (GOLD.b - GRAY.b) * colorT + (HIGHLIGHT.b - GOLD.b) * pulseT * 0.5);
            const alpha = 0.35 + depthT * 0.65;

            return { sx, sy, rz2, ps, depthT, colorR: fr, colorG: fg, colorB: fb, alpha, hoverT, node: nodes[i] };
        });

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
        const order = proj.map((_, i) => i).sort((a, b) => proj[a].rz2 - proj[b].rz2);
        for (const i of order) {
            const p = proj[i];
            const fontSize = Math.max(6.5, 8.5 * p.ps * 0.82);
            ctx.font = `500 ${fontSize}px 'Unbounded', sans-serif`;
            const textW = ctx.measureText(p.node.label).width;
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
            ctx.fillStyle = `rgba(${Math.round(p.colorR * 0.15)},${Math.round(p.colorG * 0.18)},${Math.round(p.colorB * 0.12)},0.92)`;
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
    };
    requestAnimationFrame(draw);

    canvas.addEventListener('pointermove', (e) => {
        const rect = canvas.getBoundingClientRect();
        // Курсор вернулся на канвас (был над строкой поиска или вне окна):
        // ставим точку сглаживания сразу под него. Иначе она ползёт к курсору
        // от -9999 по 4% за кадр — это ~2 секунды, всё это время узлы под
        // курсором не подсвечиваются, а подсветка едет из угла.
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
    canvas.addEventListener('pointerleave', forgetMouse);
    // pointerleave не приходит, если курсор ушёл вместе с потерей фокуса окна
    // (Alt+Tab, переключение вкладки) — иначе останется «залипшая» подсветка
    window.addEventListener('blur', forgetMouse);

    return {
        // Подменить набор узлов без пересоздания canvas/анимации (режим «Теги»)
        setNodes(nodes) { layout = buildLayout(nodes); },
        // Спрятать/показать сферу (режим «Теги»: < 5 вариантов — сфера не нужна)
        setVisible(v) {
            visible = v;
            if (!v) forgetMouse();
        },
    };
}
