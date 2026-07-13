// ─────────────────────────────────────────────────────────────────────────────
// Парсер advice-страницы Motul Lubricant Advisor (advice.aspx, lang=rus).
// Порт parseMotulAdvice/parseCompBlock из userscript/src/oil-calculator/app.js
// на cheerio: та же классификация агрегатов и те же регэкспы объёмов, чтобы
// формат fluid_capacities совпадал с тем, что шлёт калькулятор.
// ─────────────────────────────────────────────────────────────────────────────

import * as cheerio from 'cheerio';

export function parseMotulAdvice(html) {
    const $ = cheerio.load(html);

    const makeText  = $('#ctl00_ContentPlaceHolder1_lblMakeValue').text().trim();
    const modelText = $('#ctl00_ContentPlaceHolder1_lblModelValue').text().trim();
    const typeText  = $('#ctl00_ContentPlaceHolder1_lblTypeValue').text().trim();

    const out = {
        motulName: [makeText, modelText, typeText].filter(Boolean).join(' · '),
        make_model_type: typeText,
    };

    $('.AdviceComponentTitleText').each((idx, tdTitle) => {
        let titleText = $(tdTitle).contents()
            .filter((_, n) => n.type === 'text')
            .map((_, n) => n.data).get().join('');
        titleText = titleText.replace(/\s+/g, ' ').trim();
        if (!titleText) titleText = $(tdTitle).text().replace(/- Not applicable/g, '').trim();

        const compBlock = $('#Comp' + idx);
        if (!compBlock.length) return;

        const data = parseCompBlock($, compBlock);
        data.label = titleText;
        data.rawText = compBlock.text().replace(/\s+/g, ' ').trim();

        if (/двигатель/i.test(titleText)) {
            data.engineCode = titleText.replace(/двигатель/i, '').trim();
            out.engine = data;
        } else if (/раздаточн/i.test(titleText)) {
            out.transfer = data;
        } else if (/передн.*(мост|дифференциал)|дифференциал.*передн/i.test(titleText)) {
            out.diffFront = data;
        } else if (/задн.*(мост|дифференциал)|дифференциал.*задн/i.test(titleText)) {
            out.diffRear = data;
        } else if (/механическая/i.test(titleText)) {
            out.manual = data;
        } else if (/полуавтомат/i.test(titleText)) {
            // Полуавтомат (AMT/робот с одним сцеплением) — считаем как МКПП.
            // Проверка ОБЯЗАТЕЛЬНО до /автомат/, т.к. «полуавтоматическая»
            // содержит подстроку «автомат».
            data.isSemiAuto = true;
            out.manual = data;
        } else if (/вариатор|CVT/i.test(titleText)) {
            out.automatic = data;
            data.isCvt = true;
        } else if (/DSG|DCT|робот|двойн[а-я]+ сцеплен/i.test(titleText)) {
            out.automatic = data;
            data.isDct = true;
        } else if (/автомат/i.test(titleText) || /коробка передач.*планет/i.test(titleText)) {
            out.automatic = data;
        }
    });

    return out;
}

