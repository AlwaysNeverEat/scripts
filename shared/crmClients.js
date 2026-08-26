// ─────────────────────────────────────────────────────────────────────────────
// Поиск клиента в CRM по телефону или гос. номеру и разбор трёх её страниц:
// «Обзвон клиентов» (/dial_clients/), карточка клиента (/clients/N) и чек
// (/sale/N). Чистые функции на строках — без DOM: одинаково работают в
// Node-тестах, на бэкенде (прокси) и на фронте.
//
// Зачем вообще разбирать HTML: у CRM нет API, а оператору за стойкой нужен
// ОДИН экран — кто звонит, на чём ездит, сколько баллов и что ему делали.
// В самой CRM это четыре страницы и по клику на каждый чек, поэтому сайт
// собирает всё сам и показывает одной карточкой (frontend/src/clientSearch.js).
//
// Маски ввода тоже живут здесь, а не в окне поиска: «что такое правильный
// телефон и правильный гос. номер» — то же знание, которым потом проверяется
// запрос перед походом в CRM, и раздваивать его нельзя.
// ─────────────────────────────────────────────────────────────────────────────

import { stripTags, parseRawPrice } from './crmAnalyse.js';

// ── Маски ввода ──────────────────────────────────────────────────────────────

// Телефон всегда российский: CRM и сама показывает поле как +7 (000) 000-00-00.
// Ведущие 7 и 8 съедаются — человек набирает номер так, как он записан у него
// в телефоне, а не так, как удобно маске.
export function formatPhoneInput(raw) {
    let digits = String(raw ?? '').replace(/\D/g, '');
    if (digits[0] === '7' || digits[0] === '8') digits = digits.slice(1);
    digits = digits.slice(0, 10);
    if (!digits) return '';
    let out = '+7 (' + digits.slice(0, 3);
    if (digits.length >= 3) out += ')';
    if (digits.length > 3) out += ' ' + digits.slice(3, 6);
    if (digits.length > 6) out += '-' + digits.slice(6, 8);
    if (digits.length > 8) out += '-' + digits.slice(8, 10);
    return out;
}

// 10 цифр номера без кода страны. Считаются ПО МАСКЕ, а не по сырым цифрам:
// в недобранном «+7 (981) 965-19-1» сырых цифр ровно десять, и наивный подсчёт
// объявил бы такой номер полным. Маска — единственное место, которое знает,
// какая семёрка тут код страны, а какая часть номера.
export function phoneDigits(masked) {
    const digits = formatPhoneInput(masked).replace(/\D/g, '');
    return digits.startsWith('7') ? digits.slice(1) : '';
}

export function phoneComplete(masked) {
    return phoneDigits(masked).length === 10;
}

// ГОСТовский набор букв: только те кириллические, что совпадают по начертанию
// с латиницей. Их же перечисляет сама CRM в обработчике поля «Номер авто».
const PLATE_LETTERS = 'АВЕКМНОРСТУХ';
// Раскладку переключать ради номера никто не будет: латинские двойники
// молча превращаем в кириллицу — на настоящем знаке буквы именно такие.
const LATIN_TO_PLATE = {
    A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н',
    O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х',
};

// Формат х111хх11(1): буква, три цифры, две буквы, две-три цифры региона.
// Маска позиционная — лишний символ не сдвигает номер, а просто не вводится.
const PLATE_SHAPE = 'LDDDLLDDD';

export function formatPlateInput(raw) {
    const src = String(raw ?? '').toUpperCase();
    let out = '';
    for (const ch of src) {
        const slot = PLATE_SHAPE[out.length];
        if (!slot) break;
        const norm = LATIN_TO_PLATE[ch] || ch;
        if (slot === 'L' && PLATE_LETTERS.includes(norm)) out += norm;
        else if (slot === 'D' && norm >= '0' && norm <= '9') out += norm;
    }
    return out;
}

const PLATE_RE = new RegExp(`^[${PLATE_LETTERS}]\\d{3}[${PLATE_LETTERS}]{2}\\d{2,3}$`);

export function plateComplete(value) {
    return PLATE_RE.test(formatPlateInput(value));
}

// ── Адреса страниц CRM ───────────────────────────────────────────────────────

