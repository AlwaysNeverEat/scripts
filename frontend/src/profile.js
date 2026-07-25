// ─────────────────────────────────────────────────────────────────────────────
// Страница профиля: аватар (загрузка + обрезка кроппером в Supabase Storage),
// ник (клик-редактирование), статистика «добавлено/отредактировано», пустой
// расширяемый фид достижений-заглушка, кнопка «Выйти».
// ─────────────────────────────────────────────────────────────────────────────

import { openAvatarCropper } from './avatarCropper.js';
import { achievementsFeedHtml, attachFeedParticles } from './achievements.js';
import { openAssignCarsModal } from './assignCars.js';

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function rolePrefixHtml(rolePrefix) {
    if (!rolePrefix) return '';
    return `<span class="role-prefix role-prefix-${esc(rolePrefix.color)}" title="${esc(rolePrefix.tooltip || '')}">${esc(rolePrefix.label)}</span> `;
}

// Есть аватар — спрашиваем, что делать; нет — сразу открываем file picker.
function chooseAvatarAction() {
    return new Promise((resolve) => {
        const old = document.getElementById('avatar-action-modal');
        if (old) old.remove();

        const modal = document.createElement('div');
        modal.id = 'avatar-action-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-backdrop"></div>
            <div class="modal-win modal-win-sm">
                <div class="modal-head">
                    <span>Аватарка</span>
                    <button class="btn btn-sec" id="avatar-action-close">✕</button>
                </div>
                <div class="modal-body">
                    <div class="avatar-action-list">
                        <button class="btn btn-pri" id="avatar-action-recrop">Изменить отображение</button>
                        <button class="btn btn-sec" id="avatar-action-new">Загрузить новую</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const finish = (v) => { modal.remove(); resolve(v); };
        modal.querySelector('.modal-backdrop').onclick = () => finish(null);
        modal.querySelector('#avatar-action-close').onclick = () => finish(null);
        modal.querySelector('#avatar-action-recrop').onclick = () => finish('recrop');
        modal.querySelector('#avatar-action-new').onclick = () => finish('new');
    });
}

