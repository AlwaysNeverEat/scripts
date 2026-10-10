// ─────────────────────────────────────────────────────────────────────────────
// Счёт сервера и «сколько ему осталось жить» — правила, общие для сервера и
// панели «Поддержали проект».
//
// Источник — API Рег.облака, `GET https://api.cloudvps.reg.ru/v1/balance_data`
// (developers.cloudvps.reg.ru/billing/balance.html): баланс, бонусы, расход в
// час и в месяц и готовое `hours_left`. По примеру из документации
// `hours_left` = (баланс + бонусы) / расход в час — то есть бонусы в «осталось»
// уже сидят, и пересчитывать его самим незачем. Сами считаем только когда
// поля нет.
//
// Живьём ответ не снимался — разбор терпит строки вместо чисел, пустые поля и
// висящую запятую (она есть в примере самой документации).
// ─────────────────────────────────────────────────────────────────────────────

const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};

// Текст ответа → объект. Строгий JSON.parse сперва; не вышло — убираем висящие
// запятые перед } и ] и пробуем ещё раз.
export function parseJsonLoose(text) {
    try { return JSON.parse(text); } catch { /* ниже */ }
    try { return JSON.parse(String(text).replace(/,\s*([}\]])/g, '$1')); } catch { return null; }
}

/**
 * Ответ balance_data → то, что нужно панели. Детализацию по ресурсам не берём:
 * панели она не нужна, а имена серверов и тарифы наружу незачем.
 * @returns {{ balance, bonus, hourlyCost, monthlyCost, hoursLeft } | null}
 */
export function parseBalanceData(json) {
    const d = json?.balance_data;
    if (!d || typeof d !== 'object') return null;
    const balance = num(d.balance);
    const bonus = num(d.bonus_balance) ?? 0;
    const hourlyCost = num(d.hourly_cost);
    const monthlyCost = num(d.monthly_cost);
    let hoursLeft = num(d.hours_left);
    if (hoursLeft == null && num(d.days_left) != null) hoursLeft = num(d.days_left) * 24;
    if (hoursLeft == null && balance != null && hourlyCost > 0) hoursLeft = (balance + bonus) / hourlyCost;
    if (balance == null && hoursLeft == null) return null;
    return { balance, bonus, hourlyCost, monthlyCost, hoursLeft: hoursLeft == null ? null : Math.max(0, hoursLeft) };
}

// Сколько часов осталось сейчас, если `hoursLeft` было верно `ageMs` назад.
// Деньги списываются почасово, и счётчик между опросами честно идёт вниз.
export function hoursLeftAfter(hoursLeft, ageMs) {
    if (hoursLeft == null) return null;
    return Math.max(0, hoursLeft - Math.max(0, ageMs) / 3_600_000);
}

// 566.4 → «23 д 14 ч», 14.9 → «14 ч», 0.4 → «меньше часа».
export function formatLeft(hours) {
    if (hours == null) return '—';
    const h = Math.floor(hours);
    if (h <= 0) return hours > 0 ? 'меньше часа' : '0 ч';
    const d = Math.floor(h / 24);
    return d ? `${d} д ${h % 24} ч` : `${h} ч`;
}

// Тон счётчика: меньше трёх дней — тревога, меньше недели — пора пополнять.
export const LOW_DAYS = 7;
export const CRITICAL_DAYS = 3;
export function lifeTone(hours) {
    if (hours == null) return 'muted';
    if (hours < CRITICAL_DAYS * 24) return 'red';
    if (hours < LOW_DAYS * 24) return 'gold';
    return 'green';
}
