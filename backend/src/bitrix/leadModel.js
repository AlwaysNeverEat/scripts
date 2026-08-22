// ─────────────────────────────────────────────────────────────────────────────
// Чтение лида со страницы карточки.
//
// Значения полей лежат в разметке одним куском — Битрикс сам отдаёт их
// редактору:
//
//     var model = BX.Crm.EntityEditorModelFactory.create(1, "", {
//         entityTypeId: 1, data: {"ID":"268402","TITLE":"…","NAME":"Давид", …}
//     });
//
// Поэтому разметку мы НЕ парсим: находим этот кусок, вырезаем JSON по балансу
// скобок и дальше работаем с обычным объектом. Всё, что нарисовано на странице
// (плашки, стадии, подписи), — производное от него, и разбирать вёрстку значило
// бы читать пересказ вместо оригинала.
//
// Карточка открывается слайдером, то есть отдельным документом
// /crm/lead/details/<id>/?IFRAME=Y&IFRAME_TYPE=SIDE_SLIDER, и композитного кэша
// на ней НЕТ (в отличие от списка лидов) — хватает одного запроса.
// ─────────────────────────────────────────────────────────────────────────────

import { bbToText, isCallSource, CALL_SOURCE } from './leads.js';

export class BitrixReadError extends Error {
    constructor(message) {
        super(message);
        this.code = 'bitrix_lead_unreadable';
    }
}

// Вырезаем JSON по балансу скобок с учётом строк: внутри значений попадаются и
// скобки, и экранированные кавычки (комментарии операторов со ссылками на
// каталоги — обычное дело).
function sliceJson(text, from) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = from; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) return text.slice(from, i + 1);
    }
    return null;
}

