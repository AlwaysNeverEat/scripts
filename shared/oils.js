// ─────────────────────────────────────────────────────────────────────────────
// Shared oil data: shop inventory, Motul approvals DB, default gear/ATF oils.
// Pure data — no DOM, no state.
// ─────────────────────────────────────────────────────────────────────────────

export function getShopOils() { return [
    // Liqui Moly
    { b:'Liqui Moly', n:'5W-30 Top Tec', price:2400, v:'5W-30',
      a:['API SP','ACEA C2','ACEA C3','LL 04','LL 01','MB 229.31','MB 229.51','MB 229.52','FIAT 9.55535-S3','FORD WSS-M2C 917-A','VW 502 00','VW 505 00','VW 505 01','VW 504 00','VW 507 00','PORSCHE C30'],
      ad:['износ','отложения','температура','топливо','масло-угар'] },
    { b:'Liqui Moly', n:'5W-40 Top Tec', price:2300, v:'5W-40',
      a:['API SN','ACEA C3','MB 229.31','PORSCHE A40','VW 505 00','VW 505 01','LL 04','FIAT 9.55535-H2','FIAT 9.55535-M2','FIAT 9.55535-S2','FORD WSS-M2C 917-A','GM DEXOS2','RN 0700','RN 0710'],
      ad:['малозольное','износ','отложения','температура','топливо','масло-угар'] },
    { b:'Liqui Moly', n:'Leichtlauf HC 7 5W-30', price:2000, v:'5W-30',
      a:['ACEA A3/B4','API SN','LL 98','MB 229.3','RN 0700','RN 0710','VW 502 00','VW 505 00','GM LL-A-025','GM LL-B-025'],
      ad:['стиль вождения','износ','отложения','топливо','масло-угар'] },
    { b:'Liqui Moly', n:'Leichtlauf HC 7 5W-40', price:2100, v:'5W-40',
      a:['API SN Plus','ACEA A3/B4','LL 98','MB 229.3','PORSCHE A40','VW 502 00','VW 505 00','GM LL-A-025','GM LL-B-025','RN 0700','RN 0710'],
      ad:['износ','отложения','топливо','масло-угар'] },
    { b:'Liqui Moly', n:'5W-30 Molygen', price:2300, v:'5W-30',
      a:['API SP','ILSAC GF-6A','FIAT 9.55535-CR1','FORD WSS-M2C 961-A1','FORD WSS-M2C 946-A','FORD WSS-M2C 946-B1'],
      ad:['Америка/Азия','износ','отложения','топливо','масло-угар','антифрикционные'] },
    { b:'Liqui Moly', n:'5W-40 Molygen', price:2200, v:'5W-40',
      a:['API SN','ACEA A3/B4','LL 01','FIAT 9.55535-Z2','FIAT 9.55535-H2','FIAT 9.55535-N2','MB 229.5','PORSCHE A40','RN 0700','RN 0710','VW 502 00','VW 505 00','GM LL-B-025'],
      ad:['Америка/Азия','износ','отложения','топливо','масло-угар','антифрикционные'] },
    // ROLF
    { b:'ROLF', n:'Professional 5W-30 A5/B5', price:1500, v:'5W-30',
      a:['API SP','ACEA A5/B5','FORD WSS-M2C913-A','FORD WSS-M2C913-B','FORD WSS-M2C913-C','FORD WSS-M2C913-D','JAGUAR STJLR.03.5003'],
      ad:['внедорожники','пуск в мороз','износ','отложения','масло-угар'] },
    { b:'ROLF', n:'Professional AM 5W-40', price:1700, v:'5W-40',
      a:['API CF','API SN Plus','ACEA A3/B3','ACEA A3/B4','LL 01','FIAT 9.55535-Z2','GM LL-A-025','GM LL-B-025','PORSCHE A40','PSA B71 2293','PSA B71 2296','RN 0700','RN 0710','VW 502 00','VW 505 00','MB 226.5','MB 229.5'],
      ad:['моющие присадки','отложения','нагар','быстрый запуск'] },
    { b:'ROLF', n:'Professional 5W-30 C3', price:1700, v:'5W-30',
      a:['API SN','ACEA C3','LL 04','PORSCHE C30','VW 504 00','VW 507 00','MB 229.51'],
      ad:['антикоррозия','моющие присадки','для турбо'] },
    { b:'ROLF', n:'Professional 0W-20', price:1950, v:'0W-20',
      a:['API SN','ACEA C5','FORD WSS-M2C947-B1','JAGUAR STJLR.03.5006','VW 508','VW 509'],
      ad:['низкосульфатное','нейтрализация выхлопа','экономия топлива'] },
    // Mobil
    { b:'Mobil', n:'Super 3000 FE 5W-30', price:1800, v:'5W-30',
      a:['API CF','API SJ','API SL','API SM','API SN','API SN Plus','API SP','ACEA A5/B5','FORD WSS-M2C913-C','FORD WSS-M2C913-D','JAGUAR STJLR'],
      ad:['без саж.ф.','всесезонное','антикоррозия','отложения','топливо','любой режим езды'] },
    { b:'Mobil', n:'Super 3000 5W-40', price:1950, v:'5W-40',
      a:['FIAT 9.55535-G2','FIAT 9.55535-M2','API CF','ACEA A3/B3','ACEA A3/B4','API SL','API SM','API SN'],
      ad:['любой стиль езды','всесезонное'] },
    { b:'Mobil', n:'Ultra 10W-40', price:1350, v:'10W-40',
      a:['API SN','API SL','ACEA A3/B3','API SN Plus','MB 229.1','API SJ','API SM'],
      ad:['шлам','нагар','коррозия','пуск в мороз','топливо','масло-угар'] },
    { b:'Mobil', n:'ESP 5W-30', price:2300, v:'5W-30',
      a:['ACEA C3','GM DEXOS2','MB 229.31','MB 229.51','MB 229.52','PSA B71 2290','PSA B71 2297','API CF','API SJ','API SL','API SM','API SN'],
      ad:['малозольное','износ','отложения','экстремальные температуры','топливо','масло-угар'] },
    // ZIC
    { b:'ZIC', n:'X8 SE 5W-30', price:1800, v:'5W-30',
      a:['API SP','ACEA A5/B5','FORD WSS-M2C913-D','RN 0700','JAGUAR STJLR 03.5003'],
      ad:['быстрый запуск','защита при нагрузках','отложения','нагар'] },
    { b:'ZIC', n:'X8 SE 5W-40', price:1850, v:'5W-40',
      a:['API SP','ACEA A3/B4','VW 502 00','VW 505 00','MB 229.5','MB 229.3','LL 01','RN 0700','RN 0710','PSA B71 2296','PORSCHE A40'],
      ad:['интервал','нагар','отложения','масло-угар'] },
    { b:'ZIC', n:'X9 FE 0W-20', price:1550, v:'0W-20',
      a:['API SP','ILSAC GF-6A','GM DEXOS1 Gen 3','GM DEXOS1'],
      ad:['бензин','топливо','низкотемпературное'] },
    // GM / Shell / Castrol
    { b:'GM', n:'5W-30 Dexos II', price:1600, v:'5W-30',
      a:['ACEA A3/B3','GM LL-B-025','VW 505 01','VW 502 00','VW 505 00','MB 229.51','LL 04','GM DEXOS2'],
      ad:['низкая зольность','износ','топливо','очистка'] },
    { b:'Shell', n:'5W-30 Ultra AM-L Kia/Hyundai', price:1950, v:'5W-30',
      a:['LL 04','MB 229.51','API SN','API CF','ACEA C3'],
      ad:['топливо','масло-угар','пуск в мороз','сажа','низкозольное'] },
    { b:'Castrol', n:'5W-30 EDGE LL', price:1950, v:'5W-30',
      a:['MB 229.51','MB 229.31','VW 507 00','VW 504 00','PORSCHE C30','ACEA C3'],
      ad:['всесезонное','отложения','любой стиль вождения'] },
    // Motul
    { b:'Motul', n:'5W-30 8100 X-Clean+', price:2450, v:'5W-30',
      a:['LL 04','MB 229.51','PORSCHE C30','VW 504 00','VW 507 00','ACEA C3','API SM','API CF'],
      ad:['снижает трение','износ','моющие присадки','нагар','сажа','топливо'] },
    { b:'Motul', n:'5W-30 SAVE-NERGY', price:2100, v:'5W-30',
      a:['FIAT 9.55535-G1','FORD WSS M2C 913D','JAGUAR STJLR 03.5003','ACEA A5/B5','API SL'],
      ad:['трение','тепловые нагрузки','износ','топливо','масло-угар'] },
    { b:'Motul', n:'5W-40 6100 SYN-CLEAN', price:2100, v:'5W-40',
      a:['FORD WSS M2C 917A','GM DEXOS2','MB 229.51','RN 0710','RN 0700','VW 505 00','VW 505 01','ACEA C3','API SN'],
      ad:['трение','тепловые нагрузки','износ','топливо','масло-угар'] },
    // Idemitsu / Zepro
    { b:'Idemitsu', n:'ZEPRO TOURING FS', price:2250, v:'5W-30',
      a:['API SP','ILSAC GF-6A'],
      ad:['отложения','осадки','топливо','масло-угар'] },
    { b:'Idemitsu', n:'ZEPRO EURO SPEC FS', price:2250, v:'5W-30',
      a:['API SP','ACEA C3'],
      ad:['отложения','сажа','топливо','масло-угар'] },
    // SPOT (наш бренд)
    { b:'SPOT', n:'OPTIMAL 5W-30', price:1450, v:'5W-30',
      a:['ACEA A3/B4','API SN','API CF','VW 502 00','VW 505 00','MB 226.5','MB 229.3','RN 0700','RN 0710','GM LL-B-025','PORSCHE A40','LL 01'],
      ad:['топливо','низкотемпературное','износ','антикоррозия'], isSpot:true, tier:'optimal' },
    { b:'SPOT', n:'OPTIMAL 5W-40', price:1450, v:'5W-40',
      a:['ACEA A3/B4','API SL','VW 502 00','VW 505 00','MB 229.3','RN 0700','RN 0710','АВТОВАЗ'],
      ad:['топливо','низкотемпературное','износ','антикоррозия'], isSpot:true, tier:'optimal' },
    { b:'SPOT', n:'PROFESSIONAL 5W-30', price:1700, v:'5W-30',
      a:['ACEA C3','API SN','API CF','FORD WSS-M2C 913-A','FORD WSS-M2C 913-B','FORD WSS-M2C 913-C','RN 0700','ILSAC GF-5'],
      ad:['топливо','низкотемпературное','износ','антикоррозия'], isSpot:true, tier:'pro' },
    { b:'SPOT', n:'PROFESSIONAL 5W-40', price:1700, v:'5W-40',
      a:['GM DEXOS2','MB 229.51','MB 229.31','MB 226.5','RN 0700','RN 0710','VW 505 00','VW 505 01','LL 04','PORSCHE A40','FORD WSS-M2C-917-A'],
      ad:['топливо','низкотемпературное','износ','антикоррозия'], isSpot:true, tier:'pro' },
];}

