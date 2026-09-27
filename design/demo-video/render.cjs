// Рендер ролика: композитор index.html кадр за кадром → ffmpeg → mp4 с музыкой.
//   node render.cjs --clips <папка клипов> --audio <трек.mp3> --out <ролик.mp4> [--fps 30]
//   node render.cjs --clips … --stills 3.6,12.2,23.0 --out <папка>   — отдельные кадры для проверки
// ffmpeg берётся из $FFMPEG, иначе из PATH.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const CLIPS = path.resolve(arg('clips'));
const AUDIO = arg('audio') && path.resolve(arg('audio'));
const OUT = path.resolve(arg('out'));
const FPS = Number(arg('fps', 30));
const STILLS = arg('stills');
const FROM = Number(arg('from', 0));
const TO = arg('to') ? Number(arg('to')) : null;
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.js': 'text/javascript', '.mp3': 'audio/mpeg', '.css': 'text/css', '.woff2': 'font/woff2' };
function serve() {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = u.startsWith('/clips/') ? path.join(CLIPS, u.slice(7)) : path.join(__dirname, u === '/' ? 'index.html' : u);
    if (u === '/track.mp3' && AUDIO) file = AUDIO;
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.log('pageerror:', e.message));
  await page.goto(`http://127.0.0.1:${port}/?clips=/clips/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.ready);
  const dur = await page.evaluate(() => window.DURATION);
  const stage = page.locator('#stage');

  if (STILLS) {
    fs.mkdirSync(OUT, { recursive: true });
    for (const s of STILLS.split(',').map(Number)) {
      await page.evaluate(t => window.renderAt(t), s);
      await stage.screenshot({ path: path.join(OUT, `still-${s.toFixed(2)}.jpg`), type: 'jpeg', quality: 88 });
    }
    console.log('кадры:', OUT);
  } else {
    const end = TO ?? dur;
    const n = Math.round((end - FROM) * FPS);
    const af = AUDIO ? ['-ss', String(FROM), '-t', String(end - FROM), '-i', AUDIO] : [];
    const fadeAt = Math.max(0, end - FROM - 2.0);
    const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', ...af,
      ...(AUDIO ? ['-filter_complex', `[1:a]afade=t=in:st=0:d=0.05,afade=t=out:st=${fadeAt}:d=2.0[a]`, '-map', '0:v', '-map', '[a]', '-c:a', 'aac', '-b:a', '192k'] : []),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
    const t0 = Date.now();
    for (let i = 0; i < n; i++) {
      const t = FROM + i / FPS;
      await page.evaluate(x => window.renderAt(x), t);
      const buf = await stage.screenshot({ type: 'jpeg', quality: 95 });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (i % 150 === 0) console.log(`  кадр ${i}/${n} (${((Date.now() - t0) / 1000).toFixed(0)} с)`);
    }
    ff.stdin.end();
    await new Promise(r => ff.on('close', r));
    console.log('готово:', OUT);
  }
  await browser.close();
  srv.close();
})();
