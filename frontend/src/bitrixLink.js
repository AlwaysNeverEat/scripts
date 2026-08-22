// ─────────────────────────────────────────────────────────────────────────────
// Привязка учётки Битрикса в профиле.
//
// Пока это единственное место, где Битрикс виден на сайте: панель звонка и
// лента обращений будут отдельно. Смысл секции — один раз ввести логин и
// пароль, чтобы дальше сайт входил в портал сам (backend/src/bitrix/client.js).
//
// Почему форма именно тут, а не в панели звонка: привязку делают ОДИН РАЗ и
// заранее, а панель открывается посреди разговора — просить логин в этот
// момент поздно.
//
// Отдельно предупреждаем про капчу. Битрикс включает её после нескольких
// неудачных попыток, и тогда встанет вход не только у сайта, но и у живого
// человека в браузере. Поэтому после ошибки форма НЕ предлагает «попробовать
// ещё раз» бодрой кнопкой, а прямо говорит, чем это грозит.
// ─────────────────────────────────────────────────────────────────────────────

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function bitrixSectionHtml() {
    return `
        <div id="bitrix-link" class="bitrix-link">
            <div class="bitrix-link-state">проверяю связь с Битриксом…</div>
        </div>`;
}

export function attachBitrixSection({ apiFetch }) {
    const root = document.getElementById('bitrix-link');
    if (!root) return;

    const state = {
        loading: true,
        loggedIn: false,
        login: null,
        canLink: true,
        note: '',
        error: null,
        busy: false,
    };

    function render() {
        if (state.loading) {
            root.innerHTML = '<div class="bitrix-link-state">проверяю связь с Битриксом…</div>';
            return;
        }

        const rows = [];

        if (state.loggedIn) {
            rows.push(`<div class="bitrix-link-state bitrix-link-ok">
                Связь есть${state.login ? ` — ${esc(state.login)}` : ''}
            </div>`);
            rows.push('<button class="btn btn-sec" id="bitrix-unlink">Отвязать учётку</button>');
        } else {
            if (state.note) rows.push(`<div class="bitrix-link-note">${esc(state.note)}</div>`);
            rows.push(`
                <form id="bitrix-form" class="crm-login-form" autocomplete="off">
                    <input type="text" id="bitrix-login" class="crm-input" placeholder="почта Битрикса"
                           autocomplete="username" value="${esc(state.login || '')}" ${state.busy ? 'disabled' : ''}/>
                    <input type="password" id="bitrix-password" class="crm-input" placeholder="пароль"
                           autocomplete="current-password" ${state.busy ? 'disabled' : ''}/>
                    <button class="btn" type="submit" ${state.busy ? 'disabled' : ''}>
                        ${state.busy ? 'вхожу…' : 'Привязать'}
                    </button>
                </form>`);
        }

        if (state.error) rows.push(`<div class="edit-error">${esc(state.error)}</div>`);

        rows.push(`<div class="profile-logout-hint">
            Пароль вводится один раз и хранится зашифрованным. Вводи его внимательно:
            после нескольких неудачных попыток Битрикс включает капчу, и тогда вход
            встанет не только у сайта, но и у тебя в браузере.
        </div>`);

        root.innerHTML = rows.join('');
        bind();
    }

    function bind() {
        const form = root.querySelector('#bitrix-form');
        if (form) {
            form.onsubmit = async (e) => {
                e.preventDefault();
                const login = root.querySelector('#bitrix-login').value.trim();
                const password = root.querySelector('#bitrix-password').value;
                if (!login || !password) return;
                state.busy = true;
                state.error = null;
                render();
                try {
                    await apiFetch('/api/bitrix/login', { method: 'POST', body: { login, password } });
                    state.loggedIn = true;
                    state.login = login;
                    state.note = '';
                } catch (err) {
                    state.error = err.message || 'не удалось войти';
                }
                state.busy = false;
                render();
            };
        }

        const unlink = root.querySelector('#bitrix-unlink');
        if (unlink) {
            unlink.onclick = async () => {
                unlink.disabled = true;
                try {
                    await apiFetch('/api/bitrix/logout', { method: 'POST', body: { unlink: true } });
                    state.loggedIn = false;
                    state.login = null;
                } catch (err) {
                    state.error = err.message || 'не удалось отвязать';
                }
                render();
            };
        }
    }

    (async () => {
        try {
            const st = await apiFetch('/api/bitrix/status');
            state.loggedIn = Boolean(st.loggedIn);
            state.login = st.login || null;
            state.canLink = st.canLink !== false;
            // Причину неудачного автовхода показываем словами: «не вошли» без
            // объяснения выглядит как поломка сайта, а чаще это сменившийся
            // пароль.
            state.note = st.loggedIn ? '' : (st.message || '');
        } catch (err) {
            state.error = err.message || 'Битрикс не отвечает';
        }
        state.loading = false;
        render();
    })();
}
