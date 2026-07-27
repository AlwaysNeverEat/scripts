// ─────────────────────────────────────────────────────────────────────────────
// Разбор страницы записей админки ZMS (zamena-masla-spot.ru/admin/record) и
// доменная логика поверх неё. Как и crmAnalyse.js — чистые регулярки без DOM:
// один и тот же код работает в Node (бэкенд-прокси, тесты) и в браузере.
//
// Контракт разметки (см. фикстуру admin-record-page.html):
//   <th id="address_id_N">Título</th>                       — колонки-адреса
//   <tr data-time="H"> … затем соседний <tr> без data-time  — пара строк H:00/H:30
//   <div class="address_id_N r-stat-head">HH:MM-HH:MM …
//        <a href="/admin/record/edit?id=…">изменить</a>
//        <a href="/admin/record/delete?id=…&time=…&address_id=N">удалить</a>
//        Имя / +7 (XXX) XXX-XX-XX /</div>                   — одна запись (30 мин)
//   перед записью может стоять маркер статуса:
//   <div class="checked|too-late|is-new" …><svg class="…">…</svg></div>
//   <a href="/admin/record/create?time=DD.MM.YYYY+HH%3AMM&address_id=N">Добавить</a>
//        — один свободный бокс в этом слоте
//   пустая ячейка (ни записей, ни «Добавить») — слот закрыт.
//
// Блоки записей и ссылки «Добавить» самоописательные (address_id в классе/URL,
// время в тексте/URL), поэтому позиционный разбор таблицы не нужен — достаточно
// последовательного прохода по документу, что сильно устойчивее к переносам
// строк и лишним </div> (в оригинале разметка с ошибками).
// ─────────────────────────────────────────────────────────────────────────────

// Телефон-заглушка, которым оригинальная CRM помечает слоты-продолжения
// («SMS клиенту не отправляется») — см. юзерскрипт «Продлить запись».
export const EXTENSION_STUB_PHONE = '+71111111111';
export const SLOT_MINUTES = 30;
// Потолок одной записи (и одного продления) — сутки. Это защита от опечатки, а
// не рабочее ограничение: бокс иногда закрывают на весь день целиком, поэтому
// реальный предел задаёт само расписание (свободный промежуток до конца дня).
// Общий для бэкенда (валидация операции) и интерфейса (выбор длительности).
export const MAX_DURATION_MIN = 24 * 60;

// Столько слотов максимум может тронуть одна операция переноса/удаления —
// хватает на запись во весь рабочий день (48 получасов в сутках).
export const MAX_OP_RECORDS = 48;

const TAG_RE = /<[^>]*>/g;

function stripTags(html) {
    return String(html || '').replace(TAG_RE, ' ').replace(/&nbsp;/g, ' ');
}

function decodeEntities(s) {
    return String(s || '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'");
}

export function normPhoneDigits(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1);
    return d;
}

// Телефон в формате оригинальной админки: «+7 (921) 123-45-67». Принимает
// что угодно — «9211234567», «89211234567», «+7 921 123 45 67»: код страны в
// начале отбрасывается, лишние символы игнорируются. Используется маской
// поля ввода, поэтому обязана корректно форматировать и неполный номер.
export function formatRuPhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d[0] === '8' || d[0] === '7') d = d.slice(1);
    d = d.slice(0, 10);
    if (!d) return '';
    let out = '+7 (' + d.slice(0, 3);
    if (d.length >= 3) out += ')';
    if (d.length > 3) out += ' ' + d.slice(3, 6);
    if (d.length > 6) out += '-' + d.slice(6, 8);
    if (d.length > 8) out += '-' + d.slice(8, 10);
    return out;
}

export const STUB_DIGITS = normPhoneDigits(EXTENSION_STUB_PHONE);

// ── Время ────────────────────────────────────────────────────────────────────

export function timeToMin(t) {
    const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return NaN;
    return Number(m[1]) * 60 + Number(m[2]);
}

