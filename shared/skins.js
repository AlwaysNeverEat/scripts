// ─────────────────────────────────────────────────────────────────────────────
// Скины — оформление, которое человек носит на себе и которое видят ВСЕ:
// рамка аватара в профиле, баннер карточки лида и картинка на капсулах его
// записей. Задумано как благодарность поддержавшим проект; пока выдаётся
// списком логинов (SKIN_EDITOR_LOGINS) — смотреть, как оно выглядит, а не
// раздавать.
//
// Скин СОБИРАЕТСЯ ПО ЧАСТЯМ: у каждой части (рамка, баннер, записи) свой
// пак или стандартный вид. Рамка от котика при обычном баннере — нормальный
// выбор, а не недоделка, поэтому в базе не «пак + выключатели», а словарь
// «часть → пак». Хранится одна строка на человека (backend/src/skins/store.js),
// список приезжает всем одним запросом (`GET /api/skins`), рисует его
// frontend/src/skins.js.
//
// Где скин виден и по чему узнаётся:
//   • рамка — в профиле, по id человека;
//   • запись — на доске, по автору записи (тот же, что кружок на капсуле);
//   • лид — по КОДУ ОПЕРАТОРА звонка. Код вводят во вкладке «Лиды», и пока его
//     там нет, у лидов скина нет: иначе звонки ни с кем не связать. Сервер
//     хранит код рядом со скином — карточку чужого звонка открывает другой
//     человек, и узнать хозяина звонка ему больше неоткуда.
// ─────────────────────────────────────────────────────────────────────────────

export const SKIN_EDITOR_LOGINS = ['gtrixoff'];

export const SKIN_PACKS = {
    cat: { label: 'Котик' },
};

export const SKIN_PARTS = [
    { id: 'frame', label: 'Рамка аватара' },
    { id: 'leads', label: 'Баннер лидов' },
    { id: 'records', label: 'Записи' },
];

export function canEditSkin(user) {
    const login = String(user?.login || '').trim().toLowerCase();
    return Boolean(login) && SKIN_EDITOR_LOGINS.includes(login);
}

// Тот же ключ, что `operatorKey` в shared/crmLeads.js: «03» и «3» — один код.
export const skinOperatorKey = (v) => String(v ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 8);

// { frame: 'cat', leads: null, … } — пак по части; null — стандартный вид.
// Незнакомые части отбрасываются, пак проверяется по списку.
function cleanParts(src, strict) {
    const parts = {};
    for (const { id } of SKIN_PARTS) {
        const v = src && typeof src === 'object' ? src[id] : null;
        if (v == null || v === '') { parts[id] = null; continue; }
        if (Object.hasOwn(SKIN_PACKS, String(v))) { parts[id] = String(v); continue; }
        if (strict) return null;
        parts[id] = null;
    }
    return parts;
}

/**
 * Тело `PUT /api/skins/me` → то, что пишется в базу. Пак не из списка —
 * ошибка, а не «стандартный вид»: молча снять часть из-за опечатки хуже отказа.
 * @returns {{ skin?: { parts: object, operator: string }, error?: string }}
 */
export function cleanSkin(body) {
    const b = body && typeof body === 'object' ? body : {};
    const parts = cleanParts(b.parts, true);
    if (!parts) return { error: 'такого скина нет' };
    return { skin: { parts, operator: skinOperatorKey(b.operator) } };
}

// Строка из базы → то, что уезжает в список. Ничего не надето — в список не
// попадает вовсе. Пак, которого больше нет, считается стандартным видом.
export function publicSkin(row) {
    const parts = cleanParts(row?.parts, false);
    if (!row?.user_id || !Object.values(parts).some(Boolean)) return null;
    return { userId: row.user_id, parts, operator: skinOperatorKey(row.operator) };
}

/**
 * Кто «хозяин» звонка по коду оператора. Один код у двоих — не угадываем
 * (лучше без скина, чем чужой), а без кода скина у лидов нет.
 */
export function skinForOperator(skins, code) {
    const k = skinOperatorKey(code);
    if (!k) return null;
    const hits = (skins || []).filter(s => s.parts?.leads && s.operator === k);
    return hits.length === 1 ? hits[0] : null;
}
