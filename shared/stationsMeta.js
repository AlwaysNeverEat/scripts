// ─────────────────────────────────────────────────────────────────────────────
// Единый справочник станций (боксов) сети SPOT для клона админки записей.
//
// Источники, сведённые вместе:
//   • ADDRESS_META из юзерскрипта «CRM — Карта метро СПб v8» — метро/линия/
//     номер бокса/конфигурация/высота потолка;
//   • SPB_STATIONS из лендинга SPOT (репозиторий AlwaysNeverEat/SPOT,
//     main.js) — geo-координаты из Яндекс-ссылок оригинального сайта;
//   • точечные уточнения через Nominatim (дом-уровень): Кубинская 82к3,
//     Дунайский 21, Дальневосточный 3а, М. Балканская 35, Ветеранов 167к8.
//
// `match` — подстрока, по которой колонка `<th id="address_id_N">…title…</th>`
// из /admin/record привязывается к записи справочника (регистронезависимо,
// первое совпадение выигрывает — более специфичные подстроки стоят раньше
// более коротких). `knownId` — address_id, замеченный в реальной выгрузке
// 25.07.2026; только подсказка для людей и тестов, матчинг всегда по title.
//
// `boxes` — число боксов: столько дорожек времени рисует редактор станции,
// чтобы «червячки» записей не пересекались.
// ─────────────────────────────────────────────────────────────────────────────

export const LINE_COLORS = {
    1: '#d6083b', // Кировско-Выборгская
    2: '#0078c1', // Московско-Петроградская
    3: '#009a49', // Невско-Василеостровская
    4: '#ea7125', // Правобережная
    5: '#702f8a', // Фрунзенско-Приморская
};

export const LINE_NAMES = {
    1: 'Кировско-Выборгская',
    2: 'Московско-Петроградская',
    3: 'Невско-Василеостровская',
    4: 'Правобережная',
    5: 'Фрунзенско-Приморская',
};

