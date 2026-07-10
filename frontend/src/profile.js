// ─────────────────────────────────────────────────────────────────────────────
// Страница профиля: аватар (загрузка файлом в Supabase Storage), ник
// (клик-редактирование), статистика «добавлено/отредактировано», пустой
// расширяемый фид достижений-заглушка, кнопка «Выйти».
// ─────────────────────────────────────────────────────────────────────────────

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function rolePrefixHtml(rolePrefix) {
    if (!rolePrefix) return '';
    return `<span class="role-prefix role-prefix-${esc(rolePrefix.color)}" title="${esc(rolePrefix.tooltip || '')}">${esc(rolePrefix.label)}</span> `;
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
            : `<span class="profile-avatar-default">👤</span>`;

        box.innerHTML = `
            <div class="profile-card">
                <label class="profile-avatar-wrap" title="Кликните, чтобы сменить аватар">
                    <div class="profile-avatar">${avatarHtml}</div>
                    <input type="file" id="profile-avatar-input" accept="image/*" hidden/>
                </label>
                <div class="profile-name" id="profile-name-view" title="Кликните, чтобы поменять ник">
                    ${rolePrefixHtml(user.role_prefix)}${esc(user.display_name)}
                    <span class="profile-name-edit-hint">✏️</span>
                </div>

                <div class="profile-stats">
                    <div class="profile-stat"><b>${stats.added ?? 0}</b><span>Добавлено машин</span></div>
                    <div class="profile-stat"><b>${stats.edited ?? 0}</b><span>Отредактировано машин</span></div>
                </div>

                <div class="edit-sec-h">Достижения</div>
                <div class="achievements-feed">
                    ${achievements.length ? achievements.map(a => `
                        <div class="achievement-card" title="${esc(a.hint || '')}">
                            <div class="achievement-icon">${esc(a.icon || '🏆')}</div>
                            <div class="achievement-title">${esc(a.title)}</div>
                            <div class="achievement-date">${a.unlockedAt ? new Date(a.unlockedAt).toLocaleDateString('ru-RU') : ''}</div>
                        </div>`).join('')
                        : '<div class="search-empty">Пока пусто — достижения появятся здесь</div>'}
                </div>

                <div id="profile-error" class="edit-error hidden"></div>
                <button class="btn btn-sec profile-logout" id="btn-logout">Выйти</button>
            </div>
        `;
        bind();
    }

    function bind() {
        const errBox = document.getElementById('profile-error');
        const showErr = (msg) => { errBox.textContent = msg; errBox.classList.remove('hidden'); };

        const fileInput = document.getElementById('profile-avatar-input');
        fileInput.onchange = async () => {
            const file = fileInput.files[0];
            if (!file) return;
            errBox.classList.add('hidden');
            const fd = new FormData();
            fd.append('avatar', file);
            try {
                const resp = await apiFetch('/api/profile/avatar', { method: 'POST', body: fd, isMultipart: true });
                user = resp.user;
                onUserChanged(user);
                render();
            } catch (err) {
                showErr(err.message);
            }
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

        document.getElementById('btn-logout').onclick = async () => {
            try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch { /* всё равно разлогиниваем локально */ }
            onLogout();
        };
    }
}
