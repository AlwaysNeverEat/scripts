import { Router } from 'express';
import { userByBitrixLogin } from '../bitrix/client.js';
import { noteCall, sweepLeads } from '../bitrix/calls.js';
import { watchCalls, lastWatch, watchEveryMs } from '../bitrix/watch.js';

// ─────────────────────────────────────────────────────────────────────────────
// Приёмник датчика звонков.
//
// Датчик живёт на вкладке Битрикса и сообщает сайту одно: «идёт входящий, лид
// такой-то». Сессии САЙТА у него нет и быть не может — она в заголовке
// Authorization, а не в куках, и со стороннего домена её не достать. Зато на
// вкладке Битрикса точно известно, под кем там работают.
//
// Поэтому оператор опознаётся ПРИВЯЗКОЙ УЧЁТКИ: тот же логин, которым человек
// входил в Битрикс через сайт (bitrix_links). Нет привязки — нет и звонка, и
// это правильно: показывать карточку тому, кто в Битрикс через сайт не входил,
// всё равно нечем — читать лид будет нечем.
//
// Из этого следует и граница доверия: единственное, что может чужой с нашим
// ключом API, — показать оператору лишнее уведомление о звонке. Ничего
// прочитать или записать в Битрикс он этим не может: и то, и другое идёт
// сессией самого оператора.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

router.post('/', async (req, res) => {
    const login = String(req.body?.bitrixLogin || '').trim();
    const callId = String(req.body?.callId || '').trim();
    if (!login || !callId) {
        return res.status(400).json({ error: { code: 'bad_request', message: 'нужны bitrixLogin и callId' } });
    }

    try {
        const userId = await userByBitrixLogin(login);
        if (!userId) {
            // Не ошибка: человек просто не привязывал учётку. Датчик по этому
            // ответу замолкает до следующей перезагрузки страницы, чтобы не
            // долбиться каждым звонком.
            return res.json({ ok: false, reason: 'not_linked' });
        }

        const call = await noteCall(userId, {
            callId,
            leadId: req.body?.leadId,
            phone: req.body?.phone,
            line: req.body?.line,
            direction: req.body?.direction,
        });

        // Чистим ленту здесь же: планировщика в проекте нет, а звонки идут
        // весь день (см. sweepLeads в bitrix/calls.js).
        sweepLeads().catch(err => console.warn('чистка ленты Битрикса', err));

        res.json({ ok: true, callId: call?.call_id || callId, leadId: call?.lead_id || null });
    } catch (err) {
        console.error('датчик звонков', err);
        res.status(502).json({ error: { code: 'sensor_failed', message: 'не удалось записать звонок' } });
    }
});

// Диагностика наблюдателя (bitrix/watch.js) — что он видит в портале.
//
// Живёт она ЗДЕСЬ, рядом с датчиком, а не в панели, по одной причине: панель
// требует сессию сайта, и с сервера её не позвать — а разбираться с «почему не
// всплывает уведомление» приходится именно на сервере, в ssh:
//
//     curl -s -H "x-api-key: $API_KEY" \
//       'http://127.0.0.1:3001/api/bitrix/sensor/watch?login=operator3@9816644.ru&force=1'
//
// Оператор опознаётся так же, как у датчика, — привязанной учёткой Битрикса.
router.get('/watch', async (req, res) => {
    const login = String(req.query?.login || '').trim();
    try {
        const userId = await userByBitrixLogin(login);
        if (!userId) return res.json({ ok: false, reason: 'not_linked' });
        const seen = lastWatch(userId);
        res.json({
            ok: true,
            everyMs: watchEveryMs(),
            watch: seen && !req.query.force ? seen : await watchCalls(userId, { force: true }),
        });
    } catch (err) {
        res.status(502).json({ error: { code: 'watch_failed', message: String(err?.message || err) } });
    }
});

export default router;
