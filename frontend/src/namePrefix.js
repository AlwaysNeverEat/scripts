// ─────────────────────────────────────────────────────────────────────────────
// Плашки перед ником — одно место на весь сайт.
//
// Их три: роль («mod»), подписка («supp») и факультет («гриф»), и порядок у них
// ЖЁСТКИЙ — роль, подписка, факультет. Роль говорит о правах, подписка о том,
// что человек платит за этот сервер, факультет — о характере; сортировка идёт
// от «что можно» к «кто ты»: у модератора-подписчика всегда
// «mod supp гриф Вася», а не наоборот.
//
// Раньше маленькая функция rolePrefixHtml была скопирована в девять файлов —
// топ, оба профиля, страница машины, админка и четыре окна игр. Пока плашка
// была одна, копии жили мирно; со второй они начали бы разъезжаться при первой
// же правке, а плашка обязана выглядеть одинаково везде, иначе по ней перестают
// узнавать людей.
//
// Принимает объект пользователя целиком (у него могут быть обе плашки или ни
// одной), а не отдельные поля: вызывающему коду не нужно помнить, из чего
// плашка собирается.
// ─────────────────────────────────────────────────────────────────────────────

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function rolePrefixHtml(rolePrefix) {
    if (!rolePrefix) return '';
    return `<span class="role-prefix role-prefix-${esc(rolePrefix.color)}" title="${esc(rolePrefix.tooltip || '')}">${esc(rolePrefix.label)}</span> `;
}

// Плашка факультета. Цвета дома берутся из класса faculty-<id> (см. style.css),
// поэтому здесь нет ни одного цвета: факультет добавляется описанием в
// shared/faculties.js и парой строк в стилях, а не правкой этой функции.
export function facultyPrefixHtml(faculty) {
    if (!faculty || !faculty.prefix) return '';
    return `<span class="faculty-prefix faculty-${esc(faculty.id)}" title="Факультет: ${esc(faculty.name)}">${esc(faculty.prefix)}</span> `;
}

// Цвет подписчика уезжает в атрибут style, поэтому сверяем его с шаблоном, а
// не просто экранируем: экранирование спасает от разметки, но не от лишней
// точки с запятой, дописывающей соседнее правило. Сервер отдаёт только hex
// (shared/supporterTheme.js), и здесь мы это же и требуем.
function safeColor(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : 'currentColor';
}

// Плашка подписчика. Цвет у каждого свой (его же он выбрал темой), поэтому он
// приезжает С ПЛАШКОЙ и кладётся переменной: в glass.css нет ни одного цвета
// supp, есть только форма. Срок в подсказке — чтобы подписчик видел, сколько
// осталось, не заходя в профиль.
export function suppPrefixHtml(supporter) {
    if (!supporter) return '';
    const until = supporter.forever
        ? 'бессрочно'
        : `до ${new Date(supporter.until).toLocaleDateString('ru-RU')}`;
    return `<span class="supp-prefix" style="--supp-badge: ${safeColor(supporter.color)}"`
        + ` title="Подписка supp — ${esc(until)}">supp</span> `;
}

export function namePrefixHtml(user) {
    if (!user) return '';
    return rolePrefixHtml(user.role_prefix)
        + suppPrefixHtml(user.supporter)
        + facultyPrefixHtml(user.faculty);
}

// Цвет строки подписчика для топа. Возвращает и класс, и переменную с цветом:
// в отличие от факультета, где цвета дома лежат в CSS, тут цвет у каждого свой.
// Пустая строка, если подписчик не захотел красить свою строку (glow: false), —
// это его выбор, а не поломка.
export function suppRowAttrs(supporter) {
    if (!supporter || !supporter.glow) return { cls: '', style: '' };
    return { cls: ' supp-tint', style: `--supp-row: ${safeColor(supporter.color)}` };
}

// CSS-класс с цветами дома — для «подложки» профиля и строки топа.
// Неизвестный факультет (переименовали id в коде) не должен красить ничем.
export function facultyClass(faculty, base) {
    if (!faculty || !faculty.id) return '';
    return ` ${base} faculty-${String(faculty.id).replace(/[^a-z]/g, '')}`;
}
