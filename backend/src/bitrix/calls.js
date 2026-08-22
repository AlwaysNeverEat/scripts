// ─────────────────────────────────────────────────────────────────────────────
// Звонки и лента лидов: то, ради чего вся затея.
//
// О звонке сайту сообщают ДВА источника: наблюдатель, который сам смотрит в
// список лидов портала (watch.js), и датчик на вкладке Битрикса, читающий
// карточку телефонии (userscript/src/bitrix-call). Первый ловит новый лид,
// второй — звонок повторного клиента, у которого лид уже есть; ни один из них
// в одиночку всех звонков не видит. Здесь они сходятся в одну запись, и здесь
// же — три правила, которые к ней прилагаются.
//
// 1. Звонок открыт, пока НЕ ЗАКРЫТ ЛИД, а не пока идёт разговор. За стойкой
//    трубку кладут раньше, чем дописывают имя и комментарий; телефония о конце
//    разговора нам всё равно не сообщает.
// 2. Сорванный звонок (клиент бросил через секунду) всё равно попадает в
//    ленту. Лид Битрикс уже создал, и потерять его нельзя — иначе он потеряется
//    вообще: у оператора он даже на экране не успел появиться.
// 3. Клиент опознаётся ТЕЛЕФОНОМ. Лидов у человека со временем несколько, а
//    телефон один — на нём держатся и закреплённые машины, и будущий поиск
//    «что мы про этого клиента знаем».
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../db/client.js';
import { isCallSource } from './leads.js';

// Сколько дней держим ленту лидов. По умолчанию четыре: график 2/2, и,
// вернувшись из выходных, оператор должен застать свою прошлую смену — иначе
// «я вчера кому-то обещал перезвонить» проверить негде.
export function leadRetentionDays() {
    const raw = Number(process.env.BITRIX_LEAD_TTL_DAYS);
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 4;
}

// Телефон приезжает из разных мест по-разному: '+7 (911) 252-77-16' из
// карточки, '79112527716' от телефонии, '89112527716' из записи. В базе он
// ключ, по которому сходятся машины клиента и его лиды, поэтому вид один:
// только цифры, ведущая 8 меняется на 7.
export function normalizePhone(raw) {
    const digits = String(raw ?? '').replace(/\D+/g, '');
    if (!digits) return null;
    if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
    if (digits.length === 10) return `7${digits}`;
    return digits;
}

/**
 * Заполнен ли лид. «Не заполнен» — это не про аккуратность оператора, а про
 * факт: с ним никто не работал.
 *
 * Признаков два, и оба честные. Источник «Звонок» ставит телефония, и остаться
 * он может только если лид не открывали (сохранить с ним сайт не даёт —
 * см. leads.js). Пустое имя — то же самое с другой стороны.
 */
export function isLeadUnfilled(row) {
    if (row?.saved_at) return false;
    if (isCallSource(row?.source_id)) return true;
    return !String(row?.name ?? '').trim();
}

// ── Звонки ───────────────────────────────────────────────────────────────────

// Один и тот же звонок нам сообщают ДВА источника: датчик на вкладке Битрикса
// (по карточке телефонии) и наблюдатель за новыми лидами (bitrix/watch.js).
// Идентификаторы у них разные — «externalCall.…» и «lead:…», — поэтому по
// call_id они не сойдутся, и оператор получил бы два уведомления об одном
// звонке. Сводим их по ЛИДУ: два звонка на один лид подряд — это один звонок.
//
// Полчаса, а не «всегда»: тот же клиент, перезвонивший через час, попадает в
// тот же лид, и это уже другой разговор.
const SAME_LEAD_MS = 30 * 60 * 1000;

async function callForLead(userId, leadId) {
    if (!leadId) return null;
    const r = await query(
        `SELECT id, call_id, lead_id, phone, line, direction, started_at, closed_at
           FROM bitrix_calls
          WHERE user_id = $1 AND lead_id = $2
            AND started_at > now() - ($3 || ' milliseconds')::interval
          ORDER BY started_at DESC
          LIMIT 1`,
        [userId, leadId, String(SAME_LEAD_MS)],
    );
    return r.rows[0] || null;
}

/**
 * Источник увидел звонок. Приходит он МНОГО РАЗ за один звонок (карточка
 * перерисовывается, вкладку переоткрыли), поэтому запись одна на call_id, а
 * повтор только освежает данные.
 */
export async function noteCall(userId, call) {
    const callId = String(call?.callId ?? '').trim();
    if (!callId) return null;
    const phone = normalizePhone(call?.phone);
    const leadId = /^\d+$/.test(String(call?.leadId ?? '')) ? String(call.leadId) : null;

    // Про этот лид нам уже сообщили — пусть и под другим именем звонка.
    const twin = await callForLead(userId, leadId);
    if (twin && twin.call_id !== callId) {
        if (phone && !twin.phone) {
            await query('UPDATE bitrix_calls SET phone = $2 WHERE id = $1', [twin.id, phone]);
            twin.phone = phone;
        }
        return twin;
    }

    const r = await query(
        `INSERT INTO bitrix_calls (call_id, user_id, lead_id, phone, line, direction)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, call_id) DO UPDATE
            SET lead_id = COALESCE(EXCLUDED.lead_id, bitrix_calls.lead_id),
                phone   = COALESCE(EXCLUDED.phone, bitrix_calls.phone)
         RETURNING id, call_id, lead_id, phone, line, direction, started_at, closed_at`,
        [callId, userId, leadId, phone, call?.line || null, call?.direction || 'incoming'],
    );

    // Лид заводим в ленте СРАЗУ, не дожидаясь, пока оператор его откроет.
    // Сорванный звонок иначе исчезнет бесследно: карточка мигнула и пропала.
    if (leadId) await stubLead(leadId, phone);
    return r.rows[0] || null;
}

