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
import {
    mskDate, crmActor, fetchJournal, createBooking, updateRecord, deleteRecord,
} from '../crm/journal.js';
import { isBookableTime, isJunkPhone, SLOT_MINUTES } from '../../../shared/crmRecords.js';
import { DURATIONS } from '../../../shared/crmJournal.js';

const router = Router();

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

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

// ── Доска ────────────────────────────────────────────────────────────────────

// Весь день целиком: станции с числом постов и записи всех станций одним
// запросом. Дата — ISO, как её понимает CRM; «сегодня» считается по Москве.
router.get('/board', async (req, res) => {
    const date = String(req.query.date || '') || mskDate();
    if (!ISO_DATE_RE.test(date)) return bad(res, 'дата должна быть YYYY-MM-DD');
    try {
        res.json(await fetchJournal(req.user.id, date));
    } catch (err) {
        sendCrmError(res, err);
    }
});

// ── Запись ───────────────────────────────────────────────────────────────────

export function readBooking(body) {
    const addressId = parseInt(String(body?.addressId ?? ''), 10);
    const date = String(body?.date || '');
    const time = String(body?.time || '');
    const durationMinutes = parseInt(String(body?.durationMinutes ?? SLOT_MINUTES), 10);

    if (!Number.isFinite(addressId)) return { error: 'не указана станция' };
    if (!ISO_DATE_RE.test(date)) return { error: 'дата должна быть YYYY-MM-DD' };
    if (!TIME_RE.test(time)) return { error: 'время должно быть ЧЧ:ММ' };
    if (!isBookableTime(time)) return { error: `на ${time} записать нельзя — станция уже закрыта` };
    if (!DURATIONS.includes(durationMinutes)) {
        return { error: `длительность бывает ${DURATIONS.join(', ')} минут` };
    }
    const phone = String(body?.phone || '');
    const name = String(body?.name || '').trim();
    // Телефон из одной и той же цифры — это «бронь» и прочие служебные
    // записи. Мусором он считается по общему правилу сайта (isJunkPhone), и
    // запрещать его тут нельзя: такие записи законны, просто не зачитываются.
    if (!phone && !name) return { error: 'нужен телефон или имя' };

    return {
        fields: {
            addressId, date, time, durationMinutes,
            name,
            phone,
            carNumber: String(body?.carNumber || ''),
            comment: String(body?.comment || ''),
            // СМС — только если попросили ЯВНО. В самой CRM галка стоит по
            // умолчанию и сама включается обратно при смене времени, отчего
            // сообщение уезжает «потому что забыл снять».
            sms: body?.sms === true,
        },
        junkPhone: isJunkPhone(phone),
    };
}

// Создание. Длинная запись собирается НАШЕЙ цепочкой получасовых слотов
// (createBooking), а не полем `duration` самой CRM, и продлевающие слоты
// уходят без СМС.
router.post('/book', async (req, res) => {
    const parsed = readBooking(req.body);
    if (parsed.error) return bad(res, parsed.error);
    try {
        const result = await createBooking(req.user.id, parsed.fields);
        if (!result.ok) {
            return res.status(409).json({
                error: { code: 'slot_conflict', message: result.message },
                // Если откатить созданное не вышло, фронт обязан это показать:
                // на доске остались слоты, которых никто не заказывал.
                orphans: result.orphans || [],
            });
        }
        res.json(result);
    } catch (err) {
        sendCrmError(res, err);
    }
});

// Правка и перенос. Длительность тут не меняется вовсе: у существующей
// записи её менять нечем — двигают цепочку слот за слотом.
router.post('/move', async (req, res) => {
    const id = parseInt(String(req.body?.id ?? ''), 10);
    if (!Number.isFinite(id)) return bad(res, 'не указана запись');
    const parsed = readBooking({ ...req.body, durationMinutes: SLOT_MINUTES });
    if (parsed.error) return bad(res, parsed.error);
    try {
        const result = await updateRecord(req.user.id, { ...parsed.fields, id });
        if (!result.ok) {
            return res.status(409).json({ error: { code: 'slot_conflict', message: result.message } });
        }
        res.json(result);
    } catch (err) {
        sendCrmError(res, err);
    }
});

// Удаление. CRM сносит ВСЮ цепочку связанных слотов и говорит, сколько их
// было — фронт обязан это показать: «удалил слот» и «удалил полтора часа»
// для оператора разные вещи.
router.delete('/record/:id', async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    const addressId = parseInt(String(req.query.addressId ?? ''), 10);
    if (!Number.isFinite(id)) return bad(res, 'не указана запись');
    if (!Number.isFinite(addressId)) return bad(res, 'не указана станция');
    try {
        const result = await deleteRecord(req.user.id, { id, addressId });
        if (!result.ok) {
            return res.status(409).json({ error: { code: 'delete_failed', message: result.message } });
        }
        res.json(result);
    } catch (err) {
        sendCrmError(res, err);
    }
});

export default router;
