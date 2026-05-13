// ==UserScript==
// @name         Mann + Motul Oil Calculator
// @namespace    zamena-masla-spot.ru
// @version      2.12
// @description  Расчёт замены масла: Mann Filter / LYNXauto / Ravenol → Motul + ROLF
// @match        https://www.mann-filter.com/*
// @match        https://lynxauto.info/*
// @match        https://motul.lubricantadvisor.com/*
// @match        https://rolfoil.ru/podbor/*
// @match        https://podbor.upec.pro/*
// @match        https://podbor.ravenol.ru/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // Глобальное состояние калькулятора (объявлено вверху чтобы Firefox не ругался на TDZ)
    let calcState = null;

    const HOST = location.hostname;
    if (HOST.includes('motul.lubricantadvisor.com')) { initMotul(); return; }
    if (HOST.includes('rolfoil.ru') || HOST.includes('podbor.upec.pro')) { initRolf(); return; }
    if (HOST.includes('mann-filter.com'))            { initMann('mann');    return; }
    if (HOST.includes('lynxauto.info'))               { initMann('lynx');    return; }
    if (HOST.includes('podbor.ravenol.ru'))           { initMann('ravenol'); return; }

    // ══════════════════════════════════════════════════════════════════
    //                    БАЗА ТВОИХ МАСЕЛ (ШОУ-РУМ)
    // ══════════════════════════════════════════════════════════════════
    // ad: массив присадок (для UI, не идёт в отчёт)
    // у SPOT — фиксированный набор из 4х (как в файле "Допуска.xlsx")
    function getShopOils() { return [
        // Liqui Moly
        { b:'Liqui Moly', n:'5W-30 Top Tec', price:2350, v:'5W-30',
          a:['API SP','ACEA C2','ACEA C3','LL 04','LL 01','MB 229.31','MB 229.51','MB 229.52','FIAT 9.55535-S3','FORD WSS-M2C 917-A','VW 502 00','VW 505 00','VW 505 01','VW 504 00','VW 507 00','PORSCHE C30'],
          ad:['износ','отложения','температура','топливо','масло-угар'] },
        { b:'Liqui Moly', n:'5W-40 Top Tec', price:2200, v:'5W-40',
          a:['API SN','ACEA C3','MB 229.31','PORSCHE A40','VW 505 00','VW 505 01','LL 04','FIAT 9.55535-H2','FIAT 9.55535-M2','FIAT 9.55535-S2','FORD WSS-M2C 917-A','GM DEXOS2','RN 0700','RN 0710'],
          ad:['малозольное','износ','отложения','температура','топливо','масло-угар'] },
        { b:'Liqui Moly', n:'Leichtlauf HC 7 5W-30', price:1950, v:'5W-30',
          a:['ACEA A3/B4','API SN','LL 98','MB 229.3','RN 0700','RN 0710','VW 502 00','VW 505 00','GM LL-A-025','GM LL-B-025'],
          ad:['стиль вождения','износ','отложения','топливо','масло-угар'] },
        { b:'Liqui Moly', n:'Leichtlauf HC 7 5W-40', price:2050, v:'5W-40',
          a:['API SN Plus','ACEA A3/B4','LL 98','MB 229.3','PORSCHE A40','VW 502 00','VW 505 00','GM LL-A-025','GM LL-B-025','RN 0700','RN 0710'],
          ad:['износ','отложения','топливо','масло-угар'] },
        { b:'Liqui Moly', n:'5W-30 Molygen', price:2200, v:'5W-30',
          a:['API SP','ILSAC GF-6A','FIAT 9.55535-CR1','FORD WSS-M2C 961-A1','FORD WSS-M2C 946-A','FORD WSS-M2C 946-B1'],
          ad:['Америка/Азия','износ','отложения','топливо','масло-угар','антифрикционные'] },
        { b:'Liqui Moly', n:'5W-40 Molygen', price:2150, v:'5W-40',
          a:['API SN','ACEA A3/B4','LL 01','FIAT 9.55535-Z2','FIAT 9.55535-H2','FIAT 9.55535-N2','MB 229.5','PORSCHE A40','RN 0700','RN 0710','VW 502 00','VW 505 00','GM LL-B-025'],
          ad:['Америка/Азия','износ','отложения','топливо','масло-угар','антифрикционные'] },
        // ROLF
        { b:'ROLF', n:'Professional 5W-30 A5/B5', price:1450, v:'5W-30',
          a:['API SP','ACEA A5/B5','FORD WSS-M2C913-A','FORD WSS-M2C913-B','FORD WSS-M2C913-C','FORD WSS-M2C913-D','JAGUAR STJLR.03.5003'],
          ad:['внедорожники','пуск в мороз','износ','отложения','масло-угар'] },
        { b:'ROLF', n:'Professional AM 5W-40', price:1650, v:'5W-40',
          a:['API CF','API SN Plus','ACEA A3/B3','ACEA A3/B4','LL 01','FIAT 9.55535-Z2','GM LL-A-025','GM LL-B-025','PORSCHE A40','PSA B71 2293','PSA B71 2296','RN 0700','RN 0710','VW 502 00','VW 505 00','MB 226.5','MB 229.5'],
          ad:['моющие присадки','отложения','нагар','быстрый запуск'] },
        { b:'ROLF', n:'Professional 5W-30 C3', price:1650, v:'5W-30',
          a:['API SN','ACEA C3','LL 04','PORSCHE C30','VW 504 00','VW 507 00','MB 229.51'],
          ad:['антикоррозия','моющие присадки','для турбо'] },
        { b:'ROLF', n:'Professional 0W-20', price:1850, v:'0W-20',
          a:['API SN','ACEA C5','FORD WSS-M2C947-B1','JAGUAR STJLR.03.5006','VW 508','VW 509'],
          ad:['низкосульфатное','нейтрализация выхлопа','экономия топлива'] },
        // Mobil
        { b:'Mobil', n:'Super 3000 FE 5W-30', price:1550, v:'5W-30',
          a:['API CF','API SJ','API SL','API SM','API SN','API SN Plus','API SP','ACEA A5/B5','FORD WSS-M2C913-C','FORD WSS-M2C913-D','JAGUAR STJLR'],
          ad:['без саж.ф.','всесезонное','антикоррозия','отложения','топливо','любой режим езды'] },
        { b:'Mobil', n:'Super 3000 5W-40', price:1600, v:'5W-40',
          a:['FIAT 9.55535-G2','FIAT 9.55535-M2','API CF','ACEA A3/B3','ACEA A3/B4','API SL','API SM','API SN'],
          ad:['любой стиль езды','всесезонное'] },
        { b:'Mobil', n:'Ultra 10W-40', price:1150, v:'10W-40',
          a:['API SN','API SL','ACEA A3/B3','API SN Plus','MB 229.1','API SJ','API SM'],
          ad:['шлам','нагар','коррозия','пуск в мороз','топливо','масло-угар'] },
        { b:'Mobil', n:'ESP 5W-30', price:2000, v:'5W-30',
          a:['ACEA C3','GM DEXOS2','MB 229.31','MB 229.51','MB 229.52','PSA B71 2290','PSA B71 2297','API CF','API SJ','API SL','API SM','API SN'],
          ad:['малозольное','износ','отложения','экстремальные температуры','топливо','масло-угар'] },
        // ZIC
        { b:'ZIC', n:'X8 SE 5W-30', price:1700, v:'5W-30',
          a:['API SP','ACEA A5/B5','FORD WSS-M2C913-D','RN 0700','JAGUAR STJLR 03.5003'],
          ad:['быстрый запуск','защита при нагрузках','отложения','нагар'] },
        { b:'ZIC', n:'X8 SE 5W-40', price:1750, v:'5W-40',
          a:['API SP','ACEA A3/B4','VW 502 00','VW 505 00','MB 229.5','MB 229.3','LL 01','RN 0700','RN 0710','PSA B71 2296','PORSCHE A40'],
          ad:['интервал','нагар','отложения','масло-угар'] },
        { b:'ZIC', n:'X9 FE 0W-20', price:1550, v:'0W-20',
          a:['API SP','ILSAC GF-6A','GM DEXOS1 Gen 3','GM DEXOS1'],
          ad:['бензин','топливо','низкотемпературное'] },
        // GM / Shell / Castrol
        { b:'GM', n:'5W-30 Dexos II', price:1500, v:'5W-30',
          a:['ACEA A3/B3','GM LL-B-025','VW 505 01','VW 502 00','VW 505 00','MB 229.51','LL 04','GM DEXOS2'],
          ad:['низкая зольность','износ','топливо','очистка'] },
        { b:'Shell', n:'5W-30 Ultra AM-L Kia/Hyundai', price:1800, v:'5W-30',
          a:['LL 04','MB 229.51','API SN','API CF','ACEA C3'],
          ad:['топливо','масло-угар','пуск в мороз','сажа','низкозольное'] },
        { b:'Castrol', n:'5W-30 EDGE LL', price:1950, v:'5W-30',
          a:['MB 229.51','MB 229.31','VW 507 00','VW 504 00','PORSCHE C30','ACEA C3'],
          ad:['всесезонное','отложения','любой стиль вождения'] },
        // Motul (в твоём магазине)
        { b:'Motul', n:'5W-30 8100 X-Clean+', price:2150, v:'5W-30',
          a:['LL 04','MB 229.51','PORSCHE C30','VW 504 00','VW 507 00','ACEA C3','API SM','API CF'],
          ad:['снижает трение','износ','моющие присадки','нагар','сажа','топливо'] },
        { b:'Motul', n:'5W-30 SAVE-NERGY', price:1900, v:'5W-30',
          a:['FIAT 9.55535-G1','FORD WSS M2C 913D','JAGUAR STJLR 03.5003','ACEA A5/B5','API SL'],
          ad:['трение','тепловые нагрузки','износ','топливо','масло-угар'] },
        { b:'Motul', n:'5W-40 6100 SYN-CLEAN', price:1900, v:'5W-40',
          a:['FORD WSS M2C 917A','GM DEXOS2','MB 229.51','RN 0710','RN 0700','VW 505 00','VW 505 01','ACEA C3','API SN'],
          ad:['трение','тепловые нагрузки','износ','топливо','масло-угар'] },
        // Idemitsu / Zepro
        { b:'Idemitsu', n:'ZEPRO TOURING FS', price:2250, v:'5W-30',
          a:['API SP','ILSAC GF-6A'],
          ad:['отложения','осадки','топливо','масло-угар'] },
        { b:'Idemitsu', n:'ZEPRO EURO SPEC FS', price:2250, v:'5W-30',
          a:['API SP','ACEA C3'],
          ad:['отложения','сажа','топливо','масло-угар'] },
        // SPOT (наш бренд - всегда доступен) — присадки фиксированные из файла
        { b:'SPOT', n:'OPTIMAL 5W-30', price:1200, v:'5W-30',
          a:['ACEA A3/B4','API SN','API CF','VW 502 00','VW 505 00','MB 226.5','MB 229.3','RN 0700','RN 0710','GM LL-B-025','PORSCHE A40','LL 01'],
          ad:['топливо','низкотемпературное','износ','антикоррозия'], isSpot:true, tier:'optimal' },
        { b:'SPOT', n:'OPTIMAL 5W-40', price:1200, v:'5W-40',
          a:['ACEA A3/B4','API SL','VW 502 00','VW 505 00','MB 229.3','RN 0700','RN 0710','АВТОВАЗ'],
          ad:['топливо','низкотемпературное','износ','антикоррозия'], isSpot:true, tier:'optimal' },
        { b:'SPOT', n:'PROFESSIONAL 5W-30', price:1500, v:'5W-30',
          a:['ACEA C3','API SN','API CF','FORD WSS-M2C 913-A','FORD WSS-M2C 913-B','FORD WSS-M2C 913-C','RN 0700','ILSAC GF-5'],
          ad:['топливо','низкотемпературное','износ','антикоррозия'], isSpot:true, tier:'pro' },
        { b:'SPOT', n:'PROFESSIONAL 5W-40', price:1500, v:'5W-40',
          a:['GM DEXOS2','MB 229.51','MB 229.31','MB 226.5','RN 0700','RN 0710','VW 505 00','VW 505 01','LL 04','PORSCHE A40','FORD WSS-M2C-917-A'],
          ad:['топливо','низкотемпературное','износ','антикоррозия'], isSpot:true, tier:'pro' },
    ];}

    // ══════════════════════════════════════════════════════════════════
    //                БАЗА ДОПУСКОВ MOTUL МАСЕЛ
    // ══════════════════════════════════════════════════════════════════
    function getMotulOils() { return {
        '8100 POWER 5W-30':       { a:['ACEA A3/B4','API SN','PORSCHE A40','FIAT 9.55535-M2'] },
        '8100 ECO-CLEAN 5W-30':   { a:['ACEA C2','API SN','API CF','PSA B71 2290','FIAT 9.55535-S1'] },
        '8100 ECO-CLEAN 0W-30':   { a:['ACEA C2','API SN','FORD WSS M2C 950A','FIAT 9.55535-GS1','FIAT 9.55535-DS1'] },
        '8100 ECO-LITE 5W-20':    { a:['API SN','ILSAC GF-5'] },
        '8100 ECO-LITE 5W-30':    { a:['API SN','API CF','ILSAC GF-5','ILSAC GF4','FORD WSS-M2C913-C','JAGUAR STJLR.03.5003'] },
        '8100 ECO-NERGY 5W-30':   { a:['ACEA A5/B5','API SL','API CF','FORD WSS M2C 913D','JAGUAR STJLR.03.5003','RN 0700'] },
        '8100 X-CLEAN EFE 5W-30': { a:['ACEA C2','ACEA C3','API SN','MB 229.51','GM DEXOS2'] },
        '8100 X-CLEAN FE 5W-30':  { a:['ACEA C2','ACEA C3','API SN','API CF','GM DEXOS2','MB 229.51','PSA B71 2290','VW 502 00','VW 505 01','FIAT 9.55535-S1','FIAT 9.55535-S3'] },
        '8100 X-CLEAN 5W-40':     { a:['ACEA C3','API SN','LL 04','FORD WSS M2C 917A','MB 229.51','VW 502 00','VW 505 00','VW 505 01','PORSCHE A40','RN 0710','RN 0700','GM DEXOS2'] },
        '8100 X-CLEAN+ 5W-30':    { a:['ACEA C3','API SM','API CF','VW 504 00','VW 507 00','PORSCHE C30','MB 229.51','LL 04'] },
        '8100 X-CESS 5W-30':      { a:['ACEA A3/B4','ACEA C3','API SN','MB 229.51','LL 04','PORSCHE A40','VW 502 00','VW 505 00','RN 0710','RN 0700'] },
        '8100 X-CESS 5W-40':      { a:['ACEA A3/B4','API SN','API CF','MB 229.5','LL 01','PORSCHE A40','VW 502 00','VW 505 00','RN 0710','RN 0700','FIAT 9.55535-H2','FIAT 9.55535-M2','FIAT 9.55535-N2','FIAT 9.55535-Z2','PSA B71 2296','GM LL-B-025'] },
        '6100 SAVE-CLEAN 5W-30':  { a:['ACEA C2','API SN'] },
        '6100 SAVE-LITE 5W-20':   { a:['API SN','ILSAC GF-5'] },
        '6100 SAVE-LITE 5W-30':   { a:['API SN','ILSAC GF-5'] },
        '6100 SAVE-NERGY 5W-30':  { a:['ACEA A5/B5','API SL','FIAT 9.55535-G1','FORD WSS M2C 913D','JAGUAR STJLR 03.5003'] },
        '6100 SYN-CLEAN FE 5W-30':{ a:['ACEA C3','API SN','MB 229.51','GM DEXOS2','RN 0710','RN 0700','VW 505 00','VW 505 01','FORD WSS M2C 917A'] },
        '6100 SYN-CLEAN 5W-40':   { a:['ACEA C3','API SN','MB 229.51','GM DEXOS2','RN 0710','RN 0700','VW 505 00','VW 505 01'] },
        '6100 SYN-NERGY 5W-30':   { a:['ACEA A3/B4','API SN','MB 229.3','VW 502 00','VW 505 00','RN 0700','RN 0710'] },
        '4100 PROTEC 10W-30':     { a:['ACEA A3/B3','API SN'] },
        '4100 PROTEC 15W-40':     { a:['ACEA A3/B3','API SN'] },
        '4100 SYN-NERGY 15W-40':  { a:['ACEA A3/B4','API SN','MB 229.1'] },
        '4100 TURBOLIGHT 10W-40': { a:['ACEA A3/B4','API SN','MB 229.1','PSA B71 2300','RN 0700','VW 501 01','VW 505 00'] },
        '4000 MOTION 10W-30':     { a:['ACEA A3/B3','API SL'] },
        '4000 MOTION 15W-40':     { a:['ACEA A3/B3','API SL'] },
        '2000 PROTECT 20W-50':    { a:['API SL'] },
        'NGEN 6 5W-30':           { a:['API SP','ILSAC GF-6A'] },
        'ASIAN IMPORT 5W-20':     { a:['API SN','ILSAC GF-5'] },
        'ASIAN IMPORT 5W-30':     { a:['API SN','ILSAC GF-5'] },
        'SPECIFIC 229.51 5W-30':  { a:['ACEA C3','API SM','API CF','MB 229.51'] },
        'SPECIFIC DEXOS2 5W-30':  { a:['ACEA C3','API SN','API CF','GM DEXOS2'] },
        'SPECIFIC 504 00 507 00 5W-30': { a:['ACEA C3','VW 504 00','VW 507 00'] },
        'SPECIFIC LL-04 5W-40':   { a:['ACEA C3','API SN','API CF','LL 04'] },
        'SPECIFIC 506 01 506 00 503 00 0W-30': { a:['ACEA A5/B5','VW 503 00','VW 506 00','VW 506 01'] },
    };}

    // ══════════════════════════════════════════════════════════════════
    //              РЕГЛАМЕНТ — РЕКОМЕНДУЕМЫЕ ДОПУСКИ ПО МАРКАМ
    // ══════════════════════════════════════════════════════════════════
    function getReglament() { return {
        BMW: {
            tags: ['BMW SPECIAL OIL','LL 98','LL 01','LL 01 FE','LL 04'],
            descriptions: {
                'BMW SPECIAL OIL': 'BMW Special Oil. Подходит для силовых агрегатов с единой спецификацией.',
                'LL 98': 'BMW Longlife-98. Для бензиновых и дизельных двигателей, изготовленных после 1998 г.',
                'LL 01': 'BMW Longlife-01. Для двигателей, выпущенных после 2001 г.',
                'LL 01 FE': 'BMW Longlife-01 FE. Пониженная вязкость. Подходит не для всех моделей.',
                'LL 04': 'BMW Longlife-04. Для новых двигателей с системами токсичности (DPF).',
            },
        },
        VAG: {
            tags: ['VW 500 00','VW 501 01','VW 502 00','VW 503 00','VW 503 01','VW 504 00','VW 505 00','VW 505 01','VW 506 00','VW 506 01','VW 507 00'],
            descriptions: {
                'VW 500 00': 'VW 500.00. Всесезонная эксплуатация без принудительного нагнетателя.',
                'VW 501 01': 'VW 501.01. Для машин с распределённым впрыском. Бензин/дизель. ACEA A2.',
                'VW 502 00': 'VW 502.00. Для ТС с распределённым впрыском, бензин. ACEA A3.',
                'VW 503 00': 'VW 503.00. Двигатели 1999-2005 г.г. Увеличенный интервал замены.',
                'VW 503 01': 'VW 503.01. Для некоторых бензиновых двигателей.',
                'VW 504 00': 'VW 504.00. Для любых бензиновых двигателей с увеличенным интервалом замены.',
                'VW 505 00': 'VW 505.00. Для дизелей. Соответствует CCMC PD-2 и ACEA A3.',
                'VW 505 01': 'VW 505.01. Для дизелей с насосами-форсунками разного типа.',
                'VW 506 00': 'VW 506.00. Дизели после 1999 г. ACEA B4. SAE 5W-40.',
                'VW 506 01': 'VW 506.01. Для движков с насосом-форсункой.',
                'VW 507 00': 'VW 507.00. Дизели с любым типом впрыска. Совместим с DPF.',
            },
        },
        MERCEDES: {
            tags: ['MB 229.1','MB 229.3','MB 229.31','MB 229.5','MB 229.51'],
            descriptions: {
                'MB 229.1':  'MB 229.1. Грузовые Mercedes-Benz с дизельными двигателями.',
                'MB 229.3':  'MB 229.3. Дизели на грузовом транспорте и тягачах.',
                'MB 229.31': 'MB 229.31. Коммерческий грузовой транспорт с дизелями + DPF.',
                'MB 229.5':  'MB 229.5. Дизели коммерческого грузового транспорта при больших нагрузках.',
                'MB 229.51': 'MB 229.51. Дизели коммерческой техники. Максимальный интервал замены с DPF.',
            },
        },
        FORD: {
            tags: ['FORD WSS-M2C 912-A1','FORD WSS-M2C 913-A','FORD WSS-M2C 913-B','FORD WSS-M2C 913-C','FORD WSS-M2C 917-A'],
            descriptions: {
                'FORD WSS-M2C 912-A1': 'WSS-M2C 912 A1. Для всех легковых машин на дизеле или бензине.',
                'FORD WSS-M2C 913-A':  'WSS-M2C 913 A. Для всех легковых на дизеле или бензине.',
                'FORD WSS-M2C 913-B':  'WSS-M2C 913 B. На базе ACEA A1/B1.',
                'FORD WSS-M2C 913-C':  'WSS-M2C 913 C. Для всех моделей Форд.',
                'FORD WSS-M2C 917-A':  'WSS-M2C 917 A. Дизели объёмом 1.9 л. ACEA A3/B3.',
            },
        },
        RENAULT: {
            tags: ['RN 0700','RN 0710','RN 0720'],
            descriptions: {
                'RN 0700': 'RN 0700. Дизели и бензин без наддува. Подходит для 1.5 DCi до 100 л.с. без DPF.',
                'RN 0710': 'RN 0710. Аналогично RN 0700. Подходит для Renault Sport.',
                'RN 0720': 'RN 0720. Обновлённые дизели с турбонаддувом и DPF. ACEA C4.',
            },
        },
        OPEL: {
            tags: ['GM-LL-A-025','GM-LL-B-025','DEXOS 1','DEXOS 2'],
            descriptions: {
                'GM-LL-A-025': 'GM-LL-A-025. Легковые на бензине. ACEA A3.',
                'GM-LL-B-025': 'GM-LL-B-025. Легковые на дизеле. ACEA B3, B4.',
                'DEXOS 1':     'Dexos 1. Бензиновые.',
                'DEXOS 2':     'Dexos 2. Опели от 2010 г.в. ACEA C3-08.',
            },
        },
        PSA: {
            tags: ['PSA B71 2290','PSA B71 2294','PSA B71 2295','PSA B71 2296'],
            descriptions: {
                'PSA B71 2290': 'PSA B71 2290. Дизели с DPF.',
                'PSA B71 2294': 'PSA B71 2294. Соответствие ACEA A3/B4 и C3.',
                'PSA B71 2295': 'PSA B71 2295. Двигатели до 1998 г.',
                'PSA B71 2296': 'PSA B71 2296. ACEA A3/B4.',
            },
        },
    };}

    function getReglamentForBrand(brand) {
        if (!brand) return null;
        const b = brand.toUpperCase();
        const reg = getReglament();
        if (b === 'BMW' || b === 'MINI') return { brand: 'BMW', ...reg.BMW };
        if (['VOLKSWAGEN','VW','AUDI','SKODA','SEAT','PORSCHE'].includes(b))
            return { brand: 'VAG', ...reg.VAG };
        if (b === 'MERCEDES' || b === 'MERCEDES-BENZ' || b === 'MB' || b === 'SMART')
            return { brand: 'MERCEDES', ...reg.MERCEDES };
        if (b === 'FORD' || b === 'JAGUAR' || b === 'LAND ROVER' || b === 'LANDROVER' || b === 'VOLVO')
            return { brand: 'FORD', ...reg.FORD };
        if (b === 'RENAULT' || b === 'DACIA' || b === 'NISSAN' || b === 'INFINITI')
            return { brand: 'RENAULT', ...reg.RENAULT };
        if (b === 'OPEL' || b === 'CHEVROLET' || b === 'BUICK' || b === 'CADILLAC' || b === 'GMC')
            return { brand: 'OPEL', ...reg.OPEL };
        if (b === 'PEUGEOT' || b === 'CITROEN' || b === 'CITROËN' || b === 'DS')
            return { brand: 'PSA', ...reg.PSA };
        return null;
    }

    function matchOilToReglament(oil, brand) {
        const reg = getReglamentForBrand(brand);
        if (!reg) return [];
        const oilTokens = tokenSet(oil.a || []);
        const matches = [];
        for (const tag of reg.tags) {
            const tagTok = tokenSet([tag]);
            for (const t of tagTok) {
                if (oilTokens.has(t)) {
                    matches.push({ tag, desc: reg.descriptions[tag] || '' });
                    break;
                }
            }
        }
        return matches;
    }

    function getDefaults() { return {
        gear75W90:  [ {b:'ZIC',  n:'GFT 75W-90',          price:1380, v:'75W-90'},
                      {b:'ROLF', n:'Professional 75W-90', price:1750, v:'75W-90'} ],
        cvt:        [ {b:'ZIC',  n:'CVT Multi HP',                     price:1550, v:'CVT'},
                      {b:'ROLF', n:'Professional CVTF Multi',          price:1750, v:'CVT'} ],
        dct:        [ {b:'ZIC',  n:'DCT FE (для роботов с мокр. сц.)', price:1650, v:'DCT'},
                      {b:'ROLF', n:'Professional DCT',                 price:1850, v:'DCT'} ],
        atf:        [ {b:'ZIC',  n:'ATF',           price:1300, v:'ATF'},
                      {b:'ROLF', n:'ATF',           price:1550, v:'ATF'} ],
    };}

    // ══════════════════════════════════════════════════════════════════
    //              НОРМАЛИЗАЦИЯ И СРАВНЕНИЕ ДОПУСКОВ
    // ══════════════════════════════════════════════════════════════════
    function normApproval(s) {
        if (!s) return '';
        let x = s.toString().toUpperCase()
            .replace(/APPROVAL/g, '').replace(/LICENSE.*$/, '')
            .replace(/[\s\-_\.\/,;:()]+/g, '')
            .replace(/MERCEDES|MBAPPROVAL/g, 'MB')
            .replace(/VOLKSWAGEN/g, 'VW')
            .replace(/RENAULTRN|RENAULT/g, 'RN')
            .replace(/GMOPEL|OPEL/g, 'GM')
            .replace(/BMWLL|LONGLIFE/g, 'LL')
            .replace(/JAGUARLANDROVER|JAGUAR/g, 'STJLR')
            .replace(/FORDWSS/g, 'FORDWSS')
            .replace(/АВТОВАЗ/g, 'VAZ');
        return x;
    }
    function tokenSet(arr) {
        const s = new Set();
        for (const a of (arr || [])) {
            const n = normApproval(a);
            if (n.length >= 3) s.add(n);
            const nums = n.match(/\d{3,6}/g);
            if (nums) for (const x of nums) s.add(x);
        }
        return s;
    }
    function anyMatch(oilApprovals, carApprovals) {
        const oil = tokenSet(oilApprovals);
        const car = tokenSet(carApprovals);
        for (const t of oil) if (car.has(t)) return true;
        return false;
    }
    function isDiesel(carApprovals) {
        const s = tokenSet(carApprovals);
        return s.has('ACEAC3') || s.has('ACEAC2') || s.has('ACEAC1') ||
               s.has('APICF') || s.has('C3') || s.has('C2');
    }

    // Вернуть исходные строки допусков масла, разбитые на (matched, others)
    // относительно набора допусков машины. Сравнение по нормализованным токенам.
    function splitOilApprovals(oilApprovals, carApprovals) {
        const oilArr = oilApprovals || [];
        const carTok = tokenSet(carApprovals || []);
        const matched = [];
        const others  = [];
        for (const a of oilArr) {
            const tk = tokenSet([a]);
            let isHit = false;
            for (const t of tk) { if (carTok.has(t)) { isHit = true; break; } }
            if (isHit) matched.push(a);
            else       others.push(a);
        }
        return { matched, others };
    }

    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({
            '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
        }[c]));
    }
    function escapeHtmlSafe(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({
            '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
        }[c]));
    }

    // ══════════════════════════════════════════════════════════════════
    //                       ПАРСЕР URL МАШИНЫ
    // ══════════════════════════════════════════════════════════════════
    function parseMannUrl() {
        if (location.hostname.includes('lynxauto.info')) {
            return parseLynxUrl();
        }

        const p = new URLSearchParams(location.search);
        if (!p.get('vehicleMake') && !p.get('vehicleModel')) return null;
        const make  = (p.get('vehicleMake')  || '').trim();
        const model = (p.get('vehicleModel') || '').replace(/\+/g, ' ').trim();
        const engineCode = (p.get('engineCode') || '').replace(/\+/g, ' ').trim();
        const fuelType = (p.get('fuelType') || '').trim();
        const ccm = parseInt(p.get('ccm') || '0') || null;
        const kw  = parseInt(p.get('kw')  || '0') || null;
        const bhp = parseInt(p.get('bhp') || '0') || null;
        const yMatch = (p.get('vehicleManufacturedFrom') || '').match(/(\d{4})/);
        const yearFrom = yMatch ? parseInt(yMatch[1]) : null;

        const makeShort = make.split(/\s+/)[0];
        const modelShort = model
            .replace(/\([^)]*\)/g, ' ')
            .replace(/[()]/g, ' ')
            .replace(/\s{2,}/g, ' ').trim()
            .split(/\s+/).slice(0, 3).join(' ');
        const volume = ccm ? (Math.round(ccm / 100) / 10).toFixed(1) : '';
        const query = [makeShort, modelShort, volume].filter(Boolean).join(' ').toLowerCase();

        const cacheKey = [makeShort, modelShort, volume, kw, engineCode, yearFrom]
            .filter(Boolean).join('_').toLowerCase().replace(/\s+/g, '');

        return { make, model, makeShort, modelShort, engineCode, fuelType, ccm, kw, bhp,
                 yearFrom, volume, query, cacheKey };
    }

    function parseLynxUrl() {
        const p = new URLSearchParams(location.search);
        const vendor = (p.get('vendor') || '').trim();
        const car    = (p.get('car') || '').replace(/\+/g, ' ').trim();
        const yearRaw = (p.get('year') || '').replace(/\+/g, ' ').trim();
        const mod    = (p.get('modification') || '').replace(/\+/g, ' ').trim();
        const power  = (p.get('power_engine') || '').replace(/\+/g, ' ').trim();

        if (!vendor || !car) return null;

        let engineCode = '', engineName = mod;
        const ecMatch = mod.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
        if (ecMatch) {
            engineName = ecMatch[1].trim();
            engineCode = ecMatch[2].trim();
        }

        let yearFrom = null;
        const yMatch = yearRaw.match(/(\d{1,2})\/(\d{2,4})/);
        if (yMatch) {
            let y = parseInt(yMatch[2]);
            if (y < 100) y += y < 50 ? 2000 : 1900;
            yearFrom = y;
        }

        let kw = null, bhp = null;
        const pMatch = power.match(/(\d+)\s*\((\d+)\)/);
        if (pMatch) {
            kw = parseInt(pMatch[1]);
            bhp = parseInt(pMatch[2]);
        } else {
            const single = power.match(/(\d+)/);
            if (single) kw = parseInt(single[1]);
        }

        const modelClean = car
            .replace(/\([^)]*\)/g, ' ')
            .replace(/\s+\d{1,2}[\/\-]\d{0,4}-?\s*$/g, '')
            .replace(/\s+\d{1,2}-\s*$/g, '')
            .replace(/[-\s]+$/g, '')
            .replace(/\s{2,}/g, ' ').trim();

        let volume = '';
        const skipVolume = /^(BMW|MERCEDES|MERCEDES-BENZ)$/i.test(vendor);
        if (!skipVolume) {
            const volMatch = engineName.match(/(\d\.\d)/);
            if (volMatch) volume = volMatch[1];
        }

        const make = vendor;
        const makeShort = make.split(/\s+/)[0];
        const modelShort = modelClean.split(/\s+/).slice(0, 3).join(' ') || car;

        const queryParts = [makeShort, modelShort];
        if (engineName) queryParts.push(engineName);
        else if (volume) queryParts.push(volume);
        const query = queryParts.filter(Boolean).join(' ').toLowerCase();

        const cacheKey = [makeShort, modelShort, volume, kw, engineCode, yearFrom]
            .filter(Boolean).join('_').toLowerCase().replace(/\s+/g, '');

        let fuelType = '';
        const allText = (engineName + ' ' + engineCode).toUpperCase();
        if (/\bD\b|TDI|HDI|CDI|CRDI|TDCI|JTDM|MULTIJET|DTI|CTDI/i.test(allText)) {
            fuelType = '05';
        }

        return {
            make, model: car, makeShort, modelShort,
            engineCode, engineName, fuelType,
            ccm: null,
            kw, bhp,
            yearFrom, volume, query, cacheKey,
        };
    }

    // ══════════════════════════════════════════════════════════════════
    //              MANN FILTER — ВИДЖЕТ С КАЛЬКУЛЯТОРОМ
    // ══════════════════════════════════════════════════════════════════
    function initMann(source) {
        source = source || 'mann';
        injectStyles();
        const widget = createWidget();
        let expanded = false;
        let lastRenderedKey = null;

        function getCar() {
            if (source === 'ravenol') return buildRavenolCar();
            return parseMannUrl();
        }

        function render() {
            const car = getCar();
            if (!car) {
                widget.classList.remove('zm-full');
                const msg = source === 'ravenol'
                    ? 'Откройте Ravenol с выбранным авто (страница /1-cars/.../).'
                    : 'Откройте Mann Filter с выбранным авто.';
                widget.innerHTML = shellHTML(`<div class="zm-warn">${msg}</div>`);
                bindHeaderEvents(null);
                return;
            }

            let cached;
            if (source === 'ravenol') {
                cached = car._ravenolData;
                if (cached) GM_setValue('motul_car_' + car.cacheKey, cached);
            } else {
                cached = GM_getValue('motul_car_' + car.cacheKey, null);
            }

            if (expanded && !cached) expanded = false;

            if (expanded) {
                widget.classList.add('zm-full');
                widget.innerHTML = shellHTML(renderCalculator(car, cached));
                bindHeaderEvents(car);
                bindCalcEvents(car, cached);
            } else {
                widget.classList.remove('zm-full');
                widget.innerHTML = shellHTML(renderTrayBody(car, cached));
                bindHeaderEvents(car);
                bindTrayEvents(car);
            }

            lastRenderedKey = car.cacheKey + '|' + (cached ? 'Y' : 'N') + '|R' + ((GM_getValue('rolf_approvals_'+car.cacheKey, null)||[]).length) + '|' + (expanded ? 'E' : 'T');
        }

        function renderTrayBody(car, cached) {
            const rolfApp = GM_getValue('rolf_approvals_' + car.cacheKey, null);
            const motulOk = !!cached;
            const rolfOk = !!(rolfApp && rolfApp.length);

            const status = `
                <div style="font-size:11px;line-height:1.7">
                    <div>${motulOk ? '✓ <span class="zm-ok">Motul</span>' : '<span class="zm-wait">○ Motul (объёмы)</span>'}</div>
                    <div>${rolfOk  ? '✓ <span class="zm-ok">ROLF</span> (' + rolfApp.length + ' допусков)' : '<span class="zm-wait">○ ROLF (допуски)</span>'}</div>
                </div>
            `;

            return `
                <div class="zm-car">
                    <div class="zm-car-t">${car.makeShort} ${car.modelShort}${car.engineName?' '+car.engineName:(car.volume?' '+car.volume:'')}</div>
                    <div class="zm-car-sub">${car.engineCode || '?'} · ${car.kw||'?'}кВт · ${car.yearFrom||'?'}</div>
                </div>
                <div class="zm-tray-status">${status}</div>
                <div class="zm-tray-btns" style="flex-direction:column;gap:4px">
                    ${!motulOk ? `<button class="zm-btn zm-btn-pri" id="zm-search">🔍 Найти на Motul</button>` : ''}
                    <button class="zm-btn zm-btn-sec" id="zm-rolf">📋 Допуски (ROLF)</button>
                    ${motulOk ? `<button class="zm-btn zm-btn-pri" id="zm-expand">📊 Развернуть</button>` : ''}
                    ${motulOk ? `<button class="zm-btn zm-btn-sec" id="zm-refresh" title="Переискать на Motul">↻ переискать Motul</button>` : ''}
                </div>
            `;
        }

        function shellHTML(body) {
            const headerRight = expanded
                ? `<button class="zm-btn zm-btn-sec" id="zm-rolf-exp" title="Допуски ROLF">📋 ROLF</button>
                   <button class="zm-btn zm-btn-sec" id="zm-research" title="Переискать на Motul">↻</button>
                   <button class="zm-btn zm-btn-sec" id="zm-collapse">▸ свернуть</button>`
                : `<button class="zm-btn zm-btn-sec" id="zm-hide" title="Скрыть">−</button>`;

            return `
                <div class="zm-header">
                    <span class="zm-title">🛢 OIL WIDGET</span>
                    ${headerRight}
                </div>
                ${body}
            `;
        }

        function bindHeaderEvents(car) {
            const collapseBtn = document.getElementById('zm-collapse');
            if (collapseBtn) collapseBtn.onclick = () => { expanded = false; render(); };

            const researchBtn = document.getElementById('zm-research');
            if (researchBtn && car) researchBtn.onclick = () => { openMotulSearch(car); };

            const rolfExpBtn = document.getElementById('zm-rolf-exp');
            if (rolfExpBtn && car) rolfExpBtn.onclick = () => openRolfSearch(car);

            const hideBtn = document.getElementById('zm-hide');
            if (hideBtn) hideBtn.onclick = () => widget.classList.toggle('zm-hidden');
        }

        function bindTrayEvents(car) {
            const searchBtn = document.getElementById('zm-search');
            if (searchBtn) searchBtn.onclick = () => openMotulSearch(car);

            const rolfBtn = document.getElementById('zm-rolf');
            if (rolfBtn) rolfBtn.onclick = () => openRolfSearch(car);

            const expBtn = document.getElementById('zm-expand');
            if (expBtn) expBtn.onclick = () => { expanded = true; render(); };

            const refBtn = document.getElementById('zm-refresh');
            if (refBtn) refBtn.onclick = () => {
                GM_deleteValue('motul_car_' + car.cacheKey);
                expanded = false;
                openMotulSearch(car);
                render();
            };
        }

        function openRolfSearch(car) {
            GM_setValue('zm_rolf_pending', JSON.stringify({
                key: car.cacheKey,
                ec: car.engineCode || '',
                ts: Date.now(),
            }));
            GM_deleteValue('rolf_approvals_' + car.cacheKey);
            if (car.engineCode) {
                try { navigator.clipboard.writeText(car.engineCode).catch(()=>{}); } catch {}
            }
            window.open('https://rolfoil.ru/podbor/', 'zm_rolf_search');
            showSearchHint({ ...car, searchSource: 'ROLF' });
        }

        function openMotulSearch(car) {
            const carJson = encodeURIComponent(JSON.stringify({
                make: car.make || '',
                makeShort: car.makeShort || '',
                modelShort: car.modelShort || '',
                model: car.model || '',
                engineCode: car.engineCode || '',
                engineName: car.engineName || '',
                fuelType: car.fuelType || '',
                volume: car.volume || '',
                ccm: car.ccm || '',
                kw: car.kw || '',
                bhp: car.bhp || '',
                yearFrom: car.yearFrom || '',
            }));
            const url = `https://motul.lubricantadvisor.com/default.aspx?data=1&lang=rus#prefill=${encodeURIComponent(car.query)}&key=${encodeURIComponent(car.cacheKey)}&ec=${encodeURIComponent(car.engineCode)}&carData=${carJson}&manual=1`;
            const win = window.open(url, 'zm_motul_search');
            showSearchHint(car);
            try { win && win.focus(); } catch {}
        }

        function showSearchHint(car) {
            let p = document.getElementById('__zm_hint');
            if (p) p.remove();
            p = document.createElement('div');
            p.id = '__zm_hint';
            const isRolf = car.searchSource === 'ROLF';
            const title = isRolf ? '👆 Вставь код в умный поиск на ROLF' : '👆 Выбери машину в открытой вкладке Motul';
            const body  = isRolf
                ? `Код <b style="color:#E67E00">${car.engineCode || '?'}</b> уже в буфере ✓<br>
                   <small style="color:#7986cb">Ctrl+V в поле поиска → выбери машину → скрипт сам распарсит допуска</small>`
                : `Ищи вариант с кодом <b style="color:#E67E00">${car.engineCode || '?'}</b><br>
                   <small style="color:#7986cb">Скрипт сам распарсит и вернётся сюда</small>`;

            p.innerHTML = `
                <div style="padding:10px 14px;background:#1a1d2e;border-bottom:1px solid #2a2d3e;color:#E67E00;font-weight:bold;font-size:12px;border-radius:10px 10px 0 0">${title}</div>
                <div style="padding:10px 14px;font-size:12px;line-height:1.5">${body}</div>
                <div style="padding:0 14px 10px">
                    <button id="zm-hint-close" style="background:#1e2040;border:1px solid #3a3d5e;color:#e8eaf6;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:11px">Закрыть</button>
                </div>
            `;
            p.style.cssText = `position:fixed;bottom:18px;left:350px;z-index:999999;
                width:320px;background:#0f1117;color:#e8eaf6;border:1px solid #E67E00;
                border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.55);font:13px Arial`;
            document.body.appendChild(p);
            document.getElementById('zm-hint-close').onclick = () => p.remove();
            setTimeout(() => { if (p) p.remove(); }, 30000);
        }

        let lastUrl = location.href;
        setInterval(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                expanded = false;
                render();
                return;
            }

            const ae = document.activeElement;
            if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && ae.closest('#__zm_w')) {
                return;
            }

            const car = parseMannUrl();
            if (!car) return;
            const cached = GM_getValue('motul_car_' + car.cacheKey, null);
            const rolf   = GM_getValue('rolf_approvals_' + car.cacheKey, null);
            const rolfLen = rolf ? rolf.length : 0;

            const currentKey = car.cacheKey + '|' + (cached ? 'Y' : 'N') + '|R' + rolfLen + '|' + (expanded ? 'E' : 'T');
            if (currentKey !== lastRenderedKey) render();
        }, 1500);

        render();
    }

    // ══════════════════════════════════════════════════════════════════
    //                         КАЛЬКУЛЯТОР UI
    // ══════════════════════════════════════════════════════════════════

    function shouldDefaultToPartial(car, data) {
        const make = (car.makeShort || '').toLowerCase();
        const model = (car.modelShort || '').toLowerCase();

        if (data.automatic) {
            if (data.automatic.isCvt) return true;
            if (data.automatic.isDct) return true;
            const label = (data.automatic.label || '').toLowerCase();
            if (/dsg|dct|cvt|powershift|s\s*tronic|вариатор|робот|двойн[а-я]+ сцеплен/i.test(label)) return true;
        }

        const partialMakes = ['skoda', 'seat', 'audi', 'citroen', 'citroën', 'peugeot', 'renault',
                              'vw', 'volkswagen', 'volvo'];
        if (partialMakes.some(m => make.includes(m))) return true;

        if (make.includes('mazda') && /\b6\b/.test(model)) return true;
        if (make.includes('ford') && /kuga/.test(model)) return true;

        return false;
    }

    // ══════════════════════════════════════════════════════════════════
    //                    ФИЛЬТРЫ ДВС (парсинг + расчёт)
    // ══════════════════════════════════════════════════════════════════
    function parseFiltersInput(text) {
        const out = { vf: null, mf: null, sf: null };
        if (!text) return out;

        const TYPE_MAP = { 'вф': 'vf', 'мф': 'mf', 'сф': 'sf',
                           'ВФ': 'vf', 'МФ': 'mf', 'СФ': 'sf' };

        text.split(/\r?\n/).forEach(rawLine => {
            const line = rawLine.trim();
            if (!line) return;
            const m = line.match(/^(вф|мф|сф)\s+(.+?)\s*[-–—]\s*([\d\s]+)\s*(?:р|руб|₽)?\s*$/i);
            if (!m) return;
            const key = TYPE_MAP[m[1].toLowerCase()] || TYPE_MAP[m[1]];
            if (!key) return;
            const name = m[2].trim();
            const price = parseInt(m[3].replace(/\s+/g, ''), 10);
            if (!isFinite(price) || price <= 0) return;
            out[key] = { name, price };
        });
        return out;
    }

    function applyFiltersInput(text) {
        const parsed = parseFiltersInput(text);
        calcState.filtersRaw = text || '';

        if (!calcState.filters) calcState.filters = {};
        ['vf', 'mf', 'sf'].forEach(t => {
            if (!calcState.filters[t]) {
                const defaults = { vf: { work: 350 }, sf: { work: 550 }, mf: {} };
                calcState.filters[t] = { name: '', price: 0, enabled: false, ...defaults[t] };
            }
            const f = calcState.filters[t];
            if (parsed[t]) {
                f.name = parsed[t].name;
                f.price = parsed[t].price;
                f.enabled = true;
                if (t === 'vf' && !f.work) f.work = 350;
                if (t === 'sf' && !f.work) f.work = 550;
            } else {
                f.name = '';
                f.price = 0;
                f.enabled = false;
            }
        });
    }

    function filtersTotal() {
        const f = calcState.filters;
        let sum = 0;
        if (f.mf.enabled && f.mf.price) sum += f.mf.price;
        if (f.vf.enabled && f.vf.price) sum += f.vf.price + (f.vf.work || 0);
        if (f.sf.enabled && f.sf.price) sum += f.sf.price + (f.sf.work || 0);
        return sum;
    }

    function anyFilterEnabled() {
        const f = calcState.filters;
        return (f.mf.enabled && f.mf.price) || (f.vf.enabled && f.vf.price) || (f.sf.enabled && f.sf.price);
    }

    function renderCalculator(car, data) {
        const defaultPartial = shouldDefaultToPartial(car, data);

        if (calcState && calcState.car && calcState.car.cacheKey === car.cacheKey) {
            calcState.data = data;
            calcState.car = car;
        } else {
            calcState = {
                mileage: '<100',
                atpType: defaultPartial ? 'partial' : 'full',
                atpFilter: false,
                cvtFilterCoarse: false,
                cvtFilterFine: false,
                atpVolumeManual: null,
                volumeOverride: {},
                selected: new Set(),
                showApprovals: new Set(),    // legacy: показать допуска агрегата (внизу)
                expandedOilApp: new Set(),   // показать ВСЕ допуска у конкретного масла (per-oil)
                oilOverride: {},
                showOilPicker: null,
                ignoreApprovals: false,
                showWithSump: false,
                flush: 'none',
                filters: {
                    vf: { name: '', price: 0, enabled: false, work: 350 },
                    mf: { name: '', price: 0, enabled: false },
                    sf: { name: '', price: 0, enabled: false, work: 550 },
                },
                filtersRaw: '',
                showFiltersInput: false,
                totals: [],
                data: data,
                car: car,
            };
            if (data.engine) calcState.selected.add('engine');
        }

        return `
            <div class="zm-car">
                <div class="zm-car-t">${car.makeShort} ${car.modelShort}${car.engineName?' '+car.engineName:(car.volume?' '+car.volume:'')}</div>
                <div class="zm-car-sub">${data.motulName || '?'} · ${car.engineCode || '?'} · ${car.kw||'?'}кВт${car.bhp?' / '+car.bhp+'лс':''}${car.yearFrom?' · '+car.yearFrom:''}</div>
            </div>
            <div class="zm-ctrls">
                <div class="zm-ctrl-row">
                    <span class="zm-ctrl-lbl">Пробег:</span>
                    <button class="zm-chip ${calcState.mileage==='<100'?'zm-chip-act':''}" data-mileage="<100">до 100т</button>
                    <button class="zm-chip ${calcState.mileage==='>=100'?'zm-chip-act':''}" data-mileage=">=100">100т+</button>
                    <button class="zm-chip ${calcState.mileage==='>=200'?'zm-chip-act':''}" data-mileage=">=200">200т+</button>
                    <button class="zm-chip ${calcState.mileage==='0w20'?'zm-chip-act':''}" data-mileage="0w20">0W-20</button>
                </div>
                <div class="zm-ctrl-row" style="flex-wrap:wrap;gap:8px;margin-top:4px">
                    <label class="zm-chk" style="font-size:11px">
                        <input type="checkbox" id="zm-ignore-approvals" ${calcState.ignoreApprovals?'checked':''}/>
                        <span class="zm-chk-lbl" style="color:#ff9800">🔓 Игнорировать допуска</span>
                    </label>
                    <label class="zm-chk" style="font-size:11px">
                        <input type="checkbox" id="zm-show-sump" ${calcState.showWithSump?'checked':''}/>
                        <span class="zm-chk-lbl" style="color:#81c784">🪣 С картером (+550₽)</span>
                    </label>
                </div>
                <div class="zm-ctrl-row" style="margin-top:4px">
                    <span class="zm-ctrl-lbl">🧪 Промывка ДВС:</span>
                    <button class="zm-chip ${calcState.flush==='none'?'zm-chip-act':''}" data-flush="none">без промывки</button>
                    <button class="zm-chip zm-chip-flush ${calcState.flush==='5min'?'zm-chip-act':''}" data-flush="5min">5-минутка</button>
                    <button class="zm-chip zm-chip-flush ${calcState.flush==='full'?'zm-chip-act':''}" data-flush="full">полная</button>
                </div>
            </div>
            <div id="zm-filters"></div>
            <div id="zm-aggs"></div>
            <div id="zm-totals"></div>
            <div class="zm-result-wrap">
                <div class="zm-result-head">
                    <span>📋 Итог для копирования</span>
                    <button class="zm-btn zm-btn-sec" id="zm-copy">⧉ копировать</button>
                </div>
                <pre id="zm-result" class="zm-result"></pre>
            </div>
        `;
    }

    function bindCalcEvents(car, data) {
        document.querySelectorAll('[data-mileage]').forEach(b => {
            b.onclick = () => {
                document.querySelectorAll('[data-mileage]').forEach(x => x.classList.remove('zm-chip-act'));
                b.classList.add('zm-chip-act');
                calcState.mileage = b.dataset.mileage;
                rerenderAggs();
            };
        });

        const ignoreChk = document.getElementById('zm-ignore-approvals');
        if (ignoreChk) ignoreChk.onchange = () => {
            calcState.ignoreApprovals = ignoreChk.checked;
            rerenderAggs();
        };

        const sumpChk = document.getElementById('zm-show-sump');
        if (sumpChk) sumpChk.onchange = () => {
            calcState.showWithSump = sumpChk.checked;
            rerenderAggs();
        };

        document.querySelectorAll('[data-flush]').forEach(b => {
            b.onclick = () => {
                document.querySelectorAll('[data-flush]').forEach(x => x.classList.remove('zm-chip-act'));
                b.classList.add('zm-chip-act');
                calcState.flush = b.dataset.flush;
                rerenderAggs();
            };
        });

        document.getElementById('zm-copy').onclick = () => {
            const text = document.getElementById('zm-result').textContent;
            navigator.clipboard.writeText(text).then(() => {
                const btn = document.getElementById('zm-copy');
                const orig = btn.textContent;
                btn.textContent = '✓ скопировано';
                setTimeout(() => { btn.textContent = orig; }, 1500);
            });
        };

        rerenderFilters();
        rerenderAggs();
    }

    function getAggregates(data) {
        const out = [];
        if (data.engine) {
            const eng = { ...data.engine };
            eng.volume = eng.volumeService || eng.volumeTotal || eng.volumePlain || eng.volume || 0;
            eng.volumeType = eng.volumeService ? 'service' : (eng.volumeTotal ? 'total' : 'plain');
            out.push({ key:'engine', label:'ДВС (двигатель)', group:'engine', ...eng });
        }
        const pickTotal = (a) => {
            const r = { ...a };
            r.volume = r.volumeTotal || r.volumeService || r.volumePlain || r.volume || 0;
            r.volumeType = r.volumeTotal ? 'total' : (r.volumeService ? 'service' : 'plain');
            return r;
        };
        if (data.automatic && !data.automatic.isDct)
            out.push({ key:'automatic', label: data.automatic.isCvt ? 'Вариатор (CVT)' : 'АКПП', group:'auto', ...pickTotal(data.automatic) });
        if (data.manual)     out.push({ key:'manual',    label:'МКПП',                       group:'gear',   ...pickTotal(data.manual) });
        if (data.transfer)   out.push({ key:'transfer',  label:'Раздаточная коробка',         group:'gear',   ...pickTotal(data.transfer) });
        if (data.diffFront)  out.push({ key:'diffFront', label:'Дифференциал (перед)',        group:'gear',   ...pickTotal(data.diffFront) });
        if (data.diffRear)   out.push({ key:'diffRear',  label:'Дифференциал (зад)',          group:'gear',   ...pickTotal(data.diffRear) });
        return out;
    }

    function rerenderFilters() {
        const box = document.getElementById('zm-filters');
        if (!box) return;

        const f = calcState.filters;
        const hasAny = f.vf.name || f.mf.name || f.sf.name;

        if (!calcState.showFiltersInput && !hasAny) {
            box.innerHTML = `
                <button type="button" class="zm-btn-filters" id="zm-filters-open">➕ Добавить фильтра ДВС</button>
            `;
            document.getElementById('zm-filters-open').onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                calcState.showFiltersInput = true;
                rerenderFilters();
            };
            return;
        }

        if (calcState.showFiltersInput) {
            box.innerHTML = `
                <div class="zm-filters-panel">
                    <div class="zm-filters-head">
                        <span>🔧 Вставь список фильтров</span>
                        <button type="button" class="zm-btn zm-btn-sec" id="zm-filters-close">✕</button>
                    </div>
                    <textarea id="zm-filters-ta" class="zm-filters-ta" rows="4" placeholder="вф LYNX LA-502 LYNXauto - 1488р&#10;мф LYNX LC-331 LYNXauto - 330р&#10;сф LYNX LAC-333 auto - 1209р">${escapeHtml(calcState.filtersRaw)}</textarea>
                    <div class="zm-filters-btns">
                        <button type="button" class="zm-btn zm-btn-pri" id="zm-filters-apply">Применить</button>
                        ${hasAny ? `<button type="button" class="zm-btn zm-btn-sec" id="zm-filters-clear">Очистить</button>` : ''}
                    </div>
                    <div class="zm-filters-hint">Формат: <code>тип название - ценар</code>. Тип: <b>вф</b>/<b>мф</b>/<b>сф</b></div>
                    <div id="zm-filters-debug" style="margin-top:6px;font-size:10px;color:#5a6070"></div>
                </div>
                ${hasAny ? renderFiltersList() : ''}
            `;

            document.getElementById('zm-filters-close').onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                calcState.showFiltersInput = false;
                rerenderFilters();
            };
            document.getElementById('zm-filters-apply').onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                try {
                    const ta = document.getElementById('zm-filters-ta');
                    const txt = ta ? ta.value : '';
                    const dbg = document.getElementById('zm-filters-debug');
                    const parsed = parseFiltersInput(txt);
                    const found = ['vf','mf','sf'].filter(t => parsed[t]);
                    if (dbg) dbg.textContent = `Распознано: ${found.length} шт (${found.join(', ') || 'ни одного'})`;
                    applyFiltersInput(txt);
                    if (found.length) calcState.showFiltersInput = false;
                    rerenderFilters();
                    rerenderAggs();
                } catch (err) {
                    const dbg = document.getElementById('zm-filters-debug');
                    if (dbg) dbg.textContent = '❌ Ошибка: ' + err.message;
                }
            };
            const clearBtn = document.getElementById('zm-filters-clear');
            if (clearBtn) clearBtn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                applyFiltersInput('');
                rerenderFilters();
                rerenderAggs();
            };
        } else {
            box.innerHTML = `
                <div class="zm-filters-list-wrap">
                    <div class="zm-filters-head">
                        <span>🔧 Фильтра ДВС</span>
                        <div style="display:flex;gap:4px">
                            <button type="button" class="zm-btn zm-btn-sec" id="zm-filters-edit">✎ изменить</button>
                        </div>
                    </div>
                    ${renderFiltersList()}
                </div>
            `;
            document.getElementById('zm-filters-edit').onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                calcState.showFiltersInput = true;
                rerenderFilters();
            };
        }

        bindFilterEvents();
    }

    function renderFiltersList() {
        const f = calcState.filters;
        const rows = [];

        if (f.vf.name) {
            rows.push(`
                <div class="zm-filter-row" data-ftype="vf">
                    <label class="zm-chk">
                        <input type="checkbox" data-ftoggle="vf" ${f.vf.enabled?'checked':''}/>
                        <span class="zm-chk-lbl"><b>ВФ</b> ${escapeHtml(f.vf.name)} — ${f.vf.price}₽</span>
                    </label>
                    <div class="zm-filter-work">
                        <span class="zm-ctrl-lbl">установка:</span>
                        <button class="zm-chip ${f.vf.work===0?'zm-chip-act':''}" data-fwork="vf:0">без работы</button>
                        <button class="zm-chip ${f.vf.work===350?'zm-chip-act':''}" data-fwork="vf:350">защёлки 350₽</button>
                        <button class="zm-chip ${f.vf.work===600?'zm-chip-act':''}" data-fwork="vf:600">болты 600₽</button>
                        <button class="zm-chip ${f.vf.work===1150?'zm-chip-act':''}" data-fwork="vf:1150">разбор 1150₽</button>
                    </div>
                </div>
            `);
        }
        if (f.mf.name) {
            rows.push(`
                <div class="zm-filter-row" data-ftype="mf">
                    <label class="zm-chk">
                        <input type="checkbox" data-ftoggle="mf" ${f.mf.enabled?'checked':''}/>
                        <span class="zm-chk-lbl"><b>МФ</b> ${escapeHtml(f.mf.name)} — ${f.mf.price}₽</span>
                    </label>
                    <div class="zm-filter-work-none">меняется при замене масла</div>
                </div>
            `);
        }
        if (f.sf.name) {
            rows.push(`
                <div class="zm-filter-row" data-ftype="sf">
                    <label class="zm-chk">
                        <input type="checkbox" data-ftoggle="sf" ${f.sf.enabled?'checked':''}/>
                        <span class="zm-chk-lbl"><b>СФ</b> ${escapeHtml(f.sf.name)} — ${f.sf.price}₽</span>
                    </label>
                    <div class="zm-filter-work">
                        <span class="zm-ctrl-lbl">установка:</span>
                        <button class="zm-chip ${f.sf.work===0?'zm-chip-act':''}" data-fwork="sf:0">без работы</button>
                        <button class="zm-chip ${f.sf.work===550?'zm-chip-act':''}" data-fwork="sf:550">бардачок 550₽</button>
                        <button class="zm-chip ${f.sf.work===990?'zm-chip-act':''}" data-fwork="sf:990">под педалью 990₽</button>
                    </div>
                </div>
            `);
        }
        return rows.length ? `<div class="zm-filters-list">${rows.join('')}</div>` : '';
    }

    function bindFilterEvents() {
        document.querySelectorAll('[data-ftoggle]').forEach(ck => ck.onchange = () => {
            const t = ck.dataset.ftoggle;
            calcState.filters[t].enabled = ck.checked;
            rerenderAggs();
        });
        document.querySelectorAll('[data-fwork]').forEach(b => b.onclick = () => {
            const [t, v] = b.dataset.fwork.split(':');
            calcState.filters[t].work = parseInt(v, 10);
            rerenderFilters();
            rerenderAggs();
        });
    }

    function rerenderAggs() {
        const box = document.getElementById('zm-aggs');
        if (!box) return;

        let savedFocus = null;
        const ae = document.activeElement;
        if (ae && ae.dataset && ae.dataset.volKey) {
            savedFocus = {
                key: ae.dataset.volKey,
                value: ae.value,
                selStart: ae.selectionStart,
                selEnd: ae.selectionEnd,
            };
        }

        const aggs = getAggregates(calcState.data);

        if (!aggs.length) {
            box.innerHTML = `
                <div class="zm-warn">
                    ⚠️ Ни один агрегат не распознан из данных Motul.<br>
                    <small style="color:#7986cb">Возможно названия агрегатов нестандартные.</small>
                </div>
                <details class="zm-raw-dump">
                    <summary style="cursor:pointer;color:#E67E00;font-size:11px;padding:6px 0">Посмотреть что пришло с Motul</summary>
                    <pre style="background:#0a0c12;padding:8px;border-radius:4px;font-size:10px;color:#9aa0b0;max-height:260px;overflow:auto;white-space:pre-wrap;word-break:break-all">${escapeHtml(JSON.stringify(calcState.data, null, 2))}</pre>
                </details>
            `;
            return;
        }

        let dctNotice = '';
        if (calcState.data.automatic && calcState.data.automatic.isDct) {
            dctNotice = `
            <div class="zm-dct-notice">
                💧 <b>${calcState.data.automatic.label || 'Роботизированная коробка'}</b><br>
                <small>Коробка с мокрым сцеплением — замену масла не считаем</small>
            </div>`;
        }

        // Метка режима вязкости
        const mileage = calcState.mileage;
        let viscLabel = '';
        if (mileage === '>=200') viscLabel = '<span class="zm-visc-badge zm-visc-10w40">10W-40 (200т+)</span>';
        else if (mileage === '0w20') viscLabel = '<span class="zm-visc-badge zm-visc-0w20">0W-20</span>';
        else if (mileage === '>=100') viscLabel = '<span class="zm-visc-badge">5W-40</span>';
        else viscLabel = '<span class="zm-visc-badge">5W-30</span>';

        box.innerHTML = dctNotice + (viscLabel ? `<div style="padding:4px 14px 0">${viscLabel}</div>` : '') + aggs.map(agg => {
            const calc = calcForAggregate(agg);
            const checked = calcState.selected.has(agg.key);
            const showApp = calcState.showApprovals.has(agg.key);

            return `
            <div class="zm-agg ${calc.isHighGear ? 'zm-bath' : ''}" data-key="${agg.key}">
                <div class="zm-agg-head">
                    <label class="zm-chk">
                        <input type="checkbox" data-sel="${agg.key}" ${checked?'checked':''}/>
                        <span class="zm-chk-lbl">${agg.label}</span>
                    </label>
                    <span class="zm-agg-vol">${calc.volumeStr}</span>
                </div>
                ${calc.isHighGear
                    ? `<div class="zm-bath-msg">🛁 послан в баню!</div>`
                    : calc.html}
                <button class="zm-app-btn" data-app="${agg.key}">
                    ${showApp ? '▾' : '▸'} допуска машины (${(agg.approvals||[]).length})
                </button>
                ${showApp ? `<div class="zm-app-list">${(agg.approvals||[]).map(x=>`<span class="zm-app-tag">${x}</span>`).join('') || '<i>допуски не определены</i>'}</div>` : ''}
            </div>`;
        }).join('');

        // АКПП/CVT контролы
        if (calcState.data.automatic && !calcState.data.automatic.isDct) {
            const atpBox = box.querySelector('[data-key="automatic"]');
            if (atpBox) {
                const atp = calcState.data.automatic;
                const isCvt = atp.isCvt;
                const typeLabel = isCvt ? 'ВАРИАТОР (CVT)' : 'АКПП';
                const fullMult = '×1.5';
                const partMult = isCvt ? '×0.8' : '×0.6';

                const brand = (calcState.car?.makeShort || '').toUpperCase();
                const model = (calcState.car?.modelShort || '').toUpperCase();
                const noFullBrands = ['SKODA', 'SEAT', 'AUDI', 'CITROEN', 'CITROËN', 'PEUGEOT', 'RENAULT', 'VOLKSWAGEN', 'VW', 'VOLVO'];
                const noFullModels = [
                    { brand: 'MAZDA', model: '6' },
                    { brand: 'FORD',  model: 'KUGA' },
                ];
                let cantFull = noFullBrands.includes(brand);
                if (!cantFull) cantFull = noFullModels.some(x => brand === x.brand && model.indexOf(x.model) !== -1);
                const noFullWarn = cantFull
                    ? `<div class="zm-no-full-warn">⚠ У этой машины полную замену не делаем</div>`
                    : '';

                const ctrls = `
                    <div class="zm-atp-ctrls">
                        <div class="zm-atp-type">${typeLabel}</div>
                        <div class="zm-ctrl-row">
                            <span class="zm-ctrl-lbl">Замена:</span>
                            <button class="zm-chip ${calcState.atpType==='full'?'zm-chip-act':''}" data-atp="full">Полная ${fullMult}</button>
                            <button class="zm-chip ${calcState.atpType==='partial'?'zm-chip-act':''}" data-atp="partial">Частичная ${partMult}</button>
                        </div>
                        ${noFullWarn}
                        ${isCvt ? `
                        <label class="zm-chk">
                            <input type="checkbox" id="zm-cvt-filter-coarse" ${calcState.cvtFilterCoarse?'checked':''}/>
                            <span class="zm-chk-lbl">Фильтр грубой очистки (+1700₽)</span>
                        </label>
                        <label class="zm-chk">
                            <input type="checkbox" id="zm-cvt-filter-fine" ${calcState.cvtFilterFine?'checked':''}/>
                            <span class="zm-chk-lbl">Фильтр тонкой очистки (+3350₽)</span>
                        </label>
                        ` : `
                        <label class="zm-chk">
                            <input type="checkbox" id="zm-atp-filter" ${calcState.atpFilter?'checked':''}/>
                            <span class="zm-chk-lbl">Фильтр АКПП (+1700₽)</span>
                        </label>
                        `}
                    </div>`;
                atpBox.querySelector('.zm-agg-head').insertAdjacentHTML('afterend', ctrls);
            }
        }

        // события
        box.querySelectorAll('[data-sel]').forEach(c => c.onchange = () => {
            if (c.checked) calcState.selected.add(c.dataset.sel);
            else calcState.selected.delete(c.dataset.sel);
            rerenderResult();
        });

        box.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
            const k = b.dataset.pick;
            calcState.showOilPicker = calcState.showOilPicker === k ? null : k;
            rerenderAggs();
        });

        box.querySelectorAll('[data-reg-info]').forEach(b => b.onclick = (e) => {
            e.stopPropagation();
            try {
                const matches = JSON.parse(b.dataset.regInfo);
                showReglamentPopup(matches);
            } catch {}
        });

        box.querySelectorAll('[data-opt]').forEach(b => b.onclick = () => {
            const key = calcState.showOilPicker;
            if (!key) return;
            calcState.oilOverride[key + '_mid'] = b.dataset.opt;
            calcState.showOilPicker = null;
            rerenderAggs();
        });

        box.querySelectorAll('[data-vol-key]').forEach(inp => {
            inp.onchange = () => {
                const k = inp.dataset.volKey;
                const v = parseFloat(inp.value);
                if (isFinite(v) && v > 0) {
                    calcState.volumeOverride[k] = v;
                } else {
                    delete calcState.volumeOverride[k];
                }
                rerenderAggs();
            };
            inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } };
        });
        box.querySelectorAll('[data-vol-reset]').forEach(b => b.onclick = () => {
            delete calcState.volumeOverride[b.dataset.volReset];
            rerenderAggs();
        });
        box.querySelectorAll('[data-app]').forEach(b => b.onclick = () => {
            const k = b.dataset.app;
            if (calcState.showApprovals.has(k)) calcState.showApprovals.delete(k);
            else calcState.showApprovals.add(k);
            rerenderAggs();
        });
        // Раскрытие "остальные допуска" у конкретного масла
        box.querySelectorAll('[data-oilapp]').forEach(b => b.onclick = (e) => {
            e.stopPropagation();
            const k = b.dataset.oilapp;
            if (calcState.expandedOilApp.has(k)) calcState.expandedOilApp.delete(k);
            else calcState.expandedOilApp.add(k);
            rerenderAggs();
        });
        box.querySelectorAll('[data-atp]').forEach(b => b.onclick = () => {
            calcState.atpType = b.dataset.atp;
            rerenderAggs();
        });
        const fltChk = document.getElementById('zm-atp-filter');
        if (fltChk) fltChk.onchange = () => {
            calcState.atpFilter = fltChk.checked;
            rerenderAggs();
        };
        const cvtC = document.getElementById('zm-cvt-filter-coarse');
        if (cvtC) cvtC.onchange = () => {
            calcState.cvtFilterCoarse = cvtC.checked;
            rerenderAggs();
        };
        const cvtF = document.getElementById('zm-cvt-filter-fine');
        if (cvtF) cvtF.onchange = () => {
            calcState.cvtFilterFine = cvtF.checked;
            rerenderAggs();
        };

        if (savedFocus) {
            const newInp = box.querySelector(`[data-vol-key="${savedFocus.key}"]`);
            if (newInp) {
                newInp.value = savedFocus.value;
                newInp.focus();
                try { newInp.setSelectionRange(savedFocus.selStart, savedFocus.selEnd); } catch {}
            }
        }

        rerenderTotals();
        rerenderResult();
    }

    // ══════════════════════════════════════════════════════════════════
    //                    ОБЩИЕ СТОИМОСТИ (наборы)
    // ══════════════════════════════════════════════════════════════════
    function totalAggLabel(agg) {
        if (agg.key === 'engine') return 'двс';
        if (agg.key === 'automatic') return agg.isCvt ? 'вариатор' : 'акпп';
        if (agg.key === 'manual')    return 'мкпп';
        if (agg.key === 'transfer')  return 'раздатка';
        if (agg.key === 'diffFront') return 'диф.перед';
        if (agg.key === 'diffRear')  return 'диф.зад';
        return agg.key;
    }

    function totalOilLabel(oil) {
        return `${oil.b} ${oil.n}`;
    }

    function rerenderTotals() {
        const box = document.getElementById('zm-totals');
        if (!box) return;
        if (!calcState || !calcState.totals) calcState.totals = [];

        const aggs = getAggregates(calcState.data).filter(a => calcState.selected.has(a.key));
        const aggData = aggs.map(agg => {
            const calc = calcForAggregate(agg);
            return { agg, calc };
        }).filter(x => x.calc.costs && x.calc.costs.length);

        if (!aggData.length) {
            box.innerHTML = '';
            return;
        }

        const totalsHtml = calcState.totals.map((tot, idx) => {
            const rowsHtml = aggData.map(({ agg, calc }) => {
                const sel = tot[agg.key];
                const opts = calc.costs.map((c, i) => {
                    const checked = sel === i ? 'checked' : '';
                    return `<label class="zm-tot-opt">
                        <input type="radio" name="zm-tot-${idx}-${agg.key}" data-tot="${idx}" data-agg="${agg.key}" value="${i}" ${checked}/>
                        <span>${escapeHtml(totalOilLabel(c.oil))} — ${c.total}₽</span>
                    </label>`;
                }).join('');
                const skipChecked = (sel === undefined || sel === 'skip') ? 'checked' : '';
                return `
                    <div class="zm-tot-row">
                        <div class="zm-tot-row-h">${totalAggLabel(agg)}</div>
                        ${opts}
                        <label class="zm-tot-opt zm-tot-opt-skip">
                            <input type="radio" name="zm-tot-${idx}-${agg.key}" data-tot="${idx}" data-agg="${agg.key}" value="skip" ${skipChecked}/>
                            <span>не включать</span>
                        </label>
                    </div>
                `;
            }).join('');

            const totalSum = computeTotalSum(tot, aggData);
            const sumpAdd = calcState.showWithSump && totalSum.hasEngine ? 550 : 0;
            const displaySum = totalSum.sum + sumpAdd;
            const sumpSuffix = sumpAdd ? ` + 550₽ картер = <b>${displaySum}₽</b>` : '';

            return `
                <div class="zm-tot-block">
                    <div class="zm-tot-block-h">
                        <span>Стоимость #${idx + 1}: <b>${totalSum.sum}₽</b>${sumpSuffix}</span>
                        <button class="zm-btn zm-btn-sec" data-tot-del="${idx}">✕</button>
                    </div>
                    ${rowsHtml}
                </div>
            `;
        }).join('');

        box.innerHTML = `
            <div class="zm-totals-wrap">
                ${totalsHtml}
                <button class="zm-btn-filters" id="zm-tot-add">+ Добавить общую стоимость</button>
            </div>
        `;

        const addBtn = document.getElementById('zm-tot-add');
        if (addBtn) addBtn.onclick = () => {
            calcState.totals.push({});
            rerenderTotals();
            rerenderResult();
        };

        box.querySelectorAll('input[type="radio"][data-tot]').forEach(r => r.onchange = () => {
            const ti = parseInt(r.dataset.tot, 10);
            const ak = r.dataset.agg;
            const v = r.value;
            if (!calcState.totals[ti]) calcState.totals[ti] = {};
            calcState.totals[ti][ak] = v === 'skip' ? 'skip' : parseInt(v, 10);
            rerenderTotals();
            rerenderResult();
        });

        box.querySelectorAll('[data-tot-del]').forEach(b => b.onclick = () => {
            const i = parseInt(b.dataset.totDel, 10);
            calcState.totals.splice(i, 1);
            rerenderTotals();
            rerenderResult();
        });
    }

    function computeTotalSum(tot, aggData) {
        let sum = 0;
        let hasEngine = false;
        for (const { agg, calc } of aggData) {
            const sel = tot[agg.key];
            if (sel === undefined || sel === 'skip') continue;
            const c = calc.costs[sel];
            if (!c) continue;
            sum += c.total;
            if (agg.key === 'engine') hasEngine = true;
        }
        return { sum, hasEngine };
    }

    function buildTotalsLines() {
        if (!calcState || !calcState.totals || !calcState.totals.length) return [];

        const aggs = getAggregates(calcState.data).filter(a => calcState.selected.has(a.key));
        const aggData = aggs.map(agg => ({ agg, calc: calcForAggregate(agg) }))
            .filter(x => x.calc.costs && x.calc.costs.length);

        const lines = [];
        for (const tot of calcState.totals) {
            const parts = [];
            let sum = 0;
            let hasEngine = false;
            for (const { agg, calc } of aggData) {
                const sel = tot[agg.key];
                if (sel === undefined || sel === 'skip') continue;
                const c = calc.costs[sel];
                if (!c) continue;
                parts.push(`${c.total}(${totalAggLabel(agg)} ${totalOilLabel(c.oil)})`);
                sum += c.total;
                if (agg.key === 'engine') hasEngine = true;
            }
            if (!parts.length) continue;

            if (calcState.showWithSump && hasEngine) {
                const total = sum + 550;
                lines.push(`${parts.join(' + ')} + 550(картер) = ${total}₽`);
            } else {
                lines.push(`${parts.join(' + ')} = ${sum}₽`);
            }
        }
        return lines;
    }

    // ══════════════════════════════════════════════════════════════════
    //                    РАСЧЁТ ДЛЯ АГРЕГАТА
    // ══════════════════════════════════════════════════════════════════
    function calcForAggregate(agg) {
        if (agg.key === 'manual' && agg.rawText && /HIGH\s*GEAR|HIGHGEAR|HI[\s\-]?GEAR/i.test(agg.rawText)) {
            return { isHighGear: true, html: '' };
        }

        const shopOils = getShopOils();
        const defaults = getDefaults();
        const isCvt = agg.group === 'auto' && agg.isCvt;

        const v0 = parseFloat(agg.volume || 0);
        const vFilter = parseFloat(agg.filterVolume || 0);
        let vService = v0 + vFilter;
        let overrideUsed = false;

        const override = parseFloat(calcState.volumeOverride[agg.key]);
        if (isFinite(override) && override > 0) {
            vService = override;
            overrideUsed = true;
        } else if (agg.group === 'auto' && vService === 0 && calcState.atpVolumeManual) {
            vService = calcState.atpVolumeManual;
            overrideUsed = true;
        }

        const v0Display = v0 || 0;
        const vFilterDisplay = vFilter || 0;
        const motulVol = v0Display + vFilterDisplay;
        const currentVol = overrideUsed ? vService : (motulVol || '');
        const volEditHtml = `
            <div class="zm-vol-edit">
                <span class="zm-ctrl-lbl">Объём:</span>
                <input type="number" step="0.1" min="0" class="zm-vol-input" data-vol-key="${agg.key}"
                    value="${currentVol}" placeholder="${motulVol || '?'}"/>
                <span class="zm-ctrl-lbl">л ${motulVol ? `<span class="zm-vol-motul">(Motul: ${motulVol}л)</span>` : '<span class="zm-vol-motul zm-vol-warn">(Motul не дал)</span>'}</span>
                ${overrideUsed ? `<button class="zm-vol-reset" data-vol-reset="${agg.key}" title="Сбросить к Motul">↺</button>` : ''}
            </div>
        `;

        let vCalc, formula, volumeStr;
        if (agg.group === 'auto') {
            if (vService === 0) {
                return {
                    html: `
                        ${volEditHtml}
                        <div class="zm-warn" style="padding:8px 10px;font-size:11px;background:#2a1d00;border:1px solid #E67E00;border-radius:6px;margin-top:6px;color:#ff9800">⚠ Введи объём заправки АКПП в поле выше — Motul не дал</div>
                    `,
                    costs: [], vCalc: 0, formula: '', volumeStr: '—', oils: [],
                };
            }
            if (calcState.atpType === 'full') {
                const mult = 1.5;
                const vRaw = vService * mult;
                vCalc = Math.max(12, Math.ceil(vRaw));
                formula = `${vService}×${mult}=${vRaw.toFixed(2)}л → ${vCalc}л (мин 12)`;
                volumeStr = `полн: ${vCalc}л`;
            } else {
                const mult = isCvt ? 0.8 : 0.6;
                const minVol = 4;
                const vRaw = vService * mult;
                vCalc = Math.max(minVol, Math.round(vRaw * 10) / 10);
                formula = `${vService}×${mult}=${vRaw.toFixed(2)}л → ${vCalc}л (мин ${minVol})`;
                volumeStr = `част: ${vCalc}л`;
            }
        } else {
            vCalc = vService;
            formula = vFilter ? `${v0} + ${vFilter} (фильтр) = ${vService}л` : `${vService}л`;
            volumeStr = `${vService}л`;
        }

        // Подбор масел
        let oil1, oil2;
        if (agg.group === 'engine') {
            const picks = pickEngineOils(agg, shopOils);
            oil1 = picks.mid;
            oil2 = picks.spot;

            const overrideKey = calcState.oilOverride[agg.key + '_mid'];
            if (overrideKey) {
                const found = (agg.allCandidates || []).find(o => (o.b + '_' + o.n) === overrideKey);
                if (found) oil1 = found;
            }
        } else if (agg.group === 'auto') {
            if (isCvt) {
                oil1 = defaults.cvt[0];
                oil2 = defaults.cvt[1];
            } else {
                oil1 = defaults.atf[0];
                oil2 = defaults.atf[1];
            }
        } else {
            const isCvtGear = agg.rawText && /CVT/i.test(agg.rawText);
            const defs = isCvtGear ? defaults.cvt : defaults.gear75W90;
            oil1 = defs[0];
            oil2 = defs[1];
        }

        // Стоимость
        const calcFlushCost = (vol) => {
            if (calcState.flush === '5min') {
                return { cost: 1180, breakdown: '630 (промыв.масло) + 550 (услуга)', label: '5-минутка' };
            }
            if (calcState.flush === 'full') {
                const litres = +(vol * 0.9).toFixed(1);
                const oilCost = Math.round(litres * 300);
                const cost = oilCost + 550;
                return { cost, breakdown: `${litres}л × 300 + 550 (услуга)`, label: 'полная промывка' };
            }
            return null;
        };

        const costs = [oil1, oil2].filter(Boolean).map(oil => {
            const price = oil.price;
            let total, breakdown;
            if (agg.group === 'engine') {
                const fTotal = filtersTotal();
                const flush = calcFlushCost(vCalc);
                const flushAdd = flush ? flush.cost : 0;
                total = price * vCalc + fTotal + flushAdd;
                const parts = [`${price} × ${vCalc}`];
                if (fTotal > 0) parts.push(`${fTotal} (фильтра)`);
                if (flush) parts.push(`${flush.cost} (${flush.label})`);
                breakdown = parts.join(' + ');
            } else if (agg.group === 'auto') {
                const isPartial = calcState.atpType === 'partial';
                const baseLabor = 550 + (isPartial ? 1210 : 0);
                if (isCvt) {
                    const fltC = calcState.cvtFilterCoarse ? 1700 : 0;
                    const fltF = calcState.cvtFilterFine ? 3350 : 0;
                    total = price * vCalc + baseLabor + fltC + fltF;
                    const laborParts = ['550'];
                    if (isPartial) laborParts.push('1210');
                    const fltParts = [];
                    if (fltC) fltParts.push('1700 грубый');
                    if (fltF) fltParts.push('3350 тонкий');
                    breakdown = `${price} × ${vCalc} + ${laborParts.join(' + ')}${fltParts.length?' + '+fltParts.join(' + '):''}`;
                } else {
                    const flt = calcState.atpFilter ? 1700 : 0;
                    total = price * vCalc + baseLabor + flt;
                    const laborParts = ['550'];
                    if (isPartial) laborParts.push('1210');
                    breakdown = `${price} × ${vCalc} + ${laborParts.join(' + ')}${flt?' + 1700 (фильтр)':''}`;
                }
            } else {
                const labor = 1900 + 550;
                total = price * vCalc + labor;
                breakdown = `${price} × ${vCalc} + 1900 + 550`;
            }
            return { oil, total: Math.round(total), breakdown };
        });

        // HTML блока
        const mileage = calcState.mileage;
        const isFixedSingle = (mileage === '>=200');

        // Плашка формулы промывки
        let flushBox = '';
        if (agg.group === 'engine' && calcState.flush !== 'none') {
            const flushInfo = calcFlushCost(vCalc);
            if (flushInfo) {
                if (calcState.flush === '5min') {
                    flushBox = `
                        <div class="zm-flush-box">
                            🧪 <b>5-минутка</b>:
                            <span class="zm-flush-formula">630₽ (промыв.масло, 1 бутылка фикс) + 550₽ (услуга)</span>
                            = <b class="zm-flush-total">${flushInfo.cost}₽</b>
                        </div>
                    `;
                } else if (calcState.flush === 'full') {
                    const litres = +(vCalc * 0.9).toFixed(1);
                    const oilCost = Math.round(litres * 300);
                    flushBox = `
                        <div class="zm-flush-box">
                            🧪 <b>Полная промывка</b>:
                            <span class="zm-flush-formula">${vCalc}л × 0.9 = ${litres}л × 300₽/л = ${oilCost}₽ + 550₽ (услуга)</span>
                            = <b class="zm-flush-total">${flushInfo.cost}₽</b>
                        </div>
                    `;
                }
            }
        }

        // Для двигателя: вычисляем список присадок, исключая совпадения со SPOT
        // (SPOT всегда показывает свои 4, другие масла — то что у них есть, минус пересечение)
        const spotOilForAdds = (agg.group === 'engine')
            ? costs.find(c => c.oil && c.oil.isSpot)
            : null;
        const spotAddsLower = spotOilForAdds
            ? new Set((spotOilForAdds.oil.ad || []).map(a => normalizeAdditive(a)))
            : new Set();

        const html = `
            ${volEditHtml}
            <div class="zm-formula">📐 ${formula}</div>
            ${flushBox}
            ${costs.map((c, i) => {
                const canPick = agg.group === 'engine' && i === 0 && !c.oil.isSpot &&
                                !isFixedSingle &&
                                agg.allCandidates && agg.allCandidates.length > 1;
                const regMatches = (agg.group === 'engine')
                    ? matchOilToReglament(c.oil, calcState.car?.makeShort)
                    : [];
                const regBadge = regMatches.length
                    ? `<button class="zm-reg-badge" data-reg-info="${escapeHtmlSafe(JSON.stringify(regMatches))}" title="Совпадение с регламентом — нажми">⭐ⓘ</button>`
                    : '';

                const sumpSuffix = (agg.group === 'engine' && calcState.showWithSump)
                    ? ` + 550₽ (картер) = <b class="zm-oil-total zm-oil-total-sump">${c.total + 550}₽</b>`
                    : '';

                // НОВОЕ: блок допусков масла и присадок (только для двигателя)
                let oilDetailsHtml = '';
                if (agg.group === 'engine') {
                    oilDetailsHtml = renderOilDetailsBlock(agg, c.oil, i, spotAddsLower);
                }

                return `
                <div class="zm-oil-line ${regMatches.length ? 'zm-oil-line-reg' : ''}">
                    <div class="zm-oil-name">
                        ${canPick
                            ? `<button class="zm-oil-pick-btn" data-pick="${agg.key}">${c.oil.b} ${c.oil.n} ▾</button>`
                            : `${c.oil.b} ${c.oil.n}`}
                        ${regBadge}
                    </div>
                    <div class="zm-oil-calc">${c.breakdown} = <b class="zm-oil-total">${c.total}₽</b>${sumpSuffix}</div>
                    <div class="zm-oil-price">${c.oil.price}₽/л</div>
                    ${oilDetailsHtml}
                </div>`;
            }).join('')}
            ${agg.group === 'engine' && calcState.showOilPicker === agg.key && agg.allCandidates && !isFixedSingle ? `
                <div class="zm-oil-picker">
                    <div class="zm-oil-picker-head">Выбери масло (${agg.allCandidates.length} подходящих):</div>
                    ${agg.allCandidates.map(o => {
                        const isCurrent = (costs[0] && (costs[0].oil.b + '_' + costs[0].oil.n) === (o.b + '_' + o.n));
                        const regOpt = matchOilToReglament(o, calcState.car?.makeShort);
                        const regMark = regOpt.length ? '<span class="zm-reg-mark" title="по регламенту">⭐</span>' : '';
                        return `<button class="zm-oil-opt ${isCurrent?'zm-oil-opt-act':''} ${regOpt.length?'zm-oil-opt-reg':''}" data-opt="${o.b}_${o.n}">
                            <span class="zm-oil-opt-name">${regMark} ${o.b} ${o.n}</span>
                            <span class="zm-oil-opt-price">${o.price}₽/л</span>
                        </button>`;
                    }).join('')}
                </div>
            ` : ''}
        `;

        return { html, costs, vCalc, formula, volumeStr, oils: [oil1, oil2].filter(Boolean) };
    }

    // ── Нормализация имени присадки для сравнения ──
    function normalizeAdditive(s) {
        return String(s || '').toLowerCase()
            .replace(/[ёе]/g, 'е')
            .replace(/[\s\-\/]+/g, '')
            .trim();
    }

    // ── Рендер блока "допуска масла" + "присадки" (под строкой масла) ──
    // Метчатся ВСЕГДА если есть допуска машины (ROLF). Кнопка "допуска" видна ВСЕГДА —
    // раскрывает остальные (не совпавшие) допуска масла.
    function renderOilDetailsBlock(agg, oil, idx, spotAddsLower) {
        const oilKey = agg.key + '_' + idx + '_' + oil.b + '_' + oil.n;
        const isExpanded = calcState.expandedOilApp.has(oilKey);
        const carApprovals = agg.approvals || [];

        // Разбить допуска масла на matched / others (относительно машины)
        const { matched, others } = splitOilApprovals(oil.a || [], carApprovals);

        // Если допусков машины ещё нет ИЛИ режим "игнор" — matched пустой, всё в others
        const hasCarApprovals = carApprovals.length > 0 && !calcState.ignoreApprovals;

        const matchedHtml = (hasCarApprovals && matched.length)
            ? `<div class="zm-oil-app-matched">
                ${matched.map(a => `<span class="zm-oil-app-pill zm-oil-app-match" title="Совпадает с допуском машины">${escapeHtml(a)}</span>`).join('')}
               </div>`
            : '';

        // Кнопка "допуска" — ВСЕГДА видна (даже если все совпали — может быть other пустой, кнопка покажет 0)
        const btnLabel = hasCarApprovals
            ? `допуска +${others.length}`
            : `допуска (${(oil.a || []).length})`;
        const appBtn = `<button class="zm-oil-app-btn ${isExpanded?'zm-oil-app-btn-open':''}" data-oilapp="${escapeHtmlSafe(oilKey)}">${isExpanded?'▾':'▸'} ${btnLabel}</button>`;

        // Развёрнутый список — показываем все допуска (matched + others), но others — без подсветки
        let expandedHtml = '';
        if (isExpanded) {
            const listToShow = hasCarApprovals
                ? others.map(a => `<span class="zm-oil-app-pill">${escapeHtml(a)}</span>`)
                : (oil.a || []).map(a => `<span class="zm-oil-app-pill">${escapeHtml(a)}</span>`);
            expandedHtml = `<div class="zm-oil-app-others">${listToShow.join('') || '<i style="color:#5a6070;font-size:10px">нет дополнительных</i>'}</div>`;
        }

        // ── Присадки ──
        // Если это SPOT — показываем все его присадки полностью.
        // Иначе — исключаем те, что уже есть у SPOT.
        let myAds = oil.ad || [];
        if (!oil.isSpot && spotAddsLower && spotAddsLower.size) {
            myAds = myAds.filter(a => !spotAddsLower.has(normalizeAdditive(a)));
        }

        const adsHtml = myAds.length
            ? `<div class="zm-oil-ads">
                ${myAds.map(a => `<span class="zm-oil-ad-pill${oil.isSpot?' zm-oil-ad-pill-spot':''}">${escapeHtml(a)}</span>`).join('')}
               </div>`
            : '';

        return `
            <div class="zm-oil-details">
                ${matchedHtml}
                ${appBtn}
                ${expandedHtml}
                ${adsHtml}
            </div>
        `;
    }

    // ══════════════════════════════════════════════════════════════════
    //                    ПОДБОР МОТОРНОГО МАСЛА
    // ══════════════════════════════════════════════════════════════════
    function pickEngineOils(agg, shopOils) {
        const mileage = calcState.mileage;

        if (mileage === '>=200') {
            const oils10w40 = shopOils.filter(o => o.v === '10W-40' && !o.isSpot);
            const oil = oils10w40[0] || { b:'Mobil', n:'Ultra 10W-40', price:1150, v:'10W-40', a:['API SN'], ad:[] };
            agg.approvals = [];
            agg.allCandidates = oils10w40;
            agg.topCandidates = [oil];
            return { mid: oil, spot: null };
        }

        if (mileage === '0w20') {
            const oils0w20 = shopOils.filter(o => o.v === '0W-20' && !o.isSpot);
            const car0w = calcState.car;
            const rolf0w = GM_getValue('rolf_approvals_' + car0w.cacheKey, null);
            const carApp0w = Array.isArray(rolf0w) ? rolf0w : [];
            const carTok0w = calcState.ignoreApprovals ? new Set() : tokenSet(carApp0w);

            const rated0w = oils0w20.map(oil => {
                const oilTok = tokenSet(oil.a);
                let score = 0;
                if (!calcState.ignoreApprovals) {
                    for (const t of carTok0w) if (oilTok.has(t)) score += 10;
                }
                return { oil, score };
            });
            rated0w.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return a.oil.price - b.oil.price;
            });

            const mid0w = rated0w[0] ? rated0w[0].oil : { b:'ZIC', n:'X9 FE 0W-20', price:1550, v:'0W-20', a:['API SP'], ad:[] };
            let second0w = null;
            if (calcState.ignoreApprovals && rated0w.length > 1) {
                second0w = rated0w[1].oil;
            }

            agg.approvals = carApp0w;
            agg.allCandidates = rated0w.map(r => r.oil);
            agg.topCandidates = rated0w.filter(r => r.score === (rated0w[0]?.score || 0)).map(r => r.oil);
            return { mid: mid0w, spot: second0w };
        }

        const targetVisc = mileage === '>=100' ? '5W-40' : '5W-30';

        const car = calcState.car;
        const fuelType = String(car.fuelType || '');
        const ec = (car.engineCode || '').toUpperCase();
        const isDieselVehicle = fuelType === '05' || fuelType === '06' ||
                         /дизел|diesel/i.test(fuelType) ||
                         /D(CI|TI|I)?\b|TDI|HDI|CRDI|BLUEHDI|JTDM|MULTIJET/i.test(ec);

        const rolfApprovals = GM_getValue('rolf_approvals_' + car.cacheKey, null);
        const carApprovals = Array.isArray(rolfApprovals) ? rolfApprovals : [];
        const carTokens = tokenSet(carApprovals);

        const effectiveCarTokens = calcState.ignoreApprovals ? new Set() : carTokens;

        const needA5B5 = [...effectiveCarTokens].some(t => /A5B5|ACEAA5B5|ACEAA5|ACEAB5/.test(t));
        const needC3   = [...effectiveCarTokens].some(t => /ACEAC3|^C3$/.test(t));
        const needC2   = [...effectiveCarTokens].some(t => /ACEAC2|^C2$/.test(t));
        const needC1   = [...effectiveCarTokens].some(t => /ACEAC1|^C1$/.test(t));
        const needA3B4 = [...effectiveCarTokens].some(t => /A3B4|ACEAA3B4|ACEAA3|ACEAB4/.test(t));

        const hasAceaClass = (oil, cls) => {
            const t = tokenSet(oil.a);
            if (cls === 'A5B5') return [...t].some(x => /A5B5|ACEAA5B5/.test(x));
            if (cls === 'C3')   return [...t].some(x => /ACEAC3|^C3$/.test(x));
            if (cls === 'C2')   return [...t].some(x => /ACEAC2|^C2$/.test(x));
            if (cls === 'C1')   return [...t].some(x => /ACEAC1|^C1$/.test(x));
            if (cls === 'A3B4') return [...t].some(x => /A3B4|ACEAA3B4/.test(x));
            return true;
        };

        let requiredClass = null;
        if (!calcState.ignoreApprovals) {
            if (needA5B5) requiredClass = 'A5B5';
            else if (needC3) requiredClass = 'C3';
            else if (needC2) requiredClass = 'C2';
            else if (needC1) requiredClass = 'C1';
            else if (needA3B4) requiredClass = 'A3B4';
        }

        let candidates = shopOils.filter(o => o.v === targetVisc && !o.isSpot);

        if (requiredClass) {
            const filtered = candidates.filter(o => hasAceaClass(o, requiredClass));
            if (filtered.length) candidates = filtered;
        }

        const carMake = (car.makeShort || '').toUpperCase();
        const hasFord = carMake === 'FORD' || [...effectiveCarTokens].some(t => /FORDWSS|WSSM2C/.test(t));
        const hasMB  = [...effectiveCarTokens].some(t => /^MB\d/.test(t));
        const hasVW  = [...effectiveCarTokens].some(t => /^VW\d|^VW50/.test(t));
        const hasBMW = [...effectiveCarTokens].some(t => /^LL\d|LL01|LL04|LL98/.test(t));
        const hasRN  = [...effectiveCarTokens].some(t => /^RN\d|RN0700|RN0710/.test(t));
        const hasGM  = [...effectiveCarTokens].some(t => /^GM\d|DEXOS/.test(t));

        const rated = candidates.map(oil => {
            const oilTokens = tokenSet(oil.a);
            let score = 0;
            let matches = [];
            if (!calcState.ignoreApprovals) {
                for (const carTok of effectiveCarTokens) {
                    if (oilTokens.has(carTok)) {
                        score += 10;
                        matches.push(carTok);
                    }
                }
                if (hasFord && [...oilTokens].some(t => /FORDWSS|WSSM2C/.test(t))) score += 5;
                if (hasMB   && [...oilTokens].some(t => /^MB\d/.test(t))) score += 3;
                if (hasVW   && [...oilTokens].some(t => /^VW\d|^VW50/.test(t))) score += 3;
                if (hasBMW  && [...oilTokens].some(t => /^LL\d|LL01|LL04/.test(t))) score += 3;
                if (hasRN   && [...oilTokens].some(t => /^RN\d/.test(t))) score += 3;
                if (hasGM   && [...oilTokens].some(t => /^GM\d|DEXOS/.test(t))) score += 3;
            }
            return { oil, score, matches };
        });

        rated.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return a.oil.price - b.oil.price;
        });

        const maxScore = rated[0] ? rated[0].score : 0;
        const topMatches = rated.filter(r => r.score === maxScore);
        topMatches.sort((a, b) => a.oil.price - b.oil.price);

        const midIdx = topMatches.length <= 2 ? 0 : Math.floor(topMatches.length / 2);
        const mid = topMatches[midIdx].oil;

        const needPro = needA5B5 || needC1 || needC2 || needC3 || isDieselVehicle;
        const spotCandidates = shopOils.filter(o => o.isSpot && o.v === targetVisc);

        let spot;
        if (requiredClass) {
            const spotWithClass = spotCandidates.filter(o => hasAceaClass(o, requiredClass));
            if (spotWithClass.length) {
                spot = spotWithClass.find(o => o.tier === (needPro ? 'pro' : 'optimal'))
                    || spotWithClass[0];
            }
        }
        if (!spot) {
            spot = spotCandidates.find(o => o.tier === (needPro ? 'pro' : 'optimal'))
                || spotCandidates[0];
        }

        agg.approvals = carApprovals;
        agg.isDiesel = isDieselVehicle;
        agg.requiredClass = requiredClass;
        agg.allCandidates = rated.map(r => r.oil);
        agg.topCandidates = topMatches.map(r => r.oil);

        return { mid, spot };
    }

    function findMotulOil(db, name) {
        if (!name) return null;
        const n = name.toUpperCase().trim();
        for (const k in db) {
            if (k.toUpperCase() === n) return db[k];
        }
        for (const k in db) {
            if (k.toUpperCase().includes(n) || n.includes(k.toUpperCase())) return db[k];
        }
        return null;
    }

    // ══════════════════════════════════════════════════════════════════
    //                    ФИНАЛЬНЫЙ ТЕКСТ
    // ══════════════════════════════════════════════════════════════════
    function rerenderResult() {
        const aggs = getAggregates(calcState.data);
        const parts = [];

        const car = calcState.car;
        const carParts = [];
        if (car.makeShort) carParts.push(car.makeShort);
        if (car.modelShort) carParts.push(car.modelShort);
        if (car.engineName) carParts.push(car.engineName);
        else if (car.volume) carParts.push(car.volume);
        if (car.yearFrom) carParts.push(String(car.yearFrom));
        if (car.bhp) carParts.push(car.bhp + 'лс');
        else if (car.kw) carParts.push(car.kw + 'кВт');
        const carLine = carParts.join(' ');
        if (carLine) parts.push(carLine);

        for (const agg of aggs) {
            if (!calcState.selected.has(agg.key)) continue;
            const calc = calcForAggregate(agg);
            if (calc.isHighGear) {
                parts.push(`${agg.label} - послан в баню!`);
                continue;
            }
            parts.push(formatAggText(agg, calc));
        }

        const totalsLines = buildTotalsLines();
        if (totalsLines.length) {
            parts.push(totalsLines.join('\n'));
        }

        document.getElementById('zm-result') && (document.getElementById('zm-result').textContent = parts.join('\n\n') || '— выберите агрегаты для подсчёта —');
    }

    function formatAggText(agg, calc) {
        const lines = [];
        const mileage = calcState.mileage;
        const isFixedSingle = (mileage === '>=200');
        const is0w20 = (mileage === '0w20');

        if (agg.group === 'engine') {
            const v0 = parseFloat(agg.volume || 0);
            const vFilter = parseFloat(agg.filterVolume || 0);
            const vService = (v0 + vFilter);
            lines.push(`двс (${vService || calc.vCalc}л)`);

            const f = calcState.filters;
            if (f.vf.enabled && f.vf.name && f.vf.price) {
                const workLbl = f.vf.work === 350 ? 'защёлки' : f.vf.work === 600 ? 'болты' : 'разбор';
                lines.push(`вф ${f.vf.name} - ${f.vf.price}₽ (${workLbl} ${f.vf.work}₽)`);
            }
            if (f.mf.enabled && f.mf.name && f.mf.price) {
                lines.push(`мф ${f.mf.name} - ${f.mf.price}₽`);
            }
            if (f.sf.enabled && f.sf.name && f.sf.price) {
                const workLbl = f.sf.work === 550 ? 'бардачок' : 'под педалью';
                lines.push(`сф ${f.sf.name} - ${f.sf.price}₽ (${workLbl} ${f.sf.work}₽)`);
            }

            if (calcState.flush === '5min') {
                lines.push(`промывка двс (5-минутка) - 1180₽ (630 + 550 услуга)`);
            } else if (calcState.flush === 'full') {
                const litres = +(calc.vCalc * 0.9).toFixed(1);
                const oilCost = Math.round(litres * 300);
                const cost = oilCost + 550;
                lines.push(`промывка двс (полная) - ${cost}₽ (${litres}л × 300₽ + 550 услуга)`);
            }

            if (lines.length > 1) lines.push('');

            if (isFixedSingle) {
                calc.costs.slice(0, 1).forEach(c => {
                    const sumpLine = calcState.showWithSump ? ` + 550₽ (картер) = ${c.total + 550}₽` : '';
                    lines.push(`${c.oil.b} ${c.oil.n} ${c.oil.price}₽/л = ${c.total}₽${sumpLine}`);
                });
            } else if (is0w20) {
                calc.costs.forEach(c => {
                    const sumpLine = calcState.showWithSump ? ` + 550₽ (картер) = ${c.total + 550}₽` : '';
                    lines.push(`${c.oil.b} ${c.oil.n} ${c.oil.price}₽/л = ${c.total}₽${sumpLine}`);
                });
            } else {
                calc.costs.forEach(c => {
                    const base = `${c.oil.b} ${c.oil.n} ${c.oil.price}₽/л = ${c.total}₽`;
                    const sumpLine = calcState.showWithSump
                        ? ` + 550₽ (картер) = ${c.total + 550}₽`
                        : ' + 550р (с\\у\\з\\к)';
                    lines.push(base + sumpLine);
                });
            }
        } else if (agg.group === 'auto') {
            const isCvt = agg.isCvt;
            const isPartial = calcState.atpType === 'partial';
            const typeTxt = isPartial ? 'част' : 'полн';
            const pct = !isPartial ? '150%' : (isCvt ? '80%' : '60%');
            const vService = (parseFloat(agg.volume||0) + parseFloat(agg.filterVolume||0)) || calcState.volumeOverride[agg.key] || calcState.atpVolumeManual || 0;
            const label = isCvt ? 'вариатор' : 'акпп';
            lines.push(`${label} (серв ${vService}л)`);

            const extras = [];
            if (isPartial) extras.push('работа 1210₽');
            if (isCvt) {
                if (calcState.cvtFilterCoarse) extras.push('фильтр грубый 1700₽');
                if (calcState.cvtFilterFine)   extras.push('фильтр тонкий 3350₽');
            } else {
                if (calcState.atpFilter) extras.push('фильтр 1700₽');
            }
            const extraTxt = extras.length ? ' + ' + extras.join(' + ') : '';
            lines.push(`${typeTxt} (${calc.vCalc}л / ${pct})${extraTxt}`);
            calc.costs.forEach(c => lines.push(`${c.oil.b} ${c.oil.n} ${c.oil.price}₽/л = ${c.total}₽`));
        } else {
            const vService = (parseFloat(agg.volume||0) + parseFloat(agg.filterVolume||0)).toFixed(1);
            lines.push(`${agg.label.toLowerCase()} (${vService}л)`);
            calc.costs.forEach(c => lines.push(`${c.oil.b} ${c.oil.n} ${c.oil.price}₽/л = ${c.total}₽`));
        }
        return lines.join('\n');
    }

    // ══════════════════════════════════════════════════════════════════
    //                       RAVENOL — ПАРСЕР И INIT
    // ══════════════════════════════════════════════════════════════════
    function parseRavenolUrl() {
        const segs = location.pathname.split('/').filter(Boolean);
        if (segs.length < 4) return null;
        const cleanSeg = (s) => s.replace(/^\d+-/, '').replace(/-/g, ' ');
        const make = cleanSeg(segs[1] || '');
        const model = cleanSeg(segs[3] || segs[2] || '');
        return { make, model };
    }

    function parseRavenolHead() {
        const cont = document.querySelector('.rav_selection_head_info_container');
        if (!cont) return {};
        const text = (cont.querySelector('p') || {}).textContent || '';
        const yMatch = text.match(/год выпуска\s+с\s+(\d{4})/i);
        const yearFrom = yMatch ? parseInt(yMatch[1]) : null;
        const vMatch = text.match(/(\d\.\d)\b/);
        const engineVolume = vMatch ? vMatch[1] : '';
        const fuelMatch = text.match(/Топливо:\s*([^<\n]+)/i)
                       || (cont.textContent || '').match(/Топливо:\s*([^\n]+)/i);
        const fuel = fuelMatch ? fuelMatch[1].trim().replace(/[.,].*$/, '') : '';
        return { headText: text.replace(/\s*-\s*Моторное масло.*$/i, '').trim(), yearFrom, engineVolume, fuel };
    }

    function detectKppType(title) {
        const t = (title || '').toLowerCase();
        if (/вариатор|cvt/.test(t)) return { isCvt: true };
        if (/роботизированн|dct|dsg|двойн[а-я]+\s*сцеплен/.test(t)) return { isDct: true };
        if (/автомат|планет/.test(t)) return { isAuto: true };
        if (/механическ|m[\s-]?t\b/.test(t)) return { isManual: true };
        return {};
    }

    function parseRavenolPage() {
        const out = {};
        document.querySelectorAll('.aggregate_node').forEach((node) => {
            const titleEl = node.querySelector('.aggregate_node_title');
            if (!titleEl) return;
            const titleRaw = titleEl.textContent.replace(/\s+/g, ' ').trim();

            const descEl = node.querySelector('.aggregate_node_description_text');
            const descText = descEl ? descEl.textContent.replace(/\s+/g, ' ').trim() : '';
            let volTotal = 0, volService = 0, volPlain = 0;
            const volRe = /объ[её]м[^:]*?(?:\(([^)]+)\))?\s*:\s*([\d.,]+)\s*л/gi;
            let m;
            while ((m = volRe.exec(descText)) !== null) {
                const ctx = (m[1] || '').toLowerCase();
                const v = parseFloat(m[2].replace(',', '.'));
                if (/сервисн/i.test(ctx)) volService = v;
                else if (/общ|полн|основн/i.test(ctx)) volTotal = v;
                else if (!volPlain) volPlain = v;
            }
            const volume = volTotal || volPlain || volService || 0;

            const data = {
                volume,
                volumeService: volService,
                volumeTotal: volTotal,
                volumePlain: volPlain,
                filterVolume: 0,
                motulProducts: [],
                label: titleRaw,
                rawText: titleRaw + ' ' + descText,
            };

            if (/двигатель/i.test(titleRaw)) {
                const ec = titleRaw.replace(/^двигатель\s*/i, '').trim();
                data.engineCode = ec;
                out.engine = data;
            } else if (/коробка передач/i.test(titleRaw) || /\bкпп\b/i.test(titleRaw)) {
                const t = detectKppType(titleRaw);
                if (t.isCvt) { data.isCvt = true; out.automatic = data; }
                else if (t.isDct) { data.isDct = true; out.automatic = data; }
                else if (t.isAuto) { out.automatic = data; }
                else if (t.isManual) { out.manual = data; }
                else { out.automatic = data; }
            } else if (/раздаточн/i.test(titleRaw)) {
                if (!out.transfer) out.transfer = data;
            } else if (/дифференциал/i.test(titleRaw)) {
                if (/задн/i.test(titleRaw)) {
                    if (!out.diffRear) out.diffRear = data;
                } else if (/передн/i.test(titleRaw)) {
                    if (!out.diffFront) out.diffFront = data;
                } else {
                    if (!out.diffRear) out.diffRear = data;
                }
            }
        });
        return out;
    }

    function buildRavenolCar() {
        const u = parseRavenolUrl();
        const head = parseRavenolHead();
        if (!u) return null;

        const cap = (s) => s.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        const makeShort = cap(u.make);
        const modelShort = cap(u.model);

        const data = parseRavenolPage();
        const engineCode = (data.engine && data.engine.engineCode) || '';
        const engineName = '';

        const cacheKey = [makeShort, modelShort, head.engineVolume, engineCode, head.yearFrom]
            .filter(Boolean).join('_').toLowerCase().replace(/\s+/g, '');

        return {
            make: makeShort, model: modelShort,
            makeShort, modelShort,
            engineCode, engineName,
            volume: head.engineVolume || '',
            ccm: null, kw: null, bhp: null,
            yearFrom: head.yearFrom,
            fuelType: head.fuel || '',
            query: [makeShort, modelShort, head.engineVolume].filter(Boolean).join(' ').toLowerCase(),
            cacheKey,
            _ravenolData: data,
            _ravenolHead: head.headText || '',
            isRavenol: true,
        };
    }

    function initRavenol() {
        injectStyles();
        const widget = createWidget();
        let expanded = false;
        let lastRenderedKey = null;

        function render() {
            const car = buildRavenolCar();
            if (!car) {
                widget.classList.remove('zm-full');
                widget.innerHTML = shellHTML(`<div class="zm-warn">Откройте Ravenol с выбранным авто.</div>`);
                bindHeaderEvents(null);
                return;
            }

            const data = car._ravenolData;

            if (expanded) {
                widget.classList.add('zm-full');
                widget.innerHTML = shellHTML(renderCalculator(car, data));
                bindHeaderEvents(car);
                bindCalcEvents(car, data);
            } else {
                widget.classList.remove('zm-full');
                widget.innerHTML = shellHTML(renderTrayBodyRavenol(car));
                bindHeaderEvents(car);
                bindTrayEventsRavenol(car);
            }

            const rolfApp = GM_getValue('rolf_approvals_' + car.cacheKey, null);
            lastRenderedKey = car.cacheKey + '|R' + ((rolfApp || []).length) + '|' + (expanded ? 'E' : 'T');
        }

        function renderTrayBodyRavenol(car) {
            const rolfApp = GM_getValue('rolf_approvals_' + car.cacheKey, null);
            const rolfOk = !!(rolfApp && rolfApp.length);
            const ravOk = !!(car._ravenolData && car._ravenolData.engine);

            const status = `
                <div style="font-size:11px;line-height:1.7">
                    <div>${ravOk ? '✓ <span class="zm-ok">Ravenol</span> (объёмы + масла)' : '<span class="zm-wait">○ Ravenol</span>'}</div>
                    <div>${rolfOk ? '✓ <span class="zm-ok">ROLF</span> (' + rolfApp.length + ' допусков)' : '<span class="zm-wait">○ ROLF (допуски)</span>'}</div>
                </div>
            `;

            return `
                <div class="zm-car">
                    <div class="zm-car-t">${car.makeShort} ${car.modelShort}${car.volume?' '+car.volume:''}</div>
                    <div class="zm-car-sub">${car.engineCode || '?'} · ${car.yearFrom||'?'}${car.fuelType?' · '+car.fuelType:''}</div>
                </div>
                ${status}
                <div class="zm-tray-actions">
                    <button class="zm-btn-rolf" id="zm-go-rolf">📋 ROLF — допуски</button>
                    ${ravOk && rolfOk ? '<button class="zm-btn-calc" id="zm-go-calc">💧 Подбор масла</button>' : ''}
                </div>
            `;
        }

        function bindTrayEventsRavenol(car) {
            const goRolf = document.getElementById('zm-go-rolf');
            if (goRolf) goRolf.onclick = () => goToRolf(car);
            const goCalc = document.getElementById('zm-go-calc');
            if (goCalc) goCalc.onclick = () => { expanded = true; render(); };
        }

        setInterval(() => {
            const car = buildRavenolCar();
            if (!car) return;
            const rolfApp = GM_getValue('rolf_approvals_' + car.cacheKey, null);
            const newKey = car.cacheKey + '|R' + ((rolfApp || []).length) + '|' + (expanded ? 'E' : 'T');
            if (newKey !== lastRenderedKey) render();
        }, 1500);

        render();
    }

    // ══════════════════════════════════════════════════════════════════
    //                    ROLF — ПАРСЕР ДОПУСКОВ МАШИНЫ
    // ══════════════════════════════════════════════════════════════════
    function initRolf() {
        const pendingRaw = GM_getValue('zm_rolf_pending', '');
        let key = '', ec = '';
        if (pendingRaw) {
            try {
                const p = JSON.parse(pendingRaw);
                if (p && p.key && (Date.now() - (p.ts||0) < 30 * 60 * 1000)) {
                    key = p.key;
                    ec = p.ec || '';
                }
            } catch {}
        }

        if (!key) return;

        const isIframe = window.top !== window.self;

        if (!isIframe) {
            renderRolfHint(ec);
            pollRolfResult(key);
        } else {
            watchForRolfTags(key, ec);
        }
    }

    function renderRolfHint(ec) {
        if (!document.body) { setTimeout(() => renderRolfHint(ec), 200); return; }

        let b = document.getElementById('__zm_rolf_badge');
        if (b) b.remove();
        b = document.createElement('div');
        b.id = '__zm_rolf_badge';
        b.style.cssText = `position:fixed;top:20px;right:20px;z-index:9999999;
            background:#0f1117;color:#e8eaf6;padding:14px 18px;border-radius:10px;
            font:13px Arial;box-shadow:0 8px 24px rgba(0,0,0,.5);max-width:380px;
            border:1px solid #E67E00;line-height:1.5`;
        b.innerHTML = `
            <div style="color:#E67E00;font-weight:bold;margin-bottom:8px">📋 OIL WIDGET — ROLF</div>
            <div>Вставь код двигателя <b style="color:#E67E00">${escapeHtml(ec || '?')}</b> в «умный поиск» → выбери свою машину → скрипт сам распаршу допуска</div>
            <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
                <button id="zm-rolf-copy" style="background:#E67E00;border:none;color:#fff;border-radius:6px;padding:6px 12px;cursor:pointer;font:12px Arial">⧉ Скопировать</button>
                <button id="zm-rolf-close" style="background:transparent;border:1px solid #3a3d5e;color:#e8eaf6;border-radius:6px;padding:6px 12px;cursor:pointer;font:11px Arial">Закрыть</button>
            </div>
            <div id="zm-rolf-status" style="margin-top:10px;color:#7986cb;font-size:11px">Жду результатов…</div>
        `;
        document.body.appendChild(b);

        const copyBtn = document.getElementById('zm-rolf-copy');
        if (copyBtn && ec) copyBtn.onclick = () => {
            navigator.clipboard.writeText(ec).then(() => {
                copyBtn.textContent = '✓ скопировано';
                setTimeout(() => { copyBtn.textContent = '⧉ Скопировать'; }, 2000);
            }).catch(() => {
                copyBtn.textContent = '✗ не получилось — скопируй руками';
            });
        };
        const closeBtn = document.getElementById('zm-rolf-close');
        if (closeBtn) closeBtn.onclick = () => b.remove();
    }

    function pollRolfResult(key) {
        const interval = setInterval(() => {
            const result = GM_getValue('rolf_approvals_' + key, null);
            if (result && result.length) {
                clearInterval(interval);
                const st = document.getElementById('zm-rolf-status');
                const b = document.getElementById('__zm_rolf_badge');
                if (b) {
                    b.style.borderColor = '#4caf50';
                    if (st) {
                        st.innerHTML = `<b style="color:#4caf50">✅ Сохранено ${result.length} допусков:</b><br>${result.slice(0,5).map(escapeHtml).join(', ')}${result.length>5?'…':''}`;
                    }
                    const existingCloseTabBtn = document.getElementById('zm-rolf-closetab');
                    if (!existingCloseTabBtn) {
                        const btn = document.createElement('button');
                        btn.id = 'zm-rolf-closetab';
                        btn.textContent = '✕ Закрыть эту вкладку';
                        btn.style.cssText = 'margin-top:10px;padding:8px 14px;background:#2196f3;color:#fff;border:none;border-radius:6px;cursor:pointer;font:12px Arial;width:100%';
                        btn.onclick = () => window.close();
                        b.appendChild(btn);
                    }
                }
            }
        }, 1000);
        setTimeout(() => clearInterval(interval), 10 * 60 * 1000);
    }

    function watchForRolfTags(key, ec) {
        const seen = new Set();

        const tryParse = () => {
            const tagBlocks = document.querySelectorAll('.card-oil-tags__tags-wrap');
            if (!tagBlocks.length) return false;

            const allTags = new Set();
            tagBlocks.forEach(block => {
                const tags = block.querySelectorAll('.tag span, .tag_on-black span, span');
                tags.forEach(t => {
                    const txt = (t.textContent || '').replace(/\s+/g, ' ').trim();
                    if (txt && txt.length >= 3 && txt.length <= 80 && /[A-Za-zА-Яа-я]/.test(txt)) {
                        allTags.add(txt);
                    }
                });
            });

            if (!allTags.size) return false;

            const signature = [...allTags].sort().join('|');
            if (seen.has(signature)) return false;
            seen.add(signature);

            const normalized = [];
            allTags.forEach(tag => {
                const m = tag.match(/^([A-Z]+(?:[\s\-][A-Z]+)*)\s+([\d][\d\.\-]*(?:\/[\d][\d\.\-]*)+)/i);
                if (m) {
                    const prefix = m[1].trim();
                    m[2].split('/').forEach(v => normalized.push(`${prefix} ${v.trim()}`));
                } else {
                    normalized.push(tag);
                }
            });

            GM_setValue('rolf_approvals_' + key, normalized);
            return true;
        };

        tryParse();

        const mo = new MutationObserver(() => tryParse());
        const startObserving = () => {
            if (document.body) {
                mo.observe(document.body, { childList: true, subtree: true });
            } else {
                setTimeout(startObserving, 200);
            }
        };
        startObserving();

        const interval = setInterval(() => tryParse(), 1500);
        setTimeout(() => { clearInterval(interval); mo.disconnect(); }, 10 * 60 * 1000);
    }

    // ══════════════════════════════════════════════════════════════════
    //                         MOTUL — ПАРСЕР
    // ══════════════════════════════════════════════════════════════════
    function initMotul() {
        const hash = location.hash.slice(1);
        const hashParams = new URLSearchParams(hash);
        const prefill  = hashParams.get('prefill');
        const cacheKey = hashParams.get('key');
        const wantedEc = (hashParams.get('ec') || '').trim();
        const carData  = hashParams.get('carData') || '';

        if (cacheKey) sessionStorage.setItem('zm_cache_key', cacheKey);
        if (wantedEc) sessionStorage.setItem('zm_wanted_ec', wantedEc);
        if (prefill)  sessionStorage.setItem('zm_prefill',   prefill);
        if (carData)  sessionStorage.setItem('zm_car_data',  carData);

        runManual(
            prefill || sessionStorage.getItem('zm_prefill') || '',
            cacheKey || sessionStorage.getItem('zm_cache_key') || '',
            wantedEc || sessionStorage.getItem('zm_wanted_ec') || '',
            carData || sessionStorage.getItem('zm_car_data') || ''
        );
    }

    function runManual(prefill, cacheKey, wantedEc, carDataRaw) {
        let carData = null;
        if (carDataRaw) {
            try { carData = JSON.parse(carDataRaw); } catch {}
        }
        if (location.pathname.includes('advice.aspx')) {
            setTimeout(() => {
                const data = parseMotulAdvice();
                if (!data || !data.engine) {
                    showManualBadge('⚠️ Не удалось распарсить страницу', '#ff9800');
                    return;
                }
                const key = cacheKey || sessionStorage.getItem('zm_cache_key');
                if (!key) {
                    showManualBadge('⚠️ Нет ключа кеша - открой заново с Mann Filter', '#ff9800');
                    return;
                }

                const foundEc = (data.engine.engineCode || '').trim();
                const ecMatch = wantedEc ? matchEngineCodes(wantedEc, foundEc) : null;

                GM_setValue('motul_car_' + key, data);

                if (wantedEc && !ecMatch) {
                    showManualBadge(`⚠️ Код не совпал: ожидался ${wantedEc}, на Motul ${foundEc || '?'}. Сохранено, но проверь машину!`, '#ff9800');
                } else if (ecMatch) {
                    showManualBadge(`✅ Код совпал: ${foundEc}. Можно закрыть вкладку.`, '#4caf50');
                } else {
                    showManualBadge(`✅ Сохранено. Можно закрыть вкладку.`, '#4caf50');
                }

                const btn = document.createElement('button');
                btn.textContent = '✕ Закрыть вкладку';
                btn.style.cssText = 'position:fixed;top:70px;right:20px;z-index:999999;padding:10px 16px;border-radius:8px;background:#2196f3;color:#fff;border:none;cursor:pointer;font:13px Arial;box-shadow:0 4px 16px rgba(0,0,0,.3)';
                btn.onclick = () => window.close();
                document.body.appendChild(btn);
            }, 1500);
            return;
        }

        if (prefill) {
            setTimeout(() => {
                fillSearchField(prefill);
                showCheatsheet(carData, wantedEc, prefill);
            }, 800);
        }
    }

    function showCheatsheet(carData, wantedEc, prefill) {
        const old = document.getElementById('__zm_cheatsheet');
        if (old) old.remove();

        const fuelMap = {
            '01': 'Бензин', '02': 'Бензин + газ', '04': 'Этанол',
            '05': 'Дизель', '06': 'Дизель', '': '?',
        };
        const fuel = carData ? (fuelMap[carData.fuelType] || carData.fuelType || '?') : '?';

        if (!carData) {
            showManualBadge(`⌨ Ищу "${prefill}"…${wantedEc?' Код двигателя: '+wantedEc:''}. Выбери из выпадашки.`, '#2196f3');
            return;
        }

        const rows = [];
        const car = carData;
        if (car.makeShort)  rows.push(['Марка',     car.makeShort]);
        if (car.modelShort) rows.push(['Модель',    car.modelShort]);
        if (car.engineCode) rows.push(['Код двиг.', car.engineCode, true]);
        if (car.engineName) rows.push(['Двигатель', car.engineName]);
        if (car.volume)     rows.push(['Объём',     car.volume + ' л']);
        if (car.ccm)        rows.push(['Объём',     car.ccm + ' куб.см']);
        if (car.kw && car.bhp) rows.push(['Мощность', `${car.kw} кВт / ${car.bhp} лс`]);
        else if (car.kw)    rows.push(['Мощность', car.kw + ' кВт']);
        else if (car.bhp)   rows.push(['Мощность', car.bhp + ' лс']);
        if (car.yearFrom)   rows.push(['Год',       car.yearFrom]);
        if (fuel !== '?')   rows.push(['Топливо',   fuel]);

        const rowsHtml = rows.map(([k, v, hl]) => `
            <tr>
                <td style="padding:4px 10px 4px 0;color:#7986cb;font-size:11px;white-space:nowrap;vertical-align:top">${k}</td>
                <td style="padding:4px 0;color:${hl?'#fff':'#e8eaf6'};font-size:13px;${hl?'font-weight:bold;background:#2a1d00;padding:4px 8px;border-radius:4px':''}">${escapeHtmlSafe(String(v))}</td>
            </tr>
        `).join('');

        const box = document.createElement('div');
        box.id = '__zm_cheatsheet';
        box.style.cssText = `
            position: fixed; top: 20px; right: 20px; z-index: 9999999;
            background: #0f1117; color: #e8eaf6;
            border: 1px solid #E67E00; border-radius: 12px;
            box-shadow: 0 12px 40px rgba(0,0,0,.6);
            font: 13px Arial, sans-serif;
            width: 340px; max-width: calc(100vw - 40px);
            overflow: hidden;
        `;

        box.innerHTML = `
            <div style="padding:12px 16px;background:#1a1d2e;border-bottom:1px solid #2a2d3e;display:flex;align-items:center;gap:10px">
                <span style="color:#E67E00;font-weight:bold;font-size:13px;flex:1">🛢 OIL WIDGET — шпаргалка</span>
                <button id="__zm_cs_close" style="background:transparent;border:none;color:#7986cb;font-size:18px;cursor:pointer;padding:0 4px;line-height:1">✕</button>
            </div>
            <div style="padding:14px 16px">
                <div style="color:#E67E00;font-size:11px;font-weight:bold;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">
                    👆 Выбери машину в открытой вкладке Motul
                </div>
                <table style="width:100%;border-collapse:collapse;margin-bottom:10px">
                    ${rowsHtml}
                </table>
                <div style="background:#0a0c12;border:1px solid #2a2d3e;border-radius:6px;padding:8px 10px;font-size:11px;color:#7986cb;line-height:1.5">
                    Сравнивай <b style="color:#E67E00">все поля</b> с вариантами в Motul.<br>
                    Главное — <b style="color:#E67E00">код двигателя</b> и год.<br>
                    После выбора скрипт распарсит и вернётся.
                </div>
            </div>
        `;
        document.body.appendChild(box);

        const closeBtn = document.getElementById('__zm_cs_close');
        if (closeBtn) closeBtn.onclick = () => box.remove();
        setTimeout(() => { if (box.parentNode) box.remove(); }, 180000);
    }

    function showReglamentPopup(matches) {
        const old = document.getElementById('__zm_reg_popup');
        if (old) { old.remove(); return; }

        const box = document.createElement('div');
        box.id = '__zm_reg_popup';
        box.innerHTML = `
            <div class="zm-reg-popup-head">
                <span>📖 По регламенту</span>
                <button id="__zm_reg_close" title="Закрыть">✕</button>
            </div>
            <div class="zm-reg-popup-body">
                ${matches.map(m => `
                    <div class="zm-reg-item">
                        <div class="zm-reg-tag">⭐ ${escapeHtmlSafe(m.tag)}</div>
                        <div class="zm-reg-desc">${escapeHtmlSafe(m.desc || '—')}</div>
                    </div>
                `).join('')}
                <div class="zm-reg-foot">Совпадения с регламентом производителя — масло подойдёт.</div>
            </div>
        `;
        document.body.appendChild(box);

        document.getElementById('__zm_reg_close').onclick = () => box.remove();
        const offClick = (e) => {
            if (!box.contains(e.target)) {
                box.remove();
                document.removeEventListener('click', offClick, true);
            }
        };
        setTimeout(() => document.addEventListener('click', offClick, true), 50);
    }

    function matchEngineCodes(mannEc, motulEc) {
        if (!mannEc || !motulEc) return false;
        const a = mannEc.toUpperCase().split(/[,;\/\s]+/).map(s=>s.trim()).filter(Boolean);
        const b = motulEc.toUpperCase().split(/[,;\/\s]+/).map(s=>s.trim()).filter(Boolean);
        for (const x of a) for (const y of b) {
            if (!x || !y) continue;
            if (x === y || x.includes(y) || y.includes(x)) return true;
        }
        return false;
    }

    function fillSearchField(value) {
        const input = document.getElementById('instantsearchinput');
        if (!input) { setTimeout(() => fillSearchField(value), 200); return; }
        input.focus();
        input.value = '';
        for (let i = 0; i < value.length; i++) {
            input.value += value[i];
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keyup', { key: value[i], bubbles: true }));
        }
        if (window.jQuery) {
            try { window.jQuery(input).val(value).trigger('keyup').trigger('input'); } catch {}
        }
    }

    function showManualBadge(text, color) {
        let b = document.getElementById('__motul_badge');
        if (!b) {
            b = document.createElement('div');
            b.id = '__motul_badge';
            b.style.cssText = 'position:fixed;top:20px;right:20px;z-index:999999;color:#fff;padding:12px 18px;border-radius:10px;font:13px Arial;box-shadow:0 8px 24px rgba(0,0,0,.3);max-width:400px';
            (document.body || document.documentElement).appendChild(b);
        }
        b.style.background = color || '#4caf50';
        b.textContent = text;
    }

    function parseMotulAdvice() {
        const makeEl = document.getElementById('ctl00_ContentPlaceHolder1_lblMakeValue');
        const modelEl = document.getElementById('ctl00_ContentPlaceHolder1_lblModelValue');
        const typeEl = document.getElementById('ctl00_ContentPlaceHolder1_lblTypeValue');

        const out = {
            motulName: [makeEl?.textContent, modelEl?.textContent, typeEl?.textContent].filter(Boolean).join(' · '),
            make_model_type: (typeEl?.textContent || '').trim(),
        };

        const titleTds = document.querySelectorAll('.AdviceComponentTitleText');

        titleTds.forEach((tdTitle, idx) => {
            let titleText = '';
            for (const n of tdTitle.childNodes) {
                if (n.nodeType === 3) titleText += n.textContent;
            }
            titleText = titleText.replace(/\s+/g, ' ').trim();
            if (!titleText) titleText = tdTitle.textContent.replace(/- Not applicable/g, '').trim();

            const compBlock = document.getElementById('Comp' + idx);
            if (!compBlock) return;

            const data = parseCompBlock(compBlock);
            data.label = titleText;
            data.rawText = compBlock.textContent;

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

    function parseCompBlock(block) {
        const result = { volume: 0, filterVolume: 0, motulProducts: [], modes: [] };
        let volService = 0, volTotal = 0, volPlain = 0;

        const norm = (s) => s.toLowerCase()
            .replace(/o/g, 'о').replace(/c/g, 'с').replace(/e/g, 'е')
            .replace(/p/g, 'р').replace(/a/g, 'а');

        const rows = block.querySelectorAll('tr');
        let lastTitle = '';

        rows.forEach(tr => {
            const titleTd = tr.querySelector('.AdviceTitle');
            const valueTd = tr.querySelector('.AdviceValue');

            if (titleTd && valueTd) {
                const title = titleTd.textContent.replace(/\s+/g, ' ').trim();
                const value = valueTd.textContent.replace(/\s+/g, ' ').trim();
                const valueN = norm(value);
                const titleN = norm(title);

                if (/объ[её]м/.test(valueN) || /объ[её]м/.test(titleN)) {
                    const m = value.match(/([\d]+(?:[,\.]\d+)?)\s*л/i);
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
                lastTitle = title;
            }

            const prodValueTd = tr.querySelector('.AdviceValueProduct');
            if (prodValueTd) {
                const pname = prodValueTd.textContent.replace(/\s+/g, ' ').trim();
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

    // ══════════════════════════════════════════════════════════════════
    //                         СТИЛИ И ОБЁРТКА
    // ══════════════════════════════════════════════════════════════════
    function injectStyles() {
        if (document.getElementById('__zm_style')) return;
        const s = document.createElement('style');
        s.id = '__zm_style';
        s.textContent = `
            #__zm_w{position:fixed;bottom:18px;left:18px;z-index:999999;
                font-family:Arial,sans-serif;font-size:13px;width:320px;max-height:86vh;
                overflow-y:auto;background:#0f1117;border:1px solid #2a2d3e;
                border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.55);color:#e8eaf6;
                text-align:left}
            #__zm_w *{text-align:inherit;box-sizing:border-box}
            #__zm_w .zm-bath-msg,
            #__zm_w .zm-dct-notice{text-align:center}
            #__zm_w.zm-full{width:580px}
            #__zm_w.zm-hidden{max-height:44px;overflow:hidden}
            #__zm_w::-webkit-scrollbar{width:6px}
            #__zm_w::-webkit-scrollbar-thumb{background:#2a2d3e;border-radius:3px}
            .zm-header{background:#1a1d2e;padding:10px 14px;display:flex;gap:8px;align-items:center;
                border-bottom:1px solid #2a2d3e;position:sticky;top:0;z-index:2;border-radius:12px 12px 0 0}
            .zm-title{color:#E67E00;font-weight:bold;font-size:12px;letter-spacing:.08em;flex:1}
            .zm-btn{background:#1e2040;border:1px solid #3a3d5e;border-radius:6px;
                color:#e8eaf6;font-size:11px;padding:6px 12px;cursor:pointer;font-family:inherit}
            .zm-btn-pri{background:#E67E00;border-color:#E67E00;color:#fff;font-weight:bold}
            .zm-btn-pri:hover{background:#d67100}
            .zm-btn-sec:hover{background:#3a3d5e}
            #__zm_w:not(.zm-full) .zm-header,
            #__zm_w:not(.zm-full) .zm-car,
            #__zm_w:not(.zm-full) .zm-tray-status,
            #__zm_w:not(.zm-full) .zm-tray-btns{padding-left:14px;padding-right:14px}
            .zm-car{padding:10px 14px;border-bottom:1px solid #2a2d3e}
            .zm-car-t{font-size:14px;font-weight:bold}
            .zm-car-sub{color:#5a6070;font-size:11px;margin-top:3px}
            .zm-tray-status{padding:8px 14px;font-size:12px}
            .zm-ok{color:#4caf50}
            .zm-wait{color:#ff9800}
            .zm-tray-btns{padding:8px 14px 14px;display:flex;gap:6px}
            .zm-tray-btns .zm-btn-pri{flex:1}
            .zm-ctrls{padding:10px 14px;background:#0a0c12;border-bottom:1px solid #2a2d3e}
            .zm-ctrl-row{display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap}
            .zm-ctrl-row:last-child{margin-bottom:0}
            .zm-ctrl-lbl{color:#5a6070;font-size:11px;margin-right:4px}
            .zm-chip{background:#1e2040;border:1px solid #3a3d5e;border-radius:14px;
                color:#e8eaf6;font-size:11px;padding:4px 10px;cursor:pointer}
            .zm-chip-act{background:#E67E00;border-color:#E67E00;color:#fff}
            .zm-visc-badge{display:inline-block;background:#1e2040;border:1px solid #3a3d5e;
                color:#e8eaf6;font-size:10px;padding:2px 8px;border-radius:10px;margin-bottom:4px}
            .zm-visc-10w40{background:#3a2000;border-color:#E67E00;color:#E67E00;font-weight:bold}
            .zm-chip-flush.zm-chip-act{background:#7c4dff;border-color:#7c4dff}
            .zm-chip-flush:not(.zm-chip-act){border-color:#5e35b1;color:#b39ddb}
            .zm-flush-box{background:#1a0f3a;border:1px solid #5e35b1;border-radius:6px;
                padding:8px 10px;margin:6px 0;font-size:11px;color:#d1c4e9;line-height:1.5}
            .zm-flush-box b{color:#b39ddb}
            .zm-flush-formula{font-family:monospace;color:#9575cd;background:#0a0517;
                padding:1px 6px;border-radius:3px;margin:0 2px}
            .zm-flush-total{color:#fff !important;background:#5e35b1;padding:1px 8px;
                border-radius:3px;font-size:13px;margin-left:2px}
            .zm-visc-0w20{background:#001f3a;border-color:#2196f3;color:#64b5f6;font-weight:bold}
            #zm-aggs{padding:10px 14px}
            .zm-agg{background:#131722;border:1px solid #2a2d3e;border-radius:8px;padding:10px 12px;margin-bottom:10px}
            .zm-agg.zm-bath{background:#3a1818;border-color:#5a2828}
            .zm-bath-msg{color:#ef5350;font-size:14px;font-weight:bold;text-align:center;padding:14px}
            .zm-agg-head{display:flex;align-items:center;margin-bottom:8px}
            .zm-chk{display:flex;align-items:center;gap:8px;cursor:pointer;flex:1}
            .zm-chk input{cursor:pointer}
            .zm-chk-lbl{font-weight:bold;font-size:12px}
            .zm-agg-vol{color:#E67E00;font-size:11px;font-family:monospace}
            .zm-atp-ctrls{background:#0a0c12;border-radius:6px;padding:8px 10px;margin-bottom:8px}
            .zm-atp-type{color:#E67E00;font-size:10px;font-weight:bold;letter-spacing:.05em;margin-bottom:6px;text-transform:uppercase}
            .zm-dct-notice{background:#1e1f3a;border:1px solid #3a3d5e;border-radius:8px;padding:14px 16px;margin-bottom:12px;color:#81a8e0;font-size:12px;line-height:1.4;text-align:center}
            .zm-dct-notice b{color:#9aafe0}
            .zm-dct-notice small{color:#5a6070;display:block;margin-top:6px;font-style:italic}
            .zm-btn-filters{display:block;width:calc(100% - 28px);margin:10px 14px;background:#1e2040;border:1px dashed #3a3d5e;color:#7986cb;padding:8px;border-radius:8px;cursor:pointer;font:12px Arial}
            .zm-btn-filters:hover{border-color:#E67E00;color:#E67E00}
            .zm-filters-panel{background:#131722;border:1px solid #E67E00;border-radius:8px;padding:10px 12px;margin:10px 14px}
            .zm-filters-list-wrap{background:#131722;border:1px solid #2a2d3e;border-radius:8px;padding:10px 12px;margin:10px 14px}
            .zm-filters-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;color:#E67E00;font-size:11px;font-weight:bold}
            .zm-filters-ta{width:100%;box-sizing:border-box;background:#0a0c12;border:1px solid #3a3d5e;color:#e8eaf6;border-radius:6px;padding:8px;font:11px monospace;resize:vertical}
            .zm-filters-btns{display:flex;gap:6px;margin-top:8px}
            .zm-filters-btns .zm-btn-pri{flex:1}
            .zm-filters-hint{color:#5a6070;font-size:10px;margin-top:6px}
            .zm-filters-hint code{background:#0a0c12;padding:1px 4px;border-radius:3px;color:#7986cb}
            .zm-filters-list{display:flex;flex-direction:column;gap:8px;margin-top:4px}
            .zm-filter-row{background:#0a0c12;border-radius:6px;padding:8px 10px}
            .zm-filter-row .zm-chk-lbl{font-weight:normal;font-size:11px}
            .zm-filter-row .zm-chk-lbl b{color:#E67E00;margin-right:6px}
            .zm-filter-work{display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-top:6px;margin-left:24px}
            .zm-filter-work .zm-chip{font-size:10px;padding:3px 8px}
            .zm-filter-work-none{color:#5a6070;font-size:10px;margin-top:4px;margin-left:24px;font-style:italic}
            .zm-formula{color:#5a6070;font-size:10px;font-family:monospace;margin:4px 0 8px;padding:4px 8px;background:#0a0c12;border-radius:4px}
            .zm-vol-edit{display:flex;align-items:center;gap:6px;margin:4px 0 6px;flex-wrap:wrap}
            .zm-vol-input{background:#0a0c12;border:1px solid #3a3d5e;color:#e8eaf6;border-radius:4px;padding:3px 6px;width:64px;font:11px monospace;text-align:right}
            .zm-vol-input:focus{outline:none;border-color:#E67E00;background:#1a1d2e}
            .zm-vol-motul{color:#5a6070;font-size:10px;font-style:italic}
            .zm-vol-warn{color:#ff9800}
            .zm-vol-reset{background:transparent;border:1px solid #3a3d5e;color:#7986cb;border-radius:3px;padding:1px 5px;cursor:pointer;font:10px Arial}
            .zm-vol-reset:hover{border-color:#E67E00;color:#E67E00}
            .zm-oil-line{padding:6px 8px;margin-bottom:4px;background:#0f1421;border-radius:6px}
            .zm-oil-name{font-size:12px;font-weight:bold;color:#e8eaf6}
            .zm-oil-calc{color:#81c784;font-size:11px;font-family:monospace;margin-top:2px}
            .zm-oil-total{color:#fff;font-size:15px;font-weight:900;background:#1d3a1d;padding:1px 6px;border-radius:3px;margin-left:2px}
            .zm-oil-total-sump{background:#1d3a3a;color:#80deea}
            .zm-oil-price{color:#5a6070;font-size:10px;margin-top:1px}
            .zm-oil-line b{color:#E67E00}
            .zm-oil-pick-btn{background:transparent;border:1px dashed #3a3d5e;color:#e8eaf6;padding:2px 8px;border-radius:4px;cursor:pointer;font:bold 12px Arial;text-align:left;width:100%}
            .zm-oil-pick-btn:hover{background:#1e2040;border-color:#E67E00}
            .zm-oil-picker{background:#0a0c12;border:1px solid #E67E00;border-radius:6px;padding:8px;margin-top:6px}
            .zm-oil-picker-head{color:#E67E00;font-size:10px;margin-bottom:6px;font-weight:bold}
            .zm-oil-opt{display:flex;justify-content:space-between;align-items:center;width:100%;background:#131722;border:1px solid #2a2d3e;color:#e8eaf6;padding:5px 8px;border-radius:4px;cursor:pointer;font:11px Arial;margin-bottom:3px;text-align:left}
            .zm-oil-opt:hover{border-color:#E67E00;background:#1e2040}
            .zm-oil-opt-act{border-color:#E67E00;background:#2a1d00}
            .zm-oil-opt-name{flex:1;font-weight:500}
            .zm-oil-opt-price{color:#81c784;font-weight:bold;font-size:10px;margin-left:8px}
            .zm-app-btn{background:transparent;border:none;color:#7986cb;font-size:10px;cursor:pointer;padding:4px 0;margin-top:6px}
            .zm-app-btn:hover{color:#E67E00}
            .zm-app-list{padding:6px 8px;background:#0a0c12;border-radius:4px;margin-top:4px;display:flex;flex-wrap:wrap;gap:4px}
            .zm-app-tag{background:#1e2040;color:#9aa0b0;padding:2px 6px;border-radius:3px;font-size:10px;font-family:monospace}
            .zm-motul-prods{background:#0a0c12;border-radius:4px;padding:6px 8px;margin-top:6px}
            .zm-motul-t{color:#5a6070;font-size:10px;margin-bottom:3px}
            .zm-motul-p{display:inline-block;background:#1e2040;color:#7986cb;padding:1px 5px;border-radius:3px;font-size:10px;margin:1px;font-family:monospace}
            .zm-result-wrap{padding:10px 14px;border-top:1px solid #2a2d3e}
            #zm-totals:empty{display:none}
            .zm-totals-wrap{padding:0 14px 8px}
            .zm-tot-block{background:#131722;border:1px solid #2a2d3e;border-radius:8px;padding:8px 10px;margin-bottom:8px}
            .zm-tot-block-h{display:flex;justify-content:space-between;align-items:center;color:#E67E00;font-size:11px;font-weight:bold;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid #2a2d3e;flex-wrap:wrap;gap:4px}
            .zm-tot-block-h b{color:#fff;font-size:13px;background:#1d3a1d;padding:2px 8px;border-radius:4px;margin-left:4px}
            .zm-tot-row{margin-bottom:6px}
            .zm-tot-row:last-child{margin-bottom:0}
            .zm-tot-row-h{color:#7986cb;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px}
            .zm-tot-opt{display:flex;align-items:center;gap:6px;padding:3px 6px;cursor:pointer;font-size:11px;border-radius:4px}
            .zm-tot-opt:hover{background:#1e2040}
            .zm-tot-opt input{cursor:pointer;margin:0}
            .zm-tot-opt-skip{color:#7986cb;font-style:italic}
            .zm-result-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
            .zm-result-head span{color:#E67E00;font-size:11px;font-weight:bold}
            .zm-result{background:#0a0c12;border:1px solid #2a2d3e;border-radius:6px;
                padding:10px;color:#e8eaf6;font-family:monospace;font-size:11px;
                white-space:pre-wrap;margin:0;max-height:300px;overflow-y:auto}
            .zm-warn{color:#ff9800;padding:14px;font-size:12px;line-height:1.5}
            .zm-no-full-warn{background:#3a0000;border:1px solid #ff4d4d;color:#ff8585;padding:6px 10px;font-size:11px;border-radius:6px;margin:6px 0;font-weight:600}
            .zm-oil-line-reg{border:1px solid #2e7d32;background:#0e2014}
            .zm-reg-badge{background:#1b3a1b;border:1px solid #2e7d32;color:#a5d6a7;font-size:11px;padding:1px 6px;border-radius:4px;cursor:pointer;margin-left:6px;font-weight:600;line-height:1.4}
            .zm-reg-badge:hover{background:#2e7d32;color:#fff;border-color:#4caf50}
            .zm-reg-mark{color:#81c784;margin-right:4px}
            .zm-oil-opt-reg{border-color:#2e7d32;background:#0e2014}
            .zm-oil-opt-reg:hover{border-color:#4caf50;background:#1b3a1b}
            #__zm_reg_popup{position:fixed;top:80px;right:24px;z-index:9999999;
                background:#0f1117;color:#e8eaf6;border:1px solid #2e7d32;border-radius:10px;
                box-shadow:0 12px 40px rgba(0,0,0,.6);font:13px Arial,sans-serif;
                width:380px;max-width:calc(100vw - 40px);overflow:hidden}
            .zm-reg-popup-head{padding:10px 14px;background:#1a1d2e;border-bottom:1px solid #2e7d32;
                display:flex;justify-content:space-between;align-items:center;color:#a5d6a7;font-weight:bold}
            .zm-reg-popup-head button{background:transparent;border:none;color:#7986cb;font-size:18px;cursor:pointer;padding:0 4px;line-height:1}
            .zm-reg-popup-body{padding:12px 14px;max-height:60vh;overflow-y:auto}
            .zm-reg-item{margin-bottom:10px;padding:8px 10px;background:#131722;border-left:3px solid #2e7d32;border-radius:4px}
            .zm-reg-tag{color:#a5d6a7;font-weight:bold;font-size:12px;margin-bottom:4px;font-family:monospace}
            .zm-reg-desc{color:#bdc1d1;font-size:12px;line-height:1.5}
            .zm-reg-foot{font-size:11px;color:#7986cb;font-style:italic;text-align:center;margin-top:8px}

            /* ── НОВОЕ: блок деталей масла (метчи допусков + присадки) ── */
            .zm-oil-details{margin-top:6px;padding-top:6px;border-top:1px dashed #2a2d3e}
            .zm-oil-app-matched{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px}
            .zm-oil-app-pill{display:inline-block;font-size:10px;padding:2px 8px;border-radius:10px;
                font-family:monospace;background:#1e2040;color:#9aa0b0;border:1px solid #2a2d3e;
                line-height:1.4}
            /* Подсветка совпавшего допуска — переливающийся градиент */
            .zm-oil-app-pill.zm-oil-app-match{
                background:linear-gradient(120deg,#1b5e20,#2e7d32,#43a047,#66bb6a,#43a047,#2e7d32,#1b5e20);
                background-size:300% 100%;
                color:#fff;
                border:1px solid #66bb6a;
                font-weight:700;
                box-shadow:0 0 8px rgba(102,187,106,.35);
                animation:zm-shimmer 3s linear infinite}
            @keyframes zm-shimmer{
                0%   {background-position:0% 50%}
                100% {background-position:300% 50%}
            }
            .zm-oil-app-btn{background:transparent;border:1px dashed #3a3d5e;color:#7986cb;
                font-size:10px;cursor:pointer;padding:3px 10px;border-radius:10px;
                margin-top:2px;display:inline-block;line-height:1.4}
            .zm-oil-app-btn:hover{border-color:#E67E00;color:#E67E00}
            .zm-oil-app-btn-open{border-style:solid;border-color:#E67E00;color:#E67E00}
            .zm-oil-app-others{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;
                padding:6px 8px;background:#0a0c12;border-radius:6px}
            .zm-oil-ads{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
            .zm-oil-ad-pill{display:inline-block;font-size:10px;padding:2px 8px;border-radius:10px;
                background:#1a1d2e;color:#a8b3d9;border:1px solid #2a2d3e;line-height:1.4}
            /* Присадки SPOT — фирменный оранжевый, тоже немного переливаются */
            .zm-oil-ad-pill.zm-oil-ad-pill-spot{
                background:linear-gradient(120deg,#3a2000,#5e3a00,#8a5500,#E67E00,#8a5500,#5e3a00,#3a2000);
                background-size:300% 100%;
                color:#fff;
                border:1px solid #E67E00;
                font-weight:600;
                box-shadow:0 0 6px rgba(230,126,0,.3);
                animation:zm-shimmer 4s linear infinite}
        `;
        document.head.appendChild(s);
    }

    function createWidget() {
        let w = document.getElementById('__zm_w');
        if (!w) {
            w = document.createElement('div');
            w.id = '__zm_w';
            document.body.appendChild(w);
        }
        return w;
    }

})();