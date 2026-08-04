// ─────────────────────────────────────────────────────────────────────────────
// Страница профиля: обложка (аватар с загрузкой и обрезкой кроппером, ник по
// клику, счётчики «добавлено/отредактировано») и дальше панели — достижения,
// активность, инструменты модератора, аккаунт. Разметку обложки и панелей даёт
// profileLayout.js: она общая с чужим профилем (publicProfile.js).
//
// «Выйти» выходит по порядку: сначала бэкенд закрывает сессию в CRM и ждёт от
// неё подтверждения, и только при успехе гасятся сессии сайта — ВСЕ, а не
// только в этом браузере. Иначе второй открытый браузер того же человека
// остался бы работать и первым же запросом поднял сессию CRM заново (учётка
// CRM привязана к аккаунту), то есть выход из CRM был бы фикцией.
//
// Привязку учётки CRM при этом не снимаем — следующий вход на сайт снова
// поднимет сессию CRM сам (снять привязку можно кнопкой «Выйти» в панели CRM).
// ─────────────────────────────────────────────────────────────────────────────

import { openAvatarCropper } from './avatarCropper.js';
import { achievementsFeedHtml, attachFeedParticles } from './achievements.js';
import { openAssignCarsModal } from './assignCars.js';
import { activityFeedHtml, attachActivityFeed } from './activityFeed.js';
import { profileHeroHtml, profileSectionHtml, plural } from './profileLayout.js';

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
    let activity = null;
    try {
        [stats, achievements, activity] = await Promise.all([
            apiFetch('/api/profile/stats'),
            apiFetch('/api/profile/achievements'),
            apiFetch('/api/profile/activity'),
        ]);
    } catch { /* покажем то, что есть, без статистики */ }

    render();

    function render() {
        const avatarHtml = user.avatar
            ? `<img src="${esc(user.avatar)}" alt=""/>`
            : `<span class="profile-avatar-default"></span>`;

        const medals = Array.isArray(achievements) ? achievements.length : 0;
        const isMod = user.role === 'mod' || user.role === 'admin';

        box.innerHTML = `
            <div class="profile-page">
                ${profileHeroHtml({
                    avatarInner: avatarHtml,
                    nameInner: `${rolePrefixHtml(user.role_prefix)}${esc(user.display_name)}`,
                    added: stats.added ?? 0,
                    edited: stats.edited ?? 0,
                    editable: true,
                })}
                <input type="file" id="profile-avatar-input" accept="image/*" hidden/>
                <!-- Ошибки аватарки, ника и выхода — одним местом сразу под
                     обложкой: панелей стало много, и сообщение у нижней кнопки
                     после клика по аватарке осталось бы за экраном. -->
                <div id="profile-error" class="edit-error hidden"></div>

                ${profileSectionHtml({
                    title: 'Достижения',
                    meta: medals ? `${medals} ${plural(medals, ['медаль', 'медали', 'медалей'])}` : '',
                    body: `<div class="achievements-feed">
                        ${achievementsFeedHtml(achievements, 'Пока пусто — достижения появятся здесь')}
                    </div>`,
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

                ${profileSectionHtml({
                    title: 'Аккаунт',
                    body: `
                        <button class="btn btn-sec profile-logout" id="btn-logout">Выйти</button>
                        <!-- появляется только если CRM не подтвердила закрытие сессии -->
                        <button class="btn btn-sec profile-logout-force hidden" id="btn-logout-force">Всё равно выйти из аккаунта</button>
                        <div class="profile-logout-hint">Выход закрывает сессию CRM и все сессии сайта — на всех устройствах.</div>`,
                })}
            </div>
        `;
        bind();
        attachFeedParticles(box);
        attachActivityFeed(box);
    }

    function bind() {
        const errBox = document.getElementById('profile-error');
        const showErr = (msg) => {
            errBox.textContent = msg;
            errBox.classList.remove('hidden');
            // Ошибку выхода показываем в блоке под обложкой, а сама кнопка —
            // в нижней панели: без подскролла сообщение осталось бы за экраном.
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

        // Выход: CRM → аккаунт сайта. Порядок именно такой, и второй шаг
        // делается только после подтверждения первого.
        const logoutBtn = document.getElementById('btn-logout');
        const forceBtn = document.getElementById('btn-logout-force');

        async function dropSiteSession() {
            try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch { /* всё равно разлогиниваем локально */ }
            onLogout();
        }

        logoutBtn.onclick = async () => {
            errBox.classList.add('hidden');
            forceBtn.classList.add('hidden');
            logoutBtn.disabled = true;
            logoutBtn.textContent = 'Закрываю сессию CRM…';
            try {
                // Привязку не снимаем: unlink не передаём.
                await apiFetch('/api/crm/logout', { method: 'POST', body: {} });
            } catch (err) {
                logoutBtn.disabled = false;
                logoutBtn.textContent = 'Выйти';
                showErr(err.code === 'crm_logout_failed'
                    ? 'CRM не подтвердила, что сессия закрыта — из аккаунта не выходим. Попробуй ещё раз.'
                    : `Не удалось закрыть сессию CRM: ${err.message}. Из аккаунта не выходим — попробуй ещё раз.`);
                // Если CRM недоступна надолго, из аккаунта всё-таки надо уметь
                // выйти — но это осознанное решение человека, а не молчаливый
                // обход проверки.
                forceBtn.classList.remove('hidden');
                return;
            }
            logoutBtn.textContent = 'Выхожу на всех устройствах…';
            await dropSiteSession();
        };

        forceBtn.onclick = () => dropSiteSession();
    }
}
