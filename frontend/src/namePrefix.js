// ─────────────────────────────────────────────────────────────────────────────
// Плашки перед ником — одно место на весь сайт.
//
// Их две: роль («mod») и факультет («гриф»), и порядок у них ЖЁСТКИЙ — сначала
// роль, потом факультет. Роль говорит о правах, факультет о человеке, и права
// важнее: у модератора всегда «mod гриф Вася», а не наоборот.
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

export function namePrefixHtml(user) {
    if (!user) return '';
    return rolePrefixHtml(user.role_prefix) + facultyPrefixHtml(user.faculty);
}

// CSS-класс с цветами дома — для «подложки» профиля и строки топа.
// Неизвестный факультет (переименовали id в коде) не должен красить ничем.
export function facultyClass(faculty, base) {
    if (!faculty || !faculty.id) return '';
    return ` ${base} faculty-${String(faculty.id).replace(/[^a-z]/g, '')}`;
}
