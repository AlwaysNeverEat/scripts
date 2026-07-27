// ─────────────────────────────────────────────────────────────────────────────
// Вкладка «Топ»: рейтинг по числу СДЕЛАННЫХ ЗАПИСЕЙ за текущий месяц.
// 1-е место переливается золотым (см. .top-row-gold в style.css).
//
// Месяц закрывается сам: 1-го числа список начинается с нуля, а над ним
// остаётся карточка «Топ в прошлом месяце» — кто был первым к концу месяца
// (данные считает backend/src/routes/top.js). Одна запись = один балл,
// длинная (продлённая) запись — тоже один.
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

// «1 запись / 2 записи / 5 записей»
function recordsWord(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'запись';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'записи';
    return 'записей';
}

// 'YYYY-MM' → «июль 2026»
function monthLabel(month) {
    const m = String(month || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return '';
    const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
    return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '');
}

// Правая колонка: крупно число записей, под ним слово с правильным окончанием.
function countHtml(row) {
    return `
        <div class="top-count">
            <span class="top-score">${row.records}</span>
            <span class="top-breakdown">${recordsWord(row.records)}</span>
        </div>`;
}

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

// Карточка над списком: победитель(и) прошлого месяца. Если в прошлом месяце
// записей не делали вовсе — карточки нет, незачем занимать экран пустотой.
function previousHtml(previous) {
    const winners = previous?.winners || [];
    if (!winners.length) return '';
    const label = monthLabel(previous.month);
    const names = winners.map((w, i) => `
        <div class="top-prev-user" data-prev-idx="${i}" title="Открыть профиль">
            <div class="top-avatar">${avatarHtml(w)}</div>
            <div class="top-prev-name">${rolePrefixHtml(w.role_prefix)}${esc(w.display_name)}</div>
            <span class="top-prev-count">${w.records}&nbsp;${recordsWord(w.records)}</span>
        </div>`).join('');
    return `
        <div class="top-prev">
            <div class="top-prev-head">🏆 Топ в прошлом месяце${label ? ` · ${esc(label)}` : ''}</div>
            ${names}
        </div>`;
}

function render(body, data) {
    const rows = data.rows || [];
    const previous = data.previous || null;
    const label = monthLabel(data.month);

    const listHtml = rows.length
        ? rows.map((row, i) => `
            <div class="top-row ${row.rank === 1 ? 'top-row-gold' : ''}" data-top-idx="${i}" title="Открыть профиль">
                <span class="top-rank">${row.rank}</span>
                <div class="top-avatar">${avatarHtml(row)}</div>
                <div class="top-name">${rolePrefixHtml(row.role_prefix)}${esc(row.display_name)}</div>
                ${countHtml(row)}
            </div>`).join('')
        : '<div class="search-empty">В этом месяце записей ещё никто не сделал</div>';

    body.innerHTML = previousHtml(previous)
        + (label ? `<div class="top-month">${esc(label)}</div>` : '')
        + listHtml;

    body.querySelectorAll('[data-top-idx]').forEach(el => {
        el.onclick = () => {
            const row = rows[parseInt(el.dataset.topIdx, 10)];
            location.hash = '#/user/' + row.id;
        };
    });

    body.querySelectorAll('[data-prev-idx]').forEach(el => {
        el.onclick = () => {
            const w = previous.winners[parseInt(el.dataset.prevIdx, 10)];
            location.hash = '#/user/' + w.id;
        };
    });
}