// Дата в форме «Обзвона» отвечает за таблицу продаж за день, а не за поиск,
// но CRM ждёт её в запросе — отдаём сегодняшнюю в её же формате.
export function crmDateToday(now = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${p(now.getDate())}.${p(now.getMonth() + 1)}.${now.getFullYear()}`;
}

// Поиск идёт ровно тем же GET-ом, что и форма «Найти клиента» в CRM: телефон
// в маске, гос. номер как есть. Пустое поле остаётся пустым — CRM ищет по
// заполненному.
export function clientSearchPath({ phone = '', plate = '', date } = {}) {
    const params = new URLSearchParams({
        phone: phone ? formatPhoneInput(phone) : '',
        vehicleNumber: plate ? formatPlateInput(plate) : '',
        date: date || crmDateToday(),
    });
    return `/dial_clients/?${params.toString()}`;
}

export const clientPath = (id) => `/clients/${encodeURIComponent(id)}`;
export const salePath = (id) => `/sale/${encodeURIComponent(id)}`;

// ── Разбор: список найденных клиентов ────────────────────────────────────────

// <div class="found-clients-list"> … <a href=".../clients/151465">Георгий</a>
// Пустой список — это не ошибка, а «ничего не найдено»: CRM отвечает 200 и
// заменяет заголовок над списком.
export function parseClientSearch(html) {
    const src = String(html || '');
    const block = src.match(/<div class="found-clients-list">([\s\S]*?)<\/div>\s*<\/div>/)
        || src.match(/<div class="found-clients-list">([\s\S]*?)<script/);
    const clients = [];
    if (block) {
        const re = /<a[^>]*href="[^"]*\/clients\/(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
        let m;
        while ((m = re.exec(block[1]))) {
            const name = stripTags(m[2]);
            clients.push({ id: m[1], name: name || 'Без имени' });
        }
    }
    return { clients, searched: /found-clients-list/.test(src) };
}

// ── Разбор: таблица CRM ──────────────────────────────────────────────────────

// Таблицы и в карточке клиента, и в чеке размечены одинаково: строка несёт
// data-id, ячейка — data-name. Поэтому разбор один на обе.
function parseCrmTable(html, tableId) {
    const table = String(html || '').match(
        new RegExp(`<table[^>]*id="${tableId}"[\\s\\S]*?<\\/table>`),
    );
    if (!table) return [];
    const rows = [];
    const rowRe = /<tr[^>]*class="table__row[^"]*"[^>]*data-id="(\d+)"[^>]*>([\s\S]*?)<\/tr>/g;
    let r;
    while ((r = rowRe.exec(table[0]))) {
        const cells = {};
        const cellRe = /<td[^>]*data-name="([^"]+)"[^>]*>([\s\S]*?)<\/td>/g;
        let c;
        while ((c = cellRe.exec(r[2]))) cells[c[1]] = stripTags(c[2]);
        rows.push({ id: r[1], cells });
    }
    return rows;
}

// Пустая ячейка — это null, а не 0: «пробег не записали» и «пробег ноль» на
// карточке выглядят по-разному.
function numOrNull(text) {
    const s = String(text ?? '').trim();
    return s ? parseRawPrice(s) : null;
}

// CRM пишет время как «28.07.2026 19:34:32» — по такой строке ни отсортировать,
// ни сравнить: лексикографически 28.07.2026 меньше, чем 07.02.2024. Переводим
// в число ГГГГММДДЧЧММСС. Пустая или непонятная отметка даёт 0 — такие чеки
// уезжают в конец списка, а не притворяются свежими.
export function crmStampValue(stamp) {
    const m = String(stamp || '').match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return 0;
    const [, dd, mm, yyyy, hh = '00', mi = '00', ss = '00'] = m;
    return Number(`${yyyy}${mm}${dd}${hh}${mi}${ss}`);
}

// ── Разбор: карточка клиента ─────────────────────────────────────────────────

// Значение из левой панели: <p> Имя: Георгий </p>. Метки уникальны, поэтому
// ищем по метке, а не по порядку абзацев — CRM их переставляет.
function panelValue(html, label) {
    const re = new RegExp(`<p>\\s*${label}:([\\s\\S]*?)<\\/p>`);
    const m = String(html || '').match(re);
    return m ? stripTags(m[1]) : '';
}

// «01.12.-0001» — так CRM показывает НЕЗАПОЛНЕННУЮ дату рождения. Показывать
// это оператору нельзя: год до нашей эры читается как поломка сайта.
function realBirthday(text) {
    const s = String(text || '').trim();
    return !s || /-0001|0000/.test(s) ? null : s;
}

export function parseClientCard(html, id) {
    const src = String(html || '');

    const plates = [];
    const platesAt = src.indexOf('vehicle-numbers-header');
    if (platesAt >= 0) {
        const re = /<div>\s*([^<>]+?)\s*<\/div>/g;
        re.lastIndex = platesAt;
        let m;
        while ((m = re.exec(src))) {
            const plate = formatPlateInput(m[1]);
            // Первый же div без номера — это уже следующий блок панели.
            if (!plate || plate.length < 4) break;
            if (!plates.includes(plate)) plates.push(plate);
        }
    }

    // Чеки CRM отдаёт от старых к новым, а оператору нужен последний визит —
    // с него разговор и начинается. Разворачиваем здесь, а не в окне: «что
    // считать более поздним чеком» — это знание о данных CRM, а не о вёрстке.
    const sales = parseCrmTable(src, 'clients').map(row => ({
        id: row.id,
        seller: row.cells.seller || '',
        station: row.cells.station_name || '',
        count: numOrNull(row.cells.count),
        paidBonus: numOrNull(row.cells.paid_bonus),
        sum: numOrNull(row.cells.sum),
        receivedBonus: numOrNull(row.cells.received_bonus),
        mileage: numOrNull(row.cells.mileage),
        plate: formatPlateInput(row.cells.vehicle_number || ''),
        createdAt: row.cells.date_create || '',
        closedAt: row.cells.closed_at || '',
        comment: row.cells.call_center_comment || '',
    })).sort((a, b) =>
        crmStampValue(b.closedAt || b.createdAt) - crmStampValue(a.closedAt || a.createdAt));

    const nameFromTitle = (src.match(/<h1>\s*Продажи клиента\s*([\s\S]*?)<\/h1>/) || [])[1];
    return {
        id: String(id || ''),
        name: panelValue(src, 'Имя') || stripTags(nameFromTitle || '') || 'Без имени',
        phone: panelValue(src, 'Телефон'),
        bonus: numOrNull(panelValue(src, 'Бонусный счет')),
        birthday: realBirthday(panelValue(src, 'День рождения')),
        plates,
        sales,
    };
}

// ── Разбор: чек ──────────────────────────────────────────────────────────────

// Способ оплаты CRM показывает только картинкой (cash / cashless) — берём его
// из имени файла: подписи в разметке нет вовсе.
function paymentKind(html) {
    const icon = String(html || '').match(/<span class="payment-icon">([\s\S]*?)<\/span>/);
    if (!icon) return null;
    const src = (icon[1].match(/src="([^"]*)"/) || [])[1] || '';
    if (/cashless/i.test(src)) return 'cashless';
    if (/cash/i.test(src)) return 'cash';
    return null;
}

export function parseSale(html, id) {
    const src = String(html || '');
    const title = stripTags((src.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1] || '');
    // «Продажа №3606371 от 28.07.2026 19:35 Руставели 69»
    const head = title.match(/от\s+([\d.]+\s+[\d:]+)\s*(.*)$/);

    const items = parseCrmTable(src, 'sales_items').map(row => ({
        id: row.id,
        name: row.cells.name || '',
        price: numOrNull(row.cells.price),
        count: numOrNull(row.cells.count),
        sum: numOrNull(row.cells.sum),
        discount: row.cells.discount || '',
        total: numOrNull(row.cells.total_sum),
        minutes: numOrNull(row.cells.time_services),
    }));

    const paidText = (src.match(/<p class="paid-line-sale">\s*Оплачено:\s*([^<]*)/) || [])[1];
    return {
        id: String(id || ''),
        title,
        date: head ? head[1] : '',
        station: head ? head[2].trim() : '',
        paid: numOrNull(paidText),
        payment: paymentKind(src),
        items,
    };
}