export function getMotulOils() { return {
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

export function getDefaults() { return {
    gear75W90:  [ {b:'ZIC',  n:'GFT 75W-90',          price:1380, v:'75W-90'},
                  {b:'ROLF', n:'Professional 75W-90', price:1950, v:'75W-90'} ],
    cvt:        [ {b:'ZIC',  n:'CVT Multi HP',                     price:1650, v:'CVT'},
                  {b:'ROLF', n:'Professional CVTF Multi',          price:1850, v:'CVT'} ],
    dct:        [ {b:'ZIC',  n:'DCT FE (для роботов с мокр. сц.)', price:1600, v:'DCT'},
                  {b:'ROLF', n:'Professional DCT',                 price:2000, v:'DCT'} ],
    atf: {
        zic: {
            b:'ZIC', n:'ATF Multi', price:1400, v:'ATF', _type:'multi',
            a:['Aisin Warner AW-1','DSIH 6p805 (Geely, Ssangyoung, Mahindra)','Ford Mercon LV','GM Dexron VI','Honda DW-1','Hyundai/KIA ATF SP-IV','Hyundai/KIA ATF SPH-IV','Hyundai/KIA ATF SP-IV RR','Hyundai/KIA ATF SP-IV M1','Hyundai/KIA NWS-9638','Mazda ATF-FZ','Mitsubishi ATF-J3','Mitsubishi ATF-PA','Mitsubishi SP-IV','Nissan Matic Fluid S','Nissan Matic Fluid W','Toyota WS','JWS 3324','Audi/VW G 055 540','Audi/VW G 055 005','Audi/VW G 055 162','BMW 83 22 0 142 516','MB 236.12','MB 236.14','MB 236.15','MB 236.41','Volvo 6 speed MY 2011-2013 (P/N 31256774)','Volvo 6 speed MY 2011-2013 (P/N 31256775)','ZF 6 Speed (S671 090 255)'],
        },
        rolfDexron6: {
            b:'ROLF', n:'ATF Dexron VI', price:1650, v:'ATF', _type:'dexron6',
            a:['BMW 83 22 0 142 516','BMW 83 22 0 163 514','BMW 83 22 0 397 114','BMW 83 22 2 152 426','BMW 83 22 2 289 720','BMW 83 22 2 305 396','BMW 83 22 2 305 397','BMW ATF 2','BMW ATF 3+','BMW ATF 6','Ford Mercon LV','GM AW-1','GM DEXRON VI','Honda DW-1','Hyundai / Kia ATF SPH-IV','Hyundai / Kia ATF SP-IV','Hyundai / Kia NWS-9638','Jaguar Fluid 8432','Jaguar LR023288','Land Rover LR0022460','Land Rover TYK500050','Mazda FZ','MB 236.12','MB 236.14','MB 236.15','MB 236.41','Mitsubishi ATF-J3','Nissan Matic S','Saab AW-1','Toyota WS','VW G 052 533','VW G 055 005','VW G 055 162','VW G 055 540','VW G 060 162'],
        },
        rolfMulti: {
            b:'ROLF', n:'Professional ATF Multi', price:1650, v:'ATF', _type:'multi',
            a:['Allison C-4','BMW 81 22 9 400 272','BMW 81 22 9 400 275','BMW 81 22 9 407 858','BMW 81 22 9 407 859','BMW 83 22 0 024 249','BMW 83 22 0 024 359','BMW 83 22 0 026 922','BMW 83 22 0 402 413','BMW 83 22 0 403 248','BMW 83 22 7 542 290','BMW 83 22 9 407 765','BMW 83 22 9 407 807','Chrysler / Dodge / Jeep ATF+4','Chrysler / Dodge / Jeep SP-III','DTFR 13C180','DTFR 38B100','Ford WSS-M2C922-A1','GM DEXRON II','GM DEXRON IID','GM DEXRON IIE','GM DEXRON IIIG','GM DEXRON IIIH','GM Type A Suffix A','Honda Z-1','Hyundai / Kia ATF Red-1K','Hyundai / Kia Genuine ATF','Hyundai / Kia SP-II','Hyundai / Kia SP-III','Isuzu ATF II','Isuzu ATF III','Isuzu Genuine ATF','Jaguar JLM 20238','Jaguar JLM 20292','Jaguar JLM 21044','Jaguar K17','Jaguar LT 71141','Land Rover ETL-7045E','MAN 339 A','Mazda F-1','Mazda JWS 3317','Mazda M-V','Mazda T-IV','MB 236.10','MB 236.11','MB 236.3','MB 236.5','MB 236.6','MB 236.7','MB 236.8','MB 236.9','MB 236.91','Mitsubishi ATF-J2','Mitsubishi SP-II','Mitsubishi SP-III','Nissan 402','Nissan Matic D','Nissan Matic J','Nissan Matic K','Nissan Matic W','Renault Matic D2','Saab 3309 (T-IV)','Ssang Yong DSIH 5M-66','Subaru HP','Suzuki 3314','Suzuki 3317','Toyota D-II','Toyota T-III','Toyota T-IV','VW G 052 025','VW G 052 055','VW G 052 162','VW G 052 990','VW G 055 025','VW G US 000 162'],
        },
    },
};}

export function getReglament() { return {
    BMW: {
        tags: ['BMW SPECIAL OIL','LL 98','LL 01','LL 01 FE','LL 04'],
        descriptions: { 'BMW SPECIAL OIL':'BMW Special Oil.','LL 98':'BMW Longlife-98.','LL 01':'BMW Longlife-01.','LL 01 FE':'BMW Longlife-01 FE.','LL 04':'BMW Longlife-04.' },
    },
    VAG: {
        tags: ['VW 500 00','VW 501 01','VW 502 00','VW 503 00','VW 503 01','VW 504 00','VW 505 00','VW 505 01','VW 506 00','VW 506 01','VW 507 00'],
        descriptions: { 'VW 502 00':'VW 502.00.','VW 504 00':'VW 504.00.','VW 505 00':'VW 505.00.','VW 505 01':'VW 505.01.','VW 507 00':'VW 507.00.' },
    },
    MERCEDES: {
        tags: ['MB 229.1','MB 229.3','MB 229.31','MB 229.5','MB 229.51'],
        descriptions: { 'MB 229.1':'MB 229.1.','MB 229.3':'MB 229.3.','MB 229.31':'MB 229.31.','MB 229.5':'MB 229.5.','MB 229.51':'MB 229.51.' },
    },
    FORD: {
        tags: ['FORD WSS-M2C 912-A1','FORD WSS-M2C 913-A','FORD WSS-M2C 913-B','FORD WSS-M2C 913-C','FORD WSS-M2C 917-A'],
        descriptions: {},
    },
    RENAULT: {
        tags: ['RN 0700','RN 0710','RN 0720'],
        descriptions: { 'RN 0700':'RN 0700.','RN 0710':'RN 0710.','RN 0720':'RN 0720.' },
    },
    OPEL: {
        tags: ['GM-LL-A-025','GM-LL-B-025','DEXOS 1','DEXOS 2'],
        descriptions: {},
    },
    PSA: {
        tags: ['PSA B71 2290','PSA B71 2294','PSA B71 2295','PSA B71 2296'],
        descriptions: {},
    },
};}

export function getReglamentForBrand(brand) {
    if (!brand) return null;
    const b = brand.toUpperCase();
    const reg = getReglament();
    if (b === 'BMW' || b === 'MINI') return { brand: 'BMW', ...reg.BMW };
    if (['VOLKSWAGEN','VW','AUDI','SKODA','SEAT','PORSCHE'].includes(b)) return { brand: 'VAG', ...reg.VAG };
    if (['MERCEDES','MERCEDES-BENZ','MB','SMART'].includes(b)) return { brand: 'MERCEDES', ...reg.MERCEDES };
    if (['FORD','JAGUAR','LAND ROVER','LANDROVER','VOLVO'].includes(b)) return { brand: 'FORD', ...reg.FORD };
    if (['RENAULT','DACIA','NISSAN','INFINITI'].includes(b)) return { brand: 'RENAULT', ...reg.RENAULT };
    if (['OPEL','CHEVROLET','BUICK','CADILLAC','GMC'].includes(b)) return { brand: 'OPEL', ...reg.OPEL };
    if (['PEUGEOT','CITROEN','CITROËN','DS'].includes(b)) return { brand: 'PSA', ...reg.PSA };
    return null;
}
