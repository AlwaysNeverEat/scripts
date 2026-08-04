// ─────────────────────────────────────────────────────────────────────────────
// Общая раскладка страницы профиля — своего (profile.js) и чужого
// (publicProfile.js). Обе страницы собираются из одних и тех же кирпичей:
// «обложка» (кто это) и дальше по ПАНЕЛИ на каждую тему — активность,
// достижения, управление, аккаунт.
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

// «1 машина / 2 машины / 5 машин» — [одна, две, пять].
export function plural(n, forms) {
    const mod10 = Math.abs(n) % 10;
    const mod100 = Math.abs(n) % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
    return forms[2];
}

// Обложка профиля: аватар, ник и две цифры.
// editable — свой профиль: аватар и ник кликабельные, поэтому у них id,
// подсказки и карандаш. В чужом профиле кликать нечего, и намёка быть не должно.
export function profileHeroHtml({ avatarInner, nameInner, added = 0, edited = 0, editable = false }) {
    const avatar = `<div class="profile-avatar">${avatarInner}</div>`;
    const avatarBlock = editable
        ? `<div class="profile-avatar-wrap" id="profile-avatar-wrap" title="Кликните, чтобы сменить аватар">
               ${avatar}<span class="profile-avatar-pen" aria-hidden="true"></span>
           </div>`
        : `<div class="profile-avatar-wrap profile-avatar-static">${avatar}</div>`;
    const nameBlock = editable
        ? `<div class="profile-name" id="profile-name-view" title="Кликните, чтобы поменять ник">${nameInner}</div>`
        : `<div class="profile-name profile-name-static">${nameInner}</div>`;

    return `
        <section class="profile-hero">
            <span class="profile-hero-glow" aria-hidden="true"></span>
            ${avatarBlock}
            ${nameBlock}
            <div class="profile-stats">
                <div class="profile-stat"><b>${added}</b><span>Добавлено машин</span></div>
                <div class="profile-stat"><b>${edited}</b><span>Отредактировано машин</span></div>
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
