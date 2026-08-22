// ─────────────────────────────────────────────────────────────────────────────
// Справочники Битрикса для панели: стадии лида и сотрудники.
//
// Панель показывает человеку НАЗВАНИЯ («Уточнение информации»), а Битриксу
// отправляет коды (`IN_PROCESS`), и одно к другому не сводится: половина
// стадий у компании заведена руками и имеет коды вида '4', '6', '9'. Никакого
// «угадать по названию» тут быть не может — только справочник.
//
// Формы разбора двух видов сразу: как отдаёт REST и как отдают служебные
// запросы интерфейса (ключи там в разном регистре). Свой токен REST нам не
// достался (docs/BITRIX.md), но данные оттуда сняты живьём и разбор написан
// под оба вида — если вебхук однажды заведут, менять тут будет нечего.
// ─────────────────────────────────────────────────────────────────────────────

const pick = (row, ...names) => {
    for (const name of names) {
        const value = row?.[name];
        if (value !== undefined && value !== null && value !== false && value !== '') return value;
    }
    return undefined;
};

// ── Стадии ───────────────────────────────────────────────────────────────────

// Итог стадии: успех, провал или работа в процессе. Нужен не для красоты —
// по нему панель красит стадию, а «Доволен обслуживанием» и «НЕ доволен» иначе
// выглядят одинаково.
function semanticsOf(row) {
    const raw = String(pick(row, 'SEMANTICS') || pick(row?.EXTRA || {}, 'SEMANTICS') || '').toLowerCase();
    if (raw === 's' || raw === 'success') return 'success';
    if (raw === 'f' || raw === 'failure' || raw === 'apology') return 'failure';
    return 'process';
}

export function normalizeStages(payload) {
    const list = Array.isArray(payload) ? payload : (payload?.result || []);
    return list
        .map(row => ({
            id: String(pick(row, 'STATUS_ID', 'statusId') ?? ''),
            name: String(pick(row, 'NAME', 'name') ?? '').trim(),
            color: String(pick(row, 'COLOR') || pick(row?.EXTRA || {}, 'COLOR') || '').trim() || null,
            semantics: semanticsOf(row),
            sort: Number(pick(row, 'SORT', 'sort') ?? 0) || 0,
        }))
        .filter(s => s.id && s.name)
        // Порядок — из Битрикса: он же порядок воронки, и переставлять его по
        // алфавиту нельзя, иначе «Не обработан» уедет в середину списка.
        .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'ru'));
}

export function stageName(stages, id) {
    const found = (stages || []).find(s => s.id === String(id ?? ''));
    // Стадию, которой нет в справочнике (завели после того, как мы его
    // прочитали), показываем кодом, а не пустотой: пусто читается как «стадии
    // нет», а она есть.
    return found ? found.name : String(id ?? '') || null;
}

// ── Сотрудники ───────────────────────────────────────────────────────────────

// Имя собираем «Имя Фамилия» — ровно так, как его показывает сам портал
// (шаблон #NAME# #LAST_NAME# приезжает в параметрах формы редактора). Отчество
// портал не показывает, и мы тоже: оператор должен узнавать в списке того же
// человека, которого видит в Битриксе, а не другую запись о нём.
//
// Поля заполнены как попало: у операторов всё имя лежит в NAME («Оператор
// Семен»), у остальных разложено по двум.
function fullName(row) {
    return [pick(row, 'NAME'), pick(row, 'LAST_NAME')]
        .map(part => String(part ?? '').trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function normalizeUsers(payload) {
    const list = Array.isArray(payload) ? payload : (payload?.result || []);
    return list
        // ACTIVE проверяем напрямую, а не через pick(): тот пропускает
        // «пустые» значения, а false тут — не пустота, а «уволен».
        .filter(row => row?.ACTIVE !== false && row?.ACTIVE !== 'N')
        .map(row => ({
            id: Number(pick(row, 'ID', 'id') ?? 0) || 0,
            name: fullName(row),
            position: String(pick(row, 'WORK_POSITION') ?? '').trim() || null,
            photo: String(pick(row, 'PERSONAL_PHOTO') ?? '').trim() || null,
            // Отдел нужен, чтобы в выпадашке «ответственный» первыми шли свои:
            // в портале два десятка человек, а звонки принимает колл-центр.
            departments: Array.isArray(row?.UF_DEPARTMENT) ? row.UF_DEPARTMENT.map(Number) : [],
        }))
        .filter(u => u.id && u.name)
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

// Отдел колл-центра вычисляем, а не вписываем числом: id отдела — это
// внутренность чужого портала, её однажды поменяют. Берём тот, где сидит
// больше всего людей с должностью или именем «оператор».
export function callCentreDepartment(users) {
    const score = new Map();
    for (const user of users || []) {
        if (!/оператор|колл|call/i.test(`${user.name} ${user.position || ''}`)) continue;
        for (const dep of user.departments || []) score.set(dep, (score.get(dep) || 0) + 1);
    }
    let best = null;
    for (const [dep, count] of score) {
        if (!best || count > best.count) best = { dep, count };
    }
    return best?.dep ?? null;
}

// Сотрудников интерфейс берёт не из страницы, а отдельной ручкой подбора
// (ui.entityselector.load). Ответ у неё свой: элементы с id и title, а не
// строки пользователей — приводим к тому же виду, что и остальные, чтобы
// панель не знала, откуда список приехал.
export function normalizeSelectorUsers(answer) {
    const items = answer?.data?.dialog?.items
        || answer?.dialog?.items
        || answer?.data?.items
        || answer?.items;
    if (!Array.isArray(items)) return [];
    // Приводим к строкам пользователя и отдаём ОДНИМ списком в общий разбор:
    // он же и сортирует. Прогнать каждого по отдельности — значит остаться с
    // порядком, в котором их прислал Битрикс (по «недавно выбранным»).
    const rows = items
        .filter(item => !item?.entityId || item.entityId === 'user')
        .map(item => ({
            ID: item?.id,
            NAME: item?.customData?.name || item?.title || '',
            LAST_NAME: '',
            WORK_POSITION: item?.subtitle || '',
            PERSONAL_PHOTO: item?.avatar || '',
            UF_DEPARTMENT: item?.customData?.nodeId ? [item.customData.nodeId] : [],
        }));
    return normalizeUsers(rows);
}
