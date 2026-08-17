// ─────────────────────────────────────────────────────────────────────────────
// Откуда берётся загаданное место: снимки улиц Mapillary.
//
// ПОЧЕМУ НЕ GOOGLE STREET VIEW. У него покрытие лучше, но любой его API — даже
// «бесплатная» справка о панорамах — требует привязанной к проекту банковской
// карты: без биллинга запрос возвращает REQUEST_DENIED, и обойти это нечем.
// Mapillary — краудсорсинговый банк уличных снимков (проект Meta): токен
// выдают по обычной регистрации, карта не нужна, лимиты бесплатные.
//
// ЦЕНА ВЫБОРА. Снимки не с гугловской машины, а чьи-то — с велосипедов,
// регистраторов, телефонов. В Европе, Штатах и Японии покрытие плотное, дальше
// рванее: где-то один проезд по трассе, где-то пусто. Поэтому опорные точки в
// shared/geoPoints.js подобраны под РЕАЛЬНОЕ покрытие, а не по карте мира, и
// точка, рядом с которой ничего не нашлось, просто пропускается.
//
// КВАДРАТ ПОИСКА МАЛЕНЬКИЙ, И ЭТО НЕ НАШ ВЫБОР: Mapillary отказывает запросу,
// у которого bbox больше 0.010 квадратного градуса («Bounding box area is too
// large»), — это примерно 11 на 11 километров у экватора и меньше к полюсам.
// Поэтому размер квадрата считается, а потом ЗАЖИМАЕТСЯ под этот предел
// (см. bbox): пропорции сохраняются, площадь ужимается. Разброс опорных точек
// (JITTER_KM) подобран под этот же предел — иначе запрос улетал бы в поле в
// десяти километрах от единственной снятой улицы.
//
// СНАЧАЛА ИЩЕМ СФЕРИЧЕСКИЕ (is_pano). Вокруг такого снимка можно оглядеться —
// а «посмотреть по сторонам» и есть игра. Плоских кадров у Mapillary в разы
// больше, но по одному кадру, снятому вперёд по ходу движения, угадывать почти
// нечего. Поэтому найденный плоский снимок запоминается ПРО ЗАПАС и отдаётся,
// только если сферических не нашлось нигде: лучше кадр в одну сторону, чем
// «не удалось подобрать точку».
//
// Фильтруем по полю в ответе, а не параметром запроса: набор фильтров у
// Mapillary со временем меняется, а поле is_pano есть всегда, и лишний
// неизвестный параметр мог бы уронить весь запрос целиком.
//
// Токен ОДИН на сервер и на браузер — он и задуман публичным: снимки в окне
// игры показывает mapillary-js, и без токена в браузере он работать не может.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { fetchWithRetry } from '../http/netRetry.js';
import { pickPoint } from '../../../shared/geoPoints.js';

const API_URL = 'https://graph.mapillary.com/images';

// Полсторона квадрата поиска вокруг опорной точки, км. Больше просить нельзя:
// Mapillary считает площадь в квадратных градусах и отказывает начиная с 0.010
// (у экватора это 11 на 11 км, дальше от него — меньше).
const SEARCH_KM = 6;

// Предел площади bbox, кв. градусы. Держим с запасом от объявленных 0.010:
// граница проверяется на их стороне, и упереться в неё ровно — значит время от
// времени ловить отказ на округлении.
const MAX_BBOX_DEG2 = 0.009;

// Сколько снимков просим за раз. Из них берём случайный — иначе на одной и той
// же опорной точке всем доставался бы один и тот же кадр.
const LIMIT = 100;

// Сколько опорных точек пробуем. Квадрат маленький, покрытие рваное — с одной
// попытки везёт далеко не всегда.
const TRIES = 14;

// После скольких попыток довольствуемся плоским снимком, если он уже найден.
// Искать сферический до последнего — это четырнадцать запросов подряд перед
// каждым раундом там, где их попросту нет.
const PANO_PATIENCE = 8;

const TIMEOUT_MS = 8000;

const KM_PER_DEG = 111.32;

export const token = () => process.env.MAPILLARY_TOKEN || '';
export const hasToken = () => !!token();

