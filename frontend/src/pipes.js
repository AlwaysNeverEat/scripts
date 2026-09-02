// ── Трубы: вторая заставка на фоне главной ───────────────────────────────────
// Тот самый хранитель экрана из Windows 95, по мотивам github.com/1j01/pipes.
// Выбирается в профиле («Оформление» → «Фон главной»); значением по умолчанию
// остаётся сфера — см. background.js.
//
// ПОЧЕМУ НЕ THREE.JS, НА КОТОРОМ НАПИСАН ОРИГИНАЛ. Это фон под строкой поиска,
// а не игра: three.min.js — 550 КБ и постоянный WebGL-контекст ради клубка
// цилиндров, который на экране и так читается силуэтом. Проекцию и сортировку
// по глубине соседняя сфера (sphere.js) уже считает сама, и трубам хватает
// того же: труба — это ЛИНИЯ КРУГЛЫМ ПЕРОМ, а цилиндр из неё делает вторая
// линия поуже, сдвинутая к свету. Плата названа честно: настоящих бликов,
// теней и чайника-меша здесь нет и не будет.
//
// ЧТО ПРИШЛО НЕ ИЗ ОРИГИНАЛА, А ИЗ ЗАПРОСА: камера. В оригинале она стоит и
// прыгает в случайную точку на каждой перезагрузке клубка — заставке 95-го
// года это шло, а фону, на который смотрят весь день, нет. Здесь она ЕДЕТ
// вокруг куба непрерывно и по ходу цикла понемногу отъезжает: клубок растёт, и
// неподвижная камера сперва утыкается в него носом, а потом теряет за краем.
// Прыжок остался ровно один — в момент, когда экран уже пуст (см. фазы), и
// увидеть его нельзя.
//
// ФОН ПРОСТРАНСТВА ЗДЕСЬ НЕ РИСУЕТСЯ ВОВСЕ: канвас прозрачный, а под ним тот
// же --search-bg, что и под сферой, — то есть тему фон слушает сам, без единой
// строчки в этом файле. Зато ДЫМКА, в которой тонут дальние трубы, красится
// этим же цветом, и её пересчитывает repaint() по themechange: без неё на
// светлой теме дальние трубы уходили бы в черноту посреди белого экрана.

import { cssToRgb, varToRgb } from './cssColor.js';
import { createGrid, spawnPipe, stepPipe, rng } from './pipesGrid.js';

// ── Геометрия сцены ──────────────────────────────────────────────────────────
const HALF = 8;              // куб узлов ±8 (у оригинала ±10)
const PIPE_R = 0.22;         // радиус трубы в клетках
const BALL_R = PIPE_R * 1.55;
const TEAPOT_R = PIPE_R * 1.9;

// ── Ход цикла ────────────────────────────────────────────────────────────────
// Одна труба шагает раз в GROW_MS. Оригинал растит по отрезку НА КАДР — это
// шестьдесят клеток в секунду на трубу, за десяток секунд куб забит, и смотреть
// уже не на что. Тут рост нарочно медленнее хода камеры: клубок собирается на
// глазах, а не появляется целиком.
const GROW_MS = 240;
const PIPES_MIN = 2;
const PIPES_MAX = 3;
// Потолок отрезков — не про красоту, а про кадр: каждый отрезок это две линии
// в КАЖДОМ кадре, и тысяча труб превращает фон главной в обогреватель. Пятьсот
// при таком росте набираются примерно за минуту.
const MAX_SEGMENTS = 500;
const CYCLE_MS = 75000;
const FADE_OUT_MS = 1700;
const FADE_IN_MS = 900;

// ── Камера ───────────────────────────────────────────────────────────────────
const YAW_SPEED = 2 * Math.PI / 190000;   // оборот примерно за три минуты
const PITCH_MID = 0.16;
const PITCH_AMP = 0.24;
const PITCH_MS = 97000;                   // не кратно обороту — вид не повторяется
// Куб целиком в кадре с запасом: на ближнем краю он занимает почти всю
// меньшую сторону окна, на дальнем — примерно её половину. Ближе камеру
// подпускать нельзя не из-за красоты: с дистанции меньше пятнадцати передние
// трубы перестают помещаться, и клубок читается как забор поперёк экрана.
const DIST_NEAR = 21;
const DIST_FAR = 33;
const FOV_K = 1.15;                       // фокусное = FOV_K × меньшая сторона окна
const NEAR = 0.8;                         // ближе этого куски отрезков отрезаются

