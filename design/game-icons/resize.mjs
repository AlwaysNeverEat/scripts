// Одноразовый ресайзер PNG: 430×430 → 256×256, без внешних зависимостей.
import zlib from 'node:zlib';
import fs from 'node:fs';

function readPng(buf) {
    let i = 8, idat = [], ihdr = null;
    while (i < buf.length) {
        const len = buf.readUInt32BE(i);
        const type = buf.toString('ascii', i + 4, i + 8);
        const data = buf.subarray(i + 8, i + 8 + len);
        if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9] };
        if (type === 'IDAT') idat.push(data);
        i += 12 + len;
    }
    if (ihdr.depth !== 8 || ihdr.color !== 6) throw new Error('нужен 8-bit RGBA');
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const { w, h } = ihdr;
    const px = Buffer.alloc(w * h * 4);
    const bpp = 4, stride = w * bpp;
    for (let y = 0; y < h; y++) {
        const ft = raw[y * (stride + 1)];
        const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
        const cur = px.subarray(y * stride, (y + 1) * stride);
        const prev = y ? px.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
            let v = src[x];
            if (ft === 1) v += a;
            else if (ft === 2) v += b;
            else if (ft === 3) v += (a + b) >> 1;
            else if (ft === 4) {
                const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
            }
            cur[x] = v & 255;
        }
    }
    return { w, h, px };
}

// Усреднение по площади на предумноженной альфе — иначе по краю иконки
// проступает ореол из прозрачных, но цветных пикселей.
function resize(src, size) {
    const { w, h, px } = src;
    const out = Buffer.alloc(size * size * 4);
    const sx = w / size, sy = h / size;
    for (let y = 0; y < size; y++) {
        const y0 = y * sy, y1 = (y + 1) * sy;
        for (let x = 0; x < size; x++) {
            const x0 = x * sx, x1 = (x + 1) * sx;
            let r = 0, g = 0, b = 0, a = 0, wsum = 0;
            for (let j = Math.floor(y0); j < Math.ceil(y1); j++) {
                const wy = Math.min(j + 1, y1) - Math.max(j, y0);
                for (let i = Math.floor(x0); i < Math.ceil(x1); i++) {
                    const wx = Math.min(i + 1, x1) - Math.max(i, x0);
                    const k = (j * w + i) * 4, wt = wx * wy, al = px[k + 3] / 255;
                    r += px[k] * al * wt; g += px[k + 1] * al * wt; b += px[k + 2] * al * wt;
                    a += px[k + 3] * wt; wsum += wt;
                }
            }
            const o = (y * size + x) * 4;
            const alpha = a / wsum;
            const un = alpha > 0 ? wsum / (a / 255) : 0;
            out[o] = Math.round(Math.min(255, r * un / wsum * 1));
            out[o + 1] = Math.round(Math.min(255, g * un / wsum * 1));
            out[o + 2] = Math.round(Math.min(255, b * un / wsum * 1));
            out[o + 3] = Math.round(alpha);
        }
    }
    return { w: size, h: size, px: out };
}

function writePng({ w, h, px }) {
    const bpp = 4, stride = w * bpp;
    const raw = Buffer.alloc(h * (stride + 1));
    const cand = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];
    for (let y = 0; y < h; y++) {
        const cur = px.subarray(y * stride, (y + 1) * stride);
        const prev = y ? px.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
            cand[0][x] = cur[x];
            cand[1][x] = (cur[x] - a) & 255;
            cand[2][x] = (cur[x] - b) & 255;
            cand[3][x] = (cur[x] - ((a + b) >> 1)) & 255;
            const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
            cand[4][x] = (cur[x] - ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c))) & 255;
        }
        // Выбор фильтра по сумме модулей — стандартная эвристика из спецификации.
        let best = 0, bestSum = Infinity;
        for (let f = 0; f < 5; f++) {
            let s = 0;
            for (let x = 0; x < stride; x++) s += cand[f][x] < 128 ? cand[f][x] : 256 - cand[f][x];
            if (s < bestSum) { bestSum = s; best = f; }
        }
        raw[y * (stride + 1)] = best;
        cand[best].copy(raw, y * (stride + 1) + 1);
    }
    const chunk = (type, data) => {
        const b = Buffer.alloc(8 + data.length + 4);
        b.writeUInt32BE(data.length, 0);
        b.write(type, 4, 'ascii');
        data.copy(b, 8);
        b.writeInt32BE(zlib.crc32(b.subarray(4, 8 + data.length)) | 0, 8 + data.length);
        return b;
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

const [, , inPath, outPath, sizeArg] = process.argv;
const png = writePng(resize(readPng(fs.readFileSync(inPath)), Number(sizeArg)));
fs.writeFileSync(outPath, png);
console.log(outPath, png.length);