function bbox({ lat, lng }, km = SEARCH_KM) {
    let dLat = km / KM_PER_DEG;
    // Ближе к полюсам градус долготы короче — без косинуса квадрат в Тромсё
    // получился бы вчетверо уже, чем в Найроби. Зато В ГРАДУСАХ он выходит
    // шире, а Mapillary меряет площадь именно в них — отсюда зажим ниже.
    const cos = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    let dLng = km / (KM_PER_DEG * cos);

    // Слишком большой квадрат Mapillary не считает «многовато» — он отказывает
    // всему запросу. Ужимаем обе стороны одним множителем: квадрат остаётся
    // квадратом на местности, просто становится меньше.
    const area = 4 * dLat * dLng;
    if (area > MAX_BBOX_DEG2) {
        const k = Math.sqrt(MAX_BBOX_DEG2 / area);
        dLat *= k;
        dLng *= k;
    }
    return [lng - dLng, lat - dLat, lng + dLng, lat + dLat]
        .map(v => v.toFixed(6)).join(',');
}

/**
 * Снимки в квадрате вокруг точки. Пустой массив — «тут ничего нет».
 *
 * Сломанный токен и превышенный лимит от «тут ничего нет» отличаются:
 * перебирать дальше в этом случае бессмысленно, все попытки упрутся в то же
 * самое, поэтому наружу летит ошибка, а не пустота.
 */
export async function lookup(point, km = SEARCH_KM) {
    const url = new URL(API_URL);
    url.searchParams.set('access_token', token());
    url.searchParams.set('fields', 'id,computed_geometry,geometry,is_pano');
    url.searchParams.set('bbox', bbox(point, km));
    url.searchParams.set('limit', String(LIMIT));

    const res = await fetchWithRetry(url, {}, { timeoutMs: TIMEOUT_MS });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
        const why = body?.error?.message || `HTTP ${res.status}`;
        throw new Error(`Mapillary: ${why}`);
    }
    return (body?.data || []).filter(img => coordsOf(img));
}

// У части снимков уточнённой геометрии нет — тогда берём исходную, с GPS
// камеры. Она грубее на единицы метров, а на карте мира это ничто.
function coordsOf(img) {
    const c = img?.computed_geometry?.coordinates || img?.geometry?.coordinates;
    return Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) ? c : null;
}

function toPoint(img, label) {
    const [lng, lat] = coordsOf(img);
    return { pano: String(img.id), lat, lng, label, is_pano: !!img.is_pano };
}

/**
 * Найти место для раунда.
 *
 * rand — источник случайности. У дейли он детерминированный (см. dailyRand):
 * тогда одна и та же опорная точка выпадает человеку весь день, сколько бы раз
 * он ни перезагрузил страницу до первого ответа.
 */
export async function nextPoint(rand = Math.random) {
    const pick = (list) => list[Math.floor(rand() * list.length) % list.length];
    let fallback = null;   // первый попавшийся плоский снимок — про запас

    for (let i = 0; i < TRIES; i++) {
        // Плоский уже есть, а сферический всё не находится — хватит искать.
        if (fallback && i >= PANO_PATIENCE) break;

        const candidate = pickPoint(rand);
        const images = await lookup(candidate);
        if (!images.length) continue;

        const panos = images.filter(img => img.is_pano);
        if (panos.length) return toPoint(pick(panos), candidate.label);
        if (!fallback) fallback = { img: pick(images), label: candidate.label };
    }
    return fallback ? toPoint(fallback.img, fallback.label) : null;
}

/**
 * Случайность для дейли: своя у каждого аккаунта, одна и та же весь день.
 *
 * Тот же принцип, что у вордле (backend/src/daily.js), но результат здесь всё
 * равно СОХРАНЯЕТСЯ: банк снимков — живой сервис, и завтра он может ответить
 * на тот же запрос иначе. Хэш даёт «у каждого своё», а не «выводится заново».
 */
export function dailyRand(userId, day) {
    let counter = 0;
    return () => {
        const digest = createHash('sha256').update(`geo:${userId}:${day}:${counter++}`).digest();
        return digest.readUInt32BE(0) / 2 ** 32;
    };
}
