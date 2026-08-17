// ─────────────────────────────────────────────────────────────────────────────
// Панорама и карта для пасхалки «Гео» — вся работа с гугловским скриптом.
//
// ЧТО ИМЕННО ДЕЛАЕТ GOOGLE. Панораму рисует Maps JavaScript API: ему даётся id
// панорамы (pano_id), и он показывает снимок. Сам id находит СЕРВЕР через
// бесплатный справочник (backend/src/geo/panoramas.js) — сюда координата не
// приезжает вовсе, иначе игру можно было бы выиграть, открыв консоль.
//
// Полностью спрятать место всё равно нельзя: скрипт работает в том же браузере
// и знает, где стоит камера. Это цена всех пасхалок разом (см. shared/geo.js):
// защита от мусора, а не от того, кто специально сел ломать свой мини-топ.
//
// ПОДПИСИ ДОРОГ ВЫКЛЮЧЕНЫ (showRoadLabels: false), и это не украшательство:
// с ними в углу экрана написано название улицы, а вместе с ним — язык, алфавит
// и половина ответа.
//
// РЕЖИМЫ ПЕРЕДВИЖЕНИЯ. У панорамы есть готовые выключатели только для двух из
// трёх вещей: clickToGo и linksControl запрещают ХОДИТЬ, scrollwheel — зумить.
// Запретить КРУТИТЬ штатно нельзя, поэтому в nmpz поверх панорамы кладётся
// прозрачная плёнка, которая съедает мышь и касания, а на всякий случай ещё и
// возвращается угол обзора, если его всё же сдвинули (клавиатурой, например).
// ─────────────────────────────────────────────────────────────────────────────

const SCRIPT_ID = 'geo-gmaps';

let loading = null;

/**
 * Загрузить гугловский скрипт один раз на всю страницу.
 *
 * Скрипт тянется по клику на режим, а не при открытии окна: это чужие сотни
 * килобайт, и человеку, зашедшему посмотреть таблицу, они не нужны.
 */
export function loadMaps(key) {
    if (window.google?.maps?.StreetViewPanorama) return Promise.resolve(window.google.maps);
    if (loading) return loading;

    loading = new Promise((resolve, reject) => {
        const cb = '__geoMapsReady';
        window[cb] = () => {
            delete window[cb];
            resolve(window.google.maps);
        };
        const script = document.createElement('script');
        script.id = SCRIPT_ID;
        script.async = true;
        script.src = 'https://maps.googleapis.com/maps/api/js'
            + `?key=${encodeURIComponent(key)}&v=weekly&callback=${cb}&language=ru`;
        script.onerror = () => {
            loading = null;
            reject(new Error('не удалось загрузить карты Google'));
        };
        document.head.appendChild(script);
    });
    return loading;
}

/** Настройки панорамы под режим передвижения. */
function panoOptions(mode) {
    const walk = mode === 'move';
    return {
        // Общее для всех режимов: ни подписей, ни адреса, ни ссылки «открыть в
        // картах» — всё это готовые ответы.
        addressControl: false,
        showRoadLabels: false,
        fullscreenControl: false,
        motionTracking: false,
        motionTrackingControl: false,
        enableCloseButton: false,
        linksControl: walk,
        clickToGo: walk,
        panControl: false,
        zoomControl: mode !== 'nmpz',
        scrollwheel: mode !== 'nmpz',
        disableDoubleClickZoom: mode === 'nmpz',
    };
}

/**
 * Панорама в элементе el.
 *
 * Возвращает { show(pano), destroy() }. Панорама создаётся ОДНА на всё окно и
 * между раундами только меняет pano: пересоздавать её каждый раунд — значит
 * заново поднимать весь просмотрщик и заново платить за загрузку.
 */
