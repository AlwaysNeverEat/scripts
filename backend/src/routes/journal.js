// ─────────────────────────────────────────────────────────────────────────────
// Записи через журнал CRM — под ПЕРСОНАЛЬНОЙ учёткой работника.
//
// Отличие от routes/records.js (старая админка) ровно одно, и оно же причина
// переезда: там логин ОДИН НА ВСЕХ, раздел открыт даже гостю, и кто сделал
// запись, оригиналу не видно — автора мы восстанавливали сами, подбирая
// запись на доске по станции, времени и телефону. Здесь запрос уходит под
// сессией конкретного человека, и CRM сама проставляет записи `creator`.
//
// Отсюда следует ограничение, которого раньше не было: БЕЗ ПРИВЯЗАННОЙ
// УЧЁТКИ CRM записывать нельзя. Это не строгость ради строгости — именно
// общая учётка и была причиной того, что у записи нет автора. Гость сюда не
// попадает вовсе.
//
// Роутер живёт отдельным файлом, а не строчками в records.js, чтобы переезд
// можно было доделать и выключить старый путь одним куском, а не выковыривать
// его из перемешанного кода.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';

import { CrmError, crmEnsureSession } from '../crm/client.js';
import { mskDate, crmActor, fetchJournal } from '../crm/journal.js';
import { OpRefused, ddmmToIso, isoToDdmm, precheckJournalOp } from '../records/journalOps.js';
import { journalQueue, OP_TYPES } from '../records/journalQueue.js';
import { loadBoardAuthors } from '../records/credits.js';
import { journalToBoard } from '../../../shared/crmJournal.js';

const router = Router();

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function bad(res, message) {
    return res.status(400).json({ error: { code: 'bad_request', message } });
}

// Ошибки CRM доезжают до фронта СВОИМ кодом, а не общим «что-то пошло не
// так»: панели надо показать разное на «войди в CRM», «у твоей учётки нет
// права на запись» и «CRM не отвечает».
function sendCrmError(res, err) {
    if (err instanceof CrmError) {
        const status = err.code === 'crm_unavailable' ? 502
            : err.code === 'crm_forbidden' ? 403
            : err.code === 'crm_auth_required' ? 401
            : 400;
        return res.status(status).json({ error: { code: err.code, message: err.message } });
    }
    console.error('journal API', err);
    return res.status(500).json({ error: { code: 'internal', message: 'внутренняя ошибка' } });
}

// ── Гейт: своя учётка CRM обязательна ────────────────────────────────────────

// Замок на разделе. Проверку сессии принимает параметром — так тест гоняет
// ЭТОТ код, а не свою копию его ветвлений: замок, разошедшийся со своим
// тестом, хуже отсутствующего.
export function crmGate(ensure = crmEnsureSession) {
    return async function requireCrm(req, res, next) {
        if (!req.user) {
            return res.status(401).json({
                error: { code: 'auth_required', message: 'войдите на сайт' },
            });
        }
        try {
            const state = await ensure(req.user.id);
            if (state.loggedIn) return next();
            if (state.unavailable) {
                return res.status(502).json({
                    error: { code: 'crm_unavailable', message: state.unavailable },
                });
            }
            return res.status(403).json({
                error: {
                    code: 'crm_link_required',
                    // Текст уезжает на экран как есть — он и есть инструкция.
                    message: state.linkRejected
                        ? 'пароль от CRM больше не подходит — привяжите учётку заново в профиле'
                        : 'для записи нужна своя учётка CRM — привяжите её в профиле',
                },
            });
        } catch (err) {
            return sendCrmError(res, err);
        }
    };
}

// Список операций (общий, свои помечены `mine`) — ДО замка: он живёт в памяти процесса и CRM не
// трогает, а раздел опрашивает его раз в секунду, пока что-то исполняется.
// Проверять на каждом опросе сессию CRM значило бы ходить в базу впустую.
router.get('/ops', (req, res) => res.json({ ops: journalQueue.list(req.user.id) }));

// Отменить операцию, которая ещё не ушла в CRM.
router.delete('/ops/:id', (req, res) => {
    const ok = journalQueue.cancel(req.user.id, req.params.id);
    if (!ok) return res.status(409).json({ error: { code: 'refused', message: 'операция уже ушла в CRM — отменить нельзя' } });
    res.json({ ok: true });
});

router.use(crmGate());

// ── Кто я ────────────────────────────────────────────────────────────────────

// Фронт спрашивает это до того, как показать кнопку «Записать»: «у твоей
// учётки нет права на запись» надо знать до заполнения окна, а не после.
router.get('/me', async (req, res) => {
    try {
        const actor = await crmActor(req.user.id);
        res.json({
            user: actor.user,
            roleName: actor.roleName,
            isAdmin: actor.isAdmin,
            canBook: actor.canBook,
            today: mskDate(),
        });
    } catch (err) {
        sendCrmError(res, err);
    }
});

// ── Статус ───────────────────────────────────────────────────────────────────

// Раздел спрашивает это первым делом: какой сегодня день (по Москве) и кто
// работает. Раз мы здесь — замок пропустил, то есть учётка CRM живая.
router.get('/status', async (req, res) => {
    try {
        const actor = await crmActor(req.user.id);
        res.json({
            today: isoToDdmm(mskDate()),
            tomorrow: isoToDdmm(mskDate(Date.now() + 24 * 3600 * 1000)),
            credentials: true,
            // Раз замок пропустил — CRM ответила, то есть жива.
            alive: true,
            queue: { pending: 0, failed: 0, done: 0 },
            crm: { user: actor.user, roleName: actor.roleName, canBook: actor.canBook },
        });
    } catch (err) {
        sendCrmError(res, err);
    }
});

