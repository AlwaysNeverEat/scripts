// ─────────────────────────────────────────────────────────────────────────────
// Публичный (read-only) профиль ЧУЖОГО пользователя — открывается по клику
// на строку в топе или на автора в ленте страницы машины. Для обычного
// зрителя — только аватар/ник/статистика; модератору/админу дополнительно
// показывается панель управления: «Назначить машины» (массово, с галочками)
// и «Забанить/Разбанить» (админа банить нельзя, модератора — только админ).
// ─────────────────────────────────────────────────────────────────────────────

import { openAssignCarsModal } from './assignCars.js';

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function rolePrefixHtml(rolePrefix) {
    if (!rolePrefix) return '';
    return `<span class="role-prefix role-prefix-${esc(rolePrefix.color)}" title="${esc(rolePrefix.tooltip || '')}">${esc(rolePrefix.label)}</span> `;
}

export async function initPublicProfilePage({ apiFetch, userId, viewer }) {
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

    const viewerIsMod = viewer && (viewer.role === 'mod' || viewer.role === 'admin');
    // Кого можно банить: не админа; модератора — только админ.
    const canBan = viewerIsMod
        && user.role !== 'admin'
        && (user.role !== 'mod' || viewer.role === 'admin');

    const avatarHtml = user.avatar
        ? `<img src="${esc(user.avatar)}" alt=""/>`
        : `<span class="profile-avatar-default">👤</span>`;

    const modPanelHtml = viewerIsMod ? `
        <div class="mod-panel">
            <div class="edit-sec-h">Управление (видно только модераторам)</div>
            ${user.banned ? '<div class="mod-banned-badge">🚫 Пользователь заблокирован</div>' : ''}
            <div class="mod-panel-actions">
                <button class="btn btn-sec" id="btn-mod-assign-cars">🚗 Назначить машины</button>
                ${canBan ? `<button class="btn btn-sec ${user.banned ? '' : 'btn-danger'}" id="btn-mod-ban">${
                    user.banned ? '♻ Разбанить пользователя' : '🚫 Забанить пользователя'
                }</button>` : ''}
            </div>
            <div id="mod-panel-error" class="edit-error hidden"></div>
        </div>` : '';

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
            ${modPanelHtml}
        </div>
    `;

    if (!viewerIsMod) return;

    const reload = () => initPublicProfilePage({ apiFetch, userId, viewer });
    const errBox = document.getElementById('mod-panel-error');

    document.getElementById('btn-mod-assign-cars').onclick = () => {
        openAssignCarsModal({
            apiFetch,
            targetUser: { id: user.id, display_name: user.display_name },
            self: false,
            onDone: reload, // обновит счётчики «добавлено машин» на странице
        });
    };

    const banBtn = document.getElementById('btn-mod-ban');
    if (banBtn) banBtn.onclick = async () => {
        const banned = !user.banned;
        const q = banned
            ? `Забанить пользователя ${user.display_name}? Он будет разлогинен и не сможет войти.`
            : `Разбанить пользователя ${user.display_name}?`;
        if (!confirm(q)) return;
        errBox.classList.add('hidden');
        banBtn.disabled = true;
        try {
            await apiFetch('/api/users/' + user.id + '/ban', { method: 'POST', body: { banned } });
            reload();
        } catch (e) {
            errBox.textContent = '⚠ ' + e.message;
            errBox.classList.remove('hidden');
            banBtn.disabled = false;
        }
    };
}
