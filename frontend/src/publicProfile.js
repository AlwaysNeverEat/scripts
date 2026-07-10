// ─────────────────────────────────────────────────────────────────────────────
// Публичный (read-only) профиль ЧУЖОГО пользователя — открывается по клику
// на строку в топе или на автора в ленте страницы машины. Никакого
// редактирования — только аватар/ник/статистика.
// ─────────────────────────────────────────────────────────────────────────────

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function rolePrefixHtml(rolePrefix) {
    if (!rolePrefix) return '';
    return `<span class="role-prefix role-prefix-${esc(rolePrefix.color)}" title="${esc(rolePrefix.tooltip || '')}">${esc(rolePrefix.label)}</span> `;
}

export async function initPublicProfilePage({ apiFetch, userId }) {
    const box = document.getElementById('profile-content');
    const titleEl = document.getElementById('page-profile-title');
    if (titleEl) titleEl.textContent = 'Профиль пользователя';
    box.innerHTML = '<div class="search-empty">Загрузка…</div>';

    let user;
    try {
        user = await apiFetch('/api/users/' + userId + '/public');
    } catch (e) {
        box.innerHTML = `<div class="search-empty">Не удалось загрузить профиль: ${esc(e.message)}</div>`;
        return;
    }

    const avatarHtml = user.avatar
        ? `<img src="${esc(user.avatar)}" alt=""/>`
        : `<span class="profile-avatar-default">👤</span>`;

    box.innerHTML = `
        <div class="profile-card">
            <div class="profile-avatar">${avatarHtml}</div>
            <div class="profile-name profile-name-static">
                ${rolePrefixHtml(user.role_prefix)}${esc(user.display_name)}
            </div>
            <div class="profile-stats">
                <div class="profile-stat"><b>${user.stats.added ?? 0}</b><span>Добавлено машин</span></div>
                <div class="profile-stat"><b>${user.stats.edited ?? 0}</b><span>Отредактировано машин</span></div>
            </div>
        </div>
    `;
}