export const STATIONS_META = [
    // ── Красная (1) ──────────────────────────────────────────────────────────
    { match: 'Выборгское ш. 212',   short: 'Выб. шоссе 212',  metro: 'Парнас',            line: 1, boxNo: '##19', boxes: 1, layout: '1 бокс / 1 яма',                height: '2 м',   lat: 60.068668, lng: 30.293284, knownId: '143' },
    { match: 'Полюстровский',       short: 'Полюстровский',   metro: 'Площадь Ленина',    line: 1, boxNo: '##24', boxes: 1, layout: '1 бокс / 1 яма',                height: '2.2 м', lat: 59.972947, lng: 30.380196, knownId: '167' },
    { match: 'Руставели 69',        short: 'Руставели 69',    metro: 'Академическая',     line: 1, boxNo: '##33', boxes: 2, layout: '2 бокса / 2 ямы',               height: '2.6 м', lat: 60.037149, lng: 30.433234, knownId: '185' },
    { match: 'Охтинская',           short: 'Охтинская/Мурино',metro: 'Девяткино',         line: 1, boxNo: '##34', boxes: 1, layout: '1 бокс / 1 яма',                height: '2.5 м', lat: 60.048767, lng: 30.427207, knownId: '190' },
    { match: 'Мурино',              short: 'Охтинская/Мурино',metro: 'Девяткино',         line: 1, boxNo: '##34', boxes: 1, layout: '1 бокс / 1 яма',                height: '2.5 м', lat: 60.048767, lng: 30.427207 },
    { match: 'Кубинская 82',        short: 'Кубинская 82',    metro: 'Ленинский пр.',     line: 1, boxNo: '##15', boxes: 1, layout: '1 бокс / 1 подъёмник',          height: '2.6 м', lat: 59.839123, lng: 30.302296, knownId: '135' },
    { match: 'Казакова 29',         short: 'Казакова 29',     metro: 'Пр. Ветеранов',     line: 1, boxNo: '##28', boxes: 2, layout: '2 бокса / 1 подъёмник',         height: '2.6 м', lat: 59.860364, lng: 30.213586, knownId: '173' },
    { match: 'Ветеранов 167',       short: 'Ветеранов 167к8', metro: 'Пр. Ветеранов',     line: 1, boxNo: '',     boxes: 1, layout: '',                              height: '',      lat: 59.835846, lng: 30.116537, knownId: '192', note: 'Сосновая Поляна' },
    { match: 'Маршала Жукова 21',   short: 'Жукова 21',       metro: 'Автово',            line: 1, boxNo: '##05', boxes: 1, layout: '1 бокс / 1 подъёмник',          height: '2.5 м', lat: 59.862877, lng: 30.233586, knownId: '5' },
    { match: 'Жукова 21',           short: 'Жукова 21',       metro: 'Автово',            line: 1, boxNo: '##05', boxes: 1, layout: '1 бокс / 1 подъёмник',          height: '2.5 м', lat: 59.862877, lng: 30.233586 },

    // ── Синяя (2) ────────────────────────────────────────────────────────────
    { match: 'Придорожная',         short: 'Придорожная',     metro: 'Просвещения',       line: 2, boxNo: '##02', boxes: 2, layout: '2 бокса / 2 подъёмника',        height: '2.2 м', lat: 60.056333, lng: 30.357981, knownId: '4' },
    { match: 'Выборгское шоссе 2',  short: 'Выб. шоссе 2',    metro: 'Озерки',            line: 2, boxNo: '##09', boxes: 2, layout: '2 бокса / 2 подъёмника',        height: '2.4 м', lat: 60.033674, lng: 30.319866, knownId: '8' },
    { match: 'Кузнецовская 60',     short: 'Кузнецовская',    metro: 'Парк Победы',       line: 2, boxNo: '##35', boxes: 2, layout: '2 бокса / 2 подъёмника',        height: '2.6 м', lat: 59.873365, lng: 30.352412, knownId: '191' },
    { match: 'Типанова 20',         short: 'Типанова 20',     metro: 'Московская',        line: 2, boxNo: '##22', boxes: 2, layout: '2 бокса / 2 ямы',               height: '2 м',   lat: 59.851942, lng: 30.339939, knownId: '165' },
    { match: 'Малая балканская 35', short: 'М. Балканская',   metro: 'Купчино',           line: 2, boxNo: '##20', boxes: 1, layout: '1 бокс / 1 яма',                height: '2.2 м', lat: 59.824789, lng: 30.391459, knownId: '162' },
    { match: 'Балканская 35',       short: 'М. Балканская',   metro: 'Купчино',           line: 2, boxNo: '##20', boxes: 1, layout: '1 бокс / 1 яма',                height: '2.2 м', lat: 59.824789, lng: 30.391459 },

    // ── Зелёная (3) ──────────────────────────────────────────────────────────
    { match: 'Уральская 7',         short: 'Уральская 7',     metro: 'Василеостровская',  line: 3, boxNo: '##30', boxes: 2, layout: '2 бокса / 2 ямы',               height: '2.3 м', lat: 59.952524, lng: 30.262814, knownId: '179', note: 'Только запись' },
    { match: 'Караваевская 15',     short: 'Караваевская 15', metro: 'Рыбацкое',          line: 3, boxNo: '##21', boxes: 1, layout: '1 бокс / 1 яма',                height: '2.2 м', lat: 59.835876, lng: 30.495576, knownId: '163' },
    { match: 'Советский 55',        short: 'Советский 55',    metro: 'Рыбацкое',          line: 3, boxNo: '##11', boxes: 1, layout: '1 бокс / 1 подъёмник',          height: '2.9 м', lat: 59.825058, lng: 30.552574, knownId: '11', note: 'Металлострой' },

    // ── Оранжевая (4) ────────────────────────────────────────────────────────
    { match: 'Индустриальный',      short: 'Индустриальный',  metro: 'Ладожская',         line: 4, boxNo: '##27', boxes: 1, layout: '1 бокс / 1 яма',                height: '2.7 м', lat: 59.959278, lng: 30.464728, knownId: '172' },
    { match: 'Дальневосточный',     short: 'Дальневосточный', metro: 'Пр. Большевиков',   line: 4, boxNo: '##07', boxes: 2, layout: '2 бокса / 1 подъёмник / 1 яма', height: '2.5 м', lat: 59.917727, lng: 30.425183, knownId: '133' },
    { match: 'Солидарности 22',     short: 'Солидарности 22', metro: 'Пр. Большевиков',   line: 4, boxNo: '##06', boxes: 2, layout: '2 бокса / 2 подъёмника',        height: '2.3 м', lat: 59.913645, lng: 30.500104, knownId: '6' },
    { match: 'Кудрово',             short: 'Кудрово',         metro: 'Ул. Дыбенко',       line: 4, boxNo: '##08', boxes: 2, layout: '2 бокса / 2 подъёмника',        height: '2.6 м', lat: 59.905978, lng: 30.505669, knownId: '188' },
    { match: 'Центральная ул., 25', short: 'Кудрово',         metro: 'Ул. Дыбенко',       line: 4, boxNo: '##08', boxes: 2, layout: '2 бокса / 2 подъёмника',        height: '2.6 м', lat: 59.905978, lng: 30.505669 },

    // ── Фиолетовая (5) ───────────────────────────────────────────────────────
    { match: 'Планерная 16',        short: 'Планерная 16',    metro: 'Комендантский пр.', line: 5, boxNo: '##18', boxes: 2, layout: '2 бокса / 1 подъёмник / 1 яма', height: '2.8 м', lat: 59.999687, lng: 30.233421, knownId: '142' },
    { match: 'Оптиков 2',           short: 'Оптиков 2',       metro: 'Комендантский пр.', line: 5, boxNo: '##04', boxes: 2, layout: '2 бокса',                       height: '2.4 м', lat: 59.995075, lng: 30.254630, knownId: '3' },
    { match: 'Фучика 23',           short: 'Фучика 23',       metro: 'Бухарестская',      line: 5, boxNo: '##01', boxes: 1, layout: '1 бокс / 1 яма',                height: '3 м',   lat: 59.883373, lng: 30.386526, knownId: '1', note: 'Во дворе' },
    { match: 'Фучика 14',           short: 'Фучика 14',       metro: 'Международная',     line: 5, boxNo: '##03', boxes: 2, layout: '2 бокса / 2 подъёмника',        height: '2.2 м', lat: 59.884379, lng: 30.386548, knownId: '2', note: 'На углу' },
    { match: 'Дунайский 21',        short: 'Дунайский 21',    metro: 'Дунайская',         line: 5, boxNo: '##12', boxes: 1, layout: '1 бокс / 1 подъёмник',          height: '2.2 м', lat: 59.830708, lng: 30.350039, knownId: '' },
];

