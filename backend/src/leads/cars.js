// ─────────────────────────────────────────────────────────────────────────────
// Машины клиента — хранение (миграция 050_client_cars.sql). Клиент — телефон
// из 11 цифр (phone11 в shared/crmLeads.js), машина — строка cars.
//
// У лида номеров бывает ДВА: с какого звонили и какой стоит в карточке CRM
// (дубли лидов — обычное дело, и у дубля они часто разные). Поэтому всё здесь
// принимает СПИСОК номеров: привязка пишется на каждый, а машины собираются
// по любому — иначе машина, привязанная в одном дубле, «пропадала» в другом.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../db/client.js';

// Отдаём ровно то, что нужно карточке лида и окну записи: марка и модель —
// для «Kia Rio» в комментарий, поколение, годы и мотор — чтобы две машины
// одной модели в карточке различались. Свежепривязанная — первой; машина,
// привязанная к нескольким номерам, — один раз.
export async function listCars(phones, { db = query } = {}) {
    const { rows } = await db(
        `SELECT * FROM (
            SELECT DISTINCT ON (c.id) c.id, c.brand, c.model, c.generation, c.year_from, c.year_to,
                   c.engine_volume, c.fuel_type, cc.added_at
              FROM client_cars cc JOIN cars c ON c.id = cc.car_id
             WHERE cc.phone = ANY($1::text[])
             ORDER BY c.id, cc.added_at DESC
         ) t ORDER BY added_at DESC`,
        [phones],
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
export async function bindCar(phones, carId, userId, { db = query } = {}) {
    await db(
        `INSERT INTO client_cars (phone, car_id, added_by)
         SELECT p, $2, $3 FROM unnest($1::text[]) AS p
         ON CONFLICT (phone, car_id) DO NOTHING`,
        [phones, carId, userId],
    );
}

// Отвязка снимает машину со ВСЕХ номеров лида: иначе она тут же вернулась бы
// в список по второму номеру.
export async function unbindCar(phones, carId, { db = query } = {}) {
    await db(`DELETE FROM client_cars WHERE phone = ANY($1::text[]) AND car_id = $2`, [phones, carId]);
}
