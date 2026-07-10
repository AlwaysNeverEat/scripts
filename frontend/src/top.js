// ─────────────────────────────────────────────────────────────────────────────
// Модалка «Топ»: топ пользователей по числу добавленных машин.
// 1-е место переливается золотым (см. .top-row-gold в style.css).
// ─────────────────────────────────────────────────────────────────────────────

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function rolePrefixHtml(rolePrefix) {
    if (!rolePrefix) return '';
    return `<span class="role-prefix role-prefix-${esc(rolePrefix.color)}" title="${esc(rolePrefix.tooltip || '')}">${esc(rolePrefix.label)}</span> `;
}

let bound = false;

export function initTopModal({ apiFetch }) {
    const modal = document.getElementById('top-modal');
    const body = document.getElementById('top-modal-body');
    const btnOpen = document.getElementById('btn-top');
    const btnClose = document.getElementById('top-modal-close');
    const backdrop = document.getElementById('top-modal-backdrop');

    const close = () => modal.classList.add('hidden');

    const open = async () => {
        modal.classList.remove('hidden');
        body.innerHTML = '<div class="search-empty">Загрузка…</div>';
        try {
            const rows = await apiFetch('/api/top');
            render(rows);
        } catch (err) {
            body.innerHTML = `<div class="search-empty">Ошибка: ${esc(err.message)}</div>`;
        }
    };

    function render(rows) {
        if (!rows.length) {
            body.innerHTML = '<div class="search-empty">Пока никто не добавил ни одной машины</div>';
            return;
        }
        body.innerHTML = rows.map((row, i) => {
            const avatarHtml = row.avatar
                ? `<img src="${esc(row.avatar)}" alt=""/>`
                : `<span class="top-avatar-default">👤</span>`;
            return `
                <div class="top-row ${row.rank === 1 ? 'top-row-gold' : ''}" data-top-idx="${i}" title="Открыть профиль">
                    <span class="top-rank">${row.rank}</span>
                    <div class="top-avatar">${avatarHtml}</div>
                    <div class="top-name">${rolePrefixHtml(row.role_prefix)}${esc(row.display_name)}</div>
                    <div class="top-count">${row.added}</div>
                </div>`;
        }).join('');

        body.querySelectorAll('[data-top-idx]').forEach(el => {
            el.onclick = () => {
                const row = rows[parseInt(el.dataset.topIdx, 10)];
                close();
                location.hash = '#/user/' + row.id;
            };
        });
    }

    if (!bound) {
        bound = true;
        btnOpen.onclick = open;
        btnClose.onclick = close;
        backdrop.onclick = close;
    }
}
