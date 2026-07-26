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
import { parseRecordBoard, parseEditForm } from '../../../shared/crmRecords.js';
import { applyOp, hasAppliedWork } from './opEngine.js';

const SYNC_INTERVAL_MS = Math.max(10_000, Number(process.env.RECORDS_SYNC_INTERVAL_MS) || 60_000);
const MAX_OP_ATTEMPTS = 30;       // ~полчаса ретраев сетевых ошибок, потом откат/failed
const MAX_ROLLBACK_ATTEMPTS = 30; // столько же попыток вернуть уехавшее назад
const HISTORY_TTL_HOURS = 24;     // сколько живёт история применённых операций
const HISTORY_SWEEP_MS = 3_600_000;

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

// ── История операций ─────────────────────────────────────────────────────────

// История применённых операций живёт сутки: очередь — это оперативный журнал
// («что ушло в оригинал за сегодня»), а не архив, и раздувать её незачем.
// Незавершённые (pending, в т.ч. в откате) не трогаем никогда, сколько бы они
// ни ждали живого оригинала.
let lastHistorySweepAt = 0;

export async function cleanupOpHistory({ force = false } = {}) {
    if (!force && Date.now() - lastHistorySweepAt < HISTORY_SWEEP_MS) return 0;
    lastHistorySweepAt = Date.now();
    const r = await query(
        `DELETE FROM record_ops
          WHERE status <> 'pending'
            AND COALESCE(applied_at, created_at) < now() - ($1 || ' hours')::interval`,
        [String(HISTORY_TTL_HOURS)],
    );
    return r.rowCount || 0;
}

// ── Операции ─────────────────────────────────────────────────────────────────

export async function enqueueOp(type, payload, author = '') {
    const r = await query(
        `INSERT INTO record_ops (type, payload, author) VALUES ($1, $2, $3) RETURNING id`,
        [type, payload, author],
    );
    return r.rows[0].id;
}

// Отмена вручную. Если часть длинной операции уже уехала в оригинал, просто
// пометить её failed нельзя — иначе половина записи останется на новом месте:
// такую операцию переводим в откат, а failed она станет сама, когда всё
// вернётся.
export async function cancelOp(id) {
    const r = await query(
        `SELECT progress FROM record_ops WHERE id = $1 AND status = 'pending'`,
        [id],
    );
    if (!r.rows[0]) return false;
    const progress = r.rows[0].progress || {};
    if (progress.phase !== 'rollback' && hasAppliedWork(progress)) {
        await beginRollback(id, progress, 'отменена вручную');
        drainQueue().catch(() => {});
        return true;
    }
    const upd = await query(
        `UPDATE record_ops SET status = 'failed', last_error = 'отменена вручную', applied_at = now()
         WHERE id = $1 AND status = 'pending' RETURNING id`,
        [id],
    );
    return Boolean(upd.rows[0]);
}

export async function listOps({ limit = 50 } = {}) {
    const r = await query(
        `SELECT id, type, payload, progress, status, attempts, last_error, author, created_at, applied_at
         FROM record_ops ORDER BY id DESC LIMIT $1`,
        [Math.min(200, Math.max(1, limit))],
    );
    return r.rows.map(row => ({
        id: Number(row.id),
        type: row.type,
        payload: row.payload,
        status: row.status,
        // Операция в откате всё ещё pending, но делает противоположное —
        // интерфейсу нужно показывать «отменяю», а не «жду отправки».
        rollingBack: (row.progress || {}).phase === 'rollback',
        attempts: row.attempts,
        lastError: row.last_error,
        author: row.author,
        createdAt: row.created_at.toISOString(),
        appliedAt: row.applied_at ? row.applied_at.toISOString() : null,
    }));
}

