// ─────────────────────────────────────────────────────────────────────────────
// Общая раскладка страницы профиля — своего (profile.js) и чужого
// (publicProfile.js). Обе страницы собираются из одних и тех же кирпичей:
// «обложка» (кто это) и дальше по ПАНЕЛИ на каждую тему — факультет,
// достижения, активность, управление.
//
// Почему панели, а не один столбик: раньше всё содержимое профиля лежало в
// одной карточке подряд, а заголовки разделов были такими же тусклыми мелкими
// подписями, как названия полей внутри разделов. Глазу не за что зацепиться —
// страница читалась как список, а не как набор блоков. Теперь у каждого блока
// своя рамка и своя шапка, и границы блоков видно, не вчитываясь в текст.
//
// Разметку держим здесь, а не в двух файлах: свой и чужой профиль должны
// выглядеть одинаково, иначе они разъезжаются при первой же правке.
// ─────────────────────────────────────────────────────────────────────────────

import { facultyClass } from './namePrefix.js';
import { achievementIcon, latestAchievement } from './achievements.js';

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// «1 машина / 2 машины / 5 машин» — [одна, две, пять].
export function plural(n, forms) {
    const mod10 = Math.abs(n) % 10;
    const mod100 = Math.abs(n) % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
    return forms[2];
}

// Обложка профиля: цветная «шапка», аватар внахлёст на неё, ник и цифры.
// editable — свой профиль: аватар и ник кликабельные, поэтому у них id,
// подсказки и карандаш. В чужом профиле кликать нечего, и намёка быть не должно.
//
// faculty — плашка факультета (id/name/prefix). От неё красится ШАПКА обложки:
// цвета дома берутся из класса faculty-<id> (см. style.css), поэтому здесь нет
// ни одного цвета и новый факультет не требует правки этого файла. Без
// факультета шапка красится акцентом — обложка не должна выглядеть пустой
// заглушкой у того, кто ещё не прошёл распределение.
//
// subtitle — строка под ником (имя дома целиком: префикс у ника обрезан до
// четырёх букв, а тут место есть).
//
// achievements — список ачивок ЦЕЛИКОМ, а не число: третья плитка показывает
// последнюю медаль (иконку и название) и общий счёт, а по клику открывает окно
// со всеми (openAchievementsModal — обработчик вешает страница). Отдельной
// панели «Достижения» на странице нет — она дублировала бы эту плитку.
//
// withSettings — шестерёнка на шапке (только свой профиль): открывает окно
// настроек (profileSettings.js), обработчик вешает profile.js.
export function profileHeroHtml({
    avatarInner, nameInner, added = 0, edited = 0, achievements = [],
    editable = false, faculty = null, subtitle = '', withSettings = false,
}) {
    const avatar = `<div class="profile-avatar">${avatarInner}</div>`;
    const avatarBlock = editable
        ? `<div class="profile-avatar-wrap" id="profile-avatar-wrap" title="Кликните, чтобы сменить аватар">
               ${avatar}<span class="profile-avatar-pen" aria-hidden="true"></span>
           </div>`
        : `<div class="profile-avatar-wrap profile-avatar-static">${avatar}</div>`;
    const nameBlock = editable
        ? `<div class="profile-name" id="profile-name-view" title="Кликните, чтобы поменять ник">${nameInner}</div>`
        : `<div class="profile-name profile-name-static">${nameInner}</div>`;
    const settingsBtn = withSettings
        ? `<button type="button" class="profile-settings-btn" id="btn-profile-settings" title="Настройки" aria-label="Настройки">
               <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
           </button>`
        : '';

    const count = Array.isArray(achievements) ? achievements.length : 0;
    const latest = latestAchievement(achievements);
    const latestIcon = latest ? achievementIcon(latest.id) : null;
    // Плитка — кнопка: у неё есть работа (окно всех ачивок), а у соседних
    // плиток нет. Подпись — НАЗВАНИЕ ПОСЛЕДНЕЙ медали, а не слово
    // «достижений»: что это за число, объясняют иконка и подсказка.
    const achTile = `
        <button type="button" class="profile-stat profile-stat-ach" id="profile-ach-tile"
                title="${count
                    ? `${count} ${plural(count, ['достижение', 'достижения', 'достижений'])}, последнее — «${esc(latest.title)}». Показать все`
                    : 'Достижений пока нет'}">
            ${latestIcon ? `<img class="profile-ach-icon" src="${esc(latestIcon)}" alt=""/>` : ''}
            <span class="profile-ach-info">
                <b>${count}</b>
                <span>${latest ? esc(latest.title) : plural(count, ['Достижение', 'Достижения', 'Достижений'])}</span>
            </span>
        </button>`;

    return `
        <section class="profile-hero${facultyClass(faculty, 'faculty-tint')}">
            <div class="profile-cover">${settingsBtn}</div>
            <div class="profile-hero-main">
                ${avatarBlock}
                <div class="profile-ident">
                    ${nameBlock}
                    ${subtitle ? `<div class="profile-hero-sub">${subtitle}</div>` : ''}
                </div>
            </div>
            <div class="profile-stats">
                <div class="profile-stat"><b>${added}</b><span>Добавлено машин</span></div>
                <div class="profile-stat"><b>${edited}</b><span>Отредактировано</span></div>
                ${achTile}
            </div>
        </section>`;
}

// Панель раздела. title/meta — наш собственный текст (не пользовательский),
// поэтому вставляются как есть; всё, что приходит с сервера, экранируется на
// стороне вызывающего кода.
export function profileSectionHtml({ title, meta = '', body, cls = '' }) {
    return `
        <section class="profile-sec${cls ? ' ' + cls : ''}">
            <div class="profile-sec-head">
                <h3 class="profile-sec-title">${title}</h3>
                ${meta ? `<span class="profile-sec-meta">${meta}</span>` : ''}
            </div>
            <div class="profile-sec-body">${body}</div>
        </section>`;
}
