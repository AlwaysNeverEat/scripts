// ─────────────────────────────────────────────────────────────────────────────
// Поиск клиента в НОВОЙ CRM (crm.zamena-masla-spot.ru/re/api.php).
//
// У старой CRM API нет, и клиент там собирается регэкспами из трёх страниц
// (crmClients.js). У новой есть JSON — те же три шага, но ручками:
//
//   section=clients&q=…     поиск по телефону или госномеру (как строка поиска
//                           в разделе «Клиенты» самой CRM);
//   section=clientcard&id=  карточка: клиент, итоги, история продаж, бонусы;
//   section=sale&id=        чек: шапка и позиции.
//
// Разбор здесь переводит ответы в ТУ ЖЕ форму, что и parseClientSearch /
// parseClientCard / parseSale у старой CRM. Вкладка «Клиент» рисует карточку
// одним кодом, из какой бы CRM она ни приехала: две вёрстки одной карточки
// разошлись бы с первой же правки.
//
// Поля ответов взяты из кода самой новой CRM (как она их рисует), а не из
// документации — её нет. Поэтому разбор терпим к отсутствию любого поля:
// пустое остаётся пустым, а не превращается в ноль.
// ─────────────────────────────────────────────────────────────────────────────

import { formatPlateInput, phoneDigits, crmStampValue } from './crmClients.js';

// Ответ новой CRM с отказом — не «ничего не нашлось». Самый важный отказ —
// ДНЕВНОЙ ЛИМИТ ПРОСМОТРА КЛИЕНТОВ: новая CRM считает, сколько карточек
// открыл каждый сотрудник, и ведёт журнал просмотров для СБ. Наш сайт ходит
// под личной сессией, поэтому лимит и журнал — те же, что в самой CRM, и
// скрывать отказ за «не найдено» нельзя.
export function newCrmRefusal(json) {
    if (!json || typeof json !== 'object' || !json.error) return null;
    if (json.error === 'daily_limit') {
        return { code: 'crm_daily_limit', message: json.message || 'Превышен дневной лимит просмотра клиентов в CRM' };
    }
    return { code: 'crm_refused', message: json.message || String(json.error) };
}

