// Общая часть съёмки: живой Chromium, CDP-скринкаст с таймкодами, свой курсор.
// Курсор рисуем в самой странице: headless его не показывает, а в ролике без
// курсора непонятно, кто нажал и куда.
const fs = require('fs');
const path = require('path');

const VW = 1600, VH = 900, DSF = 1.5;

const CURSOR = `
(() => {
  const mk = () => {
    if (document.getElementById('__cur')) return;
    const st = document.createElement('style');
    st.textContent = \`
      #__cur { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none;
               width: 26px; height: 26px; transform: translate(-100px,-100px); will-change: transform;
               filter: drop-shadow(0 2px 4px rgba(0,0,0,.55)); }
      #__cur svg { width: 26px; height: 26px; display: block; }
      .__rip { position: fixed; z-index: 2147483646; pointer-events: none; width: 44px; height: 44px;
               margin: -22px 0 0 -22px; border-radius: 50%; border: 3px solid rgba(255,200,40,.95);
               animation: __rip .45s ease-out forwards; }
      @keyframes __rip { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.5); opacity: 0 } }
      ::-webkit-scrollbar { display: none }
      html { scrollbar-width: none }
    \`;
    document.head.appendChild(st);
    const c = document.createElement('div');
    c.id = '__cur';
    c.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 2 L4 20 L9 15.5 L12.5 22.5 L15.3 21.2 L11.9 14.3 L18.5 14.3 Z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    document.addEventListener('mousemove', e => { c.style.transform = 'translate(' + (e.clientX - 3) + 'px,' + (e.clientY - 2) + 'px)'; }, true);
    document.addEventListener('mousedown', e => {
      const r = document.createElement('div'); r.className = '__rip';
      r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      document.body.appendChild(r); setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.body) mk(); else document.addEventListener('DOMContentLoaded', mk);
})();`;

async function newPage(browser, extraCss = '') {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DSF, colorScheme: 'dark', locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:5173' });
  await ctx.addInitScript(CURSOR);
  if (extraCss) await ctx.addInitScript(`document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(extraCss)}; document.head.appendChild(s); });`);
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  pageerror:', e.message));
  page.__mouse = { x: VW / 2, y: VH + 40 };
  return page;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// Плавный перевод мыши с человеческим разгоном и торможением.
async function glide(page, x, y, ms = 450) {
  const { x: x0, y: y0 } = page.__mouse;
  const n = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= n; i++) {
    const k = ease(i / n);
    await page.mouse.move(x0 + (x - x0) * k, y0 + (y - y0) * k);
    await sleep(ms / n);
  }
  page.__mouse = { x, y };
}

async function center(page, sel) {
  const loc = typeof sel === 'string' ? page.locator(sel).first() : sel;
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b) throw new Error('нет элемента ' + sel);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function clickOn(page, sel, { ms = 450, mods = [] } = {}) {
  const p = await center(page, sel);
  await glide(page, p.x, p.y, ms);
  await sleep(90);
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.down(); await sleep(70); await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
}

async function typeIn(page, text, delay = 55) {
  for (const ch of text) { await page.keyboard.type(ch); await sleep(delay * (0.6 + Math.random() * 0.8)); }
}

// Скринкаст: кадры приходят только на перерисовке, с меткой времени. На
// выходе — JPEG-и и clip.json со временем каждого кадра от начала съёмки.
async function record(page, outDir, fn) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  let t0 = null;
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    if (t0 === null) t0 = metadata.timestamp;
    const i = frames.length;
    const file = String(i).padStart(5, '0') + '.jpg';
    fs.writeFileSync(path.join(outDir, file), Buffer.from(data, 'base64'));
    frames.push({ f: file, t: +(metadata.timestamp - t0).toFixed(4) });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  const marks = {};
  const wall0 = Date.now();
  const mark = name => { marks[name] = (Date.now() - wall0) / 1000; };
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VW * DSF, maxHeight: VH * DSF, everyNthFrame: 1 });
  await fn(mark);
  await sleep(300);
  await cdp.send('Page.stopScreencast');
  const dur = (Date.now() - wall0) / 1000;
  fs.writeFileSync(path.join(outDir, 'clip.json'), JSON.stringify({ w: VW * DSF, h: VH * DSF, dur, marks, frames }, null, 1));
  const fps = frames.length / dur;
  console.log(`  ${path.basename(outDir)}: ${frames.length} кадров за ${dur.toFixed(1)} с (${fps.toFixed(1)} к/с)`, marks);
}

module.exports = { newPage, record, glide, clickOn, typeIn, center, sleep, VW, VH };
