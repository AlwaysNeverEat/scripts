// ─────────────────────────────────────────────────────────────────────────────
// Страница профиля: обложка (аватар с загрузкой и обрезкой кроппером, ник по
// клику, статистика) и дальше панели — факультет, достижения, активность,
// инструменты модератора. Разметку обложки и панелей даёт profileLayout.js:
// она общая с чужим профилем (publicProfile.js).
//
// Настройки (оформление устройства и выход из аккаунта) панелями страницы
// больше не являются — они открываются шестерёнкой на обложке отдельным окном
// (profileSettings.js): профиль показывает человека, а не ручки.
// ─────────────────────────────────────────────────────────────────────────────

import { openAvatarCropper } from './avatarCropper.js';
import { openAchievementsModal } from './achievements.js';
import { openAssignCarsModal } from './assignCars.js';
import { activityFeedHtml, attachActivityFeed } from './activityFeed.js';
import { openProfileSettings } from './profileSettings.js';
import { openFxShop } from './profileFx.js';
import { profileHeroHtml, profileSectionHtml } from './profileLayout.js';
import { facultySectionHtml, openFacultyTest } from './faculty.js';
import { namePrefixHtml } from './namePrefix.js';

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
    let activity = null;
    // Распределение грузим отдельным catch: без него профиль показать можно,
    // а вот терять из-за него статистику и медали — нельзя.
    let faculty = null;
    try {
        [stats, achievements, activity, faculty] = await Promise.all([
            apiFetch('/api/profile/stats'),
            apiFetch('/api/profile/achievements'),
            apiFetch('/api/profile/activity'),
            apiFetch('/api/faculty/state').catch(() => null),
        ]);
    } catch { /* покажем то, что есть, без статистики */ }

    render();

    function render() {
        const avatarHtml = user.avatar
            ? `<img src="${esc(user.avatar)}" alt=""/>`
            : `<span class="profile-avatar-default"></span>`;

        const isMod = user.role === 'mod' || user.role === 'admin';

        box.innerHTML = `
            <div class="profile-page">
                ${profileHeroHtml({
                    avatarInner: avatarHtml,
                    nameInner: `${namePrefixHtml(user)}${esc(user.display_name)}`,
                    added: stats.added ?? 0,
                    edited: stats.edited ?? 0,
                    achievements,
                    editable: true,
                    faculty: user.faculty,
                    subtitle: user.login ? '@' + esc(user.login) : '',
                    withSettings: true,
                    fx: user.fx,
                })}
                <input type="file" id="profile-avatar-input" accept="image/*" hidden/>
                <!-- Ошибки аватарки, ника и распределения — одним местом сразу
                     под обложкой: сообщение рядом с местом клика, а не в конце
                     страницы за экраном. -->
                <div id="profile-error" class="edit-error hidden"></div>

                ${profileSectionHtml({
                    title: 'Факультет',
                    meta: faculty?.status === 'done' ? 'закреплён навсегда' : 'распределяющая шляпа',
                    cls: 'profile-sec-faculty',
                    body: facultySectionHtml(faculty),
                })}

                ${profileSectionHtml({
                    title: 'Активность',
                    meta: 'последний год',
                    body: activityFeedHtml(activity),
                })}

                ${isMod ? profileSectionHtml({
                    title: 'Модератор',
                    meta: 'видно только модераторам',
                    cls: 'profile-sec-mod',
                    body: `<button class="btn btn-sec profile-mod-assign" id="btn-self-assign-cars">Записать себе незанятые машины</button>`,
                }) : ''}
            </div>
        `;
        bind();
        // Клик по клетке ленты — окно с записями этого дня (см. activityFeed.js).
        attachActivityFeed(box, { loadDay: date => apiFetch('/api/profile/day/' + date) });
    }

    function bind() {
        const errBox = document.getElementById('profile-error');
        const showErr = (msg) => {
            errBox.textContent = msg;
            errBox.classList.remove('hidden');
            // Блок один на всю страницу: подскролл — чтобы сообщение точно
            // оказалось на экране, из какого бы места ни кликнули.
            errBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        };
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

        const startBtn = document.getElementById('btn-faculty-start');
        if (startBtn) startBtn.onclick = async () => {
            startBtn.disabled = true;
            let state;
            try {
                // Состояние перечитываем перед открытием, а не берём то, что
                // пришло при загрузке страницы: человек мог отвечать с телефона,
                // и начинать надо с его настоящего места, а не с устаревшего.
                state = await apiFetch('/api/faculty/state');
            } catch (err) {
                startBtn.disabled = false;
                showErr(`Не удалось открыть распределение: ${err.message}`);
                return;
            }
            startBtn.disabled = false;
            if (state.status === 'done') { faculty = state; render(); return; }
            openFacultyTest({
                apiFetch,
                state,
                onFinished: async () => {
                    // Факультет закреплён: перечитываем и себя тоже — от него
                    // зависят плашка у ника и подложка профиля.
                    try {
                        const [me, fresh] = await Promise.all([
                            apiFetch('/api/auth/me'),
                            apiFetch('/api/faculty/state'),
                        ]);
                        user = me.user;
                        faculty = fresh;
                        onUserChanged(user);
                    } catch { /* покажем хотя бы карточку из ответа finish */ }
                    render();
                },
            });
        };

        const settingsBtn = document.getElementById('btn-profile-settings');
        if (settingsBtn) settingsBtn.onclick = () => openProfileSettings({ apiFetch, onLogout });

        const shopBtn = document.getElementById('btn-profile-shop');
        if (shopBtn) shopBtn.onclick = () => openFxShop({
            apiFetch,
            fx: user.fx,
            onChanged: (fx) => {
                // Обложка перерисовывается сразу — эффект меряют, глядя на неё.
                user = { ...user, fx };
                onUserChanged(user);
                render();
            },
        });

        const achTile = document.getElementById('profile-ach-tile');
        if (achTile) achTile.onclick = () =>
            openAchievementsModal(achievements, { emptyText: 'Пока пусто — достижения появятся здесь' });

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
    }
}
