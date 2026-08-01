// ─────────────────────────────────────────────────────────────────────────────
// База знаний по допускам моторного масла + классификатор значимости.
//
// ЗАЧЕМ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ
// `car_approvals` в базе — это НЕ требования машины. Источник (ROLF/ЛУКОЙЛ)
// отдаёт список допусков РЕКОМЕНДОВАННОГО МАСЛА, а у каждого масла в паспорте
// стоит 20–40 чужих ОЕМ-строк. Отсюда «Renault RN0700» у 9143 машин из 13391 и
// «MB 229.3 + BMW LL-01 + PSA» у Skoda Citigo. Проверка по выгрузке:
//   • у 97.6% машин допуска сразу от ≥3 разных ОЕМ-семейств;
//   • у 65.2% список физически противоречив — в нём одновременно есть
//     полнозольные (MB 229.5, VW 502 00) и малозольные (VW 504 00, LL-04)
//     допуска, а одно масло не может быть и тем и другим.
// Значит «совпал допуск → +10 к рейтингу» одинаково для всех 30 строк — это
// подсчёт шума. Побеждало масло с самым длинным паспортом, а не подходящее.
//
// ЧТО ДЕЛАЕТ ЭТОТ ФАЙЛ
// Каждый допуск разбирается на физику, которую он реально задаёт:
//   • зольность (SAPS) — сколько сульфатной золы допускается. Ключевая ось:
//     зола забивает сажевый фильтр НЕОБРАТИМО. Full → mid → low ужесточение.
//   • HTHS — вязкость при 150 °C и высоком сдвиге. Слишком жидкое в моторе,
//     рассчитанном на ≥3.5, — износ вкладышей; слишком густое в моторе под
//     HTHS<3.0 — перерасход топлива и проблемы с фазовращателями.
//   • вязкость, если допуск её жёстко фиксирует (VW 508 00 → только 0W-20).
//   • интервал замены — единственная «мягкая» ось: ошибка стоит ресурса
//     масла, а не железа.
// Дальше — марка. MB 229.51 обязателен на Mercedes и не значит НИЧЕГО на Kia:
// это чужое обязательство, попавшее в список из паспорта масла.
//
// Подробный разбор с обоснованием весов: docs/DOPUSKI.md
// ─────────────────────────────────────────────────────────────────────────────

// Пределы сульфатной золы (% масс.) по классам ACEA. Значения — верхняя
// граница класса; используем их как «сколько золы масло МОЖЕТ иметь».
export const ASH_FULL = 1.5;   // полнозольное: A3/B4, MB 229.5, VW 502 00
export const ASH_MID  = 0.8;   // среднезольное: C2/C3, MB 229.51, VW 504 00
export const ASH_LOW  = 0.5;   // малозольное: C1/C4, RN0720, Ford WSS-M2C934-B

const HTHS_HIGH = [3.5, Infinity];  // «густое» — A3/B4, C3, большинство ОЕМ
const HTHS_MID  = [2.9, 3.5];       // топливосберегающее — A5/B5, C2
const HTHS_LOW  = [2.6, 2.9];       // сверхтекучее — C5, VW 508 00, 0W-20

// ── Семейства допусков → марки, для которых допуск обязателен ────────────────
// Порядок внутри массива не важен; марка сравнивается по нормализованному
// названию (верхний регистр, без пробелов и дефисов).

export const FAMILY_MAKES = {
    MB:      ['MERCEDES', 'MERCEDESBENZ', 'MB', 'SMART', 'MAYBACH'],
    VW:      ['VW', 'VOLKSWAGEN', 'AUDI', 'SKODA', 'SEAT', 'CUPRA', 'PORSCHE'],
    BMW:     ['BMW', 'MINI', 'ROLLSROYCE'],
    // Лада ставит допуска Renault на моторы H4M/HR16 и на 21179 — альянс общий
    RN:      ['RENAULT', 'DACIA', 'NISSAN', 'INFINITI', 'LADA', 'ВАЗ', 'ЛАДА', 'VAZ'],
    PSA:     ['PEUGEOT', 'CITROEN', 'CITROËN', 'DS', 'OPEL', 'VAUXHALL'],
    GM:      ['OPEL', 'VAUXHALL', 'CHEVROLET', 'CADILLAC', 'BUICK', 'GMC', 'SAAB', 'DAEWOO', 'RAVON'],
    FORD:    ['FORD'],
    JLR:     ['JAGUAR', 'LANDROVER', 'LAND ROVER'],
    FIAT:    ['FIAT', 'ALFAROMEO', 'ALFA', 'LANCIA', 'JEEP', 'CHRYSLER', 'DODGE', 'RAM', 'IVECO'],
    PORSCHE: ['PORSCHE'],
    VOLVO:   ['VOLVO'],
    VAZ:     ['LADA', 'ВАЗ', 'ЛАДА', 'VAZ'],
};

const FAMILY_LABEL = {
    MB: 'Mercedes-Benz', VW: 'концерн VAG', BMW: 'BMW', RN: 'Renault-Nissan',
    PSA: 'Stellantis (PSA)', GM: 'GM/Opel', FORD: 'Ford', JLR: 'Jaguar Land Rover',
    FIAT: 'Fiat/Stellantis', PORSCHE: 'Porsche', VOLVO: 'Volvo', VAZ: 'АвтоВАЗ',
};

// ── Нормализация строки допуска ──────────────────────────────────────────────
// Приводит «VW 502.00», «VW 502 00» и «Volkswagen 502 00» к одному ключу.

// Кириллические двойники латиницы. В выгрузке реально встречается «МВ 229.5»
// (448 машин) и «Porsche А40» — набрано русскими буквами, глазом не отличить.
// Без замены такие строки уходят в «неопознанные» и молча теряют вес.
const CYR_LOOKALIKE = { А:'A', В:'B', Е:'E', К:'K', М:'M', Н:'H', О:'O',
                        Р:'P', С:'C', Т:'T', У:'Y', Х:'X' };

export function normSpec(s) {
    return String(s || '').toUpperCase()
        .replace(/АВТОВАЗ|ВАЗ/g, 'VAZ')
        .replace(/[АВЕКМНОРСТУХ]/g, (c) => CYR_LOOKALIKE[c])
        .replace(/MERCEDES[\s-]*BENZ|MERCEDES/g, 'MB')
        .replace(/VOLKSWAGEN/g, 'VW')
        .replace(/LONG\s*LIFE|LONGLIFE/g, 'LL')
        .replace(/RENAULT/g, 'RN')
        // «Jaguar Land Rover STJLR.03.5007» и «JAGUAR STJLR 03.5003» → STJLR035007
        .replace(/JAGUAR\s*LAND\s*ROVER|LAND\s*ROVER|JAGUAR/g, '')
        .replace(/APPROVAL|LICENSE.*$/g, '')
        .replace(/[^A-Z0-9]/g, '')
        // «Renault RN0700» после замены даёт RNRN0700 — схлопываем удвоение
        .replace(/^(RN|MB|VW)\1/, '$1')
        // В каталоге масел допуска BMW записаны без марки — «LL 01», «LL 04»
        // (и так же в таблице иерархии). Приводим к полному виду.
        .replace(/^LL(?=\d)/, 'BMWLL');
}

// Написания, которые нельзя вывести правилами: короткая форма допуска VAG
// («VW 508» вместо «VW 508 00») и подобное.
const SPEC_ALIASES = {
    VW508: 'VW50800',
    VW509: 'VW50900',
    VW506: 'VW50600',
    VW507: 'VW50700',
    VW504: 'VW50400',
    VW502: 'VW50200',
    VW505: 'VW50500',
    DEXOS2: 'GMDEXOS2',
    DEXOS1: 'GMDEXOS1',
};

// ── Разбор составных строк ───────────────────────────────────────────────────
// В выгрузке допуска склеены: «VW 502 00/505 00», «GM-LL-A/B-025»,
// «Ford WSS-M2C913-A/B/C/D», «FIAT 9.55535-N2/M2». Разбираем на отдельные
// допуска — иначе они не находятся в справочнике и уходят в «неизвестные».
// Класс ACEA «A3/B4» — это ОДНА строка, а не два допуска: отдельная проверка.

const ACEA_PAIR_RE = /^\s*(?:ACEA\s*)?[AB]\d\s*\/\s*[AB]\d\s*$/i;

export function splitCompound(raw) {
    const s = String(raw || '').trim();
    if (!s || !s.includes('/')) return s ? [s] : [];
    if (ACEA_PAIR_RE.test(s)) return [s];

    const parts = s.split('/').map(x => x.trim()).filter(Boolean);
    if (parts.length < 2) return [s];
    const head = parts[0];

    // Кандидаты префикса от самого длинного к самому короткому: до последнего
    // дефиса («Ford WSS-M2C913-» + «B»), до последнего пробела, первое слово
    // («VW » + «505 00»). Выбираем тот, что даёт известный справочнику допуск.
    const prefixes = [];
    const dash = head.lastIndexOf('-');
    if (dash > 0) prefixes.push(head.slice(0, dash + 1));
    const space = head.lastIndexOf(' ');
    if (space > 0) prefixes.push(head.slice(0, space + 1));
    const word = head.match(/^([A-Za-zА-Яа-я]+)\s+/);
    if (word) prefixes.push(word[1] + ' ');

    const out = [head];
    for (const part of parts.slice(1)) {
        let picked = null;
        for (const p of prefixes) {
            const cand = p + part;
            if (findSpec(cand, true)) { picked = cand; break; }
        }
        // Ничего не опознали — достраиваем самым длинным префиксом: для
        // «Fiat 9.55535-S2/GH2/T2» это даёт «Fiat 9.55535-T2», а не «Fiat T2».
        out.push(picked || (prefixes[0] || '') + part);
    }

    // Голова тоже бывает неполной: в «GM-LL-A/B-025» альтернатива A/B стоит в
    // середине, и суффикс «-025» достаётся только последней части.
    if (!findSpec(out[0], true)) {
        const last = out[out.length - 1];
        for (let i = 1; i < last.length; i++) {
            const cand = head + last.slice(i);
            if (findSpec(cand, true)) { out[0] = cand; break; }
        }
    }
    return out;
}

