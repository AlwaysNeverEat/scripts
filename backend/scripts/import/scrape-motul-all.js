#!/usr/bin/env node
// Получает актуальный список всех марок категории «Легковые автомобили» Motul
// и запускает существующий чекпоинтный scrape-motul.js для каждой марки.
// Так новые марки не зависят от вручную заданного DEFAULT_BRANDS.

import { spawn } from 'node:child_process';
import * as cheerio from 'cheerio';
import { CookieJar, politeFetch } from './http.js';

const BASE = 'https://motul.lubricantadvisor.com';
const PAGE = `${BASE}/default.aspx?data=1&lang=rus`;
const args = process.argv.slice(2);
const forwarded = [];
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--brands') { i++; continue; }
    forwarded.push(args[i]);
}
const jar = new CookieJar();

function formFields(html) {
    const $ = cheerio.load(html);
    const out = {};
    for (const name of ['__EVENTTARGET','__EVENTARGUMENT','__LASTFOCUS','__VIEWSTATE','__VIEWSTATEGENERATOR','__EVENTVALIDATION']) {
        const value = $(`input[name="${name}"]`).attr('value');
        if (value != null) out[name] = value;
    }
    return out;
}

const start = await politeFetch(PAGE);
jar.absorb(start);
const startHtml = await start.text();
const body = new URLSearchParams({
    ...formFields(startHtml), search: '', hidItemId: '', hidIsModel: '',
    'ctl00$ContentPlaceHolder1$rptCategoryBtn$ctl01$btnImage.x': '10',
    'ctl00$ContentPlaceHolder1$rptCategoryBtn$ctl01$btnImage.y': '10',
}).toString();
const response = await politeFetch(PAGE, {
    method: 'POST',
    headers: { Cookie: jar.header(), Referer: PAGE, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
});
if (response.status !== 200) throw new Error(`Motul category HTTP ${response.status}`);
const $ = cheerio.load(await response.text());
const makes = $('select[name="ctl00$ContentPlaceHolder1$lstMake"] option').map((_, el) => $(el).text().trim()).get()
    .filter(Boolean)
    .filter(name => !/\((USA|CAN|TUR)\)|IRAN KHODRO/i.test(name));

// scrape-motul.js матчится по includes; полный label — самый точный фильтр.
console.log(`Motul all: найдено ${makes.length} легковых марок`);
let failed = 0;
for (let index = 0; index < makes.length; index++) {
    const brand = makes[index];
    console.log(`\n[${index + 1}/${makes.length}] ${brand}`);
    const code = await new Promise(resolve => {
        const child = spawn(process.execPath, ['scripts/import/scrape-motul.js', '--brands', brand.toLowerCase(), ...forwarded], {
            stdio: 'inherit',
            shell: false,
        });
        child.on('error', error => { console.error(error.message); resolve(1); });
        child.on('exit', value => resolve(value ?? 1));
    });
    if (code !== 0) {
        failed++;
        console.warn(`Марка ${brand} завершилась с кодом ${code}; следующий запуск повторит её по чекпоинтам`);
    }
}
console.log(`Motul all завершён: марок=${makes.length}, ошибок=${failed}`);
process.exit(failed ? 2 : 0);
