// ─────────────────────────────────────────────────────────────────────────────
// Пересборка вендоренного DOOM: из сборки webDOOM берём только то, что нужно
// пасхалке, и выкидываем музыку.
//
// Зачем вообще: у webDOOM в `public/` лежит doom1.data на 96 МБ, и 91 из них —
// mp3 с музыкой к каждому уровню. Класть их в репозиторий ради пасхалки нельзя,
// а качать при открытии окна — тем более. Остаётся 5.7 МБ: движок (prboom.wad),
// сам DOOM (doom1.wad, ШАРЕВАРНЫЙ — тот, что id Software разрешила
// распространять) и звуки (sfx/*.wav). Музыку игре запрещает искать флаг
// `-nomusic` в doom.js окна — иначе она полезла бы за отсутствующими файлами.
//
// Формат .data у emscripten простой: файлы лежат в нём подряд, а где какой —
// написано в JSON внутри загрузчика (`loadPackage({...})` в начале doom1.js).
// Поэтому пересборка — это выкинуть куски из одного файла и пересчитать
// смещения в другом; сам emscripten для этого не нужен (его тут и нет).
//
// Как запускать:
//
//   git clone --depth 1 https://github.com/UstymUkhman/webDOOM.git
//   node design/doom/repack.mjs webDOOM/public frontend/src/assets/doom
//
// Что получается: doom.js (загрузчик с пересчитанным JSON), doom.wasm (копия,
// байт в байт) и doom.data (тримленный). Их и импортирует frontend/src/doom.js.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [srcDir, outDir] = process.argv.slice(2);
if (!srcDir || !outDir) {
    console.error('использование: node repack.mjs <webDOOM/public> <frontend/src/assets/doom>');
    process.exit(1);
}

// Что оставляем: движок, вад и звуки. Всё остальное (музыка, .gitkeep) — мимо.
const KEEP = name => name === '/prboom.wad' || name === '/doom1.wad' || /^\/sfx\/.+\.wav$/.test(name);

const glue = readFileSync(join(srcDir, 'doom1.js'), 'utf8');
const data = readFileSync(join(srcDir, 'doom1.data'));

// ── JSON пакета: находим по скобочному балансу, а не регуляркой ──────────────
// Файл минифицирован в одну строку, и внутри JSON есть свои скобки.
const call = 'loadPackage(';
const at = glue.indexOf(call + '{');
if (at < 0) throw new Error('не нашёл loadPackage({...}) в doom1.js');
const from = at + call.length;
let depth = 0, to = from, inStr = false, esc = false;
for (; to < glue.length; to++) {
    const c = glue[to];
    if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { to++; break; }
}
const meta = JSON.parse(glue.slice(from, to));

// ── Новый .data: те же куски, но подряд и без дырок ──────────────────────────
const chunks = [];
const files = [];
let offset = 0;
for (const f of meta.files) {
    if (!KEEP(f.filename)) continue;
    const bytes = data.subarray(f.start, f.end);
    chunks.push(bytes);
    // audio оставляем как было: по этому флагу загрузчик отдаёт wav-ы
    // декодировщику браузера, откуда их и берёт Mix_LoadWAV.
    files.push({ start: offset, audio: f.audio, end: offset + bytes.length, filename: f.filename });
    offset += bytes.length;
}
if (files.length < 2) throw new Error('в пакете не нашлось ни вада, ни движка — не тот каталог?');

const out = Buffer.concat(chunks);
const nextMeta = { files, remote_package_size: out.length, package_uuid: meta.package_uuid };

let nextGlue = glue.slice(0, from) + JSON.stringify(nextMeta) + glue.slice(to);
// Имена, по которым загрузчик просит соседние файлы. Реальные адреса ему всё
// равно подставляет locateFile из окна игры (сборщик их хэширует), но пусть в
// коде стоит то, что лежит рядом, а не имя из чужого репозитория.
for (const [was, now] of [['doom1.data', 'doom.data'], ['doom1.wasm', 'doom.wasm']]) {
    const n = nextGlue.split(was).length - 1;
    if (!n) throw new Error(`не нашёл ${was} в doom1.js`);
    nextGlue = nextGlue.split(was).join(now);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'doom.js'), nextGlue);
writeFileSync(join(outDir, 'doom.data'), out);
writeFileSync(join(outDir, 'doom.wasm'), readFileSync(join(srcDir, 'doom1.wasm')));

const mb = n => (n / 1024 / 1024).toFixed(2) + ' МБ';
console.log(`файлов в пакете: ${meta.files.length} → ${files.length}`);
console.log(`doom.data: ${mb(data.length)} → ${mb(out.length)}`);
for (const f of files.slice(0, 2)) console.log(`  ${f.filename}: ${mb(f.end - f.start)}`);
console.log(`  sfx/*.wav: ${files.length - 2} шт.`);
