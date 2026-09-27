// Съёмка живых клипов из дев-песочниц сайта. Запуск: см. README.md рядом.
//   node capture.cjs <папка-вывода> [имя-клипа …]
const { chromium } = require('playwright');
const path = require('path');
const { newPage, record, glide, clickOn, typeIn, center, sleep, VW, VH } = require('./rec.cjs');

const BASE = 'http://127.0.0.1:5173/';
const OUT = process.argv[2];
const ONLY = process.argv.slice(3);

// Шапка песочницы и её отладочные ручки в кадр не идут: в ролике это сайт.
const HIDE_DOOM = '.doom-over { display: none !important; }';
const HIDE_DEV = `.page-head, .page-body:has(#dev-case), .page-body:has(#dev-theme), .page-body:has(#dev-open) { display: none !important; }`;

// В песочнице «Клиент» лежит снимок настоящих страниц CRM — имя, телефон,
// госномер и ФИО мастеров живых людей. В ролик они не попадают: подменяем
// выдуманными прямо в отдаваемой странице.
const FAKE_SELLERS = ['Смирнов Иван Петрович', 'Кузнецов Олег Викторович', 'Попов Денис Андреевич', 'Волков Артём Игоревич', 'Соколов Павел Сергеевич'];
function anonymizeClient(html) {
  let k = 0;
  return html
    .replace(/"seller":\s*"[^"]*"/g, () => `"seller": "${FAKE_SELLERS[k++ % FAKE_SELLERS.length]}"`)
    .replace(/seller:\s*'[^']*'/g, () => `seller: '${FAKE_SELLERS[k++ % FAKE_SELLERS.length]}'`)
    .replace(/Георгий Русланович/g, 'Алексей Петрович')
    .replace(/Георгий/g, 'Алексей')
    .replace(/79819651916/g, '79213456789')
    .replace(/9819651916/g, '9213456789')
    .replace(/К926АА147/g, 'Е123КХ178')
    .replace(/К926АА14/g, 'Е123КХ17');
}

