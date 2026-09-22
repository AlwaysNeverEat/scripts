// Нарезка знамён факультетов: присланный лист (четыре полосы с рваными
// краями, сверху вниз — Гриффиндор, Когтевран, Пуффендуй, Слизерин) →
// четыре обложки для шапки профиля.
//
// Делает две вещи, и обе — про края:
//
// 1. НАХОДИТ полосы по альфе, а не по жёстким координатам: лист рисованный,
//    полосы стоят неровно, и перерисованный лист не должен требовать правки
//    чисел в скрипте.
// 2. ВЫРЕЗАЕТ из полосы ПОЛНОСТЬЮ НЕПРОЗРАЧНЫЙ прямоугольник. Рваный край —
//    украшение листа, а не обложки: шапка профиля залита картинкой до краёв
//    (background-size: cover, скругление режет сама карточка), и прозрачные
//    зазубрины показывали бы сквозь себя градиент-подложку грязной бахромой.
//
// Уменьшения нет сознательно: высота полосы (~150px) и так меньше, чем нужно
// шапке на retina (96px × 2), картинка тянется вверх — резать разрешение
// значит мылить сильнее.
//
// Чтение, запись и усреднение берём у ресайзера иконок игр
// (design/game-icons/resize.mjs) — второй PNG-кодек в репозитории не нужен.
//
// Запуск: node design/faculty-covers/prepare.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPng, writePng } from '../game-icons/resize.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, '../../frontend/src/assets');

// Порядок полос на листе, сверху вниз.
const ORDER = ['gryffindor', 'ravenclaw', 'hufflepuff', 'slytherin'];

// «Полностью непрозрачный» — с запасом: по самому краю рисунка альфа доходит
// до 255 не везде, и строгое === 255 съедало бы лишние строки.
const OPAQUE = 250;

const sheet = readPng(fs.readFileSync(path.join(HERE, 'source.png')));
const { w, h, px } = sheet;
const alpha = (x, y) => px[(y * w + x) * 4 + 3];

// Полоса — подряд идущие строки, где заполнена хотя бы треть ширины (края
// листа рваные, поэтому порог не «вся строка»).
const bands = [];
let start = -1;
for (let y = 0; y <= h; y++) {
    let filled = 0;
    if (y < h) for (let x = 0; x < w; x++) if (alpha(x, y) > 8) filled++;
    const inBand = y < h && filled > w / 3;
    if (inBand && start < 0) start = y;
    if (!inBand && start >= 0) { bands.push([start, y - 1]); start = -1; }
}
if (bands.length !== ORDER.length) {
    throw new Error(`ожидалось ${ORDER.length} полос, найдено ${bands.length}`);
}

for (let i = 0; i < bands.length; i++) {
    const [y0, y1] = bands[i];

    // Сначала левый и правый край: пересечение непрозрачных диапазонов по
    // строкам, которые заполнены почти целиком (крайние ряды полосы рваные и
    // в счёт не идут — они бы сдвинули края внутрь на всю свою зазубрину).
    let x0 = 0, x1 = w - 1;
    for (let y = y0; y <= y1; y++) {
        let l = 0, r = w - 1;
        while (l < w && alpha(l, y) < OPAQUE) l++;
        while (r > l && alpha(r, y) < OPAQUE) r--;
        if (r - l < w * 0.9) continue;
        if (l > x0) x0 = l;
        if (r < x1) x1 = r;
    }

    // Потом верх и низ: строки, непрозрачные на всей выбранной ширине.
    let t = -1, b = -1;
    for (let y = y0; y <= y1; y++) {
        let ok = true;
        for (let x = x0; x <= x1; x++) if (alpha(x, y) < OPAQUE) { ok = false; break; }
        if (ok && t < 0) t = y;
        if (ok) b = y;
    }
    if (t < 0) throw new Error(`полоса ${ORDER[i]}: не нашлось полностью непрозрачных строк`);

    const cw = x1 - x0 + 1, ch = b - t + 1;
    const out = Buffer.alloc(cw * ch * 4);
    for (let y = 0; y < ch; y++) {
        px.copy(out, y * cw * 4, ((y + t) * w + x0) * 4, ((y + t) * w + x0 + cw) * 4);
    }
    const png = writePng({ w: cw, h: ch, px: out });
    const file = path.join(OUT_DIR, `faculty-cover-${ORDER[i]}.png`);
    fs.writeFileSync(file, png);
    console.log(`${ORDER[i]}: полоса ${y0}–${y1} → ${cw}×${ch}, ${(png.length / 1024).toFixed(0)} КБ`);
}
