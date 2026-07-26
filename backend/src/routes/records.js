// ─────────────────────────────────────────────────────────────────────────────
// API клона админки записей. Доступ ОБЩИЙ, без аккаунтов сайта (модель
// подтверждена: логин/пароль у оригинальной админки один на всех, кто-то один
// вводит его через POST /credentials — дальше страница работает у всех).
// Грубый гейт x-api-key из index.js действует и здесь.
//
// Пока сохранённых кред нет (или оригинал их отверг), «умные» эндпоинты
// отвечают 403 { code: 'zms_credentials_required' } — фронт показывает форму
// ввода логина/пароля админки.
//
// Чтение доски — из снапшотов (сегодня/завтра, обновляются воркером раз в
// минуту); произвольная дата — живым запросом к оригиналу.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { ZmsError, hasCredentials, testAndSaveCredentials, fetchBoardHtml } from '../records/adminClient.js';
import {
    getSyncState, syncTick, drainQueue, loadSnapshot,
    enqueueOp, cancelOp, listOps, mskToday,
} from '../records/sync.js';
import { parseRecordBoard, timeToMin, SLOT_MINUTES, MAX_DURATION_MIN } from '../../../shared/crmRecords.js';
import { query } from '../db/client.js';

const router = Router();

const DATE_RE = /^\d{2}\.\d{2}\.\d{4}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function sendZmsError(res, err) {
    if (err instanceof ZmsError) {
        const status = err.code === 'zms_unavailable' ? 502 : 403;
        return res.status(status).json({ error: { code: err.code, message: err.message } });
    }
    console.error('records API', err);
    return res.status(500).json({ error: { code: 'internal', message: 'внутренняя ошибка' } });
}

function bad(res, message) {
    return res.status(400).json({ error: { code: 'bad_request', message } });
}

// ── Креды ────────────────────────────────────────────────────────────────────

router.post('/credentials', async (req, res) => {
    const login = String(req.body?.login || '').trim();
    const password = String(req.body?.password || '');
    if (!login || !password) return bad(res, 'нужны login и password');
    try {
        await testAndSaveCredentials(login, password);
        // Сразу прогреваем снапшоты и проталкиваем накопившееся.
        syncTick();
        res.json({ ok: true });
    } catch (err) {
        sendZmsError(res, err);
    }
});

// ── Статус ───────────────────────────────────────────────────────────────────

router.get('/status', async (_req, res) => {
    try {
        const [creds, queueRows] = await Promise.all([
            hasCredentials(),
            query(`SELECT status, count(*)::int AS n FROM record_ops
                   WHERE status = 'pending' OR applied_at > now() - interval '1 day'
                   GROUP BY status`),
        ]);
        const queue = { pending: 0, failed: 0, done: 0 };
        for (const row of queueRows.rows) queue[row.status] = row.n;
        res.json({
            credentials: creds,
            ...getSyncState(),
            queue,
            today: mskToday(0),
            tomorrow: mskToday(1),
        });
    } catch (err) {
        sendZmsError(res, err);
    }
});

// ── Доска ────────────────────────────────────────────────────────────────────

router.get('/board', async (req, res) => {
    const date = String(req.query.date || mskToday(0));
    if (!DATE_RE.test(date)) return bad(res, 'date: DD.MM.YYYY');
    if (!(await hasCredentials().catch(() => false))) {
        return res.status(403).json({ error: { code: 'zms_credentials_required', message: 'введите логин/пароль админки' } });
    }
    try {
        const cached = [mskToday(0), mskToday(1)].includes(date);
        if (cached) {
            const snap = await loadSnapshot(date);
            const ops = await listOps({ limit: 100 });
            if (snap && snap.board) {
                return res.json({
                    date,
                    source: 'snapshot',
                    board: snap.board,
                    fetchedAt: snap.fetchedAt,
                    ok: snap.ok,
                    error: snap.error,
                    ops,
                });
            }
            // Снапшота ещё нет (первый запуск) — пробуем живьём и не ждём тика.
        }
        const html = await fetchBoardHtml(date);
        const board = parseRecordBoard(html);
        const ops = await listOps({ limit: 100 });
        res.json({ date, source: 'live', board, fetchedAt: new Date().toISOString(), ok: true, error: '', ops });
    } catch (err) {
        sendZmsError(res, err);
    }
});

