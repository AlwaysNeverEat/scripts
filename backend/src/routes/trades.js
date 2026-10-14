// ─────────────────────────────────────────────────────────────────────────────
// Обменник и маркет скинов — /api/trades (правила — shared/trades.js).
//
// Порядок у всего, что двигает вещи и гемы, один: узнать участников без
// замка, запереть кошельки обоих (trades/store.js → withUsers), ПЕРЕЧИТАТЬ
// предложение или лот под замком и проверить всё заново. Проверка до замка —
// только чтобы не отправлять заведомо мёртвое; решает та, что под ним.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';

import defaultStore from '../trades/store.js';
import { cleanOffer, tradeBlocker, cleanListing, buyBlocker, OPEN_OFFERS_MAX, LISTINGS_MAX } from '../../../shared/trades.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keys = (list) => new Set(list.map(it => `${it.pack}:${it.part}`));

export function createTradesRouter({ store = defaultStore } = {}) {
    const router = Router();
    const fail = (res, where, err) => {
        console.error(where, err);
        res.status(500).json({ error: { code: 'internal', message: 'сервер не ответил — попробуйте ещё раз' } });
    };
    const refuse = (res, message, code = 'refused', status = 409) => res.status(status).json({ error: { code, message } });
    const idOf = (req) => {
        const n = Number(req.params.id);
        return Number.isInteger(n) && n > 0 ? n : null;
    };
    // Состояние после действия — тем же ответом: окно перерисовывается без
    // второго запроса.
    const snapshot = async (me) => {
        const [wallet, offers] = await Promise.all([store.myWallet(me), store.offersOf(me)]);
        return { gems: wallet.gems, owned: wallet.owned, offers };
    };

    router.get('/', async (req, res) => {
        try { res.json(await snapshot(req.user.id)); } catch (err) { fail(res, 'GET /api/trades', err); }
    });

    router.get('/people', async (req, res) => {
        try { res.json({ people: await store.people(String(req.query.q || '').slice(0, 60), req.user.id) }); }
        catch (err) { fail(res, 'GET /api/trades/people', err); }
    });

    router.get('/people/:id', async (req, res) => {
        if (!UUID.test(req.params.id)) return refuse(res, 'такого человека нет', 'not_found', 404);
        try {
            const p = await store.personWithItems(req.params.id);
            if (!p) return refuse(res, 'такого человека нет', 'not_found', 404);
            res.json({ person: p });
        } catch (err) { fail(res, 'GET /api/trades/people/:id', err); }
    });

    // ── Обмен ────────────────────────────────────────────────────────────────

    router.post('/offers', async (req, res) => {
        const me = req.user.id;
        const { offer, error } = cleanOffer(req.body, me);
        if (error) return refuse(res, error, 'bad_request', 400);
        if (!UUID.test(offer.to)) return refuse(res, 'такого человека нет', 'not_found', 404);
        try {
            const to = await store.personWithItems(offer.to);
            if (!to) return refuse(res, 'такого человека нет', 'not_found', 404);
            const out = await store.withUsers([me, offer.to], async (tx) => {
                if (await tx.openOffers(me) >= OPEN_OFFERS_MAX) {
                    return { error: `висящих предложений уже ${OPEN_OFFERS_MAX} — дождитесь ответа или отмените старые` };
                }
                const blocker = tradeBlocker(offer, {
                    fromOwned: keys(await tx.owned(me)), toOwned: keys(await tx.owned(offer.to)),
                    fromGems: await tx.gems(me), toGems: Infinity,   // чужие гемы проверит «Принять»: их баланс — не наше дело
                });
                if (blocker) return { error: blocker };
                return { offer: await tx.insertOffer(me, offer) };
            });
            if (out.error) return refuse(res, out.error);
            res.json({ id: out.offer.id, ...(await snapshot(me)) });
        } catch (err) { fail(res, 'POST /api/trades/offers', err); }
    });

    router.post('/offers/:id/accept', async (req, res) => {
        const me = req.user.id;
        const id = idOf(req);
        if (!id) return refuse(res, 'такого предложения нет', 'not_found', 404);
        try {
            const peek = await store.peekOffer(id);
            if (!peek || peek.to !== me) return refuse(res, 'такого предложения нет', 'not_found', 404);
            const out = await store.withUsers([peek.from, peek.to], async (tx) => {
                const o = await tx.offer(id);
                if (o.status !== 'pending') return { error: 'предложение уже закрыто' };
                const blocker = tradeBlocker(o, {
                    fromOwned: keys(await tx.owned(o.from)), toOwned: keys(await tx.owned(o.to)),
                    fromGems: await tx.gems(o.from), toGems: await tx.gems(o.to),
                });
                if (blocker) {
                    // Мёртвое предложение закрывается, а не висит: принять
                    // его не выйдет и через час.
                    await tx.closeOffer(id, 'failed', blocker);
                    return { error: `обмен не прошёл: ${blocker}`, closed: true };
                }
                for (const it of o.give) await tx.move(o.from, o.to, it, 'trade');
                for (const it of o.want) await tx.move(o.to, o.from, it, 'trade');
                const gems = o.giveGems - o.wantGems;   // сколько гемов едет от отправителя к получателю
                if (gems) {
                    const meta = { offer: id };
                    await tx.ledger(o.from, { kind: 'trade', gems: -gems, meta: { ...meta, with: o.to } });
                    await tx.ledger(o.to, { kind: 'trade', gems, meta: { ...meta, with: o.from } });
                }
                await tx.closeOffer(id, 'accepted');
                return { ok: true };
            });
            // Закрытое как «не прошло» уже записано — отвечаем отказом, но
            // со свежим состоянием, чтобы строка в окне сменила статус.
            if (out.error) return res.status(409).json({ error: { code: 'refused', message: out.error }, ...(await snapshot(me)) });
            res.json({ ok: true, ...(await snapshot(me)) });
        } catch (err) { fail(res, 'POST /api/trades/offers/:id/accept', err); }
    });

    // Отклонить может получатель, отменить — отправитель. Ничего не двигается,
    // поэтому замок нужен только на строку предложения.
    for (const [action, who, status] of [['decline', 'to', 'declined'], ['cancel', 'from', 'cancelled']]) {
        router.post(`/offers/:id/${action}`, async (req, res) => {
            const me = req.user.id;
            const id = idOf(req);
            if (!id) return refuse(res, 'такого предложения нет', 'not_found', 404);
            try {
                const out = await store.withUsers([me], async (tx) => {
                    const o = await tx.offer(id);
                    if (!o || o[who] !== me) return { error: 'такого предложения нет', status: 404 };
                    if (o.status !== 'pending') return { error: 'предложение уже закрыто' };
                    await tx.closeOffer(id, status);
                    return { ok: true };
                });
                if (out.error) return refuse(res, out.error, out.status === 404 ? 'not_found' : 'refused', out.status || 409);
                res.json({ ok: true, ...(await snapshot(me)) });
            } catch (err) { fail(res, `POST /api/trades/offers/:id/${action}`, err); }
        });
    }

    // ── Маркет ───────────────────────────────────────────────────────────────

    const market = async (me) => {
        const [listings, sales, wallet] = await Promise.all([store.activeMarket(), store.mySales(me), store.myWallet(me)]);
        return { listings, sales, gems: wallet.gems, owned: wallet.owned };
    };

    router.get('/market', async (req, res) => {
        try { res.json(await market(req.user.id)); } catch (err) { fail(res, 'GET /api/trades/market', err); }
    });

    router.post('/market', async (req, res) => {
        const me = req.user.id;
        const { listing, error } = cleanListing(req.body);
        if (error) return refuse(res, error, 'bad_request', 400);
        try {
            const out = await store.withUsers([me], async (tx) => {
                if (!keys(await tx.owned(me)).has(`${listing.pack}:${listing.part}`)) return { error: 'этой вещи у вас нет' };
                const mine = await tx.activeListings(me);
                const same = mine.find(l => l.pack === listing.pack && l.part === listing.part);
                if (same) {
                    // Повторное выставление — это смена цены, а не второй лот.
                    await tx.closeListing(same.id, 'cancelled');
                } else if (mine.length >= LISTINGS_MAX) {
                    return { error: `выставлено уже ${LISTINGS_MAX} вещей — снимите что-нибудь` };
                }
                return { listing: await tx.insertListing(me, listing) };
            });
            if (out.error) return refuse(res, out.error);
            res.json({ id: out.listing.id, ...(await market(me)) });
        } catch (err) { fail(res, 'POST /api/trades/market', err); }
    });

    router.post('/market/:id/buy', async (req, res) => {
        const me = req.user.id;
        const id = idOf(req);
        if (!id) return refuse(res, 'такого лота нет', 'not_found', 404);
        try {
            const peek = await store.peekListing(id);
            if (!peek) return refuse(res, 'такого лота нет', 'not_found', 404);
            const out = await store.withUsers([me, peek.seller], async (tx) => {
                const l = await tx.listing(id);
                const blocker = buyBlocker(l, {
                    buyerId: me, sellerOwned: keys(await tx.owned(l.seller)),
                    buyerOwned: keys(await tx.owned(me)), buyerGems: await tx.gems(me),
                });
                if (blocker) return { error: blocker };
                await tx.move(l.seller, me, l, 'market');
                const meta = { listing: id, pack: l.pack, part: l.part };
                await tx.ledger(me, { kind: 'market_buy', gems: -l.price, meta: { ...meta, with: l.seller } });
                await tx.ledger(l.seller, { kind: 'market_sell', gems: l.price, meta: { ...meta, with: me } });
                // move() пометил лот «ушло» — переписываем на «продано».
                await tx.closeListing(id, 'sold', me);
                return { ok: true };
            });
            if (out.error) return refuse(res, out.error);
            res.json({ ok: true, ...(await market(me)) });
        } catch (err) { fail(res, 'POST /api/trades/market/:id/buy', err); }
    });

    router.post('/market/:id/cancel', async (req, res) => {
        const me = req.user.id;
        const id = idOf(req);
        if (!id) return refuse(res, 'такого лота нет', 'not_found', 404);
        try {
            const out = await store.withUsers([me], async (tx) => {
                const l = await tx.listing(id);
                if (!l || l.seller !== me) return { error: 'такого лота нет', status: 404 };
                if (l.status !== 'active') return { error: 'лот уже снят или продан' };
                await tx.closeListing(id, 'cancelled');
                return { ok: true };
            });
            if (out.error) return refuse(res, out.error, out.status === 404 ? 'not_found' : 'refused', out.status || 409);
            res.json({ ok: true, ...(await market(me)) });
        } catch (err) { fail(res, 'POST /api/trades/market/:id/cancel', err); }
    });

    return router;
}

export default createTradesRouter();
