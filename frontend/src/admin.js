// ─────────────────────────────────────────────────────────────────────────────
// Вкладка «Админка»: заявки на регистрацию и управление пользователями.
//
// Появилась потому, что одобрять регистрации стало нечем: сервер переехал в РФ,
// оттуда api.telegram.org не отвечает (ConnectTimeoutError на 443), и бот с его
// кнопками Accept/Decline замолчал. Заявки при этом продолжают копиться в БД.
//
// Вкладку показываем только mod/admin, но это удобство, а не защита: роль
// проверяет сервер (requireRole в backend/src/routes/admin.js и users.js).
// Спрятать кнопку в браузере может кто угодно.
//
// Ошибки показываем текстом, который вернул сервер: «заявка просрочена — она
// живёт 30 минут» объясняет, что делать, а «что-то пошло не так» — нет.
// ─────────────────────────────────────────────────────────────────────────────

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function rolePrefixHtml(rolePrefix) {
    if (!rolePrefix) return '';
    return `<span class="role-prefix role-prefix-${esc(rolePrefix.color)}" title="${esc(rolePrefix.tooltip || '')}">${esc(rolePrefix.label)}</span> `;
}

export function isModerator(user) {
    return !!user && (user.role === 'mod' || user.role === 'admin');
}

// «5 мин назад» вместо «02.08.2026, 14:31»: у заявки жизнь 30 минут, и в этом
// масштабе важно не когда её подали, а сколько она уже висит.
function agoLabel(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const min = Math.floor((Date.now() - t) / 60000);
    if (min < 1) return 'только что';
    if (min < 60) return `${min} мин назад`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `${hours} ч назад`;
    return new Date(t).toLocaleDateString('ru-RU');
}

function dateLabel(iso) {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? new Date(t).toLocaleDateString('ru-RU') : '';
}

const REQUEST_STATUS = {
    pending:  'ждёт решения',
    accepted: 'одобрена',
    declined: 'отклонена',
    expired:  'просрочена',
};

function requestRowHtml(reqRow, idx) {
    const pending = reqRow.status === 'pending';
    const actions = pending
        ? `<button class="btn btn-pri btn-mini" data-req-accept="${idx}">Одобрить</button>
           <button class="btn btn-sec btn-danger btn-mini" data-req-decline="${idx}">Отклонить</button>`
        : `<span class="admin-status">${esc(REQUEST_STATUS[reqRow.status] || reqRow.status)}</span>`;
    return `
        <div class="admin-row${pending ? '' : ' admin-row-done'}">
            <div class="admin-main">
                <div class="admin-name">${esc(reqRow.display_name)}</div>
                <div class="admin-sub">@${esc(reqRow.login)} · подана ${esc(agoLabel(reqRow.created_at))}</div>
            </div>
            <div class="admin-actions">${actions}</div>
        </div>`;
}

function userRowHtml(row, idx, viewer) {
    const self = row.id === viewer.id;
    // Те же замки, что и на сервере, — чтобы кнопка не предлагала заведомо
    // отказной запрос. Правило про admin взято из бота (nextRoleForToggle):
    // защищённая роль, её не выдают и не снимают ниоткуда, кроме БД.
    const canRole = !self && row.role !== 'admin';
    const canBan = !self && row.role !== 'admin' && (row.role !== 'mod' || viewer.role === 'admin');
    const roleLabel = row.role === 'mod' ? 'Снять модератора' : 'Сделать модератором';

    const actions = [
        canRole ? `<button class="btn btn-sec btn-mini" data-user-role="${idx}">${roleLabel}</button>` : '',
        canBan ? `<button class="btn btn-sec btn-mini${row.banned ? '' : ' btn-danger'}" data-user-ban="${idx}">${
            row.banned ? 'Разбанить' : 'Забанить'
        }</button>` : '',
        self ? '<span class="admin-status">это вы</span>' : '',
        !self && row.role === 'admin' ? '<span class="admin-status">админ, только через БД</span>' : '',
    ].join('');

    return `
        <div class="admin-row">
            <div class="admin-main">
                <div class="admin-name">${rolePrefixHtml(row.role_prefix)}${esc(row.display_name)}${
                    row.banned ? '<span class="admin-banned">заблокирован</span>' : ''
                }</div>
                <div class="admin-sub">@${esc(row.login)} · ${esc(row.role)} · с ${esc(dateLabel(row.created_at))}</div>
            </div>
            <div class="admin-actions">${actions}</div>
        </div>`;
}

// Строка поиска не пересобирается вместе со списком: перерисовка после каждого
// действия иначе сбрасывала бы фокус и набранный запрос.
let userQuery = '';

