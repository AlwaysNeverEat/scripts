// ─────────────────────────────────────────────────────────────────────────────
// Гейт входа/регистрации: без валидной сессии на сайте не видно ничего, кроме
// этой формы. Логин — POST /api/auth/login, заявка на регистрацию —
// POST /api/auth/register (уходит в Telegram, ответ на сайте не логинит).
// ─────────────────────────────────────────────────────────────────────────────

let bound = false;

export function initAuthGate({ apiFetch, onLoggedIn, message }) {
    const loginForm = document.getElementById('auth-login-form');
    const regForm = document.getElementById('auth-register-form');
    const loginErr = document.getElementById('auth-login-error');
    const regErr = document.getElementById('auth-reg-error');
    const regSuccess = document.getElementById('auth-reg-success');

    const showLogin = () => {
        regForm.classList.add('hidden');
        loginForm.classList.remove('hidden');
    };
    const showRegister = () => {
        loginForm.classList.add('hidden');
        regErr.classList.add('hidden');
        regSuccess.classList.add('hidden');
        regForm.classList.remove('hidden');
    };

    if (message) {
        loginErr.textContent = message;
        loginErr.classList.remove('hidden');
    } else {
        loginErr.classList.add('hidden');
    }
    showLogin();

    if (bound) return; // статичные элементы index.html — обработчики вешаем один раз
    bound = true;

    document.getElementById('auth-show-register').onclick = showRegister;
    document.getElementById('auth-show-login').onclick = showLogin;

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginErr.classList.add('hidden');
        const login = document.getElementById('auth-login-login').value.trim();
        const password = document.getElementById('auth-login-password').value;
        const btn = document.getElementById('auth-login-submit');
        btn.disabled = true;
        btn.textContent = 'Входим…';
        try {
            const resp = await apiFetch('/api/auth/login', { method: 'POST', body: { login, password } });
            document.getElementById('auth-login-password').value = '';
            onLoggedIn(resp.user, resp.token);
        } catch (err) {
            loginErr.textContent = err.message;
            loginErr.classList.remove('hidden');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Войти';
        }
    });

    regForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        regErr.classList.add('hidden');
        regSuccess.classList.add('hidden');
        const display_name = document.getElementById('auth-reg-name').value.trim();
        const login = document.getElementById('auth-reg-login').value.trim();
        const password = document.getElementById('auth-reg-password').value;
        const btn = document.getElementById('auth-reg-submit');
        btn.disabled = true;
        btn.textContent = 'Отправляем…';
        try {
            await apiFetch('/api/auth/register', { method: 'POST', body: { display_name, login, password } });
            regForm.reset();
            regSuccess.textContent = '✅ Заявка отправлена! Администратор получит её в Telegram — заявка живёт 30 минут.';
            regSuccess.classList.remove('hidden');
        } catch (err) {
            regErr.textContent = err.message;
            regErr.classList.remove('hidden');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Отправить заявку';
        }
    });
}
