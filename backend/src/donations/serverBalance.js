// ─────────────────────────────────────────────────────────────────────────────
// Счёт сервера из API Рег.облака — для панели «Поддержали проект».
//
// Токен (REG_CLOUD_TOKEN в deploy/.env) даёт управлять облаком целиком, вплоть
// до удаления серверов, поэтому он живёт ТОЛЬКО здесь: наружу уходят готовые
// цифры, в журнал — только код ответа. Без токена счёт просто не показывается.
//
// В Рег.облако ходим не на каждый заход на страницу, а раз в REFRESH_MS: цифры
// меняются копейками в час, а панель открыта у всех сразу. Устаревший снимок
// отдаётся немедленно, а свежий догружается фоном; упало обновление — отдаём
// последний удачный с пометкой `stale`, а не ошибку: «23 д 14 ч» получасовой
// давности полезнее пустого места. Ждать Рег.облако приходится только на
// самом первом запросе после старта, и то не дольше FIRST_WAIT_MS.
// ─────────────────────────────────────────────────────────────────────────────

import { parseJsonLoose, parseBalanceData, hoursLeftAfter } from '../../../shared/serverBalance.js';

const URL = 'https://api.cloudvps.reg.ru/v1/balance_data';
export const REFRESH_MS = 15 * 60 * 1000;
const FIRST_WAIT_MS = 5000;
const TIMEOUT_MS = 15000;

export function createServerBalance({
    token = process.env.REG_CLOUD_TOKEN,
    fetchImpl = (...a) => fetch(...a),
    now = () => Date.now(),
    log = console,
} = {}) {
    let snap = null;      // { data, at } — последний удачный ответ
    let pending = null;   // идущий запрос: одновременные заходы его делят
    let lastTry = 0;

    async function refresh() {
        lastTry = now();
        try {
            const r = await fetchImpl(URL, {
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            const text = await r.text();
            if (!r.ok) throw new Error(`Рег.облако ответило ${r.status}`);
            const data = parseBalanceData(parseJsonLoose(text));
            if (!data) throw new Error('Рег.облако ответило без balance_data');
            snap = { data, at: now() };
        } catch (err) {
            log.warn?.('[server-balance]', err?.message || err);
        }
    }

    function kick() {
        if (!pending) pending = refresh().finally(() => { pending = null; });
        return pending;
    }

    function view() {
        if (!snap) return { available: false };
        const age = now() - snap.at;
        const { balance, bonus, monthlyCost, hoursLeft } = snap.data;
        return {
            available: true,
            balance,
            bonus,
            monthlyCost,
            // Пересчитано на «сейчас»: снимок может быть пятнадцатиминутной
            // давности, а деньги списываются каждый час.
            hoursLeft: hoursLeftAfter(hoursLeft, age),
            updatedAt: new Date(snap.at).toISOString(),
            stale: age > REFRESH_MS * 2,
        };
    }

    return {
        enabled: !!token,
        async get() {
            if (!token) return null;
            if (!snap) {
                // Первый раз ждём, но недолго: панель не должна висеть на
                // Рег.облаке. Не успело — покажем на следующем заходе.
                if (now() - lastTry >= 60_000 || pending) {
                    await Promise.race([kick(), new Promise(r => { setTimeout(r, FIRST_WAIT_MS).unref?.(); })]);
                }
            } else if (now() - snap.at >= REFRESH_MS && now() - lastTry >= 60_000) {
                kick();
            }
            return view();
        },
    };
}
