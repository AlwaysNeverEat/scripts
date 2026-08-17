// ─────────────────────────────────────────────────────────────────────────────
// Публичный (read-only) профиль ЧУЖОГО пользователя — открывается по клику
// на строку в топе или на автора в ленте страницы машины. Для обычного
// зрителя — только аватар/ник/статистика; модератору/админу дополнительно
// показывается панель управления: «Назначить машины» (массово, с галочками)
// и «Забанить/Разбанить» (админа банить нельзя, модератора — только админ).
// ─────────────────────────────────────────────────────────────────────────────

import { openAssignCarsModal } from './assignCars.js';
import { achievementsFeedHtml, attachFeedParticles } from './achievements.js';
import { activityFeedHtml, attachActivityFeed } from './activityFeed.js';
import { profileHeroHtml, profileSectionHtml, plural } from './profileLayout.js';
import { namePrefixHtml } from './namePrefix.js';
import { facultyCardHtml } from './faculty.js';

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function initPublicProfilePage({ apiFetch, userId, viewer }) {
    const box = document.getElementById('profile-content');
    const titleEl = document.getElementById('page-profile-title');
    if (titleEl) titleEl.textContent = 'Профиль пользователя';
    box.innerHTML = '<div class="search-empty">Загрузка…</div>';

    let user;
    let activity = null;
    try {
        // Лента активности — отдельным запросом (см. GET /api/users/:id/activity).
        // Профиль без неё показать можно, поэтому её ошибку глотаем отдельно.
        [user, activity] = await Promise.all([
            apiFetch('/api/users/' + userId + '/public'),
            apiFetch('/api/users/' + userId + '/activity').catch(() => null),
        ]);
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
        : `<span class="profile-avatar-default"></span>`;

    const modPanelHtml = viewerIsMod ? profileSectionHtml({
        title: 'Управление',
        meta: 'видно только модераторам',
        cls: 'profile-sec-mod',
        body: `
            ${user.banned ? '<div class="mod-banned-badge">Пользователь заблокирован</div>' : ''}
            <div class="mod-panel-actions">
                <button class="btn btn-sec" id="btn-mod-assign-cars">Назначить машины</button>
                ${canBan ? `<button class="btn btn-sec ${user.banned ? '' : 'btn-danger'}" id="btn-mod-ban">${
                    user.banned ? 'Разбанить пользователя' : 'Забанить пользователя'
                }</button>` : ''}
            </div>
            <div id="mod-panel-error" class="edit-error hidden"></div>`,
    }) : '';

    const medals = Array.isArray(user.achievements) ? user.achievements.length : 0;

    box.innerHTML = `
        <div class="profile-page">
            ${profileHeroHtml({
                avatarInner: avatarHtml,
                nameInner: `${namePrefixHtml(user)}${esc(user.display_name)}`,
                added: user.stats.added ?? 0,
                edited: user.stats.edited ?? 0,
                faculty: user.faculty,
            })}

            ${user.faculty ? profileSectionHtml({
                title: 'Факультет',
                meta: 'закреплён навсегда',
                body: facultyCardHtml(user.faculty),
            }) : ''}

            ${profileSectionHtml({
                title: 'Достижения',
                meta: medals ? `${medals} ${plural(medals, ['медаль', 'медали', 'медалей'])}` : '',
                body: `<div class="achievements-feed">
                    ${achievementsFeedHtml(user.achievements, 'Пока нет достижений')}
                </div>`,
            })}

            ${profileSectionHtml({
                title: 'Активность',
                meta: 'последний год',
                body: activityFeedHtml(activity),
            })}

            ${modPanelHtml}
        </div>
    `;
    attachFeedParticles(box);
    attachActivityFeed(box);

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
            errBox.textContent = e.message;
            errBox.classList.remove('hidden');
            banBtn.disabled = false;
        }
    };
}
