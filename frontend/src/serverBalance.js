// ─────────────────────────────────────────────────────────────────────────────
// Панель «Сервер» в профиле: сколько денег на облачном счёте и на сколько их
// хватит при нынешнем расходе. Данные — /api/server/balance (бэкенд ходит в
// Рег.облако сам, см. backend/src/regcloud/balance.js).
//
// Панель видна всем вошедшим, потому что кончившийся счёт кладёт сайт у всех.
// Отсюда и главная цифра — не баланс, а СРОК: «134,18 ₽» человеку, который не
// платит за сервер, не говорит ничего, а «хватит на 2 дня» говорит.
//
// Панель ДОЗАГРУЖАЕТСЯ, а не задерживает профиль: чужой API живёт своей
// жизнью, и ждать его, чтобы показать аватарку и медали, незачем.
//
// Токена в .env нет (машина разработчика, чужая копия проекта) — панель молча
// исчезает. Пустая панель с прочерками выглядела бы как поломка.
//
// Значки — SVG, как везде на сайте: эмодзи рисует операционная система, в
// каждой по-своему, и подогнать их под строку и под тему нельзя.
// ─────────────────────────────────────────────────────────────────────────────

import { clockIcon } from './icons.js';
import { plural } from './profileLayout.js';

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const rub = (n, digits = 2) => new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
}).format(Number(n) || 0) + ' ₽';

// Порог тревоги — в ДНЯХ, а не в рублях: пополнить счёт можно за минуту, а вот
// заметить проблему нужно заранее. Три дня — это «займись сегодня», неделя —
// «на этой неделе».
const DAYS_ALARM = 3;
const DAYS_WARN  = 7;

// Шкала полосы — две недели. Не «месяц»: на месячной шкале разница между
// двумя днями и четырьмя не видна вовсе, а именно она тут и важна.
const SCALE_DAYS = 14;

function levelOf(days) {
    if (days == null) return 'ok';
    if (days <= DAYS_ALARM) return 'alarm';
    if (days <= DAYS_WARN) return 'warn';
    return 'ok';
}

// «Хватит на 2 дня» — главная строка панели. Меньше суток считаем часами:
// «0 дней» — это не срок, а ошибка отображения.
function lifeLabel({ hoursLeft, daysLeft }) {
    if (hoursLeft == null) return 'Расхода нет — счёт не тратится';
    if (hoursLeft <= 0) return 'Деньги кончились';
    if (hoursLeft < 48) return `Хватит на ${hoursLeft} ${plural(hoursLeft, ['час', 'часа', 'часов'])}`;
    const days = daysLeft ?? Math.floor(hoursLeft / 24);
    return `Хватит на ${days} ${plural(days, ['день', 'дня', 'дней'])}`;
}

// Дату конца считаем от МОМЕНТА ЗАМЕРА, а не от «сейчас»: ответ живёт в кэше
// бэкенда до пяти минут, и от «сейчас» дата ползала бы туда-сюда между
// заходами на страницу.
function runsOutLabel({ checkedAt, hoursLeft }) {
    if (!hoursLeft) return '';
    const base = Date.parse(checkedAt);
    if (!Number.isFinite(base)) return '';
    const end = new Date(base + hoursLeft * 3600_000);
    const date = end.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    const time = end.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return `до ${date}, ${time}`;
}

function itemsHtml(items) {
    if (!Array.isArray(items) || !items.length) return '';
    return `<div class="srv-items">${items.map(it => `
        <div class="srv-item">
            <span class="srv-item-name" title="${esc(it.label)}">${esc(it.label)}</span>
            <span class="srv-item-price">${rub(it.hourly, 2)}/час</span>
        </div>`).join('')}</div>`;
}

export function serverBalanceHtml(data) {
    const days = data.daysLeft;
    const level = levelOf(days);
    // Полоса — это «сколько дней жизни осталось», поэтому и пустеет она вместе
    // с ними: полная — две недели и больше, пустая — сегодня.
    const fill = data.hoursLeft == null
        ? 100
        : Math.max(2, Math.min(100, Math.round((data.hoursLeft / 24) / SCALE_DAYS * 100)));
    const out = runsOutLabel(data);

    return `
        <div class="srv-life srv-${level}">
            <div class="srv-life-head">
                <span class="srv-life-icon">${clockIcon(20)}</span>
                <span class="srv-life-main">${esc(lifeLabel(data))}</span>
                ${out ? `<span class="srv-life-date">${esc(out)}</span>` : ''}
            </div>
            <div class="srv-bar"><span class="srv-bar-fill" style="width:${fill}%"></span></div>
        </div>
        <div class="srv-figures">
            <div class="srv-fig">
                <span class="srv-fig-label">На счёте</span>
                <span class="srv-fig-value">${rub(data.balance)}</span>
            </div>
            ${data.bonus > 0 ? `
            <div class="srv-fig">
                <span class="srv-fig-label">Бонусы</span>
                <span class="srv-fig-value">${rub(data.bonus)}</span>
            </div>` : ''}
            <div class="srv-fig">
                <span class="srv-fig-label">Расход</span>
                <span class="srv-fig-value">${rub(data.hourly, 2)}<span class="srv-fig-unit">/час</span></span>
            </div>
            <div class="srv-fig">
                <span class="srv-fig-label">В месяц</span>
                <span class="srv-fig-value">${rub(data.monthly, 2)}</span>
            </div>
        </div>
        ${itemsHtml(data.items)}
        ${data.stale ? `<div class="srv-stale">Рег.облако не отвечает — цифры на ${esc(
            new Date(data.checkedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))}</div>` : ''}
    `;
}

// Секция рисуется сразу пустой и заполняется, когда приедут данные: так она не
// прыгает по странице (высота панели уже занята), а профиль не ждёт чужой API.
export function serverBalanceSectionBody() {
    return `<div id="srv-body" class="srv-body"><div class="search-empty">Загрузка…</div></div>`;
}

export async function mountServerBalance({ apiFetch, root }) {
    const section = root.querySelector('.profile-sec-server');
    const body = root.querySelector('#srv-body');
    if (!section || !body) return;

    let data;
    try {
        data = await apiFetch('/api/server/balance');
    } catch (e) {
        // Свой бэкенд не ответил — это уже не «нет токена», а поломка, и
        // прятать её нельзя: панель осталась, в ней написано, что случилось.
        body.innerHTML = `<div class="search-empty">Баланс не загрузился: ${esc(e.message)}</div>`;
        return;
    }
    if (!data?.configured) { section.remove(); return; }

    body.innerHTML = serverBalanceHtml(data);
    const meta = section.querySelector('.profile-sec-meta');
    if (meta && data.daysLeft != null && data.daysLeft <= DAYS_ALARM) {
        meta.textContent = 'пора пополнить';
        meta.classList.add('srv-meta-alarm');
    }
}
