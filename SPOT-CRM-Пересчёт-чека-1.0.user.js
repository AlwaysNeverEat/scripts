// ==UserScript==
// @name         SPOT CRM: Пересчёт чека
// @namespace    zamena-masla-spot.ru
// @version      1.7.513
// @description  Пересчёт стоимости услуги по чеку /sale/{id} по актуальным ценам
// @match        *://crm.zamena-masla-spot.ru/sale/*
// @match        *://crm.zamena-masla-spot.ru/for-sale/*
// @match        *://crm.zamena-masla-spot.ru/foreign_sale/*
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/SPOT-CRM-%D0%9F%D0%B5%D1%80%D0%B5%D1%81%D1%87%D1%91%D1%82-%D1%87%D0%B5%D0%BA%D0%B0-1.0.user.js
// @downloadURL  https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/SPOT-CRM-%D0%9F%D0%B5%D1%80%D0%B5%D1%81%D1%87%D1%91%D1%82-%D1%87%D0%B5%D0%BA%D0%B0-1.0.user.js
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

  // userscript/src/spot-crm-recalc/app.js
  function getDefaults2() {
    const d = getDefaults();
    const strip = ({ b, n, price, v }) => ({ b, n, price, v });
    return {
      gear75W90: d.gear75W90.map(strip),
      cvt: d.cvt.map(strip),
      atf: [d.atf.zic, d.atf.rolfDexron6, d.atf.rolfMulti].map(strip)
    };
  }
  function parseNum(str) {
    return parseFloat((str || "").replace(/ /g, "").replace(/\s/g, "").replace(",", ".")) || 0;
  }
  function parseReceipt() {
    const rows = document.querySelectorAll("table#sales_items tr.table__row[data-id]");
    const items = [];
    for (const row of rows) {
      const cell = (n) => {
        const td = row.querySelector(`[data-name="${n}"]`);
        return td ? td.textContent.trim() : "";
      };
      const name = cell("name");
      if (!name) continue;
      const price = parseNum(cell("price"));
      const count = parseNum(cell("count"));
      if (!price || !count) continue;
      let type = "oil";
      if (/салонный фильтр/i.test(name)) type = "sf";
      else if (/воздушный фильтр/i.test(name)) type = "vf";
      else if (/масляный фильтр/i.test(name)) type = "mf";
      const modelMatch = name.match(/^\S+\s+(.+)$/);
      const model = modelMatch ? modelMatch[1].trim() : name;
      items.push({ name, model, type, receiptPrice: Math.ceil(price), count, volume: Math.round(count / 10 * 10) / 10 });
    }
    return items;
  }
  function matchEngineOil(receiptName, shopOils) {
    const text = receiptName.toUpperCase().replace(/[,.]/g, " ");
    const viscMatch = text.match(/\b(\d+W-\d+)\b/);
    const visc = viscMatch ? viscMatch[1] : null;
    if (!visc) return null;
    const aceaMatch = text.match(/ACEA\s+([A-C]\d)/);
    const acea = aceaMatch ? aceaMatch[1] : null;
    const BRANDS = ["LIQUI MOLY", "ROLF", "MOBIL", "ZIC", "GM", "SHELL", "CASTROL", "MOTUL", "IDEMITSU", "SPOT"];
    let brandKey = null;
    for (const b of BRANDS) {
      if (text.includes(b)) {
        brandKey = b;
        break;
      }
    }
    let cands = shopOils.filter((o) => o.v === visc);
    if (brandKey) {
      const byBrand = cands.filter((o) => o.b.toUpperCase().replace(/\s+/g, "") === brandKey.replace(/\s+/g, ""));
      if (byBrand.length) cands = byBrand;
    }
    if (acea && cands.length > 1) {
      const byAcea = cands.filter((o) => o.a.some((a) => a.replace(/\s/g, "").toUpperCase().includes("ACEA" + acea)));
      if (byAcea.length) cands = byAcea;
    }
    return cands[0] || null;
  }
  var receipt = [];
  var state = {};
  function initState() {
    receipt = parseReceipt();
    const oilItem = receipt.find((r) => r.type === "oil");
    const shopOils = getShopOils();
    const matched = oilItem ? matchEngineOil(oilItem.name, shopOils) : null;
    const firstKey = shopOils[0] ? shopOils[0].b + "|" + shopOils[0].n : "";
    state = {
      mode: "engine",
      collapsed: false,
      // ДВС
      engineOilKey: matched ? matched.b + "|" + matched.n : firstKey,
      engineOilMatched: !!matched,
      engineOilPriceOvr: null,
      engineVolume: oilItem ? oilItem.volume : 0,
      sump: true,
      sumpPrice: 550,
      flush: "none",
      // МКПП/АКПП/CVT
      neOilIdx: 0,
      neVolume: oilItem ? oilItem.volume : 0,
      atpType: "partial",
      atpFilter: false,
      cvtFilterCoarse: false,
      cvtFilterFine: false,
      // Фильтры
      filters: {
        mf: mkFilter("mf"),
        vf: mkFilter("vf"),
        sf: mkFilter("sf")
      },
      showFilterModal: false,
      filterModalText: ""
    };
  }
  function mkFilter(type) {
    const item = receipt.find((r) => r.type === type);
    return {
      enabled: !!item,
      name: item ? item.model : "",
      price: item ? item.receiptPrice : 0,
      work: type === "vf" ? 350 : type === "sf" ? 550 : 0
    };
  }
  var C = Math.ceil;
  function getEngineOil() {
    const k = state.engineOilKey;
    const oils = getShopOils();
    return oils.find((o) => o.b + "|" + o.n === k) || oils[0] || null;
  }
  function effectiveOilPrice(oil) {
    const ovr = state.engineOilPriceOvr;
    return ovr !== null && isFinite(ovr) && ovr >= 0 ? ovr : oil ? oil.price : 0;
  }
  function filtersTotal() {
    const { mf, vf, sf } = state.filters;
    let s = 0;
    if (mf.enabled && mf.price > 0) s += mf.price;
    if (vf.enabled && vf.price > 0) s += vf.price + (vf.work || 0);
    if (sf.enabled && sf.price > 0) s += sf.price + (sf.work || 0);
    return s;
  }
  function flushCost(vol) {
    if (state.flush === "5min") return 1180;
    if (state.flush === "full") return C(vol * 0.9 * 300) + 550;
    return 0;
  }
  function calcTotal() {
    if (state.mode === "engine") {
      const oil2 = getEngineOil();
      const vol2 = state.engineVolume;
      return C(effectiveOilPrice(oil2) * vol2) + filtersTotal() + flushCost(vol2) + (state.sump ? state.sumpPrice : 0);
    }
    const defs = getDefaults2();
    const oilList = state.mode === "gear" ? defs.gear75W90 : state.mode === "atf" ? defs.atf : defs.cvt;
    const oil = oilList[Math.min(state.neOilIdx, oilList.length - 1)] || oilList[0];
    const vol = state.neVolume;
    const base = C(oil.price * vol);
    if (state.mode === "gear") return base + 2450;
    const labor = 550 + (state.atpType === "partial" ? 1210 : 0);
    if (state.mode === "cvt")
      return base + labor + (state.cvtFilterCoarse ? 1700 : 0) + (state.cvtFilterFine ? 3350 : 0);
    return base + labor + (state.atpFilter ? 1700 : 0);
  }
  function injectStyles() {
    const css = `
#sr-panel{position:fixed;bottom:20px;right:20px;z-index:99999;width:340px;
  background:#1a1d27;color:#d0d4e0;border-radius:10px;
  box-shadow:0 4px 24px rgba(0,0,0,.6);font:13px/1.4 system-ui,sans-serif;
  overflow:hidden;border:1px solid #2e3348;}
#sr-panel.sr-hidden{display:none}
.sr-hdr{display:flex;align-items:center;justify-content:space-between;
  background:#13151f;padding:9px 12px;border-bottom:1px solid #2e3348;gap:6px}
.sr-title{font-weight:700;font-size:13px;color:#7ba7e0;letter-spacing:.3px}
.sr-body{padding:10px 12px;max-height:80vh;overflow-y:auto}
.sr-body::-webkit-scrollbar{width:4px}
.sr-body::-webkit-scrollbar-thumb{background:#3a4060;border-radius:3px}
.sr-tabs{display:flex;gap:3px;flex-wrap:wrap;padding:7px 12px 5px;border-bottom:1px solid #2e3348}
.sr-tab{padding:3px 9px;border-radius:12px;font-size:11px;cursor:pointer;
  background:#252838;color:#8090b0;border:1px solid #2e3348;transition:all .15s}
.sr-tab.on{background:#2a4880;color:#aac4f5;border-color:#3a5890}
.sr-sec{margin-bottom:9px}
.sr-lbl{font-size:11px;color:#7080a0;margin-bottom:3px}
.sr-row{display:flex;align-items:center;gap:5px;margin-bottom:4px;flex-wrap:wrap}
.sr-sel{flex:1;background:#252838;color:#d0d4e0;border:1px solid #2e3348;
  border-radius:5px;padding:4px 6px;font-size:12px}
.sr-inp{background:#252838;color:#d0d4e0;border:1px solid #2e3348;
  border-radius:5px;padding:3px 6px;font-size:12px;width:68px}
.sr-sel:focus,.sr-inp:focus{outline:none;border-color:#4a6898}
.sr-chip{padding:2px 8px;border-radius:10px;font-size:11px;cursor:pointer;
  background:#252838;color:#7080a0;border:1px solid #2e3348;transition:all .15s;white-space:nowrap}
.sr-chip.on{background:#2a4880;color:#aac4f5;border-color:#3a5890}
.sr-chip:disabled{opacity:.4;cursor:default}
.sr-frow{display:flex;align-items:center;gap:5px;margin-bottom:3px;
  background:#1e2132;border-radius:6px;padding:4px 7px}
.sr-flbl{font-size:11px;font-weight:700;min-width:22px;color:#5a9ade}
.sr-fname{flex:1;font-size:11px;color:#8898b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-ftog{font-size:10px;padding:1px 6px;border-radius:8px;cursor:pointer;
  background:#252838;color:#7080a0;border:1px solid #2e3348}
.sr-ftog.on{background:#1a3a20;color:#5acc70;border-color:#2a5030}
.sr-chips{display:flex;gap:3px;flex-wrap:wrap;margin:1px 0 4px 28px}
.sr-div{border:none;border-top:1px solid #2e3348;margin:7px 0}
.sr-total{background:#13151f;border-radius:7px;padding:8px 10px;
  display:flex;justify-content:space-between;align-items:center;border:1px solid #2e3348}
.sr-tlbl{font-size:12px;color:#8090b0}
.sr-tsum{font-size:22px;font-weight:800;color:#5acc70}
.sr-btn{padding:3px 9px;border-radius:6px;font-size:11px;cursor:pointer;
  border:1px solid #2e3348;background:#252838;color:#9098b0;transition:all .15s}
.sr-btn:hover{background:#2e3450;color:#c0c8e0}
.sr-btn:disabled{opacity:.4;cursor:default}
.sr-warn{color:#e08030;font-size:11px}
.sr-ok{color:#4acc60;font-size:11px}
#sr-modal{position:fixed;top:0;left:0;width:100%;height:100%;
  background:rgba(0,0,0,.65);z-index:100000;display:flex;align-items:center;justify-content:center}
#sr-mbox{background:#1a1d27;border-radius:10px;padding:18px;width:380px;max-width:95vw;
  box-shadow:0 4px 20px rgba(0,0,0,.5);border:1px solid #2e3348;color:#d0d4e0}
#sr-mbox h4{margin:0 0 10px;color:#7ba7e0;font-size:14px}
#sr-mta{width:100%;box-sizing:border-box;background:#252838;color:#d0d4e0;
  border:1px solid #2e3348;border-radius:6px;padding:7px;
  font:12px/1.5 monospace;resize:vertical;min-height:90px}
.sr-mhint{font-size:10px;color:#5a6070;margin-top:4px}
.sr-mbtns{display:flex;gap:6px;margin-top:10px;justify-content:flex-end}
.sr-pri{background:#1e4080;color:#aac4f5;border-color:#2a5090}
.sr-pri:hover{background:#254890}
#sr-panel.sr-collapsed{width:auto;border-radius:20px;background:transparent;
  box-shadow:none;border:none;overflow:visible}
.sr-tray{padding:7px 16px;background:#13151f;color:#5a9ade;
  border:1px solid #2e3348;border-radius:20px;font-size:12px;
  cursor:pointer;white-space:nowrap;display:block;
  box-shadow:0 2px 12px rgba(0,0,0,.5);transition:all .15s;
  font:12px/1.4 system-ui,sans-serif}
.sr-tray:hover{background:#1e2640;color:#7ba7e0;border-color:#3a5890}
        `;
    if (typeof GM_addStyle !== "undefined") {
      GM_addStyle(css);
    } else {
      const s = document.createElement("style");
      s.textContent = css;
      (document.head || document.documentElement).appendChild(s);
    }
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  var panel;
  function render() {
    if (!panel) return;
    panel.classList.toggle("sr-collapsed", state.collapsed);
    panel.innerHTML = buildHTML();
    bindAll();
  }
  function buildHTML() {
    if (state.collapsed) {
      return `<button class="sr-tray" id="sr-expand">узнать актуальную стоимость</button>`;
    }
    return hdr() + tabs() + `<div class="sr-body">${oilSec()}${engSec()}${filterSec()}${totalSec()}</div>` + (state.showFilterModal ? modal() : "");
  }
  function hdr() {
    const oilItem = receipt.find((r) => r.type === "oil");
    const info = oilItem ? `<span style="font-size:10px;color:#5a6a80;margin-right:6px">${oilItem.volume}л</span>` : "";
    return `<div class="sr-hdr"><span class="sr-title">ПЕРЕСЧЁТ ЧЕКА</span>${info}<button class="sr-btn" id="sr-minimize" style="padding:1px 7px" title="Свернуть">−</button></div>`;
  }
  function tabs() {
    return `<div class="sr-tabs">
            ${[["engine", "ДВС"], ["gear", "МКПП·дифы"], ["atf", "АКПП"], ["cvt", "CVT"]].map(
      ([id, lbl]) => `<button class="sr-tab${state.mode === id ? " on" : ""}" data-mode="${id}">${lbl}</button>`
    ).join("")}
        </div>`;
  }
  function oilSec() {
    if (state.mode === "engine") {
      const oils = getShopOils();
      const oil2 = getEngineOil();
      const vol2 = state.engineVolume;
      const p = effectiveOilPrice(oil2);
      const key = state.engineOilKey;
      const matchNote = state.engineOilMatched ? `<div class="sr-ok" style="margin-bottom:3px">✓ авто-матч</div>` : `<div class="sr-warn" style="margin-bottom:3px">⚠ выберите масло вручную</div>`;
      return `<div class="sr-sec">
                <div class="sr-lbl">Масло (ДВС)</div>
                ${matchNote}
                <div class="sr-row">
                    <select class="sr-sel" id="sr-oil-sel">
                        ${oils.map((o) => {
        const k = o.b + "|" + o.n;
        return `<option value="${esc(k)}"${k === key ? " selected" : ""}>${esc(o.b)} ${esc(o.n)} — ${o.price}₽/л</option>`;
      }).join("")}
                    </select>
                </div>
                <div class="sr-row">
                    <span class="sr-lbl" style="margin:0">Цена/л:</span>
                    <input type="number" class="sr-inp" id="sr-oil-p" value="${p}" min="0" step="1" style="width:60px"/>
                    ${state.engineOilPriceOvr !== null ? `<button class="sr-btn" id="sr-oil-p-rst" style="font-size:10px">↺</button>` : ""}
                    <span class="sr-lbl" style="margin:0">×</span>
                    <input type="number" class="sr-inp" id="sr-eng-vol" value="${vol2}" min="0" step="0.1" style="width:52px"/>
                    <span class="sr-lbl" style="margin:0">л = <b style="color:#c8d8f0">${C(p * vol2)}₽</b></span>
                </div>
            </div>`;
    }
    const defs = getDefaults2();
    const list = state.mode === "gear" ? defs.gear75W90 : state.mode === "atf" ? defs.atf : defs.cvt;
    const idx = Math.min(state.neOilIdx, list.length - 1);
    const oil = list[idx];
    const vol = state.neVolume;
    const modeLabel = state.mode === "gear" ? "МКПП / дифы / раздатка" : state.mode === "atf" ? "АКПП" : "Вариатор (CVT)";
    return `<div class="sr-sec">
            <div class="sr-lbl">${modeLabel}</div>
            <div class="sr-row">
                <select class="sr-sel" id="sr-ne-sel">
                    ${list.map((o, i) => `<option value="${i}"${i === idx ? " selected" : ""}>${esc(o.b)} ${esc(o.n)} — ${o.price}₽/л</option>`).join("")}
                </select>
            </div>
            <div class="sr-row">
                <span class="sr-lbl" style="margin:0">Объём:</span>
                <input type="number" class="sr-inp" id="sr-ne-vol" value="${vol}" min="0" step="0.1" style="width:60px"/>
                <span class="sr-lbl" style="margin:0">л = <b style="color:#c8d8f0">${C(oil.price * vol)}₽</b></span>
            </div>
        </div>`;
  }
  var VF_WORK = [{ l: "без работы", v: 0 }, { l: "защёлки", v: 350 }, { l: "болты", v: 600 }, { l: "разбор", v: 1150 }];
  var SF_WORK = [{ l: "без работы", v: 0 }, { l: "бардачок", v: 550 }, { l: "под педалью", v: 990 }];
  function filterSec() {
    if (state.mode !== "engine") return "";
    const { mf, vf, sf } = state.filters;
    const hasModels = receipt.some((r) => r.type !== "oil");
    const frow = (key, lbl, f, workOpts) => {
      const chips = workOpts ? `<div class="sr-chips">${workOpts.map(
        (opt) => `<button class="sr-chip${f.work === opt.v ? " on" : ""}" data-work="${key}" data-val="${opt.v}">${opt.l}${opt.v ? ` +${opt.v}₽` : ""}</button>`
      ).join("")}</div>` : "";
      return `<div class="sr-frow">
                <button class="sr-ftog${f.enabled ? " on" : ""}" data-ftog="${key}">${f.enabled ? "вкл" : "выкл"}</button>
                <span class="sr-flbl">${lbl}</span>
                <span class="sr-fname" title="${esc(f.name)}">${esc(f.name || "—")}</span>
                <input type="number" class="sr-inp" style="width:55px" data-fp="${key}" value="${f.price}" min="0"/>
            </div>${chips}`;
    };
    return `<hr class="sr-div"><div class="sr-sec">
            <div class="sr-row" style="margin-bottom:5px">
                <span class="sr-lbl" style="margin:0">Фильтры</span>
                <button class="sr-btn" id="sr-copy-arts"${!hasModels ? " disabled" : ""}>📋 артикулы</button>
                <button class="sr-btn" id="sr-upd-prices">✎ обновить цены</button>
            </div>
            ${frow("mf", "МФ", mf, null)}
            ${frow("vf", "ВФ", vf, VF_WORK)}
            ${frow("sf", "СФ", sf, SF_WORK)}
        </div>`;
  }
  function engSec() {
    if (state.mode === "engine") {
      const { sump, sumpPrice, flush } = state;
      return `<hr class="sr-div"><div class="sr-sec">
                <div class="sr-row" title="снятие/установка защиты картера">
                    <span class="sr-lbl" style="margin:0">Защита картера:</span>
                    <button class="sr-chip${sump ? " on" : ""}" id="sr-sump-tog">${sump ? "вкл" : "выкл"}</button>
                    <input type="number" class="sr-inp" id="sr-sump-p" value="${sumpPrice}" min="0" style="width:58px"${!sump ? " disabled" : ""}/>₽
                </div>
                <div class="sr-row">
                    <span class="sr-lbl" style="margin:0">Промывка:</span>
                    <button class="sr-chip${flush === "none" ? " on" : ""}" data-flush="none">нет</button>
                    <button class="sr-chip${flush === "5min" ? " on" : ""}" data-flush="5min">5-мин +1180₽</button>
                    <button class="sr-chip${flush === "full" ? " on" : ""}" data-flush="full">полная</button>
                </div>
            </div>`;
    }
    if (state.mode === "gear") return "";
    const { atpType, atpFilter, cvtFilterCoarse, cvtFilterFine } = state;
    const isCvt = state.mode === "cvt";
    const labor = 550 + (atpType === "partial" ? 1210 : 0);
    return `<hr class="sr-div"><div class="sr-sec">
            <div class="sr-row">
                <span class="sr-lbl" style="margin:0">Замена:</span>
                <button class="sr-chip${atpType === "partial" ? " on" : ""}" data-atp="partial">Частичная</button>
                <button class="sr-chip${atpType === "full" ? " on" : ""}" data-atp="full">Полная</button>
            </div>
            <div class="sr-lbl">Работа: ${labor}₽</div>
            ${isCvt ? `
            <label style="display:flex;gap:5px;align-items:center;font-size:12px;margin-top:4px">
                <input type="checkbox" id="sr-cvt-c"${cvtFilterCoarse ? " checked" : ""}> Фильтр грубой (+1700₽)
            </label>
            <label style="display:flex;gap:5px;align-items:center;font-size:12px;margin-top:2px">
                <input type="checkbox" id="sr-cvt-f"${cvtFilterFine ? " checked" : ""}> Фильтр тонкой (+3350₽)
            </label>` : `
            <label style="display:flex;gap:5px;align-items:center;font-size:12px;margin-top:4px">
                <input type="checkbox" id="sr-atp-f"${atpFilter ? " checked" : ""}> Фильтр АКПП (+1700₽)
            </label>`}
        </div>`;
  }
  function totalSec() {
    const total = calcTotal();
    let breakdown = "";
    if (state.mode === "engine") {
      const oil = getEngineOil();
      const vol = state.engineVolume;
      const parts = [`масло ${C(effectiveOilPrice(oil) * vol)}₽`];
      const flt = filtersTotal();
      const fl = flushCost(vol);
      if (flt) parts.push(`фильтры ${flt}₽`);
      if (fl) parts.push(`промывка ${fl}₽`);
      if (state.sump) parts.push(`защита картера ${state.sumpPrice}₽`);
      breakdown = `<div style="font-size:10px;color:#5a6a80;margin-top:2px">${parts.join(" + ")}</div>`;
    }
    return `<hr class="sr-div"><div class="sr-total">
            <div><div class="sr-tlbl">Итого (актуальные цены)</div>${breakdown}</div>
            <div class="sr-tsum">${total}₽</div>
        </div>`;
  }
  function modal() {
    return `<div id="sr-modal"><div id="sr-mbox">
            <h4>Обновить стоимости фильтров</h4>
            <textarea id="sr-mta" rows="5" placeholder="вф AG 762 - 1207р&#10;мф LYNX LC-171 - 495р&#10;сф AG 655 CF - 696р">${esc(state.filterModalText)}</textarea>
            <div class="sr-mhint">Формат: <code>тип название - ценар</code> · тип: <b>вф / мф / сф</b></div>
            <div class="sr-mbtns">
                <button class="sr-btn" id="sr-m-cancel">Отмена</button>
                <button class="sr-btn sr-pri" id="sr-m-apply">Применить</button>
            </div>
        </div></div>`;
  }
  function bindAll() {
    q("sr-minimize", (el) => el.onclick = () => {
      state.collapsed = true;
      render();
    });
    q("sr-expand", (el) => el.onclick = () => {
      state.collapsed = false;
      render();
    });
    panel.querySelectorAll("[data-mode]").forEach((b) => b.onclick = () => {
      state.mode = b.dataset.mode;
      render();
    });
    q("sr-oil-sel", (el) => el.onchange = () => {
      state.engineOilKey = el.value;
      state.engineOilMatched = false;
      state.engineOilPriceOvr = null;
      render();
    });
    q("sr-oil-p", (el) => el.oninput = () => {
      const v = parseFloat(el.value);
      state.engineOilPriceOvr = isFinite(v) && v >= 0 ? v : null;
      refreshTotal();
    });
    q("sr-oil-p-rst", (el) => el.onclick = () => {
      state.engineOilPriceOvr = null;
      render();
    });
    q("sr-eng-vol", (el) => el.oninput = () => {
      const v = parseFloat(el.value);
      if (isFinite(v) && v >= 0) state.engineVolume = v;
      refreshTotal();
    });
    q("sr-ne-sel", (el) => el.onchange = () => {
      state.neOilIdx = +el.value;
      render();
    });
    q("sr-ne-vol", (el) => el.oninput = () => {
      const v = parseFloat(el.value);
      if (isFinite(v) && v >= 0) state.neVolume = v;
      refreshTotal();
    });
    panel.querySelectorAll("[data-ftog]").forEach((b) => b.onclick = () => {
      state.filters[b.dataset.ftog].enabled ^= 1;
      render();
    });
    panel.querySelectorAll("[data-fp]").forEach((inp) => inp.oninput = () => {
      state.filters[inp.dataset.fp].price = Math.ceil(+inp.value || 0);
      refreshTotal();
    });
    panel.querySelectorAll("[data-work]").forEach((b) => b.onclick = () => {
      state.filters[b.dataset.work].work = +b.dataset.val;
      render();
    });
    q("sr-copy-arts", (el) => el.onclick = () => {
      const models = receipt.filter((r) => r.type !== "oil").map((r) => r.model);
      GM_setClipboard(models.join("\n"));
      el.textContent = "✓ скопировано";
      setTimeout(() => {
        if (document.getElementById("sr-copy-arts")) el.textContent = "📋 артикулы";
      }, 1500);
    });
    q("sr-upd-prices", (el) => el.onclick = () => {
      state.showFilterModal = true;
      render();
    });
    q("sr-m-cancel", (el) => el.onclick = () => {
      state.showFilterModal = false;
      state.filterModalText = "";
      render();
    });
    q("sr-m-apply", (el) => el.onclick = () => {
      const ta = document.getElementById("sr-mta");
      if (ta) {
        state.filterModalText = ta.value;
        applyFilterModal(ta.value);
      }
      state.showFilterModal = false;
      render();
    });
    q("sr-modal", (el) => el.onclick = (e) => {
      if (e.target === el) {
        state.showFilterModal = false;
        render();
      }
    });
    q("sr-sump-tog", (el) => el.onclick = () => {
      state.sump = !state.sump;
      render();
    });
    q("sr-sump-p", (el) => el.oninput = () => {
      state.sumpPrice = +el.value || 0;
      refreshTotal();
    });
    panel.querySelectorAll("[data-flush]").forEach((b) => b.onclick = () => {
      state.flush = b.dataset.flush;
      render();
    });
    panel.querySelectorAll("[data-atp]").forEach((b) => b.onclick = () => {
      state.atpType = b.dataset.atp;
      render();
    });
    q("sr-atp-f", (el) => el.onchange = () => {
      state.atpFilter = el.checked;
      render();
    });
    q("sr-cvt-c", (el) => el.onchange = () => {
      state.cvtFilterCoarse = el.checked;
      render();
    });
    q("sr-cvt-f", (el) => el.onchange = () => {
      state.cvtFilterFine = el.checked;
      render();
    });
  }
  function q(id, fn) {
    const el = document.getElementById(id);
    if (el) fn(el);
  }
  function refreshTotal() {
    const el = panel.querySelector(".sr-tsum");
    if (el) el.textContent = calcTotal() + "₽";
  }
  function parseFiltersInput(text) {
    const out = {};
    const MAP = { "вф": "vf", "мф": "mf", "сф": "sf" };
    (text || "").split(/\r?\n/).forEach((raw) => {
      const line = raw.trim();
      const m = line.match(/^(вф|мф|сф)\s+(.+?)\s*[-–—]\s*([\d\s]+)\s*(?:р|руб|₽)?\s*$/i);
      if (!m) return;
      const key = MAP[m[1].toLowerCase()];
      if (!key) return;
      const price = parseInt(m[3].replace(/\s+/g, ""), 10);
      if (isFinite(price) && price > 0) out[key] = { name: m[2].trim(), price };
    });
    return out;
  }
  function applyFilterModal(text) {
    const parsed = parseFiltersInput(text);
    ["vf", "mf", "sf"].forEach((t) => {
      if (!parsed[t]) return;
      state.filters[t].name = parsed[t].name;
      state.filters[t].price = Math.ceil(parsed[t].price);
      state.filters[t].enabled = true;
    });
  }
  function init() {
    injectStyles();
    initState();
    panel = document.createElement("div");
    panel.id = "sr-panel";
    (document.body || document.documentElement).appendChild(panel);
    render();
  }
  var TABLE_WAIT_MS = 3e3;
  var t0 = Date.now();
  function tryInit() {
    if (document.querySelector("table#sales_items") || Date.now() - t0 > TABLE_WAIT_MS) {
      init();
    } else {
      setTimeout(tryInit, 250);
    }
  }
  setTimeout(tryInit, 300);
})();
