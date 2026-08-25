// Нарезка присланного листа шашек на картинки для игры.
//
// Присланный лист (`pieces-sheet.png`) — это ПОКАЗ, а не спрайт: шесть предметов
// разложены на прозрачном фоне по смыслу (сверху клетки и белая простая, снизу
// чёрная простая и обе дамки), с обрезками подписей по краям. Резать его руками
// нельзя — это шесть поводов промахнуться на пиксель, — поэтому предметы
// вырезаются отсюда автоматически.
//
// СПРАЙТА ЗДЕСЬ НЕТ, в отличие от фишек тройки и маджонга, и это не забывчивость:
// там картинок 36 и 42, и одним листом они экономят десятки запросов. Здесь их
// ШЕСТЬ, они разного назначения (две — фон клетки через CSS, четыре — шашки), и
// общий спрайт заставил бы считать координаты ради экономии четырёх запросов,
// которые браузер и так сделает один раз за партию.
//
// Клетки НЕ ищутся по заранее записанным координатам: скрипт находит предметы как
// связные пятна «не прозрачно» и проверяет, что их ровно шесть, что они
// складываются в две строки по три и что на местах клеток лежат ПРЯМОУГОЛЬНИКИ, а
// на местах шашек — нет. Если лист однажды перерисуют, скрипт либо нарежет его
// заново сам, либо честно скажет, что раскладка изменилась, — вместо того чтобы
// молча положить в игру пустоту.
//
// Запуск: node design/checkers-board/prepare.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPng, resizeTo, writePng } from '../game-icons/resize.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'pieces-sheet.png');
const OUT = path.resolve(HERE, '../../frontend/src/assets/checkers');

// Что где лежит на листе. Имена файлов те же, что ищет окно игры
// (frontend/src/checkers.js) — таблицы соответствия «файл → картинка» нет нигде.
const LAYOUT = [
    ['light', 'dark', 'man-light'],
    ['man-dark', 'king-light', 'king-dark'],
];
// Клетки — сплошные прямоугольники, шашки — круги: заливка их bbox отличается
// вдвое, и по ней же проверяется, что лист не перерисовали.
const TILE = new Set(['light', 'dark']);
const TILE_FILL = 0.95;
const PIECE_FILL = 0.9;

// Сторона готовой картинки. Клетка на экране не больше 58px, то есть 256
// покрывает даже трёхкратную плотность пикселей с запасом — тот же довод, что у
// иконок меню.
const SIZE = 256;
// На сколько ужать вырезанную клетку с каждой стороны. Край пятна сглажен по
// прозрачности, и без этого по краю клетки остаётся полупрозрачная кайма — а
// клетки лежат вплотную, и кайма превращает доску в сетку из 64 плиток.
const TILE_INSET = 4;
// Прозрачно ли здесь. Порог, а не ноль: край нарисован со сглаживанием.
const SOLID = 40;

const sheet = readPng(fs.readFileSync(SRC));

/** Связные пятна «не прозрачно». Мелочь (обрезки подписей) отсеиваем по площади. */
function blobs(img, minArea = 2000) {
    const { w, h, px } = img;
    const seen = new Uint8Array(w * h);
    const out = [];
    const solid = i => px[i * 4 + 3] > SOLID;
    for (let start = 0; start < w * h; start++) {
        if (seen[start] || !solid(start)) continue;
        const stack = [start];
        seen[start] = 1;
        let head = 0, area = 0, minx = w, maxx = 0, miny = h, maxy = 0;
        while (head < stack.length) {
            const p = stack[head++];
            const x = p % w, y = (p / w) | 0;
            area++;
            if (x < minx) minx = x;
            if (x > maxx) maxx = x;
            if (y < miny) miny = y;
            if (y > maxy) maxy = y;
            if (x + 1 < w) push(p + 1);
            if (x > 0) push(p - 1);
            if (y + 1 < h) push(p + w);
            if (y > 0) push(p - w);
        }
        if (area >= minArea) {
            const bw = maxx - minx + 1, bh = maxy - miny + 1;
            out.push({ x: minx, y: miny, w: bw, h: bh, fill: area / (bw * bh) });
        }
        function push(q) { if (!seen[q] && solid(q)) { seen[q] = 1; stack.push(q); } }
    }
    return out;
}

/** Кусок листа как отдельная картинка. */
function crop(img, x, y, w, h) {
    const px = Buffer.alloc(w * h * 4);
    for (let row = 0; row < h; row++) {
        img.px.copy(px, row * w * 4, ((y + row) * img.w + x) * 4, ((y + row) * img.w + x + w) * 4);
    }
    return { w, h, px };
}

/** Положить картинку в центр прозрачного квадрата — чтобы не растянуть круглую шашку. */
function pad(img) {
    const side = Math.max(img.w, img.h);
    const px = Buffer.alloc(side * side * 4);
    const dx = (side - img.w) >> 1, dy = (side - img.h) >> 1;
    for (let row = 0; row < img.h; row++) {
        img.px.copy(px, ((dy + row) * side + dx) * 4, row * img.w * 4, (row + 1) * img.w * 4);
    }
    return { w: side, h: side, px };
}

const found = blobs(sheet);
if (found.length !== LAYOUT.length * LAYOUT[0].length) {
    throw new Error(`на листе ${found.length} предметов вместо шести — раскладка изменилась`);
}

// Две строки по три: делим по середине листа, внутри строки — слева направо.
const rows = [[], []];
for (const b of found) rows[b.y + b.h / 2 < sheet.h / 2 ? 0 : 1].push(b);
rows.forEach(row => row.sort((a, b) => a.x - b.x));
if (rows.some(row => row.length !== 3)) {
    throw new Error('предметы не складываются в две строки по три — раскладка изменилась');
}

fs.mkdirSync(OUT, { recursive: true });
rows.forEach((row, ry) => row.forEach((blob, rx) => {
    const name = LAYOUT[ry][rx];
    const tile = TILE.has(name);
    if (tile && blob.fill < TILE_FILL) throw new Error(`${name}: на месте клетки лежит не прямоугольник`);
    if (!tile && blob.fill > PIECE_FILL) throw new Error(`${name}: на месте шашки лежит прямоугольник`);

    let piece;
    if (tile) {
        // Клетку режем КВАДРАТОМ по центру, а не растягиваем присланный
        // прямоугольник: доска из восьми квадратов, и растянутая клетка сделала
        // бы волокна дерева овальными (см. README рядом).
        const side = Math.min(blob.w, blob.h) - TILE_INSET * 2;
        piece = crop(sheet,
            blob.x + ((blob.w - side) >> 1), blob.y + ((blob.h - side) >> 1), side, side);
    } else {
        piece = pad(crop(sheet, blob.x, blob.y, blob.w, blob.h));
    }
    const file = path.join(OUT, `${name}.png`);
    fs.writeFileSync(file, writePng(resizeTo(piece, SIZE, SIZE)));
    console.log(`${name}.png — из ${blob.w}×${blob.h} (${(fs.statSync(file).size / 1024).toFixed(0)} КБ)`);
}));