// ── Доска ────────────────────────────────────────────────────────────────────

// Кто записал. Два источника, и порядок у них осознанный: сперва наш зачёт —
// там человек с сайта, с аватаркой и профилем, и это тот же человек, под чьей
// учёткой CRM ушла запись; потом `creator` из самой CRM — он закрывает
// записи, сделанные прямо в CRM, мимо сайта. Пусто в обоих — автора никто не
// знает, и выдумывать его нельзя.
export function mergeAuthors(board, fromCredits = {}) {
    const out = { ...fromCredits };
    for (const byTime of Object.values(board.cells || {})) {
        for (const cell of Object.values(byTime)) {
            for (const r of cell.records) {
                if (out[r.id] || !r.creator) continue;
                out[r.id] = { id: null, display_name: r.creator, avatar: null, counted: true, skipLabel: '', crm: true };
            }
        }
    }
    return out;
}

// Доска в той же форме, что отдавал /api/records/board: раздел рисует её
// годами, и переезд на CRM не повод переписывать рисование. Дата — как её
// шлёт раздел (ДД.ММ.ГГГГ); ISO тоже принимаем.
router.get('/board', async (req, res) => {
    const raw = String(req.query.date || '');
    const iso = raw ? (ddmmToIso(raw) || (ISO_DATE_RE.test(raw) ? raw : null)) : mskDate();
    if (!iso) return bad(res, 'дата должна быть ДД.ММ.ГГГГ');
    const date = isoToDdmm(iso);
    try {
        // `now` закрывает слоты ближе часа — так же, как их закрывала старая
        // админка (см. BOOKING_LEAD_MIN). Сама операция проверяет то же
        // правило ещё раз, на случай запроса мимо кнопки.
        const board = journalToBoard(await fetchJournal(req.user.id, iso), { now: Date.now() });
        board.date = date;
        let credits = {};
        try { credits = await loadBoardAuthors(date, board); } catch { /* топ не повод прятать доску */ }
        res.json({
            date,
            source: 'live',
            board,
            fetchedAt: new Date().toISOString(),
            ok: true,
            error: '',
            // Свои операции едут вместе с доской: призраки «записываю…»
            // рисуются по ним, и доска без них мигнула бы пустой ячейкой.
            ops: journalQueue.list(req.user.id),
            authors: mergeAuthors(board, credits),
        });
    } catch (err) {
        sendCrmError(res, err);
    }
});

// ── Операции ─────────────────────────────────────────────────────────────────

// Подпись операции для списка «Очередь»: кто клиент, какой телефон, какая
// станция и на какое время. Раздел знает это в момент нажатия, а после того
// как запись встала (или не встала) — уже нет: окно закрыто, доска могла уехать
// на другой день. Поэтому подпись едет вместе с операцией и возвращается в
// списке как есть. Только короткие строки — это текст на экран, не данные.
export function cleanNote(note) {
    if (!note || typeof note !== 'object') return null;
    const out = {};
    for (const k of ['kind', 'name', 'phone', 'station', 'date', 'time', 'duration']) {
        if (note[k] == null) continue;
        const v = String(note[k]).trim().slice(0, 160);
        if (v) out[k] = v;
    }
    return Object.keys(out).length ? out : null;
}

// Те же create / update / delete, что шлёт раздел, но POST их только СТАВИТ и
// отвечает сразу: исполняет очередь (records/journalQueue.js) фоном и под
// учёткой того, кто нажал, — CRM ставит записи `creator` сама. Ждать CRM,
// держа окно открытым, оператору незачем.
//
// Что решается без CRM (формат даты, запас в час), отказывается тут же, 409 с
// текстом, — в том же окне, пока человек его не закрыл.
//
// Правка записи — это до трёх операций (снять хвост, перенести, дописать), и
// приезжают они ОДНОЙ пачкой `{ ops: [...] }`: проверяются все до одной, а
// ставятся только если прошли все. Иначе хвост уже снимался бы, а перенос
// получил бы отказ — и запись осталась бы обрезанной. В очереди у пачки общая
// метка: не прошёл шаг — следующие не исполняются.
router.post('/ops', (req, res) => {
    const body = req.body || {};
    const list = Array.isArray(body.ops) ? body.ops : [{ type: body.type, payload: body.payload }];
    if (!list.length || list.length > 5) return bad(res, 'пустая или слишком длинная пачка операций');
    const steps = list.map(o => ({ type: String(o?.type || ''), payload: o?.payload || {} }));
    if (steps.some(o => !OP_TYPES.has(o.type))) return bad(res, 'операция бывает create | update | delete');
    try {
        for (const o of steps) precheckJournalOp(o.type, o.payload);
    } catch (err) {
        if (err instanceof OpRefused) {
            return res.status(409).json({ error: { code: 'refused', message: err.message } });
        }
        return sendCrmError(res, err);
    }
    const author = req.user.display_name || req.user.login || '';
    const note = cleanNote(body.note);
    const group = steps.length > 1 ? `g${Date.now()}${Math.random().toString(36).slice(2, 6)}` : null;
    const ops = steps.map(o => journalQueue.enqueue(req.user.id, { ...o, author, group, note }));
    res.status(202).json({ ok: true, op: ops[ops.length - 1], ops });
});

export default router;
