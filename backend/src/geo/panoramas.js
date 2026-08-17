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
// СНАЧАЛА ИЩЕМ СФЕРИЧЕСКИЕ (is_pano). Вокруг такого снимка можно оглядеться —
// а «посмотреть по сторонам» и есть игра. Плоских кадров у Mapillary в разы
// больше, но по одному кадру, снятому вперёд по ходу движения, угадывать почти
// нечего. Поэтому плоские берутся ВТОРЫМ проходом: лучше кадр в одну сторону,
// чем «не удалось подобрать точку».
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

// Полсторона квадрата поиска вокруг опорной точки, км. Больше, чем было бы
// нужно Google: покрытие рваное, и по маленькому квадрату половина точек
// уходила бы впустую.
const SEARCH_KM = 20;

// Сколько снимков просим за раз. Из них берём случайный — иначе на одной и той
// же опорной точке всем доставался бы один и тот же кадр.
const LIMIT = 100;

// Сколько опорных точек пробуем в каждом проходе.
const TRIES = 10;

const TIMEOUT_MS = 8000;

const KM_PER_DEG = 111.32;

export const token = () => process.env.MAPILLARY_TOKEN || '';
export const hasToken = () => !!token();

function bbox({ lat, lng }, km = SEARCH_KM) {
    const dLat = km / KM_PER_DEG;
    // Ближе к полюсам градус долготы короче — без косинуса квадрат в Тромсё
    // получился бы вчетверо шире, чем в Найроби.
    const cos = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    const dLng = km / (KM_PER_DEG * cos);
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
    // Проход первый — только сферические снимки, второй — любые.
    for (const panoOnly of [true, false]) {
        for (let i = 0; i < TRIES; i++) {
            const candidate = pickPoint(rand);
            const images = await lookup(candidate);
            const pool = panoOnly ? images.filter(img => img.is_pano) : images;
            if (!pool.length) continue;
            return toPoint(pool[Math.floor(rand() * pool.length) % pool.length], candidate.label);
        }
    }
    return null;
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
