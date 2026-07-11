// ─────────────────────────────────────────────────────────────────────────────
// Партиклы медалей (порт из фигмовского экспорта на framer-motion → ванильный
// JS + Web Animations API, чтобы не тащить реакт ради трёх эффектов):
//   cars_added_100  — фиолетовые искры, летящие снизу вверх («ветер»);
//   cars_added_500  — огненные искры от основания монеты, виляющие вверх;
//   cars_added_1000 — кристальные блики-звёздочки по всей медали + свечение.
//
// Оригинал рисовался под медаль 240×240 — все координаты из макета умножаются
// на k = size/240, поэтому эффект одинаково выглядит и на карточке в профиле
// (64px), и на тосте (48px).
//
// repeatDelay из motion эмулируется растяжением таймлайна: активная часть
// занимает dur/(dur+repeatDelay) длительности, дальше кадр «невидим» до конца
// итерации (WAAPI умеет iterations:Infinity, но не паузу между повторами).
// ─────────────────────────────────────────────────────────────────────────────

const rng = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[Math.floor(rng(0, arr.length))];

const REDUCED_MOTION = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Растянуть keyframes на таймлайн с «паузой»: offsets ужимаются в [0, p],
// затем держим последний (невидимый) кадр до конца итерации.
function loopWithPause(el, frames, { dur, delay, repeatDelay, easing }) {
    const total = dur + repeatDelay;
    const p = dur / total;
    const n = frames.length - 1;
    const scaled = frames.map((f, i) => ({ ...f, offset: (i / n) * p, easing }));
    scaled.push({ ...frames[n], offset: 1 });
    el.animate(scaled, {
        duration: total * 1000,
        delay: delay * 1000,
        iterations: Infinity,
        fill: 'backwards',
    });
}

// ── 100 · фиолетовые искры снизу вверх ────────────────────────────────────────

const PURPLE = [
    '#E879F9', '#F0ABFC', '#C084FC', '#DDD6FE',
    '#F5D0FE', '#A855F7', '#FFFFFF',
];

function purpleSparks(layer, k) {
    for (let i = 0; i < 11; i++) {
        const bx = rng(-88, 88) * k;
        const by = rng(85, 130) * k;
        const w = Math.max(1, rng(1.2, 2.6) * k);
        const h = rng(8, 22) * k;
        const rot = rng(-12, 12);
        const color = pick(PURPLE);
        const dx = rng(-16, 16) * k;
        const dy = rng(-220, -170) * k;

        const s = document.createElement('div');
        s.style.cssText = `
            position:absolute; left:calc(50% + ${bx}px); top:calc(50% + ${by}px);
            width:${w}px; height:${h}px; margin-left:${-w / 2}px; margin-top:${-h / 2}px;
            border-radius:999px; opacity:0;
            background:linear-gradient(to bottom, transparent, ${color} 35%, ${color} 65%, transparent);
            box-shadow:0 0 ${w * 4}px ${color}, 0 0 ${w * 10}px ${color}BB;
        `;
        layer.appendChild(s);

        const tf = (t) => `translate(${dx * t}px, ${dy * t}px) rotate(${rot}deg)`;
        loopWithPause(s, [
            { opacity: 0, transform: tf(0) },
            { opacity: 1, transform: tf(1 / 3) },
            { opacity: 0.8, transform: tf(2 / 3) },
            { opacity: 0, transform: tf(1) },
        ], { dur: rng(1.2, 2.4), delay: rng(0, 4), repeatDelay: rng(2, 4), easing: 'ease-out' });
    }
}

// ── 500 · огненные искры, виляющие вверх от основания ─────────────────────────

const FIRE_COLORS = [
    '#FF4500', '#FF5A00', '#FF6A00', '#FF8C00',
    '#FFB300', '#FFCA28', '#FF3D00', '#FF7518',
];

function fireSparks(layer, k) {
    for (let i = 0; i < 12; i++) {
        const bx = rng(-75, 75) * k;
        const by = rng(108, 125) * k; // от самого основания монеты
        const totalY = rng(-200, -160) * k;
        const w = Math.max(0.8, rng(0.7, 1.4) * k);
        const h = rng(7, 14) * k;
        const color = pick(FIRE_COLORS);

        // виляющая траектория из макета: 5 точек, поворот по направлению движения
        const wx = [0, rng(-22, 22) * k, rng(-22, 22) * k, rng(-16, 16) * k, rng(-10, 10) * k];
        const wy = [0, totalY * 0.25, totalY * 0.5, totalY * 0.75, totalY];
        const rot = wx.map((_, idx) => {
            if (idx === 0) return 0;
            const dx = wx[idx] - wx[idx - 1];
            const dy = wy[idx] - wy[idx - 1];
            return Math.atan2(dx, -dy) * (180 / Math.PI) * 0.6;
        });
        const opacity = [0, 1, 0.85, 0.6, 0];

        const s = document.createElement('div');
        s.style.cssText = `
            position:absolute; left:calc(50% + ${bx}px); top:calc(50% + ${by}px);
            width:${w}px; height:${h}px; margin-left:${-w / 2}px; margin-top:${-h / 2}px;
            border-radius:999px; opacity:0;
            background:linear-gradient(to top, ${color} 0%, ${color} 55%, transparent 100%);
            box-shadow:0 0 ${w * 3}px ${color}, 0 0 ${w * 7}px ${color}99;
        `;
        layer.appendChild(s);

        loopWithPause(s, wx.map((_, idx) => ({
            opacity: opacity[idx],
            transform: `translate(${wx[idx]}px, ${wy[idx]}px) rotate(${rot[idx]}deg)`,
        })), { dur: rng(0.7, 1.3), delay: rng(0, 4), repeatDelay: rng(2.5, 5), easing: 'ease-out' });
    }
}

