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
import {
    ZmsError, hasCredentials, testAndSaveCredentials, fetchBoardHtml, fetchEditFormHtml,
} from '../records/adminClient.js';
import {
    getSyncState, syncTick, drainQueue, loadSnapshot,
    enqueueOp, cancelOp, listOps, mskToday,
} from '../records/sync.js';
import {
    parseRecordBoard, parseEditForm, timeToMin,
    SLOT_MINUTES, MAX_DURATION_MIN, MAX_OP_RECORDS, WORK_END_MIN,
} from '../../../shared/crmRecords.js';
import { loadBoardAuthors } from '../records/credits.js';
import { query } from '../db/client.js';
import { requireRole } from '../auth/middleware.js';

const router = Router();

// Кто правит справочник станций и вешает предупреждения — и кто вводит
// логин/пароль оригинальной админки. Всё остальное в разделе по-прежнему
// открыто всем: записываться и переносить может кто угодно, в том числе гость.
const modOnly = requireRole('mod', 'admin');

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

// Логин/пароль общие на всех, но менять их — не общее дело: неверная пара
// рвёт раздел сразу у всех, поэтому ввод оставлен модераторам. Проверка
// серверная, а не «спрятали кнопку»: на роль здесь и держится доступ.
router.post('/credentials', modOnly, async (req, res) => {
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

// Кто записал каждого клиента на доске: { [recordId]: { id, display_name,
// avatar } } по зачётам топа (credits.js). Записи, сделанные мимо сайта (прямо
// в оригинальной админке), автора не имеют — и это правда, а не пробел.
// Отдельный catch: доска важнее подписи, без авторов она должна открываться.
async function authorsFor(date, board) {
    try {
        return await loadBoardAuthors(date, board);
    } catch (err) {
        console.error('records: авторы записей', err.message);
        return {};
    }
}

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
                    authors: await authorsFor(date, snap.board),
                });
            }
            // Снапшота ещё нет (первый запуск) — пробуем живьём и не ждём тика.
        }
        const html = await fetchBoardHtml(date);
        const board = parseRecordBoard(html);
        const ops = await listOps({ limit: 100 });
        const authors = await authorsFor(date, board);
        res.json({ date, source: 'live', board, fetchedAt: new Date().toISOString(), ok: true, error: '', ops, authors });
    } catch (err) {
        sendZmsError(res, err);
    }
});

// ── Карточка записи ──────────────────────────────────────────────────────────

// На доске оригинал показывает только имя и телефон: госномер и комментарий
// живут в форме /admin/record/edit. Тянем их поштучно, по требованию (когда
// запись открыли), — тащить формы всех записей дня ради доски нельзя, оригинал
// этого не переживёт.
router.get('/record/:id', async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return bad(res, 'id');
    if (!(await hasCredentials().catch(() => false))) {
        return res.status(403).json({ error: { code: 'zms_credentials_required', message: 'введите логин/пароль админки' } });
    }
    try {
        const form = parseEditForm(await fetchEditFormHtml(req.params.id));
        if (!form) {
            return res.status(404).json({ error: { code: 'record_not_found', message: 'записи больше нет в админке' } });
        }
        res.json({
            record: {
                id: String(req.params.id),
                name: form.name || '',
                phone: form.phone || '',
                carNumber: form.carNumber || '',
                comment: form.comment || '',
            },
        });
    } catch (err) {
        sendZmsError(res, err);
    }
});

// ── Справочник станций: правки модераторов и предупреждения ──────────────────
// Что и зачем — см. db/migrations/022_station_overrides.sql. Здесь важно одно:
// в patch кладутся ТОЛЬКО перечисленные ниже поля. `short` и `match` в списке
// нет намеренно — по ним станция опознаётся (и `short` вдобавок ключ строки),
// а lat/lng задают точку на карте и правятся вместе с ней, то есть в коде.

const PATCH_FIELDS = {
    // Код перевода звонка — всегда две цифры через две решётки.
    boxNo: (v) => (/^##\d{2}$/.test(v) ? v : undefined),
    metro: (v) => text(v, 40),
    line: (v) => (Number.isInteger(v) && v >= 1 && v <= 5 ? v : undefined),
    layout: (v) => text(v, 80),
    height: (v) => text(v, 20),
    // Гидростойка и кондиционер трёхзначные: «нет в патче» — как в справочнике,
    // true/false — модератор сказал своё слово.
    hydro: (v) => (typeof v === 'boolean' ? v : undefined),
    ac: (v) => (typeof v === 'boolean' ? v : undefined),
    boxes: (v) => (Number.isInteger(v) && v >= 1 && v <= 10 ? v : undefined),
    note: (v) => text(v, 120),
};

function text(v, max) {
    if (typeof v !== 'string') return undefined;
    const s = v.trim().slice(0, max);
    return s || undefined;
}

// Патч из тела запроса: неизвестные ключи и негодные значения молча
// отбрасываются, пустые строки означают «не переопределяю» и в патч не идут.
function cleanPatch(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [key, check] of Object.entries(PATCH_FIELDS)) {
        if (!(key in raw) || raw[key] === null) continue;
        const value = check(raw[key]);
        if (value !== undefined) out[key] = value;
    }
    return out;
}

const MISSING_TABLE = '42P01';