const CLIPS = {
  // Клиент: набрали номер — карточка, чеки дозаполняются на глазах.
  async client(browser) {
    const page = await newPage(browser, HIDE_DEV + ` body { padding-top: 70px !important; } .page-body { max-width: 640px !important; }`);
    await page.route(/dev-client\.html/, async route => {
      const res = await route.fetch();
      route.fulfill({ response: res, body: anonymizeClient(await res.text()) });
    });
    await page.goto(BASE + 'dev-client.html', { waitUntil: 'networkidle' });
    await sleep(600);
    await record(page, path.join(OUT, 'client'), async mark => {
      await sleep(250);
      await clickOn(page, '.client-search input', { ms: 500 });
      mark('type');
      await typeIn(page, '9213456789', 60);
      mark('typed');
      await sleep(4200);
      mark('filled');
      await glide(page, VW / 2 + 60, VH / 2 + 140, 700);
      await sleep(500);
    });
    await page.context().close();
  },

  // Записи: станция → свободный слот → окно → «Записать и скопировать» → очередь.
  async records(browser) {
    const page = await newPage(browser, ``);
    await page.goto(BASE + 'dev-records-crm.html?delay=1600', { waitUntil: 'networkidle' });
    await sleep(900);
    await record(page, path.join(OUT, 'records'), async mark => {
      await sleep(200);
      await clickOn(page, '[data-action="open-station"]', { ms: 550 });
      mark('station');
      await sleep(900);
      const slots = page.locator('button.rc-add[data-action="create-at"]');
      const n = await slots.count();
      await clickOn(page, slots.nth(Math.min(4, n - 1)), { ms: 550 });
      mark('modal');
      await sleep(500);
      await clickOn(page, '#rc-f-name', { ms: 350 });
      await typeIn(page, 'Алексей', 45);
      await clickOn(page, '#rc-f-phone', { ms: 300 });
      await typeIn(page, '9213456789', 40);
      await clickOn(page, '#rc-f-car', { ms: 300 });
      await typeIn(page, 'Е123КХ178', 40);
      await clickOn(page, '#rc-f-comment', { ms: 300 });
      await typeIn(page, 'двс + вф', 45);
      await sleep(250);
      await clickOn(page, '[data-action="submit-create"]', { ms: 500 });
      mark('submit');
      await sleep(2600);
      mark('applied');
      await clickOn(page, '[data-action="open-queue"]', { ms: 600 });
      mark('queue');
      await sleep(1800);
    });
    await page.context().close();
  },

  // Склад: три станции колонками, запрос — остатки по каждой.
  async stock(browser) {
    const page = await newPage(browser, HIDE_DEV + ` body { padding-top: 24px !important; }`);
    await page.goto(BASE + 'dev-stock.html', { waitUntil: 'networkidle' });
    await sleep(1800);
    await record(page, path.join(OUT, 'stock'), async mark => {
      await sleep(200);
      const st = name => page.locator('#ss-stations').getByText(name, { exact: true });
      await clickOn(page, st('Ветеранов 167к8'), { ms: 500 });
      await clickOn(page, st('Выборгское ш. 2'), { ms: 300, mods: ['Control'] });
      await clickOn(page, st('Планерная 16'), { ms: 350, mods: ['Control'] });
      mark('stations');
      await clickOn(page, '.stock-search input[type="search"], .stock-search input[type="text"], .stock-search input', { ms: 500 });
      await typeIn(page, 'фильтр', 60);
      await page.keyboard.press('Enter');
      mark('search');
      await sleep(2600);
      await glide(page, VW * 0.62, VH * 0.55, 700);
      await sleep(600);
    });
    await page.context().close();
  },
  // Калькулятор: карточка машины, чипы пробега — пилюля едет, итог для Битрикса пересчитывается.
  async carpage(browser) {
    const page = await newPage(browser, ``);
    await page.goto(BASE + 'dev-carpage.html', { waitUntil: 'networkidle' });
    await sleep(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await record(page, path.join(OUT, 'carpage'), async mark => {
      await sleep(300);
      await glide(page, VW * 0.5, VH * 0.6, 500);
      for (let i = 0; i < 26; i++) { await page.mouse.wheel(0, 28); await sleep(16); }
      mark('scrolled');
      await sleep(400);
      await clickOn(page, '[data-mileage=">=100"]', { ms: 450 });
      await sleep(500);
      await clickOn(page, '[data-mileage=">=200"]', { ms: 350 });
      await sleep(500);
      await clickOn(page, '[data-mileage="0w20"]', { ms: 350 });
      mark('chips');
      await sleep(900);
    });
    await page.context().close();
  },

  // Лента активности: масштаб 3 месяца → полгода → год, подписи перетекают.
  async activity(browser) {
    const page = await newPage(browser, HIDE_DEV + ` .page-head, body > .page-body:first-of-type { display: none !important; } body { padding-top: 30px !important; }`);
    await page.goto(BASE + 'dev-activity.html', { waitUntil: 'networkidle' });
    await sleep(1200);
    await record(page, path.join(OUT, 'activity'), async mark => {
      await sleep(300);
      const chip = t => page.locator('#dev-activity').getByText(t, { exact: true }).first();
      await clickOn(page, chip('Полгода'), { ms: 500 });
      await sleep(900);
      await clickOn(page, chip('Год'), { ms: 400 });
      mark('year');
      await sleep(1100);
    });
    await page.context().close();
  },

  // Пасхалка: меню игр.
  async games(browser) {
    const page = await newPage(browser, ` .page-head { display: none !important; }`);
    await page.goto(BASE + 'dev-games.html', { waitUntil: 'networkidle' });
    await sleep(800);
    await page.evaluate(() => { document.getElementById('dev-open').style.opacity = '0'; });
    await record(page, path.join(OUT, 'games'), async mark => {
      await sleep(200);
      await page.click('#dev-open');
      mark('open');
      await glide(page, VW * 0.5, VH * 0.5, 900);
      await sleep(1600);
    });
    await page.context().close();
  },

  // Главная: сфера из машин и набор в поиске.
  async sphere(browser) {
    const page = await newPage(browser, ` #picker, #toggle-theme, .dev-panel { display: none !important; }`);
    await page.goto(BASE + 'dev-background.html', { waitUntil: 'networkidle' });
    await page.evaluate(() => { for (const el of document.querySelectorAll('body > *')) if (el.id !== 'page-search' && !el.querySelector?.('#page-search')) el.style.display = 'none'; });
    await sleep(1500);
    await record(page, path.join(OUT, 'sphere'), async mark => {
      await sleep(1500);
      await clickOn(page, '#search-input', { ms: 600 });
      await typeIn(page, 'Solaris', 90);
      mark('typed');
      await sleep(1500);
    });
    await page.context().close();
  },

  // Главная: трубы из Windows 95.
  async pipes(browser) {
    const page = await newPage(browser, ``);
    await page.goto(BASE + 'dev-background.html', { waitUntil: 'networkidle' });
    await sleep(800);
    await page.getByText('Трубы', { exact: true }).first().click();
    await page.evaluate(() => { for (const el of document.querySelectorAll('body > *')) if (el.id !== 'page-search' && !el.querySelector?.('#page-search')) el.style.display = 'none'; const p = document.getElementById('picker'); if (p) p.closest('div').style.display = 'none'; });
    await sleep(2500);
    await record(page, path.join(OUT, 'pipes'), async () => { await sleep(4500); });
    await page.context().close();
  },

  // DOOM прямо на рабочем месте.
  async doom(browser) {
    const page = await newPage(browser, ` .page-head { display: none !important; } ${HIDE_DOOM}`);
    await page.goto(BASE + 'dev-doom.html', { waitUntil: 'networkidle' });
    await sleep(500);
    await page.evaluate(() => { document.getElementById('dev-open').style.opacity = '0'; });
    await page.click('#dev-open');
    await sleep(6000);
    await record(page, path.join(OUT, 'doom'), async mark => {
      await page.keyboard.press('Enter'); await sleep(400);
      await page.keyboard.press('Enter'); await sleep(400);
      await page.keyboard.press('Enter'); await sleep(400);
      await page.keyboard.press('Enter'); await sleep(2500);
      mark('ingame');
      await page.keyboard.down('w'); await sleep(900); await page.keyboard.up('w');
      await sleep(1200);
    });
    await page.context().close();
  },
};

(async () => {
  const browser = await chromium.launch();
  for (const [name, fn] of Object.entries(CLIPS)) {
    if (ONLY.length && !ONLY.includes(name)) continue;
    console.log('клип', name);
    try { await fn(browser); } catch (e) { console.log('  СБОЙ', name, e.message); }
  }
  await browser.close();
})();