// Привязка заголовка колонки из /admin/record к справочнику. Более длинные
// (специфичные) подстроки проверяются первыми, чтобы «Выборгское шоссе 2» не
// съел «Выборгское ш. 212» и наоборот.
const BY_LENGTH = [...STATIONS_META].sort((a, b) => b.match.length - a.match.length);

export function findStationMeta(title) {
    const t = String(title || '').toLowerCase();
    for (const m of BY_LENGTH) {
        if (t.includes(m.match.toLowerCase())) return m;
    }
    return null;
}

// ── География ────────────────────────────────────────────────────────────────

export function haversineKm(lat1, lng1, lat2, lng2) {
    const rad = (d) => d * Math.PI / 180;
    const dLat = rad(lat2 - lat1);
    const dLng = rad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(a));
}

// Ближайшие станции к точке (для поиска «введи улицу — покажу станции рядом»).
// Дубли-алиасы (Мурино/Охтинская и т.п.) схлопываются по boxNo+short.
export function nearestStations(lat, lng, limit = 5) {
    const seen = new Set();
    const unique = [];
    for (const s of STATIONS_META) {
        const key = `${s.short}|${s.boxNo}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(s);
    }
    return unique
        .map(s => ({ ...s, distanceKm: haversineKm(lat, lng, s.lat, s.lng) }))
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, limit);
}