// Экранное направление на свет: влево-вверх. Блик всегда с этой стороны трубы —
// иначе клубок читается набором плоских палок.
const LIGHT_X = -0.55;
const LIGHT_Y = -0.83;

// ── Цвет ─────────────────────────────────────────────────────────────────────
// ТРУБЫ РАЗНОЦВЕТНЫЕ, и это не забытый акцент: в разноцветности вся заставка,
// одноцветный клубок читается как ошибка отрисовки. Акцент никуда не делся — он
// красит свечение пространства под канвасом (--search-glow в style.css). А вот
// тему трубы слушают светлотой: на белом фоне те же тона надо брать темнее,
// иначе клубок выцветает в молоко.
const RECIPES = {
    dark: {
        base: (h) => `oklch(0.66 0.155 ${h})`,
        hi: (h) => `oklch(0.86 0.105 ${h})`,
        fog: 0.70,
    },
    light: {
        base: (h) => `oklch(0.60 0.145 ${h})`,
        hi: (h) => `oklch(0.79 0.115 ${h})`,
        fog: 0.50,
    },
};
const FALLBACK_BG = { dark: { r: 7, g: 9, b: 13 }, light: { r: 246, g: 247, b: 249 } };
const FALLBACK_PIPE = { r: 150, g: 150, b: 160 };

const themeName = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

// Готовых строк цвета на трубу — по ступени дымки, а не по кадру. Иначе на
// каждый отрезок в каждом кадре собиралась бы пара строк «rgb(…)»: тысяча
// строк шестьдесят раз в секунду ради цвета, который между соседними ступенями
// не отличить. Ступеней 32 — на глаз полос не видно.
const FOG_STEPS = 32;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => t * t * (3 - 2 * t);

const isTouchOnly = typeof matchMedia === 'function'
    && matchMedia('(hover: none) and (pointer: coarse)').matches;
const prefersReducedMotion = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
const MAX_DPR = isTouchOnly ? 2 : 2.5;
const MIN_FRAME_MS = isTouchOnly ? 1000 / 30 : 0;

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {{ setVisible: (v: boolean) => void }}
 */
