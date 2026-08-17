// Подготовка гербов факультетов: присланный PNG → квадрат 224×224 для сборки.
//
// Делает три вещи, и каждая нужна:
//
// 1. ОБРЕЗАЕТ прозрачные поля. У присланных гербов они разные (у Слизерина по
//    краям несколько пустых пикселей, у остальных ноль), и без обрезки один
//    герб на экране оказался бы заметно мельче соседнего при одинаковой рамке.
// 2. ВПИСЫВАЕТ в квадрат с сохранением пропорций. Гербы разной формы — орёл с
//    расправленными крыльями шире льва, — а растянуть их до одинаковых
//    размеров нельзя: зверь поедет вширь.
// 3. КЛАДЁТ В ОДНУ И ТУ ЖЕ КВАДРАТНУЮ РАМКУ, по центру. Тогда в вёрстке у всех
//    четырёх один и тот же размер картинки, и заголовок карточки не прыгает
//    вбок при смене факультета. Прозрачные поля в PNG почти ничего не весят.
//
// Увеличения тут нет и быть не должно: исходники маленькие (самый большой
// 623×696, самый мелкий 204×240), и растянуть их до 256 — это не детали, а
// мыло. 224 — размер, в который влезает самый мелкий герб без увеличения.
//
// Чтение, запись и усреднение берём у ресайзера иконок игр
// (design/game-icons/resize.mjs) — второй PNG-кодек в репозитории не нужен.
//
// Запуск: node design/faculty-crests/prepare.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPng, writePng, resizeTo } from '../game-icons/resize.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, '../../frontend/src/assets');
const BOX = 224;

// Пиксель считаем непрозрачным с запасом: у краёв герба альфа плавно уходит в
// ноль, и обрезка «строго по alpha > 0» оставляла бы кайму из невидимой пыли.
const ALPHA_FLOOR = 8;

function trim(src) {
    const { w, h, px } = src;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (px[(y * w + x) * 4 + 3] <= ALPHA_FLOOR) continue;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
        }
    }
    if (x1 < 0) throw new Error('картинка пустая');
    const nw = x1 - x0 + 1;
    const nh = y1 - y0 + 1;
    const out = Buffer.alloc(nw * nh * 4);
    for (let y = 0; y < nh; y++) {
        px.copy(out, y * nw * 4, ((y + y0) * w + x0) * 4, ((y + y0) * w + x0 + nw) * 4);
    }
    return { w: nw, h: nh, px: out };
}

// Вписать по длинной стороне и положить по центру квадрата.
function fitIntoSquare(src, box) {
    const scale = Math.min(box / src.w, box / src.h);
    const dw = Math.max(1, Math.round(src.w * scale));
    const dh = Math.max(1, Math.round(src.h * scale));
    const small = resizeTo(src, dw, dh);
    const out = Buffer.alloc(box * box * 4);           // прозрачный фон
    const ox = Math.floor((box - dw) / 2);
    const oy = Math.floor((box - dh) / 2);
    for (let y = 0; y < dh; y++) {
        small.px.copy(out, ((y + oy) * box + ox) * 4, y * dw * 4, (y + 1) * dw * 4);
    }
    return { w: box, h: box, px: out };
}

for (const id of ['gryffindor', 'slytherin', 'ravenclaw', 'hufflepuff']) {
    const src = readPng(fs.readFileSync(path.join(HERE, `${id}.png`)));
    const png = writePng(fitIntoSquare(trim(src), BOX));
    const out = path.join(OUT_DIR, `faculty-${id}.png`);
    fs.writeFileSync(out, png);
    console.log(`${id}: ${src.w}×${src.h} → ${BOX}×${BOX}, ${(png.length / 1024).toFixed(0)} КБ`);
}