// ── 1000 · кристальные блики-звёздочки ────────────────────────────────────────

const CRYSTAL_COLORS = [
    '#FFFFFF', '#FFFFFF', '#E0F2FE', '#BAE6FD',
    '#7DD3FC', '#F0F9FF', '#FFFFFF',
];

// Звёздочка-блик «+»: вертикальный и горизонтальный лучи + яркое ядро.
function glintStar(size, color) {
    const arm = size * 0.18;
    const star = document.createElement('div');
    star.style.cssText = `width:${size}px; height:${size}px; position:relative;`;
    star.innerHTML = `
        <div style="position:absolute; left:50%; top:0; width:${arm}px; height:${size}px;
             margin-left:${-arm / 2}px; border-radius:999px;
             background:linear-gradient(to bottom, transparent 0%, ${color} 35%, ${color} 65%, transparent 100%);"></div>
        <div style="position:absolute; top:50%; left:0; width:${size}px; height:${arm}px;
             margin-top:${-arm / 2}px; border-radius:999px;
             background:linear-gradient(to right, transparent 0%, ${color} 35%, ${color} 65%, transparent 100%);"></div>
        <div style="position:absolute; left:50%; top:50%; width:${arm * 2.2}px; height:${arm * 2.2}px;
             margin-left:${-arm * 1.1}px; margin-top:${-arm * 1.1}px; border-radius:50%; background:white;
             box-shadow:0 0 ${arm * 2}px white, 0 0 ${size * 0.6}px ${color}CC;"></div>
    `;
    return star;
}

function crystalSparkles(layer, k) {
    for (let i = 0; i < 15; i++) {
        const angle = (i / 15) * Math.PI * 2 + rng(0, 0.6);
        const r = rng(12, 100) * k;
        const bx = Math.cos(angle) * r;
        const by = Math.sin(angle) * r;
        const size = rng(10, 30) * k;
        const rot0 = rng(0, 45); // «+» против «×»

        const wrap = document.createElement('div');
        wrap.style.cssText = `
            position:absolute; left:calc(50% + ${bx}px); top:calc(50% + ${by}px);
            margin-left:${-size / 2}px; margin-top:${-size / 2}px; opacity:0; z-index:2;
        `;
        wrap.appendChild(glintStar(size, pick(CRYSTAL_COLORS)));
        layer.appendChild(wrap);

        const tf = (s) => `rotate(${rot0}deg) scale(${s})`;
        loopWithPause(wrap, [
            { opacity: 0, transform: tf(0) },
            { opacity: 1, transform: tf(1) },
            { opacity: 1, transform: tf(0.85) },
            { opacity: 0, transform: tf(0) },
        ], {
            dur: rng(0.7, 1.8), delay: rng(0, 7), repeatDelay: rng(2.5, 7),
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        });
    }
}

const PARTICLE_EFFECTS = {
    cars_added_100: purpleSparks,
    cars_added_500: fireSparks,
    cars_added_1000: crystalSparkles,
    // Линейка «Редактор машин» — та же цветовая схема (фиолет/огонь/кристалл),
    // те же эффекты.
    cars_edited_100: purpleSparks,
    cars_edited_500: fireSparks,
    cars_edited_1000: crystalSparkles,
};

// Кристальные медали дополнительно подсвечиваются голубым свечением.
const CRYSTAL_GLOW = new Set(['cars_added_1000', 'cars_edited_1000']);

// Навесить партиклы на контейнер с медалью. size — размер медали в px
// (масштаб макета 240). У медалей без эффекта тихо ничего не делает.
export function attachAchievementParticles(host, achievementId, size) {
    const effect = PARTICLE_EFFECTS[achievementId];
    if (!effect || REDUCED_MOTION || !host) return;

    host.classList.add('ach-particles-host');
    if (CRYSTAL_GLOW.has(achievementId)) host.classList.add('ach-glow-crystal');

    const layer = document.createElement('div');
    layer.className = 'ach-particles-layer';
    host.appendChild(layer);
    effect(layer, size / 240);
}
