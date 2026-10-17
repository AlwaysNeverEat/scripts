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
// ─────────────────────────────────────────────────────────────────────────────

import { phone11 } from '../../shared/crmLeads.js';

const cache = new Map(); // телефон (11 цифр) → [машины]

export const LEAD_CARS_EVENT = 'lead-cars:changed';

export function cachedLeadCars(raw) {
    return cache.get(phone11(raw)) || null;
}

function put(phone, cars) {
    cache.set(phone, cars || []);
    window.dispatchEvent(new CustomEvent(LEAD_CARS_EVENT, { detail: { phone, cars: cache.get(phone) } }));
    return cache.get(phone);
}

export async function loadLeadCars(apiFetch, raw) {
    const phone = phone11(raw);
    if (!phone) return [];
    const { cars } = await apiFetch(`/api/lead-cars?phone=${phone}`);
    return put(phone, cars);
}

export async function bindLeadCar(apiFetch, raw, carId) {
    const phone = phone11(raw);
    const { cars } = await apiFetch('/api/lead-cars', { method: 'POST', body: { phone, carId } });
    return put(phone, cars);
}

export async function unbindLeadCar(apiFetch, raw, carId) {
    const phone = phone11(raw);
    const { cars } = await apiFetch(`/api/lead-cars?phone=${phone}&carId=${encodeURIComponent(carId)}`, { method: 'DELETE' });
    return put(phone, cars);
}

// «Kia Rio III, 2011–2017, 1.6» — строка машины в карточке лида и в окошке:
// две машины одной модели должны различаться.
export function carLine(car) {
    const years = car.yearFrom ? `${car.yearFrom}–${car.yearTo || 'н.в.'}` : '';
    const vol = car.engineVolume ? car.engineVolume.toFixed(1) : '';
    const head = [car.brand, car.model, car.generation].filter(Boolean).join(' ');
    return [head, years, vol].filter(Boolean).join(', ');
}
