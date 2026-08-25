// Сборка спрайта фишек маджонга из присланного листа.
//
// Присланный лист (`tiles-sheet.png`) — это ПОКАЗ, а не спрайт: фишки на нём
// разложены по смыслу (масти рядами, ветры и драконы отдельной строкой),
// подписаны, обведены рамкой и лежат на тёмно-зелёном фоне. Резать его руками
// на 42 файла нельзя — это 42 запроса при открытии окна и 42 повода промахнуться
// на пиксель, — поэтому фишки вырезаются отсюда автоматически и собираются в
// ОДИН спрайт `frontend/src/assets/mahjong-tiles.png` (сетка 7×6).
//
// Клетки НЕ ищутся по заранее записанным координатам: скрипт находит фишки как
// связные пятна «не фон» и проверяет, что их ровно 43 и что они складываются в
// строки 9-9-9-8-8. Если лист однажды перерисуют, скрипт либо соберёт спрайт
// заново сам, либо честно скажет, что раскладка изменилась, — вместо того чтобы
// молча нарезать пустоту.
//
// Сорок третья фишка — ПУСТАЯ (в строке драконов их четыре: красный, зелёный,
// белый в рамке и просто чистая). В игре она не нужна: рубашки в пасьянсе-
// маджонге нет, все фишки лежат лицом вверх. Её и пропускаем.
//
// Фон снимается не «в лоб»: край фишки на листе сглажен по тёмно-зелёному, и
// простое «непохожее на фон — оставить» дало бы по контуру тёмную кайму, которая
// на светлой теме сайта заметна сразу. Поэтому маска СЖИМАЕТСЯ на пиксель, а
// снятое кольцо дорисовывается цветом соседа изнутри с половинной прозрачностью:
// край получается мягким и своего цвета.
//
// Порядок фишек в спрайте задаёт KINDS из shared/mahjong.js, а строку и столбец
// считают spriteRow/spriteCol оттуда же — таблицы соответствия «фишка →
// картинка» нет нигде, и лист обязан идти в том же порядке, что и KINDS.
//
// Запуск: node design/mahjong-tiles/prepare.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPng, writePng } from '../game-icons/resize.mjs';
import { KINDS, SPRITE, SPRITE_COLS, spriteCol, spriteRow } from '../../shared/mahjong.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'tiles-sheet.png');
const OUT = path.resolve(HERE, '../../frontend/src/assets/mahjong-tiles.png');

// Фон листа — тёмно-зелёный. Порог по сумме модулей: точное совпадение ловило бы
// только середину фона, а не его сглаженные края у рамки.
const BG = [26, 42, 30];
const BG_TOLERANCE = 40;
// Лицо фишки — светлый кремовый прямоугольник. По нему выравниваются все 42
// картинки: если ровнять по внешнему контуру, фишки разъедутся на пиксель-
// другой, и на столе это видно как дрожь рисунка.
const FACE_MIN = 190;
const FACE_SPREAD = 40;
// Что считать фишкой: пятно меньше — это буква подписи, больше — рамка листа.
const MIN_AREA = 3000, MAX_W = 130, MAX_H = 150;
const ROWS = [9, 9, 9, 8, 8];
// Прозрачность дорисованного кольца по краю (см. шапку).
const EDGE_ALPHA = 150;

const sheet = readPng(fs.readFileSync(SRC));

const at = (x, y) => (y * sheet.w + x) * 4;
const isInk = (x, y) => {
    const i = at(x, y);
    if (sheet.px[i + 3] < 200) return false;
    return Math.abs(sheet.px[i] - BG[0]) + Math.abs(sheet.px[i + 1] - BG[1])
         + Math.abs(sheet.px[i + 2] - BG[2]) > BG_TOLERANCE;
};
const isFace = (x, y) => {
    const i = at(x, y);
    const mx = Math.max(sheet.px[i], sheet.px[i + 1], sheet.px[i + 2]);
    const mn = Math.min(sheet.px[i], sheet.px[i + 1], sheet.px[i + 2]);
    return sheet.px[i + 3] >= 200 && mn > FACE_MIN && mx - mn < FACE_SPREAD;
};

