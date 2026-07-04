// Источник артикулов трёх фильтров и каноничных названий марки/модели —
// онлайн-каталог MANN-FILTER.
//
// Логика выбора фильтров портирована из юзерскрипта
// «MANN-FILTER: Скопировать 3 артикула»: берём только «доступные» и не
// устаревшие карточки, по одной на тип (воздушный/масляный/салонный),
// салонный — с приоритетом CU > CUK, FP игнорируем.
//
// Каноничное имя (включая КУЗОВ В СКОБКАХ, например «3 (E90)») берём из
// заголовка выбранной машины на странице результатов MANN — это важное
// требование: кузов мы прописываем в generation.

const LOCALE = process.env.MANN_LOCALE || 'ru-ru';

// Строит URL результатов каталога по данным машины.
// Точка тюнинга: сверить актуальный путь/имена параметров на живом сайте.
export function buildSearchUrl({ make, model, engineCode, ccm, kw, bhp, yearFrom }) {
  const p = new URLSearchParams();
  if (make) p.set('vehicleMake', make);
  if (model) p.set('vehicleModel', model);
  if (engineCode) p.set('engineCode', engineCode);
  if (ccm) p.set('ccm', String(ccm));
  if (kw) p.set('kw', String(kw));
  if (bhp) p.set('bhp', String(bhp));
  if (yearFrom) p.set('vehicleManufacturedFrom', String(yearFrom));
  return `https://www.mann-filter.com/${LOCALE}/catalog/search-results.html?${p.toString()}`;
}

// Функция запускается ВНУТРИ страницы (page.evaluate).
function extractFilters() {
  function getCardType(titleText) {
    const t = titleText.toLowerCase();
    if (t.includes('салон') || t.includes('cabin')) return 'cabin';
    if (t.includes('масл') || t.includes('oil')) return 'oil';
    if (t.includes('воздуш') || t.includes('air')) return 'air';
    return null;
  }
  function cabinPriority(sku) {
    if (/^FP\b/i.test(sku)) return 99;
    if (/^CU\b/i.test(sku)) return 1;
    if (/^CUK\b/i.test(sku)) return 2;
    return 3;
  }
  function isOutdated(card) {
    const dateRange = card.querySelector('.cmp-DateRange');
    if (!dateRange) return false;
    const icon = dateRange.querySelector('.cmp-icon--arrow-right');
    if (!icon) return false;
    let node = icon.previousSibling;
    while (node) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '') return false;
      node = node.previousSibling;
    }
    return true;
  }
  function findCards() {
    const selectors = ['[class*="product-item"]','[class*="productItem"]','[class*="catalog-item"]',
      '[class*="result-item"]','[class*="product-card"]','[class*="productCard"]'];
    for (const sel of selectors) {
      const found = document.querySelectorAll(sel);
      if (found.length) {
        const cards = Array.from(found).filter((el) => !el.parentElement.closest(sel));
        if (cards.length) return cards;
      }
    }
    return [];
  }

  const cards = findCards();
  const result = { air: null, oil: null, cabin: null, cabinPrio: 99 };
  for (const card of cards) {
    const text = card.innerText || card.textContent || '';
    if (!text.toLowerCase().includes('доступный')) continue;
    if (isOutdated(card)) continue;
    const titleEl = card.querySelector('[class*="result-item-title"], [class*="item-title"], [class*="filter-type"]');
    const type = getCardType(titleEl ? titleEl.textContent : text);
    if (!type) continue;
    const skuMatch = text.match(/\b([A-Z]{1,3}K?\s?\d[\d\s/-]{0,10}(?:\s*[a-z]{1,2})?)\b/i);
    if (!skuMatch) continue;
    const sku = skuMatch[1].trim();
    if (type === 'cabin') {
      const prio = cabinPriority(sku);
      if (prio === 99) continue;
      if (prio < result.cabinPrio) { result.cabin = sku; result.cabinPrio = prio; }
    } else if (!result[type]) {
      result[type] = sku;
    }
  }

  // Каноничное название выбранной машины (с кузовом в скобках).
  const headEl = document.querySelector(
    '[class*="vehicle-title"], [class*="selected-vehicle"], [class*="vehicle-name"], h1');
  const vehicleTitle = headEl ? headEl.textContent.replace(/\s+/g, ' ').trim() : '';

  const cardCount = cards.length;
  return { air: result.air, oil: result.oil, cabin: result.cabin, vehicleTitle, cardCount };
}

// Из заголовка «BMW 3 (E90) 320i» вынимает { brand, model, generation }.
export function splitVehicleTitle(title, fallbackMake) {
  if (!title) return { brand: fallbackMake || null, model: null, generation: null };
  let generation = null;
  const paren = title.match(/\(([^)]+)\)/);
  if (paren) generation = paren[1].trim();
  const noParen = title.replace(/\([^)]*\)/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const words = noParen.split(/\s+/);
  const brand = fallbackMake || words[0] || null;
  // модель — то, что между маркой и первой характеристикой (объём/л.с.)
  const rest = fallbackMake && noParen.toLowerCase().startsWith(fallbackMake.toLowerCase())
    ? noParen.slice(fallbackMake.length).trim()
    : words.slice(1).join(' ');
  const model = (rest.split(/\s+\d/)[0] || rest).trim() || null;
  return { brand, model, generation };
}

// Грузит результаты MANN для машины и возвращает фильтры + каноничное имя.
export async function lookupFilters(page, vehicle) {
  const url = buildSearchUrl(vehicle);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Каталог AEM догружает карточки скриптом — ждём появления или таймаут.
  await page.waitForTimeout(3500);
  const raw = await page.evaluate(extractFilters).catch(() => null);
  if (!raw) return { url, filters: null, name: null, cardCount: 0 };

  const name = splitVehicleTitle(raw.vehicleTitle, vehicle.make);
  const filters = {
    vf: raw.air ? { part: raw.air, absent: false } : { part: null, absent: false },
    mf: raw.oil ? { part: raw.oil, absent: false } : { part: null, absent: false },
    sf: raw.cabin ? { part: raw.cabin, absent: false } : { part: null, absent: false },
  };
  return { url, filters, name, cardCount: raw.cardCount };
}

// Все ли три фильтра найдены.
export function filtersComplete(filters) {
  return !!(filters && filters.vf?.part && filters.mf?.part && filters.sf?.part);
}
