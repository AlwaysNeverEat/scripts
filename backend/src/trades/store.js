// ─────────────────────────────────────────────────────────────────────────────
// Обменник и маркет — хранение. Правила — shared/trades.js, таблицы —
// миграция 049_trades.sql, порядок действий — routes/trades.js.
//
// Всё, что двигает вещи или гемы, идёт внутри `withUsers`: одна транзакция и
// замки на кошельки ВСЕХ участников, взятые в порядке id. Замок тот же, что у
// кейсов (cases/store.js), поэтому обмен не разминётся с открытием кейса, а
// порядок id не даёт двум встречным обменам ждать друг друга вечно.
// ─────────────────────────────────────────────────────────────────────────────

import pool, { query } from '../db/client.js';
import { ops as walletOps, WALLET_LOCK } from '../cases/store.js';
import { SKIN_EDITOR_LOGINS } from '../../../shared/skins.js';

const items = (v) => (Array.isArray(v) ? v : []).map(it => ({ pack: it.pack, part: it.part }));

function offerRow(r) {
    return {
        id: Number(r.id), from: r.from_user, to: r.to_user,
        give: items(r.give), giveGems: r.give_gems, want: items(r.want), wantGems: r.want_gems,
        note: r.note || '', status: r.status, reason: r.reason || null,
        createdAt: r.created_at, closedAt: r.closed_at,
    };
}
const listingRow = (r) => ({
    id: Number(r.id), seller: r.seller, pack: r.pack, part: r.part, price: r.price,
    status: r.status, buyer: r.buyer || null, createdAt: r.created_at, closedAt: r.closed_at,
});

function txOps(q) {
    return {
        async owned(userId) { return walletOps(q, userId).owned(); },
        async gems(userId) { return (await walletOps(q, userId).balance()).gems; },
        async ledger(userId, row) { return walletOps(q, userId).ledger(row); },

        // Вещь переезжает: строка skin_items меняет хозяина, у прежнего она
        // снимается с себя (редактор паков носит что угодно — его не трогаем),
        // а его лот на эту вещь закрывается: вернись она к нему потом, старый
        // лот ожил бы сам.
        async move(fromId, toId, it, source) {
            const { rowCount } = await q(
                `UPDATE skin_items SET user_id = $2, source = $5, created_at = now()
                 WHERE user_id = $1 AND pack = $3 AND part = $4`,
                [fromId, toId, it.pack, it.part, source],
            );
            if (!rowCount) throw new Error(`skin_items: ${it.pack}:${it.part} нет у ${fromId}`);
            await q(
                `UPDATE user_skins SET parts = jsonb_set(parts, ARRAY[$2::text], 'null'::jsonb), updated_at = now()
                 WHERE user_id = $1 AND parts->>$2 = $3
                   AND NOT EXISTS (SELECT 1 FROM users WHERE id = $1 AND lower(login) = ANY($4::text[]))`,
                [fromId, it.part, it.pack, SKIN_EDITOR_LOGINS],
            );
            await q(
                `UPDATE market_listings SET status = 'gone', closed_at = now()
                 WHERE seller = $1 AND pack = $2 AND part = $3 AND status = 'active'`,
                [fromId, it.pack, it.part],
            );
        },

        async offer(id) {
            const { rows: [r] } = await q(`SELECT * FROM trade_offers WHERE id = $1 FOR UPDATE`, [id]);
            return r ? offerRow(r) : null;
        },
        async openOffers(fromId) {
            const { rows: [r] } = await q(`SELECT count(*)::int AS n FROM trade_offers WHERE from_user = $1 AND status = 'pending'`, [fromId]);
            return r.n;
        },
        async insertOffer(fromId, o) {
            const { rows: [r] } = await q(
                `INSERT INTO trade_offers (from_user, to_user, give, give_gems, want, want_gems, note)
                 VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6, $7) RETURNING *`,
                [fromId, o.to, JSON.stringify(o.give), o.giveGems, JSON.stringify(o.want), o.wantGems, o.note],
            );
            return offerRow(r);
        },
        async closeOffer(id, status, reason = null) {
            await q(`UPDATE trade_offers SET status = $2, reason = $3, closed_at = now() WHERE id = $1`, [id, status, reason]);
        },

        async listing(id) {
            const { rows: [r] } = await q(`SELECT * FROM market_listings WHERE id = $1 FOR UPDATE`, [id]);
            return r ? listingRow(r) : null;
        },
        async activeListings(seller) {
            const { rows } = await q(`SELECT * FROM market_listings WHERE seller = $1 AND status = 'active'`, [seller]);
            return rows.map(listingRow);
        },
        async insertListing(seller, l) {
            const { rows: [r] } = await q(
                `INSERT INTO market_listings (seller, pack, part, price) VALUES ($1, $2, $3, $4) RETURNING *`,
                [seller, l.pack, l.part, l.price],
            );
            return listingRow(r);
        },
        async closeListing(id, status, buyer = null) {
            await q(`UPDATE market_listings SET status = $2, buyer = $3, closed_at = now() WHERE id = $1`, [id, status, buyer]);
        },
    };
}

