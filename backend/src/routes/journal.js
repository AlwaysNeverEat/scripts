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
import { applyJournalOp, OpRefused, ddmmToIso, isoToDdmm } from '../records/journalOps.js';
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
        const board = journalToBoard(await fetchJournal(req.user.id, iso));
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
            // Очереди больше нет: CRM отвечает сразу, и операция либо
            // применилась, либо вернула отказ тут же, в том же запросе.
            ops: [],
            authors: mergeAuthors(board, credits),
        });
    } catch (err) {
        sendCrmError(res, err);
    }
});

// ── Операции ─────────────────────────────────────────────────────────────────

// Те же create / update / delete, что шлёт раздел, но исполняются СРАЗУ и под
// учёткой того, кто нажал: CRM ставит записи `creator` сама. Отказ по делу
// («занято», «записи больше нет») приезжает 409 со своим текстом — его
// показывают в окне как есть.
router.post('/ops', async (req, res) => {
    const type = String(req.body?.type || '');
    const payload = req.body?.payload || {};
    try {
        const result = await applyJournalOp(req.user.id, type, payload);
        res.json({ ok: true, ...result });
    } catch (err) {
        if (err instanceof OpRefused) {
            return res.status(409).json({ error: { code: 'refused', message: err.message } });
        }
        sendCrmError(res, err);
    }
});

// Очереди нет — список пуст всегда. Ручка оставлена, чтобы раздел не
// спотыкался о 404 там, где раньше показывал «в очереди».
router.get('/ops', (_req, res) => res.json({ ops: [] }));

export default router;
