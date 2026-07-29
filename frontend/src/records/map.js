// Карта станций для страницы «Записи»: Leaflet + бесплатные тайлы CARTO
// (подход перенесён с лендинга SPOT), но вместо голых булавок — плашки с
// кодом перевода звонка, названием станции, цветом линии метро, снежинкой
// «есть заправка кондиционера» и счётчиком СВОБОДНЫХ слотов (цвет счётчика
// отвечает на главный вопрос — куда ещё можно записать).
// Плюс поиск по улице через Nominatim (OSM) с подсказкой ближайших станций.
//
// Leaflet вендорен через npm (а не CDN, как на лендинге) — страница работает
// и без доступа к unpkg; внешними остаются только тайлы и геокодер.

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { STATIONS_META, LINE_COLORS, nearestStations } from '../../../shared/stationsMeta.js';
import { currentTheme } from '../theme.js';
import { icons } from './icons.js';

// Тайлы под тему сайта: на светлой теме тёмная карта была бы чёрным пятном
// посреди белой страницы. У CARTO это те же тайлы в двух вариантах, так что
// смена темы меняет только слой — вид, зум и маркеры остаются на месте.
const TILE_URL = {
    dark:  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Уникальные станции (без алиасов вроде «Мурино»/«Охтинская»).
export function uniqueStations() {
    const seen = new Set();
    const out = [];
    for (const s of STATIONS_META) {
        const key = `${s.short}|${s.boxNo}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(s);
    }
    return out;
}

// container — DOM-узел; onPick(meta) — клик по плашке станции;
// view — {lat, lng, zoom} стартового положения (переживает перерисовку окна);
// fit — [[lat, lng], …] точки, которые должны поместиться в кадр, когда view
// нет (карта станции: она сама и её соседи).
// Возвращает { setFree, highlight, invalidate, focus, getView, destroy }.
export function createStationsMap(container, { onPick, view, fit } = {}) {
    const start = view && Number.isFinite(view.lat)
        ? [[view.lat, view.lng], view.zoom || 12]
        : [[59.93, 30.32], 10];
    // zoomSnap: 0.25 — иначе fitBounds округляет зум вниз до целого и все
    // станции жмутся в середину, оставляя половину карты пустой.
    const map = L.map(container, {
        zoomControl: true,
        attributionControl: false,
        zoomSnap: 0.25,
        zoomDelta: 1,
    }).setView(start[0], start[1]);
    const makeTiles = (theme) => L.tileLayer(TILE_URL[theme] || TILE_URL.dark, {
        subdomains: 'abcd',
        maxZoom: 19,
    });
    let tiles = makeTiles(currentTheme()).addTo(map);

    // Новый слой добавляем ПЕРЕД снятием старого: иначе между кадрами
    // проглядывает пустая подложка и карта успевает моргнуть.
    const onThemeChange = (e) => {
        const next = makeTiles(e.detail?.theme).addTo(map);
        map.removeLayer(tiles);
        tiles = next;
    };
    document.addEventListener('themechange', onThemeChange);

    const markers = new Map(); // short → { marker, meta }
    let freeCounts = {};

    // Цвет счётчика: нет мест — красный, мало — жёлтый, есть — зелёный.
    const freeTone = (free) =>
        free === 0 ? ' rc-pin-count-none' : free <= 5 ? ' rc-pin-count-low' : ' rc-pin-count-ok';

    const pinHtml = (meta, free, active) => {
        const color = LINE_COLORS[meta.line] || '#888';
        // Доска ещё не приехала — счётчика нет вовсе, а не «0 свободно».
        const badge = free == null ? ''
            : `<span class="rc-pin-count${freeTone(free)}" title="Свободно получасов: ${free}">${free}</span>`;
        const ac = meta.ac
            ? `<span class="rc-pin-ac" title="Заправка кондиционера">${icons.snowflake(11)}</span>` : '';
        const code = meta.boxNo ? `<span class="rc-pin-code">${esc(meta.boxNo)}</span>` : '';
        return `<span class="rc-pin${meta.ac ? ' rc-pin-ac-st' : ''}${active ? ' rc-pin-active' : ''}">`
            + `<span class="rc-pin-stripe" style="background:${color}"></span>${code}`
            + `<span class="rc-pin-name">${esc(meta.short)}</span>${ac}${badge}</span>`;
    };

    const makeIcon = (meta, active = false) => L.divIcon({
        className: 'rc-pin-wrap',
        html: pinHtml(meta, meta.short in freeCounts ? freeCounts[meta.short] : null, active),
        iconSize: null,
        iconAnchor: [0, 14],
    });

    const stations = uniqueStations();
    for (const meta of stations) {
        const marker = L.marker([meta.lat, meta.lng], { icon: makeIcon(meta) }).addTo(map);
        marker.on('click', () => onPick && onPick(meta));
        markers.set(meta.short, { marker, meta });
    }

    // Без явного view показываем сразу все станции целиком, а не кусок
    // города с пустотой снизу. С fit — только заданные точки: так карта
    // станции сама подбирает зум, при котором соседи ещё в кадре (у
    // Ветеранов ближайшая в 7 км, у Фучика — в 700 м, одним зумом не обойтись).
    const fitAll = () => {
        if (!stations.length) return;
        map.fitBounds(stations.map(s => [s.lat, s.lng]), { padding: [45, 45] });
    };
    // Плашка растёт ВПРАВО от своей точки (iconAnchor слева), поэтому справа
    // оставляем места на целую подпись — иначе соседи упираются в край и
    // читаются как «##35 Кузнец…».
    const fitStart = () => {
        if (fit && fit.length) {
            map.fitBounds(fit, {
                paddingTopLeft: [16, 30],
                paddingBottomRight: [140, 30],
                maxZoom: 14,
            });
        } else fitAll();
    };
    if (!view) fitStart();

    let activeShort = null;
    const refresh = () => {
        for (const [short, { marker, meta }] of markers) {
            marker.setIcon(makeIcon(meta, short === activeShort));
        }
    };

    return {
        setFree(counts) { freeCounts = counts || {}; refresh(); },
        highlight(short) { activeShort = short || null; refresh(); },
        // Модалка появляется вместе с картой, поэтому первый расчёт размеров
        // приходится на ещё не разложенный контейнер — после invalidateSize
        // подгоняем охват заново.
        invalidate() {
            setTimeout(() => {
                map.invalidateSize();
                if (!view) fitStart();
            }, 60);
        },
        focus(lat, lng, zoom = 13) { map.setView([lat, lng], zoom); },
        // Текущее положение — чтобы перерисовка окна не отбрасывала карту
        // в начальный вид.
        getView() {
            const c = map.getCenter();
            return { lat: c.lat, lng: c.lng, zoom: map.getZoom() };
        },
        destroy() {
            document.removeEventListener('themechange', onThemeChange);
            map.remove();
        },
    };
}

// ── Поиск по улице ───────────────────────────────────────────────────────────

// Nominatim (бесплатный геокодер OSM); ограничиваем рамкой Петербурга и
// окрестностей, чтобы «Оптиков» не уезжал в другой город.
const SPB_VIEWBOX = '29.4,60.35,31.1,59.55'; // lon1,lat1,lon2,lat2

export async function geocodeStreet(q) {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=5'
        + `&viewbox=${SPB_VIEWBOX}&bounded=1&q=${encodeURIComponent(q)}`;
    // Без таймаута зависший запрос оставляет панель в «Ищу адрес…» навсегда.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let res;
    try {
        res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    } finally {
        clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`геокодер ответил ${res.status}`);
    const list = await res.json();
    return list.map(item => ({
        label: item.display_name.split(',').slice(0, 3).join(',').trim(),
        lat: Number(item.lat),
        lng: Number(item.lon),
    }));
}

// Ближайшие станции к точке — с расстоянием, готовые к показу списком.
export function stationsNear(lat, lng, limit = 5) {
    return nearestStations(lat, lng, limit);
}
