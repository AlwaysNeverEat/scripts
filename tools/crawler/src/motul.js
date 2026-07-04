// Источник объёмов и допусков — Motul Lubricant Advisor.
//
// Навигация: у адвайзера есть «умный поиск» (#instantsearchinput) с
// автоподсказками — тот же путь, что использует юзерскрипт-калькулятор.
// Печатаем запрос → ждём выпадашку → выбираем машину → попадаем на страницу
// advice с блоками агрегатов → парсим объёмы/продукты/допуска.
//
// parseAdvice() / parseCompBlock() — порт проверенной логики из
// userscript/src/oil-calculator/app.js (parseMotulAdvice). Менять их надо
// синхронно с юзерскриптом.

const ADVISOR_URL = 'https://motul.lubricantadvisor.com/default.aspx?data=1&lang=rus';

// Функция запускается ВНУТРИ страницы (page.evaluate). Возвращает объекты
// агрегатов в форме fluid_capacities базы: { engine, automatic, manual, ... }.
function extractAdvice() {
  const makeEl = document.getElementById('ctl00_ContentPlaceHolder1_lblMakeValue');
  const modelEl = document.getElementById('ctl00_ContentPlaceHolder1_lblModelValue');
  const typeEl = document.getElementById('ctl00_ContentPlaceHolder1_lblTypeValue');

  const out = {
    motulName: [makeEl?.textContent, modelEl?.textContent, typeEl?.textContent].filter(Boolean).join(' · '),
    make: (makeEl?.textContent || '').trim(),
    model: (modelEl?.textContent || '').trim(),
    type: (typeEl?.textContent || '').trim(),
    aggregates: {},
  };

  function parseCompBlock(block) {
    const result = { volumeService: 0, volumeTotal: 0, volumePlain: 0, filterVolume: 0, motulProducts: [], modes: [] };
    let volService = 0, volTotal = 0, volPlain = 0;
    const norm = (s) => s.toLowerCase()
      .replace(/o/g, 'о').replace(/c/g, 'с').replace(/e/g, 'е').replace(/p/g, 'р').replace(/a/g, 'а');

    block.querySelectorAll('tr').forEach((tr) => {
      const titleTd = tr.querySelector('.AdviceTitle');
      const valueTd = tr.querySelector('.AdviceValue');
      if (titleTd && valueTd) {
        const value = valueTd.textContent.replace(/\s+/g, ' ').trim();
        const valueN = norm(value);
        const titleN = norm(titleTd.textContent.replace(/\s+/g, ' ').trim());
        if (/объ[её]м/.test(valueN) || /объ[её]м/.test(titleN)) {
          const m = value.match(/([\d]+(?:[,.]\d+)?)\s*л/i);
          if (m) {
            const vol = parseFloat(m[1].replace(',', '.'));
            if (/фильтр/.test(valueN)) result.filterVolume = vol;
            else if (/сервисн/.test(valueN)) volService = vol;
            else if (/общ|полн/.test(valueN)) volTotal = vol;
            else if (!volPlain) volPlain = vol;
          }
        } else if (/режим/.test(titleN) || /режим/.test(valueN)) {
          result.modes.push(value);
        }
      }
      const prodTd = tr.querySelector('.AdviceValueProduct');
      if (prodTd) {
        const pname = prodTd.textContent.replace(/\s+/g, ' ').trim();
        if (pname && pname !== ':' && !/products not found/i.test(pname) && pname.length > 1
            && !result.motulProducts.includes(pname)) {
          result.motulProducts.push(pname);
        }
      }
    });

    result.volumeService = volService;
    result.volumeTotal = volTotal;
    result.volumePlain = volPlain;
    return result;
  }

  document.querySelectorAll('.AdviceComponentTitleText').forEach((tdTitle, idx) => {
    let titleText = '';
    for (const n of tdTitle.childNodes) if (n.nodeType === 3) titleText += n.textContent;
    titleText = titleText.replace(/\s+/g, ' ').trim();
    if (!titleText) titleText = tdTitle.textContent.replace(/- Not applicable/g, '').trim();

    const compBlock = document.getElementById('Comp' + idx);
    if (!compBlock) return;
    const data = parseCompBlock(compBlock);
    data.label = titleText;

    if (/двигатель/i.test(titleText)) { data.engineCode = titleText.replace(/двигатель/i, '').trim(); out.aggregates.engine = data; }
    else if (/раздаточн/i.test(titleText)) out.aggregates.transfer = data;
    else if (/передн.*(мост|дифференциал)|дифференциал.*передн/i.test(titleText)) out.aggregates.diffFront = data;
    else if (/задн.*(мост|дифференциал)|дифференциал.*задн/i.test(titleText)) out.aggregates.diffRear = data;
    else if (/механическая/i.test(titleText)) out.aggregates.manual = data;
    else if (/полуавтомат/i.test(titleText)) { data.isSemiAuto = true; out.aggregates.manual = data; }
    else if (/вариатор|CVT/i.test(titleText)) { data.isCvt = true; out.aggregates.automatic = data; }
    else if (/DSG|DCT|робот|двойн[а-я]+ сцеплен/i.test(titleText)) { data.isDct = true; out.aggregates.automatic = data; }
    else if (/автомат/i.test(titleText) || /коробка передач.*планет/i.test(titleText)) out.aggregates.automatic = data;
  });

  return out;
}

// Публичный API модуля ─────────────────────────────────────────────────────────

export async function openAdvisor(page) {
  await page.goto(ADVISOR_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#instantsearchinput', { timeout: 30000 });
}

// Печатает запрос в умный поиск, берёт первую подсказку, ждёт страницу advice.
// Возвращает распарсенные данные или null, если машину не нашли.
export async function searchVehicle(page, queryText) {
  await openAdvisor(page);
  const input = page.locator('#instantsearchinput');
  await input.fill('');
  await input.type(queryText, { delay: 40 });

  // Автоподсказки адвайзера (Olyslager). Селектор — точка тюнинга: сверить
  // на живом сайте (--headful) первый запуск. Обычно это <ul>/<li> под инпутом.
  const suggestion = page.locator('.ui-autocomplete li, .autocomplete-suggestion, #instantSearchResults a').first();
  try {
    await suggestion.waitFor({ state: 'visible', timeout: 8000 });
    await suggestion.click();
  } catch {
    // Нет подсказок — жмём GO как запасной путь.
    await page.locator('#ctl00_ContentPlaceHolder1_olyInstantSearch_btnSearch').click().catch(() => {});
  }

  try {
    await page.waitForSelector('.AdviceComponentTitleText', { timeout: 15000 });
  } catch {
    return null; // не дошли до advice — вероятно, список моделей/типов
  }
  return page.evaluate(extractAdvice);
}

// Прямой парс уже открытой страницы advice (когда навигация сделана иначе).
export async function parseCurrentAdvice(page) {
  const has = await page.locator('.AdviceComponentTitleText').count();
  if (!has) return null;
  return page.evaluate(extractAdvice);
}
