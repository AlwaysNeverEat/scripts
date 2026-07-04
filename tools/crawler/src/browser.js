// Запуск браузера с учётом окружения.
//
// В обычной сети (машина оператора, CI-раннер) — просто ставит браузер
// playwright-core и запускает его. В песочнице с egress-прокси нужно передать
// HTTPS_PROXY: playwright пробрасывает его в chromium через опцию proxy.

import { chromium } from 'playwright-core';

export async function launchBrowser({ headless = true, executablePath, slowMo = 0 } = {}) {
  const opts = { headless, slowMo, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] };

  // Явный путь к браузеру (например, предустановленный chromium в песочнице:
  //   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, executablePath=.../chrome).
  if (executablePath) opts.executablePath = executablePath;

  // Egress-прокси, если он есть (песочница). В обычной сети переменной нет —
  // браузер идёт напрямую.
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (proxy) {
    opts.proxy = { server: proxy };
    opts.ignoreHTTPSErrors = true;
    opts.args.push('--ignore-certificate-errors');
  }

  const browser = await chromium.launch(opts);
  const context = await browser.newContext({
    ignoreHTTPSErrors: !!proxy,
    locale: 'ru-RU',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  });
  return { browser, context };
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Джиттер вокруг базовой задержки, чтобы запросы не шли ровным «пулемётным»
// ритмом (меньше шансов словить rate-limit).
export function jitter(baseMs, spreadMs = baseMs * 0.4) {
  return baseMs + Math.floor((Math.random() * 2 - 1) * spreadMs);
}
