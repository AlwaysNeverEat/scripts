// ─────────────────────────────────────────────────────────────────────────────
// Снимок улицы и карта для пасхалки «Гео» — вся работа с чужими библиотеками.
//
// ДВЕ БИБЛИОТЕКИ, И ОБЕ БЕЗ КАРТЫ И БЕЗ СЧЕТОВ:
//   • mapillary-js — показывает снимок улицы по его id;
//   • leaflet + плитки OpenStreetMap — карта, куда тыкают догадку.
// Google Street View не взяли по одной причине: любой его API требует
// привязанной банковской карты, даже там, где запросы бесплатны.
//
// Обе грузятся ОТДЕЛЬНЫМ ЧАНКОМ, по клику на режим: вместе они весят прилично,
// и человеку, зашедшему посмотреть таблицу, не нужны вовсе.
//
// НАРУЖУ ИЗ ИГРЫ ЕДЕТ ТОЛЬКО id СНИМКА. Координаты загаданного места остаются
// на сервере до конца раунда — иначе считать расстояние было бы не до чего.
// Спрятать их полностью всё равно нельзя: снимок рисуется в этом же браузере,
// и его положение можно вытащить из консоли. Цена та же, что у остальных
// пасхалок: защита от мусора, а не от того, кто сел ломать свой мини-топ.
//
// РЕЖИМЫ ПЕРЕДВИЖЕНИЯ ложатся на настройки просмотрщика один в один:
//   • обычный — стрелки перехода и лента последовательности включены;
//   • без ходьбы — они выключены (и клавиатура тоже: с неё тоже ходят),
//     крутить и зумить можно;
//   • NMPZ — вдобавок выключены перетаскивание и зум, то есть не остаётся
//     ничего, кроме как смотреть в одну сторону.
// ─────────────────────────────────────────────────────────────────────────────

// Плитки карты. OSM отдаёт их бесплатно и без ключа; взамен просит не снимать
// подпись и не долбить сервер — у пасхалки на десяток человек это не вопрос.
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILES_BY = '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>';

let libs = null;

/** Загрузить обе библиотеки один раз на всё окно. */
export function loadMaps() {
    if (!libs) {
        libs = Promise.all([
            import('mapillary-js'),
            import('mapillary-js/dist/mapillary.css'),
            import('leaflet'),
            import('leaflet/dist/leaflet.css'),
        ]).then(([mly, , leaflet]) => ({ mly, L: leaflet.default || leaflet }));
    }
    return libs;
}

/** Настройки просмотрщика под режим передвижения. */
function componentOptions(mode) {
    const walk = mode === 'move';
    return {
        // Заставка «нажмите, чтобы загрузить» тут лишняя: раунд уже начался и
        // время пошло.
        cover: false,
        // Стрелки перехода на соседний снимок и лента последовательности — это
        // и есть «ходить». С клавиатуры ходят тоже, поэтому она в одной пачке.
        direction: walk,
        sequence: walk,
        keyboard: walk,
        // Перетаскивание и зум: в NMPZ нет ни того, ни другого.
        pointer: mode === 'nmpz'
            ? { dragPan: false, scrollZoom: false, touchZoom: false }
            : true,
        zoom: mode !== 'nmpz',
        // Компас оставляем во всех режимах: он показывает, куда смотрит камера,
        // а не где она стоит, — подсказки в нём нет.
        bearing: true,
    };
}

/**
 * Просмотрщик в элементе el.
 *
 * Возвращает { show(id), resize(), destroy() }. Просмотрщик создаётся ОДИН на
 * окно и между раундами только переезжает на другой снимок: пересоздавать его
 * каждый раунд — значит заново поднимать весь движок.
 */
export function createPanorama({ mly }, el, mode, token) {
    const viewer = new mly.Viewer({
        accessToken: token,
        container: el,
        component: componentOptions(mode),
        trackResize: true,
    });

    return {
        show(id) {
            // Снимка может не оказаться (удалили с Mapillary после того, как
            // сервер его записал) — ронять на этом окно нельзя, раунд просто
            // останется с прошлой картинкой, а сервер выдаст новую точку.
            viewer.moveTo(String(id)).catch(() => {});
        },
        // Просмотрщик считает размер холста сам, но только пока он виден: после
        // возврата с экрана итога его надо пнуть, иначе кадр остаётся растянут
        // по старым размерам.
        resize() { viewer.resize(); },
        destroy() { viewer.remove(); },
    };
}

/**
 * Карта, куда тыкают догадку.
 *
 * onPick зовётся с { lat, lng } на каждый клик — окно само решает, что с этим
 * делать (зажечь кнопку «Угадать», например).
 */
export function createGuessMap({ L }, el, onPick) {
    const map = L.map(el, {
        center: [20, 0],
        zoom: 1,
        minZoom: 1,
        worldCopyJump: true,
        zoomControl: true,
        attributionControl: true,
    });
    L.tileLayer(TILES, { attribution: TILES_BY, maxZoom: 18 }).addTo(map);

    let marker = null;
    const extra = [];

    // Метки рисуем кружками, а не стандартными «булавками» Leaflet: те тянут
    // картинку по относительному пути, который после сборки не находится, и
    // на карте оказываются пустые прямоугольники.
    const dot = (lat, lng, color, size = 7) => L.circleMarker([lat, lng], {
        radius: size,
        color: '#111',
        weight: 2,
        fillColor: color,
        fillOpacity: 1,
    });

    map.on('click', (e) => {
        const point = { lat: e.latlng.lat, lng: e.latlng.lng };
        if (marker) map.removeLayer(marker);
        marker = dot(point.lat, point.lng, '#e74c3c').addTo(map);
        onPick(point);
    });

    const clear = () => {
        if (marker) { map.removeLayer(marker); marker = null; }
        while (extra.length) map.removeLayer(extra.pop());
    };

    return {
        map,
        /** Новый раунд: карта чистая и снова смотрит на весь мир. */
        reset() {
            clear();
            map.setView([20, 0], 1);
        },
        /** Холст сменил размер (карта переехала из угла на весь экран). */
        resize() { map.invalidateSize(); },
        /**
         * Показать итог: где было на самом деле, куда ткнули и линия между.
         * guesses — [{ lat, lng, color }], их может быть две (дуэль).
         */
        showResult(target, guesses) {
            clear();
            const points = [[target.lat, target.lng]];
            extra.push(dot(target.lat, target.lng, '#2ecc71', 9).addTo(map));
            for (const g of guesses) {
                if (!g) continue;
                points.push([g.lat, g.lng]);
                extra.push(dot(g.lat, g.lng, g.color || '#e74c3c').addTo(map));
                extra.push(L.polyline([[g.lat, g.lng], [target.lat, target.lng]], {
                    color: g.color || '#e74c3c',
                    weight: 2,
                    opacity: 0.9,
                }).addTo(map));
            }
            map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 12 });
        },
        destroy() {
            clear();
            map.remove();
        },
    };
}
