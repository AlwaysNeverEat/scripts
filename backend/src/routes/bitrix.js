import { Router } from 'express';
import {
    bitrixLogin, bitrixLogout, bitrixEnsureSession, bitrixLinkedLogin,
    bitrixGetHtml, bitrixAjax, linkSecretConfigured, BitrixError,
} from '../bitrix/client.js';
import {
    parseLeadModel, normalizeLead, parseSourceOptions, parseStageOptions,
    leadPagePath, BitrixReadError,
} from '../bitrix/leadModel.js';
import { buildLeadSaveForm, BitrixLeadError } from '../bitrix/leads.js';
import { normalizeSelectorUsers } from '../bitrix/dicts.js';
import {
    openCall, closeCall, rememberLead, leadFeed,
} from '../bitrix/calls.js';
import { watchCalls, lastWatch, watchEveryMs } from '../bitrix/watch.js';

// Панель Битрикса: во время звонка сайт показывает лид и даёт править ровно те
// поля, которыми оператор пользуется, — имя, стадию, источник, ответственного и
// комментарий. Разбор протокола и причины, почему всё устроено именно так, —
// docs/BITRIX.md.
//
// Ошибки авторизации Битрикса отдаём как 403, НЕ 401: 401 фронт понимает как
// «истекла сессия САЙТА» и выкидывает на гейт (apiFetch в main.js). Тот же
// уговор, что и со старой CRM.

const router = Router();

function sendError(res, err) {
    if (err instanceof BitrixError) {
        const status = err.code === 'bitrix_auth_required' ? 403
            : err.code === 'bitrix_auth_failed' ? 403
            : err.code === 'bitrix_captcha' ? 403
            : err.code === 'bitrix_2fa_required' ? 403
            : 502;
        return res.status(status).json({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof BitrixLeadError || err instanceof BitrixReadError) {
        // Это не поломка, а отказ по правилу («источник всё ещё Звонок») —
        // оператор должен увидеть текст и поправить, а не «сервер упал».
        return res.status(422).json({ error: { code: err.code, message: err.message } });
    }
    console.error('Битрикс', err);
    return res.status(502).json({ error: { code: 'bitrix_failed', message: 'Битрикс ответил непонятно' } });
}

// ── Учётка ───────────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
    const login = String(req.body?.login || '').trim();
    const password = String(req.body?.password || '');
    if (!login || !password) {
        return res.status(400).json({ error: { code: 'bad_request', message: 'нужны login и password' } });
    }
    try {
        const { linked } = await bitrixLogin(req.user.id, login, password, {
            remember: req.body?.remember !== false,
        });
        res.json({ ok: true, linked });
    } catch (err) {
        sendError(res, err);
    }
});

router.post('/logout', async (req, res) => {
    try {
        res.json({ ok: true, ...await bitrixLogout(req.user.id, { unlink: req.body?.unlink === true }) });
    } catch (err) {
        sendError(res, err);
    }
});

router.get('/status', async (req, res) => {
    try {
        await bitrixEnsureSession(req.user.id);
        res.json({ loggedIn: true, login: await bitrixLinkedLogin(req.user.id), canLink: linkSecretConfigured() });
    } catch (err) {
        if (err instanceof BitrixError && err.code !== 'bitrix_unavailable') {
            return res.json({
                loggedIn: false,
                login: await bitrixLinkedLogin(req.user.id),
                canLink: linkSecretConfigured(),
                reason: err.code,
                message: err.message,
            });
        }
        sendError(res, err);
    }
});

// ── Звонки ───────────────────────────────────────────────────────────────────

// Состояние для панели: есть ли сейчас звонок.
//
// Здесь же сайт и СМОТРИТ в Битрикс — раз панель спрашивает, значит вкладка
// открыта и оператор на месте (bitrix/watch.js объясняет, почему опрос
// портала это нормально). Частоту держит наблюдатель, а не панель: лишние
// вопросы он гасит сам, так что три открытых вкладки сайта не превращаются в
// тройной опрос портала.
//
// Ошибка наблюдателя ответ НЕ роняет: даже когда Битрикс недоступен, панель
// обязана показать звонок, который уже лежит в своей базе.
router.get('/call', async (req, res) => {
    try {
        const watch = await watchCalls(req.user.id).catch(err => {
            console.warn('наблюдатель Битрикса', err);
            return null;
        });
        const call = await openCall(req.user.id);
        res.json({
            watch: watch && { at: watch.at, ids: watch.ids, newest: watch.newest, error: watch.error },
            call: call && {
                callId: call.call_id,
                leadId: call.lead_id ? String(call.lead_id) : null,
                phone: call.phone,
                line: call.line,
                direction: call.direction,
                startedAt: call.started_at,
            },
        });
    } catch (err) {
        sendError(res, err);
    }
});

// Что наблюдатель видит в Битриксе. Ручка диагностическая: по ней видно,
// доходит ли опрос до портала, сколько лидов он разбирает и почему не считает
// звонком то, что нашёл. Без неё «не всплывает уведомление» не отличить от
// «портал сменил разметку».
router.get('/watch', async (req, res) => {
    try {
        const seen = lastWatch(req.user.id);
        res.json({
            everyMs: watchEveryMs(),
            watch: seen && !req.query.force ? seen : await watchCalls(req.user.id, { force: true }),
        });
    } catch (err) {
        sendError(res, err);
    }
});