/** Связные пятна по заданному признаку: [{x0,y0,x1,y1,area}]. */
function blobs(hit) {
    const seen = new Uint8Array(sheet.w * sheet.h);
    const found = [];
    const stack = [];
    for (let y = 0; y < sheet.h; y++) for (let x = 0; x < sheet.w; x++) {
        const start = y * sheet.w + x;
        if (seen[start] || !hit(x, y)) continue;
        let x0 = x, x1 = x, y0 = y, y1 = y, area = 0;
        seen[start] = 1;
        stack.push(start);
        while (stack.length) {
            const p = stack.pop();
            const px = p % sheet.w, py = (p / sheet.w) | 0;
            area++;
            if (px < x0) x0 = px; if (px > x1) x1 = px;
            if (py < y0) y0 = py; if (py > y1) y1 = py;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = px + dx, ny = py + dy;
                if (nx < 0 || ny < 0 || nx >= sheet.w || ny >= sheet.h) continue;
                const ni = ny * sheet.w + nx;
                if (!seen[ni] && hit(nx, ny)) { seen[ni] = 1; stack.push(ni); }
            }
        }
        found.push({ x0, y0, x1, y1, area });
    }
    return found;
}

// ── Где на листе лежат фишки ─────────────────────────────────────────────────

const tiles = blobs(isInk).filter(b =>
    b.area >= MIN_AREA && b.x1 - b.x0 + 1 <= MAX_W && b.y1 - b.y0 + 1 <= MAX_H);

// Раскладываем по строкам: внутри строки фишки стоят на одной высоте, а между
// строками расстояние в полтора роста фишки, так что «строка кончилась» видно
// по разрыву, а не по заранее записанной координате.
tiles.sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0));
const rows = [];
for (const t of tiles) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y0 - t.y0) < 40) row.push(t);
    else rows.push([t]);
}
for (const row of rows) row.sort((a, b) => a.x0 - b.x0);

const shape = rows.map(r => r.length);
if (shape.join() !== ROWS.join()) {
    throw new Error(`лист изменился: строки ${shape.join('-')}, ждали ${ROWS.join('-')}`);
}

// Строка драконов: красный, зелёный, белый — и пустая фишка, которой в игре нет.
const order = [...rows[0], ...rows[1], ...rows[2], ...rows[3].slice(0, 7), ...rows[4]];
if (order.length !== KINDS.length) {
    throw new Error(`фишек ${order.length}, а видов ${KINDS.length}`);
}

// ── Спрайт ───────────────────────────────────────────────────────────────────

const SW = SPRITE_COLS * SPRITE.cellW;
const SH = Math.ceil(KINDS.length / SPRITE_COLS) * SPRITE.cellH;
const out = Buffer.alloc(SW * SH * 4);

order.forEach((tile, kind) => {
    // Лицо внутри пятна: по нему фишка и встаёт в клетку.
    let fx0 = tile.x1, fy0 = tile.y1;
    for (let y = tile.y0; y <= tile.y1; y++) for (let x = tile.x0; x <= tile.x1; x++) {
        if (!isFace(x, y)) continue;
        if (x < fx0) fx0 = x;
        if (y < fy0) fy0 = y;
    }

    const cx = spriteCol(kind) * SPRITE.cellW + SPRITE.pad;
    const cy = spriteRow(kind) * SPRITE.cellH + SPRITE.pad;

    for (let y = tile.y0; y <= tile.y1; y++) for (let x = tile.x0; x <= tile.x1; x++) {
        if (!isInk(x, y)) continue;
        // Клетка считается от ЛИЦА, а не от контура: контур снизу справа шире на
        // бортик, и от него фишки в спрайте разъехались бы по вертикали.
        const dx = cx + (x - fx0), dy = cy + (y - fy0);
        if (dx < 0 || dy < 0 || dx >= SW || dy >= SH) continue;

        const inner = isInk(x - 1, y) && isInk(x + 1, y) && isInk(x, y - 1) && isInk(x, y + 1);
        let sx = x, sy = y, alpha = 255;
        if (!inner) {
            // Край: берём цвет ближайшего соседа изнутри — иначе в спрайт уехал
            // бы пиксель, наполовину состоящий из тёмно-зелёного фона листа.
            alpha = EDGE_ALPHA;
            for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
                if (!isInk(x + ox, y + oy)) continue;
                if (!isInk(x + ox - 1, y + oy) || !isInk(x + ox + 1, y + oy)) continue;
                if (!isInk(x + ox, y + oy - 1) || !isInk(x + ox, y + oy + 1)) continue;
                sx = x + ox; sy = y + oy;
                break;
            }
        }
        const s = at(sx, sy), d = (dy * SW + dx) * 4;
        out[d] = sheet.px[s];
        out[d + 1] = sheet.px[s + 1];
        out[d + 2] = sheet.px[s + 2];
        out[d + 3] = alpha;
    }
});

const png = writePng({ w: SW, h: SH, px: out });
fs.writeFileSync(OUT, png);
console.log(`${OUT} ${SW}×${SH}, ${(png.length / 1024).toFixed(0)} КБ, фишек ${KINDS.length}`);
