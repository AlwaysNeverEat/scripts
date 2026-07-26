// ─────────────────────────────────────────────────────────────────────────────
// Вкладка «Топ»: рейтинг пользователей по сумме (добавленные машины +
// отредактированные машины). 1-е место переливается золотым (см. .top-row-gold
// в style.css). Служебный аккаунт (gtrixoff) идёт отдельной серой строкой внизу
// вне рейтинга — машины он залил автоимпортом (см. backend/src/routes/top.js).
//
// Последний ответ держим в кеше: возврат на вкладку показывает готовый список
// сразу, а свежие цифры доезжают фоном и подменяют его без «Загрузка…».
// ─────────────────────────────────────────────────────────────────────────────

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function rolePrefixHtml(rolePrefix) {
    if (!rolePrefix) return '';
    return `<span class="role-prefix role-prefix-${esc(rolePrefix.color)}" title="${esc(rolePrefix.tooltip || '')}">${esc(rolePrefix.label)}</span> `;
}

function avatarHtml(row) {
    return row.avatar
        ? `<img src="${esc(row.avatar)}" alt=""/>`
        : `<span class="top-avatar-default"></span>`;
}

// Правая колонка: крупно сумма (число машин + записи), под ней разбивка
// «добавлено + отредактировано».
function countHtml(row) {
    return `
        <div class="top-count">
            <span class="top-score">${row.score}</span>
            <span class="top-breakdown" title="добавлено машин + отредактировано машин">${row.added} + ${row.edited}</span>
        </div>`;
}

const AUTO_IMPORT_NOTE = 'Все эти машины я добавил автоматически по этому не учитываюсь в топе';

let cache = null;   // последний успешный ответ /api/top

export function resetTopCache() { cache = null; }

export async function showTopPage({ apiFetch }) {
    const body = document.getElementById('top-body');
    if (!body) return;

    if (cache) render(body, cache);
    else body.innerHTML = '<div class="search-empty">Загрузка…</div>';

    try {
        cache = await apiFetch('/api/top');
    } catch (err) {
        if (!cache) body.innerHTML = `<div class="search-empty">Ошибка: ${esc(err.message)}</div>`;
        return; // есть кеш — оставляем его на экране
    }
    // Пока ходили на сервер, могли уйти на другую вкладку — рисуем всё равно:
    // страница скрыта, но при возврате будет уже свежей.
    render(body, cache);
}

function render(body, data) {
    // Бэкенд теперь отдаёт { rows, excluded }; на всякий случай переживаем и
    // старую форму (голый массив), если ответ пришёл из кэша прод-версии.
    const rows = Array.isArray(data) ? data : (data.rows || []);
    const excluded = Array.isArray(data) ? null : data.excluded;

    if (!rows.length && !excluded) {
        body.innerHTML = '<div class="search-empty">Пока никто не добавил ни одной машины</div>';
        return;
    }

    const rankedHtml = rows.map((row, i) => `
        <div class="top-row ${row.rank === 1 ? 'top-row-gold' : ''}" data-top-idx="${i}" title="Открыть профиль">
            <span class="top-rank">${row.rank}</span>
            <div class="top-avatar">${avatarHtml(row)}</div>
            <div class="top-name">${rolePrefixHtml(row.role_prefix)}${esc(row.display_name)}</div>
            ${countHtml(row)}
        </div>`).join('');

    // Служебная строка внизу: серая, без места, с «?»-подсказкой сбоку.
    const excludedHtml = excluded ? `
        <div class="top-row top-row-muted" data-excluded-idx="0" title="Открыть профиль">
            <span class="top-rank"></span>
            <div class="top-avatar">${avatarHtml(excluded)}</div>
            <div class="top-name">
                ${rolePrefixHtml(excluded.role_prefix)}${esc(excluded.display_name)}
                <span class="top-help" tabindex="0" aria-label="${esc(AUTO_IMPORT_NOTE)}">?<span class="top-help-pop">${esc(AUTO_IMPORT_NOTE)}</span></span>
            </div>
            ${countHtml(excluded)}
        </div>` : '';

    body.innerHTML = rankedHtml + excludedHtml;

    body.querySelectorAll('[data-top-idx]').forEach(el => {
        el.onclick = () => {
            const row = rows[parseInt(el.dataset.topIdx, 10)];
            location.hash = '#/user/' + row.id;
        };
    });

    const exEl = body.querySelector('[data-excluded-idx]');
    if (exEl && excluded) {
        exEl.onclick = (e) => {
            // клик по «?» — это про подсказку, а не навигацию
            if (e.target.closest('.top-help')) return;
            location.hash = '#/user/' + excluded.id;
        };
    }
}
