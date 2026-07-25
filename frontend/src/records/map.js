// Карта станций для страницы «Записи»: Leaflet + бесплатные тайлы CARTO
// (подход перенесён с лендинга SPOT), но вместо голых булавок — плашки с
// названием станции, цветом линии метро и счётчиком занятых слотов.
// Плюс поиск по улице через Nominatim (OSM) с подсказкой ближайших станций.
//
// Leaflet вендорен через npm (а не CDN, как на лендинге) — страница работает
// и без доступа к unpkg; внешними остаются только тайлы и геокодер.

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { STATIONS_META, LINE_COLORS, nearestStations } from '../../../shared/stationsMeta.js';

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

// container — DOM-узел; onPick(meta) — клик по плашке станции.
// Возвращает { setBusy(mapShortToCount), highlight(short), invalidate, focus(lat,lng,zoom), destroy }.
export function createStationsMap(container, { onPick } = {}) {
    const map = L.map(container, { zoomControl: true, attributionControl: false })
        .setView([59.93, 30.32], 10);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 19,
    }).addTo(map);

    const markers = new Map(); // short → { marker, meta }
    let busyCounts = {};

    const pinHtml = (meta, busy, active) => {
        const color = LINE_COLORS[meta.line] || '#888';
        const badge = busy > 0 ? `<span class="rc-pin-count">${busy}</span>` : '';
        return `<span class="rc-pin${active ? ' rc-pin-active' : ''}">`
            + `<span class="rc-pin-stripe" style="background:${color}"></span>`
            + `<span class="rc-pin-name">${esc(meta.short)}</span>${badge}</span>`;
    };

    const makeIcon = (meta, active = false) => L.divIcon({
        className: 'rc-pin-wrap',
        html: pinHtml(meta, busyCounts[meta.short] || 0, active),
        iconSize: null,
        iconAnchor: [0, 14],
    });

    for (const meta of uniqueStations()) {
        const marker = L.marker([meta.lat, meta.lng], { icon: makeIcon(meta) }).addTo(map);
        marker.on('click', () => onPick && onPick(meta));
        markers.set(meta.short, { marker, meta });
    }

    let activeShort = null;
    const refresh = () => {
        for (const [short, { marker, meta }] of markers) {
            marker.setIcon(makeIcon(meta, short === activeShort));
        }
    };

    return {
        setBusy(counts) { busyCounts = counts || {}; refresh(); },
        highlight(short) { activeShort = short || null; refresh(); },
        invalidate() { setTimeout(() => map.invalidateSize(), 60); },
        focus(lat, lng, zoom = 13) { map.setView([lat, lng], zoom); },
        destroy() { map.remove(); },
    };
}

// ── Поиск по улице ───────────────────────────────────────────────────────────

// Nominatim (бесплатный геокодер OSM); ограничиваем рамкой Петербурга и
// окрестностей, чтобы «Оптиков» не уезжал в другой город.
const SPB_VIEWBOX = '29.4,60.35,31.1,59.55'; // lon1,lat1,lon2,lat2

export async function geocodeStreet(q) {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=5'
        + `&viewbox=${SPB_VIEWBOX}&bounded=1&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
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
