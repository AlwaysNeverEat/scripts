// ─────────────────────────────────────────────────────────────────────────────
// Разбор карточек звонка Битрикса.
//
// Живёт в shared/, потому что этим пользуется датчик-юзерскрипт (он же
// собирается сборщиком отсюда), а проверяется тестами здесь — на вкладке
// Битрикса отладчика нет, и ошибку там ловить нечем.
//
// Главное, что надо знать про эти карточки: их НЕ УБИРАЮТ и НЕ ОБНОВЛЯЮТ.
// Каждый звонок добавляет на страницу свою форму, и к концу смены их там
// десяток. Хуже того, CALL_STATE у всех остаётся "connected" — даже у звонков
// двухчасовой давности. То есть «идёт ли разговор» по карточке не понять.
//
// Понять можно по времени: оно зашито в сам CALL_ID —
// externalCall.<хэш>.<время в секундах>. По нему и отбираем.
// ─────────────────────────────────────────────────────────────────────────────

// Сколько звонок считается свежим. Полторы минуты: разговор начинается сразу,
// а если оператор открыл вкладку через час, старую карточку показывать уже
// незачем — она только собьёт с толку.
export const CALL_FRESH_MS = 90 * 1000;

/** Разбор одной карточки. null — не карточка звонка. */
export function parseCallOption(raw) {
    let data;
    try {
        data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
        return null;
    }
    if (!data || !data.CALL_ID) return null;

    const callId = String(data.CALL_ID);
    return {
        callId,
        startedAt: callStartedAt(callId),
        phone: data.PHONE_NUMBER ? String(data.PHONE_NUMBER) : null,
        line: data.LINE_NUMBER ? String(data.LINE_NUMBER) : null,
        direction: data.CALL_DIRECTION ? String(data.CALL_DIRECTION) : 'incoming',
        // Лида может не быть: звонок с неизвестного номера в первую секунду.
        // Тогда покажем хотя бы номер — это лучше, чем промолчать.
        leadId: data.CRM_ENTITY_TYPE === 'LEAD' && data.CRM_ENTITY_ID
            ? String(data.CRM_ENTITY_ID)
            : null,
    };
}

// Время начала из хвоста идентификатора. Формат не документирован, поэтому
// не доверяем ему вслепую: непохожее на время число (или его отсутствие)
// означает «не знаю», а не «звонок из 1970 года».
export function callStartedAt(callId) {
    const m = String(callId || '').match(/(\d{10})(?:\D|$)/);
    if (!m) return null;
    const at = Number(m[1]) * 1000;
    return Number.isFinite(at) ? at : null;
}

/**
 * Какой звонок показывать сейчас.
 *
 * @param values    содержимое всех карточек на странице
 * @param known     идентификаторы, о которых уже сообщали
 * @param now       текущее время
 * @param maxAgeMs  сколько звонок считается свежим
 *
 * Отдаём САМЫЙ СВЕЖИЙ и только если он и правда свежий. Иначе при каждой
 * перезагрузке страницы на сайт вываливалась бы вся смена разом.
 *
 * Звонок без разбираемого времени считается свежим только если карточка
 * появилась при нас (его нет в known): открыв страницу, мы не знаем, когда он
 * был, а угадывать в пользу «показать» — значит показывать чужое прошлое.
 */
export function pickCurrentCall(values, { known = new Set(), now = Date.now(), maxAgeMs = CALL_FRESH_MS, firstScan = false } = {}) {
    const calls = (Array.isArray(values) ? values : [])
        .map(parseCallOption)
        .filter(Boolean)
        .filter(call => !known.has(call.callId));

    const fresh = calls.filter(call => {
        if (call.startedAt == null) return !firstScan;
        return now - call.startedAt <= maxAgeMs && now - call.startedAt >= -maxAgeMs;
    });
    if (!fresh.length) return null;

    // Самый поздний: у карточек без времени приоритет ниже — про них мы знаем
    // только то, что они появились сейчас.
    fresh.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    return fresh[0];
}