export function createPanorama(maps, el, mode) {
    const pano = new maps.StreetViewPanorama(el, panoOptions(mode));

    let veil = null;
    let lock = null;
    if (mode === 'nmpz') {
        // Плёнка поверх панорамы: она и есть запрет крутить. Мышь до
        // просмотрщика не доходит, значит, и вращать нечем.
        veil = document.createElement('div');
        veil.className = 'geo-nmpz-veil';
        el.appendChild(veil);
        // Подстраховка на случай, если угол всё же сдвинули (клавиатурой или
        // API): запоминаем первый угол раунда и возвращаемся к нему.
        let home = null;
        lock = pano.addListener('pov_changed', () => {
            const pov = pano.getPov();
            if (!home) { home = { heading: pov.heading, pitch: pov.pitch, zoom: 0 }; return; }
            if (Math.abs(pov.heading - home.heading) < 0.01 && Math.abs(pov.pitch - home.pitch) < 0.01) return;
            pano.setPov(home);
        });
        pano.__resetHome = () => { home = null; };
    }

    return {
        show(id) {
            if (pano.__resetHome) pano.__resetHome();
            pano.setPano(id);
            pano.setPov({ heading: 0, pitch: 0 });
            pano.setZoom(0);
        },
        destroy() {
            lock?.remove();
            veil?.remove();
        },
    };
}

/**
 * Карта, куда тыкают догадку.
 *
 * onPick зовётся с { lat, lng } на каждый клик — окно само решает, что с этим
 * делать (показать кнопку «Угадать», например).
 */
export function createGuessMap(maps, el, onPick) {
    const map = new maps.Map(el, {
        center: { lat: 20, lng: 0 },
        zoom: 1,
        minZoom: 1,
        disableDefaultUI: true,
        zoomControl: true,
        clickableIcons: false,
        // Карта угадывания — политическая: города и страны нужны, а вот
        // спутниковую подложку и рельеф отключаем, по ним ткнуть точнее.
        mapTypeId: 'roadmap',
        gestureHandling: 'greedy',
        streetViewControl: false,
    });

    let marker = null;
    const extra = [];

    map.addListener('click', (e) => {
        const point = { lat: e.latLng.lat(), lng: e.latLng.lng() };
        if (marker) marker.setMap(null);
        marker = new maps.Marker({ position: e.latLng, map, title: 'Ваша догадка' });
        onPick(point);
    });

    const clear = () => {
        if (marker) { marker.setMap(null); marker = null; }
        while (extra.length) extra.pop().setMap(null);
    };

    return {
        map,
        /** Новый раунд: карта чистая и снова смотрит на весь мир. */
        reset() {
            clear();
            map.setZoom(1);
            map.setCenter({ lat: 20, lng: 0 });
        },
        /**
         * Показать итог: где было на самом деле, куда ткнули и линия между.
         * guesses — [{ lat, lng, label, color }], их может быть две (дуэль).
         */
        showResult(target, guesses) {
            clear();
            const bounds = new maps.LatLngBounds();
            const at = new maps.LatLng(target.lat, target.lng);
            bounds.extend(at);
            extra.push(new maps.Marker({
                position: at, map, title: 'Загаданное место', zIndex: 10,
                icon: {
                    path: maps.SymbolPath.CIRCLE,
                    scale: 9,
                    fillColor: '#2ecc71',
                    fillOpacity: 1,
                    strokeColor: '#0b3d1f',
                    strokeWeight: 2,
                },
            }));
            for (const g of guesses) {
                if (!g) continue;
                const pos = new maps.LatLng(g.lat, g.lng);
                bounds.extend(pos);
                extra.push(new maps.Marker({ position: pos, map, title: g.label || 'Догадка' }));
                extra.push(new maps.Polyline({
                    map,
                    path: [pos, at],
                    strokeColor: g.color || '#e74c3c',
                    strokeOpacity: 0.9,
                    strokeWeight: 2,
                }));
            }
            map.fitBounds(bounds, 40);
        },
        destroy: clear,
    };
}