export async function initProfilePage({ apiFetch, user, onUserChanged, onLogout }) {
    const box = document.getElementById('profile-content');
    const titleEl = document.getElementById('page-profile-title');
    if (titleEl) titleEl.textContent = 'Профиль';
    box.innerHTML = '<div class="search-empty">Загрузка…</div>';

    let stats = { added: 0, edited: 0 };
    let achievements = [];
    try {
        [stats, achievements] = await Promise.all([
            apiFetch('/api/profile/stats'),
            apiFetch('/api/profile/achievements'),
        ]);
    } catch { /* покажем то, что есть, без статистики */ }

    render();

    function render() {
        const avatarHtml = user.avatar
            ? `<img src="${esc(user.avatar)}" alt=""/>`
            : `<span class="profile-avatar-default"></span>`;

        box.innerHTML = `
            <div class="profile-card">
                <div class="profile-avatar-wrap" id="profile-avatar-wrap" title="Кликните, чтобы сменить аватар">
                    <div class="profile-avatar">${avatarHtml}</div>
                </div>
                <input type="file" id="profile-avatar-input" accept="image/*" hidden/>
                <div class="profile-name" id="profile-name-view" title="Кликните, чтобы поменять ник">
                    ${rolePrefixHtml(user.role_prefix)}${esc(user.display_name)}
                    <span class="profile-name-edit-hint"></span>
                </div>

                <div class="profile-stats">
                    <div class="profile-stat"><b>${stats.added ?? 0}</b><span>Добавлено машин</span></div>
                    <div class="profile-stat"><b>${stats.edited ?? 0}</b><span>Отредактировано машин</span></div>
                </div>

                <div class="edit-sec-h">Достижения</div>
                <div class="achievements-feed">
                    ${achievementsFeedHtml(achievements, 'Пока пусто — достижения появятся здесь')}
                </div>

                ${user.role === 'mod' || user.role === 'admin' ? `
                    <div class="edit-sec-h">Модератор</div>
                    <button class="btn btn-sec profile-mod-assign" id="btn-self-assign-cars">Записать себе незанятые машины</button>
                ` : ''}

                <div id="profile-error" class="edit-error hidden"></div>
                <button class="btn btn-sec profile-logout" id="btn-logout">Выйти</button>
            </div>
        `;
        bind();
        attachFeedParticles(box);
    }

    function bind() {
        const errBox = document.getElementById('profile-error');
        const showErr = (msg) => { errBox.textContent = msg; errBox.classList.remove('hidden'); };
        const fileInput = document.getElementById('profile-avatar-input');

        async function uploadNew(file) {
            const objectUrl = URL.createObjectURL(file);
            try {
                const result = await openAvatarCropper({ imageSrc: objectUrl });
                if (!result) return; // отменили в кроппере
                const fd = new FormData();
                fd.append('avatar_original', file);
                fd.append('avatar', result.blob, 'avatar.jpg');
                fd.append('crop', JSON.stringify(result.crop));
                const resp = await apiFetch('/api/profile/avatar', { method: 'POST', body: fd, isMultipart: true });
                user = resp.user;
                onUserChanged(user);
                render();
            } catch (err) {
                showErr(err.message);
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
        }

        async function recrop() {
            if (!user.avatar_original) return;
            try {
                const result = await openAvatarCropper({ imageSrc: user.avatar_original, initialCrop: user.avatar_crop });
                if (!result) return;
                const fd = new FormData();
                fd.append('avatar', result.blob, 'avatar.jpg');
                fd.append('crop', JSON.stringify(result.crop));
                const resp = await apiFetch('/api/profile/avatar/crop', { method: 'PATCH', body: fd, isMultipart: true });
                user = resp.user;
                onUserChanged(user);
                render();
            } catch (err) {
                showErr(err.message);
            }
        }

        document.getElementById('profile-avatar-wrap').onclick = async () => {
            errBox.classList.add('hidden');
            if (user.avatar && user.avatar_original) {
                const action = await chooseAvatarAction();
                if (action === 'recrop') await recrop();
                else if (action === 'new') fileInput.click();
            } else {
                fileInput.click();
            }
        };

        fileInput.onchange = () => {
            const file = fileInput.files[0];
            fileInput.value = ''; // чтобы повторный выбор того же файла тоже сработал
            if (file) uploadNew(file);
        };

        document.getElementById('profile-name-view').onclick = () => {
            const cur = user.display_name;
            const nameBox = document.getElementById('profile-name-view');
            nameBox.innerHTML = `<input type="text" id="profile-name-input" value="${esc(cur)}" class="profile-name-input"/>`;
            const input = document.getElementById('profile-name-input');
            input.focus();
            input.select();

            const commit = async () => {
                const val = input.value.trim();
                if (!val || val === cur) { render(); return; }
                try {
                    const resp = await apiFetch('/api/profile', { method: 'PATCH', body: { display_name: val } });
                    user = resp.user;
                    onUserChanged(user);
                } catch (err) {
                    showErr(err.message);
                }
                render();
            };
            input.onblur = commit;
            input.onkeydown = (e) => {
                if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
                if (e.key === 'Escape') { e.preventDefault(); render(); }
            };
        };

        const selfAssignBtn = document.getElementById('btn-self-assign-cars');
        if (selfAssignBtn) selfAssignBtn.onclick = () => {
            openAssignCarsModal({
                apiFetch,
                targetUser: { id: user.id, display_name: user.display_name },
                self: true, // себе — только незанятые машины
                onDone: async () => {
                    // обновить счётчики и ачивки на странице
                    try {
                        [stats, achievements] = await Promise.all([
                            apiFetch('/api/profile/stats'),
                            apiFetch('/api/profile/achievements'),
                        ]);
                    } catch { /* покажем старые цифры */ }
                    render();
                },
            });
        };

        document.getElementById('btn-logout').onclick = async () => {
            try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch { /* всё равно разлогиниваем локально */ }
            onLogout();
        };
    }
}