export async function initAdminPage({ apiFetch, user }) {
    const box = document.getElementById('admin-body');
    if (!box) return;

    // Плашка ошибки — своя у каждого блока, а не одна общая сверху: список
    // пользователей длинный, и ошибка от кнопки в его конце уехала бы за экран.
    box.innerHTML = `
        <div class="admin-sec">
            <div class="edit-sec-h">Заявки на регистрацию</div>
            <div class="admin-error edit-error hidden"></div>
            <div id="admin-requests" class="admin-list"><div class="search-empty">Загрузка…</div></div>
        </div>
        <div class="admin-sec">
            <div class="edit-sec-h">Пользователи</div>
            <div class="admin-error edit-error hidden"></div>
            <div class="admin-search">
                <input id="admin-user-q" type="search" placeholder="Имя или логин…" autocomplete="off" value="${esc(userQuery)}"/>
            </div>
            <div id="admin-users" class="admin-list"><div class="search-empty">Загрузка…</div></div>
        </div>
    `;

    const requestsBox = document.getElementById('admin-requests');
    const usersBox = document.getElementById('admin-users');
    const searchInput = document.getElementById('admin-user-q');

    const errBoxOf = (el) => el.closest('.admin-sec').querySelector('.admin-error');

    // Действие → перезагрузка того же списка. Кнопки на время запроса гасим:
    // второй клик по «Одобрить» иначе получил бы «заявка уже одобрена».
    //
    // Текст ошибки берём как есть от сервера: он объясняет, что именно не так
    // («заявка просрочена — она живёт 30 минут», «модератора может забанить
    // только администратор»), и по нему видно, что делать дальше.
    async function run(btn, fn, reload) {
        const errBox = errBoxOf(btn);
        errBox.classList.add('hidden');
        const group = btn.closest('.admin-actions');
        group.querySelectorAll('button').forEach(b => { b.disabled = true; });
        try {
            await fn();
            await reload();
        } catch (e) {
            errBox.textContent = e.message;
            errBox.classList.remove('hidden');
            group.querySelectorAll('button').forEach(b => { b.disabled = false; });
        }
    }

    async function loadRequests() {
        let data;
        try {
            data = await apiFetch('/api/admin/requests');
        } catch (e) {
            requestsBox.innerHTML = `<div class="search-empty">Не удалось загрузить заявки: ${esc(e.message)}</div>`;
            return;
        }
        const rows = data.requests || [];
        requestsBox.innerHTML = rows.length
            ? rows.map(requestRowHtml).join('')
            : '<div class="search-empty">Новых заявок нет</div>';

        requestsBox.querySelectorAll('[data-req-accept]').forEach(btn => {
            const row = rows[Number(btn.dataset.reqAccept)];
            btn.onclick = () => run(
                btn,
                () => apiFetch(`/api/admin/requests/${row.id}/accept`, { method: 'POST' }),
                // Одобренная заявка — это новый пользователь, список рядом
                // обязан это показать сразу.
                () => Promise.all([loadRequests(), loadUsers()]),
            );
        });
        requestsBox.querySelectorAll('[data-req-decline]').forEach(btn => {
            const row = rows[Number(btn.dataset.reqDecline)];
            btn.onclick = () => {
                if (!confirm(`Отклонить заявку от ${row.display_name} (@${row.login})?`)) return;
                run(btn, () => apiFetch(`/api/admin/requests/${row.id}/decline`, { method: 'POST' }), loadRequests);
            };
        });
    }

    async function loadUsers() {
        const q = userQuery.trim();
        let rows;
        try {
            rows = await apiFetch('/api/users?limit=200' + (q ? '&q=' + encodeURIComponent(q) : ''));
        } catch (e) {
            usersBox.innerHTML = `<div class="search-empty">Не удалось загрузить пользователей: ${esc(e.message)}</div>`;
            return;
        }
        usersBox.innerHTML = rows.length
            ? rows.map((row, i) => userRowHtml(row, i, user)).join('')
            : '<div class="search-empty">Никого не нашлось</div>';

        usersBox.querySelectorAll('[data-user-role]').forEach(btn => {
            const row = rows[Number(btn.dataset.userRole)];
            const next = row.role === 'mod' ? 'user' : 'mod';
            btn.onclick = () => {
                const ask = next === 'mod'
                    ? `Сделать ${row.display_name} модератором?`
                    : `Снять с ${row.display_name} права модератора?`;
                if (!confirm(ask)) return;
                run(btn, () => apiFetch(`/api/users/${row.id}/role`, { method: 'PATCH', body: { role: next } }), loadUsers);
            };
        });
        usersBox.querySelectorAll('[data-user-ban]').forEach(btn => {
            const row = rows[Number(btn.dataset.userBan)];
            const banned = !row.banned;
            btn.onclick = () => {
                const ask = banned
                    ? `Забанить ${row.display_name}? Он будет разлогинен и не сможет войти.`
                    : `Разбанить ${row.display_name}?`;
                if (!confirm(ask)) return;
                run(btn, () => apiFetch(`/api/users/${row.id}/ban`, { method: 'POST', body: { banned } }), loadUsers);
            };
        });
    }

    let searchTimer = 0;
    searchInput.oninput = () => {
        userQuery = searchInput.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(loadUsers, 250);
    };

    await Promise.all([loadRequests(), loadUsers()]);
}