// Заготовка лида в ленте: только то, что известно от телефонии. Настоящие поля
// приедут, когда карточку прочитают, — а до тех пор строка честно считается
// незаполненной.
async function stubLead(leadId, phone) {
    await query(
        `INSERT INTO bitrix_leads (lead_id, phone, seen_at)
         VALUES ($1, $2, now())
         ON CONFLICT (lead_id) DO UPDATE
            SET phone = COALESCE(bitrix_leads.phone, EXCLUDED.phone)`,
        [leadId, phone],
    );
}

/** Открытый звонок оператора — ровно один, его и показывает панель. */
export async function openCall(userId) {
    const r = await query(
        `SELECT id, call_id, lead_id, phone, line, direction, started_at
           FROM bitrix_calls
          WHERE user_id = $1 AND closed_at IS NULL
          ORDER BY started_at DESC
          LIMIT 1`,
        [userId],
    );
    return r.rows[0] || null;
}

/** Оператор сохранил или закрыл лид — звонок больше не актуален. */
export async function closeCall(userId, callId = null) {
    await query(
        `UPDATE bitrix_calls SET closed_at = now()
          WHERE user_id = $1 AND closed_at IS NULL
            AND ($2::text IS NULL OR call_id = $2)`,
        [userId, callId],
    );
}

// ── Лента лидов ──────────────────────────────────────────────────────────────

/** Запомнить прочитанный или сохранённый лид. */
export async function rememberLead(lead, { userId = null, saved = false } = {}) {
    const view = lead?.view || {};
    const phone = normalizePhone(view.phones?.[0]);
    await query(
        `INSERT INTO bitrix_leads
             (lead_id, phone, title, name, status_id, source_id, assigned_by_id, comments, seen_at, saved_at, saved_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9, $10)
         ON CONFLICT (lead_id) DO UPDATE
            SET phone = COALESCE(EXCLUDED.phone, bitrix_leads.phone),
                title = EXCLUDED.title,
                name = EXCLUDED.name,
                status_id = EXCLUDED.status_id,
                source_id = EXCLUDED.source_id,
                assigned_by_id = EXCLUDED.assigned_by_id,
                comments = EXCLUDED.comments,
                seen_at = now(),
                -- saved_at не сбрасываем чтением: лид, который однажды
                -- заполнили, не должен снова становиться «незаполненным»
                -- оттого, что его просто открыли посмотреть.
                saved_at = COALESCE($9, bitrix_leads.saved_at),
                saved_by = COALESCE($10, bitrix_leads.saved_by)`,
        [
            view.id, phone, view.title || null, view.name || null,
            lead?.STATUS_ID || null, lead?.SOURCE_ID || null,
            Number(lead?.ASSIGNED_BY_ID) || null, view.comments || null,
            saved ? new Date() : null, saved ? userId : null,
        ],
    );
}

/** Лента обращений: что было за последние дни. */
export async function leadFeed({ limit = 50 } = {}) {
    const r = await query(
        `SELECT lead_id, phone, title, name, status_id, source_id, comments, seen_at, saved_at
           FROM bitrix_leads
          ORDER BY seen_at DESC
          LIMIT $1`,
        [Math.min(Math.max(Number(limit) || 50, 1), 200)],
    );
    return r.rows.map(row => ({
        leadId: String(row.lead_id),
        phone: row.phone,
        title: row.title,
        name: row.name,
        statusId: row.status_id,
        sourceId: row.source_id,
        comments: row.comments,
        seenAt: row.seen_at,
        savedAt: row.saved_at,
        unfilled: isLeadUnfilled(row),
    }));
}

// ── Авточистка ───────────────────────────────────────────────────────────────

// Чистим лениво, на записи, а не по расписанию: отдельного планировщика в
// проекте нет, а лента и так трогается на каждом звонке. Чаще раза в час
// смысла нет — за час набегает десяток строк.
let lastSweepAt = 0;
const SWEEP_EVERY_MS = 60 * 60 * 1000;

export async function sweepLeads({ force = false, now = Date.now() } = {}) {
    if (!force && now - lastSweepAt < SWEEP_EVERY_MS) return null;
    lastSweepAt = now;
    const days = leadRetentionDays();
    const leads = await query(
        `DELETE FROM bitrix_leads WHERE seen_at < now() - ($1 || ' days')::interval`,
        [String(days)],
    );
    // Звонки живут столько же: без своего лида строка звонка бесполезна.
    const calls = await query(
        `DELETE FROM bitrix_calls WHERE started_at < now() - ($1 || ' days')::interval`,
        [String(days)],
    );
    return { leads: leads.rowCount || 0, calls: calls.rowCount || 0, days };
}

// Для тестов: сбросить «когда мели в прошлый раз».
export function resetSweepClock() {
    lastSweepAt = 0;
}