// ── Справочник допусков ──────────────────────────────────────────────────────
// role: 'oem' — обязательство автопроизводителя, 'acea' — европейский класс,
//       'api' — уровень качества (API/ILSAC).
// ash / hths — физика, которую допуск задаёт. null = допуск её не фиксирует.
// what — что допуск означает (первая строка подсказки при наведении).

const SPECS = [
    // ── ACEA: европейские классы. Задают физику напрямую, марка не важна ──
    { id: 'ACEAA3B4', label: 'ACEA A3/B4', role: 'acea', ash: ASH_FULL, hths: HTHS_HIGH,
      what: 'Полнозольное масло с HTHS ≥ 3.5. Полный пакет присадок, но зола забивает сажевый фильтр — только для моторов без DPF/GPF.' },
    { id: 'ACEAA3B3', label: 'ACEA A3/B3', role: 'acea', ash: ASH_FULL, hths: HTHS_HIGH,
      what: 'Полнозольное с HTHS ≥ 3.5, предшественник A3/B4. Без сажевого фильтра.' },
    { id: 'ACEAA5B5', label: 'ACEA A5/B5', role: 'acea', ash: ASH_FULL, hths: HTHS_MID,
      what: 'Топливосберегающее, HTHS 2.9–3.5. Лить только в мотор, спроектированный под низкий HTHS: Ford Duratec/TDCi, Renault, Jaguar. В мотор под A3/B4 — риск износа вкладышей.' },
    { id: 'ACEAA7B7', label: 'ACEA A7/B7', role: 'acea', ash: ASH_FULL, hths: HTHS_HIGH,
      what: 'Развитие A3/B4 (2021): та же зольность и HTHS ≥ 3.5, плюс защита от LSPI и износа цепи.' },
    { id: 'ACEAC1',  label: 'ACEA C1',  role: 'acea', ash: ASH_LOW, hths: HTHS_MID,
      what: 'Самый жёсткий по золе класс (≤0.5%) при HTHS 2.9–3.5. Ford/JLR под сажевый фильтр.' },
    { id: 'ACEAC2',  label: 'ACEA C2',  role: 'acea', ash: ASH_MID, hths: HTHS_MID,
      what: 'Среднезольное (≤0.8%) и топливосберегающее, HTHS 2.9–3.5. Дизели PSA/Toyota с сажевым фильтром.' },
    { id: 'ACEAC3',  label: 'ACEA C3',  role: 'acea', ash: ASH_MID, hths: HTHS_HIGH,
      what: 'Рабочая лошадка «под сажевый фильтр»: зола ≤0.8% при полноценном HTHS ≥ 3.5. Основа для MB 229.51, VW 504 00, LL-04, dexos2.' },
    { id: 'ACEAC4',  label: 'ACEA C4',  role: 'acea', ash: ASH_LOW, hths: HTHS_HIGH,
      what: 'Малозольное (≤0.5%) при HTHS ≥ 3.5. Практически только Renault RN0720.' },
    { id: 'ACEAC5',  label: 'ACEA C5',  role: 'acea', ash: ASH_MID, hths: HTHS_LOW,
      what: 'HTHS 2.6–2.9 — сверхтекучее, ради экономии топлива. Только для моторов, где завод его прямо требует.' },
    { id: 'ACEAC6',  label: 'ACEA C6',  role: 'acea', ash: ASH_MID, hths: HTHS_LOW,
      what: 'HTHS 2.6–2.9 с защитой от LSPI (2021). Новые турбо-бензиновые с прямым впрыском.' },
    { id: 'ACEAA1B1', label: 'ACEA A1/B1', role: 'acea', ash: ASH_FULL, hths: HTHS_MID,
      what: 'Устаревший топливосберегающий класс с HTHS 2.9–3.5. Отменён ACEA, встречается только в старых паспортах.' },
    { id: 'ACEAA2B2', label: 'ACEA A2/B2', role: 'acea', ash: ASH_FULL, hths: HTHS_HIGH,
      what: 'Устаревший базовый класс, предшественник A3/B3.' },

    // ── API / ILSAC: уровень качества, а не допуск ──
    { id: 'APISP',     label: 'API SP',     role: 'api', ash: null, hths: null,
      what: 'Уровень качества API для бензиновых (2020): защита от LSPI и износа цепи. Обратно совместим с SN/SM/SL.' },
    { id: 'APISNPLUS', label: 'API SN Plus', role: 'api', ash: null, hths: null,
      what: 'API SN с добавленной защитой от LSPI. Промежуточная ступень между SN и SP.' },
    { id: 'APISN',  label: 'API SN',  role: 'api', ash: null, hths: null,
      what: 'Уровень качества API для бензиновых (2010).' },
    { id: 'APISM',  label: 'API SM',  role: 'api', ash: null, hths: null, what: 'Уровень качества API (2004).' },
    { id: 'APISL',  label: 'API SL',  role: 'api', ash: null, hths: null, what: 'Уровень качества API (2001).' },
    { id: 'APISJ',  label: 'API SJ',  role: 'api', ash: null, hths: null, what: 'Уровень качества API (1996).' },
    { id: 'APISQ',  label: 'API SQ',  role: 'api', ash: null, hths: null, what: 'Новейший уровень качества API для бензиновых.' },
    { id: 'APICF',  label: 'API CF',  role: 'api', ash: null, hths: null,
      what: 'Старый дизельный уровень качества API (1994). На современный подбор не влияет.' },
    { id: 'ILSACGF6A', label: 'ILSAC GF-6A', role: 'api', ash: null, hths: HTHS_MID,
      what: 'API SP + топливная экономичность. Японские и американские моторы под 0W-20/5W-30.' },
    { id: 'ILSACGF5',  label: 'ILSAC GF-5',  role: 'api', ash: null, hths: HTHS_MID,
      what: 'API SN + топливная экономичность (2010).' },
    { id: 'ILSACGF4',  label: 'ILSAC GF-4',  role: 'api', ash: null, hths: HTHS_MID, what: 'Предшественник GF-5.' },
    { id: 'ILSACGF7A', label: 'ILSAC GF-7A', role: 'api', ash: null, hths: HTHS_MID,
      what: 'Новейший уровень ILSAC (2025) поверх API SQ. Обратно совместим с GF-6A.' },
    { id: 'ILSACGF6B', label: 'ILSAC GF-6B', role: 'api', ash: null, hths: HTHS_LOW, visc: ['0W-16'],
      what: 'Ветка ILSAC для сверхтекучих 0W-16. С GF-6A не взаимозаменяем.' },

    // ── Mercedes-Benz ──
    { id: 'MB2291',  label: 'MB 229.1',  role: 'oem', family: 'MB', ash: ASH_FULL, hths: HTHS_HIGH,
      what: 'Базовый допуск MB 1990-х. Полнозольное, HTHS ≥ 3.5, обычный интервал.' },
    { id: 'MB2293',  label: 'MB 229.3',  role: 'oem', family: 'MB', ash: ASH_FULL, hths: HTHS_HIGH, drain: 'long',
      what: 'Полнозольное с увеличенным интервалом. Для моторов БЕЗ сажевого фильтра.' },
    { id: 'MB2295',  label: 'MB 229.5',  role: 'oem', family: 'MB', ash: ASH_FULL, hths: HTHS_HIGH, drain: 'long',
      what: 'Полнозольное, выше требования к экономии и интервалу, чем 229.3. Тоже без сажевого фильтра.' },
    { id: 'MB22931', label: 'MB 229.31', role: 'oem', family: 'MB', ash: ASH_MID, hths: HTHS_HIGH,
      what: 'Среднезольное (≤0.8%) при HTHS ≥ 3.5 — версия 229.3 для моторов с сажевым фильтром.' },
    { id: 'MB22951', label: 'MB 229.51', role: 'oem', family: 'MB', ash: ASH_MID, hths: HTHS_HIGH, drain: 'long',
      what: 'Основной современный допуск MB: среднезольное, HTHS ≥ 3.5, сажевый фильтр + увеличенный интервал.' },
    { id: 'MB22952', label: 'MB 229.52', role: 'oem', family: 'MB', ash: ASH_MID, hths: HTHS_HIGH, drain: 'long',
      what: 'Ужесточённый 229.51: выше топливная экономичность и стойкость к окислению.' },
    { id: 'MB2296',  label: 'MB 229.6',  role: 'oem', family: 'MB', ash: ASH_FULL, hths: HTHS_MID, drain: 'long',
      what: 'Новое поколение MB (2019+), пониженный HTHS ради экономии топлива.' },
    { id: 'MB22961', label: 'MB 229.61', role: 'oem', family: 'MB', ash: ASH_MID, hths: HTHS_MID, drain: 'long',
      what: 'Новое поколение MB для дизелей с сажевым фильтром: среднезольное с пониженным HTHS.' },
    { id: 'MB2265',  label: 'MB 226.5',  role: 'oem', family: 'MB', ash: ASH_FULL, hths: HTHS_MID,
      what: 'Для моторов MB на базе Renault (A/B-класс, Citan). Полнозольное, HTHS 2.9–3.5.' },
    { id: 'MB2266',  label: 'MB 226.6',  role: 'oem', family: 'MB', ash: ASH_MID, hths: HTHS_MID,
      what: 'Версия 226.5 для моторов с сажевым фильтром.' },

    // ── VAG ──
    { id: 'VW50000', label: 'VW 500 00', role: 'oem', family: 'VW', ash: ASH_FULL, hths: HTHS_MID,
      what: 'Старый энергосберегающий допуск VAG (до 1999).' },
    { id: 'VW50101', label: 'VW 501 01', role: 'oem', family: 'VW', ash: ASH_FULL, hths: HTHS_HIGH,
      what: 'Базовый допуск VAG для атмосферных моторов (до 2000).' },
    { id: 'VW50200', label: 'VW 502 00', role: 'oem', family: 'VW', ash: ASH_FULL, hths: HTHS_HIGH,
      what: 'Полнозольное для бензиновых VAG, фиксированный интервал. Мотор БЕЗ сажевого фильтра.' },
    { id: 'VW50300', label: 'VW 503 00', role: 'oem', family: 'VW', ash: ASH_FULL, hths: HTHS_MID, drain: 'long',
      what: 'LongLife II для бензиновых: пониженный HTHS, интервал до 30 тыс. км.' },
    { id: 'VW50301', label: 'VW 503 01', role: 'oem', family: 'VW', ash: ASH_FULL, hths: HTHS_HIGH,
      what: 'LongLife для нагруженных бензиновых (Audi S/RS-серии).' },
    { id: 'VW50400', label: 'VW 504 00', role: 'oem', family: 'VW', ash: ASH_MID, hths: HTHS_HIGH, drain: 'long',
      what: 'LongLife III для бензиновых: среднезольное (≤0.8%) при HTHS ≥ 3.5, интервал до 30 тыс. км, совместимо с сажевым фильтром.' },
    { id: 'VW50500', label: 'VW 505 00', role: 'oem', family: 'VW', ash: ASH_FULL, hths: HTHS_HIGH,
      what: 'Полнозольное для дизелей VAG, фиксированный интервал. Без сажевого фильтра.' },
    { id: 'VW50501', label: 'VW 505 01', role: 'oem', family: 'VW', ash: ASH_FULL, hths: HTHS_HIGH,
      what: 'Для дизелей с насос-форсунками (PD-TDI): усиленная противозадирная защита кулачков.' },
    { id: 'VW50600', label: 'VW 506 00', role: 'oem', family: 'VW', ash: ASH_FULL, hths: HTHS_MID, drain: 'long',
      what: 'LongLife II для дизелей: пониженный HTHS, увеличенный интервал.' },
    { id: 'VW50601', label: 'VW 506 01', role: 'oem', family: 'VW', ash: ASH_FULL, hths: HTHS_MID, drain: 'long',
      what: 'LongLife II для дизелей с насос-форсунками.' },
    { id: 'VW50700', label: 'VW 507 00', role: 'oem', family: 'VW', ash: ASH_MID, hths: HTHS_HIGH, drain: 'long',
      what: 'LongLife III для дизелей: среднезольное при HTHS ≥ 3.5. Обязательно при сажевом фильтре — полнозольное его убивает.' },
    { id: 'VW50800', label: 'VW 508 00', role: 'oem', family: 'VW', ash: ASH_MID, hths: HTHS_LOW, visc: ['0W-20'], drain: 'long',
      what: 'HTHS 2.6–2.9, только 0W-20. Совершенно не взаимозаменяем с 504 00: другая вязкость и другой класс.' },
    { id: 'VW50900', label: 'VW 509 00', role: 'oem', family: 'VW', ash: ASH_MID, hths: HTHS_LOW, visc: ['0W-20'], drain: 'long',
      what: 'Дизельный аналог 508 00: HTHS 2.6–2.9, только 0W-20.' },
    { id: 'VW51100', label: 'VW 511 00', role: 'oem', family: 'VW', ash: ASH_MID, hths: HTHS_MID, drain: 'long',
      what: 'Новый LongLife VAG с пониженным HTHS для моторов последних поколений.' },

    // ── BMW ──
    { id: 'BMWLL98',   label: 'BMW LL-98',    role: 'oem', family: 'BMW', ash: ASH_FULL, hths: HTHS_HIGH,
      what: 'Longlife-98: полнозольное, HTHS ≥ 3.5, моторы после 1998.' },
    { id: 'BMWLL01',   label: 'BMW LL-01',    role: 'oem', family: 'BMW', ash: ASH_FULL, hths: HTHS_HIGH, drain: 'long',
      what: 'Longlife-01: полнозольное с увеличенным интервалом. Моторы БЕЗ сажевого фильтра.' },
    { id: 'BMWLL01FE', label: 'BMW LL-01 FE', role: 'oem', family: 'BMW', ash: ASH_FULL, hths: HTHS_MID, drain: 'long',
      what: 'Longlife-01 FE: пониженный HTHS 2.9–3.5. НЕ заменяет LL-01 — подходит не всем моторам, только тем, где завод его указал.' },
    { id: 'BMWLL04',   label: 'BMW LL-04',    role: 'oem', family: 'BMW', ash: ASH_MID, hths: HTHS_HIGH, drain: 'long',
      what: 'Longlife-04: среднезольное при HTHS ≥ 3.5. Обязательно для моторов с сажевым фильтром.' },
    { id: 'BMWLL12FE', label: 'BMW LL-12 FE', role: 'oem', family: 'BMW', ash: ASH_LOW, hths: HTHS_MID, drain: 'long',
      what: 'Longlife-12 FE: малозольное 0W-30 с пониженным HTHS для дизелей BMW.' },
    { id: 'BMWLL14FE', label: 'BMW LL-14 FE+', role: 'oem', family: 'BMW', ash: ASH_MID, hths: HTHS_LOW, visc: ['0W-20'], drain: 'long',
      what: 'HTHS 2.6–2.9, 0W-20. Только для моторов, где BMW его прямо требует.' },
    { id: 'BMWLL17FE', label: 'BMW LL-17 FE+', role: 'oem', family: 'BMW', ash: ASH_MID, hths: HTHS_LOW, visc: ['0W-20'], drain: 'long',
      what: 'Развитие LL-14 FE+: HTHS 2.6–2.9, 0W-20.' },

    // ── Renault-Nissan ──
    { id: 'RN0700', label: 'RN 0700', role: 'oem', family: 'RN', ash: ASH_FULL, hths: HTHS_MID,
      what: 'Базовый допуск Renault: бензин и атмосферный дизель, полнозольное. Допускает и A3/B4, и A5/B5 — сам по себе вязкость не определяет.' },
    { id: 'RN0710', label: 'RN 0710', role: 'oem', family: 'RN', ash: ASH_FULL, hths: HTHS_HIGH,
      what: 'Усиленный RN0700 для турбодизелей без сажевого фильтра: полнозольное, HTHS ≥ 3.5.' },
    { id: 'RN0720', label: 'RN 0720', role: 'oem', family: 'RN', ash: ASH_LOW, hths: HTHS_HIGH,
      what: 'ACEA C4: малозольное (≤0.5%) для дизелей dCi с сажевым фильтром. Полнозольные RN0700/0710 сюда лить нельзя.' },
    { id: 'RN17',    label: 'RN 17',   role: 'oem', family: 'RN', ash: ASH_MID, hths: HTHS_MID,
      what: 'Новое поколение допусков Renault для моторов Euro 6.' },
    { id: 'VAZ',     label: 'АвтоВАЗ', role: 'oem', family: 'VAZ', ash: null, hths: null,
      what: 'Одобрение АвтоВАЗа. Подтверждает пригодность для моторов Лады, физику масла не задаёт.' },

    // ── PSA / Stellantis ──
    { id: 'PSAB712290', label: 'PSA B71 2290', role: 'oem', family: 'PSA', ash: ASH_MID, hths: HTHS_MID,
      what: 'ACEA C2: среднезольное с пониженным HTHS для дизелей PSA с сажевым фильтром (FAP).' },
    { id: 'PSAB712294', label: 'PSA B71 2294', role: 'oem', family: 'PSA', ash: ASH_MID, hths: HTHS_HIGH,
      what: 'Среднезольное с HTHS ≥ 3.5 (уровень C3) для моторов PSA.' },
    { id: 'PSAB712295', label: 'PSA B71 2295', role: 'oem', family: 'PSA', ash: ASH_FULL, hths: HTHS_HIGH,
      what: 'Старый полнозольный допуск PSA для моторов до 1998.' },
    { id: 'PSAB712296', label: 'PSA B71 2296', role: 'oem', family: 'PSA', ash: ASH_FULL, hths: HTHS_HIGH,
      what: 'Полнозольное A3/B4 для бензиновых PSA без сажевого фильтра.' },
    { id: 'PSAB712297', label: 'PSA B71 2297', role: 'oem', family: 'PSA', ash: ASH_MID, hths: HTHS_HIGH,
      what: 'Среднезольное (уровень C3) для бензиновых PSA Euro 5+.' },
    { id: 'PSAB712293', label: 'PSA B71 2293', role: 'oem', family: 'PSA', ash: ASH_FULL, hths: HTHS_HIGH,
      what: 'Полнозольное для моторов PSA среднего возраста.' },
    { id: 'PSAB712312', label: 'PSA B71 2312', role: 'oem', family: 'PSA', ash: ASH_MID, hths: HTHS_MID,
      what: 'Современный допуск Stellantis уровня C2 для моторов с сажевым фильтром.' },

    // ── GM / Opel ──
    { id: 'GMLLA025',  label: 'GM-LL-A-025', role: 'oem', family: 'GM', ash: ASH_FULL, hths: HTHS_HIGH, drain: 'long',
      what: 'Полнозольное (A3) для бензиновых GM/Opel с увеличенным интервалом.' },
    { id: 'GMLLB025',  label: 'GM-LL-B-025', role: 'oem', family: 'GM', ash: ASH_FULL, hths: HTHS_HIGH, drain: 'long',
      what: 'Полнозольное (B3/B4) для дизелей GM/Opel без сажевого фильтра.' },
    { id: 'GMDEXOS2',  label: 'GM dexos2',   role: 'oem', family: 'GM', ash: ASH_MID, hths: HTHS_HIGH, drain: 'long',
      what: 'Универсальный европейский допуск GM уровня C3: среднезольное при HTHS ≥ 3.5, совместимо с сажевым фильтром.' },
    { id: 'GMDEXOS1',  label: 'GM dexos1',   role: 'oem', family: 'GM', ash: null, hths: HTHS_MID, visc: ['0W-20', '5W-30'],
      what: 'Американский допуск GM на базе ILSAC: только маловязкие бензиновые масла. С dexos2 не взаимозаменяем.' },
    { id: 'GMDEXOS1GEN3', label: 'GM dexos1 Gen 3', role: 'oem', family: 'GM', ash: null, hths: HTHS_MID, visc: ['0W-20', '5W-30'],
      what: 'Актуальная версия dexos1 с защитой от LSPI.' },
    { id: 'GMDEXOS1GEN2', label: 'GM dexos1 Gen 2', role: 'oem', family: 'GM', ash: null, hths: HTHS_MID, visc: ['0W-20', '5W-30'],
      what: 'Предыдущая версия dexos1. С dexos2 не взаимозаменяема.' },
    { id: 'GMDEXOSD',  label: 'GM dexosD',  role: 'oem', family: 'GM', ash: ASH_MID, hths: HTHS_MID,
      what: 'Дизельный допуск GM уровня C2/C3 для моторов с сажевым фильтром.' },
    { id: 'OPELOV0401547', label: 'OPEL OV0401547', role: 'oem', family: 'GM', ash: ASH_MID, hths: HTHS_HIGH,
      what: 'Допуск Opel после перехода к Stellantis, преемник dexos2 (уровень C3).' },

    // ── Ford ──
    { id: 'FORDWSSM2C913A', label: 'Ford WSS-M2C913-A', role: 'oem', family: 'FORD', ash: ASH_FULL, hths: HTHS_MID,
      what: 'Ford на базе ACEA A1/B1: пониженный HTHS. Ранняя ступень серии 913.' },
    { id: 'FORDWSSM2C913B', label: 'Ford WSS-M2C913-B', role: 'oem', family: 'FORD', ash: ASH_FULL, hths: HTHS_MID,
      what: 'Ford на базе ACEA A5/B5, HTHS 2.9–3.5. Заменяет 913-A.' },
    { id: 'FORDWSSM2C913C', label: 'Ford WSS-M2C913-C', role: 'oem', family: 'FORD', ash: ASH_FULL, hths: HTHS_MID,
      what: 'Ford A5/B5 с повышенной стойкостью к окислению. Заменяет 913-B.' },
    { id: 'FORDWSSM2C913D', label: 'Ford WSS-M2C913-D', role: 'oem', family: 'FORD', ash: ASH_FULL, hths: HTHS_MID,
      what: 'Актуальная ступень серии 913: A5/B5, HTHS 2.9–3.5, совместимо с биодизелем. Полнозольное A3/B4 сюда лить нельзя — мотор рассчитан на низкий HTHS.' },
    { id: 'FORDWSSM2C917A', label: 'Ford WSS-M2C917-A', role: 'oem', family: 'FORD', ash: ASH_FULL, hths: HTHS_HIGH,
      what: 'Полнозольное A3/B4 для дизелей 1.8 TDCi. Единственная «густая» спецификация в линейке Ford.' },
    { id: 'FORDWSSM2C934B', label: 'Ford WSS-M2C934-B', role: 'oem', family: 'FORD', ash: ASH_LOW, hths: HTHS_HIGH,
      what: 'Малозольное (уровень C1) для дизелей Ford с сажевым фильтром.' },
    { id: 'FORDWSSM2C948B', label: 'Ford WSS-M2C948-B', role: 'oem', family: 'FORD', ash: ASH_MID, hths: HTHS_LOW, visc: ['0W-20'],
      what: 'HTHS 2.6–2.9, 0W-20 для моторов EcoBoost.' },
    { id: 'FORDWSSM2C950A', label: 'Ford WSS-M2C950-A', role: 'oem', family: 'FORD', ash: ASH_MID, hths: HTHS_MID,
      what: 'Среднезольное уровня C2 для моторов Ford с сажевым фильтром.' },

    // ── Jaguar Land Rover / Volvo / Porsche ──
    { id: 'STJLR035003', label: 'JLR STJLR.03.5003', role: 'oem', family: 'JLR', ash: ASH_FULL, hths: HTHS_MID,
      what: 'Jaguar Land Rover на базе ACEA A5/B5: HTHS 2.9–3.5.' },
    { id: 'STJLR035004', label: 'JLR STJLR.03.5004', role: 'oem', family: 'JLR', ash: ASH_LOW, hths: HTHS_MID,
      what: 'JLR уровня C1: малозольное для дизелей с сажевым фильтром.' },
    { id: 'STJLR035005', label: 'JLR STJLR.03.5005', role: 'oem', family: 'JLR', ash: ASH_MID, hths: HTHS_HIGH,
      what: 'JLR уровня C3: среднезольное при HTHS ≥ 3.5.' },
    { id: 'STJLR035006', label: 'JLR STJLR.03.5006', role: 'oem', family: 'JLR', ash: ASH_MID, hths: HTHS_LOW, visc: ['0W-20'],
      what: 'JLR 0W-20 с HTHS 2.6–2.9 для моторов Ingenium.' },
    { id: 'STJLR035007', label: 'JLR STJLR.03.5007', role: 'oem', family: 'JLR', ash: ASH_MID, hths: HTHS_MID,
      what: 'Актуальный допуск JLR для моторов Ingenium.' },
    { id: 'STJLR',       label: 'Jaguar STJLR', role: 'oem', family: 'JLR', ash: null, hths: null,
      what: 'Допуск Jaguar Land Rover без указания ступени — читается только как «производитель одобрил».' },
    { id: 'PORSCHEA40', label: 'Porsche A40', role: 'oem', family: 'PORSCHE', ash: ASH_FULL, hths: HTHS_HIGH,
      what: 'Полнозольное с HTHS ≥ 3.5 для атмосферных и турбо Porsche без сажевого фильтра.' },
    { id: 'PORSCHEC30', label: 'Porsche C30', role: 'oem', family: 'PORSCHE', ash: ASH_MID, hths: HTHS_HIGH,
      what: 'Среднезольное (уровень C3) для Porsche с сажевым фильтром.' },
    { id: 'PORSCHEC20', label: 'Porsche C20', role: 'oem', family: 'PORSCHE', ash: ASH_MID, hths: HTHS_LOW, visc: ['0W-20'],
      what: 'Porsche 0W-20 с HTHS 2.6–2.9.' },
    { id: 'PORSCHEC40', label: 'Porsche C40', role: 'oem', family: 'PORSCHE', ash: ASH_MID, hths: HTHS_HIGH,
      what: 'Современный среднезольный допуск Porsche.' },
    { id: 'VCC95200377', label: 'Volvo VCC 95200377', role: 'oem', family: 'VOLVO', ash: ASH_MID, hths: HTHS_MID,
      what: 'Собственный допуск Volvo для моторов Drive-E.' },
    { id: 'VCCRBS02AE', label: 'Volvo VCC RBS0-2AE', role: 'oem', family: 'VOLVO', ash: ASH_MID, hths: HTHS_LOW, visc: ['0W-20'],
      what: 'Volvo 0W-20 с HTHS 2.6–2.9 для моторов Drive-E последних поколений.' },
    { id: 'MS6395',     label: 'Chrysler MS-6395', role: 'oem', family: 'FIAT', ash: null, hths: HTHS_MID,
      what: 'Заводская спецификация Chrysler/Dodge/Jeep на базе API SN/ILSAC.' },

    // ── Fiat / Stellantis ──
    { id: 'FIAT955535H2', label: 'FIAT 9.55535-H2', role: 'oem', family: 'FIAT', ash: ASH_FULL, hths: HTHS_HIGH,
      what: 'Полнозольное A3/B4 для бензиновых Fiat.' },
    { id: 'FIAT955535M2', label: 'FIAT 9.55535-M2', role: 'oem', family: 'FIAT', ash: ASH_FULL, hths: HTHS_HIGH,
      what: 'Полнозольное A3/B4 для нагруженных бензиновых Fiat.' },
    { id: 'FIAT955535N2', label: 'FIAT 9.55535-N2', role: 'oem', family: 'FIAT', ash: ASH_FULL, hths: HTHS_HIGH,
      what: 'Полнозольное A3/B4 для дизелей Fiat без сажевого фильтра.' },
    { id: 'FIAT955535Z2', label: 'FIAT 9.55535-Z2', role: 'oem', family: 'FIAT', ash: ASH_FULL, hths: HTHS_HIGH,
      what: 'Полнозольное A3/B4 общего назначения для Fiat.' },
    { id: 'FIAT955535S1', label: 'FIAT 9.55535-S1', role: 'oem', family: 'FIAT', ash: ASH_MID, hths: HTHS_MID,
      what: 'Среднезольное уровня C2 для дизелей Fiat с сажевым фильтром.' },
    { id: 'FIAT955535S2', label: 'FIAT 9.55535-S2', role: 'oem', family: 'FIAT', ash: ASH_MID, hths: HTHS_HIGH,
      what: 'Среднезольное уровня C3 для моторов Fiat с сажевым фильтром.' },
    { id: 'FIAT955535S3', label: 'FIAT 9.55535-S3', role: 'oem', family: 'FIAT', ash: ASH_MID, hths: HTHS_HIGH,
      what: 'Среднезольное уровня C3, современная ступень Fiat.' },
    { id: 'FIAT955535G1', label: 'FIAT 9.55535-G1', role: 'oem', family: 'FIAT', ash: ASH_FULL, hths: HTHS_MID,
      what: 'Топливосберегающее A5/B5 для бензиновых Fiat.' },
    { id: 'FIAT955535GH2', label: 'FIAT 9.55535-GH2', role: 'oem', family: 'FIAT', ash: ASH_FULL, hths: HTHS_HIGH,
      what: 'Полнозольное A3/B4 нового поколения Fiat.' },
    { id: 'FIAT955535CR1', label: 'FIAT 9.55535-CR1', role: 'oem', family: 'FIAT', ash: ASH_MID, hths: HTHS_MID,
      what: 'Современное среднезольное масло Fiat пониженной вязкости.' },
];

