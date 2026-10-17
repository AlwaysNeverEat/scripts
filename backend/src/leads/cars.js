// ─────────────────────────────────────────────────────────────────────────────
// Машины клиента — хранение (миграция 050_client_cars.sql). Клиент — телефон
// из 11 цифр (phone11 в shared/crmLeads.js), машина — строка cars.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../db/client.js';

// Отдаём ровно то, что нужно карточке лида и окну записи: марка и модель —
// для «Kia Rio» в комментарий, поколение, годы и мотор — чтобы две машины
// одной модели в карточке различались. Свежепривязанная — первой.
export async function listCars(phone, { db = query } = {}) {
    const { rows } = await db(
        `SELECT c.id, c.brand, c.model, c.generation, c.year_from, c.year_to,
                c.engine_volume, c.fuel_type, cc.added_at
           FROM client_cars cc JOIN cars c ON c.id = cc.car_id
          WHERE cc.phone = $1
          ORDER BY cc.added_at DESC`,
        [phone],
    );
    return rows.map(r => ({
        id: r.id,
        brand: r.brand,
        model: r.model,
        generation: r.generation || '',
        yearFrom: r.year_from ?? null,
        yearTo: r.year_to ?? null,
        engineVolume: r.engine_volume == null ? null : Number(r.engine_volume),
        fuel: r.fuel_type || '',
        addedAt: r.added_at,
    }));
}

// Повторная привязка той же машины ничего не меняет (и не поднимает её вверх
// списка): двойной клик не должен переставлять машины клиента.
export async function bindCar(phone, carId, userId, { db = query } = {}) {
    await db(
        `INSERT INTO client_cars (phone, car_id, added_by) VALUES ($1, $2, $3)
         ON CONFLICT (phone, car_id) DO NOTHING`,
        [phone, carId, userId],
    );
}

export async function unbindCar(phone, carId, { db = query } = {}) {
    await db(`DELETE FROM client_cars WHERE phone = $1 AND car_id = $2`, [phone, carId]);
}
