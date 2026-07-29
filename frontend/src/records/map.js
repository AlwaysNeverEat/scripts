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

// Зазор между разведёнными плашками (см. layoutPins).
const PIN_GAP = 3;

// container — DOM-узел; onPick(meta) — клик по плашке станции;
// view — {lat, lng, zoom} стартового положения (переживает перерисовку окна);
// fit — [[lat, lng], …] точки, которые должны поместиться в кадр, когда view
// нет (карта станции: она сама и её соседи);
// onUserMove() — юзер сам потянул карту или крутнул зум (программные
// перемещения сюда не приходят).
// Возвращает { setFree, highlight, invalidate, focus, getView, destroy }.
export function createStationsMap(container, { onPick, view, fit, onUserMove } = {}) {
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
        // Поводок — пунктир от разведённой плашки к её настоящей точке. Длину
        // ему считает layoutPins, а показывается он только под курсором
        // (см. .rc-pin-leader в records.css).
        return `<span class="rc-pin${meta.ac ? ' rc-pin-ac-st' : ''}${active ? ' rc-pin-active' : ''}">`
            + `<i class="rc-pin-leader" style="display:none"></i>`
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
    // читаются как «##35 Кузнец…». 140px не хватало на самые длинные названия
    // («Охтинская 9/1, Мурино» — под 200px вместе с кодом и снежинкой).
    const fitStart = () => {
        if (fit && fit.length) {
            map.fitBounds(fit, {
                paddingTopLeft: [16, 30],
                paddingBottomRight: [200, 40],
                maxZoom: 14,
            });
        } else fitAll();
    };
    if (!view) fitStart();

    let activeShort = null; // открытая станция — её плашка и красится, и не двигается

    // ── Разведение плашек ────────────────────────────────────────────────────
    // На общем виде города станции стоят так плотно, что плашки налезали друг
    // на друга и превращались в кашу. Отъезжать зумом нельзя — тогда не
    // прочитать названия, — поэтому раздвигаем не карту, а сами плашки: после
    // каждого зума считаем их прямоугольники в пикселях и сдвигаем по
    // вертикали ровно настолько, чтобы они встали ВПРИТЫК друг к другу, а не
    // внахлёст. От настоящей точки к уехавшей плашке тянется пунктирный
    // поводок — иначе непонятно, чья она.
    //
    // Пересчитывать нужно только на зуме: при перетаскивании все плашки едут
    // вместе, их взаимное расположение не меняется, и старая раскладка
    // остаётся верной.
    let layoutRaf = 0;
    const layoutPins = () => {
        const contRect = container.getBoundingClientRect();
        if (!contRect.width) return;
        const items = [];
        for (const [short, { marker }] of markers) {
            const pin = marker.getElement()?.firstElementChild;
            if (!pin) continue;
            // Сбрасываем прошлый сдвиг ДО замеров: иначе каждая перекладка
            // считала бы от уже сдвинутой плашки и ошибка копилась бы.
            pin.style.setProperty('--dy', '0px');
            items.push({ short, pin });
        }
        // Замеры — отдельным проходом: браузер пересчитает вёрстку один раз, а
        // не по разу на каждую плашку.
        for (const it of items) {
            const r = it.pin.getBoundingClientRect();
            it.x = r.left - contRect.left;
            it.w = r.width;
            it.h = r.height;
            it.base = r.top - contRect.top;
        }
        // Открытая станция встаёт первой — её место настоящее, двигаются
        // соседи. Дальше сверху вниз: верхняя плашка остаётся, следующие
        // подставляются под неё столбиком.
        items.sort((a, b) =>
            (b.short === activeShort) - (a.short === activeShort) || a.base - b.base);
        const placed = [];
        const hit = (it, y) => placed.find(p =>
            it.x < p.x + p.w + PIN_GAP && p.x < it.x + it.w + PIN_GAP
            && y < p.y + p.h + PIN_GAP && p.y < y + it.h + PIN_GAP);
        for (const it of items) {
            let y = it.base;
            // Каждый шаг сдвигает строго вниз, так что цикл конечен; guard —
            // страховка от вырожденных размеров (нулевая высота плашки).
            for (let guard = 0; guard < 60; guard++) {
                const p = hit(it, y);
                if (!p) break;
                y = p.y + p.h + PIN_GAP;
            }
            it.y = y;
            placed.push({ x: it.x, y, w: it.w, h: it.h });
        }
        for (const it of items) {
            const dy = Math.round(it.y - it.base);
            it.pin.style.setProperty('--dy', `${dy}px`);
            const leader = it.pin.querySelector('.rc-pin-leader');
            if (!leader) continue;
            // Плашка на своём месте — тянуть некуда, поводка нет совсем
            // (показ остальных — на CSS, по ховеру).
            leader.style.display = dy ? '' : 'none';
            leader.style.height = `${Math.abs(dy)}px`;
            // Плашка ушла вниз — поводок тянется от неё вверх, к своей точке.
            leader.style.top = dy > 0 ? 'auto' : '50%';
            leader.style.bottom = dy > 0 ? '50%' : 'auto';
        }
    };
    const relayout = () => {
        cancelAnimationFrame(layoutRaf);
        layoutRaf = requestAnimationFrame(layoutPins);
    };
    map.on('zoomend', relayout);
    map.on('viewreset', relayout);
    relayout();

    // Перетаскивание и зум руками — повод убрать с карты то, что её закрывает
    // (подсказки поиска). Программные перемещения (fitBounds, focus) под этот
    // сигнал не попадают: иначе список станций исчезал бы ровно в тот момент,
    // когда карта подъезжает к найденному адресу.
    let quiet = 0;
    const beQuiet = () => {
        quiet++;
        setTimeout(() => { quiet = Math.max(0, quiet - 1); }, 600);
    };
    const userMoved = () => { if (!quiet && onUserMove) onUserMove(); };
    map.on('dragstart', userMoved);
    map.on('zoomstart', userMoved);

    const refresh = () => {
        for (const [short, { marker, meta }] of markers) {
            const active = short === activeShort;
            marker.setIcon(makeIcon(meta, active));
            // Открытая станция — поверх соседей, иначе её плашку подрезали бы
            // те, что южнее (Leaflet сортирует маркеры по широте).
            marker.setZIndexOffset(active ? 1000 : 0);
        }
        relayout();
    };

    return {
        setFree(counts) { freeCounts = counts || {}; refresh(); },
        highlight(short) { activeShort = short || null; refresh(); },
        // Модалка появляется вместе с картой, поэтому первый расчёт размеров
        // приходится на ещё не разложенный контейнер — после invalidateSize
        // подгоняем охват заново.
        invalidate() {
            setTimeout(() => {
                beQuiet();
                map.invalidateSize();
                if (!view) fitStart();
                relayout();
            }, 60);
        },
        focus(lat, lng, zoom = 13) { beQuiet(); map.setView([lat, lng], zoom); },
        // Текущее положение — чтобы перерисовка окна не отбрасывала карту
        // в начальный вид.
        getView() {
            const c = map.getCenter();
            return { lat: c.lat, lng: c.lng, zoom: map.getZoom() };
        },
        destroy() {
            cancelAnimationFrame(layoutRaf);
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