// Индекс по нормализованному id + по нормализованной подписи.
const SPEC_INDEX = (() => {
    const m = new Map();
    for (const s of SPECS) {
        m.set(s.id, s);
        const byLabel = normSpec(s.label);
        if (!m.has(byLabel)) m.set(byLabel, s);
    }
    return m;
})();

// Запасные правила для строк, которых нет в справочнике поимённо: серии Ford
// и Fiat насчитывают десятки ступеней, все перечислять смысла нет — семейство
// и марка важнее точной ступени.
const FALLBACK_RULES = [
    { re: /^FORDWSSM2C\d/,  family: 'FORD', label: 'Ford WSS-M2C…',
      what: 'Заводская спецификация Ford. Точная ступень неизвестна — учитываем как одобрение марки.' },
    { re: /^FIAT9\d/,       family: 'FIAT', label: 'FIAT 9.55535-…',
      what: 'Заводская спецификация Fiat. Точная ступень неизвестна — учитываем как одобрение марки.' },
    { re: /^STJLR/,         family: 'JLR',  label: 'JLR STJLR…',
      what: 'Заводская спецификация Jaguar Land Rover. Точная ступень неизвестна.' },
    { re: /^MB\d/,          family: 'MB',   label: 'MB …',
      what: 'Заводской допуск Mercedes-Benz, ступень вне справочника.' },
    { re: /^VW\d/,          family: 'VW',   label: 'VW …',
      what: 'Заводской допуск VAG, ступень вне справочника.' },
    { re: /^BMWLL/,         family: 'BMW',  label: 'BMW Longlife…',
      what: 'Заводской допуск BMW, ступень вне справочника.' },
    { re: /^PSAB\d/,        family: 'PSA',  label: 'PSA B71…',
      what: 'Заводской допуск PSA/Stellantis, ступень вне справочника.' },
    { re: /^RN\d/,          family: 'RN',   label: 'Renault RN…',
      what: 'Заводской допуск Renault, ступень вне справочника.' },
];