export function minToTime(min) {
    const h = Math.floor(min / 60);
    const mm = min % 60;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function addMinutes(t, delta) {
    return minToTime(timeToMin(t) + delta);
}

// ── Распознавание страниц ────────────────────────────────────────────────────

export function isRecordBoard(html) {
    return /id="r-stat-table"/.test(String(html || ''));
}

export function looksLikeLoginPage(html) {
    const src = String(html || '');
    return !isRecordBoard(src) && /type=["']?password/i.test(src);
}

// ── Разбор доски записей ─────────────────────────────────────────────────────

// parseRecordBoard(html) →
// {
//   date: 'DD.MM.YYYY' | null,
//   timeSlots: ['09:00', …, '22:30'],
//   addresses: [{ id, title }],              — в порядке колонок
//   cells: { [addressId]: { [time]: { records: [rec…], free: n } } },
// }
// rec = { id, addressId, timeStart, timeEnd, name, phone, phoneDigits,
//         isStub, status: ''|'checked'|'late'|'new', customer, deleteUrl }
// Отсутствие cells[aid][time] = слот закрыт (нерабочее время).
export function parseRecordBoard(html) {
    const src = String(html || '');

    const addresses = [];
    const thRe = /<th\s+id="address_id_(\d+)"[^>]*>([\s\S]*?)<\/th>/gi;
    let th;
    while ((th = thRe.exec(src))) {
        addresses.push({ id: th[1], title: stripTags(th[2]).replace(/\s+/g, ' ').trim() });
    }

    // Диапазон рабочего дня — по строкам-часам самой таблицы, а не по константе:
    // реальная сетка 09:00–22:30, и если её расширят, клон подстроится сам.
    let minH = Infinity;
    let maxH = -Infinity;
    const trRe = /<tr\s+data-time="(\d+)"/gi;
    let tr;
    while ((tr = trRe.exec(src))) {
        const h = Number(tr[1]);
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
    }
    const timeSlots = [];
    if (Number.isFinite(minH) && maxH >= minH) {
        for (let h = minH; h <= maxH; h++) {
            timeSlots.push(minToTime(h * 60), minToTime(h * 60 + 30));
        }
    }

    let date = null;
    const dateM = src.match(/[?&]time=(\d{2}\.\d{2}\.\d{4})\+/)
        || src.match(/[?&]date=(\d{2}\.\d{2}\.\d{4})/);
    if (dateM) date = dateM[1];

    const cells = {};
    const cell = (aid, time) => {
        const byAddr = cells[aid] || (cells[aid] = {});
        return byAddr[time] || (byAddr[time] = { records: [], free: 0 });
    };

    // Последовательный проход: маркер статуса относится к БЛИЖАЙШЕЙ следующей
    // записи. Ссылки «Добавить» и заголовки колонок сбрасывают отложенный
    // маркер — статус не может «перепрыгнуть» в другую ячейку.
    const tokenRe = new RegExp(
        '<div class="(checked|too-late|is-new|dummy-icon)"'
        + '|<div class="address_id_(\\d+) r-stat-head"[^>]*>'
        + '|<a href="([^"]*\\/admin\\/record\\/create\\?[^"]*)"',
        'gi',
    );
    let pendingStatus = '';
    let tok;
    while ((tok = tokenRe.exec(src))) {
        if (tok[1]) {
            pendingStatus = tok[1] === 'checked' ? 'checked'
                : tok[1] === 'too-late' ? 'late'
                : tok[1] === 'is-new' ? 'new'
                : '';
            continue;
        }

        if (tok[3]) {
            const href = decodeEntities(tok[3]);
            const aidM = href.match(/[?&]address_id=(\d+)/);
            const timeM = href.match(/[?&]time=\d{2}\.\d{2}\.\d{4}(?:\+|%20| )(\d{1,2})(?:%3A|:)(\d{2})/i);
            pendingStatus = '';
            if (!aidM || !timeM) continue;
            const time = minToTime(Number(timeM[1]) * 60 + Number(timeM[2]));
            cell(aidM[1], time).free += 1;
            continue;
        }

        const aid = tok[2];
        const bodyStart = tok.index + tok[0].length;
        const bodyEnd = src.indexOf('</div>', bodyStart);
        const body = src.slice(bodyStart, bodyEnd === -1 ? bodyStart + 2000 : bodyEnd);

        const range = body.match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
        const editM = body.match(/record\/edit\?id=(\d+)/);
        const delM = body.match(/href="([^"]*record\/delete[^"]*)"/i);

        const textLines = stripTags(body).split('\n').map(s => s.trim()).filter(Boolean);
        // Последняя строка блока — «Имя / телефон /» (текст после ссылок).
        let customer = textLines.length ? textLines[textLines.length - 1] : '';
        customer = customer.replace(/^(изменить|удалить)\s*/i, '').trim();
        const phoneM = customer.match(/(\+?\d[\d\s()\-]{6,}\d)/);
        const phone = phoneM ? phoneM[1].trim() : '';
        const name = customer
            .replace(phone, '')
            .replace(/\s*\/\s*$/, '')
            .replace(/\s*\/\s*$/, '')
            .replace(/^\s*\/\s*/, '')
            .replace(/\s+/g, ' ')
            .trim();

        const timeStart = range ? minToTime(timeToMin(range[1])) : null;
        const phoneDigits = normPhoneDigits(phone);
        if (!editM || !timeStart) { pendingStatus = ''; continue; }

        cell(aid, timeStart).records.push({
            id: editM[1],
            addressId: aid,
            timeStart,
            timeEnd: range ? minToTime(timeToMin(range[2])) : addMinutes(timeStart, SLOT_MINUTES),
            name,
            phone,
            phoneDigits,
            isStub: phoneDigits === STUB_DIGITS,
            status: pendingStatus,
            customer,
            deleteUrl: delM ? decodeEntities(delM[1]) : '',
        });
        pendingStatus = '';
    }

    return { date, timeSlots, addresses, cells };
}

// Плоский список записей одного адреса за день (из cells).
export function flattenAddressRecords(cells, addressId) {
    const byTime = cells[addressId] || {};
    const out = [];
    for (const time of Object.keys(byTime)) {
        for (const rec of byTime[time].records) out.push(rec);
    }
    return out.sort((a, b) => timeToMin(a.timeStart) - timeToMin(b.timeStart) || String(a.id).localeCompare(String(b.id)));
}

// ── «Червячки»: цепочки продлённых записей ───────────────────────────────────

// Продление в оригинале — это N отдельных записей по 30 минут: то же имя, тот
// же адрес, слоты строго встык, у продолжений телефон-заглушка +71111111111
// (или, если оператор продлевал руками, тот же реальный номер). Головой
// цепочки становится самая ранняя запись.
//
// detectChains(records) → [{ head, parts: [rec…], timeStart, timeEnd }]
// parts включает head; одиночная запись — цепочка из одной части.
export function detectChains(records) {
    const sorted = [...records].sort(
        (a, b) => timeToMin(a.timeStart) - timeToMin(b.timeStart) || String(a.id).localeCompare(String(b.id)),
    );
    const used = new Set();
    const chains = [];

    for (const rec of sorted) {
        if (used.has(rec.id)) continue;
        used.add(rec.id);
        const parts = [rec];

        let tail = rec;
        for (;;) {
            const next = sorted.find(c =>
                !used.has(c.id)
                && c.timeStart === tail.timeEnd
                && c.name === tail.name
                && c.name !== ''
                && (c.isStub || c.phoneDigits === rec.phoneDigits));
            if (!next) break;
            used.add(next.id);
            parts.push(next);
            tail = next;
        }

        chains.push({
            head: rec,
            parts,
            timeStart: rec.timeStart,
            timeEnd: tail.timeEnd,
        });
    }
    return chains;
}

// ── Дорожки (боксы) ──────────────────────────────────────────────────────────

// Раскладываем цепочки по дорожкам, чтобы пересекающиеся по времени «червячки»
// не рисовались друг на друге. Жадный интервальный алгоритм: каждой цепочке —
// первая дорожка, освободившаяся к её началу. Дорожек минимум `boxes` (у
// станции с двумя боксами всегда две полосы времени, даже если записей мало).
// assignLanes(chains, boxes) → { lanes: n, byHeadId: { [head.id]: laneIdx } }
export function assignLanes(chains, boxes = 1) {
    const sorted = [...chains].sort(
        (a, b) => timeToMin(a.timeStart) - timeToMin(b.timeStart)
            || timeToMin(b.timeEnd) - timeToMin(a.timeEnd),
    );
    const laneEnds = Array.from({ length: Math.max(1, boxes) }, () => -Infinity);
    const byHeadId = {};

    for (const chain of sorted) {
        const start = timeToMin(chain.timeStart);
        let lane = -1;
        for (let i = 0; i < laneEnds.length; i++) {
            if (laneEnds[i] <= start) { lane = i; break; }
        }
        if (lane === -1) {
            lane = laneEnds.length;
            laneEnds.push(-Infinity);
        }
        laneEnds[lane] = timeToMin(chain.timeEnd);
        byHeadId[chain.head.id] = lane;
    }
    return { lanes: laneEnds.length, byHeadId };
}

// ── Продление и создание длинных записей ─────────────────────────────────────

// Свободные непрерывные слоты адреса, начиная строго с fromTime.
// slotInfo(time) → { open: bool, freeBoxes: n } строится вызывающей стороной
// (из cells или из /jsApi/serviceTimes).
export function contiguousFreeSlots(fromTime, timeSlots, isFree) {
    const out = [];
    let expect = fromTime;
    for (const t of timeSlots) {
        if (timeToMin(t) < timeToMin(fromTime)) continue;
        if (t !== expect) break;
        if (!isFree(t)) break;
        out.push(t);
        expect = addMinutes(t, SLOT_MINUTES);
    }
    return out;
}

// План операций для записи длиной durationMinutes: первый слот — «настоящая»
// запись с реальным телефоном клиента, остальные — продолжения с телефоном-
// заглушкой (как это делает оригинальный скрипт «Продлить запись»).
// base = { addressId, date, time, name, phone, carNumber, comment }
export function buildExtensionOps(base, durationMinutes) {
    const nSlots = Math.max(1, Math.ceil(durationMinutes / SLOT_MINUTES));
    const ops = [];
    for (let i = 0; i < nSlots; i++) {
        ops.push({
            addressId: base.addressId,
            date: base.date,
            time: addMinutes(base.time, i * SLOT_MINUTES),
            name: base.name,
            phone: i === 0 ? (base.phone || '') : EXTENSION_STUB_PHONE,
            carNumber: i === 0 ? (base.carNumber || '') : '',
            comment: i === 0 ? (base.comment || '') : '',
        });
    }
    return ops;
}

// Влезает ли запись в целевые слоты доски. board — parseRecordBoard дня
// назначения, times — слоты, которые займёт запись (по одному на каждые
// 30 минут), ownIds — id записей, которые сами переезжают: их нынешние места
// на этой же доске освободятся, поэтому «занято собой» конфликтом не считается.
// → null, если всё влезает, иначе { time, reason: 'closed' | 'busy' }.
export function findSlotConflict(board, addressId, times, ownIds = []) {
    const own = new Set([...ownIds].map(String));
    const byTime = board?.cells?.[String(addressId)] || {};
    for (const time of times) {
        const cell = byTime[time];
        if (!cell) return { time, reason: 'closed' };
        const mine = cell.records.filter(r => own.has(String(r.id))).length;
        if (cell.free + mine < 1) return { time, reason: 'busy' };
    }
    return null;
}

// Где запись лежит на доске: { addressId, time } | null. Нужно и для проверки
// «оригинал действительно принял перенос», и для отката, когда откуда именно
// уехала запись, в операции не записано.
export function findBoardRecord(board, id) {
    const target = String(id);
    for (const addressId of Object.keys(board?.cells || {})) {
        const byTime = board.cells[addressId];
        for (const time of Object.keys(byTime)) {
            if (byTime[time].records.some(r => String(r.id) === target)) return { addressId, time };
        }
    }
    return null;
}

// Строка «Копировать запись» — формат оригинального юзерскрипта.
export function buildCopyLine(date, time, addressTitle, operator = 'Сергей') {
    return `${date || '—'} ${time || '—'} ${addressTitle || '—'} (${operator})`;
}

// ── Форма /admin/record/edit ─────────────────────────────────────────────────

// На доске видны только имя и телефон, а в записи есть ещё госномер и
// комментарий. Чтобы перенос записи их не затирал, бэкенд перед POST /update
// читает текущие значения из формы редактирования. Селект time оригинал
// грузит AJAX'ом — в серверном HTML его может не быть, поэтому time здесь
// не обязателен (текущее время записи и так известно из доски).
export function parseEditForm(html) {
    const src = String(html || '');
    const formM = src.match(/<form\b[^>]*class="[^"]*edit-record-form[^"]*"[^>]*>[\s\S]*?<\/form>/i);
    if (!formM) return null;
    const form = formM[0];

    const inputValue = (name) => {
        const m = form.match(new RegExp(`<input\\b[^>]*\\bname=["']${name}["'][^>]*>`, 'i'));
        if (!m) return null;
        const v = m[0].match(/\bvalue=["']([^"']*)["']/i);
        return decodeEntities(v ? v[1] : '');
    };
    const selectedValue = (name) => {
        const m = form.match(new RegExp(`<select\\b[^>]*\\bname=["']${name}["'][^>]*>[\\s\\S]*?<\\/select>`, 'i'));
        if (!m) return null;
        const sel = m[0].match(/<option\b[^>]*\bselected\b[^>]*\bvalue=["']([^"']*)["']/i)
            || m[0].match(/<option\b[^>]*\bvalue=["']([^"']*)["'][^>]*\bselected\b/i);
        return sel ? decodeEntities(sel[1]) : '';
    };
    const textareaM = form.match(/<textarea\b[^>]*\bname=["']comment["'][^>]*>([\s\S]*?)<\/textarea>/i);

    return {
        id: inputValue('id'),
        addressId: selectedValue('address_id') ?? inputValue('address_id'),
        date: selectedValue('date') ?? inputValue('date'),
        time: selectedValue('time') ?? inputValue('time'),
        name: inputValue('name'),
        phone: inputValue('phone'),
        carNumber: inputValue('car_number'),
        comment: textareaM ? decodeEntities(textareaM[1]).trim() : inputValue('comment'),
        back: inputValue('back'),
    };
}
