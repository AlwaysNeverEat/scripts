// ─────────────────────────────────────────────────────────────────────────────
// Машины клиента (лида) — привязки из НАШЕЙ базы (/api/lead-cars, миграция
// 050_client_cars.sql). Клиент — телефон, машин у него сколько угодно.
//
// Модуль — один экземпляр на вкладку браузера и общий кэш «телефон → машины»
// для трёх мест: карточки лида (список и «отвязать»), окошка в калькуляторе
// (leadCarDock.js — «привязать / отвязать») и окна новой записи (машины уходят
// в комментарий). Окно записи читает кэш СИНХРОННО: в момент его открытия
// карточка лида уже спросила машины, и ждать сеть ради комментария незачем.
//
// Любое изменение объявляется событием `lead-cars:changed` на window — так
// привязка из калькулятора сразу видна в открытой карточке лида и наоборот.
//
// Клиент — это НАБОР номеров лида (звонок и карточка CRM): у дублей лидов
// они расходятся, и машина, привязанная в одном дубле, должна быть видна в
// другом. Всё ниже принимает номер или список номеров; ключ кэша — список.
// Сервер пишет привязку на каждый номер, а ищет по любому.
// ─────────────────────────────────────────────────────────────────────────────

import { phone11 } from '../../shared/crmLeads.js';

const cache = new Map(); // «79…,79…» → [машины]

export const LEAD_CARS_EVENT = 'lead-cars:changed';

// Номер, список номеров или готовый ключ «79…,79…» → отсортированный список
// без мусора и повторов. Ключ разбирается по запятой: иначе phone11 склеил бы
// два номера в одну строку из 22 цифр и выбросил её как мусор.
export function leadPhones(raw) {
    const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
    return [...new Set(list.map(phone11).filter(Boolean))].sort();
}
// Ключ лида: одна строка на один и тот же набор номеров.
export const leadKey = (raw) => leadPhones(raw).join(',');

export function cachedLeadCars(raw) {
    return cache.get(leadKey(raw)) || null;
}

// Свежий список кладётся под ключ лида, а все остальные ключи, где есть хоть
// один из его номеров, выбрасываются: их машины могли измениться тоже, и
// следующий показ перечитает их у сервера.
function put(key, cars) {
    const mine = new Set(key.split(','));
    for (const k of cache.keys()) if (k !== key && k.split(',').some(p => mine.has(p))) cache.delete(k);
    cache.set(key, cars || []);
    window.dispatchEvent(new CustomEvent(LEAD_CARS_EVENT, { detail: { key, cars: cache.get(key) } }));
    return cache.get(key);
}

export async function loadLeadCars(apiFetch, raw) {
    const key = leadKey(raw);
    if (!key) return [];
    const { cars } = await apiFetch(`/api/lead-cars?phones=${key}`);
    return put(key, cars);
}

export async function bindLeadCar(apiFetch, raw, carId) {
    const key = leadKey(raw);
    const { cars } = await apiFetch('/api/lead-cars', { method: 'POST', body: { phones: key.split(','), carId } });
    return put(key, cars);
}

export async function unbindLeadCar(apiFetch, raw, carId) {
    const key = leadKey(raw);
    const { cars } = await apiFetch(`/api/lead-cars?phones=${key}&carId=${encodeURIComponent(carId)}`, { method: 'DELETE' });
    return put(key, cars);
}

// «Kia Rio III, 2011–2017, 1.6» — строка машины в карточке лида и в окошке:
// две машины одной модели должны различаться.
export function carLine(car) {
    const years = car.yearFrom ? `${car.yearFrom}–${car.yearTo || 'н.в.'}` : '';
    const vol = car.engineVolume ? car.engineVolume.toFixed(1) : '';
    const head = [car.brand, car.model, car.generation].filter(Boolean).join(' ');
    return [head, years, vol].filter(Boolean).join(', ');
}
