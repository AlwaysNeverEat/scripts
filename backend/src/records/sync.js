// ─────────────────────────────────────────────────────────────────────────────
// Синхронизация с оригинальной админкой записей + очередь операций.
//
// Каждую минуту: сначала проталкиваем накопленные операции (create/update/
// delete) в порядке создания, затем перечитываем доски на сегодня и завтра
// (МСК) и сохраняем снапшоты в record_snapshots. Если оригинал лежит —
// снапшоты остаются от последнего успешного синка (фронт показывает
// «обновлено N назад»), а операции копятся в record_ops и уйдут сами после
// восстановления.
//
// Запускается в процессе Express (как Telegram-бот) — отдельный сервис на
// бесплатном хостинге не нужен.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../db/client.js';
import {
    fetchBoardHtml, fetchEditFormHtml, postRecordUpdate, deleteRecordByUrl,
    hasCredentials, ZmsError,
} from './adminClient.js';
import {
    parseRecordBoard, parseEditForm, buildExtensionOps, findMoveConflict,
} from '../../../shared/crmRecords.js';

const SYNC_INTERVAL_MS = Math.max(10_000, Number(process.env.RECORDS_SYNC_INTERVAL_MS) || 60_000);
const MAX_OP_ATTEMPTS = 30; // ~полчаса ретраев сетевых ошибок, потом failed

const state = {
    lastSuccessAt: null,   // Date последнего успешного чтения доски
    lastAttemptAt: null,
    lastError: '',         // текст последней ошибки ('' = всё хорошо)
    alive: false,          // последний тик дотянулся до оригинала
    running: false,
};

export function getSyncState() {
    return {
        lastSuccessAt: state.lastSuccessAt ? state.lastSuccessAt.toISOString() : null,
        lastAttemptAt: state.lastAttemptAt ? state.lastAttemptAt.toISOString() : null,
        lastError: state.lastError,
        alive: state.alive,
    };
}

// ── Даты (МСК) ───────────────────────────────────────────────────────────────

// «Сегодня» и «завтра» считаем по Москве — рабочий день станций живёт в МСК.
export function mskToday(offsetDays = 0) {
    const now = new Date(Date.now() + offsetDays * 86_400_000);
    const parts = new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric',
    }).formatToParts(now);
    const get = (t) => parts.find(p => p.type === t)?.value || '';
    return `${get('day')}.${get('month')}.${get('year')}`; // DD.MM.YYYY
}