function parseCompBlock($, block) {
    const result = { volume: 0, filterVolume: 0, motulProducts: [], modes: [] };
    let volService = 0, volTotal = 0, volPlain = 0;

    // Motul иногда пишет кириллические слова латинскими буквами-двойниками.
    const norm = (s) => s.toLowerCase()
        .replace(/o/g, 'о').replace(/c/g, 'с').replace(/e/g, 'е')
        .replace(/p/g, 'р').replace(/a/g, 'а');

    block.find('tr').each((_, tr) => {
        const titleTd = $(tr).find('.AdviceTitle').first();
        const valueTd = $(tr).find('.AdviceValue').first();

        if (titleTd.length && valueTd.length) {
            const title = titleTd.text().replace(/\s+/g, ' ').trim();
            const value = valueTd.text().replace(/\s+/g, ' ').trim();
            const valueN = norm(value);
            const titleN = norm(title);

            if (/объ[её]м/.test(valueN) || /объ[её]м/.test(titleN)) {
                const m = value.match(/([\d]+(?:[,.]\d+)?)\s*л/i);
                if (m) {
                    const vol = parseFloat(m[1].replace(',', '.'));
                    const isFilter  = /фильтр/.test(valueN);
                    const isService = /сервисн/.test(valueN);
                    const isTotal   = /общ|полн/.test(valueN);

                    if (isFilter) {
                        result.filterVolume = vol;
                    } else if (isService) {
                        volService = vol;
                    } else if (isTotal) {
                        volTotal = vol;
                    } else if (!volPlain) {
                        volPlain = vol;
                    }
                }
            } else if (/режим/.test(titleN) || /режим/.test(valueN)) {
                result.modes.push(value);
            } else if (/интервал/.test(titleN) || /интервал/.test(valueN)) {
                result.interval = value;
            }
        }

        const prodValueTd = $(tr).find('.AdviceValueProduct').first();
        if (prodValueTd.length) {
            const pname = prodValueTd.text().replace(/\s+/g, ' ').trim();
            if (pname && pname !== ':' && !/products not found/i.test(pname) && pname.length > 1) {
                if (!result.motulProducts.includes(pname)) {
                    result.motulProducts.push(pname);
                }
            }
        }
    });

    result.volumeService = volService;
    result.volumeTotal = volTotal;
    result.volumePlain = volPlain;
    result.volume = volService || volTotal || volPlain || 0;
    result.volumeType = volService ? 'service' : (volTotal ? 'total' : 'plain');

    return result;
}

// ── Разбор подписи модификации из выпадашки lstType ─────────────────────────
// Примеры: «Octavia III 1.2 TSI (63 кВт / 86 ЛС) (2012 - 2016)»,
//          «320i (135 кВт) (2018 - )»
export function parseTypeLabel(label) {
    const out = { engineName: '', kw: null, bhp: null, yearFrom: null, yearTo: null, volume: null };
    let rest = label.replace(/\s+/g, ' ').trim();

    const years = rest.match(/\((\d{4})\s*-\s*(\d{4})?\s*\)\s*$/);
    if (years) {
        out.yearFrom = parseInt(years[1]);
        out.yearTo = years[2] ? parseInt(years[2]) : null;
        rest = rest.slice(0, years.index).trim();
    }

    const power = rest.match(/\((\d+)\s*кВт(?:\s*\/\s*(\d+)\s*ЛС)?\)\s*$/i);
    if (power) {
        out.kw = parseInt(power[1]);
        out.bhp = power[2] ? parseInt(power[2]) : null;
        rest = rest.slice(0, power.index).trim();
    }

    const vol = rest.match(/(\d+\.\d+)/);
    if (vol) out.volume = parseFloat(vol[1]);

    out.engineName = rest;
    return out;
}

// Топливо по названию/коду двигателя — тот же дизельный регэксп, что в
// userscript/src/parsers.js (коды: '01' бензин, '05' дизель).
export function guessFuelType(text) {
    const t = String(text || '').toUpperCase();
    if (/электро|electric/i.test(t)) return null;
    if (/\bD\b|DCI|TDI|HDI|CDI|CRDI|TDCI|TDDI|JTD|MULTIJET|DTI|CTDI|D-?4D|SDI|\bTD\b|ДИЗЕЛЬ/i.test(t)) {
        return '05';
    }
    return '01';
}

// «Kia (EU)» → «KIA», «Lada (VAZ / Zhiguli)» → «LADA»
export function cleanBrand(makeLabel) {
    return makeLabel.replace(/\([^)]*\)/g, ' ').replace(/\s{2,}/g, ' ').trim().toUpperCase();
}

// «Octavia III, NL3 (2012 - 2020)» → { model: 'Octavia III', generation: 'NL3' }
export function parseModelLabel(modelLabel) {
    let rest = modelLabel.replace(/\(\s*\d{4}\s*-\s*\d{0,4}\s*\)\s*$/, '').trim();
    const comma = rest.indexOf(',');
    if (comma > 0) {
        return { model: rest.slice(0, comma).trim(), generation: rest.slice(comma + 1).trim() || null };
    }
    return { model: rest, generation: null };
}
