// ─────────────────────────────────────────────────────────────────────────────
// Откуда берётся загаданное место: справочник панорам Google.
//
// КАК ЭТО УСТРОЕНО ПОД КАПОТОМ. У Street View есть отдельная ручка «а есть ли
// тут панорама» — metadata у Static-API. Она принимает координату и радиус,
// возвращает id ближайшей панорамы и её ТОЧНЫЕ координаты, и — что важно —
// не тарифицируется вовсе: платят за показ панорамы, а не за вопрос о ней.
// Поэтому точку выбираем здесь, на сервере: мы спрашиваем справочник про
// случайную координату из shared/geoPoints.js, получаем настоящее место съёмки
// и кладём его в базу. Браузеру уезжает ТОЛЬКО id панорамы — по нему картинка
// показывается, а координата в ответе не приходит.
//
// Радиус большой (десяток километров) сознательно: опорная точка — это «где-то
// в этой стране», а не адрес. Пусть справочник сам найдёт ближайшую дорогу.
//
// source=outdoor отсекает съёмку внутри помещений: угадывать страну по холлу
// отеля невозможно, и такой раунд человек справедливо считает сломанным.
//
// Ключ нужен и здесь, и в браузере (панораму рисует гугловский скрипт). Ключей
// поэтому два: серверный — в GOOGLE_MAPS_KEY, браузерный (тот, что ограничен
// по домену) — в GOOGLE_MAPS_BROWSER_KEY. Если второго нет, отдаём первый: на
// маленькой установке городить два ключа незачем. Нет ни одного — игра честно
// говорит, что не настроена, вместо белого экрана.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { fetchWithRetry } from '../http/netRetry.js';
import { pickPoint } from '../../../shared/geoPoints.js';

const META_URL = 'https://maps.googleapis.com/maps/api/streetview/metadata';

// Радиус поиска панорамы вокруг запрошенной координаты, м.
const RADIUS_M = 12000;

// Сколько координат пробуем, прежде чем сдаться. Опорные точки стоят в
// покрытых странах, поэтому обычно хватает первой; десяток — на случай, когда
// разброс увёл запрос в море или в горы.
const TRIES = 12;

const TIMEOUT_MS = 8000;

export const serverKey = () => process.env.GOOGLE_MAPS_KEY || '';
export const browserKey = () => process.env.GOOGLE_MAPS_BROWSER_KEY || serverKey();
export const hasKey = () => !!serverKey() && !!browserKey();

/**
 * Есть ли панорама рядом с этой координатой.
 * Возвращает { pano, lat, lng } или null, если поблизости ничего нет.
 */
export async function lookup({ lat, lng }, radius = RADIUS_M) {
    const url = new URL(META_URL);
    url.searchParams.set('location', `${lat.toFixed(6)},${lng.toFixed(6)}`);
    url.searchParams.set('radius', String(radius));
    url.searchParams.set('source', 'outdoor');
    url.searchParams.set('key', serverKey());

    const res = await fetchWithRetry(url, {}, { timeoutMs: TIMEOUT_MS });
    if (!res.ok) throw new Error(`справочник панорам ответил ${res.status}`);
    const body = await res.json();

    if (body.status === 'ZERO_RESULTS' || body.status === 'NOT_FOUND') return null;
    if (body.status !== 'OK') {
        // REQUEST_DENIED (ключ не тот), OVER_QUERY_LIMIT — это не «тут нет
        // панорамы», а сломанная настройка: перебирать дальше бессмысленно,
        // все двенадцать попыток упрутся в то же самое.
        throw new Error(`справочник панорам: ${body.status}${body.error_message ? ` (${body.error_message})` : ''}`);
    }
    return { pano: body.pano_id, lat: body.location.lat, lng: body.location.lng };
}

/**
 * Найти место для раунда.
 *
 * rand — источник случайности. У дейли он детерминированный (см. dailyRand):
 * тогда одна и та же опорная точка выпадает человеку весь день, сколько бы раз
 * он ни перезагрузил страницу до первого ответа.
 */
export async function nextPoint(rand = Math.random) {
    for (let i = 0; i < TRIES; i++) {
        const candidate = pickPoint(rand);
        const found = await lookup(candidate);
        if (found) return { ...found, label: candidate.label };
    }
    return null;
}

/**
 * Случайность для дейли: своя у каждого аккаунта, одна и та же весь день.
 *
 * Тот же принцип, что у вордле (backend/src/daily.js), но результат здесь всё
 * равно СОХРАНЯЕТСЯ: справочник панорам — живой сервис, и завтра он может
 * ответить на тот же запрос иначе. Хэш даёт «у каждого своё», а не «выводится
 * заново».
 */
export function dailyRand(userId, day) {
    let counter = 0;
    return () => {
        const digest = createHash('sha256').update(`geo:${userId}:${day}:${counter++}`).digest();
        return digest.readUInt32BE(0) / 2 ** 32;
    };
}
