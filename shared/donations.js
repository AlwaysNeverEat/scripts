// ─────────────────────────────────────────────────────────────────────────────
// Поддержавшие проект — правила, общие для сервера и окна.
//
// Донаты идут на сервер, на котором живёт сайт. Сайт их НЕ принимает: деньги
// переводят как переводят, а на сайт их вносит руками один человек (тот, кто
// платит за сервер) — датой и суммой. Отсюда две вещи:
//   • вносить может ровно один аккаунт (DONATION_ADMIN_LOGIN), а не роль: это
//     не модерация, а бухгалтерия одного кошелька;
//   • запись — это ФАКТ ПОПОЛНЕНИЯ (кто, когда, сколько), и хранится она
//     навсегда: «за месяц» и «всего» считаются из этих строк, а не копятся
//     счётчиком, который однажды разойдётся с реальностью.
//
// Хранение — backend/src/donations/store.js, панель справа —
// frontend/src/donorsPanel.js, окно внесения — frontend/src/donorsAdmin.js.
// ─────────────────────────────────────────────────────────────────────────────

export const DONATION_ADMIN_LOGIN = 'gtrixoff';

// Потолок одного пополнения — защита от лишнего нуля, а не от щедрости.
export const AMOUNT_MAX = 1_000_000;
// Раньше этой даты сайта не было — дата до неё означает опечатку в годе.
export const DATE_MIN = '2024-01-01';

export function isDonationAdmin(user) {
    return String(user?.login || '').trim().toLowerCase() === DONATION_ADMIN_LOGIN;
}

// Сегодня по Москве — 'YYYY-MM-DD'. Месяц «этот» — тоже московский: внесли
// пополнение в 23:30 последнего числа — оно должно попасть в тот же месяц,
// что видит человек на календаре, а не в следующий по UTC.
export function mskToday(now = Date.now()) {
    return new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
}

export const monthOf = (date) => String(date || '').slice(0, 7);

const MONTHS = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне',
    'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
// '2026-10' → 'в октябре' (подпись колонки «за месяц»).
export function monthLabel(month) {
    const m = Number(String(month || '').slice(5, 7));
    return MONTHS[m - 1] ? `в ${MONTHS[m - 1]}` : 'в этом месяце';
}

function validDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Сумма — целые рубли. Принимает «1 500», «1500», «1500 ₽», «1500,00».
export function parseAmount(raw) {
    const s = String(raw ?? '').replace(/[\s ₽]/g, '').replace(/(руб|р)\.?$/i, '').replace(/[.,]00$/, '');
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    return Number.isSafeInteger(n) ? n : null;
}

/**
 * Проверить пополнение перед записью.
 * @returns {{ donation: { userId, date, amount } } | { error: string }}
 */
export function cleanDonation(raw, now = Date.now()) {
    const userId = String(raw?.userId || '').trim();
    if (!userId) return { error: 'не выбран человек' };
    const date = String(raw?.date || '').trim();
    if (!validDate(date)) return { error: 'дата — в виде ГГГГ-ММ-ДД' };
    if (date < DATE_MIN) return { error: 'дата раньше, чем появился сайт, — опечатка в годе?' };
    if (date > mskToday(now)) return { error: 'дата в будущем' };
    const amount = parseAmount(raw?.amount);
    if (!amount || amount < 1) return { error: 'сумма — целое число рублей больше нуля' };
    if (amount > AMOUNT_MAX) return { error: `больше ${AMOUNT_MAX.toLocaleString('ru-RU')} ₽ за раз — проверьте нули` };
    return { donation: { userId, date, amount } };
}

// Порядок в панели: кто дал больше ВСЕГО — выше. При равенстве выше тот, кто
// больше дал в этом месяце, потом — кто пополнял позже. Сортирует и сервер
// (SQL), и песочница; правило одно, и стережёт его тест.
export function sortDonors(list) {
    return [...list].sort((a, b) => (b.total - a.total)
        || (b.month - a.month)
        || String(b.last || '').localeCompare(String(a.last || '')));
}

// 1500 → '1 500 ₽'.
export function rub(n) {
    return `${Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/ /g, ' ')} ₽`;
}