// exactOnly: искать только поимённо, без запасных правил по семейству.
// Нужно при разборе склеенных строк: там мы перебираем варианты префикса, и
// правило «всё, что начинается на VW+цифра, — допуск VAG» приняло бы мусорный
// вариант «VW 502 505 00» раньше правильного «VW 505 00».
export function findSpec(raw, exactOnly = false) {
    const key0 = normSpec(raw);
    if (!key0) return null;
    const key = SPEC_ALIASES[key0] || key0;
    const hit = SPEC_INDEX.get(key);
    if (hit) return hit;
    if (exactOnly) return null;
    for (const rule of FALLBACK_RULES) {
        if (rule.re.test(key)) {
            return { id: key, label: String(raw).trim(), role: 'oem', family: rule.family,
                     ash: null, hths: null, what: rule.what, approximate: true };
        }
    }
    return null;
}

// ── Строки, которые вообще не про моторное масло ─────────────────────────────
// У части машин в car_approvals лежит паспорт АНТИФРИЗА: «VW G12/G12+»,
// «ASTM D 3306», «NATO S759», «JOHN DEERE H 24 B1/C1». Источник перепутал
// продукт целиком. Такие строки нужно опознавать явно, иначе они молча
// попадают в «неизвестные» и создают ощущение, что справочник неполон.