export async function pendingOps() {
    const r = await query(
        `SELECT id, type, payload, progress, attempts FROM record_ops WHERE status = 'pending' ORDER BY id`,
    );
    return r.rows.map(row => ({
        id: Number(row.id),
        type: row.type,
        payload: row.payload,
        progress: row.progress || {},
        attempts: row.attempts,
    }));
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

// Свежая доска нужного дня — для проверки конфликтов перед изменением.
async function freshBoard(date) {
    const html = await fetchBoardHtml(date);
    return parseRecordBoard(html);
}

// ── Применение операций ──────────────────────────────────────────────────────

// Ввод-вывод для opEngine.js: вся сеть и база живут здесь, логика «всё или
// ничего» — там (и оттого покрыта тестами без сети и БД).
function opIo(op) {
    return {
        board: freshBoard,
        async editForm(id) {
            try {
                return parseEditForm(await fetchEditFormHtml(id));
            } catch (err) {
                if (err instanceof ZmsError) throw err;
                return null; // не разобралась форма — считаем, что записи нет
            }
        },
        update: (fields) => postRecordUpdate(fields),
        remove: (deleteUrl) => deleteRecordByUrl(deleteUrl),
        saveProgress: (progress) => saveProgress(op.id, progress),
        // Прогресс в памяти держим синхронным со строкой в БД: по нему
        // onOpError решает, что делать с сорвавшейся попыткой.
        beginRollback: async (progress, reason) => {
            op.progress = await beginRollback(op.id, progress, reason);
            return op.progress;
        },
        days: () => [mskToday(0), mskToday(1)],
    };
}

async function saveProgress(id, progress) {
    await query('UPDATE record_ops SET progress = $2 WHERE id = $1', [id, progress]);
}

// Операция в откате остаётся pending (она ещё ходит в оригинал), но делает
// обратное: возвращает уехавшие слоты на прежние места. failed она станет,
// когда возврат дойдёт до конца.
async function beginRollback(id, progress, reason) {
    const next = { ...progress, phase: 'rollback', reason, rollbackAttempts: 0 };
    await query(
        `UPDATE record_ops SET progress = $2, attempts = 0, last_error = $3 WHERE id = $1`,
        [id, next, `отменяю: ${reason}`],
    );
    return next;
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
            const result = await applyOp(op, opIo(op));
            if (result.ok) await markOpDone(op.id);
            else await markOpFailed(op.id, result.reason);
        } catch (err) {
            if (err instanceof ZmsError && err.code === 'zms_credentials_required') {
                state.lastError = err.message;
                return; // без кред очередь не сдвинуть
            }
            await onOpError(op, err.message);
            if (err instanceof ZmsError) return; // сеть/оригинал лежит — ждём следующего тика
            // Неожиданная ошибка кода: не блокируем остальные операции.
            console.error('records: операция', op.id, err);
        }
    }
}

// Сорвалась попытка применить операцию. Пока попытки не кончились, операция
// остаётся pending и повторится с того места, где встала. Когда кончились:
// уехавшую часть длинной записи возвращаем назад, а не бросаем на полпути.
async function onOpError(op, message) {
    const progress = op.progress || {};

    if (progress.phase === 'rollback') {
        const tries = (progress.rollbackAttempts || 0) + 1;
        await saveProgress(op.id, { ...progress, rollbackAttempts: tries });
        if (tries >= MAX_ROLLBACK_ATTEMPTS) {
            await markOpFailed(op.id,
                `${progress.reason}; вернуть записи на место не удалось (${message}) — проверьте оригинал вручную`);
        } else {
            await query('UPDATE record_ops SET last_error = $2 WHERE id = $1', [op.id, `отменяю: ${message}`]);
        }
        return;
    }

    if (op.attempts + 1 >= MAX_OP_ATTEMPTS && hasAppliedWork(progress)) {
        await beginRollback(op.id, progress, `не удалось применить целиком (${message})`);
        return;
    }
    await bumpOpAttempt(op.id, message);
}

// ── Тик ──────────────────────────────────────────────────────────────────────

let ticking = null;

export async function syncTick() {
    if (ticking) return ticking; // не накладываем тики друг на друга
    ticking = (async () => {
        state.lastAttemptAt = new Date();
        try {
            // Чистка истории не зависит от оригинала — делаем её до всего
            // остального, иначе при долгом простое админки журнал не подрежется.
            await cleanupOpHistory().catch(err => console.error('records: чистка истории', err));

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