// ── Операции ─────────────────────────────────────────────────────────────────

function validateCreate(p) {
    if (!/^\d+$/.test(String(p.addressId || ''))) return 'addressId';
    if (!DATE_RE.test(String(p.date || ''))) return 'date';
    if (!TIME_RE.test(String(p.time || ''))) return 'time';
    if (!String(p.name || '').trim()) return 'name';
    const dur = Number(p.durationMinutes) || SLOT_MINUTES;
    if (dur < SLOT_MINUTES || dur > MAX_DURATION_MIN || dur % SLOT_MINUTES !== 0) return 'durationMinutes';
    if (Number.isNaN(timeToMin(p.time))) return 'time';
    return null;
}

// Место записи в оригинале: станция + день + слот. Полагаемся на это и при
// проверке целевого окна перед переносом, и при откате, поэтому «половинчатых»
// адресов (одно время без станции) не принимаем.
function validatePlace(place, prefix) {
    if (!/^\d+$/.test(String(place.addressId ?? ''))) return `${prefix}.addressId`;
    if (!DATE_RE.test(String(place.date || ''))) return `${prefix}.date`;
    if (!TIME_RE.test(String(place.time || ''))) return `${prefix}.time`;
    return null;
}

function validateRecordsList(p, { needTarget }) {
    if (!Array.isArray(p.records) || !p.records.length || p.records.length > 16) return 'records';
    for (const r of p.records) {
        if (!/^\d+$/.test(String(r.id || ''))) return 'records[].id';
        if (!needTarget) {
            if (!/^\/admin\/record\/delete\?/.test(String(r.deleteUrl || ''))) return 'records[].deleteUrl';
            continue;
        }
        // Перенос — либо полный адрес назначения, либо ничего (правка полей).
        if (r.addressId != null || r.date != null || r.time != null) {
            const invalid = validatePlace(r, 'records[]');
            if (invalid) return invalid;
            // from — откуда запись уехала: по нему бэкенд возвращает слоты на
            // место, если перенос не удался целиком.
            if (r.from != null) {
                const invalidFrom = validatePlace(r.from, 'records[].from');
                if (invalidFrom) return invalidFrom;
            }
        }
    }
    return null;
}

router.post('/ops', async (req, res) => {
    const type = String(req.body?.type || '');
    const payload = req.body?.payload || {};
    const author = String(req.body?.author || '').slice(0, 64);

    let invalid = null;
    if (type === 'create') {
        invalid = validateCreate(payload);
        payload.name = String(payload.name).trim().slice(0, 200);
        payload.phone = String(payload.phone || '').trim().slice(0, 32);
        payload.carNumber = String(payload.carNumber || '').trim().slice(0, 32);
        payload.comment = String(payload.comment || '').trim().slice(0, 500);
    } else if (type === 'update') {
        invalid = validateRecordsList(payload, { needTarget: true });
    } else if (type === 'delete') {
        invalid = validateRecordsList(payload, { needTarget: false });
    } else {
        return bad(res, 'type: create | update | delete');
    }
    if (invalid) return bad(res, `некорректное поле: ${invalid}`);

    try {
        const id = await enqueueOp(type, payload, author);
        // Пинаем очередь сразу — при живом оригинале операция уйдёт за секунды;
        // ответа не ждём, статус виден через GET /ops.
        drainQueue().then(() => syncTick()).catch(() => {});
        res.json({ ok: true, opId: id });
    } catch (err) {
        sendZmsError(res, err);
    }
});

router.get('/ops', async (req, res) => {
    try {
        res.json({ ops: await listOps({ limit: Number(req.query.limit) || 50 }) });
    } catch (err) {
        sendZmsError(res, err);
    }
});

router.delete('/ops/:id', async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return bad(res, 'id');
    try {
        const cancelled = await cancelOp(Number(req.params.id));
        res.json({ ok: cancelled });
    } catch (err) {
        sendZmsError(res, err);
    }
});

// ── Форс-обновление ──────────────────────────────────────────────────────────

router.post('/refresh', async (_req, res) => {
    try {
        await syncTick();
        res.json({ ok: true, ...getSyncState() });
    } catch (err) {
        sendZmsError(res, err);
    }
});

export default router;