/** Сырая модель лида из разметки карточки. */
export function parseLeadModel(html) {
    const text = String(html || '');
    const factory = text.search(/EntityEditorModelFactory\s*\.\s*create\s*\(/);
    if (factory < 0) {
        // Чаще всего это не «сломался разбор», а закрывшаяся сессия: портал
        // отдал страницу входа. Пустую модель возвращать НЕЛЬЗЯ — на ней
        // соберётся пустая форма, а сохранение такой формы стирает лид.
        throw new BitrixReadError('на странице нет данных лида — похоже, сессия закрылась');
    }
    const dataAt = text.indexOf('data:', factory);
    const start = dataAt < 0 ? -1 : text.indexOf('{', dataAt);
    const raw = start < 0 ? null : sliceJson(text, start);
    if (!raw) throw new BitrixReadError('данные лида в разметке оборвались');
    try {
        return JSON.parse(raw);
    } catch {
        throw new BitrixReadError('данные лида не разбираются — портал сменил формат');
    }
}

// Множественное поле (телефон, почта): нам нужны id значения, само значение и
// тип. VIEW_DATA — готовая разметка для карточки, и обратно её слать нельзя.
function multi(list) {
    return (Array.isArray(list) ? list : [])
        .map(item => ({
            id: item?.ID ? String(item.ID) : null,
            value: String(item?.VALUE ?? ''),
            valueType: String(item?.VALUE_TYPE || 'WORK'),
            countryCode: String(item?.VALUE_EXTRA?.COUNTRY_CODE || '') || null,
        }))
        .filter(item => item.value);
}

// Пользовательские поля приезжают объектом с подписью: { SIGNATURE, IS_EMPTY }
// у пустого и со значением у заполненного. В форму уходит именно значение —
// подпись поля Битрикс проверяет отдельным обработчиком, и наше дело её не
// трогать.
function ufValue(raw) {
    if (raw == null || raw === false) return '';
    if (typeof raw !== 'object') return String(raw);
    if (raw.IS_EMPTY) return '';
    const value = raw.VALUE ?? raw.value ?? '';
    return typeof value === 'object' ? '' : String(value);
}

// Поля, которые редактор отправляет обратно как есть. Всё остальное из 143
// полей модели — производное (FULL_NAME, ASSIGNED_BY_NAME, даты), и слать его
// не нужно: Битрикс пересчитает сам.
const KEEP = [
    'ID', 'TITLE', 'STATUS_ID', 'OPPORTUNITY', 'CURRENCY_ID', 'IS_MANUAL_OPPORTUNITY',
    'HONORIFIC', 'NAME', 'SECOND_NAME', 'LAST_NAME', 'BIRTHDATE', 'POST',
    'COMPANY_TITLE', 'SOURCE_ID', 'SOURCE_DESCRIPTION', 'OPENED', 'ASSIGNED_BY_ID',
    'OBSERVER_IDS', 'COMMENTS', 'ADDRESS',
];

/**
 * Модель Битрикса → лид в нашем виде: то, что уходит обратно в форму
 * сохранения, плюс `view` — то, что показывает панель.
 */
export function normalizeLead(model) {
    const id = String(model?.ID ?? '').trim();
    if (!/^\d+$/.test(id)) throw new BitrixReadError('в данных лида нет его номера');

    const lead = {};
    for (const key of KEEP) {
        const value = model?.[key];
        lead[key] = value == null || value === false ? '' : String(value);
    }

    lead.PHONE = multi(model?.PHONE);
    lead.EMAIL = multi(model?.EMAIL);
    lead.WEB = multi(model?.WEB);
    lead.IM = multi(model?.IM);

    lead.uf = {};
    for (const [key, raw] of Object.entries(model || {})) {
        if (key.startsWith('UF_')) lead.uf[key] = ufValue(raw);
    }

    // Ответственный: имя нужно панели, чтобы не ходить за справочником ради
    // одной строки. Собирается так же, как показывает портал.
    const assigned = [model?.ASSIGNED_BY_NAME, model?.ASSIGNED_BY_LAST_NAME]
        .map(part => String(part ?? '').trim()).filter(Boolean).join(' ');

    lead.view = {
        id,
        title: lead.TITLE,
        name: [lead.NAME, lead.LAST_NAME].filter(Boolean).join(' ').trim(),
        statusId: lead.STATUS_ID,
        assignedById: Number(lead.ASSIGNED_BY_ID) || null,
        assignedByName: assigned || null,
        // Панель показывает описание обычным текстом, а не BB-кодом.
        comments: bbToText(lead.COMMENTS),
        phones: lead.PHONE.map(p => p.value),
        source: String(model?.SOURCE_DESCRIPTION ?? '').trim() || null,
        createdAt: String(model?.DATE_CREATE ?? '') || null,
    };

    return lead;
}

// ── Источники ────────────────────────────────────────────────────────────────

// Список источников лежит в той же карточке, в описании поля SOURCE_ID:
//
//     {'name':'SOURCE_ID','type':'list','data':{'items':[
//         {'NAME':'Не выбрано','VALUE':''},{'NAME':'Звонок','VALUE':'CALL'}, …]}}
//
// Записано это литералом JS с ОДИНАРНЫМИ кавычками, а не JSON'ом, поэтому
// разбираем парами: городить конвертер ради двух ключей смысла нет, а regexp
// по паре 'NAME'/'VALUE' переживёт и добавление новых полей внутрь.
export function parseSourceOptions(html) {
    const text = String(html || '');

    // Имя поля встречается в карточке дважды: сперва в перечислении разделов
    // (там у него нет ничего, кроме имени), и только потом в описании самого
    // поля со списком значений. Первое вхождение притащило бы ЧУЖОЙ список —
    // на живой карточке в выпадашку источников попали стадии.
    //
    // Поэтому смотрим не «рядом», а ВНУТРИ описания: берём кусок до следующего
    // поля и требуем, чтобы и тип, и список значений нашлись в нём. Вложенные
    // значения пишутся в верхнем регистре ('NAME'), так что за границу поля их
    // не примешь.
    const re = /\{'name':'SOURCE_ID'/g;
    let m;
    while ((m = re.exec(text))) {
        const next = text.indexOf("{'name':'", m.index + 1);
        const field = text.slice(m.index, next < 0 ? m.index + 8000 : next);
        if (!field.includes("'type':'list'")) continue;
        const items = field.indexOf("'items':[");
        if (items < 0) continue;
        const end = field.indexOf(']', items);
        return parseOptionPairs(field.slice(items, end < 0 ? undefined : end));
    }
    return [];
}

function parseOptionPairs(chunk) {
    const list = [];
    const re = /\{'NAME':'((?:[^'\\]|\\.)*)','VALUE':'((?:[^'\\]|\\.)*)'\}/g;
    let m;
    while ((m = re.exec(chunk))) {
        const id = m[2];
        // «Не выбрано» — пустое значение, в выпадашку его класть нечего:
        // источник у обработанного лида обязан быть. Безымянные пропускаем по
        // той же причине: в этом портале есть источник с пустым названием
        // (REPEAT_SALE), и пустая строка в списке — это не выбор, а загадка.
        if (!id || !m[1]) continue;
        list.push({ id, name: m[1] });
    }
    return list;
}

// Правило «источник не может остаться Звонком» живёт в leads.js рядом с
// остальными правилами сохранения; здесь оно только пробрасывается наружу,
// чтобы панель брала справочник и проверку из одного места.
export { isCallSource, CALL_SOURCE };

/** Страница карточки лида — тот самый адрес, который открывает слайдер. */
export function leadPagePath(id) {
    const value = String(id ?? '').trim();
    if (!/^\d+$/.test(value)) throw new BitrixReadError('нужен числовой id лида');
    return `/crm/lead/details/${value}/?IFRAME=Y&IFRAME_TYPE=SIDE_SLIDER`;
}
