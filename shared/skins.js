// ─────────────────────────────────────────────────────────────────────────────
// Скины — оформление, которое человек носит на себе и которое видят ВСЕ:
// рамка вокруг его аватарки (везде, где она нарисована), шапка его профиля,
// его звонки в ленте лидов и картинка на капсулах его записей. Задумано как благодарность поддержавшим проект; пока выдаётся
// списком логинов (SKIN_EDITOR_LOGINS) — смотреть, как оно выглядит, а не
// раздавать.
//
// Скин СОБИРАЕТСЯ ПО ЧАСТЯМ: у каждой части (рамка, шапка, звонки, записи) свой
// пак или стандартный вид. Рамка от котика при обычном баннере — нормальный
// выбор, а не недоделка, поэтому в базе не «пак + выключатели», а словарь
// «часть → пак». Хранится одна строка на человека (backend/src/skins/store.js),
// список приезжает всем одним запросом (`GET /api/skins`), рисует его
// frontend/src/skins.js.
//
// Где скин виден и по чему узнаётся:
//   • рамка и шапка — по id человека (рамка — у любой его аватарки: топы,
//     мини-топы игр, панель поддержавших, лента машины, записи, вкладка);
//   • запись — на доске, по автору записи (тот же, что кружок на капсуле);
//   • звонок в ленте лидов — по КОДУ ОПЕРАТОРА звонка. Код вводят во вкладке «Лиды», и пока его
//     там нет, у лидов скина нет: иначе звонки ни с кем не связать. Сервер
//     хранит код рядом со скином — карточку чужого звонка открывает другой
//     человек, и узнать хозяина звонка ему больше неоткуда.
// ─────────────────────────────────────────────────────────────────────────────

export const SKIN_EDITOR_LOGINS = ['gtrixoff'];

// hue — тон пака в ленте кейса и в инвентаре (полоска «редкости», как в CS).
// weight — вес пака в розыгрыше кейса: шанс пака = его вес / сумма весов
// паков сезона (shared/cases.js). Веса ЦЕЛЫЕ (на сервере crypto.randomInt),
// поэтому обычные стоят по 20, а не по 1: только так у легендарки остаётся
// место быть в двадцать раз реже обычного, а не в десять.
// tier — ступень редкости: обычный (по умолчанию), 'rare' и 'legendary'. В
// ленте, на призе, в примерочной и в окне шансов ступень подсвечена своим
// цветом (фиолетовый и золото), а в шансах у каждой своя группа.
// ready: false — пак описан, но картинки ещё не нарезаны: в кейсы он не
// попадает, пока не появятся все части (из кейса не должно выпадать то, чего
// нельзя надеть).
export const SKIN_PACKS = {
    cat: { label: 'Котик', hue: 350, weight: 20 },
    fox: { label: 'Лиса', hue: 45, weight: 20 },
    raccoon: { label: 'Енотик', hue: 225, weight: 20 },
    bunny: { label: 'Зайчик', hue: 15, weight: 20 },
    halloween: { label: 'Хэллоуин', hue: 285, weight: 6, tier: 'rare' },
    // Легендарка: «тот самый» жёлтый Матиз курьера с термокоробом. Вес 1 на
    // сезон из четырёх обычных и редкого — около 1,1% за большой кейс.
    matiz: { label: 'Матиз курьера', hue: 95, weight: 1, tier: 'legendary' },
    // Зима, «Холодрыжество» (SEASONS в shared/cases.js): картинок ещё нет.
    // Легендарок три по весу 1 — каждая около 1% за большой кейс, как Матиз.
    snowman: { label: 'Снеговик', hue: 200, weight: 20 },
    santa: { label: 'Санта', hue: 0, weight: 20 },
    deer: { label: 'Олень', hue: 25, weight: 20 },
    owl: { label: 'Сова', hue: 210, weight: 20 },
    grinch: { label: 'Гринч', hue: 110, weight: 6, tier: 'rare' },
    subzero: { label: 'Саб-Зиро', hue: 190, weight: 6, tier: 'rare' },
    potter: { label: 'Гарри Поттер', hue: 40, weight: 1, tier: 'legendary', ready: false },
    lichking: { label: 'Король-лич', hue: 195, weight: 1, tier: 'legendary' },
};

export const TIERS = ['common', 'rare', 'legendary'];
export const tierOf = (pack) => SKIN_PACKS[pack]?.tier || 'common';

export const SKIN_PARTS = [
    { id: 'frame', label: 'Рамка аватара' },
    { id: 'cover', label: 'Шапка профиля' },
    { id: 'leads', label: 'Звонки в ленте' },
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

// Чьё время на коде: claims — строки operator_claims ({ code, userId, at }),
// at — мс настоящего времени. Хозяин звонка — последний, кто занял код ДО
// звонка; userId: null — код освобождён (вышел из аккаунта). Звонок раньше
// всех известных строк — ничей: угадывать, кто сидел тогда, не из чего.
// Без времени звонка — хозяин сейчас.
export function operatorAt(claims, code, at) {
    const k = skinOperatorKey(code);
    if (!k) return null;
    let best = null;
    for (const c of claims || []) {
        if (c.code !== k || (at && c.at > at)) continue;
        if (!best || c.at > best.at) best = c;
    }
    return best?.userId || null;
}

/**
 * Скин звонка: скин лидов того, кто сидел под кодом в момент звонка. Код —
 * место за телефоном, а не человек (на одном коде работают сменами), поэтому
 * сам код в скине не хранится: сменщик без скина иначе получал чужой.
 */
export function skinForOperator(skins, claims, code, at) {
    const owner = operatorAt(claims, code, at);
    if (!owner) return null;
    return (skins || []).find(s => s.userId === owner && s.parts?.leads) || null;
}