export function ddmmyyyyToIso(d) {
    const m = String(d || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// ── Снапшоты ─────────────────────────────────────────────────────────────────

async function saveSnapshot(dateDDMMYYYY, board) {
    const iso = ddmmyyyyToIso(dateDDMMYYYY);
    if (!iso) return;
    await query(
        `INSERT INTO record_snapshots (day, data, fetched_at, ok, error)
         VALUES ($1, $2, now(), true, '')
         ON CONFLICT (day) DO UPDATE SET data = $2, fetched_at = now(), ok = true, error = ''`,
        [iso, board],
    );
}

async function markSnapshotError(dateDDMMYYYY, message) {
    const iso = ddmmyyyyToIso(dateDDMMYYYY);
    if (!iso) return;
    // data и fetched_at НЕ трогаем — они от последнего успешного синка.
    await query(
        `INSERT INTO record_snapshots (day, ok, error)
         VALUES ($1, false, $2)
         ON CONFLICT (day) DO UPDATE SET ok = false, error = $2`,
        [iso, String(message || 'ошибка синхронизации')],
    );
}

export async function loadSnapshot(dateDDMMYYYY) {
    const iso = ddmmyyyyToIso(dateDDMMYYYY);
    if (!iso) return null;
    const r = await query(
        'SELECT data, fetched_at, ok, error FROM record_snapshots WHERE day = $1',
        [iso],
    );
    if (!r.rows[0]) return null;
    return {
        board: r.rows[0].data,
        fetchedAt: r.rows[0].fetched_at ? r.rows[0].fetched_at.toISOString() : null,
        ok: r.rows[0].ok,
        error: r.rows[0].error,
    };
}

async function cleanupOldSnapshots() {
    // По требованию храним только сегодня и завтра (МСК).
    const today = ddmmyyyyToIso(mskToday(0));
    await query('DELETE FROM record_snapshots WHERE day < $1', [today]);
}

// ── Операции ─────────────────────────────────────────────────────────────────

export async function enqueueOp(type, payload, author = '') {
    const r = await query(
        `INSERT INTO record_ops (type, payload, author) VALUES ($1, $2, $3) RETURNING id`,
        [type, payload, author],
    );
    return r.rows[0].id;
}

export async function cancelOp(id) {
    const r = await query(
        `UPDATE record_ops SET status = 'failed', last_error = 'отменена вручную', applied_at = now()
         WHERE id = $1 AND status = 'pending' RETURNING id`,
        [id],
    );
    return Boolean(r.rows[0]);
}

export async function listOps({ limit = 50 } = {}) {
    const r = await query(
        `SELECT id, type, payload, status, attempts, last_error, author, created_at, applied_at
         FROM record_ops ORDER BY id DESC LIMIT $1`,
        [Math.min(200, Math.max(1, limit))],
    );
    return r.rows.map(row => ({
        id: Number(row.id),
        type: row.type,
        payload: row.payload,
        status: row.status,
        attempts: row.attempts,
        lastError: row.last_error,
        author: row.author,
        createdAt: row.created_at.toISOString(),
        appliedAt: row.applied_at ? row.applied_at.toISOString() : null,
    }));
}

export async function pendingOps() {
    const r = await query(
        `SELECT id, type, payload, attempts FROM record_ops WHERE status = 'pending' ORDER BY id`,
    );
    return r.rows.map(row => ({ id: Number(row.id), type: row.type, payload: row.payload, attempts: row.attempts }));
}

async function markOpDone(id) {
    await query(`UPDATE record_ops SET status = 'done', applied_at = now(), last_error = '' WHERE id = $1`, [id]);
}

async function markOpFailed(id, message) {
    await query(
        `UPDATE record_ops SET status = 'failed', applied_at = now(), last_error = $2 WHERE id = $1`,
        [id, String(message || 'ошибка')],
    );
}

async function bumpOpAttempt(id, message) {
    await query(
        `UPDATE record_ops
         SET attempts = attempts + 1,
             last_error = $2,
             status = CASE WHEN attempts + 1 >= $3 THEN 'failed' ELSE status END,
             applied_at = CASE WHEN attempts + 1 >= $3 THEN now() ELSE applied_at END
         WHERE id = $1`,
        [id, String(message || 'ошибка сети'), MAX_OP_ATTEMPTS],
    );
}

// Свежая доска нужного дня — для проверки конфликтов перед create.
async function freshBoard(date) {
    const html = await fetchBoardHtml(date);
    return parseRecordBoard(html);
}

// Применить одну операцию. Бросает ZmsError при сетевых проблемах (операция
// остаётся pending); возвращает { ok: true } либо { ok: false, reason } —
// логическая невозможность (слот занят и т.п.) → failed.
async function applyOp(op) {
    if (op.type === 'create') {
        const p = op.payload;
        const ops = buildExtensionOps(p, Number(p.durationMinutes) || 30);

        // Перед созданием сверяемся со СВЕЖЕЙ доской: пока операция лежала в
        // очереди, слот могли занять.
        const board = await freshBoard(p.date);
        for (const slot of ops) {
            const cell = board.cells[String(p.addressId)]?.[slot.time];
            if (!cell || cell.free < 1) {
                return { ok: false, reason: `слот ${slot.time} уже занят или закрыт — запись не создана` };
            }
        }
        for (const slot of ops) {
            await postRecordUpdate({ id: '', ...slot });
        }
        return { ok: true };
    }

    if (op.type === 'update') {
        // Перенос: пока операция лежала в очереди (например, оригинал был
        // недоступен), целевые слоты могли занять — сверяемся со СВЕЖЕЙ
        // доской, иначе получим двойную запись на один бокс. Правку данных
        // без смены места (имя/телефон) это не касается.
        const moving = op.payload.records.filter(r => r.addressId || r.date || r.time);
        if (moving.length) {
            const boardsByDate = {};
            for (const date of new Set(moving.map(r => r.date).filter(Boolean))) {
                boardsByDate[date] = await freshBoard(date);
            }
            const conflict = findMoveConflict(moving, boardsByDate);
            if (conflict) return { ok: false, reason: conflict };
        }

        // Для каждой записи читаем текущую форму, чтобы не затереть невидимые
        // на доске поля (госномер, комментарий).
        for (const r of op.payload.records) {
            let current = null;
            try {
                current = parseEditForm(await fetchEditFormHtml(r.id));
            } catch (err) {
                if (err instanceof ZmsError) throw err;
            }
            if (current === null) {
                return { ok: false, reason: `запись ${r.id} не найдена в оригинале (уже удалена?)` };
            }
            await postRecordUpdate({
                id: r.id,
                addressId: r.addressId ?? current.addressId,
                date: r.date ?? current.date,
                time: r.time ?? current.time,
                name: r.name ?? current.name ?? '',
                phone: r.phone ?? current.phone ?? '',
                carNumber: r.carNumber ?? current.carNumber ?? '',
                comment: r.comment ?? current.comment ?? '',
            });
        }
        return { ok: true };
    }

    if (op.type === 'delete') {
        for (const r of op.payload.records) {
            await deleteRecordByUrl(r.deleteUrl);
        }
        return { ok: true };
    }

    return { ok: false, reason: `неизвестный тип операции: ${op.type}` };
}

// Протолкнуть очередь. Останавливаемся на первой сетевой ошибке — порядок
// операций важен (создание продления после переноса и т.п.). Лок не даёт
// тику и «пинку» из роутера применить одну операцию дважды.
let draining = null;

export function drainQueue() {
    if (draining) return draining;
    draining = doDrainQueue().finally(() => { draining = null; });
    return draining;
}

async function doDrainQueue() {
    const ops = await pendingOps();
    for (const op of ops) {
        try {
            const result = await applyOp(op);
            if (result.ok) await markOpDone(op.id);
            else await markOpFailed(op.id, result.reason);
        } catch (err) {
            if (err instanceof ZmsError && err.code === 'zms_credentials_required') {
                state.lastError = err.message;
                return; // без кред очередь не сдвинуть
            }
            await bumpOpAttempt(op.id, err.message);
            if (err instanceof ZmsError) return; // сеть/оригинал лежит — ждём следующего тика
            // Неожиданная ошибка кода: не блокируем остальные операции.
            console.error('records: операция', op.id, err);
        }
    }
}

// ── Тик ──────────────────────────────────────────────────────────────────────

let ticking = null;

export async function syncTick() {
    if (ticking) return ticking; // не накладываем тики друг на друга
    ticking = (async () => {
        state.lastAttemptAt = new Date();
        try {
            if (!(await hasCredentials())) {
                state.alive = false;
                state.lastError = 'логин/пароль админки ещё не введены';
                return;
            }
            await drainQueue();

            const days = [mskToday(0), mskToday(1)];
            let anyOk = false;
            let firstError = '';
            for (const date of days) {
                try {
                    const board = await freshBoard(date);
                    await saveSnapshot(date, board);
                    anyOk = true;
                } catch (err) {
                    const message = err instanceof ZmsError ? err.message : `ошибка разбора: ${err.message}`;
                    if (!firstError) firstError = message;
                    await markSnapshotError(date, message);
                    if (err instanceof ZmsError && (err.code === 'zms_unavailable' || err.code === 'zms_credentials_required')) {
                        break; // второй день можно не мучить
                    }
                }
            }
            state.alive = anyOk;
            state.lastError = anyOk ? '' : (firstError || 'не удалось получить записи');
            if (anyOk) {
                state.lastSuccessAt = new Date();
                await cleanupOldSnapshots();
            }
        } catch (err) {
            state.alive = false;
            state.lastError = err.message;
            console.error('records sync', err);
        } finally {
            ticking = null;
        }
    })();
    return ticking;
}

export function startRecordsSync() {
    if (state.running) return;
    state.running = true;
    syncTick();
    const timer = setInterval(syncTick, SYNC_INTERVAL_MS);
    timer.unref?.();
}
