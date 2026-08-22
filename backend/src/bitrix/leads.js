// ─────────────────────────────────────────────────────────────────────────────
// Сборка формы сохранения лида для интерфейса Битрикса.
//
// Отдельно от client.js, потому что тут нет ни сети, ни сессий — чистое
// превращение «текущий лид + что поменяли» в тело запроса. Такое проверяется
// тестами целиком, а именно тут и живут все три ловушки протокола
// (docs/BITRIX.md), каждая из которых означает потерю чужих данных:
//
// 1. Редактор шлёт форму ЦЕЛИКОМ. Отправив только изменённые поля, мы сотрём
//    заголовок, телефон и источник. Поэтому на вход обязателен ПОЛНЫЙ текущий
//    лид, а патч — только поверх него.
// 2. У телефона в имени поля стоит id существующего значения (PHONE[698360]).
//    Имя PHONE[n0] означает «добавить новый», и клиенту прилетел бы ВТОРОЙ
//    номер вместо исправленного первого.
// 3. Описание лида — BB-код, а не HTML и не голый текст.
// ─────────────────────────────────────────────────────────────────────────────

// Пустое значение Битрикс отдаёт то null'ом, то пустой строкой, то ЛОЖЬЮ
// (пустые пользовательские поля приезжают как false). Через String() последнее
// превратилось бы в текст 'false' и уехало бы в лид настоящей строкой.
function asText(value) {
    if (value == null || value === false) return '';
    return String(value);
}

// Источник «Звонок» ставит сама телефония, и оставлять его нельзя: правило
// компании — у обработанного лида источник обязан быть любым другим.
export const CALL_SOURCE = 'CALL';

export function isCallSource(id) {
    return String(id ?? '').toUpperCase() === CALL_SOURCE;
}

export class BitrixLeadError extends Error {
    constructor(message) {
        super(message);
        this.code = 'bitrix_bad_lead';
    }
}

// Простые поля, которые редактор отправляет как есть. Порядок повторяет живой
// запрос: Битриксу он безразличен, а вот сверять снятое с отправляемым —
// занятие частое, и глазами это делать проще.
const PLAIN_FIELDS = [
    'TITLE', 'STATUS_ID', 'OPPORTUNITY', 'CURRENCY_ID', 'IS_MANUAL_OPPORTUNITY',
    'HONORIFIC', 'LAST_NAME', 'NAME', 'SECOND_NAME', 'BIRTHDATE', 'POST',
    'COMPANY_TITLE', 'SOURCE_ID', 'SOURCE_DESCRIPTION', 'OPENED',
    'ASSIGNED_BY_ID', 'OBSERVER_IDS', 'COMMENTS', 'ADDRESS',
];

// Множественные поля: у каждого значения свой id.
const MULTI_FIELDS = ['PHONE', 'EMAIL', 'WEB', 'IM'];

const DEFAULT_MULTI_TYPE = { PHONE: 'WORK', EMAIL: 'WORK', WEB: 'WORK', IM: 'FACEBOOK' };

// ── Описание лида: текст ↔ BB-код ────────────────────────────────────────────

// Битрикс хранит описание абзацами в [p]. Пустые строки разделяют абзацы —
// так текст, набранный оператором в обычном поле, доезжает похожим на себя.
export function textToBB(text) {
    const value = String(text ?? '').replace(/\r\n?/g, '\n').trim();
    if (!value) return '';
    return value
        .split(/\n{2,}/)
        .map(part => `[p]\n${part.trim()}\n[/p]`)
        .join('\n');
}