export async function withUsers(ids, fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const id of [...new Set(ids.map(String))].sort()) await client.query(WALLET_LOCK, [id]);
        const out = await fn(txOps((t, p) => client.query(t, p)));
        await client.query('COMMIT');
        return out;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

// ── Только читать ────────────────────────────────────────────────────────────

const PERSON = `u.id, u.display_name, u.avatar`;

// Предложения человека: висящие целиком и закрытые за последний месяц —
// история нужна, чтобы увидеть «чем кончилось», а не архив навсегда.
export async function offersOf(userId) {
    const { rows } = await query(
        `SELECT o.*, f.display_name AS f_name, f.avatar AS f_avatar, t.display_name AS t_name, t.avatar AS t_avatar
         FROM trade_offers o JOIN users f ON f.id = o.from_user JOIN users t ON t.id = o.to_user
         WHERE (o.from_user = $1 OR o.to_user = $1)
           AND (o.status = 'pending' OR o.closed_at > now() - interval '30 days')
         ORDER BY o.id DESC LIMIT 200`,
        [userId],
    );
    return rows.map(r => ({
        ...offerRow(r),
        fromUser: { id: r.from_user, name: r.f_name, avatar: r.f_avatar || null },
        toUser: { id: r.to_user, name: r.t_name, avatar: r.t_avatar || null },
    }));
}

// Активные лоты — только те, чья вещь всё ещё у продавца (страховка поверх
// 'gone' из move) и чей продавец не забанен.
export async function activeMarket() {
    const { rows } = await query(
        `SELECT l.*, u.display_name AS s_name, u.avatar AS s_avatar
         FROM market_listings l JOIN users u ON u.id = l.seller
         JOIN skin_items i ON i.user_id = l.seller AND i.pack = l.pack AND i.part = l.part
         WHERE l.status = 'active' AND u.banned_at IS NULL
         ORDER BY l.id DESC LIMIT 500`,
    );
    return rows.map(r => ({ ...listingRow(r), sellerUser: { id: r.seller, name: r.s_name, avatar: r.s_avatar || null } }));
}

// Свои проданные — «что купили и за сколько» за месяц.
export async function mySales(userId) {
    const { rows } = await query(
        `SELECT l.*, u.display_name AS b_name FROM market_listings l LEFT JOIN users u ON u.id = l.buyer
         WHERE (l.seller = $1 OR l.buyer = $1) AND l.status = 'sold' AND l.closed_at > now() - interval '30 days'
         ORDER BY l.closed_at DESC LIMIT 100`,
        [userId],
    );
    return rows.map(r => ({ ...listingRow(r), buyerName: r.b_name || null }));
}

// С кем меняться: поиск по имени и логину, свежие первыми. Только у кого
// есть хоть одна вещь — меняться с пустым инвентарём не на что.
export async function people(q, meId) {
    const like = `%${String(q || '').trim().replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const { rows } = await query(
        `SELECT ${PERSON}, count(i.*)::int AS items
         FROM users u JOIN skin_items i ON i.user_id = u.id
         WHERE u.id <> $1 AND u.banned_at IS NULL
           AND (u.display_name ILIKE $2 OR u.login ILIKE $2)
         GROUP BY u.id ORDER BY u.display_name LIMIT 30`,
        [meId, like],
    );
    return rows.map(r => ({ id: r.id, name: r.display_name, avatar: r.avatar || null, items: r.items }));
}

export async function personWithItems(userId) {
    const { rows: [u] } = await query(`SELECT ${PERSON} FROM users u WHERE u.id = $1 AND u.banned_at IS NULL`, [userId]);
    if (!u) return null;
    const { rows } = await query(`SELECT pack, part FROM skin_items WHERE user_id = $1`, [userId]);
    return { id: u.id, name: u.display_name, avatar: u.avatar || null, items: rows.map(r => ({ pack: r.pack, part: r.part })) };
}

// Без замка — узнать участников, чьи кошельки потом запереть.
export async function peekOffer(id) {
    const { rows: [r] } = await query(`SELECT * FROM trade_offers WHERE id = $1`, [id]);
    return r ? offerRow(r) : null;
}
export async function peekListing(id) {
    const { rows: [r] } = await query(`SELECT * FROM market_listings WHERE id = $1`, [id]);
    return r ? listingRow(r) : null;
}

export async function myWallet(userId) {
    const w = walletOps(query, userId);
    const [balance, owned] = await Promise.all([w.balance(), w.owned()]);
    return { gems: balance.gems, owned };
}

export default { withUsers, offersOf, activeMarket, mySales, people, personWithItems, peekOffer, peekListing, myWallet };
