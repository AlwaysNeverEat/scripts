// ─────────────────────────────────────────────────────────────────────────────
// Поддержавшие проект — /api/donors. Список видят все вошедшие (панель справа
// и звёздочка после ника), вносить и удалять пополнения может ровно один
// аккаунт — DONATION_ADMIN_LOGIN (shared/donations.js).
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';

import * as store from '../donations/store.js';
import { cleanDonation, isDonationAdmin, mskToday, monthOf } from '../../../shared/donations.js';

const ID_RE = /^\d{1,18}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createDonorsRouter({ db, now = () => Date.now() } = {}) {
    const router = Router();
    const opts = db ? { db } : {};
    const fail = (res, where, err) => {
        console.error(where, err);
        res.status(500).json({ error: { code: 'internal', message: 'сервер не ответил — попробуйте ещё раз' } });
    };
    const bad = (res, message) => res.status(400).json({ error: { code: 'bad_request', message } });
    const adminOnly = (req, res, next) => (isDonationAdmin(req.user)
        ? next()
        : res.status(403).json({ error: { code: 'forbidden', message: 'вносить пополнения может только тот, кто платит за сервер' } }));

    router.get('/', async (req, res) => {
        const month = monthOf(mskToday(now()));
        try {
            res.json({ month, donors: await store.listDonors(month, opts), canManage: isDonationAdmin(req.user) });
        } catch (err) { fail(res, 'GET /api/donors', err); }
    });

    router.get('/users', adminOnly, async (req, res) => {
        const q = String(req.query.q || '').trim().slice(0, 60);
        try { res.json({ users: await store.searchUsers(q, opts) }); } catch (err) { fail(res, 'GET /api/donors/users', err); }
    });

    router.get('/entries', adminOnly, async (req, res) => {
        try { res.json({ entries: await store.listEntries(opts) }); } catch (err) { fail(res, 'GET /api/donors/entries', err); }
    });

    router.post('/entries', adminOnly, async (req, res) => {
        const { donation, error } = cleanDonation(req.body, now());
        if (error) return bad(res, error);
        if (!UUID_RE.test(donation.userId)) return bad(res, 'не выбран человек');
        try {
            const entry = await store.addEntry({ ...donation, createdBy: req.user.id }, opts);
            if (!entry) return res.status(404).json({ error: { code: 'not_found', message: 'такого пользователя нет' } });
            res.status(201).json({ entry });
        } catch (err) { fail(res, 'POST /api/donors/entries', err); }
    });

    // Удалить можно только ошибочно внесённое — опечатку в сумме или не того
    // человека. Удалить удалённое — не ошибка.
    router.delete('/entries/:id', adminOnly, async (req, res) => {
        const id = String(req.params.id);
        if (!ID_RE.test(id)) return bad(res, 'id пополнения — число');
        try {
            await store.deleteEntry(id, opts);
            res.json({ ok: true });
        } catch (err) { fail(res, 'DELETE /api/donors/entries', err); }
    });

    return router;
}

export default createDonorsRouter();
