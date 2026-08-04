// ─────────────────────────────────────────────────────────────────────────────
// Лента активности (как «квадратики» на GitHub): по клетке на каждый день,
// яркость клетки — от количества СДЕЛАННЫХ ЗАПИСЕЙ в этот день.
//
// Считаем ровно то же, что и месячный топ, — строки record_credits
// (см. db/migrations/020_record_credits.sql): одна запись = одна клетка-единица,
// длинная (продлённая) запись — тоже одна, продолжения не считаются вовсе.
// День берётся в МСК, как и месяц зачёта, иначе вечерние записи уезжали бы в
// соседний квадрат.
//
// ЯРКОСТЬ СЧИТАЕТСЯ ОТ СРЕДНЕГО, а не от фиксированных порогов: у одного
// человека 20 записей в день — обычный вторник, у другого — рекорд месяца.
// Среднее берём по АКТИВНЫМ дням (где записи были): выходные и отпуска не
// должны занижать планку, иначе у любого, кто работает 2/2, «средний» день
// светился бы максимумом. День ровно на среднем — середина шкалы (2 из 4).
//
// Модуль общий (shared/), потому что сетку строит фронт, а данные готовит
// бэкенд, и порядок дней/недель у них должен совпадать до клетки.
// Даты везде — строки 'YYYY-MM-DD': арифметика идёт в UTC, поэтому таймзона
// браузера не может сдвинуть день на границе суток.
// ─────────────────────────────────────────────────────────────────────────────

// Сколько дней показываем: год, считая сегодняшний день.
export const HEATMAP_DAYS = 365;

const DAY_MS = 86_400_000;

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн',
                      'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                         'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// Неделя начинается с понедельника (0 = Пн … 6 = Вс) — колонка сетки читается
// сверху вниз как обычная рабочая неделя, а не как воскресная у GitHub.
export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function pad2(n) { return String(n).padStart(2, '0'); }

// 'YYYY-MM-DD' → миллисекунды UTC (null, если строка не дата).
function parseIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function toIso(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function addDays(iso, delta) {
    const ms = parseIso(iso);
    return ms === null ? null : toIso(ms + delta * DAY_MS);
}

// 0 = понедельник … 6 = воскресенье.
export function weekdayIndex(iso) {
    const ms = parseIso(iso);
    return ms === null ? null : (new Date(ms).getUTCDay() + 6) % 7;
}

// '2026-08-04' → «4 августа 2026». Свой форматтер, а не toLocaleDateString:
// формат не должен зависеть от локали браузера и от того, дорисует ли она «г.».
export function formatDayRu(iso) {
    const ms = parseIso(iso);
    if (ms === null) return '';
    const d = new Date(ms);
    return `${d.getUTCDate()} ${MONTHS_GENITIVE[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// «1 запись / 2 записи / 5 записей» — используется и лентой, и топом.
export function recordsWord(n) {
    const mod10 = Math.abs(n) % 10;
    const mod100 = Math.abs(n) % 100;
    if (mod10 === 1 && mod100 !== 11) return 'запись';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'записи';
    return 'записей';
}

// Уровень яркости 0…4 относительно среднего по активным дням.
// 0 — записей не было; 4 — заметно выше среднего (в полтора раза и больше).
export function activityLevel(count, average) {
    if (!(count > 0)) return 0;
    if (!(average > 0)) return 1;      // среднего нет — не с чем сравнивать
    const ratio = count / average;
    if (ratio <= 0.5) return 1;
    if (ratio <= 1) return 2;          // ровно среднее — середина шкалы
    if (ratio <= 1.5) return 3;
    return 4;
}

// Подпись под курсором: «3 записи · 4 августа 2026».
export function dayTitle(cell) {
    const count = cell?.count || 0;
    const head = count ? `${count} ${recordsWord(count)}` : 'Записей нет';
    return `${head} · ${formatDayRu(cell?.date)}`;
}

// Подписи месяцев над сеткой: одна на месяц, привязана к первой неделе, чей
// понедельник уже в этом месяце. Обрезанный краем года месяц (одна колонка)
// подписываем только если он последний: слева такая подпись налезла бы на
// соседнюю, а справа за ней ничего нет — и текущий месяц лучше подписать.
function monthLabels(weeks) {
    const raw = [];
    let last = null;
    weeks.forEach((week, weekIndex) => {
        const first = week.find(Boolean);
        if (!first) return;
        const month = first.date.slice(0, 7);
        if (month === last) return;
        last = month;
        raw.push({ month, label: MONTHS_SHORT[Number(month.slice(5, 7)) - 1], weekIndex });
    });
    return raw
        .map((m, i) => ({
            ...m,
            span: (i + 1 < raw.length ? raw[i + 1].weekIndex : weeks.length) - m.weekIndex,
        }))
        .filter((m, i, all) => m.span >= 2 || i === all.length - 1);
}

// ── Главное: сетка недель ────────────────────────────────────────────────────
// days — [{ date: 'YYYY-MM-DD', count: N }] (только дни с записями, порядок не
// важен), from/to — границы окна включительно (даёт бэкенд, в МСК).
//
// Возвращает:
//   weeks   — колонки сетки: массив недель по 7 клеток (Пн…Вс). Дни за
//             границами окна — null (пустое место в первой/последней колонке).
//   months  — подписи месяцев { label, weekIndex, span }
//   total, activeDays, average, best — цифры для строки-итога.
export function buildHeatmap({ days = [], from, to } = {}) {
    const end = parseIso(to);
    if (end === null) return { weeks: [], months: [], total: 0, activeDays: 0, average: 0, best: 0, from: null, to: null };
    const start = parseIso(from) ?? end - (HEATMAP_DAYS - 1) * DAY_MS;

    const counts = new Map();
    for (const d of days) {
        const date = typeof d?.date === 'string' ? d.date : null;
        const count = Number(d?.count) || 0;
        if (date && count > 0) counts.set(date, (counts.get(date) || 0) + count);
    }

    // Сетка всегда начинается с понедельника — иначе строки «Пн/Ср/Пт» слева
    // врали бы, а колонки перестали быть неделями.
    const gridStart = start - weekdayIndex(toIso(start)) * DAY_MS;

    const weeks = [];
    const cells = [];
    for (let weekMs = gridStart; weekMs <= end; weekMs += 7 * DAY_MS) {
        const week = [];
        for (let i = 0; i < 7; i++) {
            const ms = weekMs + i * DAY_MS;
            if (ms < start || ms > end) { week.push(null); continue; }
            const date = toIso(ms);
            const cell = { date, count: counts.get(date) || 0, level: 0 };
            week.push(cell);
            cells.push(cell);
        }
        weeks.push(week);
    }

    const active = cells.filter(c => c.count > 0);
    const total = active.reduce((sum, c) => sum + c.count, 0);
    const average = active.length ? total / active.length : 0;
    for (const cell of cells) cell.level = activityLevel(cell.count, average);

    return {
        weeks,
        months: monthLabels(weeks),
        total,
        activeDays: active.length,
        average,
        best: active.reduce((max, c) => Math.max(max, c.count), 0),
        from: toIso(start),
        to: toIso(end),
    };
}
