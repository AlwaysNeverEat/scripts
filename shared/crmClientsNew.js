// ─────────────────────────────────────────────────────────────────────────────
// Поиск клиента в НОВОЙ CRM (crm.zamena-masla-spot.ru/re/api.php).
//
// У старой CRM API нет, и клиент там собирается регэкспами из страниц обзвона
// (crmClients.js). У новой есть JSON, и ищем мы в ТОМ ЖЕ разделе — «Обзвон»:
//
//   section=dial&all=1&phone=… | &plate=…   все продажи по телефону или
//                                           госномеру за всё время, по 50 на
//                                           страницу: дата, станция, сумма,
//                                           продавец, пробег, номер машины,
//                                           имя и телефон клиента;
//   section=sale&id=                        чек: шапка и позиции.
//
// Первой версией тут был раздел «Клиенты» (clients → clientcard), и это была
// ошибка: операторы ищут клиента в обзвоне, а «Клиенты» — другой экран, и
// именно его просмотры новая CRM считает в дневном лимите и пишет в журнал
// СБ (в её коде в этот журнал попадают clients, clientfind, clientcard и
// reveal_phone; dial и sale — нет). Обзвон к тому же отдаёт все визиты одним
// ответом — карточка собирается из него без второго запроса.
//
// Разбор переводит ответы в ТУ ЖЕ форму, что и parseClientSearch /
// parseClientCard / parseSale у старой CRM: вкладка «Клиент» рисует карточку
// одним кодом, из какой бы CRM она ни приехала.
//
// Поля ответов — из живого ответа обзвона (снят при переезде записей) и из
// кода самой новой CRM; документации у неё нет. Поэтому разбор терпим к
// отсутствию любого поля: пустое остаётся пустым, а не превращается в ноль.
// ─────────────────────────────────────────────────────────────────────────────

import { formatPlateInput, phoneDigits, crmStampValue } from './crmClients.js';

// Ответ новой CRM с отказом — не «ничего не нашлось». У неё есть дневной
// лимит просмотра клиентов («daily_limit»): обзвон в него, судя по её коду, не
// входит, но показать отказ словами CRM дешевле, чем гадать.
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

// ── Поиск: обзвон ────────────────────────────────────────────────────────────

// Телефон — одиннадцатью цифрами, как его шлёт сам обзвон («79219503808»),
// госномер — той же позиционной маской кириллицей. `all=1` — за все даты:
// без него обзвон показывает только выбранный день.
export function newDialQuery({ phone = '', plate = '', page = 1 } = {}) {
    const q = phone
        ? `&phone=${encodeURIComponent(`7${phoneDigits(phone)}`)}`
        : `&plate=${encodeURIComponent(formatPlateInput(plate))}`;
    return `section=dial&page=${page}&all=1${q}`;
}

export function parseDialPage(json) {
    const rows = Array.isArray(json?.rows) ? json.rows.filter(r => r && r.id != null) : [];
    const per = num(json?.per) || 50;
    const total = num(json?.total) ?? rows.length;
    return { rows, per, total, pages: Math.max(1, Math.ceil(total / per)) };
}

// Пробег «1» и «0» в обзвоне — это «не вписали», а не пробег: показывать
// «1 км» оператору значит показывать мусор как сведения.
function mileageOf(v) {
    const n = num(v);
    return n != null && n > 1 ? n : null;
}

// Кто есть кто. Обзвон отдаёт ПРОДАЖИ, а не клиентов, и по госномеру в них
// бывают разные люди (машину продали, за рулём жена). Клиент здесь — телефон:
// так его понимает и сама CRM. Продажи без телефона собираются по имени —
// лучше отдельная строка «Ольга без телефона», чем чужие чеки в карточке.
function clientKey(r) {
    const d = str(r.phone).replace(/\D/g, '');
    return d.length >= 10 ? d : `name:${str(r.client).toLowerCase() || '?'}`;
}

export function dialClients(rows) {
    const groups = new Map();
    for (const r of Array.isArray(rows) ? rows : []) {
        const key = clientKey(r);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    }
    const clients = [];
    for (const [key, list] of groups) {
        const sales = list.map(r => ({
            id: String(r.id),
            seller: str(r.seller),
            station: str(r.station),
            count: null,
            paidBonus: null,
            sum: num(r.total),
            receivedBonus: null,
            mileage: mileageOf(r.mileage),
            plate: formatPlateInput(str(r.plate)),
            createdAt: isoToCrmStamp(r.date),
            closedAt: '',
            // В обзвоне это комментарий отдела качества к визиту.
            comment: str(r.comment),
        })).sort((a, b) => crmStampValue(b.createdAt) - crmStampValue(a.createdAt));
        // Имя и телефон — по САМОЙ СВЕЖЕЙ продаже: клиента переименовывают
        // («Саша» → «Александр Петров»), и верное имя у последнего визита.
        const fresh = list.slice().sort((a, b) =>
            crmStampValue(isoToCrmStamp(b.date)) - crmStampValue(isoToCrmStamp(a.date)));
        const name = fresh.map(r => str(r.client)).find(Boolean) || 'Без имени';
        const phone = fresh.map(r => str(r.phone)).find(Boolean) || '';
        const plates = [];
        for (const s of sales) if (s.plate.length >= 4 && !plates.includes(s.plate)) plates.push(s.plate);
        clients.push({
            id: key,
            name,
            phone,
            plates,
            visits: sales.length,
            // Карточка целиком: обзвон уже отдал всё, что в ней есть, и ходить
            // за ней вторым запросом незачем. Баллов в обзвоне нет — null, а не
            // ноль: «0 баллов» было бы враньём.
            card: { id: key, name, phone, bonus: null, birthday: null, plates, sales },
        });
    }
    // Свежий клиент вперёд: по госномеру первым должен стоять тот, кто ездит
    // на машине сейчас.
    return clients.sort((a, b) =>
        crmStampValue(b.card.sales[0]?.createdAt) - crmStampValue(a.card.sales[0]?.createdAt));
}

// ── Чек ──────────────────────────────────────────────────────────────────────

// Способ оплаты новая CRM пишет словами («Нал», «Б/н», «МИР», «Наличный
// расчёт», «Безналичный расчёт»), а карточка знает два значка — наличные и карта.
// Отложенный и раздельный платёж значка не получают: соврать «картой» хуже,
// чем промолчать.
function paymentOf(h) {
    const text = `${str(h.pay)} ${str(h.pay_full)}`.toLowerCase();
    if (/безнал|б\/н|мир|карт/.test(text)) return 'cashless';
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