router.get('/stations', async (_req, res) => {
    try {
        const { rows } = await query(
            `SELECT station_key, patch, warning, updated_at, updated_by_name
               FROM station_overrides`);
        const stations = {};
        for (const row of rows) {
            stations[row.station_key] = {
                patch: row.patch || {},
                warning: row.warning || '',
                updatedAt: row.updated_at,
                updatedBy: row.updated_by_name || '',
            };
        }
        res.json({ stations });
    } catch (err) {
        // Миграцию 022 накатывают руками (см. DEPLOY.md). Пока её нет, раздел
        // должен работать как раньше, а не падать целиком: правок просто нет.
        if (err?.code === MISSING_TABLE) return res.json({ stations: {} });
        sendZmsError(res, err);
    }
});

// Ключ станции едет в теле, а не в пути: в нём бывают и косая черта, и
// запятая («Охтинская 9/1, Мурино»), а %2F в пути по дороге через прокси
// живёт непредсказуемо.
router.put('/stations', modOnly, async (req, res) => {
    const key = String(req.body?.key || '').trim();
    if (!key || key.length > 200) return bad(res, 'key');
    const patch = cleanPatch(req.body?.patch);
    const warning = String(req.body?.warning || '').trim().slice(0, 300);
    try {
        // Пустая правка — это не строка с пустыми полями, а отсутствие строки:
        // «сбросить всё» и «никогда не трогали» должны выглядеть одинаково.
        if (!Object.keys(patch).length && !warning) {
            await query('DELETE FROM station_overrides WHERE station_key = $1', [key]);
            return res.json({ ok: true, station: null });
        }
        const { rows } = await query(
            `INSERT INTO station_overrides (station_key, patch, warning, updated_by, updated_by_name)
                  VALUES ($1, $2::jsonb, $3, $4, $5)
             ON CONFLICT (station_key) DO UPDATE
                     SET patch = EXCLUDED.patch,
                         warning = EXCLUDED.warning,
                         updated_at = now(),
                         updated_by = EXCLUDED.updated_by,
                         updated_by_name = EXCLUDED.updated_by_name
               RETURNING patch, warning, updated_at, updated_by_name`,
            [key, JSON.stringify(patch), warning, req.user?.id || null, req.user?.display_name || ''],
        );
        const row = rows[0];
        res.json({
            ok: true,
            station: {
                patch: row.patch || {},
                warning: row.warning || '',
                updatedAt: row.updated_at,
                updatedBy: row.updated_by_name || '',
            },
        });
    } catch (err) {
        if (err?.code === MISSING_TABLE) {
            return res.status(503).json({
                error: { code: 'migration_required', message: 'таблица station_overrides ещё не создана — накатите миграцию 022' },
            });
        }
        sendZmsError(res, err);
    }
});

// ── Операции ─────────────────────────────────────────────────────────────────

// Потолки полей записи. Комментарий был 500, и этого не хватало: в него пишут
// не «вф+сф», а весь разговор с клиентом («на 5w30 не соглашается, привезёт
// своё, плюс промывка, машина после ДТП…»), и длинное описание доезжало до
// оригинала обрезанным ровно посередине фразы. 4000 — с запасом на такой
// рассказ; ограничение остаётся только чтобы в очередь не улетел мегабайт.
const FIELD_LIMITS = { name: 200, phone: 32, carNumber: 32, comment: 4000 };

// Обрезка на месте и ТОЛЬКО тех полей, что реально пришли: в операции правки
// отсутствующее поле означает «не менять», и подставлять ему пустую строку
// нельзя — она затёрла бы то, что лежит в оригинале.
function trimFields(target) {
    for (const [key, max] of Object.entries(FIELD_LIMITS)) {
        if (target[key] == null) continue;
        target[key] = String(target[key]).trim().slice(0, max);
    }
}

function validateCreate(p) {
    if (!/^\d+$/.test(String(p.addressId || ''))) return 'addressId';
    if (!DATE_RE.test(String(p.date || ''))) return 'date';
    if (!TIME_RE.test(String(p.time || ''))) return 'time';
    if (!String(p.name || '').trim()) return 'name';
    const dur = Number(p.durationMinutes) || SLOT_MINUTES;
    if (dur < SLOT_MINUTES || dur > MAX_DURATION_MIN || dur % SLOT_MINUTES !== 0) return 'durationMinutes';
    const start = timeToMin(p.time);
    if (Number.isNaN(start)) return 'time';
    // Сетка оригинала шире рабочего дня (до 22:30), а станции работают до 21:00:
    // запись, которая вылезает за закрытие, до очереди не доходит вовсе.
    if (start + dur > WORK_END_MIN) return 'time';
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
    if (!Array.isArray(p.records) || !p.records.length || p.records.length > MAX_OP_RECORDS) return 'records';
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
    // Имя автора берём у сессии, если она есть (её не подделать), и только для
    // гостя — из тела запроса. user_id нужен месячному топу: по нему считаются
    // сделанные записи (см. routes/top.js).
    const author = req.user?.display_name || String(req.body?.author || '').slice(0, 64);
    const userId = req.user?.id || null;

    let invalid = null;
    if (type === 'create') {
        invalid = validateCreate(payload);
        trimFields(payload);
    } else if (type === 'update') {
        invalid = validateRecordsList(payload, { needTarget: true });
        // Правка шла мимо обрезки вовсе: создание резало комментарий, правка не
        // резала ничего — одно и то же поле вело себя по-разному. Режем обе,
        // одним и тем же местом.
        for (const r of (payload.records || [])) trimFields(r);
    } else if (type === 'delete') {
        invalid = validateRecordsList(payload, { needTarget: false });
    } else {
        return bad(res, 'type: create | update | delete');
    }
    if (invalid) return bad(res, `некорректное поле: ${invalid}`);

    try {
        const id = await enqueueOp(type, payload, author, userId);
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