const NON_OIL_RE = new RegExp([
    '\\bG\\s*1[123]\\b', 'TL\\s*774', 'ASTM\\s*D\\s*(3306|4985)', '\\bD\\s*4985\\b',
    'SAE\\s*J10[0-9]{2}', 'NATO\\s*S\\s*759', 'BS\\s*6580', 'AFNOR', 'JIS\\s*K\\s*2234',
    'UNE\\s*263', '\\bHEFT\\b', 'QL\\s*1301', '\\bESE\\b', 'M97B', '\\bMACK\\b',
    'CUMMINS', 'JOHN\\s*DEERE', 'LEYLAND', '\\bMAN\\s*324\\b', '\\bMB\\s*32[56]\\b',
    'антифриз', 'coolant', 'GM\\s*1899', 'AS\\s*2108', 'GB\\s*297\\d\\d',
    'CUNA\\s*NC', 'PN-C\\s*40007', '[ÖO]NORM', '\\bLC-\\d\\d\\b', 'GS\\s*94000',
    'SANS\\s*1251', 'DFS\\s*93K', '\\bTESLA\\b', 'MWM',
    // тормозная жидкость
    'FMVSS\\s*116', 'ISO\\s*4925', 'SAE\\s*J170\\d', '\\bDOT\\s*[345]\\b',
].join('|'), 'i');

// Трансмиссионные спецификации — тоже не про моторное масло.
// Трансмиссионные и АКПП-спецификации: в car_answers двигателя им не место,
// но у части машин источник подсунул паспорт ATF или масла для робота.
const GEAR_RE = new RegExp([
    '\\bAPI\\s*GL\\s*-?\\s*[45]\\b', '\\bMT-1\\b', '\\bMAN\\s*342\\b',
    'DEXRON', 'MERCON', 'MATIC', '\\bATF\\b', '\\bDCTF?\\b', 'JWS\\s*33',
    'DSIH', 'LT\\s*71141', 'TYK5', 'WSS-M2C922',
].join('|'), 'i');

// ── Спецификации грузовой техники ────────────────────────────────────────────
// У части машин в списке лежит паспорт масла для магистральных тягачей:
// ACEA E7, API CI-4, Volvo VDS-3, MAN M3275, DEUTZ DQC, CAT ECF. К легковому
// мотору это отношения не имеет — другой класс масла целиком.
// API CF сюда НЕ входит: его печатают и на легковых маслах.

const HEAVY_DUTY_RE = new RegExp([
    '\\bACEA\\s*E\\d', '\\bAPI\\s*C[HIJK]\\s*-\\s*4\\b', '\\bMAN\\s*M?\\s*3[2-9]\\d{2}',
    'VOLVO\\s*VDS', '\\bRLD\\s*-?\\s*\\d', '\\bMTU\\b', '\\bDEUTZ\\b', 'CAT\\s*ECF',
    '\\bMB\\s*228\\.', 'CUMMINS\\s*CES', 'JASO\\s*DH', '\\bSCANIA\\b', 'ZF\\s*TE-ML',
    '\\bALLISON\\b', 'MACK\\s*EO',
    'КАМАЗ', 'ЛИАЗ', 'АВТОДИЗЕЛЬ', 'ЯМЗ', '\\bМАЗ\\b',
].join('|'), 'i');

// Категория строки, которая вообще не про моторное масло легковой машины.
function nonEngineKind(raw) {
    const text = String(raw || '');
    // «ZF ТЕ-ML» набрано русскими Т и Е, а «ПАО КамАЗ» — целиком кириллицей.
    // Поэтому проверяем обе формы: исходную и приведённую к латинице.
    const latin = text.replace(/[АВЕКМНОРСТУХ]/gi,
        (c) => CYR_LOOKALIKE[c.toUpperCase()] || c);
    const hit = (re) => re.test(text) || re.test(latin);
    if (hit(NON_OIL_RE)) return 'coolant';
    if (hit(GEAR_RE)) return 'gear';
    if (hit(HEAVY_DUTY_RE)) return 'heavy';
    return null;
}

// Разбирает список строк допусков в плоский список { raw, parts, specs }.
// Составные строки («VW 502 00/505 00») дают несколько specs при одном raw —
// в UI такая строка остаётся одной плашкой, но физику берём от обеих частей.
export function parseApprovals(list) {
    const out = [];
    for (const raw of (list || [])) {
        const text = String(raw || '').trim();
        if (!text) continue;
        const kind = nonEngineKind(text);
        if (kind) { out.push({ raw: text, parts: [text], specs: [], nonOil: true, kind }); continue; }
        const parts = splitCompound(text);
        const specs = parts.map(p => findSpec(p)).filter(Boolean);
        out.push({ raw: text, parts, specs, nonOil: false, kind: null });
    }
    return out;
}

// ── Второй источник: названия продуктов Motul ────────────────────────────────
// Motul отвечает на запрос по конкретной модификации, а не отдаёт паспорт
// масла целиком, поэтому его список — независимая проверка для car_approvals.
// Линейка SPECIFIC называет допуск прямо в имени продукта («SPECIFIC 504 00
// 507 00 5W-30»), этим и пользуемся. Паттерны применяются ТОЛЬКО к названиям
// продуктов: в произвольном тексте «504 00» значило бы что угодно.

