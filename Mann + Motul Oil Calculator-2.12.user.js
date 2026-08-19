// ==UserScript==
// @name         Mann + Motul Oil Calculator
// @namespace    zamena-masla-spot.ru
// @version      2.23.593
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
// @grant        GM_xmlhttpRequest
// @connect      cars-db-backend.onrender.com
// @connect      localhost
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/Mann%20%2B%20Motul%20Oil%20Calculator-2.12.user.js
// @downloadURL  https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/Mann%20%2B%20Motul%20Oil%20Calculator-2.12.user.js
// ==/UserScript==

(() => {
  // shared/oils.js
  function getShopOils() {
    return [
      // Liqui Moly
      {
        b: "Liqui Moly",
        n: "5W-30 Top Tec",
        price: 2400,
        v: "5W-30",
        a: ["API SP", "ACEA C2", "ACEA C3", "LL 04", "LL 01", "MB 229.31", "MB 229.51", "MB 229.52", "FIAT 9.55535-S3", "FORD WSS-M2C 917-A", "VW 502 00", "VW 505 00", "VW 505 01", "VW 504 00", "VW 507 00", "PORSCHE C30"],
        ad: ["износ", "отложения", "температура", "топливо", "масло-угар"]
      },
      {
        b: "Liqui Moly",
        n: "5W-40 Top Tec",
        price: 2300,
        v: "5W-40",
        a: ["API SN", "ACEA C3", "MB 229.31", "PORSCHE A40", "VW 505 00", "VW 505 01", "LL 04", "FIAT 9.55535-H2", "FIAT 9.55535-M2", "FIAT 9.55535-S2", "FORD WSS-M2C 917-A", "GM DEXOS2", "RN 0700", "RN 0710"],
        ad: ["малозольное", "износ", "отложения", "температура", "топливо", "масло-угар"]
      },
      {
        b: "Liqui Moly",
        n: "Leichtlauf HC 7 5W-30",
        price: 2e3,
        v: "5W-30",
        a: ["ACEA A3/B4", "API SN", "LL 98", "MB 229.3", "RN 0700", "RN 0710", "VW 502 00", "VW 505 00", "GM LL-A-025", "GM LL-B-025"],
        ad: ["стиль вождения", "износ", "отложения", "топливо", "масло-угар"]
      },
      {
        b: "Liqui Moly",
        n: "Leichtlauf HC 7 5W-40",
        price: 2100,
        v: "5W-40",
        a: ["API SN Plus", "ACEA A3/B4", "LL 98", "MB 229.3", "PORSCHE A40", "VW 502 00", "VW 505 00", "GM LL-A-025", "GM LL-B-025", "RN 0700", "RN 0710"],
        ad: ["износ", "отложения", "топливо", "масло-угар"]
      },
      {
        b: "Liqui Moly",
        n: "5W-30 Molygen",
        price: 2350,
        v: "5W-30",
        a: ["API SP", "ILSAC GF-6A", "FIAT 9.55535-CR1", "FORD WSS-M2C 961-A1", "FORD WSS-M2C 946-A", "FORD WSS-M2C 946-B1"],
        ad: ["Америка/Азия", "износ", "отложения", "топливо", "масло-угар", "антифрикционные"]
      },
      {
        b: "Liqui Moly",
        n: "5W-40 Molygen",
        price: 2200,
        v: "5W-40",
        a: ["API SN", "ACEA A3/B4", "LL 01", "FIAT 9.55535-Z2", "FIAT 9.55535-H2", "FIAT 9.55535-N2", "MB 229.5", "PORSCHE A40", "RN 0700", "RN 0710", "VW 502 00", "VW 505 00", "GM LL-B-025"],
        ad: ["Америка/Азия", "износ", "отложения", "топливо", "масло-угар", "антифрикционные"]
      },
      // ROLF
      {
        b: "ROLF",
        n: "Professional 5W-30 A5/B5",
        price: 1500,
        v: "5W-30",
        a: ["API SP", "ACEA A5/B5", "FORD WSS-M2C913-A", "FORD WSS-M2C913-B", "FORD WSS-M2C913-C", "FORD WSS-M2C913-D", "JAGUAR STJLR.03.5003"],
        ad: ["внедорожники", "пуск в мороз", "износ", "отложения", "масло-угар"]
      },
      {
        b: "ROLF",
        n: "Professional AM 5W-40",
        price: 1750,
        v: "5W-40",
        a: ["API CF", "API SN Plus", "ACEA A3/B3", "ACEA A3/B4", "LL 01", "FIAT 9.55535-Z2", "GM LL-A-025", "GM LL-B-025", "PORSCHE A40", "PSA B71 2293", "PSA B71 2296", "RN 0700", "RN 0710", "VW 502 00", "VW 505 00", "MB 226.5", "MB 229.5"],
        ad: ["моющие присадки", "отложения", "нагар", "быстрый запуск"]
      },
      {
        b: "ROLF",
        n: "Professional 5W-30 C3",
        price: 1750,
        v: "5W-30",
        a: ["API SN", "ACEA C3", "LL 04", "PORSCHE C30", "VW 504 00", "VW 507 00", "MB 229.51"],
        ad: ["антикоррозия", "моющие присадки", "для турбо"]
      },
      {
        b: "ROLF",
        n: "Professional 0W-20",
        price: 1950,
        v: "0W-20",
        a: ["API SN", "ACEA C5", "FORD WSS-M2C947-B1", "JAGUAR STJLR.03.5006", "VW 508", "VW 509"],
        ad: ["низкосульфатное", "нейтрализация выхлопа", "экономия топлива"]
      },
      // Mobil
      {
        b: "Mobil",
        n: "Super 3000 FE 5W-30",
        price: 1800,
        v: "5W-30",
        a: ["API CF", "API SJ", "API SL", "API SM", "API SN", "API SN Plus", "API SP", "ACEA A5/B5", "FORD WSS-M2C913-C", "FORD WSS-M2C913-D", "JAGUAR STJLR"],
        ad: ["без саж.ф.", "всесезонное", "антикоррозия", "отложения", "топливо", "любой режим езды"]
      },
      {
        b: "Mobil",
        n: "Super 3000 5W-40",
        price: 1950,
        v: "5W-40",
        a: ["FIAT 9.55535-G2", "FIAT 9.55535-M2", "API CF", "ACEA A3/B3", "ACEA A3/B4", "API SL", "API SM", "API SN"],
        ad: ["любой стиль езды", "всесезонное"]
      },
      {
        b: "Mobil",
        n: "Ultra 10W-40",
        price: 1350,
        v: "10W-40",
        a: ["API SN", "API SL", "ACEA A3/B3", "API SN Plus", "MB 229.1", "API SJ", "API SM"],
        ad: ["шлам", "нагар", "коррозия", "пуск в мороз", "топливо", "масло-угар"]
      },
      {
        b: "Mobil",
        n: "ESP 5W-30",
        price: 2300,
        v: "5W-30",
        a: ["ACEA C3", "GM DEXOS2", "MB 229.31", "MB 229.51", "MB 229.52", "PSA B71 2290", "PSA B71 2297", "API CF", "API SJ", "API SL", "API SM", "API SN"],
        ad: ["малозольное", "износ", "отложения", "экстремальные температуры", "топливо", "масло-угар"]
      },
      // ZIC
      {
        b: "ZIC",
        n: "X8 SE 5W-30",
        price: 1800,
        v: "5W-30",
        a: ["API SP", "ACEA A5/B5", "FORD WSS-M2C913-D", "RN 0700", "JAGUAR STJLR 03.5003"],
        ad: ["быстрый запуск", "защита при нагрузках", "отложения", "нагар"]
      },
      {
        b: "ZIC",
        n: "X8 SE 5W-40",
        price: 1850,
        v: "5W-40",
        a: ["API SP", "ACEA A3/B4", "VW 502 00", "VW 505 00", "MB 229.5", "MB 229.3", "LL 01", "RN 0700", "RN 0710", "PSA B71 2296", "PORSCHE A40"],
        ad: ["интервал", "нагар", "отложения", "масло-угар"]
      },
      {
        b: "ZIC",
        n: "X9 FE 0W-20",
        price: 1550,
        v: "0W-20",
        a: ["API SP", "ILSAC GF-6A", "GM DEXOS1 Gen 3", "GM DEXOS1"],
        ad: ["бензин", "топливо", "низкотемпературное"]
      },
      {
        b: "ZIC",
        n: "TOP LS 5W-30",
        price: 1950,
        v: "5W-30",
        a: ["API SN", "ACEA C3", "VW 504 00", "VW 507 00", "MB 229.51", "PORSCHE C30", "LL 04"],
        ad: ["малозольное", "масло-угар", "отложения", "нагар", "температура"]
      },
      {
        b: "ZIC",
        n: "TOP 5W-40",
        price: 1900,
        v: "5W-40",
        a: ["API SQ", "ACEA A3/B3", "ACEA A3/B4", "VW 502 00", "VW 505 00", "MB 229.5", "MB 229.3", "LL 01", "RN 0700", "RN 0710", "PSA B71 2296", "PORSCHE A40"],
        ad: ["интервал", "масло-угар", "отложения", "нагар", "температура"]
      },
      {
        b: "ZIC",
        n: "ZERO 0W-30",
        price: 2150,
        v: "0W-30",
        a: ["ACEA C3", "VW 504 00", "VW 507 00"],
        ad: ["отложения", "нагар", "топливо"]
      },
      // GM / Shell / Castrol
      {
        b: "GM",
        n: "5W-30 Dexos II",
        price: 1650,
        v: "5W-30",
        a: ["ACEA A3/B3", "GM LL-B-025", "VW 505 01", "VW 502 00", "VW 505 00", "MB 229.51", "LL 04", "GM DEXOS2"],
        ad: ["низкая зольность", "износ", "топливо", "очистка"]
      },
      {
        b: "Shell",
        n: "5W-30 Ultra AM-L Kia/Hyundai",
        price: 2100,
        v: "5W-30",
        a: ["LL 04", "MB 229.51", "API SN", "API CF", "ACEA C3"],
        ad: ["топливо", "масло-угар", "пуск в мороз", "сажа", "низкозольное"]
      },
      {
        b: "Castrol",
        n: "5W-30 EDGE LL",
        price: 1950,
        v: "5W-30",
        a: ["MB 229.51", "MB 229.31", "VW 507 00", "VW 504 00", "PORSCHE C30", "ACEA C3"],
        ad: ["всесезонное", "отложения", "любой стиль вождения"]
      },
      // Motul
      {
        b: "Motul",
        n: "5W-30 8100 X-Clean+",
        price: 2450,
        v: "5W-30",
        a: ["LL 04", "MB 229.51", "PORSCHE C30", "VW 504 00", "VW 507 00", "ACEA C3", "API SM", "API CF"],
        ad: ["снижает трение", "износ", "моющие присадки", "нагар", "сажа", "топливо"]
      },
      {
        b: "Motul",
        n: "5W-30 SAVE-NERGY",
        price: 2150,
        v: "5W-30",
        a: ["FIAT 9.55535-G1", "FORD WSS M2C 913D", "JAGUAR STJLR 03.5003", "ACEA A5/B5", "API SL"],
        ad: ["трение", "тепловые нагрузки", "износ", "топливо", "масло-угар"]
      },
      {
        b: "Motul",
        n: "5W-40 6100 SYN-CLEAN",
        price: 2150,
        v: "5W-40",
        a: ["FORD WSS M2C 917A", "GM DEXOS2", "MB 229.51", "RN 0710", "RN 0700", "VW 505 00", "VW 505 01", "ACEA C3", "API SN"],
        ad: ["трение", "тепловые нагрузки", "износ", "топливо", "масло-угар"]
      },
      // Idemitsu / Zepro
      {
        b: "Idemitsu",
        n: "ZEPRO TOURING FS",
        price: 2250,
        v: "5W-30",
        a: ["API SP", "ILSAC GF-6A"],
        ad: ["отложения", "осадки", "топливо", "масло-угар"]
      },
      {
        b: "Idemitsu",
        n: "ZEPRO EURO SPEC FS",
        price: 2250,
        v: "5W-30",
        a: ["API SP", "ACEA C3"],
        ad: ["отложения", "сажа", "топливо", "масло-угар"]
      },
      // SPOT (наш бренд)
      {
        b: "SPOT",
        n: "OPTIMAL 5W-30",
        price: 1450,
        v: "5W-30",
        a: ["ACEA A3/B4", "API SN", "API CF", "VW 502 00", "VW 505 00", "MB 226.5", "MB 229.3", "RN 0700", "RN 0710", "GM LL-B-025", "PORSCHE A40", "LL 01"],
        ad: ["топливо", "низкотемпературное", "износ", "антикоррозия"],
        isSpot: true,
        tier: "optimal"
      },
      {
        b: "SPOT",
        n: "OPTIMAL 5W-40",
        price: 1450,
        v: "5W-40",
        a: ["ACEA A3/B4", "API SL", "VW 502 00", "VW 505 00", "MB 229.3", "RN 0700", "RN 0710", "АВТОВАЗ"],
        ad: ["топливо", "низкотемпературное", "износ", "антикоррозия"],
        isSpot: true,
        tier: "optimal"
      },
      {
        b: "SPOT",
        n: "PROFESSIONAL 5W-30",
        price: 1700,
        v: "5W-30",
        a: ["ACEA C3", "API SN", "API CF", "FORD WSS-M2C 913-A", "FORD WSS-M2C 913-B", "FORD WSS-M2C 913-C", "RN 0700", "ILSAC GF-5"],
        ad: ["топливо", "низкотемпературное", "износ", "антикоррозия"],
        isSpot: true,
        tier: "pro"
      },
      {
        b: "SPOT",
        n: "PROFESSIONAL 5W-40",
        price: 1700,
        v: "5W-40",
        a: ["GM DEXOS2", "MB 229.51", "MB 229.31", "MB 226.5", "RN 0700", "RN 0710", "VW 505 00", "VW 505 01", "LL 04", "PORSCHE A40", "FORD WSS-M2C-917-A"],
        ad: ["топливо", "низкотемпературное", "износ", "антикоррозия"],
        isSpot: true,
        tier: "pro"
      }
    ];
  }
  function getDefaults() {
    return {
      gear75W90: [
        { b: "ZIC", n: "GFT 75W-90", price: 1380, v: "75W-90" },
        { b: "ROLF", n: "Professional 75W-90", price: 1950, v: "75W-90" }
      ],
      cvt: [
        { b: "ZIC", n: "CVT Multi HP", price: 1650, v: "CVT" },
        { b: "ROLF", n: "Professional CVTF Multi", price: 1850, v: "CVT" }
      ],
      dct: [
        { b: "ZIC", n: "DCT FE (для роботов с мокр. сц.)", price: 1600, v: "DCT" },
        { b: "ZIC", n: "DCTF Multi", price: 1600, v: "DCT" },
        { b: "ROLF", n: "Professional DCT", price: 2e3, v: "DCT" }
      ],
      atf: {
        zic: {
          b: "ZIC",
          n: "ATF Multi",
          price: 1400,
          v: "ATF",
          _type: "multi",
          a: ["Aisin Warner AW-1", "DSIH 6p805 (Geely, Ssangyoung, Mahindra)", "Ford Mercon LV", "GM Dexron VI", "Honda DW-1", "Hyundai/KIA ATF SP-IV", "Hyundai/KIA ATF SPH-IV", "Hyundai/KIA ATF SP-IV RR", "Hyundai/KIA ATF SP-IV M1", "Hyundai/KIA NWS-9638", "Mazda ATF-FZ", "Mitsubishi ATF-J3", "Mitsubishi ATF-PA", "Mitsubishi SP-IV", "Nissan Matic Fluid S", "Nissan Matic Fluid W", "Toyota WS", "JWS 3324", "Audi/VW G 055 540", "Audi/VW G 055 005", "Audi/VW G 055 162", "BMW 83 22 0 142 516", "MB 236.12", "MB 236.14", "MB 236.15", "MB 236.41", "Volvo 6 speed MY 2011-2013 (P/N 31256774)", "Volvo 6 speed MY 2011-2013 (P/N 31256775)", "ZF 6 Speed (S671 090 255)"]
        },
        rolfDexron6: {
          b: "ROLF",
          n: "ATF Dexron VI",
          price: 1750,
          v: "ATF",
          _type: "dexron6",
          a: ["BMW 83 22 0 142 516", "BMW 83 22 0 163 514", "BMW 83 22 0 397 114", "BMW 83 22 2 152 426", "BMW 83 22 2 289 720", "BMW 83 22 2 305 396", "BMW 83 22 2 305 397", "BMW ATF 2", "BMW ATF 3+", "BMW ATF 6", "Ford Mercon LV", "GM AW-1", "GM DEXRON VI", "Honda DW-1", "Hyundai / Kia ATF SPH-IV", "Hyundai / Kia ATF SP-IV", "Hyundai / Kia NWS-9638", "Jaguar Fluid 8432", "Jaguar LR023288", "Land Rover LR0022460", "Land Rover TYK500050", "Mazda FZ", "MB 236.12", "MB 236.14", "MB 236.15", "MB 236.41", "Mitsubishi ATF-J3", "Nissan Matic S", "Saab AW-1", "Toyota WS", "VW G 052 533", "VW G 055 005", "VW G 055 162", "VW G 055 540", "VW G 060 162"]
        },
        rolfMulti: {
          b: "ROLF",
          n: "Professional ATF Multi",
          price: 1750,
          v: "ATF",
          _type: "multi",
          a: ["Allison C-4", "BMW 81 22 9 400 272", "BMW 81 22 9 400 275", "BMW 81 22 9 407 858", "BMW 81 22 9 407 859", "BMW 83 22 0 024 249", "BMW 83 22 0 024 359", "BMW 83 22 0 026 922", "BMW 83 22 0 402 413", "BMW 83 22 0 403 248", "BMW 83 22 7 542 290", "BMW 83 22 9 407 765", "BMW 83 22 9 407 807", "Chrysler / Dodge / Jeep ATF+4", "Chrysler / Dodge / Jeep SP-III", "DTFR 13C180", "DTFR 38B100", "Ford WSS-M2C922-A1", "GM DEXRON II", "GM DEXRON IID", "GM DEXRON IIE", "GM DEXRON IIIG", "GM DEXRON IIIH", "GM Type A Suffix A", "Honda Z-1", "Hyundai / Kia ATF Red-1K", "Hyundai / Kia Genuine ATF", "Hyundai / Kia SP-II", "Hyundai / Kia SP-III", "Isuzu ATF II", "Isuzu ATF III", "Isuzu Genuine ATF", "Jaguar JLM 20238", "Jaguar JLM 20292", "Jaguar JLM 21044", "Jaguar K17", "Jaguar LT 71141", "Land Rover ETL-7045E", "MAN 339 A", "Mazda F-1", "Mazda JWS 3317", "Mazda M-V", "Mazda T-IV", "MB 236.10", "MB 236.11", "MB 236.3", "MB 236.5", "MB 236.6", "MB 236.7", "MB 236.8", "MB 236.9", "MB 236.91", "Mitsubishi ATF-J2", "Mitsubishi SP-II", "Mitsubishi SP-III", "Nissan 402", "Nissan Matic D", "Nissan Matic J", "Nissan Matic K", "Nissan Matic W", "Renault Matic D2", "Saab 3309 (T-IV)", "Ssang Yong DSIH 5M-66", "Subaru HP", "Suzuki 3314", "Suzuki 3317", "Toyota D-II", "Toyota T-III", "Toyota T-IV", "VW G 052 025", "VW G 052 055", "VW G 052 162", "VW G 052 990", "VW G 055 025", "VW G US 000 162"]
        }
      }
    };
  }
  function getReglament() {
    return {
      BMW: {
        tags: ["BMW SPECIAL OIL", "LL 98", "LL 01", "LL 01 FE", "LL 04"],
        descriptions: {
          "BMW SPECIAL OIL": "BMW Special Oil. Подходит для силовых агрегатов с единой спецификацией.",
          "LL 98": "BMW Longlife-98. Для бензиновых и дизельных двигателей, изготовленных после 1998 г.",
          "LL 01": "BMW Longlife-01. Для двигателей, выпущенных после 2001 г.",
          "LL 01 FE": "BMW Longlife-01 FE. Пониженная вязкость. Подходит не для всех моделей.",
          "LL 04": "BMW Longlife-04. Для новых двигателей с системами токсичности (DPF)."
        }
      },
      VAG: {
        tags: ["VW 500 00", "VW 501 01", "VW 502 00", "VW 503 00", "VW 503 01", "VW 504 00", "VW 505 00", "VW 505 01", "VW 506 00", "VW 506 01", "VW 507 00"],
        descriptions: {
          "VW 500 00": "VW 500.00. Всесезонная эксплуатация без принудительного нагнетателя.",
          "VW 501 01": "VW 501.01. Для машин с распределённым впрыском. Бензин/дизель. ACEA A2.",
          "VW 502 00": "VW 502.00. Для ТС с распределённым впрыском, бензин. ACEA A3.",
          "VW 503 00": "VW 503.00. Двигатели 1999-2005 г.г. Увеличенный интервал замены.",
          "VW 503 01": "VW 503.01. Для некоторых бензиновых двигателей.",
          "VW 504 00": "VW 504.00. Для любых бензиновых двигателей с увеличенным интервалом замены.",
          "VW 505 00": "VW 505.00. Для дизелей. Соответствует CCMC PD-2 и ACEA A3.",
          "VW 505 01": "VW 505.01. Для дизелей с насосами-форсунками разного типа.",
          "VW 506 00": "VW 506.00. Дизели после 1999 г. ACEA B4. SAE 5W-40.",
          "VW 506 01": "VW 506.01. Для движков с насосом-форсункой.",
          "VW 507 00": "VW 507.00. Дизели с любым типом впрыска. Совместим с DPF."
        }
      },
      MERCEDES: {
        tags: ["MB 229.1", "MB 229.3", "MB 229.31", "MB 229.5", "MB 229.51"],
        descriptions: {
          "MB 229.1": "MB 229.1. Грузовые Mercedes-Benz с дизельными двигателями.",
          "MB 229.3": "MB 229.3. Дизели на грузовом транспорте и тягачах.",
          "MB 229.31": "MB 229.31. Коммерческий грузовой транспорт с дизелями + DPF.",
          "MB 229.5": "MB 229.5. Дизели коммерческого грузового транспорта при больших нагрузках.",
          "MB 229.51": "MB 229.51. Дизели коммерческой техники. Максимальный интервал замены с DPF."
        }
      },
      FORD: {
        tags: ["FORD WSS-M2C 912-A1", "FORD WSS-M2C 913-A", "FORD WSS-M2C 913-B", "FORD WSS-M2C 913-C", "FORD WSS-M2C 917-A"],
        descriptions: {
          "FORD WSS-M2C 912-A1": "WSS-M2C 912 A1. Для всех легковых машин на дизеле или бензине.",
          "FORD WSS-M2C 913-A": "WSS-M2C 913 A. Для всех легковых на дизеле или бензине.",
          "FORD WSS-M2C 913-B": "WSS-M2C 913 B. На базе ACEA A1/B1.",
          "FORD WSS-M2C 913-C": "WSS-M2C 913 C. Для всех моделей Форд.",
          "FORD WSS-M2C 917-A": "WSS-M2C 917 A. Дизели объёмом 1.9 л. ACEA A3/B3."
        }
      },
      RENAULT: {
        tags: ["RN 0700", "RN 0710", "RN 0720"],
        descriptions: {
          "RN 0700": "RN 0700. Дизели и бензин без наддува. Подходит для 1.5 DCi до 100 л.с. без DPF.",
          "RN 0710": "RN 0710. Аналогично RN 0700. Подходит для Renault Sport.",
          "RN 0720": "RN 0720. Обновлённые дизели с турбонаддувом и DPF. ACEA C4."
        }
      },
      OPEL: {
        tags: ["GM-LL-A-025", "GM-LL-B-025", "DEXOS 1", "DEXOS 2"],
        descriptions: {
          "GM-LL-A-025": "GM-LL-A-025. Легковые на бензине. ACEA A3.",
          "GM-LL-B-025": "GM-LL-B-025. Легковые на дизеле. ACEA B3, B4.",
          "DEXOS 1": "Dexos 1. Бензиновые.",
          "DEXOS 2": "Dexos 2. Опели от 2010 г.в. ACEA C3-08."
        }
      },
      PSA: {
        tags: ["PSA B71 2290", "PSA B71 2294", "PSA B71 2295", "PSA B71 2296"],
        descriptions: {
          "PSA B71 2290": "PSA B71 2290. Дизели с DPF.",
          "PSA B71 2294": "PSA B71 2294. Соответствие ACEA A3/B4 и C3.",
          "PSA B71 2295": "PSA B71 2295. Двигатели до 1998 г.",
          "PSA B71 2296": "PSA B71 2296. ACEA A3/B4."
        }
      }
    };
  }
  function getReglamentForBrand(brand) {
    if (!brand) return null;
    const b = brand.toUpperCase();
    const reg = getReglament();
    if (b === "BMW" || b === "MINI") return { brand: "BMW", ...reg.BMW };
    if (["VOLKSWAGEN", "VW", "AUDI", "SKODA", "SEAT", "PORSCHE"].includes(b)) return { brand: "VAG", ...reg.VAG };
    if (["MERCEDES", "MERCEDES-BENZ", "MB", "SMART"].includes(b)) return { brand: "MERCEDES", ...reg.MERCEDES };
    if (["FORD", "JAGUAR", "LAND ROVER", "LANDROVER", "VOLVO"].includes(b)) return { brand: "FORD", ...reg.FORD };
    if (["RENAULT", "DACIA", "NISSAN", "INFINITI"].includes(b)) return { brand: "RENAULT", ...reg.RENAULT };
    if (["OPEL", "CHEVROLET", "BUICK", "CADILLAC", "GMC"].includes(b)) return { brand: "OPEL", ...reg.OPEL };
    if (["PEUGEOT", "CITROEN", "CITROËN", "DS"].includes(b)) return { brand: "PSA", ...reg.PSA };
    return null;
  }

  // shared/fuel.js
  var FUEL_OPTIONS = [
    { code: "", label: "не указано" },
    { code: "01", label: "бензин" },
    { code: "02", label: "бензин + газ" },
    { code: "05", label: "дизель" }
  ];
  var DIESEL_CODES = /* @__PURE__ */ new Set(["05", "06"]);
  var PETROL_CODES = /* @__PURE__ */ new Set(["01", "02", "04"]);
  function isDieselFuel(fuelType) {
    const ft = String(fuelType == null ? "" : fuelType).trim();
    return DIESEL_CODES.has(ft) || /дизел|diesel/i.test(ft);
  }
  function isPetrolFuel(fuelType) {
    const ft = String(fuelType == null ? "" : fuelType).trim();
    return PETROL_CODES.has(ft) || /бензин|petrol|gasol|этанол|ethanol|\bгаз\b|lpg|cng/i.test(ft);
  }
  function normalizeFuelCode(fuelType) {
    const ft = String(fuelType == null ? "" : fuelType).trim();
    if (isDieselFuel(ft)) return "05";
    if (ft === "02" || /газ|lpg|cng/i.test(ft)) return "02";
    if (isPetrolFuel(ft)) return "01";
    return "";
  }
  function fuelLabel(fuelType) {
    const ft = String(fuelType == null ? "" : fuelType).trim();
    if (!ft) return "";
    if (isDieselFuel(ft)) return "дизель";
    if (ft === "02") return "бензин + газ";
    if (isPetrolFuel(ft)) return "бензин";
    const safe = ft.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    return `топливо: ${safe}?`;
  }
  function fuelSelectOptions(current) {
    const cur = normalizeFuelCode(current);
    return FUEL_OPTIONS.map(
      (o) => `<option value="${o.code}"${o.code === cur ? " selected" : ""}>${o.label}</option>`
    ).join("");
  }

  // shared/crmQuirks.js
  var SEVERITY_LABELS = {
    block: "так не делаем",
    warn: "смотреть по факту",
    info: "к сведению"
  };
  var BRAND_ALIASES = {
    "шкода": "skoda",
    "сеат": "seat",
    "ауди": "audi",
    "форд": "ford",
    "ситроен": "citroen",
    "ситроэн": "citroen",
    "citroën": "citroen",
    "пежо": "peugeot",
    "рено": "renault",
    "вольво": "volvo",
    "ниссан": "nissan",
    "мазда": "mazda",
    "тойота": "toyota",
    "мицубиси": "mitsubishi",
    "митсубиши": "mitsubishi",
    "мицубиши": "mitsubishi",
    "фольксваген": "volkswagen",
    "vw": "volkswagen",
    "фолькс": "volkswagen",
    "порше": "porsche",
    "бмв": "bmw",
    "мерседес": "mercedes",
    "мерс": "mercedes",
    "mercedes benz": "mercedes",
    "хундай": "hyundai",
    "хёндай": "hyundai",
    "хендай": "hyundai",
    "киа": "kia",
    "шевроле": "chevrolet",
    "опель": "opel",
    "кадиллак": "cadillac",
    "джили": "geely",
    "гили": "geely",
    "чери": "chery",
    "грейт вол": "great wall",
    "greatwall": "great wall"
  };
  var GM_BRANDS = ["chevrolet", "opel", "cadillac", "gmc", "buick", "hummer", "daewoo"];
  var WET_ROBOT_BRANDS = ["volkswagen", "skoda", "seat", "audi", "porsche", "ford", "volvo"];
  var SKODA_SEAT_SUV = ["kodiaq", "karoq", "kamiq", "yeti", "ateca", "tarraco", "arona"];
  function normStr(s) {
    return String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zа-я0-9]+/g, " ").trim();
  }
  function canonBrand(raw) {
    const n = normStr(raw);
    if (BRAND_ALIASES[n]) return BRAND_ALIASES[n];
    const first = n.split(" ")[0];
    return BRAND_ALIASES[first] && n.split(" ").length <= 2 ? BRAND_ALIASES[first] : n;
  }
  function num(v) {
    const n = parseFloat(String(v == null ? "" : v).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  function quirkContext(car, data) {
    const src = car || {};
    const brand = canonBrand(src.makeShort || src.brand || src.make || "");
    let model = normStr(src.modelShort || src.model || "");
    if (brand && model.startsWith(brand)) model = model.slice(brand.length).trim();
    const generation = normStr(src.generation || "");
    const auto = data && data.automatic || null;
    return {
      brand,
      model,
      modelTokens: new Set([...model.split(" "), ...generation.split(" ")].filter(Boolean)),
      generation,
      engineCode: normStr(src.engineCode || src.engine_code || ""),
      volume: num(src.volume != null && src.volume !== "" ? src.volume : src.engine_volume),
      bhp: num(src.bhp),
      year: num(src.yearFrom || src.year_from),
      fuel: normStr(src.fuelType || src.fuel_type || ""),
      hasAuto: !!auto,
      isCvt: !!(auto && auto.isCvt),
      isDct: !!(auto && auto.isDct),
      hasManual: !!(data && data.manual)
    };
  }
  function modelHits(ctx, patterns) {
    if (!patterns || !patterns.length) return true;
    return patterns.some((p) => normStr(p).split(" ").every((t) => ctx.modelTokens.has(t)));
  }
  var CRM_QUIRKS = [
    // 1. Skoda / Seat — аппарат не подключить
    {
      id: "skoda-seat-at-no-full",
      scope: "automatic",
      severity: "block",
      noFullAt: true,
      brands: ["skoda", "seat"],
      when: (ctx) => !modelHits(ctx, SKODA_SEAT_SUV),
      text: "Полную (аппаратную) замену не делаем — аппарат не подключается к системе охлаждения. Частичную делаем.",
      note: "Полная на этих марках допустима только на внедорожниках."
    },
    {
      id: "skoda-seat-suv-at-by-fact",
      // Пока подключение не проверили — расчёт частичной: это единственный
      // вариант, который на этой машине точно сделают.
      scope: "automatic",
      severity: "warn",
      partialDefault: true,
      brands: ["skoda", "seat"],
      models: SKODA_SEAT_SUV,
      text: "Полную (аппаратную) на Skoda и Seat делаем только на внедорожниках — этот как раз внедорожник. Смотрим по факту: подключается ли аппарат и есть ли переходники."
    },
    // 2. Audi A4 / A5 / A6 — вариатор под высоким давлением
    {
      id: "audi-a456-cvt-no-full",
      scope: "automatic",
      severity: "block",
      noFullAt: true,
      brands: ["audi"],
      models: ["a4", "a5", "a6"],
      text: "Вариатор (мультитроник): полную (аппаратную) не делаем — в системе охлаждения вариатора высокое давление. Частичную делаем.",
      note: "У этого вариатора есть ещё фильтр тонкой очистки жидкости."
    },
    // 3. Ford — пробка МКПП и Kuga
    {
      id: "ford-manual-neutral",
      scope: "manual",
      severity: "warn",
      brands: ["ford"],
      text: "Ручка КПП при замене должна стоять на нейтрали. Если воткнута передача, при закручивании сливной пробки ломается механизм шарика — пробку придётся менять."
    },
    {
      id: "ford-kuga-at-no-full",
      scope: "automatic",
      severity: "block",
      noFullAt: true,
      brands: ["ford"],
      models: ["kuga"],
      text: "Полную (аппаратную) не делаем — у этой АКПП нет системы охлаждения. Частичную делаем.",
      note: "Фильтр в этой АКПП не меняется."
    },
    // 4. Ford Focus — шестиступенчатая МКПП на DCTF
    {
      id: "ford-focus-manual-dctf",
      scope: "manual",
      severity: "info",
      brands: ["ford"],
      models: ["focus"],
      text: "Если МКПП шестиступенчатая — заливаем масло DCTF."
    },
    // 5. Французы — нет системы охлаждения АКПП
    {
      id: "psa-renault-at-no-full",
      scope: "automatic",
      severity: "block",
      noFullAt: true,
      brands: ["citroen", "peugeot", "renault"],
      text: "Полную (аппаратную) не делаем ни на одной модели этой марки — нет системы охлаждения АКПП. Частичную делаем."
    },
    // 6. Не откачать через щуп — только слив
    {
      id: "engine-no-express",
      scope: "engine",
      severity: "block",
      models: ["hover", "prado", "land cruiser 200", "lc200", "pajero sport"],
      text: "Экспресс-замену масла ДВС не делаем — откачкой масло полностью не убрать. Меняем только сливом через пробку.",
      note: "В CRM правило записано для мотора 2.4D (с 2019 года)."
    },
    // 7. GM — МКПП без сливной пробки
    {
      id: "gm-manual-sump",
      scope: "manual",
      severity: "warn",
      brands: GM_BRANDS,
      text: "В МКПП нет сливной пробки — снимаем поддон, под ним прокладка. Прокладку мастер подбирает строго по VIN, они разные.",
      note: "Считаем как «замена масла МКПП» + «замена фильтра КПП / с.у. поддона»."
    },
    // 8-9. VW Polo и Tiguan — контура охлаждения нет
    {
      id: "vw-polo-tiguan-at-no-full",
      scope: "automatic",
      severity: "block",
      noFullAt: true,
      brands: ["volkswagen"],
      models: ["polo", "tiguan"],
      text: "Аппаратно (полную) не делаем — нет контура охлаждения АКПП, подключаться некуда. Делаем частичную.",
      note: "На разных комплектациях подключение иногда есть — смотреть по факту."
    },
    // 10. Touareg / Cayenne 3.6 — фильтр можно перепутать с теплообменником
    {
      id: "touareg-cayenne-oil-filter",
      scope: "engine",
      severity: "warn",
      models: ["touareg", "cayenne"],
      when: (ctx) => ctx.volume == null || Math.abs(ctx.volume - 3.6) < 0.15,
      text: "Мотор 3.6 (280 л.с.): масляный фильтр внизу по левой стороне. Прямо над ним теплообменник с очень похожей крышкой — не перепутать.",
      note: "Артикул масляного фильтра — HU 932/6n."
    },
    // 11. Volvo — высокое давление в АКПП
    {
      id: "volvo-at-no-full",
      scope: "automatic",
      severity: "block",
      noFullAt: true,
      brands: ["volvo"],
      text: "Аппаратно (полную) не делаем — высокое давление рабочей жидкости АКПП. Вместо неё предлагаем частичную три раза подряд: с запуском двигателя и перебором режимов АКПП."
    },
    // 12. Вариаторы Nissan и Outlander 3 — два фильтра
    {
      id: "nissan-cvt-fine-filter",
      scope: "automatic",
      severity: "info",
      when: (ctx) => ctx.isCvt && (ctx.brand === "nissan" || ctx.brand === "mitsubishi" && modelHits(ctx, ["outlander"])),
      text: "В вариаторе два фильтра — грубой и тонкой очистки. За замену фильтра тонкой очистки берём дополнительно нормо-час."
    },
    // 13. Mazda 6 — аппарат не подключить
    {
      id: "mazda6-at-no-full",
      scope: "automatic",
      severity: "block",
      noFullAt: true,
      brands: ["mazda"],
      models: ["6"],
      text: "Полную (аппаратную) замену не делаем — аппарат не подключается к системе охлаждения. Частичную делаем."
    },
    // 14. Фильтр АКПП: в шестиступенчатых его физически не поменять
    {
      id: "at-filter-6ab",
      scope: "automatic",
      severity: "info",
      when: (ctx) => ctx.hasAuto && !ctx.isCvt && !ctx.isDct && ctx.brand !== "bmw" && ctx.brand !== "mercedes",
      text: "Почти во всех шестиступенчатых автоматах фильтр АКПП заменить технически нельзя, даже если он там стоит. Исключения — BMW и Mercedes.",
      note: "Меняется ли фильтр на этой машине и с какого года — смотреть в списке «Фильтра в АКПП»."
    },
    {
      id: "camry-at-filter-fixed",
      scope: "automatic",
      severity: "info",
      brands: ["toyota"],
      models: ["camry"],
      text: "В восьмиступенчатой АКПП Камри фильтр несменный."
    },
    {
      id: "creta-at-filter-fixed",
      scope: "automatic",
      severity: "info",
      brands: ["hyundai"],
      models: ["creta"],
      text: "Фильтр АКПП на Крете не меняется."
    },
    // 16. VAG 1.4 TSI (DJKA) + АКПП AQ 300-8F
    {
      id: "vag-aq300-atf",
      scope: "automatic",
      severity: "info",
      brands: ["skoda", "volkswagen"],
      models: ["karoq", "taos", "jetta", "octavia"],
      when: (ctx) => ctx.engineCode.includes("djka") || ctx.modelTokens.has("taos") || ctx.modelTokens.has("karoq") || ctx.modelTokens.has("a8") || ctx.volume != null && Math.abs(ctx.volume - 1.4) < 0.05 && (ctx.year == null || ctx.year >= 2018),
      text: "Поперечный 1.4 TSI 150 л.с. (DJKA) с восьмиступенчатой АКПП AQ 300-8F: допуск по маслу VAG ATF G 053 001 A2.",
      note: "На Рольфе и ZIC эти машины не бьются — допуск смотреть у Ravenol."
    },
    // 17. Роботы
    {
      id: "dsg-powershift-no-service",
      scope: "automatic",
      severity: "block",
      when: (ctx) => ctx.isDct && WET_ROBOT_BRANDS.includes(ctx.brand),
      text: "Масло в роботах DSG и PowerShift не меняем."
    },
    {
      id: "robot-other-as-is",
      scope: "automatic",
      severity: "info",
      when: (ctx) => ctx.isDct && !WET_ROBOT_BRANDS.includes(ctx.brand),
      text: "Это не DSG и не PowerShift — в остальных роботах масло меняем как есть."
    },
    // 19. Chery Tiggo 8 — робот Getrag обслуживается как механика
    {
      id: "chery-tiggo8-getrag",
      scope: "automatic",
      severity: "info",
      brands: ["chery"],
      models: ["tiggo 8"],
      text: "Замена масла в роботе Getrag делается как в обычной механике — входит ровно 4 литра."
    },
    // 20. BMW — только по факту
    {
      id: "bmw-at-by-fact",
      scope: "automatic",
      severity: "warn",
      brands: ["bmw"],
      text: "Аппаратную (полную) делаем только по факту: смотрим на месте, подключается ли аппарат и есть ли переходники."
    },
    // 21. Hyundai / Kia — посторонние предметы в масляном фильтре
    {
      id: "hyundai-kia-oil-filter-check",
      scope: "engine",
      severity: "warn",
      brands: ["hyundai", "kia"],
      text: "Перед установкой масляного фильтра проверь его сердцевину: на Хендай и Киа в ней находят посторонние предметы. Оставшаяся внутри пробка забьёт масляный канал."
    },
    // 22. Geely Tugella
    {
      id: "geely-tugella-at-no-full",
      scope: "automatic",
      severity: "block",
      noFullAt: true,
      brands: ["geely"],
      models: ["tugella"],
      text: "Полную замену в АКПП на Тугелле не сделать. Делаем частичную."
    }
  ];
  function crmQuirksFor(car, data) {
    const ctx = quirkContext(car, data);
    if (!ctx.brand && !ctx.model) return [];
    const out = [];
    for (const q of CRM_QUIRKS) {
      if (q.brands && !q.brands.includes(ctx.brand)) continue;
      if (q.models && !modelHits(ctx, q.models)) continue;
      if (q.when && !q.when(ctx)) continue;
      out.push({
        id: q.id,
        scope: q.scope,
        severity: q.severity,
        text: q.text,
        note: q.note || "",
        noFullAt: !!q.noFullAt,
        partialDefault: !!(q.noFullAt || q.partialDefault)
      });
    }
    return out;
  }
  function crmQuirksForAggregate(car, data, aggregate) {
    const scope = aggregate && (aggregate.group === "engine" ? "engine" : aggregate.group === "auto" ? "automatic" : aggregate.key === "manual" ? "manual" : null);
    if (!scope) return [];
    return crmQuirksFor(car, data).filter((q) => q.scope === scope);
  }
  function crmNoFullAt(car, data) {
    return crmQuirksFor(car, data).some((q) => q.noFullAt);
  }
  function crmPrefersPartial(car, data) {
    return crmQuirksFor(car, data).some((q) => q.partialDefault);
  }

  // shared/oemRules.js
  var normMake = (s) => String(s == null ? "" : s).toUpperCase().replace(/[^A-ZА-Я0-9]/g, "");
  var MB = ["MERCEDES", "MERCEDESBENZ", "MB", "SMART", "MAYBACH"];
  var BMW = ["BMW", "MINI", "ROLLSROYCE"];
  var VAG = ["VW", "VOLKSWAGEN", "AUDI", "SKODA", "SEAT", "CUPRA"];
  var RENO = ["RENAULT", "DACIA"];
  var LADA = ["LADA", "VAZ", "AVTOVAZ", "ЛАДА", "ВАЗ", "АВТОВАЗ"];
  var PSA = ["PEUGEOT", "CITROEN", "CITROËN", "DS"];
  var GM = ["OPEL", "VAUXHALL", "CHEVROLET", "DAEWOO", "UZDAEWOO", "RAVON"];
  var KOREA = ["HYUNDAI", "KIA", "GENESIS"];
  var JAPAN = [
    "TOYOTA",
    "LEXUS",
    "MAZDA",
    "HONDA",
    "ACURA",
    "MITSUBISHI",
    "SUZUKI",
    "SUBARU",
    "DAIHATSU",
    "NISSAN",
    "INFINITI",
    "DATSUN"
  ];
  var RULES = [
    // ── АвтоВАЗ ──────────────────────────────────────────────────────────────
    // Единственный случай, где правило ОСЛАБЛЯЕТ возрастную эвристику: Лада
    // выпускается под Евро-5 без бензинового сажевого фильтра, и правило
    // «бензин с 2018 → GPF» для неё просто неверно — оно снимало с подбора все
    // полнозольные масла, включая то, которое одобрил сам завод.
    {
      id: "VAZ",
      makes: LADA,
      specs: ["АвтоВАЗ"],
      filter: "none",
      why: "АвтоВАЗ — сажевого фильтра нет ни на одной модели, требований по зольности завод не предъявляет. Годится любое масло нужной вязкости с одобрением ВАЗа."
    },
    // ── Mercedes-Benz ────────────────────────────────────────────────────────
    // Дизели CDI получили сажевый фильтр раньше общеевропейского Euro 5:
    // OM 642 и OM 646 идут с ним с 2005 года, поэтому здесь `filter: 'dpf'`.
    {
      id: "MB-DIESEL-DPF",
      makes: MB,
      fuel: "diesel",
      from: 2005,
      specs: ["MB 229.51"],
      filter: "dpf",
      why: "Дизель Mercedes с 2005 года — сажевый фильтр уже стоит (OM 642/646 CDI). Завод требует 229.51: среднезольное при HTHS ≥ 3.5."
    },
    {
      id: "MB-DIESEL",
      makes: MB,
      fuel: "diesel",
      to: 2004,
      specs: ["MB 229.5"],
      why: "Дизель Mercedes до 2005 года — сажевого фильтра нет, завод требует полнозольное 229.5 (HTHS ≥ 3.5)."
    },
    {
      id: "MB-PETROL-GPF",
      makes: MB,
      fuel: "petrol",
      from: 2018,
      specs: ["MB 229.52"],
      why: "Бензиновый Mercedes с 2018 года (Euro 6d) — бензиновый сажевый фильтр. Требование 229.52: среднезольное при HTHS ≥ 3.5."
    },
    {
      id: "MB-PETROL",
      makes: MB,
      fuel: "petrol",
      from: 1998,
      to: 2017,
      specs: ["MB 229.5"],
      why: "Бензиновый Mercedes до 2018 года — фильтра нет, штатное требование 229.5."
    },
    {
      id: "MB-ANY",
      makes: MB,
      from: 2005,
      specs: ["MB 229.51"],
      why: "Mercedes с 2005 года. Топливо в карточке не указано, поэтому берём более строгую из двух веток — 229.51: среднезольное масло подходит и бензиновому мотору, а полнозольное дизельному с фильтром — нет."
    },
    // ── BMW / Mini ───────────────────────────────────────────────────────────
    // Дизели BMW получили сажевый фильтр с 2004 года — раньше Euro 5.
    {
      id: "BMW-DIESEL-DPF",
      makes: BMW,
      fuel: "diesel",
      from: 2004,
      specs: ["BMW LL-04"],
      filter: "dpf",
      why: "Дизель BMW с 2004 года — сажевый фильтр. Требование Longlife-04: среднезольное при HTHS ≥ 3.5."
    },
    {
      id: "BMW-DIESEL",
      makes: BMW,
      fuel: "diesel",
      to: 2003,
      specs: ["BMW LL-01"],
      why: "Дизель BMW до 2004 года — фильтра нет, штатное требование Longlife-01."
    },
    {
      id: "BMW-PETROL-GPF",
      makes: BMW,
      fuel: "petrol",
      from: 2018,
      specs: ["BMW LL-04"],
      why: "Бензиновый BMW с 2018 года (Euro 6d) — бензиновый сажевый фильтр, поэтому Longlife-04, а не полнозольный Longlife-01."
    },
    {
      id: "BMW-PETROL",
      makes: BMW,
      fuel: "petrol",
      from: 2001,
      to: 2017,
      specs: ["BMW LL-01"],
      why: "Бензиновый BMW 2001–2017 — штатное требование Longlife-01 (полнозольное, HTHS ≥ 3.5)."
    },
    {
      id: "BMW-PETROL-98",
      makes: BMW,
      fuel: "petrol",
      from: 1998,
      to: 2e3,
      specs: ["BMW LL-98"],
      why: "Бензиновый BMW 1998–2000 — эпоха Longlife-98."
    },
    {
      id: "BMW-ANY",
      makes: BMW,
      from: 2004,
      specs: ["BMW LL-04"],
      why: "BMW с 2004 года. Топливо не указано — берём Longlife-04: он подходит и бензиновому мотору, а полнозольный Longlife-01 дизелю с фильтром нет."
    },
    // ── Концерн VAG ──────────────────────────────────────────────────────────
    // У VAG сажевый фильтр на дизелях стал стандартом с 2007 года — на два года
    // раньше Euro 5.
    {
      id: "VAG-DIESEL-DPF",
      makes: VAG,
      fuel: "diesel",
      from: 2007,
      specs: ["VW 507 00"],
      filter: "dpf",
      why: "Дизель VAG с 2007 года — сажевый фильтр. Требование 507 00 (LongLife III): среднезольное, HTHS ≥ 3.5. Полнозольное 505 00 такому мотору льют только по недосмотру — оно забивает фильтр."
    },
    {
      id: "VAG-DIESEL",
      makes: VAG,
      fuel: "diesel",
      from: 1996,
      to: 2006,
      specs: ["VW 505 00"],
      why: "Дизель VAG до 2007 года — фильтра нет, штатное требование 505 00."
    },
    {
      id: "VAG-PETROL-LL3",
      makes: VAG,
      fuel: "petrol",
      from: 2010,
      specs: ["VW 504 00"],
      why: "Бензиновый VAG с 2010 года — эпоха LongLife III (504 00). Масло по 504 00 покрывает и 502 00, поэтому подходит и моторам с фиксированным интервалом."
    },
    {
      id: "VAG-PETROL",
      makes: VAG,
      fuel: "petrol",
      from: 1999,
      to: 2009,
      specs: ["VW 502 00"],
      why: "Бензиновый VAG 1999–2009 — штатное требование 502 00 (полнозольное, HTHS ≥ 3.5)."
    },
    {
      id: "VAG-ANY",
      makes: VAG,
      from: 2007,
      specs: ["VW 504 00", "VW 507 00"],
      why: "VAG с 2007 года, топливо не указано. Берём пару 504 00 / 507 00 — масло этого класса подходит обоим типам моторов, включая дизель с сажевым фильтром."
    },
    // ── Porsche ──────────────────────────────────────────────────────────────
    {
      id: "PORSCHE-C30",
      makes: ["PORSCHE"],
      from: 2009,
      specs: ["Porsche C30"],
      why: "Porsche с 2009 года — допуск C30 (среднезольное, HTHS ≥ 3.5)."
    },
    {
      id: "PORSCHE-A40",
      makes: ["PORSCHE"],
      to: 2008,
      specs: ["Porsche A40"],
      why: "Porsche до 2009 года — допуск A40 (полнозольное, HTHS ≥ 3.5)."
    },
    // ── Renault / Dacia ──────────────────────────────────────────────────────
    {
      id: "RN-DIESEL-DPF",
      makes: RENO,
      fuel: "diesel",
      from: 2010,
      specs: ["RN 0720"],
      why: "Дизель dCi с 2010 года — сажевый фильтр, Renault требует RN 0720 (ACEA C4, зола ≤0.5%). Малозольных масел в наличии обычно нет, поэтому это не запрет, а приоритет: чем меньше золы, тем лучше."
    },
    {
      id: "RN-DIESEL",
      makes: RENO,
      fuel: "diesel",
      to: 2009,
      specs: ["RN 0710"],
      why: "Дизель Renault до 2010 года — фильтра нет, требование RN 0710 (полнозольное, HTHS ≥ 3.5)."
    },
    {
      id: "RN-PETROL",
      makes: RENO,
      fuel: "petrol",
      specs: ["RN 0700", "RN 0710"],
      why: "Бензиновый Renault — базовые допуски RN 0700/0710. Сам RN 0700 разрешает и A5/B5, и A3/B4; берём пару, потому что ошибка «залили гуще» стоит расхода топлива, а «залили жиже» — вкладышей."
    },
    // ── PSA / Stellantis ─────────────────────────────────────────────────────
    // У PSA сажевый фильтр (FAP) появился на дизелях HDi в 2000 году — на девять
    // лет раньше общеевропейского Euro 5, отсюда `filter: 'dpf'`.
    {
      id: "PSA-DIESEL-FAP",
      makes: PSA,
      fuel: "diesel",
      from: 2006,
      specs: ["PSA B71 2290", "PSA B71 2294"],
      filter: "dpf",
      why: "Дизель HDi с 2006 года — сажевый фильтр FAP, отсюда среднезольное. Точную ступень (C2 по 2290 или C3 по 2294) год не различает, поэтому берём пару: масла C2 в наличии почти нет, а «залил гуще» стоит расхода топлива, тогда как «залил жиже» — вкладышей."
    },
    {
      id: "PSA-DIESEL",
      makes: PSA,
      fuel: "diesel",
      to: 2005,
      specs: ["PSA B71 2294"],
      why: "Дизель PSA до 2006 года — требование B71 2294 (уровень C3)."
    },
    {
      id: "PSA-PETROL-EP6",
      makes: PSA,
      fuel: "petrol",
      from: 2006,
      specs: ["PSA B71 2290", "PSA B71 2297"],
      why: "Бензиновый PSA с 2006 года (семейство EP) — среднезольное масло (B71 2290 или 2297). Как и на дизеле, берём пару: между C2 и C3 год выпуска не различает, а густое масло — обратимая ошибка."
    },
    {
      id: "PSA-PETROL",
      makes: PSA,
      fuel: "petrol",
      to: 2005,
      specs: ["PSA B71 2296"],
      why: "Бензиновый PSA до 2006 года — требование B71 2296 (полнозольное A3/B4)."
    },
    // ── GM / Opel / Chevrolet ────────────────────────────────────────────────
    {
      id: "GM-DEXOS2",
      makes: GM,
      from: 2010,
      specs: ["GM dexos2"],
      why: "GM/Opel с 2010 года — универсальный допуск dexos2 (уровень C3): среднезольное при HTHS ≥ 3.5, подходит и бензину, и дизелю."
    },
    {
      id: "GM-LL-DIESEL",
      makes: GM,
      fuel: "diesel",
      from: 1998,
      to: 2009,
      specs: ["GM-LL-B-025"],
      why: "Дизель GM/Opel до 2010 года — допуск GM-LL-B-025 (полнозольное)."
    },
    {
      id: "GM-LL-PETROL",
      makes: GM,
      fuel: "petrol",
      from: 1998,
      to: 2009,
      specs: ["GM-LL-A-025"],
      why: "Бензиновый GM/Opel до 2010 года — допуск GM-LL-A-025 (полнозольное)."
    },
    // ── Ford (Европа) ────────────────────────────────────────────────────────
    {
      id: "FORD-DIESEL-DPF",
      makes: ["FORD"],
      fuel: "diesel",
      from: 2010,
      specs: ["Ford WSS-M2C934-B"],
      why: "Дизель TDCi с 2010 года — сажевый фильтр, спецификация 934-B (малозольное). Полнозольное масло фильтр забивает."
    },
    {
      id: "FORD-DIESEL",
      makes: ["FORD"],
      fuel: "diesel",
      from: 2e3,
      to: 2009,
      specs: ["Ford WSS-M2C913-D"],
      why: "Дизель TDCi до 2010 года — линейка 913 (ACEA A5/B5, HTHS 2.9–3.5). Исключение — 1.8 TDCi под 917-A: если в карточке этот мотор, проверь вручную."
    },
    {
      id: "FORD-PETROL",
      makes: ["FORD"],
      fuel: "petrol",
      from: 2e3,
      specs: ["Ford WSS-M2C913-D"],
      why: "Бензиновый Ford с 2000 года — спецификация 913-D: топливосберегающее масло A5/B5. Мотор рассчитан на низкий HTHS, густое A3/B4 Ford не одобряет."
    },
    // ── Volvo ────────────────────────────────────────────────────────────────
    {
      id: "VOLVO-DRIVE-E",
      makes: ["VOLVO"],
      from: 2014,
      specs: ["Volvo VCC 95200377"],
      why: "Volvo с 2014 года — моторы Drive-E, собственный допуск VCC 95200377 (среднезольное, HTHS 2.9–3.5)."
    },
    {
      id: "VOLVO-OLD",
      makes: ["VOLVO"],
      from: 2e3,
      to: 2013,
      specs: ["ACEA A5/B5"],
      why: "Volvo 2000–2013 — моторы разработки Ford, требование ACEA A5/B5."
    },
    // ── Hyundai / Kia ────────────────────────────────────────────────────────
    // Своих допусков у корейцев нет — завод пишет класс ACEA и уровень API.
    {
      id: "KOR-DIESEL-DPF",
      makes: KOREA,
      fuel: "diesel",
      from: 2011,
      specs: ["ACEA C3"],
      why: "Дизель CRDi с 2011 года (Euro 5) — сажевый фильтр. Завод требует ACEA C3: среднезольное при HTHS ≥ 3.5."
    },
    {
      id: "KOR-DIESEL",
      makes: KOREA,
      fuel: "diesel",
      from: 2e3,
      to: 2010,
      specs: ["ACEA A3/B4"],
      why: "Дизель CRDi до 2011 года — фильтра нет, класс ACEA B4."
    },
    {
      id: "KOR-PETROL",
      makes: KOREA,
      fuel: "petrol",
      from: 2e3,
      maxHpPerL: 105,
      specs: ["ACEA A5/B5"],
      why: "Бензиновый Hyundai/Kia — завод пишет API SM/SN + ILSAC, то есть мотор рассчитан на топливосберегающее масло (ACEA A5/B5, HTHS 2.9–3.5). Это ориентир по семейству моторов, а не допуск конкретной машины."
    },
    // ── Японские марки ───────────────────────────────────────────────────────
    {
      id: "JP-PETROL",
      makes: JAPAN,
      fuel: "petrol",
      from: 2e3,
      maxHpPerL: 105,
      specs: ["ACEA A5/B5", "ILSAC GF-6A"],
      why: "Японский бензиновый мотор — семейство ILSAC: рассчитан на топливосберегающее масло с HTHS 2.9–3.5. Густое A3/B4 здесь не нужно. Наддувные и спортивные версии (выше 105 л.с. с литра) под правило не подпадают — им нужно гуще."
    }
  ];
  function specificPower(ctx) {
    const bhp = Number(ctx.bhp);
    let vol = parseFloat(String(ctx.engineVolume == null ? "" : ctx.engineVolume).replace(",", "."));
    if (!Number.isFinite(bhp) || bhp <= 0 || !Number.isFinite(vol) || vol <= 0) return null;
    if (vol > 100) vol /= 1e3;
    return bhp / vol;
  }
  function oemRuleFor(ctx = {}) {
    const make = normMake(ctx.make || ctx.makeShort);
    if (!make) return null;
    const year = Number(ctx.yearFrom) || 0;
    const ft = ctx.fuelType;
    const fuel = isDieselFuel(ft) ? "diesel" : isPetrolFuel(ft) ? "petrol" : null;
    const hpPerL = specificPower(ctx);
    for (const r of RULES) {
      if (!r.makes.some((k) => make === k || make.startsWith(k))) continue;
      if (r.fuel && r.fuel !== fuel) continue;
      if ((r.from != null || r.to != null) && !year) continue;
      if (r.from != null && year < r.from) continue;
      if (r.to != null && year > r.to) continue;
      if (r.maxHpPerL != null && hpPerL != null && hpPerL > r.maxHpPerL) continue;
      return { id: r.id, specs: [...r.specs], filter: r.filter || null, why: r.why };
    }
    return null;
  }

  // shared/approvals.js
  var ASH_FULL = 1.5;
  var ASH_MID = 0.8;
  var ASH_LOW = 0.5;
  var HTHS_HIGH = [3.5, Infinity];
  var HTHS_MID = [2.9, 3.5];
  var HTHS_LOW = [2.6, 2.9];
  var FAMILY_MAKES = {
    MB: ["MERCEDES", "MERCEDESBENZ", "MB", "SMART", "MAYBACH"],
    VW: ["VW", "VOLKSWAGEN", "AUDI", "SKODA", "SEAT", "CUPRA", "PORSCHE"],
    BMW: ["BMW", "MINI", "ROLLSROYCE"],
    // Лада ставит допуска Renault на моторы H4M/HR16 и на 21179 — альянс общий
    RN: ["RENAULT", "DACIA", "NISSAN", "INFINITI", "LADA", "ВАЗ", "ЛАДА", "VAZ"],
    PSA: ["PEUGEOT", "CITROEN", "CITROËN", "DS", "OPEL", "VAUXHALL"],
    GM: ["OPEL", "VAUXHALL", "CHEVROLET", "CADILLAC", "BUICK", "GMC", "SAAB", "DAEWOO", "RAVON"],
    FORD: ["FORD"],
    JLR: ["JAGUAR", "LANDROVER", "LAND ROVER"],
    FIAT: ["FIAT", "ALFAROMEO", "ALFA", "LANCIA", "JEEP", "CHRYSLER", "DODGE", "RAM", "IVECO"],
    PORSCHE: ["PORSCHE"],
    VOLVO: ["VOLVO"],
    VAZ: ["LADA", "ВАЗ", "ЛАДА", "VAZ"]
  };
  var FAMILY_LABEL = {
    MB: "Mercedes-Benz",
    VW: "концерн VAG",
    BMW: "BMW",
    RN: "Renault-Nissan",
    PSA: "Stellantis (PSA)",
    GM: "GM/Opel",
    FORD: "Ford",
    JLR: "Jaguar Land Rover",
    FIAT: "Fiat/Stellantis",
    PORSCHE: "Porsche",
    VOLVO: "Volvo",
    VAZ: "АвтоВАЗ"
  };
  var CYR_LOOKALIKE = {
    А: "A",
    В: "B",
    Е: "E",
    К: "K",
    М: "M",
    Н: "H",
    О: "O",
    Р: "P",
    С: "C",
    Т: "T",
    У: "Y",
    Х: "X"
  };
  function normSpec(s) {
    return String(s || "").toUpperCase().replace(/АВТОВАЗ|ВАЗ/g, "VAZ").replace(/[АВЕКМНОРСТУХ]/g, (c) => CYR_LOOKALIKE[c]).replace(/MERCEDES[\s-]*BENZ|MERCEDES/g, "MB").replace(/VOLKSWAGEN/g, "VW").replace(/LONG\s*LIFE|LONGLIFE/g, "LL").replace(/RENAULT/g, "RN").replace(/JAGUAR\s*LAND\s*ROVER|LAND\s*ROVER|JAGUAR/g, "").replace(/APPROVAL|LICENSE.*$/g, "").replace(/[^A-Z0-9]/g, "").replace(/^(RN|MB|VW)\1/, "$1").replace(/^LL(?=\d)/, "BMWLL");
  }
  var SPEC_ALIASES = {
    VW508: "VW50800",
    VW509: "VW50900",
    VW506: "VW50600",
    VW507: "VW50700",
    VW504: "VW50400",
    VW502: "VW50200",
    VW505: "VW50500",
    DEXOS2: "GMDEXOS2",
    DEXOS1: "GMDEXOS1"
  };
  var ACEA_PAIR_RE = /^\s*(?:ACEA\s*)?[AB]\d\s*\/\s*[AB]\d\s*$/i;
  function splitCompound(raw) {
    const s = String(raw || "").trim();
    if (!s || !s.includes("/")) return s ? [s] : [];
    if (ACEA_PAIR_RE.test(s)) return [s];
    const parts = s.split("/").map((x) => x.trim()).filter(Boolean);
    if (parts.length < 2) return [s];
    const head = parts[0];
    const prefixes = [];
    const dash = head.lastIndexOf("-");
    if (dash > 0) prefixes.push(head.slice(0, dash + 1));
    const space = head.lastIndexOf(" ");
    if (space > 0) prefixes.push(head.slice(0, space + 1));
    const word = head.match(/^([A-Za-zА-Яа-я]+)\s+/);
    if (word) prefixes.push(word[1] + " ");
    const out = [head];
    for (const part of parts.slice(1)) {
      let picked = null;
      for (const p of prefixes) {
        const cand = p + part;
        if (findSpec(cand, true)) {
          picked = cand;
          break;
        }
      }
      out.push(picked || (prefixes[0] || "") + part);
    }
    if (!findSpec(out[0], true)) {
      const last = out[out.length - 1];
      for (let i = 1; i < last.length; i++) {
        const cand = head + last.slice(i);
        if (findSpec(cand, true)) {
          out[0] = cand;
          break;
        }
      }
    }
    return out;
  }
  var SPECS = [
    // ── ACEA: европейские классы. Задают физику напрямую, марка не важна ──
    {
      id: "ACEAA3B4",
      label: "ACEA A3/B4",
      role: "acea",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      what: "Полнозольное масло с HTHS ≥ 3.5. Полный пакет присадок, но зола забивает сажевый фильтр — только для моторов без DPF/GPF."
    },
    {
      id: "ACEAA3B3",
      label: "ACEA A3/B3",
      role: "acea",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      what: "Полнозольное с HTHS ≥ 3.5, предшественник A3/B4. Без сажевого фильтра."
    },
    {
      id: "ACEAA5B5",
      label: "ACEA A5/B5",
      role: "acea",
      ash: ASH_FULL,
      hths: HTHS_MID,
      what: "Топливосберегающее, HTHS 2.9–3.5. Лить только в мотор, спроектированный под низкий HTHS: Ford Duratec/TDCi, Renault, Jaguar. В мотор под A3/B4 — риск износа вкладышей."
    },
    {
      id: "ACEAA7B7",
      label: "ACEA A7/B7",
      role: "acea",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      what: "Развитие A3/B4 (2021): та же зольность и HTHS ≥ 3.5, плюс защита от LSPI и износа цепи."
    },
    {
      id: "ACEAC1",
      label: "ACEA C1",
      role: "acea",
      ash: ASH_LOW,
      hths: HTHS_MID,
      what: "Самый жёсткий по золе класс (≤0.5%) при HTHS 2.9–3.5. Ford/JLR под сажевый фильтр."
    },
    {
      id: "ACEAC2",
      label: "ACEA C2",
      role: "acea",
      ash: ASH_MID,
      hths: HTHS_MID,
      what: "Среднезольное (≤0.8%) и топливосберегающее, HTHS 2.9–3.5. Дизели PSA/Toyota с сажевым фильтром."
    },
    {
      id: "ACEAC3",
      label: "ACEA C3",
      role: "acea",
      ash: ASH_MID,
      hths: HTHS_HIGH,
      what: "Рабочая лошадка «под сажевый фильтр»: зола ≤0.8% при полноценном HTHS ≥ 3.5. Основа для MB 229.51, VW 504 00, LL-04, dexos2."
    },
    {
      id: "ACEAC4",
      label: "ACEA C4",
      role: "acea",
      ash: ASH_LOW,
      hths: HTHS_HIGH,
      what: "Малозольное (≤0.5%) при HTHS ≥ 3.5. Практически только Renault RN0720."
    },
    {
      id: "ACEAC5",
      label: "ACEA C5",
      role: "acea",
      ash: ASH_MID,
      hths: HTHS_LOW,
      what: "HTHS 2.6–2.9 — сверхтекучее, ради экономии топлива. Только для моторов, где завод его прямо требует."
    },
    {
      id: "ACEAC6",
      label: "ACEA C6",
      role: "acea",
      ash: ASH_MID,
      hths: HTHS_LOW,
      what: "HTHS 2.6–2.9 с защитой от LSPI (2021). Новые турбо-бензиновые с прямым впрыском."
    },
    {
      id: "ACEAA1B1",
      label: "ACEA A1/B1",
      role: "acea",
      ash: ASH_FULL,
      hths: HTHS_MID,
      what: "Устаревший топливосберегающий класс с HTHS 2.9–3.5. Отменён ACEA, встречается только в старых паспортах."
    },
    {
      id: "ACEAA2B2",
      label: "ACEA A2/B2",
      role: "acea",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      what: "Устаревший базовый класс, предшественник A3/B3."
    },
    // ── API / ILSAC: уровень качества, а не допуск ──
    {
      id: "APISP",
      label: "API SP",
      role: "api",
      ash: null,
      hths: null,
      what: "Уровень качества API для бензиновых (2020): защита от LSPI и износа цепи. Обратно совместим с SN/SM/SL."
    },
    {
      id: "APISNPLUS",
      label: "API SN Plus",
      role: "api",
      ash: null,
      hths: null,
      what: "API SN с добавленной защитой от LSPI. Промежуточная ступень между SN и SP."
    },
    {
      id: "APISN",
      label: "API SN",
      role: "api",
      ash: null,
      hths: null,
      what: "Уровень качества API для бензиновых (2010)."
    },
    { id: "APISM", label: "API SM", role: "api", ash: null, hths: null, what: "Уровень качества API (2004)." },
    { id: "APISL", label: "API SL", role: "api", ash: null, hths: null, what: "Уровень качества API (2001)." },
    { id: "APISJ", label: "API SJ", role: "api", ash: null, hths: null, what: "Уровень качества API (1996)." },
    { id: "APISQ", label: "API SQ", role: "api", ash: null, hths: null, what: "Новейший уровень качества API для бензиновых." },
    {
      id: "APICF",
      label: "API CF",
      role: "api",
      ash: null,
      hths: null,
      what: "Старый дизельный уровень качества API (1994). На современный подбор не влияет."
    },
    {
      id: "ILSACGF6A",
      label: "ILSAC GF-6A",
      role: "api",
      ash: null,
      hths: HTHS_MID,
      what: "API SP + топливная экономичность. Японские и американские моторы под 0W-20/5W-30."
    },
    {
      id: "ILSACGF5",
      label: "ILSAC GF-5",
      role: "api",
      ash: null,
      hths: HTHS_MID,
      what: "API SN + топливная экономичность (2010)."
    },
    { id: "ILSACGF4", label: "ILSAC GF-4", role: "api", ash: null, hths: HTHS_MID, what: "Предшественник GF-5." },
    {
      id: "ILSACGF7A",
      label: "ILSAC GF-7A",
      role: "api",
      ash: null,
      hths: HTHS_MID,
      what: "Новейший уровень ILSAC (2025) поверх API SQ. Обратно совместим с GF-6A."
    },
    {
      id: "ILSACGF6B",
      label: "ILSAC GF-6B",
      role: "api",
      ash: null,
      hths: HTHS_LOW,
      visc: ["0W-16"],
      what: "Ветка ILSAC для сверхтекучих 0W-16. С GF-6A не взаимозаменяем."
    },
    // ── Mercedes-Benz ──
    {
      id: "MB2291",
      label: "MB 229.1",
      role: "oem",
      family: "MB",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      what: "Базовый допуск MB 1990-х. Полнозольное, HTHS ≥ 3.5, обычный интервал."
    },
    {
      id: "MB2293",
      label: "MB 229.3",
      role: "oem",
      family: "MB",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      drain: "long",
      what: "Полнозольное с увеличенным интервалом. Для моторов БЕЗ сажевого фильтра."
    },
    {
      id: "MB2295",
      label: "MB 229.5",
      role: "oem",
      family: "MB",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      drain: "long",
      what: "Полнозольное, выше требования к экономии и интервалу, чем 229.3. Тоже без сажевого фильтра."
    },
    {
      id: "MB22931",
      label: "MB 229.31",
      role: "oem",
      family: "MB",
      ash: ASH_MID,
      hths: HTHS_HIGH,
      what: "Среднезольное (≤0.8%) при HTHS ≥ 3.5 — версия 229.3 для моторов с сажевым фильтром."
    },
    {
      id: "MB22951",
      label: "MB 229.51",
      role: "oem",
      family: "MB",
      ash: ASH_MID,
      hths: HTHS_HIGH,
      drain: "long",
      what: "Основной современный допуск MB: среднезольное, HTHS ≥ 3.5, сажевый фильтр + увеличенный интервал."
    },
    {
      id: "MB22952",
      label: "MB 229.52",
      role: "oem",
      family: "MB",
      ash: ASH_MID,
      hths: HTHS_HIGH,
      drain: "long",
      what: "Ужесточённый 229.51: выше топливная экономичность и стойкость к окислению."
    },
    {
      id: "MB2296",
      label: "MB 229.6",
      role: "oem",
      family: "MB",
      ash: ASH_FULL,
      hths: HTHS_MID,
      drain: "long",
      what: "Новое поколение MB (2019+), пониженный HTHS ради экономии топлива."
    },
    {
      id: "MB22961",
      label: "MB 229.61",
      role: "oem",
      family: "MB",
      ash: ASH_MID,
      hths: HTHS_MID,
      drain: "long",
      what: "Новое поколение MB для дизелей с сажевым фильтром: среднезольное с пониженным HTHS."
    },
    {
      id: "MB2265",
      label: "MB 226.5",
      role: "oem",
      family: "MB",
      ash: ASH_FULL,
      hths: HTHS_MID,
      what: "Для моторов MB на базе Renault (A/B-класс, Citan). Полнозольное, HTHS 2.9–3.5."
    },
    {
      id: "MB2266",
      label: "MB 226.6",
      role: "oem",
      family: "MB",
      ash: ASH_MID,
      hths: HTHS_MID,
      what: "Версия 226.5 для моторов с сажевым фильтром."
    },
    // ── VAG ──
    {
      id: "VW50000",
      label: "VW 500 00",
      role: "oem",
      family: "VW",
      ash: ASH_FULL,
      hths: HTHS_MID,
      what: "Старый энергосберегающий допуск VAG (до 1999)."
    },
    {
      id: "VW50101",
      label: "VW 501 01",
      role: "oem",
      family: "VW",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      what: "Базовый допуск VAG для атмосферных моторов (до 2000)."
    },
    {
      id: "VW50200",
      label: "VW 502 00",
      role: "oem",
      family: "VW",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      what: "Полнозольное для бензиновых VAG, фиксированный интервал. Мотор БЕЗ сажевого фильтра."
    },
    {
      id: "VW50300",
      label: "VW 503 00",
      role: "oem",
      family: "VW",
      ash: ASH_FULL,
      hths: HTHS_MID,
      drain: "long",
      what: "LongLife II для бензиновых: пониженный HTHS, интервал до 30 тыс. км."
    },
    {
      id: "VW50301",
      label: "VW 503 01",
      role: "oem",
      family: "VW",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      what: "LongLife для нагруженных бензиновых (Audi S/RS-серии)."
    },
    {
      id: "VW50400",
      label: "VW 504 00",
      role: "oem",
      family: "VW",
      ash: ASH_MID,
      hths: HTHS_HIGH,
      drain: "long",
      what: "LongLife III для бензиновых: среднезольное (≤0.8%) при HTHS ≥ 3.5, интервал до 30 тыс. км, совместимо с сажевым фильтром."
    },
    {
      id: "VW50500",
      label: "VW 505 00",
      role: "oem",
      family: "VW",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      what: "Полнозольное для дизелей VAG, фиксированный интервал. Без сажевого фильтра."
    },
    {
      id: "VW50501",
      label: "VW 505 01",
      role: "oem",
      family: "VW",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      what: "Для дизелей с насос-форсунками (PD-TDI): усиленная противозадирная защита кулачков."
    },
    {
      id: "VW50600",
      label: "VW 506 00",
      role: "oem",
      family: "VW",
      ash: ASH_FULL,
      hths: HTHS_MID,
      drain: "long",
      what: "LongLife II для дизелей: пониженный HTHS, увеличенный интервал."
    },
    {
      id: "VW50601",
      label: "VW 506 01",
      role: "oem",
      family: "VW",
      ash: ASH_FULL,
      hths: HTHS_MID,
      drain: "long",
      what: "LongLife II для дизелей с насос-форсунками."
    },
    {
      id: "VW50700",
      label: "VW 507 00",
      role: "oem",
      family: "VW",
      ash: ASH_MID,
      hths: HTHS_HIGH,
      drain: "long",
      what: "LongLife III для дизелей: среднезольное при HTHS ≥ 3.5. Обязательно при сажевом фильтре — полнозольное его убивает."
    },
    {
      id: "VW50800",
      label: "VW 508 00",
      role: "oem",
      family: "VW",
      ash: ASH_MID,
      hths: HTHS_LOW,
      visc: ["0W-20"],
      drain: "long",
      what: "HTHS 2.6–2.9, только 0W-20. Совершенно не взаимозаменяем с 504 00: другая вязкость и другой класс."
    },
    {
      id: "VW50900",
      label: "VW 509 00",
      role: "oem",
      family: "VW",
      ash: ASH_MID,
      hths: HTHS_LOW,
      visc: ["0W-20"],
      drain: "long",
      what: "Дизельный аналог 508 00: HTHS 2.6–2.9, только 0W-20."
    },
    {
      id: "VW51100",
      label: "VW 511 00",
      role: "oem",
      family: "VW",
      ash: ASH_MID,
      hths: HTHS_MID,
      drain: "long",
      what: "Новый LongLife VAG с пониженным HTHS для моторов последних поколений."
    },
    // ── BMW ──
    {
      id: "BMWLL98",
      label: "BMW LL-98",
      role: "oem",
      family: "BMW",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      what: "Longlife-98: полнозольное, HTHS ≥ 3.5, моторы после 1998."
    },
    {
      id: "BMWLL01",
      label: "BMW LL-01",
      role: "oem",
      family: "BMW",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      drain: "long",
      what: "Longlife-01: полнозольное с увеличенным интервалом. Моторы БЕЗ сажевого фильтра."
    },
    {
      id: "BMWLL01FE",
      label: "BMW LL-01 FE",
      role: "oem",
      family: "BMW",
      ash: ASH_FULL,
      hths: HTHS_MID,
      drain: "long",
      what: "Longlife-01 FE: пониженный HTHS 2.9–3.5. НЕ заменяет LL-01 — подходит не всем моторам, только тем, где завод его указал."
    },
    {
      id: "BMWLL04",
      label: "BMW LL-04",
      role: "oem",
      family: "BMW",
      ash: ASH_MID,
      hths: HTHS_HIGH,
      drain: "long",
      what: "Longlife-04: среднезольное при HTHS ≥ 3.5. Обязательно для моторов с сажевым фильтром."
    },
    {
      id: "BMWLL12FE",
      label: "BMW LL-12 FE",
      role: "oem",
      family: "BMW",
      ash: ASH_LOW,
      hths: HTHS_MID,
      drain: "long",
      what: "Longlife-12 FE: малозольное 0W-30 с пониженным HTHS для дизелей BMW."
    },
    {
      id: "BMWLL14FE",
      label: "BMW LL-14 FE+",
      role: "oem",
      family: "BMW",
      ash: ASH_MID,
      hths: HTHS_LOW,
      visc: ["0W-20"],
      drain: "long",
      what: "HTHS 2.6–2.9, 0W-20. Только для моторов, где BMW его прямо требует."
    },
    {
      id: "BMWLL17FE",
      label: "BMW LL-17 FE+",
      role: "oem",
      family: "BMW",
      ash: ASH_MID,
      hths: HTHS_LOW,
      visc: ["0W-20"],
      drain: "long",
      what: "Развитие LL-14 FE+: HTHS 2.6–2.9, 0W-20."
    },
    // ── Renault-Nissan ──
    {
      id: "RN0700",
      label: "RN 0700",
      role: "oem",
      family: "RN",
      ash: ASH_FULL,
      hths: HTHS_MID,
      what: "Базовый допуск Renault: бензин и атмосферный дизель, полнозольное. Допускает и A3/B4, и A5/B5 — сам по себе вязкость не определяет."
    },
    {
      id: "RN0710",
      label: "RN 0710",
      role: "oem",
      family: "RN",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      what: "Усиленный RN0700 для турбодизелей без сажевого фильтра: полнозольное, HTHS ≥ 3.5."
    },
    {
      id: "RN0720",
      label: "RN 0720",
      role: "oem",
      family: "RN",
      ash: ASH_LOW,
      hths: HTHS_HIGH,
      what: "ACEA C4: малозольное (≤0.5%) для дизелей dCi с сажевым фильтром. Полнозольные RN0700/0710 сюда лить нельзя."
    },
    {
      id: "RN17",
      label: "RN 17",
      role: "oem",
      family: "RN",
      ash: ASH_MID,
      hths: HTHS_MID,
      what: "Новое поколение допусков Renault для моторов Euro 6."
    },
    {
      id: "VAZ",
      label: "АвтоВАЗ",
      role: "oem",
      family: "VAZ",
      ash: null,
      hths: null,
      what: "Одобрение АвтоВАЗа. Подтверждает пригодность для моторов Лады, физику масла не задаёт."
    },
    // ── PSA / Stellantis ──
    {
      id: "PSAB712290",
      label: "PSA B71 2290",
      role: "oem",
      family: "PSA",
      ash: ASH_MID,
      hths: HTHS_MID,
      what: "ACEA C2: среднезольное с пониженным HTHS для дизелей PSA с сажевым фильтром (FAP)."
    },
    {
      id: "PSAB712294",
      label: "PSA B71 2294",
      role: "oem",
      family: "PSA",
      ash: ASH_MID,
      hths: HTHS_HIGH,
      what: "Среднезольное с HTHS ≥ 3.5 (уровень C3) для моторов PSA."
    },
    {
      id: "PSAB712295",
      label: "PSA B71 2295",
      role: "oem",
      family: "PSA",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      what: "Старый полнозольный допуск PSA для моторов до 1998."
    },
    {
      id: "PSAB712296",
      label: "PSA B71 2296",
      role: "oem",
      family: "PSA",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      what: "Полнозольное A3/B4 для бензиновых PSA без сажевого фильтра."
    },
    {
      id: "PSAB712297",
      label: "PSA B71 2297",
      role: "oem",
      family: "PSA",
      ash: ASH_MID,
      hths: HTHS_HIGH,
      what: "Среднезольное (уровень C3) для бензиновых PSA Euro 5+."
    },
    {
      id: "PSAB712293",
      label: "PSA B71 2293",
      role: "oem",
      family: "PSA",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      what: "Полнозольное для моторов PSA среднего возраста."
    },
    {
      id: "PSAB712312",
      label: "PSA B71 2312",
      role: "oem",
      family: "PSA",
      ash: ASH_MID,
      hths: HTHS_MID,
      what: "Современный допуск Stellantis уровня C2 для моторов с сажевым фильтром."
    },
    // ── GM / Opel ──
    {
      id: "GMLLA025",
      label: "GM-LL-A-025",
      role: "oem",
      family: "GM",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      drain: "long",
      what: "Полнозольное (A3) для бензиновых GM/Opel с увеличенным интервалом."
    },
    {
      id: "GMLLB025",
      label: "GM-LL-B-025",
      role: "oem",
      family: "GM",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      drain: "long",
      what: "Полнозольное (B3/B4) для дизелей GM/Opel без сажевого фильтра."
    },
    {
      id: "GMDEXOS2",
      label: "GM dexos2",
      role: "oem",
      family: "GM",
      ash: ASH_MID,
      hths: HTHS_HIGH,
      drain: "long",
      what: "Универсальный европейский допуск GM уровня C3: среднезольное при HTHS ≥ 3.5, совместимо с сажевым фильтром."
    },
    {
      id: "GMDEXOS1",
      label: "GM dexos1",
      role: "oem",
      family: "GM",
      ash: null,
      hths: HTHS_MID,
      visc: ["0W-20", "5W-30"],
      what: "Американский допуск GM на базе ILSAC: только маловязкие бензиновые масла. С dexos2 не взаимозаменяем."
    },
    {
      id: "GMDEXOS1GEN3",
      label: "GM dexos1 Gen 3",
      role: "oem",
      family: "GM",
      ash: null,
      hths: HTHS_MID,
      visc: ["0W-20", "5W-30"],
      what: "Актуальная версия dexos1 с защитой от LSPI."
    },
    {
      id: "GMDEXOS1GEN2",
      label: "GM dexos1 Gen 2",
      role: "oem",
      family: "GM",
      ash: null,
      hths: HTHS_MID,
      visc: ["0W-20", "5W-30"],
      what: "Предыдущая версия dexos1. С dexos2 не взаимозаменяема."
    },
    {
      id: "GMDEXOSD",
      label: "GM dexosD",
      role: "oem",
      family: "GM",
      ash: ASH_MID,
      hths: HTHS_MID,
      what: "Дизельный допуск GM уровня C2/C3 для моторов с сажевым фильтром."
    },
    {
      id: "OPELOV0401547",
      label: "OPEL OV0401547",
      role: "oem",
      family: "GM",
      ash: ASH_MID,
      hths: HTHS_HIGH,
      what: "Допуск Opel после перехода к Stellantis, преемник dexos2 (уровень C3)."
    },
    // ── Ford ──
    {
      id: "FORDWSSM2C913A",
      label: "Ford WSS-M2C913-A",
      role: "oem",
      family: "FORD",
      ash: ASH_FULL,
      hths: HTHS_MID,
      what: "Ford на базе ACEA A1/B1: пониженный HTHS. Ранняя ступень серии 913."
    },
    {
      id: "FORDWSSM2C913B",
      label: "Ford WSS-M2C913-B",
      role: "oem",
      family: "FORD",
      ash: ASH_FULL,
      hths: HTHS_MID,
      what: "Ford на базе ACEA A5/B5, HTHS 2.9–3.5. Заменяет 913-A."
    },
    {
      id: "FORDWSSM2C913C",
      label: "Ford WSS-M2C913-C",
      role: "oem",
      family: "FORD",
      ash: ASH_FULL,
      hths: HTHS_MID,
      what: "Ford A5/B5 с повышенной стойкостью к окислению. Заменяет 913-B."
    },
    {
      id: "FORDWSSM2C913D",
      label: "Ford WSS-M2C913-D",
      role: "oem",
      family: "FORD",
      ash: ASH_FULL,
      hths: HTHS_MID,
      what: "Актуальная ступень серии 913: A5/B5, HTHS 2.9–3.5, совместимо с биодизелем. Полнозольное A3/B4 сюда лить нельзя — мотор рассчитан на низкий HTHS."
    },
    {
      id: "FORDWSSM2C917A",
      label: "Ford WSS-M2C917-A",
      role: "oem",
      family: "FORD",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      what: "Полнозольное A3/B4 для дизелей 1.8 TDCi. Единственная «густая» спецификация в линейке Ford."
    },
    {
      id: "FORDWSSM2C934B",
      label: "Ford WSS-M2C934-B",
      role: "oem",
      family: "FORD",
      ash: ASH_LOW,
      hths: HTHS_HIGH,
      what: "Малозольное (уровень C1) для дизелей Ford с сажевым фильтром."
    },
    {
      id: "FORDWSSM2C948B",
      label: "Ford WSS-M2C948-B",
      role: "oem",
      family: "FORD",
      ash: ASH_MID,
      hths: HTHS_LOW,
      visc: ["0W-20"],
      what: "HTHS 2.6–2.9, 0W-20 для моторов EcoBoost."
    },
    {
      id: "FORDWSSM2C950A",
      label: "Ford WSS-M2C950-A",
      role: "oem",
      family: "FORD",
      ash: ASH_MID,
      hths: HTHS_MID,
      what: "Среднезольное уровня C2 для моторов Ford с сажевым фильтром."
    },
    // ── Jaguar Land Rover / Volvo / Porsche ──
    {
      id: "STJLR035003",
      label: "JLR STJLR.03.5003",
      role: "oem",
      family: "JLR",
      ash: ASH_FULL,
      hths: HTHS_MID,
      what: "Jaguar Land Rover на базе ACEA A5/B5: HTHS 2.9–3.5."
    },
    {
      id: "STJLR035004",
      label: "JLR STJLR.03.5004",
      role: "oem",
      family: "JLR",
      ash: ASH_LOW,
      hths: HTHS_MID,
      what: "JLR уровня C1: малозольное для дизелей с сажевым фильтром."
    },
    {
      id: "STJLR035005",
      label: "JLR STJLR.03.5005",
      role: "oem",
      family: "JLR",
      ash: ASH_MID,
      hths: HTHS_HIGH,
      what: "JLR уровня C3: среднезольное при HTHS ≥ 3.5."
    },
    {
      id: "STJLR035006",
      label: "JLR STJLR.03.5006",
      role: "oem",
      family: "JLR",
      ash: ASH_MID,
      hths: HTHS_LOW,
      visc: ["0W-20"],
      what: "JLR 0W-20 с HTHS 2.6–2.9 для моторов Ingenium."
    },
    {
      id: "STJLR035007",
      label: "JLR STJLR.03.5007",
      role: "oem",
      family: "JLR",
      ash: ASH_MID,
      hths: HTHS_MID,
      what: "Актуальный допуск JLR для моторов Ingenium."
    },
    {
      id: "STJLR",
      label: "Jaguar STJLR",
      role: "oem",
      family: "JLR",
      ash: null,
      hths: null,
      what: "Допуск Jaguar Land Rover без указания ступени — читается только как «производитель одобрил»."
    },
    {
      id: "PORSCHEA40",
      label: "Porsche A40",
      role: "oem",
      family: "PORSCHE",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      what: "Полнозольное с HTHS ≥ 3.5 для атмосферных и турбо Porsche без сажевого фильтра."
    },
    {
      id: "PORSCHEC30",
      label: "Porsche C30",
      role: "oem",
      family: "PORSCHE",
      ash: ASH_MID,
      hths: HTHS_HIGH,
      what: "Среднезольное (уровень C3) для Porsche с сажевым фильтром."
    },
    {
      id: "PORSCHEC20",
      label: "Porsche C20",
      role: "oem",
      family: "PORSCHE",
      ash: ASH_MID,
      hths: HTHS_LOW,
      visc: ["0W-20"],
      what: "Porsche 0W-20 с HTHS 2.6–2.9."
    },
    {
      id: "PORSCHEC40",
      label: "Porsche C40",
      role: "oem",
      family: "PORSCHE",
      ash: ASH_MID,
      hths: HTHS_HIGH,
      what: "Современный среднезольный допуск Porsche."
    },
    {
      id: "VCC95200377",
      label: "Volvo VCC 95200377",
      role: "oem",
      family: "VOLVO",
      ash: ASH_MID,
      hths: HTHS_MID,
      what: "Собственный допуск Volvo для моторов Drive-E."
    },
    {
      id: "VCCRBS02AE",
      label: "Volvo VCC RBS0-2AE",
      role: "oem",
      family: "VOLVO",
      ash: ASH_MID,
      hths: HTHS_LOW,
      visc: ["0W-20"],
      what: "Volvo 0W-20 с HTHS 2.6–2.9 для моторов Drive-E последних поколений."
    },
    {
      id: "MS6395",
      label: "Chrysler MS-6395",
      role: "oem",
      family: "FIAT",
      ash: null,
      hths: HTHS_MID,
      what: "Заводская спецификация Chrysler/Dodge/Jeep на базе API SN/ILSAC."
    },
    // ── Fiat / Stellantis ──
    {
      id: "FIAT955535H2",
      label: "FIAT 9.55535-H2",
      role: "oem",
      family: "FIAT",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      what: "Полнозольное A3/B4 для бензиновых Fiat."
    },
    {
      id: "FIAT955535M2",
      label: "FIAT 9.55535-M2",
      role: "oem",
      family: "FIAT",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      what: "Полнозольное A3/B4 для нагруженных бензиновых Fiat."
    },
    {
      id: "FIAT955535N2",
      label: "FIAT 9.55535-N2",
      role: "oem",
      family: "FIAT",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      what: "Полнозольное A3/B4 для дизелей Fiat без сажевого фильтра."
    },
    {
      id: "FIAT955535Z2",
      label: "FIAT 9.55535-Z2",
      role: "oem",
      family: "FIAT",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      what: "Полнозольное A3/B4 общего назначения для Fiat."
    },
    {
      id: "FIAT955535S1",
      label: "FIAT 9.55535-S1",
      role: "oem",
      family: "FIAT",
      ash: ASH_MID,
      hths: HTHS_MID,
      what: "Среднезольное уровня C2 для дизелей Fiat с сажевым фильтром."
    },
    {
      id: "FIAT955535S2",
      label: "FIAT 9.55535-S2",
      role: "oem",
      family: "FIAT",
      ash: ASH_MID,
      hths: HTHS_HIGH,
      what: "Среднезольное уровня C3 для моторов Fiat с сажевым фильтром."
    },
    {
      id: "FIAT955535S3",
      label: "FIAT 9.55535-S3",
      role: "oem",
      family: "FIAT",
      ash: ASH_MID,
      hths: HTHS_HIGH,
      what: "Среднезольное уровня C3, современная ступень Fiat."
    },
    {
      id: "FIAT955535G1",
      label: "FIAT 9.55535-G1",
      role: "oem",
      family: "FIAT",
      ash: ASH_FULL,
      hths: HTHS_MID,
      what: "Топливосберегающее A5/B5 для бензиновых Fiat."
    },
    {
      id: "FIAT955535GH2",
      label: "FIAT 9.55535-GH2",
      role: "oem",
      family: "FIAT",
      ash: ASH_FULL,
      hths: HTHS_HIGH,
      what: "Полнозольное A3/B4 нового поколения Fiat."
    },
    {
      id: "FIAT955535CR1",
      label: "FIAT 9.55535-CR1",
      role: "oem",
      family: "FIAT",
      ash: ASH_MID,
      hths: HTHS_MID,
      what: "Современное среднезольное масло Fiat пониженной вязкости."
    }
  ];
  var SPEC_INDEX = (() => {
    const m = /* @__PURE__ */ new Map();
    for (const s of SPECS) {
      m.set(s.id, s);
      const byLabel = normSpec(s.label);
      if (!m.has(byLabel)) m.set(byLabel, s);
    }
    return m;
  })();
  var FALLBACK_RULES = [
    {
      re: /^FORDWSSM2C\d/,
      family: "FORD",
      label: "Ford WSS-M2C…",
      what: "Заводская спецификация Ford. Точная ступень неизвестна — учитываем как одобрение марки."
    },
    {
      re: /^FIAT9\d/,
      family: "FIAT",
      label: "FIAT 9.55535-…",
      what: "Заводская спецификация Fiat. Точная ступень неизвестна — учитываем как одобрение марки."
    },
    {
      re: /^STJLR/,
      family: "JLR",
      label: "JLR STJLR…",
      what: "Заводская спецификация Jaguar Land Rover. Точная ступень неизвестна."
    },
    {
      re: /^MB\d/,
      family: "MB",
      label: "MB …",
      what: "Заводской допуск Mercedes-Benz, ступень вне справочника."
    },
    {
      re: /^VW\d/,
      family: "VW",
      label: "VW …",
      what: "Заводской допуск VAG, ступень вне справочника."
    },
    {
      re: /^BMWLL/,
      family: "BMW",
      label: "BMW Longlife…",
      what: "Заводской допуск BMW, ступень вне справочника."
    },
    {
      re: /^PSAB\d/,
      family: "PSA",
      label: "PSA B71…",
      what: "Заводской допуск PSA/Stellantis, ступень вне справочника."
    },
    {
      re: /^RN\d/,
      family: "RN",
      label: "Renault RN…",
      what: "Заводской допуск Renault, ступень вне справочника."
    }
  ];
  function findSpec(raw, exactOnly = false) {
    const key0 = normSpec(raw);
    if (!key0) return null;
    const key = SPEC_ALIASES[key0] || key0;
    const hit = SPEC_INDEX.get(key);
    if (hit) return hit;
    if (exactOnly) return null;
    for (const rule of FALLBACK_RULES) {
      if (rule.re.test(key)) {
        return {
          id: key,
          label: String(raw).trim(),
          role: "oem",
          family: rule.family,
          ash: null,
          hths: null,
          what: rule.what,
          approximate: true
        };
      }
    }
    return null;
  }
  var NON_OIL_RE = new RegExp([
    "\\bG\\s*1[123]\\b",
    "TL\\s*774",
    "ASTM\\s*D\\s*(3306|4985)",
    "\\bD\\s*4985\\b",
    "SAE\\s*J10[0-9]{2}",
    "NATO\\s*S\\s*759",
    "BS\\s*6580",
    "AFNOR",
    "JIS\\s*K\\s*2234",
    "UNE\\s*263",
    "\\bHEFT\\b",
    "QL\\s*1301",
    "\\bESE\\b",
    "M97B",
    "\\bMACK\\b",
    "CUMMINS",
    "JOHN\\s*DEERE",
    "LEYLAND",
    "\\bMAN\\s*324\\b",
    "\\bMB\\s*32[56]\\b",
    "антифриз",
    "coolant",
    "GM\\s*1899",
    "AS\\s*2108",
    "GB\\s*297\\d\\d",
    "CUNA\\s*NC",
    "PN-C\\s*40007",
    "[ÖO]NORM",
    "\\bLC-\\d\\d\\b",
    "GS\\s*94000",
    "SANS\\s*1251",
    "DFS\\s*93K",
    "\\bTESLA\\b",
    "MWM",
    // тормозная жидкость
    "FMVSS\\s*116",
    "ISO\\s*4925",
    "SAE\\s*J170\\d",
    "\\bDOT\\s*[345]\\b"
  ].join("|"), "i");
  var GEAR_RE = new RegExp([
    "\\bAPI\\s*GL\\s*-?\\s*[45]\\b",
    "\\bMT-1\\b",
    "\\bMAN\\s*342\\b",
    "DEXRON",
    "MERCON",
    "MATIC",
    "\\bATF\\b",
    "\\bDCTF?\\b",
    "JWS\\s*33",
    "DSIH",
    "LT\\s*71141",
    "TYK5",
    "WSS-M2C922"
  ].join("|"), "i");
  var HEAVY_DUTY_RE = new RegExp([
    "\\bACEA\\s*E\\d",
    "\\bAPI\\s*C[HIJK]\\s*-\\s*4\\b",
    "\\bMAN\\s*M?\\s*3[2-9]\\d{2}",
    "VOLVO\\s*VDS",
    "\\bRLD\\s*-?\\s*\\d",
    "\\bMTU\\b",
    "\\bDEUTZ\\b",
    "CAT\\s*ECF",
    "\\bMB\\s*228\\.",
    "CUMMINS\\s*CES",
    "JASO\\s*DH",
    "\\bSCANIA\\b",
    "ZF\\s*TE-ML",
    "\\bALLISON\\b",
    "MACK\\s*EO",
    "КАМАЗ",
    "ЛИАЗ",
    "АВТОДИЗЕЛЬ",
    "ЯМЗ",
    "\\bМАЗ\\b"
  ].join("|"), "i");
  function nonEngineKind(raw) {
    const text = String(raw || "");
    const latin = text.replace(
      /[АВЕКМНОРСТУХ]/gi,
      (c) => CYR_LOOKALIKE[c.toUpperCase()] || c
    );
    const hit = (re) => re.test(text) || re.test(latin);
    if (hit(NON_OIL_RE)) return "coolant";
    if (hit(GEAR_RE)) return "gear";
    if (hit(HEAVY_DUTY_RE)) return "heavy";
    return null;
  }
  function parseApprovals(list) {
    const out = [];
    for (const raw of list || []) {
      const text = String(raw || "").trim();
      if (!text) continue;
      const kind = nonEngineKind(text);
      if (kind) {
        out.push({ raw: text, parts: [text], specs: [], nonOil: true, kind });
        continue;
      }
      const parts = splitCompound(text);
      const specs = parts.map((p) => findSpec(p)).filter(Boolean);
      out.push({ raw: text, parts, specs, nonOil: false, kind: null });
    }
    return out;
  }
  var PRODUCT_SPEC_PATTERNS = [
    [/LL[\s-]*01\s*FE/i, "BMW LL-01 FE"],
    [/LL[\s-]*12\s*FE/i, "BMW LL-12 FE"],
    [/LL[\s-]*14\s*FE/i, "BMW LL-14 FE+"],
    [/LL[\s-]*17\s*FE/i, "BMW LL-17 FE+"],
    [/LL[\s-]*04/i, "BMW LL-04"],
    [/LL[\s-]*01/i, "BMW LL-01"],
    [/\bdexos\s*1\s*GEN\s*3/i, "GM dexos1 Gen 3"],
    [/\bdexos\s*2\b/i, "GM dexos2"],
    [/\bdexos\s*1\b/i, "GM dexos1"],
    [/\b229[\s.]*52\b/, "MB 229.52"],
    [/\b229[\s.]*51\b/, "MB 229.51"],
    [/\b229[\s.]*31\b/, "MB 229.31"],
    [/\b229[\s.]*61\b/, "MB 229.61"],
    [/\b229[\s.]*6\b/, "MB 229.6"],
    [/\b229[\s.]*5\b/, "MB 229.5"],
    [/\b229[\s.]*3\b/, "MB 229.3"],
    [/\b226[\s.]*5\b/, "MB 226.5"],
    [/\b0720\b/, "RN 0720"],
    [/\b0710\b/, "RN 0710"],
    [/\b0700\b/, "RN 0700"],
    [/\bSPECIFIC\s+17\b/i, "RN 17"],
    [/\b913\s*[A-D]\b/i, "Ford WSS-M2C913-D"],
    [/\b948\s*B\b/i, "Ford WSS-M2C948-B"],
    [/\b934\s*B\b/i, "Ford WSS-M2C934-B"],
    [/\b950\s*A\b/i, "Ford WSS-M2C950-A"],
    [/\bA40\b/, "Porsche A40"],
    [/\bC30\b/, "Porsche C30"],
    [/\b2290\b/, "PSA B71 2290"],
    [/\b2293\b/, "PSA B71 2293"],
    [/\b2296\b/, "PSA B71 2296"],
    [/\b2297\b/, "PSA B71 2297"],
    [/\b2312\b/, "PSA B71 2312"],
    [/\bRBS0[\s-]*2AE\b/i, "Volvo VCC RBS0-2AE"]
  ];
  var VAG_CODE_RE = /\b(5\d\d)[\s.]+(0\d)\b/g;
  function specsFromProductNames(names) {
    const out = /* @__PURE__ */ new Set();
    for (const name of names || []) {
      const text = String(name || "");
      if (!text) continue;
      for (const [re, label] of PRODUCT_SPEC_PATTERNS) if (re.test(text)) out.add(label);
      VAG_CODE_RE.lastIndex = 0;
      let m;
      while (m = VAG_CODE_RE.exec(text)) {
        const label = `VW ${m[1]} ${m[2]}`;
        if (findSpec(label, true)) out.add(label);
      }
    }
    return [...out];
  }
  function makeFamilies(make) {
    const m = String(make || "").toUpperCase().replace(/[\s\-_.]/g, "");
    if (!m) return [];
    const out = [];
    for (const [family, makes] of Object.entries(FAMILY_MAKES)) {
      if (makes.some((x) => {
        const k = x.replace(/[\s\-_.]/g, "");
        return m === k || m.startsWith(k) || k.startsWith(m);
      })) out.push(family);
    }
    return out;
  }
  function profileOfSpecs(specs) {
    let ash = null, ashAllowed = null, hthsMin = null, hthsMax = null, visc = null;
    for (const s of specs) {
      if (s.ash != null) {
        ash = ash == null ? s.ash : Math.min(ash, s.ash);
        ashAllowed = ashAllowed == null ? s.ash : Math.max(ashAllowed, s.ash);
      }
      if (s.hths) {
        hthsMin = hthsMin == null ? s.hths[0] : Math.max(hthsMin, s.hths[0]);
        hthsMax = hthsMax == null ? s.hths[1] : Math.max(hthsMax, s.hths[1]);
      }
      if (s.visc) visc = visc ? [.../* @__PURE__ */ new Set([...visc, ...s.visc])] : [...s.visc];
    }
    return { ash, ashAllowed, hthsMin, hthsMax, visc };
  }
  function hthsGateFor(nativeSpecs) {
    let lo = null;
    for (const s of nativeSpecs) {
      if (!s.hths) continue;
      lo = lo == null ? s.hths[0] : Math.min(lo, s.hths[0]);
    }
    return lo;
  }
  function ashGateFor(nativeSpecs, ctx, rule) {
    if (rule && rule.filter === "none") return null;
    if (rule && (rule.filter === "dpf" || rule.filter === "gpf")) return ASH_MID;
    const year = Number(ctx.yearFrom) || 0;
    const diesel = isDieselLike(ctx.fuelType);
    if (diesel && year >= 2009) return ASH_MID;
    if (!diesel && year >= 2018) return ASH_MID;
    const withAsh = nativeSpecs.filter((s) => s.ash != null);
    if (withAsh.length && withAsh.every((s) => s.ash <= ASH_MID)) return ASH_MID;
    return null;
  }
  function isDieselLike(fuelType) {
    const ft = String(fuelType == null ? "" : fuelType).trim();
    return ft === "05" || ft === "06" || /дизел|diesel/i.test(ft);
  }
  function aceaClassOfProfile(profile) {
    if (!profile) return null;
    const ash = profile.ashGate != null ? profile.ashGate : profile.ashAllowed != null ? profile.ashAllowed : profile.ash;
    if (ash == null) return null;
    const thick = profile.hthsMin == null || profile.hthsMin >= 3.5;
    if (ash <= ASH_LOW) return thick ? "C4" : "C1";
    if (ash <= ASH_MID) return thick ? "C3" : "C2";
    return thick ? "A3B4" : "A5B5";
  }
  var sapsLabel = (ash) => ash == null ? "—" : ash <= ASH_LOW ? "малозольное" : ash <= ASH_MID ? "среднезольное" : "полнозольное";
  function oilProfile(oilApprovals) {
    const parsed = parseApprovals(oilApprovals);
    const specs = parsed.flatMap((p) => p.specs);
    return { ...profileOfSpecs(specs), specs };
  }
  function findConflicts(items) {
    const conflicts = [];
    const byAsh = { full: [], mid: [], low: [] };
    for (const it of items) {
      for (const s of it.specs) {
        if (s.ash == null) continue;
        const bucket = s.ash <= ASH_LOW ? "low" : s.ash <= ASH_MID ? "mid" : "full";
        if (!byAsh[bucket].includes(s.label)) byAsh[bucket].push(s.label);
      }
    }
    const lean = [...byAsh.mid, ...byAsh.low];
    if (byAsh.full.length && lean.length) {
      conflicts.push({
        axis: "saps",
        hard: true,
        a: byAsh.full,
        b: lean,
        note: "В списке одновременно полнозольные и мало/среднезольные допуска. Одно масло не может удовлетворять обоим — значит список собран из паспортов разных масел."
      });
    }
    const byHths = { high: [], mid: [], low: [] };
    for (const it of items) {
      for (const s of it.specs) {
        if (!s.hths) continue;
        const bucket = s.hths[0] >= 3.5 ? "high" : s.hths[1] <= 2.9 ? "low" : "mid";
        if (!byHths[bucket].includes(s.label)) byHths[bucket].push(s.label);
      }
    }
    if (byHths.high.length && byHths.low.length) {
      conflicts.push({
        axis: "hths",
        hard: true,
        a: byHths.high,
        b: byHths.low,
        note: "В списке есть допуска и на густое (HTHS ≥ 3.5), и на сверхтекучее (HTHS < 2.9) масло. Это взаимоисключающие вязкости."
      });
    }
    return conflicts;
  }
  var NON_ENGINE_WHAT = {
    coolant: "Это допуск охлаждающей жидкости, а не моторного масла.",
    gear: "Это трансмиссионная спецификация, а не допуск моторного масла.",
    heavy: "Это допуск масла для грузовой техники."
  };
  var NON_ENGINE_WHY = {
    coolant: "Спецификация охлаждающей жидкости, а не масла: источник уехал не в тот продукт. На подбор масла не влияет вообще — строку можно смело удалить.",
    gear: "Трансмиссионная спецификация (масло в коробку или мост). К подбору масла в ДВС отношения не имеет.",
    heavy: "Спецификация масла для грузовой техники — тягачей и спецтехники. Это другой класс масла целиком, к легковому мотору отношения не имеет и в подборе не участвует."
  };
  var RANKS = {
    critical: { weight: 100, label: "ключевой", color: "red" },
    important: { weight: 40, label: "важный", color: "green" },
    // Допуск не из данных машины, а из правила «марка + годы + топливо».
    // Вес как у физического класса ACEA: это настоящее требование завода к
    // поколению моторов, но конкретно эта машина его не подтверждала — поэтому
    // ниже родного допуска (100) и с отдельной подписью в интерфейсе.
    assumed: { weight: 40, label: "по марке и годам", color: "violet" },
    minor: { weight: 12, label: "второстепенный", color: "blue" },
    info: { weight: 2, label: "справочный", color: "grey" },
    noise: { weight: 0, label: "шум", color: "grey" },
    conflict: { weight: 0, label: "противоречие", color: "amber" }
  };
  function analyzeCarApprovals(carApprovals, ctx = {}) {
    const families = makeFamilies(ctx.make);
    const familySet = new Set(families);
    const parsed = parseApprovals(carApprovals);
    const isNative = (s) => !!(s.family && familySet.has(s.family));
    const evidenceParsed = parseApprovals(ctx.evidence || []);
    const evidenceSpecs = evidenceParsed.flatMap((p) => p.specs);
    const evidenceIds = new Set(evidenceSpecs.map((s) => s.id));
    const evidenceNative = evidenceSpecs.filter(isNative);
    const conflicts = findConflicts(parsed);
    const nativeSpecs = parsed.flatMap((p) => p.specs).filter(isNative);
    const confirmed = [...evidenceNative, ...nativeSpecs.filter((s) => evidenceIds.has(s.id))];
    const confirmedIds = new Set(confirmed.map((s) => s.id));
    const nonOilCount = parsed.filter((p) => p.nonOil).length;
    const notOil = parsed.length >= 5 && nonOilCount >= parsed.length * 0.5;
    const rule = oemRuleFor(ctx);
    const ruleSpecs = rule ? parseApprovals(rule.specs).flatMap((p) => p.specs) : [];
    let profileSpecs, confidence, ruleApplied = false;
    if (!notOil && (nativeSpecs.length || evidenceNative.length)) {
      profileSpecs = [...nativeSpecs, ...evidenceNative];
      confidence = confirmed.length ? "high" : "medium";
    } else if (ruleSpecs.length) {
      profileSpecs = ruleSpecs;
      confidence = "assumed";
      ruleApplied = true;
    } else if (notOil) {
      profileSpecs = [];
      confidence = "none";
    } else {
      profileSpecs = parsed.flatMap((p) => p.specs).filter((s) => s.role === "acea");
      confidence = "low";
    }
    const profile = profileOfSpecs(profileSpecs);
    profile.ashGate = ashGateFor(nativeSpecs, ctx, rule);
    profile.hthsGate = notOil && !ruleApplied ? null : hthsGateFor(nativeSpecs) ?? profile.hthsMin;
    const carLabel = String(ctx.make || "этой машины").trim();
    const items = parsed.map((p) => {
      const primary = p.specs[0] || null;
      const nativeSpec = p.specs.find(isNative) || null;
      const rank = rankApproval({ p, primary, nativeSpec, profile, confirmedIds, notOil });
      return {
        raw: p.raw,
        parts: p.parts,
        label: primary ? p.specs.length > 1 ? p.raw : primary.label : p.raw,
        family: primary ? primary.family || primary.role : null,
        role: p.nonOil ? "nonoil" : primary ? primary.role : null,
        known: p.specs.length > 0,
        native: !!nativeSpec,
        confirmed: p.specs.some((s) => confirmedIds.has(s.id)),
        rank,
        weight: RANKS[rank].weight,
        what: p.nonOil ? NON_ENGINE_WHAT[p.kind] : primary ? primary.what : "Строка не опознана справочником допусков.",
        why: explainRank({ rank, p, primary, nativeSpec, profile, carLabel, confidence, notOil }),
        ash: primary ? primary.ash : null,
        hths: primary ? primary.hths : null
      };
    });
    const missing = [];
    const seen = new Set(parsed.flatMap((p) => p.specs).map((s) => s.id));
    for (const s of evidenceNative) {
      if (!seen.has(s.id) && !missing.some((m) => m.id === s.id)) missing.push(s);
    }
    for (const s of missing) {
      items.push({
        raw: s.label,
        parts: [s.label],
        label: s.label,
        family: s.family,
        role: s.role,
        known: true,
        native: true,
        confirmed: true,
        fromEvidence: true,
        rank: "critical",
        weight: RANKS.critical.weight,
        what: s.what,
        why: `Заводской допуск ${FAMILY_LABEL[s.family] || s.family} для ${carLabel}. В списке машины его нет — источник его потерял, — но Motul предлагает масло именно под него для этой модификации. Добавлен в подбор как требование.` + physicsTail(s),
        ash: s.ash,
        hths: s.hths
      });
    }
    if (ruleApplied) {
      for (const s of ruleSpecs) {
        const same = items.find((it) => (it.parts || []).some((part) => {
          const found = findSpec(part);
          return found && found.id === s.id;
        }));
        const why = `У этой машины допусков в базе нет — требование выведено по марке, году и топливу. ${rule.why}` + physicsTail(s) + "\nЭто ориентир по поколению моторов, а не допуск конкретной машины: если знаешь допуск точно — впиши его в карточку, он важнее правила.";
        if (same) {
          if (same.weight < RANKS.assumed.weight) {
            same.rank = "assumed";
            same.weight = RANKS.assumed.weight;
          }
          same.fromRule = true;
          same.why = why;
          continue;
        }
        items.push({
          raw: s.label,
          parts: [s.label],
          label: s.label,
          family: s.family || s.role,
          role: s.role,
          known: true,
          native: !!(s.family && familySet.has(s.family)),
          confirmed: false,
          fromRule: true,
          rank: "assumed",
          weight: RANKS.assumed.weight,
          what: s.what,
          why,
          ash: s.ash,
          hths: s.hths
        });
      }
    }
    const counts = {};
    for (const it of items) counts[it.rank] = (counts[it.rank] || 0) + 1;
    return {
      items,
      profile,
      conflicts,
      confidence,
      families,
      counts,
      notOil,
      missing,
      // Правило по марке/годам: сработало ли оно, применено ли как требование
      // (applied) и что именно оно сказало про сажевый фильтр.
      rule: rule ? { ...rule, applied: ruleApplied } : null,
      // Список — объединение паспортов масел, а не требования мотора
      unionSuspect: conflicts.some((c) => c.hard) || countFamilies(parsed) >= 3,
      decisive: items.filter((i) => ["critical", "important", "assumed"].includes(i.rank))
    };
  }
  function countFamilies(parsed) {
    const fams = /* @__PURE__ */ new Set();
    for (const p of parsed) for (const s of p.specs) if (s.family) fams.add(s.family);
    return fams.size;
  }
  function rankApproval({ p, primary, nativeSpec, profile, confirmedIds, notOil }) {
    if (p.nonOil) return "noise";
    if (!primary) return "noise";
    if (primary.role === "api") return "info";
    if (notOil) return "noise";
    const target = nativeSpec || (primary.role === "acea" ? primary : null);
    if (target) {
      if (viscConflict(target, profile)) return "conflict";
      if (looserThanProfile(target, profile)) return "minor";
    }
    if (nativeSpec) return "critical";
    if (primary.role === "acea") {
      if (matchesProfile(primary, profile)) return "important";
      return "minor";
    }
    return "noise";
  }
  function viscConflict(spec, profile) {
    const gate = profile && (profile.hthsGate != null ? profile.hthsGate : profile.hthsMin);
    if (gate == null || !spec.hths) return false;
    return spec.hths[1] < gate;
  }
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
  function explainRank({ rank, p, primary, nativeSpec, profile, carLabel, confidence, notOil }) {
    const famLabel = primary && primary.family ? FAMILY_LABEL[primary.family] || primary.family : "";
    if (p.nonOil) return NON_ENGINE_WHY[p.kind] || NON_ENGINE_WHY.coolant;
    if (rank === "critical") {
      const conf = confidence === "high" ? " Подтверждён вторым источником — рекомендацией Motul по этой конкретной машине, поэтому подбор опирается прежде всего на него." : " Единственный класс обязательств, который у этой машины настоящий, — по нему и подбираем.";
      return `Заводской допуск ${famLabel} — обязателен для ${carLabel}.` + conf + physicsTail(primary);
    }
    if (rank === "important") {
      return `Класс ACEA совпадает с тем, что мотору реально нужно (${sapsLabel(profile.ashGate ?? profile.ashAllowed)}${profile.hthsMin != null ? `, HTHS ≥ ${profile.hthsMin}` : ""}). Марка тут ни при чём: это прямое физическое требование, и по нему масло отбирается даже когда родного допуска в каталоге нет.` + physicsTail(primary);
    }
    if (rank === "conflict") {
      return `Требует вязкости, несовместимой с остальным набором: масло под него будет жиже, чем нужно мотору (HTHS ≥ ${profile.hthsMin}). Перекрыть «более строгим» допуском такое нельзя — это выбор между разными маслами, а не ступени одной лестницы. В подборе не учитывается.` + physicsTail(primary);
    }
    if (rank === "minor") {
      if (looserThanProfile(nativeSpec || primary, profile)) {
        return `Менее строгая ветка: разрешает ${sapsLabel((nativeSpec || primary).ash)} масло, тогда как мотору с сажевым фильтром нужно ${sapsLabel(profile.ashGate)}. Масло по строгой ветке подходит и сюда, поэтому подбор идёт по строгой, а этот допуск — фон. Закрыть на него глаза можно: ошибка стоит ресурса масла, а не железа.` + physicsTail(primary);
      }
      if (nativeSpec) {
        return `Родной допуск ${famLabel}, но выбор определяет не он: более строгий допуск той же марки уже задал профиль масла. Совпадение по нему — приятный бонус, не критерий.` + physicsTail(primary);
      }
      return "Класс ACEA, который мотору не противоречит, но и не задаёт выбор — ограничение уже установлено более строгим допуском." + physicsTail(primary);
    }
    if (rank === "info") {
      return "Уровень качества API/ILSAC, а не допуск. Есть практически у всех масел каталога, поэтому между ними ничего не различает — работает только как отсечка совсем старых масел.";
    }
    if (notOil) {
      return "Список допусков этой машины собран не по маслу, поэтому ни одна строка в нём не считается требованием. Подбор идёт как для машины без допусков" + (confidence === "assumed" ? " — по марке, году и топливу." : ".");
    }
    if (primary && primary.role === "oem") {
      return `Заводской допуск ${famLabel} — к ${carLabel} отношения не имеет. Попал в список потому, что источник отдаёт паспорт рекомендованного масла целиком, а там стоят допуска пары десятков чужих марок. Обязательств не создаёт, в подборе игнорируется.`;
    }
    return "Строка не опознана справочником допусков — в подборе не участвует.";
  }
  function physicsTail(spec) {
    if (!spec) return "";
    const bits = [];
    if (spec.ash != null) bits.push(`${sapsLabel(spec.ash)} (зола ≤ ${spec.ash}%)`);
    if (spec.hths) {
      bits.push(spec.hths[1] === Infinity ? `HTHS ≥ ${spec.hths[0]}` : `HTHS ${spec.hths[0]}–${spec.hths[1]}`);
    }
    if (spec.visc) bits.push(`вязкость ${spec.visc.join("/")}`);
    return bits.length ? `
Физика: ${bits.join(", ")}.` : "";
  }
  function oilFitsProfile(oilApprovals, analysis) {
    const notes = [];
    if (!analysis || !analysis.profile) return { blocked: false, penalty: 0, notes };
    const { profile, confidence } = analysis;
    const prof = oilProfile(oilApprovals);
    let blocked = false, penalty = 0;
    const hardAsh = confidence === "high" || confidence === "medium" || confidence === "assumed";
    const hardHths = confidence === "high" || confidence === "medium";
    if (profile.ashGate != null && prof.ash != null) {
      if (prof.ash > profile.ashGate) {
        const note = `масло ${sapsLabel(prof.ash)}, мотору нужно ${sapsLabel(profile.ashGate)}`;
        if (hardAsh) {
          blocked = true;
          notes.push(note);
        } else {
          penalty += 40;
          notes.push(note + " (профиль выведен неточно)");
        }
      } else if (profile.ash != null && prof.ash > profile.ash) {
        penalty += 15;
        notes.push(`мотору желательно ${sapsLabel(profile.ash)}, у масла ${sapsLabel(prof.ash)}`);
      }
    }
    const hthsGate = profile.hthsGate != null ? profile.hthsGate : profile.hthsMin;
    if (hthsGate != null && prof.hthsMin != null && prof.hthsMin + 1e-3 < hthsGate) {
      if (hardHths) {
        blocked = true;
        notes.push(`HTHS масла ниже требуемого ${hthsGate}`);
      } else {
        penalty += 25;
        notes.push(`HTHS масла, похоже, ниже требуемого ${hthsGate}`);
      }
    } else if (profile.hthsMax != null && profile.hthsMax !== Infinity && prof.hthsMin != null && prof.hthsMin >= profile.hthsMax) {
      penalty += 20;
      notes.push(`мотор рассчитан на HTHS до ${profile.hthsMax}, масло гуще`);
    }
    return { blocked, penalty, notes };
  }

  // shared/calculator.js
  var roundL = (x) => {
    const n = Number(x);
    return Number.isFinite(n) ? Math.round(n * 1e3) / 1e3 : 0;
  };
  function normApproval(s) {
    if (!s) return "";
    return s.toString().toUpperCase().replace(/APPROVAL/g, "").replace(/LICENSE.*$/, "").replace(/[\s\-_\.\/,;:()]+/g, "").replace(/MERCEDES|MBAPPROVAL/g, "MB").replace(/VOLKSWAGEN/g, "VW").replace(/RENAULTRN|RENAULT/g, "RN").replace(/GMOPEL|OPEL/g, "GM").replace(/BMWLL|LONGLIFE/g, "LL").replace(/JAGUARLANDROVER|JAGUAR/g, "STJLR").replace(/FORDWSS/g, "FORDWSS").replace(/АВТОВАЗ/g, "VAZ");
  }
  function tokenSet(arr) {
    const s = /* @__PURE__ */ new Set();
    for (const a of arr || []) {
      const n = normApproval(a);
      if (n.length >= 3) s.add(n);
      const nums = n.match(/\d{3,6}/g);
      if (nums) for (const x of nums) s.add(x);
    }
    return s;
  }
  var APPROVAL_SUPERSEDES_RULES = [
    // Mercedes-Benz
    ["MB 229.52", ["MB 229.51", "MB 229.31"]],
    ["MB 229.51", ["MB 229.31"]],
    ["MB 229.31", ["MB 229.3"]],
    ["MB 229.5", ["MB 229.3", "MB 229.1"]],
    ["MB 229.3", ["MB 229.1"]],
    // VW
    ["VW 504 00", ["VW 502 00"]],
    ["VW 507 00", ["VW 505 01", "VW 505 00"]],
    // BMW Longlife
    ["LL 04", ["LL 01"]],
    ["LL 01", ["LL 98"]],
    // Renault
    ["RN 0710", ["RN 0700"]]
  ];
  var _supersedesMap = null;
  function supersedesMap() {
    if (_supersedesMap) return _supersedesMap;
    const m = /* @__PURE__ */ new Map();
    const add = (sup, sub, label) => {
      if (!m.has(sup)) m.set(sup, /* @__PURE__ */ new Map());
      if (!m.get(sup).has(sub)) m.get(sup).set(sub, label);
    };
    for (const [sup, subs] of APPROVAL_SUPERSEDES_RULES) {
      for (const sub of subs) {
        for (const supTok of tokenSet([sup])) {
          for (const subTok of tokenSet([sub])) {
            add(supTok, subTok, { via: sup, covers: sub });
          }
        }
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const [sup, subs] of m) {
        for (const [sub, label] of subs) {
          const deeper = m.get(sub);
          if (!deeper) continue;
          for (const [sub2, label2] of deeper) {
            if (sup === sub2 || subs.has(sub2)) continue;
            add(sup, sub2, { via: label.via, covers: label2.covers });
            changed = true;
          }
        }
      }
    }
    _supersedesMap = m;
    return m;
  }
  function expandCoveredTokens(oilTokens) {
    const m = supersedesMap();
    const out = /* @__PURE__ */ new Map();
    for (const t of oilTokens) {
      const covered = m.get(t);
      if (!covered) continue;
      for (const [sub, label] of covered) {
        if (!oilTokens.has(sub) && !out.has(sub)) out.set(sub, label);
      }
    }
    return out;
  }
  function splitOilApprovals(oilApprovals, carApprovals) {
    const oilArr = oilApprovals || [];
    const carArr = carApprovals || [];
    const carTok = tokenSet(carArr);
    const carTokToStr = /* @__PURE__ */ new Map();
    for (const a of carArr) {
      for (const t of tokenSet([a])) if (!carTokToStr.has(t)) carTokToStr.set(t, a);
    }
    const matched = [], others = [], hier = [];
    for (const a of oilArr) {
      const tk = tokenSet([a]);
      let isHit = false;
      for (const t of tk) {
        if (carTok.has(t)) {
          isHit = true;
          break;
        }
      }
      if (isHit) {
        matched.push(a);
        continue;
      }
      const covered = expandCoveredTokens(tk);
      let hierHit = null;
      for (const [sub] of covered) {
        if (carTok.has(sub)) {
          hierHit = carTokToStr.get(sub) || sub;
          break;
        }
      }
      if (hierHit) hier.push({ approval: a, covers: hierHit });
      else others.push(a);
    }
    return { matched, others, hier };
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
          matches.push({ tag, desc: reg.descriptions[tag] || "" });
          break;
        }
      }
    }
    return matches;
  }
  function extractAtfSpecs(text) {
    const t = " " + (text || "").toUpperCase().replace(/[._/,;:()\-]+/g, " ").replace(/\s+/g, " ") + " ";
    const out = /* @__PURE__ */ new Set();
    if (/\b(?:DEXRON|DEX|ATF)\s*(?:VI|6)\b/.test(t)) out.add("DEXRONVI");
    if (/\bDEXRON\s*(?:III|3)[A-Z]?\b/.test(t)) out.add("DEXRONIII");
    if (/\bDEXRON\s*(?:II|2)[A-Z]?\b/.test(t) && !/\bDEXRON\s*III\b/.test(t)) out.add("DEXRONII");
    if (/\bMERCON\s*LV\b/.test(t)) out.add("MERCONLV");
    if (/\bMERCON\s*V\b/.test(t) && !/MERCON\s*LV/.test(t)) out.add("MERCONV");
    if (/\bWSS\s*M2C922\b/.test(t)) out.add("WSSM2C922");
    if (/\bSPH\s*(?:IV|4)\b/.test(t)) out.add("SPHIV");
    if (/\bSP\s*(?:IV|4)\b/.test(t)) out.add("SPIV");
    if (/\bSP\s*(?:III|3)\b/.test(t)) out.add("SPIII");
    if (/\bSP\s*(?:II|2)\b/.test(t) && !/\bSP\s*III\b/.test(t)) out.add("SPII");
    if (/\bRED\s*1K\b/.test(t)) out.add("REDIK");
    if (/\bNWS\s*9638\b/.test(t)) out.add("NWS9638");
    if (/\bTOYOTA\s*WS\b|\bATF\s*WS\b|(?:^|\s)WS\s/.test(t)) out.add("TOYOTAWS");
    if (/\bT\s*(?:IV|4)\b|\bTYPE\s*(?:IV|4)\b/.test(t)) out.add("TYPEIV");
    if (/\bT\s*(?:III|3)\b|\bTYPE\s*(?:III|3)\b/.test(t)) out.add("TYPEIII");
    if (/\bD\s*(?:II|2)\b|\bTYPE\s*(?:II|2)\b/.test(t)) out.add("TYPEII");
    if (/\bATF\s*J3\b/.test(t)) out.add("ATFJ3");
    if (/\bATF\s*J2\b/.test(t)) out.add("ATFJ2");
    if (/\bATF\s*PA\b/.test(t)) out.add("ATFPA");
    if (/\bATF\s*FZ\b|\bMAZDA\s*FZ\b/.test(t)) out.add("MAZDAFZ");
    if (/\bMAZDA\s*M\s*V\b|\bM\s*V\b/.test(t)) out.add("MAZDAMV");
    if (/\bDW\s*1\b/.test(t)) out.add("HONDADW1");
    if (/\bHONDA\s*Z\s*1\b|\bZ\s*1\b/.test(t)) out.add("HONDAZ1");
    if (/\bATF\s*\+?\s*4\b/.test(t)) out.add("ATFP4");
    if (/\bAW\s*1\b/.test(t)) out.add("AW1");
    const mbMatches = t.match(/\bMB\s*236\s*(\d+)\b/g);
    if (mbMatches) for (const m of mbMatches) out.add(m.replace(/\s+/g, ""));
    const vwMatches = t.match(/\bG\s*0\s*\d{2}\s*\d{3}\b/g);
    if (vwMatches) for (const m of vwMatches) out.add("VW" + m.replace(/\s+/g, ""));
    const bmwMatches = t.match(/\b\d{2,3}\s+\d{2,3}\s+\d{1,3}\s+\d{2,4}\s+\d{2,4}\b/g);
    if (bmwMatches) for (const m of bmwMatches) out.add("BMW" + m.replace(/\s+/g, ""));
    const jwsMatches = t.match(/\bJWS\s*33(09|17|24)\b/g);
    if (jwsMatches) for (const m of jwsMatches) out.add("JWS33" + m.match(/\d{2}$/)[0]);
    const maticMatches = t.match(/\bMATIC(?:\s+FLUID)?\s+([ADJKSW])\b/g);
    if (maticMatches) for (const m of maticMatches) out.add("MATIC" + m.match(/[ADJKSW]\b/)[0]);
    return out;
  }
  function carAtfSpecSet(motulProducts) {
    const set = /* @__PURE__ */ new Set();
    for (const p of motulProducts || []) for (const tok of extractAtfSpecs(p)) set.add(tok);
    return set;
  }
  function oilAtfMatches(oil, carSet) {
    if (!carSet || !carSet.size) return [];
    const matches = [];
    for (const a of oil.a || []) {
      for (const tok of extractAtfSpecs(a)) {
        if (carSet.has(tok)) {
          matches.push(a);
          break;
        }
      }
    }
    return matches;
  }
  function pickAtfOils(motulProducts, atfDefs) {
    const { zic, rolfDexron6: rolfDex, rolfMulti } = atfDefs;
    const motulText = (motulProducts || []).join(" | ").toUpperCase();
    const wantsDexron6 = /\b(?:DEXRON|DEX|ATF)\s*(?:VI|6)\b/.test(motulText);
    const carSet = carAtfSpecSet(motulProducts);
    const zicHits = oilAtfMatches(zic, carSet);
    const rolfDexHits = oilAtfMatches(rolfDex, carSet);
    const rolfMultiHits = oilAtfMatches(rolfMulti, carSet);
    let rolf;
    if (wantsDexron6 && rolfDexHits.length) rolf = rolfDex;
    else if (rolfMultiHits.length) rolf = rolfMulti;
    else if (rolfDexHits.length) rolf = rolfDex;
    else rolf = wantsDexron6 ? rolfDex : rolfMulti;
    const anyHit = zicHits.length + rolfDexHits.length + rolfMultiHits.length;
    const noMatch = (motulProducts || []).length > 0 && carSet.size > 0 && anyHit === 0;
    return {
      oil1: zic,
      oil2: rolf,
      noMatch,
      wantsDexron6,
      debug: { zicHits, rolfDexHits, rolfMultiHits, carSet: [...carSet] }
    };
  }
  function getAggregates(data) {
    const out = [];
    const lbl = (a, def) => a && typeof a.label === "string" && a.label.trim() ? a.label.trim() : def;
    const renamed = (a) => !!(a && typeof a.label === "string" && a.label.trim());
    if (data.engine) {
      const eng = { ...data.engine };
      eng.volume = eng.volumeService || eng.volumeTotal || eng.volumePlain || eng.volume || 0;
      eng.volumeType = eng.volumeService ? "service" : eng.volumeTotal ? "total" : "plain";
      out.push({ key: "engine", group: "engine", ...eng, label: lbl(data.engine, "ДВС (двигатель)"), labelOverride: renamed(data.engine) });
    }
    const pickTotal = (a) => {
      const r = { ...a };
      r.volume = r.volumeTotal || r.volumeService || r.volumePlain || r.volume || 0;
      r.volumeType = r.volumeTotal ? "total" : r.volumeService ? "service" : "plain";
      r.approvals = r.motulProducts || [];
      return r;
    };
    if (data.automatic && !data.automatic.isDct)
      out.push({ key: "automatic", group: "auto", ...pickTotal(data.automatic), label: lbl(data.automatic, data.automatic.isCvt ? "Вариатор (CVT)" : "АКПП"), labelOverride: renamed(data.automatic) });
    if (data.manual) out.push({ key: "manual", group: "gear", ...pickTotal(data.manual), label: lbl(data.manual, data.manual.isSemiAuto ? "Робот/АМТ (расчёт как МКПП)" : "МКПП"), labelOverride: renamed(data.manual) });
    if (data.transfer) out.push({ key: "transfer", group: "gear", ...pickTotal(data.transfer), label: lbl(data.transfer, "Раздаточная коробка"), labelOverride: renamed(data.transfer) });
    if (data.diffFront) out.push({ key: "diffFront", group: "gear", ...pickTotal(data.diffFront), label: lbl(data.diffFront, "Дифференциал (перед)"), labelOverride: renamed(data.diffFront) });
    if (data.diffRear) out.push({ key: "diffRear", group: "gear", ...pickTotal(data.diffRear), label: lbl(data.diffRear, "Дифференциал (зад)"), labelOverride: renamed(data.diffRear) });
    const custom = Array.isArray(data.custom) ? data.custom : [];
    for (const c of custom) {
      if (!c || typeof c !== "object" || !c.key) continue;
      const group = c.group === "auto" ? "auto" : "gear";
      out.push({
        key: c.key,
        label: c.label || (group === "auto" ? c.isCvt ? "Вариатор" : "АКПП" : "Агрегат"),
        group,
        isCvt: group === "auto" ? !!c.isCvt : false,
        isCustom: true,
        ...pickTotal(c)
      });
    }
    return out;
  }
  function shouldDefaultToPartial(car, data) {
    if (data.automatic) {
      if (data.automatic.isCvt) return true;
      if (data.automatic.isDct) return true;
      if (/dsg|dct|cvt|powershift|s\s*tronic|вариатор|робот|двойн[а-я]+ сцеплен/i.test(data.automatic.label || "")) return true;
    }
    return crmPrefersPartial(car, data);
  }
  function filtersTotal(calcState2) {
    const f = calcState2.filters;
    let sum = 0;
    if (f.mf.enabled && f.mf.price) sum += f.mf.price;
    if (f.vf.enabled && f.vf.price) sum += f.vf.price + (f.vf.work || 0);
    if (f.sf.enabled && f.sf.price) sum += f.sf.price + (f.sf.work || 0);
    return sum;
  }
  function requirementGroup(item) {
    if (item.role === "acea") return "ACEA";
    if (item.role === "api") return "API";
    return item.family || item.role || item.label;
  }
  var CORE_MIN = Math.round(RANKS.important.weight * 0.7);
  function buildOilRater(analysis) {
    const scoredItems = analysis ? analysis.items.filter((i) => i.weight > 0) : [];
    return (oil) => {
      const oilTokens = tokenSet(oil.a);
      const covered = expandCoveredTokens(oilTokens);
      const best = /* @__PURE__ */ new Map();
      const direct = [], hier = [];
      for (const item of scoredItems) {
        const tk = tokenSet(item.parts);
        let hit = false;
        for (const t of tk) if (oilTokens.has(t)) {
          hit = true;
          break;
        }
        let gained = 0;
        if (hit) {
          gained = item.weight;
          direct.push(item.label);
        } else {
          let via = null;
          for (const t of tk) {
            const lab = covered.get(t);
            if (lab) {
              via = lab.via;
              break;
            }
          }
          if (via) {
            gained = item.rank === "assumed" ? item.weight : Math.round(item.weight * 0.7);
            hier.push({ covers: item.label, via });
          }
        }
        if (!gained) continue;
        const key = requirementGroup(item);
        if (gained > (best.get(key) || 0)) best.set(key, gained);
      }
      let score = 0, core = 0;
      for (const v of best.values()) {
        score += v;
        if (v >= CORE_MIN) core += v;
      }
      const fit = analysis ? oilFitsProfile(oil.a, analysis) : { blocked: false, penalty: 0, notes: [] };
      return {
        oil,
        score: score - fit.penalty,
        core: core - fit.penalty,
        direct,
        hier,
        blocked: fit.blocked,
        fitNotes: fit.notes
      };
    };
  }
  var THIN_CLASSES = /* @__PURE__ */ new Set(["A5B5", "C2", "C1"]);
  function oilMeetsClass(oil, cls) {
    const p = oilProfile(oil.a || []);
    const thick = p.hthsMin != null && p.hthsMin >= 3.5;
    if (thick && THIN_CLASSES.has(cls)) return false;
    if (hasLiteralAceaClass(oil, cls)) return true;
    if (p.hthsMin == null) return false;
    switch (cls) {
      // Полнозольные классы золу не ограничивают — важен только HTHS, и
      // зольность масла для них можно не знать вовсе. Иначе японские масла
      // с одним лишь ILSAC в паспорте (Molygen, ZEPRO, ZIC X9) выпадали из
      // выбора именно там, где они и нужны, — на машинах под ILSAC.
      case "A3B4":
        return thick;
      case "A5B5":
        return !thick;
      // Малозольные классы — наоборот: без замера по золе подтвердить нечем.
      case "C3":
        return p.ash != null && thick && p.ash <= ASH_MID;
      case "C2":
        return p.ash != null && p.ash <= ASH_MID;
      case "C1":
        return p.ash != null && p.ash <= ASH_LOW;
      default:
        return false;
    }
  }
  function cheapestFirst(rated) {
    if (!rated.length) return [];
    const bestCore = rated.reduce((m, r) => Math.max(m, r.core), -Infinity);
    return rated.filter((r) => r.core === bestCore).sort((a, b) => a.oil.price !== b.oil.price ? a.oil.price - b.oil.price : b.score - a.score);
  }
  function hasLiteralAceaClass(oil, cls) {
    const t = tokenSet(oil.a);
    if (cls === "A5B5") return [...t].some((x) => /A5B5|ACEAA5B5/.test(x));
    if (cls === "C3") return [...t].some((x) => /ACEAC3|^C3$/.test(x));
    if (cls === "C2") return [...t].some((x) => /ACEAC2|^C2$/.test(x));
    if (cls === "C1") return [...t].some((x) => /ACEAC1|^C1$/.test(x));
    if (cls === "A3B4") return [...t].some((x) => /A3B4|ACEAA3B4/.test(x));
    return true;
  }
  function pickEngineOils(agg, shopOils, calcState2, carApprovals) {
    const mileage = calcState2.mileage;
    if (mileage === ">=200") {
      const oils10w40 = shopOils.filter((o) => o.v === "10W-40" && !o.isSpot);
      const oil = oils10w40[0] || { b: "Mobil", n: "Ultra 10W-40", price: 1350, v: "10W-40", a: ["API SN"], ad: [] };
      agg.approvals = [];
      agg.allCandidates = oils10w40;
      agg.topCandidates = [oil];
      return { mid: oil, spot: null };
    }
    if (mileage === "0w20" || mileage === "0w30") {
      const visc0w = mileage === "0w20" ? "0W-20" : "0W-30";
      const oils0w = shopOils.filter((o) => o.v === visc0w && !o.isSpot);
      const carApp0w = Array.isArray(carApprovals) ? carApprovals : [];
      const analysis0w = calcState2.ignoreApprovals ? null : analyzeApprovalsFor(agg, calcState2, carApp0w);
      const rate0w = buildOilRater(analysis0w);
      const rated0w = oils0w.map(rate0w);
      agg.approvalAnalysis = analysis0w;
      rated0w.sort((a, b) => b.score !== a.score ? b.score - a.score : a.oil.price - b.oil.price);
      const fallback0w = mileage === "0w20" ? { b: "ZIC", n: "X9 FE 0W-20", price: 1550, v: "0W-20", a: ["API SP"], ad: [] } : { b: "ZIC", n: "ZERO 0W-30", price: 2150, v: "0W-30", a: ["ACEA C3"], ad: [] };
      let eligible0w = rated0w.filter((r) => !r.blocked);
      if (!eligible0w.length) eligible0w = rated0w;
      const sufficient0w = cheapestFirst(eligible0w);
      const mid0w = sufficient0w.length ? sufficient0w[0].oil : fallback0w;
      let second0w = null;
      if (calcState2.ignoreApprovals && rated0w.length > 1) second0w = rated0w[1].oil;
      agg.approvals = carApp0w;
      agg.allCandidates = rated0w.map((r) => r.oil);
      agg.topCandidates = sufficient0w.map((r) => r.oil);
      agg.ranked = rated0w.map((r) => ({
        oil: r.oil,
        score: r.score,
        core: r.core,
        direct: r.direct,
        hier: r.hier,
        classMiss: null,
        blocked: r.blocked || false,
        fitNotes: r.fitNotes || [],
        sufficient: sufficient0w.some((s) => s.oil === r.oil)
      }));
      return { mid: mid0w, spot: second0w };
    }
    const targetVisc = mileage === ">=100" ? "5W-40" : "5W-30";
    const car = calcState2.car;
    const fuelType = String(car.fuelType || "");
    const ec = (car.engineCode || "").toUpperCase();
    const isDieselVehicle = isDieselFuel(fuelType) || /D(CI|TI|I)?\b|TDI|HDI|CRDI|BLUEHDI|JTD|MULTIJET/i.test(ec);
    const approvals = Array.isArray(carApprovals) ? carApprovals : [];
    const carTokens = tokenSet(approvals);
    const effectiveCarTokens = calcState2.ignoreApprovals ? /* @__PURE__ */ new Set() : carTokens;
    const analysis = calcState2.ignoreApprovals ? null : analyzeApprovalsFor(agg, calcState2, approvals);
    const needA5B5 = [...effectiveCarTokens].some((t) => /A5B5|ACEAA5B5|ACEAA5|ACEAB5/.test(t));
    const needC3 = [...effectiveCarTokens].some((t) => /ACEAC3|^C3$/.test(t));
    const needC2 = [...effectiveCarTokens].some((t) => /ACEAC2|^C2$/.test(t));
    const needC1 = [...effectiveCarTokens].some((t) => /ACEAC1|^C1$/.test(t));
    const needA3B4 = [...effectiveCarTokens].some((t) => /A3B4|ACEAA3B4|ACEAA3|ACEAB4/.test(t));
    let requiredClass = null;
    if (!calcState2.ignoreApprovals) {
      if (analysis && analysis.confidence !== "low" && analysis.confidence !== "none") {
        requiredClass = aceaClassOfProfile(analysis.profile);
      }
      if (!requiredClass) {
        if (needA5B5) requiredClass = "A5B5";
        else if (needC3) requiredClass = "C3";
        else if (needC2) requiredClass = "C2";
        else if (needC1) requiredClass = "C1";
        else if (needA3B4) requiredClass = "A3B4";
      }
    }
    const poolAll = shopOils.filter((o) => o.v === targetVisc && !o.isSpot);
    const rateOil = buildOilRater(analysis);
    const ratedAll = poolAll.map(rateOil);
    for (const r of ratedAll) {
      r.classOk = !requiredClass || oilMeetsClass(r.oil, requiredClass);
      if (!requiredClass) continue;
      if (r.classOk) {
        r.score += 30;
        r.core += 30;
      } else r.classMiss = requiredClass;
    }
    ratedAll.sort((a, b) => b.score !== a.score ? b.score - a.score : a.oil.price - b.oil.price);
    let eligible = ratedAll.filter((r) => !r.blocked);
    if (!eligible.length) eligible = ratedAll;
    if (!requiredClass) {
      const thick = eligible.filter((r) => oilMeetsClass(r.oil, "A3B4"));
      if (thick.length) eligible = thick;
    }
    const sufficient = cheapestFirst(eligible);
    const mid = sufficient.length ? sufficient[0].oil : (eligible[0] || ratedAll[0] || {}).oil || null;
    const needPro = needA5B5 || needC1 || needC2 || needC3 || isDieselVehicle;
    agg.spotWarn = null;
    const spotRated = shopOils.filter((o) => o.isSpot && o.v === targetVisc).map(rateOil);
    for (const r of spotRated) r.classOk = !requiredClass || oilMeetsClass(r.oil, requiredClass);
    const pickSpot = (list) => (list.find((r) => r.oil.tier === (needPro ? "pro" : "optimal")) || [...list].sort((a, b) => a.oil.price - b.oil.price)[0]).oil;
    const spotFit = spotRated.filter((r) => !r.blocked && r.classOk);
    const spotSafe = spotRated.filter((r) => !r.blocked);
    let spot = null;
    if (spotFit.length) {
      spot = pickSpot(spotFit);
    } else if (spotSafe.length) {
      spot = pickSpot(spotSafe);
      agg.spotWarn = `у SPOT ${targetVisc} нет класса ${requiredClass} — проверь, требует его завод или только разрешает`;
    } else if (spotRated.length) {
      const worst = spotRated.find((r) => r.blocked) || spotRated[0];
      agg.spotWarn = `SPOT ${targetVisc} не подходит: ${(worst.fitNotes || []).join("; ")}`;
    }
    agg.approvals = approvals;
    agg.isDiesel = isDieselVehicle;
    agg.requiredClass = requiredClass;
    agg.approvalAnalysis = analysis;
    agg.allCandidates = ratedAll.map((r) => r.oil);
    agg.topCandidates = sufficient.map((r) => r.oil);
    agg.ranked = ratedAll.map((r) => ({
      oil: r.oil,
      score: r.score,
      core: r.core,
      direct: r.direct,
      hier: r.hier,
      classMiss: r.classMiss || null,
      blocked: r.blocked || false,
      fitNotes: r.fitNotes || [],
      // Закрывает все требования, которые вообще закрываются этой вязкостью,
      // и безопасно по физике — такое можно предлагать не глядя.
      sufficient: sufficient.some((s) => s.oil === r.oil)
    }));
    return { mid, spot };
  }
  function analyzeApprovalsFor(agg, calcState2, approvals) {
    const car = calcState2.car || {};
    return analyzeCarApprovals(approvals, {
      make: car.makeShort || car.make || "",
      model: car.modelShort || car.model || "",
      fuelType: car.fuelType,
      yearFrom: car.yearFrom,
      // Марка, год и топливо нужны правилам из shared/oemRules.js, а мощность
      // с объёмом — чтобы правило не накрыло наддувную версию семейства,
      // которой нужно масло гуще базовой.
      bhp: car.bhp,
      engineVolume: car.volume,
      evidence: specsFromProductNames(agg.motulProducts || [])
    });
  }
  var MANUAL_UNSUPPORTED_SPECS = [
    { re: /\b70W\b/i, label: "70W" },
    { re: /75W[\s-]?85/i, label: "75W-85" },
    { re: /80W[\s-]?90/i, label: "80W-90" },
    { re: /\bLS\b/i, label: "LS (limited slip)" }
  ];
  function manualOilWarn(agg) {
    if (agg.key !== "manual") return null;
    const products = agg.motulProducts || agg.approvals || [];
    if (!products.length) return { reason: "notFound" };
    for (const p of products) {
      for (const spec of MANUAL_UNSUPPORTED_SPECS) {
        if (spec.re.test(String(p))) {
          return { reason: "spec", spec: spec.label, product: String(p) };
        }
      }
    }
    return null;
  }
  function manualWarnText(warn) {
    if (!warn) return "";
    if (warn.reason === "notFound") {
      return "Motul не дал продуктов для МКПП (product not found) — предложить нечего, перевести на мастера";
    }
    return `Motul требует ${warn.spec} («${warn.product}») — такого масла в наличии нет, предложить нечего, перевести на мастера`;
  }
  function calcForAggregate(agg, calcState2, carApprovals) {
    if (agg.key === "manual" && agg.rawText && /HIGH\s*GEAR|HIGHGEAR|HI[\s\-]?GEAR/i.test(agg.rawText)) {
      return { isHighGear: true, costs: [], vCalc: 0, formula: "", volumeStr: "—" };
    }
    const shopOils = getShopOils();
    const defaults = getDefaults();
    const isCvt = agg.group === "auto" && agg.isCvt;
    const v0 = roundL(parseFloat(agg.volume || 0));
    const vFilter = roundL(parseFloat(agg.filterVolume || 0));
    const motulVol = roundL(v0 + vFilter);
    let vService = motulVol;
    let overrideUsed = false;
    const override = roundL(parseFloat((calcState2.volumeOverride || {})[agg.key]));
    if (isFinite(override) && override > 0) {
      vService = override;
      overrideUsed = true;
    } else if (agg.group === "auto" && vService === 0 && calcState2.atpVolumeManual) {
      vService = roundL(calcState2.atpVolumeManual);
      overrideUsed = true;
    }
    if (agg.group === "auto" && vService === 0) {
      return {
        needsVolume: true,
        costs: [],
        vCalc: 0,
        formula: "",
        volumeStr: "—",
        vService,
        motulVol,
        overrideUsed
      };
    }
    let vCalc, formula, volumeStr;
    if (agg.group === "auto") {
      if (calcState2.atpType === "full") {
        const mult = 1.5;
        const vRaw = roundL(vService * mult);
        vCalc = Math.max(12, Math.ceil(vRaw));
        formula = `${vService}×${mult}=${vRaw.toFixed(2)}л → ${vCalc}л (мин 12)`;
        volumeStr = `полн: ${vCalc}л`;
      } else {
        const mult = isCvt ? 0.8 : 0.6;
        const vRaw = roundL(vService * mult);
        vCalc = Math.max(4, Math.round(vRaw * 10) / 10);
        formula = `${vService}×${mult}=${vRaw.toFixed(2)}л → ${vCalc}л (мин 4)`;
        volumeStr = `част: ${vCalc}л`;
      }
    } else {
      vCalc = vService;
      formula = vFilter ? `${v0} + ${vFilter} (фильтр) = ${vService}л` : `${vService}л`;
      volumeStr = `${vService}л`;
    }
    let oil1, oil2;
    if (agg.group === "engine") {
      const picks = pickEngineOils(agg, shopOils, calcState2, carApprovals);
      oil1 = picks.mid;
      oil2 = picks.spot;
      const overrideKey = (calcState2.oilOverride || {})[agg.key + "_mid"];
      if (overrideKey) {
        const found = (agg.allCandidates || []).find((o) => o.b + "_" + o.n === overrideKey);
        if (found) oil1 = found;
      }
    } else if (agg.group === "auto") {
      if (isCvt) {
        if (calcState2.cvtAtfSp3) {
          oil1 = defaults.atf.rolfMulti;
          oil2 = null;
        } else {
          oil1 = defaults.cvt[0];
          oil2 = defaults.cvt[1];
        }
      } else {
        const picked = pickAtfOils(agg.approvals || [], defaults.atf);
        oil1 = picked.oil1;
        oil2 = picked.oil2;
        agg.atfWarn = picked.noMatch;
      }
    } else {
      const mkppWarn = manualOilWarn(agg);
      if (mkppWarn) {
        agg.mkppWarn = mkppWarn;
        return {
          mkppWarn,
          costs: [],
          vCalc,
          formula,
          volumeStr,
          vService,
          motulVol,
          overrideUsed
        };
      }
      agg.mkppWarn = null;
      const isCvtGear = agg.rawText && /CVT/i.test(agg.rawText);
      const defs = isCvtGear ? defaults.cvt : defaults.gear75W90;
      oil1 = defs[0];
      oil2 = defs[1];
    }
    const calcFlushCost = (vol) => {
      if (calcState2.flush === "5min") {
        return { cost: 1180, breakdown: "630 (промыв.масло) + 550 (услуга)", label: "5-минутка" };
      }
      if (calcState2.flush === "full") {
        const litres = +(vol * 0.9).toFixed(1);
        const oilCost = Math.round(litres * 350);
        return { cost: oilCost + 550, breakdown: `${litres}л × 350 + 550 (услуга)`, label: "полная промывка" };
      }
      return null;
    };
    const flush = calcFlushCost(vCalc);
    const costs = [oil1, oil2].filter(Boolean).map((oil) => {
      const price = oil.price;
      let total, breakdown;
      if (agg.group === "engine") {
        const fTotal = filtersTotal(calcState2);
        const flushAdd = flush ? flush.cost : 0;
        total = price * vCalc + fTotal + flushAdd;
        const parts = [`${price} × ${vCalc}`];
        if (fTotal > 0) parts.push(`${fTotal} (фильтра)`);
        if (flush) parts.push(`${flush.cost} (${flush.label})`);
        breakdown = parts.join(" + ");
      } else if (agg.group === "auto") {
        const isPartial = calcState2.atpType === "partial";
        const baseLabor = 550 + (isPartial ? 1210 : 0);
        const laborParts = ["550"];
        if (isPartial) laborParts.push("1210");
        if (isCvt) {
          const fltC = calcState2.cvtFilterCoarse ? 1700 : 0;
          const fltF = calcState2.cvtFilterFine ? 3350 : 0;
          total = price * vCalc + baseLabor + fltC + fltF;
          const fltParts = [];
          if (fltC) fltParts.push("1700 грубый");
          if (fltF) fltParts.push("3350 тонкий");
          breakdown = `${price} × ${vCalc} + ${laborParts.join(" + ")}${fltParts.length ? " + " + fltParts.join(" + ") : ""}`;
        } else {
          const flt = calcState2.atpFilter ? 1700 : 0;
          total = price * vCalc + baseLabor + flt;
          breakdown = `${price} × ${vCalc} + ${laborParts.join(" + ")}${flt ? " + 1700 (фильтр)" : ""}`;
        }
      } else {
        const labor = 1900 + 550;
        total = price * vCalc + labor;
        breakdown = `${price} × ${vCalc} + 1900 + 550`;
      }
      return { oil, total: Math.round(total), breakdown };
    });
    if (agg.group === "engine") costs.sort((a, b) => a.total - b.total);
    return { costs, vCalc, formula, volumeStr, vService, motulVol, overrideUsed, flush };
  }
  function totalAggLabel(agg) {
    if (agg.labelOverride && agg.label) return agg.label.toLowerCase();
    if (agg.key === "engine") return "двс";
    if (agg.key === "automatic") return agg.isCvt ? "вариатор" : "акпп";
    if (agg.key === "manual") return "мкпп";
    if (agg.key === "transfer") return "раздатка";
    if (agg.key === "diffFront") return "диф.перед";
    if (agg.key === "diffRear") return "диф.зад";
    return (agg.label || agg.key).toLowerCase();
  }
  var totalOilLabel = (oil) => `${oil.b} ${oil.n}`;
  function computeTotalSum(tot, aggData) {
    let sum = 0, hasEngine = false;
    for (const { agg, calc } of aggData) {
      const sel = tot[agg.key];
      if (sel === void 0 || sel === "skip") continue;
      const c = calc.costs[sel];
      if (!c) continue;
      sum += c.total;
      if (agg.key === "engine") hasEngine = true;
    }
    return { sum, hasEngine };
  }

  // shared/report.js
  function formatAggText(agg, calc, calcState2) {
    const lines = [];
    const mileage = calcState2.mileage;
    const isFixedSingle = mileage === ">=200";
    const is0w20 = mileage === "0w20" || mileage === "0w30";
    if (agg.group === "engine") {
      const v0 = roundL(parseFloat(agg.volume || 0));
      const vFilter = roundL(parseFloat(agg.filterVolume || 0));
      const vService = roundL(v0 + vFilter);
      lines.push(`двс (${vService || calc.vCalc}л)`);
      const f = calcState2.filters;
      if (f.vf.enabled && f.vf.name && f.vf.price) {
        const workLbl = f.vf.work === 350 ? "защёлки" : f.vf.work === 600 ? "болты" : "разбор";
        lines.push(`вф ${f.vf.name} - ${f.vf.price}₽ (${workLbl} ${f.vf.work}₽)`);
      }
      if (f.mf.enabled && f.mf.name && f.mf.price) {
        lines.push(`мф ${f.mf.name} - ${f.mf.price}₽`);
      }
      if (f.sf.enabled && f.sf.name && f.sf.price) {
        const workLbl = f.sf.work === 550 ? "бардачок" : "под педалью";
        lines.push(`сф ${f.sf.name} - ${f.sf.price}₽ (${workLbl} ${f.sf.work}₽)`);
      }
      if (calcState2.flush === "5min") {
        lines.push(`промывка двс (5-минутка) - 1180₽ (630 + 550 услуга)`);
      } else if (calcState2.flush === "full") {
        const litres = +(calc.vCalc * 0.9).toFixed(1);
        const oilCost = Math.round(litres * 350);
        lines.push(`промывка двс (полная) - ${oilCost + 550}₽ (${litres}л × 350₽ + 550 услуга)`);
      }
      if (lines.length > 1) lines.push("");
      if (isFixedSingle) {
        calc.costs.slice(0, 1).forEach((c) => {
          const sumpLine = calcState2.showWithSump ? ` + 550₽ (снятие/установка защиты картера) = ${c.total + 550}₽` : "";
          lines.push(`${c.oil.b} ${c.oil.n} ${c.oil.price}₽/л = ${c.total}₽${sumpLine}`);
        });
      } else if (is0w20) {
        calc.costs.forEach((c) => {
          const sumpLine = calcState2.showWithSump ? ` + 550₽ (снятие/установка защиты картера) = ${c.total + 550}₽` : "";
          lines.push(`${c.oil.b} ${c.oil.n} ${c.oil.price}₽/л = ${c.total}₽${sumpLine}`);
        });
      } else {
        calc.costs.forEach((c) => {
          const base = `${c.oil.b} ${c.oil.n} ${c.oil.price}₽/л = ${c.total}₽`;
          const sumpLine = calcState2.showWithSump ? ` + 550₽ (снятие/установка защиты картера) = ${c.total + 550}₽` : " + 550₽ (снятие/установка защиты картера)";
          lines.push(base + sumpLine);
        });
      }
    } else if (agg.group === "auto") {
      const isCvt = agg.isCvt;
      const isPartial = calcState2.atpType === "partial";
      const typeTxt = isPartial ? "част" : "полн";
      const pct = !isPartial ? "150%" : isCvt ? "80%" : "60%";
      const vService = roundL(parseFloat(agg.volume || 0) + parseFloat(agg.filterVolume || 0)) || roundL((calcState2.volumeOverride || {})[agg.key]) || roundL(calcState2.atpVolumeManual) || 0;
      const label = isCvt ? "вариатор" : "акпп";
      const sp3Note = isCvt && calcState2.cvtAtfSp3 ? ", ATF SP-III" : "";
      lines.push(`${label} (серв ${vService}л${sp3Note})`);
      const extras = [];
      if (isPartial) extras.push("работа 1210₽");
      if (isCvt) {
        if (calcState2.cvtFilterCoarse) extras.push("фильтр грубый 1700₽");
        if (calcState2.cvtFilterFine) extras.push("фильтр тонкий 3350₽");
      } else {
        if (calcState2.atpFilter) extras.push("фильтр 1700₽");
      }
      const extraTxt = extras.length ? " + " + extras.join(" + ") : "";
      lines.push(`${typeTxt} (${calc.vCalc}л / ${pct})${extraTxt}`);
      if (!isCvt && agg.atfWarn) lines.push("подходящих масел в наличии нет — перевести на мастера");
      calc.costs.forEach((c) => lines.push(`${c.oil.b} ${c.oil.n} ${c.oil.price}₽/л = ${c.total}₽`));
    } else {
      const vService = (parseFloat(agg.volume || 0) + parseFloat(agg.filterVolume || 0)).toFixed(1);
      lines.push(`${agg.label.toLowerCase()} (${vService}л)`);
      if (calc.mkppWarn) lines.push(manualWarnText(calc.mkppWarn));
      calc.costs.forEach((c) => lines.push(`${c.oil.b} ${c.oil.n} ${c.oil.price}₽/л = ${c.total}₽`));
    }
    return lines.join("\n");
  }
  function buildTotalsLines(calcState2, data, carApprovals) {
    if (!calcState2 || !calcState2.totals || !calcState2.totals.length) return [];
    const aggs = getAggregates(data).filter((a) => calcState2.selected.has(a.key));
    const aggData = aggs.map((agg) => ({ agg, calc: calcForAggregate(agg, calcState2, carApprovals) })).filter((x) => x.calc.costs && x.calc.costs.length);
    const lines = [];
    for (const tot of calcState2.totals) {
      const parts = [];
      let sum = 0;
      let hasEngine = false;
      for (const { agg, calc } of aggData) {
        const sel = tot[agg.key];
        if (sel === void 0 || sel === "skip") continue;
        const c = calc.costs[sel];
        if (!c) continue;
        parts.push(`${c.total}(${totalAggLabel(agg)} ${totalOilLabel(c.oil)})`);
        sum += c.total;
        if (agg.key === "engine") hasEngine = true;
      }
      if (!parts.length) continue;
      if (calcState2.showWithSump && hasEngine) {
        lines.push(`${parts.join(" + ")} + 550(снятие/установка защиты картера) = ${sum + 550}₽`);
      } else {
        lines.push(`${parts.join(" + ")} = ${sum}₽`);
      }
    }
    return lines;
  }
  function buildReport(car, data, calcState2, carApprovals) {
    const aggs = getAggregates(data);
    const parts = [];
    const carParts = [];
    if (car.makeShort) carParts.push(car.makeShort);
    if (car.modelShort) carParts.push(car.modelShort);
    if (car.volume) carParts.push(car.volume + "л");
    if (car.yearFrom) carParts.push(String(car.yearFrom));
    const hp = car.bhp || (car.kw ? Math.round(parseFloat(car.kw) * 1.35962) : "");
    if (hp) carParts.push(hp + "лс");
    const carLine = carParts.join(" ");
    if (carLine) parts.push(carLine);
    for (const agg of aggs) {
      if (!calcState2.selected.has(agg.key)) continue;
      const calc = calcForAggregate(agg, calcState2, carApprovals);
      if (calc.isHighGear) {
        parts.push(`${agg.label} - послан в баню!`);
        continue;
      }
      parts.push(formatAggText(agg, calc, calcState2));
    }
    const totalsLines = buildTotalsLines(calcState2, data, carApprovals);
    if (totalsLines.length) parts.push(totalsLines.join("\n"));
    return parts.join("\n\n") || "— выберите агрегаты для подсчёта —";
  }

  // shared/serviceFlags.js
  var SERVICE_FLAGS = {
    atNoFull: { label: "АКПП полную не делаем", warn: true },
    noSumpFilter: { label: "Фильтра в поддоне нет", warn: false },
    dctNoService: { label: "Этому роботу расчёт не делаем", warn: true },
    cvtNoService: { label: "Этому вариатору расчёт не делаем", warn: true }
  };

  // shared/sourceLinks.js
  var SOURCE_SITES = ["mann", "lynx", "ravenol", "motul", "lukoil"];
  var SOURCE_LABELS = {
    mann: "Mann-Filter",
    lynx: "LYNXauto",
    ravenol: "Ravenol",
    motul: "Motul",
    lukoil: "ЛУКОЙЛ"
  };
  function detectSite(url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    const h = u.hostname.toLowerCase();
    if (h.includes("mann-filter.com")) return "mann";
    if (h.includes("lynxauto.info")) return "lynx";
    if (h.includes("ravenol.ru")) return "ravenol";
    if (h.includes("motul.lubricantadvisor.com")) return "motul";
    if (h.includes("lukoil.lubribase.ru")) return "lukoil";
    return null;
  }
  function normPart(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/\+/g, " ").replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  }
  function sourceSignature(url) {
    const site = detectSite(url);
    if (!site) return null;
    let u;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    const p = u.searchParams;
    if (site === "mann") {
      const id = p.get("vehicleTypeId") || p.get("modelTypeId");
      const digits = (id || "").replace(/\D/g, "").replace(/^0+/, "");
      if (digits) return "mann:type:" + digits;
      const parts = [
        p.get("vehicleMake"),
        p.get("vehicleModel"),
        p.get("ccm"),
        p.get("kw"),
        p.get("engineCode")
      ].map(normPart).filter(Boolean);
      return parts.length ? "mann:" + parts.join(":") : null;
    }
    if (site === "lynx") {
      const parts = [p.get("vendor"), p.get("car"), p.get("modification")].map(normPart).filter(Boolean);
      return parts.length ? "lynx:" + parts.join(":") : null;
    }
    if (site === "ravenol") {
      const path = normPart(u.pathname);
      return path ? "ravenol:" + path : null;
    }
    if (site === "lukoil") {
      const parts = [p.get("manufacturer_id"), p.get("engine_volume")].map(normPart).filter(Boolean);
      return parts.length ? "lukoil:" + parts.join(":") : null;
    }
    return null;
  }
  function buildSourceKeys(sourceLinks) {
    if (!sourceLinks || typeof sourceLinks !== "object") return [];
    const keys = /* @__PURE__ */ new Set();
    for (const url of Object.values(sourceLinks)) {
      const sig = sourceSignature(url);
      if (sig) keys.add(sig);
    }
    return [...keys];
  }
  function cleanSourceLinks(sourceLinks) {
    const out = {};
    if (!sourceLinks || typeof sourceLinks !== "object") return out;
    for (const site of SOURCE_SITES) {
      const url = sourceLinks[site];
      if (typeof url === "string" && url.trim()) out[site] = url.trim();
    }
    return out;
  }

  // userscript/src/parsers.js
  function parseMannUrl() {
    if (location.hostname.includes("lynxauto.info")) {
      return parseLynxUrl();
    }
    const p = new URLSearchParams(location.search);
    if (!p.get("vehicleMake") && !p.get("vehicleModel")) return null;
    const make = (p.get("vehicleMake") || "").trim();
    const model = (p.get("vehicleModel") || "").replace(/\+/g, " ").trim();
    const engineCode = (p.get("engineCode") || "").replace(/\+/g, " ").trim();
    const fuelType = (p.get("fuelType") || "").trim();
    const ccm = parseInt(p.get("ccm") || "0") || null;
    const kw = parseInt(p.get("kw") || "0") || null;
    const bhp = parseInt(p.get("bhp") || "0") || null;
    const yMatch = (p.get("vehicleManufacturedFrom") || "").match(/(\d{4})/);
    const yearFrom = yMatch ? parseInt(yMatch[1]) : null;
    const makeShort = make.split(/\s+/)[0];
    const modelShort = model.replace(/\([^)]*\)/g, " ").replace(/[()]/g, " ").replace(/\s{2,}/g, " ").trim().split(/\s+/).slice(0, 3).join(" ");
    const volume = ccm ? (Math.round(ccm / 100) / 10).toFixed(1) : "";
    const query = [makeShort, modelShort, volume].filter(Boolean).join(" ").toLowerCase();
    const cacheKey = [makeShort, modelShort, volume, kw, engineCode, yearFrom].filter(Boolean).join("_").toLowerCase().replace(/\s+/g, "");
    return {
      make,
      model,
      makeShort,
      modelShort,
      engineCode,
      fuelType,
      ccm,
      kw,
      bhp,
      yearFrom,
      volume,
      query,
      cacheKey
    };
  }
  function parseLynxUrl() {
    const p = new URLSearchParams(location.search);
    const vendor = (p.get("vendor") || "").trim();
    const car = (p.get("car") || "").replace(/\+/g, " ").trim();
    const yearRaw = (p.get("year") || "").replace(/\+/g, " ").trim();
    const mod = (p.get("modification") || "").replace(/\+/g, " ").trim();
    const power = (p.get("power_engine") || "").replace(/\+/g, " ").trim();
    if (!vendor || !car) return null;
    let engineCode = "", engineName = mod;
    const ecMatch = mod.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (ecMatch) {
      engineName = ecMatch[1].trim();
      engineCode = ecMatch[2].trim();
    }
    let yearFrom = null;
    const yMatch = yearRaw.match(/(\d{1,2})\/(\d{2,4})/);
    if (yMatch) {
      let y = parseInt(yMatch[2]);
      if (y < 100) y += y < 50 ? 2e3 : 1900;
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
    const modelClean = car.replace(/\([^)]*\)/g, " ").replace(/\s+\d{1,2}[\/\-]\d{0,4}-?\s*$/g, "").replace(/\s+\d{1,2}-\s*$/g, "").replace(/[-\s]+$/g, "").replace(/\s{2,}/g, " ").trim();
    let volume = "";
    const skipVolume = /^(BMW|MERCEDES|MERCEDES-BENZ)$/i.test(vendor);
    if (!skipVolume) {
      const volMatch = engineName.match(/(\d\.\d)/);
      if (volMatch) volume = volMatch[1];
    }
    const make = vendor;
    const makeShort = make.split(/\s+/)[0];
    const modelShort = modelClean.split(/\s+/).slice(0, 3).join(" ") || car;
    const queryParts = [makeShort, modelShort];
    if (engineName) queryParts.push(engineName);
    else if (volume) queryParts.push(volume);
    const query = queryParts.filter(Boolean).join(" ").toLowerCase();
    const cacheKey = [makeShort, modelShort, volume, kw, engineCode, yearFrom].filter(Boolean).join("_").toLowerCase().replace(/\s+/g, "");
    let fuelType = "";
    const allText = (engineName + " " + engineCode).toUpperCase();
    if (/\bD\b|DCI|TDI|HDI|CDI|CRDI|TDCI|TDDI|JTD|MULTIJET|DTI|CTDI|D-?4D|SDI|\bTD\b/i.test(allText)) {
      fuelType = "05";
    }
    return {
      make,
      model: car,
      makeShort,
      modelShort,
      engineCode,
      engineName,
      fuelType,
      ccm: null,
      kw,
      bhp,
      yearFrom,
      volume,
      query,
      cacheKey
    };
  }

  // userscript/src/oil-calculator/app.js
  var DB_API_BASE = "https://cars-db-backend.onrender.com";
  var DB_API_KEY = "a56817cfece2ca6ad4bfdf7c2a7b83e1df99184d09daf574";
  var DB_SITE_URL = "https://alwaysnevereat.github.io/scripts";
  function currentCarApprovals() {
    const car = calcState && calcState.car;
    if (!car) return [];
    const v = GM_getValue("rolf_approvals_" + car.cacheKey, null);
    return Array.isArray(v) ? v : [];
  }
  function recordSourceLink(cacheKey, site, url) {
    if (!cacheKey || !site || !url) return;
    const k = "zm_sources_" + cacheKey;
    const cur = GM_getValue(k, null);
    const obj = cur && typeof cur === "object" && !Array.isArray(cur) ? cur : {};
    if (obj[site] === url) return;
    obj[site] = url;
    GM_setValue(k, obj);
  }
  function getSourceLinks(cacheKey) {
    if (!cacheKey) return {};
    const v = GM_getValue("zm_sources_" + cacheKey, null);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  }
  function pickEngineOils2(agg, shopOils) {
    return pickEngineOils(agg, shopOils, calcState, currentCarApprovals());
  }
  function rerenderResult() {
    const el = document.getElementById("zm-result");
    if (!el) return;
    el.textContent = buildReport(calcState.car, calcState.data, calcState, currentCarApprovals());
  }
  function getStoredToken() {
    return GM_getValue("zm_session_token", null);
  }
  function setStoredToken(t) {
    if (t) GM_setValue("zm_session_token", t);
    else GM_deleteValue("zm_session_token");
  }
  function dbRequest(method, path, body) {
    return new Promise((resolve, reject) => {
      const headers = {
        "Content-Type": "application/json",
        "x-api-key": DB_API_KEY
      };
      const token = getStoredToken();
      if (token) headers["Authorization"] = "Bearer " + token;
      GM_xmlhttpRequest({
        method,
        url: DB_API_BASE + path,
        headers,
        data: body ? JSON.stringify(body) : void 0,
        timeout: 15e3,
        onload: (resp) => {
          let json = null;
          try {
            json = JSON.parse(resp.responseText);
          } catch {
          }
          if (resp.status >= 200 && resp.status < 300) resolve(json);
          else {
            const err = new Error(json && json.error || "HTTP " + resp.status);
            err.status = resp.status;
            reject(err);
          }
        },
        onerror: () => reject(new Error("сеть недоступна (" + DB_API_BASE + ")")),
        ontimeout: () => reject(new Error("таймаут запроса"))
      });
    });
  }
  async function dbLogin(login, password) {
    const resp = await dbRequest("POST", "/api/auth/login", { login, password });
    setStoredToken(resp.token);
    return resp.user;
  }
  function openLoginModal() {
    return new Promise((resolve) => {
      const old = document.getElementById("zm-login-modal");
      if (old) old.remove();
      const modal = document.createElement("div");
      modal.id = "zm-login-modal";
      modal.innerHTML = `
            <div class="zm-db-backdrop"></div>
            <div class="zm-db-win" style="width:340px">
                <div class="zm-db-head">
                    <span>🔐 Вход для отправки отчёта</span>
                    <button class="zm-btn zm-btn-sec" id="zm-login-close">✕</button>
                </div>
                <div class="zm-db-body">
                    <label class="zm-db-field"><span>Логин</span>
                        <input type="text" id="zm-login-login" autocomplete="username"/>
                    </label>
                    <label class="zm-db-field" style="margin-top:8px"><span>Пароль</span>
                        <input type="password" id="zm-login-password" autocomplete="current-password"/>
                    </label>
                    <div id="zm-login-error" class="zm-db-error" style="display:none"></div>
                </div>
                <div class="zm-db-foot">
                    <button class="zm-btn zm-btn-sec" id="zm-login-cancel">Отмена</button>
                    <button class="zm-btn zm-btn-pri" id="zm-login-submit">Войти</button>
                </div>
            </div>
        `;
      document.body.appendChild(modal);
      const finish = (ok) => {
        modal.remove();
        resolve(ok);
      };
      modal.querySelector(".zm-db-backdrop").onclick = () => finish(false);
      document.getElementById("zm-login-close").onclick = () => finish(false);
      document.getElementById("zm-login-cancel").onclick = () => finish(false);
      const submit = async () => {
        const btn = document.getElementById("zm-login-submit");
        const errBox = document.getElementById("zm-login-error");
        const login = document.getElementById("zm-login-login").value.trim();
        const password = document.getElementById("zm-login-password").value;
        if (!login || !password) {
          errBox.textContent = "Заполните логин и пароль";
          errBox.style.display = "block";
          return;
        }
        errBox.style.display = "none";
        btn.disabled = true;
        btn.textContent = "Входим…";
        try {
          await dbLogin(login, password);
          finish(true);
        } catch (e) {
          errBox.textContent = "⚠ " + e.message;
          errBox.style.display = "block";
          btn.disabled = false;
          btn.textContent = "Войти";
        }
      };
      document.getElementById("zm-login-submit").onclick = submit;
      document.getElementById("zm-login-password").addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      });
    });
  }
  async function ensureLoggedIn() {
    if (getStoredToken()) return true;
    return await openLoginModal();
  }
  function snapshotRecommendedOils() {
    const engineAgg = getAggregates(calcState.data).find((a) => a.group === "engine");
    if (!engineAgg) return [];
    const picks = pickEngineOils2(engineAgg, getShopOils());
    const strip = (o) => o ? { b: o.b, n: o.n, price: o.price, v: o.v } : null;
    return [
      ...(engineAgg.topCandidates || []).map(strip),
      ...picks.spot ? [strip(picks.spot)] : []
    ].filter(Boolean);
  }
  function openDbModal(car) {
    const old = document.getElementById("zm-db-modal");
    if (old) old.remove();
    const aggs = getAggregates(calcState.data);
    const approvals = currentCarApprovals();
    const f = calcState.filters || {};
    const idField = (key, label, value, hint) => `
        <label class="zm-db-field">
            <span>${label}</span>
            <input type="text" data-db-field="${key}" value="${escapeHtmlSafe(value == null ? "" : String(value))}" placeholder="${hint || ""}"/>
        </label>`;
    const aggRow = (agg) => {
      const vol = roundL(parseFloat(agg.volume || 0) + parseFloat(agg.filterVolume || 0)) || roundL((calcState.volumeOverride || {})[agg.key]) || "";
      const products = (agg.motulProducts || agg.approvals || []).slice(0, 6).map((p) => `<span class="zm-db-chip">${escapeHtml(p)}</span>`).join("");
      return `
            <div class="zm-db-agg-row">
                <span class="zm-db-agg-lbl">${escapeHtml(agg.label)}</span>
                <input type="number" step="0.1" min="0" data-db-vol="${agg.key}" value="${vol}" placeholder="?"/>
                <span class="zm-db-agg-l">л</span>
                <div class="zm-db-agg-products">${products}</div>
            </div>`;
    };
    const filterRow = (key, label) => {
      const fd = f[key] || {};
      const absent = fd.name === "[нет]";
      const part = absent ? "" : fd.name || "";
      return `
            <div class="zm-db-filter-row">
                <span class="zm-db-agg-lbl">${label}</span>
                <input type="text" data-db-filter="${key}" value="${escapeHtmlSafe(part)}" placeholder="артикул" ${absent ? "disabled" : ""}/>
                <label class="zm-db-chk"><input type="checkbox" data-db-filter-absent="${key}" ${absent ? "checked" : ""}/> отсутствует</label>
            </div>`;
    };
    const flagRows = Object.entries(SERVICE_FLAGS).map(([key, def]) => `
        <label class="zm-db-chk zm-db-flag"><input type="checkbox" data-db-flag="${key}"/> ${escapeHtml(def.label)}</label>
    `).join("");
    const savedLinks = getSourceLinks(car.cacheKey);
    const sourceRows = SOURCE_SITES.map((site) => `
        <label class="zm-db-field">
            <span>${escapeHtml(SOURCE_LABELS[site])}</span>
            <input type="url" data-db-source="${site}" value="${escapeHtmlSafe(savedLinks[site] || "")}" placeholder="ссылка на страницу машины"/>
        </label>`).join("");
    const modal = document.createElement("div");
    modal.id = "zm-db-modal";
    modal.innerHTML = `
        <div class="zm-db-backdrop"></div>
        <div class="zm-db-win">
            <div class="zm-db-head">
                <span>📤 Отправить отчёт в базу машин</span>
                <button class="zm-btn zm-btn-sec" id="zm-db-close">✕</button>
            </div>
            <div class="zm-db-body">
                <div class="zm-db-note">Проверь данные перед отправкой — они попадут на сайт для всех.</div>

                <div class="zm-db-sec-h">Машина</div>
                <div class="zm-db-grid">
                    ${idField("brand", "Марка *", car.makeShort)}
                    ${idField("model", "Модель *", car.modelShort)}
                    ${idField("engine_name", "Двигатель", car.engineName)}
                    ${idField("engine_code", "Код двиг.", car.engineCode)}
                    ${idField("engine_volume", "Объём, л", car.volume)}
                    ${idField("year_from", "Год с *", car.yearFrom)}
                    ${idField("kw", "кВт", car.kw)}
                    ${idField("bhp", "л.с.", car.bhp)}
                    <label class="zm-db-field">
                        <span>Топливо *</span>
                        <select data-db-field="fuel_type">${fuelSelectOptions(car.fuelType)}</select>
                    </label>
                </div>

                <div class="zm-db-sec-h">Объёмы жидкостей (Motul)</div>
                ${aggs.length ? aggs.map(aggRow).join("") : '<div class="zm-db-note">нет данных — сначала найди машину на Motul</div>'}

                <div class="zm-db-sec-h">Допуски масла (ROLF) — по одному в строке</div>
                <textarea id="zm-db-approvals" rows="3" placeholder="MB 229.5&#10;VW 502 00">${escapeHtml(approvals.join("\n"))}</textarea>

                <div class="zm-db-sec-h">Фильтры ДВС</div>
                ${filterRow("vf", "вф (масляный)")}
                ${filterRow("mf", "мф (воздушный)")}
                ${filterRow("sf", "сф (салонный)")}

                <div class="zm-db-sec-h">Особенности обслуживания</div>
                ${flagRows}

                <div class="zm-db-sec-h">Страницы машины (сурс-ссылки)</div>
                <div class="zm-db-note">Кнопки на странице машины + по ним нотификатор находит эту машину у коллег.</div>
                <div class="zm-db-grid">${sourceRows}</div>

                <div class="zm-db-sec-h">Заметка (необязательно)</div>
                <textarea id="zm-db-notes" rows="2" placeholder="например: сливная пробка под квадрат 8мм"></textarea>

                <div id="zm-db-error" class="zm-db-error" style="display:none"></div>
            </div>
            <div class="zm-db-foot">
                <button class="zm-btn zm-btn-sec" id="zm-db-cancel">Отмена</button>
                <button class="zm-btn zm-btn-pri" id="zm-db-submit">📤 Отправить</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector(".zm-db-backdrop").onclick = close;
    document.getElementById("zm-db-close").onclick = close;
    document.getElementById("zm-db-cancel").onclick = close;
    modal.querySelectorAll("[data-db-filter-absent]").forEach((chk) => {
      chk.onchange = () => {
        const inp = modal.querySelector(`[data-db-filter="${chk.dataset.dbFilterAbsent}"]`);
        inp.disabled = chk.checked;
        if (chk.checked) inp.value = "";
      };
    });
    document.getElementById("zm-db-submit").onclick = async () => {
      const btn = document.getElementById("zm-db-submit");
      const errBox = document.getElementById("zm-db-error");
      const field = (k) => modal.querySelector(`[data-db-field="${k}"]`);
      const val = (k) => field(k) ? field(k).value.trim() : "";
      const fluid = JSON.parse(JSON.stringify(calcState.data || {}));
      delete fluid.motulName;
      for (const agg of aggs) {
        const inp = modal.querySelector(`[data-db-vol="${agg.key}"]`);
        const v = inp ? parseFloat(inp.value) : NaN;
        if (!isFinite(v) || v <= 0 || !fluid[agg.key]) continue;
        if (agg.key === "engine") fluid.engine.volumeService = v;
        else fluid[agg.key].volumeTotal = v;
      }
      const filters = {};
      for (const key of ["vf", "mf", "sf"]) {
        const absent = modal.querySelector(`[data-db-filter-absent="${key}"]`).checked;
        const part = modal.querySelector(`[data-db-filter="${key}"]`).value.trim();
        filters[key] = absent ? { part: null, absent: true } : { part, absent: false };
      }
      const flags = {};
      modal.querySelectorAll("[data-db-flag]").forEach((chk) => {
        if (chk.checked) flags[chk.dataset.dbFlag] = true;
      });
      const sourceLinks = {};
      modal.querySelectorAll("[data-db-source]").forEach((inp) => {
        const url = inp.value.trim();
        if (url) sourceLinks[inp.dataset.dbSource] = url;
      });
      const cleanedLinks = cleanSourceLinks(sourceLinks);
      const fuelSel = val("fuel_type");
      car.fuelType = fuelSel;
      if (calcState.car) calcState.car.fuelType = fuelSel;
      const payload = {
        brand: val("brand"),
        model: val("model"),
        engine_name: val("engine_name") || null,
        engine_code: val("engine_code") || null,
        engine_volume: parseFloat(val("engine_volume")) || null,
        year_from: parseInt(val("year_from")) || null,
        kw: parseInt(val("kw")) || null,
        bhp: parseInt(val("bhp")) || null,
        fuel_type: fuelSel || null,
        motul_name: calcState.data && calcState.data.motulName || null,
        fluid_capacities: fluid,
        filter_part_numbers: filters,
        car_approvals: document.getElementById("zm-db-approvals").value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
        recommended_oils: snapshotRecommendedOils(),
        service_flags: flags,
        source_links: cleanedLinks,
        source_keys: buildSourceKeys(cleanedLinks),
        notes: document.getElementById("zm-db-notes").value.trim() || null
        // created_by сервер берёт из сессии залогиненного пользователя —
        // клиентское значение игнорируется (см. backend/src/routes/cars.js).
      };
      errBox.style.display = "none";
      if (!await ensureLoggedIn()) return;
      btn.disabled = true;
      btn.textContent = "⏳ отправка…";
      try {
        let resp;
        try {
          resp = await dbRequest("POST", "/api/cars", payload);
        } catch (e) {
          if (e.status === 401) {
            setStoredToken(null);
            if (!await openLoginModal()) throw new Error("вход отменён");
            resp = await dbRequest("POST", "/api/cars", payload);
          } else {
            throw e;
          }
        }
        close();
        showDbToast(resp);
      } catch (e) {
        errBox.textContent = "⚠ " + e.message;
        errBox.style.display = "block";
        btn.disabled = false;
        btn.textContent = "📤 Отправить";
      }
    };
  }
  function showDbToast(resp) {
    const old = document.getElementById("zm-db-toast");
    if (old) old.remove();
    const t = document.createElement("div");
    t.id = "zm-db-toast";
    const carUrl = `${DB_SITE_URL}/#/car/${resp.id}`;
    t.innerHTML = `
        <div class="zm-db-toast-t">✓ ${resp.created ? "Машина добавлена в базу" : "Машина обновлена в базе"}</div>
        <a href="${escapeHtmlSafe(carUrl)}" target="_blank" class="zm-db-toast-link">Открыть страницу машины ↗</a>
    `;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 12e3);
  }
  function renderCrmQuirks(agg) {
    const quirks = crmQuirksForAggregate(calcState.car, calcState.data, agg);
    if (!quirks.length) return "";
    return quirks.map((q) => `
        <div class="zm-quirk zm-quirk-${q.severity}">
            <span class="zm-quirk-tag">${escapeHtml(SEVERITY_LABELS[q.severity])}</span>
            <span>${escapeHtml(q.text)}${q.note ? `<span class="zm-quirk-note">${escapeHtml(q.note)}</span>` : ""}</span>
        </div>`).join("");
  }
  function calcForAggregate2(agg) {
    const calc = calcForAggregate(agg, calcState, currentCarApprovals());
    if (calc.isHighGear) return { isHighGear: true, html: "" };
    const motulVol = calc.motulVol;
    const currentVol = calc.overrideUsed ? calc.vService : motulVol || "";
    const volEditHtml = `
        <div class="zm-vol-edit">
            <span class="zm-ctrl-lbl">Объём:</span>
            <input type="number" step="0.1" min="0" class="zm-vol-input" data-vol-key="${agg.key}"
                value="${currentVol}" placeholder="${motulVol || "?"}"/>
            <span class="zm-ctrl-lbl">л ${motulVol ? `<span class="zm-vol-motul">(Motul: ${motulVol}л)</span>` : '<span class="zm-vol-motul zm-vol-warn">(Motul не дал)</span>'}</span>
            ${calc.overrideUsed ? `<button class="zm-vol-reset" data-vol-reset="${agg.key}" title="Сбросить к Motul">↺</button>` : ""}
        </div>
    `;
    if (calc.needsVolume) {
      return {
        html: `
                ${volEditHtml}
                <div class="zm-warn" style="padding:8px 10px;font-size:11px;background:#2a1d00;border:1px solid #E67E00;border-radius:6px;margin-top:6px;color:#ff9800">⚠ Введи объём заправки АКПП в поле выше — Motul не дал</div>
            `,
        costs: [],
        vCalc: 0,
        formula: "",
        volumeStr: "—",
        oils: []
      };
    }
    const { costs, vCalc, formula, volumeStr } = calc;
    const isCvt = agg.group === "auto" && agg.isCvt;
    const mileage = calcState.mileage;
    const isFixedSingle = mileage === ">=200";
    let flushBox = "";
    if (agg.group === "engine" && calc.flush) {
      if (calcState.flush === "5min") {
        flushBox = `
                <div class="zm-flush-box">
                    🧪 <b>5-минутка</b>:
                    <span class="zm-flush-formula">630₽ (промыв.масло, 1 бутылка фикс) + 550₽ (услуга)</span>
                    = <b class="zm-flush-total">${calc.flush.cost}₽</b>
                </div>
            `;
      } else if (calcState.flush === "full") {
        const litres = +(vCalc * 0.9).toFixed(1);
        const oilCost = Math.round(litres * 350);
        flushBox = `
                <div class="zm-flush-box">
                    🧪 <b>Полная промывка</b>:
                    <span class="zm-flush-formula">${vCalc}л × 0.9 = ${litres}л × 350₽/л = ${oilCost}₽ + 550₽ (услуга)</span>
                    = <b class="zm-flush-total">${calc.flush.cost}₽</b>
                </div>
            `;
      }
    }
    const spotOilForAdds = agg.group === "engine" ? costs.find((c) => c.oil && c.oil.isSpot) : null;
    const spotAddsLower = spotOilForAdds ? new Set((spotOilForAdds.oil.ad || []).map((a) => normalizeAdditive(a))) : /* @__PURE__ */ new Set();
    const atfWarnBox = agg.group === "auto" && !isCvt && agg.atfWarn ? `
        <div class="zm-warn" style="padding:8px 10px;font-size:11px;background:#2a0000;border:1px solid #e53935;border-radius:6px;margin-top:6px;color:#ff8a80">
            ⚠ Ни ZIC, ни ROLF не покрывают спецификации этой коробки — перевести клиента на мастера
        </div>` : "";
    const mkppWarnBox = calc.mkppWarn ? `
        <div class="zm-warn" style="padding:8px 10px;font-size:11px;background:#2a0000;border:1px solid #e53935;border-radius:6px;margin-top:6px;color:#ff8a80">
            ⚠ ${escapeHtmlSafe(manualWarnText(calc.mkppWarn))}
        </div>` : "";
    const spotWarnBox = agg.group === "engine" && agg.spotWarn ? `
        <div class="zm-warn" style="padding:8px 10px;font-size:11px;background:#2a1d00;border:1px solid #E67E00;border-radius:6px;margin-top:6px;color:#ff9800">
            ⚠ ${escapeHtmlSafe(agg.spotWarn)}
        </div>` : "";
    const html = `
        ${volEditHtml}
        <div class="zm-formula">📐 ${formula}</div>
        ${flushBox}
        ${atfWarnBox}${mkppWarnBox}${spotWarnBox}
        ${costs.map((c, i) => {
      const canPick = agg.group === "engine" && !c.oil.isSpot && !isFixedSingle && agg.allCandidates && agg.allCandidates.length > 1;
      const regMatches = agg.group === "engine" ? matchOilToReglament(c.oil, calcState.car?.makeShort) : [];
      const regBadge = regMatches.length ? `<button class="zm-reg-badge" data-reg-info="${escapeHtmlSafe(JSON.stringify(regMatches))}" title="Совпадение с регламентом — нажми">⭐ⓘ</button>` : "";
      const sumpSuffix = agg.group === "engine" ? calcState.showWithSump ? ` + 550₽ (снятие/установка защиты картера) = <b class="zm-oil-total zm-oil-total-sump">${c.total + 550}₽</b>` : " + 550₽ (снятие/установка защиты картера)" : "";
      let oilDetailsHtml = "";
      if (agg.group === "engine") {
        oilDetailsHtml = renderOilDetailsBlock(agg, c.oil, i, spotAddsLower);
      }
      return `
            <div class="zm-oil-line ${regMatches.length ? "zm-oil-line-reg" : ""}">
                <div class="zm-oil-name">
                    ${canPick ? `<button class="zm-oil-pick-btn" data-pick="${agg.key}">${c.oil.b} ${c.oil.n} ▾</button>` : `${c.oil.b} ${c.oil.n}`}
                    ${regBadge}
                </div>
                <div class="zm-oil-calc">${c.breakdown} = <b class="zm-oil-total">${c.total}₽</b>${sumpSuffix}</div>
                <div class="zm-oil-price">${c.oil.price}₽/л</div>
                ${oilDetailsHtml}
            </div>`;
    }).join("")}
        ${agg.group === "engine" && calcState.showOilPicker === agg.key && agg.allCandidates && !isFixedSingle ? `
            <div class="zm-oil-picker">
                <div class="zm-oil-picker-head">Выбери масло (${agg.allCandidates.length} подходящих):</div>
                ${agg.allCandidates.map((o) => {
      const cur = costs.find((c) => !c.oil.isSpot) || costs[0];
      const isCurrent = cur && cur.oil.b + "_" + cur.oil.n === o.b + "_" + o.n;
      const regOpt = matchOilToReglament(o, calcState.car?.makeShort);
      const regMark = regOpt.length ? '<span class="zm-reg-mark" title="по регламенту">⭐</span>' : "";
      const rk = (agg.ranked || []).find((r) => r.oil === o);
      let hitsMark = "";
      if (rk && (rk.direct.length || rk.hier.length)) {
        const tip = [
          ...rk.direct.map((t) => "совпал: " + t),
          ...rk.hier.map((h) => h.via + " покрывает " + h.covers)
        ].join("; ");
        hitsMark = `<span class="zm-oil-opt-hits" title="${escapeHtmlSafe(tip)}">✓${rk.direct.length ? " " + rk.direct.length : ""}${rk.hier.length ? " ⊃" + rk.hier.length : ""}</span>`;
      }
      if (rk && rk.classMiss) {
        hitsMark += `<span class="zm-oil-opt-miss" title="У масла нет требуемого класса ACEA ${escapeHtmlSafe(rk.classMiss)} — предлагать с осторожностью">⚠ не ${escapeHtmlSafe(rk.classMiss)}</span>`;
      }
      return `<button class="zm-oil-opt ${isCurrent ? "zm-oil-opt-act" : ""} ${regOpt.length ? "zm-oil-opt-reg" : ""}" data-opt="${o.b}_${o.n}">
                        <span class="zm-oil-opt-name">${regMark} ${o.b} ${o.n}${hitsMark}</span>
                        <span class="zm-oil-opt-price">${o.price}₽/л</span>
                    </button>`;
    }).join("")}
            </div>
        ` : ""}
    `;
    return { html, costs, vCalc, formula, volumeStr, oils: costs.map((c) => c.oil) };
  }
  var calcState = null;
  function routeByHost() {
    const HOST = location.hostname;
    if (HOST.includes("motul.lubricantadvisor.com")) {
      initMotul();
      return;
    }
    if (HOST.includes("rolfoil.ru") || HOST.includes("podbor.upec.pro")) {
      initRolf();
      return;
    }
    if (HOST.includes("mann-filter.com")) {
      initMann("mann");
      return;
    }
    if (HOST.includes("lynxauto.info")) {
      initMann("lynx");
      return;
    }
    if (HOST.includes("podbor.ravenol.ru")) {
      initMann("ravenol");
      return;
    }
  }
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c]);
  }
  function escapeHtmlSafe(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c]);
  }
  function initMann(source) {
    source = source || "mann";
    injectStyles();
    const widget = createWidget();
    let expanded = false;
    let lastRenderedKey = null;
    function getCar() {
      if (source === "ravenol") return buildRavenolCar();
      return parseMannUrl();
    }
    function render() {
      const car = getCar();
      if (!car) {
        widget.classList.remove("zm-full");
        const msg = source === "ravenol" ? "Откройте Ravenol с выбранным авто (страница /1-cars/.../)." : "Откройте Mann Filter с выбранным авто.";
        widget.innerHTML = shellHTML2(`<div class="zm-warn">${msg}</div>`);
        bindHeaderEvents2(null);
        return;
      }
      recordSourceLink(car.cacheKey, source, location.href);
      let cached;
      if (source === "ravenol") {
        cached = car._ravenolData;
        if (cached) GM_setValue("motul_car_" + car.cacheKey, cached);
      } else {
        cached = GM_getValue("motul_car_" + car.cacheKey, null);
      }
      if (expanded && !cached) expanded = false;
      if (expanded) {
        widget.classList.add("zm-full");
        widget.innerHTML = shellHTML2(renderCalculator(car, cached));
        bindHeaderEvents2(car);
        bindCalcEvents(car, cached);
      } else {
        widget.classList.remove("zm-full");
        widget.innerHTML = shellHTML2(renderTrayBody(car, cached));
        bindHeaderEvents2(car);
        bindTrayEvents(car);
      }
      lastRenderedKey = car.cacheKey + "|" + (cached ? "Y" : "N") + "|R" + (GM_getValue("rolf_approvals_" + car.cacheKey, null) || []).length + "|" + (expanded ? "E" : "T");
    }
    function renderTrayBody(car, cached) {
      const rolfApp = GM_getValue("rolf_approvals_" + car.cacheKey, null);
      const motulOk = !!cached;
      const rolfOk = !!(rolfApp && rolfApp.length);
      const status = `
                <div style="font-size:11px;line-height:1.7">
                    <div>${motulOk ? '✓ <span class="zm-ok">Motul</span>' : '<span class="zm-wait">○ Motul (объёмы)</span>'}</div>
                    <div>${rolfOk ? '✓ <span class="zm-ok">ROLF</span> (' + rolfApp.length + " допусков)" : '<span class="zm-wait">○ ROLF (допуски)</span>'}</div>
                </div>
            `;
      return `
                <div class="zm-car">
                    <div class="zm-car-t">${car.makeShort} ${car.modelShort}${car.engineName ? " " + car.engineName : car.volume ? " " + car.volume : ""}</div>
                    <div class="zm-car-sub">${car.engineCode || "?"} · ${car.kw || "?"}кВт · ${car.yearFrom || "?"}${fuelLabel(car.fuelType) ? " · " + fuelLabel(car.fuelType) : ""}</div>
                </div>
                <div class="zm-tray-status">${status}</div>
                <div class="zm-tray-btns" style="flex-direction:column;gap:4px">
                    ${!motulOk ? `<button class="zm-btn zm-btn-pri" id="zm-search">🔍 Найти на Motul</button>` : ""}
                    <button class="zm-btn zm-btn-sec" id="zm-rolf">📋 Допуски (ROLF)</button>
                    ${motulOk ? `<button class="zm-btn zm-btn-pri" id="zm-expand">📊 Развернуть</button>` : ""}
                    ${motulOk ? `<button class="zm-btn zm-btn-sec" id="zm-refresh" title="Переискать на Motul">↻ переискать Motul</button>` : ""}
                </div>
            `;
    }
    function shellHTML2(body) {
      const headerRight = expanded ? `<button class="zm-btn zm-btn-sec" id="zm-rolf-exp" title="Допуски ROLF">📋 ROLF</button>
                   <button class="zm-btn zm-btn-sec" id="zm-research" title="Переискать на Motul">↻</button>
                   <button class="zm-btn zm-btn-sec" id="zm-collapse">▸ свернуть</button>` : `<button class="zm-btn zm-btn-sec" id="zm-hide" title="Скрыть">−</button>`;
      return `
                <div class="zm-header">
                    <span class="zm-title">🛢 OIL WIDGET</span>
                    ${headerRight}
                </div>
                ${body}
            `;
    }
    function bindHeaderEvents2(car) {
      const collapseBtn = document.getElementById("zm-collapse");
      if (collapseBtn) collapseBtn.onclick = () => {
        expanded = false;
        render();
      };
      const researchBtn = document.getElementById("zm-research");
      if (researchBtn && car) researchBtn.onclick = () => {
        openMotulSearch(car);
      };
      const rolfExpBtn = document.getElementById("zm-rolf-exp");
      if (rolfExpBtn && car) rolfExpBtn.onclick = () => openRolfSearch(car);
      const hideBtn = document.getElementById("zm-hide");
      if (hideBtn) hideBtn.onclick = () => widget.classList.toggle("zm-hidden");
    }
    function bindTrayEvents(car) {
      const searchBtn = document.getElementById("zm-search");
      if (searchBtn) searchBtn.onclick = () => openMotulSearch(car);
      const rolfBtn = document.getElementById("zm-rolf");
      if (rolfBtn) rolfBtn.onclick = () => openRolfSearch(car);
      const expBtn = document.getElementById("zm-expand");
      if (expBtn) expBtn.onclick = () => {
        expanded = true;
        render();
      };
      const refBtn = document.getElementById("zm-refresh");
      if (refBtn) refBtn.onclick = () => {
        GM_deleteValue("motul_car_" + car.cacheKey);
        expanded = false;
        openMotulSearch(car);
        render();
      };
    }
    function openRolfSearch(car) {
      GM_setValue("zm_rolf_pending", JSON.stringify({
        key: car.cacheKey,
        ec: car.engineCode || "",
        ts: Date.now()
      }));
      GM_deleteValue("rolf_approvals_" + car.cacheKey);
      if (car.engineCode) {
        try {
          navigator.clipboard.writeText(car.engineCode).catch(() => {
          });
        } catch {
        }
      }
      window.open("https://rolfoil.ru/podbor/", "zm_rolf_search");
      showSearchHint({ ...car, searchSource: "ROLF" });
    }
    function openMotulSearch(car) {
      const carJson = encodeURIComponent(JSON.stringify({
        make: car.make || "",
        makeShort: car.makeShort || "",
        modelShort: car.modelShort || "",
        model: car.model || "",
        engineCode: car.engineCode || "",
        engineName: car.engineName || "",
        fuelType: car.fuelType || "",
        volume: car.volume || "",
        ccm: car.ccm || "",
        kw: car.kw || "",
        bhp: car.bhp || "",
        yearFrom: car.yearFrom || ""
      }));
      const url = `https://motul.lubricantadvisor.com/default.aspx?data=1&lang=rus#prefill=${encodeURIComponent(car.query)}&key=${encodeURIComponent(car.cacheKey)}&ec=${encodeURIComponent(car.engineCode)}&carData=${carJson}&manual=1`;
      const win = window.open(url, "zm_motul_search");
      showSearchHint(car);
      try {
        win && win.focus();
      } catch {
      }
    }
    function showSearchHint(car) {
      let p = document.getElementById("__zm_hint");
      if (p) p.remove();
      p = document.createElement("div");
      p.id = "__zm_hint";
      const isRolf = car.searchSource === "ROLF";
      const title = isRolf ? "👆 Вставь код в умный поиск на ROLF" : "👆 Выбери машину в открытой вкладке Motul";
      const body = isRolf ? `Код <b style="color:#E67E00">${car.engineCode || "?"}</b> уже в буфере ✓<br>
                   <small style="color:#7986cb">Ctrl+V в поле поиска → выбери машину → скрипт сам распарсит допуска</small>` : `Ищи вариант с кодом <b style="color:#E67E00">${car.engineCode || "?"}</b><br>
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
      document.getElementById("zm-hint-close").onclick = () => p.remove();
      setTimeout(() => {
        if (p) p.remove();
      }, 3e4);
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
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA") && ae.closest("#__zm_w")) {
        return;
      }
      const car = parseMannUrl();
      if (!car) return;
      const cached = GM_getValue("motul_car_" + car.cacheKey, null);
      const rolf = GM_getValue("rolf_approvals_" + car.cacheKey, null);
      const rolfLen = rolf ? rolf.length : 0;
      const currentKey = car.cacheKey + "|" + (cached ? "Y" : "N") + "|R" + rolfLen + "|" + (expanded ? "E" : "T");
      if (currentKey !== lastRenderedKey) render();
    }, 1500);
    render();
  }
  function parseFiltersInput(text) {
    const out = { vf: null, mf: null, sf: null };
    if (!text) return out;
    const TYPE_MAP = {
      "вф": "vf",
      "мф": "mf",
      "сф": "sf",
      "ВФ": "vf",
      "МФ": "mf",
      "СФ": "sf"
    };
    text.split(/\r?\n/).forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) return;
      const m = line.match(/^(вф|мф|сф)\s+(.+?)\s*[-–—]\s*([\d\s]+)\s*(?:р|руб|₽)?\s*$/i);
      if (!m) return;
      const key = TYPE_MAP[m[1].toLowerCase()] || TYPE_MAP[m[1]];
      if (!key) return;
      const name = m[2].trim();
      const price = parseInt(m[3].replace(/\s+/g, ""), 10);
      if (!isFinite(price) || price <= 0) return;
      out[key] = { name, price };
    });
    return out;
  }
  function applyFiltersInput(text) {
    const parsed = parseFiltersInput(text);
    calcState.filtersRaw = text || "";
    if (!calcState.filters) calcState.filters = {};
    ["vf", "mf", "sf"].forEach((t) => {
      if (!calcState.filters[t]) {
        const defaults = { vf: { work: 350 }, sf: { work: 550 }, mf: {} };
        calcState.filters[t] = { name: "", price: 0, enabled: false, ...defaults[t] };
      }
      const f = calcState.filters[t];
      if (parsed[t]) {
        f.name = parsed[t].name;
        f.price = parsed[t].price;
        f.enabled = true;
        if (t === "vf" && !f.work) f.work = 350;
        if (t === "sf" && !f.work) f.work = 550;
      } else {
        f.name = "";
        f.price = 0;
        f.enabled = false;
      }
    });
  }
  function renderCalculator(car, data) {
    const defaultPartial = shouldDefaultToPartial(car, data);
    if (calcState && calcState.car && calcState.car.cacheKey === car.cacheKey) {
      calcState.data = data;
      calcState.car = car;
    } else {
      calcState = {
        mileage: "<100",
        atpType: defaultPartial ? "partial" : "full",
        atpFilter: false,
        cvtFilterCoarse: false,
        cvtFilterFine: false,
        cvtAtfSp3: false,
        atpVolumeManual: null,
        volumeOverride: {},
        selected: /* @__PURE__ */ new Set(),
        showApprovals: /* @__PURE__ */ new Set(),
        // legacy: показать допуска агрегата (внизу)
        expandedOilApp: /* @__PURE__ */ new Set(),
        // показать ВСЕ допуска у конкретного масла (per-oil)
        oilOverride: {},
        showOilPicker: null,
        ignoreApprovals: false,
        showWithSump: false,
        flush: "none",
        filters: {
          vf: { name: "", price: 0, enabled: false, work: 350 },
          mf: { name: "", price: 0, enabled: false },
          sf: { name: "", price: 0, enabled: false, work: 550 }
        },
        filtersRaw: "",
        showFiltersInput: false,
        totals: [],
        data,
        car
      };
      if (data.engine) calcState.selected.add("engine");
    }
    return `
            <div class="zm-car">
                <div class="zm-car-t">${car.makeShort} ${car.modelShort}${car.engineName ? " " + car.engineName : car.volume ? " " + car.volume : ""}</div>
                <div class="zm-car-sub">${data.motulName || "?"} · ${car.engineCode || "?"} · ${car.kw || "?"}кВт${car.bhp ? " / " + car.bhp + "лс" : ""}${car.yearFrom ? " · " + car.yearFrom : ""}${fuelLabel(car.fuelType) ? " · " + fuelLabel(car.fuelType) : ""}</div>
            </div>
            <div class="zm-ctrls">
                <div class="zm-ctrl-row">
                    <span class="zm-ctrl-lbl">Пробег:</span>
                    <button class="zm-chip ${calcState.mileage === "<100" ? "zm-chip-act" : ""}" data-mileage="<100">до 100т</button>
                    <button class="zm-chip ${calcState.mileage === ">=100" ? "zm-chip-act" : ""}" data-mileage=">=100">100т+</button>
                    <button class="zm-chip ${calcState.mileage === ">=200" ? "zm-chip-act" : ""}" data-mileage=">=200">200т+</button>
                    <button class="zm-chip ${calcState.mileage === "0w20" ? "zm-chip-act" : ""}" data-mileage="0w20">0W-20</button>
                    <button class="zm-chip ${calcState.mileage === "0w30" ? "zm-chip-act" : ""}" data-mileage="0w30">0W-30</button>
                </div>
                <div class="zm-ctrl-row" style="flex-wrap:wrap;gap:8px;margin-top:4px">
                    <label class="zm-chk" style="font-size:11px">
                        <input type="checkbox" id="zm-ignore-approvals" ${calcState.ignoreApprovals ? "checked" : ""}/>
                        <span class="zm-chk-lbl" style="color:#ff9800">🔓 Игнорировать допуска</span>
                    </label>
                    <label class="zm-chk" style="font-size:11px">
                        <input type="checkbox" id="zm-show-sump" ${calcState.showWithSump ? "checked" : ""}/>
                        <span class="zm-chk-lbl" style="color:#81c784">🪣 Снятие/установка защиты картера (+550₽)</span>
                    </label>
                </div>
                <div class="zm-ctrl-row" style="margin-top:4px">
                    <span class="zm-ctrl-lbl">🧪 Промывка ДВС:</span>
                    <button class="zm-chip ${calcState.flush === "none" ? "zm-chip-act" : ""}" data-flush="none">без промывки</button>
                    <button class="zm-chip zm-chip-flush ${calcState.flush === "5min" ? "zm-chip-act" : ""}" data-flush="5min">5-минутка</button>
                    <button class="zm-chip zm-chip-flush ${calcState.flush === "full" ? "zm-chip-act" : ""}" data-flush="full">полная</button>
                </div>
            </div>
            <div id="zm-filters"></div>
            <div id="zm-aggs"></div>
            <div id="zm-totals"></div>
            <div class="zm-result-wrap">
                <div class="zm-result-head">
                    <span>📋 Итог для копирования</span>
                    <span style="display:flex;gap:6px">
                        <button class="zm-btn zm-btn-sec" id="zm-copy">⧉ копировать</button>
                        <button class="zm-btn zm-btn-pri" id="zm-db-send" title="Сохранить машину в общую базу рассчитанных">📤 Отправить отчёт</button>
                    </span>
                </div>
                <pre id="zm-result" class="zm-result"></pre>
            </div>
        `;
  }
  function bindCalcEvents(car, data) {
    document.querySelectorAll("[data-mileage]").forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll("[data-mileage]").forEach((x) => x.classList.remove("zm-chip-act"));
        b.classList.add("zm-chip-act");
        calcState.mileage = b.dataset.mileage;
        rerenderAggs();
      };
    });
    const ignoreChk = document.getElementById("zm-ignore-approvals");
    if (ignoreChk) ignoreChk.onchange = () => {
      calcState.ignoreApprovals = ignoreChk.checked;
      rerenderAggs();
    };
    const sumpChk = document.getElementById("zm-show-sump");
    if (sumpChk) sumpChk.onchange = () => {
      calcState.showWithSump = sumpChk.checked;
      rerenderAggs();
    };
    document.querySelectorAll("[data-flush]").forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll("[data-flush]").forEach((x) => x.classList.remove("zm-chip-act"));
        b.classList.add("zm-chip-act");
        calcState.flush = b.dataset.flush;
        rerenderAggs();
      };
    });
    document.getElementById("zm-copy").onclick = () => {
      const text = document.getElementById("zm-result").textContent;
      navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById("zm-copy");
        const orig = btn.textContent;
        btn.textContent = "✓ скопировано";
        setTimeout(() => {
          btn.textContent = orig;
        }, 1500);
      });
    };
    const dbSendBtn = document.getElementById("zm-db-send");
    if (dbSendBtn) dbSendBtn.onclick = () => openDbModal(car);
    rerenderFilters();
    rerenderAggs();
  }
  function rerenderFilters() {
    const box = document.getElementById("zm-filters");
    if (!box) return;
    const f = calcState.filters;
    const hasAny = f.vf.name || f.mf.name || f.sf.name;
    if (!calcState.showFiltersInput && !hasAny) {
      box.innerHTML = `
                <button type="button" class="zm-btn-filters" id="zm-filters-open">➕ Добавить фильтра ДВС</button>
            `;
      document.getElementById("zm-filters-open").onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
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
                        ${hasAny ? `<button type="button" class="zm-btn zm-btn-sec" id="zm-filters-clear">Очистить</button>` : ""}
                    </div>
                    <div class="zm-filters-hint">Формат: <code>тип название - ценар</code>. Тип: <b>вф</b>/<b>мф</b>/<b>сф</b></div>
                    <div id="zm-filters-debug" style="margin-top:6px;font-size:10px;color:#5a6070"></div>
                </div>
                ${hasAny ? renderFiltersList() : ""}
            `;
      document.getElementById("zm-filters-close").onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        calcState.showFiltersInput = false;
        rerenderFilters();
      };
      document.getElementById("zm-filters-apply").onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          const ta = document.getElementById("zm-filters-ta");
          const txt = ta ? ta.value : "";
          const dbg = document.getElementById("zm-filters-debug");
          const parsed = parseFiltersInput(txt);
          const found = ["vf", "mf", "sf"].filter((t) => parsed[t]);
          if (dbg) dbg.textContent = `Распознано: ${found.length} шт (${found.join(", ") || "ни одного"})`;
          applyFiltersInput(txt);
          if (found.length) calcState.showFiltersInput = false;
          rerenderFilters();
          rerenderAggs();
        } catch (err) {
          const dbg = document.getElementById("zm-filters-debug");
          if (dbg) dbg.textContent = "❌ Ошибка: " + err.message;
        }
      };
      const clearBtn = document.getElementById("zm-filters-clear");
      if (clearBtn) clearBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        applyFiltersInput("");
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
      document.getElementById("zm-filters-edit").onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
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
                        <input type="checkbox" data-ftoggle="vf" ${f.vf.enabled ? "checked" : ""}/>
                        <span class="zm-chk-lbl"><b>ВФ</b> ${escapeHtml(f.vf.name)} — ${f.vf.price}₽</span>
                    </label>
                    <div class="zm-filter-work">
                        <span class="zm-ctrl-lbl">установка:</span>
                        <button class="zm-chip ${f.vf.work === 0 ? "zm-chip-act" : ""}" data-fwork="vf:0">без работы</button>
                        <button class="zm-chip ${f.vf.work === 350 ? "zm-chip-act" : ""}" data-fwork="vf:350">защёлки 350₽</button>
                        <button class="zm-chip ${f.vf.work === 600 ? "zm-chip-act" : ""}" data-fwork="vf:600">болты 600₽</button>
                        <button class="zm-chip ${f.vf.work === 1150 ? "zm-chip-act" : ""}" data-fwork="vf:1150">разбор 1150₽</button>
                    </div>
                </div>
            `);
    }
    if (f.mf.name) {
      rows.push(`
                <div class="zm-filter-row" data-ftype="mf">
                    <label class="zm-chk">
                        <input type="checkbox" data-ftoggle="mf" ${f.mf.enabled ? "checked" : ""}/>
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
                        <input type="checkbox" data-ftoggle="sf" ${f.sf.enabled ? "checked" : ""}/>
                        <span class="zm-chk-lbl"><b>СФ</b> ${escapeHtml(f.sf.name)} — ${f.sf.price}₽</span>
                    </label>
                    <div class="zm-filter-work">
                        <span class="zm-ctrl-lbl">установка:</span>
                        <button class="zm-chip ${f.sf.work === 0 ? "zm-chip-act" : ""}" data-fwork="sf:0">без работы</button>
                        <button class="zm-chip ${f.sf.work === 550 ? "zm-chip-act" : ""}" data-fwork="sf:550">бардачок 550₽</button>
                        <button class="zm-chip ${f.sf.work === 990 ? "zm-chip-act" : ""}" data-fwork="sf:990">под педалью 990₽</button>
                    </div>
                </div>
            `);
    }
    return rows.length ? `<div class="zm-filters-list">${rows.join("")}</div>` : "";
  }
  function bindFilterEvents() {
    document.querySelectorAll("[data-ftoggle]").forEach((ck) => ck.onchange = () => {
      const t = ck.dataset.ftoggle;
      calcState.filters[t].enabled = ck.checked;
      rerenderAggs();
    });
    document.querySelectorAll("[data-fwork]").forEach((b) => b.onclick = () => {
      const [t, v] = b.dataset.fwork.split(":");
      calcState.filters[t].work = parseInt(v, 10);
      rerenderFilters();
      rerenderAggs();
    });
  }
  function rerenderAggs() {
    const box = document.getElementById("zm-aggs");
    if (!box) return;
    let savedFocus = null;
    const ae = document.activeElement;
    if (ae && ae.dataset && ae.dataset.volKey) {
      savedFocus = {
        key: ae.dataset.volKey,
        value: ae.value,
        selStart: ae.selectionStart,
        selEnd: ae.selectionEnd
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
    let dctNotice = "";
    if (calcState.data.automatic && calcState.data.automatic.isDct) {
      dctNotice = `
            <div class="zm-dct-notice">
                💧 <b>${calcState.data.automatic.label || "Роботизированная коробка"}</b><br>
                <small>Коробка с мокрым сцеплением — замену масла не считаем</small>
            </div>`;
    }
    const mileage = calcState.mileage;
    let viscLabel = "";
    if (mileage === ">=200") viscLabel = '<span class="zm-visc-badge zm-visc-10w40">10W-40 (200т+)</span>';
    else if (mileage === "0w20") viscLabel = '<span class="zm-visc-badge zm-visc-0w20">0W-20</span>';
    else if (mileage === "0w30") viscLabel = '<span class="zm-visc-badge zm-visc-0w30">0W-30</span>';
    else if (mileage === ">=100") viscLabel = '<span class="zm-visc-badge">5W-40</span>';
    else viscLabel = '<span class="zm-visc-badge">5W-30</span>';
    box.innerHTML = dctNotice + (viscLabel ? `<div style="padding:4px 14px 0">${viscLabel}</div>` : "") + aggs.map((agg) => {
      const calc = calcForAggregate2(agg);
      const checked = calcState.selected.has(agg.key);
      const showApp = calcState.showApprovals.has(agg.key);
      return `
            <div class="zm-agg ${calc.isHighGear ? "zm-bath" : ""}" data-key="${agg.key}">
                <div class="zm-agg-head">
                    <label class="zm-chk">
                        <input type="checkbox" data-sel="${agg.key}" ${checked ? "checked" : ""}/>
                        <span class="zm-chk-lbl">${agg.label}</span>
                    </label>
                    <span class="zm-agg-vol">${calc.volumeStr}</span>
                </div>
                ${renderCrmQuirks(agg)}
                ${calc.isHighGear ? `<div class="zm-bath-msg">🛁 послан в баню!</div>` : calc.html}
                <button class="zm-app-btn" data-app="${agg.key}">
                    ${showApp ? "▾" : "▸"} ${agg.group === "engine" ? "допуска машины" : "продукты Motul"} (${agg.group === "engine" && agg.approvalAnalysis ? agg.approvalAnalysis.items.length : (agg.approvals || []).length})
                </button>
                ${showApp ? renderApprovalsList(agg) : ""}
            </div>`;
    }).join("");
    if (calcState.data.automatic && !calcState.data.automatic.isDct) {
      const atpBox = box.querySelector('[data-key="automatic"]');
      if (atpBox) {
        const atp = calcState.data.automatic;
        const isCvt = atp.isCvt;
        const typeLabel = isCvt ? "ВАРИАТОР (CVT)" : "АКПП";
        const fullMult = "×1.5";
        const partMult = isCvt ? "×0.8" : "×0.6";
        const noFullWarn = crmNoFullAt(calcState.car, calcState.data) ? `<div class="zm-no-full-warn">⚠ Полную (аппаратную) не делаем — считаем частичную</div>` : "";
        const ctrls = `
                    <div class="zm-atp-ctrls">
                        <div class="zm-atp-type">${typeLabel}</div>
                        <div class="zm-ctrl-row">
                            <span class="zm-ctrl-lbl">Замена:</span>
                            <button class="zm-chip ${calcState.atpType === "full" ? "zm-chip-act" : ""}" data-atp="full">Полная ${fullMult}</button>
                            <button class="zm-chip ${calcState.atpType === "partial" ? "zm-chip-act" : ""}" data-atp="partial">Частичная ${partMult}</button>
                        </div>
                        ${noFullWarn}
                        ${isCvt ? `
                        <label class="zm-chk">
                            <input type="checkbox" id="zm-cvt-filter-coarse" ${calcState.cvtFilterCoarse ? "checked" : ""}/>
                            <span class="zm-chk-lbl">Фильтр грубой очистки (+1700₽)</span>
                        </label>
                        <label class="zm-chk">
                            <input type="checkbox" id="zm-cvt-filter-fine" ${calcState.cvtFilterFine ? "checked" : ""}/>
                            <span class="zm-chk-lbl">Фильтр тонкой очистки (+3350₽)</span>
                        </label>
                        <label class="zm-chk">
                            <input type="checkbox" id="zm-cvt-atf-sp3" ${calcState.cvtAtfSp3 ? "checked" : ""}/>
                            <span class="zm-chk-lbl">АТФ SP-III (старый вариатор — только ROLF Professional ATF Multi)</span>
                        </label>
                        ` : `
                        <label class="zm-chk">
                            <input type="checkbox" id="zm-atp-filter" ${calcState.atpFilter ? "checked" : ""}/>
                            <span class="zm-chk-lbl">Фильтр АКПП (+1700₽)</span>
                        </label>
                        `}
                    </div>`;
        atpBox.querySelector(".zm-agg-head").insertAdjacentHTML("afterend", ctrls);
      }
    }
    box.querySelectorAll("[data-sel]").forEach((c) => c.onchange = () => {
      if (c.checked) calcState.selected.add(c.dataset.sel);
      else calcState.selected.delete(c.dataset.sel);
      rerenderResult();
    });
    box.querySelectorAll("[data-pick]").forEach((b) => b.onclick = () => {
      const k = b.dataset.pick;
      calcState.showOilPicker = calcState.showOilPicker === k ? null : k;
      rerenderAggs();
    });
    box.querySelectorAll("[data-reg-info]").forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      try {
        const matches = JSON.parse(b.dataset.regInfo);
        showReglamentPopup(matches);
      } catch {
      }
    });
    box.querySelectorAll("[data-opt]").forEach((b) => b.onclick = () => {
      const key = calcState.showOilPicker;
      if (!key) return;
      calcState.oilOverride[key + "_mid"] = b.dataset.opt;
      calcState.showOilPicker = null;
      rerenderAggs();
    });
    box.querySelectorAll("[data-vol-key]").forEach((inp) => {
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
      inp.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          inp.blur();
        }
      };
    });
    box.querySelectorAll("[data-vol-reset]").forEach((b) => b.onclick = () => {
      delete calcState.volumeOverride[b.dataset.volReset];
      rerenderAggs();
    });
    box.querySelectorAll("[data-app]").forEach((b) => b.onclick = () => {
      const k = b.dataset.app;
      if (calcState.showApprovals.has(k)) calcState.showApprovals.delete(k);
      else calcState.showApprovals.add(k);
      rerenderAggs();
    });
    box.querySelectorAll("[data-oilapp]").forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      const k = b.dataset.oilapp;
      if (calcState.expandedOilApp.has(k)) calcState.expandedOilApp.delete(k);
      else calcState.expandedOilApp.add(k);
      rerenderAggs();
    });
    box.querySelectorAll("[data-atp]").forEach((b) => b.onclick = () => {
      calcState.atpType = b.dataset.atp;
      rerenderAggs();
    });
    const fltChk = document.getElementById("zm-atp-filter");
    if (fltChk) fltChk.onchange = () => {
      calcState.atpFilter = fltChk.checked;
      rerenderAggs();
    };
    const cvtC = document.getElementById("zm-cvt-filter-coarse");
    if (cvtC) cvtC.onchange = () => {
      calcState.cvtFilterCoarse = cvtC.checked;
      rerenderAggs();
    };
    const cvtF = document.getElementById("zm-cvt-filter-fine");
    if (cvtF) cvtF.onchange = () => {
      calcState.cvtFilterFine = cvtF.checked;
      rerenderAggs();
    };
    const cvtSp3 = document.getElementById("zm-cvt-atf-sp3");
    if (cvtSp3) cvtSp3.onchange = () => {
      calcState.cvtAtfSp3 = cvtSp3.checked;
      rerenderAggs();
    };
    if (savedFocus) {
      const newInp = box.querySelector(`[data-vol-key="${savedFocus.key}"]`);
      if (newInp) {
        newInp.value = savedFocus.value;
        newInp.focus();
        try {
          newInp.setSelectionRange(savedFocus.selStart, savedFocus.selEnd);
        } catch {
        }
      }
    }
    rerenderTotals();
    rerenderResult();
  }
  function rerenderTotals() {
    const box = document.getElementById("zm-totals");
    if (!box) return;
    if (!calcState || !calcState.totals) calcState.totals = [];
    const aggs = getAggregates(calcState.data).filter((a) => calcState.selected.has(a.key));
    const aggData = aggs.map((agg) => {
      const calc = calcForAggregate2(agg);
      return { agg, calc };
    }).filter((x) => x.calc.costs && x.calc.costs.length);
    if (!aggData.length) {
      box.innerHTML = "";
      return;
    }
    const totalsHtml = calcState.totals.map((tot, idx) => {
      const rowsHtml = aggData.map(({ agg, calc }) => {
        const sel = tot[agg.key];
        const opts = calc.costs.map((c, i) => {
          const checked = sel === i ? "checked" : "";
          return `<label class="zm-tot-opt">
                        <input type="radio" name="zm-tot-${idx}-${agg.key}" data-tot="${idx}" data-agg="${agg.key}" value="${i}" ${checked}/>
                        <span>${escapeHtml(totalOilLabel(c.oil))} — ${c.total}₽</span>
                    </label>`;
        }).join("");
        const skipChecked = sel === void 0 || sel === "skip" ? "checked" : "";
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
      }).join("");
      const totalSum = computeTotalSum(tot, aggData);
      const sumpAdd = calcState.showWithSump && totalSum.hasEngine ? 550 : 0;
      const displaySum = totalSum.sum + sumpAdd;
      const sumpSuffix = sumpAdd ? ` + 550₽ (снятие/установка защиты картера) = <b>${displaySum}₽</b>` : "";
      return `
                <div class="zm-tot-block">
                    <div class="zm-tot-block-h">
                        <span>Стоимость #${idx + 1}: <b>${totalSum.sum}₽</b>${sumpSuffix}</span>
                        <button class="zm-btn zm-btn-sec" data-tot-del="${idx}">✕</button>
                    </div>
                    ${rowsHtml}
                </div>
            `;
    }).join("");
    box.innerHTML = `
            <div class="zm-totals-wrap">
                ${totalsHtml}
                <button class="zm-btn-filters" id="zm-tot-add">+ Добавить общую стоимость</button>
            </div>
        `;
    const addBtn = document.getElementById("zm-tot-add");
    if (addBtn) addBtn.onclick = () => {
      calcState.totals.push({});
      rerenderTotals();
      rerenderResult();
    };
    box.querySelectorAll('input[type="radio"][data-tot]').forEach((r) => r.onchange = () => {
      const ti = parseInt(r.dataset.tot, 10);
      const ak = r.dataset.agg;
      const v = r.value;
      if (!calcState.totals[ti]) calcState.totals[ti] = {};
      calcState.totals[ti][ak] = v === "skip" ? "skip" : parseInt(v, 10);
      rerenderTotals();
      rerenderResult();
    });
    box.querySelectorAll("[data-tot-del]").forEach((b) => b.onclick = () => {
      const i = parseInt(b.dataset.totDel, 10);
      calcState.totals.splice(i, 1);
      rerenderTotals();
      rerenderResult();
    });
  }
  function normalizeAdditive(s) {
    return String(s || "").toLowerCase().replace(/[ёе]/g, "е").replace(/[\s\-\/]+/g, "").trim();
  }
  var RANK_ORDER_ZM = ["critical", "important", "assumed", "minor", "conflict", "info", "noise"];
  var RANK_TITLE_ZM = {
    critical: "решают выбор",
    important: "важны физически",
    assumed: "выведено по марке, году и топливу",
    minor: "перекрыты более строгими",
    conflict: "противоречат профилю",
    info: "уровень качества",
    noise: "к этой машине не относятся"
  };
  function renderApprovalsList(agg) {
    const a = agg.group === "engine" ? agg.approvalAnalysis : null;
    const plain = (agg.approvals || []).map((x) => `<span class="zm-app-tag">${escapeHtml(x)}</span>`).join("");
    if (!a || !a.items.length) {
      return `<div class="zm-app-list">${plain || "<i>не определены</i>"}</div>`;
    }
    const decisive = a.items.filter((i) => ["critical", "important", "assumed"].includes(i.rank)).length;
    const need = [];
    if (a.profile.ashGate != null) need.push(`${sapsLabel(a.profile.ashGate)} (зола ≤ ${a.profile.ashGate}%)`);
    const hths = a.profile.hthsGate != null ? a.profile.hthsGate : a.profile.hthsMin;
    if (hths != null) need.push(`HTHS ≥ ${hths}`);
    const ruleNote = a.rule && a.rule.applied ? `<div class="zm-app-rule" title="${escapeHtmlSafe(a.rule.why)}">≈ допусков в базе нет — требование выведено по марке, году и топливу</div>` : "";
    const groups = RANK_ORDER_ZM.map((rank) => ({
      rank,
      items: a.items.filter((i) => i.rank === rank)
    })).filter((g) => g.items.length);
    const warn = a.unionSuspect ? `<div class="zm-app-warn" title="${escapeHtmlSafe(a.conflicts[0] && a.conflicts[0].note || "")}">⚠ список собран из паспортов рекомендованных масел, а не из требований мотора</div>` : "";
    return `<div class="zm-app-list zm-app-list-col">
            <div class="zm-app-sum"><b>решают ${decisive} из ${a.items.length}</b>${need.length ? " · мотору нужно: " + escapeHtml(need.join(", ")) : ""}${agg.requiredClass ? " · класс " + escapeHtml(agg.requiredClass) : ""}</div>
            ${ruleNote}
            ${warn}
            ${groups.map((g) => `
                <div class="zm-app-grp">
                    <div class="zm-app-grp-h">${RANK_TITLE_ZM[g.rank]} (${g.items.length})</div>
                    <div>${g.items.map(
      (it) => `<span class="zm-app-tag zm-app-${it.rank}" title="${escapeHtmlSafe(it.label + "\n" + it.what + "\n\n" + it.why)}">${escapeHtml(it.label)}${it.fromEvidence ? " +" : it.fromRule ? " ≈" : ""}</span>`
    ).join("")}</div>
                </div>`).join("")}
        </div>`;
  }
  function renderOilDetailsBlock(agg, oil, idx, spotAddsLower) {
    const oilKey = agg.key + "_" + idx + "_" + oil.b + "_" + oil.n;
    const isExpanded = calcState.expandedOilApp.has(oilKey);
    const carApprovals = agg.approvals || [];
    const { matched, others, hier } = splitOilApprovals(oil.a || [], carApprovals);
    const hasCarApprovals = carApprovals.length > 0 && !calcState.ignoreApprovals;
    const matchedHtml = hasCarApprovals && (matched.length || hier.length) ? `<div class="zm-oil-app-matched">
                ${matched.map((a) => `<span class="zm-oil-app-pill zm-oil-app-match" title="Совпадает с допуском машины">${escapeHtml(a)}</span>`).join("")}
                ${hier.map((h) => `<span class="zm-oil-app-pill zm-oil-app-hier" title="${escapeHtmlSafe(h.approval)} покрывает требуемый ${escapeHtmlSafe(h.covers)} (старший допуск)">${escapeHtml(h.approval)} ⊃ ${escapeHtml(h.covers)}</span>`).join("")}
               </div>` : "";
    const btnLabel = hasCarApprovals ? `допуска +${others.length}` : `допуска (${(oil.a || []).length})`;
    const appBtn = `<button class="zm-oil-app-btn ${isExpanded ? "zm-oil-app-btn-open" : ""}" data-oilapp="${escapeHtmlSafe(oilKey)}">${isExpanded ? "▾" : "▸"} ${btnLabel}</button>`;
    let expandedHtml = "";
    if (isExpanded) {
      const listToShow = hasCarApprovals ? others.map((a) => `<span class="zm-oil-app-pill">${escapeHtml(a)}</span>`) : (oil.a || []).map((a) => `<span class="zm-oil-app-pill">${escapeHtml(a)}</span>`);
      expandedHtml = `<div class="zm-oil-app-others">${listToShow.join("") || '<i style="color:#5a6070;font-size:10px">нет дополнительных</i>'}</div>`;
    }
    let myAds = oil.ad || [];
    if (!oil.isSpot && spotAddsLower && spotAddsLower.size) {
      myAds = myAds.filter((a) => !spotAddsLower.has(normalizeAdditive(a)));
    }
    const adsHtml = myAds.length ? `<div class="zm-oil-ads">
                ${myAds.map((a) => `<span class="zm-oil-ad-pill${oil.isSpot ? " zm-oil-ad-pill-spot" : ""}">${escapeHtml(a)}</span>`).join("")}
               </div>` : "";
    return `
            <div class="zm-oil-details">
                ${matchedHtml}
                ${appBtn}
                ${expandedHtml}
                ${adsHtml}
            </div>
        `;
  }
  function parseRavenolUrl() {
    const segs = location.pathname.split("/").filter(Boolean);
    if (segs.length < 4) return null;
    const cleanSeg = (s) => s.replace(/^\d+-/, "").replace(/-/g, " ");
    const make = cleanSeg(segs[1] || "");
    const model = cleanSeg(segs[3] || segs[2] || "");
    return { make, model };
  }
  function parseRavenolHead() {
    const cont = document.querySelector(".rav_selection_head_info_container");
    if (!cont) return {};
    const text = (cont.querySelector("p") || {}).textContent || "";
    const yMatch = text.match(/год выпуска\s+с\s+(\d{4})/i);
    const yearFrom = yMatch ? parseInt(yMatch[1]) : null;
    const vMatch = text.match(/(\d\.\d)\b/);
    const engineVolume = vMatch ? vMatch[1] : "";
    const fuelMatch = text.match(/Топливо:\s*([^<\n]+)/i) || (cont.textContent || "").match(/Топливо:\s*([^\n]+)/i);
    const fuel = fuelMatch ? fuelMatch[1].trim().replace(/[.,].*$/, "") : "";
    return { headText: text.replace(/\s*-\s*Моторное масло.*$/i, "").trim(), yearFrom, engineVolume, fuel };
  }
  function detectKppType(title) {
    const t = (title || "").toLowerCase();
    if (/полуавтомат/.test(t)) return { isManual: true, isSemiAuto: true };
    if (/вариатор|cvt/.test(t)) return { isCvt: true };
    if (/роботизированн|dct|dsg|двойн[а-я]+\s*сцеплен/.test(t)) return { isDct: true };
    if (/автомат|планет/.test(t)) return { isAuto: true };
    if (/механическ|m[\s-]?t\b/.test(t)) return { isManual: true };
    return {};
  }
  function parseRavenolPage() {
    const out = {};
    document.querySelectorAll(".aggregate_node").forEach((node) => {
      const titleEl = node.querySelector(".aggregate_node_title");
      if (!titleEl) return;
      const titleRaw = titleEl.textContent.replace(/\s+/g, " ").trim();
      const descEl = node.querySelector(".aggregate_node_description_text");
      const descText = descEl ? descEl.textContent.replace(/\s+/g, " ").trim() : "";
      let volTotal = 0, volService = 0, volPlain = 0;
      const volRe = /объ[её]м[^:]*?(?:\(([^)]+)\))?\s*:\s*([\d.,]+)\s*л/gi;
      let m;
      while ((m = volRe.exec(descText)) !== null) {
        const ctx = (m[1] || "").toLowerCase();
        const v = parseFloat(m[2].replace(",", "."));
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
        rawText: titleRaw + " " + descText
      };
      if (/двигатель/i.test(titleRaw)) {
        const ec = titleRaw.replace(/^двигатель\s*/i, "").trim();
        data.engineCode = ec;
        out.engine = data;
      } else if (/коробка передач/i.test(titleRaw) || /\bкпп\b/i.test(titleRaw)) {
        const t = detectKppType(titleRaw);
        if (t.isCvt) {
          data.isCvt = true;
          out.automatic = data;
        } else if (t.isDct) {
          data.isDct = true;
          out.automatic = data;
        } else if (t.isAuto) {
          out.automatic = data;
        } else if (t.isManual) {
          if (t.isSemiAuto) data.isSemiAuto = true;
          out.manual = data;
        } else {
          out.automatic = data;
        }
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
    const cap = (s) => s.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    const makeShort = cap(u.make);
    const modelShort = cap(u.model);
    const data = parseRavenolPage();
    const engineCode = data.engine && data.engine.engineCode || "";
    const engineName = "";
    const cacheKey = [makeShort, modelShort, head.engineVolume, engineCode, head.yearFrom].filter(Boolean).join("_").toLowerCase().replace(/\s+/g, "");
    return {
      make: makeShort,
      model: modelShort,
      makeShort,
      modelShort,
      engineCode,
      engineName,
      volume: head.engineVolume || "",
      ccm: null,
      kw: null,
      bhp: null,
      yearFrom: head.yearFrom,
      fuelType: head.fuel || "",
      query: [makeShort, modelShort, head.engineVolume].filter(Boolean).join(" ").toLowerCase(),
      cacheKey,
      _ravenolData: data,
      _ravenolHead: head.headText || "",
      isRavenol: true
    };
  }
  function initRolf() {
    const pendingRaw = GM_getValue("zm_rolf_pending", "");
    let key = "", ec = "";
    if (pendingRaw) {
      try {
        const p = JSON.parse(pendingRaw);
        if (p && p.key && Date.now() - (p.ts || 0) < 30 * 60 * 1e3) {
          key = p.key;
          ec = p.ec || "";
        }
      } catch {
      }
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
    if (!document.body) {
      setTimeout(() => renderRolfHint(ec), 200);
      return;
    }
    let b = document.getElementById("__zm_rolf_badge");
    if (b) b.remove();
    b = document.createElement("div");
    b.id = "__zm_rolf_badge";
    b.style.cssText = `position:fixed;top:20px;right:20px;z-index:9999999;
            background:#0f1117;color:#e8eaf6;padding:14px 18px;border-radius:10px;
            font:13px Arial;box-shadow:0 8px 24px rgba(0,0,0,.5);max-width:380px;
            border:1px solid #E67E00;line-height:1.5`;
    b.innerHTML = `
            <div style="color:#E67E00;font-weight:bold;margin-bottom:8px">📋 OIL WIDGET — ROLF</div>
            <div>Вставь код двигателя <b style="color:#E67E00">${escapeHtml(ec || "?")}</b> в «умный поиск» → выбери свою машину → скрипт сам распаршу допуска</div>
            <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
                <button id="zm-rolf-copy" style="background:#E67E00;border:none;color:#fff;border-radius:6px;padding:6px 12px;cursor:pointer;font:12px Arial">⧉ Скопировать</button>
                <button id="zm-rolf-close" style="background:transparent;border:1px solid #3a3d5e;color:#e8eaf6;border-radius:6px;padding:6px 12px;cursor:pointer;font:11px Arial">Закрыть</button>
            </div>
            <div id="zm-rolf-status" style="margin-top:10px;color:#7986cb;font-size:11px">Жду результатов…</div>
        `;
    document.body.appendChild(b);
    const copyBtn = document.getElementById("zm-rolf-copy");
    if (copyBtn && ec) copyBtn.onclick = () => {
      navigator.clipboard.writeText(ec).then(() => {
        copyBtn.textContent = "✓ скопировано";
        setTimeout(() => {
          copyBtn.textContent = "⧉ Скопировать";
        }, 2e3);
      }).catch(() => {
        copyBtn.textContent = "✗ не получилось — скопируй руками";
      });
    };
    const closeBtn = document.getElementById("zm-rolf-close");
    if (closeBtn) closeBtn.onclick = () => b.remove();
  }
  function pollRolfResult(key) {
    const interval = setInterval(() => {
      const result = GM_getValue("rolf_approvals_" + key, null);
      if (result && result.length) {
        clearInterval(interval);
        const st = document.getElementById("zm-rolf-status");
        const b = document.getElementById("__zm_rolf_badge");
        if (b) {
          b.style.borderColor = "#4caf50";
          if (st) {
            st.innerHTML = `<b style="color:#4caf50">✅ Сохранено ${result.length} допусков:</b><br>${result.slice(0, 5).map(escapeHtml).join(", ")}${result.length > 5 ? "…" : ""}`;
          }
          const existingCloseTabBtn = document.getElementById("zm-rolf-closetab");
          if (!existingCloseTabBtn) {
            const btn = document.createElement("button");
            btn.id = "zm-rolf-closetab";
            btn.textContent = "✕ Закрыть эту вкладку";
            btn.style.cssText = "margin-top:10px;padding:8px 14px;background:#2196f3;color:#fff;border:none;border-radius:6px;cursor:pointer;font:12px Arial;width:100%";
            btn.onclick = () => window.close();
            b.appendChild(btn);
          }
        }
      }
    }, 1e3);
    setTimeout(() => clearInterval(interval), 10 * 60 * 1e3);
  }
  function watchForRolfTags(key, ec) {
    const seen = /* @__PURE__ */ new Set();
    const tryParse = () => {
      const tagBlocks = document.querySelectorAll(".card-oil-tags__tags-wrap");
      if (!tagBlocks.length) return false;
      const allTags = /* @__PURE__ */ new Set();
      tagBlocks.forEach((block) => {
        const tags = block.querySelectorAll(".tag span, .tag_on-black span, span");
        tags.forEach((t) => {
          const txt = (t.textContent || "").replace(/\s+/g, " ").trim();
          if (txt && txt.length >= 3 && txt.length <= 80 && /[A-Za-zА-Яа-я]/.test(txt)) {
            allTags.add(txt);
          }
        });
      });
      if (!allTags.size) return false;
      const signature = [...allTags].sort().join("|");
      if (seen.has(signature)) return false;
      seen.add(signature);
      const normalized = [];
      allTags.forEach((tag) => {
        const m = tag.match(/^([A-Z]+(?:[\s\-][A-Z]+)*)\s+([\d][\d\.\-]*(?:\/[\d][\d\.\-]*)+)/i);
        if (m) {
          const prefix = m[1].trim();
          m[2].split("/").forEach((v) => normalized.push(`${prefix} ${v.trim()}`));
        } else {
          normalized.push(tag);
        }
      });
      GM_setValue("rolf_approvals_" + key, normalized);
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
    setTimeout(() => {
      clearInterval(interval);
      mo.disconnect();
    }, 10 * 60 * 1e3);
  }
  function initMotul() {
    const hash = location.hash.slice(1);
    const hashParams = new URLSearchParams(hash);
    const prefill = hashParams.get("prefill");
    const cacheKey = hashParams.get("key");
    const wantedEc = (hashParams.get("ec") || "").trim();
    const carData = hashParams.get("carData") || "";
    if (cacheKey) sessionStorage.setItem("zm_cache_key", cacheKey);
    if (wantedEc) sessionStorage.setItem("zm_wanted_ec", wantedEc);
    if (prefill) sessionStorage.setItem("zm_prefill", prefill);
    if (carData) sessionStorage.setItem("zm_car_data", carData);
    runManual(
      prefill || sessionStorage.getItem("zm_prefill") || "",
      cacheKey || sessionStorage.getItem("zm_cache_key") || "",
      wantedEc || sessionStorage.getItem("zm_wanted_ec") || "",
      carData || sessionStorage.getItem("zm_car_data") || ""
    );
  }
  function runManual(prefill, cacheKey, wantedEc, carDataRaw) {
    let carData = null;
    if (carDataRaw) {
      try {
        carData = JSON.parse(carDataRaw);
      } catch {
      }
    }
    if (location.pathname.includes("advice.aspx")) {
      setTimeout(() => {
        const data = parseMotulAdvice();
        if (!data || !data.engine) {
          showManualBadge("⚠️ Не удалось распарсить страницу", "#ff9800");
          return;
        }
        const key = cacheKey || sessionStorage.getItem("zm_cache_key");
        if (!key) {
          showManualBadge("⚠️ Нет ключа кеша - открой заново с Mann Filter", "#ff9800");
          return;
        }
        const foundEc = (data.engine.engineCode || "").trim();
        const ecMatch = wantedEc ? matchEngineCodes(wantedEc, foundEc) : null;
        GM_setValue("motul_car_" + key, data);
        recordSourceLink(key, "motul", location.href);
        if (wantedEc && !ecMatch) {
          showManualBadge(`⚠️ Код не совпал: ожидался ${wantedEc}, на Motul ${foundEc || "?"}. Сохранено, но проверь машину!`, "#ff9800");
        } else if (ecMatch) {
          showManualBadge(`✅ Код совпал: ${foundEc}. Можно закрыть вкладку.`, "#4caf50");
        } else {
          showManualBadge(`✅ Сохранено. Можно закрыть вкладку.`, "#4caf50");
        }
        const btn = document.createElement("button");
        btn.textContent = "✕ Закрыть вкладку";
        btn.style.cssText = "position:fixed;top:70px;right:20px;z-index:999999;padding:10px 16px;border-radius:8px;background:#2196f3;color:#fff;border:none;cursor:pointer;font:13px Arial;box-shadow:0 4px 16px rgba(0,0,0,.3)";
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
    const old = document.getElementById("__zm_cheatsheet");
    if (old) old.remove();
    const fuelMap = {
      "01": "Бензин",
      "02": "Бензин + газ",
      "04": "Этанол",
      "05": "Дизель",
      "06": "Дизель",
      "": "?"
    };
    const fuel = carData ? fuelMap[carData.fuelType] || carData.fuelType || "?" : "?";
    if (!carData) {
      showManualBadge(`⌨ Ищу "${prefill}"…${wantedEc ? " Код двигателя: " + wantedEc : ""}. Выбери из выпадашки.`, "#2196f3");
      return;
    }
    const rows = [];
    const car = carData;
    if (car.makeShort) rows.push(["Марка", car.makeShort]);
    if (car.modelShort) rows.push(["Модель", car.modelShort]);
    if (car.engineCode) rows.push(["Код двиг.", car.engineCode, true]);
    if (car.engineName) rows.push(["Двигатель", car.engineName]);
    if (car.volume) rows.push(["Объём", car.volume + " л"]);
    if (car.ccm) rows.push(["Объём", car.ccm + " куб.см"]);
    if (car.kw && car.bhp) rows.push(["Мощность", `${car.kw} кВт / ${car.bhp} лс`]);
    else if (car.kw) rows.push(["Мощность", car.kw + " кВт"]);
    else if (car.bhp) rows.push(["Мощность", car.bhp + " лс"]);
    if (car.yearFrom) rows.push(["Год", car.yearFrom]);
    if (fuel !== "?") rows.push(["Топливо", fuel]);
    const rowsHtml = rows.map(([k, v, hl]) => `
            <tr>
                <td style="padding:4px 10px 4px 0;color:#7986cb;font-size:11px;white-space:nowrap;vertical-align:top">${k}</td>
                <td style="padding:4px 0;color:${hl ? "#fff" : "#e8eaf6"};font-size:13px;${hl ? "font-weight:bold;background:#2a1d00;padding:4px 8px;border-radius:4px" : ""}">${escapeHtmlSafe(String(v))}</td>
            </tr>
        `).join("");
    const box = document.createElement("div");
    box.id = "__zm_cheatsheet";
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
    const closeBtn = document.getElementById("__zm_cs_close");
    if (closeBtn) closeBtn.onclick = () => box.remove();
    setTimeout(() => {
      if (box.parentNode) box.remove();
    }, 18e4);
  }
  function showReglamentPopup(matches) {
    const old = document.getElementById("__zm_reg_popup");
    if (old) {
      old.remove();
      return;
    }
    const box = document.createElement("div");
    box.id = "__zm_reg_popup";
    box.innerHTML = `
            <div class="zm-reg-popup-head">
                <span>📖 По регламенту</span>
                <button id="__zm_reg_close" title="Закрыть">✕</button>
            </div>
            <div class="zm-reg-popup-body">
                ${matches.map((m) => `
                    <div class="zm-reg-item">
                        <div class="zm-reg-tag">⭐ ${escapeHtmlSafe(m.tag)}</div>
                        <div class="zm-reg-desc">${escapeHtmlSafe(m.desc || "—")}</div>
                    </div>
                `).join("")}
                <div class="zm-reg-foot">Совпадения с регламентом производителя — масло подойдёт.</div>
            </div>
        `;
    document.body.appendChild(box);
    document.getElementById("__zm_reg_close").onclick = () => box.remove();
    const offClick = (e) => {
      if (!box.contains(e.target)) {
        box.remove();
        document.removeEventListener("click", offClick, true);
      }
    };
    setTimeout(() => document.addEventListener("click", offClick, true), 50);
  }
  function matchEngineCodes(mannEc, motulEc) {
    if (!mannEc || !motulEc) return false;
    const a = mannEc.toUpperCase().split(/[,;\/\s]+/).map((s) => s.trim()).filter(Boolean);
    const b = motulEc.toUpperCase().split(/[,;\/\s]+/).map((s) => s.trim()).filter(Boolean);
    for (const x of a) for (const y of b) {
      if (!x || !y) continue;
      if (x === y || x.includes(y) || y.includes(x)) return true;
    }
    return false;
  }
  function fillSearchField(value) {
    const input = document.getElementById("instantsearchinput");
    if (!input) {
      setTimeout(() => fillSearchField(value), 200);
      return;
    }
    input.focus();
    input.value = "";
    for (let i = 0; i < value.length; i++) {
      input.value += value[i];
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { key: value[i], bubbles: true }));
    }
    if (window.jQuery) {
      try {
        window.jQuery(input).val(value).trigger("keyup").trigger("input");
      } catch {
      }
    }
  }
  function showManualBadge(text, color) {
    let b = document.getElementById("__motul_badge");
    if (!b) {
      b = document.createElement("div");
      b.id = "__motul_badge";
      b.style.cssText = "position:fixed;top:20px;right:20px;z-index:999999;color:#fff;padding:12px 18px;border-radius:10px;font:13px Arial;box-shadow:0 8px 24px rgba(0,0,0,.3);max-width:400px";
      (document.body || document.documentElement).appendChild(b);
    }
    b.style.background = color || "#4caf50";
    b.textContent = text;
  }
  function parseMotulAdvice() {
    const makeEl = document.getElementById("ctl00_ContentPlaceHolder1_lblMakeValue");
    const modelEl = document.getElementById("ctl00_ContentPlaceHolder1_lblModelValue");
    const typeEl = document.getElementById("ctl00_ContentPlaceHolder1_lblTypeValue");
    const out = {
      motulName: [makeEl?.textContent, modelEl?.textContent, typeEl?.textContent].filter(Boolean).join(" · "),
      make_model_type: (typeEl?.textContent || "").trim()
    };
    const titleTds = document.querySelectorAll(".AdviceComponentTitleText");
    titleTds.forEach((tdTitle, idx) => {
      let titleText = "";
      for (const n of tdTitle.childNodes) {
        if (n.nodeType === 3) titleText += n.textContent;
      }
      titleText = titleText.replace(/\s+/g, " ").trim();
      if (!titleText) titleText = tdTitle.textContent.replace(/- Not applicable/g, "").trim();
      const compBlock = document.getElementById("Comp" + idx);
      if (!compBlock) return;
      const data = parseCompBlock(compBlock);
      data.label = titleText;
      data.rawText = compBlock.textContent;
      if (/двигатель/i.test(titleText)) {
        data.engineCode = titleText.replace(/двигатель/i, "").trim();
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
  function parseCompBlock(block) {
    const result = { volume: 0, filterVolume: 0, motulProducts: [], modes: [] };
    let volService = 0, volTotal = 0, volPlain = 0;
    const norm = (s) => s.toLowerCase().replace(/o/g, "о").replace(/c/g, "с").replace(/e/g, "е").replace(/p/g, "р").replace(/a/g, "а");
    const rows = block.querySelectorAll("tr");
    let lastTitle = "";
    rows.forEach((tr) => {
      const titleTd = tr.querySelector(".AdviceTitle");
      const valueTd = tr.querySelector(".AdviceValue");
      if (titleTd && valueTd) {
        const title = titleTd.textContent.replace(/\s+/g, " ").trim();
        const value = valueTd.textContent.replace(/\s+/g, " ").trim();
        const valueN = norm(value);
        const titleN = norm(title);
        if (/объ[её]м/.test(valueN) || /объ[её]м/.test(titleN)) {
          const m = value.match(/([\d]+(?:[,\.]\d+)?)\s*л/i);
          if (m) {
            const vol = parseFloat(m[1].replace(",", "."));
            const isFilter = /фильтр/.test(valueN);
            const isService = /сервисн/.test(valueN);
            const isTotal = /общ|полн/.test(valueN);
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
      const prodValueTd = tr.querySelector(".AdviceValueProduct");
      if (prodValueTd) {
        const pname = prodValueTd.textContent.replace(/\s+/g, " ").trim();
        if (pname && pname !== ":" && !/products not found/i.test(pname) && pname.length > 1) {
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
    result.volumeType = volService ? "service" : volTotal ? "total" : "plain";
    return result;
  }
  function injectStyles() {
    if (document.getElementById("__zm_style")) return;
    const s = document.createElement("style");
    s.id = "__zm_style";
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
            .zm-visc-0w30{background:#00332a;border-color:#26a69a;color:#4db6ac;font-weight:bold}
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
            .zm-app-tag{background:#1e2040;color:#9aa0b0;padding:2px 6px;border-radius:3px;font-size:10px;font-family:monospace;
                margin:2px 3px 0 0;display:inline-block;cursor:help}
            .zm-app-list-col{display:block}
            .zm-app-sum{font-size:10px;color:#9aa0b0;line-height:1.5;margin-bottom:4px}
            .zm-app-sum b{color:#E67E00}
            .zm-app-warn{font-size:10px;color:#ff8a80;line-height:1.4;margin-bottom:6px;cursor:help}
            .zm-app-grp{margin-top:5px}
            .zm-app-grp-h{font-size:9px;text-transform:uppercase;letter-spacing:.04em;color:#5a6070;margin-bottom:2px}
            /* цвет = что решает выбор, а что попало в список из чужого паспорта */
            .zm-app-critical{background:#3a1420;color:#ff8a80;border:1px solid #b04a4a}
            .zm-app-important{background:#12301c;color:#7fd18a;border:1px solid #3f7a4a}
            /* пунктир = требование выведено по марке и годам, а не прочитано у машины */
            .zm-app-assumed{background:#12301c;color:#7fd18a;border:1px dashed #3f7a4a}
            .zm-app-rule{color:#7fd18a;font-size:10px;margin-top:4px;cursor:help}
            .zm-app-minor{background:#14203a;color:#7fa8e8;border:1px solid #3a5a8a}
            .zm-app-conflict{background:#1a1a20;color:#8a8a95;border:1px dashed #b04a4a;text-decoration:line-through}
            .zm-app-info{background:#1a1c28;color:#7a8090}
            .zm-app-noise{background:transparent;color:#5a6070;border:1px solid #2a2d40}
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
            .zm-quirk{display:flex;gap:7px;align-items:flex-start;margin:6px 10px 0;padding:6px 9px;
                border-radius:6px;font-size:11px;line-height:1.45;background:#12141c;border:1px solid #2a2d3e;color:#c5c8d6}
            .zm-quirk-block{background:#2a0000;border-color:#e53935;color:#ff8a80}
            .zm-quirk-warn{background:#2a1d00;border-color:#E67E00;color:#ffb74d}
            .zm-quirk-tag{flex:none;font-size:9px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;opacity:.85;padding-top:1px}
            .zm-quirk-note{display:block;margin-top:2px;opacity:.8}
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
            /* Допуск, покрывающий требуемый через иерархию (MB 229.5 ⊃ 229.3) */
            .zm-oil-app-pill.zm-oil-app-hier{
                background:linear-gradient(120deg,#0d47a1,#1565c0,#1e88e5,#42a5f5,#1e88e5,#1565c0,#0d47a1);
                background-size:300% 100%;
                color:#fff;
                border:1px solid #42a5f5;
                font-weight:700;
                box-shadow:0 0 8px rgba(66,165,245,.35);
                animation:zm-shimmer 3s linear infinite}
            .zm-oil-opt-hits{font-size:9px;color:#66bb6a;margin-left:4px;white-space:nowrap}
            .zm-oil-opt-miss{font-size:9px;color:#ff8a80;margin-left:4px;white-space:nowrap}

            /* ── Модалка «Отправить отчёт в базу» ── */
            #zm-db-modal{position:fixed;inset:0;z-index:2147483646;font:13px Arial}
            /* Окно логина — поверх модалки отчёта, тот же визуальный язык (.zm-db-*) */
            #zm-login-modal{position:fixed;inset:0;z-index:2147483647;font:13px Arial}
            .zm-db-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.6)}
            .zm-db-win{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
                width:560px;max-width:94vw;max-height:88vh;display:flex;flex-direction:column;
                background:#0f1117;color:#e8eaf6;border:1px solid #E67E00;border-radius:12px;
                box-shadow:0 12px 48px rgba(0,0,0,.6)}
            .zm-db-head{display:flex;justify-content:space-between;align-items:center;
                padding:12px 16px;border-bottom:1px solid #2a2d3e;color:#E67E00;font-weight:bold}
            .zm-db-body{padding:12px 16px;overflow-y:auto}
            .zm-db-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;
                border-top:1px solid #2a2d3e}
            .zm-db-note{font-size:11px;color:#7986cb;margin-bottom:8px}
            .zm-db-sec-h{font-size:11px;font-weight:bold;color:#a0b0c0;margin:12px 0 6px;
                text-transform:uppercase;letter-spacing:.5px}
            .zm-db-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px}
            .zm-db-field{display:flex;flex-direction:column;gap:2px}
            .zm-db-field span{font-size:10px;color:#7986cb}
            .zm-db-field input,.zm-db-field select,.zm-db-agg-row input,.zm-db-filter-row input[type=text],
            #zm-db-modal textarea{background:#1a1d2e;border:1px solid #2a2d3e;color:#e8eaf6;
                border-radius:6px;padding:6px 8px;font:12px Arial;width:100%;box-sizing:border-box}
            .zm-db-field input:focus,.zm-db-field select:focus,#zm-db-modal textarea:focus{outline:none;border-color:#E67E00}
            .zm-db-agg-row{display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap}
            .zm-db-agg-lbl{font-size:11px;color:#bdc1d1;min-width:130px}
            .zm-db-agg-row input{width:70px !important}
            .zm-db-agg-l{font-size:11px;color:#7986cb}
            .zm-db-agg-products{display:flex;flex-wrap:wrap;gap:3px;flex:1}
            .zm-db-chip{font-size:9px;padding:1px 6px;border-radius:8px;background:#1e2040;
                color:#9aa0b0;border:1px solid #2a2d3e;font-family:monospace}
            .zm-db-filter-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
            .zm-db-filter-row input[type=text]{flex:1;width:auto}
            .zm-db-chk{display:flex;align-items:center;gap:6px;font-size:12px;color:#bdc1d1;
                cursor:pointer;white-space:nowrap}
            .zm-db-flag{margin-bottom:4px}
            .zm-db-error{margin-top:10px;padding:8px 10px;font-size:12px;background:#2a0000;
                border:1px solid #e53935;border-radius:6px;color:#ff8a80}
            #zm-db-toast{position:fixed;bottom:18px;right:18px;z-index:2147483647;
                background:#0f1117;border:1px solid #43a047;border-radius:10px;
                padding:12px 16px;color:#e8eaf6;font:13px Arial;
                box-shadow:0 8px 32px rgba(0,0,0,.55)}
            .zm-db-toast-t{font-weight:bold;color:#66bb6a;margin-bottom:4px}
            .zm-db-toast-link{color:#E67E00;font-size:12px}
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
        `;
    document.head.appendChild(s);
  }
  function createWidget() {
    let w = document.getElementById("__zm_w");
    if (!w) {
      w = document.createElement("div");
      w.id = "__zm_w";
      document.body.appendChild(w);
    }
    return w;
  }
  if (typeof location !== "undefined" && typeof document !== "undefined") {
    routeByHost();
  }
})();