// Оператор закрыл карточку — звонок больше не актуален.
router.post('/call/close', async (req, res) => {
    try {
        await closeCall(req.user.id, req.body?.callId ? String(req.body.callId) : null);
        res.json({ ok: true });
    } catch (err) {
        sendError(res, err);
    }
});

// ── Лид ──────────────────────────────────────────────────────────────────────

router.get('/lead/:id', async (req, res) => {
    const id = String(req.params.id || '');
    if (!/^\d+$/.test(id)) {
        return res.status(400).json({ error: { code: 'bad_request', message: 'нужен числовой id лида' } });
    }
    try {
        const html = await bitrixGetHtml(req.user.id, leadPagePath(id));
        const lead = normalizeLead(parseLeadModel(html));
        await rememberLead(lead, { userId: req.user.id });
        res.json({
            lead: lead.view,
            // Справочники едут вместе с лидом: стадии и источники лежат в той
            // же странице, и отдельный запрос за ними был бы вторым походом за
            // тем же самым.
            stages: parseStageOptions(html),
            sources: parseSourceOptions(html),
        });
    } catch (err) {
        sendError(res, err);
    }
});

router.post('/lead/:id', async (req, res) => {
    const id = String(req.params.id || '');
    if (!/^\d+$/.test(id)) {
        return res.status(400).json({ error: { code: 'bad_request', message: 'нужен числовой id лида' } });
    }
    try {
        // Читаем ПЕРЕД записью, а не пользуемся тем, что показали оператору:
        // редактор Битрикса отправляет форму целиком, и всё, чего в ней не
        // окажется, будет стёрто. Между показом и сохранением лид мог править
        // кто-то ещё — их правки сохранятся, наши лягут поверх.
        const html = await bitrixGetHtml(req.user.id, leadPagePath(id));
        const lead = normalizeLead(parseLeadModel(html));

        const form = buildLeadSaveForm(lead, {
            name: req.body?.name,
            statusId: req.body?.statusId,
            sourceId: req.body?.sourceId,
            assignedById: req.body?.assignedById,
            comments: req.body?.comments,
        });

        const answer = await bitrixAjax(
            req.user.id, '/bitrix/components/bitrix/crm.lead.details/ajax.php', form,
        );
        if (answer?.ERROR || answer?.error) {
            return res.status(502).json({
                error: { code: 'bitrix_save_failed', message: String(answer.ERROR || answer.error) },
            });
        }

        // Перечитываем: что именно записалось, знает только Битрикс.
        const saved = normalizeLead(parseLeadModel(await bitrixGetHtml(req.user.id, leadPagePath(id))));
        await rememberLead(saved, { userId: req.user.id, saved: true });
        await closeCall(req.user.id);
        res.json({ ok: true, lead: saved.view });
    } catch (err) {
        sendError(res, err);
    }
});

// ── Лента обращений ──────────────────────────────────────────────────────────

router.get('/feed', async (req, res) => {
    try {
        res.json({ leads: await leadFeed({ limit: req.query.limit }) });
    } catch (err) {
        sendError(res, err);
    }
});

// ── Сотрудники ───────────────────────────────────────────────────────────────

// Список ответственных — единственный справочник, которого нет в карточке:
// интерфейс берёт его отдельной ручкой подбора. Меняется он раз в полгода,
// поэтому держим в памяти процесса: панель открывается на каждый звонок, и
// лишний запрос в Битрикс в этот момент заметнее всего.
const USERS_TTL_MS = 6 * 60 * 60 * 1000;
let usersCache = null;

const SELECTOR_BODY = {
    dialog: {
        id: 'crm-entity-editor-user-selector-dialog-ASSIGNED_BY_ID',
        context: 'CRM_ENTITY_EDITOR_USER',
        entities: [{
            id: 'user',
            options: { inviteEmployeeLink: false, emailUsers: false, inviteGuestLink: false, intranetUsersOnly: true },
            searchable: true,
            dynamicLoad: true,
            dynamicSearch: true,
            filters: [],
        }],
        preselectedItems: [],
        clearUnavailableItems: false,
    },
};

router.get('/users', async (req, res) => {
    try {
        if (usersCache && Date.now() - usersCache.at < USERS_TTL_MS) {
            return res.json({ users: usersCache.users });
        }
        const answer = await bitrixAjax(
            req.user.id,
            '/bitrix/services/main/ajax.php?context=CRM_ENTITY_EDITOR_USER&action=ui.entityselector.load',
            SELECTOR_BODY,
            { json: true },
        );
        const users = normalizeSelectorUsers(answer);
        // Пустой список не кэшируем: это почти наверняка сменившийся формат
        // ответа, и запирать его на шесть часов — значит чинить вслепую.
        if (users.length) usersCache = { at: Date.now(), users };
        res.json({ users });
    } catch (err) {
        sendError(res, err);
    }
});

export default router;