const PRODUCT_SPEC_PATTERNS = [
    [/LL[\s-]*01\s*FE/i,        'BMW LL-01 FE'],
    [/LL[\s-]*12\s*FE/i,        'BMW LL-12 FE'],
    [/LL[\s-]*14\s*FE/i,        'BMW LL-14 FE+'],
    [/LL[\s-]*17\s*FE/i,        'BMW LL-17 FE+'],
    [/LL[\s-]*04/i,             'BMW LL-04'],
    [/LL[\s-]*01/i,             'BMW LL-01'],
    [/\bdexos\s*1\s*GEN\s*3/i,  'GM dexos1 Gen 3'],
    [/\bdexos\s*2\b/i,          'GM dexos2'],
    [/\bdexos\s*1\b/i,          'GM dexos1'],
    [/\b229[\s.]*52\b/,         'MB 229.52'],
    [/\b229[\s.]*51\b/,         'MB 229.51'],
    [/\b229[\s.]*31\b/,         'MB 229.31'],
    [/\b229[\s.]*61\b/,         'MB 229.61'],
    [/\b229[\s.]*6\b/,          'MB 229.6'],
    [/\b229[\s.]*5\b/,          'MB 229.5'],
    [/\b229[\s.]*3\b/,          'MB 229.3'],
    [/\b226[\s.]*5\b/,          'MB 226.5'],
    [/\b0720\b/,                'RN 0720'],
    [/\b0710\b/,                'RN 0710'],
    [/\b0700\b/,                'RN 0700'],
    [/\bSPECIFIC\s+17\b/i,      'RN 17'],
    [/\b913\s*[A-D]\b/i,        'Ford WSS-M2C913-D'],
    [/\b948\s*B\b/i,            'Ford WSS-M2C948-B'],
    [/\b934\s*B\b/i,            'Ford WSS-M2C934-B'],
    [/\b950\s*A\b/i,            'Ford WSS-M2C950-A'],
    [/\bA40\b/,                 'Porsche A40'],
    [/\bC30\b/,                 'Porsche C30'],
    [/\b2290\b/,                'PSA B71 2290'],
    [/\b2293\b/,                'PSA B71 2293'],
    [/\b2296\b/,                'PSA B71 2296'],
    [/\b2297\b/,                'PSA B71 2297'],
    [/\b2312\b/,                'PSA B71 2312'],
    [/\bRBS0[\s-]*2AE\b/i,      'Volvo VCC RBS0-2AE'],
];

// Все допуска VAG вида «5xx yy» — в названии их бывает сразу несколько
// («SPECIFIC 506 01 506 00 503 00 0W-30»), поэтому ищем глобально.
const VAG_CODE_RE = /\b(5\d\d)[\s.]+(0\d)\b/g;

export function specsFromProductNames(names) {
    const out = new Set();
    for (const name of (names || [])) {
        const text = String(name || '');
        if (!text) continue;
        for (const [re, label] of PRODUCT_SPEC_PATTERNS) if (re.test(text)) out.add(label);
        VAG_CODE_RE.lastIndex = 0;
        let m;
        while ((m = VAG_CODE_RE.exec(text))) {
            const label = `VW ${m[1]} ${m[2]}`;
            if (findSpec(label, true)) out.add(label);
        }
    }
    return [...out];
}

// ── Марка машины → семейства допусков, обязательные для неё ──────────────────

export function makeFamilies(make) {
    const m = String(make || '').toUpperCase().replace(/[\s\-_.]/g, '');
    if (!m) return [];
    const out = [];
    for (const [family, makes] of Object.entries(FAMILY_MAKES)) {
        if (makes.some(x => {
            const k = x.replace(/[\s\-_.]/g, '');
            return m === k || m.startsWith(k) || k.startsWith(m);
        })) out.push(family);
    }
    return out;
}

// ── Физический профиль набора допусков ───────────────────────────────────────
// Берём САМОЕ СТРОГОЕ требование из набора. Обоснование в docs/DOPUSKI.md:
// риск несимметричен. Малозольное масло в моторе без сажевого фильтра — потеря
// части моющего пакета (обратимо, стоит ресурса масла). Полнозольное в моторе
// с сажевым фильтром — забитый фильтр (необратимо, стоит фильтра). Под
// неопределённостью выбираем сторону с обратимой ошибкой.

export function profileOfSpecs(specs) {
    let ash = null, ashAllowed = null, hthsMin = null, hthsMax = null, visc = null;
    for (const s of specs) {
        if (s.ash != null) {
            ash = ash == null ? s.ash : Math.min(ash, s.ash);
            // Сколько золы мотору РАЗРЕШЕНО: самый мягкий из его же допусков.
            ashAllowed = ashAllowed == null ? s.ash : Math.max(ashAllowed, s.ash);
        }
        if (s.hths) {
            hthsMin = hthsMin == null ? s.hths[0] : Math.max(hthsMin, s.hths[0]);
            hthsMax = hthsMax == null ? s.hths[1] : Math.max(hthsMax, s.hths[1]);
        }
        if (s.visc) visc = visc ? [...new Set([...visc, ...s.visc])] : [...s.visc];
    }
    return { ash, ashAllowed, hthsMin, hthsMax, visc };
}

// Ниже какого HTHS масло для этого мотора завод не одобрял НИ В ОДНОМ из своих
// допусков. Берём минимум по родным: если Renault под RN0700 разрешает A5/B5
// (HTHS 2.9–3.5), то масло A5/B5 для этого мотора одобрено — резать его из-за
// того, что рядом в списке лежит более строгий RN0710, неправильно.
function hthsGateFor(nativeSpecs) {
    let lo = null;
    for (const s of nativeSpecs) {
        if (!s.hths) continue;
        lo = lo == null ? s.hths[0] : Math.min(lo, s.hths[0]);
    }
    return lo;
}

// ── Нужно ли вообще ограничивать зольность ───────────────────────────────────
// Зола вредна ровно одним: она забивает сажевый фильтр. Если фильтра нет,
// полнозольное масло ничем не хуже — и резать по золе бессмысленно.
//
// Раньше предел брался как «самый строгий допуск из списка», и это было
// ошибкой: список — объединение паспортов, туда попадает мало- и
// среднезольное от чужих масел. Renault Duster 2012 (атмосферный бензиновый,
// фильтра нет) получал предел 0.8% и терял все полнозольные масла, включая
// те, что Renault для него и одобрил.
//
// Надёжный признак фильтра — не допуск, а сама машина: дизели получили DPF
// с Euro 5, бензиновые — GPF с Euro 6d. Плюс случай, когда марка сама не
// разрешает ничего полнозольного.

function ashGateFor(nativeSpecs, ctx) {
    const year = Number(ctx.yearFrom) || 0;
    const diesel = isDieselLike(ctx.fuelType);
    if (diesel && year >= 2009) return ASH_MID;      // Euro 5: сажевый фильтр
    if (!diesel && year >= 2018) return ASH_MID;     // Euro 6d: бензиновый GPF

    // Родные допуска марки, ни один из которых не разрешает полнозольное, —
    // значит завод полнозольное для этого мотора не допускает вовсе.
    const withAsh = nativeSpecs.filter(s => s.ash != null);
    if (withAsh.length && withAsh.every(s => s.ash <= ASH_MID)) return ASH_MID;

    return null;
}

// Локальная проверка топлива: тянуть fuel.js сюда незачем, нужен один признак.
function isDieselLike(fuelType) {
    const ft = String(fuelType == null ? '' : fuelType).trim();
    return ft === '05' || ft === '06' || /дизел|diesel/i.test(ft);
}

// Профиль → класс ACEA, под который отбирать масло. Нужен, чтобы «требуемый
// класс» в UI и подбор опирались на один и тот же вывод: раньше класс брался
// сканированием сырых строк, и на Kia Rio получалось «нужен A5/B5» (HTHS
// 2.9–3.5) одновременно с профилем HTHS ≥ 3.5 — два взаимоисключающих ответа.
export function aceaClassOfProfile(profile) {
    if (!profile) return null;
    // Без сажевого фильтра класс задаётся тем, что мотору РАЗРЕШЕНО, иначе —
    // пределом. Считать по «самому строгому допуску в списке» нельзя: у
    // бензинового Дастера так получался класс C2, которого Renault не требует.
    const ash = profile.ashGate != null ? profile.ashGate
        : profile.ashAllowed != null ? profile.ashAllowed
        : profile.ash;
    if (ash == null) return null;
    const thick = profile.hthsMin == null || profile.hthsMin >= 3.5;
    if (ash <= ASH_LOW) return thick ? 'C4' : 'C1';
    if (ash <= ASH_MID) return thick ? 'C3' : 'C2';
    return thick ? 'A3B4' : 'A5B5';
}

export const sapsLabel = (ash) =>
    ash == null ? '—' : ash <= ASH_LOW ? 'малозольное' : ash <= ASH_MID ? 'среднезольное' : 'полнозольное';

// Профиль масла из его собственного паспорта. Правило то же — самое строгое:
// если масло получило допуск C3, оно физически прошло замер по золе ≤0.8%,
// сколько бы полнозольных строк ни стояло рядом в маркетинговом списке.
// Гарантированный «пол» по HTHS у масла — САМАЯ ВЫСОКАЯ из заявленных нижних
// границ, а не самая низкая. Liqui Moly Top Tec заявляет и C2 (2.9–3.5), и C3
// (≥3.5); раз оно прошло C3, замер HTHS у него ≥3.5, и строка C2 — маркетинг.
// Брать минимум значило бы блокировать все нормальные C3-масла.
export function oilProfile(oilApprovals) {
    const parsed = parseApprovals(oilApprovals);
    const specs = parsed.flatMap(p => p.specs);
    return { ...profileOfSpecs(specs), specs };
}

// ── Конфликты внутри набора ──────────────────────────────────────────────────
// Две оси, по которым допуска физически несовместимы. Наличие конфликта в
// списке МАШИНЫ — доказательство того, что это объединение паспортов масел,
// а не требования конкретного мотора.

