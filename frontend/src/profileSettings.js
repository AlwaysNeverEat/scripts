// ─────────────────────────────────────────────────────────────────────────────
// Окно «Настройки» — открывается шестерёнкой на обложке СВОЕГО профиля.
//
// Сюда вынесено всё, что человек КРУТИТ, а не смотрит: оформление (фон главной
// и акцентный цвет — обе ручки живут в localStorage, то есть на устройстве) и
// выход из аккаунта. Раньше это были две панели в самом профиле, и страница
// «кто я и что я сделал» наполовину состояла из ползунков и кнопки «Выйти»;
// профиль показывает человека, настройки — отдельная работа.
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

import { accentPickerHtml, bindAccentPicker } from './accent.js';
import { backgroundPickerHtml, bindBackgroundPicker } from './background.js';

const MODAL_ID = 'profile-settings-modal';

export function openProfileSettings({ apiFetch, onLogout }) {
    document.getElementById(MODAL_ID)?.remove();

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-backdrop"></div>
        <div class="modal-win profile-settings-win">
            <div class="modal-head">
                <span>Настройки</span>
                <button class="btn btn-sec" id="pset-close">✕</button>
            </div>
            <div class="modal-body profile-settings-body">
                <div class="pset-group">
                    <div class="pset-head">
                        <span class="pset-title">Оформление</span>
                        <span class="pset-meta">только на этом устройстве</span>
                    </div>
                    ${backgroundPickerHtml()}
                    ${accentPickerHtml()}
                </div>
                <div class="pset-group">
                    <div class="pset-head">
                        <span class="pset-title">Аккаунт</span>
                    </div>
                    <button class="btn btn-sec profile-logout" id="pset-logout">Выйти</button>
                    <!-- появляется только если CRM не подтвердила закрытие сессии -->
                    <button class="btn btn-sec profile-logout-force hidden" id="pset-logout-force">Всё равно выйти из аккаунта</button>
                    <div class="profile-logout-hint">Выход закрывает сессию CRM и все сессии сайта — на всех устройствах.</div>
                    <div id="pset-error" class="edit-error hidden"></div>
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('.modal-backdrop').onclick = close;
    modal.querySelector('#pset-close').onclick = close;

    bindBackgroundPicker(modal);
    bindAccentPicker(modal);

    const errBox = modal.querySelector('#pset-error');
    const showErr = (msg) => {
        errBox.textContent = msg;
        errBox.classList.remove('hidden');
    };

    // Выход: CRM → аккаунт сайта. Порядок именно такой, и второй шаг
    // делается только после подтверждения первого.
    const logoutBtn = modal.querySelector('#pset-logout');
    const forceBtn = modal.querySelector('#pset-logout-force');

    async function dropSiteSession() {
        try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch { /* всё равно разлогиниваем локально */ }
        close();
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
