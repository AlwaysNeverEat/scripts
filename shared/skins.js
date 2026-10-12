// ─────────────────────────────────────────────────────────────────────────────
// Скины — оформление, которое человек носит на себе и которое видят ВСЕ:
// рамка аватара в профиле, баннер карточки лида и картинка на капсулах его
// записей. Задумано как благодарность поддержавшим проект; пока выдаётся
// списком логинов (SKIN_EDITOR_LOGINS) — смотреть, как оно выглядит, а не
// раздавать.
//
// Скин — это ПАК (одна тема на все три места) и выключатели частей: кто-то
// захочет котика на записях, но не на аватарке. Хранится одна строка на
// человека (backend/src/skins/store.js), список приезжает всем одним запросом
// (`GET /api/skins`), а рисует его frontend/src/skins.js.
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

/**
 * Тело `PUT /api/skins/me` → то, что пишется в базу. Пак не из списка —
 * ошибка, а не «без скина»: молча снять скин из-за опечатки хуже отказа.
 * Незнакомые части отбрасываются, недостающие считаются включёнными.
 * @returns {{ skin?: { pack: string|null, parts: object, operator: string }, error?: string }}
 */
export function cleanSkin(body) {
    const b = body && typeof body === 'object' ? body : {};
    const pack = b.pack == null || b.pack === '' ? null : String(b.pack);
    if (pack && !Object.hasOwn(SKIN_PACKS, pack)) return { error: 'такого скина нет' };
    const src = b.parts && typeof b.parts === 'object' ? b.parts : {};
    const parts = {};
    for (const { id } of SKIN_PARTS) parts[id] = src[id] !== false;
    return { skin: { pack, parts, operator: skinOperatorKey(b.operator) } };
}

// Строка из базы → то, что уезжает в список. Снятый скин (pack = null) в
// список не попадает вовсе — смотреть на нём нечего.
export function publicSkin(row) {
    if (!row?.pack || !Object.hasOwn(SKIN_PACKS, row.pack)) return null;
    const parts = {};
    for (const { id } of SKIN_PARTS) parts[id] = row.parts?.[id] !== false;
    return { userId: row.user_id, pack: row.pack, parts, operator: skinOperatorKey(row.operator) };
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