export function findConflicts(items) {
    const conflicts = [];

    const byAsh = { full: [], mid: [], low: [] };
    for (const it of items) {
        for (const s of it.specs) {
            if (s.ash == null) continue;
            const bucket = s.ash <= ASH_LOW ? 'low' : s.ash <= ASH_MID ? 'mid' : 'full';
            if (!byAsh[bucket].includes(s.label)) byAsh[bucket].push(s.label);
        }
    }
    const lean = [...byAsh.mid, ...byAsh.low];
    if (byAsh.full.length && lean.length) {
        conflicts.push({
            axis: 'saps',
            hard: true,
            a: byAsh.full, b: lean,
            note: 'В списке одновременно полнозольные и мало/среднезольные допуска. ' +
                  'Одно масло не может удовлетворять обоим — значит список собран из паспортов разных масел.',
        });
    }

    const byHths = { high: [], mid: [], low: [] };
    for (const it of items) {
        for (const s of it.specs) {
            if (!s.hths) continue;
            const bucket = s.hths[0] >= 3.5 ? 'high' : s.hths[1] <= 2.9 ? 'low' : 'mid';
            if (!byHths[bucket].includes(s.label)) byHths[bucket].push(s.label);
        }
    }
    if (byHths.high.length && byHths.low.length) {
        conflicts.push({
            axis: 'hths',
            hard: true,
            a: byHths.high, b: byHths.low,
            note: 'В списке есть допуска и на густое (HTHS ≥ 3.5), и на сверхтекучее (HTHS < 2.9) масло. ' +
                  'Это взаимоисключающие вязкости.',
        });
    }

    return conflicts;
}

const NON_ENGINE_WHAT = {
    coolant: 'Это допуск охлаждающей жидкости, а не моторного масла.',
    gear:    'Это трансмиссионная спецификация, а не допуск моторного масла.',
    heavy:   'Это допуск масла для грузовой техники.',
};

const NON_ENGINE_WHY = {
    coolant: 'Спецификация охлаждающей жидкости, а не масла: источник уехал не в тот продукт. ' +
             'На подбор масла не влияет вообще — строку можно смело удалить.',
    gear:    'Трансмиссионная спецификация (масло в коробку или мост). К подбору масла в ДВС ' +
             'отношения не имеет.',
    heavy:   'Спецификация масла для грузовой техники — тягачей и спецтехники. Это другой класс ' +
             'масла целиком, к легковому мотору отношения не имеет и в подборе не участвует.',
};

// ── Ранги значимости ─────────────────────────────────────────────────────────
// Вес — это цена ошибки, а не «важность» в абстрактном смысле.

export const RANKS = {
    critical:  { weight: 100, label: 'ключевой',       color: 'red'   },
    important: { weight:  40, label: 'важный',         color: 'green' },
    minor:     { weight:  12, label: 'второстепенный', color: 'blue'  },
    info:      { weight:   2, label: 'справочный',     color: 'grey'  },
    noise:     { weight:   0, label: 'шум',            color: 'grey'  },
    conflict:  { weight:   0, label: 'противоречие',   color: 'amber' },
};

// ── Главный разбор: список допусков машины → что из него реально значит ──────
//
// ctx: { make, fuelType, yearFrom, evidence }
//   evidence — допуска, подтверждённые вторым независимым источником (у нас
//   это продукты Motul для конкретной машины). Motul отвечает на запрос по
//   VIN-подобной модификации, поэтому его список короче и ближе к правде.
//
// Возвращает:
//   items      — по одной записи на исходную строку, с рангом и текстом подсказки
//   profile    — { ash, hthsMin, visc } — что мотору реально нужно
//   conflicts  — найденные физические противоречия
//   confidence — 'high' | 'medium' | 'low': насколько можно опираться на profile

export function analyzeCarApprovals(carApprovals, ctx = {}) {
    const families = makeFamilies(ctx.make);
    const familySet = new Set(families);
    const parsed = parseApprovals(carApprovals);
    const isNative = (s) => !!(s.family && familySet.has(s.family));

    // Второй источник (продукты Motul по этой конкретной машине). Он отвечает
    // на запрос по модификации, а не отдаёт паспорт масла целиком, поэтому его
    // родные допуска считаем подтверждёнными — даже если в car_approvals их нет.
    const evidenceParsed = parseApprovals(ctx.evidence || []);
    const evidenceSpecs = evidenceParsed.flatMap(p => p.specs);
    const evidenceIds = new Set(evidenceSpecs.map(s => s.id));
    const evidenceNative = evidenceSpecs.filter(isNative);

    const conflicts = findConflicts(parsed);

    // Родные допуска — те, чьё семейство обязательно для этой марки.
    const nativeSpecs = parsed.flatMap(p => p.specs).filter(isNative);
    const confirmed = [...evidenceNative, ...nativeSpecs.filter(s => evidenceIds.has(s.id))];
    const confirmedIds = new Set(confirmed.map(s => s.id));

    // Список вообще не про масло (в базу уехал паспорт антифриза) — тогда из
    // него нельзя выводить ничего, и подбор должен идти как без допусков.
    const nonOilCount = parsed.filter(p => p.nonOil).length;
    const notOil = parsed.length >= 5 && nonOilCount >= parsed.length * 0.5;

    // Второй источник ДОПОЛНЯЕТ родные допуска, а не заменяет их. Замена была
    // ошибкой: у Renault Duster Motul предлагает масло под RN 17 (допуск для
    // моторов Euro 6), и профиль строился по нему одному — а настоящие RN0700
    // и RN0710 из списка машины выпадали из расчёта совсем.
    let profileSpecs, confidence;
    if (notOil) {
        profileSpecs = [];
        confidence = 'none';
    } else if (nativeSpecs.length || evidenceNative.length) {
        profileSpecs = [...nativeSpecs, ...evidenceNative];
        confidence = confirmed.length ? 'high' : 'medium';
    } else {
        // Родных допусков нет вовсе (японцы, корейцы) — остаются классы ACEA.
        profileSpecs = parsed.flatMap(p => p.specs).filter(s => s.role === 'acea');
        confidence = 'low';
    }
    const profile = profileOfSpecs(profileSpecs);
    // Предел по золе задаёт наличие сажевого фильтра, а не самый строгий
    // допуск в свалке. Считаем по родным допускам машины и по ней самой.
    profile.ashGate = notOil ? null : ashGateFor(nativeSpecs, ctx);
    profile.hthsGate = notOil ? null : (hthsGateFor(nativeSpecs) ?? profile.hthsMin);

    const carLabel = String(ctx.make || 'этой машины').trim();

    const items = parsed.map(p => {
        const primary = p.specs[0] || null;
        const nativeSpec = p.specs.find(isNative) || null;
        const rank = rankApproval({ p, primary, nativeSpec, profile, confirmedIds, confidence });
        return {
            raw: p.raw,
            parts: p.parts,
            label: primary ? (p.specs.length > 1 ? p.raw : primary.label) : p.raw,
            family: primary ? (primary.family || primary.role) : null,
            role: p.nonOil ? 'nonoil' : (primary ? primary.role : null),
            known: p.specs.length > 0,
            native: !!nativeSpec,
            confirmed: p.specs.some(s => confirmedIds.has(s.id)),
            rank,
            weight: RANKS[rank].weight,
            what: p.nonOil ? NON_ENGINE_WHAT[p.kind]
                : (primary ? primary.what : 'Строка не опознана справочником допусков.'),
            why: explainRank({ rank, p, primary, nativeSpec, profile, carLabel, confidence }),
            ash: primary ? primary.ash : null,
            hths: primary ? primary.hths : null,
        };
    });

    // Допуска, подтверждённые вторым источником, но отсутствующие в
    // car_approvals. Это самый ценный случай: у Skoda Citigo источник отдал
    // 29 строк без единого VW 504 00, хотя Motul на эту же модификацию
    // предлагает SPECIFIC 504 00 507 00. Такие допуска дописываем в список —
    // иначе решающего требования в подборе просто не окажется.
    const missing = [];
    const seen = new Set(parsed.flatMap(p => p.specs).map(s => s.id));
    for (const s of evidenceNative) {
        if (!seen.has(s.id) && !missing.some(m => m.id === s.id)) missing.push(s);
    }
    for (const s of missing) {
        items.push({
            raw: s.label, parts: [s.label], label: s.label,
            family: s.family, role: s.role,
            known: true, native: true, confirmed: true, fromEvidence: true,
            rank: 'critical', weight: RANKS.critical.weight,
            what: s.what,
            why: `Заводской допуск ${FAMILY_LABEL[s.family] || s.family} для ${carLabel}. ` +
                 'В списке машины его нет — источник его потерял, — но Motul предлагает масло ' +
                 'именно под него для этой модификации. Добавлен в подбор как требование.' +
                 physicsTail(s),
            ash: s.ash, hths: s.hths,
        });
    }

    const counts = {};
    for (const it of items) counts[it.rank] = (counts[it.rank] || 0) + 1;

    return {
        items, profile, conflicts, confidence, families, counts, notOil, missing,
        // Список — объединение паспортов масел, а не требования мотора
        unionSuspect: conflicts.some(c => c.hard) || countFamilies(parsed) >= 3,
        decisive: items.filter(i => i.rank === 'critical' || i.rank === 'important'),
    };
}

function countFamilies(parsed) {
    const fams = new Set();
    for (const p of parsed) for (const s of p.specs) if (s.family) fams.add(s.family);
    return fams.size;
}