export function bbToText(bb) {
    return String(bb ?? '')
        .replace(/\[br\s*\/?\]/gi, '\n')
        .replace(/\[\/p\]\s*\[p\]/gi, '\n\n')
        .replace(/\[\/?p\]/gi, '\n')
        .replace(/\[\/?[a-z][^\]]*\]/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// ── Сборка формы ─────────────────────────────────────────────────────────────

function putMulti(form, field, values) {
    const list = Array.isArray(values) ? values : [];
    if (!list.length) {
        // Пустая строка с именем n0 — так редактор отправляет «значения нет».
        // Совсем не отправлять поле нельзя: для Битрикса это «не трогали», и
        // удалить номер стало бы невозможно.
        form.set(`${field}[n0][VALUE]`, '');
        form.set(`${field}[n0][VALUE_TYPE]`, DEFAULT_MULTI_TYPE[field] || 'WORK');
        return;
    }
    list.forEach((item, i) => {
        // Битрикс отдаёт значения в ВЕРХНЕМ регистре (ID/VALUE/VALUE_TYPE), а
        // внутри сайта удобнее обычный. Читаем оба: перепутать регистр —
        // значит потерять id и завести клиенту второй номер.
        const id = item?.id ?? item?.ID;
        // Есть id — правим существующее значение, нет — добавляем новое.
        const key = id ? String(id) : `n${i}`;
        const type = item?.valueType || item?.VALUE_TYPE || DEFAULT_MULTI_TYPE[field] || 'WORK';
        const country = item?.countryCode || item?.VALUE_COUNTRY_CODE;
        form.set(`${field}[${key}][VALUE]`, asText(item?.value ?? item?.VALUE));
        form.set(`${field}[${key}][VALUE_TYPE]`, String(type));
        if (country) form.set(`${field}[${key}][VALUE_COUNTRY_CODE]`, String(country));
    });
}

/**
 * Тело запроса сохранения лида.
 *
 * @param {object} lead  ПОЛНЫЙ текущий лид, как он прочитан из Битрикса:
 *                       простые поля строками, PHONE/EMAIL/WEB/IM — массивами
 *                       { id, value, valueType, countryCode },
 *                       пользовательские поля — в lead.uf (UF_CRM_… → значение).
 * @param {object} patch Что меняем: { name, statusId, assignedById, comments }.
 *                       Незаданные ключи не трогаются — это правка, а не
 *                       перезапись.
 */
export function buildLeadSaveForm(lead, patch = {}) {
    const id = String(lead?.ID ?? lead?.id ?? '').trim();
    if (!/^\d+$/.test(id)) throw new BitrixLeadError('у лида нет числового ID — сохранять нечего');

    const values = { ...lead };
    if (patch.name !== undefined) values.NAME = patch.name;
    if (patch.statusId !== undefined) values.STATUS_ID = patch.statusId;
    if (patch.assignedById !== undefined) values.ASSIGNED_BY_ID = patch.assignedById;
    if (patch.comments !== undefined) values.COMMENTS = textToBB(patch.comments);

    if (!String(values.STATUS_ID || '').trim()) {
        // Пустая стадия увела бы лид в начало воронки — молча этого не делаем.
        throw new BitrixLeadError('у лида пустая стадия — сохранение отменено');
    }

    if (patch.sourceId !== undefined) values.SOURCE_ID = patch.sourceId;

    // Правило компании, а не Битрикса: источник «Звонок» ставит телефония, и у
    // обработанного лида его быть не должно — оператор обязан выбрать
    // настоящий источник. Проверяем здесь, а не в панели: панель одна из
    // возможных, а правило одно.
    if (isCallSource(values.SOURCE_ID)) {
        throw new BitrixLeadError('источник всё ещё «Звонок» — выберите настоящий источник');
    }
    if (!String(values.SOURCE_ID || '').trim()) {
        throw new BitrixLeadError('у лида не выбран источник');
    }

    const form = new FormData();
    form.set('ACTION', 'SAVE');
    form.set('ACTION_ENTITY_TYPE', 'L');
    form.set('ACTION_ENTITY_ID', id);
    form.set('EDITOR_CONFIG_ID', 'lead_details');
    form.set('ENABLE_REQUIRED_USER_FIELD_CHECK', 'Y');

    for (const field of PLAIN_FIELDS) {
        const value = values[field];
        form.set(field, asText(value));
    }

    // Клиента (компанию и контакт) отправляем ровно тем, чем он был: трогать
    // привязки лида мы не умеем и не должны.
    form.set('CLIENT_DATA', JSON.stringify(
        lead?.CLIENT_DATA ?? { COMPANY_DATA: [], CONTACT_DATA: [] },
    ));

    for (const field of MULTI_FIELDS) putMulti(form, field, values[field]);

    // Пользовательские поля (метки Roistat и прочее) возвращаем как есть: они
    // не наши, но без них редактор считает, что их очистили.
    for (const [name, value] of Object.entries(lead?.uf || {})) {
        if (!/^UF_/.test(name)) continue;
        form.set(name, asText(value));
    }

    return form;
}

// Смена только стадии — отдельной ручкой списка. Нужна редко (обычная правка
// уходит одним SAVE вместе со стадией), но пусть будет: этой же ручкой стадию
// двигает и сам интерфейс.
export function buildStageForm(leadId, statusId) {
    const id = String(leadId ?? '').trim();
    if (!/^\d+$/.test(id)) throw new BitrixLeadError('нужен числовой id лида');
    if (!String(statusId || '').trim()) throw new BitrixLeadError('нужна стадия');
    return {
        ID: id,
        ACTION: 'SAVE_PROGRESS',
        VALUE: String(statusId),
        TYPE: 'LEAD',
        // Интерфейс шлёт сюда случайную строку своего происхождения; серверу
        // она безразлична, но поле обязательное.
        EVENT_ID: Math.random().toString(36).slice(2, 18),
    };
}