// Число из ответа CRM: бывает числом, бывает строкой («12 345,50»), бывает
// пустым. Пустое — null: «пробег не записали» и «пробег ноль» разные вещи.
function num(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

const str = (v) => (v == null ? '' : String(v).trim());

// Новая CRM пишет время как ISO («2026-07-28 19:34:32»), а карточка вкладки
// живёт на формате старой («28.07.2026 19:34»): им она делит дату и время и
// по нему сортирует. Переводим здесь, а не учим вёрстку второму формату.
export function isoToCrmStamp(value) {
    const m = str(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    if (!m) return '';
    return `${m[3]}.${m[2]}.${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}`;
}

// «—» в колонке «Автомобиль» — это пусто, а не номер.
function platesOf(car) {
    const out = [];
    for (const part of str(car).split(/[,;/]+/)) {
        const p = formatPlateInput(part);
        if (p.length >= 4 && !out.includes(p)) out.push(p);
    }
    return out;
}

// ── Поиск ────────────────────────────────────────────────────────────────────

// Телефон уходит одиннадцатью цифрами — так новая CRM хранит его сама
// («79219503808»), госномер — кириллицей без пробелов, как он стоит в чеках.
export function newClientSearchQuery({ phone = '', plate = '' } = {}) {
    const q = phone ? `7${phoneDigits(phone)}` : formatPlateInput(plate);
    return `section=clients&page=1&q=${encodeURIComponent(q)}`;
}

// `need_exact` — CRM не ищет по половине номера и говорит об этом сама.
// Мы и так ходим только с полным номером, но госномер она может счесть
// неполным по своим правилам — тогда её текст и надо показать.
export function parseNewClientSearch(json) {
    const rows = Array.isArray(json?.rows) ? json.rows : [];
    const clients = rows
        .filter(r => r && r.id != null)
        .map(r => ({
            id: String(r.id),
            name: str(r.fio) || 'Без имени',
            phone: str(r.phone),
            plates: platesOf(r.car),
            visits: num(r.changes),
        }));
    return {
        clients,
        needExact: Boolean(json?.need_exact) && !clients.length,
        message: str(json?.message),
    };
}

// ── Карточка ─────────────────────────────────────────────────────────────────

// Бонусы по чекам новая CRM отдаёт отдельным журналом, а у строки
// обслуживания в карточке место под «+N баллов / −N баллов» уже есть — туда
// их и раскладываем по номеру продажи. Корректировки и ручные правки к
// конкретному визиту не относятся и в строку не идут.
function bonusesBySale(bonuses) {
    const by = new Map();
    for (const b of Array.isArray(bonuses) ? bonuses : []) {
        if (!b || b.set_id == null || b.correction) continue;
        const key = String(b.set_id);
        const cur = by.get(key) || { received: 0, paid: 0 };
        const amount = Math.abs(num(b.amount) || 0);
        if (b.type === 'add') cur.received += amount;
        else cur.paid += amount;
        by.set(key, cur);
    }
    return by;
}

export function parseNewClientCard(json, id) {
    const c = json?.client || {};
    const bonus = bonusesBySale(json?.bonuses);
    const sales = (Array.isArray(json?.history) ? json.history : [])
        .filter(h => h && h.id != null)
        .map(h => {
            const b = bonus.get(String(h.id));
            return {
                id: String(h.id),
                seller: '',
                station: str(h.station),
                count: num(h.items),
                paidBonus: b && b.paid ? b.paid : null,
                sum: num(h.sum),
                receivedBonus: b && b.received ? b.received : null,
                mileage: num(h.mileage),
                plate: '',
                createdAt: isoToCrmStamp(h.date),
                closedAt: '',
                comment: str(h.comment),
            };
        })
        // Свежие вперёд, как у старой: разговор начинается с последнего визита.
        .sort((a, b) => crmStampValue(b.createdAt) - crmStampValue(a.createdAt));

    return {
        id: String(c.id ?? id ?? ''),
        name: str(c.fio) || 'Без имени',
        phone: str(c.phone),
        bonus: num(c.bonus),
        birthday: null,
        plates: platesOf(c.car),
        sales,
        comment: str(c.comment),
    };
}

// ── Чек ──────────────────────────────────────────────────────────────────────

// Способ оплаты новая CRM пишет словами («Нал», «МИР», «Наличный расчёт»,
// «Безнал расчёт»), а карточка знает два значка — наличные и карта.
// Отложенный и раздельный платёж значка не получают: соврать «картой» хуже,
// чем промолчать.
function paymentOf(h) {
    const text = `${str(h.pay)} ${str(h.pay_full)}`.toLowerCase();
    if (/безнал|мир|карт/.test(text)) return 'cashless';
    if (/нал/.test(text)) return 'cash';
    return null;
}

export function parseNewSale(json, id) {
    const h = json?.header || {};
    const items = (Array.isArray(json?.items) ? json.items : []).map((it, i) => {
        const pct = num(it.disc_pct);
        return {
            id: String(i + 1),
            name: str(it.name),
            price: num(it.price),
            count: num(it.count),
            sum: num(it.sum),
            discount: pct ? `${pct}%` : '',
            total: num(it.total),
            minutes: num(it.time),
        };
    });
    return {
        id: String(h.id ?? id ?? ''),
        title: str(h.name),
        date: isoToCrmStamp(h.date),
        station: str(h.station),
        paid: num(h.paid),
        payment: paymentOf(h),
        items,
        // Продавца, пробег и номер машины старая CRM отдаёт в строке карточки,
        // а новая — только в самом чеке.
        seller: str(h.seller),
        mileage: num(h.mileage),
        plate: formatPlateInput(str(h.vehicle)),
    };
}