function rankApproval({ p, primary, nativeSpec, profile, confirmedIds, confidence }) {
    if (p.nonOil) return 'noise';
    if (!primary) return 'noise';
    if (primary.role === 'api') return 'info';
    if (confidence === 'none') return 'noise';

    const target = nativeSpec || (primary.role === 'acea' ? primary : null);

    if (target) {
        // Несовместимая вязкость — настоящее противоречие: ни один из двух
        // допусков не перекрывает другой, выбирать приходится один.
        if (viscConflict(target, profile)) return 'conflict';
        // Менее строгая ветка того же семейства (VW 502 00 при профиле 504 00,
        // ACEA A3/B4 при профиле C3). Не противоречие: масло по строгой ветке
        // подходит и сюда, поэтому подбор идёт по строгой, а эта — фон.
        if (looserThanProfile(target, profile)) return 'minor';
    }

    // Родной допуск марки решает выбор всегда. Раньше он падал до «фонового»,
    // стоило второму источнику подтвердить хоть что-то, — и у Renault Duster
    // настоящие RN0700/RN0710 оказывались ниже дописанного RN 17.
    if (nativeSpec) return 'critical';

    if (primary.role === 'acea') {
        // Класс ACEA, совпадающий с профилем, — рабочий ориентир: под него
        // можно подобрать масло даже когда родного допуска в каталоге нет.
        if (matchesProfile(primary, profile)) return 'important';
        return 'minor';
    }

    // Чужой ОЕМ-допуск. Ноль обязательств, но косвенно говорит об уровне масла.
    return 'noise';
}

// Допуск требует масла жиже, чем профиль машины: перекрыть его «более строгим»
// нельзя — это выбор между разными вязкостями, а не ступени одной лестницы.
function viscConflict(spec, profile) {
    const gate = profile && (profile.hthsGate != null ? profile.hthsGate : profile.hthsMin);
    if (gate == null || !spec.hths) return false;
    return spec.hths[1] < gate;
}

// Допуск разрешает больше золы, чем мотору позволено. Сравниваем именно
// с пределом: если сажевого фильтра нет, предела нет, и «менее строгих»
// допусков не существует — полнозольный допуск такой же настоящий.
function looserThanProfile(spec, profile) {
    if (!profile || profile.ashGate == null || spec.ash == null) return false;
    return spec.ash > profile.ashGate;
}

function matchesProfile(spec, profile) {
    if (!profile || spec.ash == null) return false;
    if (profile.ashGate != null && spec.ash > profile.ashGate) return false;
    if (profile.ashGate == null && profile.ashAllowed != null && spec.ash > profile.ashAllowed) return false;
    if (profile.hthsMin != null && spec.hths && spec.hths[1] < profile.hthsMin) return false;
    return true;
}

// ── Текст подсказки: почему этот допуск важен или почему на него плевать ─────

function explainRank({ rank, p, primary, nativeSpec, profile, carLabel, confidence }) {
    const famLabel = primary && primary.family ? (FAMILY_LABEL[primary.family] || primary.family) : '';

    if (p.nonOil) return NON_ENGINE_WHY[p.kind] || NON_ENGINE_WHY.coolant;

    if (rank === 'critical') {
        const conf = confidence === 'high'
            ? ' Подтверждён вторым источником — рекомендацией Motul по этой конкретной машине, ' +
              'поэтому подбор опирается прежде всего на него.'
            : ' Единственный класс обязательств, который у этой машины настоящий, — по нему и подбираем.';
        return `Заводской допуск ${famLabel} — обязателен для ${carLabel}.` + conf + physicsTail(primary);
    }

    if (rank === 'important') {
        return `Класс ACEA совпадает с тем, что мотору реально нужно (${sapsLabel(profile.ashGate ?? profile.ashAllowed)}` +
               `${profile.hthsMin != null ? `, HTHS ≥ ${profile.hthsMin}` : ''}). ` +
               'Марка тут ни при чём: это прямое физическое требование, и по нему масло отбирается ' +
               'даже когда родного допуска в каталоге нет.' + physicsTail(primary);
    }

    if (rank === 'conflict') {
        return 'Требует вязкости, несовместимой с остальным набором: масло под него будет жиже, ' +
               `чем нужно мотору (HTHS ≥ ${profile.hthsMin}). Перекрыть «более строгим» допуском такое нельзя — ` +
               'это выбор между разными маслами, а не ступени одной лестницы. В подборе не учитывается.' +
               physicsTail(primary);
    }

    if (rank === 'minor') {
        if (looserThanProfile(nativeSpec || primary, profile)) {
            return `Менее строгая ветка: разрешает ${sapsLabel((nativeSpec || primary).ash)} масло, ` +
                   `тогда как мотору с сажевым фильтром нужно ${sapsLabel(profile.ashGate)}. ` +
                   'Масло по строгой ветке подходит и сюда, поэтому подбор идёт по строгой, а этот допуск — фон. ' +
                   'Закрыть на него глаза можно: ошибка стоит ресурса масла, а не железа.' + physicsTail(primary);
        }
        if (nativeSpec) {
            return `Родной допуск ${famLabel}, но выбор определяет не он: более строгий допуск той же марки ` +
                   'уже задал профиль масла. Совпадение по нему — приятный бонус, не критерий.' + physicsTail(primary);
        }
        return 'Класс ACEA, который мотору не противоречит, но и не задаёт выбор — ограничение уже ' +
               'установлено более строгим допуском.' + physicsTail(primary);
    }

    if (rank === 'info') {
        return 'Уровень качества API/ILSAC, а не допуск. Есть практически у всех масел каталога, поэтому ' +
               'между ними ничего не различает — работает только как отсечка совсем старых масел.';
    }

    // noise
    if (confidence === 'none') {
        return 'Список допусков этой машины собран не по маслу, поэтому ни одна строка в нём ' +
               'не считается требованием. Подбор идёт как для машины без допусков.';
    }
    if (primary && primary.role === 'oem') {
        return `Заводской допуск ${famLabel} — к ${carLabel} отношения не имеет. Попал в список потому, ` +
               'что источник отдаёт паспорт рекомендованного масла целиком, а там стоят допуска пары десятков ' +
               'чужих марок. Обязательств не создаёт, в подборе игнорируется.';
    }
    return 'Строка не опознана справочником допусков — в подборе не участвует.';
}

function physicsTail(spec) {
    if (!spec) return '';
    const bits = [];
    if (spec.ash != null) bits.push(`${sapsLabel(spec.ash)} (зола ≤ ${spec.ash}%)`);
    if (spec.hths) {
        bits.push(spec.hths[1] === Infinity ? `HTHS ≥ ${spec.hths[0]}` : `HTHS ${spec.hths[0]}–${spec.hths[1]}`);
    }
    if (spec.visc) bits.push(`вязкость ${spec.visc.join('/')}`);
    return bits.length ? `\nФизика: ${bits.join(', ')}.` : '';
}

// ── Совместимость масла с профилем машины ────────────────────────────────────
// Возвращает { blocked, penalty, notes }.
//   blocked — масло опасно для этого мотора, в основной выбор не идёт.
//   penalty — мягкое отклонение: лить можно, но есть чем крыть.

export function oilFitsProfile(oilApprovals, analysis) {
    const notes = [];
    if (!analysis || !analysis.profile) return { blocked: false, penalty: 0, notes };
    const { profile, confidence } = analysis;
    const prof = oilProfile(oilApprovals);

    let blocked = false, penalty = 0;

    // Зола. Режем только там, где есть что забивать: profile.ashGate стоит
    // лишь при реальном сажевом фильтре. Разницу между средне- и малозольным
    // (0.8 против 0.5) держим мягкой — она влияет на скорость забивания
    // фильтра, а не убивает его, и масел ≤0.5% в наличии обычно нет вовсе.
    if (profile.ashGate != null && prof.ash != null) {
        if (prof.ash > profile.ashGate) {
            const note = `масло ${sapsLabel(prof.ash)}, мотору нужно ${sapsLabel(profile.ashGate)}`;
            if (confidence === 'high' || confidence === 'medium') { blocked = true; notes.push(note); }
            else { penalty += 40; notes.push(note + ' (профиль выведен неточно)'); }
        } else if (profile.ash != null && prof.ash > profile.ash) {
            penalty += 15;
            notes.push(`мотору желательно ${sapsLabel(profile.ash)}, у масла ${sapsLabel(prof.ash)}`);
        }
    }

    // HTHS. Слишком жидкое — масляная плёнка тоньше расчётной, износ вкладышей:
    // это блокировка. Слишком густое — потеря экономичности и вялые
    // фазовращатели: это штраф, потому что заводы вроде Ford такое запрещают,
    // но железо от этого не умирает, а альтернативы в наличии может не быть.
    const hthsGate = profile.hthsGate != null ? profile.hthsGate : profile.hthsMin;
    if (hthsGate != null && prof.hthsMin != null && prof.hthsMin + 0.001 < hthsGate) {
        if (confidence === 'high' || confidence === 'medium') {
            blocked = true;
            notes.push(`HTHS масла ниже требуемого ${hthsGate}`);
        } else {
            penalty += 25;
            notes.push(`HTHS масла, похоже, ниже требуемого ${hthsGate}`);
        }
    } else if (profile.hthsMax != null && profile.hthsMax !== Infinity &&
               prof.hthsMin != null && prof.hthsMin >= profile.hthsMax) {
        penalty += 20;
        notes.push(`мотор рассчитан на HTHS до ${profile.hthsMax}, масло гуще`);
    }

    return { blocked, penalty, notes };
}

// ── Вес совпавшего допуска ───────────────────────────────────────────────────
// Индекс «нормализованный id допуска → вес» для скоринга масел.

export function approvalWeights(analysis) {
    const w = new Map();
    if (!analysis) return w;
    for (const it of analysis.items) {
        for (const part of it.parts || [it.raw]) {
            const spec = findSpec(part);
            const id = spec ? spec.id : normSpec(part);
            if (!id) continue;
            w.set(id, Math.max(w.get(id) || 0, it.weight));
        }
    }
    return w;
}