export function startPipes(canvas) {
    const ctx = canvas.getContext('2d');
    const rnd = rng((Math.random() * 0xffffffff) >>> 0);
    const grid = createGrid(HALF);

    let pipes = [];
    let segments = [];
    let visible = true;
    let bg = FALLBACK_BG[themeName()];
    let fogK = RECIPES[themeName()].fog;

    // Порядок отрисовки: индексы отрезков, отсортированные по глубине. Массив
    // переиспользуется между кадрами — пятьсот чисел незачем создавать заново
    // шестьдесят раз в секунду (тот же довод, что у сферы).
    const order = [];

    // ── Цвета труб ───────────────────────────────────────────────────────────
    // Палитра — ОБЩИЙ ОБЪЕКТ трубы и всех её отрезков, и меняется он на месте.
    // Если на смену темы создавать новый, отрезки умерших труб остались бы с
    // цветами прошлой темы: труба живёт до тупика, а её отрезки — до конца
    // цикла. Поэтому палитры лежат отдельным списком, а не берутся из pipes.
    let palettes = [];

    function paint(p) {
        const r = RECIPES[themeName()];
        p.base = cssToRgb(r.base(p.hue), FALLBACK_PIPE);
        p.hi = cssToRgb(r.hi(p.hue), FALLBACK_PIPE);
        p.baseFog = new Array(FOG_STEPS);
        p.hiFog = new Array(FOG_STEPS);
    }

    function repaint() {
        bg = varToRgb('--search-bg', FALLBACK_BG[themeName()]);
        fogK = RECIPES[themeName()].fog;
        for (const p of palettes) paint(p);
    }
    repaint();

    // Тон новой трубы не должен совпасть с предыдущей: два близких оттенка
    // читаются как одна труба, ошибшаяся геометрией.
    let lastHue = -999;
    function newPipe() {
        const pipe = spawnPipe(grid, rnd);
        if (!pipe) return null;
        let hue = 0;
        for (let i = 0; i < 8; i++) {
            hue = rnd() * 360;
            if (Math.abs(((hue - lastHue + 540) % 360) - 180) > 45) break;
        }
        lastHue = hue;
        const pal = { hue };
        paint(pal);
        palettes.push(pal);
        pipe.pal = pal;
        return pipe;
    }

    function reset() {
        grid.clear();
        segments = [];
        order.length = 0;
        palettes = [];
        pipes = [];
        const want = PIPES_MIN + (rnd() < 0.4 ? PIPES_MAX - PIPES_MIN : 0);
        for (let i = 0; i < want; i++) {
            const pipe = newPipe();
            if (pipe) pipes.push(pipe);
        }
    }

    // Шаг роста: каждая труба делает по отрезку, мёртвую заменяет новая. У
    // оригинала замены нет — там труба, упёршаяся в занятый узел, молча стоит
    // до конца цикла (см. pipesGrid.js).
    function grow() {
        for (let i = 0; i < pipes.length; i++) {
            const pipe = pipes[i];
            const seg = stepPipe(pipe, grid, rnd);
            if (seg) {
                seg.pal = pipe.pal;
                // Где отрезок стыкуется с соседом по своей трубе. Нужно
                // единственно для блика: см. drawSegment — на стыке его концы
                // приходится вытягивать под соседа.
                seg.joinA = false;
                seg.joinB = false;
                if (pipe.tail) {
                    pipe.tail.joinB = true;
                    seg.joinA = true;
                }
                pipe.tail = seg;
                // Шарнир только на повороте: круглое перо и так скругляет угол,
                // а шар с чайником — та самая примета заставки. Чайник редкий,
                // как в оригинале.
                seg.joint = seg.turn ? (rnd() < 1 / 200 ? 2 : rnd() < 1 / 3 ? 1 : 0) : 0;
                segments.push(seg);
            } else {
                const next = newPipe();
                if (next) pipes[i] = next;
                else pipes.splice(i--, 1);
            }
        }
    }

    // ── Размер буфера, потеря контекста, цикл ────────────────────────────────
    // Всё ниже — та же механика, что у сферы, и по тем же причинам (там она
    // расписана подробно): буфер синхронизируется каждый кадр, а не по resize;
    // цикл останавливается на скрытой странице, в фоновой вкладке и под
    // открытой модалкой, а будят его visibilitychange, ResizeObserver и
    // наблюдатель за классом modal-open.
    const syncSize = () => {
        const w = canvas.offsetWidth;
        const h = canvas.offsetHeight;
        if (!w || !h) return false;
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        const bw = Math.round(w * dpr);
        const bh = Math.round(h * dpr);
        if (canvas.width !== bw || canvas.height !== bh) {
            canvas.width = bw;
            canvas.height = bh;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return true;
    };
    syncSize();

    let contextLost = false;
    canvas.addEventListener('contextlost', (e) => {
        e.preventDefault();
        contextLost = true;
    });
    canvas.addEventListener('contextrestored', () => {
        contextLost = false;
        canvas.width = 0;
        prevTime = 0;
    });

    // ── Фазы: появление → рост → уход → новый клубок ─────────────────────────
    let phase = 'in';
    let phaseMs = 0;
    let age = 0;        // возраст клубка: от него считается отъезд камеры
    let clock = 0;      // время с запуска: от него качание по высоте
    let growAcc = 0;
    let yaw = rnd() * Math.PI * 2;
    let prevTime = 0;
    let lastFrame = 0;
    let rafId = 0;
    let running = false;
    let lastFade = -1;

    reset();

    const step = (dt) => {
        age += dt;
        clock += dt;
        phaseMs += dt;
        yaw += dt * YAW_SPEED;

        if (phase === 'in' && phaseMs >= FADE_IN_MS) { phase = 'grow'; phaseMs = 0; }
        if (phase !== 'out') {
            growAcc += dt;
            // Потолок на догон: dt и так обрезан сотней миллисекунд, но рост не
            // должен выстреливать пачкой отрезков в один кадр после сна вкладки.
            let guard = 4;
            while (growAcc >= GROW_MS && guard-- > 0) {
                growAcc -= GROW_MS;
                grow();
            }
            if (growAcc >= GROW_MS) growAcc = 0;
            if (segments.length >= MAX_SEGMENTS || age >= CYCLE_MS || !pipes.length) {
                phase = 'out';
                phaseMs = 0;
            }
        } else if (phaseMs >= FADE_OUT_MS) {
            // Экран уже пуст — только здесь камере и можно вернуться к кубу.
            reset();
            age = 0;
            phase = 'in';
            phaseMs = 0;
        }
    };

    const fadeNow = () => {
        if (phase === 'in') return clamp01(phaseMs / FADE_IN_MS);
        if (phase === 'out') return 1 - clamp01(phaseMs / FADE_OUT_MS);
        return 1;
    };

    const draw = (time) => {
        const W = canvas.offsetWidth;
        const H = canvas.offsetHeight;
        const paused = document.body.classList.contains('modal-open');
        if (W === 0 || !visible || contextLost || document.hidden || paused) {
            if (W !== 0 && !contextLost && !paused) ctx.clearRect(0, 0, W, H);
            prevTime = 0;
            running = false;
            return;
        }
        rafId = requestAnimationFrame(draw);
        if (MIN_FRAME_MS && time - lastFrame < MIN_FRAME_MS) return;
        lastFrame = time;
        if (!syncSize()) {
            prevTime = 0;
            return;
        }

        const dt = prevTime ? Math.min(time - prevTime, 100) : 16;
        prevTime = time;
        if (!prefersReducedMotion) step(dt);

        ctx.clearRect(0, 0, W, H);

        // Камера: непрерывный объезд, качание по высоте и медленный отъезд по
        // ходу цикла. Отъезд считается от ВОЗРАСТА клубка, а качание — от
        // общего времени: возраст обнуляется на каждом клубке, и высота
        // повторяла бы один и тот же проход раз за разом.
        const pitch = PITCH_MID + Math.sin((clock / PITCH_MS) * Math.PI * 2) * PITCH_AMP;
        const dist = DIST_NEAR + (DIST_FAR - DIST_NEAR) * smooth(clamp01(age / CYCLE_MS));
        const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
        const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
        const f = Math.min(W, H) * FOV_K;
        const cx = W / 2;
        const cy = H / 2;
        // Дымка: ближний край — передняя грань куба, дальний — задняя.
        const fogNear = dist - HALF;
        const fogSpan = HALF * 2.4;

        let count = 0;
        for (let i = 0; i < segments.length; i++) {
            const s = segments[i];
            s.vis = false;

            // Вид: поворот вокруг Y (объезд), потом вокруг X (высота). Числа
            // держим в переменных, а не в объектах точки: на пятистах отрезках
            // это тысяча объектов в мусор на каждый кадр.
            let arx = s.ax * cosY - s.az * sinY;
            let arz = s.ax * sinY + s.az * cosY;
            let ary = s.ay * cosP - arz * sinP;
            let ad = dist - (s.ay * sinP + arz * cosP);

            let brx = s.bx * cosY - s.bz * sinY;
            let brz = s.bx * sinY + s.bz * cosY;
            let bry = s.by * cosP - brz * sinP;
            let bd = dist - (s.by * sinP + brz * cosP);

            // Отсечение по ближней плоскости: камера ездит внутри сферы,
            // описанной вокруг куба, и куски труб регулярно оказываются у неё
            // за спиной. Без отсечения такой отрезок улетает через весь экран
            // зеркальной чертой.
            if (ad < NEAR && bd < NEAR) continue;
            s.jointVis = ad > NEAR;
            s.jointScale = f / ad;
            if (ad < NEAR) {
                const t = (NEAR - ad) / (bd - ad);
                arx += (brx - arx) * t; ary += (bry - ary) * t; ad = NEAR;
            } else if (bd < NEAR) {
                const t = (NEAR - bd) / (ad - bd);
                brx += (arx - brx) * t; bry += (ary - bry) * t; bd = NEAR;
            }

            s.x1 = cx + arx * f / ad;
            s.y1 = cy - ary * f / ad;
            s.x2 = cx + brx * f / bd;
            s.y2 = cy - bry * f / bd;
            s.d = (ad + bd) / 2;
            s.scale = f / s.d;
            s.vis = true;
            order[count++] = i;
        }
        order.length = count;
        // Сзади наперёд: узел занимает ровно одна труба, поэтому спорить за
        // пиксель могут только разнесённые по глубине отрезки — а у них порядок
        // однозначен, и художника хватает.
        order.sort((a, b) => segments[b].d - segments[a].d);

        // ПОЯВЛЕНИЕ И УХОД КЛУБКА ГАСЯТСЯ ЦЕЛИКОМ, ЧЕРЕЗ CSS, а не globalAlpha
        // на кисти. Полупрозрачной кистью каждое перекрытие складывается само с
        // собой: трубы просвечивают друг через друга, а на стыках, где блик
        // заходит под соседа, проступают светлые точки. Канвас же гасится как
        // готовая картинка — ровно, чем бы он ни был нарисован.
        const fade = fadeNow();
        if (fade !== lastFade) {
            canvas.style.setProperty('--pipes-fade', String(fade));
            lastFade = fade;
        }
        ctx.lineCap = 'round';
        for (let k = 0; k < order.length; k++) {
            drawSegment(ctx, segments[order[k]], bg, fogNear, fogSpan, fogK);
        }

        // «Меньше движения» в системе: показываем готовый клубок и замираем —
        // фон остаётся картинкой, а не вечной анимацией.
        if (prefersReducedMotion) {
            cancelAnimationFrame(rafId);
            running = false;
        }
    };

    const kick = () => {
        cancelAnimationFrame(rafId);
        prevTime = 0;
        lastFrame = 0;
        running = true;
        rafId = requestAnimationFrame(draw);
    };

    // «Меньше движения»: клубок собирается разом, до первого кадра, — расти ему
    // всё равно не дадут, цикл встанет сразу после первой отрисовки.
    if (prefersReducedMotion) {
        while (segments.length < MAX_SEGMENTS * 0.6 && pipes.length) grow();
        phase = 'grow';
        age = CYCLE_MS * 0.55;
    }

    kick();
    document.addEventListener('themechange', () => { repaint(); if (!running) kick(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
    window.addEventListener('pageshow', kick);
    if (typeof MutationObserver === 'function') {
        new MutationObserver(() => {
            if (!running && !document.body.classList.contains('modal-open')) kick();
        }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
    if (typeof ResizeObserver === 'function') {
        new ResizeObserver(() => {
            if (!running && canvas.offsetWidth) kick();
        }).observe(canvas);
    }

    return {
        // Фон переключили на сферу — трубы замирают (цикл встанет и сам, когда
        // канвас спрячут, но полагаться на это незачем).
        setVisible(v) {
            visible = v;
            if (v && !running) kick();
        },
    };
}

// ── Рисование одного отрезка ─────────────────────────────────────────────────
// Труба — это ДВЕ линии: широкая цветом трубы и узкая, сдвинутая к свету,
// цветом блика. Настоящий градиент поперёк цилиндра выглядел бы честнее, но
// createLinearGradient на каждый отрезок в каждом кадре — это пятьсот новых
// объектов шестьдесят раз в секунду ради разницы, которую видно стоп-кадром.
function drawSegment(ctx, s, bg, fogNear, fogSpan, fogK) {
    if (!s.vis) return;
    const w = PIPE_R * 2 * s.scale;
    if (w < 0.6) return;                       // тоньше половины пикселя — не видно

    const t = clamp01((s.d - fogNear) / fogSpan) * fogK;
    const fogStep = Math.min(FOG_STEPS - 1, (t * FOG_STEPS) | 0);
    const base = fogged(s.pal, 'base', fogStep, bg);

    ctx.strokeStyle = base;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.stroke();

    // Блик кладём, только пока труба толще трёх пикселей: на дальних он
    // сливается с телом и остаётся шумом.
    //
    // НА СТЫКАХ БЛИК ВЫТЯГИВАЕТСЯ ПОД СОСЕДА — без этого труба выглядит
    // пунктирной. Отрезки рисуются по одному и сзади наперёд, поэтому круглый
    // торец соседнего отрезка закрашивает своим телом конец нашего блика: на
    // каждой клетке появляется прореха. Вытягиваем ровно на полтолщины —
    // столько же, сколько занимает торец соседа, так что наружу вылезти
    // некуда, а прорехе взяться неоткуда. На свободном конце трубы (соседа
    // нет) блик, наоборот, не вытягиваем — он торчал бы за срез.
    let hi = null;
    if (w > 3) {
        hi = fogged(s.pal, 'hi', fogStep, bg);
        const dx = s.x2 - s.x1;
        const dy = s.y2 - s.y1;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        let nx = -uy;
        let ny = ux;
        if (nx * LIGHT_X + ny * LIGHT_Y < 0) { nx = -nx; ny = -ny; }
        const off = w * 0.22;
        const ea = s.joinA ? w * 0.5 : 0;
        const eb = s.joinB ? w * 0.5 : 0;
        ctx.strokeStyle = hi;
        ctx.lineWidth = w * 0.34;
        ctx.beginPath();
        ctx.moveTo(s.x1 + nx * off - ux * ea, s.y1 + ny * off - uy * ea);
        ctx.lineTo(s.x2 + nx * off + ux * eb, s.y2 + ny * off + uy * eb);
        ctx.stroke();
    }

    if (s.joint && s.jointVis) {
        if (!hi) hi = fogged(s.pal, 'hi', fogStep, bg);
        if (s.joint === 2) teapot(ctx, s.x1, s.y1, TEAPOT_R * s.jointScale, base, hi);
        else ball(ctx, s.x1, s.y1, BALL_R * s.jointScale, base, hi);
    }
}

function ball(ctx, x, y, r, base, hi) {
    if (r < 0.7) return;
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (r > 2.5) {
        ctx.fillStyle = hi;
        ctx.beginPath();
        ctx.arc(x + LIGHT_X * r * 0.42, y + LIGHT_Y * r * 0.42, r * 0.4, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ЧАЙНИК — пасхалка самого оригинала (там это настоящий чайник из Юты, меш на
// пару тысяч треугольников). Плоским пером меш не нарисуешь, поэтому здесь
// СИЛУЭТ: тулово, носик, ручка, крышечка. Он не поворачивается вместе с
// камерой — в этом и разница между силуэтом и мешем; на размере в десяток
// пикселей раз в цикл её не видно, а меш стоил бы отдельной библиотеки.
function teapot(ctx, x, y, r, base, hi) {
    if (r < 2) return ball(ctx, x, y, r, base, hi);
    ctx.strokeStyle = base;
    ctx.fillStyle = base;

    ctx.lineWidth = r * 0.34;                  // носик
    ctx.beginPath();
    ctx.moveTo(x + r * 0.55, y + r * 0.1);
    ctx.lineTo(x + r * 1.25, y - r * 0.45);
    ctx.stroke();

    ctx.lineWidth = r * 0.24;                  // ручка
    ctx.beginPath();
    ctx.arc(x - r * 0.75, y - r * 0.05, r * 0.55, -Math.PI * 0.55, Math.PI * 0.55);
    ctx.stroke();

    ctx.beginPath();                           // тулово
    ctx.ellipse(x, y, r, r * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();                           // крышечка
    ctx.arc(x, y - r * 0.85, r * 0.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = hi;                        // блик на тулове
    ctx.beginPath();
    ctx.ellipse(x + LIGHT_X * r * 0.4, y + LIGHT_Y * r * 0.35, r * 0.34, r * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
}

// Цвет трубы, утонувшей в дымке на ступень fogStep. Готовые строки лежат в
// самой палитре: смешивать и собирать «rgb(…)» на каждый отрезок в каждом
// кадре — это тысяча строк в секунду в мусор.
function fogged(pal, which, fogStep, bg) {
    const cache = which === 'base' ? pal.baseFog : pal.hiFog;
    let css = cache[fogStep];
    if (css) return css;
    const c = which === 'base' ? pal.base : pal.hi;
    const t = fogStep / FOG_STEPS;
    css = `rgb(${Math.round(c.r + (bg.r - c.r) * t)},`
        + `${Math.round(c.g + (bg.g - c.g) * t)},`
        + `${Math.round(c.b + (bg.b - c.b) * t)})`;
    cache[fogStep] = css;
    return css;
}
