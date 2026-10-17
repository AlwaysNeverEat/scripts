// ─────────────────────────────────────────────────────────────────────────────
// Машины клиента — /api/lead-cars. Привязки ХРАНИМ У СЕБЯ, а не в CRM: в её
// карточке «Авто» — свободная строка, по ней машину в нашей базе не открыть и
// не посчитать. Привязывают из калькулятора (плавающее окошко у страницы
// машины, frontend/src/leadCarDock.js), смотрят и отвязывают — там же и в
// карточке лида.
//
//   GET    /?phone=79…            → { cars }
//   POST   / { phone, carId }     → { cars }  привязать
//   DELETE /?phone=79…&carId=…    → { cars }  отвязать
//
// Каждый ответ — свежий список целиком: окошко и карточка просто кладут его
// к себе и не собирают итог из «что я сейчас сделал».
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';

import * as store from '../leads/cars.js';
import { phone11 } from '../../../shared/crmLeads.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createLeadCarsRouter({ db } = {}) {
    const router = Router();
    const opts = db ? { db } : {};
    const bad = (res, message) => res.status(400).json({ error: { code: 'bad_request', message } });
    const fail = (res, where, err) => {
        console.error(where, err);
        res.status(500).json({ error: { code: 'internal', message: 'сервер не ответил — попробуйте ещё раз' } });
    };

    // Телефон и машина — из запроса или тела; плохое — 400 с понятной причиной.
    function read(src, needCar) {
        const phone = phone11(src?.phone);
        if (!phone) return { error: 'нужен номер телефона клиента' };
        const carId = String(src?.carId || '');
        if (needCar && !UUID_RE.test(carId)) return { error: 'нет такой машины' };
        return { phone, carId };
    }

    router.get('/', async (req, res) => {
        const { phone, error } = read(req.query, false);
        if (error) return bad(res, error);
        try {
            res.json({ cars: await store.listCars(phone, opts) });
        } catch (err) { fail(res, 'GET /api/lead-cars', err); }
    });

    router.post('/', async (req, res) => {
        const { phone, carId, error } = read(req.body, true);
        if (error) return bad(res, error);
        try {
            await store.bindCar(phone, carId, req.user.id, opts);
            res.json({ cars: await store.listCars(phone, opts) });
        } catch (err) {
            // Машину удалили, пока окошко висело открытым.
            if (err?.code === '23503') return res.status(404).json({ error: { code: 'not_found', message: 'этой машины уже нет в базе' } });
            fail(res, 'POST /api/lead-cars', err);
        }
    });

    router.delete('/', async (req, res) => {
        const { phone, carId, error } = read(req.query, true);
        if (error) return bad(res, error);
        try {
            await store.unbindCar(phone, carId, opts);
            res.json({ cars: await store.listCars(phone, opts) });
        } catch (err) { fail(res, 'DELETE /api/lead-cars', err); }
    });

    return router;
}

export default createLeadCarsRouter();
