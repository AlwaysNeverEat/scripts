// ── Разбор CSS-цвета в числа (для канвасов) ──────────────────────────────────
// Канвасу нужны ЧИСЛА, а oklch мы считать не умеем — но умеет браузер. Красим
// пиксель и читаем, что получилось: заодно даром достаётся приведение в охват
// sRGB (синий и красный на нашей светлоте просто не бывают такими насыщенными,
// и браузер сам убавит насыщенность, сохранив светлоту).
//
// Ни fillStyle, ни getComputedStyle для этого не годятся: оба отдают oklch()
// обратно той же строкой, а не цветом.
//
// Пользуются этим сфера (sphere.js) и трубы (pipes.js) — оба рисуют акцентом и
// цветами темы, которых в канвасе не существует.

const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });

/**
 * @param {string} css — любой цвет, который понимает браузер: oklch, hex, rgba
 * @param {{r:number,g:number,b:number}} fallback — на случай браузера без oklch
 */
export function cssToRgb(css, fallback) {
    try {
        probe.clearRect(0, 0, 1, 1);
        probe.fillStyle = css;
        probe.fillRect(0, 0, 1, 1);
        const d = probe.getImageData(0, 0, 1, 1).data;
        if (!d[3]) return fallback;              // цвет не разобрался — пиксель пуст
        return { r: d[0], g: d[1], b: d[2] };
    } catch { return fallback; }
}

// Значение переменной темы (--search-bg и подобные) числами. Переменные живут
// на <html>, и меняются они целым блоком при смене темы — поэтому читать их
// нужно заново по themechange, а не один раз при загрузке.
export function varToRgb(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v ? cssToRgb(v, fallback) : fallback;
}
